// Navigation map arithmetic: projection, framing, scale, bearing and distance,
// terrain tiles and label placement. Pure data and maths (no three.js, no DOM),
// like regions.js, so the map and its tests read the same numbers.
//
// Metres; +x is east, +z is south, north is up on the map. Bearings and headings
// are radians clockwise from north, as flight.js and airports.js use them.
import { WORLD, WATER_LEVEL, REGIONS, LANDMARKS } from './regions.js';
import { AIRPORTS } from './airports.js';

export const METRES_PER_NM = 1852;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---- Destination, bearing and distance -------------------------------------

/**
 * The field to navigate to, from main.js's airport state ({ selected, mission }):
 * the field of the mission underway, else the selected field. One owner of the
 * destination, so retry, cancel and switching airports follow the selection.
 */
export function navigationDestination(state) {
  const field = state?.mission ?? state?.selected;
  if (!field) return null;
  return { id: field.id, ident: field.ident, name: field.name, x: field.x, z: field.z, heading: field.heading, runway: field.runway,
    threshold: field.threshold, mission: !!state.mission };
}

/** Bearing (radians clockwise from north, 0..2π) and horizontal distance from one point to another. */
export function bearingDistance(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return { bearing: (Math.atan2(dx, -dz) + TAU) % TAU, distance: Math.hypot(dx, dz) };
}

/** Bearing relative to a heading, -π..π: negative is left of the nose. */
export const relativeBearing = (bearing, heading) => ((bearing - heading + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** Whole degrees 001–360 as headings and bearings are read. */
export const degrees = radians => String(Math.round(((radians * 180 / Math.PI) % 360 + 360) % 360) || 360).padStart(3, '0');

/** Nautical miles for a distance in metres: one decimal below 100 NM, as the flown readout. */
export function formatNM(metres) {
  const nm = metres / METRES_PER_NM;
  return `${nm < 99.95 ? nm.toFixed(1) : Math.round(nm)} NM`;
}

/** Time en route at a speed (m/s), rounded to whole minutes; '' when too slow to say. */
export function formatEte(metres, speed) {
  if (!(speed > 15)) return '';
  const minutes = Math.round(metres / speed / 60);
  return minutes < 1 ? '<1 min' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Bearing, distance and time en route to a destination from an aircraft state ({ position, heading, speed }). */
export function navigationReadout(aircraft, destination) {
  if (!destination) return null;
  const { bearing, distance } = bearingDistance(aircraft.position, destination);
  return { bearing, distance, relative: relativeBearing(bearing, aircraft.heading ?? 0), bearingText: degrees(bearing),
    distanceText: formatNM(distance), ete: formatEte(distance, aircraft.speed) };
}

// ---- Views: projection and framing -----------------------------------------

/**
 * Map spans (metres across the map's shorter side) the zoom controls step
 * through, from a close look at a field to the whole world.
 */
export const ZOOM_SPANS = Object.freeze([2500, 4000, 6000, 9000, 13000, 19000, 28000, 42000, 60000, 80000, 115000, 160000]);
export const FRAMINGS = Object.freeze(['route', 'follow', 'world']);
export const FRAMING_LABELS = Object.freeze({ route: 'Route', follow: 'Aircraft', world: 'World', free: 'Panned' });

/** A view: centre, metres per (CSS) pixel and size, with project/unproject. */
export function createView(cx, cz, metresPerPixel, width, height) {
  return {
    cx, cz, mpp: metresPerPixel, width, height,
    project: (x, z) => [(x - cx) / metresPerPixel + width / 2, (z - cz) / metresPerPixel + height / 2],
    unproject: (px, py) => ({ x: cx + (px - width / 2) * metresPerPixel, z: cz + (py - height / 2) * metresPerPixel }),
    bounds: { minX: cx - width / 2 * metresPerPixel, maxX: cx + width / 2 * metresPerPixel, minZ: cz - height / 2 * metresPerPixel, maxZ: cz + height / 2 * metresPerPixel },
  };
}

/**
 * Keep a view's centre so it shows the world rather than the void past its rim:
 * along an axis the view is narrower than the world (plus `margin`), the view
 * stays inside it; wider, it is centred on the world.
 */
export function clampCentre(cx, cz, mpp, width, height, margin = 1500) {
  const fit = (c, half, min, max) => half * 2 >= max - min + margin * 2 ? (min + max) / 2 : clamp(c, min - margin + half, max + margin - half);
  return { cx: fit(cx, width / 2 * mpp, WORLD.minX, WORLD.maxX), cz: fit(cz, height / 2 * mpp, WORLD.minZ, WORLD.maxZ) };
}

/** Index of the zoom step nearest a span. */
export const nearestZoom = span => ZOOM_SPANS.reduce((best, s, i) => Math.abs(Math.log(s / span)) < Math.abs(Math.log(ZOOM_SPANS[best] / span)) ? i : best, 0);

/**
 * The zoom step that shows a required span: grows at once, shrinks only once the
 * span fits the smaller step with 15% to spare, so the route view does not pump
 * in and out while the aircraft flies along the edge of a step.
 */
export function routeZoom(required, current = ZOOM_SPANS.length - 1, min = 2) {
  const fits = ZOOM_SPANS.findIndex(s => s >= required), grow = fits < 0 ? ZOOM_SPANS.length - 1 : Math.max(min, fits);
  if (grow >= current) return grow;
  const shrink = ZOOM_SPANS.findIndex(s => s * .85 >= required);
  return Math.max(min, Math.min(current, shrink < 0 ? current : shrink));
}

/**
 * Frame a view. `state` is { framing: 'route' | 'follow' | 'world' | 'free', zoom,
 * cx, cz } and is updated in place (route keeps its zoom for hysteresis); the
 * aircraft and destination are { x, z }. `pad` is the CSS pixels kept clear at the
 * edges for markers and labels.
 */
export function frameView(state, width, height, aircraft, destination, pad = 22) {
  const short = Math.min(width, height);
  let cx, cz, span;
  if (state.framing === 'world') {
    const mpp = Math.max(WORLD.size / (width - pad * 2), WORLD.size / (height - pad * 2));
    return createView((WORLD.minX + WORLD.maxX) / 2, (WORLD.minZ + WORLD.maxZ) / 2, mpp, width, height);
  }
  if (state.framing === 'route' && destination) {
    cx = (aircraft.x + destination.x) / 2; cz = (aircraft.z + destination.z) / 2;
    // The span (across the short side) that keeps both points `pad` from the edges.
    const need = Math.max(Math.abs(aircraft.x - destination.x) / Math.max(1, width - pad * 2), Math.abs(aircraft.z - destination.z) / Math.max(1, height - pad * 2)) * short;
    state.zoom = routeZoom(need, state.zoom ?? ZOOM_SPANS.length - 1);
    // Both points are what matters: no world-edge clamp, and wider than the last step if it takes that.
    return createView(cx, cz, Math.max(ZOOM_SPANS[state.zoom], need) / short, width, height);
  } else if (state.framing === 'free') {
    cx = state.cx; cz = state.cz; span = ZOOM_SPANS[state.zoom];
  } else {
    cx = aircraft.x; cz = aircraft.z; span = ZOOM_SPANS[state.zoom ?? 3];
  }
  const mpp = span / short, c = clampCentre(cx, cz, mpp, width, height);
  return createView(c.cx, c.cz, mpp, width, height);
}

/** Zoom in (+1) or out (-1) from whatever a view shows; the result follows the aircraft. */
export function zoomFrom(state, view, direction) {
  const current = nearestZoom(view.mpp * Math.min(view.width, view.height));
  const zoom = clamp(current - direction, 0, ZOOM_SPANS.length - 1);
  return state.framing === 'free' ? { ...state, zoom } : { framing: 'follow', zoom };
}

/** True when a projected point lies within the view, `inset` pixels inside its edges. */
export const inView = (view, [px, py], inset = 0) => px >= inset && px <= view.width - inset && py >= inset && py <= view.height - inset;

/**
 * Where to draw a pointer for a point beyond the view: the point on the rectangle
 * `inset` pixels inside the edges along the line from the view's centre, and the
 * pointer's angle (radians clockwise from map-up). Null when the point is in view.
 */
export function edgePointer(view, x, z, inset = 12) {
  const p = view.project(x, z);
  if (inView(view, p, inset)) return null;
  const dx = p[0] - view.width / 2, dy = p[1] - view.height / 2;
  const t = Math.min(dx ? (view.width / 2 - inset) / Math.abs(dx) : Infinity, dy ? (view.height / 2 - inset) / Math.abs(dy) : Infinity);
  return { x: view.width / 2 + dx * t, y: view.height / 2 + dy * t, angle: Math.atan2(dx, -dy) };
}

// ---- Scale ------------------------------------------------------------------

/** The longest round distance (1, 2 or 5 × 10ⁿ metres) whose bar is at most `maxPx` long. */
export function scaleBar(mpp, maxPx = 70) {
  const limit = mpp * maxPx;
  let metres = 10 ** Math.floor(Math.log10(limit));
  for (const k of [5, 2]) if (metres * k <= limit) { metres *= k; break; }
  return { metres, px: metres / mpp, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}

// ---- Terrain tiles ------------------------------------------------------------

// The world as a quadtree of square tiles, TILE_PIXELS across at every level:
// level 0 is the whole world at 4.4 km a pixel, each level halves that, down to
// 34 m a pixel at level 7.
export const TILE_PIXELS = 32;
export const MAX_TILE_LEVEL = 7;
export const tileMetres = level => WORLD.size / 2 ** level;

/**
 * The tile level for a view: the coarsest whose pixels are no larger than the
 * view's (times `detail`: 1 on high quality, 2 on low, which draws a level
 * coarser and samples a quarter as much ground).
 */
export function tileLevel(mpp, detail = 1, maxLevel = MAX_TILE_LEVEL) {
  const level = Math.ceil(Math.log2(WORLD.size / TILE_PIXELS / (mpp * detail)));
  return clamp(level, 0, maxLevel);
}

/** The tiles ({ level, i, j, key, minX, minZ, size }) at a level that cover a view, centre first. */
export function tilesFor(view, level) {
  const size = tileMetres(level), n = 2 ** level, b = view.bounds, out = [];
  const i0 = clamp(Math.floor((b.minX - WORLD.minX) / size), 0, n - 1), i1 = clamp(Math.floor((b.maxX - WORLD.minX) / size), 0, n - 1);
  const j0 = clamp(Math.floor((b.minZ - WORLD.minZ) / size), 0, n - 1), j1 = clamp(Math.floor((b.maxZ - WORLD.minZ) / size), 0, n - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(tile(level, i, j));
  const mid = (i, j) => Math.hypot(WORLD.minX + (i + .5) * size - view.cx, WORLD.minZ + (j + .5) * size - view.cz);
  return out.sort((a, b2) => mid(a.i, a.j) - mid(b2.i, b2.j));
}

export function tile(level, i, j) {
  const size = tileMetres(level);
  return { level, i, j, key: `${level}/${i}/${j}`, minX: WORLD.minX + i * size, minZ: WORLD.minZ + j * size, size };
}

/** The tile one level up holding a tile, and which quarter of it (0/1 in i and j) the tile is. */
export const parentTile = t => t.level ? { ...tile(t.level - 1, t.i >> 1, t.j >> 1), qi: t.i & 1, qj: t.j & 1 } : null;

const WATER = [37, 86, 92];
// Ground colour by height: olive valley floors, grey-green slopes, bare rock, then snow.
const RAMP = [[0, [50, 64, 46]], [900, [84, 92, 74]], [1800, [112, 115, 106]], [2800, [150, 154, 148]]];
function groundColour(h) {
  let k = 1;
  while (k < RAMP.length - 1 && h > RAMP[k][0]) k++;
  const [h0, c0] = RAMP[k - 1], [h1, c1] = RAMP[k], t = clamp((h - h0) / (h1 - h0), 0, 1);
  return c0.map((c, i) => c + (c1[i] - c) * t);
}
/**
 * Colour for a map pixel from its four corner heights (`spacing` metres apart):
 * teal water, ground by height (groundColour), shaded by slope (lit from the
 * north-west) with a dark contour every 200 m.
 */
export function terrainColour(h00, h10, h01, h11, spacing) {
  const h = (h00 + h10 + h01 + h11) / 4;
  if (h <= WATER_LEVEL + .1) return WATER;
  const gx = (h10 + h11 - h00 - h01) / 2 / spacing, gz = (h01 + h11 - h00 - h10) / 2 / spacing;
  const shade = clamp((gx + gz) * 24, -20, 20);
  const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
  const contour = Math.floor(lo / 200) !== Math.floor(hi / 200) && lo > WATER_LEVEL + 5 ? -8 : 0;
  return groundColour(h).map(c => clamp(c + shade + contour, 0, 255));
}

/**
 * Raster one tile: RGBA bytes, TILE_PIXELS square, from (TILE_PIXELS + 1)² height
 * samples at the pixel corners. `heightAt` is the world's own height function.
 */
export function rasterTile(t, heightAt, pixels = TILE_PIXELS) {
  const n = pixels + 1, step = t.size / pixels, h = new Float64Array(n * n), data = new Uint8ClampedArray(pixels * pixels * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = heightAt(t.minX + i * step, t.minZ + j * step);
  for (let j = 0; j < pixels; j++) for (let i = 0; i < pixels; i++) {
    const c = terrainColour(h[j * n + i], h[j * n + i + 1], h[(j + 1) * n + i], h[(j + 1) * n + i + 1], step), o = (j * pixels + i) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return data;
}

// ---- Labels -------------------------------------------------------------------

/**
 * Places named for the map: every airport, the named regions and landmarks,
 * each with a priority (lower is placed first) and the span (metres) beyond
 * which it is left off. A name appears once: a region's landmark, or a pass an
 * airport is named after, is left to the region or the airport.
 */
export function mapPlaces() {
  const places = [], seen = new Set(AIRPORTS.map(a => a.name)); // An airport's own label already names its place.
  const add = p => { if (!seen.has(p.name)) { seen.add(p.name); places.push(p); } };
  for (const r of REGIONS) if (r.id !== 'outer-ranges') {
    const [x0, z0, x1, z1] = r.bounds;
    const at = { 'central-valley': [-1500, 6800], 'southern-basin': [1200, 31500], 'northern-range': [1500, -22000], 'southern-coast': [3000, 51000],
      'northern-glaciers': [-8000, -53500], 'eastern-lowlands': [57000, -8000], 'western-highlands': [-52000, 14000] }[r.id] ?? [(x0 + x1) / 2, (z0 + z1) / 2];
    add({ name: r.name, kind: 'region', x: at[0], z: at[1], priority: 3, minSpan: 13000, maxSpan: Infinity });
  }
  const rank = { lake: 4, sea: 4, peak: 5, pass: 5, plateau: 4, valley: 4, glacier: 4, caldera: 4, fjord: 5, river: 5, escarpment: 5, island: 6, gorge: 5, butte: 6, cone: 6, village: 7, town: 6 };
  for (const l of LANDMARKS) if (l.type !== 'airport') add({ name: l.name, kind: l.type, x: l.x, z: l.z, priority: rank[l.type] ?? 6, minSpan: 0, maxSpan: l.type === 'village' ? 20000 : 45000 });
  return places;
}

/** Airports in drawing order, the destination last so it sits on top. */
export const mapAirports = destinationId => [...AIRPORTS].sort((a, b) => (a.id === destinationId) - (b.id === destinationId));

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Greedy label placement. Each label is { id, w, h, x, y (anchor), priority,
 * offsets? } and is tried at its offsets (default right, left, above, below the
 * anchor) in priority order; it is kept at the first position that lies wholly
 * inside the view (`margin` from the edges) and clear of every label already
 * placed and every `reserved` rectangle. Returns the placed labels with their
 * box { x, y, w, h } (top-left); the rest are left off.
 */
export function placeLabels(labels, width, height, reserved = [], margin = 4) {
  const placed = [], taken = [...reserved];
  for (const label of [...labels].sort((a, b) => a.priority - b.priority)) {
    const gap = label.gap ?? 7, { w, h } = label;
    const offsets = label.offsets ?? [[gap, -h / 2], [-gap - w, -h / 2], [-w / 2, -gap - h], [-w / 2, gap]];
    for (const [ox, oy] of offsets) {
      const box = { x: label.x + ox, y: label.y + oy, w, h };
      if (box.x < margin || box.y < margin || box.x + w > width - margin || box.y + h > height - margin) continue;
      if (taken.some(r => overlaps(r, box))) continue;
      taken.push(box); placed.push({ ...label, box });
      break;
    }
  }
  return placed;
}

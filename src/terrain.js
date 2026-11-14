// The one height function: flight collisions, scenery placement, the map and the
// rendered mesh call groundHeight; the lake shader runs groundShader, the same
// arithmetic in GLSL, so water always knows its true depth. Keep them in step:
// every change below has its twin in the template further down.
import { AIRFIELD } from './airfield.js';
import { SHAPES, ROUTES, WORLD, CORE } from './regions.js';
import { GRADED_AIRPORTS } from './airports.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export function hash(x, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function noise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz); return mix(mix(hash(ix, iz), hash(ix + 1, iz), sx), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz); }
export function fbm(x, z) { return noise(x, z) * .55 + noise(x * 2.03 + 17, z * 2.03 + 31) * .27 + noise(x * 4.13 + 51, z * 4.13 + 11) * .12 + noise(x * 8.17, z * 8.17) * .06; }
function ridge(x, z) { return 1 - Math.abs(noise(x, z) * 2 - 1); }

const { westValley: W, plateau: P, basin: B, divide: D, rim: R, trough: T, lowlands: L, sea: S, highlands: H } = SHAPES;
// Four widths (plus the wobble of up to 370 m) from its line a corridor has
// handed the ground back to the mountainside, so points outside this box skip it.
const boxed = r => {
  const reach = r.width * 4 + 400, xs = r.points.map(p => p[0]), zs = r.points.map(p => p[1]);
  return { ...r, box: [Math.min(...xs) - reach, Math.min(...zs) - reach, Math.max(...xs) + reach, Math.max(...zs) + reach] };
};
const CARVED = ROUTES.filter(r => r.carve !== false && !r.outer).map(boxed);
const OUTER_CARVED = ROUTES.filter(r => r.carve !== false && r.outer).map(boxed);
// The trough is cut within 2.2 half-widths (plus its wobble) of its line.
const TROUGH_BOX = (() => {
  const reach = Math.max(...T.points.map(p => p[3])) * 2.2 + 800, xs = T.points.map(p => p[0]), zs = T.points.map(p => p[1]);
  return [Math.min(...xs) - reach, Math.min(...zs) - reach, Math.max(...xs) + reach, Math.max(...zs) + reach];
})();
const { x: airportX, z: airportZ, elevation: airportY } = AIRFIELD;
// Oxbow lakes: [x, z, radius, ux, uz], a ring left open toward (ux, uz).
const OXBOWS = L.oxbows.map(([x, z, r, open]) => [x, z, r, Math.sin(open), -Math.cos(open)]);
// Lava flows: [ux, uz, length, half-width, thickness], (ux, uz) along the bearing.
const FLOWS = H.flows.map(([bearing, length, width, thick]) => [Math.sin(bearing), -Math.cos(bearing), length, width, thick]);

/** The central lake's centreline: x of the valley floor at z. */
export const valleyCurve = z => Math.sin(z * .00028) * 480 + Math.sin(z * .00074) * 170;
/** The western valley's centreline. */
export const westValleyCurve = z => W.x + Math.sin(z * W.f1 + W.p1) * W.a1 + Math.sin(z * W.f2) * W.a2 + smooth(W.bendFrom, W.bendTo, z) * W.bend;
/** Normalised distance from the southern basin's centre (1 is about the shore). */
export const basinDistance = (x, z) => Math.sqrt(((x - B.x) / B.rx) ** 2 + ((z - B.z) / B.rz) ** 2);
/** The Calme's centreline across Calmeterre: x of the river at z. */
export const calmeCurve = z => L.river.x + Math.sin(z * .00012 + .4) * 3800 + Math.sin(z * .00041 + 1.3) * 1100 + Math.sin(z * .0011) * 260 + smooth(L.river.bendFrom, L.river.bendTo, z) * L.river.bend;
/** Calmeterre's western edge at z: the foot of the Orvane Escarpment, swinging west toward the sea. */
export const lowlandEdge = z => L.edge - smooth(36000, 46000, z) * 9000;
/** Normalised distance from the Mer d'Aurin's centre (1 is about the shore). */
export const seaDistance = (x, z) => Math.sqrt(((x - S.x) / S.rx) ** 2 + ((z - S.z) / S.rz) ** 2);

// Away from the central valley its walls stop steepening: the quadratic rise is
// unchanged within 6 km and eases toward a ceiling beyond it.
const capDistance = d => d < 6000 ? d : 6000 + 3000 * (1 - Math.exp((6000 - d) / 3000));

// A corridor lowers the ground toward its floor and eases back into the original
// mountainside across its walls, so the walls keep the range's own relief.
function corridorCut(x, z, h, route, detail) {
  let best = h;
  const { points, width } = route;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.sqrt((x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2);
    if (d >= width * 4) continue; // Untouched (mix would round the height by an ulp).
    best = Math.min(best, mix(mix(a[2], b[2], smooth(0, 1, t)) + detail, h, smooth(width * .5, width * 4, d)));
  }
  return best;
}

// A glacial trough: a flat floor between walls that steepen into the mountains
// (a U, not the corridors' V). Like a corridor it only ever lowers the ground.
function troughCut(x, z, h, detail) {
  let best = h;
  const points = T.points;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.sqrt((x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2), w = mix(a[3], b[3], t);
    if (d >= w * 2.2) continue;
    const u = Math.max(d / w - .5, 0);
    best = Math.min(best, mix(mix(a[2], b[2], smooth(0, 1, t)) + detail + Math.min(u * u, 1.6) * T.rise, h, smooth(w * 1.2, w * 2.2, d)));
  }
  return best;
}

// The outer regions beyond the Divide. Every weight here is zero inside CORE,
// so the original world never pays for them (and the GLSL twin skips them there too).
function outerHeight(x, z, h) {
  // South of the sea the central valley's line closes into the mountains again.
  if (z > 56000) h += smooth(56000, 62000, z) * (1 - smooth(1000, 5500, Math.abs(x - valleyCurve(z)))) * 900;
  // Calmeterre: floodplain, terraces and farm hills either side of the Calme.
  if (x > 27000) {
    const weight = smooth(-2500, 3000, x - lowlandEdge(z) + (noise(x * .0005 + 61, z * .0005 + 17) - .5) * 3000)
      * smooth(L.north - 3000, L.north + 3000, z + (noise(x * .0005 + 7, z * .0005 + 83) - .5) * 4000)
      // and gives way to the far range near the world's edge.
      * (1 - smooth(60500, 67000, Math.max(x, z) + (noise(x * .0006 + 11, z * .0006 + 61) - .5) * 3000));
    if (weight > 0) {
      const d = Math.abs(x - calmeCurve(z) + (noise(x * .0008 + 9, z * .0008 + 27) - .5) * 300);
      let plain = mix(L.top, L.foot, smooth(L.north, 48000, z)) + (fbm(x * .0011 + 71, z * .0011 + 3) - .5) * 16;
      for (let i = 0; i < L.terraces.length; i++) plain += L.terraces[i][1] * smooth(L.terraces[i][0] - 300, L.terraces[i][0] + 300, d);
      plain += smooth(9000, 16000, d) * (fbm(x * .0007 + 13, z * .0007 + 5) - .25) * 420;
      // The channel fades out where the river has run into the sea.
      plain = mix(plain, -4, (1 - smooth(L.river.width * .6, L.river.width * 2.2, d)) * (1 - smooth(L.river.mouth, L.river.mouth + 4000, z)));
      for (let i = 0; i < OXBOWS.length; i++) {
        const o = OXBOWS[i], ox = x - o[0], oz = z - o[1], r = Math.sqrt(ox * ox + oz * oz) + 1e-3;
        plain = mix(plain, -2, (1 - smooth(60, 150, Math.abs(r - o[2]))) * smooth(.45, .15, (ox * o[3] + oz * o[4]) / r));
      }
      h = mix(h, plain, weight);
    }
  }
  // Cendre: lava tableland, cinder cones and the caldera with its crater lake.
  if (x < -36500) {
    const zw = z + (noise(x * .0005 + 89, z * .0005 + 5) - .5) * 5000;
    const weight = (1 - smooth(H.edge - 4000, H.edge + 2000, x + (noise(x * .0005 + 3, z * .0005 + 47) - .5) * 3000)) * smooth(-46000, -40000, zw) * (1 - smooth(36000, 42000, zw))
      * smooth(-67500, -62000, x + (noise(x * .0006 + 11, z * .0006 + 61) - .5) * 3000);
    if (weight > 0) {
      let top = H.elevation + (fbm(x * .00035 + 31, z * .00035 + 19) - .5) * 300 + (fbm(x * .0012 + 5, z * .0012 + 2) - .5) * 70;
      const F = H.farmland, farm = 1 - smooth(.55, 1, Math.sqrt(((x - F.x) / F.rx) ** 2 + ((z - F.z) / F.rz) ** 2));
      top = mix(top, F.elevation + (fbm(x * .0007 + 17, z * .0007 + 13) - .5) * 26, farm);
      const coneNoise = .92 + noise(x * .003 + 7, z * .003 + 7) * .16;
      for (let i = 0; i < H.cones.length; i++) {
        const c = H.cones[i], d = Math.sqrt((x - c[0]) ** 2 + (z - c[1]) ** 2) * coneNoise;
        top += c[3] * smooth(c[2], c[2] * .2, d) - c[4] * smooth(c[2] * .24, c[2] * .05, d);
      }
      const C = H.caldera, dc = Math.sqrt((x - C.x) ** 2 + (z - C.z) ** 2) * (.95 + noise(x * .0012 + 19, z * .0012 + 23) * .1);
      // Lava tongues: flat-topped lobes with steep fronts, running out from the flanks.
      for (let i = 0; i < FLOWS.length; i++) {
        const f = FLOWS[i], ox = x - C.x, oz = z - C.z, along = ox * f[0] + oz * f[1], across = Math.abs(ox * f[1] - oz * f[0]) * coneNoise;
        top += f[4] * smooth(f[3], f[3] * .6, across) * smooth(C.r * .9, C.r * 1.3, along) * smooth(C.r + f[2], C.r + f[2] - 700, along);
      }
      if (dc < C.r) {
        const k = C.island;
        top = mix(C.bed, C.rim, smooth(C.r * .72, C.r, dc)) + k[3] * smooth(k[2], k[2] * .15, Math.sqrt((x - k[0]) ** 2 + (z - k[1]) ** 2));
      } else top = mix(top, C.rim, smooth(C.r * 2.7, C.r, dc));
      h = mix(h, top, weight);
    }
  }
  // Mer d'Aurin: a coastal plain along the north shore, the sea bed and its islands.
  if (z > S.north - 700) {
    const north = smooth(S.north, S.northFull, z + (noise(x * .0007 + 97, z * .0007 + 11) - .5) * 1400), e = seaDistance(x, z) + (noise(x * .0004 + 13, z * .0004 + 29) - .5) * .16;
    const coastWeight = (1 - smooth(1.35, 1.8, e)) * (1 - smooth(.72, .97, Math.abs(x - S.x) / S.rx + (noise(x * .0006 + 31, z * .0006 + 3) - .5) * .2)) * north;
    if (coastWeight > 0) h = mix(h, Math.min(12 + Math.max(e - 1, 0) * 160 + (fbm(x * .0009 + 37, z * .0009 + 41) - .5) * 16, h), coastWeight);
    if (e < 1.25) {
      const bed = S.floor + smooth(.35, 1.06, e) * (16 - S.floor) + (fbm(x * .0011 + 43, z * .0011 + 47) - .5) * 24 * smooth(.8, 1.1, e);
      // The islands rise from the bed, whatever the ground was before the sea.
      const islandNoise = .88 + noise(x * .005 + 3, z * .005 + 1) * .24;
      let islands = 0;
      for (let i = 0; i < S.islands.length; i++) { const k = S.islands[i]; islands += k[3] * smooth(k[2], k[2] * .15, Math.sqrt((x - k[0]) ** 2 + (z - k[1]) ** 2) * islandNoise); }
      h = mix(h, Math.min(bed, h) + islands, (1 - smooth(1.04, 1.25, e)) * north);
    }
  }
  // Vauclair: the glacial trough and the cirques in its walls.
  if (x > TROUGH_BOX[0] && x < TROUGH_BOX[2] && z > TROUGH_BOX[1] && z < TROUGH_BOX[3]) {
    const tx = x + (noise(x * .0004 + 53, z * .0004 + 59) - .5) * 1400, tz = z + (noise(x * .0004 + 67, z * .0004 + 71) - .5) * 1400;
    // Moraine hummocks and outwash on the floor.
    h = troughCut(tx, tz, h, (fbm(x * .0016 + 3, z * .0016 + 9) - .5) * 36);
    for (let i = 0; i < T.cirques.length; i++) {
      const c = T.cirques[i], d = Math.sqrt((tx - c[0]) ** 2 + (tz - c[1]) ** 2);
      if (d < c[2] * 1.6) h = Math.min(h, mix(c[3] + (d / c[2]) ** 2 * 700, h, smooth(c[2] * .9, c[2] * 1.6, d)));
    }
  }
  return h;
}

export function groundHeight(x, z) {
  // The original central valley, unchanged within 6 km of its lake.
  const curve = valleyCurve(z);
  const dist = Math.abs(x - curve + (noise(x * .00055, z * .00055) - .5) * 230);
  const foot = smooth(1000, 4900, dist);
  const ridges = ridge(x * .00049 + 14, z * .00049 + 8) * .58 + ridge(x * .00118 + 4, z * .00118 + 11) * .28 + ridge(x * .0027, z * .0027) * .14;
  let h = -48 + Math.pow(capDistance(dist) * .008, 2) * .13 + foot * (720 + ridges * 1850);
  h += foot * (noise(x * .0073, z * .0073) - .5) * 165;
  h += foot * (noise(x * .017, z * .017) - .5) * 43;
  h += smooth(-6500, -14500, z) * (700 + ridges * 1800) * (1 - foot * .45);
  h += (fbm(x * .0015, z * .0015) - .45) * (28 + foot * 90);
  // Val Verdance: a broad meadow floor between the western ranges.
  // (The cheap tests ahead of each region skip work whose weight would be zero;
  // the GLSL twin computes it anyway and gets the same height.)
  const westCurve = z > W.head ? westValleyCurve(z) : Infinity;
  const westOffset = Math.abs(x - westCurve) < W.wall + 360 ? Math.abs(x - westCurve + (noise(x * .0006 + 7, z * .0006 + 3) - .5) * 700) : Infinity;
  const westWeight = westOffset < W.wall ? (1 - smooth(W.floor, W.wall, westOffset)) * smooth(W.head, W.headTop, z) : 0;
  if (westWeight > 0) {
    let floor = mix(W.high, W.low, smooth(W.headTop, -4000, z));
    floor = mix(floor, W.shore, smooth(W.bendFrom + 4000, W.bendTo, z));
    floor += (westOffset / W.floor) ** 2 * 22 + (fbm(x * .0012 + 5, z * .0012 + 9) - .5) * 46;
    h = mix(h, floor, westWeight);
  }
  // Orvane Plateau: rolling tableland and its flat-topped buttes.
  const plateauCore = Math.sqrt(((x - P.x) / P.rx) ** 2 + ((z - P.z) / P.rz) ** 2);
  const plateauWeight = plateauCore < 1.13 ? 1 - smooth(.8, 1.02, plateauCore + (noise(x * .00035 + 2, z * .00035 + 5) - .5) * .2) : 0;
  if (plateauWeight > 0) {
    let top = P.elevation + (fbm(x * .0004 + 3, z * .0004 + 1) - .5) * 240 + (noise(x * .0021, z * .0021) - .5) * 28;
    const butteNoise = .9 + noise(x * .004, z * .004) * .2;
    for (let i = 0; i < P.buttes.length; i++) { const b = P.buttes[i]; top += b[3] * smooth(b[2], b[2] * .78, Math.sqrt((x - b[0]) ** 2 + (z - b[1]) ** 2) * butteNoise); }
    h = mix(h, top, plateauWeight);
  }
  // Passes and gorges between the regions.
  let cx = NaN, cz = NaN, corridorDetail = 0;
  for (let r = 0; r < CARVED.length; r++) {
    const route = CARVED[r], box = route.box;
    if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) continue;
    if (cx !== cx) {
      cx = x + (noise(x * .0011 + 41, z * .0011 + 13) - .5) * 520; cz = z + (noise(x * .0011 + 23, z * .0011 + 37) - .5) * 520;
      corridorDetail = (fbm(x * .0019 + 29, z * .0019 + 7) - .5) * 60;
    }
    h = corridorCut(cx, cz, h, route, corridorDetail);
  }
  // The Divide (the original world's rim) and the new rim at the world's edge.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smooth(D.from, D.to, edge) * D.height * (1 - smooth(D.fadeFrom, D.fadeTo, edge));
  h += smooth(R.from, WORLD.maxX, edge) * R.height;
  // Serein Basin: a broad lake bed, soft foothills and three islands.
  const basinNorth = smooth(B.north, B.northFull, z), basinCore = basinNorth > 0 ? basinDistance(x, z) : Infinity;
  if (basinCore < 2.36) {
    const e = basinCore + (noise(x * .00042 + 3, z * .00042 + 9) - .5) * .22;
    h = mix(h, 60 + Math.max(h - 60, 0) * .42 + Math.min(h - 60, 0), (1 - smooth(1.35, 2.25, e)) * basinNorth);
    if (e < 1.7) {
      let bed = B.floor + smooth(.5, 1.03, e) * 104 + (fbm(x * .0011 + 8, z * .0011 + 2) - .5) * 30 * smooth(.85, 1.15, e);
      const islandNoise = .88 + noise(x * .006, z * .006) * .24;
      for (let i = 0; i < B.islands.length; i++) { const k = B.islands[i]; bed += k[3] * smooth(k[2], k[2] * .15, Math.sqrt((x - k[0]) ** 2 + (z - k[1]) ** 2) * islandNoise); }
      h = mix(h, Math.min(bed, h), (1 - smooth(1.03, 1.7, e)) * basinNorth);
    }
  }
  // The outer regions, and the routes that run on into them through the Divide.
  if (edge > CORE.maxX) h = outerHeight(x, z, h);
  for (let r = 0; r < OUTER_CARVED.length; r++) {
    const route = OUTER_CARVED[r], box = route.box;
    if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) continue;
    if (cx !== cx) {
      cx = x + (noise(x * .0011 + 41, z * .0011 + 13) - .5) * 520; cz = z + (noise(x * .0011 + 23, z * .0011 + 37) - .5) * 520;
      corridorDetail = (fbm(x * .0019 + 29, z * .0019 + 7) - .5) * 60;
    }
    h = corridorCut(cx, cz, h, route, corridorDetail);
  }
  // A lake-side apron, wide enough to make an actual flyable runway.
  const airportDistance = Math.sqrt(((x - airportX) / 410) ** 2 + ((z - airportZ) / 840) ** 2);
  h = mix(h, airportY, 1 - smooth(.79, 1.65, airportDistance));
  // The network's other fields: flat over a rectangle in runway-local
  // coordinates (airports.js gradingBox), easing back to the natural ground.
  for (let i = 0; i < GRADED_AIRPORTS.length; i++) {
    const g = GRADED_AIRPORTS[i], dx = x - g.airport.x, dz = z - g.airport.z;
    if (dx * dx + dz * dz > g.reach * g.reach) continue;
    const ea = Math.max(Math.abs(dx * g.sin - dz * g.cos - g.along) - g.halfAlong, 0) / g.blendAlong;
    const ec = Math.max(Math.abs(dx * g.cos + dz * g.sin - g.cross) - g.halfCross, 0) / g.blendCross;
    h = mix(h, g.airport.elevation, 1 - smooth(0, 1, Math.sqrt(ea * ea + ec * ec)));
  }
  return h;
}

// ---- GLSL twin -------------------------------------------------------------
const f = n => { const s = String(n); return /[.e]/.test(s) ? s : `${s}.`; };
const v = n => `(${f(n)})`;

function glslCorridor(route, i, name = 'groundCorridor') {
  const segments = route.points.slice(0, -1).map(([ax, az, ay], k) => {
    const [bx, bz, by] = route.points[k + 1];
    return `  best = min(best, groundSegment(x, z, h, detail, ${v(ax)}, ${v(az)}, ${v(ay)}, ${v(bx)}, ${v(bz)}, ${v(by)}, ${v(route.width)}));`;
  }).join('\n');
  return `float ${name}${i}(float x, float z, float h, float detail) {\n  float best = h;\n${segments}\n  return best;\n}`;
}

// outerHeight, line for line.
const glslOuter = /* glsl */`
float groundTroughSegment(float x, float z, float h, float detail, float ax, float az, float ay, float aw, float bx, float bz, float by, float bw) {
  float dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0., 1.);
  float d = length(vec2(x - ax - dx * t, z - az - dz * t)), w = mix(aw, bw, t), u = max(d / w - .5, 0.);
  return mix(mix(ay, by, groundSmooth(0., 1., t)) + detail + min(u * u, 1.6) * ${v(T.rise)}, h, groundSmooth(w * 1.2, w * 2.2, d));
}
float groundOuter(float x, float z, float h) {
  if (z > 56000.) h += groundSmooth(56000., 62000., z) * (1. - groundSmooth(1000., 5500., abs(x - (sin(z * .00028) * 480. + sin(z * .00074) * 170.)))) * 900.;
  if (x > 27000.) {
    float lowEdge = ${v(L.edge)} - groundSmooth(36000., 46000., z) * 9000.;
    float weight = groundSmooth(-2500., 3000., x - lowEdge + (groundNoise(x * .0005 + 61., z * .0005 + 17.) - .5) * 3000.)
      * groundSmooth(${v(L.north - 3000)}, ${v(L.north + 3000)}, z + (groundNoise(x * .0005 + 7., z * .0005 + 83.) - .5) * 4000.)
      * (1. - groundSmooth(60500., 67000., max(x, z) + (groundNoise(x * .0006 + 11., z * .0006 + 61.) - .5) * 3000.));
    if (weight > 0.) {
      float river = ${v(L.river.x)} + sin(z * .00012 + .4) * 3800. + sin(z * .00041 + 1.3) * 1100. + sin(z * .0011) * 260. + groundSmooth(${v(L.river.bendFrom)}, ${v(L.river.bendTo)}, z) * ${v(L.river.bend)};
      float d = abs(x - river + (groundNoise(x * .0008 + 9., z * .0008 + 27.) - .5) * 300.);
      float plain = mix(${v(L.top)}, ${v(L.foot)}, groundSmooth(${v(L.north)}, 48000., z)) + (groundFbm(x * .0011 + 71., z * .0011 + 3.) - .5) * 16.;
${L.terraces.map(([at, rise]) => `      plain += ${v(rise)} * groundSmooth(${v(at - 300)}, ${v(at + 300)}, d);`).join('\n')}
      plain += groundSmooth(9000., 16000., d) * (groundFbm(x * .0007 + 13., z * .0007 + 5.) - .25) * 420.;
      plain = mix(plain, -4., (1. - groundSmooth(${v(L.river.width * .6)}, ${v(L.river.width * 2.2)}, d)) * (1. - groundSmooth(${v(L.river.mouth)}, ${v(L.river.mouth + 4000)}, z)));
${OXBOWS.map(([ox, oz, r, ux, uz]) => `      {
        float ox = x - ${v(ox)}, oz = z - ${v(oz)}, r = length(vec2(ox, oz)) + 1e-3;
        plain = mix(plain, -2., (1. - groundSmooth(60., 150., abs(r - ${v(r)}))) * groundSmooth(.45, .15, (ox * ${v(ux)} + oz * ${v(uz)}) / r));
      }`).join('\n')}
      h = mix(h, plain, weight);
    }
  }
  if (x < -36500.) {
    float zw = z + (groundNoise(x * .0005 + 89., z * .0005 + 5.) - .5) * 5000.;
    float weight = (1. - groundSmooth(${v(H.edge - 4000)}, ${v(H.edge + 2000)}, x + (groundNoise(x * .0005 + 3., z * .0005 + 47.) - .5) * 3000.)) * groundSmooth(-46000., -40000., zw) * (1. - groundSmooth(36000., 42000., zw))
      * groundSmooth(-67500., -62000., x + (groundNoise(x * .0006 + 11., z * .0006 + 61.) - .5) * 3000.);
    if (weight > 0.) {
      float top = ${v(H.elevation)} + (groundFbm(x * .00035 + 31., z * .00035 + 19.) - .5) * 300. + (groundFbm(x * .0012 + 5., z * .0012 + 2.) - .5) * 70.;
      float farm = 1. - groundSmooth(.55, 1., length(vec2((x - ${v(H.farmland.x)}) / ${v(H.farmland.rx)}, (z - ${v(H.farmland.z)}) / ${v(H.farmland.rz)})));
      top = mix(top, ${v(H.farmland.elevation)} + (groundFbm(x * .0007 + 17., z * .0007 + 13.) - .5) * 26., farm);
      float coneNoise = .92 + groundNoise(x * .003 + 7., z * .003 + 7.) * .16;
${H.cones.map(([cx, cz, r, rise, crater]) => `      {
        float d = length(vec2(x - ${v(cx)}, z - ${v(cz)})) * coneNoise;
        top += ${v(rise)} * groundSmooth(${v(r)}, ${v(r * .2)}, d) - ${v(crater)} * groundSmooth(${v(r * .24)}, ${v(r * .05)}, d);
      }`).join('\n')}
      float dc = length(vec2(x - ${v(H.caldera.x)}, z - ${v(H.caldera.z)})) * (.95 + groundNoise(x * .0012 + 19., z * .0012 + 23.) * .1);
${FLOWS.map(([ux, uz, length, width, thick]) => `      {
        float ox = x - ${v(H.caldera.x)}, oz = z - ${v(H.caldera.z)}, along = ox * ${v(ux)} + oz * ${v(uz)}, across = abs(ox * ${v(uz)} - oz * ${v(ux)}) * coneNoise;
        top += ${v(thick)} * groundSmooth(${v(width)}, ${v(width * .6)}, across) * groundSmooth(${v(H.caldera.r * .9)}, ${v(H.caldera.r * 1.3)}, along) * groundSmooth(${v(H.caldera.r + length)}, ${v(H.caldera.r + length - 700)}, along);
      }`).join('\n')}
      if (dc < ${v(H.caldera.r)}) {
        top = mix(${v(H.caldera.bed)}, ${v(H.caldera.rim)}, groundSmooth(${v(H.caldera.r * .72)}, ${v(H.caldera.r)}, dc)) + ${v(H.caldera.island[3])} * groundSmooth(${v(H.caldera.island[2])}, ${v(H.caldera.island[2] * .15)}, length(vec2(x - ${v(H.caldera.island[0])}, z - ${v(H.caldera.island[1])})));
      } else top = mix(top, ${v(H.caldera.rim)}, groundSmooth(${v(H.caldera.r * 2.7)}, ${v(H.caldera.r)}, dc));
      h = mix(h, top, weight);
    }
  }
  if (z > ${v(S.north - 700)}) {
    float north = groundSmooth(${v(S.north)}, ${v(S.northFull)}, z + (groundNoise(x * .0007 + 97., z * .0007 + 11.) - .5) * 1400.);
    float e = length(vec2((x - ${v(S.x)}) / ${v(S.rx)}, (z - ${v(S.z)}) / ${v(S.rz)})) + (groundNoise(x * .0004 + 13., z * .0004 + 29.) - .5) * .16;
    float coastWeight = (1. - groundSmooth(1.35, 1.8, e)) * (1. - groundSmooth(.72, .97, abs(x - ${v(S.x)}) / ${v(S.rx)} + (groundNoise(x * .0006 + 31., z * .0006 + 3.) - .5) * .2)) * north;
    if (coastWeight > 0.) h = mix(h, min(12. + max(e - 1., 0.) * 160. + (groundFbm(x * .0009 + 37., z * .0009 + 41.) - .5) * 16., h), coastWeight);
    if (e < 1.25) {
      float bed = ${v(S.floor)} + groundSmooth(.35, 1.06, e) * ${v(16 - S.floor)} + (groundFbm(x * .0011 + 43., z * .0011 + 47.) - .5) * 24. * groundSmooth(.8, 1.1, e);
      float islandNoise = .88 + groundNoise(x * .005 + 3., z * .005 + 1.) * .24, islands = 0.;
${S.islands.map(([ix, iz, r, rise]) => `      islands += ${v(rise)} * groundSmooth(${v(r)}, ${v(r * .15)}, length(vec2(x - ${v(ix)}, z - ${v(iz)})) * islandNoise);`).join('\n')}
      h = mix(h, min(bed, h) + islands, (1. - groundSmooth(1.04, 1.25, e)) * north);
    }
  }
  if (x > ${v(TROUGH_BOX[0])} && x < ${v(TROUGH_BOX[2])} && z > ${v(TROUGH_BOX[1])} && z < ${v(TROUGH_BOX[3])}) {
    float tx = x + (groundNoise(x * .0004 + 53., z * .0004 + 59.) - .5) * 1400., tz = z + (groundNoise(x * .0004 + 67., z * .0004 + 71.) - .5) * 1400.;
    float best = h, detail = (groundFbm(x * .0016 + 3., z * .0016 + 9.) - .5) * 36.;
${T.points.slice(0, -1).map(([ax, az, ay, aw], k) => { const [bx, bz, by, bw] = T.points[k + 1]; return `    best = min(best, groundTroughSegment(tx, tz, h, detail, ${v(ax)}, ${v(az)}, ${v(ay)}, ${v(aw)}, ${v(bx)}, ${v(bz)}, ${v(by)}, ${v(bw)}));`; }).join('\n')}
    h = best;
${T.cirques.map(([cx, cz, r, floor]) => `    {
      float d = length(vec2(tx - ${v(cx)}, tz - ${v(cz)}));
      if (d < ${v(r * 1.6)}) h = min(h, mix(${v(floor)} + (d / ${v(r)}) * (d / ${v(r)}) * 700., h, groundSmooth(${v(r * .9)}, ${v(r * 1.6)}, d)));
    }`).join('\n')}
  }
  return h;
}
`;

// groundHeight, bit for bit, so the lake knows its own depth along every shore.
export const groundShader = /* glsl */`
float groundHash(float x, float z) { uint h = uint(int(x)) * 374761393u + uint(int(z)) * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u; return float(h) / 4294967295.; }
float groundNoise(float x, float z) { float ix = floor(x), iz = floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3. - 2. * fx), sz = fz * fz * (3. - 2. * fz); return mix(mix(groundHash(ix, iz), groundHash(ix + 1., iz), sx), mix(groundHash(ix, iz + 1.), groundHash(ix + 1., iz + 1.), sx), sz); }
float groundRidge(float x, float z) { return 1. - abs(groundNoise(x, z) * 2. - 1.); }
float groundFbm(float x, float z) { return groundNoise(x, z) * .55 + groundNoise(x * 2.03 + 17., z * 2.03 + 31.) * .27 + groundNoise(x * 4.13 + 51., z * 4.13 + 11.) * .12 + groundNoise(x * 8.17, z * 8.17) * .06; }
float groundSmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
float groundCap(float d) { return d < 6000. ? d : 6000. + 3000. * (1. - exp((6000. - d) / 3000.)); }
float groundSegment(float x, float z, float h, float detail, float ax, float az, float ay, float bx, float bz, float by, float width) {
  float dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0., 1.);
  float d = length(vec2(x - ax - dx * t, z - az - dz * t));
  return mix(mix(ay, by, groundSmooth(0., 1., t)) + detail, h, groundSmooth(width * .5, width * 4., d));
}
${CARVED.map((route, i) => glslCorridor(route, i)).join('\n')}
${OUTER_CARVED.map((route, i) => glslCorridor(route, i, 'groundOuterCorridor')).join('\n')}
${glslOuter}
float groundHeight(float x, float z) {
  float curve = sin(z * .00028) * 480. + sin(z * .00074) * 170.;
  float dist = abs(x - curve + (groundNoise(x * .00055, z * .00055) - .5) * 230.);
  float foot = groundSmooth(1000., 4900., dist);
  float ridges = groundRidge(x * .00049 + 14., z * .00049 + 8.) * .58 + groundRidge(x * .00118 + 4., z * .00118 + 11.) * .28 + groundRidge(x * .0027, z * .0027) * .14;
  float capped = groundCap(dist) * .008;
  float h = -48. + capped * capped * .13 + foot * (720. + ridges * 1850.);
  h += foot * (groundNoise(x * .0073, z * .0073) - .5) * 165.;
  h += foot * (groundNoise(x * .017, z * .017) - .5) * 43.;
  h += groundSmooth(-6500., -14500., z) * (700. + ridges * 1800.) * (1. - foot * .45);
  h += (groundFbm(x * .0015, z * .0015) - .45) * (28. + foot * 90.);
  float westCurve = ${v(W.x)} + sin(z * ${v(W.f1)} + ${v(W.p1)}) * ${v(W.a1)} + sin(z * ${v(W.f2)}) * ${v(W.a2)} + groundSmooth(${v(W.bendFrom)}, ${v(W.bendTo)}, z) * ${v(W.bend)};
  float westOffset = abs(x - westCurve + (groundNoise(x * .0006 + 7., z * .0006 + 3.) - .5) * 700.);
  float westWeight = (1. - groundSmooth(${v(W.floor)}, ${v(W.wall)}, westOffset)) * groundSmooth(${v(W.head)}, ${v(W.headTop)}, z);
  if (westWeight > 0.) {
    float floorY = mix(${v(W.high)}, ${v(W.low)}, groundSmooth(${v(W.headTop)}, -4000., z));
    floorY = mix(floorY, ${v(W.shore)}, groundSmooth(${v(W.bendFrom + 4000)}, ${v(W.bendTo)}, z));
    float across = westOffset / ${v(W.floor)};
    floorY += across * across * 22. + (groundFbm(x * .0012 + 5., z * .0012 + 9.) - .5) * 46.;
    h = mix(h, floorY, westWeight);
  }
  float plateauEdge = length(vec2((x - ${v(P.x)}) / ${v(P.rx)}, (z - ${v(P.z)}) / ${v(P.rz)})) + (groundNoise(x * .00035 + 2., z * .00035 + 5.) - .5) * .2;
  float plateauWeight = 1. - groundSmooth(.8, 1.02, plateauEdge);
  if (plateauWeight > 0.) {
    float top = ${v(P.elevation)} + (groundFbm(x * .0004 + 3., z * .0004 + 1.) - .5) * 240. + (groundNoise(x * .0021, z * .0021) - .5) * 28.;
    float butteNoise = .9 + groundNoise(x * .004, z * .004) * .2;
${P.buttes.map(([bx, bz, r, rise]) => `    top += ${v(rise)} * groundSmooth(${v(r)}, ${v(r * .78)}, length(vec2(x - ${v(bx)}, z - ${v(bz)})) * butteNoise);`).join('\n')}
    h = mix(h, top, plateauWeight);
  }
  float cx = x + (groundNoise(x * .0011 + 41., z * .0011 + 13.) - .5) * 520., cz = z + (groundNoise(x * .0011 + 23., z * .0011 + 37.) - .5) * 520.;
  float corridorDetail = (groundFbm(x * .0019 + 29., z * .0019 + 7.) - .5) * 60.;
${CARVED.map((_, i) => `  h = groundCorridor${i}(cx, cz, h, corridorDetail);`).join('\n')}
  float edge = max(abs(x), abs(z));
  h += groundSmooth(${v(D.from)}, ${v(D.to)}, edge) * ${v(D.height)} * (1. - groundSmooth(${v(D.fadeFrom)}, ${v(D.fadeTo)}, edge));
  h += groundSmooth(${v(R.from)}, ${v(WORLD.maxX)}, edge) * ${v(R.height)};
  float basinNorth = groundSmooth(${v(B.north)}, ${v(B.northFull)}, z);
  if (basinNorth > 0.) {
    float e = length(vec2((x - ${v(B.x)}) / ${v(B.rx)}, (z - ${v(B.z)}) / ${v(B.rz)})) + (groundNoise(x * .00042 + 3., z * .00042 + 9.) - .5) * .22;
    h = mix(h, 60. + max(h - 60., 0.) * .42 + min(h - 60., 0.), (1. - groundSmooth(1.35, 2.25, e)) * basinNorth);
    float bed = ${v(B.floor)} + groundSmooth(.5, 1.03, e) * 104. + (groundFbm(x * .0011 + 8., z * .0011 + 2.) - .5) * 30. * groundSmooth(.85, 1.15, e);
    float islandNoise = .88 + groundNoise(x * .006, z * .006) * .24;
${B.islands.map(([ix, iz, r, rise]) => `    bed += ${v(rise)} * groundSmooth(${v(r)}, ${v(r * .15)}, length(vec2(x - ${v(ix)}, z - ${v(iz)})) * islandNoise);`).join('\n')}
    h = mix(h, min(bed, h), (1. - groundSmooth(1.03, 1.7, e)) * basinNorth);
  }
  if (edge > ${v(CORE.maxX)}) h = groundOuter(x, z, h);
${OUTER_CARVED.map((_, i) => `  h = groundOuterCorridor${i}(cx, cz, h, corridorDetail);`).join('\n')}
  float airport = length(vec2((x - ${v(airportX)}) / 410., (z - ${v(airportZ)}) / 840.));
  h = mix(h, ${v(airportY)}, 1. - groundSmooth(.79, 1.65, airport));
${GRADED_AIRPORTS.map(g => `  {
    float dx = x - ${v(g.airport.x)}, dz = z - ${v(g.airport.z)};
    float ea = max(abs(dx * ${v(g.sin)} - dz * ${v(g.cos)} - ${v(g.along)}) - ${v(g.halfAlong)}, 0.) / ${v(g.blendAlong)};
    float ec = max(abs(dx * ${v(g.cos)} + dz * ${v(g.sin)} - ${v(g.cross)}) - ${v(g.halfCross)}, 0.) / ${v(g.blendCross)};
    h = mix(h, ${v(g.airport.elevation)}, 1. - groundSmooth(0., 1., sqrt(ea * ea + ec * ec)));
  }`).join('\n')}
  return h;
}
`;

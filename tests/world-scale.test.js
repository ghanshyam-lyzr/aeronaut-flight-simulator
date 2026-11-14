import test from 'node:test';
import assert from 'node:assert/strict';
import { groundHeight, groundShader, hash, calmeCurve, seaDistance } from '../src/terrain.js';
import { tileGeometry, deepSea, outerCell, outerTrees, OUTER_CELL, SEGMENTS, COARSE_STEP, FULL_RANGE, FULL_LAG } from '../src/world.js';
import { WORLD, CORE, SHAPES, REGIONS, ROUTES, LANDMARKS, VILLAGES, AIRPORT_SITES, WATER_LEVEL, regionAt, region, inWorld, clampToWorld } from '../src/regions.js';
import { AIRPORTS, footprint, gradingBox, inProtectedArea, localCoordinates } from '../src/airports.js';
import { runwayPoint } from '../src/airfield.js';
import { frameView, clampCentre, tilesFor, tileLevel, tileMetres, rasterTile, terrainColour, mapPlaces, createView, ZOOM_SPANS, TILE_PIXELS, MAX_TILE_LEVEL } from '../src/navigation.js';

const OUTER = ['northern-glaciers', 'eastern-lowlands', 'southern-coast', 'western-highlands'];
const heightAt = (x, z) => Math.max(WATER_LEVEL, groundHeight(x, z));
const grid = (x0, x1, z0, z1, step, fn) => { for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) fn(x, z); };
const outerBoxes = ROUTES.filter(r => r.outer).map(r => {
  const reach = r.width * 4 + 400, xs = r.points.map(p => p[0]), zs = r.points.map(p => p[1]);
  return [Math.min(...xs) - reach, Math.min(...zs) - reach, Math.max(...xs) + reach, Math.max(...zs) + reach];
});
// Runway-local point of a site (along from the primary threshold, cross to the right).
const sitePoint = (s, along, cross = 0) => runwayPoint(along, cross, s);

function glslAsJs() {
  const body = groundShader
    .replace(/^float groundHash[^\n]*\n/m, '')
    .replace(/\bfloat (\w+)\(([^)]*)\)\s*\{/g, (_, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')}) {`)
    .replace(/\bfloat /g, 'let ');
  const prelude = `const {abs,min,max,sin,exp,floor,sqrt}=Math; const clamp=(x,a,b)=>min(b,max(a,x)), mix=(a,b,t)=>a+(b-a)*t, vec2=(a,b)=>[a,b], length=v=>sqrt(v[0]*v[0]+v[1]*v[1]);`;
  return new Function('groundHash', `${prelude}\n${body}\nreturn groundHeight;`)(hash);
}

test('the world is 140.8 km square, four times the original, with the original at its centre', () => {
  assert.deepEqual([WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, WORLD.size], [-70400, 70400, -70400, 70400, 140800]);
  assert.equal(WORLD.size ** 2, CORE.size ** 2 * 4);
  assert.equal(WORLD.tiles * WORLD.tileSize, WORLD.size);
  assert.deepEqual([CORE.minX, CORE.maxX, CORE.minZ, CORE.maxZ], [-35200, 35200, -35200, 35200]);
  // The original tiles still sit on the world's vertex grid.
  assert.ok(Number.isInteger((CORE.minX - WORLD.minX) / WORLD.tileSize));
  assert.ok(inWorld(WORLD.maxX - 1, WORLD.minZ + 1) && inWorld(-60000, 60000) && !inWorld(70401, 0));
  assert.deepEqual(clampToWorld(-1e6, 1e6, 500), { x: WORLD.minX + 500, z: WORLD.maxZ - 500 });
  // The rendered height function stays finite and bounded to the new edge.
  let low = Infinity, high = -Infinity;
  grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 700, (x, z) => { const h = groundHeight(x, z); low = Math.min(low, h); high = Math.max(high, h); });
  assert.ok(Number.isFinite(low) && low > -100 && high < 7000, `${low}..${high}`);
});

test('the original 70.4 km world is unchanged, bit for bit, outside the new passes', () => {
  // Recorded from the height function before the expansion over the same 200 m grid.
  let sum = 0, sq = 0, n = 0;
  grid(CORE.minX, CORE.maxX, CORE.minZ, CORE.maxZ, 200, (x, z) => {
    if (outerBoxes.some(([a, b, c, d]) => x >= a && x <= c && z >= b && z <= d)) return;
    const h = groundHeight(x, z); sum += h; sq += h * h * 1e-3; n++;
  });
  assert.equal(n, 117954);
  assert.equal(sum, 250638851.79134178);
  assert.equal(sq, 732288478.6898963);
  // The original five fields keep their positions, elevations and graded runways (the outer fields are graded outside CORE).
  for (const a of AIRPORTS) for (let along = 0; along <= a.runwayLength; along += 50) for (const cross of [-a.runwayWidth / 2, 0, a.runwayWidth / 2]) {
    const p = runwayPoint(along, cross, a);
    assert.ok(Math.abs(groundHeight(p.x, p.z) - a.elevation) < 1e-6, `${a.name} at ${along}`);
  }
  assert.deepEqual(AIRPORTS.slice(0, 5).map(a => [a.id, a.x, a.z, a.elevation]), [
    ['alpine-field', 900, -1800, 78], ['orvane-regional', 21000, -2000, 1058], ['verdance-meadow', -23900, -3100, 440],
    ['serein-lakeside', 1390, 15540, 42], ['brume-col', -11350, 2350, 1142]]);
});

test('the GLSL twin agrees with groundHeight over the outer regions, sites and routes', () => {
  const shader = glslAsJs();
  let worst = 0;
  const check = (x, z) => { worst = Math.max(worst, Math.abs(shader(x, z) - groundHeight(x, z))); };
  grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 1130, (x, z) => { if (!inWorld(x, z) || Math.max(Math.abs(x), Math.abs(z)) > CORE.maxX) check(x, z); });
  for (const s of AIRPORT_SITES) for (let along = -400; along <= s.runwayLength + 400; along += 100) { const p = sitePoint(s, along); check(p.x, p.z); }
  for (const r of ROUTES.filter(r => r.outer || !region(r.from) || OUTER.includes(r.to))) for (const [x, z] of r.points) check(x, z);
  for (const l of LANDMARKS) check(l.x, l.z);
  assert.ok(worst < 1e-6, `largest difference ${worst} m`);
});

test('at least three outer regions lie beyond the old bounds, each with landmarks, villages and a route in', () => {
  for (const id of OUTER) {
    const r = region(id), [x0, z0, x1, z1] = r.bounds;
    assert.ok(r, id);
    // Mostly outside the original world: its centre is beyond the old edge.
    assert.ok(Math.max(Math.abs((x0 + x1) / 2), Math.abs((z0 + z1) / 2)) > CORE.maxX, `${id} lies beyond the old bounds`);
    assert.ok(LANDMARKS.filter(l => l.region === id).length >= 4, `${id} landmarks`);
    assert.ok(VILLAGES.some(([x, z]) => regionAt(x, z)?.id === id), `${id} villages`);
    assert.ok(ROUTES.some(route => route.to === id || route.from === id), `${id} routes`);
    assert.ok(REGIONS.indexOf(r) < REGIONS.findIndex(q => q.id === 'outer-ranges'));
  }
  // Every outer route that cuts through the Divide starts in the original world.
  for (const route of ROUTES.filter(r => r.outer)) {
    const [x, z] = route.points[0];
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) < CORE.maxX && OUTER.includes(regionAt(...route.points.at(-1).slice(0, 2)).id) || OUTER.includes(route.from), route.id);
  }
  // The edges close in a far range all round.
  for (const [x, z] of [[69000, 0], [-69000, 0], [0, 69000], [0, -69000], [69000, 50000], [-69000, -30000]]) assert.ok(groundHeight(x, z) > 900, `rim at ${x}, ${z}`);
});

test('Vauclair is a U-shaped glacial trough with cirques, a glacier floor and a finger lake', () => {
  // (Away from the Col de Vauclair, which opens the north wall.)
  for (const [x, z, floor, w] of SHAPES.trough.points.filter(p => [-30000, -19000, -9500, 9500, 20000].includes(p[0]))) {
    const h = groundHeight(x, z);
    assert.ok(Math.abs(h - floor) < 90, `floor at ${x}: ${h} vs ${floor}`);
    // A U: a broad floor, then walls far above it on both sides.
    const across = [-1, 1].map(s => groundHeight(x, z + s * w * 1.9));
    assert.ok(across.every(a => a > h + 450), `walls at ${x}: ${across.map(Math.round)} over ${Math.round(h)}`);
    assert.ok([-1, 1].every(s => Math.abs(groundHeight(x, z + s * w * .3) - h) < 60), `flat floor at ${x}`);
  }
  // The upper trough holds the glacier (above the snow line), its mouth the lake.
  assert.ok(groundHeight(-30000, -55000) > 1800);
  assert.ok(groundHeight(40000, -41300) < WATER_LEVEL - 20 && groundHeight(36000, -42600) < WATER_LEVEL - 20);
  for (const [cx, cz, , floor] of SHAPES.trough.cirques) assert.ok(groundHeight(cx, cz) < floor + 150, `cirque at ${cx}`);
});

test('Calmeterre is a lowland plain with a meandering river, oxbow lakes and terraces', () => {
  let wet = 0, samples = 0;
  for (let z = -34000; z <= 50000; z += 500) {
    const x = calmeCurve(z);
    let lowest = Infinity;
    for (let s = -250; s <= 250; s += 25) lowest = Math.min(lowest, groundHeight(x + s, z));
    samples++; if (lowest < WATER_LEVEL) wet++;
  }
  assert.ok(wet / samples > .97, `river wet over ${wet} of ${samples}`);
  for (const [x, z, r, open] of SHAPES.lowlands.oxbows) {
    const wx = x - Math.sin(open) * r, wz = z + Math.cos(open) * r;
    assert.ok(groundHeight(wx, wz) < WATER_LEVEL, `oxbow at ${x}, ${z}`);
  }
  // Floodplain, then each terrace higher than the last, east of the river.
  for (const z of [-20000, -6000, 8000]) {
    const at = d => groundHeight(calmeCurve(z) + d, z);
    assert.ok(at(800) > WATER_LEVEL && at(800) < 260, `floodplain at ${z}`);
    assert.ok(at(3000) > at(800) + 10 && at(6000) > at(3000) + 10, `terraces at ${z}`);
  }
  // The Orvane Escarpment: over a kilometre of relief within 8 km.
  assert.ok(groundHeight(33500, -3500) - groundHeight(43500, -3500) > 700);
});

test('the Mer d\'Aurin is a large sea with islands, a coastal plain and a fjord', () => {
  let water = 0;
  grid(-30000, 36000, 44000, 64000, 250, (x, z) => { if (groundHeight(x, z) < WATER_LEVEL) water++; });
  assert.ok(water * 250 * 250 > 4e8, `${(water * 250 * 250 / 1e6).toFixed(0)} km² of water`);
  for (const [x, z, , rise] of SHAPES.sea.islands) assert.ok(groundHeight(x, z) > WATER_LEVEL + rise * .3, `island at ${x}`);
  // Low coastal plain north of the shore.
  for (const x of [-6000, 6000, 14000, 20000]) { const h = groundHeight(x, 44500); assert.ok(h > WATER_LEVEL && h < 80, `coast at ${x}: ${h}`); }
  // Fjord: water between walls over 600 m high within 2.5 km.
  const fjord = ROUTES.find(r => r.id === 'fjord-de-lisse');
  for (const [x, z, floor] of fjord.points.slice(1, 4)) {
    let lowest = Infinity;
    for (let s = -500; s <= 500; s += 50) lowest = Math.min(lowest, groundHeight(x + s, z + s));
    assert.ok(lowest < WATER_LEVEL, `fjord at ${x}`);
    assert.ok(Math.max(groundHeight(x + 2500, z), groundHeight(x - 2500, z), groundHeight(x, z + 2500), groundHeight(x, z - 2500)) > 600, `fjord walls at ${x}`);
    assert.ok(floor < WATER_LEVEL);
  }
  // The Gorges d'Aurin join Lac Serein to the sea by water.
  for (let z = 31000; z <= 46000; z += 250) {
    let lowest = Infinity;
    for (let x = -800; x <= 2400; x += 40) lowest = Math.min(lowest, groundHeight(x, z));
    assert.ok(lowest < WATER_LEVEL, `Gorges d'Aurin at ${z}`);
  }
  assert.ok(seaDistance(1500, 46500) < 1.15);
});

test('Cendre is a volcanic tableland: caldera lake, cinder cones with craters, lava flows', () => {
  const { caldera: C, cones, elevation } = SHAPES.highlands;
  assert.ok(groundHeight(C.x - 900, C.z - 500) < WATER_LEVEL - 20, 'crater lake');
  assert.ok(groundHeight(...C.island.slice(0, 2)) > WATER_LEVEL + 50, 'island cone');
  for (let a = 0; a < Math.PI * 2; a += .5) assert.ok(groundHeight(C.x + Math.sin(a) * C.r * 1.02, C.z - Math.cos(a) * C.r * 1.02) > 1150, `rim at ${a.toFixed(1)}`);
  for (const [x, z, r, rise] of cones) {
    const rim = groundHeight(x + r * .3, z), centre = groundHeight(x, z), foot = groundHeight(x + r * 1.6, z);
    assert.ok(rim > foot + rise * .5, `cone at ${x}`);
    assert.ok(centre < rim, `crater at ${x}`);
  }
  let plateau = 0;
  grid(-62000, -44000, -30000, 30000, 1000, (x, z) => { const h = groundHeight(x, z); if (h > elevation - 250 && h < elevation + 350) plateau++; });
  assert.ok(plateau > 600, `${plateau} km² of tableland`);
  for (const [bearing, length, , thick] of SHAPES.highlands.flows.slice(0, 2)) {
    const d = C.r + length * .55, x = C.x + Math.sin(bearing) * d, z = C.z - Math.cos(bearing) * d;
    assert.ok(groundHeight(x, z) > groundHeight(x + Math.cos(bearing) * 3000, z + Math.sin(bearing) * 3000) - 40 + thick * .3, `flow at bearing ${bearing}`);
  }
});

test('five surveyed airport sites: viable, dry, flat, clear on both approaches and away from scenery', () => {
  assert.equal(AIRPORT_SITES.length, 5);
  const kinds = AIRPORT_SITES.map(s => s.kind).sort();
  assert.deepEqual(kinds, ['commercial', 'commercial', 'grass', 'lakeside', 'mountain']);
  for (const s of AIRPORT_SITES) {
    assert.equal(regionAt(s.x, s.z).id, s.region, s.id);
    assert.ok(OUTER.includes(s.region) && inWorld(s.x, s.z, 5000), s.id);
    if (s.kind === 'commercial') assert.ok(s.runwayLength >= 3000 && s.runwayWidth >= 45 && s.surface === 'asphalt', s.id);
    if (s.kind === 'grass') assert.equal(s.surface, 'grass');
    // Natural ground across the graded footprint lies within a few metres of the field.
    const f = footprint(s), g = gradingBox(s);
    let lo = Infinity, hi = -Infinity;
    for (let along = f.along[0]; along <= f.along[1]; along += 40) for (let cross = f.cross[0]; cross <= f.cross[1]; cross += 30) {
      const p = sitePoint(s, along, cross), h = groundHeight(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    assert.ok(lo > WATER_LEVEL + 4, `${s.id} dry: ${lo}`);
    assert.ok(Math.abs(lo - s.elevation) < 15 && Math.abs(hi - s.elevation) < 15, `${s.id} ground ${lo.toFixed(1)}..${hi.toFixed(1)} vs ${s.elevation}`);
    assert.ok(g.reach < 3500, `${s.id} grading reach`);
    // Both directions: a 3° path stays 30 m above the ground from 800 m to 8 km out.
    for (const end of [0, s.runwayLength]) for (let d = 800; d <= 8000; d += 100) {
      const p = sitePoint(s, end ? end + d : -d);
      assert.ok(s.elevation + Math.tan(3 * Math.PI / 180) * d - groundHeight(p.x, p.z) > 30, `${s.id} approach to ${end ? 'far' : 'near'} end at ${d} m`);
    }
    // Far from every field and every other site.
    for (const o of [...AIRPORTS, ...AIRPORT_SITES]) if (o.id !== s.id) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) > 12000, `${s.id} and ${o.id}`);
    // No village is planned on the field or under its approaches.
    for (const [x, z] of VILLAGES) assert.ok(!inProtectedArea(s, x, z), `${s.id} village at ${x}, ${z}`);
    assert.ok(Math.abs(localCoordinates(s, s.x, s.z).along - s.runwayLength / 2) < 1e-9);
  }
});

test('outer scenery is bounded: coarse tiles share the full grid, the forest is planted per cell', () => {
  // A coarse tile is its full tile's step-4 mesh, vertex for vertex.
  const full = tileGeometry(13, 7, 1).getAttribute('position'), coarse = tileGeometry(13, 7, COARSE_STEP).getAttribute('position');
  const row = SEGMENTS + 1, crow = SEGMENTS / COARSE_STEP + 1;
  for (const [i, j] of [[0, 0], [5, 9], [26, 26], [13, 2]]) for (let k = 0; k < 3; k++) assert.equal(coarse.getX(j * crow + i) * (k === 0) + coarse.getY(j * crow + i) * (k === 1) + coarse.getZ(j * crow + i) * (k === 2),
    full.getX((j * 4) * row + i * 4) * (k === 0) + full.getY((j * 4) * row + i * 4) * (k === 1) + full.getZ((j * 4) * row + i * 4) * (k === 2));
  // However large the world, only the tiles near the camera keep full meshes.
  const half = WORLD.tileSize / 2;
  for (const [cx, cz] of [[0, 0], [-60000, 60000], [58000, 4500], [WORLD.maxX, 0]]) {
    let resident = 0;
    for (let j = 0; j < WORLD.tiles; j++) for (let i = 0; i < WORLD.tiles; i++) {
      const x = WORLD.minX + (i + .5) * WORLD.tileSize, z = WORLD.minZ + (j + .5) * WORLD.tileSize;
      if (Math.hypot(Math.max(0, Math.abs(cx - x) - half), Math.max(0, Math.abs(cz - z) - half)) <= FULL_RANGE.high + FULL_LAG) resident++;
    }
    assert.ok(resident <= 64, `${resident} full tiles at ${cx}, ${cz}`);
  }
  // The outer forest: one cell per outer tile, the same every planting, within its cap and never on water or a site.
  let cells = 0;
  for (let j = 0; j < WORLD.tiles; j++) for (let i = 0; i < WORLD.tiles; i++) if (outerCell(i, j)) cells++;
  assert.equal(cells, WORLD.tiles ** 2 - (CORE.size / WORLD.tileSize) ** 2);
  const a = outerTrees(13, 8), b = outerTrees(13, 8);
  assert.deepEqual(a, b);
  assert.ok(a.length > 200 && a.length <= OUTER_CELL.trees);
  for (const [i, j] of [[13, 8], [2, 9], [6, 14], [11, 1]]) for (const [x, y, z] of outerTrees(i, j)) {
    assert.ok(y + 2 > WATER_LEVEL + 15, `tree in water at ${x}, ${z}`);
    assert.ok(AIRPORT_SITES.every(s => !inProtectedArea(s, x, z)), `tree on a site at ${x}, ${z}`);
  }
});

test('the lake shader only skips the terrain over the Mer d\'Aurin where it is over 26 m deep', () => {
  let n = 0;
  grid(-30000, 36000, 44000, 64000, 97, (x, z) => { if (!deepSea(x, z)) return; assert.ok(groundHeight(x, z) < WATER_LEVEL - 26, `${x}, ${z}`); n++; });
  assert.ok(n > 20000, `${n} samples`);
});

test('the chart covers the whole world: framing, zoom, tiles and places', () => {
  const world = frameView({ framing: 'world' }, 640, 480, { x: 0, z: 0 }, null, 20);
  for (const [x, z] of [[WORLD.minX, WORLD.minZ], [WORLD.maxX, WORLD.maxZ], [WORLD.minX, WORLD.maxZ]]) {
    const [px, py] = world.project(x, z);
    assert.ok(px >= 19.9 && py >= 19.9 && px <= 620.1 && py <= 460.1, `${x}, ${z}`);
  }
  assert.ok(ZOOM_SPANS.at(-1) >= WORLD.size, 'the widest zoom step shows the whole world');
  // Panned or following views stay over the world, out to its new corners.
  const c = clampCentre(1e6, -1e6, ZOOM_SPANS[4] / 300, 300, 300);
  assert.ok(c.cx <= WORLD.maxX + 1500 && c.cz >= WORLD.minZ - 1500 && c.cx > CORE.maxX);
  // The quadtree: level 0 is the world, the finest level keeps 34 m pixels.
  assert.equal(tilesFor(createView(0, 0, WORLD.size / 100, 100, 100), 0).length, 1);
  assert.equal(tileLevel(WORLD.size / TILE_PIXELS), 0);
  assert.ok(tileMetres(MAX_TILE_LEVEL) / TILE_PIXELS < 35);
  // A close view of an outer field needs only the tiles under it.
  const view = createView(58000, 4500, 40, 300, 200), level = tileLevel(view.mpp), size = tileMetres(level);
  assert.equal(level, MAX_TILE_LEVEL);
  assert.ok(tilesFor(view, level).length <= (Math.ceil(300 * 40 / size) + 1) * (Math.ceil(200 * 40 / size) + 1));
  // Outer terrain on the chart: the sea is water, Calmeterre International is land.
  const water = terrainColour(WATER_LEVEL, WATER_LEVEL, WATER_LEVEL, WATER_LEVEL, 10);
  const pixel = (x, z) => {
    const level = MAX_TILE_LEVEL, size = tileMetres(level), i = Math.floor((x - WORLD.minX) / size), j = Math.floor((z - WORLD.minZ) / size);
    const t = { level, i, j, minX: WORLD.minX + i * size, minZ: WORLD.minZ + j * size, size }, data = rasterTile(t, heightAt);
    const px = Math.floor((x - t.minX) / size * TILE_PIXELS), py = Math.floor((z - t.minZ) / size * TILE_PIXELS);
    return [...data.slice((py * TILE_PIXELS + px) * 4, (py * TILE_PIXELS + px) * 4 + 3)];
  };
  assert.deepEqual(pixel(3000, 54000), water);
  assert.notDeepEqual(pixel(58000, 4500), water);
  const names = mapPlaces().map(p => p.name);
  for (const id of OUTER) assert.ok(names.includes(region(id).name), id);
  assert.ok(names.includes('Lac Long') && names.includes('Mont Cendre'));
});

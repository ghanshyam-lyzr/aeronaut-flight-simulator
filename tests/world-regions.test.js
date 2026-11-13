import test from 'node:test';
import assert from 'node:assert/strict';
import { groundHeight, groundShader, noise, fbm, hash, valleyCurve, westValleyCurve, basinDistance } from '../src/terrain.js';
import { groundHeight as worldHeight, deepBasin, DEEP_CHANNEL_SOUTH } from '../src/world.js';
import { WORLD, REGIONS, ROUTES, LANDMARKS, VILLAGES, AIRFIELD_SITES, SHAPES, WATER_LEVEL, regionAt, region, inWorld, clampToWorld } from '../src/regions.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';

// The height function before the regions were added, verbatim.
function legacyHeight(x, z) {
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t, ridge = (a, b) => 1 - Math.abs(noise(a, b) * 2 - 1);
  const curve = Math.sin(z * .00028) * 480 + Math.sin(z * .00074) * 170;
  const dist = Math.abs(x - curve + (noise(x * .00055, z * .00055) - .5) * 230);
  const foot = smooth(1000, 4900, dist);
  const ridges = ridge(x * .00049 + 14, z * .00049 + 8) * .58 + ridge(x * .00118 + 4, z * .00118 + 11) * .28 + ridge(x * .0027, z * .0027) * .14;
  let h = -48 + Math.pow(dist * .008, 2) * .13 + foot * (720 + ridges * 1850);
  h += foot * (noise(x * .0073, z * .0073) - .5) * 165;
  h += foot * (noise(x * .017, z * .017) - .5) * 43;
  h += smooth(-6500, -14500, z) * (700 + ridges * 1800) * (1 - foot * .45);
  h += (fbm(x * .0015, z * .0015) - .45) * (28 + foot * 90);
  const airportDistance = Math.sqrt(((x - AIRFIELD.x) / 410) ** 2 + ((z - AIRFIELD.z) / 840) ** 2);
  return mix(h, AIRFIELD.elevation, 1 - smooth(.79, 1.65, airportDistance));
}

// Runs the generated GLSL as JavaScript (in double precision): any drift between
// the two hand-kept twins shows up as a height difference.
function glslAsJs() {
  const body = groundShader
    .replace(/^float groundHash[^\n]*\n/m, '')
    .replace(/\bfloat (\w+)\(([^)]*)\)\s*\{/g, (_, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')}) {`)
    .replace(/\bfloat /g, 'let ');
  const prelude = `const {abs,min,max,sin,exp,floor,sqrt}=Math; const clamp=(x,a,b)=>min(b,max(a,x)), mix=(a,b,t)=>a+(b-a)*t, vec2=(a,b)=>[a,b], length=v=>sqrt(v[0]*v[0]+v[1]*v[1]);`;
  return new Function('groundHash', `${prelude}\n${body}\nreturn groundHeight;`)(hash);
}

const grid = (x0, x1, z0, z1, step, fn) => { for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) fn(x, z); };
const distanceToRoute = (x, z, { points }) => Math.min(...points.slice(0, -1).map(([ax, az], i) => {
  const [bx, bz] = points[i + 1], dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}));
const carved = ROUTES.filter(r => r.carve !== false);

test('the world is at least 70 km square and tiled exactly', () => {
  assert.ok(WORLD.size >= 70000);
  assert.equal(WORLD.maxX - WORLD.minX, WORLD.size);
  assert.equal(WORLD.maxZ - WORLD.minZ, WORLD.size);
  assert.equal(WORLD.tiles * WORLD.tileSize, WORLD.size);
  // Tiles stay on the original 84.6 m vertex grid, so the valley's mesh is unchanged.
  assert.ok(Number.isInteger((WORLD.minX + 22000) / (WORLD.tileSize / 104)));
  assert.ok(inWorld(0, 0) && !inWorld(WORLD.maxX + 1, 0) && !inWorld(0, WORLD.minZ - 1));
  assert.deepEqual(clampToWorld(1e6, -1e6, 100), { x: WORLD.maxX - 100, z: WORLD.minZ + 100 });
  assert.equal(worldHeight, groundHeight);
});

test('heights are finite and bounded everywhere on the rendered terrain', () => {
  let low = Infinity, high = -Infinity;
  grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 400, (x, z) => {
    const h = groundHeight(x, z);
    assert.ok(Number.isFinite(h), `height at ${x}, ${z}`);
    low = Math.min(low, h); high = Math.max(high, h);
  });
  assert.ok(low > -90 && high < 7000, `${low}..${high}`);
});

test('the GLSL twin computes the same heights as groundHeight', () => {
  const shader = glslAsJs();
  let worst = 0;
  grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 530, (x, z) => { worst = Math.max(worst, Math.abs(shader(x, z) - groundHeight(x, z))); });
  for (const site of [...LANDMARKS, ...AIRFIELD_SITES]) worst = Math.max(worst, Math.abs(shader(site.x, site.z) - groundHeight(site.x, site.z)));
  for (const route of ROUTES) for (const [x, z] of route.points) worst = Math.max(worst, Math.abs(shader(x, z) - groundHeight(x, z)));
  assert.ok(worst < 1e-6, `largest difference ${worst} m`);
});

test('the central valley, Alpine Field and its approach are unchanged', () => {
  let compared = 0;
  grid(-7000, 7000, -13000, 9000, 97, (x, z) => {
    if (Math.abs(x - valleyCurve(z)) > 5500) return;
    if (carved.some(route => distanceToRoute(x, z, route) < route.width * 4.4 + 400)) return;
    assert.equal(groundHeight(x, z), legacyHeight(x, z), `height at ${x}, ${z}`);
    compared++;
  });
  assert.ok(compared > 15000, `${compared} points compared`);
  // Runway 36: graded flat, and the approach from 10 km south matches the original ground.
  for (let along = 0; along <= AIRFIELD.runwayLength; along += 25) for (const cross of [-30, 0, 30]) {
    const p = runwayPoint(along, cross);
    assert.ok(Math.abs(groundHeight(p.x, p.z) - AIRFIELD.elevation) < 1e-9);
  }
  for (let along = 0; along >= -10000; along -= 50) for (const cross of [-300, 0, 300]) {
    const p = runwayPoint(along, cross);
    assert.equal(groundHeight(p.x, p.z), legacyHeight(p.x, p.z));
    if (along < -1200) assert.ok(groundHeight(p.x, p.z) < AIRFIELD.elevation + Math.tan(3 * Math.PI / 180) * -along - 30);
  }
});

test('the lake shader only skips the terrain over water over 26 m deep', () => {
  // A depth over 26 m draws exactly as the flat 40 m the shader assumes.
  const deep = WATER_LEVEL - 26;
  let channel = 0, basin = 0;
  grid(WORLD.minX, WORLD.maxX, -5600, DEEP_CHANNEL_SOUTH, 41, (x, z) => {
    if (Math.abs(x - valleyCurve(z)) > 860) return;
    if (Math.abs(x - AIRFIELD.x) < 680 && Math.abs(z - AIRFIELD.z) < 1390) return;
    assert.ok(groundHeight(x, z) < deep, `channel at ${x}, ${z}: ${groundHeight(x, z)}`); channel++;
  });
  grid(-12000, 14000, 16000, 33000, 61, (x, z) => {
    if (!deepBasin(x, z)) return;
    assert.ok(groundHeight(x, z) < deep, `basin at ${x}, ${z}: ${groundHeight(x, z)}`); basin++;
  });
  assert.ok(channel > 10000 && basin > 10000, `${channel} channel and ${basin} basin samples`);
});

test('each new region has its own recognisable ground', () => {
  // Val Verdance: a dry meadow floor between 380 and 820 m along its length.
  for (let z = -18000; z <= 6000; z += 1000) {
    const h = groundHeight(westValleyCurve(z), z);
    assert.ok(h > 380 && h < 820, `Val Verdance floor at z ${z}: ${h}`);
    assert.ok(groundHeight(westValleyCurve(z) + 6500, z) > h + 300, `Val Verdance east wall at z ${z}`);
  }
  // Orvane Plateau: rolling tableland near 1,040 m, with buttes standing above it.
  const { plateau, basin } = SHAPES;
  let plateauSamples = 0;
  grid(plateau.x - plateau.rx * .6, plateau.x + plateau.rx * .6, plateau.z - plateau.rz * .6, plateau.z + plateau.rz * .6, 300, (x, z) => {
    if (Math.hypot((x - plateau.x) / plateau.rx, (z - plateau.z) / plateau.rz) > .65) return;
    if (plateau.buttes.some(([bx, bz, r]) => Math.hypot(x - bx, z - bz) < r * 1.4)) return;
    const h = groundHeight(x, z);
    assert.ok(h > 900 && h < 1200, `plateau at ${x}, ${z}: ${h}`); plateauSamples++;
  });
  assert.ok(plateauSamples > 800, `${plateauSamples} plateau samples`);
  for (const [bx, bz, , rise] of plateau.buttes) assert.ok(groundHeight(bx, bz) > plateau.elevation + rise * .6, `butte at ${bx}, ${bz}`);
  // Serein Basin: open water with its three islands above it.
  assert.ok(groundHeight(basin.x, basin.z) < -40);
  for (const [ix, iz, , rise] of basin.islands) assert.ok(groundHeight(ix, iz) > WATER_LEVEL + rise * .25, `island at ${ix}, ${iz}`);
  let water = 0;
  grid(basin.x - basin.rx, basin.x + basin.rx, basin.z - basin.rz, basin.z + basin.rz, 250, (x, z) => { if (groundHeight(x, z) < WATER_LEVEL) water++; });
  assert.ok(water * 250 * 250 > 1.5e8, `${(water * 250 * 250 / 1e6).toFixed(0)} km² of water`);
});

test('routes between regions stay low enough to fly through', () => {
  for (const route of ROUTES) {
    const { points, width } = route;
    for (let i = 0; i < points.length - 1; i++) for (let t = 0; t <= 1; t += .05) {
      const [ax, az, ay] = points[i], [bx, bz, by] = points[i + 1], x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      // The corridor wanders by up to 260 m, so take the lowest ground across its floor.
      let lowest = Infinity;
      for (let s = -width; s <= width; s += width / 8) lowest = Math.min(lowest, groundHeight(x + s * (bz - az) / Math.hypot(bx - ax, bz - az), z - s * (bx - ax) / Math.hypot(bx - ax, bz - az)));
      assert.ok(lowest < Math.max(ay, by) + 140, `${route.name} at ${x.toFixed(0)}, ${z.toFixed(0)}: ${lowest.toFixed(0)} m`);
    }
    assert.ok(region(route.from) && region(route.to), route.id);
  }
});

test('regions, landmarks, villages and airfield sites agree with the terrain', () => {
  assert.equal(regionAt(WORLD.maxX + 10, 0), null);
  grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 2200, (x, z) => assert.ok(regionAt(x, z), `${x}, ${z}`));
  assert.equal(new Set(REGIONS.map(r => r.id)).size, REGIONS.length);
  for (const id of ['southern-basin', 'western-valley', 'eastern-plateau']) assert.ok(LANDMARKS.filter(l => l.region === id).length >= 3, id);
  for (const l of LANDMARKS) {
    assert.ok(inWorld(l.x, l.z, 2000), l.name);
    assert.equal(regionAt(l.x, l.z).id, l.region, l.name);
    const h = groundHeight(l.x, l.z);
    if (l.type === 'lake') assert.ok(h < WATER_LEVEL - 20, l.name);
    if (l.type === 'village' || l.type === 'airport' || l.type === 'island') assert.ok(h > WATER_LEVEL + 15, l.name);
    if (l.y !== undefined) assert.ok(l.y > h + 150, `${l.name} is ${l.y - h} m above ground`);
    if (l.type === 'peak') assert.ok(h > 1400, l.name);
  }
  for (const [x, z, spread] of VILLAGES) {
    let dry = 0;
    grid(x - spread / 2, x + spread / 2, z - spread / 2, z + spread / 2, spread / 6, (px, pz) => { const h = groundHeight(px, pz); if (h > 28 && h < 1400) dry++; });
    assert.ok(dry >= 12, `village at ${x}, ${z}: ${dry} of 49 spots dry`);
  }
  for (const site of AIRFIELD_SITES) {
    assert.equal(regionAt(site.x, site.z).id, site.region, site.id);
    const heights = [];
    for (let along = -site.length / 2 - 300; along <= site.length / 2 + 300; along += 50) for (const cross of [-60, 0, 60]) {
      heights.push(groundHeight(site.x + along * Math.sin(site.heading) + cross * Math.cos(site.heading), site.z - along * Math.cos(site.heading) + cross * Math.sin(site.heading)));
    }
    const low = Math.min(...heights), high = Math.max(...heights);
    assert.ok(low > WATER_LEVEL + 10, `${site.id} stays dry: ${low}`);
    assert.ok(high - low < 45, `${site.id} varies ${(high - low).toFixed(1)} m along its runway`);
  }
});

test('the southern basin is reached from the valley by water', () => {
  for (let z = 9000; z <= 17500; z += 250) assert.ok(groundHeight(valleyCurve(z), z) < WATER_LEVEL - 20, `Narrows at ${z}`);
  assert.ok(basinDistance(valleyCurve(17500), 17500) < 1);
});

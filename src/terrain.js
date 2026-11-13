// The one height function: flight collisions, scenery placement, the map and the
// rendered mesh call groundHeight; the lake shader runs groundShader, the same
// arithmetic in GLSL, so water always knows its true depth. Keep them in step:
// every change below has its twin in the template further down.
import { AIRFIELD } from './airfield.js';
import { SHAPES, ROUTES, WORLD } from './regions.js';
import { GRADED_AIRPORTS } from './airports.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export function hash(x, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function noise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz); return mix(mix(hash(ix, iz), hash(ix + 1, iz), sx), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz); }
export function fbm(x, z) { return noise(x, z) * .55 + noise(x * 2.03 + 17, z * 2.03 + 31) * .27 + noise(x * 4.13 + 51, z * 4.13 + 11) * .12 + noise(x * 8.17, z * 8.17) * .06; }
function ridge(x, z) { return 1 - Math.abs(noise(x, z) * 2 - 1); }

const { westValley: W, plateau: P, basin: B, rim: R } = SHAPES;
// Four widths (plus the wobble of up to 370 m) from its line a corridor has
// handed the ground back to the mountainside, so points outside this box skip it.
const CARVED = ROUTES.filter(r => r.carve !== false).map(r => {
  const reach = r.width * 4 + 400, xs = r.points.map(p => p[0]), zs = r.points.map(p => p[1]);
  return { ...r, box: [Math.min(...xs) - reach, Math.min(...zs) - reach, Math.max(...xs) + reach, Math.max(...zs) + reach] };
});
const { x: airportX, z: airportZ, elevation: airportY } = AIRFIELD;

/** The central lake's centreline: x of the valley floor at z. */
export const valleyCurve = z => Math.sin(z * .00028) * 480 + Math.sin(z * .00074) * 170;
/** The western valley's centreline. */
export const westValleyCurve = z => W.x + Math.sin(z * W.f1 + W.p1) * W.a1 + Math.sin(z * W.f2) * W.a2 + smooth(W.bendFrom, W.bendTo, z) * W.bend;
/** Normalised distance from the southern basin's centre (1 is about the shore). */
export const basinDistance = (x, z) => Math.sqrt(((x - B.x) / B.rx) ** 2 + ((z - B.z) / B.rz) ** 2);

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
  // The world rim rises into a far range.
  h += smooth(R.from, WORLD.maxX, Math.max(Math.abs(x), Math.abs(z))) * R.height;
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

function glslCorridor(route, i) {
  const segments = route.points.slice(0, -1).map(([ax, az, ay], k) => {
    const [bx, bz, by] = route.points[k + 1];
    return `  best = min(best, groundSegment(x, z, h, detail, ${v(ax)}, ${v(az)}, ${v(ay)}, ${v(bx)}, ${v(bz)}, ${v(by)}, ${v(route.width)}));`;
  }).join('\n');
  return `float groundCorridor${i}(float x, float z, float h, float detail) {\n  float best = h;\n${segments}\n  return best;\n}`;
}

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
${CARVED.map(glslCorridor).join('\n')}
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
  h += groundSmooth(${v(R.from)}, ${v(WORLD.maxX)}, max(abs(x), abs(z))) * ${v(R.height)};
  float basinNorth = groundSmooth(${v(B.north)}, ${v(B.northFull)}, z);
  if (basinNorth > 0.) {
    float e = length(vec2((x - ${v(B.x)}) / ${v(B.rx)}, (z - ${v(B.z)}) / ${v(B.rz)})) + (groundNoise(x * .00042 + 3., z * .00042 + 9.) - .5) * .22;
    h = mix(h, 60. + max(h - 60., 0.) * .42 + min(h - 60., 0.), (1. - groundSmooth(1.35, 2.25, e)) * basinNorth);
    float bed = ${v(B.floor)} + groundSmooth(.5, 1.03, e) * 104. + (groundFbm(x * .0011 + 8., z * .0011 + 2.) - .5) * 30. * groundSmooth(.85, 1.15, e);
    float islandNoise = .88 + groundNoise(x * .006, z * .006) * .24;
${B.islands.map(([ix, iz, r, rise]) => `    bed += ${v(rise)} * groundSmooth(${v(r)}, ${v(r * .15)}, length(vec2(x - ${v(ix)}, z - ${v(iz)})) * islandNoise);`).join('\n')}
    h = mix(h, min(bed, h), (1. - groundSmooth(1.03, 1.7, e)) * basinNorth);
  }
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

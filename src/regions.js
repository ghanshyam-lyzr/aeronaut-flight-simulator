// The world's map: one source for its extent, named regions, landmarks, routes
// and the terrain shapes that carve them. Pure data, no three.js, so the terrain,
// the scenery, the navigation map, airports and tests all read the same numbers.
// Distances are metres: +x is east, +z is south, y is height above the datum
// (the lakes lie at WATER_LEVEL). Every name describes an original fictional
// alpine world; nothing here is real geography.

export const WATER_LEVEL = 10;

// Rendered and flyable extent: 8 x 8 terrain tiles of 8.8 km, 70.4 km square.
export const WORLD = Object.freeze({
  minX: -35200, maxX: 35200, minZ: -35200, maxZ: 35200,
  size: 70400, tileSize: 8800, tiles: 8,
});

/** True when (x, z) lies on rendered terrain. */
export const inWorld = (x, z, margin = 0) => x >= WORLD.minX + margin && x <= WORLD.maxX - margin && z >= WORLD.minZ + margin && z <= WORLD.maxZ - margin;

/** The nearest point that is still `margin` metres inside the world. */
export function clampToWorld(x, z, margin = 0) {
  return { x: Math.min(WORLD.maxX - margin, Math.max(WORLD.minX + margin, x)), z: Math.min(WORLD.maxZ - margin, Math.max(WORLD.minZ + margin, z)) };
}

// Terrain shapes. terrain.js turns these into the height function (CPU and GLSL);
// change a number here and both follow.
export const SHAPES = Object.freeze({
  // Western valley floor: centreline x = x + sin(z*f1+p1)*a1 + sin(z*f2)*a2, bending
  // east toward the southern basin; the floor descends from its head to the shore.
  westValley: { x: -23500, a1: 1500, f1: .00019, p1: .6, a2: 450, f2: .00057, bend: 7000, bendFrom: 8000, bendTo: 22000,
    floor: 1300, wall: 5600, head: -24500, headTop: -19000, high: 760, low: 430, shore: 26 },
  // Eastern plateau: a noisy ellipse of rolling tableland, with flat-topped buttes.
  plateau: { x: 24000, z: -4000, rx: 9500, rz: 15000, elevation: 1040,
    buttes: [[21500, -9500, 900, 380], [27500, -1500, 650, 300], [19500, 2500, 520, 240], [28500, -13500, 780, 420]] },
  // Southern basin: a broad lake ringed by soft foothills, with three islands.
  basin: { x: 1200, z: 24500, rx: 11500, rz: 8000, floor: -62, north: 9500, northFull: 14500,
    islands: [[-2600, 26000, 1100, 270], [4800, 22200, 650, 210], [6500, 28500, 500, 170]] },
  // Mountains rise toward the world's rim so its edge reads as a far range.
  rim: { from: 31000, height: 650 },
});

// Low corridors between regions, flyable below the ridgelines (and by
// helicopter). Points are [x, z, floor elevation]; width is the flat floor.
export const ROUTES = Object.freeze([
  { id: 'col-de-brume', name: 'Col de Brume', from: 'central-valley', to: 'western-valley', width: 650,
    points: [[-1150, 3500, 70], [-4200, 3900, 560], [-8000, 3500, 1020], [-11500, 2600, 1150], [-15500, 1500, 840], [-19800, 600, 520]] },
  { id: 'lanz-gorge', name: 'Lanz Gorge', from: 'central-valley', to: 'eastern-plateau', width: 420,
    points: [[1650, 8300, 60], [4300, 8500, 380], [7600, 8000, 720], [11200, 7300, 960], [15200, 6200, 1040]] },
  { id: 'orvane-descent', name: 'Orvane Descent', from: 'eastern-plateau', to: 'southern-basin', width: 560,
    points: [[21000, 10500, 1030], [17500, 14500, 760], [14500, 18000, 380], [11800, 20800, 40]] },
  // The central lake runs south through the Narrows into the basin, and the
  // western valley bends east to the basin's west shore: both are open water or
  // valley floor already, so they need no carving.
  { id: 'the-narrows', name: 'The Narrows', from: 'central-valley', to: 'southern-basin', width: 900, carve: false,
    points: [[350, 9000, 10], [-250, 13500, 10], [0, 17500, 10]] },
  { id: 'verdance-shore', name: 'Lower Verdance', from: 'western-valley', to: 'southern-basin', width: 1300, carve: false,
    points: [[-22145, 6000, 441], [-20562, 13800, 392], [-19376, 18000, 156], [-18344, 21000, 43], [-17600, 23600, 27]] },
  { id: 'serein-gap', name: 'Serein Gap', from: 'western-valley', to: 'southern-basin', width: 800,
    points: [[-17600, 23600, 28], [-14200, 24600, 32], [-10900, 25100, 26]] },
]);

// Regions in lookup order (the first whose rectangle holds a point wins).
// `bounds` is [minX, minZ, maxX, maxZ]; `elevation` is the typical ground range.
export const REGIONS = Object.freeze([
  { id: 'central-valley', name: 'Alpine Valley', kind: 'lake valley', bounds: [-6500, -12000, 7500, 12500], elevation: [10, 900],
    summary: 'The original winding lake valley, Alpine Field and its villages.' },
  { id: 'southern-basin', name: 'Serein Basin', kind: 'lake basin', bounds: [-14500, 12500, 16500, 35200], elevation: [10, 600],
    summary: 'A broad southern lake with wooded islands, ringed by soft foothills.' },
  { id: 'western-valley', name: 'Val Verdance', kind: 'valley', bounds: [-35200, -24500, -9500, 24000], elevation: [400, 800],
    summary: 'A dry pastoral valley of meadows, forest and farm villages west of the main range.' },
  { id: 'eastern-plateau', name: 'Orvane Plateau', kind: 'plateau', bounds: [12500, -21000, 35200, 11500], elevation: [950, 1300],
    summary: 'High rolling tableland near 1,040 m with flat-topped buttes.' },
  { id: 'northern-range', name: 'Northern Range', kind: 'mountains', bounds: [-9500, -35200, 12500, -12000], elevation: [1500, 4500],
    summary: 'The high massif behind the Northern Pass.' },
  { id: 'outer-ranges', name: 'Outer Ranges', kind: 'mountains', bounds: [WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ], elevation: [900, 4500],
    summary: 'High ridges between the regions and around the world rim.' },
]);

export const region = id => REGIONS.find(r => r.id === id);

/** The region holding (x, z): one of REGIONS, or null outside the world. */
export function regionAt(x, z) {
  if (!inWorld(x, z)) return null;
  return REGIONS.find(({ bounds: [x0, z0, x1, z1] }) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
}

// Named places. `y` is set only for points in the air (a pass); otherwise the
// ground height at (x, z) is the landmark's height.
export const LANDMARKS = Object.freeze([
  { name: 'Alpine Field', type: 'airport', region: 'central-valley', x: 900, z: -1800 },
  { name: 'Lake Azure', type: 'lake', region: 'central-valley', x: -100, z: -2400 },
  { name: 'Mont Argent', type: 'peak', region: 'central-valley', x: -4500, z: -6300 },
  { name: 'The Three Sisters', type: 'peak', region: 'central-valley', x: 5200, z: -4100 },
  { name: 'Northern Pass', type: 'pass', region: 'northern-range', x: -300, z: -12600, y: 2200 },
  { name: 'Lac Serein', type: 'lake', region: 'southern-basin', x: 2400, z: 25000 },
  { name: 'Isle Brisa', type: 'island', region: 'southern-basin', x: -2600, z: 26000 },
  { name: 'Port Serein', type: 'village', region: 'southern-basin', x: -9200, z: 19800 },
  { name: 'Bellarive', type: 'village', region: 'southern-basin', x: 11900, z: 22300 },
  { name: 'Val Verdance', type: 'valley', region: 'western-valley', x: -23300, z: -4000 },
  { name: 'Verdance', type: 'village', region: 'western-valley', x: -22400, z: 2600 },
  { name: 'Pic Ferrand', type: 'peak', region: 'western-valley', x: -29500, z: -9500 },
  { name: 'Col de Brume', type: 'pass', region: 'western-valley', x: -11500, z: 2600, y: 1450 },
  { name: 'Orvane Plateau', type: 'plateau', region: 'eastern-plateau', x: 24500, z: -5500 },
  { name: 'Les Tables', type: 'butte', region: 'eastern-plateau', x: 21500, z: -9500 },
  { name: 'Orvane', type: 'village', region: 'eastern-plateau', x: 23800, z: 3800 },
  { name: 'Lanz Gorge', type: 'gorge', region: 'outer-ranges', x: 9400, z: 7700, y: 1200 },
]);

// Villages: [x, z, spread in metres, houses attempted]. The first four are the
// original central-valley villages and keep their places.
export const VILLAGES = Object.freeze([
  [1650, -1500, 510, 37], [-1800, -3100, 700, 37], [1750, 1900, 590, 37], [-1700, 5500, 700, 37],
  [-22400, 2600, 900, 46], [-24600, -11000, 700, 30], [-19400, 13800, 760, 34],
  [-9200, 19800, 760, 40], [11900, 22300, 700, 36], [-3600, 30800, 640, 28],
  [23800, 3800, 640, 26], [27800, -9000, 520, 20],
]);

// Flat, open ground surveyed for future airfields: centre, heading (radians, 0 =
// runway toward north) and the runway length that fits. Not built and not graded:
// an airport here still grades its own apron into terrain.js.
export const AIRFIELD_SITES = Object.freeze([
  { id: 'verdance', region: 'western-valley', x: -21000, z: 1800, heading: 0, length: 1500 },
  { id: 'orvane', region: 'eastern-plateau', x: 29400, z: -200, heading: .9, length: 1800 },
  { id: 'serein', region: 'southern-basin', x: 7800, z: 29800, heading: .9, length: 1500 },
]);

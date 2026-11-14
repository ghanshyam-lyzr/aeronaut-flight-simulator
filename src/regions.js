// The world's map: one source for its extent, named regions, landmarks, routes
// and the terrain shapes that carve them. Pure data, no three.js, so the terrain,
// the scenery, the navigation map, airports and tests all read the same numbers.
// Distances are metres: +x is east, +z is south, y is height above the datum
// (the lakes lie at WATER_LEVEL). Every name describes an original fictional
// alpine world; nothing here is real geography.

export const WATER_LEVEL = 10;

// Rendered and flyable extent: 16 x 16 terrain tiles of 8.8 km, 140.8 km square.
// The original 70.4 km world (CORE) sits at its centre, ringed by the Divide.
export const WORLD = Object.freeze({
  minX: -70400, maxX: 70400, minZ: -70400, maxZ: 70400,
  size: 140800, tileSize: 8800, tiles: 16,
});

/** The original 70.4 km world inside the Divide: its terrain and scenery are unchanged. */
export const CORE = Object.freeze({ minX: -35200, maxX: 35200, minZ: -35200, maxZ: 35200, size: 70400 });

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
  // The original world's rim survives as the Divide, a ring of ranges between it
  // and the outer regions: it rises as before up to the old edge, then falls
  // back to the open mountains, which a new rim lifts again at the world's edge.
  divide: { from: 31000, to: 35200, fadeFrom: 38000, fadeTo: 44000, height: 650 },
  rim: { from: 65000, height: 700 },
  // Vauclair: a glacial trough, U-shaped, from a snowbound cirque in the north-west
  // down to the overdeepened finger lake at its mouth. Points are [x, z, floor,
  // half-width]; walls rise `rise` metres from the floor's edge to one half-width
  // beyond it. Cirques are [x, z, radius, floor]: bowls hollowed into its walls.
  trough: { rise: 1400,
    points: [[-40000, -58500, 2150, 1300], [-30000, -55000, 1960, 1700], [-19000, -51500, 1720, 2000], [-9500, -49600, 1490, 2100],
      [-500, -48800, 1470, 2200], [9500, -47600, 1190, 2200], [20000, -46000, 860, 2000], [29500, -44200, 420, 1800],
      [36000, -42600, -40, 1600], [44500, -40200, -40, 1700], [50500, -37600, 70, 2200]],
    cirques: [[-33500, -61800, 1500, 2280], [-14500, -56500, 1400, 2150], [2500, -54800, 1300, 2050], [-23500, -46000, 1200, 2000]] },
  // Calmeterre: a broad lowland plain. The Calme meanders south across it, bends
  // west and reaches the sea; its floodplain steps up in terraces to rolling
  // farm hills in the east and to the Orvane Escarpment in the west.
  lowlands: { edge: 40000, north: -41000, top: 150, foot: 24, terraces: [[1500, 26], [4300, 30], [8200, 44]],
    river: { x: 52000, width: 150, bend: -17000, bendFrom: 32000, bendTo: 52000, mouth: 54000 },
    oxbows: [[46000, -20200, 800, 1.57], [56500, 10800, 760, 4.71], [53900, 15600, 820, 1.57]] },
  // Mer d'Aurin: a long inland sea in the south with a rocky archipelago and a
  // coastal plain along its north shore (the Fjord de Lisse is one of ROUTES).
  sea: { x: 3000, z: 54000, rx: 31000, rz: 8200, floor: -85, north: 36500, northFull: 40000,
    islands: [[-9500, 56500, 900, 230], [-5200, 59800, 650, 170], [14500, 57800, 1100, 270], [20500, 52500, 520, 140]] },
  // Cendre: a volcanic tableland in the west. A caldera holds a crater lake with
  // a young cone for an island; cinder cones with summit craters stand on the
  // lava plateau. Cones are [x, z, radius, height, crater depth].
  // Flows are [bearing, length, half-width, thickness]: lava tongues from the caldera's flanks.
  highlands: { edge: -40000, elevation: 760, caldera: { x: -55000, z: -9000, r: 4300, rim: 1380, bed: -45, island: [-54000, -8200, 800, 300] },
    flows: [[1.2, 11000, 1300, 55], [2.3, 14000, 1600, 45], [.2, 9000, 1100, 60], [4.0, 8000, 1200, 50]],
    // The Plaine de Sorre: smooth farmland in a shallow basin of the tableland.
    farmland: { x: -49000, z: 21000, rx: 6500, rz: 5000, elevation: 705 },
    cones: [[-47500, -21500, 1300, 340, 70], [-49500, 3500, 1100, 280, 55], [-60500, 9500, 1500, 420, 90], [-46500, 13500, 900, 210, 45], [-58000, -25500, 1200, 300, 60]] },
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
  // Through the Divide to the outer regions. `outer` corridors are cut after the
  // outer regions' ground, so they run on through it.
  { id: 'col-de-vauclair', name: 'Col de Vauclair', from: 'northern-range', to: 'northern-glaciers', width: 600, outer: true,
    points: [[-300, -29000, 1700], [100, -34000, 1780], [300, -39000, 1740], [-800, -44000, 1600], [-1200, -47200, 1490]] },
  { id: 'rampe-orvane', name: "Rampe d'Orvane", from: 'eastern-plateau', to: 'eastern-lowlands', width: 520, outer: true,
    points: [[31500, -3500, 1030], [35500, -3000, 880], [39000, -2500, 520], [43500, -2000, 170]] },
  { id: 'gorges-aurin', name: "Gorges d'Aurin", from: 'southern-basin', to: 'southern-coast', width: 460, outer: true,
    points: [[180, 30500, -15], [300, 35000, -15], [900, 40000, -15], [1500, 46500, -15]] },
  { id: 'fjord-de-lisse', name: 'Fjord de Lisse', from: 'southern-coast', to: 'western-highlands', width: 520, outer: true,
    points: [[-25500, 51000, -60], [-31500, 47800, -55], [-35800, 43200, -45], [-41000, 40000, -30], [-44000, 37000, 180], [-46000, 34500, 700]] },
  { id: 'pas-de-cendre', name: 'Pas de Cendre', from: 'western-valley', to: 'western-highlands', width: 560, outer: true,
    points: [[-26800, -12500, 640], [-31500, -13500, 900], [-36000, -14000, 1050], [-40500, -14500, 820]] },
  // The trough and the river are open floor already.
  { id: 'val-vauclair', name: 'Val Vauclair', from: 'northern-glaciers', to: 'eastern-lowlands', width: 2000, carve: false,
    points: [[-30000, -55000, 1960], [-500, -48800, 1470], [20000, -46000, 860], [36000, -42600, 10], [50500, -37600, 70]] },
  { id: 'calme', name: 'The Calme', from: 'eastern-lowlands', to: 'southern-coast', width: 700, carve: false,
    points: [[54360, -38000, 10], [53630, -35000, 10], [54020, -32000, 10], [52660, -29000, 10], [50460, -26000, 10], [48220, -23000, 10],
      [47910, -20000, 10], [48880, -17000, 10], [49340, -14000, 10], [49170, -11000, 10], [48820, -8000, 10], [50680, -5000, 10],
      [52900, -2000, 10], [55210, 1000, 10], [54900, 4000, 10], [54910, 7000, 10], [54690, 10000, 10], [56150, 13000, 10],
      [55640, 16000, 10], [54280, 19000, 10], [51320, 22000, 10], [50280, 25000, 10], [49880, 28000, 10], [50050, 31000, 10],
      [48250, 34000, 10], [44850, 37000, 10], [41660, 40000, 10], [39760, 43000, 10], [38470, 46000, 10], [36520, 49000, 10],
      [35840, 52000, 10]] },
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
  { id: 'eastern-lowlands', name: 'Calmeterre', kind: 'river plain', bounds: [37000, -39000, 66000, 46000], elevation: [10, 400],
    summary: 'A broad lowland plain below the Orvane Escarpment: the meandering Calme, its oxbow lakes, terraces and farm hills.' },
  { id: 'southern-coast', name: 'Aurin Coast', kind: 'sea coast', bounds: [-47000, 37000, 37000, 66000], elevation: [10, 300],
    summary: "The Mer d'Aurin: an inland sea with a rocky archipelago, a coastal plain on its north shore and the Fjord de Lisse." },
  { id: 'western-highlands', name: 'Cendre Highlands', kind: 'volcanic tableland', bounds: [-66000, -40000, -37000, 37000], elevation: [550, 1400],
    summary: 'A lava tableland near 760 m: a caldera with its crater lake, lava tongues and cinder cones.' },
  { id: 'northern-glaciers', name: 'Vauclair Glaciers', kind: 'glacial valley', bounds: [-46000, -66000, 46000, -39000], elevation: [10, 2400],
    summary: 'A U-shaped glacial trough from snowbound cirques down to the finger lake Lac Long.' },
  { id: 'outer-ranges', name: 'Outer Ranges', kind: 'mountains', bounds: [WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ], elevation: [900, 4500],
    summary: 'High ridges between the regions, the Divide around the original world, and the far rim.' },
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
  // Beyond the Divide.
  { name: 'Glacier de Vauclair', type: 'glacier', region: 'northern-glaciers', x: -30000, z: -55000 },
  { name: 'Pic Blanc', type: 'peak', region: 'northern-glaciers', x: -20800, z: -56200 },
  { name: 'Lac Long', type: 'lake', region: 'northern-glaciers', x: 40000, z: -41300 },
  { name: 'Vauclair', type: 'village', region: 'northern-glaciers', x: 14000, z: -46800 },
  { name: 'Col de Vauclair', type: 'pass', region: 'northern-glaciers', x: 200, z: -40500, y: 2000 },
  { name: 'Calmeterre', type: 'town', region: 'eastern-lowlands', x: 51200, z: -6000 },
  { name: 'Saint-Aubry', type: 'village', region: 'eastern-lowlands', x: 47500, z: 21000 },
  { name: 'Les Prés', type: 'village', region: 'eastern-lowlands', x: 60500, z: -14000 },
  { name: 'The Calme', type: 'river', region: 'eastern-lowlands', x: 49720, z: -6000 },
  { name: 'Lac des Saules', type: 'oxbow', region: 'eastern-lowlands', x: 45200, z: -20200 },
  { name: 'Orvane Escarpment', type: 'escarpment', region: 'eastern-lowlands', x: 39000, z: 8000 },
  { name: "Mer d'Aurin", type: 'sea', region: 'southern-coast', x: 3000, z: 54000 },
  { name: 'Les Écueils', type: 'island', region: 'southern-coast', x: 14500, z: 57800 },
  { name: 'Aurin', type: 'town', region: 'southern-coast', x: 4000, z: 44200 },
  { name: 'Lisse', type: 'village', region: 'southern-coast', x: -21000, z: 47200 },
  { name: 'Fjord de Lisse', type: 'fjord', region: 'southern-coast', x: -35800, z: 43200 },
  { name: "Gorges d'Aurin", type: 'gorge', region: 'southern-coast', x: 600, z: 37500, y: 500 },
  { name: 'Lac Cendre', type: 'lake', region: 'western-highlands', x: -55800, z: -9500 },
  { name: 'Mont Cendre', type: 'caldera', region: 'western-highlands', x: -55000, z: -13300 },
  { name: 'Puy Rouge', type: 'cone', region: 'western-highlands', x: -60500, z: 9500 },
  { name: 'Puy de Sorre', type: 'cone', region: 'western-highlands', x: -46500, z: 13500 },
  { name: 'Cendre', type: 'village', region: 'western-highlands', x: -47000, z: -15500 },
  { name: 'Sorre', type: 'village', region: 'western-highlands', x: -51500, z: 21000 },
  { name: 'Pas de Cendre', type: 'pass', region: 'western-highlands', x: -38500, z: -14200, y: 1300 },
]);

// Villages: [x, z, spread in metres, houses attempted]. The first four are the
// original central-valley villages and keep their places; those beyond CORE draw
// their houses from a sequence of their own (world.js).
export const VILLAGES = Object.freeze([
  [1650, -1500, 510, 37], [-1800, -3100, 700, 37], [1750, 1900, 590, 37], [-1700, 5500, 700, 37],
  [-22400, 2600, 900, 46], [-24600, -11000, 700, 30], [-19400, 13800, 760, 34],
  [-9200, 19800, 760, 40], [11900, 22300, 700, 36], [-3600, 30800, 640, 28],
  [23800, 3800, 640, 26], [27800, -9000, 520, 20],
  // Beyond the Divide: Vauclair, Calmeterre, the Aurin coast, Cendre.
  [14000, -46800, 700, 30], [4500, -48300, 600, 20],
  [51200, -6000, 1100, 70], [47500, 21000, 800, 40], [60500, -14000, 700, 32], [44000, -30500, 650, 26],
  [4000, 44200, 900, 52], [-12500, 45600, 700, 30], [-21000, 47200, 600, 26], [23500, 45500, 600, 24], [14500, 57800, 400, 14],
  [-47000, -15500, 800, 36], [-51500, 21000, 700, 30], [-60000, -20000, 600, 22],
]);

// Flat, open ground surveyed for future airfields: centre, heading (radians, 0 =
// runway toward north) and the runway length that fits. Not built and not graded:
// an airport here still grades its own apron into terrain.js.
export const AIRFIELD_SITES = Object.freeze([
  { id: 'verdance', region: 'western-valley', x: -21000, z: 1800, heading: 0, length: 1500 },
  { id: 'orvane', region: 'eastern-plateau', x: 29400, z: -200, heading: .9, length: 1800 },
  { id: 'serein', region: 'southern-basin', x: 7800, z: 29800, heading: .9, length: 1500 },
]);

// Surveyed for the airports of the outer regions (docs/world-scale.md); airports.js
// builds a field on each (docs/airport-expansion.md). Each is shaped like an AIRPORTS entry (airports.js) so its
// footprint and protected approaches can be measured the same way.
// `heading` is the primary runway's landing direction in radians clockwise from
// north; `apron` is in runway-local metres (along from the primary threshold,
// cross to the right of the centreline), as for the built fields.
const site = spec => Object.freeze({ ...spec, heading: spec.headingDegrees * Math.PI / 180,
  apron: Object.freeze({ along: Object.freeze(spec.apron.along), cross: Object.freeze(spec.apron.cross) }) });
export const AIRPORT_SITES = Object.freeze([
  site({ id: 'calmeterre-international', name: 'Calmeterre International', kind: 'commercial', region: 'eastern-lowlands',
    x: 58000, z: 4500, elevation: 110, headingDegrees: 5, runwayLength: 3200, runwayWidth: 45, surface: 'asphalt',
    apron: { along: [900, 2300], cross: [90, 480] },
    approach: 'Open floodplain both ways; the Calme and an oxbow lake lie under the southern final. Terrace rise of 40 m 1 km east.' }),
  site({ id: 'aurin-cote', name: 'Aurin Côte', kind: 'commercial', region: 'southern-coast',
    x: 11000, z: 44000, elevation: 53, headingDegrees: 100, runwayLength: 3000, runwayWidth: 45, surface: 'asphalt',
    apron: { along: [800, 2200], cross: [-480, -90] },
    approach: 'Coastal plain both ways, the Gorges d\'Aurin mouth 8 km west; the Divide rises 6–8 km north, so circle over the sea to the south.' }),
  site({ id: 'port-aurin', name: "Port d'Aurin", kind: 'lakeside', region: 'southern-coast',
    x: -7500, z: 45500, elevation: 20, headingDegrees: 85, runwayLength: 1800, runwayWidth: 30, surface: 'asphalt',
    apron: { along: [600, 1150], cross: [-300, -60] },
    approach: 'Along the shore of the Mer d\'Aurin, 800 m inland; the south side is open water, the coastal plain climbs gently north.' }),
  site({ id: 'sorre-meadow', name: 'Sorre Meadow', kind: 'grass', region: 'western-highlands',
    x: -49000, z: 23000, elevation: 703, headingDegrees: 20, runwayLength: 900, runwayWidth: 30, surface: 'grass',
    apron: { along: [320, 520], cross: [40, 110] },
    approach: 'Farmland of the Plaine de Sorre at 703 m; open tableland both ways, Puy de Sorre (210 m high) 10 km north-north-east.' }),
  site({ id: 'vauclair-altiport', name: 'Plan de Vauclair', kind: 'mountain', region: 'northern-glaciers',
    x: -4000, z: -50000, elevation: 1483, headingDegrees: 95, runwayLength: 1200, runwayWidth: 30, surface: 'asphalt',
    apron: { along: [380, 650], cross: [35, 140] },
    approach: 'On the outwash floor of Val Vauclair at 1,483 m: walls rise 350 m 2 km either side; approaches along the trough only.' }),
]);

# World regions: a 70 km alpine world

Expands the playable scenery from a 44 km square to **70.4 km square** (`WORLD`, ±35.2 km) with three new regions, linked to the original valley by low routes. No dependencies, downloads, external data or real geography; aircraft handling, the 17-aircraft fleet, UI, camera near plane (1 m), water depth/ripples and the weather and quality settings are unchanged.

## Regions

| Region (`id`) | Character | Typical ground |
| --- | --- | --- |
| Alpine Valley (`central-valley`) | The original lake valley, Alpine Field and its four villages, unchanged | 10–900 m |
| Serein Basin (`southern-basin`) | A broad lake (Lac Serein, over 150 km² of water) reached through the Narrows, three wooded islands, soft foothills, a shore road, five boats, Port Serein, Bellarive and a south-shore hamlet | 10–600 m |
| Val Verdance (`western-valley`) | A dry 2–3 km wide meadow valley west of the main range, floor 430–760 m, stands of forest, three villages and a valley road; its lower end bends east to the basin | 400–800 m |
| Orvane Plateau (`eastern-plateau`) | Rolling open tableland near 1,040 m with scattered groves and four flat-topped buttes (Les Tables), the Orvane hamlets and a plateau track | 950–1,300 m (buttes to ~1,460 m) |
| Northern Range / Outer Ranges | The original northern massif and the ridges between regions; the world's rim rises into a far range | 900–4,500 m |

Routes (`ROUTES`), all lower than the ridgelines and flyable by helicopter:

- **Col de Brume**: central valley west shore (z ≈ 3.5 km) over a 1,150 m saddle down into Val Verdance.
- **Lanz Gorge**: a narrow wooded gorge from the central lake (z ≈ 8.3 km) up to the plateau rim at 1,040 m.
- **Orvane Descent**: from the plateau's south edge down to Lac Serein's north-east shore.
- **The Narrows**: the central lake runs south into the basin as open water.
- **Lower Verdance** and **Serein Gap**: down Val Verdance and over a low saddle onto the basin's west shore.

## Source of truth: `src/regions.js`

Pure data with no three.js import, for the airport, map and mission threads:

- `WORLD` `{ minX, maxX, minZ, maxZ, size, tileSize, tiles }`. Metres; +x east, +z south. `inWorld(x, z, margin)` and `clampToWorld(x, z, margin)`.
- `WATER_LEVEL` (10 m): ground below it is lake.
- `REGIONS[]` `{ id, name, kind, bounds: [minX, minZ, maxX, maxZ], elevation: [lo, hi], summary }`, in lookup order. `regionAt(x, z)` returns the first whose rectangle holds the point (`outer-ranges` is the catch-all), or `null` outside the world. `region(id)` looks one up.
- `LANDMARKS[]` `{ name, type, region, x, z, y? }`: 17 named places (the original five, then 3–4 per new region). `y` is set only for airborne points (passes, the gorge); otherwise use the ground height. `createWorld()` still returns `landmarks` as `{ name, type, region, position: Vector3 }`.
- `ROUTES[]` `{ id, name, from, to, width, points: [[x, z, floorElevation]…], carve? }`.
- `VILLAGES[]` `[x, z, spread, houses]` (the first four are the originals).
- `AIRFIELD_SITES[]` `{ id, region, x, z, heading, length }`: surveyed, **not built and not graded**. Heading is radians clockwise from north (the `AIRFIELD.heading` convention); trees are already kept off a 520 m wide strip extending 700 m past each end.
- `SHAPES`: the numbers the terrain is carved from (west valley curve, plateau ellipse and buttes, basin ellipse and islands, rim).

`createWorld()` additionally returns `bounds` (`WORLD`), `regions` and `regionAt`.

### Terrain: `src/terrain.js`

`groundHeight(x, z)` (re-exported from `world.js` as before) and `groundShader`, its GLSL twin, are generated from the same `SHAPES`/`ROUTES` numbers. Helpers: `valleyCurve(z)`, `westValleyCurve(z)` and `basinDistance(x, z)`. **An airport that grades an apron must add the same grading to both the JS function and the GLSL template**, as Alpine Field's apron does at the end of each; `tests/world-regions.test.js` then proves that they still agree.

### Candidate airfield sites (for the airport-network thread)

Ground variation is measured along the runway plus 300 m beyond each end, across ±60 m:

| id | Region | Centre (x, z) | Heading | Length | Ground | Variation |
| --- | --- | --- | --- | --- | --- | --- |
| `verdance` | Val Verdance | −21000, 1800 | 0 (N–S, along the valley) | 1,500 m | ≈440 m | 7.4 m |
| `orvane` | Orvane Plateau | 29400, −200 | 0.9 rad (≈52°) | 1,800 m | ≈1,030 m | 7.9 m |
| `serein` | Serein Basin south shore | 7800, 29800 | 0.9 rad (≈52°) | 1,500 m | ≈30 m | 2.3 m |

All three are dry, inside their regions and away from village centres. Approaches: Verdance along the valley floor (high walls east and west); Orvane over open tableland; Serein over Lac Serein from the north-east.

## Rendering and bounds

- Terrain: 8 × 8 tiles of 8.8 km (104 segments) on the original vertex grid, so the central valley's mesh is the same as before. Each tile picks its index step from its nearest-edge distance to the camera, re-chosen after every 500 m: high 1/2/4 at <9 km/<22 km/beyond, balanced 2/4 at 16 km, performance 2/4 at 7.5 km. A skirt hanging 1–160 m below every tile edge hides any crack between steps. Vertices sit on one integer world grid, and normals come from a one-sample border ring, so seams match bit for bit and shade continuously.
- Forest: the original 28,200 trees keep their random sequence and buckets. The regions plant up to 52,000 more (about 62,000 trees in total), drawn from a separate sequence, clustered into stands (sparser groves on the plateau) and kept off the airfield sites. They sit in one bucket per tile, and buckets beyond 16/12.5/8.5 km (high/balanced/performance) are hidden, on top of the existing density scaling.
- Clouds: the original 46, plus 24 over the outer regions (low and balanced show 8 and 14 of them).
- Lake: one 70.4 km plane. The shader's shoreline shortcut now also treats the basin's heart (away from the islands) as deep, and stops treating the central channel as deep south of z = 28 km. Both shortcuts are tested to cover only water over 26 m deep, where the flat 40 m depth draws identically.

## Validation

`npm test`: **295 passed, 0 failed** (286 before, plus 9 in `tests/world-regions.test.js`). `npm run build` passes (the existing large-bundle advisory remains).

`tests/world-regions.test.js` covers:

- Bounds ≥ 70 km, exact tiling, and the original vertex grid.
- Finite heights everywhere (−90 to 7,000 m).
- **The GLSL twin and `groundHeight` agree**: the generated GLSL is run as JavaScript over the whole world, at every landmark, site and route point (worst difference < 1e-6 m).
- **Central valley unchanged**: over 15,000 points within 5.5 km of the lake are bit-identical to the original function; runway 36 stays graded at 78 m; the 10 km approach matches the original ground and stays under a 3° glide path.
- The lake shader's deep-water shortcuts cover only water over 26 m deep.
- Each region's character: valley floor and walls, plateau surface and buttes, basin water area and islands.
- Every route has a low floor; landmarks, villages and sites sit on suitable ground; `regionAt` covers the world; the Narrows link the valley to the basin by water.

### Browser review (software WebGL in this VM)

- **CPU/GPU agreement on a real GPU path**: `groundShader` was compiled in WebGL2 and its heights rendered to an R32F texture on 256 × 256 grids, then compared with `groundHeight`. Worst differences: 3 cm near shorelines over the basin, the Narrows and the airport, and 0.30 m on the highest peaks (float32), with a mean of 7 mm across the world.
- Inspected the central valley and the Alpine Field approach (the runway and approach are clear of trees and houses), Val Verdance, the Col de Brume pass, the Lanz Gorge, Orvane Plateau and Les Tables, Lac Serein with its islands and shoreline foam, and Port Serein. High and low quality were both checked; low quality's tile seams show no cracks.
- HUD layout unchanged at 1600 × 900, 1280 × 800 and 390 × 844.
- Load in this VM (software rendering, 2 cores):

| | Before | After |
| --- | --- | --- |
| `createWorld()` | 0.50–0.66 s | 1.24–1.44 s |
| High quality, start view | 70 draws, 528k tris | 91 draws, 415k tris |
| Low quality, start view | 61 draws, 99k tris | 74 draws, 128k tris |
| High quality, new regions | n/a | 28–144 draws, 216k–519k tris |
| High quality, world corner looking across everything | n/a | 168 draws, 315k tris |

**Not measured:** frame rate. This VM renders with SwiftShader (frames take hundreds of milliseconds), so its FPS figures say nothing about a hardware GPU. The triangle and draw counts above are the comparable measure.

## Known limits

- `heightAt` remains defined beyond `WORLD`, and nothing stops an aircraft from flying past the rendered edge (behaviour unchanged). `inWorld`/`clampToWorld` exist for a future boundary rule.
- The navigation map, airports, mission selection and any boundary warnings are left to their own threads.

# Airport network: five fields

Adds four fictional fields to Alpine Field across the 70 km world, all landable, graded into the terrain and rendered procedurally. Alpine Field, `AIRFIELD`, `world.airport` and every default (runway start, landing mission, map) are unchanged. Aircraft handling, water styling, the camera near plane and the fleet are untouched; no dependencies or external data were added.

| id | Ident | Name | Region | Kind | Centre (x, z) | Elevation | Runways (heading) | Length × width | Surface |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `alpine-field` | QAAF | Alpine Field | central-valley | valley | 900, −1800 | 78 m | 36 / 18 (000° / 180°) | 1,100 × 53 m | asphalt, lit |
| `orvane-regional` | QAOR | Orvane Regional | eastern-plateau | regional | 21000, −2000 | 1,058 m | 14 / 32 (138° / 318°) | 2,600 × 45 m | asphalt, lit |
| `verdance-meadow` | QAVM | Verdance Meadow | western-valley | grass | −23900, −3100 | 440 m | 35 / 17 (352° / 172°) | 900 × 30 m | grass |
| `serein-lakeside` | QASL | Serein Lakeside | southern-basin | lakeside | 1390, 15540 | 42 m | 16 / 34 (162° / 342°) | 1,400 × 30 m | asphalt, lit |
| `brume-col` | QACB | Col de Brume | western-valley (on the col) | mountain | −11350, 2350 | 1,142 m | 11 / 29 (106° / 286°) | 650 × 18 m | asphalt |

Runway numbers are the true headings in tens of degrees (the world has no magnetic variation). Orvane's 14/32 and the col's 11/29 run well off north/south; Serein's 16/34 sits 18° off it.

- **Orvane Regional**: open tableland, both finals over flat plateau; terminal with glazed front, control tower, two arched hangars, a large apron with two taxiways; threshold bars, numbers, centreline, edge lines, aiming points and touchdown-zone pairs; edge lights.
- **Verdance Meadow**: mown olive strip with two lighter mown lanes, white edge and threshold boards, gravel apron, timber clubhouse and hangar under slate gables. Finals follow the valley floor; the valley road passes ~600 m east and is not cut.
- **Serein Lakeside**: the shore where the Narrows open into Lac Serein, ~600 m from the water. Both finals cross open water (runway 16 from ~1.2 km out, runway 34 from ~2 km), then a short stretch of shore. Pale terminal and small tower, arched hangar, concrete apron, full paint, lights.
- **Col de Brume**: a short altiport on the 1,140 m saddle of the Col de Brume route, approached up either valley (the ground falls away beyond both ends). Stone hut and hangar under steep roofs, gravel apron, numbers, threshold bars, edge lines. High ground rises ~500 m north of the strip.

Every field has a windsock opposite its apron by the primary threshold; all socks show the same wind as Alpine Field's.

## Aircraft suitability

`RUNWAY_NEEDS[aircraftId]` gives each fleet aircraft's minimum runway `length`, `width` and allowed `surfaces`. Lengths are at least 1.5× the takeoff roll the flight model produces (tested). `suitability(airport, id)` returns `{ rating, reason }`: `recommended` (length ≥ 1.5 × need), `suitable` (fits with little margin) or `unsuitable` (too short, too narrow or a paved-only aircraft on grass). Helicopters are recommended everywhere.

| Field | Recommended | Suitable (little margin) | Unsuitable |
| --- | --- | --- | --- |
| Alpine Field | rotorcraft, bush, biplane, motorglider, trainer, utility, canard, aerobatic, commuter, cityliner, jet | regional, fighter, cargo, airliner (737), widebody | — |
| Orvane Regional | all 17 aircraft | — | — |
| Verdance Meadow | rotorcraft, bush, biplane, motorglider, trainer, utility, aerobatic | commuter | canard, cityliner, jet, regional, fighter, cargo, airliner, widebody |
| Serein Lakeside | rotorcraft, bush, biplane, motorglider, trainer, utility, canard, aerobatic, commuter, cityliner, jet, regional, fighter | cargo, airliner | widebody (needs 45 m width) |
| Col de Brume | rotorcraft, bush, biplane, motorglider, trainer, utility, canard, aerobatic | — | commuter, cityliner, jet, regional, fighter, cargo, airliner, widebody |

Each field also carries a one-line `caution` (elevation, grass, short and narrow) for selection and mission UI. Density altitude is not modelled by the flight model, so Orvane and the col fly like sea level; the caution text says what a pilot should expect, not what the model enforces.

## Registry API: `src/airports.js` (pure data, no three.js)

- `AIRPORTS[]`: frozen, in the order above. Each field: `{ id, ident, name, kind, region, x, z, elevation, heading, runway, reciprocal, runways, runwayLength, runwayWidth, surface, lit, apron, summary, caution }`. `heading` is radians clockwise from north for the primary runway (`runway`), exactly `AIRFIELD`'s convention, so `runwayCoordinates(position, field)` / `runwayPoint(along, cross, field)` from `airfield.js` and `new LandingMission(field)` work on any field. `runways` is `[{ designator, heading, threshold: { x, z } }]` for both ends. `apron` is `{ along: [a0, a1], cross: [c0, c1] }` in runway-local metres (along from the primary threshold, cross right of the centreline).
- `ALPINE_FIELD`: the registry entry for Alpine Field; it has every `AIRFIELD` value (`AIRFIELD` itself is unchanged and still the default everywhere) plus the metadata above and `grading: 'legacy'`.
- `airportById(id)`, `designator(heading)`.
- `runwayDirection(field, designator)`: the same field landing the other way (heading, `runway`/`reciprocal`, `runways` and `apron` flipped), e.g. `new LandingMission(runwayDirection(airportById('orvane-regional'), '32'))`. Throws for a runway the field does not have.
- `footprint(field)`, `localCoordinates(field, x, z)`, `inProtectedArea(field, x, z)` (footprint + 120 m, plus a 1.5 km approach funnel at each end, kept free of trees and houses).
- `GRADING`, `gradingBox(field)`, `GRADED_AIRPORTS`: how terrain.js grades the four new fields.
- `RUNWAY_NEEDS`, `suitability(field, aircraftId)`, `aircraftFor(field, ids?)` → `{ recommended, suitable, unsuitable }` id lists.

## Runtime API

- `createWorld()` still returns `airport` (Alpine Field, now `{ ...ALPINE_FIELD, position, windsock }`) and adds `airports`: every field in registry order as `{ ...field, position: Vector3(x, elevation, z), windsock }`.
- Until airport selection merges, `main.js` reads `?airport=<id>&runway=<nn>` for the field the Runway start uses (default: Alpine Field 36, unchanged), and `&start=runway` or `&start=approach` begins there. The approach start places the aircraft as the landing mission does (1.1 km final, 3° path, landing configuration) but runs no mission. `window.aeronaut` gains `airports()`, `runwayStart(id?, runway?)` and `approachStart(id?, runway?)`. The selection thread can replace the query handling; `runwayStart(field)` and `approachStart(field)` take any registry field or `runwayDirection` result.

## Terrain

The four new fields are graded in runway-local coordinates at the end of `groundHeight` and of its GLSL twin (generated from the same `GRADED_AIRPORTS` numbers): flat over the footprint plus a 250 m margin, then a smoothstep back to natural ground over 700 m along the centreline and 300 m to the sides. The margin covers the terrain mesh: at index steps 1 and 2 (84.6 m and 169 m between vertices, the near detail on every quality) the rendered triangles lie exactly flat under each runway and apron; at step 4 (beyond 7.5–22 km) they stay within 1.3 m. Paved and grass surfaces sit 0.48–0.93 m above the graded ground, exactly as Alpine Field's runway does, so gear clearances are the same on every field. Alpine Field's original ellipse is untouched.

Grading changes: Orvane cuts ≤ 21 m and fills ≤ 35 m; Verdance ≤ 5 / 16 m; Serein ≤ 17 / 26 m (filling a little shore beside the runway, which the lake shader follows); the col cuts ≤ 34 m into its north wall, where the steepest graded bank is 0.79 (38°) against a natural 0.48, ~550 m beside the centreline and not under either final.

## Tests: `tests/airport-network.test.js` (in `npm test`)

Registry shape and truthful runway numbers; Alpine Field compatibility (`AIRFIELD` values, defaults, legacy grading); rotated runway coordinates for every field in both directions; flat grading in the collider, the GLSL twin and the simulated terrain mesh at steps 1/2/4, with dry ground; 3° approach clearance (15 m from 300 m out) and no walls on all ten finals; graded banks under 40°; protected areas and villages; suitability checked against measured takeoff rolls; and, on every new field in both directions, a full-power runway departure and a full landing-mission landing with the landing tests' feedback pilot, plus the 737 and widebody departing Orvane in the first half of its runway.

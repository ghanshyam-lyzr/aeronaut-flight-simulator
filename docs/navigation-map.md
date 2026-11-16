# Navigation map

Connects the expanded world (`src/regions.js`), the airport network (`src/airports.js`) and the selected airport (`src/airport-selection.js`) through the map. No terrain, airports or mission scoring change, and no dependencies are added.

## Pieces

- `src/navigation.js` (pure, no three.js or DOM): destination (`navigationDestination(airportState())`: the mission's field while one flies, else the selection), bearing, distance and ground-motion/progress readouts (`bearingDistance`, radians clockwise from north on the world axes, `navigationReadout`), views (`createView`, `frameView` for route / follow / world / panned framing, `clampCentre`, `routeZoom` with hysteresis, `zoomFrom`, `edgePointer`), the scale bar (`scaleBar`), terrain tiles (`tileLevel`, `tilesFor`, `parentTile`, `rasterTile`, `terrainColour`) and labels (`mapPlaces`, `placeLabels`).
- `src/nav-map.js`: `NavigationMap` draws one canvas. Terrain comes from `world.heightAt` (the function rendering and collisions use) as a quadtree of 32 px tiles over `WORLD`, cached (700 tiles, levels 0–2 always kept) and sampled centre-first within a time budget per draw (6 ms high, 3 ms low; 40 / 20 ms on the chart, where the flight is paused). Until a tile is sampled its nearest cached ancestor is drawn instead. Low quality samples a level coarser, caps the canvas at 1× pixels, thins the trail and shows fewer places.
- `src/main.js`: the small map (redrawn with the HUD, about 8 times a second, never per animation frame) and the chart dialog. The destination is never stored separately: both read `airportState()`. Choosing a field on the chart calls `selection.select`, exactly as Explore does.

## Behaviour

- Retry keeps the mission's field; cancelling returns to the selected field; selecting another field during a mission changes the next departure or mission, and the chart says so.
- The bearing readout is the true bearing to the field's reference point with a small arrow relative to the nose; nothing commands the aircraft.
- The small map and chart add labeled **Track / Groundspeed** values inside the existing panel. They show horizontal travel; the heading instrument remains nose heading and the airspeed tape remains airspeed. On phones the two labels sit over their values inside the existing 142 px map. The map still hides during a mission on phones; N (or the mobile menu’s chart action) opens the chart.

## Ground-motion and progress contract

`main.js` passes `groundVelocity(state, type)` from `src/flight-path.js` to the pure `navigationReadout({ position, heading, groundVelocity }, destination)` helper. This is the same authoritative velocity that `groundTrack` uses: helicopter world momentum, fixed-wing travel plus wind, and wheel travel on the ground. Navigation never adds wind again or derives travel from airspeed. It reads horizontal x/z only, so climb rate cannot inflate groundspeed. A crashed aircraft supplies null velocity; a stationary aircraft supplies a zero vector, even in wind.

The helper returns ground motion even without a destination. Track is clockwise from true north, shown as 001–360°, and is unavailable below 1 m/s (about 2 kt). Groundspeed is m/s internally and rounded to whole knots for display; zero is a valid reading. `heading` only drives the existing relative-bearing arrow, so nose direction cannot change the estimate for sideways or backward rotorcraft travel.

For a destination, the field reference point (x/z in the airport registry, not the runway threshold or touchdown zone) supplies the bearing and horizontal distance. The signed closing speed is the dot product:

```
closingSpeed = groundVelocity · (destination - position) / distance
estimatedSeconds = distance / closingSpeed
```

The chart labels this **Est. time to field**, with **At present closing speed** beneath it. This extrapolates current progress; it does not model a future turn, changing wind, descent, touchdown or landing time. Opening a dialog pauses flight and wind; the chart describes that frozen motion, and does not count down in wall time.

`NAVIGATION` exports these display/gameplay guards, not aircraft performance limits:

- **Not closing**: closing speed at or below 2 m/s (about 4 kt), or closing speed at or below half of horizontal groundspeed. This includes hover, outbound flight and travel mainly across the route (more than about 60° from the destination bearing). Useful slow rotorcraft travel above that bound can still produce an estimate; there is no fixed-wing airspeed cutoff.
- **Near field**: distance at or below 100 m, avoiding an unstable bearing/estimate over the reference point. It does not mean landed or mission complete.
- **Unavailable**: missing/nonfinite ground velocity, including after a crash. No destination gives **No destination**, while motion can still be read.

Each unavailable estimate is a dash with the reason alongside it. `eteSeconds` is null in those states. The helper retains no history, so selecting another field or runway, mission lock/retry/cancel and aircraft/start resets cannot reuse a previous destination’s estimate.

## Read-only diagnostics

`window.aeronaut.getNavigation()` keeps `destination, bearing, distance, framing, scale, pendingTiles, drawMs` and adds `track, trackText, groundSpeed, groundSpeedText, closingSpeed, eteSeconds, ete, eteState, eteReason`. `bearing` is rounded degrees as before; `track` is radians clockwise from north, speeds are m/s, distance is metres and `eteSeconds` is seconds. Absent numeric values are null. `eteState` is `estimate`, `not-closing`, `near-destination`, `unavailable` or `no-destination`. The snapshot only reads flight state. `window.aeronaut.setMapFraming(framing, zoom?)` still sets the small map’s framing.

## Measurements and verification

The navigation tests fly the trainer over flat 40 m terrain for 8 s with ordinary `FlightInputs` at 120 Hz and flight assist holding north. Steady head/tail/crosswind is 12 m/s; a destination is then placed exactly 10 km north of the current position to compare equal remaining routes. The final step’s measured horizontal displacement agrees with the readout within 1e-6 m/s:

| Wind | Airspeed (m/s) | Groundspeed (m/s) | Track | Closing (m/s) | Estimate (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Calm | 51 | 51 | 360° | 51 | 196.08 |
| Headwind from north | 51 | 39 | 360° | 39 | 256.41 |
| Tailwind from south | 51 | 63 | 360° | 63 | 158.73 |
| Crosswind from west | 51 | 52.39 | 013.24° | 51 | 196.08 |

Crosswind increases groundspeed and drifts track without shortening the northward estimate. These are deterministic arcade-model observations, not certified aircraft performance.

`tests/navigation.test.js` covers these measured cases, vertical exclusion, true-north wrap, hover, normal-input backward helicopter travel at 30/60/144 Hz, stationary ground wind for fixed-wing/rotorcraft, a real normal-input crash and reset, no-progress/away/mostly-crossing guards, invalid/no destination, near-field behavior and selection/mission/retry/cancel/runway/aircraft changes. Existing map framing, scale, labels and mission tests remain intact. The related wind test now passes the authoritative velocity instead of a scalar speed. `npm test`: **684 passed**. `npm run build`: passed (the existing bundle-size warning remains).

Browser checks used `forge serve` on `0.0.0.0:5173`, Low quality and headless Chromium software WebGL at 1600×900, 1280×800 and 390×844. Map and chart labels fit with no horizontal document overflow and no console errors; phone chart content scrolls inside the existing dialog. A Serein Lakeside 16 mission kept its destination/estimate when Orvane Regional was selected on the chart, stated that the selection applied to the next flight, and returned to Orvane after cancellation. Chart framing/zoom, pause and the existing phone mission/map visibility remained intact. Navigation values stayed fixed while paused (map timing diagnostics may change as the canvas redraws).

Screenshots for review in this thread’s VM are under `/tmp/forge-browser/wind-nav-{map-live,mission-chart}-{1600,1280,390}.png` (the phone mission map is intentionally hidden).

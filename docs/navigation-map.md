# Navigation map

Connects the expanded world (`src/regions.js`), the airport network (`src/airports.js`) and the selected airport (`src/airport-selection.js`) through the map. No terrain, airports or mission scoring change, and no dependencies are added.

## Pieces

- `src/navigation.js` (pure, no three.js or DOM): destination (`navigationDestination(airportState())`: the mission's field while one flies, else the selection), bearing and distance (`bearingDistance`, radians clockwise from north on the world axes, `navigationReadout`), views (`createView`, `frameView` for route / follow / world / panned framing, `clampCentre`, `routeZoom` with hysteresis, `zoomFrom`, `edgePointer`), the scale bar (`scaleBar`), terrain tiles (`tileLevel`, `tilesFor`, `parentTile`, `rasterTile`, `terrainColour`) and labels (`mapPlaces`, `placeLabels`).
- `src/nav-map.js`: `NavigationMap` draws one canvas. Terrain comes from `world.heightAt` (the function rendering and collisions use) as a quadtree of 32 px tiles over `WORLD`, cached (700 tiles, levels 0–2 always kept) and sampled centre-first within a time budget per draw (6 ms high, 3 ms low; 40 / 20 ms on the chart, where the flight is paused). Until a tile is sampled its nearest cached ancestor is drawn instead. Low quality samples a level coarser, caps the canvas at 1× pixels, thins the trail and shows fewer places.
- `src/main.js`: the small map (redrawn with the HUD, about 8 times a second, never per animation frame) and the chart dialog. The destination is never stored separately: both read `airportState()`. Choosing a field on the chart calls `selection.select`, exactly as Explore does.

## Behaviour

- Retry keeps the mission's field; cancelling returns to the selected field; selecting another field during a mission changes the next departure or mission, and the chart says so.
- The bearing readout is the true bearing to the field's reference point with a small arrow relative to the nose; nothing commands the aircraft.
- `window.aeronaut.getNavigation()` returns `{ destination, bearing, distance, framing, scale, pendingTiles, drawMs }`; `window.aeronaut.setMapFraming(framing, zoom?)` sets the small map's framing.

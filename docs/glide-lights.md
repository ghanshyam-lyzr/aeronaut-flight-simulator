# Glide-path lights

Four red/white lights beside the destination runway's touchdown aim show whether a fixed-wing aircraft is on the landing path. **Two white and two red is on path. More white means high, more red means low.** They work in free flight and in a fixed-wing landing mission.

This is a simplified training aid modelled on a PAPI. It is **not** a certified PAPI installation: there is no light-box optics, transition band, obstacle clearance or real siting standard.

## What the lights show

- **The path is the landing mission's own path.** It starts at `TOUCHDOWN_ZONE.aim` (220 m past the threshold), at runway elevation plus the aircraft's ground clearance, and rises at `landingProfile(type).slope` (0.05, about 2.86°). It is the path the mission card's "Glide path: On path / ft high / ft low" readout and the approach start already use. No second, hard-coded glide angle is introduced.
- **Each unit turns white above its own angle**: path +0.5°, +0.17°, −0.17° and −0.5°, innermost unit first. The outer units turn white first, as on a real PAPI. At 1.3 km, ±0.17° is about ±4 m, which matches the mission card's 4 m "On path" band.
- **The angle comes from the aircraft's position**, not from the chase, cockpit or orbit camera. The lights read the same in every view.
- **Every runway direction has its own aim point**, measured from its own threshold, at its own field elevation (Col de Brume 1,142 m, Orvane Regional 1,058 m).

## Where they are

- One row of four units, 9 m apart. The first unit sits 12 m beyond the runway edge, abeam the aim point.
- The row is on the pilot's left, unless that direction's apron (and its buildings) is on the left; then it is on the right. For example, Orvane 32 and Verdance 35 have their lights on the right.
- The lights follow the active mission's runway while a mission runs (or shows its result). Otherwise they follow the runway selected in Explore. Changing the field or runway, or entering or leaving a mission, moves the same row; nothing is rebuilt.

## When they are hidden

- helicopters (the fixed-wing slope does not apply to them);
- on the ground, after a crash and once a mission has finished;
- less than 100 m before the aim point, over the runway or past it, or behind the far end (that is, on the reciprocal's approach);
- more than 6 km out;
- more than 10° either side of the extended centreline (measured from the runway edges);
- more than 10° above the aim point.

Below the path, the lights stay on as four red. Terrain still hides them, because they are depth-tested.

## Rendering

- **Three objects in total:** one `THREE.Points` draw with four vertices (a per-vertex white flag; the colours are uniforms), and one low graphite housing bar (`BoxGeometry` + `MeshLambertMaterial`). That makes two geometries, two materials, no textures, no scene lights and no downloaded assets.
- **Size:** the points are about 1.2 m across up close. They are never smaller than 4.5 px (scaled to a 900 px tall view) and never larger than 40 px, so a row 1–6 km away stays readable on a laptop and a phone.
- **Depth and fog:** the points are depth-tested against terrain, buildings and the aircraft, and depth writes are off. They use the shared valley-haze fog chunk, so overcast and golden-hour weather dim them like everything else. Weather behaviour is unchanged.
- **Colour updates:** the white flags are rewritten only when the white count changes.
- **Unchanged:** the camera's near plane, the landing gates and outlines, the airport geometry and the touchdown scoring are untouched.

## Help text

- The landing brief (fixed-wing only) explains the colours and calls the lights a simplified training aid.
- The controls dialog adds one note for fixed-wing aircraft.
- `window.aeronaut.getGlideLights()` returns `{ visible, white, units, reason, angle, path, field, runway }` for checks.

## Verification

- `npm test`: 531 tests pass, 9 of them in `tests/glide-lights.test.js`. That file covers:
  - on, high and low counts, and the transition at each offset, which is monotonic;
  - agreement with every mission start, on every runway direction;
  - each sector limit (minimum and maximum distance, lateral and vertical);
  - reciprocal headings and aim points;
  - elevated fields, and per-aircraft clearance;
  - helicopter, ground, crash and invalid-input gating;
  - one set of resources reused across all 10 runway directions, with no stale groups and full disposal;
  - colour updates only when the count changes.
- `npm run build` passes.
- Headless Chromium (software WebGL):
  - **Col de Brume 11** (small, elevated field, free flight, 1.3 km out, on path), 1600×900: [chase](glide-lights/brume-chase-1600.png) and [cockpit](glide-lights/brume-cockpit-1600.png). The row reads white-white-red-red on the left, with the reds nearest the runway. These two shots were taken before the minimum point size went from 3.5 px to 4.5 px.
  - **Orvane Regional 32** (landing mission, reciprocal direction), 1600×900: [cockpit](glide-lights/orvane-32-cockpit-1600.png) and [chase](glide-lights/orvane-32-chase-1600.png). The row is on the right, away from the apron, mirrored red-red-white-white.
  - **390×844:** [chase](glide-lights/orvane-32-chase-390.png). The row is visible below the mission card.
  - **Landing brief:** [1280×800](glide-lights/landing-brief-1280.png) and [390×844](glide-lights/landing-brief-390.png). The new paragraph fits without a dialog scroll at 1280×800.
  - Leaving the mission, a helicopter approach, a runway start and Alpine Field 18 reported `past the approach`, `helicopter`, `on the ground` and on path (2 white), respectively.
  - There were no console errors.

## Limits

- **Software rendering:** with SwiftShader the simulator runs at about 0–1 FPS. So the screenshots were taken at the approach start (about 1.1–1.3 km out), not on a flown approach. At that range the units are only a few pixels across, and the zoomed crops of the WebGL canvas were used to read their colours. On hardware the 4.5 px minimum keeps them legible. The fog is the shared GLSL chunk and was not measured separately under software rendering.
- **Hard transitions:** the colours switch exactly at each offset, with no pink transition band and no hysteresis. Holding an angle right at a boundary can flicker one unit.
- **Simplified siting:** the lights are sited at the aim point, abeam it, and the angle is measured from the centreline aim point, not from each unit. The few metres of lateral offset are ignored.

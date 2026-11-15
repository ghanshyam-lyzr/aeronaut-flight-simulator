# Flight-path marker

An optional HUD symbol that shows where the aircraft is **actually travelling**, not where its nose points. On a landing approach, put the marker on the touchdown zone and the aircraft will arrive there. When the nose is raised but the aircraft is still sinking, the marker stays below the nose (and below the crosshair) until the climb actually develops.

## Using it

- **Settings → Display → Flight path marker.** Off by default, so the usual view doesn't change. The choice is saved with the other preferences (`showFlightPath` in `aeronaut-settings`), and **Restore defaults** turns it off again.
- The symbol is a thin chartreuse circle with two wings and a fin. It is separate from the ivory centre crosshair, which still marks the view's centre ahead of the aircraft. Each can be turned on or off on its own.
- It works in the chase, cockpit and orbit views. The camera does not change it: the marker always means the same direction in the world.
- **Hiding the flight panels (H, or the Flight panels setting) hides it too.** H, the next H and *Show hidden panels* bring it back only if it was turned on: they never switch it on, and leaving it off never shows the *Show hidden panels* button. The marker is a separate opt-in preference, not one of the five display preferences that recovery restores.

## When it is hidden

The marker is hidden rather than pushed to the edge of the screen, because an edge-clamped marker would point the wrong way:

- below 2 m/s of actual travel (it stays shown down to 1 m/s once visible, so a hover or a stop doesn't flicker): parked on a runway, a helicopter hover, a stopped rollout;
- when the direction of travel is behind the camera, or within 20 px of an edge of the world view: a helicopter flying sideways or backwards in the chase view, a vertical climb seen from a level chase camera;
- after a crash, on an invalid (non-finite) state, and once a landing mission has finished.

It is the first element in the HUD, so every panel, the stall/terrain notice, the GEAR banner, the map, the mission card and the phone touch controls draw on top of it. It has no pointer events. The world-space landing cues stay visible through its open centre.

## How it works

`src/flight-path.js` is read-only and never changes the flight model.

- **Velocity (`flightPathVelocity`).** For fixed-wing aircraft, `state.velocity` is only set at a reset and goes stale in flight (a test shows it still holds the reset heading after a turn). So the velocity is rebuilt from the same terms `FlightController.step` uses to move the position:
  - **standard fixed-wing:** `cos(pitch) · speed` along the heading horizontally, and the lagging `state.verticalSpeed` vertically;
  - **free-attitude (aerobatic) types:** the nose's horizontal components × speed, with the lagging `verticalSpeed`. This covers loops, inverted and vertical flight;
  - **ground roll:** speed along the heading;
  - **helicopters:** the integrated `state.velocity`, which covers sideways, backwards and vertical travel, and is zero on the ground.

  Tests check that this equals the next frame's real displacement ÷ dt (to 10⁻⁶ m/s) for the jet, widebody, fighter, aerobatic, helicopter and tandem.
- **Projection (`projectDirection`).** The velocity is projected as a point at infinity, using the rendered camera's orientation and projection matrix. Because of that, the chase and orbit camera offsets add no parallax, and the cockpit view, the aerobatic follow frame and inverted attitudes all work out without special cases. Off-screen, edge and behind-camera directions return `null`; nothing is clamped.
- **No jumps (`FlightPathMarker`).** The velocity comes straight from the current state, with no smoothing or position history. So the first frame after a reset, teleport (approach or runway start), mission start or aircraft change already shows the new path. The only memory is the visibility hysteresis, and it is cleared whenever flight time runs backwards or the aircraft changes. Pausing freezes the frame and the marker together.
- `main.js` updates it right after each render, using the cached stage size. `window.aeronaut.getFlightPath()` returns `{ visible, x, y, reason, enabled }` for checks.

## Verification

- `npm test`: 501 tests pass, 12 of them in `tests/flight-path.test.js`. That file covers:
  - kinematics against the measured displacement, and the stale fixed-wing `state.velocity`;
  - level flight (on the nose in the cockpit, on the horizon in chase);
  - descent with a raised nose (vertical-speed lag);
  - inverted and vertical attitudes;
  - helicopter sideways, backwards and diagonal travel;
  - near-zero motion with hysteresis, invalid and crashed states;
  - frame independence (30, 60 and 144 Hz agree within 4 px);
  - resets, runway starts, landing missions (on the 3° glide path from the first frame) and aircraft changes;
  - agreement with three.js `Vector3.project` through an orbit-style camera, with no clamping on landscape or portrait frames;
  - the setting: default off, validation, migration, round-trip, restore defaults, H and *Show hidden panels* behaviour.
- `npm run build` passes.
- In headless Chromium (software WebGL) on a landing approach to Alpine Field 36:
  - **1600×900:** the chase and cockpit views put the marker on the touchdown zone, below the nose crosshair, at −450 fpm ([chase](flight-path-marker/chase-approach-1600.png), [cockpit](flight-path-marker/cockpit-approach-1600.png)).
  - **1280×800:** cockpit view, same result ([cockpit](flight-path-marker/cockpit-approach-1280.png)).
  - **390×844:** chase view: on the runway, between the mission card and the map, clear of the touch controls ([chase](flight-path-marker/chase-approach-390.png)).
  - Toggling the setting saved it and showed no restore button. H hid the marker with the panels, and the next H restored it with the preference kept.
  - It survived a reload, and Restore defaults turned it off.
  - The first frame after a reset and after a mission start showed the new path. A runway start and a helicopter hover hid it. There were no console errors.

## Limits

- The software renderer in the test VM ran at about 1 frame per second, and each frame advances at most 0.25 s of sim time. So the live browser runs checked placement, layout and reset behaviour, not motion at a real frame rate. Helicopter translation and frame-rate independence are covered by the unit tests, not by the live browser. This says nothing about frame rates on real hardware.
- The marker shows travel relative to the ground. The simulator has no wind model, so that is the same as travel through the air.
- On a phone, a steep path can pass under the mission card or the map. They are drawn above the marker on purpose, so the marker is hidden behind them there.
- It is not drawn in flight photos (the photo button captures only the 3D world, like the rest of the HUD).

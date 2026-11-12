# Montis C90 cargo transport validation

Based on main `36a934b` (fleet expansion #16). Adds one original selectable aircraft, id `cargo`. No dependencies, downloaded models or assets. The one-metre near plane, water rendering, centred cameras and timestamped controls are unchanged; the original ten aircraft keep their tests and code paths.

## Aircraft

- Montis C90 (`A-MC90`, badge CARGO): original four-engine cargo turboprop. Broad high wing (40.4 m span), four separate nacelles with four-blade propellers, deep boxy hold sweeping up to a rear loading-ramp seam (not animated), small flight-deck panes, tall fin, sponsons with retracting tandem main wheels and a twin-wheel nose gear (six tyres). Ivory with deep olive accent (changed from plum after merging, to stay distinct from the Veyra U9's aubergine) and pale gold stripe.
- Metadata in `src/cargo-type.js`, model and cockpit in `src/cargo.js`, tests in `tests/cargo.test.js`. Shared files only register it (`fleet.js`, `aircraft.js`) and make the roster count dynamic (`main.js`).
- Reuses `FlightController` and the existing turboprop sound bus (`engine: 'turboprop'`), with explicit `engines: 4` capability data.
- Arcade tuning: ~198 kt cruise at 72%, slow turbine spool (slower than the Sarine twin), gentle roll/pitch, clean stall 89 kt, 15° flaps rotate near 90 kt, 97 kt full-flap approach at ~35% power, touchdown below 120 kt / 630 fpm.

## Automated checks

`npm test`: **202 passed, 0 failed** (188 previous + 2 landing-mission cases that iterate the whole fleet + 12 cargo cases). `npm run build` passes (Vite's existing large-chunk advisory). `git diff --check` passes.

Deterministic cases on the real procedural terrain with `FlightInputs`:
- Cruise holds 102 m/s and 620 m for 30 s; reset/selection clears state.
- Normal-input runway takeoff with 15° flaps: roll ≈ 482 m in ≈ 25 s, liftoff ≈ 89 kt, inside the 1,100 m runway; then gear-up climb.
- Clean stall at its own threshold, nose drop and power recovery; flap stages lower the stall threshold by 5 m/s each.
- Landing mission: feedback pilot touches down ≈ 329 m past the threshold at ≈ 340 fpm and 97 kt, stops with ≈ 525 m remaining; a hard approach fails and retries cleanly.
- 30/100 ms taps on all four axes, both directions, stay small and match across 10/30/60/120 Hz.
- Model: 40.4 m span, tyres meet the runway datum, 4 propellers spin, 6 tyres, gear retracts in 4 s into the sponsons (hidden when up), flaps reach 30°, opposite ailerons, elevator and rudder move; 68 meshes / ~33k triangles; every geometry and material disposes.
- Cockpit: four power levers follow the throttle, all parts beyond the 1 m near plane, phone fit, full disposal. Chase framing at 390×844 covers the whole span.
- Audio: propeller bus on, jet bus off, gear horn active, muted on crash.

## Browser review

Preview through `forge serve` on 0.0.0.0:5173, headless Chromium with **SwiftShader software WebGL** (1–2 FPS here; hardware GPU performance not benchmarked).

- Explore roster heading reads "11 to fly"; selecting Montis via its roster button updates labels, saves `cargo`, and survives reload.
- 1600×900: selector, chase, orbit (air and runway close-up), cockpit and landing-start views. 1280×800: landing-start chase. 390×844: chase (whole wingspan centred, no horizontal overflow) and cockpit.
- Switching cargo → jet → cargo works; the saved Montis flight appears by name in the flight log.
- Controls dialog lists G and F with truthful help; G and F toggle gear and flaps; gear/flap buttons enabled.
- Sound enabled through its button without errors. No application console errors; the only error came from a synthetic pointer event used to drag the orbit camera (no real pointer to capture), plus SwiftShader readback warnings.

Screenshots in `docs/cargo-qa/`. For clean captures the simulation was paused and the pause overlay/toast hidden in the DOM.

## Limits

Landing and takeoff are validated by automated normal-input pilots, not sustained manual flying. The loading ramp is a seam only; no cargo mode. All four engines share one spool in this flight model, so the four engine columns and levers always agree. Ground handling remains the existing rolling-resistance model (no brakes or reverse). Audio timbre was not reviewed by ear.

## Rebased onto canard (#17)

Merged main `09c3000` (Neris P2 canard) with both aircraft kept in `FLEET`, the factories, styleguide, README and the npm test script. `npm test`: **215 passed, 0 failed**; the shared landing suite lands all 12 registered types, including canard and cargo. `EXPANDED_AIRCRAFT` is still the original six. Build and `git diff --check` pass. In the browser the roster reads "12 to fly" with 12 rows, and roster-button switching canard → cargo → jet → cargo updates the labels, selection and saved id with no console errors.

## Merged with Veyra U9 (#21) and Sorna H8 (#23)

Merged main `fe9f7b4`. Fleet, factory and cockpit dispatch, README, styleguide and the npm test script now hold every merged aircraft plus the Montis C90. Audio routing is unchanged: `turboprop` still selects the propeller bus. The Montis accent moved from plum to deep olive hsl(84 22% 30%), because the Veyra U9's aubergine hsl(318 26% 29%) was nearly identical. `npm test`: **246 passed, 0 failed**; the shared landing suite lands all 14 registered types. There are 14 unique registrations, badges and names. Build and `git diff --check` pass. In the browser the roster reads "14 to fly" with 14 rows. Switching transport → utility → canard → cargo updates labels and the saved id, and the C90 landing mission starts at 97 kt with gear down and 30° flaps, with no console errors. The landing-start, runway close-up and phone chase screenshots were retaken in olive; the earlier plum-era chase and orbit shots were removed.

# Veyra U9 utility turboprop validation

Based on main `36a934b` (fleet expansion #16). Adds one original aircraft, id `utility`, to the existing fleet. No dependencies, downloaded models or assets; no world, water, input, camera near-plane or flight-model rewrites.

## Aircraft

Veyra U9 (A-VU09, badge UTIL): tall square-sided high-wing cabin with four passenger windows per side, a framed two-piece cargo door with its own windows and handle on the left, a belly cargo pod, a long turbine nose with chin intake and exhaust stacks, a five-blade propeller with pointed spinner, single lift struts, long-span flaps, a conventional low tail with dorsal fillet, and sturdy fixed tricycle gear with spring-steel mains. Ivory airframe with aubergine accent, copper cheat line and yellow prop tips.

Metadata lives in `src/utility-type.js`, geometry and cockpit in `src/utility.js`, tests in `tests/utility.test.js`. Shared files only register it: `fleet.js` (import + FLEET entry), `aircraft.js` (two dispatch lines), `main.js` (Explore heading counts `Object.keys(FLEET).length`), `package.json` (test script). It reuses `FlightController`, the `turboprop` sound mix on the propeller bus, and the existing capability flags (`fixedGear`, flaps) rather than id checks.

Arcade tuning: ~150 kt cruise at 72% power, 58 kt clean stall (43 kt with 30° flaps), gradual turbine spool (about 4× slower to 90% than the piston singles), 56 kt rotation with 15° flaps, 72 kt full-flap landing approach at 33% power, touchdown limits 90 kt / 650 ft/min. Camera scale 1.02 (between the bush plane and twin commuter); cockpit eye sits behind the long nose.

## Automated checks

`npm test`: **201 passed, 0 failed** (188 previous + 11 in `tests/utility.test.js` + the two landing-mission cases that iterate the whole fleet). `npm run build` passes (Vite's existing large-bundle advisory remains).

- Registration, unique identity, help/runway text quoting the tuned numbers, no gear-retraction wording; `EXPANDED_AIRCRAFT` still holds the original six model-builder ids.
- Cruise holds speed and altitude for 25 s; reset and switching to/from other types start fresh flights.
- Real-runway takeoff with normal FlightInputs: ~92 m roll with 15° flaps (~119 m clean) versus ~193 m for the twin commuter; acceleration bounded; climbs without stall.
- Clean and full-flap stall thresholds, nose drop, power recovery.
- Fixed gear never retracts or warns; flaps cycle 0/15/30.
- Landing mission: the shared fleet-wide feedback pilot flies approach, flare, touchdown (~285 m along, ~340 ft/min, 72 kt) and rollout to success; a deliberate hard landing fails and retries cleanly.
- 30/100 ms taps on all axes, both directions, stay small and agree across 10/30/60/120 Hz.
- Geometry: 16.0 m span, 13.5 m length, 39 meshes / ~16.9k triangles, one five-blade propeller, three tyres on three fixed gear legs meeting the raised runway top exactly, prop clearance > 0.3 m; propeller spins with spool, flaps reach 30°, ailerons/elevators/rudder deflect; every geometry and material disposes.
- Cockpit fits portrait and landscape and disposes; audio routes to the propeller bus with no gear horn and mutes on crash.

`tests/fleet-expansion.test.js` now checks that the original ten ids are present and that registrations are unique across `Object.keys(FLEET).length`, instead of a literal total of ten.

## Browser review

Software WebGL in the headless VM browser (single-digit FPS); this says nothing about hardware performance. Vite dev server via `forge serve` on 0.0.0.0:5173.

- Explore roster heading reads “11 to fly”; selecting Veyra U9 updates the mission card, saves `aircraft: "utility"` and survives reload.
- Chase, orbit and cockpit at 1600×900; landing start at 1600×900, 1280×800 and 390×844; cockpit at 390×844; runway start at 1600×900. The whole wingspan stays centred on the phone.
- Gear button disabled with “Fixed landing gear · always down”; pressing G toasts the same; F sets 15°; the controls dialog lists flaps but not gear; the landing brief and HUD say “Gear fixed · flaps 30°”, 72 kt, 650 fpm; runway hint names 56 kt.
- Switched utility → commuter → utility → helicopter → utility without errors; an 11 s Veyra flight was saved to the logbook as “Veyra U9”.
- Console: no errors; only the software renderer's GPU-stall-on-ReadPixels warnings from screenshots.

Landing and takeoff were verified by the automated pilot only; no manual keyboard flight from approach to rollout was flown in the browser. Sound was checked by unit tests (bus routing, horn suppression, crash mute), not by listening. Disposal was checked in unit tests; GPU memory counters were not inspected in the browser. No cargo loading is modelled.

# Valnera Q100 cityliner validation

Based on main `63dd67b` (Veyra U9 #21, with Neris P2 #17). Adds one original aircraft, id `cityliner`, to the existing fleet. No dependencies, downloaded models or assets; no world, water, input, camera near-plane or flight-model rewrites. The Sorna H8 helicopter transport is a separate thread and is not touched here.

## Aircraft

Valnera Q100 (A-VQ10, badge Q100): rounded passenger fuselage with a window row, forward and aft passenger doors on both sides (seam outline, flush panel, porthole), a high swept wing with slight droop on a roof fairing, four separate podded turbofans on short pylons under the wing (two per side, each with its own animated 16-blade fan, accent intake lip and exhaust cone), a tall swept fin with T-tail stabiliser and bullet fairing, main-gear sponsons and a belly fairing, and retractable tricycle gear (twin-wheel mains fold inward into the sponsons, twin nose leg folds forward). Ivory airframe, ink-blue fin/cheat line/intake lips, thin glacier pinstripe. 26.5 m span, 29.5 m long including tail fairing, 106 meshes / ~37k triangles.

Metadata lives in `src/cityliner-type.js`, geometry and cockpit in `src/cityliner.js`, tests in `tests/cityliner.test.js`. Shared files only register it: `fleet.js` (import + FLEET entry), `aircraft.js` (import + two dispatch lines), `flight.js` (one `passengerSound` line giving the `cityliner` engine a higher four-fan tone on the existing passenger-jet bus), `package.json` (test script). It reuses `FlightController`, the retractable-gear warning/horn and flap stages, and the landing mission unchanged.

Arcade tuning: ~205 kt cruise at 72% power, 89 kt clean stall (66 kt with 30° flaps), one shared turbine spool reaching 90% in ~4.0 s from idle (regional jet 3.1 s, 737 4.4 s), 89 kt rotation with 15° flaps, 99 kt full-flap approach at ~35% power, touchdown limits 124 kt / 610 ft/min. Camera scale 1.95 (between the commuter and the 737); cockpit eye at the flight deck behind the nose.

**Engine instruments:** the four N1 bars on the deck all read the single simulated spool; the deck labels them "N1 % · one shared spool" and the help text says the four turbofans share one spool. There is no per-engine failure or asymmetric thrust.

## Automated checks

`npm test`: **228 passed, 0 failed** (214 previous + 12 in `tests/cityliner.test.js` + the two landing-mission cases that iterate the whole fleet, which now land all 13 types). `npm run build` passes (Vite's existing large-bundle advisory remains). `git diff --check` is clean.

- Identity: registered as its own type, unique name/registration/badge/engine, `EXPANDED_AIRCRAFT` still the original six; help and runway hint quote the tuned rotate, approach, power and touchdown numbers.
- Cruise holds ~205 kt and 620 m for 25 s; reset and switching widebody → Q100 → 737 → Q100 start fresh flights.
- Slow spool: 90% takes longer than the regional jet and much longer than the commuter, still under 5 s; spool after one second at full lever is 0.2–0.4.
- Real-runway takeoff with `FlightInputs`: ~213 m roll with 15° flaps (regional 324 m, 737 464 m), no speed jump, gear up and climb above 60 m without stall; clean takeoff rolls longer but still fits.
- Stall at 89 kt clean, nose drops, power recovers; full flaps and gear lower it to 66 kt; approach margin > 1.4×.
- Gear warning true low/slow/gear-up, false with gear down, more power or above 1,000 ft; flaps cycle 0/15/30 and each stage slows the aircraft by > 6 m/s.
- 30/100 ms taps on pitch/roll/yaw/throttle, both directions, stay small and agree across 10/30/60/120 Hz.
- Landing mission (dedicated pilot): approach holds 99 ± 10 kt on path, flare below 8 m, touchdown ~303 m along at ~350 ft/min and 96 kt, gear down, flaps 30°, rollout to success stopping ~450 m along. A full-power dive fails as a hard landing; a gear-up approach fails with a gear reason; each retry starts clean with gear down and 30° flaps. The shared fleet-wide feedback pilot in `landing-mission.test.js` also lands it.
- Geometry: four fans (two per side at two spanwise stations, below the wing, > 2 m above the runway) versus ≤ 2 fans/propellers on the 737, regional jet, widebody and commuter; three retractable gear legs and six tyres meeting the raised runway top exactly; fans spin with spool; gear reaches 75% after 1 s and stows hidden after ~4 s, then returns; flaps reach 30°; ailerons opposite, elevators and rudder deflect; every geometry and material disposes.
- Cockpit fits portrait and landscape and disposes; sound uses the jet bus (prop bus off), sounds the gear horn on warning, mutes on crash; 737, light jet, regional and widebody mixes are unchanged.

## Browser review

Software WebGL in the headless VM browser (about 1 FPS; this says nothing about hardware performance). Existing Vite dev server `preview` via `forge serve` on 0.0.0.0:5173.

- Explore roster reads "13 to fly" and lists Valnera Q100 with its Q100 badge, selected; the saved choice `aircraft: "cityliner"` survives reload.
- Switched 737 → Q100 → regional → Q100 from the roster: aircraft, saved setting and gear state (enabled, UP in the air) follow each switch.
- Chase, cockpit and orbit at 1600×900; runway start in orbit at 1600×900 (gear down, "On the ground" notice); landing start at 1600×900, 1280×800 and 390×844; chase runway start, cockpit and orbit at 390×844. The whole wingspan stays centred on the phone; the runway stays visible above the low cockpit panel.
- Landing brief and HUD: 99 kt, "Gear down · flaps 30° · sink <610 fpm · alignment ≤12°".
- A 15 s Q100 flight was saved to the logbook as "Valnera Q100".
- Console: no errors; only the software renderer's GPU-stall-on-ReadPixels warnings from screenshots.

Takeoff, stall, gear warning and landing were verified by deterministic automated pilots only; no manual keyboard flight from approach to rollout was flown in the browser, and the stall/gear banners were not triggered in the browser (their conditions are unit-tested). Sound was checked by unit tests, not by listening.

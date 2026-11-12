# Varen G18 motorglider validation

Based on main `09c3000` (fleet expansion #16 and the Neris P2 canard #17, merged into this branch). Adds one original aircraft, the Varen G18 self-launching powered sailplane (`motorglider`, A-VG18). No dependencies, downloaded models or assets. Water rendering, timestamped controls, centred cameras and the one-metre near plane are unchanged; the original ten aircraft keep their behaviour.

## What changed

- `src/motorglider-type.js` metadata and arcade tuning; `src/motorglider.js` procedural airframe and sailplane cockpit; `tests/motorglider.test.js`.
- Small shared registrations: `FLEET` entry, `createAircraft` / `createCockpit` dispatch, the Explore heading counts `Object.keys(FLEET).length`.
- Two optional flight capabilities in `FlightController`, defaulting to the old behaviour: `idleSink` (sink per unit of spool below 0.32; default 6) and `glidePitch` (the released-stick attitude at idle power; default level). Only the G18 sets them.
- `propellerSound` takes an optional per-type `propVoice` (`pitch`, `level`, `stopBelow`). The G18 uses the existing propeller bus with a higher, quieter voice; below `stopBelow` (0.02 spool, the same threshold that stops the visual prop and shows PROP STOP) blade tone, pulse and propwash are zero and fade back in over the next 0.02. Wind and the master bus are unchanged, and aircraft without `stopBelow` sound exactly as before.
- Livery accent is indigo-violet hsl(255 28% 38%), distinct from the Neris P2's berry.
- `tests/fleet-expansion.test.js`: first test renamed and asserts the original ten ids plus uniqueness against the fleet size. `tests/landing-mission.test.js`: its feedback pilot reads `idleSink` from the type (default 6, so the other aircraft are unchanged).

## Automated checks

`npm test` on the branch merged with current main: **214 passed, 0 failed**, including the canard suite. The shared landing-mission suite's feedback pilot lands all 12 registered types (jet, fighter, helicopter, airliner, trainer, bush, commuter, regional, widebody, aerobatic, canard, motorglider). `npm run build` passes (Vite keeps its large-bundle advisory).

Deterministic G18 cases on the real terrain with ordinary inputs: 67 kt motoring cruise holds altitude; power-off hands-off glide settles at about 49 kt, −260 ft/min (~19:1) and always descends; nose-high power-off stall below 37 kt with gentle recovery; 15° flap self-launch roll about 117 m, 400–600 ft/min initial climb; fixed gear never warns; flaps cycle 15/30/0; the shared all-fleet mission pilot and its own copy both land in the touchdown zone at the 49 kt approach (touchdown ~1.7 m/s); hands-off approaches float long and fail; a full-power dive fails as a hard landing and retries cleanly; 30/100 ms taps on every axis stay small and frame-rate independent (10–120 Hz); roll is slower than the Mira T2; stopped-prop audio is silent below `stopBelow` with wind kept, fades in monotonically, matches the quiet level when running, and FlightAudio drives the tone/wash voices to zero while stopped; other prop aircraft keep their idle sound; geometry span 18.1 m, monowheel and tailwheel meet the runway datum to 1 µm with outriggers 6 cm clear; prop stopped at idle and turning with spool; flaps, opposite ailerons, elevators and rudder move; every geometry/material disposes.

## Browser review

After the merge: the Explore roster lists all 12 ids with the heading "12 to fly"; selecting the Neris P2 and then the G18 through the roster works; no console errors or warnings.


Existing `forge serve` preview on 0.0.0.0:5173, headless Chromium. Selected through the real Explore roster (heading reads "11 to fly"), reload restored the G18 from saved settings, controls dialog omits G and lists F, gear button disabled/"FIXED". Landing mission brief/HUD read 49 kt, "Gear fixed · flaps 30°". Chase, orbit and cockpit checked at 1600×900; landing-start chase/orbit at 1280×800; chase and cockpit at 390×844 (whole span framed, no horizontal overflow). A saved 40 s G18 flight appears as "Varen G18" in the flight log after switching to the Mira T2; repeated switching returned to the G18. No console errors or warnings.

## Limits

Chromium renders with software WebGL (SwiftShader) at 0–1 FPS on high quality; hardware performance was not measured. In-browser flight was short live runs (assisted cruise, a keyboard power reduction into the trimmed glide); approach, flare and landing were verified only by the deterministic test pilots, not flown by hand. Sound routing is unit-tested, not listened to. GPU memory after switching was not measured in the browser; disposal is unit-tested. This is the existing arcade model: no lift, thermals, ridge lift, spoilers, wing-drop on the ground or retractable engine mast.

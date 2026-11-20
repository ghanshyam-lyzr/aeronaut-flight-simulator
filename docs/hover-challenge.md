# Laret H4 hover challenge

Choose **Explore → Hover challenge · Laret H4** (phone: **Menu → Explore**). Only the Laret H4 is supported: other aircraft receive a named explanation and a separate explicit switch button. Opening the brief or refusing an unsupported start changes neither aircraft nor another running exercise.

One local, repeatable challenge uses the existing rotor physics. There are no flight-model changes, new dependencies, online scores or changes to ranked-v1 recording and verification. These are accessible arcade gameplay targets, not real-aircraft limits or certified flight training.

## Setup and controls

The target is 22 m (72 ft) above Alpine Field's runway at x=900, z=−1500, heading 000°. Its centre is presently 100 m / 328 ft MSL. A thin chartreuse ring marks the 4 m horizontal radius at target altitude, with an arrow pointing north and a tether to the runway. It has one shared torus geometry, one line geometry and two basic materials; it is hidden outside active attempts, including results.

The helicopter begins stationary and level at target x+10 m, z+8 m, 4 m low and 20° left of north, at its existing hover collective (58%), rotors at flight speed, manual control, and calm wind. All three initial errors exceed their limits, so waiting cannot satisfy the challenge.

- Tap W/S and A/D or use the touch cyclic to translate. Releasing levels the rotor; a small opposite input brakes drift.
- Shift/Ctrl or the phone's +/− buttons raise/lower collective. Near 58% holds height; short taps avoid large vertical excursions.
- Q/E or the phone's yaw buttons turn the nose toward north.

The corner card shows horizontal position error in metres, signed height error in metres, shortest signed heading error in degrees, and continuous hold progress. Each reading becomes chartreuse inside its limit. The cue names a correction in the current aircraft frame. Desktop also shows target MSL altitude, best hold and timer resets. Retry and Free flight stay in the card on every screen size.

## Scoring and lifecycle

All three conditions must hold simultaneously for **ten continuous simulation seconds**:

| Measurement | Inclusive limit |
| --- | --- |
| Horizontal distance from target | ≤4 m radius |
| Height from target centre | ±2 m |
| Shortest heading error from north | ±8° |

The first observation inside earns no time; only subsequent observed intervals with both endpoints inside count. Any excursion resets the entire hold timer, retains the best continuous hold, and increments the reset count once. Heading wraps through north. A tiny numeric epsilon prevents a mathematically exact boundary failing from trig roundoff. The live display floors tenths so it never announces 10.0 seconds before success.

The scorer uses increasing flight time, bounded by the supplied physics slice and the controller's 250 ms safety cap. Duplicate observations and invalid/zero dt do not score. Pause, dialogs and hidden tabs already suspend the shared simulation loop and release held controls, so they freeze the challenge and borrowed wind without wall-clock catch-up.

Hover hold / assist **fails** the attempt. `Activities.beforeStep` checks before physics can disengage assist through manual input, and both UI assist controls check immediately even while paused or in Settings. A real crash or any ground contact also ends it with a reason. Success/failure freezes the flight and preserves measured results: best continuous hold, attempt time, final position/height/heading errors and number of excursions. No failure is presented as a completed hold.

R, the flight-card Retry and result Retry repeat the same manual start. Free flight starts fresh; changing aircraft, runway/final/free-flight starts and other exercises end the attempt. An external controller reset (including at flight time zero or after a result) is detected through the existing shared reset watcher and cancels safely.

`Activities` permits one exercise. Hover uses `ActivityWind`, the same lease as crosswind practice and stall recovery: first start saves the pilot's normalized wind choice, Retry keeps it, a Weather choice during the attempt replaces the saved choice, and results retain the lease until exit. Every exit restores once, before another activity can borrow its own wind. The selected airport/destination is untouched.

## Measurements and verification

Run `node scripts/measure-hover.js`; add `--import ./tests/init-wasm.js` after `node` for WASM. Raw [JavaScript measurements](hover-challenge/measurements.jsonl) and [WASM measurements](hover-challenge/measurements-wasm.jsonl) are checked in.

The test-only pilot uses real `FlightInputs` and `FlightController` over the current terrain. It makes no pose, velocity, collective, attitude or assist writes after start. Analogue cyclic/yaw/power commands and 100 ms binary key taps both complete at 30, 60 and 144 fps in **15.68–15.77 s**, including the ten-second hold. Final horizontal errors are 0.23–0.26 m, height errors under 0.06 m and heading errors under 0.7°. Minimum terrain clearance is 18 m. The 4 m / 2 m / 8° limits leave room for ordinary corrections. These frame rates describe deterministic input sampling, not software-rendered browser performance.

`tests/hover-challenge.test.js` separates normal-input flights from explicit synthetic scoring boundaries. It covers all three individual excursions and discontinuous holds, inclusive limits, north wrapping, exact ten-second timing, hands-off refusal, zero/duplicate/invalid updates, assist before physics, real collective-descent crash, ground contact, immutable results, repeatable retries, all activity transitions, custom wind, changed Weather choice, exact-once cleanup and external reset/aircraft changes before progress and after results. Target visibility and resource disposal are checked too.

Browser captures: [1600×900](hover-challenge/active-1600.png), [1280×800](hover-challenge/active-1280.png), [390×844](hover-challenge/active-390.png), [phone brief](hover-challenge/brief-390.png). The phone card ends at y≈304, above cyclic y≈519, yaw y≈546 and collective y≈516; instruments start at y≈638. The brief scrolls with its Close control retained and its Start button reachable. Browser checks verify the explicit switch, pause/dialog freezing, Settings assist failure, result Retry and the phone Explore route. Captures use Performance graphics.

A browser keyboard pilot also completed using the app's real keydown/keyup handlers and WASM backend: **17.181 s** total, ten continuous hold seconds, final position error **1.008 m**, signed height error **−0.029 m**, heading error **0.626°**, no excursions, assist off and no crash. This used feedback-driven ordinary key presses, with no state writes. [Laptop result](hover-challenge/result-1280.png) and [phone result](hover-challenge/result-390.png) show the actual frozen measurements.

The repeatable `scripts/check-hover.browser.js` runs through the browser MCP's `browser_run_code_unsafe` filename argument against port 5173. Its **16 checks pass**, including all three UI assist entry points, R, pause/dialog/controlled hidden-tab suspension, normal keyboard completion, activity replacement and wind restoration; [raw result](hover-challenge/browser-check.json). This accelerated lifecycle probe controls the frame clock and skips repeated GPU draw calls after the initial frame, while keeping the app's DOM, handlers and physics. The viewport screenshots and 17.181 s live completion above use normal rendering independently.

Final validation: **`npm test` — 802 passed, 0 failed**; **92 relevant WASM tests passed** (`hover-challenge`, `helicopter`, `transport`, `crosswind-practice`, `stall-recovery`, `ranked-runs`); `npm run build` passed; `git diff --check` clean.

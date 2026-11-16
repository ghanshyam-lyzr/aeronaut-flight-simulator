# Mira T2 stall recovery

One repeatable scored exercise for the **Mira T2**, reached from Explore or the desktop flight card. On phones use **Menu → Explore → Stall recovery · Mira T2**. Other aircraft get a named refusal and an explicit switch button. Refusing a start changes neither the aircraft nor another running activity.

This is an accessible exercise in Aeronaut's arcade controller, not certified training, aircraft performance data or an assessment of real-world technique. It reads the existing controller state; no flight dynamics, trim behavior, response settings, stall thresholds or assist behavior were changed. The shared bank-dependent stall contract in [banked-stall.md](banked-stall.md) remains authoritative.

## Setup and scoring

The trainer starts over Lake Azure at x=0, z=4000, heading north, wings level, nose on the horizon, 42 m/s (82 kt), 54% power, fixed gear, flaps retracted and neutral trim. Altitude is at least 1,800 m MSL and at least 900 m above terrain. This location is about 1,790 m above the lake in the current terrain. Each retry resets the controls, trim, heading selector, contact feedback and flight clock, with manual control and calm wind.

1. Slow at idle with level wings until **`state.stalled` is true**. The trainer reaches it near 25 m/s (49 kt). The speed tape's caution state or crossing an exercise speed target cannot stand in for the controller flag. Entry must have power ≤20% and bank ≤10°.
2. Observe a nose attitude at least 4° lower than the first stalled attitude, below the horizon, and power ≥80%. The live cue asks for gentle nose-down control and added power. Those observations do not identify elevator force or claim that a particular action caused the nose drop: the controller also drops its nose during a stall.
3. Regain at least 35 m/s (68 kt), with the shared effective stall speed's 30% margin if that is greater. Then hold **3 continuous flight seconds** at 35–55 m/s (68–107 kt), pitch within ±3°, bank within ±5°, vertical speed within ±2 m/s (about ±400 ft/min), power ≥80%, and no stall. Breaking any condition resets stable time. The cue asks the pilot to ease toward 80% if too fast.

The two useful measurements are time from the **first actual controller stall** through the stable hold, and the maximum drop below the altitude at that stall. The lowest altitude is retained, so climbing back does not erase height lost. Results also show final airspeed and the first observed stalled airspeed. No attempt without a stall reports a stall-to-recovery time or post-stall height loss.

A crash or ground contact, terrain clearance below 150 m, more than 250 m (820 ft) lost below the **start** altitude, no stall within 60 seconds, or no stable recovery within 45 seconds of the first stall fails the attempt with a reason. Changing flaps fails this clean-configuration exercise. Engaging assist fails the manual attempt; `Activities.beforeStep` checks it before physics can disengage it again during a stalled step. Merely waiting, idle descent, high airspeed while diving, an unstable attitude, and adding power without the other observed conditions cannot complete it.

R and both Retry buttons repeat this exercise, including after failure or success. Free flight ends it and starts a fresh assisted flight. Changing aircraft, using a runway/final/free-flight start or starting any other scored activity also ends it. A result freezes flight/scoring, removes warnings and clears transient contact sound/motion. Pause, open dialogs and hidden-tab time do not advance physics, wind, stable time or the result clock. Visibility transitions release held inputs and reset the input clock to prevent replay on return.

## One wind owner

`src/activity-wind.js` is the shared wind lease for **both** crosswind practice and stall recovery. `Activities` enforces exclusivity and ends the old lease **before** the next exercise takes the wind. First start snapshots the pilot's normalized configuration; retries reapply the exercise wind without replacing the snapshot. Weather choices during an exercise replace the saved pilot choice, while its fixed wind continues. Runway advice uses that saved choice. Success/failure keeps the lease until an exit; `release()` restores the saved configuration exactly once. Gust timing resets with the flight as it did for crosswind practice; this restores the selected configuration, not an earlier gust phase or blend progress.

Both leases watch aircraft, monotonic flight time and distance, and the existing `bodyRates` record that `FlightController.reset()` replaces. The record identity detects an external reset even at time zero before time/distance have advanced; it also works after a result. This consumes existing reset state without adding a controller hook. All activity switches, retry, cancel, external reset and aircraft changes exercise this one restoration mechanism, rather than separate wind rules in the UI.

## Measured targets and validation

Run `node scripts/measure-stall-recovery.js`. Its pilot uses **ordinary rate inputs through `FlightInputs`** and the current `FlightController` over the real terrain, with no pose, speed or rate writes after the exercise start. It idles level, lowers the nose toward −7° while adding power, then levels as speed passes 68 kt. Raw output is [measurements.jsonl](stall-recovery/measurements.jsonl).

At 30 / 60 / 144 fps respectively, stall entry is at 4.508 / 4.508 / 4.507 flight seconds and about 48.6 kt. Recovery including the three-second stable hold takes **9.13 / 9.13 / 9.12 s**, losing **28.57 / 28.47 / 28.39 m** (about 94 / 93 / 93 ft). Final speed is about 101 kt with nearly level attitude and a small remaining descent; minimum terrain clearance exceeds 1,750 m. These are attainable deterministic gameplay measurements, not a requirement to match a particular time. The wider limits leave room for beginner corrections.

`tests/stall-recovery.test.js` separates real input-pilot behavior from pure scoring-boundary observations. It covers a real induced stall and successful recovery at all three rates, refusing false successes, discontinuous stability, assist use, idle/no-power and diving height-loss failures, unstable/time failures, an actual terrain collision, repeatability, configuration/clearance boundaries, all activity switches, custom wind, Weather updates, exact-once restoration and external resets before progress and after a result. The pre-existing crosswind, banked-stall and heading-select tests remain in the full suite.

Review captures: [1600×900](stall-recovery/active-1600.png), [1280×800](stall-recovery/active-1280.png), [390×844](stall-recovery/active-390.png). The phone card ends at y≈291, well above the yoke at y≈519; warnings retain their separate lower slot. The brief scrolls in the existing dialog and results reuse the quiet mission result surface.

Browser checks also completed an actual touch-yoke / normal-throttle attempt in 9.4 s with 30.6 m (100 ft) lost. Pause, dialog and controlled hidden-tab probes each kept the flight clock unchanged. Switching crosswind → recovery → crosswind retained the original pilot wind, a Weather change made during recovery survived R / Retry, and aircraft change returned to free flight with that wind. The [phone brief](stall-recovery/brief-390.png) starts at its heading with a sticky Close control. Captures use Performance graphics; the 30/60/144 fps measurements above are deterministic input/controller checks, not a claim about browser rendering speed.

Final validation: `npm test` — **693 passed, 0 failed**; `npm run build` — passed; `git diff --check` — clean.

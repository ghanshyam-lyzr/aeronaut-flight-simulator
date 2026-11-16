# Bank-dependent stall margin

Conventional fixed-wing aircraft now lose stall margin as bank increases in the model's upright coordinated turns. The existing stall warning, nose drop, low-speed sink and airspeed tape share the same effective threshold. This is arcade gameplay tuning, not certified aircraft performance.

## Approximation and limits

`src/stall.js` is the pure shared calculation, in m/s:

```
levelStall = type.flight.stallSpeed - flaps * type.flight.flapStallGain
turnDemand = 1 / max(0.5, cos(bank))
effectiveStall = levelStall * sqrt(turnDemand)
```

The square-root relationship and a 2 g demand at 60° come from coordinated, constant-altitude turn mechanics ([FAA Pilot's Handbook of Aeronautical Knowledge, chapter 5, pages 5-34–5-35](https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/phak/07_phak_ch5.pdf)). The simulator deliberately caps demand at **2**, so stall speed rises at most **41.4%**, including the racer's steeper allowed banks. At 30° the rise is 7.5%; at 45° it is 18.9%. There is no near-90° division by zero.

This is a bank-based demand proxy for conventional aircraft whose existing controller coordinates the turn and limits their attitude. It assumes the wing is carrying the turn load even though the arcade controller permits climbs, descents and a small turn sink. It does not calculate angle of attack, actual lift, slip/skid, weight, or instantaneous elevator unloading. Rolling toward level reduces demand immediately; easing the nose down helps through the existing speed model. Pull-up stalls in wings-level flight are outside this change.

Ground rolls, rotation checks and rotorcraft use their existing behavior. Every free-attitude type (Silex A3, Arolla F7, Taris F12) retains its existing flap-only threshold at **all** attitudes, including upright turns. A supplied conventional pose at or beyond knife-edge also gets no turn multiplier; normal conventional flight never reaches that guard because its bank limits are below 90°. The helper is not a formula for inverted flight.

`state.gForce` remains measured, signed and unclamped telemetry. It neither drives the helper nor receives its cap. The controller uses `effectiveStall` for both strict stall entry (`speed < effectiveStall`) and the existing sink/nose-drop severity. Assist still disengages on a stall. No new latch or load state needs resetting.

## Instrument contract

`stallSpeed(type, flaps = 0, state = {})` and `airspeedEnvelope(type, flaps = 0, state = {})` preserve their wings-level defaults when flight state is omitted. `stallSpeed` remains re-exported from `airspeed-envelope.js` for existing callers.

The controller, monitor and existing tape pass the current state. The tape's band cache now keys on the effective stall speed, so banking alone moves its coral stall band and 20% low margin. The monitor retains its 3 kt exit hysteresis. Caution, overspeed, tape scale, upper-limit hysteresis, warning priority and layout are unchanged. Grounded/inactive/crashed monitor suppression stays intact.

## Independent before/after measurement

Run `node scripts/measure-banked-stall.js` for every conventional type and available flap stage, or supply type IDs. The script does **not** import the new threshold helper. It records actual controller stall transitions through ordinary ramped `FlightInputs`, reading the original aircraft data for its wings-level reference.

The initial setup is stable airborne slow flight at 6,000 m over flat terrain, calm wind, 1.12 × flap-adjusted level stall speed and matching power. After setup there are no pose, speed or rate writes: a feedback pilot uses pitch, roll and throttle inputs only. It holds level wings for 35 s, banks toward the lesser of 95% of the type's limit and 60° for 10 s, then rolls level for 15 s while keeping the same speed target. The pitch input opposes the stall's nose drop, deliberately sustaining the slow turn until rollout. This is a deterministic example, not recommended real-world stall technique.

The **same script** was copied into a clean archive of main at `f43a927` and run before/after for trainer, jet, airliner, widebody, motorglider and racer, with all three flap stages: 18 runs per version. Raw observations are in [before.jsonl](banked-stall/before.jsonl) and [after.jsonl](banked-stall/after.jsonl). Every before run remained above the old threshold and never stalled. Every after run stalled above its wings-level threshold, then recovered without crashing. Clean-flap examples (speeds in m/s, banks in degrees):

| Type | Level stall | After: first stall speed / bank | After: first recovery speed / bank | Maximum bank |
| --- | ---: | ---: | ---: | ---: |
| Mira T2 trainer | 25 | 27.70 / 35.6° | 28.03 / 37.3° | 56.4° |
| Vela J8 jet | 42 | 46.78 / 36.6° | 47.17 / 37.4° | 59.1° |
| Boeing 737-800 | 66 | 73.46 / 36.2° | 74.15 / 37.5° | 46.8° |
| Aven W280 | 70 | 77.79 / 36.1° | 78.76 / 37.8° | 43.1° |
| Varen G18 | 19 | 21.02 / 35.2° | 24.00 / 51.2° | 51.3° |
| Rava R6 | 38 | 42.26 / 36.8° | 42.61 / 37.3° | 58.5° |

The trainer, jet, airliner, widebody and racer clear during rollout, 0.69–1.08 s after the 45 s roll-level command, while still below the stall threshold for their former maximum bank. Their speed target does not increase. The motorglider's nose drop can instead accelerate it enough to recover **before** rollout (38.98 s clean); its first-recovery row reports that actual transition, not an assumed rollout recovery. Sink takes time to settle after stall clearance: the existing sink lag and aircraft inertia remain visible.

A manual example is the Mira T2 in calm air at a safe altitude: fly clean at roughly 54 kt (28 m/s), bank gently into a steep turn, and watch the low-speed bands move up toward the marker. The stall now appears around 36° as speed remains above its 49 kt wings-level threshold. Roll toward level and allow airspeed to recover; the scripted example clears near 54.5 kt / 37° while rolling out. Larger aircraft retain their lower bank limits and show the same margin effect sooner than the cap.

## Verification

`tests/banked-stall.test.js` checks all 15 conventional types / 41 available flap configurations, both turn directions, the 2 g bound, unchanged level thresholds, free-attitude/rotorcraft exclusions, controller entry and nose drop/sink, actual normal-input stalls and recovery, changing tape bands and monitor hysteresis, reset/start paths, and 20/30/60/120/144 FPS feedback/event cadences. Short event slices and the existing >6 g telemetry case stay independent of turn demand.

All 18 fixed-wing types also finish crosswind practice through the existing normal-input pilot. The motorglider needs 0.5 s of nose-up trim for a little more float: without that adjustment this pilot touches down at 59.33 m on both main and this branch, 0.67 m before the scoring zone. Scoring and flight profiles are untouched. The existing all-fleet landing, checkpoint-course and heading-select tests remain part of `npm test`.

Browser check: Vite on `0.0.0.0:5173`, Low quality, headless Chromium software WebGL. At 1600×900, 1280×800 and 390×844 the existing tape and warning fit, with no horizontal overflow or console errors. The Vela J8's stall band grew from 27.21% wings level to 37.13% at the sampled 57.5° bank; the label changed to Low speed and the controller reported stalled at 55 m/s. Rolling level restored the 27.21% band, Airspeed label and cleared stall at the same speed. For repeatable layout inspection, the browser's animation loop was held and stepped manually with a test pose; real maneuver evidence comes from the Node input runs above. Screenshots live in `/tmp/forge-browser/banked-stall-{1600,1280,390}.png` in this session.

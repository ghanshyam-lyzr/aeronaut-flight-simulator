# Aircraft handling

Applies to all 21 aircraft, including the Rava R6, Cervin P6, Lodra H20 and Taris F12. Baseline: `849df03` (fleet variety merged). This is arcade flight-model tuning, not certified aircraft performance.

## What changed

- Elevator, aileron and rudder rates brake four times faster when the commanded rate is reduced or reversed. Their original maximum rates and acceleration responses remain. Rudder onset now uses each fixed-wing type's pitch response instead of one fleet-wide constant.
- Each angular step integrates the exponential response, including the exact instant a reversed rate crosses zero. The opposite rotation then accelerates normally. This prevents a long update slice from receiving excess reversal authority.
- Non-aerobatic stability fades continuously between 5% and 10% stick instead of switching abruptly at 5%. Aerobatic aircraft still use unrestricted, normalized body-axis quaternions and hold manual vertical/inverted attitudes.
- Helicopter disc stability blends continuously with cyclic deflection. A small held cyclic now settles to a modest tilt; full cyclic keeps each helicopter's existing rate and tilt authority. Release levels the disc while translation retains momentum.
- Hover assist hands attitude control through the same rate integrator. Collective moves continuously from its current value, at at most twice the type's manual lever slew. A lead term accounts for each rotor's collective-response lag. Manual takeover keeps the current lever, attitude and rotor state.

The timestamped `FlightInputs` ramp, saved 50–200% axis preferences, bindings, inversion and mouse/touch mapping are unchanged. Manual throttle/collective already stopped precisely on release, so its slew and the engine/rotor inertia remain unchanged. No altitude capture was added to manual flight. Gear, flaps, stalls, touchdown/crash limits and landing-mission evaluation are unchanged.

## Reproducible measurements

Run `node scripts/measure-handling.js` for this checkout. Pass a baseline checkout directory as the first argument to run the identical scenarios against its `src` modules, with its dependencies installed/linked. Measurements below compare `849df03` with this change at 120 physics steps/s over flat terrain at 78 m.

A 100 ms positive tap at 100% response starts from each type's airborne cruise/hover. Attitude corrections are read at 1.6 s. The yaw column is the percentage of the release rate still present 200 ms later; throttle is percentage points of lever travel. Arrows show before → after.

| Aircraft | Pitch correction, ° | Roll correction, ° | Remaining yaw rate, % | Throttle/collective change, pp (unchanged) |
| --- | --- | --- | --- | --- |
| Mira T2 trainer | 0.100 → 0.033 | 0.219 → 0.074 | 57.121 → 4.784 | 0.457 |
| Aven W280 widebody | 0.061 → 0.019 | 0.142 → 0.043 | 57.121 → 13.534 | 0.214 |
| Rava R6 racer | 0.182 → 0.067 | 0.541 → 0.204 | 57.121 → 1.330 | 0.571 |
| Cervin P6 push-pull | 0.095 → 0.031 | 0.205 → 0.067 | 57.121 → 6.588 | 0.400 |
| Arolla F7 fighter | 0.353 → 0.141 | 1.410 → 0.587 | 57.121 → 0.370 | 0.500 |
| Taris F12 interceptor | 0.317 → 0.122 | 1.190 → 0.479 | 57.121 → 0.701 | 0.457 |
| Lodra H20 tandem | 0.035 → 0.010 | 0.038 → 0.011 | 59.452 → 12.493 | 0.243 |

The fighter's residual pitch rate after 200 ms falls from 24.660% to 0.370%; its resulting vertical-speed change at 1.6 s falls from 1.051 to 0.419 m/s. The flight-path model still responds to the resulting attitude rather than capturing the original altitude.

Across the entire fleet, 50/100/150 ms taps and 50/100/200% response settings, the largest pitch correction falls from 1.884° to 0.838°, roll from 7.537° to 3.522°, and yaw from 1.289° to 0.558°. The largest lever change remains 2.700 percentage points. These maxima include the aerobatic prop at 200% response; high saved response still makes larger corrections.

After holding an axis for 1.6 s, reverse it through `FlightInputs`. At normal response, the old fighter pitch rotation stops in 92 ms instead of 242 ms; interceptor roll in 92 ms instead of 242 ms; racer yaw in 108 ms instead of 442 ms; push-pull yaw in 150 ms instead of 442 ms. The slowest reversal over every aircraft, angular axis and low/normal/high setting is the widebody elevator at 50%: 575 → 225 ms. Times are sampled at 120 Hz.

## Hover assist and tradeoffs

Engage assist after eight seconds with collective 14 percentage points above hover. The original controller moved collective down 30.598 percentage points in its first 1/120 s step. It now moves 0.367 pp on the H4, 0.300 pp on the H8 and 0.283 pp on the H20. The descent case's original +21.856 pp jump is bounded by the same limits.

Continuous handover deliberately retains inertia: peak vertical capture overshoot in that climb is H4 1.940 → 2.811 m, H8 2.219 → 3.195 m and H20 2.135 → 3.109 m. Full-forward translation capture also needs slightly more braking distance: 99.370 → 103.330 m, 64.911 → 67.024 m and 47.106 → 48.429 m respectively. Assist returns to the captured point; it does not instantly stop the aircraft.

All three helicopters settle below 1 cm position error in the final ten seconds of each 65 s climb/descent/translation capture check, without a continuing hover oscillation. Tests also exercise small held cyclic, leveling on release, pedals, collective reversal, and manual takeover.

## Validation

- `npm test`: **489 passed**, including 92 new handling cases. Fleet-wide invariants cover both signs of 50–150 ms taps, low/normal/high response, full angular authority, complete lever travel, release, reversal, combined small analogue inputs, and render cadences of 10/15/30/60/120 Hz plus irregular intervals. Attitude differences stay below 0.0001 rad and position differences below 1 cm against 120 Hz in the combined-input cases.
- All fixed-wing types retain approach descent after one short pitch tap, can arrest descent with a deliberate flare, and can fly a powered go-around. Trainers, bush and utility takeoff pilots now continue to a modest climb attitude after rotation instead of relying on the old residual elevator pull; their existing takeoff-distance, climb-height, stall and crash assertions remain. The historical J8 trajectory snapshot became a switched-versus-fresh handling equivalence check.
- Existing stall/recovery, runway starts, gear/flaps, touchdown, landing-mission, engine spool/afterburner, cancellation and settings checks pass. Fighter, interceptor and aerobatic-prop cases retain repeated inside/outside loops, rolls, vertical/inverted manual flight and quaternion continuity through the existing and new suites.
- `npm run build`: **passed**. Vite reports its large-chunk advisory (approximately 940 kB JS); no dependency was added.
- Chromium rendered the app at **1600×900**, **1280×800** and **390×844** on the existing `forge serve` preview at port **5173**. No JavaScript console errors. The smaller sizes have no horizontal document overflow.
- Bounded browser scenarios used real DOM keyboard events through the app's input pipeline: a 100 ms R6 approach correction remained descending and flyable; the F7 completed a pitch loop through inverted flight, and the F12 completed a roll with working afterburners. The H20 received separate 100 ms cyclic, pedal and collective taps: after 2 s, displacement was 7 mm horizontally and 10 mm vertically, heading changed 0.044°, and it remained upright. Re-enabling hover assist reduced speed to 0.00334 m/s after another 3 s, with about 12 mm altitude error relative to the captured point.

Browser limitation: software WebGL rendering here can take longer than the simulator's 250 ms safety cap, which intentionally discards expired inputs after a long absence. For repeatable browser scenarios, `performance.now()` and DOM event timestamps were controlled to advance 250 ms per rendered frame, then restored. This exercises the actual rendered app and fixed-step input integration but is not a hardware-FPS measurement or a subjective flight test on a normal GPU. Deterministic Node checks supply the broader cadence and flight-family coverage.

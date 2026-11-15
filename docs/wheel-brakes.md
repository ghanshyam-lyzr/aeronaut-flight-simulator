# Wheel brakes

Fixed-wing aircraft now have pilot wheel brakes for the landing rollout and for taxiing: **hold B**, or hold the **Brake** button on a phone. This is arcade tuning, not certified stopping performance.

## Behaviour

- **Grounded only.** Brakes act in `FlightController.stepGround` only. In the air, brake input changes nothing: no speed-brake effect, no change to attitude or sink. The state's `brake` field reads 0 off the ground.
- **Bounded, continuous, never reversing.** Full brakes add a constant deceleration (`BRAKE_DECELERATION`, 2.0–3.4 m/s²) on top of the existing rolling resistance. Speed is clamped at 0, so the aircraft stops and stays stopped while the brakes are held. It never rolls backwards.
- **Eased on, released at once.** `brake` is a fifth, one-sided (0–1) axis in the timestamped `FlightInputs` pipeline. Held brakes reach full pressure in 800 ms, so a 100 ms tap of B removes only a few cm/s. Release is immediate. Negative or invalid values count as no brake. The ramp does not follow the four saved axis-response settings (pitch, roll, rudder, throttle), which are unchanged.
- **No stuck brake.** Key-up, pointer-up, pointer-cancel and lost pointer capture release the brake. So do window blur, a hidden tab, pause, any dialog, restart, a mission start or result, and switching aircraft. All of these go through `clearControls`, which also clears the displayed brake state.
- **Power still matters.** Brakes hold an aircraft against taxi power (spool 0.3): a rolling jet, trainer, widebody or freighter comes to rest. They do not hold full takeoff power. A run-up with brakes held creeps under 15 m while the engines spool, then releasing the brakes gives a normal takeoff.
- **Heavier vs lighter.** Light singles with good brakes stop hardest (Brenta B6 3.4, Mira T2 / Veyra U9 / Vela J8 3.0 m/s²). The tailwheel Alba B2 (2.2) and the single-main-wheel Varen G18 (2.0) brake gently. So do the heavy jets and the freighter (737 2.4, Aven W280 2.1, Montis C90 2.0), which also land faster and need far more runway. A type can override its value with `flight.brakeDeceleration`.
- **Helicopters.** This model freezes helicopter ground translation, so there is nothing to brake. `brakeDeceleration` is 0 for rotorcraft, brake input is ignored, the phone button is hidden, and no help text mentions it. The helicopter is unchanged.
- **UI.** The Controls dialog lists "Wheel brakes · hold on the ground (B)" for fixed-wing types, and its phone note mentions the Brake button. The desktop key hints add `B Brakes`. The landing brief and the rollout cue say to hold B to slow below 6 kt. While the brakes are applied on the ground, the flight notice reads "Wheel brakes on · release to roll". The phone button sits where the helicopter-only yaw buttons go, which are never shown at the same time. It turns chartreuse with `aria-pressed="true"` while held.

The model is unchanged when the brakes are not used: with brake 0, the ground step is exactly the original code path. A test checks every fixed-wing takeoff state for deep equality with and without `brake: 0`. Collision, touchdown, landing-mission and airfield-suitability thresholds are unchanged.

## Measured stopping distances

`node scripts/measure-brakes.js` reproduces these. All runs use 120 Hz input slices through `FlightInputs`, on flat ground at idle (spool 0). They start at 85% of each type's approach speed. A run counts as stopped below 0.5 m/s, because unbraked rolling resistance only approaches zero.

| Aircraft | Brake m/s² | Start kt | Free roll m | Braked m | Shorter | Free s | Braked s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Brenta B6 | 3.4 | 45 | 64 | 34 | 46% | 10.9 | 3.4 |
| Mira T2 | 3.0 | 55 | 79 | 47 | 40% | 11.5 | 4.1 |
| Varen G18 | 2.0 | 41 | 59 | 37 | 38% | 10.7 | 4.3 |
| Alba B2 | 2.2 | 45 | 64 | 40 | 38% | 10.9 | 4.3 |
| Veyra U9 | 3.0 | 61 | 88 | 55 | 38% | 11.8 | 4.3 |
| Cervin P6 | 2.9 | 63 | 91 | 57 | 37% | 11.9 | 4.5 |
| Neris P2 | 2.6 | 66 | 96 | 63 | 34% | 12.1 | 4.8 |
| Silex A3 | 2.8 | 74 | 108 | 72 | 34% | 12.4 | 4.9 |
| Rava R6 | 2.6 | 76 | 110 | 75 | 32% | 12.5 | 5.1 |
| Montis C90 | 2.0 | 83 | 120 | 88 | 26% | 12.7 | 5.9 |
| Valnera Q100 | 2.6 | 84 | 122 | 85 | 30% | 12.7 | 5.4 |
| Sarine C24 | 2.8 | 88 | 127 | 88 | 31% | 12.9 | 5.3 |
| Vela J8 | 3.0 | 93 | 134 | 93 | 31% | 13.0 | 5.3 |
| Orsino R70 | 2.6 | 109 | 159 | 117 | 26% | 13.5 | 6.0 |
| Arolla F7 | 2.7 | 116 | 168 | 125 | 26% | 13.7 | 6.1 |
| Boeing 737-800 | 2.4 | 119 | 173 | 132 | 24% | 13.7 | 6.4 |
| Taris F12 | 2.4 | 119 | 173 | 132 | 24% | 13.7 | 6.4 |
| Aven W280 | 2.1 | 127 | 185 | 146 | 21% | 13.9 | 6.9 |

The existing idle rolling resistance is strong at speed (an exponential 0.35 s⁻¹ decay), so brakes save the most at low speed. That is where the unbraked aircraft used to dribble for seconds. For the same reason the percentage saving is smaller for fast types.

Scored landing missions use the landing tests' feedback pilot. It flies the 1.1 km final and pulls to idle on touchdown; the braked runs also hold B from touchdown. The rollout is measured from touchdown to mission success. Every run succeeds, and touchdown sink, zone and alignment are scored by the unchanged rules.

| Aircraft | Runway | Free rollout m | Braked rollout m | Mission time free → braked, s |
| --- | --- | --- | --- | --- |
| Mira T2 | QAAF 36 and 18 | 112 | 75 | 51.1 → 47.8 |
| Vela J8 | QAAF 36 and 18 | 246 | 186 | 37.5 → 33.8 |
| Alba B2 | QAVM 35 and 17 | 79 | 54 | 58.0 → 55.4 |
| Boeing 737-800 | QAOR 14 and 32 | 376 | 309 | 33.9 → 30.5 |
| Aven W280 | QAOR 14 and 32 | 410 | 347 | 33.0 → 29.8 |

Both runway directions give identical results. Their graded surfaces are flat, and the model is direction-independent.

## Validation

- `tests/brakes.test.js` (9 tests, added to `npm test`) covers:
  - per-type bounds and the heavy/light order;
  - shorter stopping distance and time for every fixed-wing type;
  - bounded per-step deceleration, a full stop and no reversal at 10/30/60/120 Hz;
  - holding against taxi power;
  - the gradual onset, where a tap is within 1% of the exact ramp impulse;
  - immediate release with no residual drag, and reset/cancellation;
  - one-sided input;
  - aircraft switching;
  - no airborne effect for all 21 types, and no helicopter effect;
  - response settings untouched;
  - unchanged unbraked takeoffs for every fixed-wing type, and a normal takeoff after a braked run-up;
  - the scored landings above.
- `npm test`: 522 passed after merging `origin/main` at `55bf553` (flight-log recovery #34 and flight-path marker #35), including their suites and the 9 brake tests. `npm run build`: passed, with Vite's existing large-chunk advisory. No dependency was added.
- Browser checks ran in Chromium on the `forge serve` dev preview (port 5173), with no console errors:
  - **Keyboard (390×844):** a Mira T2 ran to 10 m/s under Shift. Ctrl alone stopped it in 86 m and 12.8 s. Ctrl plus held B stopped it in 44 m and 5.3 s, at exactly 0 m/s. The notice showed while braking and cleared on key-up.
  - **Touch button (390×844):** the Brake button applied the brake, and pointer-up, pointer-cancel, a dialog opening, window blur and pause each released it. Switching to the Laret H4 hid the button and left the brake at 0. Phone layout had no horizontal overflow.
  - **Desktop:** holding B on a Vela J8 at **1600×900** and **1280×800** applied the brake and showed the notice, and releasing B cleared it. The key hints include `B Brakes` and fit both widths. The Controls dialog lists the brake for fixed-wing types, and the helicopter hints omit it.

- **After the merge (1280×800):** a Mira T2 under Ctrl plus held B stopped from 7 m/s in 32 m, to exactly 0, with the brake notice. Releasing B cleared the notice. The Settings flight-path toggle switched the marker on: absent while stationary on the runway, as designed, and shown once airborne. The Flight log dialog opened. No brake stayed applied after the dialogs.

Browser limitation: this VM renders with software WebGL. Each frame took about 1 s at 390×844 and about 2.8 s at 1600×900, longer than the simulator's 250 ms safety cap, which discards input after a long absence. For repeatable scenarios, `performance.now()` and DOM event `timeStamp` were set to a controlled clock that advanced 250 ms per rendered frame. The pointer events were Playwright mouse pointers on the button, not real multi-touch hardware. These checks exercise the real rendered app, DOM handlers and fixed-step input integration. They are not hardware frame rates or a subjective flight test on a normal GPU or phone.

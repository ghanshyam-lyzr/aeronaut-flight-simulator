# Pitch trim

Conventional fixed-wing aircraft now have pilot pitch trim. Use it to set up a steady climb, descent or cruise without tapping pitch over and over. **Hold `]`** to trim nose up and **hold `[`** to trim nose down. **`T`** returns the trim to neutral. On a phone, hold the **▲ / ▼** trim arrows next to Power, and tap the value between them for neutral. This is arcade tuning, not a model of real elevator trim forces.

## How it works

The arcade model treats the stick as a pitch-rate command. With the stick released, a conventional aircraft slowly self-levels: its pitch relaxes towards level at 0.045 s⁻¹ (a glider relaxes towards its idle glide attitude instead). That is why holding a climb used to need repeated presses.

Trim moves that **stick-free attitude**. It is not a rotation command.

- **Bounded.** `state.pitchTrim` is an attitude in radians, limited to ±8° (`TRIM_LIMIT`). While held, it moves at a fixed 2°/s (`TRIM_RATE`). A 100 ms tap is a 0.2° step, and the full range takes 4 s. The type's own pitch limits still clamp the result.
- **Stable when released.** Releasing the key or button stops the wheel at once (the `trim` axis in `FlightInputs` has no ease-in or ease-out). The trim keeps that value. The stick-free nose then settles on the trimmed attitude and stays there. Nothing keeps rotating: after a 90 s settle, another minute hands-off moves the nose by less than 0.01° (tested for six conventional types).
- **The nose follows the wheel, never past it.** While the trim wheel turns and the stick is released, the nose moves with it towards the new trimmed attitude. It stops at that attitude and never overshoots. So trim alone can set up a climb from level flight in a couple of seconds. If the nose is already beyond the new trim, it does not follow. The existing slow stick-free return then brings it back.
- **Neutral is unchanged.** At 0 the stick-free target is exactly the old one, on the same code path. Scripted flights (assist then manual manoeuvres, and full-power runway takeoffs) were run for all 21 types through `main`'s `flight.js` / `controls.js` and through this branch's. They matched bit for bit: 832,062 compared values, maximum difference 0. A test also checks every type's states for deep equality with no trim input and with `trim: 0`.
- **Ground rotation is untouched.** On the runway the trim wheel still turns, so you can set trim before takeoff. It does not affect the roll, the nose-wheel attitude or rotation, and it applies from the moment the wheels leave the ground.
- **Flight assist stays in charge.** With assist on, trim input changes the stored trim but not the flight path: assist flies exactly as it does untrimmed, and trim input never disengages assist. When assist disengages, the nose eases from where assist left it towards the trimmed attitude at the stick-free pace. The fastest change measured was under 0.6°/s, so there is no attitude jump. Neutral trim (`T`) likewise only moves the target, never the nose.
- **Independent of the response settings.** The four saved response settings (pitch, roll, rudder, throttle) do not change the trim rate. Trim is never saved and never inverted by *Invert pitch*.

### Which aircraft

- **Trimmed:** the 15 conventional fixed-wing types: Vela J8, 737-800, Mira T2, Brenta B6, Sarine C24, Orsino R70, Aven W280, Neris P2, Veyra U9, Montis C90, Varen G18, Alba B2, Valnera Q100, Rava R6 and Cervin P6.
- **Free-attitude aerobatic types (Arolla F7, Silex A3, Taris F12):** no trim. Their free body already holds any attitude hands-off, with zero corrections (measured below). A trim there would either do nothing or add a self-levelling they do not have. Their readout reads N/A and is disabled, the phone arrows are hidden, the keys are ignored, and `T` says why.
- **Helicopters:** unchanged. The trim input is ignored and the controls are hidden.

### Resets and releases

- **Reset to neutral:** restart (R), aircraft changes, runway departures, approach starts and landing-mission starts and retries. All of these go through `FlightController.reset()`.
- **Kept, with any held adjustment released:** pause, window blur, a hidden tab, any dialog, pointer up, pointer cancel and lost pointer capture. All go through `clearControls` / the pointer handlers, which stop the wheel without changing the trim value.

## Interface

- **Flight deck (desktop).** A `Trim +3.5°` readout sits beside Gear and Flaps in the throttle cell. It uses the same muted label and turns chartreuse when off neutral. Clicking it sets neutral. The sign is "+ nose up", which the button's tooltip explains. Its aria-label says the value in words ("Pitch trim 3.5 degrees nose up. Reset to neutral"). Above 1150 px the throttle cell is a little wider (`flex: 2`) so all three fit on one line at 1280 and 1600.
- **Phones.** A compact column between Brake and Power: ▲ nose up, the value in words ("2.5° down", Barlow Condensed chartreuse), ▼ nose down. Held arrows turn chartreuse. The value button sets neutral.
- **Keys.** `[` nose down, `]` nose up, `T` neutral. These were unused. They are listed in the key hints (`[ ] Trim`), the Controls dialog and the world's aria-label. Releasing a trim key shows the new value as a toast. That toast is the only readout at 551–800 px widths, where the flight deck already hides the throttle cell.

## Measured: holding a steady attitude

`node scripts/measure-trim.js` reproduces this table. The run is 90 s through `FlightInputs` at 60 Hz, starting established at the attitude. A feedback pilot corrects whenever the nose is more than 0.5° off. Each correction is one full-deflection key press held until the nose is back. The trimmed run first holds the trim key until the trim reads the attitude, which counts as one adjustment. Error and vertical speed cover the last 30 s.

| Aircraft | Scenario | Untrimmed presses | Trimmed inputs | Worst error untrimmed → trimmed | Mean VS fpm untrimmed → trimmed |
| --- | --- | --- | --- | --- | --- |
| Mira T2 | Climb +5° | 23 | 1 (trim only) | 0.51° → 0.03° | 809 → 828 |
| Mira T2 | Descent −3° | 14 | 1 | 0.50° → 0.03° | −352 → −367 |
| Mira T2 | Cruise +2° (reduced power) | 9 | 1 | 0.50° → 0.03° | 162 → 173 |
| Vela J8 | Climb +5° | 23 | 1 | 0.51° → 0.03° | 1591 → 1627 |
| Vela J8 | Descent −3° | 14 | 1 | 0.50° → 0.03° | −714 → −742 |
| Boeing 737-800 | Climb +5° | 21 | 1 | 0.51° → 0.03° | 2035 → 2073 |
| Boeing 737-800 | Descent −3° | 13 | 1 | 0.51° → 0.03° | −896 → −928 |
| Montis C90 | Climb +5° | 21 | 1 | 0.51° → 0.03° | 1614 → 1644 |
| Varen G18 | Climb +5° | 22 | 1 | 0.51° → 0.03° | 446 → 452 |
| Varen G18 | Cruise +2° (reduced power) | 9 | 1 | 0.50° → 0.16° | 128 → 128 |

Without trim the pilot needs 9–23 corrective presses in 90 s, about one every 4–10 s, and the nose saws through a 1° band. With trim it needs one adjustment of 1–2.5 s and then nothing: the nose holds within 0.03° (0.16° for the Varen G18 at the low power setting, where its glide attitude blends in). The script prints all 15 scenario rows. The Arolla F7, Silex A3 and Taris F12 need 0 presses in every scenario with no trim.

## Validation

- `tests/trim.test.js` (11 tests, added to `npm test`) covers:
  - which types have trim, the ±8° bounds for all 15 trimmed types in both directions, and full-rate clamping;
  - exact rate × held time at 10/30/60/144 Hz, with the press and release between frames, and the 0.2° tap;
  - release stability with no overshoot and no residual rotation (trainer, biplane, motorglider, jet, airliner, freighter; +5° and −3°);
  - the steady-attitude measurement above, plus 0 corrections for the free-attitude types;
  - neutral equivalence for all 21 types in the air and on the runway, and the unchanged 0.045 s⁻¹ stick-free return;
  - no effect on ground roll or rotation, with full trim either way;
  - assist authority, no disengagement and a jump-free handover;
  - every reset path (restart, aircraft change, runway start, landing/approach start);
  - control release keeping the chosen trim;
  - independence from the response settings;
  - no effect on helicopters and free-attitude types.
- `npm test`: 533 passed (522 existing plus 11 new). `npm run build`: passed, with Vite's existing large-chunk advisory. No dependency was added.
- Browser checks in Chromium on the dev preview (port 5173), with no console errors:
  - **Phone (390×844), touch:** holding ▲ on a Mira T2 for 2.75 s set +5.5°, and the nose followed to 5.5°. Both stayed there for the next 3 s. The held arrow turned chartreuse. Pointer-cancel on a held ▼ stopped the wheel at −2.5° and cleared the highlight, and the value held. Tapping the value set neutral. In the landing-mission layout the trim column sits between Brake (x 138–203) and Power (x 320–368) with no overlap. The page has no horizontal overflow, and a mission start leaves the trim neutral.
  - **Keyboard (on 390×844):**
    - With assist on in a 737, holding `]` stored +2.5° while assist kept the nose at 0° and stayed engaged. After disengaging, the nose eased 0.08° → 0.27° over 1.5 s.
    - Pause, window blur and opening Settings while holding `[` each stopped the wheel and kept the value. A key still physically down after resuming did not keep trimming.
    - `T` returned the trim to neutral with the nose staying at −1.93°: no jump.
    - Switching to the Laret H4 or the Silex A3 showed N/A, hid the phone arrows and ignored `]`. Switching aircraft reset the trim.
  - **Desktop (1600×900 and 1280×800):** the `Trim −3.5°` readout fits on the Gear/Flaps line, ending flush with the throttle slider. The key hints show `[ ] Trim` and fit both widths.

Browser limitation: this VM renders with software WebGL, at about 1 frame per second at 390×844 and a few at 1600×900. That is slower than the simulator's 250 ms safety cap, which drops time after a long absence. For repeatable scenarios, `performance.now()` and DOM event `timeStamp` were set to a controlled clock that advanced 250 ms per rendered frame. Pointers were Playwright mouse pointers on the buttons, and the pointer-cancel was a dispatched `PointerEvent`; none of this was real multi-touch hardware. These checks exercise the real rendered app, its DOM handlers and the fixed-step input integration. They are not hardware frame rates or a subjective flight test on a normal GPU or phone.

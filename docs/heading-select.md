# Heading select

Fixed-wing aircraft have a **heading bug**: a heading you choose, which flight assist turns to and holds. Open **Sel** beside the label on the heading instrument, type a heading or step it, then press **Hold heading**. This is heading selection only. There is no route following, no navigation coupling and no new autopilot modes.

## Using it

- **Choose a value.** Click or tap **Sel** on the heading instrument to open the selector above the instrument strip. Type a heading and press Enter (or leave the field), or use −10 / −1 / +1 / +10. In the field, ↑ / ↓ step 1° (with Shift, 10°) and Page Up / Page Down step 10°. **Use current** copies the heading you are flying now. Esc, the close button or a click or tap elsewhere closes the selector; Esc and the close button return focus to Sel. Opened from the keyboard or a mouse, focus lands in the field; opened by a tap, it lands on the selector itself, so the on-screen keyboard only appears when you tap the field.
- **Choosing a value never steers.** In manual flight the bug only marks a heading. Nothing engages, and the aircraft flies exactly as it would without the bug (tested bit for bit).
- **Hold heading** engages flight assist on the selected heading and holds the altitude you are at when you press it. If assist is already on, any new value takes effect at once, and assist keeps the altitude it was already holding.
- **Space is unchanged.** Space (and *Enable assist* / *Take control*, and the Flight assist switch in Settings) toggles assist and captures the heading and altitude you are flying, as before. The bug value stays where you set it but is shown as not held.
- **Manual input still wins.** Any pitch, roll or rudder input disengages assist at once, exactly as before, and the hold ends with it. A stall, a touchdown or a crash also ends it. The bug keeps its value.
- **Not on the ground or after a crash.** You can choose a value on the runway, but Hold heading is disabled until you are airborne, and refused after a crash.
- **Readout.** The large number is always the current heading. The Sel chip shows the selected heading: `---` when nothing is chosen; a hollow dot and ivory value when selected but not held; a filled chartreuse dot, chartreuse value and chartreuse outline while assist holds it. The selector repeats it in words ("Now 042° · Selected · not held", "Assist holding 330°"), and the mission card reads *Assist · heading 330°*.
- **Helicopters** keep their hover hold and the plain heading instrument; the chip is hidden.

## Behaviour

- **Input.** `normalizeHeadingTarget` (src/flight.js) accepts any finite number, or a numeric string, and rounds it to a whole degree from 0 to 359. 360 becomes 000, −10 becomes 350 and 725 becomes 005. Empty text, words, `12°`, NaN, ±Infinity, booleans, null and objects are refused. The selector then shows "Enter a heading from 000 to 360" in the danger colour and keeps the previous selection.
- **Controller actions.** `setHeadingTarget(value)` validates and selects a value and returns it, or returns null. With assist on, it also retargets the held heading and leaves the held altitude alone. `holdSelectedHeading()` engages assist on the selection; it returns false without a selection, on the ground, after a crash or in a helicopter. `clearHeadingTarget()` forgets the selection; a hold in progress becomes an ordinary hold of the heading then flown. The state has `selectedHeading` (whole degrees or null) and `headingHold` (true only while assist holds the bug).
- **Shortest turn.** The heading error is wrapped to ±180°, so 350° → 010° turns right through north and 010° → 350° turns left. Tests check that this holds for every pair across 359/001.
- **Same bounded turn as before.** The bug only changes the heading that assist's existing controller aims at. That controller limits bank to 23° (0.4 rad, and to each type's own bank limit) and eases it in at up to 25°/s. Pitch still comes from the altitude hold. Free-attitude types use their existing capped rotation (1.2 rad/s at most). Nothing is snapped or teleported, and throttle and pitch trim are never touched.
- **Aerobatic recovery.** From an unusual attitude, the Arolla F7, Silex A3 and Taris F12 still level out first with wings level and nose level. When the recovery ends, assist takes up a heading chosen before or during it, instead of overwriting it with the heading it levelled on. Space alone still holds the heading it levels on.
- **Wind.** Assist holds the **nose heading**. In wind the aircraft crabs off it and drifts across the ground (src/wind.js); there is no wind correction and no ground-track capture. A test checks that, in Breeze and Gusts, the nose stays within 1.5° of the bug while the track drifts.
- **Warnings and missions.** The bug is read-only for everything else: stall, terrain, gear and airspeed warnings, glide-path lights, the flight-path marker and trim behave as before. It never starts with an activity, and landing missions and the checkpoint course keep their own starts and objectives.

### Resets

Every fresh start goes through `FlightController.reset()`, which clears both the selection and the hold. That covers restart (R, the reset buttons), aircraft changes, runway departures, approach starts, landing-mission starts and retries, and checkpoint-course starts and retries. The checkpoint course still captures its own gate-1 heading with assist. Pause, dialogs and hiding the panels keep the selection. Opening any dialog, restarting or switching to a helicopter closes the selector.

### Keyboard safety

Opening the selector first releases any held flight keys (`clearControls`). Every key pressed inside it stops at the selector, so typing or pressing Space, W, R, P, H, G, B, `[` or Shift cannot fly the aircraft or trigger a shortcut. Key releases still pass through to the window handler, so a flight key can never be left stuck down. With focus on the **Sel** chip itself (where Tab or Esc leaves it), Space and Enter open or close the selector like any button and stop there, so they never reach the global Space = assist shortcut; their key releases still pass. Space over the flight world still toggles assist. No new flight-control key was added; the selector has no global hotkey, so trim (`[` `]` `T`), brakes (`B`), map (`M` `V` `N` `−` `+`) and the course controls keep their keys.

## Measurements

`node scripts/measure-heading-select.js` flies each fixed-wing type through the real input pipeline at 2,400 m in calm air: assist engaged on the bug, hands off. Capture means within 2° of the target with wings within 3° of level.

| Type | 350→010 s | 000→180 s | 090→270 s | Worst bank | Peak roll rate | Altitude ± | Overshoot |
|---|---|---|---|---|---|---|---|
| Mira T2 (trainer) | 7.7 | 40.8 | 40.8 | 22.9° | 25.0°/s | 2.9 m | 0.00° |
| Varen G18 (motorglider) | 5.5 | 27.4 | 27.4 | 22.9° | 25.0°/s | 3.5 m | 0.60° |
| Alba B2 (biplane) | 6.7 | 34.6 | 34.6 | 22.9° | 25.0°/s | 3.2 m | 0.11° |
| Vela J8 (jet) | 14.9 | 80.7 | 80.7 | 22.9° | 25.0°/s | 1.8 m | 0.00° |
| 737-800 (airliner) | 19.1 | 102.4 | 102.4 | 22.9° | 25.0°/s | 1.8 m | 0.00° |
| Aven W280 (widebody) | 21.1 | 113.0 | 113.0 | 22.9° | 25.0°/s | 1.8 m | 0.00° |
| Montis C90 (cargo) | 15.2 | 81.3 | 81.3 | 22.9° | 25.0°/s | 2.1 m | 0.00° |
| Silex A3 (aerobatic, free attitude) | 11.2 | 60.3 | 60.3 | 22.9° | 22.5°/s | 3.3 m | 0.00° |
| Arolla F7 (fighter, free attitude) | 25.6 | 138.2 | 138.2 | 22.9° | 22.5°/s | 2.8 m | 0.00° |
| Taris F12 (interceptor, free attitude) | 26.3 | 142.2 | 142.2 | 22.9° | 22.5°/s | 2.8 m | 0.00° |

The script prints all 18 fixed-wing types; the rest fall within these ranges. The free-attitude types, started at 150° of bank and 30° nose up with the bug at 120°, levelled first and then captured it: Silex A3 in 46.3 s, Arolla F7 in 109.7 s and Taris F12 in 113.0 s, each finishing 0.00° off. The turn times are the existing assist's own, which a Space hold would also take: the bug changes only the target.

## Tests

`tests/heading-select.test.js` (14 tests, part of `npm test`) covers:

- input normalisation and refusal;
- fixed-wing availability, and helicopters' hover hold unchanged bit for bit;
- selecting while flying manually is identical to not selecting;
- shortest turns across 359/001 for nine representative types;
- bounded, smooth convergence for all 18 fixed-wing types;
- no throttle, trim, position or attitude jump;
- altitude retention when retargeting under assist, and Space's existing capture;
- Hold heading;
- disengagement by pitch, roll and rudder, with manual flight then identical to a plain assist disengagement;
- refusal on the ground, after a crash and on a stall;
- aerobatic recovery honouring the bug, by both Hold heading and Space-then-select;
- every reset path;
- clearing the selection mid-turn;
- nose-heading hold with drift in wind.

## Browser checks

All checks ran in headless Chromium against the dev preview (port 5173) on the merged branch, through the real page and its DOM handlers, with no console or page errors. A Playwright script drove ordinary mouse clicks, keyboard presses and touch taps (`hasTouch`/`isMobile` contexts; not real touch hardware).

**Desktop, 1600×900, mouse and keyboard (Vela J8):**

1. *Take control* switched to manual flight.
2. Clicking **Sel** opened the selector (268 × 164 px, centred over the heading cell, above the strip), with focus in the field.
3. With focus in the field, W, Space, R, P, H, G, B, `[` and a held Shift changed nothing: assist stayed off, there was no pause or restart, and gear, throttle, trim and panels were unchanged.
4. Typing `north` and Enter showed the coral error and kept no selection (`select-invalid-1600.png`). `360` gave 000; ↓ gave 359; Page Down gave 349; −10, −10, +1 gave 330.
5. Flying manually for 10 s with 330 selected, the heading stayed at 000.00° and the state read *Selected · not held* (`select-manual-1600.png`).
6. **Hold heading** engaged assist: the button read *Holding 330°*, the chip turned chartreuse and the mission card read *Assist · heading 330°*. The jet turned left and captured 330° (within 2°) in 17.5 s of simulated time, never more than 1.0 m off the held altitude (`holding-1600.png`).
7. Typing `020` while held turned right across north (+16° bank) and held altitude to within 0.7 m.
8. Esc closed the selector and returned focus to Sel. Space on the world then disengaged assist, keeping 020 selected but not held. Space again re-engaged ordinary assist on the current heading (*Flight assist enabled*, not held).
9. Hold heading again, then a tap of D: assist and the hold ended at once, and 020 stayed selected.
10. Opening Settings closed the selector. While paused, stepping −10 gave 010 without engaging anything (`select-paused-1600.png`).
11. H hid the strip and its chip; H again restored both. R cleared the selection (`Sel ---`).
12. Switching to the Laret H4 hid the chip and left the plain heading instrument; switching to the Mira T2 brought it back.
13. On a runway start, 120 could be selected, but Hold heading was disabled with *Selected · hold once airborne* (`select-runway-1600.png`).
14. An earlier eastbound demonstration flew into the valley wall: the terrain crash ended assist and refused re-engagement, as designed. The demonstration was moved to the lake.

**Desktop, 1280×800:** the chip (66 × 22 px) fits beside the Heading label in the 151 px cell. The selector sits above the strip without covering the map or mission card. Holding 345° is shown in `holding-1280.png`.

**Phone, 390×844, touch:**

- Tapping Sel opened the selector across the strip's width (360 × 182 px, above the two-row instrument grid), with focus on the selector rather than the field, so no on-screen keyboard appeared.
- Space pressed then did nothing.
- Step buttons are 36 × 42 px and the hold button is 183 × 40 px; the chip is 43 × 30 px with its "Sel" word hidden.
- Taps of +10, +10, −1 from 000 gave 019 in manual flight, with assist still off. Tapping Hold engaged it (*Assist · heading 019°*) (`select-390.png`, `holding-390.png`).
- A tap on the world closed the selector.
- The page has no horizontal overflow.
- While open, the selector covers the phone's yoke and trim column; closing it (a tap on the world, ×, or Esc) uncovers them.

**Revalidation after merging main through #47 (course card #44, runway wind #45, touchdown feedback #46, crosswind practice #47):** `npm test` 654/654 and `npm run build` pass. In the browser, with no console errors:

- **Desktop, 1600×900:** Space on the focused Sel opened the selector with assist unchanged. Esc closed it and returned focus to Sel, where Space opened it again with assist unchanged; Enter also opened it.
- **Retargeting:** typing 340 with assist on retargeted the hold (*Assist · heading 340°*). ↑ gave 341, and Space inside the field changed nothing.
- **Space over the world:** pressed twice, it turned assist off, then back on capturing the current heading (not held); a tap of A handed back manual control.
- **Phone, 390×844, touch:** tapping Sel opened the selector without the on-screen keyboard. Taps of −10 and −1 retargeted to 349. A tap on the world closed it, and Space over the world and on the focused Sel behaved as on desktop. There was no horizontal overflow.

**Software-WebGL limits.** This VM renders with SwiftShader at about 2–4 frames per second (Low quality). The simulator caps each frame's step, so for repeatable runs `performance.now()` and event `timeStamp` were driven by a controlled clock advancing 250 ms per rendered frame, and the scripts read simulated rather than wall-clock time. Screenshots were taken with the frame loop briefly held. These checks exercise the real rendered app and its handlers; they are not hardware frame rates, real touch hardware or a subjective flight test on a normal GPU or phone.

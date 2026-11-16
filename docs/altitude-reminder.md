# Altitude reminder

Open **Set** beside **Altitude**. Choose a target in **feet MSL**, type it and press Enter or leave the field, step by 100 / 1,000 ft, or choose **Use current**. Selecting a valid target arms monitoring. The chip shows the target in chartreuse while armed and ivory while disarmed. The large altitude number and AGL readout remain actual flight telemetry.

This is a visual reminder for **every fixed-wing aircraft and all three helicopters**. It never engages assist, captures an altitude, changes a held heading/altitude, moves trim or throttle, or steers a climb. Helicopter hover hold remains Space's existing behavior; the reminder uses the same MSL bands as fixed-wing flight and is not a hover-height or terrain-clearance alert. There is no new horn.

## Lifecycle and gameplay assumptions

These are deliberately broad gameplay bands, not certified aircraft equipment or performance limits. `src/altitude-reminder.js` contains the pure monitor and the exported `ALTITUDE_REMINDER` constants.

- A finite target from **0 through 60,000 ft MSL** is rounded to a whole foot. Invalid input preserves the previous target and shows an error. Step buttons clamp at these bounds.
- A new selection or **Arm reminder** starts approach monitoring. The first observed movement toward the target within **1,000 ft** shows “Approaching … ft MSL.” Selecting inside that range while level or moving away does not alert. This reminder occurs once per arm/selection. It persists until capture, acknowledgment, disarm, or moving more than **1,200 ft** away; crossing back into the approach zone does not repeat it.
- Entering the **±100 ft** capture band changes to “Captured · deviation armed,” silently. Selecting the altitude already flown also captures that band silently. A sample that crosses the entire target band still captures it.
- After capture, remaining **200 ft or more** above/below the target for a continuous **one flight second** shows “Altitude deviation from … ft MSL.” A short spike or returning inside 200 ft before the second expires cancels the pending alert. An active deviation clears at **150 ft** from the target.
- **Acknowledge** dismisses the alert. Acknowledging approach leaves subsequent capture/deviation monitoring enabled. Acknowledging deviation quiets that whole excursion, including continued drift or jitter around 150–200 ft. A return to **±100 ft** rearms the next deviation. The same excursion never raises a repeated reminder, even if its notice cleared at 150 ft.
- **Disarm** clears alerts and monitoring but keeps the selected number. Arm starts a fresh lifecycle on that number. Closing the selector only closes it. The inline notice also has Acknowledge, usable with panels hidden.

Timing uses actual `flightTime`; altitude uses `position.y × 3.28084`, never AGL or predicted vertical speed. The monitor observes each physics slice so ordinary low frame rates cannot skip the capture band. Pause, dialogs and hidden tabs stop the flight clock and suspend reminder presentation; suspension also cancels a pending deviation dwell. Visibility transitions reset input timing at both ends, so background time cannot be replayed as flight input or alert timing. No wall-clock timer queues reminders.

Ground contact suppresses notices and returns an armed reminder to approach monitoring, without capturing on the runway. Crashes and finished-activity result screens disarm and suppress it. Restart, aircraft changes, approach/runway starts, activity starts/retries/cancellation clear the target, latches and event history explicitly. The pure monitor also detects aircraft changes and rewound flight time. Targets are not persisted across reloads.

## Flight deck and keyboard

Stall, terrain (both warning and caution) and overspeed retain priority in the existing notice slot. Their styles, stall-bank calculation, gear warning and panel-visibility behavior are preserved. A reminder is shown only when none of those notices owns that slot. No extra warning layer competes with mission cues.

The selector follows Alpine Flight's graphite/ivory/chartreuse tokens, DM Sans labels, Barlow Condensed values and existing 6 px controls. At desktop sizes it sits above the strip and to the right of the camera tools. On phones it occupies the telemetry strip itself with an opaque surface; the yoke, trim, brake, power and mission cues stay accessible. The selector repeats the current MSL altitude while covering the telemetry. Opening either altitude or heading selection closes the other. Dialogs, hidden instruments and new starts close altitude selection.

Opening releases held flight keys. All keydowns inside the selector stop before global flight shortcuts; keyups still release held inputs. In the field, ↑ / ↓ step 100 ft (Shift: 1,000 ft), Page Up / Down step 1,000 ft, Enter commits and Escape closes/refocuses the chip. Space/Enter on the chip open it using native button behavior, without toggling assist. Space/Enter on Acknowledge dismiss the reminder without toggling assist. Space over the world and the merged heading selector keep their existing behavior. Touch opens on the selector, not in the input, so the software keyboard is requested only when tapping the field.

## Deterministic checks

`npm test` includes 14 reminder tests: both approach directions, full-band crossings, dwell/deadbands/hysteresis, acknowledgment/rearming, input validation, pause/suspension, MSL sourcing, ground/crash/results, clock/type/reset paths and defensive diagnostics. Every fleet type also flies through ordinary ramped `FlightInputs` with manual and assist/heading/hover-hold cases: repeated selection, rearming and acknowledgment leave the entire controller state **bit-identical** to the control run, including its held altitude and heading. `src/flight.js`, the shared bank-dependent `src/stall.js`, wind handling and activity implementations are unchanged.

`node scripts/measure-altitude-reminder.js` runs an independent, reproducible Vela J8 example over synthetic flat ground in calm wind. From its ordinary 2,034 ft MSL airborne start, select 2,334 ft; hold positive pitch input for 0.5 s, release 2 s, hold 1 s, then release. Acknowledge approach at 2.5 s. Without any subsequent position/speed/attitude writes or assist:

- Approach appears at 0.008 s, 299.88 ft below target, on the first upward movement.
- Capture occurs at 7.058 s, 99.85 ft below target.
- Continued climb raises deviation at 15.667 s, 232.29 ft above target, after the one-second dwell.

This demonstrates the reminder lifecycle under those game inputs; it is not a climb-rate benchmark.

## Browser verification

Headless Chromium against `forge serve` on port **5173**, Low quality, at **1600×900**, **1280×800**, and **390×844**. Software WebGL is slow in this VM, so checks use controlled `performance.now()`/event timestamps and manually advance normal animation frames by 250 ms. Screenshots hold the frame loop. Aircraft state is read through diagnostics; no flight pose is injected. Touch uses Playwright `hasTouch` / `isMobile`, not physical hardware.

- No horizontal overflow at any checked size. Selector: 326×184 px on desktop; 362×176 px at 390×844, occupying y=638–814 while touch controls end at y≈624. Its opaque surface prevents covered telemetry showing through.
- Text entry, W, Space, R, P, H, G, B, `[`, and Shift leave assist, gear, throttle, trim and pause unchanged. Invalid text displays the error and preserves the selected number. Arrow/Page stepping, Escape/refocus and Space on the focused chip work. World Space toggles assist normally.
- A keyboard-flown climb produces an approach alert; Space on its Acknowledge silences it without engaging assist. Capture then arms deviation. A separate Use current/climb produces deviation at flight time 7.242 s; Enter on Acknowledge silences it while assist remains off. The reminder remains visible and acknowledgeable with panels hidden.
- Pause, Settings and simulated visibility changes leave flight time and event count unchanged; resuming does not replay a crossing. Touch opens with focus on the selector and leaves assist enabled through stepping, disarm and Use current capture.
- A keyboard-flown low-power climb stalls while a deviation is still active: the red STALL notice replaces the reminder, stays visible with panels hidden, and hides the reminder's Acknowledge button. The monitor retains its independent deviation state.
- Restart, approach/runway starts, landing/course/crosswind starts and cancellation all clear selection while the input still has focus. Closing the field commits before reset, preventing a blur event from rearming the stale value. Aircraft changes clear the selection; helicopters retain hover hold when Use current arms their reminder.

`scripts/check-altitude-reminder.browser.js` is a repeatable browser-MCP check: pass its absolute path as `browser_run_code_unsafe`'s `filename` with the port-5173 preview running. It creates an isolated Low-quality context, asserts the focused-field reset regression, keyboard isolation, heading-hold coexistence, selector geometry at all three sizes and helicopter support, and saves viewport screenshots under `/tmp/forge-browser`. It needs no project dependency or production test endpoint.

`window.aeronaut.getAltitudeReminder()` returns a detached read-only snapshot: target, phase, armed state, active/acknowledged alert, suppression reason, signed target-minus-actual error in feet, last sampled flight time, pending dwell start, approach/excursion latches, event count, last event `{kind,time,target}`, selector-open state and candidate reminder text. A higher-priority flight warning can preempt that candidate text; inspect the visible notice alongside the snapshot. No diagnostic setter or state-injection endpoint was added.

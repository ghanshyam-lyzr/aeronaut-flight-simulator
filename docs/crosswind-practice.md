# Crosswind practice

One repeatable beginner exercise: land on Alpine Field's runway 36 in a fixed crosswind. It is **the landing mission itself**, with the same start (lined up on a 3° final 1.1 km out), the same touchdown and rollout rules, and the same result panel and measurements. On top of that it borrows a wind for the attempt and adds a little crosswind feedback. Nothing new is scored.

## Where to find it

- **Desktop:** the flight card's third entry, **Crosswind practice · runway 36**, or **Explore → Crosswind practice · Alpine Field 36**.
- **Phone:** Menu → Explore. The flight card keeps its height there, as it does for the checkpoint course.

The brief ([1600](crosswind-practice/brief-1600.png), [1280](crosswind-practice/brief-trainer-1280.png), [390](crosswind-practice/brief-390.png)) shows:
- the wind, and its crosswind and headwind components on the runway;
- the crab angle at the aircraft's approach speed;
- three steps: crab, straighten, roll out;
- **Start crosswind practice**.

The Mira T2 is recommended. In any other aircraft, the brief names it and offers a separate **Switch to the Mira T2** button. The selected aircraft never changes unless you press it.

Who can fly it:
- Helicopters are refused by name ([390](crosswind-practice/helicopter-refused-390.png)), with **Switch to the Mira T2** and **Choose another aircraft**.
- An aircraft the landing mission would refuse at the practice field is refused with the mission's own reason (`missionAvailability`).
- Every fixed-wing type in the fleet suits Alpine Field, so in practice only rotorcraft are refused today.

## The exercise

| | |
|---|---|
| Runway | Alpine Field 36, 1,100 × 53 m asphalt, heading 360° |
| Wind | 080° 9G12 kt, ±4° veer, seed 3 (`PRACTICE.wind` in `src/crosswind-practice.js`) |
| Components | 8.9 kt crosswind from the right (11.8 kt in gusts), 1.6 kt headwind |
| Crab | Mira T2 at 64 kt: 7.9°. Vela J8 at 109 kt: 4.7° |

The brief explains the technique in the arcade model's own terms:
1. **Crab.** Left alone, the wind carries you left of the centreline. Turn a few degrees right, with E or a gentle bank (D or the touch yoke), until the runway stops sliding sideways.
2. **Straighten.** About 10 ft up, yaw the nose back in line with Q, then flare. In this model the drift stops when the wheels touch, so straighten late and quickly.
3. **Roll out.** As in the landing mission.

It does not claim certified limits. Fixed-wing phones have no rudder buttons, so the brief says to level the wings and land with the crab in. The landing mission accepts up to 12° of misalignment.

**During the attempt** ([1600](crosswind-practice/approach-paused-1600.png), [1280](crosswind-practice/card-trainer-paused-1280.png), [390](crosswind-practice/card-paused-390.png)), the landing card's **Wind now** line (from the runway-wind advisor, #45) reads the practice wind on runway 36, for example `Wind now Head 1 · Cross 11 R kt`. The map's wind row does the same. This exercise adds no wind readout of its own.

The cue reads the actual drift over the ground (the flight-path marker's track):
- "Drifting left · turn into the wind with E"
- "Drifting right · ease the crab back with Q"
- "Crabbed 8° right · tracking the centreline"
- below 8 m, "Straighten now with Q · then flare gently with S"

Where the touch yoke shows (phones), the cues name a bank instead ("turn into the wind with a gentle right bank"), and below 8 m they say "Level the wings · flare gently, the crab can stay in". When the heading is more than 12° off the runway, the landing mission's own cues take over.

**The result** ([1600](crosswind-practice/result-uncorrected-1600.png), [390](crosswind-practice/result-390.png)) keeps the mission's reason and four touchdown measurements. It adds one sentence of advice and two tiles: **Crab on final** (the mean heading offset from 800 m to 50 m before the threshold) and **Crosswind**. Example sentences:
- "No crab into the wind on final · the wind carried you 108 m left by the threshold. Turn a few degrees right early and hold it."
- "Crabbed 9° right to hold the centreline and straightened to 1° for touchdown."

The retry button reads **Retry crosswind practice**.

## Wind ownership and lifecycle

`src/wind.js`'s API (`flight.setWind` returns the previous configuration) is the only wind used. Nothing here re-implements wind physics.

- **Start.** The first start takes the wind with `{ immediate: true }` and keeps the pilot's configuration. A retry (Retry, R, the result's retry) keeps owning it and never stores the practice wind as the pilot's. `flight.reset()` inside the mission's start replays the **same gusts from time zero**, at the same start.
- **End.** `CrosswindPractice.end()` restores the pilot's configuration **exactly once** (tested by counting `setWind` calls), whichever way the attempt ends:
  - Free flight, or Return to free flight from a result, including after a crash;
  - starting a landing mission, the checkpoint course, a runway or approach start, or Start in the air;
  - an aircraft change, or an external reset (the mission cancels itself and the practice follows on its next update).
- **`settings.wind` is never touched.** A Wind choice made in the Weather dialog during the attempt is saved, the dialog says the practice holds its wind until it ends, and that new choice is what comes back ([1600](crosswind-practice/weather-during-practice-1600.png)).
  - Changing the light (Clear / Golden hour / Cloud cover) does not touch the attempt.
  - The weather panel reads the wind blowing: the practice wind during it, the pilot's afterwards.
- **Runway advice** (#45) for the selected destination, in Explore and the landing brief, uses the pilot's wind during the attempt (`CrosswindPractice.pilotWind`), because any departure or mission started from there ends the practice and flies in that wind. In the browser, with Breeze chosen, Orvane 32's advice read "Reported wind 240° at 8 kt" during the attempt and after it. The live **Wind now** readouts show the wind actually blowing.
- **Pause and dialogs** freeze the wind and the mission clock, because the flight is not updated.
- **One activity at a time.** `Activities` (`src/activities.js`) gains `startCrosswind` and kind `'crosswind'`: it starts only if the aircraft can fly it, and ends the checkpoint course. Starting the course or a landing mission ends the practice first. A refused start (a helicopter) leaves whatever was running untouched.
- **Destination and glide lights.** The practice uses its own field and never changes the airport selection. During the attempt the glide-path lights and the map follow Alpine Field 36, as they do for any mission; afterwards they return to the selected field. In the browser: Orvane Regional 32 was selected, the lights followed Alpine Field 36 during the attempt and were back on Orvane 32 afterwards.

## Measurements

Reproducible with `node scripts/measure-crosswind.js`. A deterministic pilot (`tests/crosswind-pilot.js`) flies through `FlightInputs` with ordinary rate inputs only:
- pitch to hold the 3° path and flare;
- rudder (Q/E) for the crab, wings level;
- rudder to straighten 3 m above the runway;
- idle power and full brakes on the ground, rudder to keep straight.

It reads what the pilot sees (the wind on the card, the ground track, the runway) and never writes the aircraft's pose. "Uncorrected" is the identical pitch, power and brake pilot with hands off the lateral controls.

| Aircraft | Pilot | Result | Crab on final | Offset at threshold | Touchdown along / offset | Touchdown crab | Sink | Max offset |
|---|---|---|---|---|---|---|---|---|
| Mira T2 | crab + straighten | success | 9.4° | 0.0 m | 212 m / −4.7 m | 0.8° | 338 fpm | 4.8 m |
| Mira T2 | crab, never straightened | success | 9.4° | 0.0 m | 211 m / 0.0 m | 9.6° | 338 fpm | 4.8 m |
| Mira T2 | crab, not straightened or steered | success | 9.4° | 0.0 m | 211 m / 0.0 m | 9.6° | 338 fpm | 11.9 m |
| Mira T2 | touch yoke only (no rudder) | success | 10.1° | 0.2 m | 166 m / 1.7 m | 9.8° | 340 fpm | 16.9 m |
| Mira T2 | **uncorrected** | **touchdown outside the runway** | 0.0° | **−183 m** | 230 m / −222 m | 0.0° | 338 fpm | 222 m |
| Vela J8 | crab + straighten | success | 5.6° | 0.0 m | 285 m / −4.4 m | 0.7° | 343 fpm | 4.4 m |
| Vela J8 | crab, never straightened | success | 5.6° | 0.0 m | 285 m / −0.1 m | 6.1° | 343 fpm | 4.0 m |
| Vela J8 | crab, not straightened or steered | success | 5.6° | 0.0 m | 285 m / −0.1 m | 6.1° | 343 fpm | 19.0 m |
| Vela J8 | touch yoke only (no rudder) | success | 6.6° | −0.8 m | 254 m / 0.0 m | 5.6° | 343 fpm | 16.2 m |
| Vela J8 | **uncorrected** | **touchdown outside the runway** | 0.0° | **−107 m** | 292 m / −135 m | 0.0° | 343 fpm | 135 m |

Every success stops on the runway: Mira T2 near 285 m from the threshold, Vela J8 near 470 m.

What the measurements show:
- **Crab and straighten** lands on the centreline in both aircraft.
- **The same approach uncorrected** drifts 107–183 m left by the threshold and touches down off the runway.
- **A crabbed touchdown still counts**, because the mission's own 12° alignment rule is kept unchanged. Its rollout wanders 12–19 m sideways when not steered, and the feedback says to straighten in the flare.
- **Frame rate.** The rudder pilot at 30, 20 and 10 fps lands within 0.1 m of its 60 fps touchdown, with the same crab to 0.1° (the script's table; the test allows 3 m and 0.5°).

## Two fixes this exercise exposed

Both are covered by tests in `tests/crosswind-practice.test.js` that fail without the fix.

1. **Load factor at low frame rates (`src/controls.js`).** This one predates this branch: it also shows in an ordinary landing mission with Gusts selected.
   - **Symptom.** At about 1 fps, `FlightInputs` cut each 0.25 s frame into 1/120 s slices and left a floating-point remainder of about 2 × 10⁻¹³ s. On a pitched approach in wind, the wind is sampled at each step's midpoint, so the load factor differentiated over that sliver read in the thousands of g (−3488.7 g on the G-force instrument in the browser).
   - **Fix.** Any remainder under 1 µs now joins the slice before it. Total time is unchanged.
   - **Result.** Worst |g − 1| over 40 one-fps frames fell from 46,728 to 0.01.
2. **Terrain alert hysteresis on final (`src/terrain-alert.js`).**
   - **Symptom.** While an alert shows, hysteresis widened every margin by 15 m, including the 5 m approach-corridor margin, which an ordinary 3° final sits inside. The practice starts lined up with the runway, not crabbed, so the Vela J8's first look-ahead runs off the corridor and raises a correct caution. Hysteresis then latched it into a warning from 619 m out to 194 m out, down a good, centred approach.
   - **Fix.** Hysteresis now widens only the open-ground margin.
   - **Result.** A corrected Vela J8 approach shows a caution for its first 1.8 s and nothing after. Corrected Mira T2 approaches stay clear. Both uncorrected approaches are still warned. The existing terrain-alert tests all pass.

## Tests

`tests/crosswind-practice.test.js` (16 tests) covers:
- the exercise definition and the brief's numbers;
- rotorcraft and unsuitable-field refusal;
- wind ownership: retries, exactly-once restore, and a pilot choice made during the attempt;
- the same start and gust sequence on retry, including after a crash;
- every exit: free flight, landing mission, course, aircraft change, external reset;
- mutual exclusion, including a refused start;
- the untouched airport selection;
- full approach, flare and rollout success for the Mira T2 and Vela J8, and the uncorrected drift;
- the crabbed-touchdown feedback, and touch-yoke-only landings;
- 30, 20 and 10 fps;
- pause and no-time updates;
- the feedback wording;
- the low-frame-rate load factor and the terrain-alert latch.

`npm test` runs it with the rest of the suite.

## Interface checks (headless Chromium, software WebGL)

All checks ran against the dev server through `window.aeronaut`. The new diagnostics are `getPractice()` and `startCrosswind()`.

- **Sizes.** 1600×900, 1280×800 and 390×844, with screenshots linked above.
  - The third flight-card entry pushes the scene label down by one row: it now clears the card by 20 px at 1600 and 1280, and by 15 px at 800 wide.
  - On the phone, the practice card, touch yoke, Brake, trim column, power buttons and instrument strip do not overlap. The map and weather panels hide while the mission flies, as for any landing mission.
- **Keyboard.**
  - E held through real `keydown`/`keyup` events yawed the aircraft into a crab.
  - R retried: same start, wind clock back to zero.
  - H hid the panels: the practice card stayed visible, the restore button appeared and the attempt kept its wind.
  - P paused: the wind clock was identical after 3 s paused, and after 2.5 s under the Weather dialog.
  - Enter on the focused **Retry crosswind practice** button retried the attempt. **Switch to the Mira T2** kept the brief open with focus on Start.
- **Touch.** Checked with dispatched pointer events on the touch yoke (it banked and turned the aircraft during an attempt) and with clicks on the brief and result buttons. No real touch device was used. The synthetic pointer logged one `setPointerCapture` error, because no real pointer existed; it is not an app error.
- **Software-WebGL limit.** This VM renders at about 1 fps, even at Low quality.
  - Flight time advances about one flight second per 6–8 s of wall time, so no attempt was hand-flown to a landing in the browser.
  - Successful landings are proved by the deterministic pilot above. The browser runs are hands-off or briefly keyed: they show the cues, the uncorrected result (the same 108 m drift by the threshold in two separate runs) and every lifecycle transition.
  - Screenshots while flying timed out at this frame rate, so the in-flight screenshots were taken paused.
  - No hardware-WebGL browser was used.

# Checkpoint course — Lake Azure gates

One curated, beginner-friendly timed course in the existing central valley: six gates up Lake Azure, past Alpine Field, about 10.8 km. There is no course editor, no new world and no persistence service; the best time is kept in memory for the session.

## Starting it

- **Flight card:** *Fly the Lake Azure gates* under *Land at …* (desktop and tablet). Phones keep the free-flight card at its old height and start it from **Menu → Explore → Checkpoint course**.
- **Explore:** *Checkpoint course · Lake Azure gates*, beneath *Start in the air*.
- Both open the **brief**. It names the course, its length and region, the current aircraft and the rules. It recommends the **Mira T2** and offers *Switch to the Mira T2* as a separate button. The course is always flown in the aircraft the pilot has chosen; nothing switches it silently.
- **Exclusions are explicit:** helicopters (Laret H4, Sorna H8, Lodra H20) get a bordered notice instead of the start button: "No course run in the … : the gates are set for fixed-wing speeds and turns; helicopters keep the landing missions." It offers the Mira T2 switch and Explore.
- **Fast aircraft are advised, not excluded:** any type cruising above 210 kt (737, Aven W280, Orsino R70, Rava R6, Arolla F7, Taris F12) gets a note in the brief to ease power below 210 kt to make the turns.
- Every start is the same airborne start: at 190 m over the lake, 1.6 km south of gate 1, lined up with it at cruise power. Retractable gear is up and flaps are at 0. **Flight assist is on**, so a hands-off aircraft flies level, straight to gate 1; any stick input takes control.

## Flying it

- **Gates:** 140 × 80 m openings, centred 160–210 m above sea level over open water. Legs are 1.8–1.9 km long; no turn between legs exceeds 27°, and no climb or descent is steeper than about 2°. Each gate faces the bisector of the legs into and out of it.
- **World cues:** the next gate is a chartreuse frame. Later gates are ivory at half opacity. Thin graphite poles drop to the water so a gate reads at a distance. Passed gates disappear. Everything is fogged and depth-tested.
- **Card** (the landing mission's card layout):
  - the phase line: *Gate n of 6 · distance*;
  - six gate pips;
  - course time and next gate in Barlow Condensed;
  - a cue: *Turn right 11° toward gate 2*, *130 ft high · ease the nose down*, *Gate 2 straight ahead*, or *Gate 2 is behind you · turn back and enter from the front*;
  - the objective line, with the session best once there is one;
  - *Retry* and *Free flight*.
- Each gate passed shows a toast with its split time. A pass that does not count shows a note for 3.5 s instead of the cue: missed (crossed outside the opening), flown backwards, or out of order.

## How gates count (`src/checkpoint-course.js`)

- **Swept segments.** Each physics slice tests the segment from the previous to the current position against the **next gate's plane only**. A gate counts when the segment crosses the plane from back to front (`along` < 0 → ≥ 0) and the interpolated crossing point lies inside the opening.
  - Fast aircraft and low frame rates cannot skip a gate. In the browser, gate 1 counted at 0.25 s frame steps (about 25 m a step).
  - A segment ending exactly on the plane counts once; the next segment starts on the plane and does not cross it again.
- **Never counted:**
  - wrong order: a different gate's opening is named, not counted;
  - flying around a post or over or under a beam;
  - crossing behind the gate (parallel to its plane);
  - crossing backwards;
  - flying back through a gate already passed.
- **Resets and teleports never award gates.**
  - A move faster than 600 m/s of flight time is a jump: no gate is judged, and the next slice measures from the new place. 600 m/s is above any type's top speed plus afterburner, and a move with no flight time at all counts too.
  - Any reset (flight time runs backwards) or aircraft change cancels the attempt.
- **Clock.** The clock is the aircraft's flight time, which only advances while the simulator runs. Pause, any dialog and a finished result all freeze it. Splits and the final time are interpolated to the crossing, not the end of the slice.
- **End of a run.** The last gate completes the run. A crash fails it with the flight model's reason (*Terrain collision*, *Hard landing*). Both freeze the simulator and show the result panel.

## Result, retry, cancel

- The result reuses the landing result panel. It shows the eyebrow, title and reason, then the course time, gates, best this session, and either the average speed (complete) or the last gate's split (failed). Below them are **Retry the course** (focused) and **Return to free flight**.
- **Retry** (the button, the card's Retry, or R) restarts from the same start with the clock, gates and splits cleared. The session best is kept.
- **Free flight**, *Start in the air*, a runway or approach start, and an aircraft change all cancel the course. An aircraft change's toast says so.
- **Mutual exclusivity** (`src/activities.js`): starting a landing mission cancels the course, and starting the course cancels a landing mission. Each keeps its own start, scoring and controls. The landing mission code is unchanged; it is only started through the coordinator.

## Glide-path lights

The lights keep following the runway selected in Explore while the course runs. They hide, as after a landing mission, while a result is on screen. They come back on retry, cancellation and return to free flight.

Checked in the browser: the lights read *outside the sector* (live, Alpine Field 36) during the run. After *Free flight* and an approach start they read on path, two white over two red.

## Code

- `src/checkpoint-course.js`: the course definition, `gateCoordinates`, `gateCrossing`, `courseAvailability` and `CheckpointCourse` (start, update, guidance, snapshot). It is pure: no DOM, no Three.js and no wall clock.
- `src/activities.js`: landing/course exclusivity.
- `src/course-gates.js`: Three.js rendering. It uses one shared `BoxGeometry` and three `MeshBasicMaterial`s, and restyles only when the next gate changes.
- `src/main.js`, `index.html`, `src/style.css`: the brief, card, result and entries.
- `window.aeronaut.getCourse()`, `startCourse()` and `cancelActivity()` exist for checks.

## Verification

- `npm test`: every test passes, 16 of them in `tests/checkpoint-course.test.js`. They cover:
  - geometry: turns, climbs, leg lengths, and gate 1 lined up;
  - terrain clearance under every gate and in a ±400 m corridor along every leg (at least 100 m), and clear of every airfield;
  - crossing edge cases: forward, backward, posts, beams, edge, behind, on-plane, diagonal;
  - a 290 m/s aircraft at 4 updates a second;
  - order, missed, backwards and re-crossing;
  - teleport, paused-move and reset handling;
  - clock interpolation and pause freezing;
  - completion, best time and retry;
  - crash and aircraft-change cancellation;
  - identical starts and the helicopter refusal for every type;
  - landing/course exclusivity;
  - gate rendering and disposal.
- `npm run build` passes.
- **Flown routes (Node, real flight model, normal rate inputs).** A deterministic feedback pilot flies to a point ahead on the line through the gates with ordinary pitch, roll and throttle inputs. There are no pose writes after the start.
  - At cruise power: **Mira T2 211.8 s**, **Vela J8 109.2 s**, and the Vela J8 again at 20 frames a second.
  - Below 210 kt: every fixed-wing type completes. The slowest is the Varen G18 at 315 s.
  - Minimum clearance above ground or water was about 150 m in every run.
  - At their 330+ kt cruise, this pilot misses gates in the Arolla F7 and Taris F12, and also overshot in the Aven W280 in some tuning runs. That is why the brief advises easing power below 210 kt for fast types.
- **Headless Chromium (software WebGL, low quality, about 0–1 FPS):**
  - Brief: [1600×900](checkpoint-course/course-brief-1600.png), [1280×800](checkpoint-course/course-brief-1280.png) and [390×844](checkpoint-course/course-brief-390.png). It fits without a dialog scroll at 1280×800.
  - The **Vela J8 flew gate 1 for real**, on assist, at the 0.25 s frame cap: split 0:16.0, with the cue turning to *Turn right 10° toward gate 2*. See [start](checkpoint-course/course-start-1600.png) and [after gate 1](checkpoint-course/course-gate2-1600.png). The course card at [1280×800](checkpoint-course/course-1280.png) and [390×844](checkpoint-course/course-390.png) (Mira T2, after *Switch to the Mira T2*).
  - Crash runs (nose held down with W) gave the result panel at [1600×900](checkpoint-course/course-result-crash-1600.png), [1280×800](checkpoint-course/course-result-1280.png) and [390×844](checkpoint-course/course-result-390.png).
  - Retry reset the run to gate 1 at 0:00.0 at the start position, with the result hidden. A landing start during the course cancelled it and hid the gates; starting the course again cancelled the landing. *Free flight* left no activity, with both entries back. The helicopter brief showed the exclusion notice with no start button, and the switch made the Mira T2 the aircraft.
  - There were no console errors.

## Limits

- **Software rendering:** at about 0.09 simulated seconds per wall second, a full run in the browser would take about 20 minutes. So only gate 1 was flown in the browser, and the complete route evidence is the Node flights above, which use the same flight model and course code. Screenshots of the running course were taken paused with the pause overlay hidden, because the renderer was too busy to capture otherwise. The *Course complete* result was verified by the tests and the shared result code path, not captured as a screenshot.
- The turn and height cues are simple bearing and height differences to the gate centre. They do not plan a line.
- The best time lasts for the browser session only, by design.
- The navigation map still points at the selected airfield during the course; it does not show the gates.

# Wind model

Wind now moves the aircraft. Before this change, the wind in the weather panel was text and the windsocks swayed for decoration; every flight was in still air. `src/wind.js` adds one deterministic horizontal wind. The flight model, the windsocks and the weather panel all read it. **Calm is the default.** New settings, older saved settings and invalid ones all start in calm air, so nothing changes until a pilot picks a wind.

## Choosing a wind

The Weather dialog (the weather panel, or Menu → Weather on a phone) has a **Wind** row under the three light presets. It is a Calm / Breeze / Gusts segmented control, built like the camera-view control in Settings. Arrow keys, Home and End move between the choices, as in the other radio groups. The choice is saved apart from the light and weather (`settings.wind`), so Golden hour can be calm or gusty. Restore defaults keeps the wind, as it keeps the other selections.

| Preset | Wind (from, true) | Notes |
|---|---|---|
| Calm | none | Still air: exactly the earlier flight model. |
| Breeze | 240° at 8 kt | Steady. |
| Gusts | 260° 14G24 kt | Speed rises by up to 10 kt and direction swings ±12°, on a fixed, repeatable rhythm. |

The panel shows the real preset, for example `18°C / Wind 260° 14G24 kt` or `Wind calm`. This replaces the old hard-coded wind text for each light preset.

## Conventions (`src/wind.js`)

- **Axes.** +x is east, +z is south, +y is up. A heading `h` points along `(sin h, 0, −cos h)`.
- **Direction.** `direction` is where the wind blows **from**, in radians true, as in an aviation report. A 270° wind moves the air toward +x.
- **Units.** `speed` and `gust` are in m/s. `veer` is the most the direction swings either side, in radians. Wind is horizontal only.
- **Bounds.** `normalizeWind` clamps any configuration: up to 20 m/s steady, 12 m/s of gust and ±20° of veer. A missing or invalid configuration is calm.
- **Pure sampler.** `sampleWind(config, t)` returns `{ x, z, speed, direction, gust }`. `x` and `z` are the air velocity over the ground. The result depends only on the configuration and the simulation time `t`. Gusts are a sum of three sine waves with periods of 7.3, 3.1 and 1.7 s, so speed stays within `[speed, speed + gust]`.

## API for later threads

Import from `src/wind.js` and `src/flight-path.js`. Do not re-implement any wind physics.

- `flight.setWind(config, { immediate })` sets the wind and **returns the previous configuration**. `config` is a preset id (`'breeze'`) or `{ direction, speed, gust, veer, seed }`. Without `immediate`, the change blends in over 6 simulation seconds (smoothstep).
- `flight.windSnapshot()` returns a frozen `{ config, time, transitioning, x, z, speed, direction, gust }`. `flight.sampleWind(target)` returns the wind at the current clock endpoint. `state.windVelocity` (`{x, 0, z}`) is the midpoint air velocity used for the last physics interval's displacement. These contracts, including setter return values and activity restoration, are unchanged.
- `groundVelocity(state, type)` and `groundTrack(state, type)` (`src/flight-path.js`) give the **authoritative ground velocity**, and the ground speed and track. `flightPathVelocity` is the same function. A state without `windVelocity` (a hand-made legacy test state) is treated as still air.
- `windComponents(sample, heading)` returns `{ headwind, crosswind }`: headwind is positive into the nose, crosswind is positive from the right. `windText`, `sampleText`, `windsockYaw` and `windsockDroop` are also exported.
- **An activity that needs its own wind** applies it when it starts and restores the pilot's afterwards:

  ```js
  const pilotWind = flight.setWind({ direction: runway.heading + Math.PI / 2, speed: 6 }, { immediate: true });
  // … the activity runs; retries call flight.reset(), which replays the same gusts from time zero …
  flight.setWind(pilotWind, { immediate: true });
  ```

  It should not change `settings.wind`, which is the pilot's saved choice.

## How the physics works

**Wind time and sampling.** The controller owns one `Wind`. For an interval `[t, t + dt]`, it samples the midpoint `t + dt/2` for displacement and the endpoint `t + dt` for inertia and load factor. The previous endpoint sample is already available at `t`; the wind change therefore spans exactly `dt`, even when adjacent input slices have different lengths. Both samples are taken before advancing the clock, because advancing can retire a completed preset transition. The clock advances exactly once by `dt`, only inside `FlightController.step`.

The wind freezes whenever the flight is not updated (pause, any dialog, a finished mission, a crash). `reset()` keeps the configuration but restarts the clock and load measurements at zero. Every restart, retry and new start therefore gets the same gusts, and any blend still under way finishes at once. Applying an immediate activity wind also starts a fresh load measurement, so setup/restoration is not interpreted as an airborne impulse.

**Fixed-wing aircraft, airborne**
- `state.speed` stays true airspeed. Thrust, drag, stall, turn rate, assist and the speed tape all use it unchanged.
- The aircraft moves along its nose at that airspeed, plus the wind. A crosswind makes it crab: the heading stays the same while the track drifts. A headwind slows it over the ground.
- `state.distance` (distance flown, the flight log), the flight-path marker, the terrain look-ahead and the navigation time en route all follow this ground travel.
- A constant wind changes nothing else. Load factor comes from the change in inertial (ground) velocity, and a constant wind adds the same vector before and after each step, so it creates no load-factor spikes. The tests check this to 1e−9 g.
- When the wind along the flight path changes (a gust, or a preset blending in), airspeed changes by the opposite amount, as inertia does. A headwind gust raises it, and the existing thrust and drag model then brings it back. That makes the speed tape move a few knots in Gusts.

**Load measurement resolution.** Endpoint ground velocity is air-relative velocity plus endpoint wind. Specific force is its change over the same elapsed interval, plus gravity, projected onto the aircraft's up axis. Ordinary slices use their own velocity difference. Below 1 microsecond, subtracting nearly equal velocities and dividing by the tiny remainder amplifies floating-point roundoff. Such slices still apply controls, inertia, displacement, distance and both clocks; their accelerometer difference spans the preceding resolved interval plus the new elapsed time. Consecutive short slices accumulate until they provide another resolved interval. A fresh flight keeps its initial load until that first interval is available. No load is clamped, and real positive/negative manoeuvre loads are retained. Ground roll and immediate wind setup clear this measurement history.

**Fixed-wing aircraft, on the ground.** The existing ground-roll and wheel-brake model is kept. The tyres hold the aircraft, so it never drifts sideways, and `state.speed` on the ground is still wheel (ground) speed. The documented approximations are:
- Rotation compares **airspeed** (wheel speed plus headwind) with the rotate speed, so a headwind shortens the takeoff roll. At liftoff that airspeed carries into the air.
- At touchdown, airspeed becomes wheel speed along the heading (plus any tailwind). The crosswind component simply stops at the wheels.
- `state.airspeed` is the airspeed for display, on the ground as in the air. A parked aircraft facing an 8 kt headwind shows 8 kt.
- There are no ground aerodynamics: no weathervaning on the runway and no crosswind side-load on the wheels.

**Helicopters**
- `state.velocity` stays the ground velocity.
- Rotor and fuselage drag act on the velocity through the air, using the same drag law as before. A level disc therefore drifts downwind and approaches the wind's speed.
- `state.speed` is the airspeed.
- Hover hold keeps its point fixed over the ground. It adds a feed-forward tilt that cancels the wind's drag at that point. In calm air this term is zero, so the earlier behaviour is unchanged.
- On the ground a helicopter does not move. Touchdown limits use the ground velocity, as before.

**Windsocks.** Every field's sock points downwind and extends with the same sample the aircraft flies in. Each sock's world yaw is set and its airport group's own rotation is subtracted. The sock hangs at −1.2 rad in calm air and is straight out at 15 kt. Its small flutter grows with wind strength and runs on the wind clock, so it freezes with pause. Only transforms change: no geometry is rebuilt and no lights are added.

## Measurements

These are reproducible with `node scripts/measure-wind.js`. It flies through the real input pipeline (`FlightInputs`), using ordinary key presses, and records every physics slice rather than only the final slice of each rendered frame.

**Mira T2, calm versus wind.** The sequence is 90 s of key presses: 30 s hands-off heading north, D held for 6 s (a turn to about 174°), 30 s hands-off, then ½ s taps of W and of S.

| Wind | East m | North m | Flown NM | Heading ° | Track ° | Airspeed kt | Ground kt | Airspeed range kt | g range |
|---|---|---|---|---|---|---|---|---|---|
| Calm | 750 | −799 | 2.46 | 173.9 | 173.9 | 98.8 | 98.8 | 93.5–99.8 | 0.82–2.01 |
| Breeze | 1071 | −613 | 2.48 | 173.9 | 169.5 | 98.8 | 95.9 | 93.5–99.8 | 0.82–2.01 |
| Gusts | 1558 | −664 | 2.56 | 175.0 | 163.9 | 98.0 | 100.5 | 91.6–103.5 | 0.82–2.18 |
| Westerly 10 m/s | 1650 | −799 | 2.58 | 173.9 | 163.0 | 98.8 | 102.7 | 93.5–99.8 | 0.82–2.01 |
| Northerly 10 m/s | 750 | −1699 | 2.55 | 173.9 | 174.9 | 98.8 | 118.2 | 93.5–99.8 | 0.82–2.01 |

With the same key presses, the steady winds leave airspeed, heading and the load-factor range identical to calm. Only the ground track changes: a westerly adds exactly 900 m east over 90 s, and a northerly adds 900 m south. Gusts add a few knots of airspeed variation.

**Frame rate.** Gusts with the same key presses end within **0.15 m** of the 144 fps run at 30, 60 and 120 fps. `FlightInputs` already slices to 1/120 s, and the wind is sampled at the middle of each slice. The unit test also checks 30, 60 and 144 fps with direct updates: within 3 m after 40 s.

### Input-remainder stability correction

Before this correction (`0a2f419`), ordinary 60 fps inputs could report approximately **−9.91×10¹¹ to +1.85×10¹² g** in a landing turn. The reproduction is a trainer on flat terrain (`() => 40`), immediate Gusts, `new LandingMission().start(flight)`, and `input.set({ roll: 0.3 }, 0.1)`, advanced with `input.advance(frame / 60, (dt, controls) => flight.update(dt, controls))` for 600 frames. Collect `state.gForce` inside that callback to see every sample. The measurement script includes this exact sequence.

`FlightInputs` naturally emits positive frame remainders as short as `6.94×10⁻¹⁸ s` here. Previously, changing from a normal slice to a remainder compared two midpoint wind samples separated by about half the normal slice, then divided that wind change by only the tiny new `dt`. This also applied too much airspeed inertia to a short slice. Endpoint wind differences correct the time contract; resolved accelerometer intervals also remove the remaining subtraction roundoff, which occurred in Calm too.

Corrected ten-second measurements below include every physics slice. Bank means the trainer's normal airborne start with roll 0.3 pressed at 0.1 s; landing turn is the reproduction above. Descent uses the landing start and a −0.4 pitch / trim-up tap at 0.013–0.113 s. Transition means Calm blending to Gusts over six seconds, beginning after the start/reset.

| Flight | Wind | 30 fps g range | 60 fps g range | 144 fps g range | Largest endpoint difference from 144 fps |
|---|---|---|---|---|---|
| Bank | Gusts | 0.965765–2.146565 | 0.965765–2.146565 | 0.965755–2.146544 | 0.122407 m |
| Bank | Transition | 0.998052–2.142574 | 0.998052–2.142574 | 0.998054–2.142575 | 0.119935 m |
| Descent | Gusts | 0.999381–1.011485 | 0.999381–1.011485 | 0.999353–1.011486 | 0.002147 m |
| Descent | Transition | 0.999337–1.011408 | 0.999337–1.011408 | 0.999316–1.011409 | 0.001107 m |
| Landing turn | Gusts | 0.967930–2.119588 | 0.967930–2.119588 | 0.967923–2.119539 | 0.092349 m |
| Landing turn | Transition | 0.999337–2.145296 | 0.999337–2.145296 | 0.999316–2.145284 | 0.085514 m |

Adding an explicit positive 1 ns partial after each frame changes these endpoints by at most **1.760×10⁻⁷ m** and the load-range extrema by **7.665×10⁻¹¹ g**. Flight and wind clocks both finish at exactly 10 s in those runs. The 90 s flight above still agrees within 0.14 m across cadences, and its rounded speed, drift and load figures are unchanged.

`tests/wind-stability.test.js` covers these cadences, non-frame-aligned press/release events, standalone `update(1e-9)` calls, a fresh run made entirely of 1 ns slices, endpoint acceleration versus load, displacement versus `groundVelocity`, real fighter loads above +6 / below −6 g, deterministic landing retries, and pause/resume with the input clock rebased. The full suite retains coverage of all 21 aircraft, hover hold, brakes, trim, heading assist, warnings and landing/course activities.

**Takeoff roll, Mira T2, full power, stick back.**

| Wind | Roll | Sideways |
|---|---|---|
| Calm | 113 m | 0.00 m |
| Headwind 8 m/s | 61 m | 0.00 m |
| Tailwind 8 m/s | 181 m | 0.00 m |
| Crosswind 8 m/s | 113 m | 0.00 m |

Liftoff airspeed is 58.3 kt in every case.

**Laret H4, 60 s.**

| Wind | Mode | Distance from start | Ground speed | Airspeed |
|---|---|---|---|---|
| Breeze | Hover hold | 0.0 m | 0.0 kt | 8.0 kt |
| Gusts | Hover hold | 0.0 m | 0.1 kt | 17.1 kt |
| Breeze | Hands-off | 197 m | 7.9 kt | 0.1 kt |
| Gusts | Hands-off | 471 m | 18.7 kt | 1.5 kt |

## Interface checks (headless Chromium, software WebGL)

These were checked against the dev server through `window.aeronaut`. The new diagnostics are `getWind()`, `setWind(id)` and `getWindsocks()`; `getState()` now also includes `windVelocity`, `groundVelocity` and `wind`.

- **1600×900.** The dialog is shown in [wind-dialog-1600.png](wind-model/wind-dialog-1600.png), and the panel reads `Wind 260° 14G24 kt`.
- **390×844.** The dialog fits on a phone ([wind-dialog-390.png](wind-model/wind-dialog-390.png)). The segmented control is 167 × 36 px beside the description.
- **1280×800.** In a runway start at Alpine Field in Gusts, the sock streams east, extended ([wind-runway-1280.png](wind-model/wind-runway-1280.png)). The aircraft did not move sideways while parked: x stayed at exactly 900.
- **Live flight in Gusts.** The aircraft drifted 8.85 m east per flight second, with wind x = 8.77 m/s. The speed tape showed 194 kt, which is airspeed, while ground speed was 199 kt. All five socks had the same world yaw (0.2739 rad) after their group rotations were undone.
- **Lifecycle.**
  - The wind choice survived a reload.
  - Pausing froze wind time; it was identical after 2 s paused.
  - A reset restarted wind time from zero and kept Gusts.
  - Hiding the panels with H kept the wind and showed the restore button. Restoring brought back the panel text.
  - Arrow keys moved the choice and focus, wrapping from Gusts to Calm.
  - A change made while paused reads "Blends in over a few flight seconds".
- **Software-WebGL limit.** This VM renders with software WebGL at about 0–1 fps. Flight time therefore advanced far slower than wall time (about 1 flight second per 8 s), and the browser checks measured state, not frame-paced flying. A hardware-WebGL browser has not been used here. Touch input was checked as pointer clicks on the segmented buttons; there was no real touch device. The flight touch controls (yoke, brake, trim) are not changed by this work.

# Airspeed envelope

The fixed-wing airspeed instrument now shows the usable speed range. The display lives in `src/airspeed-envelope.js` and is **read-only**. Its low-speed threshold is shared with the controller through `src/stall.js`; see [bank-dependent stall margin](banked-stall.md) for the bounded bank demand. No aircraft data or upper speed limit is changed. A test flies a full-power fighter dive with and without the monitor and checks that the two states are byte-for-byte identical.

## What the pilot sees

- **Tape bands** (a 2px rule under the existing ticks):
  - Solid coral from zero to the effective stall speed for the current flaps and bank.
  - Dotted coral from stall to 1.2 × stall (the low-speed margin).
  - Dotted ivory from the caution speed to the overspeed speed.
  - Solid coral from the overspeed speed to the end of the tape, with a 1px red-line tick at its start.

  The low bands move as the flaps and conventional-aircraft bank change.
- **Label**: "Airspeed" becomes **Low speed**, **High speed** or **Overspeed** in those ranges. Low and high turn the label ivory. Overspeed turns the label, number and unit coral. Colour never carries the state alone.
- **Notice**: **OVERSPEED · Reduce power and ease the nose up**, in the shared flight-notice slot with the coral warning text and no flash. That slot stays visible when the flight panels or the instrument strip are hidden.
  - Priority: STALL > TERRAIN > OVERSPEED > brake and ground notices. The GEAR banner is a separate element and stays independent.
  - On phones the notice sits in the stall banner's slot, below the mission and map panels and the GEAR banner.

## Limits

- **Stall** uses the shared `stallSpeed(type, flaps, state)` helper, exactly as `FlightController.stepFixedWing` computes it. Wings-level values below remain unchanged; airborne conventional turns apply the [bounded bank demand](banked-stall.md).
- **Caution and overspeed** come from the explicit `UPPER_LIMITS` table (knots), one tuned entry per fixed-wing type. They are **simulator tuning, not certified speeds**:
  - Caution sits at or just above the type's full-power level speed, with any afterburner lit and fixed-gear drag included.
  - Overspeed sits roughly midway between that speed and the dive ceiling.
- **Dive ceiling**: the steady speed of a full-power dive at the type's nose-down pitch limit (60° for free-attitude types in the measurement), capped by `maxSpeed`.
- An untuned future type falls back to the same placement, derived from its own numbers.
- **Not a limit**: `speedScale` stays the display range only. Where the red line would not fit on that scale with 10 kt to spare, the tape grows. The Vela J8 goes from 190 to 300 kt; the Brenta B6, Neris P2, Rava R6 and Cervin P6 grow too.
- **Hysteresis**: a state clears only 4 kt back inside an upper threshold, or 3 kt above the low margin. Every caution speed is more than 4 kt above full-power level speed, so after a dive, level flight at full power always clears.
- **Suppressed**: the monitor reads "off" in these cases, and the latch is cleared so nothing carries over:
  - grounded or crashed
  - paused, or under a dialog
  - a finished mission
  - a restart (the flight timer goes back) or a new aircraft
- **Rotorcraft** have no envelope. Their tape keeps its original speedScale meaning.

## Measured

`node scripts/measure-airspeed.js` reproduces this table. The last column is seconds from cruise to the warning in a full-power dive at the pitch limit (60° nose down for free-attitude types), at 120 Hz. Every type warns before its `maxSpeed` clamp.

| Aircraft | Stall clean / full flaps kt | Low margin clean kt | Cruise kt | Full power level kt | Caution kt | Overspeed kt | Dive ceiling kt | Clamp kt | Tape kt | Dive to warning s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vela J8 | 82 / 70 | 98 | 194 | 245 | 255 | 270 | 286 | 292 | 300 | 10.2 |
| Arolla F7 | 109 / 89 | 131 | 332 | 540 (burner) | 545 | 550 | 554 | 554 | 560 | 15.6 |
| Boeing 737-800 | 128 / 105 | 154 | 249 | 315 | 320 | 335 | 345 | 379 | 380 | 19.4 |
| Mira T2 | 49 / 37 | 58 | 99 | 126 | 132 | 140 | 147 | 165 | 160 | 7.0 |
| Brenta B6 | 39 / 27 | 47 | 86 | 111 | 115 | 125 | 131 | 142 | 140 | 6.8 |
| Sarine C24 | 82 / 66 | 98 | 171 | 218 | 225 | 235 | 245 | 276 | 250 | 9.8 |
| Orsino R70 | 107 / 87 | 128 | 225 | 286 | 295 | 305 | 316 | 350 | 330 | 13.8 |
| Aven W280 | 136 / 113 | 163 | 275 | 350 | 355 | 365 | 377 | 424 | 420 | 19.6 |
| Silex A3 | 62 / 62 | 75 | 146 | 190 | 200 | 225 | 249 | 249 | 240 | 6.4 |
| Neris P2 | 58 / 58 | 70 | 156 | 202 | 210 | 220 | 234 | 249 | 240 | 10.1 |
| Veyra U9 | 58 / 43 | 70 | 151 | 195 | 200 | 210 | 219 | 229 | 220 | 9.5 |
| Montis C90 | 89 / 70 | 107 | 198 | 253 | 260 | 265 | 276 | 292 | 300 | 18.3 |
| Varen G18 | 37 / 31 | 44 | 67 | 79 | 85 | 105 | 121 | 121 | 130 | 10.9 |
| Alba B2 | 39 / 39 | 47 | 85 | 110 | 115 | 120 | 130 | 140 | 130 | 5.2 |
| Valnera Q100 | 89 / 66 | 107 | 205 | 260 | 265 | 275 | 288 | 321 | 300 | 12.9 |
| Rava R6 | 74 / 58 | 89 | 229 | 295 | 305 | 320 | 336 | 342 | 350 | 8.3 |
| Cervin P6 | 58 / 47 | 70 | 148 | 191 | 197 | 205 | 217 | 241 | 230 | 9.5 |
| Taris F12 | 117 / 97 | 140 | 342 | 517 (burner) | 525 | 545 | 568 | 568 | 560 | 11.5 |

`tests/airspeed-envelope.test.js` covers the following:

- per-type limit ordering against each type's numbers
- clean and flapped margins against the model's own stall
- landing-mission approach speeds staying out of "Low speed"
- entry and exit at every threshold, and noise across a threshold changing state at most once
- dive reachability for all 18 fixed-wing types, then recovery through the caution band to normal
- 150 s of assisted cruise and full-power level flight (afterburner lit on the Arolla F7 and Taris F12) never leaving normal
- representative light (Mira T2), jet (Vela J8), heavy (Aven W280) and aerobatic (Silex A3) bands
- suppression on the ground, after a crash, when inactive and in rotorcraft
- resets

## Browser check

Headless Chromium through `forge serve` (Vite dev on 0.0.0.0:5173), Low quality, **SwiftShader software WebGL** at 1–2 FPS. These checks say nothing about frame rate on real hardware. At that frame rate the screenshot tool timed out, so the render loop was stopped (`requestAnimationFrame` replaced) only after the HUD had updated from live state.

Speed, altitude and flaps were held by wrapping `FlightController.prototype.update` from the console. Hand-flying a dive at 1 FPS is not repeatable; the Node tests fly the real dives.

Screenshots in `docs/airspeed-envelope/`:

- **1600×900**: Vela J8 at 276 kt shows the Overspeed label and the OVERSPEED notice.
- **1280×800**: Vela J8 at 78 kt with 30° flaps shows Low speed, with the shorter flapped bands.
- **390×844**: Aven W280 at 370 kt with the gear up below 1,000 ft. GEAR and OVERSPEED stack without overlapping. An earlier two-line top-slot notice overlapped GEAR, which is why the phone rule moved it.
- **1600×900, flight panels hidden**: Silex A3. At 60 m AGL descending, TERRAIN wins. At 400 m the notice switches to OVERSPEED. Pausing clears the label and notice, and resuming restores them.

No console errors appeared.

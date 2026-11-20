# Mira T2 takeoff practice

Explore → **Takeoff practice · Mira T2 · Alpine Field 36** opens the brief. Other aircraft stay selected until the pilot explicitly chooses **Switch to the Mira T2**. Start parks the clean Mira on runway 36, 100 m beyond the threshold, at idle in calm air. No assist, flaps or trim setup is needed.

Hold Shift (or +) for full power, steer straight and gently raise the nose near 60 kt with S / ↓ or the yoke. After liftoff ease off to a 5–10° nose attitude. Reach 150 ft above the runway, then hold a controlled climb for 3 continuous flight seconds: 62–126 kt, power ≥80%, pitch 2–18°, bank ≤15°, heading within 20° of 360°, vertical speed ≥1 m/s (about 200 ft/min), no stall. The timer resets whenever a target is missed. These are forgiving arcade gameplay targets, not operating limits or real flight instruction.

The unchanged Mira model rotates above 30 m/s clean and stalls near 25 m/s. The exercise's 31 m/s rotate cue and 32–65 m/s climb range leave speed margin. Ordinary power and pitch commands through `FlightInputs`, on the world's actual terrain, consistently complete in about 20 seconds without assist. The automated pilot writes no position, speed, attitude or score state after start. Keyboard mode uses full-deflection taps and releases; yoke mode uses proportional pitch. Tests exercise both at 30, 60 and 144 fps.

`node scripts/measure-takeoff.js` reproduces [six measured flights](takeoff-practice/measurements.jsonl). `node --import ./tests/init-wasm.js scripts/measure-takeoff.js` exercises the same pilot on WASM.

Feedback records the distance actually rolled from the start until the first airborne slice, liftoff airspeed, signed nose alignment relative to runway 36, and signed centreline offset. A failed roll reports distance rolled and **Not recorded** for liftoff observations. It never substitutes a target speed or the length of the runway for a measurement.

Retry and R reset this exercise to the same stopped start, with the pilot's wind still saved. Free flight, a different activity, an aircraft switch or external controller reset releases the borrowed wind once. A Weather selection made during the exercise is saved for exit. Active and finished attempts both observe resets. Starting this exercise ends the previous activity before borrowing calm wind; unsupported starts leave the current flight untouched.

A crash, leaving the runway before liftoff, ground contact after liftoff, a flap change, or 90 seconds without completion ends the attempt. Assist is checked before physics and at every UI engagement, including heading hold and the Settings switch, so an on/off toggle inside a frozen dialog cannot earn completion. Pausing, dialogs and a hidden tab stop progress through the existing simulation gate. Finished results freeze physics.

The new component is optional in `Activities`; canonical ranked-v1 simulations keep their four original components. No flight physics, WASM binaries, ranked starts, rules, replay fields, verification metrics, persistence or online boards change. An additional integration regression compares every ranked start with/without an attached, previously active takeoff component and rejects a takeoff board.

## Validation

- `npm test`: **799 tests passed**, full repository suite.
- `node --import ./tests/init-wasm.js --test tests/takeoff-practice.test.js tests/stall-recovery.test.js tests/crosswind-practice.test.js tests/wasm.test.js tests/ranked-runs.test.js`: **92 tests passed**, exercise, lifecycle, numerics and ranked replay regressions.
- `npm run build`: includes `check:wasm` and the production Vite build.
- Browser MCP, real app on port 5173, WASM flight and terrain. A controlled clock accommodates software WebGL; keyboard events go through the production input queue. A completed flight measured **131.66 m**, **63 kt** liftoff, **0°** nose alignment / **0 m** offset, and finished at **20.80 s**, after **3 continuous seconds** of climb above 150 ft.
- Browser lifecycle: pause held the complete flight/activity snapshots unchanged over 5 simulated seconds; an open Weather dialog also froze them while `paused:false`; a hidden-tab gate froze flight time. A new wind choice remained saved while live wind stayed calm, then returned on exit. Toggling Settings assist on/off while airborne in one dialog failed the attempt; Retry returned to time zero on the runway. An aircraft switch cleared ownership and restored the saved wind.
- First-screen layout inspected at 1600×900, 1280×800 and 390×844. No horizontal overflow. At 390 px, active card y=72–291, touch controls y=516–624, instruments y=638–814. The brief fits y=42–802; the result fits y=162–614. All primary actions remain reachable.

## Visual evidence

- Brief: [desktop](takeoff-practice/brief-1600.png), [phone](takeoff-practice/brief-390.png), [explicit aircraft switch](takeoff-practice/aircraft-switch-1600.png).
- Active: [desktop](takeoff-practice/active-1600.png), [small laptop](takeoff-practice/active-1280.png), [phone](takeoff-practice/active-390.png).
- Actual successful browser flight: [desktop result](takeoff-practice/result-1600.png), [phone result](takeoff-practice/result-390.png).

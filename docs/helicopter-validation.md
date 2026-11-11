# Laret H4 validation

Based on origin/main `076f2ff0b8ffaf87699f56f8d96c483829b31468`, including merged water depth precision #10 and smooth controls #11. No dependencies or downloaded aircraft assets were added.

## Behavior

Select **Laret H4** in Explore. Airborne/reset starts in a stationary hover at 58% collective and flight rotor RPM, with hover hold enabled by the UI. Ground start parks on fixed skids with the rotor stopped. Collective spins up the governed rotor and lifts vertically without a takeoff roll or minimum airspeed. Cyclic tilt creates world-space momentum, with damping and modest lift compensation. Centering cyclic levels the aircraft; Space brakes back to the captured position and holds altitude and heading. Any manual cyclic, yaw or collective input takes over.

- W/S: cyclic forward/backward; A/D: cyclic left/right; Q/E: yaw left/right.
- Shift/Ctrl, the slider, or phone +/−: collective/lift. 58% hovers; the phone lever shows its percentage.
- Phone cyclic follows drag direction; two extra pointer controls provide yaw. Cancel, blur, dialogs, pause, reset and switching clear input commands through the existing timestamped input path.
- Fixed skids remain down. Gear and flap buttons are disabled; G/F explain that the helicopter has skids and no flaps. No fixed-wing stall or gear horn applies.
- HUD airspeed is the magnitude of actual velocity, including vertical and lateral motion. VSI uses its vertical component; G-force uses the measured acceleration plus gravity along the aircraft up axis. The helicopter cockpit panel is live.
- Synthesized turbine/rotor wash and blade-pass pulse follow rotor RPM and collective load. Mute, pause and crash silence the audio output; paused/crashed rotors stop animating.

## Automated checks

`npm test`: 89 tests pass (79 existing plus 10 helicopter behavior/integration tests). New cases cover 120-second manual and assisted hovers, climb/descent, airspeed and specific force, all cyclic directions, independent yaw, cyclic after a heading change, braking into hover from forward flight, manual takeover, ground spool-up and vertical takeoff, gentle/hard/fast/tilted/sloping-terrain/water collisions, frozen crash state, reset/switching among all three types, procedural model dimensions/reflections/rotor animation/resource disposal, and synthesized audio buses/warnings/mute.

Timestamped 100 ms taps, holds, release and opposite corrections are exercised in both directions for every axis at 10, 15, 30, 60 and 120 Hz. The fixed-wing suite continues to cover stall/gear horn behavior, turbine response, takeoff/landing performance and repeated unrestricted fighter loops and rolls.

`npm run build`: passes. Vite retains its bundle-size advisory. `git diff --check`: passes.

## Browser checks

Headless Chromium, actual fleet buttons, keyboard events, range-slider keyboard input, camera controls and phone pointer controls:

- All three aircraft: chase and cockpit views at 1600×900, 1280×800 and 390×844; all 18 combinations rendered with viewport-sized documents and no overflow. Helicopter rotor span stays in frame, the cockpit pedestal clears the HUD, and the one-metre near plane is preserved.
- Helicopter: W/S/A/D/Q/E/Shift/Ctrl short taps versus holds and release; touch cyclic, yaw and collective; hover hold takeover; ground start with stopped rotor; vertical takeoff; hover; gentle skid landing; subsequent high-power takeoff and deliberate idle-power hard landing with crash overlay; reset; G/F no-ops; persisted selection after reload; saved helicopter logbook identity.
- Jets: real roll inputs, gear/flap operation, throttle reduction and stall banners for both Vela J8 and Arolla F7. Gear warning appears and clears with gear operation. Fleet switching restores fixed-wing labels and enabled gear/flap controls.
- Web Audio nodes observed after enabling sound through its button: helicopter bus selected, live master gain around 0.65, pause fade below 0.001, crash and mute gain zero. Automated audio tests cover type switching and fixed-wing warning horns. This verifies routing and gain behavior, not the subjective sound of speakers/headphones.
- Clean reload and interactions recorded no application page errors. An earlier temporary browser observer mistakenly called `textContent` as a function; it was corrected and the warning capture rerun successfully.

Screenshots and raw browser snapshots are supplied with the thread report under `helicopter-validation/`. For camera review only, screenshot capture hides the pause overlay and transient toast; the scene is otherwise the actual rendered app.

## Limits

This VM uses software WebGL: typically about 1–4 FPS in Performance mode, with High graphics stalling interaction. Screenshots, UI behavior and deterministic 10–120 Hz physics checks are meaningful; hardware-accelerated frame rate, subjective rotor sound and high-rate physical touch behavior still need a real device. Browser event delivery and simulated time can lag wall time under this renderer.

This is an accessible rotor-lift approximation, not training software. It intentionally omits autorotation, torque coupling, vortex-ring state and detailed blade aerodynamics. Collision checks use the aircraft origin plus skid-footprint slope checks rather than full swept rotor/body collision geometry.

# Sorna H8 validation

Based on origin/main `63dd67bffb5efac95a95728eedc160ce84bac2a3` (includes the Neris P2 #17 and Veyra U9 #21). No dependencies, downloaded models or image assets were added; the airframe, cockpit and sound are generated in code.

## What changed

- `transport` joins the fleet as the **Sorna H8** (A-SH08, badge TRNS) beside the unchanged **Laret H4**. The roster heading still counts the fleet (13 to fly); the original six `EXPANDED_AIRCRAFT` ids are unchanged.
- It flies on the existing rotorcraft path (`stepHelicopter`). Optional per-type values default to the H4's previous constants, so the H4 behaves exactly as before: `yawResponse` (6), `levelRate` (1.6), `footprint` ([1.2, 1.2] m), `rotor` sound/animation geometry (3 blades at 38 rad/s, 600 Hz turbine base) and `landingGear` (`skids`).
- H8 tuning: 62% hover collective, lift response 1.7 (H4 3), rotor spin-up 0.62 (H4 1.1), collective lever 0.18/s (H4 0.22), pitch/roll rate 0.34/0.38 rad/s with response 3.8 (H4 0.48/0.55, 6), yaw 0.42 rad/s with response 3.4 (H4 0.65, 6), tilt limits −0.42/+0.36 and ±0.42 rad, levelling 1.2. Touchdown below 4.5 m/s horizontal (9 kt) and 1.9 m/s sink (370 ft/min) on fixed wheels 1.78 m below the origin.
- Landing mission profiles carry `settlePower` (hover − 1%: 57% for the H4, 61% for the H8) and `contact` (`skids`/`wheels`). The mission card, brief, result text, gear button/label, G toast and controls help read hover/settle numbers and gear wording from the active type instead of H4 constants. Gear and stall warnings remain off for every rotorcraft.
- Audio: `helicopterSound` takes the type's rotor geometry; the H8's five blades at 27 rad/s give a 21.5 Hz blade pass and a lower rotor and turbine tone. The H4 mix is identical to before.

## Automated checks

`npm test`: 232 tests pass (216 on the base, plus 14 in `tests/transport.test.js` and 2 new shared landing tests). The shared landing suite covers every registered type, including the H8's normal-control descent and settle; its rotorcraft regressions (landing box, lateral speed, settle collective, real crash telemetry and true-hover start) now run for both helicopters. The shared pilot lowers collective relative to each type's hover instead of a fixed 55%.

H8 cases: identity and truthful wheel/hover text, H4 tuning snapshot, zero-speed 120 s manual and assisted hover, collective climb/descent and slower lift response, forward/backward/sideways cyclic and levelling, independent yaw, 100 ms taps on all four axes at 10–120 Hz (small, released and frame-rate independent), hover hold from forward/sideways/backward flight and manual takeover, ground start with slower rotor spin-up and vertical lift-off, gentle wheel landing versus hard/fast/tilted/sloped/terrain/water crashes, landing mission success/failure/retry with normal inputs and wheel wording, switching among both helicopters and a jet, model dimensions, five main and ten tail blades, wheels at the clearance datum, rotor animation and stop, cockpit hide, resource disposal, cockpit surfaces beyond the 1 m near plane with the panel inside a phone's field of view, and audio routing without stall or gear horns.

`npm run build`: passes (Vite keeps its existing bundle-size advisory). `git diff --check`: passes.

## Browser checks

Headless Chromium against the dev server, Low graphics, real Explore roster clicks and keyboard events:

- Selector: the roster lists 13 aircraft with Sorna H8 last; selecting it updates the flight card, HUD (Collective, Gear FIXED, Flaps N/A), key hints and the saved setting, and it is still selected after reload. Switching to the H4 restores Skids wording and its original landing brief (58%/55%/57%, below 10 kt).
- Chase, cockpit and orbit at 1600×900, 1280×800 and 390×844: documents stay viewport-sized; the full 14 m rotor disc fits the centred phone chase and orbit views; the cockpit keeps the windscreen open with its panel low (on phones it sits under the touch controls, as other decks do).
- Flown with keys: 100 ms taps on W/S/A/D/Q/E/Shift/Ctrl leave fine corrections (0.5–0.6° of pitch or bank, 0.8° of heading, 1.6% collective) and release cleanly; held cyclic moves the aircraft in each direction; Space brakes back into a hover.
- Ground start: parks on its wheels with a stopped rotor; held Shift spins the rotor up (45% → 78% → 92% RPM) and it lifts vertically with no lateral drift. Lowering collective to 54% descended at 320 ft/min to a gentle touchdown; a later held-Ctrl descent crashed as a hard landing; held Ctrl over the lake ended in a water collision. Both showed the crash overlay.
- Landing mission: the brief and card show 62%/59%/61%, below 9 kt and wheel wording. Ctrl taps alone flew it to success (188 ft/min, 0 kt, on the centreline); Retry, a held-Ctrl drop (failed: unsafe sink) and R each restore the same hover.
- No page errors or console errors; only software-WebGL readback warnings from screenshots.

## Limits

This VM renders with software WebGL at 1–4 FPS, and the per-frame step cap means sim time ran at roughly 0.3–0.55× wall time in the browser checks. That makes browser flying slower but still meaningful; physics magnitudes come from the deterministic tests. Hardware frame rate, subjective rotor sound and physical touch handling still need a real device. Rotor/body collisions use the aircraft origin and a footprint slope check, not swept-rotor geometry. Like the H4, the H8 is an accessible rotor-lift approximation without autorotation, torque coupling or vortex-ring state.

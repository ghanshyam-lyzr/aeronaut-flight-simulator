# Boeing 737-800 validation

Validated on 11 November 2026, rebased onto main `b7f9612` (including helicopter #12, smooth controls #11 and water-flicker #10). This PR adds one aircraft; it does not modify the world, input ramp, camera near plane or helicopter flight/model files.

## Source and visual model

The Boeing [737 Next Generation airport planning manual](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf), D6-58325-7 Rev C, October 2025, §2.2.6 (printed page 2-14, PDF page 35), was read and its drawing rendered to check the wingleted 737-800 silhouette. The procedural model targets 39.47 m length, 35.79 m span, 12.55 m nominal ground height and 3.76 m fuselage width. It has a conventional tail, underwing turbofans, passenger windows, entry and overwing exits, blended winglets and an original Aeronaut livery. No Boeing drawing, downloaded model or external image is included.

The model animates both fan rotors, four flap panels, ailerons, elevators, rudder and five-second tricycle gear travel. Main and nose legs have twin wheels. Its ground datum includes the airfield's raised runway surface, matching the existing fleet's convention. The cockpit uses a centre windshield post and paired columns, with live instruments on the HUD.

## Automated checks

- `npm test`: 107 passed, zero failed. Includes all existing jet, fighter aerobatics, controls, warnings and helicopter tests.
- Airliner tests cover switching/reset, cruise and slower response/spool, takeoff without a speed jump, approach/landing and hard touchdowns, flap-dependent stalls, gear thresholds, short taps at 10–120 Hz, model bounds and animations, livery colours, disposal and twin-engine audio/mute/crash handling.
- The existing warning tests now include the airliner: exact stall boundaries at all flap settings, the 1,000 ft / 20% gear boundaries, horn rearming and pause/crash/mute behavior.
- `npm run build` passes. Vite reports its existing large-chunk advisory.
- `git diff --check` passes. The running preview answers HTTP 200, including a `.run.app` Host header.

At 60 physics steps/s, a full-power takeoff with 15° flaps rotated at 130.34 knots after about 465 m / 18.22 s of roll. Full flaps, gear and 45% power settle near 140 knots. These are deliberately forgiving **gameplay** targets for the 1,100 m valley runway, not real 737 performance data.

## Browser checks

Rendered and inspected chase, cockpit and orbit views at 1600×900, 1280×800 and 390×844. The full airframe stays in frame, phone chase framing remains centred, the cockpit retains a clear horizon without near-plane cuts, and the phone has no horizontal overflow. The runway frame confirms visible tyres on the surface. Orbit dragging and zooming work; the 737's grounded orbit camera is kept above the ground.

Used the actual Explore selector for helicopter → fighter → light jet → airliner after rebasing. All four names and persisted IDs agree; helicopter collective/fixed-skid controls switch back to throttle/flaps/gear for the 737. Reload restores the airliner. Reset and runway start keep it selected. Logbook labels use the same fleet metadata.

Actual keyboard controls completed a 737 runway takeoff. An idle-power descent produced a stall and then both STALL and GEAR banners below 1,000 ft AGL, visibly separated on the phone. Lowering gear cleared its warning. Sound enabled and muted through its button. A brief manual bank input disengaged assist and produced a fine correction. No runtime console errors appeared after a clean reload of the final source.

The sandbox uses software WebGL (roughly 1 FPS at laptop size and 3–4 FPS on phone), with driver ReadPixels performance warnings. Paused reference screenshots hide only the pause card to expose the airframe; the live warning and takeoff frames use real running state. This does not establish hardware-rendered frame rate or subjective audio fidelity. Landing limits and fine 30/100 ms tap timing are verified deterministically in tests, rather than claimed from low-FPS manual flying.

## Limits

This is an original visual approximation with arcade flight handling, not a study-level 737 simulation. No FMC, detailed fuel/hydraulic/engine systems, real-world V-speed calculation or added autopilot systems. Cockpit face artwork is decorative; HUD airspeed, vertical speed and G-force are live. Synthetic audio uses the existing two-compressor turbofan bus with lower tones and a fuller rumble; the helicopter retains its own rotor bus.

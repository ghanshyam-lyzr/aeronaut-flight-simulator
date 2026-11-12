# Fleet expansion validation

Based on main `00d3530` including landing mission #15. Adds six original aircraft to the four existing choices. No dependencies, external assets, mission types or world/flight-input rewrites. The one-metre near plane and water rendering are unchanged.

## Aircraft

- Mira T2: high-wing piston trainer, fixed tricycle gear, blue livery, gentle self-stabilising controls.
- Brenta B6: broad braced high wing, oversized tyres, fixed tailwheel, amber livery, low-speed STOL tuning.
- Sarine C24: twin six-blade turboprops, high wing and T-tail, retractable gear, forest livery, moderate turbine response.
- Orsino R70: rear-mounted fans, swept winglets and T-tail, slate/coral livery, responsive regional-jet tuning.
- Aven W280: broad cabin, large underwing fans, raked tips, four-wheel main bogies, teal/gold livery, slow spool and deliberate controls.
- Silex A3: tapered low wing, bubble canopy, fixed tailwheel and no flaps, red livery, unrestricted body-axis loops and rolls.

Each has explicit performance and approach data, complete metadata, live analogue or glass cockpit instruments, camera offsets/scales, moving surfaces and rotors, engine sound routing, saved selection and flight-log identity. Speeds and runway distances are gameplay targets for the valley, not operating data.

## Automated checks

`npm test`: **188 passed, zero failed**. Includes the full previous jet, fighter aerobatics, controls, warning, helicopter, 737 and landing-mission suites.

New deterministic cases use actual procedural terrain and ordinary flight inputs. All six new types cruise steadily, take off inside the runway, stall at their own clean thresholds and recover with power. All ten aircraft complete the landing mission's approach, flare, touchdown and rollout using a feedback pilot through FlightInputs; fixed-gear/no-flap toggles cannot invalidate the applicable landing configuration. All six new types fail a deliberately hard normal-input approach and retry cleanly. Normal-input takeoff rolls were approximately 92 / 42 / 193 / 325 / 527 / 93 m respectively (trainer, bush, commuter, regional, widebody, aerobatic).

30/100 ms taps on all four axes, both directions, are compared at 10/30/60/120 Hz. Small corrections survive slow rendering. Fighter and Silex complete continuous loops and rolls. Geometry, prop/fan counts, ground clearance, flap/control-surface animation, gear travel, cockpit visibility and unique resource disposal are checked per new model. The airframes use 30–76 meshes and roughly 16–44k triangles; lowered tyres meet the raised runway surface within one micrometre of the existing datum.

Sound tests cover piston/turboprop/jet distinctions, routing, fixed-gear horn suppression, mute and crash. `npm run build` passes; Vite retains its large-bundle advisory. `git diff --check` passes.

## Browser review

Preview runs through `forge serve` on **0.0.0.0:5173**. Used actual selector buttons for every one of the ten aircraft on desktop and phone; selection, name, saved ID and correct enabled/disabled gear/flap controls agree. Keyboard roster arrows/Home/End work and retain focus. Mira selection restores after reload. Saved Mira and Silex flights show their proper names in the logbook.

Rendered every new airframe in chase, cockpit and orbit at 1600×900; representative cockpit/chase/orbit/ground views at 1280×800 and 390×844. The bounded roster is 320 px high on desktop and 280 px on phone; the 390 px document has no horizontal overflow. Keyboard G/F exercise fixed gear, retractable gear and absent flaps truthfully; mission HUD reads “Gear fixed · no flaps” for Silex. Engine sound was enabled/muted via its actual button. Browser Web Audio was running with nonzero output for each new type; pause gain decays toward zero. No runtime console errors appeared.

The accompanying `fleet-expansion-qa/` folder contains representative screenshots. For unobstructed camera captures the pause overlay was hidden in the DOM while physics remained paused; this is a capture-only adjustment. Some screenshots retain transient camera notices.

## Limits

Chromium uses **ANGLE SwiftShader (software Vulkan/WebGL)**. It emits GPU readback-stall warnings and runs slowly here, so hardware GPU performance has not been benchmarked. Screenshot/click/keyboard checks and short free-flight interactions are automated; they are not sustained manual flying or manual landing runs. Deterministic normal-input tests supply repeatable flight/mission validation. Audio routing and nonzero samples were measured; speaker/headphone timbre was not reviewed by listening.

This remains the existing arcade flight/rolling-resistance model, with simplified tailwheel ground stance and origin/clearance collision detection rather than a full airframe contact simulation. No added water-landing system or aircraft systems simulation.

# Terrain look-ahead

The TERRAIN warning now looks ahead along the aircraft's actual travel, so it can call out a ridge before the aircraft is low over it. It is read-only: flight physics, collisions, landing scoring and the stall and gear warnings are unchanged. The code is in `src/terrain-alert.js` and is wired into `updateUI` in `src/main.js`.

## How it works

- **Path.** `flightPathVelocity` (the flight-path marker's reconstruction) gives the velocity. It rebuilds the fixed-wing velocity from heading, pitch, speed and vertical speed, because fixed-wing `state.velocity` is stale in flight. For helicopters it uses their integrated velocity, sideways and backwards travel included. The path is that velocity extrapolated in a straight line, including the vertical motion. Turns are not predicted.
- **Ground.** `world.heightAt` gives the ground: the procedural terrain, clamped to the water level, which is what rendering and collisions use. Clearance is measured above the wheels or skids (`groundClearance`).
- **Bounded sampling.** Each sample makes 16 probes along the path plus one under the aircraft, so at most 17 height lookups. Samples run at most once per 0.25 flight seconds, which caps the cost at 68 lookups per flight second. A paused flight is never resampled. Fixed-wing aircraft look 20 s ahead, capped at 4 km, so probes are at most 250 m apart. Helicopters look 10 s ahead, capped at 600 m.
- **Conflict.** A probe conflicts when its predicted clearance is under the **margin** and the clearance has shrunk by at least the **closure** since the current position. The margin is 45 m (about 150 ft) for fixed-wing aircraft and 10 m for helicopters. The closure is 15 m and 4 m. The closure rule keeps level low flight over flat ground quiet, because the clearance does not change.
  - **Rising terrain:** the ground at the probe is at least half the closure higher than under the aircraft. A conflict 9 s away or less (4 s for helicopters) is a **warning**. Further out it is a **caution**.
  - **Descent into flat ground:** this counts only when impact at the current sink rate is within 6 s (fixed-wing), or within 3 s while sinking faster than 2 m/s (helicopters). It is always a warning.
  - **Actual intersection:** a probe where the path meets the ground (clearance at or below zero) skips the margin and closure rules, which exist only to keep near misses quiet. The contact time is interpolated between probes. Ground above the wheels' current height (so even level flight would meet it) counts as rising terrain. Otherwise it is a descent, under the same 6 s / 3 s and 2 m/s rule, so gentle helicopter settling stays quiet. Probes beyond the contact point are ignored. Before this rule, a jet 2 m above flat ground approaching an 8 m rise 5 s ahead, or sinking 0.5 m/s with 4 s to contact, saw no alert because its clearance shrank by less than 15 m.
- **Runways, at every field (mission or not).** These rules apply when the aircraft is descending with the gear down and its track is within 20° of either runway direction:
  - Where the path meets the ground on that runway (or up to 100 m short of it), the meeting is a landing. Probes on the runway and beyond it are ignored.
  - In the 3 km approach corridor before the threshold (runway width plus 15 m, splaying 10% each side), only ground within 5 m of the path counts (2 m for helicopters). That means a bank or ridge actually blocking the glide path. A normal glide path over ground rising to the field stays quiet.
  - An active landing mission does not switch detection off. A ridge across its final still warns, and terrain anywhere outside the corridor is checked as usual. Takeoffs climb, so they get no corridor.
- **Hysteresis.** An alert escalates at once. It steps down only after 1 flight second without its cause. While it shows, the margin widens by 15 m (4 m for helicopters), so a path skimming the margin does not flicker.
- **Suppressed** on the ground, after a crash and once a mission is finished. The alert forgets everything when flight time runs backwards (a reset, teleport or mission start) or the aircraft changes.

## Notice

The existing flight notice carries the alert. The stall warning still takes priority.

| Level | Text | Style |
| --- | --- | --- |
| Caution | Terrain ahead · Climb or turn away | Ivory text, one-pixel danger-coral outline |
| Warning | TERRAIN · Pull up (helicopters: TERRAIN · Raise collective) | Danger-coral text, as before |

On phones, terrain notices now sit below the mission card, the map and the GEAR banner (`top: 264px`, as the stall banner does). In a landing mission they keep the existing landing-mode position. I checked the layout at 1600×900, 1280×800 and 390×844.

## Before and after on a real ridge

`node scripts/measure-terrain-alert.js` reproduces these numbers. The run starts the Vela J8 1 km north-west of Alpine Field over the lake, at 160 m with flight assist holding its height and a 315° heading. It flies toward the north-western range, which rises from the shore about 4 km out to roughly 620 m by 5.5 km.

| Case | Old rule (below 100 m AGL) | Caution | Warning | Outcome |
| --- | --- | --- | --- | --- |
| Level toward the ridge | 3.5 s before impact | 21.2 s before impact | 10.4 s before impact | Impact at 35.8 s |
| Pilot climbs (full power, pull 0.3) at the first caution | — | at 14.6 s | never | Clears the ridge; alert clears at 16.4 s |

The old rule also warned anywhere below 100 m AGL, for example on a harmless low pass over a lake. The look-ahead stays quiet there.

## Measured sampling cost

The same script times `sampleTerrain` on the real terrain: 15–20 µs per sample (17 lookups) in Node v22 on this sandbox VM, which is about 0.06–0.08 ms per flight second at four samples a second. These are Node timings on one VM. They are not claims about browser or end-user hardware. The hard bound that holds everywhere is the lookup count above. The tests assert that bound for jets, fighters, airliners and helicopters.

## Tests

`tests/terrain-alert.test.js` covers:

- a ridge ahead vs behind, and travel following the reconstructed velocity rather than the stale `state.velocity`
- a climb that clears the ridge vs the same height level, and descents over falling ground
- level low flight vs a dive into flat ground
- actual intersections inside the closure: a jet 2 m up meeting an 8 m rise, and a 0.5 m/s descent from 2 m, both warned before contact under the alert's cadence; a 1.5 m bump and level skimming stay quiet
- helicopter sideways translation toward and away from a cliff, a hover, and gentle (also while drifting forward) vs fast settling
- the landing pilot flying real approaches to every tested field in both runway directions (fixed-wing and helicopter) with no alert before touchdown and missions not failing
- a ridge across an active mission's final
- takeoff
- ground, crash and suppression
- resets, aircraft changes and hysteresis
- probe, cadence and distance bounds
- the before/after ridge run

An extra sweep, not kept as a test, flew every aircraft to every field in both directions. No terrain alert fired before touchdown. The only mission failures were overruns at Col de Brume by the two airliners, which its field rating already marks unsuitable for them.

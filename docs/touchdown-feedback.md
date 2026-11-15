# Touchdown feedback

Each new wheel or skid contact with the ground now gives a short procedural sound and a brief camera settle. It is presentation only. `src/touchdown.js` reads the impact record that `FlightController.recordTouchdown` already writes (`state.touchdown`: sink, ground speed, flight time). It never writes flight state. Collisions, touchdown thresholds, landing-mission scoring, aircraft motion and handling are unchanged. A test flies a landing with and without the detector and checks that the final state and mission snapshot are identical.

## Detection: once per real contact

`TouchdownDetector.update(state)` runs once per frame in `main.js`, after the flight update. It returns a touchdown record only when all of these are true:

- the record is new. `recordTouchdown` runs only on an air-to-ground contact, so rolling and sitting on the ground never create one;
- the record is fresh: at most `STALE_AFTER` (0.25 s) of flight time old, and not dated in the future;
- the aircraft is now `grounded` and not `crashed`. Crashes keep their own crash overlay and get no touchdown cue;
- the aircraft had been airborne for at least `REARM_AIRBORNE` (0.35 s) of flight time. This means a helicopter skimming and re-touching does not chatter.

Flight time running backwards or a different aircraft id resynchronises the detector without an event. That covers reset (R), mission retries, approach and runway starts, course starts and aircraft changes. `main.js` also calls `resetTouchdown()` from each of those paths. A runway start begins grounded with no record, so it stays silent. A later takeoff and landing re-arms the detector and gives a fresh response.

## Severity and bounds

`severity = clamp(sink / maxTouchdownSink, 0, 1)` uses the actual pre-contact sink against the aircraft's own limit. Severity of 0.5 or more is **firm**; anything lower is **gentle**. Any successful touchdown is below 1, and a crash plays nothing.

| Class | Types | Body thump | Weight |
| --- | --- | --- | --- |
| light | fixed-wing, cameraScale < 1.3 | 124 → 64 Hz | 0.78 |
| medium | fixed-wing, 1.3–2.2 | 98 → 52 Hz | 0.88 |
| heavy | fixed-wing, ≥ 2.2 (737, Aven W280, Montis C90) | 74 → 40 Hz | 1.0 |
| skids | Laret H4 | 108 → 56 Hz, low scrape | 0.74 |
| rotorWheels | Sorna H8, Lodra H20 | 92 → 48 Hz | 0.84 |

- **Sound.** The peak gain is between 0.035 and 0.16 on the volume output. That is below the 0.22 stall horn, and the cue is halved while the stall or gear horn sounds. It is a falling sine thump plus band-passed noise: a tyre chirp at 760–1,150 Hz that rises with ground speed, or a low-passed skid scrape at 420 Hz. Every cue ends within 0.6 s.
- **Camera.** The camera moves along its own up axis only: a dip, a smaller rebound, then rest at exactly the end of the impulse (`impulseShape`). Bounds:
  - Cockpit: at most 4.5 cm. The deck is camera-local, so it moves with the camera and nothing comes nearer than the one-metre near plane.
  - Chase and orbit: at most 12 cm × cameraScale. That is under about 0.3° of view at the chase distance.
  - Duration: 0.22–0.42 s.

  The impulse is added after `lookAt` and removed again at the start of the next camera update. So aim, framing and the lagging orbit camera never accumulate it, and the orbit ground clearance (1.3 m) is reapplied.

Fleet-wide range at 25% → 90% of each type's sink limit (`touchdownResponse`):

| Aircraft | Class | Limit fpm | Gain | Cockpit cm | Outside cm | ms |
| --- | --- | --- | --- | --- | --- | --- |
| Mira T2 | light | 630 | 0.052 → 0.115 | 1.5 → 3.2 | 3.0 → 6.4 | 262 → 340 |
| Vela J8 | light | 591 | 0.052 → 0.115 | 1.5 → 3.2 | 4.1 → 8.7 | 262 → 340 |
| Sarine C24 | medium | 630 | 0.058 → 0.130 | 1.7 → 3.7 | 7.9 → 16.6 | 292 → 370 |
| Boeing 737-800 | heavy | 591 | 0.066 → 0.148 | 2.0 → 4.2 | 13.9 → 29.4 | 328 → 406 |
| Aven W280 | heavy | 591 | 0.066 → 0.148 | 2.0 → 4.2 | 15.8 → 33.3 | 328 → 406 |
| Laret H4 | skids | 394 | 0.049 → 0.109 | 1.5 → 3.1 | 3.9 → 8.2 | 250 → 328 |
| Sorna H8 | rotorWheels | 374 | 0.056 → 0.124 | 1.7 → 3.5 | 5.8 → 12.3 | 280 → 358 |
| Lodra H20 | rotorWheels | 354 | 0.056 → 0.124 | 1.7 → 3.5 | 7.7 → 16.3 | 280 → 358 |

## When it is dropped

`touchdownOutputs` decides what plays. Nothing is queued or replayed later.

| Situation | Sound | Camera settle |
| --- | --- | --- |
| Normal flight | yes | yes |
| Paused, a dialog open, or the tab hidden | dropped | dropped |
| Sound off, or audio not yet unlocked (context not `running`) | dropped | yes |
| `prefers-reduced-motion: reduce` | yes | off |

`FlightAudio.playTouchdown` uses the existing AudioContext and its shared synthesized noise buffer. It opens no new context, loads no asset and adds no dependency. One cue sounds at a time. Muting stops a cue that is still sounding, and turning sound back on plays nothing from before.

## Measurements

`node scripts/measure-touchdown.js` reproduces these numbers. It uses the landing tests' feedback pilot at 60 Hz, flying real landing missions to a gentle flare (25% of the limit) and a firm one (80%):

| Aircraft | Flare | Mission | Events | Sink fpm | Severity | Level | Gain | Cockpit cm | Outside cm | ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mira T2 | 0.25 | success | 1 | 150 | 0.24 | gentle | 0.051 | 1.5 | 3.0 | 261 |
| Mira T2 | 0.8 | success | 1 | 476 | 0.76 | firm | 0.101 | 2.9 | 5.7 | 323 |
| Boeing 737-800 | 0.25 | success | 1 | 188 | 0.32 | gentle | 0.075 | 2.2 | 15.5 | 336 |
| Boeing 737-800 | 0.8 | success | 1 | 493 | 0.83 | firm | 0.139 | 3.9 | 27.8 | 398 |
| Laret H4 | 0.25 | success | 1 | 98 | 0.25 | gentle | 0.049 | 1.5 | 3.9 | 250 |
| Laret H4 | 0.8 | success | 1 | 315 | 0.80 | firm | 0.100 | 2.8 | 7.5 | 316 |
| Sorna H8 | 0.25 | success | 1 | 94 | 0.25 | gentle | 0.056 | 1.7 | 5.8 | 280 |
| Sorna H8 | 0.8 | success | 1 | 299 | 0.80 | firm | 0.113 | 3.2 | 11.3 | 346 |

Circuits on flat ground, flown as one uninterrupted flight each: runway start, takeoff, climb, descend and land, then again.

| Aircraft | Landings | Events | Levels | Grounded frames without an event |
| --- | --- | --- | --- | --- |
| Mira T2 | 2 | 2 | gentle, firm | 1,786 |
| Vela J8 | 2 | 2 | gentle, firm | 2,170 |
| Laret H4 | 2 | 2 | gentle, firm | 760 |
| Lodra H20 | 2 | 2 | gentle, firm | 925 |

## Browser verification (headless Chromium, software WebGL)

Flights were made through the real app, keyboard input and render loop at `localhost:5173`, at low quality. The software renderer ran at about 0.3–0.5 FPS, and each frame advances at most 0.25 s of flight. The flights were therefore flown by a frame-synchronous script tapping W / S (or Shift / Ctrl) for 120 ms, not by hand at a real frame rate. The numbers come from `window.aeronaut.getTouchdown()`.

- **Firm, chase view, Vela J8, free-flight approach to Alpine Field 36.** 397 fpm, severity 0.67, firm. Sound played (context `running`, gain 0.093), camera settle 7.1 cm over 313 ms, event count 1. The count stayed at 1 through the rollout and braking. Screenshot: [touchdown-feedback/firm-chase-1600.png](touchdown-feedback/firm-chase-1600.png).
- **Gentle, cockpit view, Vela J8.** 132 fpm, severity 0.22, gentle, gain 0.049, cockpit settle 1.5 cm over 259 ms. The new approach start added no event. This flare floated and touched down on the meadow just short of the QAAF threshold. That is a valid landing for the flight model, and the screenshots show it as it happened: [1600](touchdown-feedback/gentle-cockpit-1600.png), [1280](touchdown-feedback/gentle-cockpit-1280.png), [390](touchdown-feedback/gentle-cockpit-390.png).
- **Skids, chase view, Laret H4 precision landing, with `prefers-reduced-motion: reduce` emulated.** 82 fpm, severity 0.21, gentle. Sound played; motion was `false` and no impulse ran. The mission succeeded with the same 82 fpm on its result card: [touchdown-feedback/skids-gentle-result-1600.png](touchdown-feedback/skids-gentle-result-1600.png). Retry, the aircraft change before it, and pause/resume (P) all added no event.
- These browser flights were made before rebasing onto the wind model (#43, #45). After the rebase, the Node measurements above were re-run and are identical, and a runway start in the browser loads without page errors and gives no event. The browser landings were not flown again.
- The interface is unchanged at 1600 × 900, 1280 × 800 and 390 × 844: no banner, panel or new control. The console showed no errors, only the renderer's own ReadPixels performance warnings.

### Limits of this verification

- **Sound.** Headless Chromium has no audio output. The browser runs prove that the cue was scheduled on the running context with the gains above. They say nothing about how it sounds. Loudness and timbre against the engine mix, and how clearly the horns cut through, still need a listen on real speakers. The unit tests check the audio graph against a fake context: nodes, gains, timing, ducking, mute and replacement.
- **Camera settle.** At 0.25 s per software frame, a 0.26–0.41 s impulse spans one or two rendered frames. So the browser shows that the impulse starts and clears, not how it moves. The motion is covered by the `impulseShape` tests: bounded, dip first, smaller rebound, rest at the end with no jump. Real hardware at 60 FPS will draw it over 15–25 frames. Nothing here measures frame rate on real hardware.
- **Not flown in the browser.** Paused, dialog and hidden-tab drops cannot happen mid-contact through the app, because the flight does not advance while paused, under a dialog or in a hidden tab. They are covered by `touchdownOutputs` tests. Touch input uses the same flight path as the keyboard and was not flown separately.

## Tests

`tests/touchdown.test.js` has 11 tests and is part of `npm test`. It covers:

- class mapping for every type;
- severity, gain, impulse and duration bounds, monotonic in sink, firm clearly above gentle;
- the impulse shape;
- real gentle and firm missions in four types, one event each, with the same sink the mission scored;
- detector read-only equality;
- sustained contact, parked runway starts, and stale or future telemetry;
- consecutive landings in one flight;
- crash, reset, retry and aircraft change;
- skim re-arm;
- the output matrix for pause, dialog, hidden, mute, locked audio and reduced motion;
- `FlightAudio.playTouchdown` on a fake context: refused before unlock or while suspended, one context, shared noise buffer, after-volume routing, single voice, ducking under both horns, stopped by mute and never replayed after unmute.

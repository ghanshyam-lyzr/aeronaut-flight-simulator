# Fleet variety validation

Based on main `78369d0` (world expansion #31). Adds four original, procedural, fully flyable aircraft to the 17 already in the fleet, so Explore now lists 21 (its heading counts `FLEET`; no number is hard-coded). No dependencies, downloaded models or textures; no flight-model, camera, near-plane, world or UI rewrites.

## Aircraft

| id | Name | Type | Silhouette and motion | Tuning (arcade) |
|---|---|---|---|---|
| `racer` | Rava R6 (A-RR06, RACE) | Piston racing monoplane | Long inline-engine nose with exhaust stubs and chin scoop, four-blade prop, low elliptical wing, bubble canopy, tall fin; retractable tailwheel gear (mains fold into the wing roots, tailwheel aft), flaps, ailerons, elevators, rudder. Ivory, ultramarine, saffron pinstripe. | 229 kt cruise, quick roll (2.5× the trainer) inside normal pitch/bank limits — unlike the free-attitude, fixed-gear Silex A3. Rotate 78 kt (15° flaps), approach 89 kt. Needs 400 m paved. |
| `pushpull` | Cervin P6 (A-CP06, PUSH) | Push-pull touring twin | Short glazed pod with a tractor prop at the nose and a pusher prop at the tail between twin booms, high straight wing, twin fins joined by a high tailplane, fixed tricycle gear; both props animate. Ivory, terracotta, sand. | 148 kt cruise, gentler roll than the Neris P2 and Sarine C24, self-levels when released; flaps, fixed gear. Rotate 62 kt, approach 74 kt. Needs 350 m, grass or paved. |
| `tandem` | Lodra H20 (A-LH20, TNDM) | Heavy tandem-rotor helicopter | 15 m box cabin with flight-deck glazing, ramp outline, sponsons; low front and tall rear pylons carrying two counter-rotating three-blade rotors 11.5 m apart; four fixed wheels; no tail rotor. Ivory, mustard, graphite. | Existing rotorcraft model: 66% hover collective, the slowest collective, rotor spin-up and cyclic in the fleet; wheel and collective wording throughout; lands vertically anywhere. |
| `interceptor` | Taris F12 (A-TF12, INTC) | Twin-engine interceptor | Radome, bubble canopy, side intakes, two engines with two nozzles and two plumes, 40° swept wing, twin canted fins with rudders, stabilators, retractable tricycle gear. Two-tone grey, bronze accent. | Free body-axis attitude (loops, rolls, inverted) like the Arolla F7; heavier: slower roll and acceleration; restrained afterburners above 92% (+42 m/s vs +60). Rotate 130 kt, approach 140 kt. Needs 1,000 m paved. |

Each type has its own data file (`src/<id>-type.js`), model and cockpit (`src/<id>.js`) and model test (`tests/<id>.test.js`). Shared changes are narrow: `fleet.js` and `aircraft.js` register them; `airports.js` adds four `RUNWAY_NEEDS`; `flight.js` routes the fighter bus by `engine === 'fighter'` (so the twin uses it) with an optional per-type `engineVoice`, and doubles blade-pass for a `rotor.tandem`. The racer and push-pull use the existing propeller bus with their own `propVoice`. `landing-mission.test.js` now expects three rotorcraft.

Cockpits follow the fleet decks: a low graphite canvas panel in the gap above the instrument strip on desktops, and a compact strip between the map and the camera chip on phones (`userData.fit`), everything beyond the 1 m near plane.

## Automated checks

`npm test`: **397 passed, 0 failed** (352 on main + 7 racer, 6 push-pull, 6 tandem, 5 interceptor, 12 `fleet-variety`, plus the fleet-wide landing-mission cases that now include the four). `npm run build` passes (the existing large-bundle advisory remains).

- Identity: 21 unique ids, names, registrations and badges; complete flight keys; help and runway hints quote the tuned rotate, approach and touchdown numbers; tandem text says wheels and collective, no skids or fixed-wing instructions.
- Each aeroplane: fresh airborne start holds cruise, real-runway departure with time-based inputs, stall just below its stall speed and power recovery; the takeoff roll and the landing rollout are each ≤ 2/3 of the runway need.
- Racer bank stops at its limit and eases back; gear warning and G work. Push-pull self-levels; G reports fixed gear. Tandem hovers exactly at 66%, climbs more slowly than the Sorna H8, needs rotor spin-up from the ground, lifts off and holds a hover. Interceptor completes more than 1.5 continuous loops and rolls, holds inverted, recovers with Space, lights the burner only at the top of the lever, and is slower than the Arolla with it lit.
- Suitability: racer unsuitable on grass, interceptor unsuitable at Col de Brume and Verdance, tandem recommended everywhere. Departures and full landing missions on both runways of Col de Brume (racer), Verdance Meadow (push-pull) and Orvane Regional (interceptor); a tandem precision landing at Col de Brume.
- Models: bounded size, tyre contact on the runway datum, mesh/triangle budgets, named props/rotors/exhausts/gear, animation, gear timing, flaps and surfaces; swapping jet → four new types → jet releases every geometry, material and texture the previous airframe and cockpit owned. Cockpits stay beyond the near plane and inside the HUD gaps at 1600×900, 1280×800 and 390×844.
- Audio: racer and push-pull on the prop bus with distinct tones, tandem on the helicopter bus with doubled blade-pass, interceptor on the fighter bus with its twin voice; gear horn only for the retractable types; muted on crash.

## Browser review (headless Chromium, software WebGL, Low quality)

On the Vite dev server: chase views of all four at 1600×900; cockpit views of all four at 1600×900 and 390×844; tandem chase at 390×844 (centred, both rotors in frame). Review found the push-pull and interceptor desktop panels hidden behind the instrument strip, phone panels under the touch controls and telemetry card, a stray nose edge across the racer's panel and an oversized cowl blob in the push-pull view; all were fixed and re-checked. Behaviour with real keyboard events: choosing the Lodra H20 in Explore selects and saves it (roster heading "21 to fly"); its Col de Brume landing brief uses wheel/collective wording, and the precision landing flown with Ctrl taps succeeded ("Wheels settled safely", 204 ft/min); the Taris F12 flew a loop with S held (inverted at the top, no crash) and showed both plumes with Shift held; the Rava R6 departed Col de Brume (airborne after 146 m at 85 kt, gear raised with G); the Cervin P6 departed the Verdance grass strip (airborne after ~167 m) and climbed.

## Limitations

- Software WebGL ran at about 1–3 FPS, so the browser checks are short, paused for screenshots and say nothing about hardware frame rate; real-time feel was judged from the simulation, not from smooth playback.
- Engine sound was checked by routing and mix values in tests, not by listening.
- Push-pull engines, the tandem's two rotors and the interceptor's two engines each share one simulated spool or rotor speed, and the panels say so; there is no per-engine failure or asymmetric thrust.

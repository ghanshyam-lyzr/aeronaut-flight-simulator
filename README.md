# Aeronaut

A playable 3D browser flight simulator built with Three.js and Vite. Choose from a fleet of aircraft, from a forgiving high-wing trainer to an aerobatic prop, bush plane, turboprop commuter, fighter, light and medium helicopters and passenger jets, and explore a procedural alpine world with snowy peaks, a turquoise lake, forests, villages, boats, and a working airfield.

## Run

```sh
npm install
npm run dev
```

The development server binds to `0.0.0.0:5173`. Production build: `npm run build`. The generated `dist/` is a static site and does not require a database or sign-in.

## Fly

The simulator opens airborne with flight assist holding heading and altitude. Select **Take control**, or use the flight keys to disengage assistance. The **Explore** menu also offers a runway start and a scrollable aircraft roster; its heading counts the aircraft available. Arrow keys and Home / End select aircraft while the roster has focus. Changing aircraft saves the current flight and starts the new one in the air; restarts and runway starts keep the chosen aircraft, and the choice is remembered in this browser.

The Arolla F7 and Silex A3 have no pitch or bank limits: hold the stick for continuous loops and rolls, and it stays inverted or vertical when you let go. Flight assist from any attitude first rolls and pitches the short way back to level, at no more than about 70°/s, then holds the heading and altitude it has there.

- **W / S** or **up / down arrows**: nose down / up.
- **A / D** or **left / right arrows**: bank.
- **Q / E**: rudder.
- **Shift / Ctrl**: increase / decrease throttle. The instrument slider also works.
- **Space**: flight assistance.
- **C**: chase, cockpit, and orbit camera. Drag and scroll in orbit view.
- **P**: pause. **R**: restart.
- **G**: retractable landing gear. **F**: cycle 0°, 15°, and 30° flaps where fitted. Fixed gear stays down; the Silex A3 and Neris P2 have no flaps.
- **M**: map. **H**: instruments.

On a phone, steer with the touch yoke and hold the + / − buttons to adjust power. In settings, mouse steering and inverted pitch are optional. Flight audio starts when the sound button is selected.

In any aircraft with retractable gear, with landing gear up, flying below 1,000 ft AGL at less than 20% throttle shows **GEAR** on the HUD and sounds a warning horn when flight sound is enabled. Lower the gear, raise throttle to at least 20%, or climb to at least 1,000 ft AGL to clear it. The horn follows the sound toggle and is silent while paused or after a crash.

The engines spool up and down over a few seconds, so lead with power changes. For a runway takeoff, add full power and pitch up after reaching about 95 knots (a little less with flaps). The jet cruises near 195 knots at the default power and stalls below about 82 knots clean, or 70 knots with full flaps. For landing, reduce power to around 45%, lower gear and flaps, keep the aircraft level, and touch down at under 130 knots with less than 600 ft/min descent. The Arolla F7 cruises near 330 knots (over 500 with the afterburner, which lights above 90% throttle), rolls and turns hard, and rotates near 130 knots; fly its approach near 135 knots with gear and full flaps, and touch down below 155 knots and 700 ft/min. Terrain collisions and stalls are modeled. The flight model is an accessible approximation, not certified flight training.

The **Laret H4** starts in a zero-airspeed hover with its rotors at flight RPM. **58% collective** holds a level hover; Shift / Ctrl or the lever raises / lowers collective to climb / descend. **W / S** tilts the cyclic forward / backward and **A / D** tilts left / right for lateral motion. Release cyclic to level; momentum slows gradually, so use opposite cyclic or **Space** to brake into a hover and hold position, altitude and heading. **Q / E** yaws the nose independently. Collective, cyclic or yaw input takes over from hover hold. On phones, drag the cyclic in the direction you want to travel, hold + / − for collective, and use the two yaw buttons to turn. The ground start begins with stopped rotors: raise collective and allow a few seconds to spin up before lifting vertically. Land with level skids below 10 knots of horizontal motion and 400 ft/min descent on fairly level ground. Fixed skids cannot retract; there are no flaps or fixed-wing stall/gear warnings. The rotor sound follows RPM and collective load, and silences on mute, pause or crash. This is an accessible rotor-lift approximation with tilt compensation, damping and hover stabilization; it does not model autorotation, torque coupling, vortex-ring state or certified helicopter performance.

The **Sorna H8** is an original twin-turbine medium transport helicopter: a long rounded passenger cabin with three windows a side and a sliding door, twin turbine housings on the roof, a five-blade main rotor, an enclosed ten-blade tail rotor in the fin and fixed wheeled landing gear on sponsons. It flies on the same rotor model as the Laret H4 but is heavier to handle: **62% collective** hovers, lift follows the lever more slowly, cyclic tilt and yaw build more deliberately, a centred cyclic levels more gently and the larger rotor takes about twice as long to reach flight RPM from a ground start. Short taps stay small on every axis. Land level on its wheels below 9 knots and 370 ft/min; the wheels never retract and there are no flaps, stall or gear warnings. Its live cockpit panel shows airspeed, altitude, VSI, attitude, rotor speed, collective against the hover mark and both turbines' torque.

The **Neris P2** is an original two-seat canard pusher: a long glazed tandem nose, a small forewing whose elevators pitch the aircraft, a swept main wing with ailerons, rudders on twin wingtip fins and a three-blade propeller behind the engine. It cruises near 155 knots, is slow to lose speed at idle, rotates near 68 knots and lands from a 78-knot approach on fixed tricycle gear with no flaps. Its forewing stalls first and lowers the nose; add power and ease back to recover. Pitch and bank stay within gentle limits, like the other touring aircraft.

## Landing mission

Choose **Landing mission** on the flight card or in **Explore**. Every fixed-wing aircraft begins 1.1 km before Alpine Field's runway 36, aligned north in their landing configuration. Approach speeds are Vela J8 109 kt, Arolla F7 136 kt, 737-800 140 kt, Mira T2 64 kt, Brenta B6 52 kt, Sarine C24 103 kt, Orsino R70 128 kt and Aven W280 150 kt. These use 30° flaps; Silex A3 uses its clean wing at 87 kt and Neris P2 at 78 kt. Veyra U9 flies a 72 kt approach with 30° flaps. Fixed gear remains fixed. Follow the chartreuse approach brackets, correct speed with power, and flare gently near 25 ft above the runway. The Laret H4 instead begins in a hover 46 ft above a small skid target at 58% collective; lower toward 55% to descend gently. The Sorna H8 begins the same way above its landing box at 62%; lower toward 59%.

Land inside the outlined touchdown zone, level and within 12° of runway heading. Touchdown feedback retains sink rate, alignment, speed and centreline offset. Fixed-wing aircraft must then remain on the runway, reduce power below 20% and slow below 6 kt for two continuous seconds. Helicopters must settle inside their box with collective just below their hover setting: 57% for the Laret H4, 61% for the Sorna H8. Off-runway, hard, fast or long landings, runway excursions and overruns end the attempt. **Retry** or **R** starts the same approach again; **Free flight** returns to a fresh airborne flight. Aircraft switching cancels the mission. Pause and dialogs freeze mission progress.

The mission uses the existing arcade flight and ground-roll model, including rolling resistance rather than wheel brakes or reverse thrust. These are gameplay targets for the procedural runway, not real aircraft landing procedures. `npm test` includes deterministic approach/flare/rollout scenarios using normal flight inputs for every aircraft in the fleet, plus failure and lifecycle regressions.

## Environment

Clear, golden-hour, and overcast presets affect the sky, sunlight, fog, clouds, and water. Graphics quality controls render resolution, terrain detail, tree density, clouds, and shadows. High quality works best with a hardware-accelerated WebGL 2 browser. The flight log and preferences are saved locally in the current browser.

All scenery, aircraft geometry, textures, and sound are generated in code. The world is inspired by the Swiss Alps; it is not a real geospatial dataset. The original Vela, Arolla and 737 cockpit face textures are decorative; the six newer aircraft, helicopter panels and HUD carry live flight data. Weather presets are simulated. No external imagery or model assets are used.


## Boeing 737-800

The wingleted 737-800 has an original Aeronaut ivory, teal and coral livery, passenger windows and entry/overwing doors, two underwing turbofans with rotating fans, swept wings with four moving flap panels, ailerons, elevators and rudder, and a five-second retractable tricycle gear cycle. Cameras frame its larger span on desktop and phone; its cockpit has a centre windshield post and paired control columns. The HUD remains the source of live airspeed, vertical speed and G-force; the cockpit face artwork is decorative.

Handling is deliberately slower than the Vela J8: pitch and roll response, throttle travel and turbine spool all take more time. For the **game's** runway takeoff, select 15° flaps, advance to full power, then rotate near 130 knots. It cruises near 250 knots at default power. Fly an approach near 140 knots with gear down, 30° flaps and about 45% power; touch down below 155 knots with less than 600 ft/min descent. Clean stall is near 128 knots, falling to about 105 knots at full flaps. The normal stall and low-power gear warnings apply. These are forgiving gameplay targets for the 1,100 m valley runway, **not real 737 operating data**. There is no flight-management computer, detailed engine/fuel/hydraulic simulation or study-level autopilot.

Silhouette and principal dimensions were checked against [Boeing's 737 Next Generation airport planning manual, D6-58325-7 Rev C (October 2025), §2.2.6, printed page 2-14](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf): 39.47 m length, 35.79 m span with blended winglets, 12.55 m nominal height, 3.76 m fuselage width, conventional tail and underwing engines. Geometry is an original procedural approximation; the manual's drawings and assets are not redistributed.
Merge-without-checks probe, 2026-11-11.

## Expanded original fleet

Six original procedural aircraft join the existing Vela J8, Arolla F7, Laret H4 and Boeing 737-800. Cruise, stall and approach speeds are arcade tuning for Alpine Field, not real-aircraft procedures.

- **Mira T2**: blue-and-ivory high-wing piston trainer, struts and fixed tricycle gear. Forgiving response, 100 kt cruise, 64 kt full-flap approach.
- **Brenta B6**: amber-and-ivory STOL bush plane, braced broad wing, large tyres and fixed tailwheel. Short takeoff, 85 kt cruise, 52 kt full-flap approach.
- **Sarine C24**: forest-and-ivory high-wing commuter with two six-blade turboprops, T-tail and retractable gear. 170 kt cruise, 103 kt full-flap approach.
- **Orsino R70**: slate-and-coral regional passenger jet with rear-mounted turbofans, swept winglets, T-tail and retractable gear. More responsive than the big airliners; 225 kt cruise, 128 kt full-flap approach.
- **Aven W280**: teal-and-gold widebody with large underwing fans, raked wingtips, conventional tail and four-wheel main bogies. Slow spool and deliberate controls; 275 kt cruise, 150 kt full-flap approach.
- **Silex A3**: red-and-ivory low-wing aerobatic single with bubble canopy, fixed tailwheel and no flaps. Quick piston response and unrestricted loops/rolls; 146 kt cruise, 87 kt approach.

The six aircraft have live camera-local cockpit instruments, moving control surfaces and propellers/fans, appropriate piston/turboprop/turbofan sound, and type-specific camera framing. Gear retracts over four seconds on the commuter, regional jet and widebody. Fixed-gear HUD/help and landing missions never ask the pilot to retract gear; the Silex mission never requires flaps.

## Veyra U9 utility turboprop

The **Veyra U9** (`utility`, A-VU09) is an original single-engine utility turboprop: a tall, square-sided high-wing cabin with passenger windows, a framed cargo door on the left side and a belly cargo pod, a long turbine nose with chin intake, exhaust stacks and a five-blade propeller, single lift struts, a conventional low tail with dorsal fillet, and sturdy fixed tricycle gear. Its ivory airframe carries aubergine and copper accents. It cruises near 150 kt at the default 72% power and stalls near 58 kt clean (43 kt with 30° flaps). The single turbine spools up gradually, so set power early. Take off with 15° flaps and rotate near 56 kt; the landing mission flies a 72 kt full-flap approach at about 33% power, and touchdown must stay below 90 kt and 650 ft/min. The gear is fixed, so the HUD, help and mission never ask for it. Its own single-pilot cockpit shows a primary flight display with a torque, ITT, gas-generator and propeller-speed strip, and it shares the turboprop sound on the propeller bus. No cargo loading is modelled; performance is arcade tuning for Alpine Field.

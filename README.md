# Aeronaut

A playable 3D browser flight simulator built with Three.js and Vite. Fly the Vela J8, an original twin-turbofan light jet, the Arolla F7 delta-wing fighter, the Laret H4 light helicopter, or a Boeing 737-800 passenger airliner, through a procedural alpine world with snowy peaks, a turquoise lake, forests, villages, boats, and a working airfield.

## Run

```sh
npm install
npm run dev
```

The development server binds to `0.0.0.0:5173`. Production build: `npm run build`. The generated `dist/` is a static site and does not require a database or sign-in.

## Fly

The simulator opens airborne with flight assist holding heading and altitude. Select **Take control**, or use the flight keys to disengage assistance. The **Explore** menu also offers a runway start and the aircraft choice: the Vela J8, Arolla F7, Laret H4 or Boeing 737-800. Changing aircraft saves the current flight and starts the new one in the air; restarts and runway starts keep the chosen aircraft, and the choice is remembered in this browser.

The Arolla F7 has no pitch or bank limits: hold the stick for continuous loops and rolls, and it stays inverted or vertical when you let go. Flight assist from any attitude first rolls and pitches the short way back to level, at no more than about 70°/s, then holds the heading and altitude it has there.

- **W / S** or **up / down arrows**: nose down / up.
- **A / D** or **left / right arrows**: bank.
- **Q / E**: rudder.
- **Shift / Ctrl**: increase / decrease throttle. The instrument slider also works.
- **Space**: flight assistance.
- **C**: chase, cockpit, and orbit camera. Drag and scroll in orbit view.
- **P**: pause. **R**: restart.
- **G**: landing gear. **F**: cycle 0°, 15°, and 30° flaps.
- **M**: map. **H**: instruments.

On a phone, steer with the touch yoke and hold the + / − buttons to adjust power. In settings, mouse steering and inverted pitch are optional. Flight audio starts when the sound button is selected.

In either jet, with landing gear up, flying below 1,000 ft AGL at less than 20% throttle shows **GEAR** on the HUD and sounds a warning horn when flight sound is enabled. Lower the gear, raise throttle to at least 20%, or climb to at least 1,000 ft AGL to clear it. The horn follows the sound toggle and is silent while paused or after a crash.

The engines spool up and down over a few seconds, so lead with power changes. For a runway takeoff, add full power and pitch up after reaching about 95 knots (a little less with flaps). The jet cruises near 195 knots at the default power and stalls below about 82 knots clean, or 70 knots with full flaps. For landing, reduce power to around 45%, lower gear and flaps, keep the aircraft level, and touch down at under 130 knots with less than 600 ft/min descent. The Arolla F7 cruises near 330 knots (over 500 with the afterburner, which lights above 90% throttle), rolls and turns hard, and rotates near 130 knots; fly its approach near 135 knots with gear and full flaps, and touch down below 155 knots and 700 ft/min. Terrain collisions and stalls are modeled. The flight model is an accessible approximation, not certified flight training.

The **Laret H4** starts in a zero-airspeed hover with its rotors at flight RPM. **58% collective** holds a level hover; Shift / Ctrl or the lever raises / lowers collective to climb / descend. **W / S** tilts the cyclic forward / backward and **A / D** tilts left / right for lateral motion. Release cyclic to level; momentum slows gradually, so use opposite cyclic or **Space** to brake into a hover and hold position, altitude and heading. **Q / E** yaws the nose independently. Collective, cyclic or yaw input takes over from hover hold. On phones, drag the cyclic in the direction you want to travel, hold + / − for collective, and use the two yaw buttons to turn. The ground start begins with stopped rotors: raise collective and allow a few seconds to spin up before lifting vertically. Land with level skids below 10 knots of horizontal motion and 400 ft/min descent on fairly level ground. Fixed skids cannot retract; there are no flaps or fixed-wing stall/gear warnings. The rotor sound follows RPM and collective load, and silences on mute, pause or crash. This is an accessible rotor-lift approximation with tilt compensation, damping and hover stabilization; it does not model autorotation, torque coupling, vortex-ring state or certified helicopter performance.

## Landing mission

Choose **Landing mission** on the flight card or in **Explore**. The three jets begin 1.1 km before Alpine Field's runway 36, aligned north with gear down and 30° flaps: Vela J8 at 109 kt, Arolla F7 at 136 kt, and 737-800 at 140 kt. Follow the chartreuse approach brackets, correct speed with power, and flare gently near 25 ft above the runway. The Laret H4 instead begins in a hover 46 ft above a small skid target at 58% collective; lower toward 55% to descend gently.

Land inside the outlined touchdown zone, level and within 12° of runway heading. Touchdown feedback retains sink rate, alignment, speed and centreline offset. Fixed-wing aircraft must then remain on the runway, reduce power below 20% and slow below 6 kt for two continuous seconds. The helicopter must settle inside its box with collective below 57%. Off-runway, hard, fast or long landings, runway excursions and overruns end the attempt. **Retry** or **R** starts the same approach again; **Free flight** returns to a fresh airborne flight. Aircraft switching cancels the mission. Pause and dialogs freeze mission progress.

The mission uses the existing arcade flight and ground-roll model, including rolling resistance rather than wheel brakes or reverse thrust. These are gameplay targets for the procedural runway, not real aircraft landing procedures. `npm test` includes deterministic approach/flare/rollout scenarios using normal flight inputs for all four aircraft, plus failure and lifecycle regressions.

## Environment

Clear, golden-hour, and overcast presets affect the sky, sunlight, fog, clouds, and water. Graphics quality controls render resolution, terrain detail, tree density, clouds, and shadows. High quality works best with a hardware-accelerated WebGL 2 browser. The flight log and preferences are saved locally in the current browser.

All scenery, aircraft geometry, textures, and sound are generated in code. The world is inspired by the Swiss Alps; it is not a real geospatial dataset. Jet cockpit face textures are decorative; the helicopter panel and the HUD carry live flight data. Weather presets are simulated. No external imagery or model assets are used.


## Boeing 737-800

The wingleted 737-800 has an original Aeronaut ivory, teal and coral livery, passenger windows and entry/overwing doors, two underwing turbofans with rotating fans, swept wings with four moving flap panels, ailerons, elevators and rudder, and a five-second retractable tricycle gear cycle. Cameras frame its larger span on desktop and phone; its cockpit has a centre windshield post and paired control columns. The HUD remains the source of live airspeed, vertical speed and G-force; the cockpit face artwork is decorative.

Handling is deliberately slower than the Vela J8: pitch and roll response, throttle travel and turbine spool all take more time. For the **game's** runway takeoff, select 15° flaps, advance to full power, then rotate near 130 knots. It cruises near 250 knots at default power. Fly an approach near 140 knots with gear down, 30° flaps and about 45% power; touch down below 155 knots with less than 600 ft/min descent. Clean stall is near 128 knots, falling to about 105 knots at full flaps. The normal stall and low-power gear warnings apply. These are forgiving gameplay targets for the 1,100 m valley runway, **not real 737 operating data**. There is no flight-management computer, detailed engine/fuel/hydraulic simulation or study-level autopilot.

Silhouette and principal dimensions were checked against [Boeing's 737 Next Generation airport planning manual, D6-58325-7 Rev C (October 2025), §2.2.6, printed page 2-14](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf): 39.47 m length, 35.79 m span with blended winglets, 12.55 m nominal height, 3.76 m fuselage width, conventional tail and underwing engines. Geometry is an original procedural approximation; the manual's drawings and assets are not redistributed.
Merge-without-checks probe, 2026-11-11.

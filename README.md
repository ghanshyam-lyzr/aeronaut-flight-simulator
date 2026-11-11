# Aeronaut

A playable 3D browser flight simulator built with Three.js and Vite. Fly the Vela J8, an original twin-turbofan light jet, the Arolla F7 delta-wing fighter, or the Laret H4 light helicopter, through a procedural alpine world with snowy peaks, a turquoise lake, forests, villages, boats, and a working airfield.

## Run

```sh
npm install
npm run dev
```

The development server binds to `0.0.0.0:5173`. Production build: `npm run build`. The generated `dist/` is a static site and does not require a database or sign-in.

## Fly

The simulator opens airborne with flight assist holding heading and altitude. Select **Take control**, or use the flight keys to disengage assistance. The **Explore** menu also offers a runway start and the aircraft choice: the Vela J8, Arolla F7 or Laret H4. Changing aircraft saves the current flight and starts the new one in the air; restarts and runway starts keep the chosen aircraft, and the choice is remembered in this browser.

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

## Environment

Clear, golden-hour, and overcast presets affect the sky, sunlight, fog, clouds, and water. Graphics quality controls render resolution, terrain detail, tree density, clouds, and shadows. High quality works best with a hardware-accelerated WebGL 2 browser. The flight log and preferences are saved locally in the current browser.

All scenery, aircraft geometry, textures, and sound are generated in code. The world is inspired by the Swiss Alps; it is not a real geospatial dataset. Jet cockpit face textures are decorative; the helicopter panel and the HUD carry live flight data. Weather presets are simulated. No external imagery or model assets are used.
Merge-without-checks probe, 2026-11-11.

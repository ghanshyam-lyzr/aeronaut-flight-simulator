# Aeronaut

A playable 3D browser flight simulator built with Three.js and Vite. Fly the Vela J8, an original twin-turbofan light jet, through a procedural alpine world with snowy peaks, a turquoise lake, forests, villages, boats, and a working airfield.

## Run

```sh
npm install
npm run dev
```

The development server binds to `0.0.0.0:5173`. Production build: `npm run build`. The generated `dist/` is a static site and does not require a database or sign-in.

## Fly

The simulator opens airborne with flight assist holding heading and altitude. Select **Take control**, or use the flight keys to disengage assistance. The **Explore** menu also offers a runway start.

- **W / S** or **up / down arrows**: nose down / up.
- **A / D** or **left / right arrows**: bank.
- **Q / E**: rudder.
- **Shift / Ctrl**: increase / decrease throttle. The instrument slider also works.
- **Space**: flight assistance.
- **C**: chase, cockpit, and orbit camera. Drag and scroll in orbit view.
- **P**: pause. **R**: restart.
- **G**: landing gear. **F**: cycle 0°, 15°, and 30° flaps.
- **M**: map. **H**: instruments.

On a phone, steer with the touch yoke and hold the + / − buttons to adjust power. In settings, mouse steering and inverted pitch are optional. Synthesized jet engine audio starts when the sound button is selected.

The engines spool up and down over a few seconds, so lead with power changes. For a runway takeoff, add full power and pitch up after reaching about 95 knots (a little less with flaps). The jet cruises near 195 knots at the default power and stalls below about 82 knots clean, or 70 knots with full flaps. For landing, reduce power to around 45%, lower gear and flaps, keep the aircraft level, and touch down at under 130 knots with less than 600 ft/min descent. Terrain collisions and stalls are modeled. The flight model is an accessible approximation, not certified flight training.

## Environment

Clear, golden-hour, and overcast presets affect the sky, sunlight, fog, clouds, and water. Graphics quality controls render resolution, terrain detail, tree density, clouds, and shadows. High quality works best with a hardware-accelerated WebGL 2 browser. The flight log and preferences are saved locally in the current browser.

All scenery, aircraft geometry, textures, and sound are generated in code. The world is inspired by the Swiss Alps; it is not a real geospatial dataset. Cockpit face textures are decorative; the HUD carries live flight data. Weather presets are simulated. No external imagery or model assets are used.

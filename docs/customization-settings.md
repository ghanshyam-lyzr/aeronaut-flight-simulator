# Customization settings

The settings dialog (sliders icon in the top bar) now holds every saved preference, in five sections. Nothing here changes aircraft physics or manoeuvring limits, moves the aircraft, or cancels a mission.

| Section | Setting | Range / choices | Default |
| --- | --- | --- | --- |
| Flight | Graphics quality, flight assist, invert pitch, mouse steering | unchanged | unchanged |
| Control response | Pitch, roll, yaw (rudder / pedals), throttle (collective) | 50–200 %, steps of 25 % | 100 % |
| Camera | View | Chase, cockpit, orbit (also saved when C cycles it) | Chase |
| Camera | Chase distance | 100–160 %, steps of 10 % | 100 % |
| Sound | Flight sound | on / off (also the top-bar speaker) | off |
| Sound | Master volume | 0–100 %, steps of 5 % | 100 % |
| Display | Flight panels, instrument strip, key hints, crosshair, navigation map | on / off | all on |

## How it works

- **`src/settings.js`** owns the shape: defaults, finite bounds and enums, `normalizeSettings` (every stored value is validated field by field, numbers clamped and snapped to their steps), migration of the version-1 `aeronaut-settings` entry (all earlier choices kept; it is rewritten with `version: 2`), and storage that never throws (corrupt JSON, blocked or full `localStorage` all fall back to defaults and the sim keeps flying).
- **Control response** divides each axis's travel time in `FlightInputs` (`src/controls.js`): 650 ms stick / 350 ms throttle at 100 %. It applies after keyboard, mouse and touch are merged, so it covers all three. Timestamped, fixed-step integration is unchanged; held inputs still reach full deflection at every setting, release is still immediate and reversal still ramps from neutral. The response is bounded in `FlightInputs` too (0.5–2) so no caller can bypass it.
- **Chase distance** scales the fitted chase offset outwards only (never closer than the default), so the whole aircraft still fits portrait screens; the camera stays on the centreline and the 1 m near plane is untouched.
- **Sound** — `FlightAudio` gains one output gain node after the master bus, so the volume covers every engine voice, wind, the gear horn and the stall horn on the single existing audio context. Sound starts off as before; turning it on is saved, and after a reload it resumes at the first key press or tap (browsers require that gesture).
- **Display** — hiding flight panels keeps the stall/terrain notices, the GEAR banner and a mission card underway. Whenever any of the five display preferences (flight panels, instrument strip, key hints, crosshair, map) is off, a "Show hidden panels" button stays on screen: top right when the flight panels are hidden, otherwise beside the map/HUD tool buttons. That button and H both turn all five back on and save it (`toggleDisplay` in `src/settings.js`); only with everything visible does H hide the flight panels. The top bar with the settings button is never hidden.
- **Restore defaults** resets only the table above (except flight assist, which is the live flight's state). The aircraft, airfield and runway, weather, map framing, flight log and the flight or mission in progress are kept.

## Verification

- `npm test` (340 tests) and `npm run build` pass.
- `tests/settings.test.js`: defaults, v1 migration, per-field validation and clamping, corrupt/unavailable storage, round-trips, restore-defaults preservation, display recovery (crosshair-only, map-only, instruments, hints, panels, mixed and everything hidden, each saved and reloaded, then one H/restore shows all five and persists; with all visible H hides only the panels), and audio routing (all voices through the master volume, one context reused across mute/unmute) with a stub AudioContext.
- `tests/controls.test.js`: sub-frame tap impulse scales exactly with response at 10–120 Hz; full deflection, immediate release and neutral-start reversal at every response and cadence; default equals the original ramp; invalid/extreme values bounded; mid-hold changes don't jump; a 200 % tap on approach is still a small correction (jet and fighter).
- In the browser (Chromium, 1600×900, 1280×800, 390×844): the dialog scrolls with a sticky header, shows live values and has no horizontal overflow. Changes persisted across a reload (response, view, distance, volume, quality, hidden panels). Restore defaults during a landing mission left the mission flying at the same position, kept the aircraft and field, and focused the button. With panels hidden mid-mission the mission card and warnings stayed visible and the restore button brought everything back. After switching to the helicopter the settings were kept and the response labels read cyclic/pedals/collective. The speaker stayed off after reload until the first key press, then resumed. A corrupt stored entry loaded as defaults with no console errors. Display recovery with the real UI: crosshair-only off showed the restore button, survived a reload, and one real H key press restored everything; closing the map alone showed the button; hints + crosshair + map off survived a reload and one real click on the button restored all three; with everything visible H hid only the flight panels. On a phone the button sits left of the tool column, clear of the map and touch controls.

## Limitations

- Hiding the instrument strip also hides its pause/restart buttons; P and R still work, and the restore button is always shown.
- Volume above the original mix isn't offered; 100 % is the original level.
- Orbit distance and angle stay as before (mouse wheel and drag, not saved).

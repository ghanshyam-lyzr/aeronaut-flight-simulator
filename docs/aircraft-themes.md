# Aircraft exterior paint

The model foundation supplies paint roles, four presets, validated custom colors and per-aircraft browser storage. It creates no UI, reads no saved preferences on its own, and changes no flight or camera state. The theme editor owns application wiring.

Every `createAircraft(id)` result, including results from the direct model constructors, exposes `model.paint`:

- `roles`: frozen array of supported names in `body`, `accent`, `stripe` order. Arolla F7 (`fighter`) and Laret H4 (`helicopter`) have two roles; the other aircraft support all three. An unsupported role remains in a custom theme's saved palette, so one complete theme shape works everywhere.
- `materials`: frozen role-to-material-array bindings. They identify actual exterior paint, including painted control surfaces, gear doors, wheel fairings and spinners. These are model-owned Three.js material references for inspection; use `apply` to change their colors.
- `apply(theme)`: apply a preset id string or a normalized theme, returning a separate validated copy of the applied theme.
- `theme`: a defensive copy of the current normalized theme.
- `restore()`: restore Factory, returning `{ preset: 'factory', colors: null }`.

## Editor wiring

```js
import { createAircraft } from './aircraft.js';
import { AIRCRAFT_THEME_PRESETS, normalizeAircraftTheme, normalizePaintHex } from './aircraft-themes.js';
import { loadAircraftTheme, saveAircraftTheme, resetAircraftTheme } from './aircraft-theme-storage.js';

const model = createAircraft(id);
model.paint.apply(loadAircraftTheme(id)); // On construction, including aircraft switching / reload.

// Preset choice: Factory, Alpine rescue, Glacier or Midnight.
const theme = model.paint.apply('alpine-rescue');
const saved = saveAircraftTheme(id, theme); // false when storage is blocked or full.

// Custom input is complete and strictly hex-only. Validate fields before applying;
// normalizePaintHex returns null for incomplete/invalid text, so leave live paint as-is while typing.
const body = normalizePaintHex(bodyInput.value);
const accent = normalizePaintHex(accentInput.value);
const stripe = normalizePaintHex(stripeInput.value);
if (body && accent && stripe) {
  const theme = model.paint.apply({ preset: 'custom', colors: { body, accent, stripe } });
  saveAircraftTheme(id, theme);
}

// Reset the selected aircraft only, without recreating its model or resetting the flight.
model.paint.restore();
const resetSaved = resetAircraftTheme(id);
```

Use `AIRCRAFT_THEME_PRESETS` for preset ids, labels and immutable colors. `factoryAircraftTheme()` makes a fresh Factory state. `normalizeAircraftTheme(value)` returns one of:

```js
{ preset: 'factory', colors: null }
{ preset: 'glacier', colors: { body: '#e4edef', accent: '#245963', stripe: '#86c5cb' } }
{ preset: 'custom', colors: { body: '#aabbcc', accent: '#123def', stripe: '#0000ff' } }
```

`#RGB` and `#RRGGBB` are accepted, trimmed and expanded to lowercase six-digit hex. CSS names, alpha hex, functional colors and partial custom palettes fall back to Factory. Preset colors always come from their definitions, ignoring injected custom colors. A UI should retain the last complete custom palette while a field is incomplete, and use `paint.roles` to disable unsupported controls. Factory is not represented by a single color per role: the two Vela stripe materials, biplane body/fabric and fighter counter-shading keep their distinct original appearances.

## Persistence and ownership

`loadAircraftTheme(id, storage?)`, `saveAircraftTheme(id, theme, storage?)` and `resetAircraftTheme(id, storage?)` default to browser `localStorage`. Tests or non-browser callers can supply a Storage-compatible object or `null`. Keys are `aeronaut-aircraft-theme.<fleet-id>`, with payload `{ version: 1, theme }`; exported prefix/version constants describe the contract. Unknown fleet ids never touch storage. Missing, malformed, invalid or unsupported-version data loads Factory. Reads never rewrite entries. Save and reset return a boolean and catch storage-access, quota and removal failures. A failed write leaves the live model unchanged; let the pilot know the choice could not be remembered. A failed reset similarly means the old saved choice may return after reload. Settings and the logbook use independent keys.

Each constructor passes explicit material references to `createAircraftPaint` after creating its own materials. No color matching or mesh-wide recoloring runs. Materials shared by a painted stripe and propeller safety markings, anti-glare or fighter stores are separated once before batching. Glass, navigation lights, tyres, bare metal, instruments, rotor blades and their tips retain their materials. Cockpit models are independent and never bound.

Apply mutates existing `color` values only, with one exception: on custom/preset paint it disables vertex colors on fighter body materials, avoiding multiplication by the old grey livery. Factory copies the exact saved linear color components and restores the original `vertexColors` flag, preserving the original geometry color attributes. Roughness, metalness, clearcoat, opacity, environment maps and all other properties remain untouched. A shader update is requested only when the vertex-color flag changes. There is no per-frame paint work, material allocation on apply, geometry replacement or disposal wrapper; existing model disposal owns all referenced paint and isolated detail materials.

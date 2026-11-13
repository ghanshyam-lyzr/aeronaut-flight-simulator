# Airport selection

Makes the five-field network usable: pick a field and runway in Explore, depart there, or fly a scored landing mission there. Builds on `src/airports.js` (registry, `runwayDirection`, `suitability`) from the airport-network change. No new dependencies; the map is unchanged. Map bounds, labels, airport markers and route guidance belong to the navigation-map thread.

## UI flows

- **Explore → Airfield**: a radio list of the five fields (name, ident, region, runway length and surface, elevation, and a fit line for the current aircraft: good fit, tight fit, or "Not suited · needs …"). Under it, the selected field's two runways (e.g. Runway 14 138° / Runway 32 318°), its summary, size and caution. Arrow keys, Home and End move within each radio group; Tab moves between groups. The aircraft roster keeps its scroll position and focus when you change aircraft or field.
- **Choosing a field or runway moves nothing.** It only changes where the next departure or new mission starts. If a mission is underway, the dialog says it continues.
- **Explicit actions** (in Explore):
  - *Land at {field} · {runway}* opens the landing brief for the selected field.
  - *Start in the air* is the existing free-flight reset in the Alpine Valley.
  - *Depart {field} · runway {nn}* (helicopters: *Lift off from …*) is a fresh runway start 100 m past the threshold on the selected runway heading. Departures are open to every aircraft. An unsuited pairing only changes the toast, which names the reason, e.g. "Vela J8: needs a paved runway · Verdance Meadow has 900 m grass".
- **Mission panel**: the entry reads *Land at {selected field}*. While a mission flies, the title, phase, cues, alignment hint ("Align with runway 32 · heading 318°"), map footer and result all name that mission's field and runway.
- **Landing brief**: shows the runway, heading and elevation, with heading-aware instructions for fixed-wing aircraft and rotorcraft. A tight fit or the field's own caution appears as a notice. **Unsuitable aircraft** (registry `suitability` = `unsuitable`) can't start a scored mission at that field. The brief shows the reason and the field's size, offers *Land at X instead* for each field that suits the aircraft, and *Choose another aircraft or field*. `startLanding` refuses the same pairings, so `R` and the API are covered too.
- **Retry / R / result Retry** restart the mission at its own field, even after the selection changed. *Free flight* cancels it. Changing aircraft cancels it, as before.

## State and API (for the navigation-map thread)

`src/airport-selection.js` (pure, no three.js or DOM):

- `new AirportSelection(id, runway)` is an `EventTarget` with `id`, `runway`, `airport` (registry field) and `field` (that field turned to the selected runway with `runwayDirection`). `select(id, runway?)` fires `'change'` only on a real change and keeps the runway when the same field is chosen again. `snapshot()` returns `describeField(field)`.
- `resolveAirport(id, runway)`: an unknown or missing id falls back to Alpine Field; a runway the field doesn't have falls back to its primary runway.
- `missionAvailability(field, aircraftId)` returns `{ available, rating, reason, alternatives: [ids] }`.
- `describeField(field)` returns `{ id, ident, name, region, regionName, runway, reciprocal, heading, x, z, elevation, runwayLength, runwayWidth, surface, threshold: {x, z} }`. `threshold` is the landing threshold of the selected runway. `headingDegrees(rad)` gives `'001'`–`'360'`.

In `main.js` there is one `selection` instance, and `landing.field` is the field of the mission underway. Don't keep a second copy of either:

- `airportState()` returns `{ selected: describeField(selection.field), mission: null | { ...describeField(landing.field), status, phase } }`.
- `window.aeronaut.getAirport()` returns the same object. `window.aeronaut.selectAirport(id, runway?)` selects a field (and persists it).
- The `window` event `'aeronaut:airport'` (`CustomEvent`, `detail` = `airportState()`) fires when the selection changes, when a mission starts, finishes or is cancelled, and on retry.
- Persistence: `localStorage['aeronaut-settings']` stores `airport` (stable id) and `runway`. Old settings without them, and invalid ones, mean Alpine Field 36.
- `?airport=<id>&runway=<nn>` selects a field as the picker does. `&start=runway` / `&start=approach` still begin there. `window.aeronaut.runwayStart(id?, runway?)`, `approachStart(id?, runway?)` and `startLanding()` default to the selection.

## Mission changes (`src/landing-mission.js`, `src/landing-guidance.js`)

- `LandingMission.start(flight, field?)` moves the mission to `field` before starting. Without it, the call is a retry at the current field. The alignment failure message names the mission runway. `onFinal(state)` replaces main.js's Alpine-only terrain-warning suppression: active, gear down, within one runway width of the centreline, from 1.5 km out to the far end of *this* runway. `snapshot()` adds `field` and `runway`.
- Touchdown zone, sink, speed, alignment, flaps, gear and rollout criteria are unchanged. Every check already runs in that field's runway coordinates, so rotation, length and elevation follow the field.
- `createLandingGuidance` returns `{ field, group, show, dispose }`. main.js disposes and rebuilds the cues when a mission starts at a different field or runway. On narrow runways the outlines stay inside the paint, and the helicopter box is never wider than the area the mission scores (Col de Brume: ±6 m).

## Tests: `tests/airport-selection.test.js` (in `npm test`)

Covers:

- Settings fallback.
- Selection events and snapshots.
- Mission availability and alternatives for every field × aircraft.
- Mission starts on all ten runways for fixed-wing aircraft and helicopters: heading, centreline, elevation clearance.
- Grading against the mission field: rotated Orvane 32 success, misalignment naming runway 32, Alpine's aim point being off Orvane's runway, overrun and runway-passed on the 650 m col, the helicopter box at the col.
- Retry staying on its field; cancel, reset and aircraft-change cancellation.
- Terrain-warning suppression on Orvane's long rotated final.
- Guidance placement and disposal on every runway.
- Full feedback-pilot missions: jet at Orvane 32, transport helicopter at Col de Brume 29, utility at Verdance 17.

## Limitations

- The navigation map still covers only the Alpine Valley and marks only Alpine Field; missions elsewhere show the aircraft off-map until the navigation-map thread lands.
- Density altitude isn't modelled (see airport-network.md); elevation is a caution, not a performance change.
- Tight-fit pairings (e.g. the 737 at Alpine Field) stay available, with a notice, as before.

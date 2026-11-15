# Flight log recovery

The browser-local `aeronaut-flights` history now has a validated boundary in `src/flight-log.js`. Damaged history cannot interrupt startup, Flight log, aircraft changes, restart, or the existing unload saver. The logbook layout and its five visible previous flights are unchanged.

## Reproduction before this change

The loader assigned the result of `JSON.parse` directly to `savedFlights`. Parsing valid JSON did not guarantee an array or valid entries. The real logbook expression `savedFlights.reduce((n, f) => n + f.time, 0)` threw for these stored values:

- `null`: cannot read `reduce` on null.
- `{}` and `"text"`: `reduce` is not a function.
- `[null]`: cannot read `time` on null.

In a clean Chromium context, seed `aeronaut-flights` with the string `null` **before module initialization**, then open Flight log. The dialog fails to open with the `reduce` error. Allow the flight timer to pass ten seconds and restart: `savedFlights.unshift(entry)` throws before the flight can reset. The same saver runs when changing aircraft and leaving.

For repeatable browser reproduction, use a fresh isolated storage context and an initialization script. For example, in a Playwright harness:

```js
const context = await browser.newContext();
await context.addInitScript(() => {
  if (location.origin !== 'http://localhost:5173') return;
  localStorage.setItem('aeronaut-settings', JSON.stringify({ quality: 'low' }));
  localStorage.setItem('aeronaut-flights', 'null');
});
const page = await context.newPage();
await page.goto('http://localhost:5173');
// Wait for window.aeronaut, then click Flight log and exercise restart.
```

Seeding just before an ordinary reload is unreliable: an existing flight of ten seconds or more can overwrite the seed in `beforeunload`. To check persistence, seed only once per context (for example, guard with a sessionStorage marker), then navigate normally.

## Recovery rules

- Missing storage, malformed JSON and non-array roots yield an empty session history. Loading itself does not rewrite storage.
- Skip nulls, arrays, primitives and objects with neither a `time` nor a `distance` field. Retain the first 20 recoverable records in their existing newest-first order; invalid records do not consume that limit.
- Repair each metric independently. `time` is seconds; `distance` and `maxAltitude` are metres. Finite numbers are clamped to `[0, Number.MAX_SAFE_INTEGER]`; strings, missing values and non-finite values become zero. Totals use the same finite bound and include the current flight once. Ordinary numbers retain their exact values.
- Keep valid ISO dates as canonical ISO strings, including valid offsets. Reject impossible calendar days, out-of-range dates and non-string dates; store `null` and display `Unknown date`. Never substitute the current date or show `Invalid Date`.
- Keep known fleet ids only, using an own-property check so ids such as `constructor` cannot resolve through the fleet object's prototype. Unknown or absent ids omit the aircraft label and preserve the flight metrics. Old valid records without aircraft or maximum-altitude fields remain usable.
- New flights still enter history at ten seconds. Recording returns a normalized copy, prepends the eligible flight and retains at most 20 records. Saving normalizes again before serialization, so later writes cannot reuse a malformed array or entry.
- Storage follows settings' existing `browserStorage()` boundary: access, reads and writes may fail without escaping into the simulator. `saveFlights` returns false when unavailable/full; session history remains usable. Later saves may retry, allowing transient storage failures to recover. Persistence across reloads requires working browser storage.

## Verification

- `npm test`: 501 passing tests, including 12 focused flight-log tests in `tests/flight-log.test.js`.
- `npm run build`: passes; Vite retains its existing large-chunk warning.
- Tests cover malformed/root-type data, mixed records, numeric and date boundaries, calendar rollover, all fleet ids and prototype names, legacy entries, the 20-entry limit, the ten-second threshold, ordinary totals, exact round-trips, repeated saves after recovery, blocked property access, read/write exceptions, quota failures, and later successful writes.
- Isolated Chromium at 1280 × 800, low quality and reduced canvas pixel density for the software renderer: `null` loads and opens Flight log with the empty state; a real ten-second flight restarts and persists valid metrics; choosing the fighter in Explore works and the new log remains usable. Screenshot inspected at `/tmp/forge-browser/flight-log-recovery.png` (temporary, outside the repository).
- A second isolated context loaded a valid jet flight, an older aircraft-less flight, null/empty records and a damaged record. The dialog showed the two original durations, repaired metrics and `Unknown date`. After ten seconds, navigating away and reloading saved one new flight and preserved the three recoverable entries in order. Reopened Flight log showed all four previous flights. No page errors in either scenario.
- A third isolated context threw on every flight-history read/write. Flight log initially opened empty. After ten seconds, two explicit `beforeunload` events and the real restart button exercised three failed writes; all three records remained visible for the session. Restart reset the timer, Explore switched to the helicopter, and navigation away succeeded with no page errors.

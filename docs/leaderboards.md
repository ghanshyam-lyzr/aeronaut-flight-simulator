# Leaderboard browser view

Open **Leaderboards** in the desktop navigation or the phone's **Flight menu**. Browsing uses the existing modal pause boundary: closing restores the launching control and the prior pause state. Filter selections belong only to this view; they never call aircraft, airfield, wind, reset or activity setters.

`src/ranked-client.js` owns the browse/profile HTTP transport. Its fixed `/api/ranked/` paths use same-origin credentials, reject redirects, enforce a timeout, accept cancellation and validate the returned canonical board, ranking measurements, ownership and pagination. Board keys and opaque cursors are encoded with `URLSearchParams`. There are no external URLs, client owner IDs, mock fallbacks, attempt-creation calls or replay submissions in this view. The shared HTTP/data contract is [ranked-runs.md](ranked-runs.md); the service owns its profile/ownership additions.

The browser-profile extension agreed with the service uses `GET /api/ranked/profile` and `PUT /api/ranked/profile` with a display name only. The server cookie identifies the anonymous browser profile. The form displays the server's canonical returned name and explains that this is neither a verified account nor a portable login; accepted runs retain their submitted name. Public entries' `isOwn` flags and the server's complete-board `personalBest` establish ownership. Matching names never do. All public rows represent accepted runs (`rankingPolicy: "runs"`).

The catalog supplies valid activity, aircraft, course/airfield, runway and prescribed wind options. Lower measurements rank first in the contract's order, with exact three-decimal values and units. Landing/crosswind run details expose threshold distance, touchdown speed and elapsed time; course details expose elapsed gate splits; recovery details expose total attempt duration. No points are invented. The eligibility disclosure explains manual flight, fixed starts, completion/rollout, simulation limits and server expiry. This view does not start or submit a ranked run.

`src/leaderboard-model.js` keeps catalog, profile and score requests independent. Filter changes, refreshes and close abort requests and invalidate old responses even if a transport ignores cancellation. Paging preserves server ranks and the cursor for retry, rejects duplicate/repeated pages, and retains already loaded results on a page error. Empty catalogs, empty boards, unsupported rules, HTML from a static host, timeouts and unavailable services have explicit text states.

## Verification

Run `npm test`, `npm run test:wasm` and `npm run build`. The focused `ranked-client.test.js` suite exercises an actual controlled HTTP server, including encoded requests, profile writes, invalid data, cancellation, HTML fallback, service failure and timeout. `leaderboard-model.test.js` covers stale responses, close, compatible boards, independent profile failure, empty states and pagination retries without restarting global rank.

Browser checks use Playwright request interception for the `/api/ranked/` endpoints, with canonical boards created by `makeBoard`; fixture entries are explicitly named “Fixture pilot.” These responses exist only in the test browser. No fixture data is installed in application code or presented as a live service. Before backend integration, the normal static preview honestly reports that rankings are unavailable.

For headless SwiftShader, set the existing `aeronaut-settings` quality to `low` before navigation, then pause through `window.aeronaut.setPaused(true)` after initialization. High-quality world rendering at 1600×900 can stall browser automation. The screenshots use that Performance graphics setting.

Verified at 1600×900, 1280×800 and 390×844: viewport-bounded dialog, internal scrolling, no horizontal overflow, long names, literal markup in names, unit labels, personal-best row, filters for all four activities, complete-board personal-best display, paginated global rank, empty/error/retry states, name canonicalization, tab wrapping, Escape/close focus restoration and flight-shortcut isolation. A paused active course's complete flight state, course snapshot and selected airfield were byte-for-byte unchanged after browsing/filtering and typing shortcut letters. Expanded eligibility content also fits the phone width.

The screenshots below show controlled HTTP fixtures, not live scores:

- [1600×900 rankings](screenshots/leaderboard-desktop.png)
- [1280×800 rankings](screenshots/leaderboard-small-laptop.png)
- [390×844 rankings](screenshots/leaderboard-phone.png)
- [390×844 empty board](screenshots/leaderboard-empty-phone.png)
- [1600×900 unavailable service](screenshots/leaderboard-unavailable-desktop.png)

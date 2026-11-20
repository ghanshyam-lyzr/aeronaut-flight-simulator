# Persistent ranked-run service

The online leaderboard is one Node HTTP service serving `dist/` and `/api/ranked/*` on the same origin. PostgreSQL is required. `pg` is the sole added server dependency (explicitly approved as an exception to the project dependency rule); the browser receives no database code or additional dependency. Shared protocol and score rules remain in [ranked-runs.md](ranked-runs.md). This service supplies the backend; the ranked flight/leaderboard UI is a separate change.

## Local operation

Use Node 22 or newer. After installing the checked-in dependencies with `npm ci`:

```sh
forge db up
npm run build
forge serve start web --port 8080 --default -- env TRUST_PROXY=1 npm start
```

`npm start` applies checked-in migrations and then listens on `0.0.0.0:$PORT` (8080 by default). `DATABASE_URL` is required from the environment; never put a connection string in source. Migrations run inside a transaction under a PostgreSQL advisory lock and migration ledger. Running them again or starting multiple instances is safe. Startup fails if PostgreSQL or a migration fails. **The build does not connect to PostgreSQL.** Build outputs and database data are separate.

For Vite live development, start the API on 8080 and Vite on 5173:

```sh
forge serve start api --port 8080 -- env TRUST_PROXY=1 npm run dev:server
forge serve start web --port 5173 --default -- npm run dev
```

Vite proxies `/api` to 8080, preserving the browser's Host and Origin, with no CORS workaround. Its target is deliberately fixed to loopback; do not accept an arbitrary proxy target from a request. For another backend development port, change the target in `vite.config.js`. `npm run preview` previews static build assets only; use the Node service or Vite development proxy for ranked API calls.

Set `TRUST_PROXY=1` **only behind a trusted reverse proxy** (Alpha preview or Cloud Run). It enables the forwarded host for same-origin checks and the final `X-Forwarded-For` address for coarse throttles. The proxy must append the actual peer address and prevent bypass of the proxy. Without this setting, the service ignores forwarded headers and uses its direct Host/peer. Origin uses HTTP for localhost names and HTTPS for public hosts; no public hostname is hard-coded. Address limits can aggregate users behind a shared proxy/NAT; they safeguard resources rather than establish identity.

## Anonymous pilot profile

`GET /api/ranked/profile` returns `{profile:null,serverNow}` until this browser chooses a name. `PUT /api/ranked/profile` accepts only `{displayName}` and returns `{profile:{displayName},serverNow}`. Names normalize with NFKC, retain letters/numbers/combining marks/spaces and simple punctuation, collapse spaces, require 2–24 code points and at least a letter or number. Markup, controls and directional formatting are removed. Render the returned name with text content, never HTML.

Creation sets a random 256-bit opaque HttpOnly cookie; PostgreSQL stores only its SHA-256 digest. All origins use a Secure `__Host-` cookie with `SameSite=None` for embedded previews, including browser-trusted localhost names. Cookies last a year. Missing/invalid cookies are anonymous. Starting, cancelling or submitting a run requires an existing browser profile. Clients cannot submit a pilot id or choose their cookie value. Names are not unique, and changing a name affects future entries only.

This is anonymous browser identity, **not a verified account**. Clearing the cookie loses access to that pilot's personal best and open tickets; there is no account recovery or cross-browser identity. A browser that blocks third-party cookies should open the app in its own tab. No Auth service is needed. All API responses use `Cache-Control: private, no-store`; public entries contain neither owner ids, cookie digests nor replay data.

## Verification and persistence

All endpoints follow [ranked-runs.md](ranked-runs.md), including identical-replay retries, cancellation, errors and full canonical boards. A profile may have eight unexpired open tickets, allowing several tabs. Tickets expire after one hour. Rejected/cancelled tickets cannot be reused; expiry is checked against PostgreSQL time both before verification and immediately before acceptance. An accepted identical retry returns the stored immutable entry with 200, including after ticket expiry. First acceptance returns 201.

Each submission locks its ticket row in a database transaction. Other submissions and cancellations serialize on that row across instances. The service calculates a SHA-256 hash of canonical replay JSON: fixed replay and board property order, original array order and JSON numeric representation. Whitespace/property-order changes retry identically. It retains the digest and final state, without retaining replay bodies. The built-in JSON parser does not detect duplicate object keys; callers must send the canonical unique-key schema.

Verification runs the shared `verifyReplay` implementation in a worker with a 20-second deadline, 128 MiB old generation, 16 MiB young generation and a 4 MiB stack. Two transaction-scoped PostgreSQL advisory slots cap concurrent verifications **across all service instances**. A process admits at most 12 API handlers, including at most three submission bodies, with no unbounded worker queue. Busy/timeout requests return 503 and leave the ticket open for an identical retry; lock waits are bounded to three seconds. Process crashes/database disconnects roll back the transaction and release row/advisory locks. A lost HTTP response may still commit: retry the same replay to recover its saved result. There is no persisted processing claim to become stuck.

The HTTP layer rejects oversized bodies before parsing (including chunked requests), compressed input, non-JSON content and cross-origin writes. Replay JSON is limited to 16 MiB, 120,000 slices, 600 simulated seconds and 1,024 actions through the shared validator. Initial state, client scores and arbitrary replay properties are never trusted. Only the verifier's finite safe-integer metrics establish a score. Expected simulation rejection finalizes the ticket without an entry. Unexpected errors roll back and return 500; they never establish an entry. Parameterized SQL writes the entry, final ticket state and best-per-pilot pointer in one transaction.

The board always ranks **runs**, including multiple accepted runs from one pilot, by score tuple then accepted time then ASCII id. Lower scores win, ties share competition rank (1,1,3). PostgreSQL arrays implement the shared lexicographic score tuple; ids use `C` collation. `limit` is 1–100 (default 20). A bounded opaque cursor names an actual accepted entry on the complete selected board; its score/time/id anchor is looked up in PostgreSQL. Cross-board, missing and malformed anchors are rejected. Page ranks and `personalBest` use the entire board within one repeatable-read snapshot. Concurrent new entries can naturally change ranks between page requests.

`GET /api/ranked/leaderboard` adds `rankingPolicy:'runs'`, `isOwn` on every entry, and `personalBest:{...entry,rank,isOwn:true}|null` to the shared response. Personal best is independent of pagination. Anonymous requests get `isOwn:false` and `personalBest:null`. The current service accepts/displays registered v1 boards only; it does not reinterpret unsupported historical rules.

Database-backed fixed-window limits: 20 profile writes per address/hour; 30 profile edits, ticket requests and submissions per pilot/10 minutes; 120 ticket requests and 60 submissions per address/10 minutes. Rate-limited requests return 429 with `Retry-After: 30`; clients should back off and preserve the original replay for retries. An anonymous user can acquire new browser identities, so these measures do not establish human authorship or prevent determined automation. Successful reconstruction proves only success under the current arcade rules.

## Tests and production

```sh
npm test
npm run test:wasm
npm run build
npm run test:server
```

The backend suite requires a real PostgreSQL `DATABASE_URL` and permission to create/drop a temporary schema. It creates isolated random schemas, uses ordinary-control successful replay recordings, and covers profile/cookie isolation, all four activities, altered/failed/oversized/nonfinite replays, cross-origin requests, pagination and tied ranks, parallel/duplicate submissions across instances, transactional personal bests/rollback, cancellation races, concurrency bounds, worker timeout, static/SPA/WASM handling, throttles and a fresh OS process reading the same durable state. CI provides PostgreSQL 16 and runs this suite explicitly; it never silently skips database tests.

Production needs `DATABASE_URL`, `PORT` and `TRUST_PROXY=1` behind its trusted edge, a writable PostgreSQL schema and enough database connections for 12 per service instance. Size the database connection budget and Cloud Run instance cap together. Budget memory for two workers plus in-flight JSON parsing (the worker heap limits do not cap total process RSS); validate memory under production replay load before increasing concurrency. Service startup performs migrations; the build runs `npm run build` with no database access. PostgreSQL (including Cloud SQL socket URLs supported by `pg`) persists pilots/tickets/scores across restarts and instances. No production state is stored in local files. The start script serves the built SPA, retains `application/wasm` and accepts `.run.app` hosts without a host allowlist.

When deploying through Alpha on the user's instruction, enable production PostgreSQL or provide a hosted `DATABASE_URL`. Production starts empty and runtime migration creates the schema; local rows are not copied. The service requires neither sign-in nor `OPENWEATHER_API_KEY`. `/api/health` checks database reachability without exposing connection details. Retention/backup policy is an operator decision: accepted entries remain immutable, ticket rows and throttle subjects remain until explicitly pruned, and raw replay payloads are not stored. No deployment is performed by this change.

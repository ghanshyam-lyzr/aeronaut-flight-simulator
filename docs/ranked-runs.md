# Ranked runs v1

The shared implementation is DOM-free and has no network, storage or clock side effects:

- `src/ranked-rules.js`: board validation, versions, limits and ordering.
- `src/run-replay.js`: prescribed starts, bounded wire validation, actions and simulation result extraction.
- `src/run-recorder.js`: one local manual attempt, driven by actual physics slices.
- `src/run-verifier.js`: authoritative reconstruction and replay.

Existing flight and activity APIs are unchanged. Free flight and local activity results keep their existing behavior.

## Board identity and prescribed setup

`RULES_VERSION = "aeronaut-ranked-v1"`, `REPLAY_VERSION = 1`.
`makeBoard({ activity, aircraft, ...selectors })` expands selectors into this canonical object; `validateBoard(board)` requires all seven fields. Both throw `RankedRunError` with a stable `code` on invalid input. Explicit unknown, incompatible or irrelevant selectors are rejected, never silently replaced.

```json
{
  "rulesVersion": "aeronaut-ranked-v1",
  "activity": "landing",
  "aircraft": "trainer",
  "course": null,
  "airport": "alpine-field",
  "runway": "36",
  "setup": "calm"
}
```

`activity` is `course`, `landing`, `crosswind` or `recovery`; `aircraft` is a fleet id. Canonical fields:

- Course: `course: "lake-azure"`; airport/runway null; setup `calm` (default), `breeze` or `gusts`. Existing fixed-wing availability applies.
- Landing: course null; registered airport and one of its two runway designators (defaults Alpine Field's primary); setup `calm` (default), `breeze` or `gusts`. Existing aircraft/airfield mission suitability applies, including helicopters.
- Crosswind: course null; `airport: "alpine-field"`, `runway: "36"`, `setup: "crosswind-practice"`. Existing practice availability applies. The existing PRACTICE wind is prescribed: 080°/9 kt, gust addition 3 kt, veer 4°, seed 3.
- Recovery: course/airport/runway null; `aircraft: "trainer"`, `setup: "stall-recovery"`. Existing RECOVERY start and calm wind apply.

`boardKey(board)` joins the seven fields in the order above with `|`, using `-` for null. Registry identifiers cannot contain `|`. The example key is `aeronaut-ranked-v1|landing|trainer|-|alpine-field|36|calm`. URL-encode the entire key. The database must partition and query by the entire key, including rules version. There is no global cross-board ranking.

All starts are rebuilt with existing `Activities.startCourse/startLanding/startCrosswind/startRecovery`. These methods set the prescribed location, speed, attitude, power, gear and flaps, reset trim and the wind clock, and disable assist. Initial state is never accepted from the client. The course geometry, airport registry/grading, fleet performance, wind presets, activity rules, terrain and physics are part of the rules version. Change that version before changing any ranked behavior; historical unsupported versions may still be displayed, but cannot be submitted under v1.

**Canonical engine:** ranked v1 explicitly uses `FlightController(..., {engine: "javascript"})` and `terrain.referenceHeight`, including real terrain and the controller's water floor. This stays the same whether the host has initialized WASM or not. A live ranked flight must use the same engine/terrain. `createRankedSimulation(board, existing?)` configures this and starts the activity; `existing` is optional `{flight, activities}` containing all four activity components. It returns `{board, flight, activities, landing, course, practice, recovery, s}`. Save the live flight's previous `engine` and `heightAt` and restore them after leaving ranked mode. Free-flight/default engine selection is not changed by any global setting.

## Scores, units and deterministic ties

Only the existing activity's success/completion after the entire input replay qualifies. Landings include the successful stopped, controlled two-second rollout; touchdown alone is insufficient. Assist/hover hold/heading hold are forbidden for every ranked activity.

Every listed scalar is an integer, rounded with `Math.round` after the simulation, with negative zero normalized to zero. All ranking dimensions are lower-is-better. Ranking uses the same quantized numbers displayed; hidden floating-point digits never break ties.

- Course: `elapsedMs`, then no further score tie-break. `splitsMs` lists elapsed time at each gate. Display elapsed and splits as seconds to three decimals (or m:ss.sss).
- Landing: `sinkMmPerSecond`, then `centrelineMm`, then `alignmentMilliDegrees`. Display touchdown sink as m/s to three decimals, absolute centreline offset as metres to three decimals, alignment error as degrees to three decimals. Also display `touchdownAlongMm` (metres to three decimals from threshold), `speedMmPerSecond` (m/s to three decimals) and `elapsedMs` (seconds to three decimals). Those extra metrics do not break score ties.
- Crosswind: `centrelineMm`, then `sinkMmPerSecond`, then `alignmentMilliDegrees`; identical extra/display metrics to landing. Offset is the absolute touchdown offset, not the threshold offset or mean crab.
- Recovery: `heightLostMm`, then `recoveryMs`. Display metres and seconds to three decimals. Height lost is the maximum drop below the first observed stall altitude, including stabilization; time is from first stall to three continuous stable seconds, exactly as RECOVERY measures it. `attemptMs` is the extra start-to-finish duration, displayed in seconds to three decimals and unused for ties.

`rankingTuple(board, metrics)` gives those ordered integer score dimensions. Never call it on a client's claimed metrics to establish an entry. `compareEntries(a,b)` accepts `{id, board, metrics, submittedAt}`. Equal score tuples are ordered by server `submittedAt` (Unix milliseconds), then id in ASCII lexical order, independent of locale. `rankEntries(entries)` returns a sorted copy with competition `rank` (1,1,3); equal tuples share rank even though their display order is deterministic. Mixed boards and duplicate ids are rejected. Pagination must carry this total ordering and compute ranks against the whole board, not restart ranks per page.

## Bounded input replay

```json
{
  "version": 1,
  "rulesVersion": "aeronaut-ranked-v1",
  "attemptId": "server_generated_opaque_id",
  "board": {
    "rulesVersion": "aeronaut-ranked-v1", "activity": "landing", "aircraft": "trainer",
    "course": null, "airport": "alpine-field", "runway": "36", "setup": "calm"
  },
  "steps": [[0.008333333333333333, 0, 0, 0, -0.1, 0, 0, []]]
}
```

This one-slice schema example is incomplete and will not qualify. Each slice is `[dt, pitch, roll, yaw, throttle, brake, trim, actions]`:

- `dt` is the actual positive simulation slice in seconds, at most 0.025. Record the exact number supplied by `FlightInputs.advance`; do not round, resample, merge, quantize or use render/wall-clock frame duration. Tiny partial slices are allowed; count/byte limits bound them.
- The six controls are the actual normalized, response-adjusted `FlightInputs` output passed to `FlightController.update`: pitch, roll, yaw, throttle and trim in [-1,1], brake in [0,1]. All must be finite numbers. `trim` is a rate command, not an absolute attitude or trim value.
- `actions` is an array drawn only from `"gear"`, `"flaps"`, `"trim-neutral"`, at most once each per slice. Apply in the recorded order immediately **before** that slice: `toggleGear()`, `cycleFlaps()`, and `state.pitchTrim=0` when `hasPitchTrim`. Actions that are unavailable on the aircraft have their normal no-op semantics. Queue live actions until the next slice so recorder and replay agree. Continuous hold-to-trim is already the sixth control. More than one press of the same action between slices must be deferred to a subsequent slice, never silently dropped.
- An action during a pause takes effect on the first resumed slice; pause adds no slices or simulation time. Pauses, dialogs, hidden tabs and gaps never become a large catch-up slice. No pending action may occur after the activity finishes.
- Direct throttle-slider writes are not a v1 replay action. Disable the absolute slider during ranked play and retain the normalized throttle/collective rate controls. Absolute pose, velocity, speed, power, wind, time, score, initial-state, assist and arbitrary property-setting actions are forbidden.

Limits (`RUN_LIMITS`): 16 MiB UTF-8 JSON body, 120,000 slices, 600 total simulation seconds, 1,024 total discrete actions, 0.025 seconds per slice. All are independent hard caps; no truncation or clamping. The server caps the body before parsing JSON and validates every slice before constructing a simulation. Unknown fields, versions, axes/actions, nonfinite values, invalid bounds, empty, incomplete, failed and trailing-after-finish recordings are rejected. Duplicate JSON property names should be rejected at the HTTP parser boundary if its parser supports that; transport requests use the strict canonical schema.

## Live recorder integration

```js
import { RunRecorder } from './run-recorder.js';
const previousEngine = flight.engine, previousHeightAt = flight.heightAt;
const recorder = new RunRecorder(serverAttempt, {
  now: serverClockNow, existing: {flight, activities},
}); // resets into the prescribed start, using canonical ranked engine/terrain
const pendingActions = [];
// Replace the ordinary flight.update + activities.update for a ranked slice:
controls.advance(inputTime, (dt, normalized) => {
  if (activities.finished || recorder.state !== 'recording') return;
  recorder.step(dt, normalized, pendingActions.splice(0));
});
// Once the activity succeeds, before retry/free flight can reset anything:
const replay = recorder.finish({now: serverClockNow});
// Submit replay once. Restore after ranked mode ends:
flight.engine = previousEngine; flight.heightAt = previousHeightAt;
```

No server time is read internally. Use the attempt response's `serverNow` plus monotonic elapsed time as the client's approximate server clock. The server checks its own clock. `step` both records and actually steps flight/activity exactly once; never call those updates a second time. `simulation` exposes the same live components to views.

`observe()` checks the bound flight/activity, reset identity (including time-zero resets), aircraft, accumulated simulation time, success/failure, manual state, engine, terrain and prescribed wind. Call it while paused/before result actions too. It rejects unrecorded physics advancement. `invalidate(reason)` is sticky; cancel/reset/retry/aircraft/activity changes must call it before their handlers act, including same-activity restart. Every assist/hover-hold/heading-hold enabling handler must call `invalidate("ASSIST_USED")` **before** the controller can disengage assist due to pilot input or a stall. Weather/setup changes also invalidate. Do not re-enable that recording when the pilot turns assist off again. Construct a new recorder and server attempt for a retry. Failed recordings clear their retained slices and cannot finish. `state` is `recording`, `invalid` or `finalized`; `reason`, `seconds` and `slices` support local status.

`finish({now})` observes eligibility and success, checks attempt lifetime and wire limits, finalizes once, and returns a detached replay object. A second finish/step/observe throws `RECORDING_FINALIZED`. Duplicate recording is not another score submission. Save the returned replay for a network retry, which must use the same attempt id. An incomplete finish invalidates the recording. Recorders are local UX guards, never the security boundary; clients can edit JavaScript. A reconstructed successful input sequence proves success under these arcade rules, not human authorship or absence of external automation.

## HTTP and persistence contract

These are the shared recommended endpoints/data shapes for the service and view; this PR supplies the pure modules, not an HTTP server or UI. Identifiers match `[a-zA-Z0-9_-]{1,96}`. Authentication/ownership comes from the server session, never a submitted user id. Public responses contain no email, credentials or replay data.

`POST /api/ranked/attempts` with `{board: <canonical board>}` issues a fresh opaque random id and returns HTTP 201:

```js
{ attempt: {id, board, status: 'open', issuedAt, expiresAt}, serverNow }
```

All times are Unix milliseconds. `issuedAt <= serverNow < expiresAt`; lifetime is at most one hour (`RUN_LIMITS.attemptLifetimeMs`). The service stores immutable `id`, owner, full canonical board, issued/expires times, status, and eventual submission/result. It may permit only one open attempt per owner; if it does, superseded attempts must be marked cancelled and the view must discard their recorder. Paused simulation time never affects scoring, but the one-hour server expiry still applies. A browser reload loses the live run; it cannot resume by supplying a pose. Local reset, cancellation and retry must discard the attempt. Cancellation is idempotent via `DELETE /api/ranked/attempts/:id` (204), without creating an entry; future submissions return finalized/cancelled conflict. The service should apply issuance/submission rate limits independent of replay bounds.

`POST /api/ranked/submissions` with the replay object itself (no score or user wrapper):

1. Authenticate; cap raw body bytes before parsing. Load attempt by `attemptId` and authenticated owner. Ownership mismatch/missing id is a generic 404. Compare full canonical board. Do not accept a client-created attempt, timestamps or status.
2. Serialize submissions/cancellations for that attempt. A transaction or a single-attempt processing claim prevents concurrent duplicate verification. An already accepted *identical canonical replay* returns its stored result (200); a different payload for an accepted id returns `ATTEMPT_FINALIZED` (409). A cancelled, rejected or superseded attempt also returns 409. Keep a server-calculated cryptographic digest of canonical replay JSON (canonical board field order and numeric array order); do not trust a client digest. The pure verifier intentionally has no global duplicate store and returns finalized for non-open attempts. For an accepted identical retry, the service returns its saved response before invoking it, even after expiry.
3. Call `verifyReplay(replay, trustedAttempt, {now: serverNow})`. It returns `{ok:false,code,message}` for expected rejection or `{ok:true,board,boardKey,metrics,simulationSeconds,slices}`. It validates the entire bounded replay before constructing a new isolated `FlightController` and all four Activities components, rebuilds the start and real terrain, applies every action/control slice, and accepts only genuine success at the end. No pose/score claims enter the simulator. Do CPU work in a bounded worker or serialized job; never expose an unbounded public synchronous replay loop. Unexpected programming errors throw and must be HTTP 500, with no score written.
4. Recheck expiry and open/processing ownership before committing (verification may take time). On an accepted result, finalize the attempt and insert exactly one immutable entry in the same transaction, using only verifier metrics and board. On a well-formed but ineligible/failed replay, finalize as rejected; allow a new attempt. Malformed transport/version requests may return before acquiring the attempt claim. Never let a rejected payload overwrite an accepted result.

First acceptance is HTTP 201; exact idempotent retry is HTTP 200:

```js
{ entry: {id, board, boardKey, displayName, metrics, submittedAt}, serverNow }
```

The service assigns the sanitized display name, entry id and accepted timestamp. Best-per-pilot boards, if desired, keep all verified entries but expose only the best score tuple for each pilot (earliest accepted/id for a score tie). State that filtering in the response; do not silently change the rank policy. The default contract ranks accepted runs, one entry per attempt.

`GET /api/ranked/boards?activity=...&aircraft=...` returns `{rulesVersion, boards:[{board,boardKey}], limits:RUN_LIMITS}` for supported combinations, with optional activity/aircraft filters. Build entries through `makeBoard`; omit unavailable combinations. `GET /api/ranked/leaderboard?boardKey=<encoded>&limit=20&cursor=...` returns `{board,boardKey,entries:[{...entry,rank}],nextCursor,serverNow}`. Limit is a bounded integer (1–100). Bind any opaque cursor to the board and deterministic score/time/id ordering; reject cross-board cursors. In an empty board, return an empty entries array and null cursor. Read-only historical boards may have older rules, but the service never passes them to the v1 verifier as current rules.

Errors use `{error:{code,message}}`. Stable module codes include `UNSUPPORTED_RULES`, `UNSUPPORTED_REPLAY` (422); `INVALID_BOARD`, `INVALID_ATTEMPT`, `INVALID_REPLAY`, `INVALID_SLICE`, `INVALID_CONTROLS`, `INVALID_ACTION`, `ATTEMPT_MISMATCH`, `BOARD_MISMATCH` (400); `REPLAY_LIMIT` (413); `STALE_ATTEMPT` (410); `ATTEMPT_FINALIZED` (409); `INCOMPLETE_RUN`, `TRAILING_SLICES`, `INELIGIBLE_RUN` (422). `INVALID_ENTRY` and `INVALID_METRICS` indicate service misuse of ranking functions, not permission to accept client metrics. Local recorder codes additionally include `RECORDING_FINALIZED`, and sticky `reason` values `STALE_RECORDING`, `SETUP_CHANGED`, `ASSIST_USED`, `FAILED_RUN`. Display a short eligibility explanation; retain the code for diagnostics. Unknown versions never silently use the current implementation.

## Validation

`tests/ranked-runs.test.js` records successful course, landing, crosswind and recovery flights using only ordinary controls through `FlightInputs`, then verifies detached JSON replays from fresh canonical starts. It also covers altered/malformed/replayed submissions, bounds, rejected versions, local reset/cancel/assist/setup changes, finalized recorders, pause behavior, explicit actions and rank ties. No injected aircraft positions or claimed scores establish replay success. The same suite runs with WASM initialized to prove ranked v1 keeps its prescribed reference engine.

Measured Mira T2 replay examples (60 fps input frames, actual partial simulation slices retained): course 211.798 s / 28,916 slices / 2,580,281 JSON bytes; landing 1.718 m/s touchdown sink / 0.000 m offset; crosswind 4.654 m offset / 1.717 m/s sink / 0.757° alignment; recovery 28.472 m lost / 9.125 s recovery. These are reproducible validation flights, not qualification thresholds. A separate successful helicopter landing exercises binding an existing live controller/activity pair.

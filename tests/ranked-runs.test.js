import test from 'node:test';
import assert from 'node:assert/strict';
import { FLEET } from '../src/fleet.js';
import { AIRPORTS } from '../src/airports.js';
import { referenceHeight } from '../src/terrain.js';
import { RULES_VERSION, REPLAY_VERSION, RUN_LIMITS, makeBoard, boardKey, rankEntries, compareEntries, rankingTuple } from '../src/ranked-rules.js';
import { RunRecorder } from '../src/run-recorder.js';
import { verifyReplay } from '../src/run-verifier.js';
import { runSucceeded, verifiedMetrics, createRankedSimulation, applyRunActions } from '../src/run-replay.js';
import { flyRanked } from './ranked-pilots.js';

const NOW = 1800000000000;
function attempt(activity = 'recovery', aircraft = 'trainer', selectors = {}) {
  return { id: 'attempt_1', board: makeBoard({ activity, aircraft, ...selectors }), status: 'open', issuedAt: NOW,
    expiresAt: NOW + RUN_LIMITS.attemptLifetimeMs };
}
const recording = a => new RunRecorder(a, { now: NOW });
const verify = (replay, a) => verifyReplay(replay, a, { now: NOW + 10 * 60 * 1000 });
const finish = r => r.finish({ now: NOW + 10 * 60 * 1000 });
const code = expected => error => error.code === expected;

test('boards partition every ranked dimension, explicitly validate availability and reject fallback selectors', () => {
  const base = makeBoard({ activity: 'landing', aircraft: 'trainer' });
  assert.equal(boardKey(base), `${RULES_VERSION}|landing|trainer|-|alpine-field|36|calm`);
  const variations = [makeBoard({ activity: 'landing', aircraft: 'jet' }),
    makeBoard({ activity: 'landing', aircraft: 'trainer', runway: '18' }),
    makeBoard({ activity: 'landing', aircraft: 'trainer', airport: 'orvane-regional' }),
    makeBoard({ activity: 'landing', aircraft: 'trainer', setup: 'gusts' }),
    makeBoard({ activity: 'crosswind', aircraft: 'trainer' }), makeBoard({ activity: 'course', aircraft: 'trainer' })];
  assert.equal(new Set([base, ...variations].map(boardKey)).size, variations.length + 1);
  for (const selectors of [{ airport: 'missing' }, { runway: '99' }, { setup: 'custom' }, { course: 'lake-azure' }, { unexpected: true }]) {
    assert.throws(() => makeBoard({ activity: 'landing', aircraft: 'trainer', ...selectors }), code('INVALID_BOARD'));
  }
  assert.throws(() => makeBoard({ activity: 'recovery', aircraft: 'jet' }), code('INVALID_BOARD'));
  assert.throws(() => makeBoard({ activity: 'course', aircraft: 'helicopter' }), code('INVALID_BOARD'));
  assert.throws(() => makeBoard({ activity: 'crosswind', aircraft: 'trainer', setup: 'calm' }), code('INVALID_BOARD'));
  assert.throws(() => makeBoard({ activity: 'course', aircraft: 'trainer', rulesVersion: 'old' }), code('UNSUPPORTED_RULES'));
  assert.throws(() => makeBoard({ activity: 'course', aircraft: 'toString' }), code('INVALID_BOARD'));
  assert.throws(() => makeBoard({ activity: 'course', aircraft: ['trainer'] }), code('INVALID_BOARD'));
  assert.throws(() => boardKey({ ...base, claimed: true }), code('INVALID_BOARD'));
  assert.ok(Object.isFrozen(base));
  // Every registered runway is a separate valid light-trainer landing board.
  for (const field of AIRPORTS) for (const runway of [field.runway, field.reciprocal]) {
    const board = makeBoard({ activity: 'landing', aircraft: 'trainer', airport: field.id, runway });
    assert.equal(board.runway, runway); assert.equal(board.airport, field.id);
  }
  for (const type of Object.values(FLEET)) if (type.flight.rotorcraft) {
    assert.throws(() => makeBoard({ activity: 'crosswind', aircraft: type.id }), code('INVALID_BOARD'));
  }
});

const successful = new Map();
for (const activity of ['course', 'landing', 'crosswind', 'recovery']) test(`${activity}: ordinary recorded controls complete and independently replay on real terrain`, () => {
  const a = attempt(activity), r = recording(a), x = flyRanked(r);
  assert.equal(runSucceeded(x), true, JSON.stringify({ course: x.course.snapshot(), landing: x.landing.snapshot(), recovery: x.recovery.snapshot() }));
  assert.equal(x.s.autopilot, false); assert.equal(x.s.crashed, false);
  assert.equal(x.flight.backend, 'javascript'); assert.equal(x.flight.heightAt, referenceHeight);
  const expected = verifiedMetrics(x), replay = finish(r), result = verify(JSON.stringify(replay), a);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.metrics, expected);
  assert.equal(result.boardKey, boardKey(a.board)); assert.equal(result.slices, replay.steps.length);
  assert.equal(r.slices, replay.steps.length);
  assert.equal(result.simulationSeconds, r.seconds);
  assert.deepEqual(verify(replay, a), result, 'fresh independent replays have identical results');
  assert.ok(replay.steps.every(slice => slice.length === 8 && slice[0] > 0 && slice[0] <= 0.025));
  assert.ok(Object.values(expected).flat().every(Number.isSafeInteger));
  assert.equal(r.state, 'finalized');
  assert.throws(() => finish(r), code('RECORDING_FINALIZED'));
  assert.throws(() => r.step(1 / 120, {}), code('RECORDING_FINALIZED'));
  successful.set(activity, { a, replay, result });
});

test('the recorder binds existing live components and replays a real helicopter landing with the canonical engine', () => {
  const a = attempt('landing', 'helicopter'), existing = createRankedSimulation(attempt().board);
  existing.flight.engine = 'auto'; existing.flight.heightAt = () => 0;
  const r = new RunRecorder(a, { now: NOW, existing });
  assert.equal(r.simulation.flight, existing.flight); assert.equal(r.simulation.activities, existing.activities);
  assert.equal(r.simulation.s.aircraft, 'helicopter');
  assert.equal(r.simulation.flight.backend, 'javascript'); assert.equal(r.simulation.flight.heightAt, referenceHeight);
  flyRanked(r);
  const expected = verifiedMetrics(r.simulation);
  assert.deepEqual(verify(finish(r), a).metrics, expected);
});

test('successful replays reject client score/pose claims, truncation, altered controls and extra terminal slices', () => {
  const { a, replay } = successful.get('recovery');
  for (const field of ['score', 'position', 'initialState', 'metrics', 'userId']) {
    assert.equal(verify({ ...replay, [field]: { heightLostMm: 0 } }, a).code, 'INVALID_REPLAY');
  }
  assert.equal(verify({ ...replay, steps: replay.steps.slice(0, -1) }, a).code, 'INCOMPLETE_RUN');
  const neutral = replay.steps.map(slice => [slice[0], 0, 0, 0, 0, 0, 0, []]);
  assert.equal(verify({ ...replay, steps: neutral }, a).ok, false);
  assert.equal(verify({ ...replay, steps: [...replay.steps, replay.steps.at(-1)] }, a).code, 'TRAILING_SLICES');
  const badFlaps = structuredClone(replay); badFlaps.steps[0][7] = ['flaps'];
  assert.equal(verify(badFlaps, a).ok, false, 'ordinary allowed actions still have to satisfy recovery rules');
  assert.equal(verify({ ...replay, board: makeBoard({ activity: 'landing', aircraft: 'trainer' }) }, a).code, 'BOARD_MISMATCH');
  assert.equal(verify({ ...replay, attemptId: 'different' }, a).code, 'ATTEMPT_MISMATCH');
});

test('unsupported versions, malformed JSON/shapes, NaN, controls/actions and replay budgets reject before simulation', () => {
  const { a, replay } = successful.get('recovery');
  const short = { ...replay, steps: [[1 / 120, 0, 0, 0, 0, 0, 0, []]] };
  assert.equal(verify('{', a).code, 'INVALID_REPLAY');
  for (const input of [null, [], 42, {}, { ...short, steps: null }]) assert.equal(verify(input, a).ok, false);
  assert.equal(verify({ ...short, version: REPLAY_VERSION + 1 }, a).code, 'UNSUPPORTED_REPLAY');
  assert.equal(verify({ ...short, rulesVersion: 'unknown' }, a).code, 'UNSUPPORTED_RULES');
  for (const dt of [0, -1, NaN, Infinity, 0.026, '0.01']) {
    assert.equal(verify({ ...short, steps: [[dt, 0, 0, 0, 0, 0, 0, []]] }, a).code, 'INVALID_SLICE');
  }
  for (let axis = 1; axis <= 6; axis++) for (const invalid of [2, axis === 5 ? -0.1 : -2, null, '0', NaN, Infinity]) {
    const slice = structuredClone(short.steps[0]); slice[axis] = invalid;
    assert.equal(verify({ ...short, steps: [slice] }, a).code, 'INVALID_CONTROLS');
  }
  for (const actions of [['assist'], ['position'], ['gear', 'gear'], [null], {}, null]) {
    const slice = [...short.steps[0]]; slice[7] = actions;
    assert.equal(verify({ ...short, steps: [slice] }, a).code, 'INVALID_ACTION');
  }
  assert.equal(verify({ ...short, steps: [] }, a).code, 'REPLAY_LIMIT');
  const tooMany = { ...short, steps: Array(RUN_LIMITS.slices + 1).fill(short.steps[0]) };
  assert.equal(verify(JSON.stringify(tooMany), a).code, 'REPLAY_LIMIT');
  assert.equal(verify(' '.repeat(RUN_LIMITS.bytes + 1), a).code, 'REPLAY_LIMIT');
  assert.equal(verify({ ...short, steps: Array(24001).fill([0.025, 0, 0, 0, 0, 0, 0, []]) }, a).code, 'REPLAY_LIMIT');
  assert.equal(verify({ ...short, steps: Array(1025).fill([1 / 120, 0, 0, 0, 0, 0, 0, ['trim-neutral']]) }, a).code, 'REPLAY_LIMIT');
  const circular = { ...short }; circular.self = circular;
  assert.equal(verify(circular, a).code, 'INVALID_REPLAY');
});

test('server-issued attempt time, status, board and identity are required; local success does not override them', () => {
  const { a, replay } = successful.get('recovery');
  for (const now of [a.issuedAt - 1, a.expiresAt, a.expiresAt + 1]) {
    assert.equal(verifyReplay(replay, a, { now }).code, 'STALE_ATTEMPT');
  }
  for (const status of ['accepted', 'rejected', 'cancelled', 'processing', 'superseded']) assert.equal(verify(replay, { ...a, status }).code, 'ATTEMPT_FINALIZED');
  for (const invalid of [null, {}, { ...a, expiresAt: Infinity }, { ...a, issuedAt: -1 },
    { ...a, expiresAt: a.issuedAt + RUN_LIMITS.attemptLifetimeMs + 1 }]) assert.equal(verify(replay, invalid).ok, false);
  assert.equal(verifyReplay(replay, a).code, 'INVALID_ATTEMPT', 'no ambient wall clock fallback');
  assert.equal(verify(replay, { ...a, board: { ...a.board, rulesVersion: 'old' } }).code, 'UNSUPPORTED_RULES');
});

test('paused time adds no slices or score time and a resumed attempt replays identically; wall expiry still applies', () => {
  const a = attempt(), uninterrupted = recording(a), paused = recording(a);
  flyRanked(uninterrupted);
  let observed = false;
  flyRanked(paused, { pause: (r, frame) => {
    if (frame !== 240) return;
    const before = [r.seconds, r.slices, r.simulation.s.position.toArray(), r.simulation.recovery.snapshot()];
    for (let i = 0; i < 100; i++) r.observe();
    assert.deepEqual([r.seconds, r.slices, r.simulation.s.position.toArray(), r.simulation.recovery.snapshot()], before);
    observed = true;
  } });
  assert.equal(observed, true);
  assert.deepEqual(finish(paused), finish(uninterrupted));
  const expired = recording(a); flyRanked(expired);
  assert.throws(() => expired.finish({ now: a.expiresAt }), code('STALE_ATTEMPT'));
  assert.equal(expired.state, 'invalid');
});

test('local resets, aircraft/activity switches, cancellations, setup edits, unrecorded updates and assist invalidate permanently', () => {
  const changes = {
    'time-zero reset': x => x.flight.reset(),
    'aircraft switch': x => x.flight.setAircraft('jet'),
    cancel: x => x.activities.cancel(),
    retry: x => x.activities.startRecovery(x.flight),
    'activity switch': x => x.activities.startCourse(x.flight),
    wind: x => x.flight.setWind('breeze', { immediate: true }),
    terrain: x => { x.flight.heightAt = () => 0; },
    'external physics': x => x.flight.update(1 / 120),
    assist: x => x.flight.toggleAutopilot(),
  };
  for (const [label, change] of Object.entries(changes)) {
    const r = recording(attempt()); change(r.simulation);
    assert.throws(() => r.observe(), code('INELIGIBLE_RUN'), label);
    assert.equal(r.state, 'invalid', label); assert.equal(r.slices, 0);
    assert.throws(() => finish(r), code('INELIGIBLE_RUN'), label);
  }
  const toggle = recording(attempt()); toggle.invalidate('ASSIST_USED');
  toggle.simulation.flight.toggleAutopilot(); toggle.simulation.flight.toggleAutopilot();
  assert.throws(() => toggle.step(1 / 120), code('INELIGIBLE_RUN')); assert.equal(toggle.reason, 'ASSIST_USED');
  const bad = recording(attempt()); assert.throws(() => bad.step(1 / 120, { assist: true }), code('INVALID_CONTROLS'));
  assert.equal(bad.state, 'invalid');
  const nullAxis = recording(attempt()); assert.throws(() => nullAxis.step(1 / 120, { pitch: null }), code('INVALID_CONTROLS'));
  const badAction = recording(attempt()); assert.throws(() => badAction.step(1 / 120, {}, {}), code('INVALID_ACTION'));
  const incomplete = recording(attempt()); incomplete.step(1 / 120);
  assert.throws(() => finish(incomplete), code('INCOMPLETE_RUN')); assert.equal(incomplete.state, 'invalid');
});

test('only explicit allowed actions mutate live/replayed configuration, including held and neutral trim', () => {
  const a = attempt('course', 'jet'), r = recording(a), { flight, s } = r.simulation;
  const original = s.gearDown;
  r.step(1 / 120, { trim: 1 }, ['gear', 'flaps']);
  assert.equal(s.gearDown, !original); assert.equal(s.flaps, 1); assert.ok(s.pitchTrim > 0);
  r.step(1 / 120, {}, ['trim-neutral']); assert.equal(s.pitchTrim, 0);
  assert.equal(r.slices, 2);
  assert.throws(() => applyRunActions(flight, ['assist']), code('INVALID_ACTION'));
  const fixed = createRankedSimulation(attempt('landing').board);
  applyRunActions(fixed.flight, ['gear']); assert.equal(fixed.s.gearDown, true, 'fixed gear action keeps normal no-op behavior');
});

test('a successful landing replays actual gear/flap actions and held/neutral trim in exact slice order', () => {
  const a = attempt('landing'), r = recording(a);
  // Cycle all three flap settings, hold trim, then neutralize it before flying the approach. Fixed gear is a no-op.
  r.step(1 / 120, { trim: 1 }, ['gear', 'flaps']);
  r.step(1 / 120, { trim: 1 }, ['flaps']);
  r.step(1 / 120, {}, ['flaps', 'trim-neutral']);
  flyRanked(r);
  const expected = verifiedMetrics(r.simulation), replay = finish(r);
  assert.deepEqual(verify(replay, a).metrics, expected);
  const reordered = structuredClone(replay); reordered.steps[2][7] = ['trim-neutral'];
  assert.equal(verify(reordered, a).ok, false, 'omitting the final flap action fails the actual landing rules');
});

test('failed real flights cannot finalize; the verifier also rejects their reconstructed input sequence', () => {
  const a = attempt(), r = recording(a), steps = [];
  assert.throws(() => {
    for (let i = 0; i < 8000; i++) {
      const slice = [1 / 120, 0, 0, 0, 0, 0, 0, []]; steps.push(slice); r.step(slice[0]);
    }
  }, code('INELIGIBLE_RUN'));
  assert.equal(r.simulation.recovery.status, 'failed'); assert.equal(r.state, 'invalid');
  assert.throws(() => finish(r), code('INELIGIBLE_RUN'));
  assert.equal(verify({ version: REPLAY_VERSION, rulesVersion: RULES_VERSION, attemptId: a.id, board: a.board, steps }, a).ok, false);
});

test('ranking honors exact displayed metrics, activity-specific dimensions and deterministic shared ties', () => {
  const fixtures = {
    course: [{ elapsedMs: 1 }, { elapsedMs: 2 }],
    landing: [{ sinkMmPerSecond: 1, centrelineMm: 9999, alignmentMilliDegrees: 9999 }, { sinkMmPerSecond: 2, centrelineMm: 0, alignmentMilliDegrees: 0 }],
    crosswind: [{ centrelineMm: 1, sinkMmPerSecond: 9999, alignmentMilliDegrees: 9999 }, { centrelineMm: 2, sinkMmPerSecond: 0, alignmentMilliDegrees: 0 }],
    recovery: [{ heightLostMm: 1, recoveryMs: 9999 }, { heightLostMm: 2, recoveryMs: 0 }],
  };
  for (const [activity, [best, worse]] of Object.entries(fixtures)) {
    const board = attempt(activity).board;
    const entry = (id, metrics, submittedAt = NOW) => ({ id, board, metrics, submittedAt });
    const entries = [entry('bad', worse, NOW - 100), entry('z', best), entry('a', best), entry('early', best, NOW - 1)];
    const sorted = rankEntries(entries);
    assert.deepEqual(sorted.map(e => e.id), ['early', 'a', 'z', 'bad']);
    assert.deepEqual(sorted.map(e => e.rank), [1, 1, 1, 4]);
    assert.deepEqual(entries.map(e => e.id), ['bad', 'z', 'a', 'early']);
    const dimensions = rankingTuple(board, best);
    for (const key of Object.keys(best)) {
      const next = { ...best, [key]: best[key] + 1 };
      assert.ok(compareEntries(entry('a', best), entry('b', next)) < 0, `${activity}: ${key}`);
    }
    assert.ok(dimensions.every(Number.isSafeInteger));
    assert.throws(() => rankingTuple(board, {}), code('INVALID_METRICS'));
    assert.throws(() => rankEntries([entries[0], entries[0]]), code('INVALID_ENTRY'));
  }
  const entry = { id: 'one', board: attempt('course').board, metrics: { elapsedMs: 100 }, submittedAt: NOW };
  assert.throws(() => compareEntries(entry, { ...entry, board: makeBoard({ activity: 'course', aircraft: 'jet' }) }), code('BOARD_MISMATCH'));
  assert.throws(() => compareEntries(entry, { ...entry, metrics: { elapsedMs: NaN } }), code('INVALID_METRICS'));
  assert.throws(() => compareEntries(null, entry), code('INVALID_ENTRY'));
  assert.deepEqual(rankEntries([]), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, boardKey } from '../src/ranked-rules.js';
import { chooseBoard, createLeaderboardModel, metricText, scoreFields } from '../src/leaderboard-model.js';

const landing = makeBoard({ activity: 'landing', aircraft: 'trainer' });
const course = makeBoard({ activity: 'course', aircraft: 'trainer' });
const recovery = makeBoard({ activity: 'recovery', aircraft: 'trainer' });
const catalog = { boards: [landing, course, recovery].map(board => ({ board, boardKey: boardKey(board) })) };
const page = (id, nextCursor = null) => ({ entries: [{ id }], nextCursor });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const stub = overrides => ({ boards: async () => catalog, profile: async () => null, saveProfile: async displayName => ({ displayName }), ...overrides });

test('uses applicable canonical boards and existing metrics, without mixing incompatible selections', () => {
  assert.equal(chooseBoard([landing, course, recovery], landing, { activity: 'recovery' }), recovery);
  assert.equal(chooseBoard([landing, course], landing, { aircraft: 'not-in-catalog' }), null);
  assert.deepEqual(scoreFields(landing), ['sinkMmPerSecond', 'centrelineMm', 'alignmentMilliDegrees']);
  assert.equal(metricText(1718), '1.718'); assert.equal(metricText(0), '0.000'); assert.equal(metricText(211798), '211.798');
});

test('filter changes abort requests and discard stale responses even from a transport ignoring cancellation', async () => {
  const requests = [], states = [];
  const model = createLeaderboardModel(stub({ leaderboard: (board, options) => { const d = deferred(); requests.push({ board, ...options, ...d }); return d.promise; } }), state => states.push(state.entries.map(row => row.id)));
  const mounting = model.mount(landing); await flush();
  model.select('activity', 'course');
  assert.ok(requests[0].signal.aborted); assert.equal(requests[1].board, course);
  requests[1].resolve(page('new')); await flush();
  requests[0].resolve(page('stale')); await mounting;
  assert.deepEqual(model.state.entries.map(row => row.id), ['new']); assert.ok(!states.flat().includes('stale'));
  model.unmount();
});

test('pagination retains global ranks, retries the same opaque cursor, and rejects duplicate pages', async () => {
  const calls = []; let fail = true;
  const model = createLeaderboardModel(stub({ leaderboard: async (_board, options) => {
    calls.push(options.cursor);
    if (!options.cursor) return { ...page('one', 'next'), entries: [{ id: 'one', rank: 1 }] };
    if (fail) throw Object.assign(new Error(), { code: 'SERVICE_UNAVAILABLE' });
    return { ...page('two'), entries: [{ id: 'two', rank: 21 }] };
  } }), () => {});
  await model.mount(landing); await model.loadPage(true);
  assert.equal(model.state.status, 'page-error'); assert.equal(model.state.entries[0].rank, 1);
  fail = false; await model.loadPage(true);
  assert.deepEqual(calls, [undefined, 'next', 'next']); assert.equal(model.state.entries[1].rank, 21); assert.equal(model.state.nextCursor, null);
  model.unmount();
  const duplicate = createLeaderboardModel(stub({ leaderboard: async () => page('one', 'next') }), () => {});
  await duplicate.mount(landing); await duplicate.loadPage(true);
  assert.equal(duplicate.state.error.code, 'INVALID_RESPONSE'); assert.equal(duplicate.state.entries.length, 1);
  duplicate.unmount();
});

test('empty boards, empty catalog and independent profile errors do not invent entries', async () => {
  const model = createLeaderboardModel(stub({ leaderboard: async () => ({ entries: [], nextCursor: null }), profile: async () => { throw new Error('offline'); } }), () => {});
  await model.mount(landing); assert.equal(model.state.status, 'ready'); assert.deepEqual(model.state.entries, []); assert.equal(model.state.profileStatus, 'error');
  model.unmount();
  const empty = createLeaderboardModel(stub({ boards: async () => ({ boards: [] }) }), () => {});
  await empty.mount(landing); assert.equal(empty.state.status, 'no-boards'); assert.equal(empty.state.board, null); empty.unmount();
});

test('closing cancels catalog, page and profile requests and ignores later completions', async () => {
  const pending = deferred(), profile = deferred(); let signal, count = 0;
  const model = createLeaderboardModel(stub({ leaderboard: (_board, options) => { signal = options.signal; return pending.promise; }, profile: () => profile.promise }), () => { count++; });
  const mounting = model.mount(landing); await flush(); model.unmount(); const atClose = count;
  assert.ok(signal.aborted); pending.resolve(page('late')); profile.resolve({ displayName: 'Late pilot' }); await mounting;
  assert.equal(count, atClose); assert.deepEqual(model.state.entries, []);
});

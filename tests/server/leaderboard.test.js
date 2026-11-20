import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createPool, migrate, transaction } from '../../server/database.js';
import { createApp } from '../../server/http.js';
import { verifyInWorker } from '../../server/verifier.js';
import { digest, cursorFor } from '../../server/protocol.js';
import { RUN_LIMITS, makeBoard, boardKey, rankEntries } from '../../src/ranked-rules.js';
import { RunRecorder } from '../../src/run-recorder.js';
import { flyRanked } from '../ranked-pilots.js';

const templates = new Map();
function replayFor(attempt) {
  const key = boardKey(attempt.board);
  if (!templates.has(key)) {
    const recorder = new RunRecorder(attempt, { now: attempt.issuedAt });
    flyRanked(recorder);
    templates.set(key, recorder.finish({ now: attempt.issuedAt + 1 }));
  }
  return { ...structuredClone(templates.get(key)), attemptId: attempt.id };
}
const recovery = makeBoard({ activity: 'recovery', aircraft: 'trainer' });

async function fixture(t) {
  const admin = createPool(), schema = `ranked_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(undefined, { options: `-c search_path=${schema}` });
  const distDir = await mkdtemp(join(tmpdir(), 'aeronaut-server-'));
  await mkdir(join(distDir, 'assets'));
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Aeronaut</title><div id="app"></div>');
  await writeFile(join(distDir, 'assets', 'sample.js'), 'export const answer = 42;');
  await writeFile(join(distDir, 'flight.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const servers = [];
  async function start(options = {}) {
    const server = createApp({ pool, distDir, ...options });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server);
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  }
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    await rm(distDir, { recursive: true });
  });
  await Promise.all([migrate(pool), migrate(pool)]);
  return { pool, schema, distDir, start, ...await start() };
}

function browser(url) {
  const b = { url, cookie: '' };
  b.request = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const response = await fetch(b.url + path, { method,
      headers: { ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: b.url, 'Content-Type': 'application/json' }),
        ...(b.cookie ? { Cookie: b.cookie } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) b.cookie = cookie.split(';')[0];
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : text };
  };
  b.profile = async name => {
    const result = await b.request('/api/ranked/profile', { method: 'PUT', body: { displayName: name } });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result;
  };
  b.issue = async (board = recovery) => {
    const result = await b.request('/api/ranked/attempts', { method: 'POST', body: { board } });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.attempt;
  };
  b.submit = replay => b.request('/api/ranked/submissions', { method: 'POST', body: replay });
  b.board = (board = recovery, query = '') => b.request(`/api/ranked/leaderboard?boardKey=${encodeURIComponent(boardKey(board))}${query}`);
  return b;
}
const error = (result, status, code) => { assert.equal(result.status, status, JSON.stringify(result.body)); assert.equal(result.body.error.code, code); };

test('real PostgreSQL leaderboard and HTTP contract', { timeout: 120000 }, async t => {
  const f = await fixture(t), alice = browser(f.url), bob = browser(f.url), guest = browser(f.url);
  let first, second, third, aliceReplay;
  await t.test('anonymous profiles use an opaque HttpOnly cookie and sanitized names', async () => {
    const unknown = await guest.request('/api/ranked/profile'); assert.equal(unknown.body.profile, null);
    const a = await alice.profile('  Alice <>&\u202e  '), b = await bob.profile('Bob');
    assert.deepEqual(a.body.profile, { displayName: 'Alice' }); assert.deepEqual(b.body.profile, { displayName: 'Bob' });
    assert.match(a.headers.get('set-cookie'), /HttpOnly/); assert.match(a.headers.get('set-cookie'), /SameSite=None/); assert.match(a.headers.get('set-cookie'), /Secure/);
    assert.notEqual(alice.cookie, bob.cookie); assert.match(alice.cookie, /^__Host-aeronaut-pilot=[\w-]{43}$/);
    assert.equal((await alice.request('/api/ranked/profile')).headers.get('cache-control'), 'private, no-store');
    error(await guest.request('/api/ranked/attempts', { method: 'POST', body: { board: recovery } }), 401, 'PROFILE_REQUIRED');
    error(await alice.request('/api/ranked/profile', { method: 'PUT', body: { displayName: 'x' } }), 400, 'INVALID_NAME');
    error(await alice.request('/api/ranked/profile', { method: 'PUT', body: { displayName: 'Pilot', pilotId: 'forged' } }), 400, 'INVALID_PROFILE');
    const row = (await f.pool.query('SELECT cookie_hash FROM ranked_pilots WHERE display_name = $1', ['Alice'])).rows[0];
    assert.equal(row.cookie_hash, digest(alice.cookie.split('=')[1]));
    assert.ok(!JSON.stringify(a.body).includes(row.cookie_hash));
  });
  await t.test('registry discovery and empty boards validate the full canonical board', async () => {
    const boards = await guest.request('/api/ranked/boards?activity=recovery&aircraft=trainer');
    assert.equal(boards.status, 200); assert.deepEqual(boards.body.boards, [{ board: recovery, boardKey: boardKey(recovery) }]);
    assert.equal(boards.body.limits.bytes, RUN_LIMITS.bytes);
    error(await guest.request('/api/ranked/boards?aircraft=toString'), 400, 'INVALID_BOARD');
    error(await guest.request('/api/ranked/leaderboard?boardKey=anything'), 400, 'INVALID_BOARD');
    error(await guest.board(recovery, '&limit=101'), 400, 'INVALID_LIMIT');
    const empty = await guest.board();
    assert.deepEqual(empty.body.entries, []); assert.equal(empty.body.nextCursor, null);
    assert.equal(empty.body.rankingPolicy, 'runs'); assert.equal(empty.body.personalBest, null);
    error(await alice.request('/api/ranked/attempts', { method: 'POST', body: { board: { ...recovery, setup: 'calm' } } }), 400, 'INVALID_BOARD');
    error(await alice.request('/api/ranked/attempts', { method: 'POST', body: { board: { ...recovery, rulesVersion: 'old' } } }), 422, 'UNSUPPORTED_RULES');
  });
  await t.test('same-origin writes reject cross-site requests and ignore forged proxy headers by default', async () => {
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' }]) {
      error(await alice.request('/api/ranked/profile', { method: 'PUT', body: { displayName: 'Stolen' }, headers }), 403, 'CROSS_ORIGIN');
    }
    error(await alice.request('/api/ranked/profile', { method: 'PUT', body: { displayName: 'Stolen' }, headers: { 'Content-Type': 'text/plain' } }), 415, 'INVALID_CONTENT_TYPE');
    assert.equal((await alice.request('/api/ranked/profile')).body.profile.displayName, 'Alice');
  });
  await t.test('trusted proxy requests set a secure host-only cookie and retain the public origin', async () => {
    const instance = await f.start({ trustProxy: true }), proxied = browser(instance.url);
    const headers = { Origin: 'https://flight.example.run.app', 'X-Forwarded-Host': 'flight.example.run.app',
      'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '192.0.2.10' };
    const response = await proxied.request('/api/ranked/profile', { method: 'PUT', body: { displayName: 'Proxy pilot' }, headers });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /^__Host-aeronaut-pilot=/); assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=None/);
    assert.ok(!cookie.includes('Domain='));
    const profile = await proxied.request('/api/ranked/profile', { headers });
    assert.deepEqual(profile.body.profile, { displayName: 'Proxy pilot' });
  });
  await t.test('tickets are server-owned, expiring and cancellable without exposing ownership', async () => {
    const attempt = await alice.issue();
    assert.ok(attempt.issuedAt < attempt.expiresAt); assert.equal(attempt.expiresAt - attempt.issuedAt, RUN_LIMITS.attemptLifetimeMs);
    assert.deepEqual(Object.keys(attempt).sort(), ['board', 'expiresAt', 'id', 'issuedAt', 'status']);
    error(await bob.submit(replayFor(attempt)), 404, 'NOT_FOUND');
    error(await bob.request(`/api/ranked/attempts/${attempt.id}`, { method: 'DELETE' }), 404, 'NOT_FOUND');
    error(await alice.submit({ ...replayFor(attempt), attemptId: 'made_up' }), 404, 'NOT_FOUND');
    error(await alice.submit({ ...replayFor(attempt), board: makeBoard({ activity: 'landing', aircraft: 'trainer' }) }), 400, 'BOARD_MISMATCH');
    for (let i = 0; i < 2; i++) assert.equal((await alice.request(`/api/ranked/attempts/${attempt.id}`, { method: 'DELETE' })).status, 204);
    error(await alice.submit(replayFor(attempt)), 409, 'ATTEMPT_FINALIZED');
    const expired = await alice.issue();
    await f.pool.query('UPDATE ranked_attempts SET issued_at = issued_at - $2, expires_at = expires_at - $2 WHERE id = $1', [expired.id, RUN_LIMITS.attemptLifetimeMs + 1000]);
    error(await alice.submit(replayFor(expired)), 410, 'STALE_ATTEMPT');
  });
  await t.test('parallel identical submissions across instances insert one entry and return a saved result', async () => {
    const instance = await f.start(), otherAlice = browser(instance.url); otherAlice.cookie = alice.cookie;
    const attempt = await alice.issue(); aliceReplay = replayFor(attempt);
    const results = await Promise.all([alice.submit(aliceReplay), otherAlice.submit(aliceReplay)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
    first = results[0].body.entry; assert.deepEqual(results[1].body.entry, first);
    assert.equal((await f.pool.query('SELECT count(*) FROM ranked_entries WHERE id = $1', [attempt.id])).rows[0].count, '1');
    assert.equal((await f.pool.query("SELECT status FROM ranked_attempts WHERE id = $1", [attempt.id])).rows[0].status, 'accepted');
    assert.ok(Object.values(first.metrics).every(Number.isSafeInteger));
    const reordered = { steps: aliceReplay.steps, board: Object.fromEntries(Object.entries(aliceReplay.board).reverse()),
      attemptId: aliceReplay.attemptId, rulesVersion: aliceReplay.rulesVersion, version: aliceReplay.version };
    assert.deepEqual((await alice.submit(reordered)).body.entry, first);
    error(await alice.submit({ ...aliceReplay, steps: aliceReplay.steps.slice(0, -1) }), 409, 'ATTEMPT_FINALIZED');
    await f.pool.query('UPDATE ranked_attempts SET issued_at = issued_at - $2, expires_at = expires_at - $2 WHERE id = $1', [attempt.id, RUN_LIMITS.attemptLifetimeMs + 1000]);
    assert.equal((await alice.submit(aliceReplay)).status, 200, 'accepted identical retry works after expiry');
  });
  await t.test('entries retain their names, show only own flags, and keep a transactional personal best', async () => {
    await alice.profile('Alice renamed');
    const a2 = await alice.issue(), b1 = await bob.issue();
    const accepted = await Promise.all([alice.submit(replayFor(a2)), bob.submit(replayFor(b1))]);
    assert.deepEqual(accepted.map(r => r.status), [201, 201]);
    second = accepted[0].body.entry; third = accepted[1].body.entry;
    assert.equal(second.displayName, 'Alice renamed'); assert.equal(first.displayName, 'Alice');
    const board = await alice.board();
    assert.equal(board.body.entries.length, 3); assert.ok(board.body.entries.every(e => e.rank === 1));
    assert.equal(board.body.entries.filter(e => e.isOwn).length, 2); assert.equal(board.body.personalBest.id, first.id);
    assert.equal(board.body.personalBest.isOwn, true); assert.equal(board.body.personalBest.rank, 1);
    assert.equal((await bob.board()).body.personalBest.id, third.id);
    const anonymous = await guest.board();
    assert.ok(anonymous.body.entries.every(e => e.isOwn === false)); assert.equal(anonymous.body.personalBest, null);
    for (const entry of board.body.entries) assert.deepEqual(Object.keys(entry).sort(),
      ['board', 'boardKey', 'displayName', 'id', 'isOwn', 'metrics', 'rank', 'submittedAt']);
    assert.equal((await f.pool.query('SELECT count(*) FROM ranked_bests')).rows[0].count, '2');
  });
  await t.test('keyset pagination preserves full-board tie ranks and returns personal best outside the page', async () => {
    const expected = rankEntries([third, first, second]);
    const actual = []; let cursor = '';
    for (let i = 0; i < 3; i++) {
      const result = await alice.board(recovery, `&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(result.status, 200); actual.push(...result.body.entries);
      assert.equal(result.body.personalBest.id, first.id); cursor = result.body.nextCursor;
    }
    assert.equal(cursor, null); assert.deepEqual(actual.map(e => e.id), expected.map(e => e.id));
    assert.deepEqual(actual.map(e => e.rank), [1, 1, 1]);
    const crossBoard = makeBoard({ activity: 'landing', aircraft: 'trainer' });
    error(await guest.board(crossBoard, `&cursor=${cursorFor(boardKey(recovery), first.id)}`), 400, 'INVALID_CURSOR');
    error(await guest.board(recovery, `&cursor=${cursorFor(boardKey(recovery), 'nonexistent')}`), 400, 'INVALID_CURSOR');
    error(await guest.board(recovery, '&cursor=garbage'), 400, 'INVALID_CURSOR');
  });
  await t.test('invalid controls, incomplete and tampered replays never write scores and consume rejected tickets', async () => {
    for (const [change, status, code] of [
      [r => ({ ...r, steps: r.steps.slice(0, -1) }), 422, 'INCOMPLETE_RUN'],
      [r => ({ ...r, steps: [...r.steps, r.steps.at(-1)] }), 422, 'TRAILING_SLICES'],
      [r => { r.steps[0][1] = 2; return r; }, 400, 'INVALID_CONTROLS'],
      [r => { r.steps[0][7] = ['assist']; return r; }, 400, 'INVALID_ACTION'],
      [r => ({ ...r, steps: r.steps.map(s => [s[0], 0, 0, 0, 0, 0, 0, []]) }), 422, 'INCOMPLETE_RUN'],
    ]) {
      const a = await bob.issue(), replay = change(replayFor(a)); error(await bob.submit(replay), status, code);
      error(await bob.submit(replayFor(a)), 409, 'ATTEMPT_FINALIZED');
      assert.equal((await f.pool.query('SELECT 1 FROM ranked_entries WHERE id = $1', [a.id])).rowCount, 0);
      assert.equal((await f.pool.query('SELECT status FROM ranked_attempts WHERE id = $1', [a.id])).rows[0].status, 'rejected');
    }
  });
  await t.test('byte, version, schema and simulation budgets are hard bounds', async () => {
    // Reset only rate-test data; prior pilots, tickets and scores remain throughout this suite.
    await f.pool.query('TRUNCATE ranked_throttles');
    const a = await bob.issue(), replay = replayFor(a);
    error(await bob.submit({ ...replay, score: 0 }), 400, 'INVALID_REPLAY');
    error(await bob.submit({ ...replay, rulesVersion: 'future' }), 422, 'UNSUPPORTED_RULES');
    error(await bob.submit({ ...replay, version: 99 }), 422, 'UNSUPPORTED_REPLAY');
    error(await bob.request('/api/ranked/submissions', { method: 'POST', raw: '{' }), 400, 'INVALID_REPLAY');
    error(await bob.request('/api/ranked/submissions', { method: 'POST', raw: ' '.repeat(RUN_LIMITS.bytes + 1) }), 413, 'REPLAY_LIMIT');
    error(await bob.submit({ ...replay, steps: Array(RUN_LIMITS.slices + 1).fill([0.01, 0, 0, 0, 0, 0, 0, []]) }), 413, 'REPLAY_LIMIT');
    error(await bob.submit({ ...replay, steps: Array(24001).fill([0.025, 0, 0, 0, 0, 0, 0, []]) }), 413, 'REPLAY_LIMIT');
    const nonfinite = await bob.issue(), bad = replayFor(nonfinite);
    const text = JSON.stringify(bad).replace(/"steps":\[\[[^,]+,/, '"steps":[[1e999,');
    error(await bob.request('/api/ranked/submissions', { method: 'POST', raw: text }), 400, 'INVALID_SLICE');
    const chunked = await new Promise((resolve, reject) => {
      const req = request(`${bob.url}/api/ranked/submissions`, { method: 'POST', headers: {
        Origin: bob.url, Cookie: bob.cookie, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked',
      } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject); req.end(' '.repeat(RUN_LIMITS.bytes + 1));
    });
    error(chunked, 413, 'REPLAY_LIMIT');
  });
  await t.test('unequal successful scores use full-board competition ranks across pages', async () => {
    const carol = browser(f.url); await carol.profile('Carol');
    const a = await carol.issue(), recorder = new RunRecorder(a, { now: a.issuedAt });
    flyRanked(recorder, { rate: 30 });
    const result = await carol.submit(recorder.finish({ now: a.issuedAt + 1 }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.notDeepEqual(result.body.entry.metrics, first.metrics, 'different normal-input feedback produces a distinct successful score');
    const expected = rankEntries([first, second, third, result.body.entry]);
    const board = await carol.board();
    assert.deepEqual(board.body.entries.map(e => [e.id, e.rank]), expected.map(e => [e.id, e.rank]));
    const page = await carol.board(recovery, `&limit=2&cursor=${cursorFor(boardKey(recovery), expected[1].id)}`);
    assert.deepEqual(page.body.entries.map(e => [e.id, e.rank]), expected.slice(2).map(e => [e.id, e.rank]));
  });
  await t.test('database-wide verification slots reject excess work without consuming tickets', async () => {
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      for (const slot of [10, 11]) await client.query('SELECT pg_advisory_xact_lock(1634038382, $1)', [slot]);
      const a = await bob.issue(), replay = replayFor(a);
      error(await bob.submit(replay), 503, 'SERVICE_BUSY');
      assert.equal((await f.pool.query('SELECT status FROM ranked_attempts WHERE id = $1', [a.id])).rows[0].status, 'open');
      await client.query('ROLLBACK');
      assert.equal((await bob.submit(replay)).status, 201);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await t.test('all four activities are verified by the service on their own boards', async () => {
    for (const activity of ['landing', 'crosswind', 'course']) {
      const board = makeBoard({ activity, aircraft: 'trainer' }), a = await alice.issue(board);
      const response = await alice.submit(replayFor(a));
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.entry.boardKey, boardKey(board));
      const list = await guest.board(board); assert.equal(list.body.entries.length, 1);
      assert.equal(list.body.entries[0].rank, 1); assert.equal(list.body.personalBest, null);
    }
  });
  await t.test('separate simultaneous tickets from one pilot update exactly one personal best', async () => {
    const instance = await f.start(), otherBob = browser(instance.url); otherBob.cookie = bob.cookie;
    const a = await bob.issue(), b = await bob.issue();
    const results = await Promise.all([bob.submit(replayFor(a)), otherBob.submit(replayFor(b))]);
    assert.deepEqual(results.map(r => r.status), [201, 201]);
    assert.equal((await bob.board()).body.personalBest.id, third.id);
    const pilot = (await f.pool.query('SELECT id FROM ranked_pilots WHERE display_name = $1', ['Bob'])).rows[0];
    assert.equal((await f.pool.query('SELECT count(*) FROM ranked_bests WHERE pilot_id = $1 AND board_key = $2', [pilot.id, boardKey(recovery)])).rows[0].count, '1');
  });
  await t.test('unexpected persistence failures return 500 and roll back ticket, entry and best together', async () => {
    const rollback = browser(f.url); await rollback.profile('Rollback pilot');
    const a = await rollback.issue(), replay = replayFor(a);
    // Fail after both entry and best were written, at the final ticket update.
    await f.pool.query(`CREATE FUNCTION fail_ranked_accept() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test acceptance failure'; END $$;
      CREATE TRIGGER fail_ranked_accept BEFORE UPDATE ON ranked_attempts FOR EACH ROW
        WHEN (NEW.status = 'accepted') EXECUTE FUNCTION fail_ranked_accept()`);
    try {
      error(await rollback.submit(replay), 500, 'INTERNAL_ERROR');
      assert.equal((await f.pool.query('SELECT status FROM ranked_attempts WHERE id = $1', [a.id])).rows[0].status, 'open');
      assert.equal((await f.pool.query('SELECT 1 FROM ranked_entries WHERE id = $1', [a.id])).rowCount, 0);
      assert.equal((await rollback.board()).body.personalBest, null);
    } finally { await f.pool.query('DROP TRIGGER fail_ranked_accept ON ranked_attempts; DROP FUNCTION fail_ranked_accept()'); }
    assert.equal((await rollback.submit(replay)).status, 201);
  });
  await t.test('cancellation racing submission cannot undo an accepted result or create a cancelled score', async () => {
    const a = await alice.issue(), replay = replayFor(a);
    const [submitted, cancelled] = await Promise.all([alice.submit(replay), alice.request(`/api/ranked/attempts/${a.id}`, { method: 'DELETE' })]);
    assert.equal(cancelled.status, 204);
    const state = (await f.pool.query('SELECT status FROM ranked_attempts WHERE id = $1', [a.id])).rows[0].status;
    assert.ok(['accepted', 'cancelled'].includes(state));
    assert.equal(submitted.status, state === 'accepted' ? 201 : 409);
    assert.equal((await f.pool.query('SELECT 1 FROM ranked_entries WHERE id = $1', [a.id])).rowCount, state === 'accepted' ? 1 : 0);
  });
  await t.test('throttles persist in PostgreSQL and operate before expensive verification', async () => {
    const pilot = (await f.pool.query('SELECT id FROM ranked_pilots WHERE display_name = $1', ['Bob'])).rows[0];
    await f.pool.query(`INSERT INTO ranked_throttles(subject, action, window_start, count)
      VALUES ($1, 'attempts', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint / 600000 * 600000, 30)
      ON CONFLICT(subject, action) DO UPDATE SET count = 30, window_start = EXCLUDED.window_start`, [pilot.id]);
    const limited = await bob.request('/api/ranked/attempts', { method: 'POST', body: { board: recovery } });
    error(limited, 429, 'RATE_LIMITED'); assert.equal(limited.headers.get('retry-after'), '30');
  });
  await t.test('static app routes retain SPA loading, WASM MIME, cache policy and production hosts', async () => {
    for (const path of ['/', '/flight/recovery']) {
      const result = await guest.request(path, { headers: { Accept: 'text/html' } });
      assert.equal(result.status, 200); assert.match(result.body, /<title>Aeronaut/);
      assert.equal(result.headers.get('cache-control'), 'no-cache');
    }
    assert.equal((await guest.request('/flight.wasm')).headers.get('content-type'), 'application/wasm');
    assert.match((await guest.request('/assets/sample.js')).headers.get('cache-control'), /immutable/);
    assert.equal((await guest.request('/flight.wasm', { method: 'HEAD' })).body, '');
    assert.equal((await guest.request('/', { headers: { Host: 'x.run.app' } })).status, 200);
    for (const path of ['/assets/missing.js', '/missing.wasm', '/.git/config', '/api/unknown']) assert.equal((await guest.request(path)).status, 404);
  });
  await t.test('a fresh OS process retains cookie identity, tickets, scores, bests and throttle state', async () => {
    const a = await alice.issue(), replay = replayFor(a);
    const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(),
      env: { ...process.env, PORT: '18089', PGOPTIONS: `-c search_path=${f.schema}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('listening')) resolve(); });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('exit', code => reject(new Error(`Service exited ${code}: ${output}`)));
    });
    const timeout = setTimeout(() => child.kill(), 20000);
    try {
      await ready;
      const restarted = browser('http://127.0.0.1:18089'); restarted.cookie = alice.cookie;
      assert.equal((await restarted.request('/api/ranked/profile')).body.profile.displayName, 'Alice renamed');
      assert.deepEqual((await restarted.submit(aliceReplay)).body.entry, first);
      assert.equal((await restarted.submit(replay)).status, 201, 'ticket issued before restart is still usable');
      assert.equal((await restarted.board()).body.personalBest.id, first.id);
      restarted.cookie = bob.cookie;
      error(await restarted.request('/api/ranked/attempts', { method: 'POST', body: { board: recovery } }), 429, 'RATE_LIMITED');
    } finally { clearTimeout(timeout); child.kill('SIGTERM'); await once(child, 'exit'); }
  });
});

test('replay workers have a hard deadline and terminate on timeout', async () => {
  const attempt = { id: 'worker_timeout', board: recovery, status: 'open', issuedAt: Date.now(), expiresAt: Date.now() + 3600000 };
  await assert.rejects(verifyInWorker(replayFor(attempt), attempt, attempt.issuedAt, { timeoutMs: 1 }),
    error => error.status === 503 && error.code === 'VERIFICATION_BUSY');
});

test('transaction failures roll back all mutations', async t => {
  const f = await fixture(t);
  await assert.rejects(transaction(f.pool, async client => {
    await client.query("INSERT INTO ranked_pilots VALUES ('rollback', 'hash', 'Rollback pilot', 1)");
    throw new Error('simulated application failure');
  }), /simulated application failure/);
  assert.equal((await f.pool.query("SELECT 1 FROM ranked_pilots WHERE id = 'rollback'")).rowCount, 0);
});

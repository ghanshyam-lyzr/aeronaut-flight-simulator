import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRankedClient } from '../src/ranked-client.js';
import { makeBoard, boardKey, RULES_VERSION } from '../src/ranked-rules.js';

const board = makeBoard({ activity: 'landing', aircraft: 'trainer' }), key = boardKey(board);
const row = (overrides = {}) => ({ id: 'run-1', board, boardKey: key, rank: 1, displayName: 'Fixture pilot', submittedAt: 1000, isOwn: false,
  metrics: { sinkMmPerSecond: 1718, centrelineMm: 0, alignmentMilliDegrees: 0, touchdownAlongMm: 120000, speedMmPerSecond: 31000, elapsedMs: 42000 }, ...overrides });
const page = (overrides = {}) => ({ board, boardKey: key, entries: [row()], nextCursor: null, serverNow: 1001, rankingPolicy: 'runs', personalBest: null, ...overrides });
async function fixture(t, handle, options) {
  const server = http.createServer(handle); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return createRankedClient({ ...options, fetch: (path, init) => {
    assert.ok(path.startsWith('/api/ranked/')); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
    return fetch(new URL(path, origin), init);
  } });
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };

test('browse/profile HTTP contract sends canonical encoded board and opaque cursor, with no owner supplied', async t => {
  const client = await fixture(t, async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.endsWith('/boards')) return json(res, { rulesVersion: RULES_VERSION, boards: [{ board, boardKey: key }] });
    if (url.pathname.endsWith('/leaderboard')) {
      assert.equal(url.searchParams.get('boardKey'), key); assert.equal(url.searchParams.get('cursor'), 'opaque+/=cursor'); assert.equal(url.searchParams.get('limit'), '20');
      return json(res, page({ personalBest: row({ isOwn: true }), rankingPolicy: 'runs' }));
    }
    if (req.method === 'PUT') {
      let body = ''; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { displayName: 'New pilot' });
      return json(res, { profile: { displayName: 'New pilot' }, serverNow: 1001 });
    }
    json(res, { profile: null, serverNow: 1001 });
  });
  assert.equal((await client.boards()).boards[0].boardKey, key);
  assert.equal((await client.leaderboard(board, { cursor: 'opaque+/=cursor' })).personalBest.isOwn, true);
  assert.equal(await client.profile(), null);
  assert.equal((await client.saveProfile('New pilot')).displayName, 'New pilot');
});

test('rejects wrong boards, invalid measurements, duplicate entries and unknown rank policies', async t => {
  for (const value of [page({ boardKey: 'wrong-board' }), page({ entries: [row({ metrics: { ...row().metrics, sinkMmPerSecond: 1.1 } })] }),
    page({ entries: [row(), row()] }), page({ rankingPolicy: 'secret-points' }), page({ entries: [row({ rank: 0 })] })]) {
    const client = await fixture(t, (_req, res) => json(res, value));
    await assert.rejects(client.leaderboard(board), { code: 'INVALID_RESPONSE' });
  }
});

test('static-host HTML, HTTP failure, malformed JSON, unsupported rules and timeout are honest errors', async t => {
  const html = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Vite fallback</html>'); });
  await assert.rejects(html.boards(), { code: 'SERVICE_UNAVAILABLE' });
  const unavailable = await fixture(t, (_req, res) => json(res, { error: { code: 'MAINTENANCE', message: 'Private server diagnostics' } }, 503));
  await assert.rejects(unavailable.boards(), error => error.status === 503 && error.code === 'MAINTENANCE' && !error.message.includes('Private'));
  const malformed = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); });
  await assert.rejects(malformed.boards(), { code: 'SERVICE_UNAVAILABLE' });
  const version = await fixture(t, (_req, res) => json(res, { rulesVersion: 'future-v2', boards: [] }));
  await assert.rejects(version.boards(), { code: 'UNSUPPORTED_RULES' });
  const slow = await fixture(t, () => {}, { timeoutMs: 15 });
  await assert.rejects(slow.boards(), { code: 'TIMEOUT' });
});

test('caller cancellation remains AbortError rather than becoming an unavailable-service error', async t => {
  const client = await fixture(t, () => {}), controller = new AbortController();
  const response = client.boards({ signal: controller.signal }); controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
});

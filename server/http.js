import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isIP } from 'node:net';
import { RUN_LIMITS, exactFields, validRunId, validateBoard } from '../src/ranked-rules.js';
import { databaseNow } from './database.js';
import { RankedStore, RATE_LIMITS, throttle } from './store.js';
import { HttpError, fail, digest, errorStatus, displayName, listBoards, boardFromKey, canonicalSubmission, readCursor } from './protocol.js';

function requestOrigin(req, trustProxy) {
  // Only use forwarded headers when an operator has configured a trusted reverse proxy.
  const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
  fail(typeof host === 'string' && /^[a-zA-Z0-9.:[\]-]+$/.test(host), 400, 'INVALID_HOST', 'Invalid request host');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)|\.localhost(:|$)/.test(host);
  return { origin: `${local ? 'http' : 'https'}://${host}`, local };
}
function requireSameOrigin(req, origin) {
  fail(req.headers.origin === origin && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']),
    403, 'CROSS_ORIGIN', 'Writes must come from this app');
}
function cookieToken(req) {
  const pairs = (req.headers.cookie ?? '').split(';').map(value => value.trim().split('='));
  return pairs.find(pair => pair[0] === '__Host-aeronaut-pilot')?.[1] ?? null;
}
function setPilotCookie(res, token) {
  // Browsers treat localhost as trustworthy too; keep the same cookie contract in embedded local previews.
  res.setHeader('Set-Cookie', `__Host-aeronaut-pilot=${token}; Path=/; HttpOnly; Max-Age=31536000; SameSite=None; Secure`);
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
  res.end(body);
}
async function readJson(req, maxBytes) {
  fail(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''),
    415, 'INVALID_CONTENT_TYPE', 'Send application/json');
  fail(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 415, 'INVALID_ENCODING', 'Compressed requests are not supported');
  fail(!req.headers['content-length'] || Number(req.headers['content-length']) <= maxBytes, 413, 'REPLAY_LIMIT', 'Request exceeds the byte limit');
  const chunks = []; let bytes = 0;
  await new Promise((resolve, reject) => {
    const clean = () => { req.off('data', data); req.off('end', end); req.off('error', broken); req.off('aborted', aborted); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        clean(); req.pause(); reject(new HttpError(413, 'REPLAY_LIMIT', 'Request exceeds the byte limit'));
      } else chunks.push(chunk);
    };
    const end = () => { clean(); resolve(); };
    const broken = () => { clean(); reject(new HttpError(400, 'INVALID_REPLAY', 'Request body was interrupted')); };
    const aborted = broken;
    req.on('data', data); req.once('end', end); req.once('error', broken); req.once('aborted', aborted);
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError(400, 'INVALID_REPLAY', 'Request must be valid UTF-8 JSON'); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
async function staticFile(req, res, url, distDir) {
  fail(['GET', 'HEAD'].includes(req.method), 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'INVALID_PATH', 'Invalid request path'); }
  fail(!path.includes('\0') && !path.includes('\\') && !path.split('/').some(part => part.startsWith('.')),
    404, 'NOT_FOUND', 'File not found');
  const root = await realpath(distDir).catch(() => null);
  fail(root, 503, 'BUILD_REQUIRED', 'Build the app before starting the production server');
  let file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  fail(file.startsWith(root + sep), 404, 'NOT_FOUND', 'File not found');
  let info = await stat(file).catch(() => null);
  if (!info && !extname(path) && req.headers.accept?.includes('text/html')) {
    file = resolve(root, 'index.html'); info = await stat(file).catch(() => null);
  }
  fail(info?.isFile(), 404, 'NOT_FOUND', 'File not found');
  const actual = await realpath(file);
  fail(actual.startsWith(root + sep), 404, 'NOT_FOUND', 'File not found');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size,
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(actual), res);
}

/** No listen side effect, so integration tests can run independent instances against the same PostgreSQL. */
export function createApp({ pool, distDir = resolve('dist'), trustProxy = process.env.TRUST_PROXY === '1' }) {
  const store = new RankedStore(pool);
  let requests = 0, submissions = 0;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    let admitted = false, submission = false;
    try {
      const { origin } = requestOrigin(req, trustProxy), url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) return await staticFile(req, res, url, distDir);
      fail(req.url.length <= 4096, 414, 'INVALID_URL', 'Request URL is too long');
      fail(requests < 12, 503, 'SERVICE_BUSY', 'Service is busy; try again shortly');
      requests++; admitted = true;
      if (url.pathname === '/api/ranked/submissions' && req.method === 'POST') {
        fail(submissions < 3, 503, 'SERVICE_BUSY', 'Service is busy; try again shortly');
        submissions++; submission = true;
      }
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write) requireSameOrigin(req, origin);
      if (url.pathname === '/api/health' && req.method === 'GET') {
        await pool.query('SELECT 1'); return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/ranked/boards' && req.method === 'GET') return json(res, 200, listBoards(url.searchParams));
      const pilot = await store.pilot(cookieToken(req));
      // A trusted single proxy appends the real peer as the final forwarded address.
      const forwarded = trustProxy ? req.headers['x-forwarded-for']?.split(',').at(-1).trim() : null;
      const address = `address:${digest(forwarded && isIP(forwarded) ? forwarded : req.socket.remoteAddress ?? 'unknown')}`;
      if (url.pathname === '/api/ranked/profile') {
        if (req.method === 'GET') return json(res, 200, { profile: pilot ? { displayName: pilot.display_name } : null, serverNow: await databaseNow(pool) });
        fail(req.method === 'PUT', 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        await throttle(pool, address, 'profile', RATE_LIMITS.profile);
        const value = await readJson(req, 1024);
        fail(exactFields(value, ['displayName']), 400, 'INVALID_PROFILE', 'Expected a display name');
        const result = await store.profile(pilot, displayName(value.displayName));
        if (result.token) setPilotCookie(res, result.token);
        return json(res, 200, { profile: { displayName: result.pilot.display_name }, serverNow: await databaseNow(pool) });
      }
      if (url.pathname === '/api/ranked/leaderboard' && req.method === 'GET') {
        fail([...url.searchParams.keys()].every(key => ['boardKey', 'limit', 'cursor'].includes(key)), 400, 'INVALID_QUERY', 'Unknown leaderboard parameter');
        const key = url.searchParams.get('boardKey'), board = boardFromKey(key), rawLimit = url.searchParams.get('limit') ?? '20';
        fail(/^\d{1,3}$/.test(rawLimit) && Number(rawLimit) >= 1 && Number(rawLimit) <= 100, 400, 'INVALID_LIMIT', 'Limit must be between 1 and 100');
        return json(res, 200, await store.leaderboard(board, pilot, Number(rawLimit), readCursor(url.searchParams.get('cursor'), key)));
      }
      const knownWrite = ['/api/ranked/attempts', '/api/ranked/submissions'].includes(url.pathname)
        || url.pathname.startsWith('/api/ranked/attempts/');
      fail(knownWrite, 404, 'NOT_FOUND', 'Endpoint not found');
      fail(pilot, 401, 'PROFILE_REQUIRED', 'Choose a pilot display name before starting a ranked run');
      if (url.pathname === '/api/ranked/attempts' && req.method === 'POST') {
        await throttle(pool, address, 'attempts', RATE_LIMITS.addressAttempts);
        const value = await readJson(req, 2048);
        fail(exactFields(value, ['board']), 400, 'INVALID_BOARD', 'Expected a canonical board');
        return json(res, 201, await store.issue(pilot, validateBoard(value.board)));
      }
      if (url.pathname.startsWith('/api/ranked/attempts/') && req.method === 'DELETE') {
        const id = url.pathname.slice('/api/ranked/attempts/'.length);
        fail(validRunId(id), 404, 'NOT_FOUND', 'Run not found');
        await store.cancel(pilot, id); res.writeHead(204, { 'Cache-Control': 'private, no-store' }); return res.end();
      }
      if (url.pathname === '/api/ranked/submissions' && req.method === 'POST') {
        await throttle(pool, address, 'submissions', RATE_LIMITS.addressSubmissions);
        const { replay, hash } = canonicalSubmission(await readJson(req, RUN_LIMITS.bytes));
        const result = await store.submit(pilot, replay, hash);
        if (result.rejection) throw result.rejection;
        return json(res, result.status, result.body);
      }
      throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found');
    } catch (error) {
      const status = errorStatus(error);
      if (res.headersSent) { res.destroy(); return; }
      if (status === 500) console.error('Request failed', error.name, error.code ?? 'INTERNAL_ERROR');
      if (status === 429 || status === 503) res.setHeader('Retry-After', '30');
      if (!req.complete) res.setHeader('Connection', 'close');
      json(res, status, { error: { code: status >= 500 ? (status === 503 ? 'SERVICE_BUSY' : 'INTERNAL_ERROR') : error.code,
        message: status === 500 ? 'The request could not be completed' : status === 503 ? 'Service is busy; retry shortly' : error.message } });
    } finally { if (admitted) requests--; if (submission) submissions--; }
  });
  server.maxRequestsPerSocket = 100;
  return server;
}

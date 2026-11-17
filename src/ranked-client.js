// The browse/profile surface only. Attempt issuance and replay submission live elsewhere.
import { RULES_VERSION, boardKey, validateBoard, rankingTuple, validRunId } from './ranked-rules.js';

export class RankedServiceError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'RankedServiceError'; this.code = code; this.status = status; }
}
const invalid = () => { throw new RankedServiceError('INVALID_RESPONSE', 'The leaderboard service returned an unreadable response.'); };
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
const metricFields = {
  course: ['elapsedMs'],
  landing: ['sinkMmPerSecond', 'centrelineMm', 'alignmentMilliDegrees', 'touchdownAlongMm', 'speedMmPerSecond', 'elapsedMs'],
  crosswind: ['centrelineMm', 'sinkMmPerSecond', 'alignmentMilliDegrees', 'touchdownAlongMm', 'speedMmPerSecond', 'elapsedMs'],
  recovery: ['heightLostMm', 'recoveryMs', 'attemptMs'],
};
function entry(value, key) {
  if (!value || !validRunId(value.id) || !name(value.displayName) || !time(value.submittedAt)
    || !Number.isSafeInteger(value.rank) || value.rank < 1 || boardKey(value.board) !== key
    || value.boardKey !== key || typeof value.isOwn !== 'boolean') invalid();
  rankingTuple(value.board, value.metrics);
  if (!metricFields[value.board.activity].every(field => Number.isSafeInteger(value.metrics[field]) && value.metrics[field] >= 0)) invalid();
  if (value.board.activity === 'course' && (!Array.isArray(value.metrics.splitsMs) || !value.metrics.splitsMs.every(time))) invalid();
  return value;
}

export function createRankedClient({ fetch: request = globalThis.fetch, timeoutMs = 12000 } = {}) {
  async function json(path, { signal, method = 'GET', body } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await request(`/api/ranked/${path}`, {
        method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new RankedServiceError('SERVICE_UNAVAILABLE', 'Online leaderboards are unavailable.', response.status);
      }
      const value = await response.json();
      if (!response.ok) throw new RankedServiceError(value?.error?.code || 'REQUEST_FAILED', 'The leaderboard request failed.', response.status);
      return value;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (timedOut) throw new RankedServiceError('TIMEOUT', 'The leaderboard service took too long to respond.');
      if (error instanceof RankedServiceError) throw error;
      throw new RankedServiceError('SERVICE_UNAVAILABLE', 'Online leaderboards are unavailable.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function validate(read) {
    try { return read(); }
    catch (error) { if (error instanceof RankedServiceError) throw error; invalid(); }
  }
  return {
    async boards({ signal } = {}) {
      const value = await json('boards', { signal });
      return validate(() => {
        if (value?.rulesVersion !== RULES_VERSION) throw new RankedServiceError('UNSUPPORTED_RULES', 'These ranked rules need a newer simulator.');
        if (!Array.isArray(value.boards)) invalid();
        const seen = new Set();
        for (const item of value.boards) {
          validateBoard(item.board);
          if (item.boardKey !== boardKey(item.board) || seen.has(item.boardKey)) invalid();
          seen.add(item.boardKey);
        }
        return value;
      });
    },
    async leaderboard(board, { cursor, signal, limit = 20 } = {}) {
      const key = boardKey(board);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && typeof cursor !== 'string')) {
        throw new RankedServiceError('INVALID_REQUEST', 'Invalid leaderboard page.');
      }
      const query = new URLSearchParams({ boardKey: key, limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      const value = await json(`leaderboard?${query}`, { signal });
      return validate(() => {
        if (value?.boardKey !== key || boardKey(value.board) !== key || !Array.isArray(value.entries)
          || value.entries.length > limit || !(value.nextCursor === null || typeof value.nextCursor === 'string' && value.nextCursor.length > 0)
          || !time(value.serverNow) || value.rankingPolicy !== 'runs' || !Object.hasOwn(value, 'personalBest')) invalid();
        const seen = new Set();
        for (const row of value.entries) { entry(row, key); if (seen.has(row.id)) invalid(); seen.add(row.id); }
        if (value.personalBest !== null) { entry(value.personalBest, key); if (!value.personalBest.isOwn) invalid(); }
        return value;
      });
    },
    async profile({ signal } = {}) {
      const value = await json('profile', { signal });
      return validate(() => { if (!value || !time(value.serverNow) || !(value.profile === null || name(value.profile?.displayName))) invalid(); return value.profile; });
    },
    async saveProfile(displayName, { signal } = {}) {
      const value = await json('profile', { method: 'PUT', body: { displayName }, signal });
      return validate(() => { if (!time(value?.serverNow) || !name(value?.profile?.displayName)) invalid(); return value.profile; });
    },
  };
}

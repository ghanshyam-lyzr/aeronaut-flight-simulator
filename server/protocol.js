import { createHash } from 'node:crypto';
import { FLEET } from '../src/fleet.js';
import { AIRPORTS } from '../src/airports.js';
import { RULES_VERSION, REPLAY_VERSION, RUN_LIMITS, RankedRunError, exactFields, validRunId,
  makeBoard, validateBoard, boardKey } from '../src/ranked-rules.js';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (condition, status, code, message) => { if (!condition) throw new HttpError(status, code, message); };
export const digest = value => createHash('sha256').update(value).digest('hex');

export function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof RankedRunError) {
    if (error.code === 'REPLAY_LIMIT') return 413;
    if (error.code === 'STALE_ATTEMPT') return 410;
    if (error.code === 'ATTEMPT_FINALIZED') return 409;
    if (['UNSUPPORTED_RULES', 'UNSUPPORTED_REPLAY', 'INCOMPLETE_RUN', 'INELIGIBLE_RUN', 'TRAILING_SLICES'].includes(error.code)) return 422;
    if (['INVALID_METRICS', 'INVALID_ENTRY', 'INVALID_SIMULATION'].includes(error.code)) return 500;
    return 400;
  }
  if (['55P03', '57014', '53300'].includes(error.code)) return 503;
  return 500;
}

export function displayName(value) {
  fail(typeof value === 'string' && value.length <= 256, 400, 'INVALID_NAME', 'Use a display name of 2–24 characters');
  const name = value.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M} ._'’-]/gu, '').replace(/\s+/g, ' ').trim();
  fail([...name].length >= 2 && [...name].length <= 24 && /[\p{L}\p{N}]/u.test(name),
    400, 'INVALID_NAME', 'Use 2–24 letters, numbers, spaces or simple punctuation');
  return name;
}

const boards = [];
for (const aircraft of Object.keys(FLEET)) for (const activity of ['course', 'landing', 'crosswind', 'recovery']) {
  const selectors = activity === 'landing'
    ? AIRPORTS.flatMap(field => [field.runway, field.reciprocal].flatMap(runway =>
      ['calm', 'breeze', 'gusts'].map(setup => ({ airport: field.id, runway, setup }))))
    : activity === 'course' ? ['calm', 'breeze', 'gusts'].map(setup => ({ setup })) : [{}];
  for (const selection of selectors) {
    try { const board = makeBoard({ activity, aircraft, ...selection }); boards.push({ board, boardKey: boardKey(board) }); }
    catch (error) { if (error.code !== 'INVALID_BOARD') throw error; }
  }
}
const byKey = new Map(boards.map(entry => [entry.boardKey, entry.board]));
export function listBoards(params) {
  fail([...params.keys()].every(key => ['activity', 'aircraft'].includes(key)), 400, 'INVALID_BOARD', 'Unknown board filter');
  const activity = params.get('activity'), aircraft = params.get('aircraft');
  fail(!activity || ['course', 'landing', 'crosswind', 'recovery'].includes(activity), 400, 'INVALID_BOARD', 'Unknown activity');
  fail(!aircraft || Object.hasOwn(FLEET, aircraft), 400, 'INVALID_BOARD', 'Unknown aircraft');
  return { rulesVersion: RULES_VERSION, boards: boards.filter(entry => (!activity || entry.board.activity === activity)
    && (!aircraft || entry.board.aircraft === aircraft)), limits: RUN_LIMITS };
}
export function boardFromKey(key) {
  fail(typeof key === 'string' && byKey.has(key), 400, 'INVALID_BOARD', 'Unknown or unsupported board');
  return byKey.get(key);
}

// Schema order and numeric JSON representation determine retry identity, never caller property order.
export function canonicalSubmission(value) {
  fail(exactFields(value, ['version', 'rulesVersion', 'attemptId', 'board', 'steps']), 400, 'INVALID_REPLAY', 'Unexpected replay fields');
  fail(value.version === REPLAY_VERSION, 422, 'UNSUPPORTED_REPLAY', 'Unsupported replay version');
  fail(value.rulesVersion === RULES_VERSION, 422, 'UNSUPPORTED_RULES', 'Unsupported ranked rules version');
  fail(validRunId(value.attemptId), 400, 'INVALID_ATTEMPT', 'Invalid attempt id');
  const board = validateBoard(value.board);
  fail(Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= RUN_LIMITS.slices,
    413, 'REPLAY_LIMIT', 'Replay has no slices or too many slices');
  const replay = { version: value.version, rulesVersion: value.rulesVersion, attemptId: value.attemptId, board, steps: value.steps };
  let canonical;
  try { canonical = JSON.stringify(replay); }
  catch { throw new HttpError(400, 'INVALID_REPLAY', 'Replay is too deeply nested'); }
  fail(Buffer.byteLength(canonical) <= RUN_LIMITS.bytes, 413, 'REPLAY_LIMIT', 'Replay exceeds the byte limit');
  return { replay, hash: digest(canonical) };
}

export function cursorFor(key, id) { return Buffer.from(JSON.stringify({ boardKey: key, id })).toString('base64url'); }
export function readCursor(value, key) {
  if (value === null) return null;
  fail(value.length <= 1024 && /^[a-zA-Z0-9_-]+$/.test(value), 400, 'INVALID_CURSOR', 'Invalid leaderboard cursor');
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { /* rejected below */ }
  fail(exactFields(cursor, ['boardKey', 'id']) && cursor.boardKey === key && validRunId(cursor.id),
    400, 'INVALID_CURSOR', 'Cursor does not belong to this board');
  return cursor.id;
}

export function publicEntry(row, pilotId) {
  return { id: row.id, board: row.board, boardKey: row.board_key, displayName: row.display_name,
    metrics: row.metrics, submittedAt: Number(row.submitted_at),
    ...(row.rank !== undefined ? { rank: Number(row.rank), isOwn: row.pilot_id === pilotId } : {}) };
}

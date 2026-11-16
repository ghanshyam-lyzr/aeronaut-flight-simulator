// Shared ranked-run policy. No clock, storage, network or rendering; callers supply server time and attempt state.
import { FLEET } from './fleet.js';
import { AIRPORTS } from './airports.js';
import { resolveAirport, missionAvailability } from './airport-selection.js';
import { COURSE, courseAvailability } from './checkpoint-course.js';
import { PRACTICE, practiceAvailability } from './crosswind-practice.js';
import { recoveryAvailability } from './stall-recovery.js';

export const RULES_VERSION = 'aeronaut-ranked-v1';
export const REPLAY_VERSION = 1;
export const RUN_LIMITS = Object.freeze({ seconds: 600, slices: 120000, actions: 1024, bytes: 16 * 1024 * 1024,
  sliceSeconds: 0.025, attemptLifetimeMs: 60 * 60 * 1000 });
export const CONTROL_AXES = Object.freeze(['pitch', 'roll', 'yaw', 'throttle', 'brake', 'trim']);
export const RUN_ACTIONS = Object.freeze(['gear', 'flaps', 'trim-neutral']);
const ACTIVITIES = ['course', 'landing', 'crosswind', 'recovery'];
const WINDS = ['calm', 'breeze', 'gusts'];
const BOARD_FIELDS = ['rulesVersion', 'activity', 'aircraft', 'course', 'airport', 'runway', 'setup'];
const TOKEN = /^[a-zA-Z0-9_-]{1,96}$/;

export class RankedRunError extends Error {
  constructor(code, message) { super(message); this.name = 'RankedRunError'; this.code = code; }
}
export function requireRun(condition, code, message) { if (!condition) throw new RankedRunError(code, message); }
export const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function exactFields(value, fields) {
  return isRecord(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}
export const validRunId = value => typeof value === 'string' && TOKEN.test(value);

/** Expand UI selectors into a complete, immutable board. Explicit unknowns never fall back to another board. */
export function makeBoard(selection) {
  requireRun(isRecord(selection) && Object.keys(selection).every(key => BOARD_FIELDS.includes(key)), 'INVALID_BOARD', 'Unknown board fields');
  const { activity, aircraft } = selection;
  const rulesVersion = selection.rulesVersion ?? RULES_VERSION;
  requireRun(rulesVersion === RULES_VERSION, 'UNSUPPORTED_RULES', 'Unsupported ranked rules version');
  requireRun(ACTIVITIES.includes(activity) && typeof aircraft === 'string' && Object.hasOwn(FLEET, aircraft), 'INVALID_BOARD', 'Unknown activity or aircraft');
  const type = FLEET[aircraft];
  let course = null, airport = null, runway = null, setup;
  if (activity === 'course') {
    requireRun(courseAvailability(type).available, 'INVALID_BOARD', 'This aircraft cannot fly the course');
    course = COURSE.id; setup = selection.setup ?? 'calm';
  } else if (activity === 'landing') {
    airport = selection.airport ?? 'alpine-field';
    const field = AIRPORTS.find(candidate => candidate.id === airport);
    requireRun(!!field, 'INVALID_BOARD', 'Unknown airfield');
    runway = selection.runway ?? field.runway;
    requireRun([field.runway, field.reciprocal].includes(runway), 'INVALID_BOARD', 'Unknown runway');
    requireRun(missionAvailability(field, aircraft).available, 'INVALID_BOARD', 'Aircraft unsuitable for this airfield');
    setup = selection.setup ?? 'calm';
  } else if (activity === 'crosswind') {
    requireRun(practiceAvailability(type).available, 'INVALID_BOARD', 'Aircraft unsuitable for crosswind practice');
    airport = PRACTICE.airport; runway = PRACTICE.runway; setup = PRACTICE.id;
  } else {
    requireRun(recoveryAvailability(type).available, 'INVALID_BOARD', 'Recovery requires the Mira T2');
    setup = 'stall-recovery';
  }
  if (activity === 'course' || activity === 'landing') requireRun(WINDS.includes(setup), 'INVALID_BOARD', 'Unknown prescribed wind');
  const board = { rulesVersion, activity, aircraft, course, airport, runway, setup };
  for (const key of BOARD_FIELDS) if (Object.hasOwn(selection, key)) {
    requireRun(selection[key] === board[key], 'INVALID_BOARD', `Invalid prescribed ${key}`);
  }
  return Object.freeze(board);
}

export function validateBoard(value) {
  requireRun(exactFields(value, BOARD_FIELDS), 'INVALID_BOARD', 'A complete canonical board is required');
  return makeBoard(value);
}

/** Stable storage/URL key. Registry ids cannot contain the delimiter, and absent dimensions have a fixed marker. */
export function boardKey(value) {
  const board = validateBoard(value);
  return BOARD_FIELDS.map(key => board[key] ?? '-').join('|');
}

export function boardField(board) { return board.airport ? resolveAirport(board.airport, board.runway).field : null; }

/** The attempt is trusted server data, never the attempt-shaped object from a request body. */
export function validateAttempt(attempt, now) {
  requireRun(isRecord(attempt) && validRunId(attempt.id), 'INVALID_ATTEMPT', 'Invalid server attempt');
  const board = validateBoard(attempt.board);
  requireRun(Number.isSafeInteger(now) && Number.isSafeInteger(attempt.issuedAt) && Number.isSafeInteger(attempt.expiresAt)
    && attempt.issuedAt >= 0 && attempt.expiresAt > attempt.issuedAt
    && attempt.expiresAt - attempt.issuedAt <= RUN_LIMITS.attemptLifetimeMs, 'INVALID_ATTEMPT', 'Invalid attempt clock');
  requireRun(attempt.status === 'open', 'ATTEMPT_FINALIZED', 'Attempt is no longer open');
  requireRun(now >= attempt.issuedAt && now < attempt.expiresAt, 'STALE_ATTEMPT', 'Attempt has expired or is not yet valid');
  return board;
}

/** Wire units are integers; these exact displayed values also decide score ties. */
export const RANK_METRICS = Object.freeze({
  course: Object.freeze(['elapsedMs']),
  landing: Object.freeze(['sinkMmPerSecond', 'centrelineMm', 'alignmentMilliDegrees']),
  crosswind: Object.freeze(['centrelineMm', 'sinkMmPerSecond', 'alignmentMilliDegrees']),
  recovery: Object.freeze(['heightLostMm', 'recoveryMs']),
});

export function rankingTuple(board, metrics) {
  validateBoard(board);
  const keys = RANK_METRICS[board.activity];
  requireRun(isRecord(metrics) && keys.every(key => Number.isSafeInteger(metrics[key]) && metrics[key] >= 0),
    'INVALID_METRICS', 'Ranking requires verified nonnegative integer metrics');
  return keys.map(key => metrics[key]);
}
const compareTuple = (a, b) => a.reduce((order, value, i) => order || value - b[i], 0);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Score ties share rank; accepted server time, then ASCII id, make their display order deterministic. */
export function compareEntries(a, b) {
  requireRun(isRecord(a) && isRecord(b), 'INVALID_ENTRY', 'Expected ranked entries');
  requireRun(boardKey(a.board) === boardKey(b.board), 'BOARD_MISMATCH', 'Cannot compare different boards');
  for (const entry of [a, b]) requireRun(validRunId(entry.id) && Number.isSafeInteger(entry.submittedAt) && entry.submittedAt >= 0,
    'INVALID_ENTRY', 'Entries require a server id and accepted time');
  return compareTuple(rankingTuple(a.board, a.metrics), rankingTuple(b.board, b.metrics))
    || a.submittedAt - b.submittedAt || lexical(a.id, b.id);
}

/** Competition ranks: 1, 1, 3. Does not mutate entries, and refuses mixed boards or duplicate ids. */
export function rankEntries(entries) {
  requireRun(Array.isArray(entries), 'INVALID_ENTRY', 'Expected entries');
  const seen = new Set();
  for (const entry of entries) {
    compareEntries(entry, entry);
    requireRun(!seen.has(entry.id), 'INVALID_ENTRY', 'Duplicate entry id'); seen.add(entry.id);
    if (entries.length) requireRun(boardKey(entry.board) === boardKey(entries[0].board), 'BOARD_MISMATCH', 'Mixed boards');
  }
  const sorted = [...entries].sort(compareEntries);
  let rank = 0;
  return sorted.map((entry, i) => {
    if (!i || compareTuple(rankingTuple(entry.board, entry.metrics), rankingTuple(sorted[i - 1].board, sorted[i - 1].metrics))) rank = i + 1;
    return { ...entry, rank };
  });
}

// Browser-local observations only. Independent of flight totals, ranked runs and online services.
import { browserStorage } from './settings.js';
import { normalizeFlightDate } from './flight-log.js';

export const LANDING_HISTORY_KEY = 'aeronaut-landing-history';
export const LANDING_HISTORY_VERSION = 1;
export const MAX_LANDING_ATTEMPTS = 20;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, limit = 160) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
const positive = value => number(value) !== null && value >= 0 ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const numbers = (value, keys) => Object.fromEntries(keys.map(key => [key, number(object(value)[key])]));
const position = value => numbers(value, ['x', 'y', 'z']);
function wind(value) {
  const w = object(value), c = object(w.config);
  return { config: { id: text(c.id), ...numbers(c, ['direction', 'speed', 'gust', 'veer', 'seed']) },
    ...numbers(w, ['time', 'x', 'z', 'speed', 'direction', 'gust']), transitioning: boolean(w.transitioning) };
}
function normalizeAttempt(value) {
  const v = object(value), id = text(v.id, 128);
  if (!id || !['landing', 'crosswind'].includes(v.exercise) || !['success', 'failed'].includes(v.outcome)) return null;
  const a = object(v.aircraft), f = object(v.field), s = object(v.setup), t = object(v.touchdown), feedback = object(v.feedback);
  return { id, exercise: v.exercise, outcome: v.outcome, reason: text(v.reason, 400),
    startedAt: normalizeFlightDate(v.startedAt), finishedAt: normalizeFlightDate(v.finishedAt), elapsed: positive(v.elapsed),
    aircraft: { id: text(a.id), name: text(a.name) },
    field: { id: text(f.id), name: text(f.name), runway: text(f.runway, 12), surface: text(f.surface, 40),
      ...numbers(f, ['heading', 'runwayLength', 'runwayWidth', 'elevation']) },
    setup: { ...numbers(s, ['speed', 'throttle', 'flaps', 'heading', 'pitch', 'bank', 'pitchTrim', 'targetSpeed', 'maxSink', 'maxSpeed']),
      gearDown: boolean(s.gearDown), autopilot: boolean(s.autopilot), position: position(s.position), weather: text(s.weather, 40) },
    windStart: wind(v.windStart), windEnd: wind(v.windEnd),
    touchdown: v.touchdown && typeof v.touchdown === 'object' && !Array.isArray(v.touchdown) ? {
      ...numbers(t, ['time', 'along', 'cross', 'alignment', 'heading', 'bank', 'pitch', 'flaps']),
      speed: positive(t.speed), sink: positive(t.sink), position: position(t.position), gearDown: boolean(t.gearDown), stalled: boolean(t.stalled),
    } : null,
    feedback: v.exercise === 'crosswind' ? numbers(feedback, ['crab', 'thresholdCross', 'touchdownCrab', 'touchdownBank', 'touchdownPitch']) : null };
}

/** Salvage known records independently, first occurrence wins; never invent absent measurements or identities. */
export function normalizeLandingAttempts(value) {
  const entries = [], seen = new Set();
  if (!Array.isArray(value)) return entries;
  for (const raw of value) {
    const entry = normalizeAttempt(raw);
    if (!entry || seen.has(entry.id)) continue;
    entries.push(entry); seen.add(entry.id);
    if (entries.length === MAX_LANDING_ATTEMPTS) break;
  }
  return entries;
}
export function loadLandingAttempts(storage = browserStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(LANDING_HISTORY_KEY) ?? 'null');
    return saved?.version === LANDING_HISTORY_VERSION ? normalizeLandingAttempts(saved.attempts) : [];
  } catch { return []; }
}
export function saveLandingAttempts(entries, storage = browserStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(LANDING_HISTORY_KEY, JSON.stringify({ version: LANDING_HISTORY_VERSION, attempts: normalizeLandingAttempts(entries) }));
    return true;
  } catch { return false; }
}
let sequence = 0;
const attemptId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Optional Activities observer. Captures at completion, before result rendering or a retry can erase telemetry. */
export class LandingHistory {
  constructor({ storage, now = () => new Date().toISOString(), id = attemptId, context = () => ({}) } = {}) {
    this.storage = storage; this.now = now; this.id = id; this.context = context;
    this.entries = loadLandingAttempts(storage); this.active = null; this.persisted = null;
  }
  begin(exercise, flight, landing) {
    const s = flight.state, p = landing.profile;
    this.active = { flight, entry: { id: this.id(), exercise, startedAt: this.now(),
      aircraft: { id: flight.type.id, name: flight.type.name }, field: { ...landing.field },
      setup: { ...s, position: { x: s.position.x, y: s.position.y, z: s.position.z },
        targetSpeed: p.speed, maxSink: p.maxSink, maxSpeed: p.maxSpeed, weather: this.context().weather },
      windStart: flight.windSnapshot() } };
  }
  finish(landing, practice) {
    if (!this.active || !landing.finished) return false;
    const { flight, entry } = this.active;
    this.active = null; // Consumed before saving: a blocked write can never duplicate a result.
    const completed = normalizeAttempt({ ...entry, finishedAt: this.now(), elapsed: landing.lastTime,
      outcome: landing.status, reason: landing.reason, touchdown: landing.touchdown, windEnd: flight.windSnapshot(),
      feedback: entry.exercise === 'crosswind' ? practice?.feedback() : null });
    this.entries = normalizeLandingAttempts([completed, ...this.entries]);
    this.flush();
    return true;
  }
  end(landing, practice) { this.finish(landing, practice); this.active = null; }
  flush() { this.persisted = saveLandingAttempts(this.entries, this.storage); return this.persisted; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_HISTORY_KEY, LANDING_HISTORY_VERSION, MAX_LANDING_ATTEMPTS, normalizeLandingAttempts, loadLandingAttempts, saveLandingAttempts, LandingHistory } from '../src/landing-history.js';
import { landingHistoryMarkup, landingHistoryRows } from '../src/landing-history-ui.js';
import { FLIGHTS_KEY, saveFlights, loadFlights } from '../src/flight-log.js';
import { setup, flyApproach } from './crosswind-pilot.js';
import { StallRecovery } from '../src/stall-recovery.js';
import { resolveAirport } from '../src/airport-selection.js';
import { PRACTICE } from '../src/crosswind-practice.js';

class MemoryStorage {
  constructor(raw = null) { this.values = new Map([[LANDING_HISTORY_KEY, raw]]); this.writes = 0; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes++; this.values.set(key, String(value)); }
}
const stamp = '2026-11-20T12:30:00.000Z';
const attempt = (overrides = {}) => ({ id: 'attempt-1', exercise: 'landing', outcome: 'failed', startedAt: stamp, finishedAt: stamp,
  aircraft: { id: 'trainer', name: 'Mira T2' }, field: { id: 'alpine-field', name: 'Alpine Field', runway: '36' }, ...overrides });
const envelope = entries => JSON.stringify({ version: LANDING_HISTORY_VERSION, attempts: entries });
const blocked = { getItem() { throw Error('SecurityError'); }, setItem() { throw Error('QuotaExceededError'); } };
function logged(id = 'trainer', wind = 'calm', storage = new MemoryStorage()) {
  const x = setup(id, wind); x.landing.field = resolveAirport('alpine-field', '36').field; let sequence = 0, clock = 0;
  const history = new LandingHistory({ storage, id: () => `id-${++sequence}`, now: () => new Date(Date.parse(stamp) + clock++ * 1000).toISOString(), context: () => ({ weather: 'golden' }) });
  x.activities.history = history; x.activities.recovery = new StallRecovery();
  return { ...x, history, storage };
}
function crash(x) {
  Object.assign(x.s, { crashed: true, crashReason: 'Terrain impact', flightTime: 0.5 });
  x.activities.update(1 / 120, x.s);
}

test('actual landing and crosswind finish integration captures observed touchdown and frozen setup exactly once', () => {
  for (const exercise of ['landing', 'crosswind']) {
    const x = logged();
    if (exercise === 'landing') x.activities.startLanding(x.flight); else x.activities.startCrosswind(x.flight);
    const start = x.flight.state.position.clone(), result = flyApproach(x);
    assert.equal(result.status, 'success', result.reason);
    assert.equal(x.history.entries.length, 1);
    const e = x.history.entries[0];
    assert.equal(e.exercise, exercise); assert.equal(e.outcome, result.status);
    assert.equal(e.aircraft.id, x.flight.type.id); assert.equal(e.aircraft.name, x.flight.type.name);
    assert.equal(e.field.id, x.landing.field.id); assert.equal(e.field.runway, x.landing.field.runway);
    for (const key of ['sink', 'speed', 'along', 'cross', 'alignment', 'pitch', 'bank', 'time']) assert.equal(e.touchdown[key], result.touchdown[key], key);
    assert.deepEqual(e.setup.position, { x: start.x, y: start.y, z: start.z });
    assert.equal(e.setup.weather, 'golden'); assert.equal(e.setup.autopilot, false);
    assert.equal(e.windStart.config.id, exercise === 'crosswind' ? PRACTICE.wind.id : 'calm');
    assert.ok(e.startedAt < e.finishedAt); assert.ok(e.elapsed > e.touchdown.time);
    for (let i = 0; i < 5; i++) { x.activities.beforeStep(x.s); x.activities.update(1 / 120, x.s); landingHistoryMarkup(x.history); }
    assert.equal(x.storage.writes, 1, 'finished slices and rerenders do not persist twice');
    const captured = structuredClone(e);
    x.activities.cancel(); x.flight.setAircraft('jet'); x.flight.setWind('gusts');
    assert.deepEqual(x.history.entries, [captured], 'leaving and changing aircraft/wind cannot relabel an old result');
    assert.deepEqual(loadLandingAttempts(x.storage), [captured]);
  }
});

test('real uncorrected crosswind touchdown failure retains its reason and measurements', () => {
  const x = logged(); x.activities.startCrosswind(x.flight);
  const result = flyApproach(x, { correct: false });
  assert.equal(result.status, 'failed'); assert.ok(result.touchdown);
  assert.equal(x.history.entries[0].reason, result.reason);
  assert.equal(x.history.entries[0].touchdown.cross, result.touchdown.cross);
});

test('pre-touchdown failures have unavailable measurements and fast attempts are still recorded', () => {
  const x = logged('jet', 'breeze'); x.activities.startLanding(x.flight); crash(x);
  const e = x.history.entries[0];
  assert.equal(e.reason, 'Terrain impact'); assert.equal(e.elapsed, 0.5); assert.equal(e.touchdown, null);
  assert.match(landingHistoryRows([e]).markup, /No touchdown recorded/);
  assert.match(landingHistoryRows([e]).markup, /Touchdown sink<\/dt><dd>Unavailable/);
  assert.doesNotMatch(landingHistoryRows([e]).markup, /Touchdown sink<\/dt><dd>0/);
});

test('every retry owns a fresh identity even at the same timestamp and with identical results', () => {
  const x = logged();
  for (let i = 0; i < MAX_LANDING_ATTEMPTS + 3; i++) { x.activities.startCrosswind(x.flight); crash(x); }
  assert.equal(x.history.entries.length, MAX_LANDING_ATTEMPTS);
  assert.equal(new Set(x.history.entries.map(e => e.id)).size, MAX_LANDING_ATTEMPTS);
  assert.equal(x.history.entries[0].id, 'id-23'); assert.equal(x.history.entries.at(-1).id, 'id-4');
  assert.deepEqual(loadLandingAttempts(x.storage), x.history.entries);
});

test('pause/no updates, unfinished retries, activity switches, unsupported starts and external resets add no false results', () => {
  const x = logged(); x.activities.startLanding(x.flight);
  for (let i = 0; i < 3; i++) { x.activities.beforeStep(x.s); landingHistoryMarkup(x.history); }
  assert.equal(x.history.entries.length, 0);
  x.activities.startCrosswind(x.flight); x.activities.startLanding(x.flight); x.activities.startCourse(x.flight);
  x.activities.startLanding(x.flight); x.activities.startRecovery(x.flight);
  x.activities.cancel(); x.activities.startLanding(x.flight); x.flight.reset(); x.activities.update(1 / 120, x.s);
  x.activities.cancel(); assert.equal(x.history.entries.length, 0); assert.equal(x.storage.writes, 0);
  const heli = logged('helicopter'); heli.activities.startLanding(heli.flight);
  assert.equal(heli.activities.startCrosswind(heli.flight), null);
  assert.ok(heli.history.active); crash(heli); assert.equal(heli.history.entries[0].exercise, 'landing');
});

test('finished attempt is captured before a retry or switch can erase it, even before the next UI update', () => {
  for (const leave of [x => x.activities.startLanding(x.flight), x => x.activities.startCrosswind(x.flight), x => x.activities.startCourse(x.flight), x => x.activities.startRecovery(x.flight), x => x.activities.cancel()]) {
    const x = logged(); x.activities.startLanding(x.flight);
    x.landing.fail('Finished before rendering'); leave(x); leave(x);
    assert.equal(x.history.entries.length, 1); assert.equal(x.history.entries[0].reason, 'Finished before rendering');
  }
});

test('selected field/runway, actual aircraft and initial/end wind are captured rather than defaults', () => {
  const x = logged('jet', 'breeze'), field = resolveAirport('orvane-regional', '27').field;
  x.activities.startLanding(x.flight, field);
  x.flight.setWind('gusts'); crash(x);
  const e = x.history.entries[0];
  assert.equal(e.field.id, field.id); assert.equal(e.field.runway, field.runway); assert.equal(e.field.heading, field.heading);
  assert.equal(e.aircraft.id, 'jet'); assert.equal(e.windStart.config.id, 'breeze'); assert.equal(e.windEnd.config.id, 'gusts');
  assert.equal(e.windEnd.transitioning, true);
});

test('missing, corrupt, old/future and wrong-root storage recover without overwriting on load', () => {
  for (const raw of [null, '', '{bad', 'null', '[]', '42', '{}', JSON.stringify({ version: 0, attempts: [attempt()] }), JSON.stringify({ version: 99, attempts: [attempt()] }), JSON.stringify({ version: 1, attempts: {} })]) {
    const storage = new MemoryStorage(raw);
    assert.deepEqual(loadLandingAttempts(storage), []); assert.equal(storage.writes, 0);
    const x = logged('trainer', 'calm', storage); x.activities.startLanding(x.flight); crash(x);
    assert.equal(loadLandingAttempts(storage).length, 1);
  }
});

test('mixed records salvage independently with deduplication, an explicit limit, strict metrics and dates', () => {
  const values = [null, {}, [], true, 'text', attempt(), attempt(), attempt({ id: 'two', startedAt: '2026-02-30', finishedAt: 'bad', touchdown: { sink: '2', speed: -3, cross: -4.5, bank: Infinity, alignment: NaN } }),
    ...Array.from({ length: 30 }, (_, i) => attempt({ id: `extra-${i}` }))];
  const before = structuredClone(values), result = normalizeLandingAttempts(values);
  assert.equal(result.length, 20); assert.equal(result[1].id, 'two'); assert.equal(result.at(-1).id, 'extra-17');
  assert.equal(result[1].startedAt, null); assert.equal(result[1].finishedAt, null);
  assert.equal(result[1].touchdown.sink, null); assert.equal(result[1].touchdown.speed, null);
  assert.equal(result[1].touchdown.cross, -4.5); assert.equal(result[1].touchdown.bank, null); assert.equal(result[1].touchdown.alignment, null);
  assert.deepEqual(values, before);
  for (const value of [undefined, null, {}, '2', true, Infinity, NaN, Number.MAX_VALUE]) {
    const e = normalizeLandingAttempts([attempt({ elapsed: value, touchdown: { sink: value, speed: value, cross: value } })])[0];
    assert.equal(e.elapsed, null); assert.equal(e.touchdown.sink, null); assert.equal(e.touchdown.cross, null);
  }
});

test('legacy partial identities stay unknown; optional measurements never turn into a default aircraft or zero', () => {
  const e = normalizeLandingAttempts([attempt({ aircraft: null, field: null, setup: null, touchdown: {} })])[0];
  assert.equal(e.aircraft.id, ''); assert.equal(e.field.runway, ''); assert.equal(e.setup.speed, null); assert.equal(e.touchdown.sink, null);
  const markup = landingHistoryRows([e]).markup;
  assert.match(markup, /Unknown aircraft/); assert.match(markup, /Unknown airfield/); assert.match(markup, /Unavailable/);
});

test('new writes normalize too, and never touch pre-existing flight time/distance history', () => {
  const storage = new MemoryStorage();
  const flights = [{ date: stamp, time: 120, distance: 1852, aircraft: 'jet', maxAltitude: 900 }];
  saveFlights(flights, storage); const before = storage.getItem(FLIGHTS_KEY);
  assert.equal(saveLandingAttempts([null, attempt(), attempt()], storage), true);
  assert.equal(loadLandingAttempts(storage).length, 1);
  assert.equal(storage.getItem(FLIGHTS_KEY), before); assert.deepEqual(loadFlights(storage), flights);
  const x = logged('trainer', 'calm', storage); x.activities.startLanding(x.flight); crash(x);
  assert.equal(storage.getItem(FLIGHTS_KEY), before);
});

test('full/blocked storage retains deduplicated session results and a later flush recovers them', () => {
  for (const storage of [null, {}, blocked]) {
    assert.deepEqual(loadLandingAttempts(storage), []); assert.equal(saveLandingAttempts([attempt()], storage), false);
    const x = logged('trainer', 'calm', storage);
    for (let i = 0; i < 3; i++) { x.activities.startLanding(x.flight); crash(x); x.history.finish(x.landing, x.practice); }
    assert.equal(x.history.entries.length, 3); assert.equal(x.history.persisted, false);
    assert.match(landingHistoryMarkup(x.history), /unavailable or full/);
    x.history.storage = new MemoryStorage(); assert.equal(x.history.flush(), true);
    assert.equal(loadLandingAttempts(x.history.storage).length, 3);
  }
});

test('even blocked localStorage property access is safe and later default storage access can recover', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('SecurityError'); } });
  try {
    const x = logged('trainer', 'calm', undefined); x.activities.startLanding(x.flight); crash(x);
    // Explicit default-storage instance, since logged() normally supplies a test store.
    const history = new LandingHistory(); history.entries = x.history.entries;
    assert.equal(history.flush(), false); assert.deepEqual(loadLandingAttempts(), []);
    const storage = new MemoryStorage(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    assert.equal(history.flush(), true); assert.equal(loadLandingAttempts().length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('filters combine actual recorded ids; safe rows include outcome, dates, units and empty/filter states', () => {
  const entries = [attempt(), attempt({ id: '2', aircraft: { id: 'jet', name: 'Vela J8' }, exercise: 'crosswind', outcome: 'success' }),
    attempt({ id: '3', field: { id: 'other', name: 'Other field', runway: '18' } })];
  assert.equal(landingHistoryRows(entries, { aircraft: 'trainer' }).count, '2 of 3 attempts');
  assert.equal(landingHistoryRows(entries, { aircraft: 'trainer', airfield: 'other' }).count, '1 of 3 attempts');
  assert.match(landingHistoryRows(entries, { aircraft: 'jet', airfield: 'other' }).markup, /No attempts match/);
  assert.match(landingHistoryRows([]).markup, /No finished landing attempts/);
  const markup = landingHistoryMarkup({ entries });
  assert.match(markup, /Local to this browser/); assert.match(markup, /Separate from public rankings/); assert.match(markup, /not verified scores/);
  assert.match(markup, /All aircraft/); assert.match(markup, /All airfields/);
  assert.match(markup, /datetime="2026/); assert.match(markup, /Crosswind practice/); assert.match(markup, /Not completed/);
  const hostile = landingHistoryMarkup({ entries: [attempt({ aircraft: { id: '"><svg onload=alert(1)>', name: '<img src=x onerror=alert(1)>' }, reason: '<script>bad()</script>' })] });
  assert.doesNotMatch(hostile, /<img|<script|<svg/); assert.match(hostile, /&lt;img/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHTS_KEY, MAX_FLIGHTS, normalizeFlights, loadFlights, saveFlights, recordFlight, flightTotals, formatFlightDate } from '../src/flight-log.js';
import { FLEET } from '../src/fleet.js';

class MemoryStorage {
  constructor(raw = null) { this.raw = raw; }
  getItem(key) { assert.equal(key, FLIGHTS_KEY); return this.raw; }
  setItem(key, value) { assert.equal(key, FLIGHTS_KEY); this.raw = String(value); }
}
const flight = (overrides = {}) => ({ date: '2026-11-14T12:30:00.000Z', time: 120, distance: 1852, maxAltitude: 850, aircraft: 'jet', ...overrides });
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };

test('corrupt JSON, missing history and every non-array JSON root recover as an empty history', () => {
  for (const raw of [null, '', '{bad json', 'null', '{}', '"text"', 'false', '42']) {
    assert.deepEqual(loadFlights(new MemoryStorage(raw)), [], String(raw));
  }
  for (const value of [undefined, null, {}, 'text', 42, true]) assert.deepEqual(normalizeFlights(value), []);
});

test('mixed histories preserve good flights and repair fields without retaining non-flight records', () => {
  const good = flight(), legacy = { date: '2025-01-02T00:00:00.000Z', time: 60, distance: 926 };
  const damaged = { date: 'invalid', time: '60', distance: 3704, maxAltitude: -50, aircraft: '<img src=x onerror=alert(1)>' };
  const raw = [null, good, 'text', {}, [], 42, legacy, damaged, { time: -5, distance: null, maxAltitude: '900' }];
  const before = structuredClone(raw);
  assert.deepEqual(normalizeFlights(raw), [good, { ...legacy, maxAltitude: 0 },
    { date: null, time: 0, distance: 3704, maxAltitude: 0 }, { date: null, time: 0, distance: 0, maxAltitude: 0 }]);
  assert.deepEqual(raw, before, 'normalization never mutates the parsed history');
});

test('metrics are strictly numeric, finite, nonnegative and bounded at both storage boundaries', () => {
  for (const invalid of [undefined, null, '120', '', true, false, [], {}, NaN, Infinity, -Infinity, -1]) {
    const normalized = normalizeFlights([flight({ time: invalid, distance: invalid, maxAltitude: invalid })]);
    assert.deepEqual(normalized[0], flight({ time: 0, distance: 0, maxAltitude: 0 }));
    const storage = new MemoryStorage();
    assert.equal(saveFlights([flight({ time: invalid, distance: invalid, maxAltitude: invalid })], storage), true);
    assert.deepEqual(loadFlights(storage), normalized);
  }
  for (const n of [0, 0.5, 10, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
    const entry = normalizeFlights([flight({ time: n, distance: n, maxAltitude: n })])[0];
    for (const key of ['time', 'distance', 'maxAltitude']) assert.equal(entry[key], Math.min(n, Number.MAX_SAFE_INTEGER));
  }
});

test('dates round-trip as ISO strings and unparseable or non-string dates have a safe label', () => {
  assert.equal(normalizeFlights([flight({ date: '2026-11-14T12:30:00Z' })])[0].date, flight().date);
  assert.equal(normalizeFlights([flight({ date: '2024-02-29T23:00:00-02:00' })])[0].date, '2024-03-01T01:00:00.000Z');
  assert.equal(formatFlightDate(flight().date, 'en-US'), new Date(flight().date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  for (const date of [undefined, null, '', 'yesterday', '2026-99-99', '2026-02-30T00:00:00Z', '2025-02-29', '2024-04-31', '999999-01-01', 0, 1735776000000, [], {}]) {
    assert.equal(normalizeFlights([flight({ date })])[0].date, null);
    assert.equal(formatFlightDate(date), 'Unknown date');
  }
  for (const date of ['-271821-04-20T00:00:00.000Z', '+275760-09-13T00:00:00.000Z']) {
    assert.equal(normalizeFlights([flight({ date })])[0].date, date);
    assert.doesNotThrow(() => formatFlightDate(date));
  }
});

test('known aircraft are retained while legacy and unknown aircraft never become a default jet', () => {
  for (const aircraft of Object.keys(FLEET)) assert.equal(normalizeFlights([flight({ aircraft })])[0].aircraft, aircraft);
  for (const aircraft of [undefined, null, '', 'removed-aircraft', '__proto__', 'constructor', 'toString', {}, []]) {
    const entry = normalizeFlights([flight({ aircraft })])[0];
    assert.equal(Object.hasOwn(entry, 'aircraft'), false);
    assert.equal(entry.time, 120);
  }
});

test('history retains the first 20 recoverable entries in order, even among invalid entries', () => {
  const entries = Array.from({ length: MAX_FLIGHTS + 5 }, (_, i) => flight({ time: i + 10 }));
  const raw = entries.flatMap(entry => [null, {}, entry]);
  const expected = entries.slice(0, MAX_FLIGHTS);
  assert.deepEqual(normalizeFlights(raw), expected);
  const storage = new MemoryStorage(JSON.stringify(raw));
  assert.deepEqual(loadFlights(storage), expected);
  assert.equal(saveFlights(raw, storage), true);
  assert.deepEqual(JSON.parse(storage.raw), expected);
});

test('ordinary history and new-flight metrics round-trip exactly and totals include the current flight once', () => {
  const storage = new MemoryStorage(JSON.stringify([flight(), flight({ aircraft: 'helicopter', time: 65, distance: 926 })]));
  const history = loadFlights(storage), current = flight({ time: 30.5, distance: 463.25, maxAltitude: 950.5, aircraft: 'biplane' });
  assert.deepEqual(flightTotals(history, current), { time: 215.5, distance: 3241.25 });
  const recorded = recordFlight(history, current);
  assert.deepEqual(recorded, [current, ...history]);
  assert.equal(history.length, 2, 'recording does not mutate existing history');
  assert.equal(saveFlights(recorded, storage), true);
  assert.deepEqual(loadFlights(storage), recorded);
  assert.deepEqual(flightTotals(loadFlights(storage)), flightTotals(history, current));
});

test('recording after corrupt history recovers and subsequent saves remain usable', () => {
  const storage = new MemoryStorage('null');
  let history = loadFlights(storage);
  for (let i = 0; i < MAX_FLIGHTS + 2; i++) {
    const entry = flight({ time: 10 + i });
    history = recordFlight(history, entry);
    assert.equal(saveFlights(history, storage), true);
    assert.deepEqual(loadFlights(storage), history);
    assert.deepEqual(history[0], entry);
  }
  assert.equal(history.length, MAX_FLIGHTS);
  assert.equal(history.at(-1).time, 12);
  assert.deepEqual(recordFlight(null, flight()), [flight()]);
});

test('new flights below ten seconds or with invalid times do not enter history', () => {
  const history = [flight()];
  for (const time of [0, 9.999, -1, NaN, Infinity, '10', null, undefined]) assert.deepEqual(recordFlight(history, flight({ time })), history);
  for (const entry of [null, 'flight', {}, []]) assert.deepEqual(recordFlight(history, entry), history);
  assert.deepEqual(recordFlight(history, flight({ time: 10 })), [flight({ time: 10 }), ...history]);
});

test('extreme stored or current metrics never make totals overflow or become strings', () => {
  const huge = Array.from({ length: MAX_FLIGHTS }, () => flight({ time: Number.MAX_VALUE, distance: Number.MAX_VALUE }));
  assert.deepEqual(flightTotals(huge, { time: Number.MAX_VALUE, distance: Number.MAX_VALUE }), { time: Number.MAX_SAFE_INTEGER, distance: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(flightTotals([null, flight({ time: '50', distance: -1 })], { time: NaN, distance: Infinity }), { time: 0, distance: 0 });
  assert.deepEqual(flightTotals(null, null), { time: 0, distance: 0 });
});

test('missing, throwing and quota-limited storage cannot break repeated recording or later writes', () => {
  for (const storage of [null, blocked, {}]) {
    let history = loadFlights(storage);
    assert.deepEqual(history, []);
    for (let i = 0; i < 3; i++) {
      history = recordFlight(history, flight({ time: 10 + i }));
      assert.equal(saveFlights(history, storage), false);
    }
    assert.equal(history.length, 3, 'session history still works when persistence is blocked');
  }
  const storage = new MemoryStorage();
  storage.setItem = blocked.setItem;
  assert.equal(saveFlights([flight()], storage), false);
  delete storage.setItem;
  assert.equal(saveFlights([flight()], storage), true, 'a later available write can persist the session');
  assert.deepEqual(loadFlights(storage), [flight()]);
});

test('even accessing the browser localStorage property may throw safely, as with settings', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(loadFlights(), []);
    assert.equal(saveFlights([flight()]), false);
    assert.equal(saveFlights([flight()]), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

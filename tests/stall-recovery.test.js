import test from 'node:test';
import assert from 'node:assert/strict';
import { FLEET } from '../src/fleet.js';
import { RECOVERY, recoveryAvailability } from '../src/stall-recovery.js';
import { CALM, normalizeWind, WIND_PRESETS } from '../src/wind.js';
import { stallSpeed } from '../src/stall.js';
import { setup, flyRecovery } from './stall-recovery-pilot.js';

const dt = 1 / 120, DEG = Math.PI / 180;
const step = (x, seconds = 1) => { for (let t = 0; t < seconds - 1e-8; t += dt) { if (x.activities.beforeStep(x.s)) continue; x.flight.update(dt); x.activities.update(dt, x.s); } };
const wind = x => x.flight.windSnapshot().config;

// Fake observations below test the scoring boundary only; real flight behavior is exercised by the input pilot.
function observe(x, changes = {}) {
  const state = { ...x.s, position: x.s.position.clone(), flightTime: x.recovery.lastTime + dt, ...changes };
  x.recovery.update(dt, state); return state;
}
function recorded(x) {
  observe(x, { stalled: true, throttle: 0, airspeed: 24 });
  assert.ok(x.recovery.stall); return x;
}

test('only the explicitly selected Mira T2 may use its measured exercise; a refusal changes nothing', () => {
  for (const type of Object.values(FLEET)) {
    assert.equal(recoveryAvailability(type).available, type.id === RECOVERY.aircraft, type.id);
    if (type.id === RECOVERY.aircraft) continue;
    const x = setup({ type: type.id }); x.activities.startLanding(x.flight);
    const before = x.landing.snapshot(), position = x.s.position.toArray();
    assert.match(recoveryAvailability(type).reason, /Mira T2 only/);
    assert.equal(x.activities.startRecovery(x.flight), null);
    assert.deepEqual(x.landing.snapshot(), before); assert.deepEqual(x.s.position.toArray(), position);
    assert.equal(wind(x), WIND_PRESETS.gusts); assert.equal(x.recovery.status, 'idle');
  }
});

test('the repeatable start is level, clean, neutral-trim manual flight with ample terrain clearance', () => {
  const x = setup(); const s = x.activities.startRecovery(x.flight);
  assert.equal(s.aircraft, 'trainer'); assert.equal(s.autopilot, false); assert.equal(s.bank, 0); assert.equal(s.pitch, 0);
  assert.equal(s.flaps, 0); assert.equal(s.pitchTrim, 0); assert.equal(s.stalled, false); assert.equal(s.grounded, false);
  assert.equal(s.touchdown, null); assert.equal(s.brake, 0); assert.equal(s.selectedHeading, null); assert.equal(s.headingHold, false);
  assert.equal(s.airspeed, RECOVERY.startSpeed); assert.equal(s.flightTime, 0); assert.equal(wind(x), CALM);
  assert.ok(s.position.y - x.flight.groundAt(s.position.x, s.position.z) >= RECOVERY.clearance);
  assert.ok(s.airspeed > stallSpeed(x.flight.type, s.flaps, s));
});

for (const rate of [30, 60, 144]) test(`${rate} fps: ordinary inputs induce a controller stall and recover to 3 continuous stable seconds`, () => {
  const x = setup(); x.activities.startRecovery(x.flight); const r = flyRecovery(x, { rate });
  assert.equal(r.status, 'success', r.reason); assert.equal(r.stallSeen, true);
  assert.ok(r.stall.speed < stallSpeed(x.flight.type, 0), `${r.stall.speed} m/s`);
  assert.ok(r.noseLowered && r.powerAdded); assert.ok(r.stableTime >= RECOVERY.stableSeconds);
  assert.equal(x.s.stalled, false); assert.equal(x.s.autopilot, false); assert.equal(x.s.crashed, false);
  assert.ok(r.result.recoveryTime > 8.9 && r.result.recoveryTime < 9.4, `${r.result.recoveryTime} s`);
  assert.ok(r.result.heightLost > 27 && r.result.heightLost < 30, `${r.result.heightLost} m`);
  assert.ok(Math.abs(r.final.pitch) < RECOVERY.pitchLimit && Math.abs(r.final.bank) < RECOVERY.bankLimit);
  assert.ok(Math.abs(r.final.sink) < RECOVERY.sinkLimit && r.final.speed >= RECOVERY.safeSpeed && r.final.speed <= RECOVERY.maxSpeed);
  assert.ok(r.minClearance > 1500); assert.equal(x.activities.finished, true); assert.equal(x.activities.kind, 'recovery');
});

test('waiting, low speed without the controller flag, and zero flight-time updates never produce a stall or success', () => {
  const x = setup(); x.activities.startRecovery(x.flight);
  const before = x.recovery.snapshot();
  for (const bad of [0, -1, NaN]) x.recovery.update(bad, x.s);
  assert.deepEqual(x.recovery.snapshot(), before);
  for (let i = 0; i < 500; i++) observe(x, { stalled: false, airspeed: 20, throttle: 1, pitch: 0 });
  assert.equal(x.recovery.stall, null); assert.equal(x.recovery.status, 'flying'); assert.equal(x.recovery.stableTime, 0);
  x.activities.startRecovery(x.flight);
  const r = flyRecovery(x, { mode: 'wait' });
  assert.equal(r.status, 'failed'); assert.equal(r.stallSeen, false); assert.match(r.reason, /No stall.*60 seconds/);
  assert.equal(r.result.recoveryTime, null); assert.equal(r.result.heightLost, null);
});

test('a speed threshold, added power alone, a lower nose alone or intermittent stability cannot complete recovery', () => {
  for (const missing of ['nose', 'power', 'stall flag', 'speed', 'bank', 'pitch', 'sink']) {
    const x = setup(); x.activities.startRecovery(x.flight); recorded(x);
    // Deliberately supply each incomplete scoring observation, not a simulated flight performance claim.
    for (let i = 0; i < 600; i++) observe(x, {
      stalled: missing === 'stall flag', throttle: missing === 'power' ? 0 : 0.9,
      pitch: missing === 'nose' ? 0 : missing === 'pitch' ? -0.12 : i === 0 ? -0.1 : 0,
      bank: missing === 'bank' ? 0.2 : 0, airspeed: missing === 'speed' ? 30 : 40,
      verticalSpeed: missing === 'sink' ? -3 : 0,
    });
    assert.equal(x.recovery.status, 'flying', missing); assert.equal(x.recovery.stableTime, 0, missing);
  }
  const x = setup(); x.activities.startRecovery(x.flight); recorded(x);
  observe(x, { pitch: -0.1, throttle: 0.9, airspeed: 40, stalled: false });
  for (let cycle = 0; cycle < 4; cycle++) {
    for (let i = 0; i < 200; i++) observe(x, { throttle: 0.9, airspeed: 40, pitch: 0, stalled: false });
    assert.ok(x.recovery.stableTime > 1.6 && x.recovery.stableTime < 1.7);
    observe(x, { throttle: 0.9, airspeed: 40, pitch: 0, bank: 0.2, stalled: false });
    assert.equal(x.recovery.stableTime, 0);
  }
  assert.equal(x.recovery.status, 'flying');
});

test('assist ends an attempt before or after the real stall; a toggle cannot turn into a scored recovery', () => {
  for (const afterStall of [false, true]) {
    const x = setup(); x.activities.startRecovery(x.flight);
    if (afterStall) flyRecovery(x, { seconds: 5 });
    assert.equal(!!x.recovery.stall, afterStall);
    x.flight.toggleAutopilot(); step(x, dt);
    assert.equal(x.recovery.status, 'failed'); assert.match(x.recovery.reason, /Assist was used/);
    x.flight.toggleAutopilot(); step(x, 5);
    assert.equal(x.recovery.status, 'failed');
  }
});

test('unrecovered idle, excessive diving, unstable flight and a real terrain collision fail clearly', () => {
  for (const mode of ['idle', 'no-power', 'dive', 'bank']) {
    const x = setup(); x.activities.startRecovery(x.flight); const r = flyRecovery(x, { mode });
    assert.equal(r.status, 'failed', mode); assert.equal(r.stallSeen, true, mode);
    assert.match(r.reason, mode === 'bank' ? /45 seconds/ : /Height loss exceeded/, mode);
    assert.ok(r.result.recoveryTime > 0 && r.result.heightLost > 0);
    if (mode === 'dive') assert.ok(r.final.speed > RECOVERY.safeSpeed, 'speed alone does not rescue a dive');
  }
  const x = setup({ terrain: (_x, z) => z < 3600 ? 2500 : 10 });
  x.activities.startRecovery(x.flight); const r = flyRecovery(x);
  assert.equal(x.s.crashed, true); assert.equal(r.status, 'failed'); assert.match(r.reason, /terrain|ground|landing/i);
});

test('clean configuration, level entry and safe terrain clearance have explicit failure reasons', () => {
  const cases = [
    [{ flaps: 1 }, /flaps retracted/],
    [{ stalled: true, throttle: 0.5 }, /idle power/],
    [{ stalled: true, throttle: 0, bank: 11 * DEG }, /wings level/],
  ];
  for (const [state, message] of cases) {
    const x = setup(); x.activities.startRecovery(x.flight); observe(x, state);
    assert.equal(x.recovery.status, 'failed'); assert.match(x.recovery.reason, message);
  }
  const x = setup(); x.activities.startRecovery(x.flight);
  const position = x.s.position.clone(); position.x = 12000; position.y = x.flight.groundAt(position.x, position.z) + 140;
  // Score a terrain-clearance boundary without fabricating a flight to the point.
  x.recovery.startAltitude = x.recovery.minimum = position.y; observe(x, { position });
  assert.equal(x.recovery.status, 'failed'); assert.match(x.recovery.reason, /Terrain clearance/);
});

test('a result freezes measurements, and Retry repeats the same start and ordinary-input flight', () => {
  const x = setup(); const run = () => { x.activities.startRecovery(x.flight); return flyRecovery(x); };
  const first = run(), result = x.recovery.snapshot(); step(x, 2);
  assert.deepEqual(x.recovery.snapshot(), result, 'later physics slices cannot rewrite a result');
  assert.deepEqual(run(), first); assert.equal(x.recovery.previous, WIND_PRESETS.gusts);
  x.activities.cancel(); assert.equal(wind(x), WIND_PRESETS.gusts);
  assert.deepEqual(run(), first);
});

test('one owner: every activity switch restores the previous wind before the new activity borrows it', () => {
  const x = setup();
  x.activities.startCrosswind(x.flight); assert.equal(x.activities.kind, 'crosswind');
  x.activities.startRecovery(x.flight); assert.equal(x.activities.kind, 'recovery');
  assert.equal(x.practice.running, false); assert.equal(x.landing.status, 'idle'); assert.equal(x.course.status, 'idle');
  assert.equal(x.recovery.previous, WIND_PRESETS.gusts); assert.equal(wind(x), CALM);
  x.activities.startCrosswind(x.flight); assert.equal(x.activities.kind, 'crosswind');
  assert.equal(x.practice.previous, WIND_PRESETS.gusts); assert.equal(x.recovery.status, 'idle');
  for (const start of [() => x.activities.startLanding(x.flight), () => x.activities.startCourse(x.flight)]) {
    x.activities.startRecovery(x.flight); start();
    assert.equal(wind(x), WIND_PRESETS.gusts); assert.equal(x.recovery.status, 'idle');
  }
});

test('custom pilot wind and later Weather choices survive retry, cancel, aircraft changes, reset and finished exits exactly once', () => {
  const custom = normalizeWind({ id: 'pilot', direction: 2.3, speed: 4.6, gust: 1.2, veer: 0.1, seed: 42 });
  const exits = {
    cancel: x => x.activities.cancel(),
    landing: x => x.activities.startLanding(x.flight),
    course: x => x.activities.startCourse(x.flight),
    aircraft: x => { x.flight.setAircraft('jet'); x.activities.update(dt, x.s); },
    reset: x => { x.flight.reset(); x.activities.update(dt, x.s); },
  };
  for (const finished of [false, true]) for (const [label, exit] of Object.entries(exits)) {
    const x = setup({ wind: custom }), changes = [], setWind = x.flight.setWind.bind(x.flight);
    x.flight.setWind = (config, options) => { changes.push(normalizeWind(config)); return setWind(config, options); };
    x.activities.startRecovery(x.flight); step(x);
    x.activities.startRecovery(x.flight); assert.equal(x.recovery.previous, custom);
    if (finished) assert.equal(flyRecovery(x).status, 'success'); else step(x);
    exit(x); assert.equal(wind(x), custom, `${label} finished=${finished}`);
    assert.equal(x.recovery.owning, false); assert.equal(changes.filter(c => c === custom).length, 1, label);
    x.activities.cancel(); x.activities.update(dt, x.s);
    assert.equal(changes.filter(c => c === custom).length, 1, `${label}: no double restore`);
  }
  const x = setup({ wind: custom }); x.activities.startRecovery(x.flight);
  assert.equal(x.activities.pilotWind(wind(x)), custom);
  assert.equal(x.activities.holdPilotChoice('breeze'), true); assert.equal(wind(x), CALM);
  x.activities.startRecovery(x.flight); assert.equal(x.activities.pilotWind(wind(x)), WIND_PRESETS.breeze);
  x.activities.cancel(); assert.equal(wind(x), WIND_PRESETS.breeze);
  assert.equal(x.activities.holdPilotChoice('gusts'), false);
});

test('crosswind result exits also restore its wind after a controller reset or aircraft change', () => {
  for (const change of [x => x.flight.reset(), x => x.flight.setAircraft('trainer')]) {
    const x = setup(); x.activities.startCrosswind(x.flight); step(x);
    x.landing.fail('Result boundary'); assert.equal(x.activities.finished, true);
    change(x); x.activities.update(dt, x.s);
    assert.equal(x.activities.kind, 'free'); assert.equal(x.practice.owning, false); assert.equal(wind(x), WIND_PRESETS.gusts);
  }
});


test('an external reset at time zero also releases either activity before a first physics slice', () => {
  for (const start of ['startRecovery', 'startCrosswind']) {
    for (const advance of [false, true]) {
      const x = setup(); x.activities[start](x.flight); assert.equal(x.s.flightTime, 0);
      x.flight.reset(); if (advance) x.flight.update(dt); x.activities.update(dt, x.s);
      assert.equal(x.activities.kind, 'free'); assert.equal(wind(x), WIND_PRESETS.gusts);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FLEET } from '../src/fleet.js';
import { CALM, WIND_PRESETS, normalizeWind } from '../src/wind.js';
import { runwayCoordinates } from '../src/airfield.js';
import { TAKEOFF, takeoffAvailability } from '../src/takeoff-practice.js';
import { takeoffBrief, takeoffResult } from '../src/takeoff-practice-ui.js';
import { makeBoard } from '../src/ranked-rules.js';
import { createRankedSimulation } from '../src/run-replay.js';
import { setup, flyTakeoff } from './takeoff-pilot.js';

const dt = 1 / 120;
const wind = x => x.flight.windSnapshot().config;
function step(x, seconds = 1, controls = {}) {
  for (let t = 0; t < seconds - 1e-8; t += dt) {
    if (x.activities.beforeStep(x.s)) continue;
    x.flight.update(dt, controls); x.activities.update(dt, x.s);
  }
}
// Boundary-only scoring observations. Actual successful flights below use ordinary controls.
function observe(x, changes = {}) {
  const s = { ...x.s, position: x.s.position.clone(), distance: x.takeoff.watch?.distance ?? x.s.distance, flightTime: x.takeoff.lastTime + dt, ...changes };
  x.takeoff.update(dt, s); return s;
}
function airborne(x) {
  const position = x.s.position.clone(); position.y += 60;
  observe(x, { position, grounded: false, distance: 150, airspeed: 33 });
  return { position, grounded: false, airspeed: 40, pitch: .14, verticalSpeed: 5, throttle: 1, bank: 0, heading: 0 };
}

test('only an explicit Mira choice starts takeoff; unsupported starts preserve the current activity and flight', () => {
  for (const type of Object.values(FLEET)) {
    assert.equal(takeoffAvailability(type).available, type.id === 'trainer');
    if (type.id === 'trainer') continue;
    const x = setup({ type: type.id }); x.activities.startLanding(x.flight);
    const before = x.landing.snapshot(), position = x.s.position.toArray();
    assert.equal(x.activities.startTakeoff(x.flight), null); assert.deepEqual(x.landing.snapshot(), before);
    assert.deepEqual(x.s.position.toArray(), position); assert.equal(wind(x), WIND_PRESETS.gusts);
    assert.match(takeoffBrief(type), /id="takeoff-aircraft"/); assert.doesNotMatch(takeoffBrief(type), /id="start-takeoff"/);
  }
});

test('manual start is stopped on Alpine 36 with idle power, clean configuration, neutral trim and calm air', () => {
  const x = setup(); const s = x.activities.startTakeoff(x.flight), at = runwayCoordinates(s.position, x.takeoff.field);
  assert.equal(x.activities.kind, 'takeoff'); assert.equal(x.activities.finished, false);
  assert.equal(s.aircraft, 'trainer'); assert.equal(s.autopilot, false); assert.equal(s.grounded, true);
  for (const key of ['speed', 'airspeed', 'throttle', 'spool', 'flaps', 'pitchTrim', 'brake', 'flightTime', 'distance', 'pitch', 'bank']) assert.equal(s[key], 0, key);
  assert.equal(s.gearDown, true); assert.equal(s.touchdown, null); assert.equal(s.selectedHeading, null); assert.equal(s.headingHold, false);
  assert.equal(at.along, TAKEOFF.startAlong); assert.equal(at.cross, 0); assert.equal(s.heading, 0); assert.equal(wind(x), CALM);
  assert.match(takeoffBrief(x.flight.type), /Start Mira T2 takeoff/);
});

for (const rate of [30, 60, 144]) for (const mode of ['yoke', 'keyboard']) test(`${rate} fps ${mode}: normal power and pitch inputs complete a real manual takeoff and sustained climb`, () => {
  const x = setup(); x.activities.startTakeoff(x.flight); const r = flyTakeoff(x, { rate, mode });
  assert.equal(r.status, 'success', r.reason); assert.equal(r.stallSeen, false); assert.equal(x.s.crashed, false); assert.equal(x.s.autopilot, false);
  assert.equal(x.activities.finished, true); assert.ok(r.stableTime >= TAKEOFF.stableSeconds);
  assert.ok(r.liftoff.distance > 110 && r.liftoff.distance < 140, `${r.liftoff.distance} m`);
  assert.ok(r.liftoff.speed * 1.94384 > 60 && r.liftoff.speed * 1.94384 < 63, `${r.liftoff.speed} m/s`);
  assert.equal(r.liftoff.alignment, 0); assert.equal(r.liftoff.cross, 0);
  assert.ok(r.result.height >= TAKEOFF.height && r.final.climb >= TAKEOFF.minClimb);
  assert.ok(r.final.time > 18 && r.final.time < 23, `${r.final.time} s`);
  assert.equal(r.result.groundDistance, r.liftoff.distance); assert.ok(x.s.distance > r.liftoff.distance);
  assert.match(takeoffResult(x.takeoff).metrics, /Takeoff ground roll/);
});

test('no rotation, no power and steering off the runway fail with useful feedback and no invented liftoff metrics', () => {
  for (const [mode, reason] of [['roll-only', /left the runway/], ['wait', /90 seconds/], ['veer', /left the runway/]]) {
    const x = setup(); x.activities.startTakeoff(x.flight); const r = flyTakeoff(x, { mode });
    assert.equal(r.status, 'failed', mode); assert.match(r.reason, reason); assert.equal(r.liftoff, null);
    assert.match(takeoffResult(x.takeoff).metrics, /Ground roll · no liftoff/); assert.match(takeoffResult(x.takeoff).metrics, /Not recorded/);
  }
});

test('a genuine post-liftoff terrain crash cannot succeed', () => {
  const x = setup({ terrain: (_x, z) => z < -1600 ? 300 : 78 });
  x.activities.startTakeoff(x.flight); const r = flyTakeoff(x);
  assert.ok(r.liftoff); assert.equal(x.s.crashed, true); assert.equal(r.status, 'failed'); assert.match(r.reason, /terrain|landing|ground/i);
});

test('assist before physics, assist after liftoff, touchdown and a changed configuration cannot earn success', () => {
  for (const afterLiftoff of [false, true]) {
    const x = setup(); x.activities.startTakeoff(x.flight);
    if (afterLiftoff) flyTakeoff(x, { seconds: 12 });
    assert.equal(!!x.takeoff.liftoff, afterLiftoff);
    if (afterLiftoff) x.flight.toggleAutopilot(); else x.s.autopilot = true; // Boundary injection: normal ground assist is refused by the controller.
    step(x); assert.equal(x.takeoff.status, 'failed'); assert.match(x.takeoff.reason, /Assist was used/);
    x.flight.toggleAutopilot(); step(x, 5); assert.equal(x.takeoff.status, 'failed');
  }
  const x = setup(); x.activities.startTakeoff(x.flight); airborne(x); observe(x, { grounded: true });
  assert.match(x.takeoff.reason, /touched the ground again/);
  x.activities.startTakeoff(x.flight); observe(x, { flaps: 1 }); assert.match(x.takeoff.reason, /flaps retracted/);
});

test('climb must be continuous and inside every target; flight time alone and intermittent stability never succeed', () => {
  for (const bad of [{ pitch: 0 }, { pitch: .4 }, { bank: .3 }, { heading: .4 }, { airspeed: 30 }, { airspeed: 67 }, { verticalSpeed: .5 }, { throttle: .7 }, { stalled: true }, { position: null }]) {
    const x = setup(); x.activities.startTakeoff(x.flight); const good = airborne(x);
    if (bad.position === null) bad.position = x.s.position.clone();
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 240; i++) observe(x, good);
      assert.ok(x.takeoff.stableTime > 1.9 && x.takeoff.stableTime < 2.1);
      observe(x, { ...good, ...bad }); assert.equal(x.takeoff.stableTime, 0, JSON.stringify(bad));
    }
    assert.equal(x.takeoff.status, 'flying');
  }
  const x = setup(); x.activities.startTakeoff(x.flight); const good = airborne(x), before = x.takeoff.snapshot();
  for (let i = 0; i < 500; i++) {
    const frozen = { ...x.s, ...good, distance: x.takeoff.watch.distance, flightTime: x.takeoff.lastTime };
    x.takeoff.update(dt, frozen);
    for (const invalid of [0, -1, NaN]) x.takeoff.update(invalid, frozen);
  }
  assert.deepEqual(x.takeoff.snapshot(), before);
});

test('results freeze, feedback measures the recorded liftoff, and retry repeats the start and flight', () => {
  const x = setup(), run = () => { x.activities.startTakeoff(x.flight); return flyTakeoff(x); };
  const first = run(), result = x.takeoff.snapshot(); step(x, 4); assert.deepEqual(x.takeoff.snapshot(), result);
  assert.deepEqual(run(), first); assert.equal(x.takeoff.previous, WIND_PRESETS.gusts);
  x.activities.cancel(); assert.equal(wind(x), WIND_PRESETS.gusts); assert.deepEqual(run(), first);
  // A boundary observation proves signed feedback is a measured nose/offset, not a fixed success claim.
  x.activities.startTakeoff(x.flight); const position = x.s.position.clone(); position.x += 8;
  observe(x, { grounded: false, position, distance: 123, airspeed: 34, heading: .1 });
  observe(x, { crashed: true }); const feedback = takeoffResult(x.takeoff);
  assert.match(feedback.metrics, /123/); assert.match(feedback.metrics, /66/); assert.match(feedback.metrics, /5.7° right/); assert.match(feedback.metrics, /8.0/);
});

test('every activity transition is exclusive and releases old wind before borrowing the next setup', () => {
  const x = setup();
  for (const other of ['startCrosswind', 'startRecovery', 'startLanding', 'startCourse']) {
    x.activities[other](x.flight); x.activities.startTakeoff(x.flight);
    assert.equal(x.activities.kind, 'takeoff'); assert.equal(x.practice.running, false); assert.equal(x.recovery.status, 'idle');
    assert.equal(x.landing.status, 'idle'); assert.equal(x.course.status, 'idle'); assert.equal(x.takeoff.previous, WIND_PRESETS.gusts);
    x.activities[other](x.flight); assert.equal(x.takeoff.status, 'idle'); assert.equal(x.takeoff.owning, false);
    if (other === 'startCrosswind') assert.equal(x.practice.previous, WIND_PRESETS.gusts);
    else if (other === 'startRecovery') assert.equal(x.recovery.previous, WIND_PRESETS.gusts);
    else assert.equal(wind(x), WIND_PRESETS.gusts);
    x.activities.cancel();
  }
});

test('custom wind and Weather choices survive retry, cancellation, reset and aircraft changes, including results and time-zero resets', () => {
  const custom = normalizeWind({ id: 'pilot', direction: 2.3, speed: 4.6, gust: 1.2, veer: .1, seed: 42 });
  for (const finish of [false, true]) for (const exit of ['cancel', 'reset', 'aircraft']) {
    const x = setup({ wind: custom }), changes = [], setWind = x.flight.setWind.bind(x.flight);
    x.flight.setWind = (config, options) => { changes.push(config); return setWind(config, options); };
    x.activities.startTakeoff(x.flight); step(x); x.activities.startTakeoff(x.flight);
    if (finish) flyTakeoff(x);
    if (exit === 'cancel') x.activities.cancel();
    if (exit === 'reset') x.flight.reset();
    if (exit === 'aircraft') x.flight.setAircraft('jet');
    x.activities.update(dt, x.s); x.activities.cancel(); x.activities.update(dt, x.s);
    assert.equal(x.activities.kind, 'free'); assert.equal(wind(x), custom); assert.equal(changes.filter(c => c === custom).length, 1, `${finish} ${exit}`);
  }
  const x = setup(); x.activities.startTakeoff(x.flight);
  assert.equal(x.activities.pilotWind(wind(x)), WIND_PRESETS.gusts); assert.equal(x.activities.holdPilotChoice('breeze'), true);
  assert.equal(wind(x), CALM); x.activities.startTakeoff(x.flight); assert.equal(x.takeoff.previous, WIND_PRESETS.breeze);
  x.flight.reset(); x.activities.update(dt, x.s); assert.equal(x.activities.kind, 'free'); assert.equal(wind(x), WIND_PRESETS.breeze);
  assert.equal(x.activities.holdPilotChoice('gusts'), false);
});


test('takeoff stays local; ranked-v1 starts remain identical with a live takeoff component attached', () => {
  assert.throws(() => makeBoard({ activity: 'takeoff', aircraft: 'trainer' }), e => e.code === 'INVALID_BOARD');
  for (const activity of ['landing', 'course', 'crosswind', 'recovery']) {
    const board = makeBoard({ activity, aircraft: 'trainer' }), fresh = createRankedSimulation(board), x = setup();
    x.activities.startTakeoff(x.flight); flyTakeoff(x, { seconds: 4 });
    createRankedSimulation(board, x);
    assert.equal(x.takeoff.status, 'idle'); assert.equal(x.takeoff.owning, false); assert.equal(x.activities.kind, activity);
    assert.deepEqual(x.s, fresh.s, activity);
    assert.deepEqual(x.landing.snapshot(), fresh.landing.snapshot(), activity);
    assert.deepEqual(x.course.snapshot(), fresh.course.snapshot(), activity);
    assert.deepEqual(x.recovery.snapshot(), fresh.recovery.snapshot(), activity);
  }
});

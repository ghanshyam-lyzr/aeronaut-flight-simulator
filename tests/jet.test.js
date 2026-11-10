import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, JET, jetSound } from '../src/flight.js';
import { createAircraft, AIRCRAFT } from '../src/aircraft.js';

function fly(flight, seconds, controls = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) flight.update(1 / 60, controls);
  return flight.state;
}
const knots = metres => metres * 1.94384;

function runwayStart() {
  const flight = new FlightController(() => 78);
  Object.assign(flight.state, { speed: 0, throttle: 0, spool: 0, gearDown: true, grounded: true });
  flight.state.position.set(900, 80.8, -1350);
  return flight;
}

test('jet cruise is faster than the old touring speed but stays in the valley range', () => {
  const state = fly(new FlightController(() => 78), 30);
  assert.ok(knots(state.speed) > 180 && knots(state.speed) < 210, `cruise ${knots(state.speed)} kt`);
  assert.equal(state.stalled, false);
});

test('engine spool lags the throttle lever, slowest from idle', () => {
  const flight = runwayStart();
  const state = flight.state;
  state.throttle = 1;
  fly(flight, 1);
  assert.ok(state.spool > 0.3 && state.spool < 0.6, `spool after 1 s: ${state.spool}`);
  fly(flight, 4);
  assert.ok(state.spool > 0.93);
});

test('takeoff roll rotates near 95 kt and lifts off well inside the 1,100 m runway', () => {
  const flight = runwayStart();
  const state = flight.state;
  let roll = 0, liftoff = 0;
  for (let i = 0; i < 60 * 30 && state.grounded; i++) {
    flight.update(1 / 60, { throttle: 1, pitch: 1 });
    roll = state.distance;
    liftoff = state.speed;
  }
  assert.equal(state.grounded, false);
  assert.ok(roll < 800, `roll ${roll} m`);
  assert.ok(knots(liftoff) > 90 && knots(liftoff) < 100, `liftoff ${knots(liftoff)} kt`);
  fly(flight, 20, { throttle: 1, pitch: 0.4 });
  assert.equal(state.crashed, false);
  assert.ok(state.position.y > 200);
});

test('idle power in level flight decays into a stall, and the stall drops the nose', () => {
  const flight = new FlightController(() => 78);
  const state = flight.state;
  state.throttle = 0;
  let stalledAt = 0;
  for (let i = 0; i < 60 * 60 && !stalledAt; i++) {
    flight.update(1 / 60);
    if (state.stalled) stalledAt = i / 60;
  }
  assert.ok(stalledAt > 5, `stalled after ${stalledAt} s`);
  assert.ok(knots(state.speed) < 83);
  fly(flight, 2);
  assert.ok(state.pitch < -0.05);
});

test('an approach with gear, full flaps and ~45% power stays flyable and under the touchdown limit', () => {
  const flight = new FlightController(() => 78);
  const state = flight.state;
  Object.assign(state, { gearDown: true, flaps: 2, throttle: 0.45 });
  fly(flight, 40);
  assert.equal(state.stalled, false);
  assert.ok(state.speed > JET.stallSpeed - 2 * JET.flapStallGain + 5);
  assert.ok(state.speed < JET.maxTouchdownSpeed);
});

test('touching down too fast is a hard landing; a jet-speed gentle touchdown lands and stops', () => {
  const fast = new FlightController(() => 78);
  fast.state.position.y = 80.81;
  Object.assign(fast.state, { speed: 80, gearDown: true, verticalSpeed: -1, pitch: -0.02 });
  fly(fast, 0.2);
  assert.equal(fast.state.crashed, true);

  const flight = new FlightController(() => 78);
  const state = flight.state;
  state.position.y = 80.81;
  Object.assign(state, { speed: 60, throttle: 0.3, gearDown: true, verticalSpeed: -1.5, pitch: -0.03 });
  fly(flight, 0.2);
  assert.equal(state.grounded, true);
  state.throttle = 0;
  const before = state.distance;
  fly(flight, 40);
  assert.ok(state.speed < 0.01);
  assert.ok(state.distance - before < 900, `rollout ${state.distance - before} m`);
});

test('jet sound rises in pitch and loudness with spool and wind with airspeed', () => {
  const idle = jetSound(0, 0), cruise = jetSound(0.72, 100), full = jetSound(1, 130);
  for (const key of ['whine', 'fan', 'roar', 'roarGain', 'rumbleGain', 'master']) {
    assert.ok(idle[key] < cruise[key] && cruise[key] < full[key], key);
  }
  assert.ok(idle.wind < full.wind);
  assert.ok(full.whine > 3000 && idle.whine < 1200);
  assert.deepEqual(jetSound(Number.NaN, -5), jetSound(0, 0));
});

test('aircraft is a propeller-free jet with animated gear and control surfaces', () => {
  const aircraft = createAircraft();
  assert.match(aircraft.group.name, new RegExp(AIRCRAFT.name));
  assert.equal('propellers' in aircraft, false);
  let meshes = 0;
  aircraft.group.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes < 99, `meshes ${meshes}`);

  const state = { gearDown: false, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 100, flightTime: 10 };
  aircraft.update(1 / 60, 0.7, state);
  assert.equal(aircraft.gearPosition, 0);
  state.gearDown = true;
  for (let i = 0; i < 90; i++) aircraft.update(1 / 60, 0.7, state);
  assert.ok(aircraft.gearPosition > 0.4 && aircraft.gearPosition < 0.6);
  for (let i = 0; i < 120; i++) aircraft.update(1 / 60, 0.7, state);
  assert.equal(aircraft.gearPosition, 1);

  state.flaps = 2;
  for (let i = 0; i < 180; i++) aircraft.update(1 / 60, 0.7, state);
  assert.ok(aircraft.surfaces.flaps.every(a => Math.abs(a - 0.52) < 1e-6));

  for (let i = 0; i < 20; i++) { state.bank += 0.01; state.pitch += 0.005; aircraft.update(1 / 60, 0.7, state); }
  const [right, left] = [...aircraft.surfaces.ailerons].sort((a, b) => a - b);
  assert.ok(right < -0.05 && left > 0.05, 'ailerons deflect opposite');
  assert.ok(aircraft.surfaces.elevators.every(a => a < -0.05), 'elevators rise to pitch up');

  state.grounded = true; state.gearDown = true;
  aircraft.update(1 / 60, 0.7, state);
  assert.equal(aircraft.gearPosition, 1);
});

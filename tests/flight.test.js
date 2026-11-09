import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightController, JET } from '../src/flight.js';

function fly(flight, seconds, controls = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) flight.update(1 / 60, controls);
  return flight.state;
}

test('cruise stays level and autopilot recovers altitude and heading', () => {
  const flight = new FlightController(() => 78);
  const state = fly(flight, 20);
  assert.equal(state.crashed, false);
  assert.ok(Math.abs(state.position.y - 620) < 0.1);
  assert.ok(state.distance > 1200);
  assert.equal(state.heading, 0);
  state.heading = 0.8;
  flight.toggleAutopilot();
  state.position.y += 20;
  state.pitch = 0.1;
  state.bank = 0.15;
  fly(flight, 40);
  assert.equal(state.autopilot, true);
  assert.ok(Math.abs(state.position.y - 620) < 2);
  assert.ok(Math.abs(state.heading - 0.8) < 0.01);
});

test('right bank turns and moves the aircraft right', () => {
  const flight = new FlightController(() => 78);
  const state = fly(flight, 2, { roll: 0.6 });
  assert.ok(state.bank > 0.5);
  assert.ok(state.heading > 0.05 && state.heading < Math.PI / 2);
  assert.ok(state.position.x > 1);
  assert.ok(new Vector3(0, 0, -1).applyQuaternion(state.quaternion).x > 0);
  assert.equal(state.crashed, false);
});

test('pitch up raises the nose and produces a climb', () => {
  const flight = new FlightController(() => 78);
  flight.toggleAutopilot();
  const state = fly(flight, 2, { pitch: 0.6 });
  assert.equal(state.autopilot, false);
  assert.ok(state.position.y > 625);
  assert.ok(state.verticalSpeed > 3);
  assert.ok(new Vector3(0, 0, -1).applyQuaternion(state.quaternion).y > 0);
});

test('throttle and pitch can take off from a stationary runway start', () => {
  const flight = new FlightController(() => 78);
  const state = flight.state;
  state.position.set(900, 80.8, -1350);
  Object.assign(state, { speed: 0, throttle: 0, gearDown: true, grounded: true });
  fly(flight, 20, { throttle: 1, pitch: 1 });
  assert.equal(state.crashed, false);
  assert.equal(state.grounded, false);
  assert.ok(state.position.y > 150);
  assert.ok(state.speed > 32);
});

test('a gentle gear-down touchdown lands and idle rolling comes to rest', () => {
  const flight = new FlightController(() => 78);
  const state = flight.state;
  state.position.y = 80.81;
  Object.assign(state, { speed: 35, throttle: 0.2, gearDown: true, verticalSpeed: -1, pitch: -0.03 });
  fly(flight, 0.2);
  assert.equal(state.grounded, true);
  assert.equal(state.crashed, false);
  assert.ok(Math.abs(state.position.y - 80.8) < 0.01);
  state.throttle = 0;
  fly(flight, 30);
  assert.ok(state.speed < 0.01);
});

test('terrain impact ends flight and reset restores a flyable aircraft', () => {
  const flight = new FlightController(() => 78);
  flight.state.position.y = 80.81;
  flight.state.verticalSpeed = -10;
  fly(flight, 0.2);
  assert.equal(flight.state.crashed, true);
  assert.equal(flight.state.speed, 0);
  flight.reset();
  assert.equal(flight.state.crashed, false);
  assert.equal(flight.state.flightTime, 0);
  assert.equal(flight.state.speed, JET.cruiseSpeed);
  assert.ok(fly(flight, 1).position.z < 1900);
});

test('water contact crashes even with gear down and a gentle descent', () => {
  const flight = new FlightController(() => -20);
  flight.state.position.y = 12.81;
  Object.assign(flight.state, { speed: 35, gearDown: true, verticalSpeed: -1, pitch: -0.03 });
  fly(flight, 0.2);
  assert.equal(flight.state.crashed, true);
  assert.equal(flight.state.grounded, false);
});

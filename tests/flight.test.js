import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { FlightController, JET } from '../src/flight.js';

function fly(flight, seconds, controls = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) flight.update(1 / 60, controls);
  return flight.state;
}

test('G-force is 1 in level flight and increases in coordinated turns', () => {
  const flight = new FlightController(() => 78);
  assert.equal(flight.state.gForce, 1);
  assert.equal(fly(flight, 2).gForce, 1);
  for (const direction of [-1, 1]) {
    flight.reset();
    flight.state.bank = direction * Math.PI / 3;
    flight.state.verticalSpeed = -Math.sin(Math.PI / 3) * 0.9;
    // A coordinated 60-degree bank carries approximately twice the level load.
    const state = flight.update(1 / 60, { roll: direction * 0.05 });
    assert.ok(Math.abs(state.gForce - 2) < 0.05);
  }
});

test('G-force responds to pull-ups and preserves negative-g loads', () => {
  const flight = new FlightController(() => 78);
  assert.ok(fly(flight, 1.5, { pitch: 1 }).gForce > 2);
  flight.reset();
  assert.ok(fly(flight, 1.5, { pitch: -1 }).gForce < 0);
});

test('G-force can exceed 6 and resets to 1 on restart and on the ground', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const flight = new FlightController(() => 78);
    Object.assign(flight.state, { pitch: 0.48, verticalSpeed: -20, speed: 100 });
    const { gForce } = flight.update(dt);
    assert.ok(Number.isFinite(gForce) && gForce > 6);
    flight.reset();
    assert.equal(flight.state.gForce, 1);
    Object.assign(flight.state, { grounded: true, gForce: 7, speed: 0 });
    assert.equal(flight.update(dt).gForce, 1);
  }
});

test('fighter G-force stays finite at and across vertical, knife-edge and inverted attitudes', () => {
  for (const pitch of [0, -Math.PI / 2, Math.PI / 2]) {
    for (const bank of [0, -Math.PI / 2, Math.PI / 2, Math.PI]) {
      for (const offset of [-1e-7, 0, 1e-7]) {
        const flight = new FlightController(() => 0, 'fighter');
        const s = flight.state;
        s.position.y = 10000;
        s.quaternion.setFromEuler(new Euler(pitch + offset, -1.2, -bank, 'YXZ'));
        flight.readAttitude();
        s.verticalSpeed = new Vector3(0, 0, -s.speed).applyQuaternion(s.quaternion).y - Math.abs(Math.sin(s.bank)) * 0.9;
        flight.update(1 / 60);
        assert.ok(Number.isFinite(s.gForce) && Math.abs(s.gForce) < 3, `pitch ${pitch}, bank ${bank}: ${s.gForce}`);
        if (bank === 0 && Math.abs(pitch) === Math.PI / 2) assert.ok(Math.abs(s.gForce) < 1e-5, 'vertical thrust does not produce a normal load');
        if (pitch === 0 && bank === Math.PI) assert.ok(Math.abs(s.gForce + 1) < 1e-5, 'steady inverted flight reads -1 g');
      }
    }
  }
});

test('fighter G-force follows measured motion continuously through loops and rolls', () => {
  const dt = 1 / 60;
  const manoeuvres = [
    { pitch: 1, throttle: 1 }, { pitch: -1, throttle: 1 },
    { roll: 1 }, { roll: -1 }, { pitch: 0.6, roll: 0.4, yaw: 0.2, throttle: 1 },
  ];
  for (const controls of manoeuvres) {
    const flight = new FlightController(() => 0, 'fighter');
    flight.state.position.y = 10000;
    let previousVelocity, previousLoad = 1, minimum = 1, maximum = 1;
    for (let i = 0; i < 20 / dt; i++) {
      const before = flight.state.position.clone();
      const s = flight.update(dt, controls);
      const velocity = s.position.clone().sub(before).divideScalar(dt);
      assert.equal(s.crashed, false);
      assert.ok(Number.isFinite(s.gForce));
      assert.ok(Math.abs(s.gForce - previousLoad) < 1, `load jumped from ${previousLoad} to ${s.gForce}`);
      if (previousVelocity) {
        // An independent accelerometer reading from successive position deltas.
        const force = velocity.clone().sub(previousVelocity).divideScalar(dt).add(new Vector3(0, 9.81, 0));
        const aircraftUp = new Vector3(0, 1, 0).applyQuaternion(s.quaternion);
        const measuredLoad = force.dot(aircraftUp) / 9.81;
        assert.ok(Math.abs(s.gForce - measuredLoad) < 1e-6, `${s.gForce} vs measured ${measuredLoad}`);
      }
      previousVelocity = velocity;
      previousLoad = s.gForce;
      minimum = Math.min(minimum, s.gForce);
      maximum = Math.max(maximum, s.gForce);
    }
    if (controls.pitch > 0) assert.ok(maximum > 6, 'pulling reaches the warning threshold');
    if (controls.pitch < 0) assert.ok(minimum < -6, 'outside loops retain the negative load sign');
    if (!controls.pitch) assert.ok(minimum < -0.9 && maximum < 3, 'rolling passes through negative load without a singularity');
  }
});

test('switching aircraft clears a previous G-force load and runway starts read 1 g', () => {
  const flight = new FlightController(() => 78, 'fighter');
  flight.state.gForce = 8;
  assert.equal(flight.setAircraft('jet').gForce, 1);
  flight.state.gForce = -3;
  assert.equal(flight.runwayStart(900, 80.8, -1350).gForce, 1);
  assert.equal(fly(flight, 1).gForce, 1);
});

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

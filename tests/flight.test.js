import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightController, FlightAudio, JET } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';

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

// Hold level-flight speed across a physics step so acceleration cannot cross a tested boundary.
function setAirspeed(flight, speed, flaps = 0) {
  const f = flight.type.flight;
  const throttle = (speed - f.idleSpeed + flaps * f.flapDrag) / f.thrustSpeed;
  Object.assign(flight.state, { speed, flaps, throttle, spool: throttle, pitch: 0, bank: 0, heading: 0 });
  flight.pitchRate = flight.rollRate = flight.yawRate = 0;
  flight.setQuaternion();
}

for (const [aircraft, thresholds] of [['jet', [42, 39, 36]], ['fighter', [56, 51, 46]]]) {
  for (const [flaps, stallSpeed] of thresholds.entries()) {
    test(`${FLEET[aircraft].name} stall threshold is strictly below ${stallSpeed} m/s with ${flaps * 15}° flaps`, () => {
      const flight = new FlightController(() => 78, aircraft);
      const state = flight.state;
      for (const speed of [stallSpeed - 0.01, stallSpeed, stallSpeed + 0.01]) {
        setAirspeed(flight, speed, flaps);
        flight.update(1 / 60);
        assert.equal(state.stalled, speed < stallSpeed, `airspeed ${speed} m/s`);
      }
      Object.assign(state, { grounded: true, speed: 0, stalled: true });
      flight.update(1 / 60);
      assert.equal(state.stalled, false, 'no stall warning on the ground');
    });
  }

  test(`${FLEET[aircraft].name} flap changes update the stall threshold in flight`, () => {
    const flight = new FlightController(() => 78, aircraft);
    const speed = (thresholds[0] + thresholds[1]) / 2;
    for (const stalled of [true, false, false, true]) {
      setAirspeed(flight, speed, flight.state.flaps);
      flight.update(1 / 60);
      assert.equal(flight.state.stalled, stalled, `${flight.state.flaps * 15}° flaps`);
      flight.cycleFlaps();
    }
  });
}

test('stall detection follows the active aircraft when switching types', () => {
  const flight = new FlightController(() => 78, 'jet');
  for (const [aircraft, stalled] of [['jet', false], ['fighter', true], ['jet', false]]) {
    flight.setAircraft(aircraft);
    setAirspeed(flight, 48);
    flight.update(1 / 60);
    assert.equal(flight.state.stalled, stalled, aircraft);
  }
});

test('fighter stall thresholds apply inverted, at knife-edge and through vertical flight', () => {
  const flight = new FlightController(() => 78, 'fighter');
  const f = flight.type.flight;
  for (const [pitch, bank] of [[0, Math.PI], [0, Math.PI / 2], [Math.PI / 2, 0], [-Math.PI / 2, 0]]) {
    for (const flaps of [0, 1, 2]) {
      for (const offset of [-0.1, 0.1]) {
        flight.reset();
        flight.state.position.y = 3000;
        const speed = f.stallSpeed - flaps * f.flapStallGain + offset;
        Object.assign(flight.state, { speed, flaps, pitch, bank });
        flight.setQuaternion();
        flight.update(0.00001);
        assert.equal(flight.state.stalled, offset < 0, `pitch ${pitch}, bank ${bank}, ${flaps * 15}° flaps, ${speed} m/s`);
        assert.equal(flight.state.crashed, false);
        assert.ok(Math.abs(flight.state.quaternion.length() - 1) < 1e-9);
      }
    }
  }
});

for (const aircraft of ['jet', 'fighter']) {
  test(`${FLEET[aircraft].name} stall horn is short, sounds once per stall and rearms after recovery`, async t => {
    const oscillators = [];
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
    const node = () => ({ connect(target) { return target; }, disconnect() {} });
    class AudioContext {
      currentTime = 1;
      sampleRate = 100;
      destination = node();
      createGain() { return { ...node(), gain: param() }; }
      createBiquadFilter() { return { ...node(), frequency: param(), Q: param() }; }
      createBuffer() { return { getChannelData: () => new Float32Array(200) }; }
      createBufferSource() { return { ...node(), start() {} }; }
      createOscillator() {
        const oscillator = { ...node(), frequency: param(), starts: [], stops: [],
          start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); } };
        oscillators.push(oscillator);
        return oscillator;
      }
      async resume() {}
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', { value: AudioContext, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, 'AudioContext', original);
      else delete globalThis.AudioContext;
    });
    const audio = new FlightAudio();
    await audio.start();
    const engines = oscillators.length;
    const state = { aircraft, throttle: 0, speed: FLEET[aircraft].flight.stallSpeed - 1, stalled: false, grounded: false, crashed: false };
    audio.update(state);
    assert.equal(oscillators.length, engines);
    state.stalled = true;
    audio.update(state);
    assert.equal(oscillators.length, engines + 1);
    const horn = oscillators.at(-1);
    assert.equal(horn.starts.length, 1);
    assert.ok(horn.stops[0] - horn.starts[0] > 0 && horn.stops[0] - horn.starts[0] <= 0.5);
    horn.onended();
    for (let i = 0; i < 60; i++) audio.update(state);
    assert.equal(oscillators.length, engines + 1, 'sustained stalls do not retrigger the horn');
    state.stalled = false;
    audio.update(state);
    state.stalled = true;
    audio.update(state);
    assert.equal(oscillators.length, engines + 2, 'a new stall sounds again');
    for (const flag of ['grounded', 'crashed']) {
      state[flag] = true;
      const count = oscillators.length;
      audio.update(state);
      assert.equal(oscillators.length, count, `no horn while ${flag}`);
      state[flag] = false;
      audio.update(state);
      assert.equal(oscillators.length, count + 1);
    }
    const activeHorn = oscillators.at(-1);
    audio.toggle();
    assert.equal(activeHorn.stops.at(-1), undefined, 'muting stops the active horn immediately');
    const count = oscillators.length;
    audio.update(state);
    assert.equal(oscillators.length, count, 'no horn while muted');
  });
}

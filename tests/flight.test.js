import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightController, FlightAudio, JET } from '../src/flight.js';

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

for (const aircraft of ['jet', 'fighter']) {
  test(`gear warning requires low AGL, low throttle, and gear up together (${aircraft})`, () => {
    const flight = new FlightController(() => 78, aircraft);
    for (const agl of [300, 310]) {
      for (const throttle of [0.19, 0.21]) {
        for (const gearDown of [false, true]) {
          Object.assign(flight.state, { throttle, gearDown });
          flight.state.position.y = 78 + agl;
          assert.equal(flight.gearWarning, agl === 300 && throttle === 0.19 && !gearDown,
            `AGL ${agl} m, throttle ${throttle}, gear ${gearDown ? 'down' : 'up'}`);
        }
      }
    }
  });

  test(`gear warning excludes exactly 1,000 ft AGL and exactly 20% throttle (${aircraft})`, () => {
    for (const elevation of [10, 78, 1500]) {
      const flight = new FlightController(() => elevation, aircraft);
      flight.state.throttle = 0.19;
      for (const [agl, expected] of [[304.79999, true], [304.8, false], [304.80001, false]]) {
        flight.state.position.y = elevation + agl;
        assert.equal(flight.gearWarning, expected, `AGL ${agl} m over ${elevation} m terrain`);
      }
      flight.state.position.y = elevation + 300;
      for (const [throttle, expected] of [[0, true], [0.2 - Number.EPSILON, true], [0.2, false], [0.2 + Number.EPSILON, false]]) {
        flight.state.throttle = throttle;
        assert.equal(flight.gearWarning, expected, `throttle ${throttle}`);
      }
    }
  });

  test(`gear warning clears and rearms immediately as each condition changes (${aircraft})`, () => {
    const flight = new FlightController(x => x === 100 ? 1500 : 78, aircraft);
    const s = flight.state;
    s.position.set(100, 1600, -50);
    s.throttle = 0.1;
    assert.equal(flight.gearWarning, true);
    flight.toggleGear();
    assert.equal(flight.gearWarning, false);
    flight.toggleGear();
    assert.equal(flight.gearWarning, true);
    s.throttle = 0.2;
    assert.equal(flight.gearWarning, false);
    s.throttle = 0.1;
    assert.equal(flight.gearWarning, true);
    s.position.x = 0;
    assert.equal(flight.gearWarning, false, 'same absolute altitude over lower terrain clears the warning');
    s.position.x = 100;
    assert.equal(flight.gearWarning, true);
    flight.reset();
    assert.equal(flight.gearWarning, false);
  });

  test(`gear warning uses the water surface for AGL above the lake (${aircraft})`, () => {
    const flight = new FlightController(() => -20, aircraft);
    flight.state.position.y = 310;
    flight.state.throttle = 0.1;
    assert.equal(flight.gearWarning, true, '300 m above the 10 m lake surface');
    flight.state.position.y = 314.8;
    assert.equal(flight.gearWarning, false);
  });

  test(`gear horn starts silent, follows the warning, and respects sound and flight state (${aircraft})`, async t => {
    const parameter = () => ({
      value: 0,
      targets: [],
      setTargetAtTime(value) { this.targets.push(value); },
    });
    const node = () => ({
      gain: parameter(), frequency: parameter(), Q: parameter(), connections: [],
      connect(target) { this.connections.push(target); return target; },
      start() { this.started = true; },
    });
    const ctx = {
      currentTime: 1, sampleRate: 32, destination: node(), oscillators: [],
      createGain: node,
      createBiquadFilter: node,
      createBufferSource: node,
      createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
      createOscillator() { const oscillator = node(); this.oscillators.push(oscillator); return oscillator; },
      async resume() {},
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return ctx; } } });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, 'AudioContext', original);
      else delete globalThis.AudioContext;
    });
    const audio = new FlightAudio();
    const state = { aircraft, throttle: 0.1, spool: 0.85, speed: 80, crashed: false };
    audio.update(state, true); // A warning must be safe before the user enables audio.
    assert.equal(await audio.start(), true);
    const voiceCount = ctx.oscillators.length;
    const horns = ctx.oscillators.filter(osc => osc.type === 'square' && osc.frequency.value === 400);
    assert.equal(horns.length, 1, 'one shared horn for both aircraft');
    const [horn] = horns;
    assert.equal(horn.type, 'square');
    assert.equal(horn.frequency.value, 400);
    assert.equal(horn.started, true);
    assert.deepEqual(horn.connections, [audio.gearHorn]);
    assert.deepEqual(audio.gearHorn.connections, [audio.master]);
    assert.equal(audio.gearHorn.gain.value, 0);
    const level = () => audio.gearHorn.gain.targets.at(-1);
    audio.update(state);
    assert.equal(level(), 0);
    audio.update(state, true);
    assert.ok(level() > 0);
    audio.update(state, false);
    assert.equal(level(), 0, 'clearing the warning silences the horn');
    audio.update(state, true);
    assert.ok(level() > 0, 'the horn can rearm');
    audio.toggle();
    audio.update(state, true);
    assert.equal(level(), 0, 'sound off silences the horn');
    assert.equal(audio.master.gain.targets.at(-1), 0);
    await audio.start();
    assert.equal(ctx.oscillators.length, voiceCount, 'reenabling sound reuses the horn');
    audio.update(state, true);
    assert.ok(level() > 0);
    audio.update({ ...state, crashed: true }, true);
    assert.equal(level(), 0, 'crashed or paused audio state silences the horn');
    audio.update({ ...state, aircraft: aircraft === 'jet' ? 'fighter' : 'jet' }, false);
    assert.equal(level(), 0, 'switching aircraft with no warning stays silent');
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightInputs } from '../src/controls.js';
import { TRIM_RATE } from '../src/flight.js';
import { groundVelocity } from '../src/flight-path.js';
import { windFlight, inputFlight } from './wind-stability-pilot.js';

const rates = [30, 60, 144];
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const events = [[0.013, { roll: 0.3 }], [0.113, {}], [1.237, { pitch: -0.4, trim: 1 }], [1.337, {}],
  [2.011, { roll: 0.3 }], [5.133, { roll: -0.2 }], [5.283, {}]];
const queue = (input, script = events) => { for (const [time, controls] of script) input.set(controls, time); };
const bounded = (r, label) => {
  assert.ok(Number.isFinite(r.minG) && r.minG > 0.8 && r.maxG < 3, `${label}: ${r.minG}–${r.maxG} g`);
  close(r.elapsed, 10, 1e-11, `${label}: all input time was integrated`);
  close(r.flightTime, 10, 1e-11, `${label}: flight clock`);
  close(r.windTime, 10, 1e-11, `${label}: wind clock`);
};

test('Gusts: a landing turn through ordinary 30/60/144 fps inputs has no remainder-slice load spikes', () => {
  const runs = rates.map(rate => {
    const setup = windFlight({ landing: true });
    setup.input.set({ roll: 0.3 }, 0.1); // The original ten-second, 60 fps reproduction.
    const r = inputFlight(setup, { rate });
    bounded(r, `${rate} fps`);
    assert.ok(r.maxG > 2, 'the bank still creates a real manoeuvre load');
    if (rate !== 144) assert.ok(r.minStep < 1e-14 && r.tinySteps > 100, 'natural floating-point remainder slices were exercised');
    return r;
  });
  for (const r of runs.slice(0, -1)) {
    const ref = runs.at(-1);
    close(r.minG, ref.minG, 0.001, 'minimum load agrees across cadences');
    close(r.maxG, ref.maxG, 0.001, 'maximum load agrees across cadences');
    assert.ok(r.position.distanceTo(ref.position) < 0.1, 'endpoint agrees within 10 cm');
    close(r.speed, ref.speed, 0.001, 'airspeed inertia agrees');
  }
});

for (const landing of [false, true]) for (const wind of ['gusts', 'transition']) {
  test(`${landing ? 'landing descent' : 'banked flight'}, ${wind}: event boundaries and positive 1 ns partials retain loads, time and control impulse`, () => {
    const runs = rates.map(rate => {
      const run = partials => {
        const setup = windFlight({ wind, landing }); queue(setup.input);
        const r = inputFlight(setup, { rate, partials });
        bounded(r, `${rate} fps, partials ${partials}`);
        assert.equal(setup.flight.state.crashed, false);
        assert.equal(setup.flight.windSnapshot().transitioning, false);
        close(setup.flight.state.pitchTrim, 0.1 * TRIM_RATE, 1e-12, 'timestamped trim press/release');
        return r;
      };
      const regular = run(false), partial = run(true);
      assert.ok(partial.tinySteps >= rate * 10 - 1, 'explicit tiny intervals reach the flight model');
      assert.ok(partial.position.distanceTo(regular.position) < 1e-5, 'partials do not change ground drift');
      close(partial.speed, regular.speed, 1e-6, 'partials do not change airspeed inertia');
      close(partial.distance, regular.distance, 1e-5, 'ground distance does not lose time');
      close(partial.minG, regular.minG, 0.001, 'minimum load with partials');
      close(partial.maxG, regular.maxG, 0.001, 'maximum load with partials');
      for (const axis of Object.keys(partial.impulse)) close(partial.impulse[axis], regular.impulse[axis], 1e-12, `${axis} impulse with partials`);
      return partial;
    });
    for (const r of runs.slice(0, -1)) {
      const ref = runs.at(-1);
      assert.ok(r.position.distanceTo(ref.position) < 0.15, 'cadence does not change the flight path');
      close(r.minG, ref.minG, 0.005, 'minimum load across cadences');
      close(r.maxG, ref.maxG, 0.005, 'maximum load across cadences');
      for (const axis of Object.keys(r.impulse)) close(r.impulse[axis], ref.impulse[axis], 1e-12, `${axis} timestamped impulse across cadences`);
    }
  });
}

test('resolved gusting loads follow endpoint inertial acceleration; ground velocity keeps matching midpoint displacement', () => {
  for (const landing of [false, true]) for (const wind of ['gusts', 'transition']) {
    const setup = windFlight({ landing, wind }), f = setup.flight, s = f.state;
    queue(setup.input);
    const endpointVelocity = () => {
      const w = f.sampleWind(), v = new Vector3(0, 0, -s.speed).applyQuaternion(s.quaternion);
      return v.set(v.x + w.x, s.verticalSpeed, v.z + w.z);
    };
    for (let frame = 1; frame <= 10 * 60; frame++) setup.input.advance(frame / 60, (dt, controls) => {
      const before = s.position.clone(), velocityBefore = endpointVelocity();
      f.update(dt, controls);
      if (dt < 1e-6) return; // Differentiating positions over an unresolved interval is itself ill-conditioned.
      const force = endpointVelocity().sub(velocityBefore).divideScalar(dt).add(new Vector3(0, 9.81, 0));
      const up = new Vector3(0, 1, 0).applyQuaternion(s.quaternion);
      close(s.gForce, force.dot(up) / 9.81, 1e-8, 'load follows the velocity change over the same interval');
      const moved = s.position.clone().sub(before).divideScalar(dt);
      assert.ok(moved.distanceTo(groundVelocity(s, f.type)) < 1e-8, 'the flight-path marker still reads the displacement velocity');
    });
  }
});

test('tiny standalone updates and a run made entirely of short slices still apply controls and elapsed time', () => {
  for (const landing of [false, true]) for (const wind of ['gusts', 'transition']) {
    const setup = windFlight({ landing, wind }), f = setup.flight;
    setup.input.set({ roll: 0.3 }, 0.1); inputFlight(setup, { seconds: 2 });
    for (const dt of [1e-9, 1e-12, Number.EPSILON, 1e-9]) {
      const g = f.state.gForce, time = f.state.flightTime, windTime = f.windSnapshot().time;
      f.update(dt, { roll: 0.3 });
      close(f.state.gForce, g, 1e-5, 'a tiny slice does not turn roundoff into acceleration');
      assert.equal(f.state.flightTime, time + dt, 'even a tiny interval advances flight time');
      assert.equal(f.windSnapshot().time, windTime + dt, 'and wind time');
    }
  }
  // A fresh flight has no preceding accelerometer interval: accumulate these slices until it can be resolved.
  const { flight: f } = windFlight();
  const input = new FlightInputs(0), start = f.state.position.clone(), trim = f.state.pitchTrim;
  input.set({ trim: 1 }, 0);
  for (let i = 1; i <= 4000; i++) input.advance(i * 1e-9, (dt, c) => f.update(dt, c));
  close(f.state.flightTime, 4e-6, 1e-18, 'a sequence made entirely of 1 ns slices loses no time');
  close(f.windSnapshot().time, 4e-6, 1e-18, 'short-only wind clock');
  close(f.state.pitchTrim - trim, TRIM_RATE * 4e-6, 1e-18, 'short-only trim impulse is retained');
  assert.ok(f.state.position.distanceTo(start) > 0.0001, 'the aircraft moves during short-only inputs');
  assert.ok(f.state.gForce > 0.9 && f.state.gForce < 1.1, 'a resolved load emerges from accumulated short slices');
});

test('windy fighter manoeuvres retain genuine positive and negative loads with partial input slices', () => {
  for (const pitch of [-1, 1]) {
    const setup = windFlight({ aircraft: 'fighter' }); setup.flight.state.position.y = 10000;
    setup.input.set({ pitch, throttle: 1 }, 0.1);
    const r = inputFlight(setup, { partials: true });
    assert.ok(pitch > 0 ? r.maxG > 6 : r.minG < -6, `a real ${pitch > 0 ? 'pull-up' : 'push-over'} stays measurable: ${r.minG}–${r.maxG} g`);
    assert.equal(setup.flight.state.crashed, false);
  }
});

test('reset, landing retry and a paused input clock leave no stale wind or load sample', () => {
  for (const wind of ['gusts', 'transition']) {
    const setup = windFlight({ landing: true, wind }), f = setup.flight;
    const attempt = (paused = false) => {
      setup.mission.start(f); setup.input.reset(0);
      if (wind === 'transition') { f.setWind('calm', { immediate: true }); f.setWind('gusts'); }
      setup.input.set({ roll: 0.3 }, 0.1);
      inputFlight(setup, { seconds: 2, partials: true });
      const frozen = { wind: f.windSnapshot(), position: f.state.position.toArray(), g: f.state.gForce };
      f.update(0); f.update(-1); f.update(NaN);
      for (let i = 0; i < 10; i++) f.sampleWind();
      assert.deepEqual({ wind: f.windSnapshot(), position: f.state.position.toArray(), g: f.state.gForce }, frozen, 'no simulation update means no clock or load change');
      const origin = paused ? 200 : 2;
      setup.input.reset(origin); // The app resets held inputs on pause; the wall-clock gap is never flown.
      setup.input.set({ roll: -0.2, trim: 1 }, origin + 0.013); setup.input.set({}, origin + 0.113);
      return inputFlight(setup, { seconds: 8, partials: true });
    };
    const first = attempt(), retry = attempt(), paused = attempt(true);
    assert.deepEqual(retry, first, 'retry replays the same gusts, inputs and loads exactly');
    assert.ok(paused.position.distanceTo(first.position) < 1e-8, 'pause preserves the ground path');
    close(paused.minG, first.minG, 1e-7, 'pause preserves the minimum load');
    close(paused.maxG, first.maxG, 1e-7, 'pause preserves the maximum load');
    close(paused.flightTime, 10, 1e-11, 'pause adds no flight time');
    close(paused.windTime, 10, 1e-11, 'pause adds no wind time');
    f.reset(); assert.equal(f.state.gForce, 1); assert.equal(f.windSnapshot().time, 0);
    f.update(1e-9); assert.equal(f.state.gForce, 1, 'an unresolved first sample cannot reuse the earlier bank load');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { FlightController } from '../src/flight.js';
import { FlightInputs, TRAVEL } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { angularResponse } from '../src/handling.js';
import { landingProfile } from '../src/landing-mission.js';

const axes = ['pitch', 'roll', 'yaw', 'throttle'];
const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' };
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const make = id => new FlightController(() => 78, id);
function advance(flight, input, from, to, cadence = [1 / 120], visit = () => {}) {
  for (let t = from, frame = 0; t < to - 1e-9;) {
    t = Math.min(to, t + cadence[frame++ % cadence.length]);
    input.advance(t, (dt, c) => { flight.update(dt, c); visit(dt, c); });
  }
}
function approach(id) {
  const flight = make(id), p = landingProfile(flight.type), s = flight.state;
  Object.assign(s, { speed: p.speed, pitch: -Math.atan(p.slope), verticalSpeed: -p.speed * p.slope,
    gearDown: true, flaps: p.flaps, throttle: p.throttle, spool: p.throttle });
  s.position.y = 500;
  flight.setQuaternion();
  return flight;
}
function sequence(flight, events, seconds, response = 1, cadence) {
  const input = new FlightInputs(0, Object.fromEntries(axes.map(a => [a, response])));
  for (const [t, c] of events) input.set(c, t);
  advance(flight, input, 0, seconds, cadence);
  return input;
}

test('opposing angular response splits exactly at rest, including a reversal inside one step', () => {
  for (const [current, target] of [[1, -0.7], [-0.8, 0.3], [0.5, 0], [0.7, 0.2], [0, 1]]) {
    const whole = angularResponse(current, target, 3.4, 0.2);
    let rate = current, rotation = 0;
    for (let i = 0; i < 20; i++) { const step = angularResponse(rate, target, 3.4, 0.01); rate = step.rate; rotation += step.angle; }
    assert.ok(Math.abs(rate - whole.rate) < 1e-12);
    assert.ok(Math.abs(rotation - whole.angle) < 1e-12, 'braking distance is independent of the step partition');
  }
});

for (const [id, type] of Object.entries(FLEET)) {
  test(`${id}: 50–150 ms taps on every axis stay fine at 50/100/200% response in both directions`, () => {
    const baseline = make(id); sequence(baseline, [], 1.6);
    for (const axis of axes) for (const response of [0.5, 1, 2]) for (const duration of [0.05, 0.1, 0.15]) for (const sign of [-1, 1]) {
      const flight = make(id), initialThrottle = flight.state.throttle;
      const input = sequence(flight, [[0.013, { [axis]: sign }], [0.013 + duration, {}]], 1.6, response);
      const s = flight.state;
      const delta = (axis === 'yaw' ? angle(s.heading - baseline.state.heading) : s[field[axis]] - baseline.state[field[axis]]) * sign;
      const bound = { pitch: 0.025, roll: 0.075, yaw: 0.02, throttle: 0.03 }[axis];
      assert.ok(delta > 0 && delta < bound, `${axis} ×${response} ${duration}s: ${delta}`);
      assert.equal(s.crashed, false); assert.equal(s.stalled, false);
      assert.ok(Object.values(input.value).every(v => v === 0), 'release cancels every command');
      if (axis === 'throttle') {
        const expected = duration ** 2 * response / (2 * TRAVEL.throttle) * type.flight.throttleRate;
        assert.ok(Math.abs((s.throttle - initialThrottle) * sign - expected) < 1e-12, 'lever/collective stops exactly on release');
      }
    }
  });

  test(`${id}: holds keep rated authority; released rates damp and shaped reversals promptly change direction`, () => {
    const f = type.flight;
    for (const axis of ['pitch', 'roll', 'yaw']) {
      const flight = make(id);
      sequence(flight, [[0, { [axis]: 1 }]], 3);
      assert.ok(flight[`${axis}Rate`] > f[`${axis}Rate`] * 0.99, `${axis}: full authority`);
      sequence(flight, [], 0.6);
      if (!f.rotorcraft || axis === 'yaw') assert.ok(Math.abs(flight[`${axis}Rate`]) < f[`${axis}Rate`] * 0.005, `${axis}: release tail`);
      for (const response of [0.5, 1, 2]) {
        const reversed = make(id), input = new FlightInputs(0, { [axis]: response });
        input.set({ [axis]: 1 }, 0); input.set({ [axis]: -1 }, 1.6);
        advance(reversed, input, 0, 1.95);
        assert.ok(reversed[`${axis}Rate`] < 0, `${axis} ×${response}: reversal arrests the old rotation within 350 ms`);
      }
    }
  });

  test(`${id}: combined small inputs, release and reversal agree across render cadences`, () => {
    const events = [[0.013, { pitch: 0.45, roll: -0.35, yaw: 0.25, throttle: 0.5 }], [0.113, {}],
      [0.33, { pitch: -0.45, roll: 0.35, yaw: -0.25, throttle: -0.5 }], [0.48, {}],
      [0.6, { pitch: 0.08, roll: -0.06, yaw: 0.05, throttle: 0.04 }], [1.3, {}]];
    for (const response of [0.5, 1, 2]) {
      const reference = make(id); sequence(reference, events, 2, response);
      for (const cadence of [[0.1], [1 / 15], [1 / 30], [1 / 60], [0.011, 0.023, 0.083, 0.017, 0.13, 0.003]]) {
        const flight = make(id); sequence(flight, events, 2, response, cadence);
        assert.ok(flight.state.position.distanceTo(reference.state.position) < 0.01, `×${response}: position at ${cadence}`);
        assert.ok(flight.state.quaternion.angleTo(reference.state.quaternion) < 0.0001, `×${response}: attitude at ${cadence}`);
        assert.ok(Math.abs(flight.state.throttle - reference.state.throttle) < 1e-12);
        assert.equal(flight.state.crashed, false);
      }
    }
  });

  if (!type.flight.rotorcraft) test(`${id}: approach taps, deliberate flare and a controlled go-around`, () => {
    for (const response of [0.5, 1, 2]) {
      const baseline = approach(id); sequence(baseline, [], 1.6, response);
      const tapped = approach(id); sequence(tapped, [[0, { pitch: 1 }], [0.1, {}]], 1.6, response);
      assert.ok(tapped.state.verticalSpeed < 0, 'one tap does not turn an approach into a climb');
      assert.ok(tapped.state.verticalSpeed > baseline.state.verticalSpeed, 'a tap eases the descent');
      assert.ok(tapped.state.verticalSpeed - baseline.state.verticalSpeed < 1);
      const flare = approach(id), flareInput = new FlightInputs(0, { pitch: response });
      for (let frame = 0; frame < 3 * 60; frame++) {
        flareInput.set({ pitch: flare.state.pitch < 0.08 ? 1 : 0 }, frame / 60);
        advance(flare, flareInput, frame / 60, (frame + 1) / 60);
      }
      assert.ok(flare.state.verticalSpeed > 0, `×${response}: deliberate elevator can arrest descent`);
      assert.equal(flare.state.stalled, false);
      const go = approach(id), start = go.state.position.y, input = new FlightInputs(0, { pitch: response, throttle: response });
      for (let frame = 0; frame < 12 * 60; frame++) {
        input.set({ throttle: 1, pitch: go.state.pitch < 0.12 ? 0.6 : 0 }, frame / 60);
        advance(go, input, frame / 60, (frame + 1) / 60);
      }
      assert.ok(go.state.position.y > start + 10 && go.state.verticalSpeed > 0, 'power and a modest climb attitude produce a go-around');
      assert.equal(go.state.crashed, false); assert.equal(go.state.stalled, false);
      assert.equal(go.state.throttle, 1);
    }
  });
}

test('every throttle/collective retains full travel, precise reversal and engine/rotor inertia', () => {
  for (const [id, type] of Object.entries(FLEET)) for (const response of [0.5, 1, 2]) {
    const flight = make(id), initial = flight.state.throttle;
    sequence(flight, [[0, { throttle: 1 }], [0.15, {}], [0.3, { throttle: -1 }], [0.45, {}]], 0.6, response);
    assert.ok(Math.abs(flight.state.throttle - initial) < 1e-12, `${id}: equal lever taps cancel`);
    sequence(flight, [[0, { throttle: 1 }]], 10, response); assert.equal(flight.state.throttle, 1);
    assert.ok(flight.state.spool < 1, `${id}: power still lags the lever`);
    sequence(flight, [[0, { throttle: -1 }]], 10, response); assert.equal(flight.state.throttle, 0);
    const spool = flight.state.spool;
    flight.update(1 / 120);
    assert.equal(flight.state.throttle, 0); assert.ok(flight.state.spool < spool && flight.state.spool > 0);
    if (type.flight.rotorcraft) assert.ok(flight.state.rotorSpeed > 0, 'governed rotors retain spin-down inertia');
  }
});

for (const id of Object.keys(FLEET).filter(id => FLEET[id].flight.rotorcraft)) {
  test(`${id}: small held cyclic settles to a modest tilt and release levels without oscillation`, () => {
    for (const axis of ['pitch', 'roll']) {
      const flight = make(id);
      sequence(flight, [[0, { [axis]: 0.05 }]], 12);
      const tilt = flight.state[field[axis]];
      assert.ok(tilt > 0.005 && tilt < 0.03, `${axis}: ${tilt}`);
      sequence(flight, [], 8);
      assert.ok(Math.abs(flight.state[field[axis]]) < 1e-4);
      assert.equal(flight.state.autopilot, false, 'manual cyclic never captures position or altitude');
      assert.ok(flight.state.speed > 0.01, 'translation retains momentum after release');
    }
  });

  test(`${id}: hover assist handover preserves rate, attitude and lift continuity and settles`, () => {
    for (const mode of ['climb', 'descent', 'translation']) {
      const flight = make(id), s = flight.state, f = flight.type.flight;
      if (mode !== 'translation') s.throttle = s.spool = f.hoverCollective + (mode === 'climb' ? 0.14 : -0.1);
      sequence(flight, [[0, mode === 'translation' ? { pitch: -0.8, yaw: 0.08 } : {}]], 8);
      const target = s.position.clone(), quaternion = s.quaternion.clone(), throttle = s.throttle, spool = s.spool;
      flight.toggleAutopilot(); flight.update(1 / 120);
      assert.ok(Math.abs(s.throttle - throttle) <= 2 * f.throttleRate / 120 + 1e-12, 'assist collective is slew limited');
      assert.ok(Math.abs(s.spool - spool) < 0.001, 'lift does not snap');
      assert.ok(s.quaternion.angleTo(quaternion) < 0.02, 'attitude is continuous');
      let peakHeight = 0, lateError = 0;
      for (let i = 1; i < 65 * 120; i++) {
        flight.update(1 / 120);
        peakHeight = Math.max(peakHeight, Math.abs(s.position.y - target.y));
        if (i > 55 * 120) lateError = Math.max(lateError, s.position.distanceTo(target));
      }
      assert.ok(peakHeight < 4, `${mode}: ${peakHeight} m vertical capture overshoot`);
      assert.ok(lateError < 0.01, `${mode}: settled hover error ${lateError}`);
      assert.ok(s.speed < 0.001); assert.equal(s.crashed, false);
      // A pilot takes over the current lever and attitude rather than restoring an old manual value.
      const before = { throttle: s.throttle, q: s.quaternion.clone() };
      flight.update(1 / 120, { pitch: 0.02, throttle: 0.02 });
      assert.equal(s.autopilot, false);
      assert.ok(Math.abs(s.throttle - before.throttle - 0.02 * f.throttleRate / 120) < 1e-12);
      assert.ok(s.quaternion.angleTo(before.q) < 0.001);
    }
  });
}

for (const id of Object.keys(FLEET).filter(id => FLEET[id].flight.aerobatic)) {
  test(`${id}: rate damping preserves manual vertical/inverted flight and continuous loops/rolls`, () => {
    for (const axis of ['pitch', 'roll']) {
      const flight = make(id); flight.state.position.y = 6000;
      const input = new FlightInputs(); input.set({ [axis]: 1, throttle: 1 }, 0);
      let rotation = 0, maxStep = 0, minUp = 1, maxPitch = 0;
      advance(flight, input, 0, 20, undefined, dt => {
        rotation += flight.state.bodyRates[axis] * dt;
        minUp = Math.min(minUp, new Vector3(0, 1, 0).applyQuaternion(flight.state.quaternion).y);
        maxPitch = Math.max(maxPitch, Math.abs(flight.state.pitch));
        maxStep = Math.max(maxStep, Math.hypot(...Object.values(flight.state.bodyRates)) * dt);
      });
      assert.ok(rotation > 4 * Math.PI && minUp < -0.95, `${axis}: repeated complete rotations`);
      if (axis === 'pitch') assert.ok(maxPitch > 1.5, 'passes vertical');
      assert.ok(maxStep < 0.04 && Math.abs(flight.state.quaternion.length() - 1) < 1e-12);
      assert.equal(flight.state.crashed, false); assert.equal(flight.state.stalled, false);
    }
    for (const [pitch, bank] of [[0, Math.PI], [1.1, 0]]) {
      const flight = make(id); Object.assign(flight.state, { pitch, bank, throttle: 1, spool: 1 }); flight.setQuaternion();
      const up = new Vector3(0, 1, 0).applyQuaternion(flight.state.quaternion);
      sequence(flight, [], 1);
      assert.ok(new Vector3(0, 1, 0).applyQuaternion(flight.state.quaternion).dot(up) > 0.999);
      assert.equal(flight.state.autopilot, false);
      assert.ok(flight.state.quaternion.angleTo(new Quaternion()) > 1, 'manual flight never auto-levels');
    }
  });
}

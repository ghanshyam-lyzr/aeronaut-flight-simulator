import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightInputs, TRAVEL } from '../src/controls.js';
import { FlightController } from '../src/flight.js';

const axes = ['pitch', 'roll', 'yaw', 'throttle'];
const rates = [10, 15, 30, 60, 120];
const degrees = radians => radians * 180 / Math.PI;

function approach(id, pitch = -0.035) {
  const flight = new FlightController(() => 0, id);
  const speed = id === 'jet' ? 60 : 68, throttle = id === 'jet' ? 0.45 : 0.26;
  Object.assign(flight.state, { speed, pitch, gearDown: true, flaps: 2, throttle, spool: throttle,
    verticalSpeed: Math.sin(pitch) * speed - Math.max(0, 0.32 - throttle) * 6 });
  flight.state.position.y = 500;
  flight.setQuaternion();
  return flight;
}

function run(flight, events, seconds, rate) {
  const input = new FlightInputs();
  for (const [time, values] of events) input.set(values, time);
  const released = [];
  for (let t = 0; t < seconds - 1e-9;) {
    t = Math.min(seconds, t + 1 / rate);
    input.advance(t, (dt, controls) => {
      if (input.time >= (events.at(-1)?.[0] ?? Infinity) + 1e-9) released.push(controls);
      flight.update(dt, controls);
    });
  }
  return { state: flight.state, input, released };
}

test('sub-frame taps are retained, with the same control impulse at 10–120 Hz', () => {
  for (const rate of rates) for (const axis of axes) for (const sign of [-1, 1]) {
    const input = new FlightInputs();
    // Both events fit between frames at 10 Hz, away from a frame boundary.
    input.set({ [axis]: sign }, 0.011);
    input.set({}, 0.041);
    let impulse = 0;
    for (let t = 1 / rate; t < 0.4; t += 1 / rate) {
      input.advance(t, (dt, controls) => { impulse += controls[axis] * dt; });
    }
    const expected = sign * 0.03 ** 2 / (2 * (axis === 'throttle' ? 0.35 : 0.65));
    assert.ok(Math.abs(impulse - expected) < 1e-12, `${axis} at ${rate} Hz: ${impulse}`);
  }
});

test('release, easing back, opposition and reversal do not keep the old command', () => {
  for (const axis of axes) {
    const input = new FlightInputs();
    input.set({ [axis]: 1 }, 0);
    for (let t = 0.1; t < 1; t += 0.1) input.advance(t, () => {});
    assert.ok(input.value[axis] > 0.99);
    input.set({ [axis]: 0.1 }, 0.9);
    input.advance(0.91, (_dt, controls) => assert.ok(controls[axis] <= 0.1 + 1e-12));
    input.set({ [axis]: -1 }, 0.91);
    input.advance(0.92, (_dt, controls) => assert.ok(controls[axis] < 0 && controls[axis] > -0.03));
    input.set({}, 0.92); // Equal opposing inputs are also neutral.
    input.advance(0.93, (_dt, controls) => assert.equal(controls[axis], 0));
    input.set({ [axis]: 1 }, 0.93);
    input.advance(0.94, (_dt, controls) => assert.ok(controls[axis] > 0 && controls[axis] < 0.03));
  }
});

for (const id of ['jet', 'fighter']) {
  test(`${id}: brief approach corrections stay small in both directions at 10–120 Hz`, () => {
    for (const rate of rates) for (const axis of axes) for (const sign of [-1, 1]) {
      const flight = approach(id, -sign * 0.035), neutral = approach(id, -sign * 0.035);
      const startThrottle = flight.state.throttle;
      const { state: s, released } = run(flight, [[0.013, { [axis]: sign }], [0.113, {}]], 1.613, rate);
      const { state: b } = run(neutral, [], 1.613, rate);
      assert.equal(s.stalled, false);
      assert.equal(s.crashed, false);
      assert.ok(released.length > 0 && released.every(c => axes.every(a => c[a] === 0)), 'released commands are neutral');
      if (axis === 'pitch') {
        const correction = degrees(s.pitch - b.pitch) * sign;
        assert.ok(correction > 0.08 && correction < 0.4, `pitch correction ${correction}° at ${rate} Hz`);
        assert.equal(Math.sign(s.verticalSpeed), -sign, 'one tap does not reverse the approach/climb');
        assert.ok(Math.abs(s.verticalSpeed - b.verticalSpeed) < 0.5);
        assert.ok(Math.abs(flight.pitchRate) < 0.0001, 'angular rate settles after release');
      }
      if (axis === 'roll') {
        const correction = degrees(s.bank - b.bank) * sign;
        assert.ok(correction > 0.25 && correction < 1.5, `bank correction ${correction}°`);
      }
      if (axis === 'yaw') {
        const correction = degrees(Math.atan2(Math.sin(s.heading - b.heading), Math.cos(s.heading - b.heading))) * sign;
        assert.ok(correction > 0.07 && correction < 0.17, `rudder heading correction ${correction}°`);
      }
      if (axis === 'throttle') {
        const correction = (s.throttle - startThrottle) * sign;
        assert.ok(correction > 0.002 && correction < 0.0051, `throttle correction ${correction}`);
      }
    }
  });

  test(`${id}: repeated taps remain fine; holding still produces a flare and full throttle travel`, () => {
    const tap = axis => [[0, { [axis]: 1 }], [0.1, {}]];
    for (const axis of axes) {
      const single = run(approach(id), tap(axis), 2, 60).state;
      const repeated = run(approach(id), [...tap(axis), [0.3, { [axis]: 1 }], [0.4, {}], [0.6, { [axis]: 1 }], [0.7, {}]], 2, 60).state;
      const held = run(approach(id), [[0, { [axis]: 1 }]], 1, 60).state;
      const baseline = run(approach(id), [], 2, 60).state;
      const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis];
      const delta = s => Math.abs(s[field] - baseline[field]);
      assert.ok(delta(repeated) > delta(single) * 2.5 && delta(repeated) < delta(single) * 3.5, axis);
      assert.ok(delta(held) > delta(repeated) * 2, `${axis}: holding has useful authority`);
    }
    const flare = run(approach(id), [[0, { pitch: 1 }], [0.6, {}]], 1.5, 60).state;
    assert.ok(flare.verticalSpeed > 0, 'a deliberate pull can arrest the descent');
    const power = approach(id);
    run(power, [[0, { throttle: 1 }]], 7, 15);
    assert.equal(power.state.throttle, 1);
    run(power, [[0, { throttle: -1 }]], 7, 15);
    assert.equal(power.state.throttle, 0);
  });
}

test('low and ordinary frame rates produce the same approach response', () => {
  for (const id of ['jet', 'fighter']) for (const axis of axes) {
    const events = [[0.013, { [axis]: 1 }], [0.113, {}], [0.33, { [axis]: -1 }], [0.43, {}]];
    const reference = run(approach(id), events, 2, 120).state;
    for (const rate of rates) {
      const s = run(approach(id), events, 2, rate).state;
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 0.0001, `${id} ${axis} at ${rate} Hz`);
      assert.ok(Math.abs(s.verticalSpeed - reference.verticalSpeed) < 0.001);
      assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12);
    }
  }
});

test('reset cancels queued inputs and ramp state when pausing or changing aircraft', () => {
  const input = new FlightInputs();
  input.set({ pitch: 1, roll: 1, yaw: -1, throttle: 1 }, 0);
  input.advance(0.2, () => {});
  input.set({ pitch: -1 }, 0.3);
  input.reset(1);
  input.advance(1.1, (_dt, controls) => assert.ok(axes.every(a => controls[a] === 0)));
});

test('a long rendering gap keeps the flight safety cap and discards expired taps', () => {
  const input = new FlightInputs();
  input.set({ pitch: 1, throttle: 1 }, 0.01);
  input.set({}, 0.11);
  let elapsed = 0;
  input.advance(5, (dt, controls) => {
    elapsed += dt;
    assert.ok(axes.every(axis => controls[axis] === 0), 'no stale input is replayed on return');
  });
  assert.ok(Math.abs(elapsed - 0.25) < 1e-12);
});

test('held shaped controls retain the fighter’s repeated loops and rolls', () => {
  for (const axis of ['pitch', 'roll']) {
    const flight = new FlightController(() => 0, 'fighter');
    flight.state.position.y = 6000;
    const input = new FlightInputs();
    input.set({ [axis]: 1, throttle: 1 }, 0);
    let turned = 0;
    for (let t = 1 / 60; t < 20; t += 1 / 60) input.advance(t, (dt, controls) => {
      flight.update(dt, controls);
      turned += flight.state.bodyRates[axis] * dt;
    });
    assert.ok(turned > Math.PI * 4, `${axis}: ${turned} rad`);
    assert.equal(flight.state.crashed, false);
  }
});

// Control response (src/settings.js): travel time divided by 0.5–2; held inputs still reach full deflection.
const responses = [0.5, 0.75, 1, 1.5, 2];

test('control response scales a sub-frame tap identically at 10–120 Hz', () => {
  for (const response of responses) for (const rate of rates) for (const axis of axes) {
    const input = new FlightInputs(0, { [axis]: response });
    input.set({ [axis]: 1 }, 0.011);
    input.set({}, 0.041);
    let impulse = 0, other = 0;
    for (let t = 1 / rate; t < 0.4; t += 1 / rate) {
      input.advance(t, (dt, controls) => { impulse += controls[axis] * dt; for (const a of axes) if (a !== axis) other += Math.abs(controls[a]); });
    }
    assert.ok(Math.abs(impulse - 0.03 ** 2 * response / (2 * TRAVEL[axis])) < 1e-12, `${axis} ×${response} at ${rate} Hz: ${impulse}`);
    assert.equal(other, 0, 'one axis response never moves another axis');
  }
});

test('every response holds to full deflection, and release and reversal stay immediate', () => {
  for (const response of responses) for (const rate of rates) for (const axis of axes) {
    const input = new FlightInputs(0, { [axis]: response });
    input.set({ [axis]: 1 }, 0);
    const fullAt = TRAVEL[axis] / response;
    let last = 0;
    for (let t = 1 / rate; t <= fullAt + 0.2; t += 1 / rate) input.advance(t, (_dt, c) => { last = c[axis]; });
    assert.equal(input.value[axis], 1, `${axis} ×${response} at ${rate} Hz reaches full travel`);
    assert.equal(last, 1, 'held input keeps full authority');
    const at = input.time;
    input.set({}, at);
    input.advance(at + 1 / rate, (_dt, c) => assert.equal(c[axis], 0, 'release is immediate'));
    input.set({ [axis]: -1 }, at + 1 / rate);
    input.advance(at + 2 / rate, (_dt, c) => assert.ok(c[axis] < 0, 'reversal acts at once'));
    assert.ok(Math.abs(input.value[axis] + Math.min(1, 1 / rate / fullAt)) < 1e-9, 'reversal ramps from neutral, not from the old deflection');
  }
});

test('default response is the original ramp; out-of-range values are bounded', () => {
  const ramp = response => {
    const input = new FlightInputs(0, response);
    input.set({ pitch: 1, roll: 1, yaw: 1, throttle: 1 }, 0);
    input.advance(0.1, () => {});
    return { ...input.value };
  };
  const original = ramp();
  for (const axis of axes) assert.ok(Math.abs(original[axis] - 0.1 / TRAVEL[axis]) < 1e-12);
  assert.deepEqual(ramp({ pitch: 1, roll: 1, yaw: 1, throttle: 1 }), original);
  assert.deepEqual(ramp({ pitch: 'x', roll: NaN, yaw: undefined, throttle: null }), original, 'invalid values mean the default');
  assert.ok(Math.abs(ramp({ pitch: 0 }).pitch - 0.05 / TRAVEL.pitch) < 1e-12, 'zero is clamped to the 50% minimum');
  const extreme = ramp({ pitch: 50, roll: 0.01, yaw: -3, throttle: Infinity });
  assert.ok(Math.abs(extreme.pitch - 0.2 / TRAVEL.pitch) < 1e-12, 'capped at 200%');
  assert.ok(Math.abs(extreme.roll - 0.05 / TRAVEL.roll) < 1e-12, 'floored at 50%');
  assert.ok(Math.abs(extreme.yaw - 0.05 / TRAVEL.yaw) < 1e-12);
  assert.ok(Math.abs(extreme.throttle - original.throttle) < 1e-12, 'non-finite means the default');
});

test('changing response mid-hold continues from the current deflection without a jump', () => {
  for (const rate of rates) {
    const input = new FlightInputs(0);
    input.set({ roll: 1 }, 0);
    let t = 0;
    while (t < 0.2) { t += 1 / rate; input.advance(t, () => {}); }
    const before = input.value.roll;
    input.setResponse({ roll: 2 });
    input.advance(t + 1 / rate, (_dt, c) => assert.ok(c.roll >= before && c.roll <= 1));
    assert.ok(input.value.roll > before);
  }
});

test('a faster response still keeps one brief approach tap a small correction', () => {
  for (const id of ['jet', 'fighter']) for (const rate of rates) {
    const fast = run(approach(id), [[0.013, { pitch: 1 }], [0.113, {}]], 1.613, rate);
    const tapped = new FlightInputs(0, { pitch: 2 });
    tapped.set({ pitch: 1 }, 0.013); tapped.set({}, 0.113);
    const flight = approach(id), baseline = approach(id);
    for (let t = 0; t < 1.613 - 1e-9;) { t = Math.min(1.613, t + 1 / rate); tapped.advance(t, (dt, c) => flight.update(dt, c)); }
    run(baseline, [], 1.613, rate);
    const correction = degrees(flight.state.pitch - baseline.state.pitch), single = degrees(fast.state.pitch - baseline.state.pitch);
    assert.ok(correction > single * 1.5 && correction < 1, `${id} at ${rate} Hz: ${correction}° vs ${single}°`);
    assert.equal(flight.state.stalled, false);
  }
});

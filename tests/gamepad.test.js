import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadControls, gamepadAxis, DEFAULT_DEAD_ZONE } from '../src/gamepad.js';
import { FlightInputs, mergeFlightControls, manualFlightIntent } from '../src/controls.js';
import { FlightController } from '../src/flight.js';
import { defaultSettings, normalizeSettings, resetSettings } from '../src/settings.js';
import { RunRecorder } from '../src/run-recorder.js';
import { makeBoard, RUN_LIMITS } from '../src/ranked-rules.js';

const zero = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
const neutral = { ...zero, brake: 0, trim: 0 };
const pad = (index = 0) => ({ connected: true, mapping: 'standard', id: `Simulated controller ${index}`, index,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
function setup() {
  const device = pad();
  let devices = [device];
  const gamepad = new GamepadControls(() => devices);
  const poll = options => gamepad.poll({ enabled: true, ...options });
  const connect = values => { devices = values; };
  poll(); // Neutral arming sample after opt-in / connection.
  return { device, gamepad, poll, connect };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('simulated analog samples have a bounded dead zone, smooth scaled travel and full authority', () => {
  for (const zone of [0.05, DEFAULT_DEAD_ZONE, 0.35]) {
    for (const value of [0, -zone, zone, -zone / 2, zone / 2]) assert.equal(gamepadAxis(value, zone), 0);
    near(gamepadAxis(zone + (1 - zone) / 2, zone), 0.5);
    near(gamepadAxis(-zone - (1 - zone) / 2, zone), -0.5);
    assert.ok(gamepadAxis(zone + 1e-7, zone) < 0.00001);
    for (const value of [-9, -1, 1, 9]) assert.equal(gamepadAxis(value, zone), Math.sign(value));
  }
  for (const invalid of [undefined, null, '1', NaN, Infinity, -Infinity]) assert.equal(gamepadAxis(invalid), 0);
  near(gamepadAxis(0.5, -1), gamepadAxis(0.5, 0.05));
  near(gamepadAxis(0.5, 1), gamepadAxis(0.5, 0.35));
  near(gamepadAxis(0.5, NaN), gamepadAxis(0.5, DEFAULT_DEAD_ZONE));
});

test('standard axes preserve directions and independent proportional power rate commands', () => {
  const { device, poll } = setup();
  device.axes = [1, -1, 0.575, -0.575];
  const frame = poll();
  assert.equal(frame.status, 'ready');
  assert.equal(frame.inputs.roll, 1); assert.equal(frame.inputs.pitch, -1);
  near(frame.inputs.yaw, 0.5); near(frame.inputs.throttle, 0.5);
  device.axes = [-1, 1, -1, 1];
  assert.deepEqual(poll().inputs, { pitch: 1, roll: -1, yaw: -1, throttle: -1 });
});

test('enable, reconnect, suspension and explicit release all require a fresh neutral sample', () => {
  for (const interrupt of ['disabled', 'suspended', 'disconnect', 'release']) {
    const { device, gamepad, poll, connect } = setup();
    device.axes = [1, 1, -1, -1];
    assert.equal(poll().inputs.throttle, 1);
    if (interrupt === 'release') gamepad.release();
    else if (interrupt === 'disconnect') { connect([]); assert.deepEqual(poll().inputs, zero); connect([device]); }
    else assert.deepEqual(poll(interrupt === 'disabled' ? { enabled: false } : { suspended: true }).inputs, zero);
    assert.deepEqual(poll().inputs, zero, `${interrupt}: held controls remain released`);
    device.axes.fill(0);
    assert.equal(poll().status, 'ready');
    device.axes[0] = -1;
    assert.equal(poll().inputs.roll, -1, `${interrupt}: deliberate input works again`);
  }
});

test('held Pause is edge-triggered, never activates on connection or after an interruption', () => {
  const { device, gamepad, poll } = setup();
  device.buttons[9] = { pressed: true, value: 1 };
  assert.equal(poll().pause, true);
  for (let i = 0; i < 10; i++) {
    const frame = poll({ paused: true });
    assert.equal(frame.pause, false); assert.deepEqual(frame.inputs, zero);
  }
  device.buttons[9] = { pressed: false, value: 0 };
  assert.equal(poll({ paused: true }).pause, false);
  device.buttons[9].pressed = true;
  assert.equal(poll({ paused: true }).pause, true, 'a fresh press resumes');
  gamepad.release(); // The UI clears inputs on pause, blur, visibility and dialog entry.
  assert.equal(poll().pause, false, 'a held Pause cannot immediately undo pause or an interruption');
  device.buttons[9].pressed = false;
  poll(); device.buttons[9].pressed = true;
  assert.equal(poll().pause, true);
  const fresh = new GamepadControls(() => [device]);
  assert.equal(fresh.poll({ enabled: true }).pause, false, 'connecting with Pause held has no action');
});

test('resuming while a stick is held cannot restore an old flight command', () => {
  const { device, poll } = setup();
  device.axes[3] = -1;
  assert.equal(poll().inputs.throttle, 1);
  assert.deepEqual(poll({ paused: true }).inputs, zero);
  assert.deepEqual(poll().inputs, zero);
  device.axes.fill(0); poll();
  device.axes[3] = 1;
  assert.equal(poll().inputs.throttle, -1);
});

test('absent, disconnected, unsupported and permission-blocked API states are honest and neutral', () => {
  for (const [read, status] of [
    [() => undefined, 'unavailable'], [() => { throw new Error('SecurityError'); }, 'blocked'],
    [() => [null, { ...pad(), connected: false }], 'disconnected'],
    [() => [{ ...pad(), mapping: '' }], 'unsupported'],
    [() => [{ ...pad(), axes: [0, 0] }], 'unsupported'],
  ]) {
    const frame = new GamepadControls(read).poll({ enabled: true });
    assert.equal(frame.status, status); assert.deepEqual(frame.inputs, zero); assert.equal(frame.pause, false);
  }
  const { poll, connect } = setup();
  connect([]); assert.equal(poll().status, 'disconnected');
  connect([{ ...pad(), mapping: '' }]); assert.equal(poll().status, 'unsupported');
});

test('one controller stays selected; a replacement cannot inherit held inputs or pause', () => {
  const { device, poll, connect } = setup(), replacement = pad(2);
  replacement.axes[0] = 1; replacement.buttons[9].pressed = true;
  device.axes[0] = -1;
  connect([null, replacement, device]);
  assert.equal(poll().device.index, 0); assert.equal(poll().inputs.roll, -1);
  connect([null, replacement]);
  assert.equal(poll().device.index, 2); assert.deepEqual(poll().inputs, zero); assert.equal(poll().pause, false);
  replacement.axes.fill(0); replacement.buttons[9].pressed = false; poll();
  replacement.axes[0] = 1; assert.equal(poll().inputs.roll, 1);
});

test('keyboard, touch and mouse own held axes including opposing keys and a centered touch yoke', () => {
  const controller = { pitch: 0.8, roll: -1, yaw: 0.3, throttle: 1 };
  const manual = { pitch: -1, roll: 1, yaw: -1, throttle: -1, brake: 1, trim: 0.5 };
  for (const axis of Object.keys(zero)) {
    const merged = mergeFlightControls(manual, controller, { [axis]: true });
    assert.equal(merged[axis], manual[axis]);
    for (const other of Object.keys(zero).filter(k => k !== axis)) assert.equal(merged[other], controller[other]);
    assert.equal(merged.brake, 1); assert.equal(merged.trim, 0.5);
    assert.equal(mergeFlightControls(neutral, controller, { [axis]: true })[axis], 0, 'held neutral still has priority');
  }
  assert.deepEqual(mergeFlightControls(manual, zero, { pitch: true, roll: true, yaw: true, throttle: true }), manual);
  assert.deepEqual(mergeFlightControls(neutral, controller, { pitch: true, roll: true }), { ...controller, pitch: 0, roll: 0, brake: 0, trim: 0 });
});

test('keyboard responsiveness and timestamped taps are unchanged while gamepad is disabled', () => {
  const a = new FlightInputs(), b = new FlightInputs();
  for (const [at, manual] of [[0.011, { ...neutral, pitch: 1, throttle: 1 }], [0.041, neutral]]) {
    a.set(manual, at);
    b.set(mergeFlightControls(manual, zero, { pitch: true, throttle: true }), at);
  }
  const slicesA = [], slicesB = [];
  a.advance(0.1, (dt, c) => slicesA.push([dt, c])); b.advance(0.1, (dt, c) => slicesB.push([dt, c]));
  assert.deepEqual(slicesB, slicesA);
});

test('neutral sticks leave power and assist unchanged; analog input shares the existing response ramp', () => {
  for (const id of ['trainer', 'helicopter']) {
    const { device, poll } = setup(), flight = new FlightController(() => 0, id, { engine: 'javascript' });
    flight.state.autopilot = false;
    const initialPower = flight.state.throttle, inputs = new FlightInputs();
    device.axes = [0.04, -0.12, 0.08, -0.14];
    for (let i = 1; i <= 120; i++) {
      const command = mergeFlightControls(neutral, poll().inputs);
      assert.equal(manualFlightIntent(command, id === 'helicopter'), false);
      inputs.set(command, (i - 1) / 120);
      inputs.advance(i / 120, (dt, c) => flight.update(dt, c));
    }
    assert.equal(flight.state.throttle, initialPower, `${id}: no neutral power drift`);
    device.axes[3] = -0.575;
    const command = mergeFlightControls(neutral, poll().inputs);
    near(command.throttle, 0.5);
    assert.equal(manualFlightIntent(command), false, 'fixed-wing throttle alone retains assist');
    assert.equal(manualFlightIntent(command, true), true, 'collective retains existing manual hover takeover');
    inputs.set(command, 1); inputs.advance(1.1, (dt, c) => flight.update(dt, c));
    assert.ok(flight.state.throttle > initialPower);
    assert.ok(inputs.value.throttle > 0 && inputs.value.throttle < 0.5, 'uses the existing gradual throttle response');
    device.axes.fill(0); inputs.set(mergeFlightControls(neutral, poll().inputs), 1.1);
    inputs.advance(1.2, (_dt, c) => assert.equal(c.throttle, 0));
    device.axes[0] = 1;
    assert.equal(manualFlightIntent(mergeFlightControls(neutral, poll().inputs)), true);
  }
});

test('gamepad settings are opt-in, validate their bounds, and restore with customization defaults', () => {
  assert.equal(defaultSettings().gamepadEnabled, false);
  assert.equal(defaultSettings().gamepadDeadZone, 0.15);
  assert.equal(normalizeSettings({ gamepadEnabled: 'yes', gamepadDeadZone: NaN }).gamepadEnabled, false);
  for (const [raw, expected] of [[-1, 0.05], [9, 0.35], ['0.226', 0.23], [Infinity, 0.15]]) {
    assert.equal(normalizeSettings({ gamepadDeadZone: raw }).gamepadDeadZone, expected);
  }
  const reset = resetSettings({ gamepadEnabled: true, gamepadDeadZone: 0.3, aircraft: 'helicopter' });
  assert.equal(reset.gamepadEnabled, false); assert.equal(reset.gamepadDeadZone, 0.15); assert.equal(reset.aircraft, 'helicopter');
});

test('actual response-adjusted gamepad slices feed the ranked recorder without changing eligibility rules', () => {
  const now = 1800000000000;
  const attempt = { id: 'gamepad_simulation', board: makeBoard({ activity: 'course', aircraft: 'trainer' }),
    status: 'open', issuedAt: now, expiresAt: now + RUN_LIMITS.attemptLifetimeMs };
  const recorder = new RunRecorder(attempt, { now }), inputs = new FlightInputs(), { device, poll } = setup();
  const slices = [];
  device.axes = [0.3, -0.2, 0.2, -0.5];
  inputs.set(mergeFlightControls(neutral, poll().inputs), 0);
  inputs.advance(0.1, (dt, actual) => { slices.push({ ...actual }); recorder.step(dt, actual); });
  assert.equal(recorder.state, 'recording'); assert.equal(recorder.slices, slices.length);
  assert.ok(slices.every(c => Object.values(c).every(Number.isFinite)));
  assert.ok(slices[0].roll > 0 && slices.at(-1).roll > slices[0].roll, 'records shaped analog output');
  const { s } = recorder.simulation;
  assert.equal(s.autopilot, false);
  s.autopilot = true;
  assert.throws(() => recorder.observe(), e => e.code === 'INELIGIBLE_RUN', 'assist remains ineligible');
  assert.equal(recorder.reason, 'ASSIST_USED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AltitudeReminder, FEET_PER_METRE as FT, normalizeAltitudeTarget, altitudeReminderNotice } from '../src/altitude-reminder.js';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';

// Synthetic MSL samples test the pure monitor's exact thresholds, not aircraft performance.
const sample = (feet = 4000, time = 0, extra = {}) => ({ aircraft: 'trainer', position: { x: 0, y: feet / FT, z: 0 }, flightTime: time, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ~ ${expected}`);

test('finite whole-foot targets are bounded, invalid values leave an armed selection alone', () => {
  for (const [v, want] of [[0, 0], [60000, 60000], [' 4500 ', 4500], [1234.5, 1235]]) assert.equal(normalizeAltitudeTarget(v), want);
  for (const v of ['', ' ', null, undefined, true, false, {}, [], [42], '2,000', '123ft', NaN, Infinity, -1, 60001]) assert.equal(normalizeAltitudeTarget(v), null);
  const m = new AltitudeReminder(); m.select(5000, sample());
  for (const v of ['oops', '', null, -1]) { assert.equal(m.select(v, sample()), null); assert.equal(m.target, 5000); assert.equal(m.phase, 'approach'); }
});

test('climbing and descending approach crossings alert once, then capture the target band', () => {
  for (const sign of [-1, 1]) {
    const m = new AltitudeReminder(), at = (d, t) => sample(5000 + sign * d, t);
    m.select(5000, at(1400, 0));
    assert.equal(m.update(at(1100, 1)).alert, '');
    assert.equal(m.update(at(1000, 2)).alert, 'approach');
    assert.equal(m.update(at(1150, 3)).alert, 'approach', 'approach exit hysteresis');
    assert.equal(m.update(at(1250, 4)).alert, '');
    m.update(at(900, 5)); assert.equal(m.events, 1, 'no repeated approach on re-entry');
    assert.equal(m.update(at(99, 6)).phase, 'deviation');
    assert.equal(m.alert, ''); assert.equal(m.events, 1);
  }
});

test('first movement inside 1000 feet can approach; moving away or level cannot', () => {
  for (const sign of [-1, 1]) {
    const m = new AltitudeReminder(); m.select(5000, sample(5000 + sign * 600));
    m.update(sample(5000 + sign * 600, 1)); assert.equal(m.alert, '');
    m.update(sample(5000 + sign * 700, 2)); assert.equal(m.alert, '');
    m.update(sample(5000 + sign * 650, 3)); assert.equal(m.alert, 'approach');
  }
});

test('one sample can cross the full capture band in either direction without missing capture', () => {
  for (const sign of [-1, 1]) {
    const m = new AltitudeReminder(); m.select(5000, sample(5000 - sign * 300));
    assert.equal(m.update(sample(5000 + sign * 300, 1)).phase, 'deviation');
    assert.equal(m.alert, '');
    m.update(sample(5000 + sign * 400, 2)); m.update(sample(5000 + sign * 500, 3.01));
    assert.equal(m.alert, 'deviation');
  }
});

test('deviation needs a continuous flight second beyond 200 feet and clears at 150', () => {
  for (const sign of [-1, 1]) {
    const m = new AltitudeReminder(), at = (d, t) => sample(5000 + sign * d, t); m.select(5000, at(0, 0));
    assert.equal(m.phase, 'deviation'); m.update(at(201, 1));
    m.update(at(201, 1.99)); assert.equal(m.alert, '');
    m.update(at(175, 2)); assert.equal(m.outsideSince, null, 'a short spike cannot accumulate dwell');
    m.update(at(201, 3)); m.update(at(201, 4.01)); assert.equal(m.alert, 'deviation');
    m.update(at(175, 5)); assert.equal(m.alert, 'deviation', 'exit hysteresis');
    m.update(at(149, 6)); assert.equal(m.alert, '');
    m.update(at(220, 7)); m.update(at(220, 9)); assert.equal(m.events, 1, 'must return to capture band before another excursion');
    m.update(at(99, 10)); m.update(at(220, 11)); m.update(at(220, 12.01)); assert.equal(m.events, 2);
  }
});

test('acknowledgment quiets approach, still permits deviation, and quiets the whole acknowledged excursion', () => {
  const m = new AltitudeReminder(); m.select(5000, sample(3800)); m.update(sample(4100, 1));
  assert.ok(m.acknowledge()); assert.equal(m.alert, ''); assert.equal(m.acknowledged, 'approach');
  m.update(sample(4500, 2)); assert.equal(m.alert, ''); m.update(sample(5000, 3));
  m.update(sample(5300, 4)); m.update(sample(5300, 5.01)); assert.equal(m.alert, 'deviation');
  m.acknowledge(); m.update(sample(5400, 20)); m.update(sample(4800, 21)); m.update(sample(4700, 23));
  assert.equal(m.events, 2); assert.equal(m.alert, ''); assert.equal(m.acknowledged, 'deviation');
  m.update(sample(5000, 24)); m.update(sample(4700, 25)); m.update(sample(4700, 26.01)); assert.equal(m.events, 3);
});

test('new target, rearm and disarm have explicit repeatable lifecycles', () => {
  const m = new AltitudeReminder(); m.select(5000, sample(4000)); m.update(sample(4100, 1)); m.acknowledge();
  m.select(6000, sample(4100, 1)); assert.equal(m.acknowledged, ''); assert.equal(m.approachSeen, false);
  m.disarm(); m.update(sample(6000, 2)); assert.equal(m.phase, 'off'); assert.equal(m.target, 6000);
  assert.ok(m.arm(sample(6000, 2))); assert.equal(m.phase, 'deviation');
  m.reset(); assert.equal(m.target, null); assert.equal(m.arm(sample()), false); assert.equal(m.events, 0);
});

test('unchanged flight time, pause/dialog/hidden suspension neither advances dwell nor replays approach', () => {
  const m = new AltitudeReminder(); m.select(5000, sample(5000)); m.update(sample(5300, 1));
  for (let i = 0; i < 20; i++) m.update(sample(5300, 1)); assert.equal(m.alert, '');
  m.update(sample(5300, 1), { suspended: true }); assert.equal(m.outsideSince, null);
  m.update(sample(5300, 1.1)); m.update(sample(5300, 2)); assert.equal(m.alert, '');
  m.update(sample(5300, 2.11)); assert.equal(m.alert, 'deviation');
  assert.ok(altitudeReminderNotice(m.snapshot()).includes('5,000 ft MSL'));
  m.update(sample(5300, 2.11), { suspended: true }); assert.equal(altitudeReminderNotice(m.snapshot()), '');
  m.select(7000, sample(5000, 3)); m.update(sample(7500, 4), { suspended: true });
  m.update(sample(7500, 4)); assert.equal(m.phase, 'approach'); assert.equal(m.alert, '', 'no replayed suspended crossing');
});

test('MSL, not AGL or a stale vertical-speed estimate, drives the reminder', () => {
  const m = new AltitudeReminder(); m.select(5000, sample(4000));
  m.update(sample(4200, 1, { agl: 1, verticalSpeed: -200, velocity: { y: -200 } }));
  near(m.snapshot().error, 800); assert.equal(m.alert, 'approach');
});

test('ground/crash/results suppress alerts; ground cannot capture, crash/results disarm', () => {
  for (const mode of ['grounded', 'crashed', 'finished']) {
    const m = new AltitudeReminder(); m.select(5000, sample(5000)); m.update(sample(5300, 1)); m.update(sample(5300, 2.01));
    const v = m.update(sample(5000, 3, { [mode]: true }), { finished: mode === 'finished' });
    assert.equal(v.alert, ''); assert.equal(v.suppressed, mode); assert.equal(altitudeReminderNotice(v), '');
    assert.equal(v.phase, mode === 'grounded' ? 'approach' : 'off');
  }
  const m = new AltitudeReminder(); m.select(5000, sample(5000, 0, { grounded: true }));
  assert.equal(m.phase, 'approach'); m.update(sample(5000, 1, { grounded: true })); assert.equal(m.phase, 'approach');
});

test('rewound flight time, aircraft change and explicit activity reset forget targets and all latches', () => {
  for (const change of [sample(5000, 0), sample(5000, 3, { aircraft: 'jet' })]) {
    const m = new AltitudeReminder(); m.select(5000, sample(4000, 1)); m.update(sample(4200, 2));
    assert.equal(m.alert, 'approach'); m.update(change); assert.equal(m.target, null); assert.equal(m.events, 0);
  }
  const m = new AltitudeReminder(); m.select(5000, sample()); m.reset();
  assert.equal(m.target, null, 'same-time transitions explicitly call reset even when no clock rewind is visible');
});

test('diagnostic snapshots cannot mutate the monitor', () => {
  const m = new AltitudeReminder(); m.select(5000, sample(4000)); m.update(sample(4100, 1));
  const v = m.snapshot(); v.target = 3; v.lastEvent.kind = 'oops';
  assert.equal(m.target, 5000); assert.equal(m.lastEvent.kind, 'approach');
});

test('all fleet types: choosing, arming, stepping, acknowledging and disarming cannot alter flight or held targets', () => {
  for (const id of Object.keys(FLEET)) for (const assisted of [false, true]) {
    const flight = new FlightController(() => 0, id), control = new FlightController(() => 0, id);
    flight.state.position.y = control.state.position.y = 2400;
    if (assisted) { flight.toggleAutopilot(); control.toggleAutopilot(); }
    if (assisted && !flight.type.flight.rotorcraft) { flight.setHeadingTarget(25); control.setHeadingTarget(25); }
    const m = new AltitudeReminder(), inputs = new FlightInputs(0), plainInputs = new FlightInputs(0);
    const command = assisted ? {} : { pitch: -.1, roll: .12, yaw: .03, throttle: .2 };
    inputs.set(command, 0); plainInputs.set(command, 0);
    for (let i = 1; i <= 600; i++) {
      if (i % 60 === 1) m.select(Math.round(flight.state.position.y * FT) + 500, flight.state);
      if (i % 60 === 20) m.acknowledge(); if (i % 60 === 30) m.disarm(); if (i % 60 === 40) m.arm(flight.state);
      inputs.advance(i / 60, (dt, c) => { flight.update(dt, c); m.update(flight.state); });
      plainInputs.advance(i / 60, (dt, c) => control.update(dt, c));
    }
    assert.deepEqual(flight.state, control.state, `${id} ${assisted ? 'assist/heading/hover hold' : 'manual'} is bit-identical`);
    assert.equal(flight.holdAltitude, control.holdAltitude); assert.equal(flight.holdHeading, control.holdHeading);
  }
});

test('real controller reset/start paths are detected by the monitor', () => {
  const f = new FlightController(() => 0, 'trainer'), m = new AltitudeReminder();
  for (const reset of [() => f.reset(), () => f.runwayStart(0, 2.8, 0, 0), () => new LandingMission().start(f), () => new CheckpointCourse().start(f), () => f.setAircraft('helicopter')]) {
    const input = new FlightInputs(0); input.advance(.1, (dt, c) => f.update(dt, c));
    m.select(5000, f.state); m.update(f.state); reset(); m.update(f.state);
    assert.equal(m.target, null);
  }
});

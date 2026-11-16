import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { stallSpeed, turnLoadDemand } from '../src/stall.js';
import { KNOTS, LOW_MARGIN, HYSTERESIS, AirspeedMonitor, airspeedEnvelope, tapeLayout } from '../src/airspeed-envelope.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { bankedTurn } from '../scripts/measure-banked-stall.js';
import { setup, flyApproach } from './crosswind-pilot.js';

const DEG = Math.PI / 180;
const CONVENTIONAL = Object.values(FLEET).filter(t => !t.flight.rotorcraft && !t.flight.aerobatic);
const FREE = Object.values(FLEET).filter(t => t.flight.aerobatic);
const ROTORCRAFT = Object.values(FLEET).filter(t => t.flight.rotorcraft);
const stages = t => t.noFlaps ? [0] : [0, 1, 2];

test('upright turn demand is symmetric, monotonic and bounded; wings-level and flap stages are preserved', () => {
  for (const type of CONVENTIONAL) for (const flaps of stages(type)) {
    const level = type.flight.stallSpeed - flaps * type.flight.flapStallGain;
    assert.equal(stallSpeed(type, flaps), level, `${type.id} legacy default`);
    assert.equal(stallSpeed(type, flaps, { bank: 0 }), level);
    let previous = level;
    for (let degrees = 0; degrees < 90; degrees += 0.25) {
      const bank = degrees * DEG, speed = stallSpeed(type, flaps, { bank });
      assert.ok(speed >= previous && speed <= level * Math.SQRT2 + 1e-12, `${type.id} ${degrees}° bound`);
      assert.equal(speed, stallSpeed(type, flaps, { bank: -bank }), 'left/right symmetry');
      previous = speed;
    }
    for (const [degrees, factor] of [[30, 1.0745699318], [45, 1.189207115], [60, Math.SQRT2], [75, Math.SQRT2], [89.999999, Math.SQRT2]]) {
      assert.ok(Math.abs(stallSpeed(type, flaps, { bank: degrees * DEG }) / level - factor) < 1e-9);
    }
  }
});

test('turn demand excludes ground, rotorcraft and all free attitudes, and is independent of measured G', () => {
  for (const type of Object.values(FLEET)) for (const bank of [-179, -90, -60, 0, 60, 90, 179]) {
    assert.equal(turnLoadDemand(type, { bank: bank * DEG, grounded: true }), 1, 'ground rolls');
    if (type.flight.rotorcraft || type.flight.aerobatic || Math.abs(bank) >= 90) {
      assert.equal(turnLoadDemand(type, { bank: bank * DEG }), 1, type.id);
    }
    for (const gForce of [-100, -1, 0, 2, 100]) {
      assert.equal(stallSpeed(type, 0, { bank: bank * DEG, gForce }), stallSpeed(type, 0, { bank: bank * DEG }));
    }
  }
  for (const type of ROTORCRAFT) assert.equal(stallSpeed(type), null);
  // Exclude the whole aerobatic regime, including an upright turn: no Euler-angle gate inside free flight.
  for (const type of FREE) for (const pitch of [-90, 0, 90]) for (const bank of [-180, -90, -60, 0, 60, 90, 180]) {
    const flight = new FlightController(() => 40, type.id), s = flight.state;
    Object.assign(s, { pitch: pitch * DEG, bank: bank * DEG, speed: type.flight.stallSpeed * 1.1 });
    s.position.y = 6000; flight.setQuaternion();
    flight.update(1 / 120);
    assert.equal(s.stalled, false, `${type.id} ${pitch}°/${bank}°`);
    assert.equal(stallSpeed(type, 0, s), type.flight.stallSpeed);
  }
});

test('controller entry, nose drop and sink use the shared threshold at every conventional flap stage', () => {
  for (const type of CONVENTIONAL) for (const flaps of stages(type)) for (const direction of [-1, 1]) {
    const below = new FlightController(() => 40, type.id), above = new FlightController(() => 40, type.id);
    for (const [flight, offset] of [[below, -0.3], [above, 0.3]]) {
      const s = flight.state, f = type.flight;
      s.position.y = 6000;
      s.flaps = flaps; s.bank = direction * Math.min(50 * DEG, f.bankLimit);
      s.speed = stallSpeed(type, flaps, s) + offset;
      s.throttle = s.spool = (s.speed - f.idleSpeed + flaps * f.flapDrag + (s.gearDown ? f.gearDrag : 0) + Math.abs(Math.sin(s.bank)) * f.bankDrag) / f.thrustSpeed;
      flight.setQuaternion(); flight.update(1 / 120);
      assert.equal(s.stalled, offset < 0, `${type.id} flaps ${flaps} ${direction}`);
      assert.equal(s.stalled, s.speed < stallSpeed(type, flaps, s), 'same threshold as display');
      assert.equal(airspeedEnvelope(type, flaps, s).stall, stallSpeed(type, flaps, s) * KNOTS);
    }
    assert.ok(below.state.pitch < above.state.pitch, 'stall drops the nose');
    assert.ok(below.state.verticalSpeed < above.state.verticalSpeed, 'less margin means more sink');
  }
});

test('ordinary ramped inputs can stall above level stall and recover across the conventional fleet and flap stages', () => {
  for (const type of CONVENTIONAL) for (const flaps of stages(type)) {
    const r = bankedTurn(type.id, { flaps });
    assert.ok(r.firstStall && r.firstStall.time > 35 && r.firstStall.time < 40, `${type.id} enters in the turn`);
    assert.ok(r.firstStall.speed > r.levelStall * 1.05, `${type.id} above wings-level stall: ${r.firstStall.speed}`);
    assert.ok(r.minSpeed > r.levelStall, `${type.id} never crosses the old threshold`);
    assert.ok(r.recovery && r.recovery.time < 48, `${type.id} recovery`);
    assert.ok(r.worstSink < -2, `${type.id} real low-speed sink`);
    assert.ok(Math.abs(r.finalBank) < 0.1 && Math.abs(r.finalPitch) < 0.1 && !r.finalStalled && !r.crashed, `${type.id} level again`);
    // At the same target speed, releasing the turn unloads the wing; gaining speed is not required.
    if (['trainer', 'jet', 'airliner', 'widebody', 'racer'].includes(type.id)) {
      assert.ok(r.recovery.time > 45 && Math.abs(r.recovery.bank) < r.maxBank - 4);
      assert.ok(r.recovery.speed < r.levelStall / Math.sqrt(Math.cos(r.maxBank * DEG)), 'still below the former banked threshold');
    }
  }
});

test('steep-turn entry and roll-out recovery agree across frame cadences and left/right inputs', () => {
  for (const id of ['trainer', 'jet', 'widebody', 'racer']) {
    const ref = bankedTurn(id);
    for (const rate of [20, 30, 120, 144]) for (const direction of [-1, 1]) {
      const r = bankedTurn(id, { rate, direction });
      assert.ok(r.firstStall && r.recovery && !r.crashed && !r.finalStalled, `${id} ${rate}fps ${direction}`);
      assert.ok(Math.abs(r.firstStall.time - ref.firstStall.time) < 0.12, 'entry timing');
      assert.ok(Math.abs(r.recovery.time - ref.recovery.time) < 0.12, 'recovery timing');
      assert.ok(Math.abs(r.firstStall.speed - ref.firstStall.speed) < 0.15, 'entry speed');
    }
  }
});

test('low-speed tape and monitor move with bank even without a flap event, retaining their hysteresis', () => {
  const flight = new FlightController(() => 40, 'trainer'), s = flight.state, monitor = new AirspeedMonitor();
  // 1.3 Vs is above the level low margin, but below the steep-turn stall threshold.
  s.speed = 1.3 * 25;
  const level = airspeedEnvelope(flight.type, 0, s);
  assert.equal(monitor.update(s, flight.type), 'normal');
  s.bank = 60 * DEG;
  const steep = airspeedEnvelope(flight.type, 0, s), layout = tapeLayout(steep, s.speed * KNOTS);
  assert.ok(steep.stall > s.speed * KNOTS && steep.low > level.low);
  assert.ok(layout.stall > tapeLayout(level, s.speed * KNOTS).stall);
  assert.equal(steep.low, steep.stall * LOW_MARGIN);
  assert.equal(monitor.update(s, flight.type), 'low');
  for (const key of ['caution', 'overspeed', 'scale']) assert.equal(steep[key], level[key], `${key} unchanged`);
  s.speed = (steep.low + HYSTERESIS.low - 0.1) / KNOTS;
  assert.equal(monitor.update(s, flight.type), 'low');
  s.speed = (steep.low + HYSTERESIS.low) / KNOTS;
  assert.equal(monitor.update(s, flight.type), 'normal');
  s.speed = 1.3 * 25; s.bank = 0;
  assert.equal(monitor.update(s, flight.type), 'normal', 'roll level lowers the margin without a flap change');
  for (const type of ROTORCRAFT) assert.equal(airspeedEnvelope(type, 0, { bank: 1 }), null);
});

test('no turn-demand state leaks through reset, aircraft change or activity/runway starts', () => {
  const flight = new FlightController(() => 40, 'trainer'), monitor = new AirspeedMonitor();
  const starts = [f => f.reset(), f => f.setAircraft('widebody'), f => f.runwayStart(0, 42.8, 0),
    f => new LandingMission().start(f), f => new CheckpointCourse().start(f)];
  for (const start of starts) {
    Object.assign(flight.state, { bank: 1, speed: 12, flightTime: 20 });
    assert.equal(monitor.update(flight.state, flight.type), 'low');
    start(flight);
    const s = flight.state;
    assert.equal(s.bank, 0);
    assert.equal(stallSpeed(flight.type, s.flaps, s), flight.type.flight.stallSpeed - s.flaps * flight.type.flight.flapStallGain);
    assert.equal(monitor.update(s, flight.type), s.grounded ? 'off' : 'normal');
    // Leave a previous runway start so the next artificially banked setup is airborne.
    s.grounded = false;
  }
});

test('normal event slices do not turn transient G telemetry into turn demand', () => {
  const flight = new FlightController(() => 40, 'jet'), inputs = new FlightInputs(0), s = flight.state;
  s.position.y = 6000;
  inputs.set({ pitch: 1 }, 0.100003);
  inputs.set({}, 0.1000031);
  for (let i = 1; i <= 120; i++) inputs.advance(i / 60, (dt, controls) => {
    flight.update(dt, controls);
    assert.equal(stallSpeed(flight.type, 0, s), 42, 'no bank means no load-demand increase');
    assert.equal(s.stalled, false);
    assert.ok(Number.isFinite(s.gForce));
  });
  // Existing overload telemetry remains unclamped even though modeled demand cannot exceed 2 g.
  Object.assign(s, { pitch: 0.48, verticalSpeed: -20, speed: 100 });
  flight.update(1 / 60);
  assert.ok(s.gForce > 6);
  assert.equal(turnLoadDemand(flight.type, s), 1);
});

test('the whole fixed-wing fleet can still complete crosswind practice with ordinary inputs', () => {
  for (const type of [...CONVENTIONAL, ...FREE]) {
    const x = setup(type.id); x.activities.startCrosswind(x.flight);
    // The existing pilot flares the glider 0.7 m short of the scoring zone on main, too.
    // A half-second of the existing trim control gives it a little more float; scoring is unchanged.
    const r = flyApproach(x, { trimSeconds: type.id === 'motorglider' ? 0.5 : 0 });
    assert.equal(r.status, 'success', `${type.id}: ${r.reason}`);
    assert.equal(r.touchdown.stalled, false, type.id);
    assert.equal(x.s.crashed, false, type.id);
  }
});

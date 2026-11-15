import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, normalizeHeadingTarget, hasHeadingSelect } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { AIRFIELD } from '../src/airfield.js';
import { groundHeight } from '../src/world.js';
import { turnToHeading } from '../scripts/measure-heading-select.js';

const DEG = Math.PI / 180;
const ALL = Object.keys(FLEET);
const FIXED_WING = ALL.filter(id => !FLEET[id].flight.rotorcraft);
const ROTORCRAFT = ALL.filter(id => FLEET[id].flight.rotorcraft);
const FREE = FIXED_WING.filter(id => FLEET[id].flight.aerobatic);
// Light, light-sport, jet, heavy and free-attitude representatives.
const REPRESENTATIVE = ['trainer', 'motorglider', 'jet', 'airliner', 'widebody', 'cargo', 'aerobatic', 'fighter', 'interceptor'];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function airborne(id, { heading = 0 } = {}) {
  const flight = new FlightController(() => 0, id);
  flight.state.position.y = 2400;
  flight.state.heading = heading * DEG;
  flight.setQuaternion();
  return flight;
}
function fly(flight, seconds, inputs = {}, each = () => {}) {
  const input = new FlightInputs(0);
  input.set(inputs, 0);
  for (let t = 0; t < seconds - 1e-9;) { t = Math.min(seconds, t + 1 / 60); input.advance(t, (dt, c) => { flight.update(dt, c); each(); }); }
}
const snapshot = s => ({ position: s.position.toArray(), quaternion: s.quaternion.toArray(), heading: s.heading, bank: s.bank,
  pitch: s.pitch, speed: s.speed, throttle: s.throttle, pitchTrim: s.pitchTrim, autopilot: s.autopilot });

test('heading targets are whole degrees normalised across 000/360; invalid input is refused', () => {
  for (const [value, expected] of [[0, 0], [360, 0], [359.6, 0], [359.4, 359], [-1, 359], [-370, 350], [725, 5], ['090', 90], [' 45 ', 45], ['270.4', 270]]) {
    assert.equal(normalizeHeadingTarget(value), expected, `${JSON.stringify(value)}`);
  }
  for (const value of ['', '  ', 'abc', '12°', NaN, Infinity, -Infinity, null, undefined, true, false, {}, [], [90]]) {
    assert.equal(normalizeHeadingTarget(value), null, `${String(value)} is refused`);
  }
  const flight = airborne('trainer');
  assert.equal(flight.setHeadingTarget(120), 120);
  for (const value of ['', 'north', NaN, null, Infinity]) {
    assert.equal(flight.setHeadingTarget(value), null);
    assert.equal(flight.state.selectedHeading, 120, 'an invalid entry leaves the selection unchanged');
  }
});

test('every fixed-wing type has the heading bug; helicopters keep their plain hover hold', () => {
  assert.ok(FIXED_WING.length >= 15 && ROTORCRAFT.length >= 2);
  for (const id of FIXED_WING) assert.ok(hasHeadingSelect(FLEET[id]), id);
  for (const id of ROTORCRAFT) {
    const flight = airborne(id), control = airborne(id);
    assert.ok(!hasHeadingSelect(FLEET[id]), id);
    assert.equal(flight.setHeadingTarget(90), null);
    assert.equal(flight.holdSelectedHeading(), false);
    assert.equal(flight.state.selectedHeading, null);
    flight.toggleAutopilot(); control.toggleAutopilot();
    fly(flight, 20); fly(control, 20);
    assert.deepEqual(snapshot(flight.state), snapshot(control.state), `${id} hover hold is unchanged`);
  }
});

test('choosing a heading while flying manually neither steers nor engages assist', () => {
  for (const id of REPRESENTATIVE) for (const inputs of [{}, { roll: 0.6 }, { pitch: -0.4, throttle: 0.3 }]) {
    const flight = airborne(id), control = airborne(id);
    flight.setHeadingTarget(200);
    fly(flight, 15, inputs, () => flight.setHeadingTarget(200)); fly(control, 15, inputs);
    assert.deepEqual(snapshot(flight.state), snapshot(control.state), `${id} ${JSON.stringify(inputs)}`);
    assert.equal(flight.state.autopilot, false);
    assert.equal(flight.state.headingHold, false);
    assert.equal(flight.state.selectedHeading, 200);
  }
});

test('the selected heading is reached the short way across 359/001', () => {
  for (const id of REPRESENTATIVE) {
    for (const [from, to, turn] of [[350, 10, 1], [10, 350, -1], [359, 1, 1], [1, 359, -1], [300, 30, 1], [60, 330, -1]]) {
      const r = turnToHeading(id, { from, to, seconds: 150 });
      assert.equal(r.firstTurn, turn, `${id} ${from}→${to} turns ${turn > 0 ? 'right' : 'left'}`);
      assert.ok(r.finalError < 0.5, `${id} ${from}→${to} settles (${r.finalError.toFixed(2)}°)`);
      // The short way never sweeps through the other side of the compass.
      assert.ok(r.overshoot < 1, `${id} ${from}→${to} overshoot ${r.overshoot.toFixed(2)}°`);
    }
  }
});

test('heading convergence is bounded and smooth for light, jet, heavy and free-attitude types', () => {
  for (const id of FIXED_WING) {
    for (const [from, to] of [[0, 180], [90, 270], [45, 135]]) {
      const r = turnToHeading(id, { from, to, seconds: 240 });
      assert.ok(r.capture !== null && r.capture < 180, `${id} ${from}→${to} captured in ${r.capture?.toFixed(1)} s`);
      assert.ok(r.finalError < 0.5, `${id} ${from}→${to} final error ${r.finalError.toFixed(2)}°`);
      // Assist's existing bounded turn: never steeper than 23° of bank, never rolled faster than 25°/s.
      assert.ok(r.worstBank <= 0.4 / DEG + 0.05, `${id} bank ${r.worstBank.toFixed(1)}°`);
      assert.ok(r.worstBankRate <= 26, `${id} roll rate ${r.worstBankRate.toFixed(1)}°/s`);
      assert.ok(r.overshoot < 1, `${id} overshoot ${r.overshoot.toFixed(2)}°`);
      assert.ok(r.autopilot && r.headingHold, `${id} still holding`);
    }
  }
});

test('heading selection never moves throttle or trim, teleports or snaps the attitude', () => {
  for (const id of REPRESENTATIVE) {
    const flight = airborne(id, { heading: 10 }), s = flight.state;
    if (!FLEET[id].flight.aerobatic) s.pitchTrim = 2 * DEG;
    s.throttle = 0.61;
    flight.toggleAutopilot();
    fly(flight, 3);
    const before = { position: s.position.clone(), quaternion: s.quaternion.clone(), throttle: s.throttle, trim: s.pitchTrim };
    flight.setHeadingTarget(190);
    assert.ok(s.position.equals(before.position) && s.quaternion.equals(before.quaternion), `${id} selecting moves nothing`);
    let last = s.position.clone(), lastQ = s.quaternion.clone(), worstStep = 0, worstTurn = 0;
    fly(flight, 60, {}, () => {
      worstStep = Math.max(worstStep, s.position.distanceTo(last)); last.copy(s.position);
      worstTurn = Math.max(worstTurn, s.quaternion.angleTo(lastQ)); lastQ.copy(s.quaternion);
    });
    assert.equal(s.throttle, before.throttle, `${id} throttle`);
    assert.equal(s.pitchTrim, before.trim, `${id} trim`);
    assert.ok(worstStep < (FLEET[id].flight.maxSpeed + 5) / 120 * 1.05, `${id} moves ${worstStep.toFixed(2)} m per 1/120 s slice`);
    assert.ok(worstTurn < 0.5 * DEG, `${id} rotates at most ${(worstTurn / DEG).toFixed(2)}° per slice`);
  }
});

test('changing heading with assist on keeps the held altitude; Space still captures heading and altitude', () => {
  for (const id of REPRESENTATIVE) {
    const flight = airborne(id, { heading: 40 }), s = flight.state;
    flight.setHeadingTarget(250);
    // Space: the existing capture of the current heading and altitude, with the selection kept but inactive.
    flight.toggleAutopilot();
    assert.ok(s.autopilot && !s.headingHold);
    assert.equal(s.selectedHeading, 250);
    const altitude = flight.holdAltitude;
    fly(flight, 30);
    assert.ok(Math.abs(wrap(s.heading - 40 * DEG)) < 1 * DEG, `${id} Space holds the captured heading`);
    s.position.y += 40;                            // drifted off the hold, e.g. a gust, before retargeting
    flight.setHeadingTarget(130);
    assert.ok(s.headingHold);
    assert.equal(flight.holdAltitude, altitude, `${id} the held altitude is kept, not re-captured`);
    let worst = 0;
    fly(flight, 200, {}, () => { worst = Math.max(worst, Math.abs(s.position.y - altitude)); });
    assert.ok(Math.abs(wrap(s.heading - 130 * DEG)) < 0.5 * DEG, `${id} new heading`);
    assert.ok(Math.abs(s.position.y - altitude) < 3, `${id} returns to the held altitude (${(s.position.y - altitude).toFixed(1)} m)`);
    assert.ok(worst <= 41, `${id} altitude excursion ${worst.toFixed(1)} m`);
    // Space again is manual flight; Space once more captures the heading then flown, not the bug.
    flight.toggleAutopilot();
    assert.ok(!s.autopilot && !s.headingHold);
    flight.toggleAutopilot();
    assert.ok(s.autopilot && !s.headingHold && flight.holdHeading === s.heading);
  }
});

test('Hold heading engages assist on the selection and holds the altitude flown when engaged', () => {
  for (const id of REPRESENTATIVE) {
    const flight = airborne(id), s = flight.state;
    assert.equal(flight.holdSelectedHeading(), false, 'nothing selected');
    assert.equal(s.autopilot, false);
    flight.setHeadingTarget(75);
    const altitude = s.position.y;
    assert.equal(flight.holdSelectedHeading(), true);
    assert.ok(s.autopilot && s.headingHold);
    assert.equal(flight.holdAltitude, altitude);
    fly(flight, 120);
    assert.ok(Math.abs(wrap(s.heading - 75 * DEG)) < 0.5 * DEG, id);
    assert.ok(Math.abs(s.position.y - altitude) < 6, `${id} altitude ${(s.position.y - altitude).toFixed(1)} m`);
  }
});

test('manual inputs disengage the heading hold immediately and keep full manual control', () => {
  for (const id of REPRESENTATIVE) for (const inputs of [{ roll: -1 }, { pitch: 0.5 }, { yaw: 1 }]) {
    // The same aircraft on a plain Space hold: once disengaged, both must fly identically.
    const flight = airborne(id), control = airborne(id), s = flight.state;
    flight.setHeadingTarget(180); flight.holdSelectedHeading();
    control.toggleAutopilot();
    // The pilot's raw input ends assist before its first physics step, as main.js does on press.
    flight.update(1 / 60, inputs); control.update(1 / 60, inputs);
    assert.equal(s.autopilot, false, `${id} ${JSON.stringify(inputs)}`);
    assert.equal(s.headingHold, false);
    assert.equal(s.selectedHeading, 180, 'the bug stays where the pilot set it');
    fly(flight, 5, inputs); fly(control, 5, inputs);
    assert.deepEqual(snapshot(flight.state), snapshot(control.state), `${id} manual flight unchanged`);
  }
});

test('assist cannot be engaged on a heading on the ground or after a crash', () => {
  for (const id of ['trainer', 'jet', 'aerobatic', 'widebody']) {
    const flight = new FlightController(groundHeight, id), s = flight.state;
    flight.runwayStart(AIRFIELD.x, groundHeight(AIRFIELD.x, AIRFIELD.z) + 2.8, AIRFIELD.z, AIRFIELD.heading);
    assert.equal(flight.setHeadingTarget(90), 90, 'a value can be chosen before departure');
    assert.equal(flight.holdSelectedHeading(), false);
    assert.ok(!s.autopilot && !s.headingHold);
    const crashed = airborne(id);
    crashed.setHeadingTarget(90);
    crashed.state.crashed = true;
    assert.equal(crashed.holdSelectedHeading(), false);
    assert.ok(!crashed.state.autopilot);
  }
  // A heading hold that touches down or stalls ends with assist.
  const flight = airborne('trainer'), s = flight.state;
  flight.setHeadingTarget(90); flight.holdSelectedHeading();
  s.speed = 10;
  fly(flight, 0.1);
  assert.ok(s.stalled && !s.autopilot && !s.headingHold, 'a stall still ends assist and the hold');
});

test('aerobatic recovery levels out first, then honours a heading chosen during it', () => {
  for (const id of FREE) for (const path of ['hold', 'space-then-select']) {
    const flight = airborne(id), s = flight.state;
    Object.assign(s, { heading: 20 * DEG, bank: 150 * DEG, pitch: 35 * DEG });
    flight.setQuaternion();
    if (path === 'hold') { flight.setHeadingTarget(200); flight.holdSelectedHeading(); }
    else { flight.toggleAutopilot(); flight.setHeadingTarget(200); }
    assert.ok(flight.recovering && s.headingHold);
    let level = null, t = 0;
    fly(flight, 240, {}, () => {
      t += 1 / 120;
      if (level === null && !flight.recovering) {
        level = { heading: s.heading, bank: Math.abs(s.bank) / DEG, pitch: Math.abs(s.pitch) / DEG };
        assert.ok(Math.abs(wrap(flight.holdHeading - 200 * DEG)) < 1e-9, `${id} the target survives recovery completion`);
      }
    });
    assert.ok(level && level.bank < 4 && level.pitch < 4, `${id} levelled first (${level?.bank.toFixed(1)}° bank)`);
    assert.ok(Math.abs(wrap(s.heading - 200 * DEG)) < 0.5 * DEG, `${id} ${path} then turns to 200°, at ${(s.heading / DEG).toFixed(1)}°`);
    assert.ok(Math.abs(s.bank) < 1 * DEG);
  }
  // Space alone still holds the heading it levels out on.
  const flight = airborne('aerobatic'), s = flight.state;
  Object.assign(s, { bank: 120 * DEG, pitch: 20 * DEG }); flight.setQuaternion();
  flight.toggleAutopilot();
  fly(flight, 60);
  assert.ok(!flight.recovering && !s.headingHold && Math.abs(wrap(flight.holdHeading - s.heading)) < 1 * DEG);
});

test('restart, aircraft change and fresh approach, runway and course starts clear the selection', () => {
  const selected = () => { const f = new FlightController(groundHeight, 'trainer'); f.state.position.y = 2400; f.setHeadingTarget(270); f.holdSelectedHeading(); assert.ok(f.state.headingHold); return f; };
  const clear = (f, label) => { assert.equal(f.state.selectedHeading, null, label); assert.equal(f.state.headingHold, false, label); };
  let f = selected(); f.reset(); clear(f, 'restart');
  f = selected(); f.setAircraft('jet'); clear(f, 'aircraft change');
  f = selected(); f.runwayStart(AIRFIELD.x, 600, AIRFIELD.z, AIRFIELD.heading); clear(f, 'runway start');
  f = selected(); new LandingMission(AIRFIELD).start(f); clear(f, 'approach / landing mission');
  f = selected(); new CheckpointCourse().start(f); f.toggleAutopilot(); clear(f, 'checkpoint course');
  assert.ok(f.state.autopilot && Math.abs(wrap(f.holdHeading - f.state.heading)) < 1e-9, 'the course still captures its own gate-1 heading');
  // After a reset, Hold heading has nothing stale to engage on.
  f = selected(); f.reset(); assert.equal(f.holdSelectedHeading(), false);
});

test('clearing the selection mid-turn holds the heading then flown, without a snap', () => {
  const flight = airborne('jet'), s = flight.state;
  flight.setHeadingTarget(180); flight.holdSelectedHeading();
  fly(flight, 20);
  const heading = s.heading, bank = s.bank;
  flight.clearHeadingTarget();
  assert.ok(s.autopilot && !s.headingHold && s.selectedHeading === null);
  assert.equal(s.bank, bank);
  fly(flight, 60);
  assert.ok(Math.abs(wrap(s.heading - heading)) < 15 * DEG, 'rolls out near the heading it was on');
});

test('in wind the bug holds the nose heading and the track drifts: no wind correction or track capture', () => {
  for (const id of ['trainer', 'jet', 'widebody', 'aerobatic']) for (const preset of ['breeze', 'gusts']) {
    const flight = airborne(id), s = flight.state;
    flight.setWind(preset, { immediate: true });
    flight.setHeadingTarget(90); flight.holdSelectedHeading();
    fly(flight, 150);
    assert.ok(s.autopilot && s.headingHold);
    // Gusts and veer nudge it only through the assist's own bounded turn; the nose stays on the bug.
    assert.ok(Math.abs(wrap(s.heading - 90 * DEG)) < 1.5 * DEG, `${id} ${preset} nose ${(s.heading / DEG).toFixed(2)}°`);
    const start = s.position.clone();
    fly(flight, 30);
    const track = Math.atan2(s.position.x - start.x, -(s.position.z - start.z));
    // A wind from 240–260° blows towards the north-east, across an eastbound nose: the track drifts left of 090.
    assert.ok(wrap(track - s.heading) < -0.5 * DEG, `${id} ${preset} drifts (${(wrap(track - s.heading) / DEG).toFixed(2)}°)`);
  }
});

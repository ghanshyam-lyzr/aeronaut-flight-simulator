import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { FlightController, FollowFrame } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { createAircraft } from '../src/aircraft.js';

const DT = 1 / 60;
const axis = (q, x, y, z) => new Vector3(x, y, z).applyQuaternion(q);
const forwardOf = q => axis(q, 0, 0, -1);
const upOf = q => axis(q, 0, 1, 0);

/** A fighter high above flat ground, so loops never meet the terrain. */
function fighter(altitude = 3000) {
  const flight = new FlightController(() => 0, 'fighter');
  flight.state.position.y = altitude;
  return flight;
}

/**
 * Flies with real control inputs and records what a pilot would see: the largest attitude change in one
 * frame, how far the flight path strays from the nose, and the extremes of the displayed angles.
 */
function fly(flight, seconds, controls = {}, track = {}) {
  const s = flight.state;
  track.maxStep ??= 0; track.maxSlip ??= 0; track.minUp ??= 1; track.maxPitch ??= -Infinity; track.minPitch ??= Infinity;
  track.maxBank ??= 0; track.pitchTurn ??= 0; track.rollTurn ??= 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const q = s.quaternion.clone(), p = s.position.clone();
    flight.update(DT, controls);
    track.maxStep = Math.max(track.maxStep, q.angleTo(s.quaternion));
    const moved = s.position.clone().sub(p);
    if (moved.length() > 0) track.maxSlip = Math.max(track.maxSlip, forwardOf(s.quaternion).angleTo(moved));
    track.minUp = Math.min(track.minUp, upOf(s.quaternion).y);
    track.maxPitch = Math.max(track.maxPitch, s.pitch);
    track.minPitch = Math.min(track.minPitch, s.pitch);
    track.maxBank = Math.max(track.maxBank, Math.abs(s.bank));
    track.pitchTurn += s.bodyRates.pitch * DT;
    track.rollTurn += s.bodyRates.roll * DT;
    for (const v of [s.pitch, s.bank, s.heading, ...s.position.toArray(), ...s.quaternion.toArray()]) assert.ok(Number.isFinite(v));
    assert.ok(Math.abs(s.quaternion.length() - 1) < 1e-9, 'attitude stays a unit rotation');
    assert.ok(s.pitch >= -Math.PI / 2 - 1e-9 && s.pitch <= Math.PI / 2 + 1e-9);
    assert.ok(s.bank >= -Math.PI - 1e-9 && s.bank <= Math.PI + 1e-9);
    assert.ok(s.heading >= 0 && s.heading < Math.PI * 2);
  }
  return track;
}

const maxFrameTurn = flight => {
  const f = flight.type.flight;
  return Math.hypot(f.pitchRate, f.rollRate, f.yawRate) * DT * 1.6;
};

test('the fighter has no attitude limits; the Vela J8 keeps its own', () => {
  assert.equal(FLEET.fighter.flight.aerobatic, true);
  assert.equal(FLEET.fighter.flight.pitchLimits, null);
  assert.equal(FLEET.fighter.flight.bankLimit, null);
  assert.equal(FLEET.jet.flight.aerobatic, false);
  const vela = new FlightController(() => 0);
  vela.state.position.y = 3000;
  fly(vela, 6, { roll: 1 });
  assert.equal(vela.state.bank, FLEET.jet.flight.bankLimit);
  const climbing = new FlightController(() => 0);
  climbing.state.position.y = 3000;
  fly(climbing, 6, { pitch: 1 });
  assert.equal(climbing.state.pitch, FLEET.jet.flight.pitchLimits[1]);
});

for (const [name, pitch] of [['inside', 1], ['outside', -1]]) {
  test(`stick held ${name === 'inside' ? 'back' : 'forward'} flies repeated ${name} loops through vertical and inverted`, () => {
    const flight = fighter(name === 'outside' ? 6000 : 3000);
    const start = flight.state.heading;
    const track = fly(flight, 20, { pitch, throttle: 1 });
    const s = flight.state;
    // At least two full loops in 20 s, every one smooth.
    assert.ok(Math.abs(track.pitchTurn) > 4 * Math.PI, `${name}: turned ${track.pitchTurn} rad`);
    assert.equal(Math.sign(track.pitchTurn), pitch);
    assert.ok(track.maxStep < maxFrameTurn(flight), `${name}: largest frame step ${track.maxStep}`);
    assert.ok(track.maxPitch > 1.5 && track.minPitch < -1.5, 'passes straight up and straight down');
    assert.ok(track.minUp < -0.95, 'flies inverted over the top');
    assert.ok(track.maxSlip < 0.35, `${name}: flight path within ${track.maxSlip} rad of the nose`);
    assert.equal(s.crashed, false);
    assert.equal(s.stalled, false);
    // Loops stay in their vertical plane: the aircraft comes back round on its original heading.
    fly(flight, 0.01, {});
    assert.ok(Math.abs(forwardOf(s.quaternion).x) < 0.12, 'no sideways drift');
    assert.ok(Math.abs(Math.sin(s.heading - start)) < 0.12 || Math.abs(s.pitch) > 0.8);
  });
}

for (const roll of [1, -1]) {
  test(`full ${roll > 0 ? 'right' : 'left'} aileron rolls continuously around the nose`, () => {
    const flight = fighter();
    const before = forwardOf(flight.state.quaternion);
    const track = fly(flight, 8, { roll });
    const s = flight.state;
    // Over three complete rolls, each passing wings-vertical and inverted without a snap.
    assert.ok(Math.abs(track.rollTurn) > 6 * Math.PI, `rolled ${track.rollTurn} rad`);
    assert.equal(Math.sign(track.rollTurn), roll);
    assert.ok(track.maxBank > 3.1 && track.minUp < -0.99);
    assert.ok(track.maxStep < maxFrameTurn(flight), `largest frame step ${track.maxStep}`);
    assert.ok(forwardOf(s.quaternion).angleTo(before) < 0.35, 'the nose stays on its line through the rolls');
    assert.ok(Math.abs(s.position.y - 3000) < 150, `height change ${s.position.y - 3000} m`);
  });
}

test('released controls hold inverted flight and a steep climb instead of self-leveling', () => {
  const flight = fighter();
  while (Math.abs(flight.state.bank) < 2.6) fly(flight, DT, { roll: 1 });
  fly(flight, 0.5, {});
  const settled = flight.state.quaternion.clone();
  assert.ok(upOf(settled).y < -0.9, 'rolled inverted');
  fly(flight, 6, {});
  // Only the slow turn from the residual bank remains: the wings stay where the pilot left them.
  assert.ok(upOf(flight.state.quaternion).y < -0.9, `up ${upOf(flight.state.quaternion).y} after release`);
  assert.ok(Math.abs(upOf(flight.state.quaternion).y - upOf(settled).y) < 0.05, 'no self-leveling roll');
  assert.equal(flight.state.autopilot, false);

  const climb = fighter();
  climb.state.throttle = 1;
  while (climb.state.pitch < 1.05) fly(climb, DT, { pitch: 1 });
  fly(climb, 2, { throttle: 1 });
  assert.ok(climb.state.pitch > 1.0, `pitch after release ${climb.state.pitch}`);
});

test('a roll to 80° and a held pull turns faster than 25°/s while holding height', () => {
  const flight = fighter(620);
  while (flight.state.bank < 1.4) fly(flight, DT, { roll: 1 });
  fly(flight, 0.3, {});
  let turned = 0, last = flight.state.heading;
  for (let i = 0; i < 5 / DT; i++) {
    // A pilot pulls and adds a little aileron to keep the bank near 80°.
    flight.update(DT, { pitch: 0.55, roll: (1.4 - flight.state.bank) * 3, throttle: 1 });
    turned += Math.atan2(Math.sin(flight.state.heading - last), Math.cos(flight.state.heading - last));
    last = flight.state.heading;
  }
  assert.ok(turned / 5 * 180 / Math.PI > 25, `${turned / 5 * 180 / Math.PI}°/s`);
  assert.ok(Math.abs(flight.state.position.y - 620) < 200, `height ${flight.state.position.y}`);
});

test('a banked fighter still turns towards the low wing, with continuous turn rate through knife-edge', () => {
  const flight = fighter();
  while (flight.state.bank < 0.5) fly(flight, DT, { roll: 1 });
  const start = flight.state.heading;
  fly(flight, 4, {});
  assert.ok(flight.state.heading - start > 0.1, 'turns right');
  // Rolling slowly through 90° bank and on to inverted never jerks the heading.
  const slow = fighter();
  let previous = slow.state.heading, biggest = 0;
  for (let i = 0; i < 4 / DT; i++) {
    slow.update(DT, { roll: 0.25 });
    biggest = Math.max(biggest, Math.abs(Math.atan2(Math.sin(slow.state.heading - previous), Math.cos(slow.state.heading - previous))));
    previous = slow.state.heading;
  }
  assert.ok(Math.abs(slow.state.bank) > 2.4);
  assert.ok(biggest < 0.01, `largest heading step ${biggest}`);
});

test('manual input takes over from assist, and assist recovers smoothly from any attitude', () => {
  const flight = fighter();
  assert.equal(flight.toggleAutopilot(), true);
  fly(flight, 0.1, { pitch: 1 });
  assert.equal(flight.state.autopilot, false, 'stick input disengages assist');
  const track = fly(flight, 6, { pitch: 1, throttle: 1 });
  assert.ok(track.pitchTurn > 3, 'and the nose goes on round');

  const attitudes = {
    inverted: { roll: 1, until: s => Math.abs(s.bank) > 3.05 },
    'straight up': { pitch: 1, throttle: 1, until: s => s.pitch > 1.5 },
    'straight down': { pitch: -1, until: s => s.pitch < -1.5 },
    'knife edge': { roll: -1, until: s => s.bank < -1.5 },
    'inverted climb': { pitch: 1, throttle: 1, until: s => s.pitch < 0.9 && upOf(s.quaternion).y < -0.3 },
  };
  for (const [name, { until, ...controls }] of Object.entries(attitudes)) {
    const f = fighter(5000);
    f.state.throttle = 0.9;
    for (let i = 0; i < 60 / DT && !until(f.state); i++) f.update(DT, controls);
    assert.ok(until(f.state), `${name} reached`);
    assert.equal(f.toggleAutopilot(), true, `${name}: assist engages`);
    const recovery = fly(f, 12, {});
    const s = f.state;
    assert.equal(s.autopilot, true, `${name}: assist holds`);
    assert.ok(recovery.maxStep < 1.25 * DT * 1.05, `${name}: capped recovery rate, step ${recovery.maxStep}`);
    assert.ok(upOf(s.quaternion).y > 0.9 && Math.abs(s.pitch) < 0.2 && Math.abs(s.bank) < 0.45, `${name}: level, pitch ${s.pitch} bank ${s.bank}`);
    assert.equal(s.crashed, false);
    // Once level it settles onto a steady heading.
    const heading = s.heading;
    fly(f, 20, {});
    assert.ok(Math.abs(Math.sin(f.state.heading - heading)) < 0.25 && Math.abs(f.state.bank) < 0.1, `${name}: heading held`);
  }
});

test('reset and runway start return a fighter upright after aerobatics', () => {
  const flight = fighter();
  fly(flight, 3, { roll: 1, pitch: 1 });
  assert.ok(flight.state.quaternion.angleTo(new Quaternion()) > 0.5);
  const fresh = flight.reset();
  assert.ok(fresh.quaternion.equals(new Quaternion()));
  assert.deepEqual([fresh.pitch, fresh.bank, fresh.heading], [0, 0, 0]);
  assert.deepEqual(fresh.bodyRates, { pitch: 0, roll: 0, yaw: 0 });
  fly(flight, 5, {});
  assert.ok(flight.state.quaternion.angleTo(new Quaternion()) < 0.01, 'flies straight and level');

  fly(flight, 2, { roll: -1 });
  const parked = flight.runwayStart(900, 80.8, -1350, Math.PI / 2);
  assert.ok(parked.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)) < 1e-9);
  assert.equal(parked.grounded, true);
  // Takeoff hands the ground attitude to the free model without a jump.
  let maxStep = 0;
  for (let i = 0; i < 40 / DT && parked.position.y < 300; i++) {
    const q = parked.quaternion.clone();
    flight.update(DT, { throttle: 1, pitch: parked.grounded || parked.pitch < 0.2 ? 0.6 : 0 });
    maxStep = Math.max(maxStep, q.angleTo(parked.quaternion));
  }
  assert.equal(parked.grounded, false);
  assert.ok(parked.position.y >= 300 && maxStep < 0.05, `takeoff step ${maxStep}`);
  assert.ok(Math.abs(parked.heading - Math.PI / 2) < 0.2);
});

test('switching aircraft mid-roll starts an upright Vela J8 that still flies exactly as before', () => {
  const flight = fighter();
  fly(flight, 2, { roll: 1, pitch: 1 });
  flight.setAircraft('jet');
  assert.ok(flight.state.quaternion.equals(new Quaternion()));
  // Recorded from the Vela J8 before the fighter's free attitude existed.
  const vela = new FlightController(() => 78);
  for (const [seconds, controls] of [[4, { roll: 1 }], [3, { pitch: 1 }], [5, {}], [3, { roll: -1, pitch: -1, yaw: 0.5 }], [6, { throttle: 1 }], [4, { pitch: -1 }]]) {
    for (let i = 0; i < seconds * 60; i++) vela.update(DT, controls);
  }
  vela.toggleAutopilot();
  for (let i = 0; i < 600; i++) vela.update(DT);
  const s = vela.state;
  assert.deepEqual(s.position.toArray(), [2244.174916913311, 377.77691528304905, -549.141302852963]);
  assert.deepEqual([s.pitch, s.bank, s.heading, s.speed, s.verticalSpeed], [0.02791211779987192, 0.009371717254964001, 0.561092582528449, 125.54741671593277, 3.670317702400234]);
  assert.deepEqual(s.quaternion.toArray(), [0.014707147160843204, -0.2767877830772224, -0.0006382124226940854, 0.9608183052203415]);
  assert.deepEqual(s.bodyRates, { pitch: 0, roll: 0, yaw: 0 });
});

test('stalls drop the nose from any attitude and crashes still end the flight', () => {
  const flight = fighter();
  flight.state.throttle = 0;
  while (flight.state.pitch < 1.4) fly(flight, DT, { pitch: 1 });
  fly(flight, 1.5, {});
  fly(flight, 6, {});
  assert.ok(flight.state.pitch < 0, `nose ${flight.state.pitch}`);

  const dive = fighter(400);
  while (!dive.state.crashed && dive.state.flightTime < 30) dive.update(DT, { pitch: -1 });
  assert.equal(dive.state.crashed, true);
  assert.equal(dive.state.crashReason, 'Terrain collision');
});

test('setting pitch, bank or heading directly re-seeds the free attitude', () => {
  const flight = fighter();
  Object.assign(flight.state, { pitch: 0.3, bank: -0.5, heading: 1 });
  flight.update(DT, {});
  const s = flight.state;
  assert.ok(Math.abs(s.pitch - 0.3) < 0.01 && Math.abs(s.bank + 0.5) < 0.01 && Math.abs(s.heading - 1) < 0.01);
  const expected = new Quaternion().setFromEuler(flight.attitude.set(0.3, -1, 0.5, 'YXZ'));
  assert.ok(s.quaternion.angleTo(expected) < 0.01);
});

test('fighter control surfaces follow body rates smoothly through inverted flight', () => {
  const model = createAircraft('fighter');
  const flight = fighter();
  let previous = null, biggest = 0;
  for (let i = 0; i < 6 / DT; i++) {
    flight.update(DT, { roll: 1 });
    model.update(DT, 0.7, flight.state);
    const ailerons = [...model.surfaces.ailerons];
    // After the first second the deflection must stay steady, through every pass of inverted.
    if (previous && i > 60) biggest = Math.max(biggest, ...ailerons.map((a, j) => Math.abs(a - previous[j])));
    previous = ailerons;
  }
  const [down, up] = [...model.surfaces.ailerons].sort((a, b) => a - b);
  assert.ok(down < -0.1 && up > 0.1, 'ailerons stay deflected in a continuous roll');
  assert.ok(biggest < 0.002, `largest aileron step ${biggest}`);
  model.dispose();
});

test('the follow camera stays behind the nose through a loop without flipping, then levels', () => {
  const flight = fighter();
  const frame = new FollowFrame();
  frame.reset(flight.state.quaternion);
  let maxStep = 0, maxLag = 0;
  for (let i = 0; i < 12 / DT; i++) {
    flight.update(DT, { pitch: 1, throttle: 1 });
    const before = frame.quaternion.clone();
    frame.update(flight.state.quaternion, DT, flight.state.bodyRates.pitch);
    maxStep = Math.max(maxStep, before.angleTo(frame.quaternion));
    maxLag = Math.max(maxLag, forwardOf(frame.quaternion).angleTo(forwardOf(flight.state.quaternion)));
  }
  assert.ok(maxStep < 0.05, `largest camera step ${maxStep}`);
  assert.ok(maxLag < 1e-6, 'looks along the nose');
  // A roll does not spin the camera, and wings-level flight brings its horizon back level.
  const rolled = fighter();
  frame.reset(rolled.state.quaternion);
  for (let i = 0; i < 2 / DT; i++) {
    rolled.update(DT, { roll: 1 });
    frame.update(rolled.state.quaternion, DT, rolled.state.bodyRates.pitch);
  }
  assert.ok(upOf(frame.quaternion).y > 0.95, 'camera horizon stays level through a roll');
  // Half a loop and a roll-out (an Immelmann) leaves the camera inverted until it eases back level.
  const immelmann = fighter();
  frame.reset(immelmann.state.quaternion);
  const step = controls => { immelmann.update(DT, controls); frame.update(immelmann.state.quaternion, DT, immelmann.state.bodyRates.pitch); };
  while (!(upOf(immelmann.state.quaternion).y < -0.97)) step({ pitch: 1, throttle: 1 });
  while (upOf(immelmann.state.quaternion).y < 0.97) step({ roll: 1 });
  assert.ok(upOf(frame.quaternion).y < 0, 'camera is still the right way up for the loop');
  maxStep = 0;
  for (let i = 0; i < 6 / DT; i++) {
    const before = frame.quaternion.clone();
    step({});
    maxStep = Math.max(maxStep, before.angleTo(frame.quaternion));
  }
  assert.ok(upOf(frame.quaternion).y > 0.97, 'and then levels with the aircraft');
  assert.ok(maxStep < 1.25 * DT, `levels gently, step ${maxStep}`);
});

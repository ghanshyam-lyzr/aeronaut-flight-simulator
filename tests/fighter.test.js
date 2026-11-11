import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightController, JET, fighterSound } from '../src/flight.js';
import { FLEET, aircraftType } from '../src/fleet.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';

function fly(flight, seconds, controls = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) flight.update(1 / 60, controls);
  return flight.state;
}
const knots = metres => metres * 1.94384;
const fighter = () => new FlightController(() => 78, 'fighter');

test('fleet retains the Vela J8 default and consistent aircraft labels', () => {
  for (const id of ['jet', 'fighter', 'helicopter']) assert.equal(FLEET[id].id, id);
  assert.equal(aircraftType('nope').id, 'jet');
  assert.equal(aircraftType(undefined).name, 'Vela J8');
  for (const type of Object.values(FLEET)) {
    for (const key of ['name', 'type', 'registration', 'badge', 'summary', 'choice', 'help', 'runwayHint']) assert.ok(type[key], `${type.id}.${key}`);
    assert.ok(type.summary.startsWith(type.name));
  }
  assert.equal(Object.keys(FLEET.fighter.flight).sort().join(), Object.keys(FLEET.jet.flight).sort().join());
  assert.equal(new FlightController(() => 78).state.aircraft, 'jet');
});

test('switching aircraft starts a fresh airborne flight, and restarts keep the chosen type', () => {
  const flight = new FlightController(() => 78);
  fly(flight, 5, { roll: 0.5, throttle: 1 });
  Object.assign(flight.state, { gearDown: true, flaps: 2 });
  const state = flight.setAircraft('fighter');
  assert.equal(state, flight.state);
  assert.equal(state.aircraft, 'fighter');
  assert.equal(state.speed, FLEET.fighter.flight.cruiseSpeed);
  assert.equal(state.throttle, 0.72);
  assert.equal(state.spool, 0.72);
  assert.deepEqual(state.position.toArray(), [0, 620, 1900]);
  assert.equal(state.flightTime, 0);
  assert.equal(state.gearDown, false);
  assert.equal(state.flaps, 0);
  assert.equal(state.bank, 0);
  flight.reset();
  assert.equal(flight.state.aircraft, 'fighter');
  flight.setAircraft('jet');
  assert.equal(flight.state.speed, JET.cruiseSpeed);
  // The Vela J8 still flies exactly as before after a fighter flight.
  const fresh = fly(new FlightController(() => 78), 20);
  const switched = fly(flight, 20);
  assert.deepEqual(switched.position.toArray(), fresh.position.toArray());
});

test('runway start parks the active aircraft at idle with the gear down', () => {
  for (const id of ['jet', 'fighter']) {
    const flight = new FlightController(() => 78, id);
    const state = flight.runwayStart(900, 80.8, -1350);
    assert.deepEqual(state.position.toArray(), [900, 80.8, -1350]);
    Object.entries({ aircraft: id, speed: 0, throttle: 0, spool: 0, gearDown: true, grounded: true, autopilot: false })
      .forEach(([key, value]) => assert.equal(state[key], value, `${id}.${key}`));
    fly(flight, 10);
    assert.equal(state.speed, 0, `${id} creeps at idle`);
    assert.equal(flight.toggleAutopilot(), false);
  }
});

test('fighter cruises near 330 kt, holds altitude on assist, and the afterburner adds speed', () => {
  const flight = fighter();
  flight.toggleAutopilot();
  const state = fly(flight, 30);
  assert.ok(knots(state.speed) > 315 && knots(state.speed) < 345, `cruise ${knots(state.speed)} kt`);
  assert.ok(Math.abs(state.position.y - 620) < 1);
  assert.equal(state.afterburner, false);
  state.throttle = 0.85;
  fly(flight, 30);
  const dry = state.speed;
  assert.equal(state.afterburner, false);
  state.throttle = 1;
  fly(flight, 30);
  assert.equal(state.afterburner, true);
  assert.ok(knots(state.speed) > 500 && state.speed > dry + 50, `burner ${knots(state.speed)} kt vs dry ${knots(dry)} kt`);
});

test('fighter rolls and pitches much faster than the Vela J8', () => {
  const vela = fly(new FlightController(() => 78), 0.5, { roll: 1 });
  const jet = fly(fighter(), 0.5, { roll: 1 });
  assert.ok(jet.bank > vela.bank * 3, `fighter ${jet.bank} vs Vela ${vela.bank}`);
  assert.ok(new Vector3(0, 0, -1).applyQuaternion(jet.quaternion).x > 0);
  const velaPitch = fly(new FlightController(() => 78), 1, { pitch: 1 }).pitch;
  const jetPitch = fly(fighter(), 1, { pitch: 1 }).pitch;
  assert.ok(jetPitch > velaPitch * 2);
  // Sustained turn performance, now flown with bank and pull, is covered in aerobatics.test.js.
});

test('turbine spool lags the lever and full-power takeoff rotates near 132 kt without a speed jump', () => {
  const flight = fighter();
  const state = flight.runwayStart(900, 80.8, -1350);
  state.throttle = 1;
  fly(flight, 1);
  assert.ok(state.spool > 0.3 && state.spool < 0.65, `spool after 1 s: ${state.spool}`);
  const flight2 = fighter();
  const s = flight2.runwayStart(900, 80.8, -1350);
  let liftoff = 0, previous = 0, maxStep = 0;
  for (let i = 0; i < 60 * 40; i++) {
    // Full back stick to rotate, then ease off: with no pitch limit a held pull would go on into a loop.
    flight2.update(1 / 60, { throttle: 1, pitch: s.grounded || s.pitch < 0.25 ? 1 : 0 });
    maxStep = Math.max(maxStep, s.speed - previous);
    previous = s.speed;
    if (!s.grounded && !liftoff) liftoff = s.speed;
    if (liftoff && s.position.y > 300) break;
  }
  assert.ok(knots(liftoff) > 125 && knots(liftoff) < 145, `liftoff ${knots(liftoff)} kt`);
  assert.ok(s.distance < 1200);
  // Thrust-limited on the roll and through liftoff: no jump to the airborne thrust target.
  assert.ok(maxStep * 60 < FLEET.fighter.flight.maxAcceleration + 0.01, `acceleration ${maxStep * 60} m/s²`);
  assert.equal(s.crashed, false);
  assert.ok(s.position.y > 300);
});

test('fighter liftoff needs 1,000 m of runway at most, and idle power decays into a stall', () => {
  const flight = fighter();
  const state = flight.runwayStart(900, 80.8, -1350);
  while (state.grounded && state.flightTime < 60) flight.update(1 / 60, { throttle: 1, pitch: 1 });
  assert.ok(state.distance < 600, `roll ${state.distance} m`);

  const glide = fighter();
  glide.state.throttle = 0;
  let stalledAt = 0;
  for (let i = 0; i < 60 * 60 && !stalledAt; i++) { glide.update(1 / 60); if (glide.state.stalled) stalledAt = i / 60; }
  assert.ok(stalledAt > 4, `stalled after ${stalledAt} s`);
  assert.ok(knots(glide.state.speed) < 112);
  fly(glide, 2);
  assert.ok(glide.state.pitch < -0.05);
});

test('a gear-down, full-flap fighter approach is flyable below the touchdown limit and lands', () => {
  const f = FLEET.fighter.flight;
  const approach = fighter();
  Object.assign(approach.state, { gearDown: true, flaps: 2, throttle: 0.26, spool: 0.26 });
  fly(approach, 40);
  assert.equal(approach.state.stalled, false);
  assert.ok(knots(approach.state.speed) > 125 && knots(approach.state.speed) < 145, `approach ${knots(approach.state.speed)} kt`);
  assert.ok(approach.state.speed < f.maxTouchdownSpeed);

  const fast = fighter();
  fast.state.position.y = 80.81;
  Object.assign(fast.state, { speed: f.maxTouchdownSpeed + 2, gearDown: true, verticalSpeed: -1, pitch: -0.02 });
  fly(fast, 0.2);
  assert.equal(fast.state.crashed, true);

  const hard = fighter();
  hard.state.position.y = 80.81;
  Object.assign(hard.state, { speed: 65, gearDown: true, verticalSpeed: -(f.maxTouchdownSink + 1.5), pitch: -0.02 });
  fly(hard, 0.2);
  assert.equal(hard.state.crashed, true);
  assert.equal(hard.state.crashReason, 'Hard landing');

  const flight = fighter();
  const state = flight.state;
  state.position.y = 80.81;
  Object.assign(state, { speed: 66, throttle: 0.3, spool: 0.3, gearDown: true, flaps: 2, verticalSpeed: -2.5, pitch: -0.02 });
  fly(flight, 0.2);
  assert.equal(state.grounded, true);
  assert.equal(state.crashed, false);
  state.throttle = 0;
  const before = state.distance;
  fly(flight, 40);
  assert.ok(state.speed < 0.01);
  assert.ok(state.distance - before < 700, `rollout ${state.distance - before} m`);
});

test('fighter sound rises with spool and airspeed, and the afterburner deepens and loudens it', () => {
  const idle = fighterSound(0, 0), cruise = fighterSound(0.72, 144), full = fighterSound(1, 200);
  for (const key of ['whine', 'whineGain', 'roar', 'roarGain', 'rumbleGain', 'master', 'wind']) {
    assert.ok(idle[key] < cruise[key] && cruise[key] < full[key], key);
  }
  assert.ok(idle.whineGain > 0 && idle.master > 0.5, 'idle turbine stays audible');
  const burner = fighterSound(1, 200, true);
  assert.equal(full.burnerGain, 0);
  assert.ok(burner.burnerGain > 0 && burner.master > full.master);
  assert.deepEqual(fighterSound(Number.NaN, -5), fighterSound(0, 0));
});

test('fighter model is propeller-free, sits on the same wheel height, and animates gear, flaps and controls', () => {
  const vela = createAircraft();
  const aircraft = createAircraft('fighter');
  assert.match(aircraft.group.name, /Arolla F7/);
  assert.match(vela.group.name, /Vela J8/);
  let meshes = 0;
  aircraft.group.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes < 120, `meshes ${meshes}`);

  const state = { gearDown: true, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 0, grounded: true, flightTime: 0 };
  aircraft.update(1 / 60, 0, state);
  assert.equal(aircraft.gearPosition, 1);
  aircraft.group.updateMatrixWorld(true);
  let lowest = Infinity;
  aircraft.group.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    o.geometry.computeBoundingBox();
    lowest = Math.min(lowest, o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).min.y);
  });
  assert.ok(Math.abs(lowest + 1.87) < 0.02, `wheels at ${lowest}`);

  Object.assign(state, { grounded: false, gearDown: false, flightTime: 10, speed: 140 });
  for (let i = 0; i < 90; i++) aircraft.update(1 / 60, 0.7, state);
  assert.ok(aircraft.gearPosition > 0.4 && aircraft.gearPosition < 0.6, `gear ${aircraft.gearPosition}`);
  for (let i = 0; i < 120; i++) aircraft.update(1 / 60, 0.7, state);
  assert.equal(aircraft.gearPosition, 0);

  state.flaps = 2;
  for (let i = 0; i < 200; i++) aircraft.update(1 / 60, 0.7, state);
  assert.ok(aircraft.surfaces.flaps.every(a => Math.abs(a + 0.6) < 1e-6), 'flaperons droop 0.6 rad');

  for (let i = 0; i < 20; i++) { state.bank += 0.02; state.pitch += 0.005; aircraft.update(1 / 60, 0.7, state); }
  const [down, up] = [...aircraft.surfaces.ailerons].sort((a, b) => a - b);
  assert.ok(down < -0.05 && up > 0.05, 'ailerons deflect opposite');
  assert.ok(aircraft.surfaces.elevators.every(a => a > 0.02), 'stabilators lift to pitch up');
  assert.equal(aircraft.surfaces.rudder.length, 2);

  state.afterburner = true; state.spool = 1;
  for (let i = 0; i < 60; i++) aircraft.update(1 / 60, 1, state);
  assert.ok(aircraft.afterburner > 0.99);
  aircraft.dispose();
});

test('each aircraft has its own cockpit', () => {
  assert.match(createCockpit().name, /Vela J8/);
  assert.match(createCockpit('fighter').name, /Arolla F7/);
});

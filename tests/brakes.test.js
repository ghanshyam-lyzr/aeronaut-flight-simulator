import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, BRAKE_DECELERATION, brakeDeceleration } from '../src/flight.js';
import { FlightInputs, TRAVEL } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { airportById, runwayDirection } from '../src/airports.js';
import { missionAvailability } from '../src/airport-selection.js';
import { TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { rollout, land } from '../scripts/measure-brakes.js';

const FIXED_WING = Object.keys(FLEET).filter(id => !FLEET[id].flight.rotorcraft);
const ROTORCRAFT = Object.keys(FLEET).filter(id => FLEET[id].flight.rotorcraft);
const rates = [10, 30, 60, 120];

function grounded(id, speed, spool = 0) {
  const flight = new FlightController(() => 78, id), s = flight.runwayStart(0, 78 + (FLEET[id].groundClearance ?? 2.8), 0);
  Object.assign(s, { speed, throttle: spool, spool });
  return flight;
}
function drive(flight, input, from, to, rate = 120, each = () => {}) {
  for (let t = from; t < to - 1e-9;) {
    t = Math.min(to, t + 1 / rate);
    input.advance(t, (dt, c) => { const before = flight.state.speed; flight.update(dt, c); each(dt, c, before); });
  }
}
const snapshot = s => ({ position: s.position.toArray(), speed: s.speed, heading: s.heading, pitch: s.pitch, bank: s.bank,
  verticalSpeed: s.verticalSpeed, grounded: s.grounded, throttle: s.throttle, spool: s.spool, crashed: s.crashed });

test('every fixed-wing type has bounded brakes; heavier types brake gentler and need more runway', () => {
  for (const id of FIXED_WING) {
    const a = brakeDeceleration(FLEET[id]);
    assert.equal(a, BRAKE_DECELERATION[id], `${id} is tuned explicitly`);
    assert.ok(a >= 2 && a <= 3.5, `${id}: ${a} m/s²`);
  }
  for (const id of ROTORCRAFT) assert.equal(brakeDeceleration(FLEET[id]), 0);
  assert.ok(brakeDeceleration(FLEET.trainer) > brakeDeceleration(FLEET.airliner));
  assert.ok(brakeDeceleration(FLEET.airliner) > brakeDeceleration(FLEET.widebody));
  const light = rollout('trainer'), large = rollout('widebody');
  assert.ok(large.distance > light.distance * 2.5, `widebody ${large.distance} m vs trainer ${light.distance} m`);
});

test('held brakes at idle stop every fixed-wing type in a shorter distance and time', () => {
  for (const id of FIXED_WING) {
    const free = rollout(id, { brake: 0 }), held = rollout(id);
    assert.ok(held.grounded && free.grounded);
    assert.ok(held.distance < free.distance * 0.8, `${id}: ${held.distance.toFixed(1)} vs ${free.distance.toFixed(1)} m`);
    assert.ok(held.time < free.time * 0.6, `${id}: ${held.time.toFixed(1)} vs ${free.time.toFixed(1)} s`);
  }
});

test('braking is continuous and bounded, reaches zero and never reverses, at any frame rate', () => {
  for (const id of ['trainer', 'widebody', 'biplane', 'fighter']) for (const rate of rates) {
    const flight = grounded(id, 25), input = new FlightInputs(0), a = brakeDeceleration(flight.type);
    input.set({ brake: 1 }, 0);
    let stoppedAt = null;
    drive(flight, input, 0, 20, rate, (dt, c, before) => {
      const s = flight.state;
      assert.ok(s.speed >= 0, 'never rolls backwards');
      assert.ok(c.brake >= 0 && c.brake <= 1);
      // Rolling resistance (≤ 0.35 · v) plus the brake (≤ a): no sudden stop in one step.
      assert.ok(before - s.speed <= (0.35 * before + a) * dt + 1e-9, `${id} @${rate} Hz: ${before} → ${s.speed}`);
      if (s.speed === 0 && stoppedAt === null) stoppedAt = input.time;
    });
    assert.ok(stoppedAt !== null && stoppedAt < 12, `${id} @${rate} Hz stops completely (${stoppedAt})`);
    assert.equal(flight.state.speed, 0, 'and stays stopped while held');
    assert.equal(flight.state.grounded, true);
  }
});

test('held brakes at low speed stop a taxiing aircraft and hold it against taxi power', () => {
  for (const id of ['trainer', 'jet', 'widebody', 'cargo']) {
    const free = grounded(id, 5, 0.3), held = grounded(id, 5, 0.3), off = new FlightInputs(0), on = new FlightInputs(0);
    on.set({ brake: 1 }, 0);
    drive(free, off, 0, 15); drive(held, on, 0, 15);
    assert.ok(free.state.speed > 1, `${id} taxi power keeps it rolling (${free.state.speed})`);
    assert.equal(held.state.speed, 0, `${id} brakes hold it`);
    assert.ok(held.state.distance < 40, `${id} stops within ${held.state.distance.toFixed(1)} m`);
    assert.equal(held.state.brake, 1);
  }
});

test('brakes come on gradually: a tap trims speed, not a sudden stop', () => {
  for (const rate of rates) for (const id of ['trainer', 'widebody']) {
    const tapped = grounded(id, 20), free = grounded(id, 20), input = new FlightInputs(0);
    input.set({ brake: 1 }, 0.011); input.set({}, 0.111);
    drive(tapped, input, 0, 1, rate); drive(free, new FlightInputs(0), 0, 1, rate);
    const lost = free.state.speed - tapped.state.speed;
    const expected = brakeDeceleration(FLEET[id]) * 0.1 ** 2 / (2 * TRAVEL.brake);
    assert.ok(lost > 0 && lost < expected * 1.01, `${id} @${rate} Hz lost ${lost} m/s`);
    assert.ok(lost < 0.05);
  }
  const input = new FlightInputs(0);
  input.set({ brake: 1 }, 0);
  for (let t = 0.1; t < 0.45; t += 0.1) input.advance(Math.min(t, 0.4), () => {});
  assert.ok(Math.abs(input.value.brake - 0.4 / TRAVEL.brake) < 1e-12, 'half applied after 0.4 s');
  for (let t = 0.5; t < 1.05; t += 0.1) input.advance(Math.min(t, 1), () => {});
  assert.equal(input.value.brake, 1);
});

test('release, cancellation and reset leave no brake applied', () => {
  for (const rate of rates) {
    const flight = grounded('jet', 30), input = new FlightInputs(0);
    input.set({ brake: 1 }, 0);
    drive(flight, input, 0, 1.5, rate);
    assert.equal(flight.state.brake, 1);
    input.set({}, 1.5);
    drive(flight, input, 1.5, 1.5 + 1 / rate, rate, (_dt, c) => assert.equal(c.brake, 0, 'release is immediate'));
    assert.equal(flight.state.brake, 0); assert.equal(input.value.brake, 0);
    // Matching unbraked state afterwards: no residual drag.
    const twin = grounded('jet', flight.state.speed); Object.assign(twin.state, { heading: flight.state.heading });
    drive(flight, input, 1.5 + 1 / rate, 3, rate); drive(twin, new FlightInputs(1.5 + 1 / rate), 1.5 + 1 / rate, 3, rate);
    assert.ok(Math.abs(flight.state.speed - twin.state.speed) < 1e-9);
  }
  // Blur, pause, dialogs, pointer loss and aircraft switches call FlightInputs.reset (main.js clearControls).
  const input = new FlightInputs(0);
  input.set({ brake: 1, throttle: -1 }, 0);
  input.advance(1, () => {});
  input.reset(1);
  input.advance(1.1, (_dt, c) => assert.equal(c.brake, 0));
  assert.equal(input.value.brake, 0);
  // Negative or invalid brake values are no brake; it is one-sided.
  const odd = new FlightInputs(0);
  odd.set({ brake: -1 }, 0); odd.advance(0.5, (_dt, c) => assert.equal(c.brake, 0));
  odd.set({ brake: 'x' }, 0.5); odd.advance(1, (_dt, c) => assert.equal(c.brake, 0));
  // Switching aircraft starts the new type with nothing applied.
  const flight = grounded('trainer', 10), held = new FlightInputs(0);
  held.set({ brake: 1 }, 0); drive(flight, held, 0, 1);
  assert.equal(flight.setAircraft('widebody').brake, 0);
});

test('brakes have no effect in the air, on helicopters, or on axis response settings', () => {
  for (const id of [...FIXED_WING, ...ROTORCRAFT]) {
    const a = new FlightController(() => 78, id), b = new FlightController(() => 78, id);
    for (const f of [a, b]) f.state.autopilot = false;
    const plain = new FlightInputs(0), braking = new FlightInputs(0);
    plain.set({ pitch: -0.2, roll: 0.3 }, 0); braking.set({ pitch: -0.2, roll: 0.3, brake: 1 }, 0);
    drive(a, plain, 0, 4); drive(b, braking, 0, 4);
    assert.deepEqual(snapshot(b.state), snapshot(a.state), `${id} airborne`);
    assert.equal(b.state.brake, 0);
  }
  for (const id of ROTORCRAFT) {
    const a = new FlightController(() => 78, id), b = new FlightController(() => 78, id);
    a.runwayStart(0, 80, 0); b.runwayStart(0, 80, 0);
    const plain = new FlightInputs(0), braking = new FlightInputs(0);
    plain.set({ throttle: 1 }, 0); braking.set({ throttle: 1, brake: 1 }, 0);
    drive(a, plain, 0, 10); drive(b, braking, 0, 10);
    assert.deepEqual(snapshot(b.state), snapshot(a.state), `${id} lifts off exactly as before`);
  }
  // Saved response tunes the four flight axes only; the brake ramp is fixed.
  for (const response of [0.5, 2]) {
    const input = new FlightInputs(0, { pitch: response, roll: response, yaw: response, throttle: response, brake: response });
    input.set({ brake: 1 }, 0); input.advance(0.2, () => {});
    assert.ok(Math.abs(input.value.brake - 0.2 / TRAVEL.brake) < 1e-12);
    assert.equal(input.travel.pitch, TRAVEL.pitch / response);
  }
});

test('unbraked takeoff runs are unchanged, and a released brake leaves the takeoff normal', () => {
  for (const id of FIXED_WING) {
    const a = grounded(id, 0), b = grounded(id, 0), plain = new FlightInputs(0), zero = new FlightInputs(0);
    const rotate = s => s.speed > FLEET[id].flight.rotateSpeed - 3 ? 1 : 0;
    for (let frame = 1; frame < 90 * 60 && (a.state.grounded || a.state.position.y < 120); frame++) {
      plain.set({ throttle: 1, pitch: rotate(a.state) }, (frame - 1) / 60);
      zero.set({ throttle: 1, pitch: rotate(b.state), brake: 0 }, (frame - 1) / 60);
      plain.advance(frame / 60, (dt, c) => a.update(dt, c)); zero.advance(frame / 60, (dt, c) => b.update(dt, c));
    }
    assert.deepEqual(snapshot(b.state), snapshot(a.state), `${id}: brake 0 is the original model`);
    assert.equal(a.state.crashed, false); assert.ok(a.state.position.y >= 120, `${id} climbs away`);
  }
  // Held brakes during the first seconds of a run-up, then released: the aircraft still rotates and climbs.
  for (const id of ['trainer', 'jet', 'widebody']) {
    const flight = grounded(id, 0), input = new FlightInputs(0), s = flight.state;
    input.set({ throttle: 1, brake: 1 }, 0);
    drive(flight, input, 0, 2);
    const heldDistance = s.distance;
    for (let frame = 121; frame < 120 * 60 && (s.grounded || s.position.y < 120); frame++) {
      input.set({ throttle: 1, pitch: s.speed > flight.type.flight.rotateSpeed - 3 ? 1 : 0 }, (frame - 1) / 60);
      input.advance(frame / 60, (dt, c) => flight.update(dt, c));
    }
    assert.ok(heldDistance < 15, `${id} held near the threshold while spooling (${heldDistance.toFixed(1)} m)`);
    assert.equal(s.crashed, false); assert.ok(s.position.y >= 120);
  }
});

test('scored landings succeed with brakes on both runway directions, light and large, with shorter rollouts', () => {
  const cases = [['trainer', 'alpine-field'], ['jet', 'alpine-field'], ['biplane', 'verdance-meadow'], ['widebody', 'orvane-regional'], ['airliner', 'orvane-regional']];
  for (const [id, airport] of cases) {
    const a = airportById(airport);
    assert.ok(missionAvailability(a, id).available, `${id} may land at ${airport}`);
    for (const rw of [a.runway, a.reciprocal]) {
      const field = runwayDirection(a, rw), free = land(id, field, false), braked = land(id, field, true);
      for (const r of [free, braked]) {
        assert.equal(r.mission.status, 'success', `${id} ${airport} ${rw}: ${JSON.stringify(r.mission.snapshot())}`);
        assert.ok(r.mission.touchdown.along >= TOUCHDOWN_ZONE.start && r.mission.touchdown.along <= TOUCHDOWN_ZONE.end);
        assert.ok(r.mission.touchdown.sink < r.mission.profile.maxSink);
        assert.equal(r.s.crashed, false);
      }
      assert.ok(braked.rollout < free.rollout * 0.95, `${id} ${rw}: braked ${braked.rollout.toFixed(0)} m vs ${free.rollout.toFixed(0)} m`);
      assert.ok(braked.time < free.time, `${id} ${rw}: mission completes sooner`);
    }
  }
  assert.equal(AIRFIELD.runway, '36');
  assert.ok(runwayPoint(0).z !== undefined);
});

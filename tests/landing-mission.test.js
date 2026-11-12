import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { AIRFIELD, runwayCoordinates, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { groundHeight } from '../src/world.js';

const dt = 1 / 120;
const ROTORCRAFT = Object.keys(FLEET).filter(id => FLEET[id].flight.rotorcraft);
function attempt(id = 'jet') {
  const flight = new FlightController(groundHeight, id), mission = new LandingMission();
  mission.start(flight);
  return { flight, mission, s: flight.state };
}
function touchdown(flight, mission, overrides = {}) {
  const s = flight.state, p = runwayPoint(TOUCHDOWN_ZONE.aim);
  const telemetry = { position: { ...p, y: AIRFIELD.elevation + mission.profile.clearance },
    speed: 50, sink: 1.5, heading: 0, bank: 0, pitch: 0, gearDown: true, flaps: 2,
    stalled: false, time: 5, ...overrides };
  s.position.set(telemetry.position.x, telemetry.position.y, telemetry.position.z);
  Object.assign(s, { touchdown: telemetry, grounded: true, speed: telemetry.speed, flightTime: 5 });
  mission.update(dt, s);
}
function settle(flight, mission, seconds = 2.1) {
  Object.assign(flight.state, { throttle: 0, speed: 0 });
  for (let i = 0; i < seconds / dt; i++) mission.update(dt, flight.state);
}

for (const id of Object.keys(FLEET)) {
  test(`${id}: repeatable start uses real airfield, safe clearance and appropriate configuration`, () => {
    const { flight, mission, s } = attempt(id), profile = landingProfile(flight.type);
    const initial = { position: s.position.toArray(), speed: s.speed, power: s.throttle };
    assert.equal(s.heading, AIRFIELD.heading);
    assert.equal(s.gearDown, true); assert.equal(s.autopilot, false);
    assert.equal(s.flaps, profile.flaps);
    assert.equal(runwayCoordinates(s.position).cross, 0);
    assert.ok(s.position.y > groundHeight(s.position.x, s.position.z) + 5);
    if (!profile.helicopter) assert.ok(s.speed > flight.type.flight.stallSpeed - 2 * flight.type.flight.flapStallGain);
    Object.assign(s, { crashed: true, throttle: 1, autopilot: true, flaps: 0, gearDown: false });
    mission.start(flight);
    assert.deepEqual({ position: s.position.toArray(), speed: s.speed, power: s.throttle }, initial);
    assert.equal(s.touchdown, null); assert.equal(s.crashed, false); assert.equal(mission.stableTime, 0);
  });

  test(`${id}: pilot can fly, flare, touch down and stop on actual terrain with normal controls`, () => {
    const { flight, mission, s } = attempt(id), p = mission.profile;
    // Deterministic feedback pilot: ordinary rate inputs, no pose/velocity writes after mission start.
    const inputs = new FlightInputs(0);
    for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
      if (frame === 300 && flight.type.fixedGear) { flight.toggleGear(); assert.equal(s.gearDown, true); }
      if (frame === 300 && flight.type.noFlaps) { flight.cycleFlaps(); assert.equal(s.flaps, 0); }
      const height = s.position.y - AIRFIELD.elevation - p.clearance;
      const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
      const idleSink = p.helicopter ? 0 : Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
      const desiredPitch = p.helicopter ? 0 : Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
      inputs.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded || (p.helicopter && s.throttle > p.throttle - 0.03) ? -1 : 0 }, (frame - 1) / 60);
      inputs.advance(frame / 60, (step, controls) => { if (!mission.active) return; flight.update(step, controls); mission.update(step, s); });
    }
    assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
    assert.equal(s.crashed, false); assert.ok(s.speed < 3);
    assert.ok(mission.touchdown.sink > 0.3 && mission.touchdown.sink < p.maxSink);
    assert.ok(mission.touchdown.along >= TOUCHDOWN_ZONE.start && mission.touchdown.along <= TOUCHDOWN_ZONE.end);
    assert.ok(mission.guidance(s).remaining > 100);
    assert.ok(p.helicopter || mission.touchdown.speed > p.speed * 0.75, 'impact speed retained after rollout');
  });
}

test('world terrain is flat under the actual runway and runway coordinates rotate correctly', () => {
  for (const along of [0, 60, 220, 550, 1100]) {
    const point = runwayPoint(along);
    assert.equal(groundHeight(point.x, point.z), AIRFIELD.elevation);
    assert.deepEqual(runwayCoordinates(point), { along, cross: 0 });
  }
  const field = { ...AIRFIELD, heading: Math.PI / 3 };
  const point = runwayPoint(320, 9, field), local = runwayCoordinates(point, field);
  assert.ok(Math.abs(local.along - 320) < 1e-10 && Math.abs(local.cross - 9) < 1e-10);
});

test('safe touchdown begins rollout; completion needs two continuous settled seconds', () => {
  const { flight, mission } = attempt(); touchdown(flight, mission);
  assert.equal(mission.phase, 'rollout'); assert.equal(mission.status, 'flying');
  settle(flight, mission, 1); assert.equal(mission.status, 'flying');
  flight.state.throttle = 0.5; mission.update(1, flight.state); assert.equal(mission.stableTime, 0);
  settle(flight, mission, 1); assert.equal(mission.status, 'flying');
  settle(flight, mission, 1.1); assert.equal(mission.status, 'success');
  const result = mission.snapshot();
  flight.state.crashed = true; mission.update(10, flight.state);
  assert.deepEqual(mission.snapshot(), result, 'terminal outcome cannot award or change twice');
});

for (const [label, overrides, reason] of [
  ['off runway', { position: { ...runwayPoint(220, 40), y: 80.8 } }, 'outside the runway'],
  ['before threshold', { position: { ...runwayPoint(-10), y: 80.8 } }, 'outside the runway'],
  ['past far end', { position: { ...runwayPoint(1120), y: 80.8 } }, 'outside the runway'],
  ['before touchdown zone', { position: { ...runwayPoint(20), y: 80.8 } }, 'touchdown zone'],
  ['long landing', { position: { ...runwayPoint(600), y: 80.8 } }, 'touchdown zone'],
  ['hard touchdown', { sink: 3 }, 'Unsafe'],
  ['fast touchdown', { speed: 68 }, 'Unsafe'],
  ['stalled touchdown', { stalled: true }, 'Unsafe'],
  ['gear up', { gearDown: false }, 'gear'],
  ['flaps retracted', { flaps: 0 }, 'flaps'],
  ['wrong direction', { heading: Math.PI }, 'aligned'],
  ['excess bank', { bank: 0.25 }, 'level'],
  ['nose down', { pitch: -0.3 }, 'level'],
]) {
  test(`rejects ${label} and cannot recover into success without retry`, () => {
    const { flight, mission } = attempt(); touchdown(flight, mission, overrides);
    assert.equal(mission.status, 'failed'); assert.match(mission.reason, new RegExp(reason));
    settle(flight, mission, 5); assert.equal(mission.status, 'failed');
    mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(mission.touchdown, null);
  });
}

for (const [label, mutate, reason] of [
  ['overrun', s => Object.assign(s.position, runwayPoint(1101)), 'overrun'],
  ['runway excursion', s => Object.assign(s.position, runwayPoint(500, 27)), 'Left the runway'],
  ['takeoff after contact', s => { s.grounded = false; }, 'Keep the aircraft'],
  ['retracted gear', s => { s.gearDown = false; }, 'gear down'],
  ['post-contact crash', s => { s.crashed = true; }, 'crashed'],
]) {
  test(`rollout rejects ${label} before a stop can count`, () => {
    const { flight, mission } = attempt(); touchdown(flight, mission);
    mutate(flight.state); settle(flight, mission);
    assert.equal(mission.status, 'failed'); assert.match(mission.reason, new RegExp(reason));
  });
}

test('every helicopter needs its landing box and rejects excessive lateral speed', () => {
  assert.deepEqual(ROTORCRAFT, ['helicopter', 'transport']);
  for (const id of ROTORCRAFT) for (const overrides of [{ position: { ...runwayPoint(280), y: 79.6 }, speed: 0 }, { speed: FLEET[id].flight.maxTouchdownSpeed }]) {
    const { flight, mission } = attempt(id); touchdown(flight, mission, overrides);
    assert.equal(mission.status, 'failed', id);
    if (overrides.position) assert.equal(mission.reason, `Land the ${FLEET[id].landingGear ?? 'skids'} inside the target box`);
  }
});

test('every helicopter settles only below its own hover collective', () => {
  for (const id of ROTORCRAFT) {
    const { flight, mission } = attempt(id), hover = FLEET[id].flight.hoverCollective;
    touchdown(flight, mission, { speed: 0, sink: 1 });
    Object.assign(flight.state, { speed: 0, throttle: hover });
    for (let i = 0; i < 3 / dt; i++) mission.update(dt, flight.state);
    assert.equal(mission.status, 'flying', `${id}: hover collective is not settled`);
    flight.state.throttle = hover - 0.02;
    for (let i = 0; i < 2.1 / dt; i++) mission.update(dt, flight.state);
    assert.equal(mission.status, 'success', id);
  }
});

test('real crash retains impact sink/speed before physics zeroes them; retry clears telemetry', () => {
  for (const id of ['jet', ...ROTORCRAFT]) {
    const { flight, mission, s } = attempt(id), p = runwayPoint(220);
    s.position.set(p.x, 78 + mission.profile.clearance + 0.01, p.z);
    s.verticalSpeed = -8; s.velocity.set(0, -8, 0);
    flight.update(dt); mission.update(dt, s);
    assert.equal(s.crashed, true); assert.equal(mission.status, 'failed');
    assert.ok(mission.touchdown.sink > 7); assert.equal(s.verticalSpeed, 0);
    mission.start(flight); assert.equal(s.touchdown, null); assert.equal(mission.touchdown, null);
  }
});

test('cancellation, reset and aircraft switch clear stale progress; idle ignores ground contact', () => {
  const { flight, mission, s } = attempt(); touchdown(flight, mission); settle(flight, mission, 1);
  mission.cancel(); mission.update(10, s); assert.equal(mission.status, 'idle'); assert.equal(mission.touchdown, null);
  mission.start(flight); flight.update(dt); mission.update(dt, s);
  flight.reset(); mission.update(dt, s); assert.equal(mission.status, 'idle');
  mission.start(flight); flight.setAircraft('fighter'); mission.update(dt, s); assert.equal(mission.status, 'idle');
  mission.start(flight); assert.equal(mission.aircraft, 'fighter'); assert.equal(mission.stableTime, 0);
});

test('paused/no-time updates cannot settle a rollout; missed airborne runway fails', () => {
  const { flight, mission, s } = attempt(); touchdown(flight, mission); s.speed = 0; s.throttle = 0;
  for (const noTime of [0, -1, NaN]) mission.update(noTime, s);
  assert.equal(mission.stableTime, 0); assert.equal(mission.status, 'flying');
  mission.start(flight); Object.assign(s.position, runwayPoint(1110)); mission.update(dt, s);
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /Runway passed/);
});

test('heading wrap at north and offset runway position use absolute alignment', () => {
  const { flight, mission } = attempt(); touchdown(flight, mission, { heading: Math.PI * 2 - 0.05 });
  assert.equal(mission.status, 'flying'); assert.ok(mission.touchdown.alignment < 3);
  const snapshot = mission.snapshot(); snapshot.touchdown.position.x = 0;
  assert.equal(mission.touchdown.position.x, AIRFIELD.x, 'diagnostic snapshot does not expose mission position');
});


for (const id of ROTORCRAFT) test(`${id} begins in a true hover and requires a collective input to descend`, () => {
  const { flight, mission, s } = attempt(id), initialHeight = s.position.y;
  for (let i = 0; i < 10 / dt; i++) { flight.update(dt); mission.update(dt, s); }
  assert.equal(mission.status, 'flying'); assert.equal(s.grounded, false);
  assert.ok(Math.abs(s.position.y - initialHeight) < 0.01);
  for (let i = 0; i < 0.15 / dt; i++) { flight.update(dt, { throttle: -1 }); mission.update(dt, s); }
  for (let i = 0; i < 2 / dt; i++) { flight.update(dt); mission.update(dt, s); }
  assert.ok(s.position.y < initialHeight - 0.3);
});

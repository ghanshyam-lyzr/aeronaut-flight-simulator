import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from 'three';
import { FLEET } from '../src/fleet.js';
import { FlightController, airlinerSound, jetSound, FlightAudio } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { disposeObject } from '../src/helicopter.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';

const f = FLEET.airliner.flight, knots = v => v * 1.94384;
const airliner = () => new FlightController(() => 78, 'airliner');
function fly(flight, seconds, inputs = {}) {
  for (let i = 0; i < seconds * 60; i++) flight.update(1 / 60, inputs);
  return flight.state;
}

test('737 switch, reset and runway start keep type and clean the previous flight', () => {
  const flight = new FlightController(() => 78);
  fly(flight, 3, { pitch: 0.5 });
  Object.assign(flight.state, { flaps: 2, gearDown: true, crashed: true });
  flight.setAircraft('airliner');
  assert.equal(flight.state.aircraft, 'airliner');
  assert.equal(flight.state.speed, 128);
  assert.equal(flight.state.flaps, 0);
  assert.equal(flight.state.gearDown, false);
  assert.equal(flight.state.crashed, false);
  flight.reset();
  assert.equal(flight.state.aircraft, 'airliner');
  flight.runwayStart(900, 82.53, -1350);
  fly(flight, 2);
  assert.equal(flight.state.speed, 0);
  assert.equal(flight.state.gearDown, true);
  assert.equal(flight.state.position.y, 82.53);
  flight.setAircraft('jet');
  assert.equal(flight.state.speed, FLEET.jet.flight.cruiseSpeed);
});

test('737 cruises near 250 knots and responds more deliberately than the light jet', () => {
  const flight = airliner(); flight.toggleAutopilot();
  const s = fly(flight, 30);
  assert.ok(knots(s.speed) > 240 && knots(s.speed) < 260);
  assert.ok(Math.abs(s.position.y - 620) < 1);
  for (const [axis, field] of [['pitch', 'pitch'], ['roll', 'bank'], ['yaw', 'heading']]) {
    const a = fly(airliner(), 0.5, { [axis]: 1 });
    const j = fly(new FlightController(() => 78), 0.5, { [axis]: 1 });
    assert.ok(a[field] > 0 && a[field] < j[field], axis);
  }
  const spool = airliner(); spool.runwayStart(900, 82.53, -1350); spool.state.throttle = 1;
  fly(spool, 1); assert.ok(spool.state.spool > 0.25 && spool.state.spool < 0.35);
  fly(spool, 6); assert.ok(spool.state.spool > 0.96);
});

test('737 with takeoff flaps rotates near 130 knots inside the game runway, without a speed jump', () => {
  const flight = airliner(), s = flight.runwayStart(900, 82.53, -1350);
  s.flaps = 1;
  let previous = 0, largestStep = 0;
  while (s.grounded && s.flightTime < 60) {
    flight.update(1 / 60, { throttle: 1, pitch: 1 });
    largestStep = Math.max(largestStep, s.speed - previous); previous = s.speed;
  }
  assert.equal(s.grounded, false);
  assert.ok(knots(s.speed) > 129 && knots(s.speed) < 132, knots(s.speed));
  assert.ok(s.distance < 1000, `game takeoff roll ${s.distance} m`);
  const liftoff = s.speed;
  fly(flight, 0.1, { throttle: 1 });
  assert.ok(s.speed - liftoff < 0.6);
  assert.ok(largestStep * 60 < f.maxAcceleration + 0.1);
  fly(flight, 8, { throttle: 1, pitch: 0.2 });
  assert.equal(s.crashed, false); assert.ok(s.position.y > 150);
});

test('737 full-flap approach stays near 140 knots, lands softly and rejects a hard/fast touchdown', () => {
  const approach = airliner(), s = approach.state;
  Object.assign(s, { gearDown: true, flaps: 2, throttle: 0.45, spool: 0.45 });
  fly(approach, 40);
  assert.equal(s.stalled, false);
  assert.ok(knots(s.speed) > 135 && knots(s.speed) < 145, knots(s.speed));
  s.position.y = 82.54; s.pitch = -0.025; s.verticalSpeed = -1.8; approach.setQuaternion();
  fly(approach, 0.2); assert.equal(s.grounded, true); assert.equal(s.crashed, false);
  s.throttle = 0; const before = s.distance;
  fly(approach, 40); assert.ok(s.speed < 0.01); assert.ok(s.distance - before < 900);
  for (const override of [{ speed: 85, verticalSpeed: -1 }, { speed: 70, verticalSpeed: -6 }]) {
    const hard = airliner(); hard.state.position.y = 82.54;
    Object.assign(hard.state, { gearDown: true, pitch: -0.02, ...override });
    fly(hard, 0.2); assert.equal(hard.state.crashed, true);
  }
});

test('737 stall is aircraft-specific and the existing 1000 ft/20% gear warning clears correctly', () => {
  const flight = airliner(), s = flight.state;
  Object.assign(s, { speed: 63, throttle: 0, spool: 0 });
  fly(flight, 0.1); assert.equal(s.stalled, true);
  fly(flight, 1); assert.ok(s.pitch < -0.1);
  flight.reset(); Object.assign(s, { speed: 58, flaps: 2, throttle: 0.45, spool: 0.45 });
  fly(flight, 0.1); assert.equal(s.stalled, false);
  Object.assign(s, { gearDown: false, throttle: 0.19 }); s.position.y = 78 + 304.7;
  assert.equal(flight.gearWarning, true);
  s.throttle = 0.2; assert.equal(flight.gearWarning, false);
  s.throttle = 0.19; s.position.y = 78 + 304.8; assert.equal(flight.gearWarning, false);
  s.position.y--; flight.toggleGear(); assert.equal(flight.gearWarning, false);
});

function tap(axis, sign, hz, duration = 0.1) {
  const flight = airliner(), input = new FlightInputs();
  Object.assign(flight.state, { speed: 72, flaps: 2, gearDown: true, throttle: 0.45, spool: 0.45, pitch: -0.035 });
  flight.setQuaternion();
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.7 - 1e-9;) {
    t = Math.min(1.7, t + 1 / hz); input.advance(t, (dt, controls) => flight.update(dt, controls));
  }
  return flight;
}
test('737 30/100ms taps survive low FPS on all four axes and remain fine corrections', () => {
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(axis, sign, 120, duration), baseline = tap(axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis];
    const difference = reference.state[field] - baseline.state[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < 0.012, `${axis}: ${delta}`);
    assert.equal(reference.state.stalled, false);
    for (const hz of [10, 15, 30, 60]) {
      const flight = tap(axis, sign, hz, duration);
      assert.ok(flight.state.quaternion.angleTo(reference.state.quaternion) < 0.0001);
      assert.ok(Math.abs(flight.state.throttle - reference.state.throttle) < 1e-12);
      assert.ok(Math.abs(flight.state.verticalSpeed - reference.state.verticalSpeed) < 0.001);
    }
  }
});

test('737 geometry follows the wingleted proportions, has two fans, and ground wheels meet the datum', () => {
  const a = createAircraft('airliner'); assert.match(a.group.name, /Boeing 737-800/);
  assert.notEqual(a.materials.teal.color.getHexString(), a.materials.paint.color.getHexString(), 'teal livery parses in Three.js');
  assert.ok(a.materials.glass.color.getHex() < a.materials.paint.color.getHex());
  const s = { gearDown: true, grounded: true, flaps: 0, flightTime: 0, bank: 0, pitch: 0, heading: 0 };
  a.update(0.01, 0, s); a.group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(a.group);
  assert.ok(Math.abs(box.max.z - box.min.z - 39.47) < 0.2);
  assert.ok(Math.abs(box.max.x - box.min.x - 35.79) < 0.2);
  assert.ok(Math.abs(box.max.y - box.min.y - 12.55) < 0.2);
  assert.ok(Math.abs(box.min.y + 3.6) < 0.01);
  assert.ok(Math.abs(FLEET.airliner.groundClearance + box.min.y - 0.925) < 0.01, 'tyres meet the raised runway surface');
  const fans = []; let meshes = 0;
  a.group.traverse(o => { if (o.isMesh) meshes++; if (o.name === 'turbofan fan') fans.push(o); });
  assert.equal(fans.length, 2); assert.ok(meshes < 140, `mesh budget ${meshes}`);
  const before = fans[0].rotation.z; a.update(0.1, 1, s); assert.ok(fans[0].rotation.z > before);
  Object.assign(s, { grounded: false, gearDown: false, flightTime: 10, flaps: 2 });
  for (let i = 0; i < 150; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.gearPosition > 0.49 && a.gearPosition < 0.51);
  for (let i = 0; i < 190; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.gearPosition < 1e-10);
  assert.ok(a.surfaces.flaps.every(a => Math.abs(a - Math.PI / 6) < 1e-6));
  assert.equal(a.surfaces.flaps.length, 4);
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0);
  assert.ok(a.surfaces.elevators.every(a => a < -0.1)); assert.ok(a.surfaces.rudder[0] > 0.05);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  let disposed = 0; a.materials.paint.addEventListener('dispose', () => disposed++);
  a.dispose(); assert.equal(disposed, 1, 'shared paint is disposed once');
  const cockpit = createCockpit('airliner'); assert.match(cockpit.name, /Boeing 737-800/); disposeObject(cockpit);
});

test('737 sound uses lower twin-turbofan tones and follows mute/pause/crash and bus switching', () => {
  const idle = airlinerSound(0, 0), full = airlinerSound(1, 140);
  assert.ok(full.whine < jetSound(1, 140).whine);
  for (const key of ['whine', 'fan', 'roar', 'roarGain', 'rumbleGain', 'wind', 'master']) assert.ok(full[key] > idle[key], key);
  assert.deepEqual(airlinerSound(NaN, -1), idle);
  const param = () => ({ value: null, setTargetAtTime(value) { this.value = value; } });
  const voice = () => ({ filter: { frequency: param() }, gain: { gain: param() } });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  audio.master = { gain: param() }; audio.gearHorn = { gain: param() };
  audio.jetBus = { gain: param() }; audio.fighterBus = { gain: param() }; audio.helicopterBus = { gain: param() };
  audio.whines = [1, 1.012].map(ratio => ({ osc: { frequency: param() }, ratio, gain: { gain: param() } }));
  audio.fan = { frequency: param() }; audio.fanVoice = voice(); audio.roar = voice(); audio.rumble = voice(); audio.wind = { gain: param() };
  const s = { aircraft: 'airliner', spool: 0.72, speed: 128 };
  audio.update(s, true);
  assert.equal(audio.jetBus.gain.value, 1); assert.equal(audio.fighterBus.gain.value, 0);
  assert.ok(audio.master.gain.value > 0); assert.equal(audio.gearHorn.gain.value, 0.12);
  assert.equal(audio.whines[0].osc.frequency.value, airlinerSound(0.72, 128).whine);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
  audio.enabled = false; audio.update(s, true); assert.equal(audio.master.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
});

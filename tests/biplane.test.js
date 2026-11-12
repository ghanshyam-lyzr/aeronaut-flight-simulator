import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { FLEET, aircraftType } from '../src/fleet.js';
import { FlightController, FlightAudio, propellerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { EXPANDED_AIRCRAFT } from '../src/fleet-models.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const type = FLEET.biplane, f = type.flight;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = (id = 'biplane') => new FlightController(groundHeight, id);

test('Alba B2 is a registered, uniquely identified fixed-gear, flapless piston biplane', () => {
  assert.equal(aircraftType('biplane'), type);
  assert.equal(type.name, 'Alba B2'); assert.equal(type.engine, 'piston');
  assert.equal(type.fixedGear, true); assert.equal(type.noFlaps, true); assert.equal(f.aerobatic, false);
  assert.ok(!EXPANDED_AIRCRAFT.includes('biplane'), 'own factory, not the shared fleet builder');
  for (const other of Object.values(FLEET)) if (other !== type) {
    assert.notEqual(other.registration, type.registration); assert.notEqual(other.name, type.name); assert.notEqual(other.badge, type.badge);
  }
  for (const key of Object.keys(FLEET.jet.flight)) assert.ok(key in f, key);
  // Cruise is the exact steady state of the existing model with the fixed gear's drag.
  assert.ok(Math.abs(f.idleSpeed + f.cruiseThrottle * f.thrustSpeed - f.gearDrag - f.cruiseSpeed) < 1e-9);
  // Help and hints state what the airframe actually has.
  for (const text of [type.help, type.runwayHint]) { assert.match(text, /fixed/i); assert.match(text, /no flaps/i); }
  assert.match(type.help, new RegExp(`${Math.round(type.landing.speed * 1.94384)} kt`));
  assert.match(type.help, new RegExp(`${Math.round(f.rotateSpeed * 1.94384)} kt`));
  assert.match(type.help, new RegExp(`${Math.round(f.maxTouchdownSpeed * 1.94384)} kt`));
});

test('flies slower and turns tighter than the trainer while keeping standard attitude limits', () => {
  assert.ok(f.cruiseSpeed < FLEET.trainer.flight.cruiseSpeed && f.stallSpeed < FLEET.trainer.flight.stallSpeed);
  assert.ok(f.rollRate > FLEET.trainer.flight.rollRate && f.bankLimit > FLEET.trainer.flight.bankLimit);
  const turned = id => { const flight = flying(id); flight.state.autopilot = false; const s = run(flight, 8, { roll: 1 }); return { s, heading: s.heading }; };
  const bi = turned('biplane'), trainer = turned('trainer');
  assert.ok(Math.abs(bi.s.bank) <= f.bankLimit + 1e-9);
  const angle = h => Math.abs(Math.atan2(Math.sin(h), Math.cos(h)));
  assert.ok(angle(bi.heading) > angle(trainer.heading), `${bi.heading} vs ${trainer.heading}`);
  const flight = flying(); run(flight, 6, { pitch: 1 }); assert.ok(flight.state.pitch <= f.pitchLimits[1] + 1e-9);
});

test('selection/reset, steady cruise and a real-runway takeoff with gradual normal inputs', () => {
  const flight = flying('fighter'); run(flight, 1, { roll: 1 });
  flight.setAircraft('biplane'); const s = flight.state;
  assert.equal(s.aircraft, 'biplane'); assert.equal(s.speed, f.cruiseSpeed);
  assert.equal(s.gearDown, true); assert.equal(s.flaps, 0); assert.equal(s.touchdown, null);
  run(flight, 20);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  const p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + type.groundClearance, p.z);
  flight.cycleFlaps(); assert.equal(s.flaps, 0);
  let previous = 0, largest = 0;
  for (let frame = 1; frame < 60 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.ok(s.distance < 400, `takeoff roll ${s.distance}`); assert.ok(s.speed >= f.rotateSpeed);
  assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
  run(flight, 6, { throttle: 1 }); assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > AIRFIELD.elevation + 20);
  flight.reset(); assert.equal(s.aircraft, 'biplane'); assert.equal(s.flightTime, 0);
});

test('clean stall at its own threshold, nose drop and power recovery', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 45 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  run(flight, 0.8); assert.ok(s.pitch < -0.1); assert.equal(s.crashed, false);
  for (let i = 0; i < 30 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false);
});

test('fixed gear and absent flaps cannot be toggled and never sound a gear warning', () => {
  const flight = flying(), s = flight.state;
  s.position.set(900, 100, -1800); s.throttle = 0.05;
  assert.equal(flight.gearWarning, false);
  assert.equal(flight.toggleGear(), true); assert.equal(s.gearDown, true);
  for (let i = 0; i < 3; i++) { assert.equal(flight.cycleFlaps(), 0); assert.equal(s.flaps, 0); }
  const profile = landingProfile(type);
  assert.equal(profile.flaps, 0); assert.equal(profile.speed, type.landing.speed); assert.equal(profile.clearance, type.groundClearance);
  assert.ok(profile.speed - 5 > f.stallSpeed, 'approach band stays above the stall');
  assert.ok(profile.throttle > 0.32 && profile.throttle < 0.6, `approach power ${profile.throttle}`);
});

test('landing mission: normal-input approach succeeds, hard landing fails and retries cleanly', () => {
  const flight = flying(), mission = new LandingMission(), s = flight.state, inputs = new FlightInputs(0);
  mission.start(flight); const p = mission.profile;
  assert.equal(s.flaps, 0); assert.equal(s.gearDown, true); assert.equal(s.speed, type.landing.speed);
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - AIRFIELD.elevation - p.clearance;
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const idleSink = Math.max(0, 0.32 - s.spool) * 6, desired = Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    inputs.set({ pitch: (desired - s.pitch) * 4, throttle: s.grounded ? -1 : 0 }, (frame - 1) / 60);
    inputs.advance(frame / 60, (step, c) => { if (!mission.active) return; flight.update(step, c); mission.update(step, s); });
  }
  assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
  const t = mission.touchdown;
  assert.ok(t.along >= TOUCHDOWN_ZONE.start && t.along <= TOUCHDOWN_ZONE.end && t.sink < p.maxSink && t.flaps === 0);
  assert.ok(mission.guidance(s).remaining > 400, 'a slow biplane stops well inside the runway');

  const hard = new FlightInputs(); mission.start(flight);
  for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
    hard.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
    hard.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); });
  }
  assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown.sink > f.maxTouchdownSink);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(s.crashed, false); assert.equal(mission.touchdown, null);
});

function tap(axis, sign, hz, duration) {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs(); mission.start(flight);
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.6 - 1e-9;) { t = Math.min(1.6, t + 1 / hz); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return flight.state;
}
test('brief 30/100 ms key taps stay small and frame-rate independent on every axis', () => {
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(axis, sign, 120, duration), baseline = tap(axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis], difference = reference[field] - baseline[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < (axis === 'roll' ? 0.035 : 0.015), `${axis} ${duration}: ${delta}`);
    assert.equal(reference.crashed, false); assert.equal(reference.stalled, false);
    for (const hz of [10, 30, 60]) { const s = tap(axis, sign, hz, duration);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 1e-4); assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12); }
  }
});

test('stacked wings, struts, propeller, fixed tailwheel gear, moving surfaces and disposal', () => {
  const a = createAircraft('biplane'), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
  assert.match(a.group.name, /Alba B2/);
  a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 8.5 && size.x < 9.2, `span ${size.x}`); assert.ok(size.z > 7.2 && size.z < 8, `length ${size.z}`); assert.ok(box.max.y < 1.3, `nothing rises above the upper wing: ${box.max.y}`);
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
  let meshes = 0, triangles = 0; const rotors = [], tyres = [], gears = [];
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
    if (o.name === 'propeller') rotors.push(o); if (o.name === 'tyre') tyres.push(o); if (/^fixed/.test(o.name)) gears.push(o); });
  assert.equal(rotors.length, 1); assert.equal(tyres.length, 3); assert.equal(gears.length, 3);
  assert.ok(meshes < 60 && triangles < 30000, `${meshes} meshes / ${triangles} triangles`);
  // Propeller tips clear the runway; the tailwheel sits aft and both mains ahead of the lower wing's trailing edge.
  const tips = new Box3().setFromObject(rotors[0]); assert.ok(tips.min.y > box.min.y + 0.12, 'propeller ground clearance');
  const wheels = tyres.map(t => t.getWorldPosition(new Vector3())).sort((p, q) => p.z - q.z);
  assert.ok(wheels[2].z > 3.5 && wheels[0].z < -1 && wheels[1].z < -1 && Math.abs(wheels[0].x + wheels[1].x) < 1e-9);
  const before = rotors[0].rotation.z; a.update(0.1, 1, s); assert.notEqual(rotors[0].rotation.z, before);
  Object.assign(s, { gearDown: false, grounded: false, flightTime: 10, flaps: 2 });
  for (let i = 0; i < 300; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 1); assert.ok(gears.every(g => g.visible && g.rotation.x === 0 && g.rotation.z === 0));
  assert.equal(a.surfaces.flaps.length, 0); assert.equal(a.surfaces.ailerons.length, 4);
  assert.equal(a.surfaces.elevators.length, 2); assert.equal(a.surfaces.rudder.length, 1);
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  const [upperLeft, upperRight, lowerLeft, lowerRight] = a.surfaces.ailerons;
  assert.ok(upperLeft * upperRight < 0 && lowerLeft * lowerRight < 0 && upperLeft * lowerLeft > 0);
  assert.ok(a.surfaces.elevators.every(x => x < -0.1)); assert.ok(a.surfaces.rudder[0] > 0.05);
  Object.assign(s, { grounded: true }); for (let i = 0; i < 120; i++) a.update(1 / 60, 0, s);
  assert.ok(Object.values(a.surfaces).flat().every(x => Math.abs(x) < 1e-3), 'surfaces centre on the ground');
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('open cockpit deck fits phones, animates the propeller and disposes', () => {
  const deck = createCockpit('biplane'); assert.match(deck.name, /Alba B2/);
  assert.equal(typeof deck.userData.fit, 'function'); deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900);
  const state = { flightTime: 1, spool: 0.7, speed: 40, verticalSpeed: 1, position: { y: 700 } };
  deck.userData.update(state);
  deck.traverse(o => { if (o.isMesh) for (const v of [o.position]) assert.ok(Number.isFinite(v.x)); });
  disposeObject(deck);
});

test('audio uses the piston propeller bus without gear horns and mutes on crash/pause', () => {
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  const s = { aircraft: 'biplane', spool: 0.72, speed: f.cruiseSpeed };
  audio.update(s, true);
  assert.equal(audio.propBus.gain.value, 1); assert.equal(audio.jetBus.gain.value, 0); assert.equal(audio.helicopterBus.gain.value, 0);
  assert.equal(audio.gearHorn.gain.value, 0); assert.equal(audio.prop.tone.frequency.value, propellerSound('piston', 0.72, f.cruiseSpeed).tone);
  assert.equal(audio.prop.turbineVoice.gain.gain.value, 0);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0);
  audio.enabled = false; audio.update(s); assert.equal(audio.master.gain.value, 0);
});

test('cameras: proportional chase scale and an open-cockpit eye point above the coaming', () => {
  assert.ok(type.cameraScale > FLEET.aerobatic.cameraScale && type.cameraScale < FLEET.bush.cameraScale);
  const [x, y, z] = type.cockpitOffset;
  assert.equal(x, 0); assert.ok(y > 0.55 && y < 1.1, 'eye above the coaming, below the upper wing'); assert.ok(z > -0.3 && z < 0.9, 'seated aft of the upper wing');
});

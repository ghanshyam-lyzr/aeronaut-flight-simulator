import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { FLEET, aircraftType } from '../src/fleet.js';
import { cargo } from '../src/cargo-type.js';
import { CARGO_DESIGN, cargoSection } from '../src/cargo.js';
import { FlightController, FlightAudio, propellerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { EXPANDED_AIRCRAFT } from '../src/fleet-models.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const type = FLEET.cargo, f = type.flight, knots = v => v * 1.94384;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = () => new FlightController(groundHeight, 'cargo');

test('cargo: registered once with complete, truthful metadata and the shared turboprop category', () => {
  assert.equal(type, cargo); assert.equal(aircraftType('cargo').name, 'Montis C90');
  assert.equal(Object.values(FLEET).filter(t => t.id === 'cargo').length, 1);
  assert.ok(!EXPANDED_AIRCRAFT.includes('cargo'), 'the six original model-builder ids stay unchanged');
  assert.equal(Object.keys(f).sort().join(), Object.keys(FLEET.jet.flight).sort().join());
  assert.equal(type.engine, 'turboprop'); assert.equal(type.engines, 4);
  assert.ok(!type.fixedGear && !type.noFlaps && !f.aerobatic && !f.rotorcraft);
  assert.ok(Math.abs(f.idleSpeed + f.cruiseThrottle * f.thrustSpeed - f.cruiseSpeed) < 1e-6);
  // Help text quotes speeds the model actually uses.
  assert.match(type.help, new RegExp(`${Math.round(knots(type.landing.speed))} kt approach`));
  assert.match(type.help, new RegExp(`rotate near ${Math.round(knots(f.rotateSpeed - f.flapStallGain) / 10) * 10} kt`));
  assert.match(type.help, new RegExp(`about ${Math.round(landingProfile(type).throttle * 100)}% power`));
  assert.match(type.help, new RegExp(`${Math.round(f.maxTouchdownSink * 196.85 / 10) * 10} ft/min`));
  assert.ok(knots(f.maxTouchdownSpeed) >= 120);
  // Heavier and slower to respond than the twin commuter, lighter than the widebody.
  const commuter = FLEET.commuter.flight, widebody = FLEET.widebody.flight;
  for (const key of ['spoolUp', 'spoolCruise', 'throttleRate', 'rollRate', 'speedRate']) assert.ok(f[key] < commuter[key], key);
  assert.ok(f.rollRate > widebody.rollRate && type.cameraScale > FLEET.commuter.cameraScale && type.cameraScale < FLEET.widebody.cameraScale);
});

test('cargo: selection/reset, steady cruise and a normal-input takeoff that fits Alpine Field', () => {
  const flight = new FlightController(groundHeight, 'fighter'); run(flight, 1, { roll: 1 });
  flight.setAircraft('cargo'); const s = flight.state;
  assert.equal(s.aircraft, 'cargo'); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, false);
  assert.equal(s.flaps, 0); assert.equal(s.distance, 0); assert.equal(s.touchdown, null);
  run(flight, 30);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  assert.ok(knots(s.speed) > 195 && knots(s.speed) < 205);
  const p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + type.groundClearance, p.z); assert.equal(s.gearDown, true);
  flight.cycleFlaps();
  let previous = 0, largest = 0, frame = 1;
  for (; frame < 90 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  // Compressed runway performance: off well before the far end, with room to abort.
  assert.ok(s.distance > 450 && s.distance < 800, `takeoff roll ${s.distance}`);
  assert.ok(frame / 60 > 20, `a heavy, slow-spooling roll (${frame / 60} s)`);
  assert.ok(s.speed >= f.rotateSpeed - f.flapStallGain);
  assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
  flight.toggleGear(); assert.equal(s.gearDown, false);
  run(flight, 8, { throttle: 1 }); assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > 105);
  flight.reset(); assert.equal(s.aircraft, 'cargo'); assert.equal(s.flightTime, 0); assert.equal(s.gearDown, false);
});

test('cargo: slow turbine spool, deliberate roll and flap stall gain', () => {
  const flight = flying(), s = flight.state;
  s.throttle = s.spool = 0; run(flight, 0.1); s.throttle = 1;
  run(flight, 2); const early = s.spool; run(flight, 4);
  assert.ok(early < 0.6, `spool after 2 s: ${early}`); assert.ok(s.spool > 0.9);
  const roll = flying(); run(roll, 1, { roll: 1 });
  const commuter = new FlightController(groundHeight, 'commuter'); run(commuter, 1, { roll: 1 });
  assert.ok(roll.state.bank > 0.1 && roll.state.bank < commuter.state.bank);
  for (const flaps of [0, 1, 2]) {
    const slow = flying(); slow.state.flaps = flaps; slow.state.speed = f.stallSpeed - flaps * f.flapStallGain + 0.2;
    run(slow, 1 / 120); assert.equal(slow.state.stalled, false);
    slow.state.speed = f.stallSpeed - flaps * f.flapStallGain - 0.2; run(slow, 1 / 120); assert.equal(slow.state.stalled, true);
  }
});

test('cargo: clean stall threshold and normal-power recovery', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 60 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  run(flight, 0.8); assert.ok(s.pitch < -0.1); assert.equal(s.crashed, false);
  for (let i = 0; i < 40 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false);
});

test('cargo: retractable gear, flaps and gear horn reflect the physical configuration', () => {
  const flight = flying(), s = flight.state;
  s.position.set(900, 100, -1800); s.throttle = 0.1;
  assert.equal(flight.gearWarning, true);
  flight.toggleGear(); assert.equal(s.gearDown, true); assert.equal(flight.gearWarning, false);
  flight.toggleGear(); assert.equal(s.gearDown, false);
  for (const expected of [1, 2, 0]) assert.equal(flight.cycleFlaps(), expected);
});

test('cargo: landing mission starts on the real final with gear and full flaps, and a hard landing fails then retries', () => {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs(), p = landingProfile(type);
  mission.start(flight); const s = flight.state;
  assert.equal(s.gearDown, true); assert.equal(s.flaps, 2); assert.equal(p.clearance, type.groundClearance);
  assert.ok(s.speed > f.stallSpeed - 2 * f.flapStallGain + 8, 'approach keeps a stall margin');
  assert.ok(p.throttle > 0.32, 'approach power stays above the idle-sink band');
  for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
    input.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); });
  }
  assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown && mission.touchdown.sink > f.maxTouchdownSink);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(s.crashed, false); assert.equal(mission.touchdown, null);
});

test('cargo: feedback pilot lands in the zone and stops with runway to spare', () => {
  const flight = flying(), mission = new LandingMission(), s = flight.state, input = new FlightInputs(0);
  mission.start(flight); const p = mission.profile;
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - AIRFIELD.elevation - p.clearance;
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const desired = Math.asin((-sink + Math.max(0, 0.32 - s.spool) * 6) / Math.max(s.speed, 1));
    input.set({ pitch: (desired - s.pitch) * 4, throttle: s.grounded ? -1 : 0 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); });
  }
  assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
  assert.ok(mission.touchdown.along >= TOUCHDOWN_ZONE.start && mission.touchdown.along <= TOUCHDOWN_ZONE.end);
  assert.ok(mission.guidance(s).remaining > 300, `remaining ${mission.guidance(s).remaining}`);
});

function tap(axis, sign, hz, duration) {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs(); mission.start(flight);
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.6 - 1e-9;) { t = Math.min(1.6, t + 1 / hz); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return flight.state;
}
test('cargo: brief 30/100 ms taps stay small and match across 10–120 Hz frame rates', () => {
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(axis, sign, 120, duration), baseline = tap(axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis], difference = reference[field] - baseline[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < (axis === 'roll' ? 0.03 : 0.012), `${axis} ${duration}: ${delta}`);
    assert.equal(reference.crashed, false); assert.equal(reference.stalled, false);
    for (const hz of [10, 30, 60]) { const s = tap(axis, sign, hz, duration);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 1e-4); assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12); }
  }
});

test('cargo: transport silhouette, four propellers, multi-wheel gear clearance, moving surfaces and disposal', () => {
  const a = createAircraft('cargo'), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
  a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(Math.abs(size.x - CARGO_DESIGN.span) < 0.5 && size.z > 29 && size.z < 31.5 && size.y > 11 && size.y < 13, JSON.stringify(size));
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
  // Deep hold: tall, boxy body whose belly sweeps up into the rear ramp.
  const hold = cargoSection(0), ramp = cargoSection(10);
  assert.ok(hold.hh * 2 > 4 && hold.n > 2.4); assert.ok(ramp.cy - ramp.hh > hold.cy - hold.hh + 1.5);
  let meshes = 0, triangles = 0; const rotors = [], tyres = [], mains = [];
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
    if (o.name === 'propeller') rotors.push(o); if (o.name === 'tyre') tyres.push(o); if (o.name === 'retractable main gear') mains.push(o); });
  assert.equal(rotors.length, 4); assert.equal(tyres.length, 6); assert.equal(mains.length, 2);
  assert.ok(meshes < 85 && triangles < 45000, `${meshes} meshes / ${triangles} triangles`);
  // Four separate nacelles: discs clear the fuselage and each other.
  const xs = rotors.map(r => r.position.x).sort((p, q) => p - q);
  assert.ok(xs[2] - CARGO_DESIGN.propRadius > cargoSection(rotors[0].position.z).hw);
  assert.ok(xs[3] - xs[2] > CARGO_DESIGN.propRadius * 2 + 0.5);
  assert.ok(rotors.every(r => r.position.y - CARGO_DESIGN.propRadius > box.min.y + 2), 'prop ground clearance');
  const before = rotors.map(r => r.rotation.z); a.update(0.1, 1, { ...s, spool: 1 });
  rotors.forEach((r, i) => assert.ok(r.rotation.z - before[i] > 10));
  Object.assign(s, { gearDown: false, grounded: false, flightTime: 10, flaps: 2 });
  for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 0.5) < 1e-10);
  const raised = mains[0].position.y;
  for (let i = 0; i < 150; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 0); assert.ok(mains.every(m => !m.visible && m.position.y > raised));
  assert.equal(a.surfaces.flaps.length, 2); assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6));
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0); assert.ok(a.surfaces.elevators[0] < -0.1); assert.ok(a.surfaces.rudder[0] > 0.05);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('cargo: transport cockpit fits phones, keeps the 1 m near plane and moves four power levers', () => {
  const deck = createCockpit('cargo'); assert.match(deck.name, /Montis C90/);
  assert.equal(deck.userData.levers.length, 4);
  deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900);
  deck.userData.update({ throttle: 0 }); const idle = deck.userData.levers.map(l => l.rotation.x);
  deck.userData.update({ throttle: 1 }); deck.userData.levers.forEach((l, i) => assert.ok(l.rotation.x - idle[i] > 0.9));
  deck.updateMatrixWorld(true);
  deck.traverse(o => { if (o.isMesh) { const b = new Box3().setFromObject(o); assert.ok(b.max.z < -1, `${o.geometry.type} reaches ${b.max.z}`); } });
  const resources = new Set(); deck.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); disposeObject(deck); assert.equal(count, resources.size);
});

test('cargo: camera scale frames the full wingspan on a 390×844 phone in chase view', () => {
  const aspect = 390 / 844, portrait = Math.min(2.3, Math.max(1, 1.2 / aspect));
  const distance = Math.hypot(8.3, 23) * portrait * type.cameraScale, halfWidth = Math.tan(53 / 2 * Math.PI / 180) * aspect * distance;
  assert.ok(halfWidth > CARGO_DESIGN.span / 2 * 1.2, `${halfWidth} m half-width`);
  const [x, y, z] = type.cockpitOffset; assert.ok(x < 0 && y > 0.5 && z < -11 && z > -13.5, 'left seat on the flight deck');
});

test('cargo: audio uses the turboprop bus with gear horn and mutes on crash', () => {
  const sound = propellerSound(type.engine, 0.72, f.cruiseSpeed); assert.ok(sound.turbineGain > 0);
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  const s = { aircraft: 'cargo', spool: 0.72, speed: f.cruiseSpeed };
  audio.update(s, true);
  assert.equal(audio.propBus.gain.value, 1); assert.equal(audio.jetBus.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0.12);
  assert.equal(audio.prop.turbine.frequency.value, sound.turbine); assert.ok(audio.master.gain.value > 0);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
});

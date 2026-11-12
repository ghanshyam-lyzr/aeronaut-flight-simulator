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
import { LandingMission, landingProfile } from '../src/landing-mission.js';

const id = 'utility', type = FLEET[id], f = type.flight;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = (which = id) => new FlightController(groundHeight, which);
const knots = v => v * 1.94384;

function takeoff(which, flaps = 1) {
  const flight = flying(which), s = flight.state, t = FLEET[which], p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + t.groundClearance, p.z);
  for (let i = 0; i < flaps; i++) flight.cycleFlaps();
  let previous = 0, largest = 0;
  for (let frame = 1; frame < 60 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  return { flight, s, largest };
}

test('Veyra U9 is registered as its own fixed-gear turboprop with saved identity and truthful help', () => {
  assert.equal(aircraftType(id), type); assert.equal(type.id, id);
  assert.ok(!EXPANDED_AIRCRAFT.includes(id), 'the original six model-builder ids stay unchanged');
  assert.equal(type.engine, 'turboprop'); assert.equal(type.fixedGear, true); assert.ok(!type.noFlaps);
  assert.equal(Object.keys(f).sort().join(), Object.keys(FLEET.jet.flight).sort().join());
  for (const other of Object.values(FLEET)) if (other !== type) {
    assert.notEqual(other.registration, type.registration); assert.notEqual(other.name, type.name); assert.notEqual(other.badge, type.badge);
  }
  assert.ok(type.summary.startsWith(type.name));
  assert.match(type.help, /fixed/i); assert.doesNotMatch(type.help + type.runwayHint, /\bG\b|retract|gear up/i);
  assert.match(type.runwayHint, /gear fixed/);
  // Help text quotes the tuned numbers.
  assert.match(type.help, new RegExp(`${Math.round(knots(f.rotateSpeed - f.flapStallGain))} kt`));
  assert.match(type.help, new RegExp(`${Math.round(knots(type.landing.speed))} kt`));
  // A medium-speed hauler between the small singles and the twin commuter.
  for (const small of ['trainer', 'bush']) assert.ok(f.cruiseSpeed > FLEET[small].flight.cruiseSpeed);
  assert.ok(f.cruiseSpeed < FLEET.commuter.flight.cruiseSpeed);
});

test('Veyra U9 holds cruise, resets cleanly and survives switching to and from other types', () => {
  const flight = flying('fighter'); run(flight, 1, { roll: 1 });
  flight.setAircraft(id); const s = flight.state;
  assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, true); assert.equal(s.flaps, 0);
  run(flight, 25);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  assert.ok(Math.abs(knots(s.speed) - 150) < 3, 'about 150 kt cruise');
  flight.reset(); assert.equal(s.aircraft, id); assert.equal(s.flightTime, 0);
  flight.setAircraft('trainer'); assert.equal(s.aircraft, 'trainer'); flight.setAircraft(id); assert.equal(s.speed, f.cruiseSpeed);
});

test('the single turbine spools more gradually than the piston singles', () => {
  const spoolTime = which => {
    const flight = flying(which), s = flight.state, p = runwayPoint(100);
    flight.runwayStart(p.x, AIRFIELD.elevation + FLEET[which].groundClearance, p.z); s.throttle = 1;
    let t = 0; while (s.spool < 0.9 && t < 30) { flight.update(1 / 120, {}); s.throttle = 1; t += 1 / 120; }
    return t;
  };
  const u9 = spoolTime(id);
  assert.ok(u9 > spoolTime('trainer') * 2 && u9 > spoolTime('bush') * 2, `${u9}s`);
  assert.ok(u9 < 6, 'still usable for a go-around');
});

test('short-field takeoff on the real runway with flaps 15 and normal inputs', () => {
  const { flight, s, largest } = takeoff(id);
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.ok(s.speed >= f.rotateSpeed - f.flapStallGain);
  assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
  const roll = s.distance;
  assert.ok(roll < 520, `takeoff roll ${roll}`);
  assert.ok(roll < takeoff('commuter').s.distance, 'shorter than the twin commuter');
  run(flight, 8, { throttle: 1 });
  assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > AIRFIELD.elevation + 40);
  // Clean takeoff also works, with a longer roll.
  const clean = takeoff(id, 0);
  assert.equal(clean.s.grounded, false); assert.ok(clean.s.distance > roll);
});

test('stall breaks gently, flaps lower it, and power recovers without losing control', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 60 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  assert.ok(Math.abs(knots(f.stallSpeed) - 58) < 1);
  run(flight, 0.8); assert.ok(s.pitch < -0.1); assert.equal(s.crashed, false);
  for (let i = 0; i < 30 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  const flapped = flying(); flapped.cycleFlaps(); flapped.cycleFlaps();
  for (let i = 0; i < 60 * 120 && !flapped.state.stalled; i++) flapped.update(1 / 120, { throttle: -1 });
  assert.ok(flapped.state.speed < f.stallSpeed - 2 * f.flapStallGain + 0.01);
  assert.ok(landingProfile(type).speed > (f.stallSpeed - 2 * f.flapStallGain) * 1.5, 'approach keeps a wide stall margin');
});

test('fixed gear never retracts or warns; flaps cycle 0/15/30', () => {
  const flight = flying(), s = flight.state;
  s.position.set(900, 100, -1800); s.throttle = 0.05;
  assert.equal(flight.gearWarning, false);
  assert.equal(flight.toggleGear(), true); assert.equal(s.gearDown, true);
  assert.deepEqual([flight.cycleFlaps(), flight.cycleFlaps(), flight.cycleFlaps()], [1, 2, 0]);
});

test('landing mission: profile, approach power and a hard landing that fails then retries', () => {
  const p = landingProfile(type);
  assert.equal(p.flaps, 2); assert.equal(p.speed, type.landing.speed);
  assert.ok(p.throttle > 0.32 && p.throttle < 0.5, `approach power ${p.throttle}`);
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs();
  mission.start(flight);
  assert.equal(flight.state.gearDown, true); assert.equal(flight.state.flaps, 2);
  for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
    input.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, flight.state); });
  }
  assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown.sink > f.maxTouchdownSink);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(flight.state.crashed, false); assert.equal(mission.touchdown, null);
});

function tap(axis, sign, hz, duration) {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs(); mission.start(flight);
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.6 - 1e-9;) { t = Math.min(1.6, t + 1 / hz); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return flight.state;
}
test('brief 30/100 ms taps stay small and frame-rate independent on every axis', () => {
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

test('distinct airframe: bounded size, five-blade prop, fixed tricycle gear, moving surfaces and disposal', () => {
  const a = createAircraft(id), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
  assert.match(a.group.name, /Veyra U9/);
  a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 15 && size.x < 17, `span ${size.x}`); assert.ok(size.z > 12.5 && size.z < 14.5, `length ${size.z}`); assert.ok(size.y < 5.5);
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet the runway top');
  let meshes = 0, triangles = 0; const rotors = [], tyres = [], gears = [];
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
    if (o.name === 'propeller') rotors.push(o); if (o.name === 'tyre') tyres.push(o); if (/fixed .*gear/.test(o.name)) gears.push(o); });
  assert.equal(rotors.length, 1); assert.equal(tyres.length, 3); assert.equal(gears.length, 3);
  assert.equal(rotors[0].children.filter(o => o.geometry?.type === 'BoxGeometry').length, 10, 'five blades with tips');
  assert.ok(meshes < 85 && triangles < 45000, `${meshes} meshes / ${triangles} triangles`);
  // Propeller clears the ground with the nose wheel down; the prop disc is ahead of the nose wheel.
  const prop = new Box3().setFromObject(rotors[0]); assert.ok(prop.min.y - box.min.y > 0.3);
  const before = rotors[0].rotation.z; a.update(0.1, 1, s); assert.notEqual(rotors[0].rotation.z, before);
  Object.assign(s, { gearDown: true, grounded: false, flightTime: 10, flaps: 2 });
  for (let i = 0; i < 270; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 1); assert.ok(gears.every(g => g.visible && g.rotation.z === 0 && g.rotation.x === 0));
  assert.equal(a.surfaces.flaps.length, 2); assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6));
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0); assert.ok(a.surfaces.elevators.every(x => x < -0.1)); assert.ok(a.surfaces.rudder[0] > 0.05);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('own cockpit deck fits phones and disposes; cameras scale between the singles and the twin', () => {
  const deck = createCockpit(id); assert.match(deck.name, /Veyra U9 — cockpit/); assert.equal(typeof deck.userData.fit, 'function');
  deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900);
  let disposed = 0, meshes = 0; deck.traverse(o => { if (o.isMesh) { meshes++; o.geometry.addEventListener('dispose', () => disposed++); } });
  disposeObject(deck); assert.equal(disposed, meshes);
  assert.ok(type.cameraScale > FLEET.bush.cameraScale && type.cameraScale < FLEET.commuter.cameraScale);
  assert.equal(type.cockpitOffset.length, 3); assert.ok(type.cockpitOffset[2] < -2 && type.cockpitOffset[2] > -3.2, 'pilot sits behind the long nose');
});

test('turboprop sound runs on the propeller bus with no gear horn', () => {
  const p = propellerSound(type.engine, 1, 90); assert.ok(p.turbineGain > 0);
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  audio.whines = [1, 1.012].map(ratio => ({ ratio, osc: { frequency: param() }, gain: node() }));
  audio.fan = { frequency: param() }; audio.fanVoice = voice(); audio.roar = voice(); audio.rumble = voice();
  const s = { aircraft: id, spool: 0.1, throttle: 0.05, speed: 40, position: new Vector3(900, 90, -1800), gearDown: true };
  audio.update(s, true);
  assert.equal(audio.propBus.gain.value, 1); assert.equal(audio.jetBus.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0);
});

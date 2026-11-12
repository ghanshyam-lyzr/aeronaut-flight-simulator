import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const id = 'canard', type = FLEET[id], f = type.flight, knots = v => v * 1.94384;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = () => new FlightController(groundHeight, id);

test('Neris P2 is registered with its own identity, explicit capabilities and truthful text', () => {
  assert.equal(aircraftType(id), type); assert.equal(type.id, id);
  assert.ok(!EXPANDED_AIRCRAFT.includes(id), 'own factory, not the shared six-model builder');
  assert.equal(type.engine, 'piston'); assert.equal(type.fixedGear, true); assert.equal(type.noFlaps, true);
  assert.equal(f.flapDrag, 0); assert.equal(f.flapStallGain, 0); assert.equal(f.aerobatic, false);
  assert.ok(f.pitchLimits && f.bankLimit, 'bounded attitudes');
  assert.equal(Object.keys(f).sort().join(), Object.keys(FLEET.jet.flight).sort().join());
  const registrations = Object.values(FLEET).map(t => t.registration), names = Object.values(FLEET).map(t => t.name);
  assert.equal(new Set(registrations).size, registrations.length); assert.equal(new Set(names).size, names.length);
  assert.ok(type.summary.startsWith(type.name));
  for (const text of [type.help, type.runwayHint]) assert.match(text, /no flaps/i);
  assert.match(type.help, /fixed tricycle gear/i); assert.match(type.runwayHint, /fixed gear/);
  // Quoted speeds match the tuning to within a knot.
  assert.match(type.help, new RegExp(`Rotate near ${Math.round(knots(f.rotateSpeed))} kt`));
  assert.match(type.help, new RegExp(`approach at ${Math.round(knots(type.landing.speed))} kt`));
  assert.match(type.runwayHint, new RegExp(`near ${Math.round(knots(f.rotateSpeed))} kt`));
  const cruise = f.idleSpeed + f.cruiseThrottle * f.thrustSpeed - f.gearDrag;
  assert.ok(Math.abs(cruise - f.cruiseSpeed) < 1e-9); assert.ok(Math.abs(knots(cruise) - 155) < 2.5);
  // The roster heading counts the fleet rather than quoting a number.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /\$\{Object\.keys\(FLEET\)\.length\} to fly/); assert.doesNotMatch(main, /10 to fly/);
});

test('Neris P2 resets to steady cruise and takes off from the real runway with gradual inputs', () => {
  const flight = new FlightController(groundHeight, 'fighter'); run(flight, 1, { roll: 1 });
  flight.setAircraft(id); const s = flight.state;
  assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, true); assert.equal(s.flaps, 0);
  run(flight, 20);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  const p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + type.groundClearance, p.z); flight.cycleFlaps(); assert.equal(s.flaps, 0);
  let previous = 0, largest = 0;
  for (let frame = 1; frame < 60 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.ok(s.distance < 850, `takeoff roll ${s.distance}`); assert.ok(s.speed >= f.rotateSpeed);
  assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
  run(flight, 6, { throttle: 1 }); assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > 105);
  flight.reset(); assert.equal(s.aircraft, id); assert.equal(s.flightTime, 0); assert.equal(s.gearDown, true);
});

test('Neris P2 canard stall drops the nose and recovers with normal power', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 45 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  run(flight, 0.8); assert.ok(s.pitch < -0.1); assert.equal(s.crashed, false);
  for (let i = 0; i < 30 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false);
});

test('Neris P2 is slippery: at idle from cruise it glides far longer than the other piston singles', () => {
  const untilStall = aircraft => { const flight = new FlightController(groundHeight, aircraft), s = flight.state; let time = 0;
    for (; time < 60 && !s.stalled; time += 1 / 120) flight.update(1 / 120, { throttle: -1 }); return time; };
  const canard = untilStall(id);
  for (const other of ['trainer', 'bush', 'aerobatic']) assert.ok(canard > untilStall(other) * 1.8, `${canard} vs ${other}`);
});

test('Neris P2 fixed gear and missing flaps stay fixed, with no gear warning', () => {
  const flight = flying(), s = flight.state;
  s.position.set(900, 100, -1800); s.throttle = 0.1;
  assert.equal(flight.gearWarning, false);
  assert.equal(flight.toggleGear(), true); assert.equal(s.gearDown, true);
  for (let i = 0; i < 3; i++) { flight.cycleFlaps(); assert.equal(s.flaps, 0); }
  const p = landingProfile(type);
  assert.equal(p.flaps, 0); assert.equal(p.speed, type.landing.speed);
  assert.ok(p.throttle > 0.15 && p.throttle < 0.4, `approach power ${p.throttle}`);
  assert.ok(p.speed > f.stallSpeed * 1.25 && p.speed < f.maxTouchdownSpeed);
});

test('Neris P2 mission fails a hard landing and retries cleanly', () => {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs();
  mission.start(flight);
  assert.equal(flight.state.flaps, 0); assert.equal(flight.state.gearDown, true);
  for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
    input.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, flight.state); });
  }
  assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown && mission.touchdown.sink > f.maxTouchdownSink);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(flight.state.crashed, false); assert.equal(mission.touchdown, null);
});

function tap(axis, sign, hz, duration) {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs(); mission.start(flight);
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.6 - 1e-9;) { t = Math.min(1.6, t + 1 / hz); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return flight.state;
}
test('Neris P2 keeps 30/100 ms key taps small and frame-rate independent on every axis', () => {
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(axis, sign, 120, duration), baseline = tap(axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis], difference = reference[field] - baseline[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < (axis === 'roll' ? 0.035 : 0.015), `${axis} ${duration}: ${delta}`);
    assert.equal(reference.crashed, false); assert.equal(reference.stalled, false);
    for (const hz of [10, 30, 60]) { const s = tap(axis, sign, hz, duration);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 1e-4); assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12); }
  }
  // Full deflection held for seconds still stops at the attitude limits.
  const flight = flying(); run(flight, 5, { roll: 1, pitch: 1 });
  assert.ok(flight.state.bank <= f.bankLimit + 1e-9 && flight.state.pitch <= f.pitchLimits[1] + 1e-9);
});

test('Neris P2 canard layout: forewing ahead, swept aft wing, tip fins, rear prop clear of the ground', () => {
  const a = createAircraft(id), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
  a.update(0.01, 0, s); a.group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 8 && size.x < 9.5 && size.y < 3.2 && size.z > 6 && size.z < 7.5, JSON.stringify(size));
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
  const named = name => { const list = []; a.group.traverse(o => { if (o.name === name) list.push(o); }); return list; };
  const centre = o => new Box3().setFromObject(o).getCenter(new Vector3());
  const [prop] = named('propeller'), tyres = named('tyre'), elevators = named('elevators'), ailerons = named('ailerons'), rudders = named('rudder');
  assert.equal(named('propeller').length, 1); assert.equal(tyres.length, 3); assert.equal(named('flaps').length, 0);
  assert.equal(elevators.length, 2); assert.equal(ailerons.length, 2); assert.equal(rudders.length, 2);
  // Pusher: the propeller is the aftmost part of the airframe.
  const propBox = new Box3().setFromObject(prop);
  assert.ok(prop.position.z > 2.8 && propBox.max.z >= box.max.z - 0.35);
  assert.ok(propBox.min.y - box.min.y > 0.75, `prop ground clearance ${propBox.min.y - box.min.y}`);
  // Canard elevators lie well ahead of the main wing's ailerons; no conventional tailplane exists.
  for (const e of elevators) assert.ok(centre(e).z < -2.3);
  for (const al of ailerons) assert.ok(centre(al).z > 0.6 && Math.abs(centre(al).x) > 2);
  for (const r of rudders) assert.ok(Math.abs(centre(r).x) > 3.8 && centre(r).y > 0, 'rudders on the wingtip fins');
  // Fixed tricycle gear: one wheel well ahead, two behind the centre.
  const zs = tyres.map(t => centre(t).z).sort((x, y) => x - y);
  assert.ok(zs[0] < -1.8 && zs[1] > 0.6 && zs[2] > 0.6);
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes < 60 && triangles < 30000, `${meshes} meshes / ${triangles} triangles`);
  a.dispose();
});

test('Neris P2 propeller turns with power, fixed gear stays down and surfaces deflect physically', () => {
  const a = createAircraft(id), s = { gearDown: false, grounded: false, flightTime: 10, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
  const prop = a.group.getObjectByName('propeller'), before = prop.rotation.z;
  a.update(0.1, 0, { ...s, spool: 0 }); const idle = Math.abs(prop.rotation.z - before);
  const mid = prop.rotation.z; a.update(0.1, 1, { ...s, spool: 1 }); assert.ok(Math.abs(prop.rotation.z - mid) > idle * 5);
  for (let i = 0; i < 240; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 1); assert.ok(a.group.getObjectByName('fixed main gear').visible);
  assert.deepEqual(a.surfaces.flaps, []);
  // Nose up, roll right, yaw right.
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  const { ailerons, elevators, rudder } = a.surfaces;
  assert.ok(ailerons[0] * ailerons[1] < 0);
  // Canard trailing edges go down (+ about +X) to raise the nose, both halves together.
  assert.ok(elevators.every(e => e > 0.1), `canard ${elevators}`);
  assert.equal(rudder.length, 2); assert.ok(rudder.every(r => r > 0.05) && rudder[0] === rudder[1]);
  // Grounded: surfaces return to neutral.
  for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, { ...s, grounded: true });
  assert.ok(Object.values(a.surfaces).flat().every(x => Math.abs(x) < 0.01));
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('Neris P2 cockpit is its own canard deck, fits phones and animates its canard', () => {
  const deck = createCockpit(id); assert.match(deck.name, /Neris P2/);
  assert.equal(typeof deck.userData.fit, 'function'); deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900);
  const state = { flightTime: 0, pitch: 0, bank: 0, speed: 50, grounded: false, crashed: false };
  for (let i = 1; i <= 30; i++) { state.flightTime = i / 60; state.pitch += 0.004; deck.userData.update(state); }
  assert.ok(deck.userData.elevators.every(h => h.rotation.x > 0.1));
  const resources = new Set(); deck.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); disposeObject(deck); assert.equal(count, resources.size);
});

test('Neris P2 uses the piston propeller bus without a gear horn, and mutes on crash or pause', () => {
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  const s = { aircraft: id, spool: 0.72, speed: f.cruiseSpeed };
  audio.update(s, true);
  assert.equal(audio.propBus.gain.value, 1); assert.equal(audio.jetBus.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
  assert.equal(audio.prop.tone.frequency.value, propellerSound('piston', 0.72, f.cruiseSpeed).tone);
  assert.equal(audio.prop.turbineVoice.gain.gain.value, 0);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0);
  audio.enabled = false; audio.update(s); assert.equal(audio.master.gain.value, 0);
});

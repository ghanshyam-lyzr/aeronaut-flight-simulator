import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { FLEET } from '../src/fleet.js';
import { FlightController, FlightAudio, propellerSound, passengerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { EXPANDED_AIRCRAFT } from '../src/fleet-models.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission } from '../src/landing-mission.js';

const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = id => new FlightController(groundHeight, id);

test('complete fleet choices retain the original ten and explicit approach/engine data', () => {
  for (const id of ['jet', 'fighter', 'helicopter', 'airliner', ...EXPANDED_AIRCRAFT]) assert.ok(FLEET[id], id);
  assert.equal(new Set(Object.values(FLEET).map(t => t.registration)).size, Object.keys(FLEET).length);
  for (const t of Object.values(FLEET)) {
    assert.ok(t.engine && Number.isFinite(t.landing.speed));
    assert.ok(t.name && t.help && t.choice && t.runwayHint && t.summary && t.badge);
    if (!t.flight.rotorcraft) for (const key of Object.keys(FLEET.jet.flight)) assert.ok(key in t.flight, `${t.id}: ${key}`);
  }
});

for (const id of EXPANDED_AIRCRAFT) {
  const type = FLEET[id], f = type.flight;
  test(`${id}: selection/reset, steady flight, real-runway takeoff with gradual normal inputs`, () => {
    const flight = flying('fighter'); run(flight, 1, { roll: 1 });
    flight.setAircraft(id); const s = flight.state;
    assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed);
    assert.equal(s.gearDown, !!type.fixedGear); assert.equal(s.flaps, 0);
    assert.equal(s.distance, 0); assert.equal(s.autopilot, false); assert.equal(s.touchdown, null);
    run(flight, 20);
    assert.equal(s.crashed, false); assert.equal(s.stalled, false);
    assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
    const p = runwayPoint(100), input = new FlightInputs();
    flight.runwayStart(p.x, AIRFIELD.elevation + type.groundClearance, p.z); flight.cycleFlaps();
    let previous = 0, largest = 0;
    for (let frame = 1; frame < 60 * 60 && s.grounded; frame++) {
      input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
      input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
    }
    assert.equal(s.grounded, false); assert.equal(s.crashed, false);
    assert.ok(s.distance < 850, `${id}: takeoff roll ${s.distance}`);
    assert.ok(s.speed >= f.rotateSpeed - (type.noFlaps ? 0 : f.flapStallGain));
    assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
    run(flight, 6, { throttle: 1 }); assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > 105);
    flight.reset(); assert.equal(s.aircraft, id); assert.equal(s.flightTime, 0);
  });

  test(`${id}: clean stall threshold and normal-power recovery use its own performance`, () => {
    const flight = flying(id), s = flight.state;
    for (let i = 0; i < 45 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
    assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
    run(flight, 0.8); assert.ok(s.pitch < -0.1); assert.equal(s.crashed, false);
    for (let i = 0; i < 30 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
    assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  });

  test(`${id}: fixed/retractable gear, flaps and warning reflect the physical configuration`, () => {
    const flight = flying(id), s = flight.state;
    s.position.set(900, 100, -1800); s.throttle = 0.1;
    assert.equal(flight.gearWarning, !type.fixedGear);
    flight.toggleGear(); assert.equal(s.gearDown, true); assert.equal(flight.gearWarning, false);
    flight.toggleGear(); assert.equal(s.gearDown, !!type.fixedGear);
    flight.cycleFlaps(); assert.equal(s.flaps, type.noFlaps ? 0 : 1);
    flight.cycleFlaps(); assert.equal(s.flaps, type.noFlaps ? 0 : 2);
    flight.cycleFlaps(); assert.equal(s.flaps, 0);
  });

  test(`${id}: normal-input mission fails for a hard landing and retries cleanly`, () => {
    const flight = flying(id), mission = new LandingMission(), input = new FlightInputs();
    mission.start(flight);
    for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
      input.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
      input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, flight.state); });
    }
    assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown && mission.touchdown.sink > f.maxTouchdownSink);
    mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(flight.state.crashed, false); assert.equal(mission.touchdown, null);
  });

  test(`${id}: bounded geometry, engines, moving surfaces, gear clearance and disposal`, () => {
    const a = createAircraft(id), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed };
    a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
    assert.ok(size.x > 8 && size.x < 65 && size.y < 18 && size.z > 7 && size.z < 58);
    assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
    let meshes = 0, triangles = 0; const rotors = [], tyres = [];
    a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
      if (o.name === 'propeller' || o.name === 'turbofan fan') rotors.push(o); if (o.name === 'tyre') tyres.push(o); });
    assert.equal(rotors.length, ['commuter', 'regional', 'widebody'].includes(id) ? 2 : 1);
    assert.equal(tyres.length, id === 'widebody' ? 9 : 3); assert.ok(meshes < 85 && triangles < 45000, `${meshes} meshes / ${triangles} triangles`);
    const before = rotors[0].rotation.z; a.update(0.1, 1, s); assert.notEqual(rotors[0].rotation.z, before);
    Object.assign(s, { gearDown: false, grounded: false, flightTime: 10, flaps: type.noFlaps ? 0 : 2 });
    for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, s);
    assert.ok(type.fixedGear ? a.gearPosition === 1 : Math.abs(a.gearPosition - 0.5) < 1e-10);
    for (let i = 0; i < 150; i++) a.update(1 / 60, 0.7, s);
    assert.ok(type.fixedGear ? a.gearPosition === 1 : a.gearPosition === 0);
    assert.equal(a.surfaces.flaps.length, type.noFlaps ? 0 : 2);
    assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6));
    for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; s.bodyRates = { roll: 0.3, pitch: 0.18, yaw: 0.15 }; a.update(1 / 60, 0.7, s); }
    assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0); assert.ok(a.surfaces.elevators[0] < -0.1); assert.ok(a.surfaces.rudder[0] > 0.05);
    a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
    const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
    let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
    const deck = createCockpit(id); assert.match(deck.name, new RegExp(type.name)); assert.equal(typeof deck.userData.fit, 'function');
    deck.userData.fit(390 / 844); disposeObject(deck);
  });
}

function tap(id, axis, sign, hz, duration) {
  const flight = flying(id), mission = new LandingMission(), input = new FlightInputs(); mission.start(flight);
  input.set({ [axis]: sign }, 0.013); input.set({}, 0.013 + duration);
  for (let t = 0; t < 1.6 - 1e-9;) { t = Math.min(1.6, t + 1 / hz); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return flight.state;
}
test('six new aircraft retain small 30/100ms taps at 10–120Hz on all axes, both directions', () => {
  for (const id of EXPANDED_AIRCRAFT) for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(id, axis, sign, 120, duration), baseline = tap(id, axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis], difference = reference[field] - baseline[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < (axis === 'roll' ? 0.035 : 0.015), `${id} ${axis} ${duration}: ${delta}`);
    assert.equal(reference.crashed, false); assert.equal(reference.stalled, false);
    for (const hz of [10, 30, 60]) { const s = tap(id, axis, sign, hz, duration);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 1e-4); assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12); }
  }
});

test('Silex and existing fighter complete continuous loops and rolls without attitude clamps', () => {
  for (const id of ['fighter', 'aerobatic']) for (const axis of ['pitch', 'roll']) {
    const flight = flying(id), input = new FlightInputs(); let rotation = 0;
    input.set({ [axis]: 1, throttle: 1 }, 0);
    for (let frame = 1; frame <= 17 * 60; frame++) input.advance(frame / 60, (dt, c) => { flight.update(dt, c); rotation += flight.state.bodyRates[axis] * dt; });
    assert.ok(rotation > Math.PI * 4, `${id} ${axis}: ${rotation}`); assert.equal(flight.state.crashed, false);
    assert.ok(Math.abs(flight.state.quaternion.length() - 1) < 1e-10);
  }
});

test('engine mixes distinguish pistons, turboprops, regional fans and widebody fans', () => {
  const piston = propellerSound('piston', 1, 50), prop = propellerSound('turboprop', 1, 90);
  assert.equal(piston.turbineGain, 0); assert.ok(prop.turbineGain > 0 && prop.tone > piston.tone);
  assert.ok(propellerSound('aeroprop', 1).tone > piston.tone);
  assert.ok(passengerSound('widebody', 1).fan < passengerSound('regional', 1).fan);
  for (const engine of ['piston', 'turboprop', 'aeroprop']) {
    const idle = propellerSound(engine, 0, 0), full = propellerSound(engine, 1, 100);
    for (const key of ['tone', 'toneGain', 'washGain', 'wind', 'master']) assert.ok(full[key] > idle[key]);
    assert.deepEqual(propellerSound(engine, NaN, -10), idle);
  }
});

test('audio routes propeller and jet buses, suppresses fixed-gear horns and mutes on pause/crash', () => {
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  audio.whines = [1, 1.012].map(ratio => ({ ratio, osc: { frequency: param() }, gain: node() }));
  audio.fan = { frequency: param() }; audio.fanVoice = voice(); audio.roar = voice(); audio.rumble = voice();
  for (const id of EXPANDED_AIRCRAFT) {
    const s = { aircraft: id, spool: 0.72, speed: FLEET[id].flight.cruiseSpeed };
    const prop = ['piston', 'aeroprop', 'turboprop'].includes(FLEET[id].engine);
    audio.enabled = true; audio.update(s, true);
    assert.equal(audio.propBus.gain.value, prop ? 1 : 0); assert.equal(audio.jetBus.gain.value, prop ? 0 : 1);
    assert.equal(audio.gearHorn.gain.value, FLEET[id].fixedGear ? 0 : 0.12); assert.ok(audio.master.gain.value > 0);
    audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
    audio.enabled = false; audio.update(s); assert.equal(audio.master.gain.value, 0);
  }
});

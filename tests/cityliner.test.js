import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { FLEET, aircraftType } from '../src/fleet.js';
import { FlightController, FlightAudio, airlinerSound, jetSound, passengerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { EXPANDED_AIRCRAFT } from '../src/fleet-models.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const id = 'cityliner', type = FLEET[id], f = type.flight;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = (which = id) => new FlightController(groundHeight, which);
const knots = v => v * 1.94384;
const named = (group, pattern) => { const found = []; group.traverse(o => { if (pattern.test(o.name)) found.push(o); }); return found; };

function takeoff(which, flaps = 1) {
  const flight = flying(which), s = flight.state, t = FLEET[which], p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + t.groundClearance, p.z);
  for (let i = 0; i < flaps; i++) flight.cycleFlaps();
  let previous = 0, largest = 0;
  for (let frame = 1; frame < 90 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  return { flight, s, largest };
}

test('Valnera Q100 is its own retractable-gear passenger jet with unique identity and truthful help', () => {
  assert.equal(aircraftType(id), type); assert.equal(type.id, id); assert.equal(type.name, 'Valnera Q100');
  assert.ok(!EXPANDED_AIRCRAFT.includes(id), 'the original six model-builder ids stay unchanged');
  assert.equal(type.engine, 'cityliner'); assert.ok(!type.fixedGear); assert.ok(!type.noFlaps); assert.ok(!f.rotorcraft);
  assert.equal(Object.keys(f).sort().join(), Object.keys(FLEET.jet.flight).sort().join());
  for (const other of Object.values(FLEET)) if (other !== type) {
    assert.notEqual(other.registration, type.registration); assert.notEqual(other.name, type.name);
    assert.notEqual(other.badge, type.badge); assert.notEqual(other.engine, type.engine);
  }
  assert.ok(type.summary.startsWith(type.name));
  // Help and runway text quote the tuned numbers and mention gear and flaps honestly.
  assert.match(type.help, new RegExp(`${Math.round(knots(f.rotateSpeed - f.flapStallGain))} kt`));
  assert.match(type.runwayHint, new RegExp(`${Math.round(knots(f.rotateSpeed - f.flapStallGain))} kt`));
  assert.match(type.help, new RegExp(`${Math.round(knots(type.landing.speed))} kt`));
  assert.match(type.help, new RegExp(`${Math.round(landingProfile(type).throttle * 100)}% power`));
  assert.match(type.help, new RegExp(`${Math.round(knots(f.maxTouchdownSpeed))} kt and ${Math.round(f.maxTouchdownSink * 196.85)} ft/min`));
  assert.match(type.help, /four turbofans share one/i); assert.match(type.help, /retractable gear/);
  // A short-field jet: slower than the regional jet and 737, faster than the turboprop commuter.
  assert.ok(f.cruiseSpeed > FLEET.commuter.flight.cruiseSpeed && f.cruiseSpeed < FLEET.regional.flight.cruiseSpeed);
  assert.ok(type.landing.speed < FLEET.regional.landing.speed && type.landing.speed < FLEET.airliner.landing.speed);
});

test('Q100 holds about 205 kt cruise, resets cleanly and survives switching to and from other types', () => {
  const flight = flying('widebody'); run(flight, 1, { roll: 1 });
  flight.setAircraft(id); const s = flight.state;
  assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, false); assert.equal(s.flaps, 0);
  run(flight, 25);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  assert.ok(Math.abs(knots(s.speed) - 205) < 2, 'about 205 kt cruise');
  Object.assign(s, { gearDown: true, flaps: 2, crashed: true });
  flight.reset(); assert.equal(s.aircraft, id); assert.equal(s.flightTime, 0); assert.equal(s.crashed, false); assert.equal(s.gearDown, false);
  flight.setAircraft('airliner'); assert.equal(s.aircraft, 'airliner'); assert.equal(s.speed, FLEET.airliner.flight.cruiseSpeed);
  flight.setAircraft(id); assert.equal(s.speed, f.cruiseSpeed);
});

test('the shared turbine spool builds slowly: slower than the regional jet, quicker than a stuck engine', () => {
  const spoolTime = which => {
    const flight = flying(which), s = flight.state, p = runwayPoint(100);
    flight.runwayStart(p.x, AIRFIELD.elevation + FLEET[which].groundClearance, p.z); s.throttle = 1;
    let t = 0; while (s.spool < 0.9 && t < 30) { flight.update(1 / 120, {}); s.throttle = 1; t += 1 / 120; }
    return t;
  };
  const q100 = spoolTime(id);
  assert.ok(q100 > spoolTime('regional') * 1.15, `${q100}s`);
  assert.ok(q100 > spoolTime('commuter') * 1.8);
  assert.ok(q100 > 3.5 && q100 < 5, 'gradual, yet usable for a go-around');
  // After one second at full lever the engines are still well short of takeoff power.
  const flight = flying(), s = flight.state; flight.runwayStart(900, AIRFIELD.elevation + type.groundClearance, -2250);
  s.throttle = 1; run(flight, 1); assert.ok(s.spool > 0.2 && s.spool < 0.4, `${s.spool}`);
});

test('short-field takeoff on Alpine Field with flaps 15, normal inputs, then gear up and climb', () => {
  const { flight, s, largest } = takeoff(id);
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.ok(s.speed >= f.rotateSpeed - f.flapStallGain);
  assert.ok(largest <= f.maxAcceleration * 1 / 120 * 2 + 1e-6, 'no speed jump');
  const roll = s.distance;
  assert.ok(roll < 400, `takeoff roll ${roll}`);
  assert.ok(roll < takeoff('regional').s.distance && roll < takeoff('airliner').s.distance, 'shorter than the regional jet and 737');
  assert.ok(100 + roll < AIRFIELD.runwayLength * 0.5, 'airborne in the first half of the runway');
  assert.equal(flight.toggleGear(), false);
  run(flight, 10, { throttle: 1 });
  assert.equal(s.crashed, false); assert.equal(s.stalled, false); assert.ok(s.position.y > AIRFIELD.elevation + 60);
  // Clean takeoff also works, with a longer roll that still fits the runway.
  const clean = takeoff(id, 0);
  assert.equal(clean.s.grounded, false); assert.ok(clean.s.distance > roll && 100 + clean.s.distance < AIRFIELD.runwayLength);
});

test('stall near 89 kt clean breaks gently, flaps lower it, and power recovers it', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 90 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  assert.ok(Math.abs(knots(f.stallSpeed) - 89) < 1);
  run(flight, 0.8); assert.ok(s.pitch < -0.1, 'nose drops'); assert.equal(s.crashed, false);
  for (let i = 0; i < 40 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  run(flight, 10, { throttle: 1 }); assert.ok(s.speed > f.stallSpeed + 5);
  const flapped = flying(); flapped.cycleFlaps(); flapped.cycleFlaps(); flapped.toggleGear();
  for (let i = 0; i < 90 * 120 && !flapped.state.stalled; i++) flapped.update(1 / 120, { throttle: -1 });
  assert.ok(flapped.state.speed < f.stallSpeed - 2 * f.flapStallGain + 0.01);
  assert.ok(Math.abs(knots(f.stallSpeed - 2 * f.flapStallGain) - 66) < 1);
  assert.ok(landingProfile(type).speed > (f.stallSpeed - 2 * f.flapStallGain) * 1.4, 'approach keeps a stall margin');
});

test('retractable gear warns when low and slow; flap stages add useful drag and lift', () => {
  const flight = flying(), s = flight.state, ground = groundHeight(900, -1800);
  assert.equal(ground, AIRFIELD.elevation);
  // The shared rule: gear up, power below 20% and below 1,000 ft (304.8 m) AGL; both thresholds exclusive.
  const warns = (agl, throttle, gearDown = false) => { s.position.set(900, ground + agl, -1800); Object.assign(s, { throttle, gearDown }); return flight.gearWarning; };
  assert.equal(warns(150, 0.1), true);
  assert.equal(warns(304.7, 0.1), true, 'just below 1,000 ft AGL');
  assert.equal(warns(304.8, 0.1), false, 'at 1,000 ft AGL'); assert.equal(warns(400, 0.1), false, 'above 1,000 ft AGL');
  assert.equal(warns(150, 0.19), true); assert.equal(warns(150, 0.2), false, 'at 20% power');
  assert.equal(warns(150, 0.1, true), false, 'gear down');
  warns(150, 0.1); assert.equal(flight.toggleGear(), true); assert.equal(flight.gearWarning, false);
  assert.equal(flight.toggleGear(), false); assert.equal(flight.gearWarning, true);
  assert.deepEqual([flight.cycleFlaps(), flight.cycleFlaps(), flight.cycleFlaps()], [1, 2, 0]);
  const settled = flaps => { const fl = flying(); for (let i = 0; i < flaps; i++) fl.cycleFlaps(); return run(fl, 40).speed; };
  const [clean, takeoffFlaps, full] = [0, 1, 2].map(settled);
  assert.ok(clean - takeoffFlaps > 6 && takeoffFlaps - full > 6, 'each stage slows the cruise');
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

/** Deterministic approach pilot: ordinary rate inputs on the 3° path, a flare below 8 m, idle on the ground. */
function approach(flight, mission, observe = () => {}) {
  const s = flight.state, p = mission.profile, input = new FlightInputs();
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const g = mission.guidance(s), height = g.height;
    const sink = height < 8 ? 1.6 : p.speed * p.slope, idleSink = Math.max(0, 0.32 - s.spool) * 6;
    const desiredPitch = Math.asin((-sink + idleSink - g.pathError * (height < 8 ? 0 : 0.05)) / Math.max(s.speed, 1));
    observe(height);
    input.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded || height < 4 ? -1 : 0 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); observe(height, mission.phase); });
  }
}

test('landing mission: approach, flare, touchdown in the zone and rollout to success with normal inputs', () => {
  const p = landingProfile(type);
  assert.equal(p.flaps, 2); assert.equal(p.speed, type.landing.speed);
  assert.ok(p.throttle > 0.3 && p.throttle < 0.45, `approach power ${p.throttle}`);
  const flight = flying(), mission = new LandingMission(), s = flight.state;
  mission.start(flight);
  assert.equal(s.gearDown, true); assert.equal(s.flaps, 2); assert.equal(s.speed, p.speed);
  let flared = false; const approachSpeeds = [], phases = new Set();
  approach(flight, mission, (height, phase) => {
    if (phase) phases.add(phase);
    if (height < 8 && !s.grounded) flared = true;
    if (height > 20) approachSpeeds.push(s.speed);
  });
  assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
  assert.ok(flared); assert.ok(phases.has('approach') && phases.has('rollout'));
  assert.ok(approachSpeeds.every(v => Math.abs(v - p.speed) < 5), 'approach speed held within the mission band');
  const t = mission.touchdown;
  assert.ok(t.along >= TOUCHDOWN_ZONE.start && t.along <= TOUCHDOWN_ZONE.end, `touchdown ${t.along}`);
  assert.ok(t.sink > 0.3 && t.sink < p.maxSink, `sink ${t.sink}`); assert.ok(t.speed < p.maxSpeed && t.speed > p.speed * 0.8);
  assert.equal(t.gearDown, true); assert.equal(t.flaps, 2); assert.ok(t.alignment < 1);
  assert.equal(s.crashed, false); assert.ok(s.speed < 3); assert.ok(mission.guidance(s).remaining > 200, 'stops with runway to spare');
});

test('landing mission failures: hard landing and gear-up landing fail, then retry starts clean', () => {
  const flight = flying(), mission = new LandingMission(), input = new FlightInputs();
  mission.start(flight);
  for (let frame = 1; frame < 60 * 60 && mission.active; frame++) {
    input.set({ pitch: -1, throttle: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, flight.state); });
  }
  assert.equal(mission.status, 'failed'); assert.ok(mission.touchdown.sink > f.maxTouchdownSink);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(flight.state.crashed, false); assert.equal(mission.touchdown, null);
  assert.equal(flight.state.gearDown, true); assert.equal(flight.state.flaps, 2);
  flight.toggleGear(); approach(flight, mission);
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /gear/i); assert.equal(flight.state.crashed, true);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.equal(flight.state.gearDown, true); assert.equal(flight.state.crashed, false);
});

test('distinct airframe: four underwing fans, T-tail, tricycle gear that retracts, moving surfaces and disposal', () => {
  const a = createAircraft(id), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: f.cruiseSpeed, spool: 0 };
  assert.match(a.group.name, /Valnera Q100 — A-VQ10/);
  a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 25.5 && size.x < 27.5, `span ${size.x}`); assert.ok(size.z > 28 && size.z < 31, `length ${size.z}`); assert.ok(size.y < 10);
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet the raised runway top');
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes < 160 && triangles < 60000, `${meshes} meshes / ${triangles} triangles`);
  const fans = named(a.group, /^turbofan fan$/), gears = named(a.group, /^retractable (main|nose) gear$/), tyres = named(a.group, /^tyre$/);
  assert.equal(fans.length, 4); assert.equal(gears.length, 3); assert.equal(tyres.length, 6);
  assert.equal(named(a.group, /^propeller$/).length, 0);
  // Separate pods: two per side, under and ahead of the high wing, clear of the ground and the fuselage.
  const centres = fans.map(fan => fan.getWorldPosition(new Vector3()));
  assert.deepEqual(centres.map(c => Math.sign(c.x)).sort(), [-1, -1, 1, 1]);
  assert.ok(new Set(centres.map(c => Math.abs(c.x).toFixed(2))).size === 2 && Math.min(...centres.map(c => Math.abs(c.x))) > 3);
  assert.ok(centres.every(c => c.y < 1.55 && c.y - box.min.y > 2), 'fans hang below the wing, well above the runway');
  // Visibly distinct from the other passenger aircraft: they carry two engines or propellers each.
  for (const other of ['airliner', 'regional', 'widebody', 'commuter']) {
    const o = createAircraft(other); o.update(0.01, 0, s);
    assert.ok(named(o.group, /^(turbofan fan|propeller)$/).length <= 2, other); o.dispose();
  }
  const before = fans.map(fan => fan.rotation.z); a.update(0.1, 1, { ...s, spool: 1 });
  fans.forEach((fan, i) => assert.ok(fan.rotation.z - before[i] > 10 * 0.1));
  // Gear retracts over about four seconds in flight and hides once stowed; the ground places it down at once.
  Object.assign(s, { gearDown: false, grounded: false, flightTime: 10 });
  for (let i = 0; i < 60; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 0.75) < 0.01, `${a.gearPosition}`); assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) > 0.01));
  for (let i = 0; i < 200; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 0); assert.ok(gears.every(g => !g.visible));
  s.gearDown = true; for (let i = 0; i < 240; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 1) < 1e-9); assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) < 1e-6));
  // Flaps travel to 30° and track aft; ailerons, elevators and rudder follow attitude changes.
  s.flaps = 2; for (let i = 0; i < 300; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.surfaces.flaps.length, 2); assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6));
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0); assert.ok(a.surfaces.elevators.every(x => x < -0.1)); assert.ok(a.surfaces.rudder[0] > 0.05);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('own transport cockpit fits phones and disposes; cameras frame it between the commuter and the 737', () => {
  const deck = createCockpit(id); assert.match(deck.name, /Valnera Q100 — cockpit/); assert.equal(typeof deck.userData.fit, 'function');
  deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900);
  let disposed = 0, meshes = 0; deck.traverse(o => { if (o.isMesh) { meshes++; o.geometry.addEventListener('dispose', () => disposed++); } });
  assert.ok(meshes > 10); disposeObject(deck); assert.equal(disposed, meshes);
  assert.ok(type.cameraScale > FLEET.commuter.cameraScale && type.cameraScale < FLEET.airliner.cameraScale);
  assert.equal(type.cockpitOffset.length, 3); assert.ok(type.cockpitOffset[2] < -10.5 && type.cockpitOffset[2] > -13.5, 'eye sits in the flight deck behind the nose');
});

test('four-fan sound reuses the passenger-jet bus with a gear horn; other jets keep their mix', () => {
  const q = passengerSound('cityliner', 0.8, 90), base = airlinerSound(0.8, 90);
  assert.ok(q.whine > base.whine && q.fan > base.fan && q.roarGain < base.roarGain);
  assert.deepEqual(passengerSound('airliner', 0.8, 90), base); assert.deepEqual(passengerSound('turbofan', 0.8, 90), jetSound(0.8, 90));
  assert.equal(passengerSound('regional', 0.8, 90).whine, base.whine * 1.13); assert.equal(passengerSound('widebody', 0.8, 90).fan, base.fan * 0.72);
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.whines = [1, 1.012].map(ratio => ({ ratio, osc: { frequency: param() }, gain: node() }));
  audio.fan = { frequency: param() }; audio.fanVoice = voice(); audio.roar = voice(); audio.rumble = voice();
  const s = { aircraft: id, spool: 0.8, throttle: 0.1, speed: 60, position: new Vector3(900, 120, -1800), gearDown: false };
  audio.update(s, true);
  assert.equal(audio.jetBus.gain.value, 1); assert.equal(audio.propBus.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0.12);
  assert.equal(audio.fan.frequency.value, q.fan); assert.ok(audio.master.gain.value > 0);
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
});

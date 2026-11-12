import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { FLEET } from '../src/fleet.js';
import { FlightController, FlightAudio, propellerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const id = 'motorglider', type = FLEET[id], f = type.flight, knots = v => v * 1.94384, fpm = v => v * 196.85;
const run = (flight, seconds, controls = {}) => { for (let i = 0; i < seconds * 120; i++) flight.update(1 / 120, controls); return flight.state; };
const flying = (aircraft = id) => new FlightController(groundHeight, aircraft);

test('Varen G18 is a complete, uniquely identified fleet choice with glider capabilities', () => {
  assert.equal(type.id, id); assert.equal(type.name, 'Varen G18');
  assert.equal(Object.values(FLEET).filter(t => t.registration === type.registration).length, 1);
  assert.equal(type.engine, 'piston'); assert.equal(type.fixedGear, true); assert.ok(!type.noFlaps);
  for (const key of Object.keys(FLEET.jet.flight)) assert.ok(key in f, key);
  assert.ok(f.idleSink < 6 && f.glidePitch > 0);
  assert.ok(type.summary.startsWith(type.name));
  assert.match(type.help, /no lift or thermal model/i); assert.match(type.runwayHint, /gear fixed/);
  // The other aircraft keep the default idle sink and level self-stability.
  for (const other of Object.values(FLEET)) if (other.id !== id) assert.ok(other.flight.idleSink === undefined && other.flight.glidePitch === undefined, other.id);
});

test('selection, steady motoring cruise and reset keep the motorglider', () => {
  const flight = flying('fighter'); run(flight, 1, { roll: 1 });
  flight.setAircraft(id); const s = flight.state;
  assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, true); assert.equal(s.flaps, 0);
  run(flight, 20);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2); assert.ok(Math.abs(s.position.y - 620) < 0.01);
  assert.ok(knots(s.speed) > 60 && knots(s.speed) < 72, 'slow motoring cruise');
  flight.reset(); assert.equal(s.aircraft, id); assert.equal(s.flightTime, 0);
});

test('power-off glide settles hands-off to a shallow, controllable descent near 50 kt', () => {
  const flight = flying(), s = flight.state;
  run(flight, 4, { throttle: -1 }); run(flight, 60);
  assert.equal(s.throttle, 0); assert.ok(s.spool < 0.001); assert.equal(s.stalled, false);
  assert.ok(Math.abs(s.pitch + f.glidePitch) < 0.004, `pitch ${s.pitch}`);
  assert.ok(knots(s.speed) > 46 && knots(s.speed) < 52, `${knots(s.speed)} kt`);
  assert.ok(fpm(s.verticalSpeed) < -220 && fpm(s.verticalSpeed) > -300, `${fpm(s.verticalSpeed)} fpm`);
  assert.ok(s.speed / -s.verticalSpeed > 17, 'glide ratio');
  // The glide still always descends: no lift is modelled.
  const start = s.position.y; run(flight, 30); assert.ok(s.position.y < start - 30);
  // A gentle nose-down tap speeds it up; restoring power brings the trim back to level flight.
  const before = s.speed; run(flight, 0.5, { pitch: -0.5 }); run(flight, 6); assert.ok(s.speed > before + 1);
  run(flight, 4, { throttle: 1 }); run(flight, 70); assert.ok(Math.abs(s.pitch) < 0.01, `pitch ${s.pitch}`); assert.ok(s.verticalSpeed > -0.3);
  // A comparable piston single sinks far faster with its engine at idle.
  const trainer = flying('trainer'); run(trainer, 4, { throttle: -1 }); run(trainer, 0.5, { pitch: -0.3 }); run(trainer, 20);
  assert.ok(trainer.state.verticalSpeed < s.verticalSpeed - 0.5 || trainer.state.stalled);
});

test('nose-high power-off stall uses its own threshold and recovers gently', () => {
  const flight = flying(), s = flight.state;
  for (let i = 0; i < 45 * 120 && !s.stalled; i++) flight.update(1 / 120, { throttle: -1, pitch: 0.3 });
  assert.equal(s.stalled, true); assert.ok(s.speed < f.stallSpeed && s.speed > f.stallSpeed - 0.3);
  assert.ok(knots(f.stallSpeed) > 34 && knots(f.stallSpeed) < 40);
  run(flight, 1.5); assert.ok(s.pitch < 0); assert.equal(s.crashed, false);
  const height = s.position.y;
  for (let i = 0; i < 30 * 120 && s.stalled; i++) flight.update(1 / 120, { throttle: 1 });
  assert.equal(s.stalled, false); assert.equal(s.crashed, false); assert.ok(height - s.position.y < 40);
});

test('runway self-launch with flaps and normal inputs on the real runway', () => {
  const flight = flying(), s = flight.state, p = runwayPoint(100), input = new FlightInputs();
  flight.runwayStart(p.x, AIRFIELD.elevation + type.groundClearance, p.z);
  assert.equal(s.gearDown, true); assert.equal(s.throttle, 0); flight.cycleFlaps(); assert.equal(s.flaps, 1);
  let previous = 0, largest = 0;
  for (let frame = 1; frame < 60 * 60 && s.grounded; frame++) {
    input.set({ throttle: 1, pitch: 1 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { flight.update(dt, c); largest = Math.max(largest, s.speed - previous); previous = s.speed; });
  }
  assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.ok(s.distance > 80 && s.distance < 300, `takeoff roll ${s.distance}`);
  assert.ok(s.speed >= f.rotateSpeed - f.flapStallGain); assert.ok(knots(s.speed) < 45);
  assert.ok(largest <= f.maxAcceleration * 0.025 + 1e-6);
  run(flight, 10, { throttle: 1 }); assert.equal(s.stalled, false); assert.ok(s.position.y > AIRFIELD.elevation + type.groundClearance + 20);
  assert.ok(fpm(s.verticalSpeed) > 250 && fpm(s.verticalSpeed) < 900, 'modest self-launch climb');
});

test('fixed gear and flaps reflect the physical configuration; no gear horn', () => {
  const flight = flying(), s = flight.state;
  s.position.set(900, 100, -1800); s.throttle = 0;
  assert.equal(flight.gearWarning, false);
  flight.toggleGear(); assert.equal(s.gearDown, true);
  for (const flaps of [1, 2, 0]) { flight.cycleFlaps(); assert.equal(s.flaps, flaps); }
});

test('landing mission: own low approach speed, power above idle and a normal-input pilot lands', () => {
  const p = landingProfile(type);
  assert.equal(p.flaps, 2); assert.ok(knots(p.speed) > 46 && knots(p.speed) < 52);
  assert.ok(p.throttle > 0.05 && p.throttle < 0.3, `approach power ${p.throttle}`);
  assert.ok(p.speed > f.stallSpeed - 2 * f.flapStallGain + 6 && p.speed < f.maxTouchdownSpeed);
  for (const other of Object.values(FLEET)) if (!other.flight.rotorcraft && other.id !== id) assert.ok(other.landing.speed > p.speed, other.id);
  const flight = flying(), mission = new LandingMission(), s = flight.state, inputs = new FlightInputs(0);
  mission.start(flight); assert.equal(s.flaps, 2); assert.equal(s.gearDown, true);
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - AIRFIELD.elevation - p.clearance;
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const desiredPitch = Math.asin((-sink + Math.max(0, 0.32 - s.spool) * f.idleSink) / Math.max(s.speed, 1));
    inputs.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded ? -1 : 0 }, (frame - 1) / 60);
    inputs.advance(frame / 60, (step, c) => { if (!mission.active) return; flight.update(step, c); mission.update(step, s); });
  }
  assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
  const t = mission.touchdown;
  assert.ok(t.along >= TOUCHDOWN_ZONE.start && t.along <= TOUCHDOWN_ZONE.end); assert.ok(t.sink < p.maxSink);
  assert.ok(mission.guidance(s).remaining > 500, 'short rollout');
});

test('landing mission: hands-off floats long, and a dive fails for a hard landing then retries', () => {
  let flight = flying(), mission = new LandingMission(); mission.start(flight);
  for (let i = 0; i < 120 * 90 && mission.active; i++) { flight.update(1 / 120, {}); mission.update(1 / 120, flight.state); }
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /touchdown zone|Runway passed/);
  flight = flying(); mission = new LandingMission(); const input = new FlightInputs(); mission.start(flight);
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
test('brief 30/100 ms taps stay small and frame-rate independent; roll is gentle', () => {
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) for (const duration of [0.03, 0.1]) {
    const reference = tap(axis, sign, 120, duration), baseline = tap(axis, 0, 120, duration);
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis], difference = reference[field] - baseline[field];
    const delta = (axis === 'yaw' ? Math.atan2(Math.sin(difference), Math.cos(difference)) : difference) * sign;
    assert.ok(delta > 0 && delta < (axis === 'roll' ? 0.02 : 0.015), `${axis} ${duration}: ${delta}`);
    assert.equal(reference.crashed, false); assert.equal(reference.stalled, false);
    for (const hz of [10, 30, 60]) { const s = tap(axis, sign, hz, duration);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < 1e-4); assert.ok(Math.abs(s.throttle - reference.throttle) < 1e-12); }
  }
  // Gentler roll than the trainer: one second of full aileron banks it less.
  const bank = aircraft => { const flight = flying(aircraft); run(flight, 1, { roll: 1 }); return flight.state.bank; };
  assert.ok(bank(id) < bank('trainer') * 0.75);
});

test('quiet small-prop voice on the propeller bus; no gear horn; mutes on crash', () => {
  const piston = propellerSound('piston', 1, 30), glider = propellerSound('piston', 1, 30, type.propVoice);
  assert.ok(glider.tone > piston.tone && glider.toneGain < piston.toneGain && glider.washGain < piston.washGain);
  assert.deepEqual(propellerSound('piston', 0.5, 20, undefined), propellerSound('piston', 0.5, 20));
  const idle = propellerSound('piston', 0, 0, type.propVoice), full = propellerSound('piston', 1, 60, type.propVoice);
  for (const key of ['tone', 'toneGain', 'washGain', 'wind', 'master']) assert.ok(full[key] > idle[key]);
  // Stopped prop: blade tone, pulse and propwash are silent; slipstream wind and the master bus remain.
  const { stopBelow } = type.propVoice, stopped = propellerSound('piston', stopBelow * 0.99, 26, type.propVoice);
  assert.equal(stopped.toneGain, 0); assert.equal(stopped.washGain, 0); assert.equal(stopped.pulseDepth, 0);
  assert.ok(stopped.wind > 0.04 && stopped.master > 0.4);
  assert.equal(propellerSound('piston', 0, 26, type.propVoice).wind, propellerSound('piston', 0, 26).wind);
  // It fades in over one more band of spool, then runs at the quiet level.
  const fading = [1, 1.25, 1.5, 1.75, 2].map(k => propellerSound('piston', stopBelow * k, 26, type.propVoice).toneGain);
  for (let i = 1; i < fading.length; i++) assert.ok(fading[i] > fading[i - 1]);
  const running = propellerSound('piston', 0.3, 26, type.propVoice), plain = propellerSound('piston', 0.3, 26);
  assert.ok(Math.abs(running.toneGain - plain.toneGain * type.propVoice.level) < 1e-12);
  // Every other aircraft (no voice, or no stopBelow) keeps its idle prop sound exactly.
  for (const other of Object.values(FLEET)) if (other.id !== id && ['piston', 'aeroprop', 'turboprop'].includes(other.engine)) {
    const idleOther = propellerSound(other.engine, 0, 20, other.propVoice);
    assert.ok(idleOther.toneGain > 0 && idleOther.washGain > 0, other.id);
    if (!other.propVoice) assert.deepEqual(idleOther, propellerSound(other.engine, 0, 20, {}));
  }
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  const s = { aircraft: id, spool: 0.72, speed: f.cruiseSpeed };
  audio.update(s, true);
  assert.equal(audio.propBus.gain.value, 1); assert.equal(audio.jetBus.gain.value, 0); assert.equal(audio.gearHorn.gain.value, 0);
  assert.equal(audio.prop.tone.frequency.value, propellerSound('piston', 0.72, f.cruiseSpeed, type.propVoice).tone);
  audio.update({ ...s, spool: 0, throttle: 0, speed: 26 }, false);
  assert.equal(audio.prop.toneVoice.gain.gain.value, 0); assert.equal(audio.prop.wash.gain.gain.value, 0);
  assert.ok(audio.wind.gain.value > 0 && audio.master.gain.value > 0, 'airflow remains with the prop stopped');
  audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0);
});

test('slender airframe: span, ground contact, stopped/turning prop, moving surfaces, wheels and disposal', () => {
  const a = createAircraft(id), s = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 0, spool: 0 };
  a.update(0.01, 0, s); const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(Math.abs(size.x - 18.1) < 0.2, `span ${size.x}`); assert.ok(size.z > 7 && size.z < 7.6); assert.ok(size.y < 2.4);
  assert.ok(size.x / size.z > 2.3, 'very long wings for the fuselage');
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
  let meshes = 0, triangles = 0; const props = [], tyres = [];
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
    if (o.name === 'propeller') props.push(o); if (o.name === 'tyre') tyres.push(o); });
  assert.equal(props.length, 1); assert.equal(tyres.length, 4); assert.ok(meshes < 60 && triangles < 40000, `${meshes} / ${triangles}`);
  // Every tyre clears or touches the runway, and only the in-line monowheel and tailwheel carry the aircraft.
  const touching = tyres.filter(t => Math.abs(new Box3().setFromObject(t).min.y - box.min.y) < 1e-6).length;
  assert.equal(touching, 2);
  // The prop is still with the engine stopped and turns with spool; wheels roll on the ground.
  const angle = props[0].rotation.z; a.update(0.5, 0, s); assert.equal(props[0].rotation.z, angle);
  const stop = type.propVoice.stopBelow; a.update(0.5, 0, { ...s, spool: stop * 0.99 }); assert.equal(props[0].rotation.z, angle);
  a.update(0.1, 0, { ...s, spool: stop * 1.01 }); assert.notEqual(props[0].rotation.z, angle);
  a.update(0.1, 1, { ...s, spool: 1, speed: 10 }); assert.notEqual(props[0].rotation.z, angle);
  Object.assign(s, { grounded: false, flightTime: 10, flaps: 2, speed: 26 });
  for (let i = 0; i < 300; i++) a.update(1 / 60, 0.3, s);
  assert.equal(a.gearPosition, 1); assert.equal(a.surfaces.flaps.length, 2);
  assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6));
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.3, s); }
  assert.ok(a.surfaces.ailerons[0] * a.surfaces.ailerons[1] < 0); assert.ok(a.surfaces.elevators.every(x => x < -0.05)); assert.ok(a.surfaces.rudder[0] > 0.02);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
  const deck = createCockpit(id); assert.match(deck.name, /Varen G18/); assert.equal(typeof deck.userData.fit, 'function');
  deck.userData.fit(390 / 844); deck.userData.fit(1600 / 900); disposeObject(deck);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Box3 } from 'three';
import { FlightController, FlightAudio, helicopterSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { disposeObject } from '../src/helicopter.js';

const helicopter = (height = () => 78) => new FlightController(height, 'helicopter');
function fly(f, seconds, controls = {}, rate = 120) {
  for (let i = 0; i < Math.round(seconds * rate); i++) f.update(1 / rate, controls);
  return f.state;
}
function shaped(events, seconds, rate = 60) {
  const f = helicopter(), input = new FlightInputs();
  for (const [t, c] of events) input.set(c, t);
  for (let t = 0; t < seconds - 1e-9;) {
    t = Math.min(seconds, t + 1 / rate);
    input.advance(t, (dt, c) => f.update(dt, c));
  }
  return { f, input, s: f.state };
}

test('airborne reset is a zero-airspeed hover at 58% collective, with fixed skids', () => {
  const f = helicopter(), s = f.state, position = s.position.clone();
  assert.equal(s.throttle, 0.58); assert.equal(s.speed, 0); assert.equal(s.rotorSpeed, 1);
  for (const assisted of [false, true]) {
    if (assisted) f.toggleAutopilot();
    fly(f, 120);
    assert.ok(s.position.distanceTo(position) < 0.001);
    assert.equal(s.gForce, 1); assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  }
  s.throttle = 0; s.position.y = 90;
  assert.equal(f.gearWarning, false); assert.equal(f.toggleGear(), true); assert.equal(s.gearDown, true);
  assert.equal(f.cycleFlaps(), 0); assert.equal(s.flaps, 0);
});

test('collective climbs and descends vertically, with airspeed and G from actual velocity', () => {
  for (const [collective, sign] of [[0.7, 1], [0.5, -1]]) {
    const f = helicopter(), s = f.state, y = s.position.y; s.throttle = collective;
    const before = s.velocity.clone(); f.update(1 / 120);
    const expectedG = s.velocity.clone().sub(before).multiplyScalar(120).add(new Vector3(0, 9.81, 0)).dot(new Vector3(0, 1, 0).applyQuaternion(s.quaternion)) / 9.81;
    assert.ok(Math.abs(s.gForce - expectedG) < 1e-10);
    fly(f, 10);
    assert.ok((s.position.y - y) * sign > 10); assert.ok(s.verticalSpeed * sign > 1);
    assert.equal(s.speed, s.velocity.length()); assert.equal(s.verticalSpeed, s.velocity.y);
    assert.equal(s.position.x, 0); assert.equal(s.position.z, 1900);
    assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  }
});

test('cyclic translates forward, backward, left and right without needing airspeed; yaw turns independently', () => {
  for (const [control, axis, sign] of [[{ pitch: -1 }, 'z', -1], [{ pitch: 1 }, 'z', 1], [{ roll: -1 }, 'x', -1], [{ roll: 1 }, 'x', 1]]) {
    const f = helicopter(), s = f.state, start = s.position.clone(); fly(f, 8, control);
    assert.ok((s.position[axis] - start[axis]) * sign > 60);
    assert.ok(s.speed > 20); assert.ok(Math.abs(s.position.y - start.y) < 0.01);
    assert.equal(s.heading, 0, 'bank is lateral cyclic, not a coordinated fixed-wing turn');
    assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  }
  for (const sign of [-1, 1]) {
    const f = helicopter(), s = fly(f, 3, { yaw: sign });
    assert.ok(Math.atan2(Math.sin(s.heading), Math.cos(s.heading)) * sign > 1.7);
    assert.equal(s.speed, 0); assert.equal(s.position.x, 0); assert.equal(s.position.z, 1900);
    fly(f, 2); const heading = s.heading; fly(f, 2);
    assert.ok(Math.abs(s.heading - heading) < 1e-6, 'yaw rate settles after release');
  }
  const f = helicopter(); f.state.heading = Math.PI / 2; f.setQuaternion();
  fly(f, 5, { pitch: -1 }); assert.ok(f.state.position.x > 30, 'forward cyclic follows nose after yaw');
});

test('hover assist brakes forward flight and captures position, altitude and heading', () => {
  const f = helicopter(); fly(f, 8, { pitch: -1, yaw: 0.08 });
  assert.ok(f.state.speed > 25); f.state.velocity.y = -2;
  assert.equal(f.toggleAutopilot(), true);
  const target = f.state.position.clone(), heading = f.state.heading;
  fly(f, 65);
  assert.ok(f.state.position.distanceTo(target) < 0.02, `hover error ${f.state.position.distanceTo(target)}`);
  assert.ok(f.state.speed < 0.001); assert.ok(Math.abs(f.state.heading - heading) < 0.001);
  assert.equal(f.state.crashed, false);
  for (const control of [{ pitch: -0.02 }, { roll: 0.02 }, { yaw: -0.02 }, { throttle: 0.02 }]) {
    if (!f.state.autopilot) f.toggleAutopilot(); f.update(1 / 120, control);
    assert.equal(f.state.autopilot, false, 'manual cyclic, yaw or collective takes over');
  }
});

test('ground start spools rotors from rest and lifts vertically; idle is parked', () => {
  const f = helicopter(), s = f.runwayStart(900, 80.8, -1350);
  assert.equal(s.position.y, 79.6); assert.equal(s.rotorSpeed, 0);
  fly(f, 10); assert.equal(s.speed, 0); assert.equal(s.rotorSpeed, 0); assert.equal(s.grounded, true);
  assert.equal(f.toggleAutopilot(), false);
  s.throttle = 0.75; fly(f, 0.5); assert.equal(s.grounded, true); assert.ok(s.rotorSpeed < 0.5);
  fly(f, 10); assert.equal(s.grounded, false); assert.ok(s.position.y > 95);
  assert.equal(s.position.x, 900); assert.equal(s.position.z, -1350); assert.equal(s.crashed, false);
});

test('gentle level skid landings settle; hard, fast, tilted, terrain and water contact crash', () => {
  const gentle = helicopter(); gentle.state.position.y = 85; gentle.state.throttle = gentle.state.spool = 0.52;
  fly(gentle, 10); assert.equal(gentle.state.grounded, true); assert.equal(gentle.state.crashed, false);
  assert.equal(gentle.state.position.y, 79.6); assert.equal(gentle.state.speed, 0);
  for (const mode of ['hard', 'fast', 'tilted', 'terrain', 'slope', 'water']) {
    const f = helicopter(mode === 'water' ? () => 10 : mode === 'terrain' ? x => x > 0 ? 200 : 78 : mode === 'slope' ? x => 78 + x : () => 78), s = f.state;
    s.position.set(mode === 'terrain' ? 0.1 : 0, mode === 'water' ? 11.605 : 79.605, 1900);
    s.throttle = s.spool = .5; s.velocity.y = mode === 'hard' ? -4 : -1;
    if (mode === 'fast') s.velocity.x = 8;
    if (mode === 'tilted') s.bank = .4;
    fly(f, 0.2); assert.equal(s.crashed, true, mode); assert.equal(s.grounded, false, mode);
    assert.equal(s.autopilot, false); assert.equal(s.speed, 0);
    const position = s.position.clone(); fly(f, 2, { throttle: 1, pitch: 1 }); assert.deepEqual(s.position.toArray(), position.toArray());
  }
});

test('brief inputs are fine corrections; holds retain authority; release and reset clear all commands at 10–120 Hz', () => {
  for (const rate of [10, 15, 30, 60, 120]) for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) {
    const { s, f, input } = shaped([[.013, { [axis]: sign }], [.113, {}]], 1.613, rate);
    const hold = shaped([[0, { [axis]: sign }]], 1.613, rate).s;
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis];
    const wrapped = a => field === 'heading' ? Math.atan2(Math.sin(a), Math.cos(a)) : a;
    const baseline = axis === 'throttle' ? .58 : 0;
    const correction = wrapped(s[field] - baseline) * sign;
    assert.ok(correction > 0 && correction < (axis === 'throttle' || axis === 'yaw' ? .006 : .004), `${axis} ${rate}: ${correction}`);
    assert.ok(wrapped(hold[field] - baseline) * sign > correction * 10, 'holding has useful authority');
    assert.ok(Object.values(input.value).every(v => v === 0));
    assert.equal(s.crashed, false); assert.equal(s.stalled, false);
    f.reset(); assert.equal(f.state.speed, 0); assert.equal(f.pitchRate, 0); assert.equal(f.yawRate, 0);
  }
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) {
    const events = [[.013, { [axis]: 1 }], [.113, {}], [.33, { [axis]: -1 }], [.43, {}]];
    const reference = shaped(events, 2, 120).s;
    for (const rate of [10, 15, 30, 60]) {
      const s = shaped(events, 2, rate).s;
      assert.ok(s.position.distanceTo(reference.position) < .001);
      assert.ok(s.quaternion.angleTo(reference.quaternion) < .0001);
    }
  }
});

test('switching among all three types resets velocity, rotors, warnings, rates and hover state', () => {
  const f = helicopter(); fly(f, 5, { pitch: -1, roll: 1, yaw: 1, throttle: 1 });
  for (const id of ['fighter', 'helicopter', 'jet', 'helicopter']) {
    f.setAircraft(id); const s = f.state;
    assert.equal(s.aircraft, id); assert.equal(s.speed, FLEET[id].flight.cruiseSpeed);
    assert.equal(s.throttle, FLEET[id].flight.cruiseThrottle); assert.equal(s.flightTime, 0);
    assert.equal(f.pitchRate, 0); assert.equal(f.rollRate, 0); assert.equal(f.yawRate, 0);
    assert.equal(s.autopilot, false); assert.equal(s.stalled, false); assert.equal(s.crashed, false);
    if (id === 'helicopter') { assert.equal(s.velocity.length(), 0); assert.equal(s.rotorSpeed, 1); fly(f, 5); assert.equal(s.speed, 0); }
  }
});

test('original helicopter is compact, reflective, animated, hides in cockpit and disposes resources', () => {
  const a = createAircraft('helicopter'); assert.match(a.group.name, /Laret H4/);
  const box = new Box3().setFromObject(a.group);
  assert.ok(Math.abs(box.min.y + 1.6) < .02, `skids ${box.min.y}`);
  assert.ok(box.max.z > 6 && box.max.y > 2 && box.max.x > 5);
  assert.ok(a.materials.glass.isMeshPhysicalMaterial); assert.ok(a.materials.paint.isMeshPhysicalMaterial);
  let meshes = 0, disposed = 0; a.group.traverse(o => { if (o.isMesh) { meshes++; o.geometry.addEventListener('dispose', () => disposed++); } });
  assert.ok(meshes < 30, `draw meshes ${meshes}`);
  const main = a.mainRotor.rotation.y, tail = a.tailRotor.rotation.x;
  a.update(.02, .58, { rotorSpeed: 1 }); assert.notEqual(a.mainRotor.rotation.y, main); assert.notEqual(a.tailRotor.rotation.x, tail);
  const spinning = a.mainRotor.rotation.y; a.update(.1, .58, { rotorSpeed: 0 }); assert.equal(a.mainRotor.rotation.y, spinning);
  a.update(.1, .58, { rotorSpeed: 1, crashed: true }); assert.equal(a.mainRotor.rotation.y, spinning);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const cockpit = createCockpit('helicopter'); assert.match(cockpit.name, /Laret H4/); assert.equal(typeof cockpit.userData.update, 'function');
  disposeObject(cockpit); a.dispose(); assert.equal(disposed, meshes);
});

test('rotor mix follows RPM, collective load and airspeed without a fixed-wing stall/gear horn', async t => {
  const off = helicopterSound(0, 0), hover = helicopterSound(1, .58), power = helicopterSound(1, 1, 40);
  assert.equal(off.master, 0); assert.equal(off.rotorGain, 0);
  assert.ok(hover.bladePass > 18 && hover.bladePass < 20); assert.equal(hover.bladePass, power.bladePass);
  assert.ok(power.chopGain > hover.chopGain); assert.ok(power.master > hover.master); assert.ok(power.wind > hover.wind);
  assert.deepEqual(helicopterSound(NaN, NaN, NaN), helicopterSound(0, 0, 0));
  const parameter = () => ({ value: 0, targets: [], setTargetAtTime(v) { this.targets.push(v); } });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), connect(n) { return n; }, start() {} });
  const ctx = { currentTime: 1, sampleRate: 32, destination: node(), createGain: node, createBiquadFilter: node, createBufferSource: node, createOscillator: node, createBuffer: (_c,n) => ({ getChannelData: () => new Float32Array(n) }), async resume() {} };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return ctx; } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else delete globalThis.AudioContext; });
  const audio = new FlightAudio(); await audio.start();
  const s = { aircraft: 'helicopter', rotorSpeed: 1, spool: .58, speed: 0, stalled: true };
  audio.update(s, true); assert.equal(audio.stallActive, false); assert.equal(audio.gearHorn.gain.targets.at(-1), 0);
  assert.equal(audio.jetBus.gain.targets.at(-1), 0); assert.equal(audio.fighterBus.gain.targets.at(-1), 0); assert.equal(audio.helicopterBus.gain.targets.at(-1), 1);
  assert.ok(audio.master.gain.targets.at(-1) > 0);
  audio.update({ ...s, crashed: true }); assert.equal(audio.master.gain.targets.at(-1), 0);
  audio.update({ ...s, rotorSpeed: 0 }); assert.equal(audio.master.gain.targets.at(-1), 0);
  audio.toggle(); audio.update(s); assert.equal(audio.master.gain.targets.at(-1), 0);
  audio.enabled = true; audio.update({ ...s, aircraft: 'fighter', stalled: false }); assert.equal(audio.helicopterBus.gain.targets.at(-1), 0); assert.equal(audio.fighterBus.gain.targets.at(-1), 1);
});

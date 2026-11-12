import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { FlightController, FlightAudio, helicopterSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET, aircraftType } from '../src/fleet.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { EXPANDED_AIRCRAFT } from '../src/fleet-models.js';
import { disposeObject } from '../src/helicopter.js';
import { D, COCKPIT } from '../src/transport.js';
import { groundHeight } from '../src/world.js';
import { AIRFIELD, runwayPoint } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const id = 'transport', type = FLEET[id], f = type.flight;
const flying = (which = id, height = () => 78) => new FlightController(height, which);
function fly(flight, seconds, controls = {}, rate = 120) {
  for (let i = 0; i < Math.round(seconds * rate); i++) flight.update(1 / rate, controls);
  return flight.state;
}
function shaped(which, events, seconds, rate = 60) {
  const flight = flying(which), input = new FlightInputs();
  for (const [t, c] of events) input.set(c, t);
  for (let t = 0; t < seconds - 1e-9;) { t = Math.min(seconds, t + 1 / rate); input.advance(t, (dt, c) => flight.update(dt, c)); }
  return { flight, input, s: flight.state };
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

test('Sorna H8 is its own rotorcraft beside an unchanged Laret H4, with truthful wheel-gear text', () => {
  assert.equal(aircraftType(id), type); assert.equal(type.id, id); assert.equal(type.engine, 'rotor');
  assert.equal(f.rotorcraft, true); assert.equal(type.landingGear, 'wheels');
  assert.deepEqual(EXPANDED_AIRCRAFT, ['trainer', 'bush', 'commuter', 'regional', 'widebody', 'aerobatic']);
  for (const other of Object.values(FLEET)) if (other !== type) {
    assert.notEqual(other.registration, type.registration); assert.notEqual(other.name, type.name); assert.notEqual(other.badge, type.badge);
  }
  // The Laret H4 keeps every tuned value; it relies on the shared defaults for the new optional parameters.
  assert.deepEqual(FLEET.helicopter.flight, {
    rotorcraft: true, cruiseSpeed: 0, cruiseThrottle: 0.58, throttleRate: 0.22, hoverCollective: 0.58, collectiveResponse: 3,
    rotorSpinUp: 1.1, rotorSpinDown: 0.35, pitchRate: 0.48, pitchResponse: 6, rollRate: 0.55, rollResponse: 6, yawRate: 0.65,
    pitchLimits: [-0.55, 0.45], bankLimit: 0.5, groundClearance: 1.6, maxTouchdownSpeed: 5, maxTouchdownSink: 2, aerobatic: false,
  });
  assert.equal(FLEET.helicopter.landingGear, undefined); assert.equal(FLEET.helicopter.rotor, undefined);
  assert.equal(FLEET.helicopter.registration, 'A-LH04');
  // Text quotes the tuned numbers and describes wheels, never skids.
  const text = [type.help, type.runwayHint, type.choice, type.summary].join(' ');
  assert.match(type.help, new RegExp(`${Math.round(f.hoverCollective * 100)}% collective`));
  assert.match(type.runwayHint, new RegExp(`${Math.round(f.hoverCollective * 100)}% hovers`));
  assert.match(type.help, new RegExp(`below ${Math.round(f.maxTouchdownSpeed * 1.94384)} knots`));
  const fpm = Number(type.help.match(/(\d+) ft\/min/)[1]);
  assert.ok(fpm < f.maxTouchdownSink * 196.85 && fpm > f.maxTouchdownSink * 196.85 - 10, `${fpm} ft/min`);
  assert.match(text, /wheel/i); assert.doesNotMatch(text, /skid|58%/i);
  assert.ok(type.summary.startsWith(type.name));
  // Larger and more deliberate than the light H4 on every axis, with a slower rotor and lift response.
  const h4 = FLEET.helicopter.flight;
  for (const key of ['pitchRate', 'pitchResponse', 'rollRate', 'rollResponse', 'yawRate', 'collectiveResponse', 'rotorSpinUp', 'rotorSpinDown', 'throttleRate', 'bankLimit'])
    assert.ok(f[key] < h4[key], key);
  assert.ok(f.yawResponse < 6 && f.levelRate < 1.6);
  assert.ok(f.groundClearance > h4.groundClearance);
});

test('main.js reads hover, settle and gear wording from the active type rather than H4 numbers', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /58%|57%|55%|below 10 kt|Below 10 kt/);
  assert.match(main, /\$\{Object\.keys\(FLEET\)\.length\} to fly/);
  for (const t of Object.values(FLEET).filter(t => t.flight.rotorcraft)) {
    const p = landingProfile(t);
    assert.equal(p.throttle, t.flight.hoverCollective);
    assert.ok(p.settlePower < p.throttle && p.settlePower > p.throttle - 0.02);
    assert.equal(p.contact, t.landingGear ?? 'skids');
  }
  assert.equal(landingProfile(FLEET.helicopter).settlePower, 0.57, 'the H4 keeps its 57% settle limit');
  assert.equal(landingProfile(type).contact, 'wheels');
  assert.equal(landingProfile(FLEET.jet).settlePower, 0.2);
});

test('airborne reset is a zero-airspeed hover at its own collective; fixed wheels never warn', () => {
  const flight = flying(), s = flight.state, start = s.position.clone();
  assert.equal(s.throttle, f.hoverCollective); assert.equal(s.speed, 0); assert.equal(s.rotorSpeed, 1); assert.equal(s.gearDown, true);
  for (const assisted of [false, true]) {
    if (assisted) flight.toggleAutopilot();
    fly(flight, 120);
    assert.ok(s.position.distanceTo(start) < 0.001); assert.equal(s.gForce, 1);
    assert.equal(s.stalled, false); assert.equal(s.crashed, false);
  }
  s.throttle = 0; s.position.y = 90;
  assert.equal(flight.gearWarning, false); assert.equal(flight.toggleGear(), true); assert.equal(s.gearDown, true);
  assert.equal(flight.cycleFlaps(), 0); assert.equal(s.flaps, 0);
});

test('collective climbs and descends vertically, and lift lags the lever more than the H4', () => {
  for (const [delta, sign] of [[0.12, 1], [-0.1, -1]]) {
    const flight = flying(), s = flight.state, y = s.position.y; s.throttle = f.hoverCollective + delta;
    fly(flight, 10);
    assert.ok((s.position.y - y) * sign > 10); assert.ok(s.verticalSpeed * sign > 1);
    assert.equal(s.speed, s.velocity.length()); assert.equal(s.position.x, 0); assert.equal(s.position.z, 1900);
    assert.equal(s.crashed, false);
  }
  const response = which => { const flight = flying(which), s = flight.state; s.throttle = FLEET[which].flight.hoverCollective + 0.1; fly(flight, 0.5); return s.verticalSpeed; };
  assert.ok(response(id) < response('helicopter') * 0.75, 'the heavier rotor answers collective more slowly');
});

test('cyclic flies forward, backward and sideways without airspeed; yaw is independent and steadier than the H4', () => {
  for (const [control, axis, sign] of [[{ pitch: -1 }, 'z', -1], [{ pitch: 1 }, 'z', 1], [{ roll: -1 }, 'x', -1], [{ roll: 1 }, 'x', 1]]) {
    const flight = flying(), s = flight.state, start = s.position.clone(); fly(flight, 8, control);
    assert.ok((s.position[axis] - start[axis]) * sign > 35, `${axis} ${sign}: ${s.position[axis] - start[axis]}`);
    assert.ok(s.speed > 10); assert.ok(Math.abs(s.position.y - start.y) < 0.05);
    assert.equal(s.heading, 0); assert.equal(s.stalled, false); assert.equal(s.crashed, false);
    const h4 = fly(flying('helicopter'), 8, control);
    assert.ok(Math.abs(s.position[axis] - start[axis]) < Math.abs(h4.position[axis] - start[axis]), 'heavier: covers less ground');
    // Released cyclic levels the disc and momentum decays.
    fly(flight, 6); assert.ok(Math.abs(s.pitch) < 0.01 && Math.abs(s.bank) < 0.01);
  }
  const tilt = which => fly(flying(which), 0.5, { pitch: -1 }).pitch;
  assert.ok(Math.abs(tilt(id)) < Math.abs(tilt('helicopter')) * 0.75, 'cyclic tilt builds more deliberately');
  for (const sign of [-1, 1]) {
    const flight = flying(), s = fly(flight, 3, { yaw: sign }), h4 = fly(flying('helicopter'), 3, { yaw: sign });
    assert.ok(wrap(s.heading) * sign > 0.9 && wrap(s.heading) * sign < wrap(h4.heading) * sign);
    assert.equal(s.speed, 0); assert.equal(s.position.x, 0);
    fly(flight, 6); const heading = s.heading; fly(flight, 2); assert.ok(Math.abs(s.heading - heading) < 1e-6, 'yaw settles after release');
  }
  const flight = flying(); flight.state.heading = Math.PI / 2; flight.setQuaternion();
  fly(flight, 6, { pitch: -1 }); assert.ok(flight.state.position.x > 20, 'forward cyclic follows the nose');
});

test('brief taps are gentle on every axis at 10–120 Hz; holds keep authority; release clears commands', () => {
  for (const rate of [10, 15, 30, 60, 120]) for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) for (const sign of [-1, 1]) {
    const { s, flight, input } = shaped(id, [[0.013, { [axis]: sign }], [0.113, {}]], 1.613, rate);
    const hold = shaped(id, [[0, { [axis]: sign }]], 1.613, rate).s;
    const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis];
    const baseline = axis === 'throttle' ? f.hoverCollective : 0, delta = a => field === 'heading' ? wrap(a) : a;
    const correction = delta(s[field] - baseline) * sign;
    assert.ok(correction > 0 && correction < 0.004, `${axis} ${rate}: ${correction}`);
    assert.ok(delta(hold[field] - baseline) * sign > correction * 10, 'holding has useful authority');
    assert.ok(Object.values(input.value).every(v => v === 0));
    assert.equal(s.crashed, false);
    flight.reset(); assert.equal(flight.pitchRate, 0); assert.equal(flight.yawRate, 0);
  }
  for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) {
    const events = [[0.013, { [axis]: 1 }], [0.113, {}], [0.33, { [axis]: -1 }], [0.43, {}]];
    const reference = shaped(id, events, 2, 120).s;
    for (const rate of [10, 15, 30, 60]) {
      const s = shaped(id, events, 2, rate).s;
      assert.ok(s.position.distanceTo(reference.position) < 0.001); assert.ok(s.quaternion.angleTo(reference.quaternion) < 0.0001);
    }
  }
});

test('hover hold brakes forward and sideways flight into the captured point; any input takes over', () => {
  for (const control of [{ pitch: -1, yaw: 0.1 }, { roll: 1 }, { pitch: 1 }]) {
    const flight = flying(); fly(flight, 8, control); flight.state.velocity.y = -1.5;
    assert.equal(flight.toggleAutopilot(), true);
    const target = flight.state.position.clone(), heading = flight.state.heading;
    fly(flight, 70);
    assert.ok(flight.state.position.distanceTo(target) < 0.03, `hold error ${flight.state.position.distanceTo(target)}`);
    assert.ok(flight.state.speed < 0.002); assert.ok(Math.abs(flight.state.heading - heading) < 0.001);
  }
  const flight = flying();
  for (const control of [{ pitch: 0.02 }, { roll: -0.02 }, { yaw: 0.02 }, { throttle: -0.02 }]) {
    if (!flight.state.autopilot) flight.toggleAutopilot(); flight.update(1 / 120, control);
    assert.equal(flight.state.autopilot, false);
  }
});

test('ground start parks on its wheels; the rotor spins up more slowly than the H4 before a vertical lift-off', () => {
  const flight = flying(), s = flight.runwayStart(900, 80.8, -1350);
  assert.equal(s.position.y, 78 + f.groundClearance); assert.equal(s.rotorSpeed, 0); assert.equal(s.grounded, true);
  fly(flight, 10); assert.equal(s.rotorSpeed, 0); assert.equal(s.grounded, true); assert.equal(flight.toggleAutopilot(), false);
  const liftOff = which => {
    const g = flying(which), state = g.runwayStart(900, 80.8, -1350); state.throttle = 0.8;
    let t = 0; while (state.grounded && t < 30) { g.update(1 / 120); t += 1 / 120; }
    return { t, g, state };
  };
  const h8 = liftOff(id), h4 = liftOff('helicopter');
  assert.ok(h8.t > h4.t * 1.5 && h8.t < 10, `${h8.t}s vs ${h4.t}s`);
  fly(h8.g, 8); assert.ok(h8.state.position.y > 95); assert.equal(h8.state.position.x, 900); assert.equal(h8.state.crashed, false);
  // Collective at idle lets the rotor run down over several seconds.
  const spin = flying(); spin.state.throttle = 0; spin.state.rotorSpeed = 1; spin.state.position.y = 600; fly(spin, 2);
  assert.ok(spin.state.rotorSpeed > 0.5 && spin.state.rotorSpeed < 1);
});

test('gentle level landings settle on the wheels; hard, fast, tilted, sloped, terrain and water contact crash', () => {
  const gentle = flying(); gentle.state.position.y = 86; gentle.state.throttle = gentle.state.spool = f.hoverCollective - 0.06;
  fly(gentle, 12); assert.equal(gentle.state.grounded, true); assert.equal(gentle.state.crashed, false);
  assert.equal(gentle.state.position.y, 78 + f.groundClearance); assert.equal(gentle.state.speed, 0);
  assert.ok(gentle.state.touchdown.sink < f.maxTouchdownSink);
  for (const mode of ['hard', 'fast', 'tilted', 'terrain', 'slope', 'water']) {
    const ground = mode === 'water' ? () => 10 : mode === 'terrain' ? x => x > 0 ? 200 : 78 : mode === 'slope' ? x => 78 + x * 0.4 : () => 78;
    const flight = flying(id, ground), s = flight.state;
    s.position.set(mode === 'terrain' ? 0.1 : 0, (mode === 'water' ? 10 : 78) + f.groundClearance + 0.005, 1900);
    s.throttle = s.spool = 0.5; s.velocity.y = mode === 'hard' ? -3.5 : -1;
    if (mode === 'fast') s.velocity.x = 7;
    if (mode === 'tilted') s.bank = 0.35;
    fly(flight, 0.2); assert.equal(s.crashed, true, mode); assert.equal(s.grounded, false, mode);
    assert.equal(s.crashReason, mode === 'water' ? 'Water collision' : 'Hard landing');
    const position = s.position.clone(); fly(flight, 2, { throttle: 1, pitch: 1 }); assert.deepEqual(s.position.toArray(), position.toArray());
  }
});

test('landing mission: hover start, gentle collective-only landing on the wheels, then failure and retry', () => {
  const flight = new FlightController(groundHeight, id), mission = new LandingMission(), s = flight.state, p = landingProfile(type);
  let frame = 0;
  const pilot = (frames, control) => {
    const input = new FlightInputs(frame / 60);
    for (let i = 0; i < frames && mission.active; i++) {
      frame++; input.set(control(), (frame - 1) / 60);
      input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); });
    }
  };
  mission.start(flight);
  assert.equal(s.throttle, f.hoverCollective); assert.equal(s.rotorSpeed, 1); assert.equal(s.speed, 0); assert.equal(s.gearDown, true);
  const height = s.position.y - AIRFIELD.elevation - f.groundClearance; assert.ok(Math.abs(height - 14) < 1e-9);
  // Normal controls: short collective taps down to settle gently, then lower collective on the wheels.
  pilot(60 * 90, () => ({ throttle: s.grounded ? -1 : s.throttle > p.throttle - 0.035 ? -1 : 0 }));
  assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
  assert.ok(mission.touchdown.sink > 0.3 && mission.touchdown.sink < p.maxSink);
  assert.ok(Math.abs(mission.touchdown.along - TOUCHDOWN_ZONE.aim) < 1 && Math.abs(mission.touchdown.cross) < 1);
  // Holding collective down from the hover drops in too fast and fails; R/Retry restores the same hover.
  mission.start(flight); const start = s.position.toArray();
  pilot(60 * 30, () => ({ throttle: -1 }));
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /Hard landing|Unsafe/);
  mission.start(flight); assert.equal(mission.status, 'flying'); assert.deepEqual(s.position.toArray(), start);
  assert.equal(s.crashed, false); assert.equal(s.touchdown, null);
  // Drifting out of the box fails with wheel wording.
  const box = new LandingMission(); box.start(flight); const q = runwayPoint(TOUCHDOWN_ZONE.aim + 40);
  Object.assign(s, { grounded: true, flightTime: 5, touchdown: { position: { ...q, y: 80 }, speed: 0, sink: 1, heading: 0, bank: 0, pitch: 0, gearDown: true, flaps: 0, stalled: false, time: 5 } });
  box.update(1 / 120, s); assert.equal(box.status, 'failed'); assert.equal(box.reason, 'Land the wheels inside the target box');
});

test('switching between both helicopters and fixed-wing types resets rotors, rates and hover state', () => {
  const flight = flying(); fly(flight, 4, { pitch: -1, roll: 1, yaw: 1, throttle: 1 });
  for (const which of ['helicopter', id, 'jet', id, 'helicopter']) {
    flight.setAircraft(which); const s = flight.state, t = FLEET[which];
    assert.equal(s.aircraft, which); assert.equal(s.throttle, t.flight.cruiseThrottle); assert.equal(s.flightTime, 0);
    assert.equal(flight.pitchRate, 0); assert.equal(flight.yawRate, 0); assert.equal(s.autopilot, false); assert.equal(s.crashed, false);
    if (t.flight.rotorcraft) { assert.equal(s.velocity.length(), 0); assert.equal(s.rotorSpeed, 1); fly(flight, 5); assert.equal(s.speed, 0); }
  }
});

test('procedural H8 is larger than the H4, with five blades, a ducted tail rotor, wheels at the datum and clean disposal', () => {
  const a = createAircraft(id), h4 = createAircraft('helicopter');
  assert.match(a.group.name, /Sorna H8 — A-SH08/); assert.notEqual(a.group.name, h4.group.name);
  const box = new Box3().setFromObject(a.group), small = new Box3().setFromObject(h4.group);
  assert.ok(Math.abs(box.min.y + f.groundClearance) < 0.01, `wheels ${box.min.y}`);
  const size = box.getSize(new Vector3()), smallSize = small.getSize(new Vector3());
  assert.ok(size.x > 13.5 && size.x > smallSize.x * 1.25, `rotor span ${size.x}`);
  assert.ok(size.z > 15 && size.z > smallSize.z, `length ${size.z}`);
  // The passenger cabin itself is visibly bigger: compare the merged cabin glazing extents.
  const glazing = g => new Box3().setFromObject(g.group.getObjectByName('cabin glazing')).getSize(new Vector3());
  assert.ok(glazing(a).z > glazing(h4).z * 1.4, 'longer glazed cabin with passenger windows');
  const named = name => { const out = []; a.group.traverse(o => { if (o.name === name) out.push(o); }); return out; };
  assert.equal(named('main blade').length, 5); assert.equal(named('tail blade').length, 10);
  assert.equal(named('wheels').length, 1); assert.equal(type.rotor.blades, 5);
  assert.ok(a.materials.glass.isMeshPhysicalMaterial && a.materials.paint.isMeshPhysicalMaterial);
  // The ducted rotor sits inside the fin; the main disc clears the tail by its radius.
  assert.ok(D.fanZ - D.rotorZ > D.rotorRadius + D.fanRadius);
  let meshes = 0, disposed = 0; a.group.traverse(o => { if (o.isMesh) { meshes++; o.geometry.addEventListener('dispose', () => disposed++); } });
  assert.ok(meshes < 45, `draw meshes ${meshes}`);
  const main = a.mainRotor.rotation.y, tail = a.tailRotor.rotation.x;
  a.update(0.02, f.hoverCollective, { rotorSpeed: 1 }); assert.notEqual(a.mainRotor.rotation.y, main); assert.notEqual(a.tailRotor.rotation.x, tail);
  assert.ok(Math.abs(a.mainRotor.rotation.y - main - 0.02 * type.rotor.rate) < 1e-9);
  const spinning = a.mainRotor.rotation.y; a.update(0.1, 0, { rotorSpeed: 0 }); assert.equal(a.mainRotor.rotation.y, spinning);
  a.update(0.1, 0, { rotorSpeed: 1, crashed: true }); assert.equal(a.mainRotor.rotation.y, spinning);
  assert.equal(a.gearPosition, 1);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  a.dispose(); assert.equal(disposed, meshes); h4.dispose();
});

test('transport cockpit is its own low deck beyond the one-metre near plane and fits phones', () => {
  const cockpit = createCockpit(id); assert.match(cockpit.name, /Sorna H8/);
  assert.equal(typeof cockpit.userData.update, 'function'); assert.equal(typeof cockpit.userData.fit, 'function');
  for (const aspect of [1600 / 900, 1280 / 800, 390 / 844]) {
    cockpit.userData.fit(aspect); cockpit.updateMatrixWorld(true);
    cockpit.traverse(o => { if (o.isMesh) {
      const b = new Box3().setFromObject(o);
      assert.ok(b.max.z < -1, `${aspect}: surface inside the near plane at z ${b.max.z}`);
    } });
  }
  // The visible panel never sits under the default page chrome. Rectangles are [left, top, right, bottom] CSS px,
  // measured in Chromium for the map and its toggles, instrument strip, camera chip, mission card and (phones) touch controls.
  const layouts = {
    '1600x900': { world: [70, 900], panel: 'wide', avoid: [[1316, 482, 1576, 728], [1539, 420, 1576, 502], [190, 748, 1410, 854], [24, 687, 244, 728], [24, 94, 314, 368]] },
    '1280x800': { world: [70, 800], panel: 'wide', avoid: [[1016, 401, 1256, 632], [1219, 370, 1256, 452], [24, 648, 1256, 754], [24, 591, 244, 632], [24, 94, 310, 368]] },
    '390x844': { world: [58, 844], panel: 'compact', avoid: [[234, 132, 376, 281], [346, 337, 376, 403], [14, 638, 376, 814], [14, 457, 156, 493], [14, 72, 207, 241], [22, 519, 124, 621], [311, 516, 350, 624], [138, 546, 212, 585]] },
  };
  for (const [size, { world: [top, bottom], panel, avoid }] of Object.entries(layouts)) {
    const [width] = size.split('x').map(Number), height = bottom - top, focal = height / 2 / Math.tan(67 * Math.PI / 360);
    cockpit.userData.fit(width / height); cockpit.updateMatrixWorld(true);
    const visible = Object.entries(cockpit.userData.panels).filter(([, p]) => p.group.visible).map(([name]) => name);
    assert.deepEqual(visible, [panel], size);
    const box = new Box3().setFromObject(cockpit.userData.panels[panel].group), depth = -box.max.z;
    const rect = [width / 2 + box.min.x / depth * focal, top + height / 2 - box.max.y / depth * focal, width / 2 + box.max.x / depth * focal, top + height / 2 - box.min.y / depth * focal];
    assert.ok(rect[0] >= 0 && rect[2] <= width && rect[1] >= top, `${size}: panel ${rect.map(Math.round)} leaves the view`);
    for (const r of avoid) assert.ok(rect[2] <= r[0] || rect[0] >= r[2] || rect[3] <= r[1] || rect[1] >= r[3], `${size}: panel ${rect.map(Math.round)} overlaps ${r}`);
    // Big enough to read: at least 0.36 CSS px per canvas px, so 30 px canvas labels are about 11 px on screen.
    const pixels = COCKPIT[panel].pixels[0];
    assert.ok((rect[2] - rect[0]) / pixels > 0.36, `${size}: ${(rect[2] - rect[0]) / pixels} CSS px per canvas px`);
    // Desktop decks keep the windscreen open above the horizon.
    if (panel === 'wide') assert.ok(box.max.y < -0.12, `${size}: panel top ${box.max.y}`);
  }
  assert.deepEqual(type.cockpitOffset.length, 3);
  disposeObject(cockpit);
});

test('rotor sound follows the larger five-blade rotor; audio routes both helicopters without stall or gear horns', async t => {
  const h4 = helicopterSound(1, 0.58), h8 = helicopterSound(1, f.hoverCollective, 0, type.rotor);
  assert.ok(Math.abs(h8.bladePass - type.rotor.rate / (2 * Math.PI) * 5) < 1e-9); assert.notEqual(h8.bladePass, h4.bladePass);
  assert.ok(h8.rotor < h4.rotor && h8.turbine < h4.turbine);
  assert.deepEqual(helicopterSound(1, 0.58, 0, {}), h4, 'the H4 mix is unchanged');
  assert.equal(helicopterSound(0, 0, 0, type.rotor).master, 0);
  const parameter = () => ({ value: 0, targets: [], setTargetAtTime(v) { this.targets.push(v); } });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), connect(n) { return n; }, start() {} });
  const ctx = { currentTime: 1, sampleRate: 32, destination: node(), createGain: node, createBiquadFilter: node, createBufferSource: node, createOscillator: node, createBuffer: (_c, n) => ({ getChannelData: () => new Float32Array(n) }), async resume() {} };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return ctx; } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else delete globalThis.AudioContext; });
  const audio = new FlightAudio(); await audio.start();
  for (const which of ['helicopter', id]) {
    const s = { aircraft: which, rotorSpeed: 1, spool: FLEET[which].flight.hoverCollective, speed: 0, stalled: true };
    audio.update(s, true);
    assert.equal(audio.stallActive, false); assert.equal(audio.gearHorn.gain.targets.at(-1), 0);
    assert.equal(audio.helicopterBus.gain.targets.at(-1), 1); assert.equal(audio.jetBus.gain.targets.at(-1), 0);
    assert.equal(audio.helicopter.pulse.frequency.targets.at(-1), helicopterSound(1, s.spool, 0, FLEET[which].rotor).bladePass);
    assert.ok(audio.master.gain.targets.at(-1) > 0);
    audio.update({ ...s, crashed: true }); assert.equal(audio.master.gain.targets.at(-1), 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { FLEET } from '../src/fleet.js';
import { readFileSync } from 'node:fs';
import { createPushpull, createPushpullCockpit } from '../src/pushpull.js';
import { disposeObject } from '../src/helicopter.js';

const id = 'pushpull', type = FLEET[id], f = type.flight;
const base = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 0, spool: 0 };
const named = (root, name) => { const list = []; root.traverse(o => { if (o.name === name) list.push(o); }); return list; };
const centre = o => new Box3().setFromObject(o).getCenter(new Vector3());

// aircraft.js imports every sibling model, so the dispatch is checked from its source to keep this file independent of them.
test('Cervin P6 is dispatched to its own factory and named for its type', () => {
  const dispatch = readFileSync(new URL('../src/aircraft.js', import.meta.url), 'utf8');
  assert.match(dispatch, /if \(type === 'pushpull'\) return createPushpull\(\);/);
  assert.match(dispatch, /if \(type === 'pushpull'\) return createPushpullCockpit\(\);/);
  const a = createPushpull();
  assert.equal(a.group.name, `${type.name} — ${type.registration}`);
  assert.equal(a.group.name, 'Cervin P6 — A-CP06');
  assert.equal(typeof createPushpull, 'function');
  const deck = createPushpullCockpit(); assert.match(deck.name, /Cervin P6 — cockpit/); disposeObject(deck);
  a.dispose();
});

test('Cervin P6 silhouette: short pod, straight high wing, twin booms, high tailplane, tyres on the runway datum', () => {
  const a = createPushpull(); a.update(0.01, 0, base); a.group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 11.3 && size.x < 12.2, `span ${size.x}`);
  assert.ok(size.z > 9 && size.z < 10.5 && size.y > 3 && size.y < 4.2, JSON.stringify(size));
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, 'tyres meet runway top');
  // Two propellers on the centreline: a tractor at the nose and a pusher behind the pod, both between/clear of the booms.
  const props = named(a.group, 'propeller').sort((p, q) => p.position.z - q.position.z);
  assert.equal(props.length, 2);
  const [front, rear] = props, frontBox = new Box3().setFromObject(front), rearBox = new Box3().setFromObject(rear);
  assert.ok(frontBox.min.z <= box.min.z + 1e-6, 'tractor is the foremost part');
  assert.ok(rear.position.z > 3 && rear.position.z < 4);
  for (const p of [frontBox, rearBox]) assert.ok(p.min.y - box.min.y > 0.6, 'prop ground clearance');
  assert.ok(rearBox.max.x < 1.6 - 0.3 && rearBox.min.x > -1.6 + 0.3, 'pusher turns between the booms');
  // Tail surfaces: one elevator on a high tailplane behind and above the pusher disc, rudders on the boom fins.
  const elevators = named(a.group, 'elevators'), rudders = named(a.group, 'rudder'), ailerons = named(a.group, 'ailerons'), flaps = named(a.group, 'flaps');
  assert.equal(elevators.length, 1); assert.equal(rudders.length, 2); assert.equal(ailerons.length, 2); assert.equal(flaps.length, 4);
  const elevatorBox = new Box3().setFromObject(elevators[0]);
  assert.ok(elevatorBox.min.z > rearBox.max.z + 1 && elevatorBox.min.y > rearBox.max.y + 0.1);
  for (const r of rudders) assert.ok(Math.abs(Math.abs(centre(r).x) - 1.6) < 0.1 && centre(r).z > 4.5 && centre(r).y > 1);
  for (const al of ailerons) assert.ok(Math.abs(centre(al).x) > 3.5 && centre(al).y > 0.7, 'ailerons outboard on the high wing');
  // Fixed tricycle gear: one wheel under the front cowl, two mains behind it.
  const tyres = named(a.group, 'tyre'); assert.equal(tyres.length, 3);
  const zs = tyres.map(t => centre(t).z).sort((x, y) => x - y);
  assert.ok(zs[0] < -2.5 && zs[1] > 0 && zs[2] > 0);
  assert.equal(named(a.group, 'fixed main gear').length, 1); assert.equal(named(a.group, 'fixed nose gear').length, 1);
  assert.equal(named(a.group, 'retractable main gear').length, 0);
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes < 160 && triangles < 60000, `${meshes} meshes / ${triangles} triangles`);
  a.dispose();
});

test('Cervin P6 both propellers turn with spool, in opposite senses, and stop when crashed', () => {
  const a = createPushpull(), [p1, p2] = named(a.group, 'propeller'), s = { ...base, grounded: false, flightTime: 10 };
  a.update(0.1, 0, { ...s, spool: 0 }); const idle = [Math.abs(p1.rotation.z), Math.abs(p2.rotation.z)];
  const before = [p1.rotation.z, p2.rotation.z];
  a.update(0.1, 1, { ...s, spool: 1 });
  const moved = [p1.rotation.z - before[0], p2.rotation.z - before[1]];
  assert.ok(Math.abs(moved[0]) > idle[0] * 5 && Math.abs(moved[1]) > idle[1] * 5);
  assert.ok(moved[0] * moved[1] < 0, 'counter-rotating');
  const frozen = [p1.rotation.z, p2.rotation.z];
  a.update(0.5, 1, { ...s, spool: 1, crashed: true });
  assert.deepEqual([p1.rotation.z, p2.rotation.z], frozen);
  a.update(0, 1, { ...s, spool: 1 }); assert.deepEqual([p1.rotation.z, p2.rotation.z], frozen, 'dt 0 is harmless');
  a.dispose();
});

test('Cervin P6 fixed gear stays visible, flaps reach 30°, surfaces deflect physically', () => {
  const a = createPushpull(), s = { ...base, gearDown: false, grounded: false, flightTime: 10, speed: f.cruiseSpeed, spool: 0.7 };
  for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 1);
  for (const name of ['fixed main gear', 'fixed nose gear']) assert.ok(a.group.getObjectByName(name).visible);
  s.flaps = 2; for (let i = 0; i < 60; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.surfaces.flaps.every(x => x > 0.2 && x < Math.PI / 6), 'flaps travel gradually');
  for (let i = 0; i < 180; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.surfaces.flaps.length, 4); assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-9));
  // Trailing edges go down with positive flap angle on both wings.
  a.group.updateMatrixWorld(true);
  for (const flap of named(a.group, 'flaps')) { const b = new Box3().setFromObject(flap); assert.ok(b.min.y < 0.62, `flap trailing edge ${b.min.y}`); }
  // Nose up, roll right, yaw right.
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  const { ailerons, elevators, rudder } = a.surfaces;
  assert.ok(ailerons[0] * ailerons[1] < 0 && Math.abs(ailerons[0]) > 0.05);
  assert.ok(elevators[0] < -0.1, `elevator ${elevators}`);
  assert.equal(rudder.length, 2); assert.ok(rudder.every(r => r > 0.05) && rudder[0] === rudder[1]);
  for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, { ...s, grounded: true });
  assert.ok([...a.surfaces.ailerons, ...a.surfaces.elevators, ...a.surfaces.rudder].every(x => Math.abs(x) < 0.01));
  // A fresh flight starts with the flaps where they are set.
  const b = createPushpull(); b.update(0.01, 0, { ...base, flaps: 1 }); assert.ok(b.surfaces.flaps.every(x => Math.abs(x - Math.PI / 12) < 1e-9));
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
  b.dispose();
});

test('Cervin P6 camera values frame a twin-boom tourer and seat the eye in the left cabin seat', () => {
  assert.ok(type.cameraScale > FLEET.trainer.cameraScale && type.cameraScale < FLEET.commuter.cameraScale);
  assert.equal(type.cockpitOffset.length, 3);
  const [x, y, z] = type.cockpitOffset;
  assert.ok(x < -0.2 && x > -0.45, 'left seat'); assert.ok(y > 0.2 && y < 0.6, 'below the wing root');
  assert.ok(z > -2.2 && z < -0.8, 'inside the glazed cabin');
});

test('Cervin P6 cockpit stays beyond the near plane, keeps its panels in the HUD gaps and disposes', () => {
  const deck = createPushpullCockpit(); assert.match(deck.name, /Cervin P6 — cockpit/);
  assert.equal(typeof deck.userData.fit, 'function');
  assert.equal(deck.getObjectByName('spinner'), undefined);
  // Rectangles are [left, top, right, bottom] CSS px of the default page chrome (as measured for the transport deck);
  // the 3D view starts below the top bar.
  const layouts = {
    '1600x900': { world: [70, 900], panel: 'wide', within: [300, 520, 1300, 740], avoid: [[1316, 460, 1576, 728], [190, 748, 1410, 854], [24, 687, 244, 728], [24, 94, 314, 368]] },
    '1280x800': { world: [70, 800], panel: 'wide', within: [200, 440, 1050, 645], avoid: [[1016, 401, 1256, 632], [24, 648, 1256, 754], [24, 591, 244, 632], [24, 94, 310, 368]] },
    '390x844': { world: [58, 844], panel: 'compact', within: [8, 295, 346, 460], avoid: [[234, 132, 376, 299], [346, 337, 376, 403], [14, 638, 376, 814], [14, 457, 156, 493]] },
  };
  for (const [size, { world: [top, bottom], panel, within, avoid }] of Object.entries(layouts)) {
    const [width] = size.split('x').map(Number), height = bottom - top, focal = height / 2 / Math.tan(67 * Math.PI / 360);
    deck.userData.fit(width / height); deck.updateMatrixWorld(true);
    deck.traverse(o => { if (!o.isMesh) return; assert.equal(o.frustumCulled, false);
      const b = new Box3().setFromObject(o); assert.ok(b.max.z < -1.0, `${size}: near plane ${b.max.z}`); });
    const visible = Object.entries(deck.userData.panels).filter(([, p]) => p.group.visible).map(([name]) => name);
    assert.deepEqual(visible, [panel], size);
    const box = new Box3().setFromObject(deck.userData.panels[panel].group), depth = -box.max.z;
    const rect = [width / 2 + box.min.x / depth * focal, top + height / 2 - box.max.y / depth * focal, width / 2 + box.max.x / depth * focal, top + height / 2 - box.min.y / depth * focal];
    assert.ok(rect[0] >= within[0] && rect[1] >= within[1] && rect[2] <= within[2] && rect[3] <= within[3], `${size}: panel ${rect.map(Math.round)} outside ${within}`);
    for (const r of avoid) assert.ok(rect[2] <= r[0] || rect[0] >= r[2] || rect[3] <= r[1] || rect[1] >= r[3], `${size}: panel ${rect.map(Math.round)} overlaps ${r}`);
    if (panel === 'wide') assert.ok(box.max.y < -0.12, `${size}: windscreen stays open above the panel`);
  }
  // The cowl top stays flat and below the horizon in front of the pilot.
  deck.traverse(o => { if (o.isMesh && o.geometry.type === 'SphereGeometry') { const b = new Box3().setFromObject(o);
    assert.ok(b.max.y < 0 && b.max.y - b.min.y < 0.15, 'flat cowl, low'); } });
  const state = { flightTime: 1, speed: 60, position: new Vector3(0, 500, 0), bank: 0, pitch: 0, flaps: 1, spool: 0.7 };
  deck.userData.update(state); deck.userData.update({ ...state, crashed: true });
  const resources = new Set(); deck.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); disposeObject(deck); assert.equal(count, resources.size);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3, MathUtils } from 'three';
import { FLEET } from '../src/fleet.js';
import { createRacer, createRacerCockpit, RACER_FUSELAGE, RACER_COCKPIT } from '../src/racer.js';
import { disposeObject } from '../src/helicopter.js';

const id = 'racer', type = FLEET[id];
const named = (group, pattern) => { const found = []; group.traverse(o => { if (pattern.test(o.name)) found.push(o); }); return found; };
const ground = () => ({ gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 0, spool: 0, throttle: 0 });

test('Rava R6 airframe: name, proportions, tyre datum and budget', () => {
  const a = createRacer();
  assert.equal(a.group.name, 'Rava R6 — A-RR06');
  a.update(0.01, 0, ground());
  const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(Math.abs(RACER_FUSELAGE - 8.2) < 1e-9, 'fuselage 8.2 m');
  assert.ok(size.x > 8.4 && size.x < 8.9, `span ${size.x}`);
  assert.ok(size.z > 8.4 && size.z < 9.2, `length with spinner ${size.z}`);
  assert.ok(size.y > 2.6 && size.y < 3.3, `height ${size.y}`);
  assert.ok(Math.abs(type.groundClearance + box.min.y - 0.925) < 1e-6, `tyres meet the raised runway top (${box.min.y})`);
  // Long nose: the spinner tip sits well ahead of the wing's leading edge; the bubble sits aft of the wing's midchord.
  assert.ok(box.min.z < -4.5, `nose ${box.min.z}`);
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes < 160 && triangles < 60000, `${meshes} meshes / ${triangles} triangles`);
  a.dispose();
});

test('named parts: one four-blade propeller, three tyres, retractable tailwheel gear, nav lights', () => {
  const a = createRacer(); a.update(0.01, 0, ground());
  const props = named(a.group, /^propeller$/);
  assert.equal(props.length, 1);
  assert.equal(props[0].children.length, 9, 'four blades, four tips and the spinner');
  assert.equal(named(a.group, /^tyre$/).length, 3);
  assert.equal(named(a.group, /^retractable main gear$/).length, 2);
  assert.equal(named(a.group, /^retractable tailwheel$/).length, 1);
  assert.equal(named(a.group, /^(fixed|retractable nose)/).length, 0);
  assert.equal(named(a.group, /^turbofan fan$/).length, 0);
  // Tailwheel layout: mains ahead of the wing's quarter chord, the tailwheel at the far tail.
  const [left, right] = named(a.group, /^retractable main gear$/).map(g => g.getWorldPosition(new Vector3()));
  const tail = named(a.group, /^retractable tailwheel$/)[0].getWorldPosition(new Vector3());
  assert.ok(left.x * right.x < 0 && Math.abs(left.z - right.z) < 1e-9 && left.z < -1);
  assert.ok(tail.z > 3 && Math.abs(tail.x) < 1e-9);
  let lights = 0; a.group.traverse(o => { if (o.isMesh && o.material.type === 'MeshBasicMaterial') lights++; });
  assert.equal(lights, 3);
  a.dispose();
});

test('propeller spins with spool and stops when crashed', () => {
  const a = createRacer(), [prop] = named(a.group, /^propeller$/), s = { ...ground(), grounded: false, flightTime: 5 };
  let before = prop.rotation.z; a.update(0.1, 0, { ...s, spool: 0 }); const idle = prop.rotation.z - before;
  before = prop.rotation.z; a.update(0.1, 1, { ...s, spool: 1 }); const full = prop.rotation.z - before;
  assert.ok(idle > 0 && full > idle * 5, `${idle} → ${full}`);
  before = prop.rotation.z; a.update(0.1, 1, { ...s, spool: 1, crashed: true }); assert.equal(prop.rotation.z, before);
  before = prop.rotation.z; a.update(0, 1, { ...s, spool: 1 }); assert.equal(prop.rotation.z, before, 'dt 0 leaves it still');
  a.dispose();
});

test('gear retracts in about three seconds, hides when stowed, snaps on the ground', () => {
  const a = createRacer(), gears = named(a.group, /^retractable (main gear|tailwheel)$/), s = ground();
  a.update(0.01, 0, s); assert.equal(a.gearPosition, 1); assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) < 1e-6));
  Object.assign(s, { gearDown: false, grounded: false, flightTime: 10 });
  for (let i = 0; i < 90; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 0.5) < 0.01, `${a.gearPosition}`);
  assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) > 0.3));
  for (let i = 0; i < 100; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 0); assert.ok(gears.every(g => !g.visible));
  // Mains fold inward (toward the fuselage) into the wing roots.
  s.gearDown = true; a.update(1 / 60, 0.7, s);
  for (const g of gears.filter(g => g.name === 'retractable main gear')) {
    const tyre = named(g, /^tyre$/)[0].getWorldPosition(new Vector3());
    assert.ok(Math.abs(tyre.x) < Math.abs(g.position.x), 'stowed wheel lies inboard of its pivot');
  }
  for (let i = 0; i < 200; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 1) < 1e-9); assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) < 1e-6));
  // Grounded or a fresh flight places the gear at once.
  a.update(1 / 60, 0.7, { ...s, gearDown: false, flightTime: 0.01 }); assert.equal(a.gearPosition, 0);
  a.update(1 / 60, 0.7, { ...s, gearDown: true, grounded: true }); assert.equal(a.gearPosition, 1);
  a.dispose();
});

test('flaps travel to 30°, control surfaces follow attitude, cockpit toggle and disposal', () => {
  const a = createRacer(), s = { ...ground(), grounded: false, flightTime: 10, speed: 100 };
  a.update(1 / 60, 0.7, s);
  s.flaps = 2; a.update(1, 0.7, s); assert.ok(Math.abs(a.surfaces.flaps[0] - 0.22) < 1e-9, 'about 0.22 rad/s');
  for (let i = 0; i < 180; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.surfaces.flaps.length, 2); assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-9));
  s.flaps = 1; for (let i = 0; i < 180; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 12) < 1e-9));
  for (let i = 0; i < 30; i++) { s.bank += 0.005; s.pitch += 0.003; s.heading += 0.003; a.update(1 / 60, 0.7, s); }
  const { ailerons, elevators, rudder } = a.surfaces;
  assert.equal(ailerons.length, 2); assert.equal(elevators.length, 2); assert.equal(rudder.length, 1);
  assert.ok(ailerons[0] * ailerons[1] < 0 && Math.abs(ailerons[0]) > 0.05, `${ailerons}`);
  assert.ok(elevators.every(x => x < -0.1)); assert.ok(rudder[0] > 0.05);
  // Grounded: surfaces settle back to neutral.
  for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, { ...s, grounded: true });
  assert.ok(Math.abs(a.surfaces.ailerons[0]) < 0.01 && Math.abs(a.surfaces.elevators[0]) < 0.01);
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  for (const m of Object.values(a.materials)) resources.add(m);
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('cockpit: named, every mesh beyond the near plane, nose behind the panel face', () => {
  const deck = createRacerCockpit();
  assert.equal(deck.name, 'Rava R6 — cockpit');
  assert.equal(typeof deck.userData.fit, 'function'); assert.equal(typeof deck.userData.update, 'function');
  for (const aspect of [390 / 844, 1280 / 800, 1600 / 900]) {
    deck.userData.fit(aspect); deck.updateMatrixWorld(true);
    let meshes = 0;
    deck.traverse(o => { if (o.isMesh) {
      meshes++; assert.equal(o.frustumCulled, false);
      const b = new Box3().setFromObject(o); assert.ok(b.max.z < -1.0, `${aspect}: ${o.geometry.type} at z ${b.max.z}`);
    } });
    assert.ok(meshes > 10);
  }
  // Nothing of the nose comes nearer than the wide panel's face, so no nose edge can cross the instruments.
  deck.userData.fit(16 / 9); deck.updateMatrixWorld(true);
  const nose = new Box3().setFromObject(deck.getObjectByName('nose'));
  assert.ok(nose.max.z < RACER_COCKPIT.wide.z, `nose reaches ${nose.max.z}`);
  // Eye sits inside the bubble, well aft of the nose; chase framing between the Silex A3 and the trainer.
  assert.equal(type.cockpitOffset.length, 3);
  assert.ok(type.cockpitOffset[2] > -1.05 && type.cockpitOffset[2] < 0.85 && type.cockpitOffset[1] > 0.5 && type.cockpitOffset[1] < 0.97);
  assert.ok(type.cameraScale > FLEET.aerobatic.cameraScale && type.cameraScale < FLEET.trainer.cameraScale);
  deck.userData.update({ throttle: 1, speed: 80, spool: 0.8, flaps: 1, gearDown: true, flightTime: 3, position: new Vector3(0, 500, 0) });
  const resources = new Set(); deck.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let disposed = 0; resources.forEach(r => r.addEventListener('dispose', () => disposed++));
  disposeObject(deck); assert.equal(disposed, resources.size);
});

test('cockpit panels sit in the HUD gaps: low strip on laptops, compact strip between map and camera chip on phones', () => {
  const deck = createRacerCockpit();
  // CSS px rectangles measured in Chromium: [left, top, right, bottom] of the free gap, and page chrome to avoid.
  const layouts = {
    '1600x900': { world: [70, 900], panel: 'wide', gap: [330, 540, 1270, 735] },
    '1280x800': { world: [70, 800], panel: 'wide', gap: [330, 540, 1270, 735] },
    '390x844': { world: [58, 844], panel: 'compact', gap: [14, 300, 340, 458],
      avoid: [[234, 132, 376, 281], [346, 337, 376, 403], [14, 638, 376, 814], [14, 457, 156, 493], [22, 519, 124, 621], [311, 516, 350, 624], [325, 515, 390, 625]] },
  };
  for (const [size, { world: [top, bottom], panel, gap, avoid = [] }] of Object.entries(layouts)) {
    const [width] = size.split('x').map(Number), height = bottom - top, focal = height / 2 / Math.tan(67 * Math.PI / 360);
    deck.userData.fit(width / height); deck.updateMatrixWorld(true);
    const visible = Object.entries(deck.userData.panels).filter(([, p]) => p.group.visible).map(([name]) => name);
    assert.deepEqual(visible, [panel], size);
    assert.equal(deck.getObjectByName('nose').visible, panel === 'wide', `${size}: nose cue only on laptops`);
    const box = new Box3().setFromObject(deck.userData.panels[panel].group), depth = -box.max.z;
    assert.ok(depth > 1.1, `${size}: panel beyond the near plane`);
    // Projected at the nearest depth, which over-states the size, so the check is conservative.
    const rect = [width / 2 + box.min.x / depth * focal, top + height / 2 - box.max.y / depth * focal, width / 2 + box.max.x / depth * focal, top + height / 2 - box.min.y / depth * focal];
    assert.ok(rect[0] >= gap[0] && rect[1] >= gap[1] && rect[2] <= gap[2] && rect[3] <= gap[3], `${size}: panel ${rect.map(Math.round)} outside the gap ${gap}`);
    for (const r of avoid) assert.ok(rect[2] <= r[0] || rect[0] >= r[2] || rect[3] <= r[1] || rect[1] >= r[3], `${size}: panel ${rect.map(Math.round)} overlaps ${r}`);
    // Readable: at least 0.36 CSS px per canvas px, so 30 px canvas labels are about 11 px on screen.
    assert.ok((rect[2] - rect[0]) / RACER_COCKPIT[panel].pixels[0] > 0.36, `${size}: scale`);
  }
  disposeObject(deck);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { interceptor as type } from '../src/interceptor-type.js';
import { createInterceptor, createInterceptorCockpit, COCKPIT } from '../src/interceptor.js';
import { createFighter } from '../src/fighter.js';
import { disposeObject } from '../src/helicopter.js';

const named = (group, pattern) => { const found = []; group.traverse(o => { if (pattern.test(o.name)) found.push(o); }); return found; };
const ground = { gearDown: true, grounded: true, flightTime: 0, flaps: 0, bank: 0, pitch: 0, heading: 0, speed: 0, spool: 0, time: 0 };
// The airframe box, leaving out the transparent afterburner plumes that only appear with reheat lit.
function airframeBox(group) {
  group.updateMatrixWorld(true);
  const box = new Box3(), plumes = new Set(named(group, /^afterburner$/));
  group.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (plumes.has(p)) return;
    o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

test('Taris F12 is a ~17 m twin-engine interceptor whose tyres meet the raised runway top within budget', () => {
  const a = createInterceptor();
  assert.equal(a.group.name, 'Taris F12 — A-TF12');
  a.update(0.01, 0, ground);
  const box = airframeBox(a.group), size = box.getSize(new Vector3());
  assert.ok(size.x > 11.5 && size.x < 12.8, `span ${size.x}`);
  assert.ok(size.z > 16.5 && size.z < 18, `length ${size.z}`);
  assert.ok(size.y > 4 && size.y < 6, `height ${size.y}`);
  assert.ok(Math.abs(box.min.y - (0.925 - type.groundClearance)) < 1e-6, `tyre datum ${box.min.y}`);
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes < 160 && triangles < 60000, `${meshes} meshes / ${triangles} triangles`);
  a.dispose();
});

test('silhouette: two exhausts with their own heat disc and plume, twin canted fins, four-surface wing, tricycle gear', () => {
  const a = createInterceptor(); a.update(0.01, 0, ground); a.group.updateMatrixWorld(true);
  const exhausts = named(a.group, /^exhaust$/);
  assert.equal(exhausts.length, 2);
  for (const e of exhausts) {
    assert.equal(named(e, /^afterburner$/).length, 1); assert.equal(named(e, /^heat$/).length, 1);
  }
  const centres = exhausts.map(e => e.getWorldPosition(new Vector3()));
  assert.deepEqual(centres.map(c => Math.sign(c.x)).sort(), [-1, 1]);
  assert.ok(centres.every(c => c.z > 6.5), 'nozzles sit at the tail');
  assert.equal(named(a.group, /^propeller$|^turbofan fan$/).length, 0);
  assert.equal(named(a.group, /^tyre$/).length, 3);
  assert.equal(named(a.group, /^retractable nose gear$/).length, 1);
  assert.equal(named(a.group, /^retractable main gear$/).length, 2);
  const s = a.surfaces;
  assert.equal(s.flaps.length, 2); assert.equal(s.ailerons.length, 2); assert.equal(s.elevators.length, 2); assert.equal(s.rudder.length, 2);
  // The rudders lean outward: the hinge axes of the twin tails tip away from the centreline.
  const rudders = named(a.group, /^rudder$/).map(p => p.getWorldPosition(new Vector3()));
  assert.deepEqual(rudders.map(r => Math.sign(r.x)).sort(), [-1, 1]);
  assert.ok(rudders.every(r => r.y > 1.5));
  // Not the single-engine delta: the Arolla F7 has one heat disc and no exhaust pair.
  const f7 = createFighter(); assert.equal(named(f7.group, /^exhaust$/).length, 0); f7.dispose();
  a.dispose();
});

test('restrained afterburners ease in with state.afterburner and fade out; crashed jets go dark', () => {
  const a = createInterceptor(), s = { ...ground, grounded: false, gearDown: false, flightTime: 10, spool: 1 };
  const plumes = named(a.group, /^afterburner$/), flames = named(a.group, /^flame$/);
  a.update(1 / 60, 1, s); assert.ok(a.afterburner < 0.2); assert.ok(plumes.every(p => p.scale.z < 0.5));
  s.afterburner = true;
  for (let i = 0; i < 60; i++) { s.time = i / 60; a.update(1 / 60, 1, s); }
  assert.ok(a.afterburner > 0.99, `${a.afterburner}`);
  assert.ok(plumes.every(p => p.visible && p.scale.z > 0.8));
  // Shorter and dimmer than the Arolla's plume: outer cone 2.5 m against 4.2 m, the Arolla's 0.55 and 0.8 opacities cut to under 65%.
  const lengths = flames.map(f => { f.geometry.computeBoundingBox(); return f.geometry.boundingBox.max.z - f.geometry.boundingBox.min.z; });
  assert.ok(Math.max(...lengths) < 4.2 * 0.65);
  const opacities = flames.map(f => f.material.opacity).sort((x, y) => x - y);
  assert.ok(opacities[0] < 0.55 * 0.65 && opacities.at(-1) < 0.8 * 0.65, `${opacities}`);
  s.afterburner = false; for (let i = 0; i < 90; i++) a.update(1 / 60, 1, s);
  assert.ok(a.afterburner < 0.01);
  s.afterburner = true; s.crashed = true; for (let i = 0; i < 60; i++) a.update(1 / 60, 1, s);
  assert.ok(a.afterburner < 0.01); assert.ok(plumes.every(p => !p.visible));
  a.update(0, 1, s); // dt may be 0
  a.dispose();
});

test('gear retracts over three seconds and hides once stowed; flaps reach 30°; surfaces follow body rates', () => {
  const a = createInterceptor(), gears = named(a.group, /^retractable (main|nose) gear$/);
  const s = { ...ground, speed: 120 };
  a.update(0.01, 0.7, s);
  assert.equal(a.gearPosition, 1); assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) < 1e-6));
  Object.assign(s, { grounded: false, gearDown: false, flightTime: 10 });
  for (let i = 0; i < 90; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Math.abs(a.gearPosition - 0.5) < 0.01, `${a.gearPosition}`);
  assert.ok(gears.every(g => g.visible && g.quaternion.angleTo(new Quaternion()) > 0.1));
  for (let i = 0; i < 100; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 0); assert.ok(gears.every(g => !g.visible));
  s.gearDown = true; for (let i = 0; i < 190; i++) a.update(1 / 60, 0.7, s);
  assert.equal(a.gearPosition, 1); assert.ok(gears.every(g => g.visible));
  // Ground or a fresh start snaps the gear.
  Object.assign(s, { gearDown: false, flightTime: 0 }); a.update(1 / 60, 0.7, s); assert.equal(a.gearPosition, 0);
  s.flightTime = 10;

  s.flaps = 2; for (let i = 0; i < 180; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.surfaces.flaps.every(x => Math.abs(x - Math.PI / 6) < 1e-6), `${a.surfaces.flaps}`);
  const flap = named(a.group, /^flaps$/)[0]; assert.ok(flap.quaternion.angleTo(new Quaternion()) > 0.5);

  s.bodyRates = { roll: 0.8, pitch: 0.3, yaw: 0.1 };
  for (let i = 0; i < 30; i++) a.update(1 / 60, 0.7, s);
  const { ailerons, elevators, rudder } = a.surfaces;
  assert.ok(ailerons[0] * ailerons[1] < 0 && Math.abs(ailerons[0]) > 0.1, 'ailerons deflect opposite');
  assert.ok(elevators.every(x => x > 0.05), 'stabilators lift to pitch up');
  assert.ok(rudder.every(x => x > 0.05), 'both rudders follow yaw');
  s.bodyRates = { roll: 0, pitch: -0.3, yaw: 0 };
  for (let i = 0; i < 60; i++) a.update(1 / 60, 0.7, s);
  assert.ok(a.surfaces.elevators.every(x => x < -0.05));
  s.crashed = true; for (let i = 0; i < 120; i++) a.update(1 / 60, 0.7, s);
  assert.ok(Object.values(a.surfaces).flat().filter((_, i) => i >= 2).every(x => Math.abs(x) < 0.01), 'surfaces centre after a crash');

  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  const resources = new Set(); a.group.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  let count = 0; resources.forEach(r => r.addEventListener('dispose', () => count++)); a.dispose(); assert.equal(count, resources.size);
});

test('cockpit: panel and HUD beyond the near plane, in the gaps of the page chrome on desktop and phone, disposes cleanly', () => {
  const deck = createInterceptorCockpit();
  assert.equal(deck.name, 'Taris F12 — cockpit');
  assert.equal(typeof deck.userData.fit, 'function'); assert.equal(typeof deck.userData.update, 'function');
  for (const aspect of [1600 / 900, 1280 / 800, 390 / 844]) {
    deck.userData.fit(aspect); deck.updateMatrixWorld(true);
    deck.traverse(o => { if (o.isMesh) {
      assert.equal(o.frustumCulled, false);
      const b = new Box3().setFromObject(o); assert.ok(b.max.z < -1.0, `${aspect} ${o.name}: z ${b.max.z}`);
    } });
  }
  // Rectangles are [left, top, right, bottom] CSS px of the page chrome the panel must avoid (camera chip, map and its toggles,
  // instrument strip, mission card; phones also telemetry card and touch controls), and the gap it should fill.
  const layouts = {
    '1600x900': { world: [70, 900], panel: 'wide', gap: [330, 530, 1270, 735], avoid: [[1316, 460, 1576, 728], [1539, 420, 1576, 502], [190, 748, 1410, 854], [24, 687, 244, 728], [24, 94, 314, 368]] },
    '1280x800': { world: [70, 800], panel: 'wide', gap: [260, 440, 1010, 646], avoid: [[1016, 401, 1256, 632], [1219, 370, 1256, 452], [24, 648, 1256, 754], [24, 591, 244, 632], [24, 94, 310, 368]] },
    '390x844': { world: [58, 844], panel: 'compact', gap: [14, 300, 340, 458], avoid: [[234, 132, 376, 281], [346, 337, 376, 403], [14, 638, 376, 814], [14, 458, 156, 493], [14, 72, 207, 241], [22, 519, 124, 621], [311, 516, 350, 624], [138, 546, 212, 585]] },
  };
  const project = (object, [width, top, bottom]) => {
    const height = bottom - top, focal = height / 2 / Math.tan(67 * Math.PI / 360);
    const box = new Box3().setFromObject(object), depth = -box.max.z;
    return [width / 2 + box.min.x / depth * focal, top + height / 2 - box.max.y / depth * focal, width / 2 + box.max.x / depth * focal, top + height / 2 - box.min.y / depth * focal];
  };
  for (const [size, { world: [top, bottom], panel, gap, avoid }] of Object.entries(layouts)) {
    const [width] = size.split('x').map(Number);
    deck.userData.fit(width / (bottom - top)); deck.updateMatrixWorld(true);
    const visible = Object.entries(deck.userData.panels).filter(([, p]) => p.group.visible).map(([name]) => name);
    assert.deepEqual(visible, [panel], size);
    const rect = project(deck.userData.panels[panel].group, [width, top, bottom]), r = rect.map(Math.round);
    if (process.env.SHOW_RECTS) console.log(size, r);
    assert.ok(rect[0] >= gap[0] && rect[1] >= gap[1] && rect[2] <= gap[2] && rect[3] <= gap[3], `${size}: panel ${r} outside gap ${gap}`);
    for (const a of avoid) assert.ok(rect[2] <= a[0] || rect[0] >= a[2] || rect[3] <= a[1] || rect[1] >= a[3], `${size}: panel ${r} overlaps ${a}`);
    // Readable: at least 0.36 CSS px per canvas px, so 30 px canvas labels are about 11 px on screen.
    assert.ok((rect[2] - rect[0]) / COCKPIT[panel].pixels[0] > 0.36, `${size}: ${(rect[2] - rect[0]) / COCKPIT[panel].pixels[0]}`);
    // The HUD combiner sits just above the wide panel, small and below the horizon; phones omit it.
    const hud = deck.userData.hud;
    assert.equal(hud.visible, panel === 'wide');
    if (panel === 'wide') {
      const h = project(hud, [width, top, bottom]), horizon = top + (bottom - top) / 2;
      assert.ok(h[1] > horizon && h[3] - h[1] <= 120, `${size}: HUD ${h.map(Math.round)}`);
      assert.ok(h[3] >= rect[1] - 8 && h[3] <= rect[1] + 30, `${size}: HUD rests on the panel`);
      assert.ok(new Box3().setFromObject(hud).max.y < 0);
    }
  }
  // The canopy bow is a hairline.
  assert.ok(named(deck, /^canopy bow$/).every(b => b.geometry.parameters.radius <= 0.012));
  // Canvas drawing is browser-only; the update stub runs safely under node with inverted and looping states.
  deck.userData.update({ speed: 150, position: new Vector3(0, 800, 0), bank: Math.PI, pitch: 1.2, heading: -0.4, spool: 1, afterburner: true, gearDown: false, flaps: 0 });
  // The eye sits under the bubble canopy and the chase camera pulls back a little further than for the 16 m Arolla.
  assert.equal(type.cockpitOffset.length, 3);
  assert.ok(type.cockpitOffset[2] > -5.1 && type.cockpitOffset[2] < -3.6 && type.cockpitOffset[1] > 0.8 && type.cockpitOffset[1] < 1.1);
  assert.ok(type.cameraScale > 1 && type.cameraScale < 1.3);
  let disposed = 0; const resources = new Set();
  deck.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
  resources.forEach(r => r.addEventListener('dispose', () => disposed++));
  disposeObject(deck); assert.equal(disposed, resources.size);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { tandem as type } from '../src/tandem-type.js';
import { createTransport } from '../src/transport.js';
import { disposeObject } from '../src/helicopter.js';
import { D, COCKPIT, createTandem, createTandemCockpit } from '../src/tandem.js';

// Imported directly (not through aircraft.js) so this file does not depend on the other fleet models.
const f = type.flight;
const named = (root, name) => { const out = []; root.traverse(o => { if (o.name === name) out.push(o); }); return out; };
const parked = { gearDown: true, grounded: true, flightTime: 0, rotorSpeed: 0, spool: 0, throttle: 0, crashed: false };

test('Lodra H20 is named, sized like a heavy tandem and stands on its wheels at the datum', () => {
  const a = createTandem(), h8 = createTransport();
  assert.equal(a.group.name, 'Lodra H20 — A-LH20');
  a.update(0.01, 0, parked);
  const box = new Box3().setFromObject(a.group), size = box.getSize(new Vector3());
  assert.ok(Math.abs(box.min.y + f.groundClearance) < 1e-3, `tyre bottoms ${box.min.y}`);
  // Two 9 m discs ~11.5 m apart: ~18 m wide, ~29.6 m long overall, well beyond the Sorna H8.
  assert.ok(size.x > 17.5 && size.x < 19, `span ${size.x}`);
  assert.ok(size.z > 28 && size.z < 31, `length ${size.z}`);
  assert.ok(size.z > new Box3().setFromObject(h8.group).getSize(new Vector3()).z * 1.4);
  // The fuselage itself is the ~15 m box-section cabin, nose -Z.
  const hull = new Box3().setFromObject(a.group.getObjectByName('tandem paint')), hullSize = hull.getSize(new Vector3());
  assert.ok(hullSize.z > 14.5 && hullSize.z < 16, `fuselage ${hullSize.z}`);
  const glass = new Box3().setFromObject(a.group.getObjectByName('cabin glazing'));
  assert.ok(glass.min.z < -7 && glass.max.z > 2.5, 'flight-deck glazing at the nose and windows along the cabin');
  assert.ok(a.materials.paint.isMeshPhysicalMaterial && a.materials.paint.clearcoat > 0 && a.materials.glass.isMeshPhysicalMaterial);
  assert.equal(a.materials.paint.color.getHexString(), a.materials.paint.color.clone().setStyle('hsl(48, 22%, 91%)').getHexString());
  assert.equal(a.materials.mustard.color.getHexString(), a.materials.mustard.color.clone().setStyle('hsl(42, 72%, 50%)').getHexString());
  assert.equal(a.materials.signal.color.getHexString(), a.materials.signal.color.clone().setStyle('hsl(77, 88%, 67%)').getHexString());
  a.dispose(); h8.dispose();
});

test('mesh and triangle budget', () => {
  const a = createTandem();
  let meshes = 0, triangles = 0;
  a.group.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  assert.ok(meshes < 160, `meshes ${meshes}`); assert.ok(triangles < 60000, `triangles ${triangles}`);
  a.dispose();
});

test('two separated three-blade heads at different heights, four fixed wheels, nothing at the tail', () => {
  const a = createTandem();
  const front = named(a.group, 'front rotor'), rear = named(a.group, 'rear rotor');
  assert.equal(front.length, 1); assert.equal(rear.length, 1);
  assert.equal(named(front[0], 'rotor blade').length, 3); assert.equal(named(rear[0], 'rotor blade').length, 3);
  assert.equal(named(a.group, 'rotor blade').length, 6); assert.equal(type.rotor.blades, 3); assert.equal(type.rotor.tandem, true);
  const gap = rear[0].position.z - front[0].position.z;
  assert.ok(gap > 11 && gap < 12.5, `rotor centres ${gap} m apart`);
  assert.ok(gap < 2 * D.rotorRadius, 'discs overlap in plan');
  assert.ok(rear[0].position.y - front[0].position.y > 0.9, 'the rear disc sits clearly higher');
  assert.ok(front[0].position.z < 0 && rear[0].position.z > 0);
  assert.equal(named(a.group, 'rotor sweep').length, 2);
  assert.equal(named(a.group, 'tyre').length, 4);
  assert.equal(named(a.group, 'fixed front gear').length, 2); assert.equal(named(a.group, 'fixed rear gear').length, 2);
  for (const t of named(a.group, 'tyre')) { a.group.updateMatrixWorld(true); assert.ok(Math.abs(new Box3().setFromObject(t).min.y + f.groundClearance) < 1e-3); }
  // Footprint in the type matches the wheel base (half-width and half-length within a few cm).
  const tyres = named(a.group, 'tyre').map(t => t.position);
  const halfWidth = Math.max(...tyres.map(p => Math.abs(p.x))), halfLength = (Math.max(...tyres.map(p => p.z)) - Math.min(...tyres.map(p => p.z))) / 2;
  assert.ok(Math.abs(halfWidth - f.footprint[0]) < 0.05 && Math.abs(halfLength - f.footprint[1]) < 0.05, `${halfWidth} ${halfLength}`);
  assert.equal(named(a.group, 'tail rotor').length, 0); assert.equal(named(a.group, 'tail blade').length, 0); assert.equal(named(a.group, 'main rotor').length, 0);
  const source = readFileSync(new URL('../src/tandem.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /skid|tail rotor/i, 'wheel wording only');
  a.dispose();
});

test('rotors counter-rotate with rotorSpeed, stop at zero speed and when crashed; gear always down', () => {
  const a = createTandem();
  const f0 = a.frontRotor.rotation.y, r0 = a.rearRotor.rotation.y;
  a.update(0.02, f.hoverCollective, { rotorSpeed: 1 });
  const df = a.frontRotor.rotation.y - f0, dr = a.rearRotor.rotation.y - r0;
  assert.ok(Math.abs(df - 0.02 * type.rotor.rate) < 1e-9 && Math.abs(dr + 0.02 * type.rotor.rate) < 1e-9, `${df} ${dr}`);
  assert.ok(Math.sign(df) === -Math.sign(dr), 'opposite senses');
  a.update(0.02, f.hoverCollective, { rotorSpeed: 0.5 });
  assert.ok(Math.abs(a.frontRotor.rotation.y - f0 - df * 1.5) < 1e-9);
  const sweep = named(a.group, 'rotor sweep')[0].material;
  assert.ok(sweep.opacity > 0 && sweep.opacity < 0.08, 'faint sweep at speed');
  const front = a.frontRotor.rotation.y, rear = a.rearRotor.rotation.y;
  a.update(0.1, 0, { rotorSpeed: 0 }); assert.equal(a.frontRotor.rotation.y, front); assert.equal(a.rearRotor.rotation.y, rear);
  a.update(0.1, 0, { rotorSpeed: 1, crashed: true }); assert.equal(a.frontRotor.rotation.y, front); assert.equal(a.rearRotor.rotation.y, rear);
  assert.equal(sweep.opacity, 0);
  a.update(0, 0, {}); // dt may be 0
  for (const state of [parked, { gearDown: true, grounded: false, flightTime: 10, rotorSpeed: 1 }]) {
    a.update(5, 0.6, state); assert.equal(a.gearPosition, 1);
    for (const g of [...named(a.group, 'fixed front gear'), ...named(a.group, 'fixed rear gear')]) assert.equal(g.visible, true);
  }
  a.setCockpit(true); assert.equal(a.group.visible, false); a.setCockpit(false); assert.equal(a.group.visible, true);
  a.dispose();
});

test('model dispose fires on every geometry and material', () => {
  const a = createTandem();
  const geometries = new Set(), materials = new Set();
  a.group.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  let g = 0, m = 0;
  geometries.forEach(x => x.addEventListener('dispose', () => g++)); materials.forEach(x => x.addEventListener('dispose', () => m++));
  a.dispose(); assert.equal(g, geometries.size); assert.equal(m, materials.size);
});

test('tandem flight deck: named, beyond the near plane, panels fit desktop and phone without HUD overlap', () => {
  const cockpit = createTandemCockpit(); assert.equal(cockpit.name, 'Lodra H20 — cockpit');
  assert.equal(typeof cockpit.userData.update, 'function'); assert.equal(typeof cockpit.userData.fit, 'function');
  cockpit.userData.update({ speed: 0, position: { y: 100 }, bank: 0, pitch: 0, rotorSpeed: 1, throttle: 0.6, spool: 0.6 });
  const halfH = Math.tan(67 * Math.PI / 360);
  // The canvas is the world area below the top bar (70 px desktop, 58 px phone), as in the layout table below.
  for (const aspect of [1600 / 900, 1600 / 830, 1280 / 730, 390 / 844, 390 / 786]) {
    cockpit.userData.fit(aspect); cockpit.updateMatrixWorld(true);
    cockpit.traverse(o => { if (o.isMesh) {
      assert.equal(o.frustumCulled, false);
      const b = new Box3().setFromObject(o);
      assert.ok(b.max.z < -1, `${aspect}: surface inside the near plane at z ${b.max.z}`);
    } });
    // The visible panel lies wholly inside the view horizontally and in the lower part on desktop.
    const panel = Object.values(cockpit.userData.panels).find(p => p.group.visible), box = new Box3().setFromObject(panel.group), depth = -box.max.z;
    const halfW = halfH * aspect * depth;
    if (aspect !== 390 / 844) assert.ok(box.min.x > -halfW && box.max.x < halfW, `${aspect}: panel ${box.min.x}..${box.max.x} vs ±${halfW}`);
    assert.ok(box.min.y > -halfH * depth, `${aspect}: panel bottom on screen`);
  }
  // Same HUD gaps as the Sorna H8 deck (rectangles are [left, top, right, bottom] CSS px measured in Chromium).
  const layouts = {
    '1600x900': { world: [70, 900], panel: 'wide', avoid: [[1316, 482, 1576, 728], [1539, 420, 1576, 502], [190, 748, 1410, 854], [24, 687, 244, 728], [24, 94, 314, 368]] },
    '1280x800': { world: [70, 800], panel: 'wide', avoid: [[1016, 401, 1256, 632], [1219, 370, 1256, 452], [24, 648, 1256, 754], [24, 591, 244, 632], [24, 94, 310, 368]] },
    '390x844': { world: [58, 844], panel: 'compact', avoid: [[234, 132, 376, 281], [346, 337, 376, 403], [14, 638, 376, 814], [14, 457, 156, 493], [14, 72, 207, 241], [22, 519, 124, 621], [311, 516, 350, 624], [138, 546, 212, 585]] },
  };
  for (const [size, { world: [top, bottom], panel, avoid }] of Object.entries(layouts)) {
    const [width] = size.split('x').map(Number), height = bottom - top, focal = height / 2 / halfH;
    cockpit.userData.fit(width / height); cockpit.updateMatrixWorld(true);
    assert.deepEqual(Object.entries(cockpit.userData.panels).filter(([, p]) => p.group.visible).map(([n]) => n), [panel], size);
    const box = new Box3().setFromObject(cockpit.userData.panels[panel].group), depth = -box.max.z;
    const rect = [width / 2 + box.min.x / depth * focal, top + height / 2 - box.max.y / depth * focal, width / 2 + box.max.x / depth * focal, top + height / 2 - box.min.y / depth * focal];
    assert.ok(rect[0] >= 0 && rect[2] <= width && rect[1] >= top, `${size}: panel ${rect.map(Math.round)} leaves the view`);
    for (const r of avoid) assert.ok(rect[2] <= r[0] || rect[0] >= r[2] || rect[3] <= r[1] || rect[1] >= r[3], `${size}: panel ${rect.map(Math.round)} overlaps ${r}`);
    assert.ok((rect[2] - rect[0]) / COCKPIT[panel].pixels[0] > 0.36, `${size}: readable`);
    if (panel === 'wide') assert.ok(box.max.y < -0.12, `${size}: panel top ${box.max.y}`);
  }
  assert.equal(type.cockpitOffset.length, 3); assert.ok(type.cockpitOffset[0] < 0, 'left seat');
  assert.ok(type.cameraScale >= 1.7 && type.cameraScale <= 1.9);
  // Camera-local geometry disposes completely.
  const own = createTandemCockpit(), parts = new Set(); let disposed = 0;
  own.traverse(o => { if (o.isMesh) { parts.add(o.geometry); parts.add(o.material); } });
  parts.forEach(x => x.addEventListener('dispose', () => disposed++));
  disposeObject(own); assert.equal(disposed, parts.size);
  disposeObject(cockpit);
});

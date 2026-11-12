import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityliner as type } from './cityliner-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Dimensions in metres; the nose points down local -Z. Ivory airframe, ink-blue accent, glacier pinstripe.
const D = {
  span: 26.3, wingY: 1.55, wingZ: -2.7, chord: 4.6, tip: 1.6, sweep: 3.4, anhedral: -0.55,
  fin: 5, finZ: 9.4, tailSpan: 11.2, fanRadius: 0.55, nacelle: 2.9, engines: [4.3, 7.6],
  wheel: 0.45, mainX: 1.95, mainZ: 0.8, noseZ: -11.6,
  accent: 'hsl(204, 42%, 22%)', stripe: 'hsl(188, 34%, 62%)',
};
// Fuselage stations: z, half width, half height, centre height, superellipse exponent (2 is round).
const STATIONS = [
  [-14, 0.15, 0.15, -0.2, 2], [-13.6, 0.8, 0.75, -0.25, 2], [-12.6, 1.35, 1.3, -0.12, 2], [-11.2, 1.65, 1.6, -0.02, 2.1],
  [-9.6, 1.75, 1.75, 0, 2.15], [7, 1.75, 1.75, 0, 2.15], [10.5, 1.25, 1.35, 0.35, 2.1], [13.6, 0.45, 0.6, 0.95, 2], [14.6, 0.12, 0.2, 1.15, 2],
];
export const CITYLINER_LENGTH = STATIONS.at(-1)[0] - STATIONS[0][0];

function station(z) {
  let i = 0;
  while (i < STATIONS.length - 2 && z > STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1), s = u * u * (3 - 2 * u);
  return { w: mix(a[1], b[1], s), h: mix(a[2], b[2], s), y: mix(a[3], b[3], s), n: mix(a[4], b[4], s) };
}
const superellipse = (angle, n) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
};
/** A point on the hull skin, `lift` metres proud of it. */
function hull(z, angle, lift = 0) {
  const st = station(z), [x, y] = superellipse(angle, st.n);
  return [x * (st.w + lift), st.y + y * (st.h + lift), z];
}
/** Spanwise station of the high, swept, slightly drooping wing; t runs root (0) to tip (1). */
function wingSection(t, side) {
  return { x: side * mix(0.6, D.span / 2, t), y: D.wingY + D.anhedral * t, z: D.wingZ + D.sweep * t, chord: mix(D.chord, D.tip, t) };
}
const wingAt = x => (Math.abs(x) - 0.6) / (D.span / 2 - 0.6);

/** Original procedural Valnera Q100; no textures, assets or model downloads. */
export function createCityliner() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.3, metalness: 0.12, clearcoat: 0.8, side: THREE.DoubleSide }),
    accent: standard(D.accent), stripe: standard(D.stripe, 0.4), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    seam: standard('hsl(205, 10%, 58%)', 0.5, 0.2),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 37%, 19%)', roughness: 0.1, metalness: 0.5, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, gears = [], fans = [], lights = [];
  function part(geometry, material, parent = group, name = '') {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.SphereGeometry(1, 18, 10), material, parent);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function box(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.BoxGeometry(sx, sy, sz), material, parent); m.position.set(x, y, z); return m;
  }
  function rod(a, b, radius, material = materials.metal, parent = group, radiusEnd = radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radiusEnd, radius, start.distanceTo(end), 10), material, parent);
    m.position.copy(start).add(end).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return m;
  }
  function grid(rows, cols, vertex, reverse = false) {
    const positions = [], indices = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) positions.push(...vertex(i / rows, j / cols));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      indices.push(...(reverse ? [a, b, a + 1, b, b + 1, a + 1] : [a, a + 1, b, b, a + 1, b + 1]));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }
  const zFront = STATIONS[0][0], zBack = STATIONS.at(-1)[0];
  // Rounded passenger fuselage: blunt nose, constant cabin, upswept tailcone under the T-tail.
  part(grid(80, 40, (t, v) => hull(mix(zFront, zBack, t), v * Math.PI * 2)), materials.paint);
  const patch = (z0, z1, a0, a1, material, lift = 0.02, rows = 8, cols = 6) => part(grid(rows, cols, (u, v) => hull(mix(z0, z1, u), mix(a0, a1, v), lift)), material);
  patch(-12.55, -11.45, Math.PI * 0.26, Math.PI * 0.74, materials.glass, 0.02, 10, 12);
  for (const side of [-1, 1]) {
    const a = side > 0 ? 0 : Math.PI, at = angle => side > 0 ? angle : Math.PI - angle;
    patch(-11.4, -10.6, at(0.42), at(0.7), materials.glass);
    // Restrained livery: one ink cheat line below the windows and a glacier pinstripe under it.
    patch(-12.2, 11, a - side * 0.12, a - side * 0.2, materials.accent, 0.012, 60, 1);
    patch(-12.2, 11, a - side * 0.25, a - side * 0.28, materials.stripe, 0.012, 60, 1);
    // Cabin windows between the doors.
    for (let z = -7.9; z < 5.2; z += 0.95) {
      const [x, y] = hull(z, at(0.3), 0.012); ellipsoid(x, y, z, 0.03, 0.19, 0.15, materials.glass);
    }
    // Forward and aft passenger doors: a seam outline, a flush panel and a small porthole each.
    for (const z of [-9.1, 6.1]) {
      patch(z - 0.48, z + 0.48, at(-0.3), at(0.62), materials.seam, 0.014, 2, 6);
      patch(z - 0.42, z + 0.42, at(-0.26), at(0.58), materials.paint, 0.02, 2, 6);
      const [x, y] = hull(z, at(0.36), 0.024); ellipsoid(x, y, z, 0.03, 0.12, 0.1, materials.glass);
    }
    // Main-gear sponsons along the lower fuselage hold the retracted wheels.
    ellipsoid(side * 1.48, -1.2, D.mainZ, 0.62, 0.62, 3.1, materials.paint);
  }
  // Wing-to-body fairing on the cabin roof and a belly fairing between the sponsons.
  ellipsoid(0, 1.62, -0.6, 1.35, 0.42, 4.3, materials.paint);
  ellipsoid(0, -1.55, 0.6, 1.1, 0.35, 3.6, materials.paint);

  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null) {
    const geometry = grid(10, 20, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * Math.PI * 2;
      const c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2), thickness = sec.chord * 0.055 * Math.sin(angle);
      return vertical ? [sec.x + thickness, sec.y, sec.z + c * sec.chord] : [sec.x, sec.y + thickness, sec.z + c * sec.chord];
    }, vertical ? false : side < 0);
    if (!moving) return part(geometry, material);
    const start = sectionAt(from), end = sectionAt(to);
    const hinge = new THREE.Vector3(start.x, start.y, start.z + start.chord * chordFrom);
    const axis = new THREE.Vector3(end.x, end.y, end.z + end.chord * chordFrom).sub(hinge).normalize();
    // Keep +X hinge orientation on both wings so opposite aileron signs are physical.
    if (!vertical && axis.x < 0) axis.negate();
    const pivot = new THREE.Group(); pivot.position.copy(hinge); group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0, hinge: hinge.clone() });
  }
  const tailY = 1.25 + D.fin, tailZ = D.finZ + 2.7;
  for (const side of [-1, 1]) {
    const wing = t => wingSection(t, side);
    surface(wing, 0, 1, 0, 0.72, materials.paint, side);
    // Large inboard flaps carry the short-field lift; ailerons sit outboard of the outer engines.
    surface(wing, 0.02, 0.64, 0.72, 1, materials.paint, side, false, 'flaps');
    surface(wing, 0.67, 0.96, 0.72, 1, materials.paint, side, false, 'ailerons');
    surface(wing, 0.64, 0.67, 0.72, 1, materials.paint, side);
    surface(wing, 0.96, 1, 0.72, 1, materials.paint, side);
    const tail = t => ({ x: side * mix(0.15, D.tailSpan / 2, t), y: tailY + 0.1 * t, z: tailZ + 1.7 * t, chord: mix(2.7, 1.3, t) });
    surface(tail, 0, 1, 0, 0.66, materials.paint, side);
    surface(tail, 0, 1, 0.66, 1, materials.paint, side, false, 'elevators');
    const tip = wingSection(1, side);
    lights.push(ellipsoid(tip.x, tip.y, tip.z + 0.3, 0.08, 0.08, 0.12,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));

    // Four separate podded turbofans on short pylons below the high wing.
    for (const x of D.engines) {
      const sec = wingSection(wingAt(x), side), r = D.fanRadius, cx = side * x, cy = sec.y - 1.2, front = sec.z - 1.7;
      surface(t => ({ x: cx, y: cy + 0.4 + t * 0.95, z: front + 0.7 + t * 0.5, chord: mix(2.6, 2.3, t) }), 0, 1, 0, 1, materials.paint, 1, true);
      // Open-ended nacelle skin and inlet tunnel leave the animated fan visible.
      part(grid(20, 28, (t, v) => { const angle = v * Math.PI * 2, radius = r * (1.08 - 0.3 * t + 0.14 * Math.sin(t * Math.PI));
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), front + t * D.nacelle]; }), materials.paint);
      const lip = part(new THREE.TorusGeometry(r * 1.02, r * 0.08, 8, 28), materials.accent); lip.position.set(cx, cy, front);
      const inlet = part(new THREE.CircleGeometry(r, 28), materials.dark); inlet.rotation.y = Math.PI; inlet.position.set(cx, cy, front + r * 0.5);
      const exhaust = part(new THREE.CylinderGeometry(r * 0.6, r * 0.72, r * 0.2, 20, 1, true), materials.dark);
      exhaust.rotation.x = Math.PI / 2; exhaust.position.set(cx, cy, front + D.nacelle);
      const cone = part(new THREE.ConeGeometry(r * 0.36, r * 0.9, 16), materials.metal); cone.rotation.x = Math.PI / 2; cone.position.set(cx, cy, front + D.nacelle + 0.3);
      const fan = new THREE.Group(); fan.name = 'turbofan fan'; fan.position.set(cx, cy, front + r * 0.25); group.add(fan); fans.push(fan);
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, blade = part(new THREE.BoxGeometry(r * 0.15, r * 0.72, r * 0.035), materials.metal, fan);
        blade.position.set(-Math.sin(a) * r * 0.55, Math.cos(a) * r * 0.55, 0); blade.rotation.set(0, 0.42, a);
      }
      const spinner = part(new THREE.ConeGeometry(r * 0.2, r * 0.5, 14), materials.dark, fan); spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.1;
    }
  }
  // Tall T-tail: swept fin in the accent, rudder below a bullet fairing, stabiliser across the top.
  const fin = t => ({ x: 0, y: 1.25 + D.fin * t, z: D.finZ + 2.6 * t, chord: mix(4.4, 2.75, t) });
  surface(fin, 0, 1, 0, 0.68, materials.accent, 1, true);
  surface(fin, 0.04, 0.94, 0.68, 1, materials.accent, 1, true, 'rudder');
  surface(t => ({ x: 0, y: 1.1 + 1.0 * t, z: 6.6 + 2.9 * t, chord: mix(3.4, 1.4, t) }), 0, 1, 0, 1, materials.accent, 1, true); // dorsal fillet
  ellipsoid(0, tailY + 0.05, tailZ + 1.4, 0.32, 0.32, 1.9, materials.accent);
  lights.push(ellipsoid(0, tailY + 0.05, tailZ + 3.35, 0.06, 0.06, 0.09, new THREE.MeshBasicMaterial({ color: 'hsl(48, 100%, 92%)' })));

  // Retractable tricycle gear: twin-wheel mains fold inward into the sponsons, the twin nose leg folds forward.
  const tyreDatum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.62, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.66, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  function leg(name, x, y, z, radius, axis, stowAngle, side) {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, y, z); group.add(pivot);
    const length = y - (tyreDatum + radius);
    rod([0, 0, 0], [0, -length, 0], 0.11, materials.metal, pivot);
    rod([0, -length * 0.15, side ? 0 : 0.5], [0, -length * 0.7, 0], 0.05, materials.metal, pivot);
    for (const offset of [-radius * 0.55, radius * 0.55]) wheel(offset, -length, 0, radius, pivot);
    box(side * 0.28, -length * 0.4, 0, 0.05, length * 0.8, radius * 1.9, materials.paint, pivot); // gear door
    gears.push({ pivot, axis: new THREE.Vector3(...axis), stowAngle, side });
  }
  for (const side of [-1, 1]) leg('retractable main gear', side * D.mainX, -1.35, D.mainZ, D.wheel, [0, 0, 1], -side * 1.5, side);
  leg('retractable nose gear', 0, -1.25, D.noseZ, 0.33, [1, 0, 0], 1.6, 0);

  // Batch only immutable root meshes. Fans, gear and control surfaces keep their own pivots.
  const batches = new Map(); group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) if (mesh.isMesh && !lights.includes(mesh)) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) { part(mergeGeometries(geometries), material); geometries.forEach(g => g.dispose()); }

  let gearPosition = 0, flapAngle = 0, previous = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      // One simulated spool drives all four fans; small fans turn faster than the big airliner's.
      const spool = clamp(state.spool ?? throttle, 0, 1);
      for (const fan of fans) fan.rotation.z += dt * (10 + spool * 105);
      // Gear travels in about four seconds; a fresh flight or the ground places it at once.
      const target = state.gearDown ? 1 : 0, fresh = (state.flightTime ?? 1) < 0.05;
      if (state.grounded || fresh) gearPosition = target;
      else gearPosition += clamp(target - gearPosition, -dt / 4, dt / 4);
      for (const { pivot, axis, stowAngle } of gears) {
        pivot.visible = gearPosition > 0.01;
        pivot.quaternion.setFromAxisAngle(axis, stowAngle * (1 - THREE.MathUtils.smoothstep(gearPosition, 0, 1)));
      }
      if (dt > 0) {
        if (!previous || fresh) previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-7 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.5, -0.38, 0.38) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-delta('pitch') * 1.4, -0.35, 0.35) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2.5, -0.32, 0.32) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        // 15° per stage, about 3.5 s for full travel; a fresh flight starts with the flaps where they are set.
        if (fresh) flapAngle = (state.flaps ?? 0) * Math.PI / 12;
        else flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.15, dt * 0.15);
      }
      for (const [name, list] of Object.entries(surfaces)) for (const s of list) {
        s.angle = name === 'flaps' ? flapAngle : name === 'ailerons' ? -deflection.ailerons * s.side : deflection[name];
        s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle);
        // The flaps also track aft as they lower, opening the slot behind the wing.
        if (name === 'flaps') s.pivot.position.z = s.hinge.z + flapAngle * 0.8;
      }
    },
    get gearPosition() { return gearPosition; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([k, list]) => [k, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

/** Camera-local two-crew transport deck: glass PFD, four-engine N1 column and a flap/gear block, kept low. */
export function createCitylinerCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0.25, -0.45); root.add(panel);
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: D.accent, roughness: 0.6 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // Narrow side posts, an offset centre post and a slim accent overhead edge keep the runway in view.
  for (const side of [-1, 1]) {
    bar([side * 1.6, -0.9, -1.6], [side * 1.6, -0.75, -2.65], 0.05);
    bar([side * 1.6, -0.8, -1.8], [side * 1.3, 1.6, -2.3], 0.05);
  }
  bar([0.5, -0.6, -2.25], [0.42, 1.65, -2.35], 0.035);
  bar([-1.35, 1.62, -2.3], [1.35, 1.62, -2.3], 0.06, accent);
  const shell = part(new THREE.BoxGeometry(3, 0.54, 0.18), dark, panel); shell.position.set(0, -0.94, -1.9);
  const hood = part(new THREE.BoxGeometry(3.1, 0.06, 0.42), trim, panel); hood.position.set(0, -0.65, -1.97);
  // Captain's and first officer's yokes, and a pedestal with four thrust levers.
  for (const x of [-0.5, 0.95]) {
    bar([x, -1.42, -1.4], [x, -1.05, -1.5], 0.035, trim);
    bar([x - 0.17, -0.98, -1.5], [x, -1.08, -1.5], 0.025, trim); bar([x, -1.08, -1.5], [x + 0.17, -0.98, -1.5], 0.025, trim);
  }
  for (let i = 0; i < 4; i++) {
    const x = 0.12 + i * 0.08; bar([x, -1.48, -1.42], [x, -1.24, -1.52], 0.014, trim);
    const knob = part(new THREE.BoxGeometry(0.05, 0.04, 0.05), i === 0 || i === 3 ? accent : trim); knob.position.set(x, -1.22, -1.53);
  }
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.43, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 250;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(2.86, 0.48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0, -0.94, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)', line: 'hsl(205 15% 26%)', warn: 'hsl(0 78% 52%)' };
    const text = (label, x, y, size = 18, color = colors.ink, align = 'center') => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = align; ctx.fillText(label, x, y); };
    let last = -1;
    root.userData.update = state => {
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1200, 250);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 600, 24, 18, colors.muted);
      const knots = state.speed * 1.94384, altitude = state.position.y * 3.28084, spool = clamp(state.spool ?? 0, 0, 1);
      // Primary flight display: speed and altitude boxes either side of the attitude.
      ctx.save(); ctx.beginPath(); ctx.rect(150, 46, 340, 190); ctx.clip(); ctx.translate(320, 141); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 130);
      ctx.fillStyle = colors.sky; ctx.fillRect(-300, -340, 600, 340); ctx.fillStyle = colors.earth; ctx.fillRect(-300, 0, 600, 340);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-290, 0); ctx.lineTo(290, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(265, 141); ctx.lineTo(302, 141); ctx.lineTo(320, 150); ctx.lineTo(338, 141); ctx.lineTo(375, 141); ctx.stroke();
      for (const [x, label, value, units] of [[75, 'IAS', Math.round(knots), 'KT'], [565, 'ALT', Math.round(altitude), 'FT']]) {
        ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.strokeRect(x - 65, 95, 130, 92);
        text(label, x, 118, 14, colors.muted); text(String(value), x, 158, 30, colors.signal); text(units, x, 180, 12, colors.muted);
      }
      text(`HDG ${String(Math.round((state.heading ?? 0) * 180 / Math.PI) % 360).padStart(3, '0')}`, 75, 225, 16);
      text(`VS ${Math.round((state.verticalSpeed ?? 0) * 196.85)}`, 565, 225, 16);
      // Engine column: four N1 bars. All four read one simulated spool, and the label says so.
      text('N1 % · ONE SHARED SPOOL', 652, 62, 14, colors.muted, 'left');
      for (let i = 0; i < 4; i++) {
        const x = 668 + i * 60, n1 = 22 + spool * 76;
        ctx.fillStyle = colors.line; ctx.fillRect(x, 78, 26, 110);
        ctx.fillStyle = colors.signal; ctx.fillRect(x, 188 - 110 * spool, 26, 110 * spool);
        text(String(i + 1), x + 13, 208, 14, colors.muted); text(String(Math.round(n1)), x + 13, 232, 17);
      }
      // Flap stages and gear state: the selected flap stage fills, gear reads green-signal when down.
      text('FLAPS', 935, 62, 15, colors.muted, 'left');
      [0, 15, 30].forEach((deg, i) => {
        const x = 935 + i * 72, on = (state.flaps ?? 0) === i;
        ctx.strokeStyle = on ? colors.signal : colors.line; ctx.lineWidth = 2; ctx.strokeRect(x, 74, 60, 36);
        if (on) { ctx.fillStyle = colors.signal; ctx.fillRect(x + 2, 76, 56, 32); }
        text(`${deg}°`, x + 30, 99, 17, on ? colors.background : colors.muted);
      });
      text('GEAR', 935, 145, 15, colors.muted, 'left');
      text(state.gearDown ? 'DOWN · 3 GREEN' : 'UP', 1150, 145, 19, state.gearDown ? colors.signal : colors.ink, 'right');
      const unsafe = !state.gearDown && !state.grounded && (state.throttle ?? 1) < 0.2;
      text(state.stalled ? 'STALL' : unsafe ? 'GEAR' : type.badge, 1040, 205, 26, state.stalled || unsafe ? colors.warn : colors.muted);
      texture.needsUpdate = true;
    };
  }
  return root;
}

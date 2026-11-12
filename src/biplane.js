import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aircraftType } from './fleet.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const smooth = u => (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;

// Alba B2 dimensions in metres; the nose points down local -Z. Staggered wings: the upper sits 0.5 m ahead.
const D = {
  noseZ: -2.95, length: 6.9,
  upper: { y: 1.12, z: -1.55, chord: 1.35, half: 4.4, root: 0, dihedral: 0 },
  lower: { y: -0.42, z: -1.05, chord: 1.25, half: 4, root: 0.45, dihedral: 0.18 },
  strutAt: 3.17, propZ: -3.12, propRadius: 1.1, wheel: 0.36, gearX: 0.8, gearZ: -1.35, tailwheelZ: 3.85, tailwheel: 0.12,
};
// Fuselage stations: [fraction of length, half width, half height, centre height]. Aluminium cowl, then a fabric body
// whose top longeron falls toward a low tail so the fixed tailwheel stays short.
const STATIONS = [
  [0, 0.28, 0.28, 0], [0.03, 0.44, 0.44, 0], [0.13, 0.5, 0.52, 0.02], [0.22, 0.5, 0.55, 0.03],
  [0.45, 0.5, 0.56, 0.02], [0.65, 0.38, 0.42, -0.1], [0.88, 0.18, 0.22, -0.3], [1, 0.04, 0.06, -0.4],
];
const COWL = 0.22;

export function fuselageSection(t) {
  let i = 0;
  while (i < STATIONS.length - 2 && t > STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], u = smooth((t - a[0]) / (b[0] - a[0]));
  return { width: mix(a[1], b[1], u), height: mix(a[2], b[2], u), y: mix(a[3], b[3], u), z: D.noseZ + t * D.length };
}

/** Original open-cockpit biplane: two stacked fabric wings, cabane and interplane struts, fixed tailwheel gear. */
export function createBiplane() {
  const type = aircraftType('biplane'), group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.45, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  // Alpine Meadow livery: olive doped body, ivory fabric wings, polished cowl and a single copper line.
  const materials = {
    fabric: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 24%, 90%)', roughness: 0.55, metalness: 0.02, clearcoat: 0.25, side: THREE.DoubleSide }),
    body: new THREE.MeshPhysicalMaterial({ color: 'hsl(82, 24%, 30%)', roughness: 0.42, metalness: 0.08, clearcoat: 0.6, side: THREE.DoubleSide }),
    copper: standard('hsl(26, 58%, 50%)', 0.35, 0.45), metal: standard('hsl(200, 8%, 80%)', 0.3, 0.55),
    strut: standard('hsl(205, 20%, 14%)', 0.5, 0.4), wood: standard('hsl(28, 45%, 28%)', 0.4, 0.05),
    leather: standard('hsl(20, 30%, 18%)', 0.8, 0), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 30%, 70%)', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, rotors = [], gears = [], moving = [];
  function part(geometry, material, parent = group, name = '') {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = material !== materials.glass; parent.add(mesh); return mesh;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.SphereGeometry(1, 18, 10), material, parent); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function rod(a, b, radius = 0.03, material = materials.strut, parent = group) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 6), material, parent);
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
  // Slightly boxy fabric sections; the cowl is the same loft in aluminium.
  const hull = (t, angle, inflate = 0) => {
    const s = fuselageSection(t), c = Math.cos(angle), n = Math.sin(angle), box = mix(1, 0.85, smooth((t - COWL) / 0.15));
    return [Math.sign(c) * Math.abs(c) ** box * (s.width + inflate), s.y + Math.sign(n) * Math.abs(n) ** box * (s.height + inflate), s.z];
  };
  part(grid(10, 28, (u, v) => hull(mix(0, COWL, u), v * Math.PI * 2)), materials.metal);
  part(grid(50, 28, (u, v) => hull(mix(COWL, 1, u), v * Math.PI * 2)), materials.body);
  for (const side of [-1, 1]) {
    part(grid(36, 1, (u, v) => hull(mix(COWL + 0.01, 0.9, u), (side < 0 ? Math.PI : 0) + (v - 0.5) * 0.09, 0.012), side > 0), materials.copper);
    for (const z of [-2.45, -2.2]) rod([side * 0.5, -0.32, z], [side * 0.62, -0.42, z + 0.12], 0.045, materials.strut);
  }
  // Open cockpit: dark well, padded leather coaming, small windscreen, a pilot's helmet and a faired headrest.
  ellipsoid(0, 0.5, 0.45, 0.34, 0.07, 0.5, materials.strut);
  const coaming = part(new THREE.TorusGeometry(1, 0.06, 6, 28), materials.leather);
  coaming.position.set(0, 0.55, 0.45); coaming.rotation.x = Math.PI / 2; coaming.scale.set(0.36, 0.52, 1);
  ellipsoid(0, 0.78, 0.62, 0.15, 0.17, 0.17, materials.leather);
  ellipsoid(0, 0.48, 1.25, 0.2, 0.17, 0.62, materials.body);
  const screen = part(new THREE.PlaneGeometry(0.52, 0.26), materials.glass);
  screen.position.set(0, 0.7, -0.08); screen.rotation.x = -0.55;
  rod([-0.26, 0.58, -0.02], [-0.26, 0.8, -0.15], 0.012, materials.metal); rod([0.26, 0.58, -0.02], [0.26, 0.8, -0.15], 0.012, materials.metal);

  // Thin cambered fabric wings with rounded tips. Each section returns the leading edge and its chord.
  function wingAt(w, side) {
    return t => {
      const tip = t < 0.86 ? 1 : 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
      return { x: side * mix(w.root, w.half, t), y: w.y + w.dihedral * t, z: w.z + w.chord * (1 - tip) * 0.5, chord: w.chord * tip };
    };
  }
  function tailAt(side) {
    return t => {
      const tip = 0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - t * t));
      return { x: side * mix(0.12, 1.65, t), y: -0.32, z: 3.05 + 0.95 * (1 - tip) * 0.5 + 0.12 * t, chord: 0.95 * tip };
    };
  }
  const fin = t => { const tip = 0.45 + 0.55 * Math.sqrt(Math.max(0, 1 - t * t)); return { x: 0, y: -0.3 + 1.3 * t, z: 3.15 + 0.35 * t, chord: 0.95 * tip }; };
  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, kind = null) {
    const geometry = grid(10, 20, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * Math.PI * 2, c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2);
      const thickness = sec.chord * (0.05 * Math.sin(angle) + (vertical ? 0 : 0.025 * Math.sin(Math.PI * c)));
      return vertical ? [sec.x + thickness, sec.y, sec.z + c * sec.chord] : [sec.x, sec.y + thickness, sec.z + c * sec.chord];
    }, vertical ? false : side < 0);
    if (!kind) return part(geometry, material);
    const start = sectionAt(from), end = sectionAt(to);
    const hinge = new THREE.Vector3(start.x, start.y, start.z + start.chord * chordFrom);
    const axis = new THREE.Vector3(end.x, end.y, end.z + end.chord * chordFrom).sub(hinge).normalize();
    // A +X hinge on both wings keeps opposite aileron signs physical.
    if (!vertical && axis.x < 0) axis.negate();
    const pivot = new THREE.Group(); pivot.position.copy(hinge); group.add(pivot); moving.push(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[kind].push({ pivot, axis, side, angle: 0 });
  }
  for (const w of [D.upper, D.lower]) for (const side of [-1, 1]) {
    const at = wingAt(w, side);
    surface(at, 0, 0.5, 0, 1, materials.fabric, side);
    surface(at, 0.5, 0.86, 0, 0.74, materials.fabric, side);
    surface(at, 0.5, 0.86, 0.74, 1, materials.fabric, side, false, 'ailerons');
    surface(at, 0.86, 1, 0, 1, w === D.upper ? materials.copper : materials.fabric, side);
  }
  for (const side of [-1, 1]) {
    surface(tailAt(side), 0, 1, 0, 0.62, materials.fabric, side);
    surface(tailAt(side), 0, 1, 0.62, 1, materials.fabric, side, false, 'elevators');
  }
  surface(fin, 0, 1, 0, 0.55, materials.body, 1, true);
  surface(fin, 0, 1, 0.55, 1, materials.copper, 1, true, 'rudder');

  // Cabane struts carry the upper wing over the cowl; I-struts, flying and landing wires brace the bay.
  const upperBottom = D.upper.y - 0.04;
  for (const side of [-1, 1]) {
    rod([side * 0.3, 0.52, -1.35], [side * 0.45, upperBottom, -1.25]); rod([side * 0.3, 0.52, -0.55], [side * 0.45, upperBottom, -0.5]);
    rod([side * 0.3, 0.52, -1.35], [side * 0.45, upperBottom, -0.5], 0.018);
    const x = side * D.strutAt, t = (D.strutAt - D.lower.root) / (D.lower.half - D.lower.root), lowY = D.lower.y + D.lower.dihedral * t + 0.03;
    const frontU = D.upper.z + D.upper.chord * 0.2, rearU = D.upper.z + D.upper.chord * 0.72;
    const frontL = D.lower.z + D.lower.chord * 0.2, rearL = D.lower.z + D.lower.chord * 0.72;
    rod([x, lowY, frontL], [x, upperBottom, frontU], 0.035); rod([x, lowY, rearL], [x, upperBottom, rearU], 0.035);
    rod([x, lowY + 0.02, (frontL + rearL) / 2], [x, upperBottom - 0.02, (frontU + rearU) / 2], 0.02);
    rod([side * 0.55, D.lower.y, -0.75], [x, upperBottom, frontU + 0.2], 0.007);
    rod([side * 0.55, D.lower.y, -0.45], [x, upperBottom, rearU - 0.2], 0.007);
    rod([side * 0.45, upperBottom, -1.1], [x, lowY, frontL + 0.2], 0.007);
    rod([side * 0.4, -0.2, 3.2], [side * 1.0, -0.32, 3.35], 0.01); rod([side * 0.08, 0.3, 3.4], [side * 1.0, -0.3, 3.4], 0.007);
    const tip = ellipsoid(side * (D.upper.half + 0.02), D.upper.y, D.upper.z + D.upper.chord * 0.5, 0.06, 0.06, 0.09,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' }));
    tip.castShadow = false;
  }

  // Varnished two-blade propeller and polished spinner.
  const prop = new THREE.Group(); prop.name = 'propeller'; prop.position.set(0, 0, D.propZ); group.add(prop); rotors.push(prop); moving.push(prop);
  for (const sign of [-1, 1]) {
    const blade = part(new THREE.CylinderGeometry(0.06, 0.1, D.propRadius * 0.9, 8), materials.wood, prop);
    blade.scale.set(1, 1, 0.35); blade.position.y = sign * D.propRadius * 0.53; blade.rotation.set(0, 0.28 * sign, sign < 0 ? Math.PI : 0);
    const tipCap = ellipsoid(0, sign * D.propRadius * 0.98, 0, 0.065, 0.04, 0.025, materials.copper, prop); tipCap.name = 'blade tip';
  }
  ellipsoid(0, 0, -0.12, 0.2, 0.2, 0.3, materials.metal, prop);

  // Fixed V-strut main gear with a spreader bar, and a sprung tailwheel. Tyres meet the runway top exactly.
  const tyreDatum = 0.925 - type.groundClearance, axleY = tyreDatum + D.wheel;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.5, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.53, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = 'fixed main gear'; group.add(pivot); gears.push(pivot); moving.push(pivot);
    const axle = [side * D.gearX, axleY, D.gearZ];
    rod([side * 0.35, -0.5, D.gearZ - 0.45], axle, 0.035, materials.strut, pivot); rod([side * 0.35, -0.5, D.gearZ + 0.5], axle, 0.035, materials.strut, pivot);
    rod([side * 0.08, axleY + 0.02, D.gearZ], [side * (D.gearX - 0.1), axleY, D.gearZ], 0.03, materials.strut, pivot);
    wheel(axle[0], axleY, D.gearZ, D.wheel, pivot);
  }
  const tail = new THREE.Group(); tail.name = 'fixed tailwheel'; group.add(tail); gears.push(tail); moving.push(tail);
  const tailY = tyreDatum + D.tailwheel;
  rod([0, -0.42, 3.55], [0, tailY + 0.04, D.tailwheelZ], 0.03, materials.strut, tail);
  wheel(0, tailY, D.tailwheelZ, D.tailwheel, tail);

  // Batch the immutable airframe per material; moving pivots keep their own meshes.
  const batches = new Map(); group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) if (mesh.isMesh && !moving.includes(mesh)) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), flat = g.index ? g.toNonIndexed() : g;
    if (g !== flat) g.dispose(); flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    const mesh = part(mergeGeometries(geometries), material); geometries.forEach(g => g.dispose());
    if (material.isMeshBasicMaterial) mesh.castShadow = mesh.receiveShadow = false;
  }

  let previous = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1);
      for (const rotor of rotors) rotor.rotation.z += dt * (8 + spool * 155);
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, ease = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = ease(deflection.ailerons, clamp(delta('bank') * 0.45, -0.4, 0.4) * active);
        deflection.elevators = ease(deflection.elevators, clamp(-delta('pitch') * 1.3, -0.4, 0.4) * active);
        deflection.rudder = ease(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
      }
      for (const [name, list] of Object.entries(surfaces)) for (const s of list) {
        s.angle = name === 'ailerons' ? -deflection.ailerons * s.side : deflection[name];
        s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle);
      }
    },
    get gearPosition() { return 1; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([k, list]) => [k, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

/** Camera-local open cockpit: upper wing overhead, cabane and I-struts, polished nose, small analogue panel. */
export function createBiplaneCockpit() {
  const type = aircraftType('biplane'), root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0, 0); root.add(panel);
  // Doped fabric glows a little with the sky behind it, so the overhead wing never reads as a black slab.
  const fabric = new THREE.MeshStandardMaterial({ color: 'hsl(48, 18%, 80%)', emissive: 'hsl(45, 22%, 48%)', roughness: 0.7, side: THREE.DoubleSide });
  const body = new THREE.MeshStandardMaterial({ color: 'hsl(82, 24%, 26%)', roughness: 0.5 });
  const strut = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.6, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 'hsl(200, 8%, 70%)', roughness: 0.42, metalness: 0.4 });
  const leather = new THREE.MeshStandardMaterial({ color: 'hsl(20, 30%, 16%)', roughness: 0.85 });
  const glass = new THREE.MeshBasicMaterial({ color: 'hsl(201, 30%, 75%)', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const blur = new THREE.MeshBasicMaterial({ color: 'hsl(28, 30%, 20%)', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
  function part(g, m, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.03, mat = strut, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat, parent);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // Wings as seen from the pilot's seat: a narrow translucent-fabric band overhead, the lower panels low at either side.
  const upper = part(new THREE.BoxGeometry(10, 0.05, 1.45), fabric); upper.position.set(0, 1.4, -2.15);
  for (const side of [-1, 1]) {
    const lower = part(new THREE.BoxGeometry(4.1, 0.05, 1.35), fabric); lower.position.set(side * 2.75, -1.3, -2.1);
    bar([side * 0.3, -0.62, -3.15], [side * 0.62, 1.37, -2.85], 0.018); bar([side * 0.3, -0.62, -2.55], [side * 0.62, 1.37, -2.15], 0.018);
    bar([side * 3.3, -1.27, -2.45], [side * 3.3, 1.37, -2.7], 0.04); bar([side * 3.3, -1.27, -1.75], [side * 3.3, 1.37, -1.95], 0.04);
    bar([side * 0.75, -1.28, -2.6], [side * 3.25, 1.37, -2.65], 0.004, metal); bar([side * 0.6, 1.37, -2.6], [side * 3.25, -1.26, -2.5], 0.004, metal);
  }
  const forward = new THREE.Group(); root.add(forward);
  const nose = part(new THREE.SphereGeometry(1, 28, 14), metal, forward); nose.position.set(0, -0.98, -3.45); nose.scale.set(0.55, 0.44, 1.45);
  const disc = part(new THREE.CircleGeometry(1.25, 40), blur, forward); disc.position.set(0, -0.95, -4.95);
  const prop = new THREE.Group(); prop.position.copy(disc.position); forward.add(prop);
  for (const sign of [-1, 1]) { const blade = part(new THREE.BoxGeometry(0.1, 1.1, 0.02), blur, prop); blade.position.y = sign * 0.6; }
  // Padded coaming, small windscreen and the instrument board stay low so the valley fills the view.
  const coaming = part(new THREE.TorusGeometry(0.78, 0.06, 8, 24, Math.PI), leather, panel); coaming.position.set(0, -0.45, -1.85); coaming.scale.set(1, 0.3, 1);
  const deck = part(new THREE.BoxGeometry(1.5, 0.36, 0.12), body, panel); deck.position.set(0, -0.63, -2.0);
  const footwell = part(new THREE.BoxGeometry(1.5, 0.9, 0.1), strut, panel); footwell.position.set(0, -1.26, -1.98);
  const screen = part(new THREE.PlaneGeometry(0.62, 0.28), glass, panel); screen.position.set(0, -0.31, -2.1); screen.rotation.x = -0.45;
  bar([-0.31, -0.45, -2.04], [-0.31, -0.19, -2.16], 0.008, metal, panel); bar([0.31, -0.45, -2.04], [0.31, -0.19, -2.16], 0.008, metal, panel);
  // Phones shrink the board evenly (round dials) and lift it clear of the telemetry grid and touch controls.
  root.userData.fit = aspect => { const k = Math.min(1, Math.max(0.6, aspect / 1.05)); panel.scale.set(k, k, 1); panel.position.y = forward.position.y = aspect < 0.8 ? 0.2 : 0; };
  let canvasUpdate = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 220;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const face = part(new THREE.PlaneGeometry(1.42, 0.347), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    face.position.set(0, -0.63, -1.939);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)' };
    const text = (label, x, y, size, color = colors.ink) => { ctx.fillStyle = color; ctx.font = `500 ${size}px "Barlow Condensed", monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x, y); };
    function dial(x, label, value, max, units, min = 0) {
      ctx.fillStyle = 'hsl(205 15% 26%)'; ctx.beginPath(); ctx.arc(x, 112, 92, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, 112, 85, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI * (0.75 + i / 16 * 1.5); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 70, 112 + Math.sin(a) * 70); ctx.lineTo(x + Math.cos(a) * 79, 112 + Math.sin(a) * 79); ctx.stroke();
      }
      const a = Math.PI * (0.75 + clamp((value - min) / (max - min), 0, 1) * 1.5);
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, 112); ctx.lineTo(x + Math.cos(a) * 64, 112 + Math.sin(a) * 64); ctx.stroke();
      text(label, x, 84, 18, colors.muted); text(String(Math.round(value)), x, 158, 30); text(units, x, 182, 16, colors.muted);
    }
    let last = -1;
    canvasUpdate = state => {
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 900, 220);
      dial(112, 'AIRSPEED', state.speed * 1.94384, type.speedScale, 'KT'); dial(337, 'ALTITUDE', state.position.y * 3.28084, 10000, 'FT');
      dial(562, 'ENGINE', (state.spool ?? 0) * 2500, 2800, 'RPM'); dial(787, 'CLIMB', (state.verticalSpeed ?? 0) * 196.85, 1500, 'FT/MIN', -1500);
      texture.needsUpdate = true;
    };
  }
  root.userData.update = state => {
    prop.rotation.z = (state.flightTime ?? 0) * (8 + (state.spool ?? 0) * 155);
    canvasUpdate?.(state);
  };
  return root;
}

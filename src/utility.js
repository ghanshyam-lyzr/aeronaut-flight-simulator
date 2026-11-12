import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { utility as type } from './utility-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Dimensions in metres; the nose points down local -Z. Ivory airframe, aubergine accent, copper stripe.
const D = {
  span: 15.9, wingY: 1.17, wingZ: -1.95, chord: 2.05, tip: 1.6, dihedral: 0.22,
  tailSpan: 6.2, tailY: 0.62, tailZ: 4.75, tailChord: 1.45, fin: 2.35,
  propZ: -6.45, propRadius: 1.32, blades: 5, wheel: 0.4, gearX: 1.7, gearZ: 0.15, noseZ: -4.75,
  accent: 'hsl(318, 26%, 29%)', stripe: 'hsl(24, 58%, 56%)', tips: 'hsl(46, 82%, 63%)',
};
// Fuselage stations: z, half width, half height, centre height, superellipse exponent (2 round, 5 boxy).
const STATIONS = [
  [-6.3, 0.2, 0.2, -0.04, 2], [-6.05, 0.43, 0.44, -0.04, 2.2], [-5.2, 0.55, 0.58, 0, 2.4], [-4.15, 0.64, 0.7, 0.05, 2.8],
  [-3.45, 0.79, 0.88, 0.17, 3.6], [-2.75, 0.84, 0.95, 0.2, 4.6], [2.35, 0.84, 0.95, 0.2, 4.6], [3.45, 0.62, 0.74, 0.38, 3.6],
  [5.35, 0.25, 0.36, 0.66, 2.6], [6.35, 0.07, 0.17, 0.78, 2],
];
export const UTILITY_LENGTH = STATIONS.at(-1)[0] - D.propZ;

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

/** Original procedural Veyra U9; no textures, assets or model downloads. */
export function createUtility() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.3, metalness: 0.12, clearcoat: 0.8, side: THREE.DoubleSide }),
    accent: standard(D.accent), stripe: standard(D.stripe), tips: standard(D.tips, 0.5), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 37%, 19%)', roughness: 0.1, metalness: 0.5, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, gears = [], rotors = [], lights = [];
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
    const m = part(new THREE.CylinderGeometry(radiusEnd, radius, start.distanceTo(end), 8), material, parent);
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
  // Long turbine nose into a tall square-sided cabin, then a tailcone that rises to the fin.
  part(grid(72, 40, (t, v) => hull(mix(zFront, zBack, t), v * Math.PI * 2)), materials.paint);
  // Hull patches: windscreen, cockpit side glass, cheat lines.
  const patch = (z0, z1, a0, a1, material, lift = 0.02, rows = 8, cols = 6) => part(grid(rows, cols, (u, v) => hull(mix(z0, z1, u), mix(a0, a1, v), lift)), material);
  patch(-3.95, -2.85, Math.PI * 0.3, Math.PI * 0.7, materials.glass, 0.02, 10, 10);
  for (const side of [-1, 1]) {
    const a = side > 0 ? 0 : Math.PI;
    patch(-2.8, -1.95, a + side * 0.18, a + side * 0.9, materials.glass);
    patch(-4.9, 3.6, a - side * 0.18, a - side * 0.26, materials.accent, 0.012, 40, 1);
    patch(-4.9, 3.6, a - side * 0.31, a - side * 0.35, materials.stripe, 0.012, 40, 1);
    // Square passenger windows; the left side keeps its aft bay for the cargo door.
    const x = side * 0.855;
    for (const z of side < 0 ? [-1.35, -0.45] : [-1.35, -0.45, 0.45, 1.35]) box(x, 0.48, z, 0.03, 0.46, 0.52, materials.glass);
  }
  // Two-piece upward/forward cargo door on the left side, framed in the accent, with its own window and handle.
  box(-0.85, 0.15, 1.15, 0.035, 1.42, 1.58, materials.accent);
  box(-0.862, 0.15, 1.15, 0.03, 1.32, 1.48, materials.paint);
  box(-0.862, 0.15, 1.15, 0.032, 1.32, 0.04, materials.accent);
  box(-0.875, 0.5, 0.75, 0.03, 0.42, 0.46, materials.glass); box(-0.875, 0.5, 1.55, 0.03, 0.42, 0.46, materials.glass);
  box(-0.885, -0.12, 1.55, 0.04, 0.05, 0.22, materials.metal);
  // Belly cargo pod and the turbine's chin intake and exhaust stacks.
  part(grid(24, 18, (t, v) => { const z = mix(-3.3, 2.8, t), r = Math.sin(Math.PI * t) ** 0.3, [x, y] = superellipse(v * Math.PI * 2, 3.2);
    return [x * 0.62 * r, -0.86 + y * 0.2 * r, z]; }), materials.accent);
  ellipsoid(0, -0.5, -5.55, 0.26, 0.14, 0.42, materials.dark);
  for (const side of [-1, 1]) {
    rod([side * 0.58, -0.02, -4.95], [side * 0.88, -0.18, -4.62], 0.13, materials.metal, group, 0.16);
    ellipsoid(side * 0.88, -0.18, -4.62, 0.17, 0.17, 0.05, materials.dark);
  }

  function wingSection(t, side) {
    return { x: side * mix(0.4, D.span / 2, t), y: D.wingY + D.dihedral * t, z: D.wingZ + 0.15 * t, chord: t < 0.45 ? D.chord : mix(D.chord, D.tip, (t - 0.45) / 0.55) };
  }
  function tailSection(t, side) {
    return { x: side * mix(0.15, D.tailSpan / 2, t), y: D.tailY + 0.12 * t, z: D.tailZ + 0.55 * t, chord: mix(D.tailChord, D.tailChord * 0.62, t) };
  }
  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null) {
    const geometry = grid(10, 20, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * Math.PI * 2;
      const c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2), thickness = sec.chord * 0.06 * Math.sin(angle);
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
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  for (const side of [-1, 1]) {
    const wing = t => wingSection(t, side), tail = t => tailSection(t, side);
    surface(wing, 0, 0.94, 0, 0.7, materials.paint, side);
    // Long-span slotted flaps cover most of the trailing edge, a hallmark of the short-field wing.
    surface(wing, 0.03, 0.66, 0.7, 1, materials.paint, side, false, 'flaps');
    surface(wing, 0.66, 0.94, 0.7, 1, materials.accent, side, false, 'ailerons');
    surface(wing, 0.94, 1, 0, 1, materials.accent, side);
    surface(tail, 0, 1, 0, 0.62, materials.paint, side);
    surface(tail, 0, 1, 0.62, 1, materials.accent, side, false, 'elevators');
    // A single faired lift strut from the cabin floor to mid-span.
    rod([side * 0.78, -0.42, -1.25], [side * 4.4, D.wingY + 0.06, -1.3], 0.065, materials.paint);
    rod([side * 4.4, D.wingY - 0.04, -1.3], [side * 4.4, D.wingY + 0.12, -1.3], 0.05, materials.dark);
    lights.push(ellipsoid(side * D.span / 2, D.wingY + D.dihedral, D.wingZ + 0.4, 0.07, 0.07, 0.1,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));
  }
  const fin = t => ({ x: 0, y: 0.82 + D.fin * t, z: 4.25 + 1.25 * t, chord: mix(1.95, 1.05, t) });
  surface(fin, 0, 1, 0, 0.66, materials.accent, 1, true);
  surface(fin, 0, 1, 0.66, 1, materials.stripe, 1, true, 'rudder');
  surface(t => ({ x: 0, y: 0.78 + 0.62 * t, z: 3.1 + 1.2 * t, chord: mix(1.6, 0.4, t) }), 0, 1, 0, 1, materials.accent, 1, true); // dorsal fillet
  lights.push(ellipsoid(0, 0.82 + D.fin + 0.06, 5.6, 0.06, 0.06, 0.09, new THREE.MeshBasicMaterial({ color: 'hsl(0, 85%, 55%)' })));

  // Five-blade propeller with a pointed spinner.
  const rotor = new THREE.Group(); rotor.name = 'propeller'; rotor.position.set(0, -0.04, D.propZ); group.add(rotor); rotors.push(rotor);
  for (let i = 0; i < D.blades; i++) {
    const a = i * 2 * Math.PI / D.blades, r = D.propRadius;
    const blade = part(new THREE.BoxGeometry(r * 0.15, r * 0.84, 0.05), materials.dark, rotor);
    blade.position.set(-Math.sin(a) * r * 0.5, Math.cos(a) * r * 0.5, 0); blade.rotation.set(0, 0.28, a);
    const tip = part(new THREE.BoxGeometry(r * 0.13, r * 0.1, 0.055), materials.tips, rotor);
    tip.position.set(-Math.sin(a) * r * 0.95, Math.cos(a) * r * 0.95, 0); tip.rotation.z = a;
  }
  const spinner = part(new THREE.ConeGeometry(0.24, 0.62, 20), materials.metal, rotor);
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.2;

  // Fixed tricycle gear: wide spring-steel mains with fairings and a strutted nose leg.
  const tyreDatum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.75, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.78, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = 'fixed main gear'; pivot.position.set(side * 0.62, -0.7, D.gearZ); group.add(pivot); gears.push({ pivot, side });
    const x = side * (D.gearX - 0.62), y = tyreDatum + D.wheel - pivot.position.y;
    rod([0, 0, 0], [x - side * 0.18, y + 0.08, 0], 0.085, materials.accent, pivot, 0.06);
    wheel(x, y, 0, D.wheel, pivot);
    ellipsoid(x - side * 0.04, y + 0.2, -0.05, 0.12, 0.18, 0.42, materials.accent, pivot);
  }
  const nose = new THREE.Group(); nose.name = 'fixed nose gear'; nose.position.set(0, -0.62, D.noseZ); group.add(nose); gears.push({ pivot: nose, side: 0 });
  const noseRadius = 0.3, noseY = tyreDatum + noseRadius - nose.position.y;
  rod([0, 0, 0], [0, noseY + 0.2, 0.05], 0.07, materials.metal, nose);
  rod([0, noseY + 0.2, 0.05], [0, noseY, 0.18], 0.05, materials.metal, nose);
  wheel(0, noseY, 0.18, noseRadius, nose);

  // Batch only immutable root meshes. Propeller, gear and surfaces keep their own pivots.
  const batches = new Map(); group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) if (mesh.isMesh && !lights.includes(mesh)) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) { part(mergeGeometries(geometries), material); geometries.forEach(g => g.dispose()); }

  let flapAngle = 0, previous = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1);
      for (const r of rotors) r.rotation.z += dt * (9 + spool * 150);
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.45, -0.4, 0.4) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-delta('pitch') * 1.3, -0.4, 0.4) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        // Flaps run electrically: 15° per stage, about 2.4 s for full travel.
        flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.22, dt * 0.22);
      }
      for (const [name, list] of Object.entries(surfaces)) for (const s of list) {
        s.angle = name === 'flaps' ? flapAngle : name === 'ailerons' ? -deflection.ailerons * s.side : deflection[name];
        s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle);
      }
    },
    get gearPosition() { return 1; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([k, list]) => [k, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

/** Camera-local single-pilot deck: high-wing roof, split windscreen, glass PFD and a turbine engine strip. */
export function createUtilityCockpit() {
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
  // Narrow posts: door frames, a slim centre divider and the wing carry-through beam overhead.
  for (const side of [-1, 1]) {
    bar([side * 1.6, -0.9, -1.6], [side * 1.6, -0.75, -2.65], 0.05);
    bar([side * 1.6, -0.8, -1.8], [side * 1.3, 1.55, -2.25], 0.045);
  }
  bar([0.38, -0.38, -2.3], [0.3, 1.5, -2.3], 0.03);
  bar([-1.4, 1.5, -2.2], [1.4, 1.5, -2.2], 0.08, accent);
  const shell = part(new THREE.BoxGeometry(2.8, 0.54, 0.18), dark, panel); shell.position.set(0, -0.94, -1.9);
  const hood = part(new THREE.BoxGeometry(2.9, 0.06, 0.42), trim, panel); hood.position.set(0, -0.65, -1.97);
  // Pilot's yoke ahead of the left seat and a centre power quadrant with one lever.
  bar([-0.38, -1.42, -1.4], [-0.38, -1.05, -1.5], 0.035, trim);
  bar([-0.55, -0.98, -1.5], [-0.38, -1.08, -1.5], 0.025, trim); bar([-0.38, -1.08, -1.5], [-0.21, -0.98, -1.5], 0.025, trim);
  bar([0.62, -1.45, -1.45], [0.62, -1.2, -1.55], 0.02, trim);
  const knob = part(new THREE.BoxGeometry(0.09, 0.06, 0.06), accent); knob.position.set(0.62, -1.18, -1.56);
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.43, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 250;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(2.66, 0.48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0, -0.94, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)', line: 'hsl(205 15% 26%)' };
    const text = (label, x, y, size = 18, color = colors.ink, align = 'center') => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = align; ctx.fillText(label, x, y); };
    function gauge(y, label, value, max, shown, units) {
      text(label, 815, y, 15, colors.muted, 'left');
      ctx.fillStyle = colors.line; ctx.fillRect(880, y - 12, 170, 12);
      ctx.fillStyle = colors.signal; ctx.fillRect(880, y - 12, 170 * clamp(value / max, 0, 1), 12);
      text(`${shown} ${units}`, 1180, y, 17, colors.ink, 'right');
    }
    let last = -1;
    root.userData.update = state => {
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1200, 250);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 600, 24, 18, colors.muted);
      const knots = state.speed * 1.94384, altitude = state.position.y * 3.28084, spool = clamp(state.spool ?? 0, 0, 1);
      // Primary flight display: speed and altitude boxes either side of the attitude.
      ctx.save(); ctx.beginPath(); ctx.rect(150, 46, 400, 190); ctx.clip(); ctx.translate(350, 141); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 130);
      ctx.fillStyle = colors.sky; ctx.fillRect(-330, -340, 660, 340); ctx.fillStyle = colors.earth; ctx.fillRect(-330, 0, 660, 340);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-320, 0); ctx.lineTo(320, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(295, 141); ctx.lineTo(332, 141); ctx.lineTo(350, 150); ctx.lineTo(368, 141); ctx.lineTo(405, 141); ctx.stroke();
      for (const [x, label, value, units] of [[75, 'IAS', Math.round(knots), 'KT'], [625, 'ALT', Math.round(altitude), 'FT']]) {
        ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.strokeRect(x - 65, 95, 130, 92);
        text(label, x, 118, 14, colors.muted); text(String(value), x, 158, 30, colors.signal); text(units, x, 180, 12, colors.muted);
      }
      text(`HDG ${String(Math.round((state.heading ?? 0) * 180 / Math.PI) % 360).padStart(3, '0')}`, 75, 225, 16);
      text(`VS ${Math.round((state.verticalSpeed ?? 0) * 196.85)}`, 625, 225, 16);
      // Turbine engine strip: torque, inter-turbine temperature, gas generator and propeller speed.
      gauge(60, 'TRQ', spool, 1, Math.round(spool * 1800), 'FT-LB');
      gauge(95, 'ITT', 400 + spool * 340, 800, Math.round(400 + spool * 340), '°C');
      gauge(130, 'NG', 52 + spool * 49, 101, Math.round(52 + spool * 49), '%');
      gauge(165, 'PROP', spool, 1, Math.round(1500 + spool * 400), 'RPM');
      text(`FLAPS ${(state.flaps ?? 0) * 15}°`, 815, 215, 17, colors.ink, 'left'); text('GEAR FIXED', 1180, 215, 17, colors.muted, 'right');
      texture.needsUpdate = true;
    };
  }
  return root;
}

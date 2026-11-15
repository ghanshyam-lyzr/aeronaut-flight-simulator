import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pushpull as type } from './pushpull-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Cervin P6 dimensions in metres; the nose points down local -Z. Original design, no reference drawing.
const D = {
  wingY: 0.78, wingZ: -1.08, span: 11.6, rootChord: 1.62, tipChord: 1.1, dihedral: 0.08,
  boomX: 1.6, boomY: 0.68, boomFront: -1.45, boomEnd: 5.75,
  finZ: 4.72, finY: 0.72, finHeight: 1.3, finRoot: 1.05, finTip: 0.6,
  tailY: 1.3, tailZ: 4.92, tailChord: 0.84,
  frontPropZ: -3.84, rearPropZ: 3.3, propY: 0.06, propRadius: 0.95,
  noseGearZ: -3.0, mainGearX: 1.38, mainGearZ: 0.28, noseWheel: 0.22, mainWheel: 0.29,
};
// Pod stations: z, half width, half height, centre height.
const STATIONS = [
  [-3.78, 0.15, 0.15, 0.06], [-3.62, 0.34, 0.33, 0.04], [-3.1, 0.45, 0.45, 0.03], [-2.6, 0.52, 0.52, 0.05],
  [-2.0, 0.6, 0.62, 0.08], [-0.8, 0.62, 0.66, 0.07], [0.4, 0.58, 0.62, 0.06], [1.5, 0.46, 0.5, 0.06],
  [2.4, 0.37, 0.38, 0.07], [3.05, 0.2, 0.2, 0.06], [3.22, 0.09, 0.09, 0.06],
];
const ACCENT = 'hsl(12, 46%, 40%)', STRIPE = 'hsl(38, 45%, 70%)';

function section(z) {
  let i = 0;
  while (i < STATIONS.length - 2 && z > STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [mix(a[1], b[1], u), mix(a[2], b[2], u), mix(a[3], b[3], u)];
}

/** Original push-pull touring twin: glazed high-wing pod, tractor and pusher props on one centreline, twin booms and a high tailplane. */
export function createPushpull() {
  const group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.28, metalness: 0.12, clearcoat: 0.85, side: THREE.DoubleSide }),
    accent: standard(ACCENT), stripe: standard(STRIPE), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(205, 22%, 15%)', roughness: 0.06, metalness: 0.55, clearcoat: 1, side: THREE.DoubleSide }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, props = [], gears = [], lights = [];
  function part(geometry, material, parent = group, name = '') {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.SphereGeometry(1, 20, 12), material, parent);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function rod(a, b, radius, material = materials.metal, parent = group) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8), material, parent);
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
  // A patch of the pod skin between two stations and two angles (0 = right side, π/2 = top), lifted by `lift`.
  const skin = (z0, z1, a0, a1, material, lift = 0, rows = 16, cols = 8) => part(grid(rows, cols, (u, v) => {
    const z = mix(z0, z1, u), [rx, ry, cy] = section(z), a = mix(a0, a1, v);
    return [(rx + lift) * Math.cos(a), cy + (ry + lift) * Math.sin(a), z];
  }), material);

  // Short pod: terracotta front cowl, ivory cabin, terracotta rear engine cowl.
  skin(-3.78, -2.6, 0, Math.PI * 2, materials.accent, 0, 14, 28);
  skin(-2.6, 1.95, 0, Math.PI * 2, materials.paint, 0, 36, 28);
  skin(1.95, 3.22, 0, Math.PI * 2, materials.accent, 0, 14, 28);
  // Glazing: a wide windscreen, big side windows and a dark door outline on the left.
  skin(-2.56, -1.62, 0.28, Math.PI - 0.28, materials.glass, 0.012, 10, 14);
  for (const side of [-1, 1]) {
    const [a0, a1] = side > 0 ? [0.08, 0.86] : [Math.PI - 0.86, Math.PI - 0.08];
    skin(-1.56, -0.62, a0, a1, materials.glass, 0.012, 8, 6);
    skin(-0.5, 0.32, a0, a1, materials.glass, 0.012, 8, 6);
    // Sand pinstripe from cowl to cowl, just below the windows.
    const s = side > 0 ? -0.14 : Math.PI + 0.14;
    skin(-2.58, 1.93, s - 0.03, s + 0.03, materials.stripe, 0.014, 24, 1);
  }
  const door = (z0, z1, a0, a1) => skin(z0, z1, a0, a1, materials.dark, 0.02, 2, 2);
  door(-1.64, -1.6, Math.PI - 0.9, Math.PI + 0.62); door(-0.58, -0.54, Math.PI - 0.9, Math.PI + 0.62);
  door(-1.64, -0.54, Math.PI - 0.94, Math.PI - 0.88); door(-1.64, -0.54, Math.PI + 0.58, Math.PI + 0.64);
  // Front cowl intakes under the spinner, a rear-engine scoop on the pod spine and its exhausts.
  for (const side of [-1, 1]) ellipsoid(side * 0.17, -0.22, -3.66, 0.11, 0.06, 0.06, materials.dark);
  ellipsoid(0, 0.4, 1.55, 0.14, 0.09, 0.42, materials.dark);
  for (const side of [-1, 1]) rod([side * 0.32, -0.14, 2.5], [side * 0.36, -0.2, 2.75], 0.04, materials.dark);

  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null) {
    const geometry = grid(10, 24, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * Math.PI * 2;
      const c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2), thickness = sec.chord * (sec.thickness ?? 0.06) * Math.sin(angle);
      return vertical ? [sec.x + thickness, sec.y, sec.z + c * sec.chord] : [sec.x, sec.y + thickness, sec.z + c * sec.chord];
    }, vertical ? false : side < 0);
    if (!moving) return part(geometry, material);
    const start = sectionAt(from), end = sectionAt(to);
    const hinge = new THREE.Vector3(start.x, start.y, start.z + start.chord * chordFrom);
    const axis = new THREE.Vector3(end.x, end.y, end.z + end.chord * chordFrom).sub(hinge).normalize();
    // +X hinges on both sides: positive flap angles lower both trailing edges.
    if (!vertical && axis.x < 0) axis.negate();
    const pivot = new THREE.Group(); pivot.name = moving; pivot.position.copy(hinge); group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  // Straight high wing across the pod roof: slight taper on the leading edge, a straight trailing edge.
  const half = D.span / 2, boomT = D.boomX / half;
  const wing = side => t => ({ x: side * half * t, y: D.wingY + D.dihedral * t,
    z: D.wingZ + (D.rootChord - D.tipChord) * t, chord: mix(D.rootChord, D.tipChord, t), thickness: 0.065 });
  for (const side of [-1, 1]) {
    const w = wing(side);
    surface(w, 0, 0.985, 0, 0.74, materials.paint, side);
    surface(w, 0, 0.08, 0.74, 1, materials.paint, side);
    // Split flaps either side of the boom, so 30° of travel never cuts through it.
    surface(w, 0.08, boomT - 0.025, 0.74, 1, materials.paint, side, false, 'flaps');
    surface(w, boomT - 0.025, boomT + 0.025, 0.74, 1, materials.paint, side);
    surface(w, boomT + 0.025, 0.56, 0.74, 1, materials.paint, side, false, 'flaps');
    surface(w, 0.56, 0.94, 0.74, 1, materials.paint, side, false, 'ailerons');
    surface(w, 0.94, 0.985, 0.74, 1, materials.paint, side);
    // Terracotta tip caps and nav lights.
    const tip = w(0.985);
    ellipsoid(tip.x + side * 0.04, tip.y, tip.z + tip.chord * 0.42, 0.11, 0.07, tip.chord * 0.48, materials.accent);
    lights.push(ellipsoid(tip.x + side * 0.15, tip.y, tip.z + 0.12, 0.05, 0.05, 0.07,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));

    // Slender tail boom from a fairing ahead of the wing to the fin, tapering aft.
    const x = side * D.boomX;
    part(grid(32, 14, (u, v) => {
      const z = mix(D.boomFront, D.boomEnd, u), a = v * Math.PI * 2;
      const r = u < 0.06 ? 0.17 * Math.sqrt(Math.max(u / 0.06, 0.02)) : mix(0.17, 0.085, (u - 0.06) / 0.94) ** 1;
      const nose = u > 0.97 ? Math.sqrt(Math.max((1 - u) / 0.03, 0.02)) : 1;
      return [x + r * nose * Math.cos(a), D.boomY + 0.02 * u + r * nose * Math.sin(a), z];
    }), materials.paint);
    // Pinstripe along the boom side.
    part(grid(24, 1, (u, v) => {
      const z = mix(D.boomFront + 0.2, D.finZ, u), r = mix(0.165, 0.1, u) + 0.006, a = (side > 0 ? 0 : Math.PI) + (v - 0.5) * 0.18;
      return [x + r * Math.cos(a), D.boomY + 0.02 * (z - D.boomFront) / (D.boomEnd - D.boomFront) + r * Math.sin(a), z];
    }), materials.stripe);
    // Terracotta fin with its rudder, swept a little; a small ventral strake under the boom.
    const fin = t => ({ x, y: D.finY + D.finHeight * t, z: D.finZ + 0.38 * t, chord: mix(D.finRoot, D.finTip, t), thickness: 0.07 });
    surface(fin, 0, 1, 0, 0.62, materials.accent, side, true);
    surface(fin, 0.04, 0.96, 0.62, 1, materials.accent, side, true, 'rudder');
    surface(t => ({ x, y: D.boomY - 0.05 - 0.28 * t, z: D.finZ + 0.25 + 0.2 * t, chord: mix(0.7, 0.36, t), thickness: 0.07 }), 0, 1, 0, 1, materials.accent, side, true);
    ellipsoid(x, D.finY + D.finHeight, D.finZ + 0.38 + D.finTip * 0.45, 0.04, 0.03, D.finTip * 0.5, materials.stripe);
  }
  // High tailplane joining the fins, well above and aft of the pusher disc; one elevator spans it.
  const tail = t => ({ x: mix(-D.boomX, D.boomX, t), y: D.tailY, z: D.tailZ, chord: D.tailChord, thickness: 0.07 });
  surface(tail, 0, 1, 0, 0.64, materials.paint);
  surface(tail, 0.015, 0.985, 0.64, 1, materials.paint, 1, false, 'elevators');

  // Two propellers on one centreline: a tractor at the nose and a pusher behind the pod.
  function propeller(z, facing) {
    const prop = new THREE.Group(); prop.name = 'propeller'; prop.position.set(0, D.propY, z); group.add(prop); props.push(prop);
    const r = D.propRadius;
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI;
      const blade = part(new THREE.BoxGeometry(r * 0.15, r * 0.88, 0.05), materials.dark, prop);
      blade.position.set(-Math.sin(a) * r * 0.52, Math.cos(a) * r * 0.52, 0); blade.rotation.set(0, 0.26 * facing, a);
      const tipMark = part(new THREE.BoxGeometry(r * 0.15, r * 0.12, 0.055), materials.stripe, prop);
      tipMark.position.set(-Math.sin(a) * r * 0.93, Math.cos(a) * r * 0.93, 0); tipMark.rotation.z = a;
    }
    const spinner = part(new THREE.ConeGeometry(0.17, 0.4, 16), materials.accent, prop);
    spinner.rotation.x = facing * Math.PI / 2; spinner.position.z = facing * 0.16;
    return prop;
  }
  const frontProp = propeller(D.frontPropZ, -1), rearProp = propeller(D.rearPropZ, 1);

  // Fixed tricycle gear: nose leg under the front cowl, mains on short sponsons with spats.
  const tyreY = 0.925 - type.groundClearance;
  function wheel(x, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.62, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, tyreY + radius, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, radius * 0.66, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  const nose = new THREE.Group(); nose.name = 'fixed nose gear'; group.add(nose); gears.push(nose);
  rod([0, -0.36, D.noseGearZ + 0.08], [0, tyreY + D.noseWheel + 0.12, D.noseGearZ], 0.05, materials.metal, nose);
  for (const side of [-1, 1]) rod([side * 0.09, tyreY + D.noseWheel + 0.16, D.noseGearZ], [side * 0.09, tyreY + D.noseWheel, D.noseGearZ], 0.025, materials.metal, nose);
  wheel(0, D.noseGearZ, D.noseWheel, nose);
  const mains = new THREE.Group(); mains.name = 'fixed main gear'; group.add(mains); gears.push(mains);
  for (const side of [-1, 1]) {
    ellipsoid(side * 0.56, -0.5, D.mainGearZ - 0.1, 0.22, 0.12, 0.62, materials.paint, mains);
    rod([side * 0.62, -0.52, D.mainGearZ - 0.05], [side * D.mainGearX, tyreY + D.mainWheel + 0.08, D.mainGearZ], 0.055, materials.paint, mains);
    wheel(side * D.mainGearX, D.mainGearZ, D.mainWheel, mains);
    ellipsoid(side * D.mainGearX, tyreY + D.mainWheel + 0.06, D.mainGearZ, D.mainWheel * 0.66, D.mainWheel * 0.72, D.mainWheel * 1.8, materials.accent, mains);
  }

  // Batch immutable root meshes by material. Surfaces, propellers and gear keep their own groups.
  const batches = new Map(); group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) if (mesh.isMesh && !lights.includes(mesh)) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) { part(mergeGeometries(geometries), material); geometries.forEach(g => g.dispose()); }

  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  let flapAngle = 0, previous = null;
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1), turn = state.crashed ? 0 : dt * (8 + spool * 150);
      // One throttle, two engines: the props turn in opposite senses about the shared centreline.
      frontProp.rotation.z += turn; rearProp.rotation.z -= turn;
      for (const g of gears) g.visible = true;
      if ((state.flightTime ?? 1) < 0.05) flapAngle = (state.flaps ?? 0) * Math.PI / 12;
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.45, -0.4, 0.4) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-delta('pitch') * 1.3, -0.4, 0.4) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
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

// Instrument panels in camera-local metres, in the gaps the default HUD leaves (the same gaps as the transport deck):
// on desktops above the instrument strip between the camera chip and the map; on phones a strip between the map
// and the camera chip, above the touch controls.
export const COCKPIT = {
  wide: { width: 2.1, height: 0.44, x: 0, y: -0.43, pixels: [1260, 264] },
  compact: { width: 0.96, height: 0.27, x: -0.055, y: 0.16, pixels: [832, 234] },
  z: -1.835,
};

/** Left-seat view of the glazed cabin: wide windscreen, slim divider, wing-root header and a low twin-engine panel. */
export function createPushpullCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const paint = new THREE.MeshStandardMaterial({ color: 'hsl(48, 22%, 88%)', roughness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.4 });
  const blur = new THREE.MeshBasicMaterial({ color: 'hsl(205, 15%, 20%)', transparent: true, opacity: 0.04, depthWrite: false, side: THREE.DoubleSide });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat, parent);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return mesh;
  }
  // The pod centreline is 0.3 m right of the left seat. Narrow door posts, a slim centre divider leaning back to the header.
  bar([-1.45, -0.8, -1.6], [-1.2, 1.2, -2.05], 0.04);
  bar([2.05, -0.8, -1.7], [1.78, 1.2, -2.15], 0.04);
  bar([0.3, -0.7, -2.3], [0.3, 1.06, -1.8], 0.016, trim);
  // High-wing root seen as a narrow overhead band across the top of the windscreen, ivory lip below.
  const header = part(new THREE.BoxGeometry(6, 0.16, 0.5), dark); header.position.set(0.3, 1.16, -1.8);
  const lip = part(new THREE.BoxGeometry(6, 0.025, 0.06), paint); lip.position.set(0.3, 1.07, -1.58);
  // A low, flat terracotta cowl top well below the horizon, and the tractor's faint disc ahead of it.
  const cowl = part(new THREE.SphereGeometry(1, 18, 8), accent); cowl.position.set(0.3, -0.98, -3.9); cowl.scale.set(0.42, 0.05, 1.1);
  const disc = part(new THREE.CircleGeometry(0.95, 32), blur); disc.position.set(0.3, -0.95, -5.2);
  // Single power lever on the centre console and the left-seat yoke.
  bar([0.42, -1.45, -1.5], [0.42, -1.24, -1.62], 0.016, trim);
  const knob = part(new THREE.BoxGeometry(0.1, 0.045, 0.05), accent); knob.position.set(0.42, -1.22, -1.63);
  bar([-0.05, -1.5, -1.5], [-0.05, -1.24, -1.62], 0.03, trim);
  bar([-0.24, -1.16, -1.62], [0.14, -1.16, -1.62], 0.025, trim);
  // Two fixed-size panels instead of one squeezed one: a wide deck for desktops and a compact strip for phones.
  const panels = {};
  for (const [name, p] of Object.entries({ wide: COCKPIT.wide, compact: COCKPIT.compact })) {
    const group = new THREE.Group(); group.name = `${name} panel`; group.position.set(p.x, p.y, 0); root.add(group);
    const shell = part(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.06, 0.06), dark, group); shell.name = 'panel shell'; shell.position.z = COCKPIT.z - 0.04;
    const hood = part(new THREE.BoxGeometry(p.width + 0.06, 0.035, 0.22), trim, group); hood.position.set(0, p.height / 2 + 0.05, COCKPIT.z - 0.1);
    panels[name] = { group, ...p };
  }
  let layout = 'wide';
  // Phones raise the strip above the touch controls; the cowl and prop disc below it would float mid-view, so they hide.
  const setLayout = name => { layout = name; panels.wide.group.visible = cowl.visible = disc.visible = name === 'wide'; panels.compact.group.visible = name === 'compact'; };
  setLayout('wide');
  root.userData.panels = panels;
  root.userData.fit = aspect => setLayout(aspect < 0.8 ? 'compact' : 'wide');
  const animate = state => { blur.opacity = state.crashed ? 0 : 0.03 + 0.06 * clamp(state.spool ?? 0, 0, 1); };
  root.userData.update = animate;
  if (typeof document === 'undefined') return root;

  const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', line: 'hsl(205 15% 26%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)', warn: 'hsl(0 78% 52%)' };
  for (const p of Object.values(panels)) {
    p.canvas = document.createElement('canvas'); [p.canvas.width, p.canvas.height] = p.pixels;
    p.ctx = p.canvas.getContext('2d'); p.texture = new THREE.CanvasTexture(p.canvas); p.texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshBasicMaterial({ map: p.texture, toneMapped: false }), p.group);
    screen.name = 'panel screen'; screen.position.z = COCKPIT.z;
  }
  const draw = (ctx, size, text, x, y, color = colors.ink, align = 'left', weight = 500, family = 'DM Sans') => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px "${family}", sans-serif`; ctx.textAlign = align; ctx.fillText(text, x, y);
  };
  // Flap stages 0/15/30: the selected one fills with the signal colour.
  function flapBoxes(ctx, x, y, w, h, gap, selected, size) {
    [0, 15, 30].forEach((deg, i) => {
      const bx = x + i * (w + gap), on = selected === i;
      ctx.strokeStyle = on ? colors.signal : colors.line; ctx.lineWidth = 2; ctx.strokeRect(bx, y, w, h);
      if (on) { ctx.fillStyle = colors.signal; ctx.fillRect(bx + 2, y + 2, w - 4, h - 4); }
      draw(ctx, size, `${deg}°`, bx + w / 2, y + h / 2 + size * 0.36, on ? colors.background : colors.muted, 'center', 500, 'Barlow Condensed');
    });
  }
  // Both engines read the one simulated spool: two bars, one lever, and the label says so.
  function engines(ctx, x, y, width, rpm, fill, scale) {
    draw(ctx, 24 * scale, 'FRONT / REAR · one lever', x, y, colors.muted, 'left', 400);
    ['FRONT', 'REAR'].forEach((name, i) => {
      const ry = y + (44 + i * 46) * scale, barX = x + 110 * scale, barW = width - 110 * scale - 110 * scale, h = 16 * scale;
      draw(ctx, 22 * scale, name, x, ry, colors.muted, 'left', 400);
      ctx.fillStyle = colors.line; ctx.fillRect(barX, ry - h, barW, h);
      ctx.fillStyle = colors.signal; ctx.fillRect(barX, ry - h, barW * fill, h);
      draw(ctx, 36 * scale, String(rpm), x + width, ry + 4 * scale, colors.ink, 'right', 500, 'Barlow Condensed');
    });
  }
  let last = '';
  root.userData.update = state => {
    animate(state);
    const knots = Math.round((state.speed ?? 0) * 1.94384), altitude = Math.round((state.position?.y ?? 0) * 3.28084 / 10) * 10;
    const fill = clamp(state.spool ?? 0, 0, 1), rpm = Math.round((600 + fill * 2100) / 10) * 10, flaps = state.flaps ?? 0;
    const values = [layout, knots, altitude, rpm, flaps, Math.round((state.bank ?? 0) * 60), Math.round((state.pitch ?? 0) * 60), !!state.stalled];
    if (values.join() === last) return; last = values.join();
    const p = panels[layout], ctx = p.ctx, [w, h] = p.pixels;
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, w, h);
    const badge = state.stalled ? 'STALL' : layout === 'compact' ? 'GEAR FIXED' : type.badge, badgeColor = state.stalled ? colors.warn : colors.ink;
    if (layout === 'compact') {
      // Phones: speed and altitude on top, the shared engine pair, then flaps and the fixed gear.
      draw(ctx, 26, 'IAS', 22, 40, colors.muted, 'left', 400); draw(ctx, 44, `${knots} kt`, 260, 44, colors.ink, 'right', 500, 'Barlow Condensed');
      draw(ctx, 26, 'ALT', 300, 40, colors.muted, 'left', 400); draw(ctx, 44, `${altitude} ft`, 560, 44, colors.ink, 'right', 500, 'Barlow Condensed');
      draw(ctx, 26, badge, w - 22, 40, badgeColor, 'right', 600);
      ctx.fillStyle = colors.line; ctx.fillRect(22, 62, w - 44, 2);
      engines(ctx, 22, 104, 520, rpm, fill, 1);
      draw(ctx, 24, 'FLAPS', 580, 104, colors.muted, 'left', 400);
      flapBoxes(ctx, 580, 128, 70, 64, 10, flaps, 32);
    } else {
      draw(ctx, 26, `${type.name.toUpperCase()}   /   ${type.registration}`, 24, 36, colors.muted);
      draw(ctx, 26, badge, w - 24, 36, badgeColor, 'right', 600);
      // Attitude: horizon behind a fixed chartreuse aircraft symbol.
      ctx.save(); ctx.beginPath(); ctx.rect(24, 52, 210, 200); ctx.clip(); ctx.translate(129, 152); ctx.rotate(-(state.bank ?? 0)); ctx.translate(0, (state.pitch ?? 0) * 150);
      ctx.fillStyle = colors.sky; ctx.fillRect(-300, -300, 600, 300); ctx.fillStyle = colors.earth; ctx.fillRect(-300, 0, 600, 300);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-290, 0); ctx.lineTo(290, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(79, 152); ctx.lineTo(111, 152); ctx.lineTo(129, 162); ctx.lineTo(147, 152); ctx.lineTo(179, 152); ctx.stroke();
      [['IAS / kt', knots], ['ALT / ft', altitude]].forEach(([label, shown], i) => {
        draw(ctx, 24, label, 262, 106 + i * 80, colors.muted, 'left', 400);
        draw(ctx, 48, String(shown), 490, 112 + i * 80, colors.ink, 'right', 500, 'Barlow Condensed');
      });
      ctx.fillStyle = colors.line; ctx.fillRect(516, 54, 2, 196); ctx.fillRect(946, 54, 2, 196);
      engines(ctx, 544, 92, 376, rpm, fill, 1);
      draw(ctx, 24, 'Both engines follow one throttle', 544, 240, colors.muted, 'left', 400);
      draw(ctx, 24, 'FLAPS', 974, 92, colors.muted, 'left', 400);
      flapBoxes(ctx, 974, 112, 80, 56, 12, flaps, 30);
      draw(ctx, 24, 'GEAR FIXED', 974, 220, colors.muted, 'left', 400);
    }
    p.texture.needsUpdate = true;
  };
  return root;
}

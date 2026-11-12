import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aircraftType } from './fleet.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Dimensions in metres. Each original airframe has its own wing, tail, engine and gear arrangement.
const designs = {
  trainer: { length: 8.4, radius: 0.66, height: 0.72, span: 11.4, wingY: 0.95, wingZ: -1.2, chord: 1.65, tip: 1.25, sweep: 0.1, dihedral: 0.2,
    tailSpan: 3.8, tailZ: 2.7, tailY: 0.25, fin: 1.8, accent: 'hsl(208, 56%, 35%)', stripe: 'hsl(77, 70%, 59%)', props: 1, blades: 2, propRadius: 1.05, wheel: 0.3, gearX: 1.15, gearZ: 0.3, noseZ: -2.75 },
  bush: { length: 8.8, radius: 0.7, height: 0.82, span: 12.8, wingY: 1.05, wingZ: -1.5, chord: 1.95, tip: 1.65, sweep: 0, dihedral: 0.15,
    tailSpan: 4.2, tailZ: 2.9, tailY: 0.25, fin: 1.9, accent: 'hsl(22, 78%, 47%)', stripe: 'hsl(44, 85%, 67%)', props: 1, blades: 3, propRadius: 1.2, wheel: 0.62, gearX: 1.35, gearZ: -1.1, tailwheel: true },
  commuter: { length: 23.4, radius: 1.14, height: 1.18, span: 25.8, wingY: 1.05, wingZ: -3.1, chord: 3.4, tip: 1.5, sweep: 0.8, dihedral: 0.6,
    tailSpan: 8, tailZ: 8, tailY: 4.6, fin: 5, accent: 'hsl(160, 38%, 29%)', stripe: 'hsl(42, 67%, 57%)', props: 2, blades: 6, propRadius: 1.85, engineX: 4.5, engineY: 0.4, engineZ: -4.3, wheel: 0.48, gearX: 2.65, gearZ: 1.4, noseZ: -8.1 },
  regional: { length: 31, radius: 1.42, height: 1.45, span: 25, wingY: -0.65, wingZ: -3.8, chord: 4.3, tip: 1.2, sweep: 4.5, dihedral: 0.8,
    tailSpan: 9.2, tailZ: 11.2, tailY: 5.6, fin: 6, accent: 'hsl(219, 36%, 31%)', stripe: 'hsl(10, 72%, 60%)', engines: 2, engineX: 2.45, engineY: 0.65, engineZ: 7.3, fanRadius: 0.7, engineLength: 3.1, winglet: 1.4, wheel: 0.42, gearX: 2.15, gearZ: 1, noseZ: -10.9 },
  widebody: { length: 57, radius: 2.85, height: 2.9, span: 60, wingY: -1.1, wingZ: -9, chord: 9.4, tip: 1.25, sweep: 13, dihedral: 2.6,
    tailSpan: 21, tailZ: 20.5, tailY: 1.45, fin: 11, accent: 'hsl(185, 47%, 25%)', stripe: 'hsl(34, 66%, 58%)', engines: 2, engineX: 9, engineY: -1.8, engineZ: -9.8, fanRadius: 1.8, engineLength: 6, raked: true, wheel: 0.65, gearX: 4.5, gearZ: 3, noseZ: -20.6, bogies: true },
  aerobatic: { length: 7.3, radius: 0.56, height: 0.61, span: 8.2, wingY: -0.4, wingZ: -1.1, chord: 1.9, tip: 0.65, sweep: 0.45, dihedral: 0.05,
    tailSpan: 3.3, tailZ: 2.35, tailY: 0.2, fin: 1.55, accent: 'hsl(2, 72%, 49%)', stripe: 'hsl(48, 80%, 65%)', props: 1, blades: 3, propRadius: 1, wheel: 0.28, gearX: 1.05, gearZ: -0.65, tailwheel: true },
};
export const EXPANDED_AIRCRAFT = Object.keys(designs);

/** Reusable bounded lofts and lifting surfaces; no textures, assets or model downloads. */
export function createFleetAircraft(id) {
  const d = designs[id], type = aircraftType(id), group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.3, metalness: 0.12, clearcoat: 0.8, side: THREE.DoubleSide }),
    accent: standard(d.accent), stripe: standard(d.stripe), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 37%, 19%)', roughness: 0.1, metalness: 0.5, clearcoat: 1 }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, gears = [], rotors = [], lights = [];
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
  const stations = [
    [-0.5, 0.025, 0.025, 0], [-0.47, 0.37, 0.36, -0.05], [-0.39, 0.85, 0.85, 0],
    [-0.28, 1, 1, 0], [0.2, 1, 1, 0], [0.34, 0.74, 0.76, 0.12], [0.49, 0.05, 0.1, 0.3], [0.5, 0.002, 0.002, 0.3],
  ];
  function section(t) {
    const z = t - 0.5; let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
    const a = stations[i], b = stations[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return [mix(a[1], b[1], u) * d.radius, mix(a[2], b[2], u) * d.height, mix(a[3], b[3], u) * d.height];
  }
  part(grid(70, 32, (t, v) => { const [rx, ry, cy] = section(t), angle = v * Math.PI * 2; return [rx * Math.cos(angle), cy + ry * Math.sin(angle), (t - 0.5) * d.length]; }), materials.paint);
  // Lower fuselage ribbons, cockpit glazing and individual passenger windows follow the hull.
  for (const side of [-1, 1]) {
    for (const [y, mat] of [[-0.12, materials.accent], [-0.25, materials.stripe]]) {
      part(grid(48, 2, (u, v) => { const t = mix(0.13, 0.87, u), [rx, ry, cy] = section(t), a = y + (v - 0.5) * 0.075; return [side * (rx + 0.012) * Math.cos(a), cy + ry * Math.sin(a), (t - 0.5) * d.length]; }, side < 0), mat);
    }
    const small = !!d.props && d.props === 1;
    const start = small ? 0.31 : 0.17, end = small ? 0.49 : 0.25;
    part(grid(8, 7, (u, v) => { const t = mix(start, end, u), [rx, ry, cy] = section(t), a = mix(0.22, 1.22, v); return [side * (rx + 0.025) * Math.cos(a), cy + (ry + 0.025) * Math.sin(a), (t - 0.5) * d.length]; }, side < 0), materials.glass);
    if (!small) for (let z = -d.length * 0.21; z < d.length * 0.27; z += id === 'widebody' ? 1.15 : 1.05) {
      ellipsoid(side * (d.radius + 0.015), d.height * 0.3, z, 0.025, 0.21, 0.14, materials.glass);
    }
    if (id === 'trainer' || id === 'bush') {
      rod([side * 0.62, -0.35, 0.3], [side * d.span * 0.3, d.wingY, -0.1], 0.045, materials.paint);
      rod([side * 0.65, 0.3, -1.65], [side * 0.61, d.wingY, -0.7], 0.035, materials.dark);
    }
  }
  if (id === 'aerobatic') ellipsoid(0, 0.68, -0.15, 0.5, 0.6, 1, materials.glass);

  function wingSection(t, side, tail = false) {
    const half = (tail ? d.tailSpan : d.span) / 2;
    return { x: side * mix(d.radius * (tail ? 0.2 : 0.65), half, t),
      y: (tail ? d.tailY : d.wingY) + (tail ? 0.05 : d.dihedral) * t,
      z: (tail ? d.tailZ : d.wingZ) + (tail ? 0.8 : d.sweep) * t,
      chord: tail ? mix(d.chord * 0.65, d.tip * 0.6, t) : mix(d.chord, d.tip, t) };
  }
  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null) {
    const geometry = grid(12, 24, (u, v) => {
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
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  for (const side of [-1, 1]) {
    const sectionAt = t => wingSection(t, side);
    surface(sectionAt, 0, 0.9, 0, 0.72, materials.paint, side);
    surface(sectionAt, 0, 0.56, 0.72, 1, materials.paint, side, false, type.noFlaps ? null : 'flaps');
    surface(sectionAt, 0.56, 1, 0.72, 1, materials.accent, side, false, 'ailerons');
    surface(sectionAt, 0.9, 1, 0, 0.72, materials.accent, side);
    const tail = t => wingSection(t, side, true);
    surface(tail, 0, 1, 0, 0.65, materials.accent, side);
    surface(tail, 0, 1, 0.65, 1, materials.paint, side, false, 'elevators');
    if (d.winglet) {
      const tip = wingSection(1, side);
      surface(t => ({ x: tip.x + side * 0.15 * t, y: tip.y + d.winglet * t, z: tip.z + t * 0.5, chord: mix(d.tip, 0.5, t) }), 0, 1, 0, 1, materials.accent, side, true);
    }
    if (d.raked) {
      const tip = wingSection(1, side);
      surface(t => ({ x: tip.x + side * 1.6 * t, y: tip.y + 0.22 * t, z: tip.z + t * 1.4, chord: mix(d.tip, 0.08, t) }), 0, 1, 0, 1, materials.accent, side);
    }
    const nav = ellipsoid(side * d.span / 2, d.wingY + d.dihedral, d.wingZ + d.sweep + d.tip * 0.3, 0.075, 0.075, 0.1,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' }));
    lights.push(nav);
  }
  const fin = t => ({ x: 0, y: d.height * 0.35 + d.fin * t, z: d.tailZ - d.chord * 0.38 + d.chord * 0.45 * t, chord: mix(d.chord * 0.95, d.tip * 0.7, t) });
  surface(fin, 0, 1, 0, 0.7, materials.accent, 1, true);
  surface(fin, 0, 1, 0.7, 1, materials.stripe, 1, true, 'rudder');

  function propeller(x, y, z, radius, blades) {
    const rotor = new THREE.Group(); rotor.name = 'propeller'; rotor.position.set(x, y, z); group.add(rotor); rotors.push(rotor);
    for (let i = 0; i < blades; i++) {
      const blade = part(new THREE.BoxGeometry(radius * 0.16, radius * 0.92, 0.055), materials.dark, rotor);
      blade.position.set(-Math.sin(i * 2 * Math.PI / blades) * radius * 0.52, Math.cos(i * 2 * Math.PI / blades) * radius * 0.52, 0);
      blade.rotation.set(0, 0.24, i * 2 * Math.PI / blades);
      const tip = part(new THREE.BoxGeometry(radius * 0.16, radius * 0.12, 0.06), materials.stripe, rotor);
      tip.position.set(-Math.sin(i * 2 * Math.PI / blades) * radius * 0.92, Math.cos(i * 2 * Math.PI / blades) * radius * 0.92, 0); tip.rotation.z = i * 2 * Math.PI / blades;
    }
    ellipsoid(0, 0, -0.12, radius * 0.18, radius * 0.18, radius * 0.26, materials.accent, rotor);
  }
  if (d.props === 1) {
    ellipsoid(0, 0, -d.length * 0.36, d.radius * 0.85, d.height * 0.75, d.length * 0.14, materials.accent);
    propeller(0, 0, -d.length / 2 - 0.05, d.propRadius, d.blades);
    for (const side of [-1, 1]) rod([side * d.radius * 0.7, -0.4, -2.5], [side * d.radius * 0.8, -0.55, -2.15], 0.07, materials.dark);
  }
  if (d.props === 2) for (const side of [-1, 1]) {
    ellipsoid(side * d.engineX, d.engineY, d.engineZ + 1.5, 0.62, 0.68, 2.1, materials.paint);
    propeller(side * d.engineX, d.engineY, d.engineZ - 0.7, d.propRadius, d.blades);
  }
  if (d.engines) for (const side of [-1, 1]) {
    const { engineX: x, engineY: y, engineZ: z, fanRadius: r, engineLength: length } = d;
    rod([side * (id === 'regional' ? d.radius : x), id === 'regional' ? y : d.wingY, z + length * 0.45], [side * x, y, z + length * 0.35], r * 0.25, materials.paint);
    // Open-ended nacelle skin and inlet tunnel leave the animated fan visible.
    part(grid(24, 32, (t, v) => { const angle = v * Math.PI * 2, radius = r * (1.06 - 0.26 * t + 0.12 * Math.sin(t * Math.PI)); return [side * x + radius * Math.cos(angle), y + radius * Math.sin(angle), z + t * length]; }), materials.paint);
    const lip = part(new THREE.TorusGeometry(r, r * 0.065, 8, 32), materials.metal); lip.position.set(side * x, y, z);
    const inlet = part(new THREE.CircleGeometry(r, 32), materials.dark); inlet.rotation.y = Math.PI; inlet.position.set(side * x, y, z + r * 0.45);
    const fan = new THREE.Group(); fan.name = 'turbofan fan'; fan.position.set(side * x, y, z + r * 0.23); group.add(fan); rotors.push(fan);
    for (let i = 0; i < 18; i++) {
      const blade = part(new THREE.BoxGeometry(r * 0.13, r * 0.72, r * 0.035), materials.metal, fan);
      blade.position.set(-Math.sin(i * Math.PI / 9) * r * 0.55, Math.cos(i * Math.PI / 9) * r * 0.55, 0); blade.rotation.set(0, 0.4, i * Math.PI / 9);
    }
    ellipsoid(0, 0, -r * 0.1, r * 0.18, r * 0.18, r * 0.3, materials.dark, fan);
    const exhaust = part(new THREE.CylinderGeometry(r * 0.58, r * 0.68, r * 0.15, 24, 1, true), materials.dark);
    exhaust.rotation.x = Math.PI / 2; exhaust.position.set(side * x, y, z + length);
  }

  const tyreDatum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.7, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.73, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * d.gearX * 0.55, -d.height * 0.5, d.gearZ); group.add(pivot);
    pivot.name = type.fixedGear ? 'fixed main gear' : 'retractable main gear'; gears.push({ pivot, side });
    const x = side * d.gearX * 0.45, y = tyreDatum + d.wheel - pivot.position.y;
    rod([0, 0, 0], [x, y, 0], d.wheel * 0.16, materials.metal, pivot);
    if (d.bogies) {
      rod([x, y, -0.95], [x, y, 0.95], 0.15, materials.dark, pivot);
      for (const zz of [-0.9, 0.9]) for (const xx of [-0.47, 0.47]) wheel(x + xx, y, zz, d.wheel, pivot);
    } else wheel(x, y, 0, d.wheel, pivot);
    if (id === 'trainer' || id === 'aerobatic') ellipsoid(x, y + 0.05, 0, d.wheel * 0.75, d.wheel * 0.65, d.wheel * 1.8, materials.accent, pivot);
  }
  const nose = new THREE.Group(); group.add(nose); nose.position.set(0, -d.height * 0.5, d.tailwheel ? d.length * 0.4 : d.noseZ); gears.push({ pivot: nose, side: 0 });
  nose.name = d.tailwheel ? 'fixed tailwheel' : 'nose gear';
  const noseRadius = d.tailwheel ? 0.15 : d.wheel * 0.7, noseY = tyreDatum + noseRadius - nose.position.y;
  rod([0, 0, 0], [0, noseY, 0], d.tailwheel ? 0.045 : d.wheel * 0.12, materials.metal, nose);
  wheel(0, noseY, 0, noseRadius, nose);

  // Batch only immutable root meshes. Moving fans, gear and surfaces retain their own pivots.
  const batches = new Map(); group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) if (mesh.isMesh && !lights.includes(mesh)) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    part(mergeGeometries(geometries), material); geometries.forEach(g => g.dispose());
  }
  let gearPosition = type.fixedGear ? 1 : 0, flapAngle = 0, previous = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1);
      rotors.forEach((rotor, i) => { rotor.rotation.z += dt * (d.props ? 8 + spool * 155 : 12 + spool * 95) * (i % 2 ? -1 : 1); });
      const target = type.fixedGear || state.gearDown ? 1 : 0;
      if (type.fixedGear || state.grounded || (state.flightTime ?? 1) < 0.05) gearPosition = target;
      else gearPosition += clamp(target - gearPosition, -dt / 4, dt / 4);
      for (const { pivot, side } of gears) { pivot.visible = gearPosition > 0.001; pivot.rotation.z = type.fixedGear ? 0 : side * (1 - gearPosition) * 1.45; pivot.rotation.x = !side && !type.fixedGear ? (1 - gearPosition) * 1.5 : 0; }
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const rates = state.bodyRates, active = state.grounded || state.crashed ? 0 : 1;
        const smooth = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp((type.flight.aerobatic ? rates?.roll ?? 0 : delta('bank')) * 0.45, -0.4, 0.4) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-(type.flight.aerobatic ? rates?.pitch ?? 0 : delta('pitch')) * 1.3, -0.4, 0.4) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((type.flight.aerobatic ? rates?.yaw ?? 0 : delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.22, dt * 0.22);
      }
      for (const [name, list] of Object.entries(surfaces)) for (const s of list) {
        s.angle = name === 'flaps' ? flapAngle : name === 'ailerons' ? -deflection.ailerons * s.side : deflection[name];
        s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle);
      }
    },
    get gearPosition() { return gearPosition; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([k, list]) => [k, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

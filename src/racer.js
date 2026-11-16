import { createAircraftPaint } from './aircraft-paint.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { racer as type } from './racer-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Dimensions in metres; the nose points down local -Z. Ivory airframe, ultramarine accent, saffron pinstripe.
const D = {
  span: 8.6, rootX: 0.4, wingY: -0.36, dihedral: 0.28, rootChord: 2, quarterZ: -1.1,
  tailSpan: 3, finHeight: 1.35, propRadius: 1, blades: 4, hubY: 0.04, hubZ: -4.08,
  wheel: 0.3, mainX: 1.25, mainY: -0.38, mainZ: -1.3, tailWheel: 0.14, tailZ: 3.35, tailY: -0.4,
  accent: 'hsl(230, 64%, 40%)', stripe: 'hsl(46, 86%, 58%)',
};
// Fuselage stations: z, half width, half height, centre height, superellipse exponent (2 is round).
// A long, slim inline-engine nose ahead of the wing, a constant cockpit section and a fine tailcone.
const STATIONS = [
  [-4, 0.34, 0.36, 0.05, 2], [-3.4, 0.46, 0.5, 0.03, 2.1], [-2, 0.52, 0.6, 0, 2.2], [-0.6, 0.55, 0.62, 0, 2.2],
  [0.4, 0.52, 0.58, 0, 2.15], [2, 0.38, 0.42, 0.06, 2.05], [3.4, 0.2, 0.24, 0.15, 2], [4.2, 0.05, 0.08, 0.22, 2],
];
export const RACER_FUSELAGE = STATIONS.at(-1)[0] - STATIONS[0][0];

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
/** Near-elliptical planform with a straight quarter-chord line; t runs root (0) to tip (1). */
const wingChord = t => D.rootChord * Math.sqrt(1 - 0.8 * t * t);
function wingSection(t, side) {
  const chord = wingChord(t);
  return { x: side * mix(D.rootX, D.span / 2, t), y: D.wingY + D.dihedral * t, z: D.quarterZ - 0.3 * chord, chord };
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

/** Original procedural Rava R6 racer; no textures, assets or model downloads. */
export function createRacer() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.28, metalness: 0.12, clearcoat: 0.85, side: THREE.DoubleSide }),
    accent: new THREE.MeshPhysicalMaterial({ color: D.accent, roughness: 0.3, metalness: 0.15, clearcoat: 0.85, side: THREE.DoubleSide }),
    stripe: standard(D.stripe, 0.4), graphite: standard('hsl(210, 8%, 16%)', 0.75, 0.15),
    rubber: standard('hsl(210, 15%, 9%)', 0.88), metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85),
    exhaust: standard('hsl(24, 14%, 24%)', 0.55, 0.7), dark: standard('hsl(205, 20%, 12%)', 0.55, 0.4),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(214, 30%, 13%)', roughness: 0.06, metalness: 0.55, clearcoat: 1, side: THREE.DoubleSide }),
  };
  const propTips = materials.stripe.clone(); // Preserve blade safety markings when exterior paint changes.
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
  function rod(a, b, radius, material = materials.metal, parent = group) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 10), material, parent);
    m.position.copy(start).add(end).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return m;
  }
  const zFront = STATIONS[0][0], zBack = STATIONS.at(-1)[0];
  // Slim streamlined fuselage with the long inline nose.
  part(grid(72, 36, (t, v) => hull(mix(zFront, zBack, t), v * Math.PI * 2)), materials.paint);
  const patch = (z0, z1, a0, a1, material, lift = 0.01, rows = 8, cols = 6) => part(grid(rows, cols, (u, v) => hull(mix(z0, z1, u), mix(a0, a1, v), lift)), material);
  const ring = (z0, z1, material, lift) => patch(z0, z1, 0, Math.PI * 2, material, lift, 3, 36);
  // Ultramarine cowl, saffron pinstripe at its edge, and a graphite anti-glare panel ahead of the canopy.
  patch(zFront, -2.35, 0, Math.PI * 2, materials.accent, 0.008, 18, 36);
  ring(-2.36, -2.3, materials.stripe, 0.012);
  patch(-3.92, -1.02, Math.PI / 2 - 0.36, Math.PI / 2 + 0.36, materials.graphite, 0.018, 26, 4);
  // Racing band around the rear fuselage between two saffron pinstripes.
  ring(1.3, 1.75, materials.accent, 0.008); ring(1.2, 1.25, materials.stripe, 0.01); ring(1.8, 1.85, materials.stripe, 0.01);
  for (const side of [-1, 1]) {
    const at = angle => side > 0 ? angle : Math.PI - angle;
    // A thin saffron pinstripe along each side from the cowl to the tail.
    patch(-2.3, 3.7, at(-0.06), at(-0.03), materials.stripe, 0.011, 48, 1);
    // Six short exhaust stubs in a row high on each side of the cowl.
    for (let i = 0; i < 6; i++) {
      const z = -3.55 + i * 0.21, [x, y] = hull(z, at(0.4), 0.02);
      const stub = box(x, y, z, 0.13, 0.07, 0.1, materials.exhaust); stub.rotation.z = side * 0.4;
    }
  }
  // Chin radiator scoop: an accent duct under the cowl with a dark open mouth, faired back into the belly.
  const duct = part(new THREE.CylinderGeometry(0.17, 0.21, 0.9, 18, 1, true), materials.accent);
  duct.rotation.x = Math.PI / 2; duct.position.set(0, -0.5, -3.3); duct.scale.set(1.3, 1, 1);
  const mouth = part(new THREE.CircleGeometry(0.17, 18), materials.dark); mouth.rotation.y = Math.PI; mouth.position.set(0, -0.5, -3.05); mouth.scale.set(1.3, 1, 1);
  ellipsoid(0, -0.48, -2.55, 0.27, 0.22, 0.75, materials.accent);
  // Teardrop bubble canopy set well aft of the nose, with a faired spine running back to the fin.
  part(grid(22, 16, (u, v) => {
    const z = mix(-1.05, 0.85, u), r = 0.47 * Math.sin(Math.PI * Math.min(1, u ** 0.62)) + 0.005, a = v * Math.PI;
    return [Math.cos(a) * r * 0.86, 0.5 + Math.sin(a) * r, z];
  }), materials.glass);
  ring(-1.12, -1.04, materials.graphite, 0.02);
  ellipsoid(0, 0.4, 1.75, 0.2, 0.28, 1.35, materials.paint);
  // Wing-root fillet under the low wing.
  ellipsoid(0, -0.42, -0.65, 0.58, 0.26, 1.55, materials.paint);

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
    const pivot = new THREE.Group(); pivot.name = moving; pivot.position.copy(hinge); group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  for (const side of [-1, 1]) {
    const wing = t => wingSection(t, side);
    surface(wing, 0, 0.9, 0, 0.76, materials.paint, side);
    // Plain flaps inboard, ailerons outboard, ultramarine wingtips.
    surface(wing, 0.02, 0.5, 0.76, 1, materials.paint, side, false, 'flaps');
    surface(wing, 0, 0.02, 0.76, 1, materials.paint, side);
    surface(wing, 0.5, 0.52, 0.76, 1, materials.paint, side);
    surface(wing, 0.52, 0.9, 0.76, 1, materials.paint, side, false, 'ailerons');
    surface(wing, 0.9, 1, 0, 1, materials.accent, side);
    const tail = t => ({ x: side * mix(0.1, D.tailSpan / 2, t), y: 0.2 + 0.03 * t, z: 3.15 + 0.4 * t, chord: mix(0.95, 0.42, t) });
    surface(tail, 0, 1, 0, 0.64, materials.paint, side);
    surface(tail, 0, 1, 0.64, 1, materials.paint, side, false, 'elevators');
    const tip = wingSection(1, side);
    lights.push(ellipsoid(tip.x, tip.y, tip.z + tip.chord * 0.35, 0.06, 0.06, 0.1,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));
  }
  // Tall pointed fin and rudder in the accent; a small keel under the tail houses the tailwheel.
  const fin = t => ({ x: 0, y: 0.22 + D.finHeight * t, z: 2.75 + 1.0 * t, chord: mix(1.45, 0.2, t) });
  surface(fin, 0, 1, 0, 0.66, materials.accent, 1, true);
  surface(fin, 0.04, 0.92, 0.66, 1, materials.accent, 1, true, 'rudder');
  surface(t => ({ x: 0, y: -0.05 - 0.38 * t, z: 2.5 + 0.35 * t, chord: mix(1.55, 0.95, t) }), 0, 1, 0, 1, materials.paint, 1, true);
  lights.push(ellipsoid(0, 0.22, zBack + 0.02, 0.05, 0.05, 0.07, new THREE.MeshBasicMaterial({ color: 'hsl(48, 100%, 92%)' })));

  // One four-blade propeller with saffron tips and a pointed ultramarine spinner.
  const rotor = new THREE.Group(); rotor.name = 'propeller'; rotor.position.set(0, D.hubY, D.hubZ); group.add(rotor); rotors.push(rotor);
  for (let i = 0; i < D.blades; i++) {
    const a = i * 2 * Math.PI / D.blades, r = D.propRadius;
    const blade = part(new THREE.BoxGeometry(r * 0.15, r * 0.82, 0.05), materials.graphite, rotor);
    blade.position.set(-Math.sin(a) * r * 0.49, Math.cos(a) * r * 0.49, 0); blade.rotation.set(0, 0.3, a);
    const bladeTip = part(new THREE.BoxGeometry(r * 0.13, r * 0.1, 0.055), propTips, rotor);
    bladeTip.position.set(-Math.sin(a) * r * 0.95, Math.cos(a) * r * 0.95, 0); bladeTip.rotation.set(0, 0.3, a);
  }
  const spinner = part(new THREE.ConeGeometry(0.3, 0.62, 20), materials.accent, rotor);
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.25;

  // Retractable tailwheel gear: mains fold inward into the wing roots, the tailwheel folds aft into the keel.
  const tyreDatum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.62, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.66, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = 'retractable main gear'; pivot.position.set(side * D.mainX, D.mainY, D.mainZ); group.add(pivot);
    const length = D.mainY - (tyreDatum + D.wheel), x = side * 0.04;
    rod([0, 0, 0], [x, -length, 0], 0.05, materials.metal, pivot);
    rod([-side * 0.42, 0.02, 0], [x * 0.5, -length * 0.55, 0], 0.025, materials.metal, pivot);
    wheel(x + side * 0.12, -length, 0, D.wheel, pivot);
    box(-side * 0.06, -length * 0.45, 0, 0.03, length * 0.85, D.wheel * 1.5, materials.paint, pivot); // leg door
    gears.push({ pivot, axis: new THREE.Vector3(0, 0, 1), stowAngle: -side * 1.55 });
  }
  const tailPivot = new THREE.Group(); tailPivot.name = 'retractable tailwheel'; tailPivot.position.set(0, D.tailY, D.tailZ); group.add(tailPivot);
  const tailLength = D.tailY - (tyreDatum + D.tailWheel);
  rod([0, 0, 0], [0, -tailLength * 0.7, 0.08], 0.035, materials.metal, tailPivot);
  for (const x of [-0.07, 0.07]) rod([x, -tailLength * 0.7, 0.08], [x, -tailLength, 0.12], 0.018, materials.metal, tailPivot);
  wheel(0, -tailLength, 0.12, D.tailWheel, tailPivot);
  gears.push({ pivot: tailPivot, axis: new THREE.Vector3(1, 0, 0), stowAngle: -1.5 });

  // Batch only immutable root meshes. Propeller, gear and control surfaces keep their own pivots.
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
    group, materials, paint: createAircraftPaint({ body: [materials.paint], accent: [materials.accent], stripe: [materials.stripe] }),
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1);
      if (!state.crashed) for (const r of rotors) r.rotation.z += dt * (8 + spool * 155);
      // Gear travels in about three seconds; a fresh flight or the ground places it at once.
      const target = state.gearDown ? 1 : 0, fresh = (state.flightTime ?? 1) < 0.05;
      if (state.grounded || fresh) gearPosition = target;
      else gearPosition += clamp(target - gearPosition, -dt / 3, dt / 3);
      for (const { pivot, axis, stowAngle } of gears) {
        pivot.visible = gearPosition > 0.001;
        pivot.quaternion.setFromAxisAngle(axis, stowAngle * (1 - THREE.MathUtils.smoothstep(gearPosition, 0, 1)));
      }
      if (dt > 0) {
        if (!previous || fresh) previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const rates = state.bodyRates, free = type.flight.aerobatic, active = state.grounded || state.crashed ? 0 : 1;
        const smooth = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp((free ? rates?.roll ?? 0 : delta('bank')) * 0.45, -0.4, 0.4) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-(free ? rates?.pitch ?? 0 : delta('pitch')) * 1.3, -0.4, 0.4) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((free ? rates?.yaw ?? 0 : delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        // 15° per stage at about 0.22 rad/s; a fresh flight starts with the flaps where they are set.
        if (fresh) flapAngle = (state.flaps ?? 0) * Math.PI / 12;
        else flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.22, dt * 0.22);
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

// Panel layouts in camera space (metres). `wide` sits low on laptops, between the horizon and the instrument strip;
// `compact` is the phone strip between the map and the camera chip, shifted left of the map toggles (as the Sorna H8's).
export const RACER_COCKPIT = {
  wide: { width: 1.98, height: 0.37, x: 0, y: -0.675, z: -2.3, pixels: [1070, 200] },
  compact: { width: 0.94, height: 0.27, x: -0.06, y: 0.16, z: -1.835, pixels: [816, 234] },
};

/** Camera-local racer cockpit: the long nose ahead, an open bubble with one high bow frame, a compact low panel. */
export function createRacerCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const [eyeX, eyeY, eyeZ] = type.cockpitOffset;
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const glare = new THREE.MeshStandardMaterial({ color: 'hsl(210, 8%, 16%)', roughness: 0.85, side: THREE.DoubleSide });
  const accent = new THREE.MeshStandardMaterial({ color: D.accent, roughness: 0.4, side: THREE.DoubleSide });
  const knob = new THREE.MeshStandardMaterial({ color: D.stripe, roughness: 0.5 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.03, mat = dark, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat, parent);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return mesh;
  }
  const W = RACER_COCKPIT.wide, C = RACER_COCKPIT.compact;
  // The upper nose, from the airframe's own hull: the ultramarine cowl and the graphite anti-glare strip along its top.
  // It starts behind the wide panel's face, and its lower edge drops as it runs forward so the edge always stays
  // behind the panel; only the top of the nose shows above it, low in the view.
  const local = ([x, y, z]) => [x - eyeX, y - eyeY, z - eyeZ];
  const noseStart = eyeZ + W.z - 0.04, nose = new THREE.Group(); nose.name = 'nose'; root.add(nose);
  part(grid(16, 16, (u, v) => { const low = mix(0.5, -0.3, u); return local(hull(mix(noseStart, -3.98, u), mix(low, Math.PI - low, v), 0.008)); }), accent, nose);
  part(grid(16, 4, (u, v) => local(hull(mix(noseStart, -3.92, u), mix(Math.PI / 2 - 0.36, Math.PI / 2 + 0.36, v), 0.02))), glare, nose);
  // Open bubble: one thin bow frame high and wide, and low canopy sills; no forward posts.
  const bow = part(new THREE.TorusGeometry(1, 0.011, 6, 48, Math.PI), trim); bow.position.set(0, -0.42, -1.6); bow.scale.set(1.2, 1, 1);
  for (const side of [-1, 1]) bar([side * 1.24, -0.66, -1.25], [side * 1.3, -0.56, -2.4], 0.03);
  // Centre stick and a left-hand throttle lever with a saffron knob that follows the power setting.
  bar([0, -1.45, -1.3], [0, -1.02, -1.5], 0.035, trim);
  const grip = part(new THREE.BoxGeometry(0.08, 0.15, 0.08)); grip.position.set(0, -0.96, -1.52);
  const throttle = new THREE.Group(); throttle.position.set(-0.78, -1.15, -1.45); root.add(throttle);
  bar([0, 0, 0], [0, 0.3, 0], 0.018, trim, throttle);
  const throttleKnob = part(new THREE.SphereGeometry(0.045, 12, 8), knob, throttle); throttleKnob.position.y = 0.32;
  const quadrant = part(new THREE.BoxGeometry(0.08, 0.06, 0.34)); quadrant.position.set(-0.78, -1.16, -1.45);
  // Graphite panels: shell and a thin hood behind each screen.
  const panels = {};
  for (const [name, p] of Object.entries({ wide: W, compact: C })) {
    const group = new THREE.Group(); group.name = `${name} panel`; group.position.set(p.x, p.y, 0); root.add(group);
    const shell = part(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.04, 0.06), dark, group); shell.name = 'panel shell'; shell.position.z = p.z - 0.04;
    const hood = part(new THREE.BoxGeometry(p.width + 0.06, 0.025, 0.2), trim, group); hood.position.set(0, p.height / 2 + 0.035, p.z - 0.11);
    panels[name] = { group, ...p };
  }
  let layout = 'wide';
  const setLayout = name => {
    layout = name; panels.wide.group.visible = name === 'wide'; panels.compact.group.visible = name === 'compact';
    nose.visible = name === 'wide'; // the phone strip sits high, so the nose cue would land under the touch yoke
  };
  setLayout('wide');
  root.userData.panels = panels;
  root.userData.fit = aspect => { if ((aspect < 0.8 ? 'compact' : 'wide') !== layout) { setLayout(aspect < 0.8 ? 'compact' : 'wide'); last = ''; } };
  let last = '';
  const animate = state => { throttle.rotation.x = -0.55 + clamp(state.throttle ?? 0, 0, 1) * 1.1; };
  root.userData.update = animate;
  if (typeof document === 'undefined') return root;

  const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', line: 'hsl(205 15% 26%)', warn: 'hsl(0 78% 52%)' };
  for (const p of Object.values(panels)) {
    p.canvas = document.createElement('canvas'); [p.canvas.width, p.canvas.height] = p.pixels;
    p.ctx = p.canvas.getContext('2d'); p.texture = new THREE.CanvasTexture(p.canvas); p.texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshBasicMaterial({ map: p.texture, toneMapped: false }), p.group);
    screen.name = 'panel screen'; screen.position.z = p.z;
  }
  const draw = (ctx, size, text, x, y, color = colors.ink, align = 'left', family = 'DM Sans') => {
    ctx.fillStyle = color; ctx.font = `500 ${size}px "${family}", sans-serif`; ctx.textAlign = align; ctx.fillText(text, x, y);
  };
  function dial(ctx, x, y, r, title, value, max, units, readout) {
    ctx.fillStyle = colors.line; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, y, r - 6, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * (0.75 + i / 20 * 1.5), inner = r * (i % 5 ? 0.8 : 0.7); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner); ctx.lineTo(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88); ctx.stroke();
    }
    const a = Math.PI * (0.75 + clamp(value / max, 0, 1) * 1.5);
    ctx.strokeStyle = colors.signal; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72); ctx.stroke();
    ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    draw(ctx, 14, title, x, y - r * 0.36, colors.muted, 'center'); draw(ctx, 30, readout, x, y + r * 0.5, colors.ink, 'center', 'Barlow Condensed');
    draw(ctx, 12, units, x, y + r * 0.76, colors.muted, 'center');
  }
  function flapRow(ctx, x, y, w, h, flaps, size) {
    [0, 15, 30].forEach((deg, i) => {
      const bx = x + i * (w + 10), on = flaps === i;
      ctx.strokeStyle = on ? colors.signal : colors.line; ctx.lineWidth = 2; ctx.strokeRect(bx, y, w, h);
      if (on) { ctx.fillStyle = colors.signal; ctx.fillRect(bx + 2, y + 2, w - 4, h - 4); }
      draw(ctx, size, `${deg}°`, bx + w / 2, y + h * 0.72, on ? colors.background : colors.muted, 'center', 'Barlow Condensed');
    });
  }
  function drawWide(v) {
    const { ctx } = panels.wide, [w, h] = W.pixels;
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, w, h);
    dial(ctx, 110, 100, 90, 'AIRSPEED', v.knots, type.speedScale, 'KT', String(v.knots));
    dial(ctx, 320, 100, 90, 'ALTITUDE', v.feet % 10000, 10000, 'FT', String(v.feet));
    dial(ctx, 530, 100, 90, 'RPM', v.rpm, 3600, `MAP ${v.map} IN`, String(v.rpm));
    ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(660, 22); ctx.lineTo(660, 178); ctx.stroke();
    draw(ctx, 16, 'Gear', 690, 52, colors.muted);
    draw(ctx, 34, v.gear ? 'GEAR DOWN' : 'GEAR UP', 1040, 56, v.gear ? colors.signal : colors.ink, 'right', 'Barlow Condensed');
    draw(ctx, 16, 'Flaps', 690, 106, colors.muted);
    flapRow(ctx, 690, 118, 106, 40, v.flaps, 26);
    draw(ctx, 13, v.stalled ? 'STALL' : `${type.name} · ${type.registration}`, 1040, 190, v.stalled ? colors.warn : colors.muted, 'right');
  }
  function drawCompact(v) {
    const { ctx } = panels.compact, [w, h] = C.pixels;
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, w, h);
    // Three readouts across the top row, gear and flaps beneath; 30 px labels read at about 11 px on a phone.
    [['IAS', v.knots, 'KT'], ['ALT', v.feet, 'FT'], ['RPM', v.rpm, '']].forEach(([label, value, units], i) => {
      const x = 24 + i * 270;
      draw(ctx, 30, label, x, 48, colors.muted);
      draw(ctx, 62, String(value), x, 108, colors.signal, 'left', 'Barlow Condensed');
      if (units) draw(ctx, 26, units, x + 230, 108, colors.muted, 'right');
    });
    ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(24, 130); ctx.lineTo(w - 24, 130); ctx.stroke();
    draw(ctx, 50, v.gear ? 'GEAR DOWN' : 'GEAR UP', 24, 200, v.gear ? colors.signal : colors.ink, 'left', 'Barlow Condensed');
    draw(ctx, 30, 'Flaps', 330, 196, colors.muted);
    flapRow(ctx, 430, 152, 116, 62, v.flaps, 40);
  }
  root.userData.update = state => {
    animate(state);
    const spool = clamp(state.spool ?? 0, 0, 1), v = {
      knots: Math.round((state.speed ?? 0) * 1.94384), feet: Math.round((state.position?.y ?? 0) * 3.28084 / 10) * 10,
      rpm: Math.round((1100 + spool * 2100) / 10) * 10, map: (12 + spool * 50).toFixed(0),
      flaps: state.flaps ?? 0, gear: !!state.gearDown, stalled: !!state.stalled,
    };
    const key = `${layout}|${v.knots}|${v.feet}|${v.rpm}|${v.flaps}|${v.gear}|${v.stalled}`; if (key === last) return; last = key;
    if (layout === 'wide') drawWide(v); else drawCompact(v);
    panels[layout].texture.needsUpdate = true;
  };
  return root;
}

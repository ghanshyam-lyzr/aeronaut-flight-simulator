import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cargo as type } from './cargo-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;

// Montis C90, modelled in metres; the nose points down local -Z. Original geometry, not a real type.
export const CARGO_DESIGN = Object.freeze({
  length: 30, span: 40.4, wingY: 2.35, rootChord: 4.9, tipChord: 2.5, rootLE: -3.4, tipLE: -2.3,
  // Inner and outer nacelles; the propeller discs clear the cabin and each other.
  engineX: [5.7, 11.2], engineY: 1.65, propRadius: 2.05, blades: 4,
  mainWheel: 0.62, noseWheel: 0.45, mainX: 2.05, mainZ: 0.5, tandem: 0.75, noseZ: -11.3,
  gearTravel: 0.83, // main gear rises straight up into the sponsons
});
const D = CARGO_DESIGN;
// Hull stations [z, half width, half height, centre height]: blunt nose, constant hold, upswept ramp and tail cone.
const STATIONS = [
  [-15, 0.05, 0.05, -0.35], [-14.4, 0.95, 0.9, -0.3], [-13.3, 1.6, 1.6, -0.15], [-11.6, 2, 2.05, -0.03],
  [-10, 2.15, 2.2, 0], [3.5, 2.15, 2.2, 0], [6.5, 2.05, 1.95, 0.3], [10, 1.6, 1.35, 1], [13.2, 0.9, 0.75, 1.6], [15, 0.15, 0.18, 1.95],
];

/** Hull cross-section at z: a superellipse that is round at the nose and boxy along the cargo hold. */
export function cargoSection(z) {
  let i = 0;
  while (i < STATIONS.length - 2 && z > STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return { hw: mix(a[1], b[1], u), hh: mix(a[2], b[2], u), cy: mix(a[3], b[3], u), n: 2 + 0.6 * clamp((z + 15) / 5, 0, 1) };
}
function hullPoint(z, angle, offset = 0) {
  const s = cargoSection(z), c = Math.cos(angle), n = Math.sin(angle), e = 2 / s.n;
  return [Math.sign(c) * Math.abs(c) ** e * (s.hw + offset), s.cy + Math.sign(n) * Math.abs(n) ** e * (s.hh + offset), z];
}

/** Procedural airframe: four propellers, moving surfaces, sponson-retracting tandem main gear and twin nose wheels. */
export function createCargo() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 20%, 90%)', roughness: 0.34, metalness: 0.1, clearcoat: 0.6, side: THREE.DoubleSide }),
    accent: standard('hsl(84, 22%, 30%)'), stripe: standard('hsl(44, 62%, 64%)'), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 62%)', 0.3, 0.8), dark: standard('hsl(205, 18%, 15%)', 0.55, 0.4),
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
  function grid(rows, cols, vertex) {
    const positions = [], indices = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) positions.push(...vertex(i / rows, j / cols));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1; indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }
  // A patch laid just proud of the hull, between two stations and two section angles.
  const patch = (z0, z1, a0, a1, material, offset = 0.02, rows = 4) =>
    part(grid(rows, 6, (u, v) => hullPoint(mix(z0, z1, u), mix(a0, a1, v) * Math.PI, offset)), material);

  part(grid(96, 40, (t, v) => hullPoint(-15 + 30 * t, v * TAU)), materials.paint);
  for (const mirror of [false, true]) {
    const side = a => mirror ? 1 - a : a; // reflects a section angle (in π) across the vertical plane
    const strip = (z0, z1, a0, a1, material, offset, rows) => patch(z0, z1, side(a0), side(a1), material, offset, rows);
    // Small flight-deck panes: two windscreen panes, a side pane and an eyebrow window each side.
    for (const [a0, a1] of [[0.31, 0.395], [0.405, 0.492]]) strip(-13.95, -13.05, a0, a1, materials.glass, 0.03);
    strip(-13, -12.15, 0.16, 0.27, materials.glass, 0.03); strip(-12.75, -12.25, 0.4, 0.47, materials.glass, 0.03);
    // Accent cheatline with a gold pinstripe, crew door, paratroop door and portholes.
    strip(-12, 8.5, -0.035, 0.035, materials.accent, 0.015, 40); strip(-12, 8.5, -0.07, -0.055, materials.stripe, 0.015, 40);
    strip(-10.2, -9.1, -0.3, -0.1, materials.dark, 0.012); strip(4.2, 5.2, -0.28, -0.08, materials.dark, 0.012);
    for (const z of [-6.5, -3.4, -0.3, 2.8]) {
      const [x, y] = hullPoint(z, 0.06 * Math.PI, 0.02); ellipsoid(mirror ? -x : x, y, z, 0.03, 0.2, 0.2, materials.glass);
    }
    // Rear loading ramp: longitudinal seams along the lower corners, hinge line and upper door edge.
    strip(6, 12.8, -0.205, -0.19, materials.dark, 0.022, 24);
  }
  patch(6, 6.12, -0.81, -0.19, materials.dark, 0.022, 1); patch(12.7, 12.82, -0.8, -0.2, materials.dark, 0.022, 1);
  patch(-10.4, 8, -0.56, -0.44, materials.accent, 0.012, 40); // belly keel stripe

  function wingSection(t, side) {
    return { x: side * mix(1.4, D.span / 2, t), y: D.wingY + 0.1 * t, z: mix(D.rootLE, D.tipLE, t), chord: mix(D.rootChord, D.tipChord, t) };
  }
  function tailSection(t, side) {
    return { x: side * mix(0.5, 8, t), y: 1.85 + 0.05 * t, z: mix(11.2, 12.6, t), chord: mix(3.6, 2, t) };
  }
  const finSection = t => ({ x: 0, y: mix(2.1, 9, t), z: mix(8.2, 12, t), chord: mix(6.2, 3.2, t) });
  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null) {
    const geometry = grid(12, 24, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * TAU;
      const c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2), thickness = sec.chord * 0.06 * Math.sin(angle);
      return vertical ? [sec.x + thickness, sec.y, sec.z + c * sec.chord] : [sec.x, sec.y + thickness, sec.z + c * sec.chord];
    });
    if (!moving) return part(geometry, material);
    const start = sectionAt(from), end = sectionAt(to);
    const hinge = new THREE.Vector3(start.x, start.y, start.z + start.chord * chordFrom);
    const axis = new THREE.Vector3(end.x, end.y, end.z + end.chord * chordFrom).sub(hinge).normalize();
    if (!vertical && axis.x < 0) axis.negate(); // +X hinge on both sides keeps opposite aileron signs physical
    const pivot = new THREE.Group(); pivot.position.copy(hinge); pivot.name = `${moving} hinge`; group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  for (const side of [-1, 1]) {
    const wing = t => wingSection(t, side), tail = t => tailSection(t, side);
    surface(wing, 0, 1, 0, 0.72, materials.paint, side);
    surface(wing, 0, 0.6, 0.72, 1, materials.paint, side, false, 'flaps');
    surface(wing, 0.6, 0.96, 0.72, 1, materials.accent, side, false, 'ailerons');
    surface(wing, 0.96, 1, 0.72, 1, materials.paint, side);
    surface(tail, 0, 1, 0, 0.64, materials.paint, side);
    surface(tail, 0, 1, 0.64, 1, materials.accent, side, false, 'elevators');
    const tip = wingSection(1, side);
    lights.push(ellipsoid(tip.x, tip.y, tip.z + tip.chord * 0.3, 0.09, 0.09, 0.14,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));
  }
  surface(finSection, 0, 1, 0, 0.68, materials.accent, 1, true);
  surface(finSection, 0.82, 1, 0.68, 1, materials.accent, 1, true);
  surface(finSection, 0.05, 0.82, 0.68, 1, materials.stripe, 1, true, 'rudder');
  ellipsoid(0, 2.25, -1, 1.55, 0.42, 4.3, materials.paint); // wing-root fairing above the hold
  ellipsoid(0, 2.25, 7.4, 0.28, 0.55, 2.8, materials.accent); // dorsal fillet into the fin
  for (const side of [-1, 1]) ellipsoid(side * 1.95, -1.5, D.mainZ, 0.82, 0.8, 4.4, materials.paint); // main-gear sponsons

  // Four separate turboprop nacelles hang below the wing, propellers well ahead of the leading edge.
  for (const side of [-1, 1]) for (const x of D.engineX) {
    const t = (x - 1.4) / (D.span / 2 - 1.4), le = mix(D.rootLE, D.tipLE, t), y = D.engineY;
    ellipsoid(side * x, y, le - 0.6, 0.68, 0.82, 3.4, materials.paint);
    ellipsoid(side * x, y - 0.5, le - 3.1, 0.32, 0.2, 0.55, materials.dark); // chin intake
    rod([side * (x + 0.45), y + 0.45, le + 0.6], [side * (x + 0.55), y + 0.4, le + 1.6], 0.16, materials.dark); // exhaust stack
    const rotor = new THREE.Group(); rotor.name = 'propeller'; rotor.position.set(side * x, y, le - 3.95); group.add(rotor); rotors.push(rotor);
    for (let i = 0; i < D.blades; i++) {
      const a = i * TAU / D.blades, r = D.propRadius;
      const blade = part(new THREE.BoxGeometry(r * 0.17, r * 0.9, 0.06), materials.dark, rotor);
      blade.position.set(-Math.sin(a) * r * 0.53, Math.cos(a) * r * 0.53, 0); blade.rotation.set(0, 0.3, a);
      const bladeTip = part(new THREE.BoxGeometry(r * 0.17, r * 0.1, 0.065), materials.stripe, rotor);
      bladeTip.position.set(-Math.sin(a) * r * 0.93, Math.cos(a) * r * 0.93, 0); bladeTip.rotation.z = a;
    }
    ellipsoid(0, 0, -0.25, 0.42, 0.42, 0.7, materials.accent, rotor);
  }

  const tyreDatum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.72, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.75, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  const mainY = tyreDatum + D.mainWheel; // axle height with the gear down
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = 'retractable main gear'; pivot.position.set(side * D.mainX, mainY, D.mainZ); group.add(pivot);
    for (const z of [-D.tandem, D.tandem]) wheel(0, 0, z, D.mainWheel, pivot);
    rod([0, 0, -D.tandem], [0, 0, D.tandem], 0.09, materials.dark, pivot);
    rod([0, 0, 0], [0, 1.35, 0], 0.11, materials.metal, pivot);
    gears.push({ pivot, side, y: mainY });
  }
  const nose = new THREE.Group(); nose.name = 'retractable nose gear'; nose.position.set(0, -1.45, D.noseZ); group.add(nose);
  const noseY = tyreDatum + D.noseWheel - nose.position.y;
  rod([0, 0, 0], [0, noseY, 0], 0.08, materials.metal, nose);
  rod([-0.32, noseY, 0], [0.32, noseY, 0], 0.06, materials.dark, nose);
  for (const x of [-0.32, 0.32]) wheel(x, noseY, 0, D.noseWheel, nose);
  gears.push({ pivot: nose, side: 0 });

  // Batch the immutable root meshes. Propellers, gear and surfaces keep their own pivots.
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
      const spool = clamp(state.spool ?? throttle, 0, 1);
      // All four propellers turn the same way, at the shared turbine spool.
      for (const rotor of rotors) rotor.rotation.z += dt * (6 + spool * 140);
      const target = state.gearDown ? 1 : 0;
      if (state.grounded || (state.flightTime ?? 1) < 0.05) gearPosition = target;
      else gearPosition += clamp(target - gearPosition, -dt / 4, dt / 4);
      for (const g of gears) {
        g.pivot.visible = gearPosition > 0.001;
        if (g.side) g.pivot.position.y = g.y + (1 - gearPosition) * D.gearTravel;
        else g.pivot.rotation.x = (1 - gearPosition) * 1.6; // nose leg folds forward into the nose
      }
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-6 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.6, -0.35, 0.35) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-delta('pitch') * 1.6, -0.35, 0.35) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2.4, -0.3, 0.3) * active);
        previous = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        // Big Fowler-style flaps travel slowly: 15° per stage.
        flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.18, dt * 0.18);
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

/** Camera-local transport flight deck: narrow mullions, a low glass panel and four live power levers. */
export function createCargoCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0.25, -0.45); root.add(panel);
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const knob = new THREE.MeshStandardMaterial({ color: 'hsl(60, 9%, 90%)', roughness: 0.5 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat, parent);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return mesh;
  }
  // The left seat sits 0.62 m off the centreline; the centre mullion and pedestal sit on it.
  for (const side of [-1, 1]) bar([side * 1.6, -0.9, -1.6], [side * 1.6, -0.75, -2.65], 0.05);
  for (const x of [-1.5, 0.62, 1.95]) bar([x, -0.38, -2.2], [x * 0.92, 1.55, -2.3], 0.022);
  bar([-1.55, 1.5, -2.25], [2.05, 1.5, -2.25], 0.045); // eyebrow-window frame
  const shell = part(new THREE.BoxGeometry(3.1, 0.54, 0.18), dark, panel); shell.position.set(0.1, -0.94, -1.9);
  const hood = part(new THREE.BoxGeometry(3.2, 0.06, 0.42), trim, panel); hood.position.set(0.1, -0.65, -1.96);
  const yoke = x => { bar([x, -1.42, -1.4], [x, -1.05, -1.5], 0.035, trim); bar([x - 0.17, -0.98, -1.5], [x + 0.17, -0.98, -1.5], 0.028, trim); };
  yoke(-0.02); yoke(1.26);
  const quadrant = part(new THREE.BoxGeometry(0.5, 0.12, 0.42), trim); quadrant.position.set(0.62, -1.3, -1.8);
  const levers = [-0.18, -0.06, 0.06, 0.18].map(dx => {
    const pivot = new THREE.Group(); pivot.position.set(0.62 + dx, -1.26, -1.8); root.add(pivot);
    bar([0, 0, 0], [0, 0.22, 0], 0.012, trim, pivot);
    const grip = part(new THREE.BoxGeometry(0.07, 0.045, 0.06), knob, pivot); grip.position.y = 0.23;
    return pivot;
  });
  root.userData.levers = levers;
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.43, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  const moveLevers = state => { for (const lever of levers) lever.rotation.x = -0.65 + clamp(state.throttle ?? 0, 0, 1) * 1.05; };
  root.userData.update = moveLevers;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 250;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(2.92, 0.48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0.1, -0.94, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)', track: 'hsl(205 15% 22%)' };
    const text = (label, x, y, size = 18, color = colors.ink) => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x, y); };
    let last = -1;
    root.userData.update = state => {
      moveLevers(state);
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1200, 250);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 600, 24, 18, colors.muted);
      const knots = state.speed * 1.94384, altitude = state.position.y * 3.28084;
      text(`${Math.round(knots)} KT`, 130, 100, 30, colors.signal); text(`${Math.round(altitude)} FT`, 130, 145, 24);
      text(`HDG ${String(Math.round(state.heading * 180 / Math.PI) % 360).padStart(3, '0')}`, 130, 185, 18);
      text(`VS ${Math.round(state.verticalSpeed * 196.85 / 10) * 10}`, 130, 215, 16, colors.muted);
      // One shared spool drives all four engines in this model, so the four columns always agree.
      const power = clamp(state.spool ?? 0, 0, 1);
      text('ENGINE POWER %', 900, 55, 14, colors.muted);
      for (let i = 0; i < 4; i++) {
        const x = 810 + i * 60;
        ctx.fillStyle = colors.track; ctx.fillRect(x - 12, 70, 24, 110);
        ctx.fillStyle = colors.signal; ctx.fillRect(x - 12, 180 - power * 110, 24, power * 110);
        text(String(i + 1), x, 200, 15, colors.muted); text(String(Math.round(power * 100)), x, 225, 17);
      }
      text(`FLAPS ${state.flaps * 15}°`, 1105, 115, 18); text(`GEAR ${state.gearDown ? 'DOWN' : 'UP'}`, 1105, 155, 18);
      text(type.badge, 1105, 200, 18, colors.muted);
      ctx.save(); ctx.beginPath(); ctx.rect(435, 50, 330, 180); ctx.clip(); ctx.translate(600, 140); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 120);
      ctx.fillStyle = colors.sky; ctx.fillRect(-260, -300, 520, 300); ctx.fillStyle = colors.earth; ctx.fillRect(-260, 0, 520, 300);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-250, 0); ctx.lineTo(250, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(550, 140); ctx.lineTo(585, 140); ctx.lineTo(600, 148); ctx.lineTo(615, 140); ctx.lineTo(650, 140); ctx.stroke();
      texture.needsUpdate = true;
    };
  }
  return root;
}

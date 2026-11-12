import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canard as type } from './canard-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Neris P2 dimensions in metres; the nose points down local -Z. Original design, no reference drawing.
const D = {
  nose: -3.45, tail: 2.86, canardZ: -2.78, canardY: 0.06, canardSpan: 3.9, canardChord: 0.5,
  wingY: -0.2, wingZ: 0.3, span: 8.4, rootChord: 1.6, tipChord: 0.66, sweep: 1.45, dihedral: 0.14,
  fin: 1.05, finBelow: 0.26, propZ: 3.02, propY: 0.06, propRadius: 0.8,
  noseGearZ: -2.2, mainGearX: 1.25, mainGearZ: 1.1, noseWheel: 0.2, mainWheel: 0.26,
};
// Fuselage stations: z, half width, half height, centre height.
const STATIONS = [
  [-3.45, 0.02, 0.02, -0.06], [-3.15, 0.22, 0.2, -0.05], [-2.5, 0.4, 0.36, -0.02], [-1.5, 0.52, 0.47, 0],
  [0.1, 0.55, 0.5, 0], [1.5, 0.46, 0.43, 0.02], [2.5, 0.28, 0.28, 0.05], [2.86, 0.12, 0.12, 0.06],
];
const ACCENT = 'hsl(328, 40%, 33%)', STRIPE = 'hsl(77, 70%, 59%)';

function section(z) {
  let i = 0;
  while (i < STATIONS.length - 2 && z > STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [mix(a[1], b[1], u), mix(a[2], b[2], u), mix(a[3], b[3], u)];
}

/** Original two-seat canard pusher: glazed tandem nose, forewing elevators, swept wing, tip rudders and rear propeller. */
export function createCanard() {
  const group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 91%)', roughness: 0.28, metalness: 0.12, clearcoat: 0.85, side: THREE.DoubleSide }),
    accent: standard(ACCENT), stripe: standard(STRIPE), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 37%, 19%)', roughness: 0.08, metalness: 0.5, clearcoat: 1 }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, rotors = [], gears = [], lights = [];
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

  // Slender hull that narrows into the engine bay; the long tandem canopy runs almost to the nose.
  const hull = (t, v) => { const z = mix(D.nose, D.tail, t), [rx, ry, cy] = section(z), a = v * Math.PI * 2; return [rx * Math.cos(a), cy + ry * Math.sin(a), z]; };
  part(grid(64, 32, hull), materials.paint);
  part(grid(28, 10, (u, v) => { const z = mix(-3.08, 0.42, u), [rx, ry, cy] = section(z), a = mix(0.32, Math.PI - 0.32, v), lift = 0.27 * Math.sin(Math.PI * clamp((z + 3.15) / 3.6, 0, 1)) ** 0.6;
    return [(rx + 0.02) * Math.cos(a), cy + (ry + 0.02 + lift) * Math.sin(a), z]; }, true), materials.glass);
  rod([-0.4, 0.5, -1.0], [0, 0.78, -1.02], 0.025, materials.dark); rod([0.4, 0.5, -1.0], [0, 0.78, -1.02], 0.025, materials.dark); // tandem canopy bow
  for (const side of [-1, 1]) for (const [y, mat] of [[-0.1, materials.accent], [-0.24, materials.stripe]]) {
    part(grid(40, 2, (u, v) => { const z = mix(-3.1, 2.5, u), [rx, ry, cy] = section(z), a = y + (v - 0.5) * (mat === materials.accent ? 0.11 : 0.05);
      return [side * (rx + 0.012) * Math.cos(a), cy + (ry + 0.012) * Math.sin(a), z]; }, side < 0), mat);
  }
  // Leading-edge strakes blend the fuselage into the swept wing roots and house the fuel.
  for (const side of [-1, 1]) ellipsoid(side * 0.62, D.wingY + 0.02, 0.15, 0.62, 0.13, 1.25, materials.paint);
  // Cowled engine and cooling scoops ahead of the pusher propeller.
  ellipsoid(0, D.propY, 2.55, 0.33, 0.33, 0.5, materials.accent);
  for (const side of [-1, 1]) {
    ellipsoid(side * 0.4, -0.32, 1.7, 0.09, 0.07, 0.38, materials.dark);
    rod([side * 0.12, -0.22, 2.7], [side * 0.15, -0.28, 2.95], 0.035, materials.dark);
  }

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
    // +X hinges on both sides keep opposite aileron and matching canard signs physical.
    if (!vertical && axis.x < 0) axis.negate();
    const pivot = new THREE.Group(); pivot.name = moving; pivot.position.copy(hinge); group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  const wing = side => t => ({ x: side * mix(0.5, D.span / 2, t), y: D.wingY + D.dihedral * t,
    z: D.wingZ + D.sweep * t, chord: mix(D.rootChord, D.tipChord, t) });
  const foreplane = side => t => ({ x: side * mix(0.3, D.canardSpan / 2, t), y: D.canardY - 0.04 * t, z: D.canardZ + 0.05 * t, chord: mix(D.canardChord, D.canardChord * 0.85, t), thickness: 0.08 });
  for (const side of [-1, 1]) {
    const w = wing(side), c = foreplane(side);
    surface(w, 0, 1, 0, 0.74, materials.paint, side);
    surface(w, 0, 0.42, 0.74, 1, materials.paint, side);
    surface(w, 0.42, 0.94, 0.74, 1, materials.accent, side, false, 'ailerons');
    surface(w, 0.94, 1, 0.74, 1, materials.paint, side);
    surface(c, 0, 1, 0, 0.62, materials.paint, side);
    surface(c, 0.04, 1, 0.62, 1, materials.accent, side, false, 'elevators');
    ellipsoid(side * D.canardSpan / 2, D.canardY - 0.04, D.canardZ + 0.28, 0.035, 0.035, 0.24, materials.stripe);
    // Twin wingtip fins carry the rudders; a short ventral fin guards each tip.
    const tip = w(1), finBase = t => ({ x: tip.x, y: tip.y + D.fin * t, z: tip.z + 0.05 + 0.55 * t, chord: mix(D.tipChord * 1.12, 0.36, t), thickness: 0.07 });
    surface(finBase, 0, 1, 0, 0.66, materials.accent, side, true);
    surface(finBase, 0.12, 0.92, 0.66, 1, materials.stripe, side, true, 'rudder');
    surface(t => ({ x: tip.x, y: tip.y - D.finBelow * t, z: tip.z + 0.12 + 0.18 * t, chord: mix(D.tipChord * 0.9, 0.3, t), thickness: 0.07 }), 0, 1, 0, 1, materials.accent, side, true);
    const nav = ellipsoid(tip.x + side * 0.05, tip.y + 0.04, tip.z + 0.12, 0.06, 0.06, 0.09,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' }));
    lights.push(nav);
  }

  // Three-blade pusher behind the cowl; it turns about the aircraft's long axis.
  const prop = new THREE.Group(); prop.name = 'propeller'; prop.position.set(0, D.propY, D.propZ); group.add(prop); rotors.push(prop);
  for (let i = 0; i < 3; i++) {
    const a = i * 2 * Math.PI / 3, r = D.propRadius;
    const blade = part(new THREE.BoxGeometry(r * 0.15, r * 0.9, 0.05), materials.dark, prop);
    blade.position.set(-Math.sin(a) * r * 0.53, Math.cos(a) * r * 0.53, 0); blade.rotation.set(0, -0.26, a);
    const tipMark = part(new THREE.BoxGeometry(r * 0.15, r * 0.11, 0.055), materials.stripe, prop);
    tipMark.position.set(-Math.sin(a) * r * 0.93, Math.cos(a) * r * 0.93, 0); tipMark.rotation.z = a;
  }
  ellipsoid(0, 0, 0.12, 0.16, 0.16, 0.3, materials.accent, prop);

  // Fixed tricycle gear: a long nose leg and swept bow legs under the strakes, with spats.
  const tyreY = 0.925 - type.groundClearance;
  function wheel(x, z, radius, parent) {
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.62, 16), materials.rubber, parent, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(x, tyreY + radius, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, radius * 0.66, 12), materials.metal, parent);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
  }
  const nose = new THREE.Group(); nose.name = 'fixed nose gear'; group.add(nose); gears.push(nose);
  rod([0, -0.36, D.noseGearZ - 0.05], [0, tyreY + D.noseWheel, D.noseGearZ], 0.045, materials.metal, nose);
  wheel(0, D.noseGearZ, D.noseWheel, nose);
  const mains = new THREE.Group(); mains.name = 'fixed main gear'; group.add(mains); gears.push(mains);
  for (const side of [-1, 1]) {
    rod([side * 0.48, -0.42, D.mainGearZ - 0.15], [side * D.mainGearX, tyreY + D.mainWheel, D.mainGearZ], 0.05, materials.paint, mains);
    wheel(side * D.mainGearX, D.mainGearZ, D.mainWheel, mains);
    ellipsoid(side * D.mainGearX, tyreY + D.mainWheel + 0.05, D.mainGearZ, D.mainWheel * 0.7, D.mainWheel * 0.72, D.mainWheel * 1.8, materials.accent, mains);
  }

  // Batch immutable root meshes by material. Surfaces, propeller and gear keep their own groups.
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
  let previous = null;
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      const spool = clamp(state.spool ?? throttle, 0, 1);
      // Seen from behind the pusher turns clockwise; from the chase camera that is -Z rotation.
      prop.rotation.z -= dt * (8 + spool * 150);
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-8 * dt));
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.45, -0.4, 0.4) * active);
        // A canard raises the nose by lowering its trailing edge: the opposite sign to a tail elevator.
        deflection.elevators = smooth(deflection.elevators, clamp(delta('pitch') * 1.3, -0.4, 0.4) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2, -0.35, 0.35) * active);
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

/** Front-seat view: open bubble glazing, the canard tips ahead, a low analogue panel and a right side stick. */
export function createCanardCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0.25, -0.45); root.add(panel);
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const paint = new THREE.MeshStandardMaterial({ color: 'hsl(48, 22%, 88%)', roughness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.4 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat, parent);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // Canopy sills only; the forward bubble has no posts in the view.
  for (const side of [-1, 1]) bar([side * 1.5, -0.95, -1.4], [side * 1.4, -0.78, -2.8], 0.05);
  // Canard halves seen ahead and below, with elevators that follow pitch.
  const elevators = [];
  for (const side of [-1, 1]) {
    const fixed = part(new THREE.BoxGeometry(2.6, 0.05, 0.46), paint); fixed.position.set(side * 2.5, -1.4, -4.8);
    const hinge = new THREE.Group(); hinge.position.set(side * 2.5, -1.4, -4.57); root.add(hinge); elevators.push(hinge);
    const flap = part(new THREE.BoxGeometry(2.5, 0.04, 0.26), accent, hinge); flap.position.z = 0.13;
  }
  const shell = part(new THREE.BoxGeometry(2.3, 0.5, 0.18), dark, panel); shell.position.set(0, -0.96, -1.9);
  const hood = part(new THREE.BoxGeometry(2.4, 0.06, 0.38), trim, panel); hood.position.set(0, -0.69, -1.96);
  // Right side stick and left throttle quadrant, as in a canard tourer.
  bar([1.05, -1.45, -1.25], [1.05, -1.12, -1.32], 0.03, trim);
  const grip = part(new THREE.BoxGeometry(0.09, 0.16, 0.1)); grip.position.set(1.05, -1.06, -1.33);
  bar([-1.05, -1.4, -1.3], [-1.02, -1.2, -1.42], 0.025, trim);
  let stickPitch = 0;
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.45, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  root.userData.elevators = elevators;
  let lastPitch = null, lastTime = 0;
  const animate = state => {
    const time = state.flightTime ?? 0, dt = time - lastTime;
    if (lastPitch !== null && dt > 0) stickPitch = mix(stickPitch, clamp((state.pitch - lastPitch) / dt * 1.3, -0.4, 0.4), 1 - Math.exp(-8 * dt));
    if (state.grounded || state.crashed) stickPitch = 0;
    lastPitch = state.pitch; lastTime = time;
    for (const hinge of elevators) hinge.rotation.x = stickPitch; // trailing edge down raises the nose
  };
  root.userData.update = animate;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 250;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0, -0.96, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)' };
    const text = (label, x, y, size = 18, color = colors.ink) => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x, y); };
    function dial(x, label, value, max, units) {
      ctx.fillStyle = 'hsl(205 15% 26%)'; ctx.beginPath(); ctx.arc(x, 140, 82, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, 140, 75, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (0.75 + i / 20 * 1.5); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 61, 140 + Math.sin(a) * 61); ctx.lineTo(x + Math.cos(a) * 69, 140 + Math.sin(a) * 69); ctx.stroke();
      }
      const a = Math.PI * (0.75 + clamp(value / max, 0, 1) * 1.5);
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 140); ctx.lineTo(x + Math.cos(a) * 57, 140 + Math.sin(a) * 57); ctx.stroke();
      text(label, x, 112, 13, colors.muted); text(String(Math.round(value)), x, 180, 21); text(units, x, 200, 11, colors.muted);
    }
    let last = -1;
    root.userData.update = state => {
      animate(state);
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1100, 250);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 550, 24, 18, colors.muted);
      const knots = state.speed * 1.94384, altitude = state.position.y * 3.28084;
      dial(100, 'AIRSPEED', knots, type.speedScale, 'KT'); dial(290, 'ALTITUDE', altitude, 10000, 'FT');
      dial(810, 'PUSHER', (state.spool ?? 0) * 2700, 3000, 'RPM'); dial(1000, 'VSI', Math.abs(state.verticalSpeed) * 196.85, 2000, 'FT/MIN');
      text('GEAR FIXED · NO FLAPS', 550, 244, 13, colors.muted);
      ctx.save(); ctx.beginPath(); ctx.rect(400, 50, 300, 172); ctx.clip(); ctx.translate(550, 136); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 120);
      ctx.fillStyle = colors.sky; ctx.fillRect(-260, -300, 520, 300); ctx.fillStyle = colors.earth; ctx.fillRect(-260, 0, 520, 300);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-250, 0); ctx.lineTo(250, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(500, 136); ctx.lineTo(535, 136); ctx.lineTo(550, 144); ctx.lineTo(565, 136); ctx.lineTo(600, 136); ctx.stroke();
      texture.needsUpdate = true;
    };
  }
  return root;
}

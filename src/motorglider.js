import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aircraftType } from './fleet.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Metres, nose towards -Z. An original 18 m self-launching sailplane: slender pod-and-boom fuselage, shoulder wing
// with polyhedral outer panels, T-tail, mast-mounted tractor prop, fixed monowheel, tailwheel and wing outriggers.
const SPAN = 18, ROOT_X = 0.3, BREAK = 0.45;
const ACCENT = 'hsl(338, 40%, 34%)', TIP = 'hsl(77, 70%, 59%)';

/** Procedural Varen G18 airframe. Same contract as the fleet models: update, gearPosition, surfaces, setCockpit, dispose. */
export function createMotorglider() {
  const type = aircraftType('motorglider'), group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: 'hsl(48, 22%, 93%)', roughness: 0.22, metalness: 0.1, clearcoat: 1, side: THREE.DoubleSide }),
    accent: standard(ACCENT), tip: standard(TIP), rubber: standard('hsl(210, 15%, 9%)', 0.88),
    metal: standard('hsl(200, 12%, 65%)', 0.27, 0.85), dark: standard('hsl(205, 20%, 14%)', 0.5, 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: 'hsl(201, 37%, 19%)', roughness: 0.08, metalness: 0.5, clearcoat: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  const surfaces = { ailerons: [], elevators: [], rudder: [], flaps: [] }, wheels = [], lights = [];
  let prop;
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

  // Pod and boom: [z, half-width, half-height, centre y]. A deep cockpit pod narrows quickly into a thin tail boom.
  const stations = [
    [-3.05, 0.02, 0.02, -0.02], [-2.85, 0.17, 0.19, -0.03], [-2.5, 0.27, 0.31, -0.02], [-1.9, 0.32, 0.38, 0],
    [-0.9, 0.33, 0.37, 0.02], [-0.15, 0.3, 0.33, 0.02], [0.6, 0.19, 0.21, -0.02], [1.6, 0.115, 0.13, -0.07],
    [3.4, 0.08, 0.095, -0.1], [4.05, 0.06, 0.075, -0.08], [4.2, 0.012, 0.012, -0.06],
  ];
  const NOSE = stations[0][0], TAIL = stations.at(-1)[0];
  function section(z) {
    let i = 0; while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
    const a = stations[i], b = stations[i + 1], u = clamp((z - a[0]) / (b[0] - a[0]), 0, 1), s = u * u * (3 - 2 * u);
    return [mix(a[1], b[1], s), mix(a[2], b[2], s), mix(a[3], b[3], s)];
  }
  const hull = (from, to, a0, a1, grow = 0) => (t, v) => {
    const z = mix(from, to, t), [rx, ry, cy] = section(z), a = mix(a0, a1, v);
    return [(rx + grow) * Math.cos(a), cy + (ry + grow) * Math.sin(a), z];
  };
  part(grid(80, 32, hull(NOSE, TAIL, 0, Math.PI * 2)), materials.paint);
  // A long single-seat canopy over the pod, and thin accent cheatlines along the boom.
  part(grid(20, 16, (t, v) => {
    const z = mix(-2.72, -0.95, t), [rx, ry, cy] = section(z), bulge = Math.sin(t * Math.PI) ** 0.6 * 0.2;
    const a = mix(0.32, Math.PI - 0.32, v);
    return [(rx + 0.012) * Math.cos(a), cy + (ry + 0.012 + bulge * Math.sin(a)) * Math.sin(a), z];
  }), materials.glass, group, 'canopy');
  for (const side of [-1, 1]) {
    part(grid(48, 2, hull(-0.3, 3.95, side < 0 ? Math.PI + 0.02 : -0.02, side < 0 ? Math.PI - 0.07 : 0.07, 0.006), side > 0), materials.accent);
  }
  part(grid(10, 2, hull(-2.78, -0.92, 0.38, Math.PI - 0.38, 0.004)), materials.dark); // canopy frame sill

  // Wing planform as a function of t (0 at the root, 1 at the tip): constant inner chord, tapered polyhedral outer panel.
  function wingSection(t, side) {
    const x = mix(ROOT_X, SPAN / 2, t), outer = Math.max(0, t - BREAK);
    const chord = t < BREAK ? mix(0.96, 0.84, t / BREAK) : mix(0.84, 0.34, (outer / (1 - BREAK)) ** 1.15);
    return { x: side * x, y: 0.2 + 0.035 * x + 0.06 * outer * SPAN / 2, z: -0.72 + 0.022 * x, chord };
  }
  function tailSection(t, side) {
    return { x: side * mix(0.05, 1.3, t), y: 1.18, z: 3.72 + 0.12 * t, chord: mix(0.5, 0.32, t) };
  }
  function surface(sectionAt, from, to, chordFrom, chordTo, material, side = 1, vertical = false, moving = null, thick = 0.06) {
    const geometry = grid(16, 24, (u, v) => {
      const sec = sectionAt(mix(from, to, u)), angle = v * Math.PI * 2;
      const c = mix(chordFrom, chordTo, (1 - Math.cos(angle)) / 2), thickness = sec.chord * thick * Math.sin(angle) * (1 - 0.6 * c);
      return vertical ? [sec.x + thickness, sec.y, sec.z + c * sec.chord] : [sec.x, sec.y + thickness, sec.z + c * sec.chord];
    }, vertical ? false : side < 0);
    if (!moving) return part(geometry, material);
    const start = sectionAt(from), end = sectionAt(to);
    const hinge = new THREE.Vector3(start.x, start.y, start.z + start.chord * chordFrom);
    const axis = new THREE.Vector3(end.x, end.y, end.z + end.chord * chordFrom).sub(hinge).normalize();
    if (!vertical && axis.x < 0) axis.negate(); // +X hinges on both wings keep opposite aileron signs physical
    const pivot = new THREE.Group(); pivot.position.copy(hinge); group.add(pivot);
    geometry.translate(-hinge.x, -hinge.y, -hinge.z); part(geometry, material, pivot);
    surfaces[moving].push({ pivot, axis, side, angle: 0 });
  }
  for (const side of [-1, 1]) {
    const wing = t => wingSection(t, side), tail = t => tailSection(t, side);
    surface(wing, 0, 0.94, 0, 0.76, materials.paint, side);
    surface(wing, 0.02, 0.45, 0.76, 1, materials.paint, side, false, 'flaps');
    surface(wing, 0.45, 0.94, 0.76, 1, materials.paint, side, false, 'ailerons');
    surface(wing, 0.94, 1, 0, 1, materials.tip, side);
    const tip = wingSection(1, side); // small upturned winglet
    surface(s => ({ x: tip.x + side * 0.04 * s, y: tip.y + 0.5 * s, z: tip.z + 0.16 * s, chord: mix(tip.chord, 0.17, s) }), 0, 1, 0, 1, materials.tip, side, true, null, 0.08);
    surface(tail, 0, 1, 0, 0.62, materials.paint, side, false, null, 0.07);
    surface(tail, 0, 1, 0.62, 1, materials.accent, side, false, 'elevators', 0.07);
    lights.push(ellipsoid(tip.x, tip.y + 0.02, tip.z + 0.1, 0.05, 0.05, 0.07,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 'hsl(0, 80%, 58%)' : 'hsl(130, 70%, 52%)' })));
  }
  // Swept fin from the boom to the T-tail; a small ventral fairing carries the tailwheel.
  const fin = t => ({ x: 0, y: mix(-0.02, 1.18, t), z: mix(3.3, 3.78, t), chord: mix(0.86, 0.5, t) });
  surface(fin, 0, 1, 0, 0.66, materials.paint, 1, true, null, 0.07);
  surface(fin, 0, 1, 0.66, 1, materials.accent, 1, true, 'rudder', 0.07);
  surface(t => ({ x: 0, y: mix(-0.12, -0.36, t), z: mix(3.62, 3.86, t), chord: mix(0.42, 0.18, t) }), 0, 1, 0, 1, materials.paint, 1, true, null, 0.12);

  // Engine mast behind the canopy, a slim nacelle and a two-blade tractor prop.
  for (const x of [-0.07, 0.07]) rod([x, 0.32, 0.2], [x, 0.98, 0.04], 0.035, materials.dark);
  ellipsoid(0, 1.03, 0.04, 0.1, 0.11, 0.36, materials.accent);
  prop = new THREE.Group(); prop.name = 'propeller'; prop.position.set(0, 1.03, -0.34); group.add(prop);
  for (let i = 0; i < 2; i++) {
    const blade = part(new THREE.BoxGeometry(0.075, 0.56, 0.03), materials.dark, prop);
    blade.position.set(0, (i ? -1 : 1) * 0.31, 0); blade.rotation.y = i ? -0.28 : 0.28;
    const tip = part(new THREE.BoxGeometry(0.075, 0.07, 0.034), materials.tip, prop); tip.position.set(0, (i ? -1 : 1) * 0.57, 0);
  }
  ellipsoid(0, 0, -0.04, 0.07, 0.07, 0.1, materials.accent, prop);

  // Fixed gear: semi-recessed monowheel, tailwheel in the ventral fairing, and two sprung wing outriggers that sit
  // 6 cm clear of the runway while the wings are level. Tyre bottoms meet the runway datum used by the fleet.
  const datum = 0.925 - type.groundClearance;
  function wheel(x, y, z, radius, name) {
    const hub = new THREE.Group(); hub.name = name; hub.position.set(x, y, z); group.add(hub); wheels.push({ hub, radius });
    const tyre = part(new THREE.CylinderGeometry(radius, radius, radius * 0.55, 16), materials.rubber, hub, 'tyre'); tyre.rotation.z = Math.PI / 2;
    const cap = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.58, 10), materials.metal, hub); cap.rotation.z = Math.PI / 2;
  }
  wheel(0, datum + 0.2, -0.32, 0.2, 'fixed monowheel');
  ellipsoid(0, -0.3, -0.32, 0.12, 0.08, 0.36, materials.dark); // wheel well
  wheel(0, datum + 0.075, 3.82, 0.075, 'fixed tailwheel');
  rod([0, -0.33, 3.82], [0, datum + 0.075, 3.82], 0.02, materials.dark);
  for (const side of [-1, 1]) {
    const at = wingSection((1.7 - ROOT_X) / (SPAN / 2 - ROOT_X), side), y = datum + 0.06 + 0.07;
    rod([side * 1.7, at.y - 0.02, at.z + 0.35], [side * 1.82, y + 0.05, at.z + 0.35], 0.026, materials.dark);
    ellipsoid(side * 1.7, at.y - 0.02, at.z + 0.35, 0.05, 0.04, 0.16, materials.paint); // root fairing
    wheel(side * 1.85, y, at.z + 0.35, 0.07, 'wing outrigger');
  }

  // Batch only immutable root meshes. Moving prop, wheels and surfaces keep their own pivots.
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
      // The small prop is stopped at idle and turns with engine spool; it never windmills in the glide.
      const spool = clamp(state.spool ?? throttle, 0, 1);
      prop.rotation.z += dt * (spool < 0.02 ? 0 : 20 + spool * 150);
      if (state.grounded) for (const { hub, radius } of wheels) hub.rotation.x -= dt * (state.speed ?? 0) / radius;
      if (dt > 0) {
        previous ??= { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        const delta = key => Math.atan2(Math.sin((state[key] ?? 0) - previous[key]), Math.cos((state[key] ?? 0) - previous[key])) / dt;
        const active = state.grounded || state.crashed ? 0 : 1, smooth = (a, b) => mix(a, b, 1 - Math.exp(-6 * dt));
        // Long ailerons move gently; the coordinated part of the turn is removed from the rudder.
        deflection.ailerons = smooth(deflection.ailerons, clamp(delta('bank') * 0.6, -0.35, 0.35) * active);
        deflection.elevators = smooth(deflection.elevators, clamp(-delta('pitch') * 1.6, -0.35, 0.35) * active);
        deflection.rudder = smooth(deflection.rudder, clamp((delta('heading') - 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24)) * 2.2, -0.35, 0.35) * active);
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

/** Camera-local sailplane panel: a low glareshield with airspeed, a central variometer, altimeter and motor monitor. */
export function createMotorgliderCockpit() {
  const type = aircraftType('motorglider'), root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0.25, -0.45); root.add(panel);
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.03, mat = dark) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // One-piece canopy: only its thin rails and a low sill frame the view; there is no windshield post.
  for (const side of [-1, 1]) {
    bar([side * 1.45, -0.95, -1.4], [side * 1.2, -0.8, -2.8], 0.035);
    bar([side * 1.2, -0.8, -2.8], [side * 0.35, -0.55, -4.2], 0.025);
  }
  const shell = part(new THREE.BoxGeometry(2.3, 0.5, 0.18), dark, panel); shell.position.set(0, -0.95, -1.9);
  const hood = part(new THREE.BoxGeometry(2.4, 0.05, 0.36), trim, panel); hood.position.set(0, -0.68, -1.96);
  bar([0, -1.5, -1.35], [0, -1.12, -1.48], 0.03, trim); // centre stick
  const grip = part(new THREE.BoxGeometry(0.08, 0.15, 0.08)); grip.position.set(0, -1.08, -1.48);
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.47, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 240;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(2.2, 0.48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0, -0.95, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', ring: 'hsl(205 15% 26%)' };
    const text = (label, x, y, size = 18, color = colors.ink) => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x, y); };
    function face(x, r) {
      ctx.fillStyle = colors.ring; ctx.beginPath(); ctx.arc(x, 135, r + 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, 135, r, 0, Math.PI * 2); ctx.fill();
    }
    function needle(x, angle, length) {
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 135); ctx.lineTo(x + Math.cos(angle) * length, 135 + Math.sin(angle) * length); ctx.stroke();
    }
    function dial(x, label, value, max, units) {
      face(x, 75);
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (0.75 + i / 20 * 1.5); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 61, 135 + Math.sin(a) * 61); ctx.lineTo(x + Math.cos(a) * 69, 135 + Math.sin(a) * 69); ctx.stroke();
      }
      needle(x, Math.PI * (0.75 + clamp(value / max, 0, 1) * 1.5), 57);
      text(label, x, 107, 13, colors.muted); text(String(Math.round(value)), x, 175, 21); text(units, x, 195, 11, colors.muted);
    }
    let last = -1;
    root.userData.update = state => {
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1100, 240);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 550, 22, 17, colors.muted);
      dial(110, 'AIRSPEED', state.speed * 1.94384, type.speedScale, 'KT');
      dial(320, 'ALTITUDE', state.position.y * 3.28084, 10000, 'FT');
      // Variometer: ±5 m/s on a left-zero scale, the classic sailplane instrument.
      const vario = clamp(state.verticalSpeed ?? 0, -5, 5); face(550, 92);
      for (let i = -5; i <= 5; i++) {
        const a = Math.PI + i / 5 * Math.PI * 0.8; ctx.strokeStyle = i ? colors.muted : colors.ink; ctx.lineWidth = i ? 2 : 3;
        ctx.beginPath(); ctx.moveTo(550 + Math.cos(a) * 76, 135 + Math.sin(a) * 76); ctx.lineTo(550 + Math.cos(a) * 86, 135 + Math.sin(a) * 86); ctx.stroke();
      }
      needle(550, Math.PI + vario / 5 * Math.PI * 0.8, 72);
      text('VARIO', 550, 102, 13, colors.muted); text(`${vario > 0 ? '+' : ''}${(state.verticalSpeed ?? 0).toFixed(1)}`, 610, 141, 20); text('M/S', 610, 160, 11, colors.muted);
      const spool = state.spool ?? 0;
      text('MOTOR', 800, 70, 14, colors.muted); text(spool < 0.02 ? 'PROP STOP' : `${Math.round(spool * 6200)} RPM`, 800, 108, 22, spool < 0.02 ? colors.muted : colors.signal);
      text(`FLAPS ${(state.flaps ?? 0) * 15}°`, 800, 152, 18); text('GEAR FIXED', 800, 186, 18, colors.muted);
      text(`HDG ${String(Math.round((state.heading ?? 0) * 180 / Math.PI) % 360).padStart(3, '0')}`, 990, 108, 20);
      text(type.badge, 990, 152, 20, colors.muted);
      texture.needsUpdate = true;
    };
  }
  return root;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tandem as type } from './tandem-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Ivory cabin, graphite lower body, a mustard accent on the pylons, engine pods and belly band, chartreuse blade tips.
const palette = {
  shell: 'hsl(48, 22%, 91%)', mustard: 'hsl(42, 72%, 50%)', graphite: 'hsl(205, 18%, 22%)', ink: 'hsl(205, 21%, 13%)',
  glass: 'hsl(205, 22%, 30%)', metal: 'hsl(200, 11%, 63%)', rubber: 'hsl(210, 15%, 9%)', signal: 'hsl(77, 88%, 67%)',
};
// Metres; nose -Z, rotor axes +Y, tail +Z. Two rotor heads ~11.5 m apart; the rear head sits 1.2 m higher so the
// overlapping discs never meet. Wheels: two under the flight deck, two aft on the sponsons.
export const D = {
  rotorRadius: 9, frontY: 2.35, frontZ: -5.6, rearY: 3.55, rearZ: 5.9,
  frontWheel: 0.42, rearWheel: 0.46, frontX: 1.6, frontGearZ: -4.9, rearX: 1.75, rearGearZ: 3.3,
};
// Fuselage stations: z, half width, half height, centre height, superellipse exponent (larger is boxier).
const STATIONS = [
  [-7.5, 0.12, 0.14, -0.32, 2], [-7.25, 0.72, 0.7, -0.2, 2.1], [-6.6, 1.15, 1.04, -0.03, 2.5], [-5.7, 1.36, 1.22, 0.08, 3.2],
  [-4.8, 1.4, 1.26, 0.1, 3.6], [3.4, 1.4, 1.26, 0.1, 3.6], [5.2, 1.3, 1, 0.36, 3.4], [6.9, 1.08, 0.7, 0.66, 3],
  [7.55, 0.86, 0.5, 0.86, 2.6], [7.7, 0.08, 0.08, 0.9, 2],
];
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
/** A point on the hull skin, `lift` metres proud of it. Angle 0 is the right side, π/2 the roof, 3π/2 the belly. */
function hull(z, angle, lift = 0) {
  const st = station(z), [x, y] = superellipse(angle, st.n);
  return [x * (st.w + lift), st.y + y * (st.h + lift), z];
}
const BELLY = Math.PI * 1.5;

/** Original procedural Lodra H20 heavy tandem-rotor helicopter; no textures, assets or model downloads. */
export function createTandem() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.28, metalness: 0.12, clearcoat: 0.85, side: THREE.DoubleSide }),
    mustard: new THREE.MeshPhysicalMaterial({ color: palette.mustard, roughness: 0.32, metalness: 0.15, clearcoat: 0.8, side: THREE.DoubleSide }),
    graphite: new THREE.MeshPhysicalMaterial({ color: palette.graphite, roughness: 0.4, metalness: 0.15, clearcoat: 0.6, side: THREE.DoubleSide }),
    ink: standard(palette.ink, 0.5, 0.4), metal: standard(palette.metal, 0.25, 0.85),
    rubber: standard(palette.rubber, 0.88), signal: standard(palette.signal, 0.45),
    glass: new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.06, metalness: 0.55, clearcoat: 1, envMapIntensity: 1.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  function part(geometry, material, parent = group, name = '') {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.SphereGeometry(1, 20, 12), material, parent);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function rod(a, b, radius, material = materials.metal, parent = group, radiusEnd = radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radiusEnd, radius, start.distanceTo(end), 10), material, parent);
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
  const patch = (z0, z1, a0, a1, material, lift = 0.02, rows = 8, cols = 6) => part(grid(rows, cols, (u, v) => hull(mix(z0, z1, u), mix(a0, a1, v), lift)), material);
  /**
   * A rounded pylon fairing rising from the cabin roof: horizontal superellipse sections from `y0` to `y1`
   * whose fore/aft extent and half width blend from the base to the top, closed by a domed cap. `from`/`to`
   * (0–1 of the height) select a band so the cap can take the accent colour.
   */
  function pylon({ y0, y1, base, top, w0, w1 }, material, from = 0, to = 1) {
    return part(grid(14, 28, (t, v) => {
      const h = mix(from, to, t), cap = h > 0.82 ? Math.sqrt(Math.max(0, 1 - ((h - 0.82) / 0.18) ** 2)) : 1;
      const k = Math.min(h, 0.82) / 0.82, y = mix(y0, y1, k) + (h > 0.82 ? (h - 0.82) / 0.18 * 0.28 : 0);
      const z0 = mix(base[0], top[0], k), z1 = mix(base[1], top[1], k), w = mix(w0, w1, k) * cap;
      const [x, z] = superellipse(v * Math.PI * 2, 2.6);
      return [x * w, y, (z0 + z1) / 2 + z * (z1 - z0) / 2 * cap];
    }), material);
  }

  // A long, box-section cargo cabin with rounded corners and an upswept tail: one lofted skin.
  part(grid(110, 44, (t, v) => hull(mix(STATIONS[0][0], STATIONS.at(-1)[0], t), v * Math.PI * 2)), materials.paint);
  // Graphite lower body with a mustard belly band at its top edge, both following the skin.
  patch(-7.1, 6.9, Math.PI + 0.2, Math.PI * 2 - 0.2, materials.graphite, 0.012, 64, 16);
  for (const side of [-1, 1]) {
    const a = side > 0 ? 0 : Math.PI, s = side > 0 ? 1 : -1;
    patch(-7.1, 6.9, a - s * 0.13, a - s * 0.2, materials.mustard, 0.014, 64, 1);
    // Flight-deck side glass, chin windows below the windscreen and a row of small cabin windows.
    patch(-6.75, -5.55, a + s * 0.06, a + s * 0.52, materials.glass, 0.02, 6, 6);
    patch(-7.15, -6.45, a - s * 0.4, a - s * 0.12, materials.glass, 0.02, 6, 4);
    for (let i = 0; i < 6; i++) { const z = -3.6 + i * 1.25; patch(z, z + 0.48, a + s * 0.2, a + s * 0.36, materials.glass, 0.02, 3, 3); }
    // Crew door outline just aft of the flight deck.
    for (const z of [-5.35, -4.45]) patch(z - 0.025, z + 0.025, a - s * 0.1, a + s * 0.55, materials.ink, 0.024, 1, 8);
    // Fuel and gear sponsons along the lower cabin sides.
    ellipsoid(side * 1.48, -0.78, 0.2, 0.42, 0.42, 3.9, materials.graphite);
  }
  // Wide two-piece windscreen with a slim centre post.
  patch(-7.2, -6.35, Math.PI * 0.12, Math.PI * 0.88, materials.glass, 0.02, 10, 14);
  patch(-7.2, -6.35, Math.PI * 0.495, Math.PI * 0.505, materials.ink, 0.026, 10, 1);
  // Rear loading ramp outline under the upswept tail: hinge line, side seams and the ramp lip.
  patch(4.05, 4.11, BELLY - 0.62, BELLY + 0.62, materials.ink, 0.026, 1, 12);
  for (const s of [-1, 1]) patch(4.05, 7.45, BELLY + s * 0.62, BELLY + s * 0.66, materials.ink, 0.026, 24, 1);
  patch(7.4, 7.5, BELLY - 0.66, BELLY + 0.66, materials.ink, 0.026, 1, 12);

  // Low front pylon over the flight deck and a tall rear pylon at the tail, both capped in mustard.
  const front = { y0: 1.1, y1: 2.0, base: [-7.0, -3.9], top: [-6.25, -4.95], w0: 0.78, w1: 0.48 };
  const rear = { y0: 1.1, y1: 3.2, base: [2.6, 7.6], top: [5.15, 6.75], w0: 0.95, w1: 0.5 };
  pylon(front, materials.paint, 0, 0.7); pylon(front, materials.mustard, 0.7, 1);
  pylon(rear, materials.paint, 0, 0.62); pylon(rear, materials.mustard, 0.62, 1);
  rod([0, 2.0, D.frontZ], [0, D.frontY, D.frontZ], 0.15);
  rod([0, 3.25, D.rearZ], [0, D.rearY, D.rearZ], 0.17);
  // Twin engine pods either side of the rear pylon: mustard nacelles, dark intakes forward, exhausts aft.
  for (const side of [-1, 1]) {
    const x = side * 1.32;
    const nacelle = part(new THREE.CylinderGeometry(0.44, 0.44, 2.3, 18, 1, true), materials.mustard);
    nacelle.rotation.x = Math.PI / 2; nacelle.position.set(x, 1.95, 5.3);
    ellipsoid(x, 1.95, 4.15, 0.44, 0.44, 0.22, materials.mustard);
    ellipsoid(x, 1.95, 4.0, 0.3, 0.3, 0.06, materials.ink);
    rod([x, 1.95, 6.4], [x, 1.95, 7.05], 0.4, materials.metal, group, 0.3);
    ellipsoid(x, 1.95, 7.06, 0.29, 0.29, 0.04, materials.ink);
    rod([side * 0.55, 2.0, 5.0], [x - side * 0.3, 1.95, 5.0], 0.07, materials.graphite);
    rod([side * 0.55, 2.0, 5.9], [x - side * 0.3, 1.95, 5.9], 0.07, materials.graphite);
  }
  // Navigation and anti-collision lights.
  const light = color => new THREE.MeshBasicMaterial({ color });
  materials.red = light('hsl(0, 80%, 58%)'); materials.green = light('hsl(130, 70%, 52%)');
  ellipsoid(-1.88, -0.7, -2.5, 0.06, 0.06, 0.08, materials.red);
  ellipsoid(1.88, -0.7, -2.5, 0.06, 0.06, 0.08, materials.green);
  ellipsoid(0, 3.5, 6.85, 0.08, 0.08, 0.1, materials.red);
  ellipsoid(0, -1.17, 0, 0.08, 0.06, 0.1, materials.red);

  // Merge the static airframe by material; gear legs, rotors and sweeps stay on their own groups.
  group.updateMatrixWorld(true);
  const batches = new Map();
  for (const mesh of [...group.children]) if (mesh.isMesh) {
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    const list = batches.get(mesh.material) ?? []; list.push(flat); batches.set(mesh.material, list);
    group.remove(mesh); mesh.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    const name = material === materials.glass ? 'cabin glazing' : `tandem ${Object.keys(materials).find(k => materials[k] === material)}`;
    part(mergeGeometries(geometries), material, group, name); geometries.forEach(g => g.dispose());
  }

  // Fixed four-wheel gear: two wheels under the flight deck, two aft on the sponsons. Tyre bottoms at -groundClearance.
  const contact = -type.flight.groundClearance;
  function leg(name, x, z, radius, top, brace) {
    const g = new THREE.Group(); g.name = name; group.add(g);
    const hubY = contact + radius;
    rod(top, [x, hubY + radius * 0.3, z], 0.09, materials.metal, g);
    rod(brace, [x * 0.97, hubY + radius * 0.5, z], 0.055, materials.metal, g);
    const t = part(new THREE.CylinderGeometry(radius, radius, radius * 0.72, 20), materials.rubber, g, 'tyre');
    t.rotation.z = Math.PI / 2; t.position.set(x, hubY, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.76, 12), materials.metal, g);
    hub.rotation.z = Math.PI / 2; hub.position.copy(t.position);
    return g;
  }
  for (const side of [-1, 1]) {
    leg('fixed front gear', side * D.frontX, D.frontGearZ, D.frontWheel, [side * 1.05, -1.0, D.frontGearZ], [side * 0.6, -1.1, D.frontGearZ - 0.7]);
    leg('fixed rear gear', side * D.rearX, D.rearGearZ, D.rearWheel, [side * 1.55, -1.0, D.rearGearZ], [side * 1.2, -1.1, D.rearGearZ + 0.8]);
  }

  // Two counter-rotating three-blade rotors with chartreuse tips and faint sweep discs at speed.
  function rotor(name, y, z, phase) {
    const head = new THREE.Group(); head.name = name; head.position.set(0, y, z); head.rotation.y = phase; group.add(head);
    part(new THREE.CylinderGeometry(0.45, 0.45, 0.26, 18), materials.metal, head);
    part(new THREE.CylinderGeometry(0.18, 0.28, 0.32, 12), materials.ink, head).position.y = 0.28;
    for (let i = 0; i < type.rotor.blades; i++) {
      const blade = new THREE.Group(); blade.name = 'rotor blade'; blade.rotation.y = i * Math.PI * 2 / type.rotor.blades; head.add(blade);
      const airfoil = part(new THREE.BoxGeometry(D.rotorRadius - 0.95, 0.06, 0.72), materials.ink, blade);
      airfoil.position.x = (D.rotorRadius + 0.05) / 2 - 0.05; airfoil.rotation.x = -0.06;
      const tip = part(new THREE.BoxGeometry(0.55, 0.062, 0.72), materials.signal, blade); tip.position.x = D.rotorRadius - 0.275;
    }
    const sweep = part(new THREE.RingGeometry(1, D.rotorRadius + 0.05, 72), new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), group, 'rotor sweep');
    sweep.rotation.x = -Math.PI / 2; sweep.position.set(0, y, z); sweep.castShadow = false;
    return { head, sweep };
  }
  const fore = rotor('front rotor', D.frontY, D.frontZ, 0), aft = rotor('rear rotor', D.rearY, D.rearZ, Math.PI / 3);
  const frontRotor = fore.head, rearRotor = aft.head, sweeps = [fore.sweep, aft.sweep];

  return {
    group, materials, frontRotor, rearRotor,
    update(dt, collective = type.flight.hoverCollective, state = {}) {
      const rpm = clamp(state.rotorSpeed ?? 1, 0, 1), step = dt * rpm * type.rotor.rate;
      if (!state.crashed) {
        // Counter-rotating: the front head turns one way, the rear head the other, cancelling torque.
        frontRotor.rotation.y = (frontRotor.rotation.y + step) % (2 * Math.PI);
        rearRotor.rotation.y = (rearRotor.rotation.y - step) % (2 * Math.PI);
      }
      for (const s of sweeps) s.material.opacity = state.crashed ? 0 : rpm * 0.045;
    },
    get gearPosition() { return 1; },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

// Instrument panels in camera-local metres, sized and placed like the Sorna H8's so they sit in the same gaps the
// HUD leaves: a wide deck above the instrument strip on desktops, a compact strip between map and camera chip on phones.
export const COCKPIT = {
  wide: { width: 2.1, height: 0.44, x: 0, y: -0.43, pixels: [1260, 264] },
  compact: { width: 0.96, height: 0.27, x: -0.07, y: 0.16, pixels: [832, 234] },
  z: -1.835,
};

/** Camera-local two-pilot flight deck (left seat): low live panel, slim centre post, narrow door posts, overhead frame, chin frames. */
export function createTandemCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const mustard = new THREE.MeshStandardMaterial({ color: palette.mustard, roughness: 0.6 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // The pilot sits 0.5 m left of the centreline: the centre post and the overhead frame sit over the cabin centre.
  for (const x of [-1.5, 2.5]) bar([x, -1.5, -1.9], [x * 0.92, 1.45, -2.45], 0.042);
  bar([0.5, -0.66, -2.6], [0.5, 1.55, -2.7], 0.022);
  bar([-1.3, 1.6, -2.55], [2.3, 1.6, -2.55], 0.04, mustard);
  // Chin windows: a low sill and two slim frames below the panel keep the landing area in view.
  bar([-1.35, -1.38, -1.75], [2.35, -1.38, -1.75], 0.03, trim);
  for (const x of [-0.45, 1.45]) bar([x, -0.72, -1.9], [x, -1.38, -1.75], 0.022);
  // Cyclic ahead of the seat and the collective lever beside it.
  bar([0, -1.55, -1.25], [0, -1.12, -1.4], 0.03, trim);
  const grip = part(new THREE.BoxGeometry(0.08, 0.16, 0.08)); grip.position.set(0, -1.06, -1.42);
  bar([-0.62, -1.55, -1.2], [-0.62, -1.3, -1.6], 0.028, trim);
  const collective = part(new THREE.BoxGeometry(0.08, 0.06, 0.1), mustard); collective.position.set(-0.62, -1.28, -1.62);
  // Two fixed-size panels: a wide deck for desktops and a compact rotor/engine strip for phones.
  const panels = {};
  for (const [name, p] of Object.entries({ wide: COCKPIT.wide, compact: COCKPIT.compact })) {
    const group = new THREE.Group(); group.name = `${name} panel`; group.position.set(p.x, p.y, 0); root.add(group);
    const shell = part(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.06, 0.06), dark, group); shell.name = 'panel shell'; shell.position.z = COCKPIT.z - 0.04;
    const hood = part(new THREE.BoxGeometry(p.width + 0.06, 0.035, 0.22), trim, group); hood.position.set(0, p.height / 2 + 0.05, COCKPIT.z - 0.1);
    panels[name] = { group, ...p };
  }
  let layout = 'wide';
  const setLayout = name => { layout = name; panels.wide.group.visible = name === 'wide'; panels.compact.group.visible = name === 'compact'; };
  setLayout('wide');
  root.userData.panels = panels;
  root.userData.update = () => {};
  root.userData.fit = aspect => setLayout(aspect < 0.8 ? 'compact' : 'wide');
  if (typeof document === 'undefined') return root;

  const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)', line: 'hsl(205 15% 26%)' };
  for (const p of Object.values(panels)) {
    p.canvas = document.createElement('canvas'); [p.canvas.width, p.canvas.height] = p.pixels;
    p.ctx = p.canvas.getContext('2d'); p.texture = new THREE.CanvasTexture(p.canvas); p.texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshBasicMaterial({ map: p.texture, toneMapped: false }), p.group);
    screen.name = 'panel screen'; screen.position.z = COCKPIT.z;
  }
  const draw = (ctx, size, label, x, y, color = colors.ink, align = 'left', weight = 500, family = 'DM Sans') => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px "${family}", sans-serif`; ctx.textAlign = align; ctx.fillText(label, x, y);
  };
  // A labelled bar: label on the left, value on the right, optional ivory mark (the hover collective).
  function gauge(ctx, x, y, width, label, amount, shown, scale, mark = null, labelWidth = 170) {
    draw(ctx, 26 * scale, label, x, y, colors.muted, 'left', 400);
    const barX = x + labelWidth * scale, barW = width - labelWidth * scale - 120 * scale, h = 16 * scale;
    ctx.fillStyle = colors.line; ctx.fillRect(barX, y - h, barW, h);
    ctx.fillStyle = colors.signal; ctx.fillRect(barX, y - h, barW * clamp(amount, 0, 1), h);
    if (mark !== null) { ctx.fillStyle = colors.ink; ctx.fillRect(barX + barW * mark - 2, y - h - 7 * scale, 4, h + 14 * scale); }
    draw(ctx, 40 * scale, shown, x + width, y + 4 * scale, colors.ink, 'right', 500, 'Barlow Condensed');
  }
  let last = '';
  root.userData.update = state => {
    const f = type.flight, rpm = clamp(state.rotorSpeed ?? 0, 0, 1), spool = clamp(state.spool ?? state.throttle ?? 0, 0, 1);
    const collective = clamp(state.throttle ?? 0, 0, 1), torque = spool * rpm;
    const mode = state.autopilot ? 'HOVER HOLD' : state.grounded ? 'ON WHEELS' : 'MANUAL';
    const values = [layout, Math.round(state.speed * 1.94384), Math.round(state.position.y * 3.28084), Math.round((state.verticalSpeed ?? 0) * 196.85 / 10) * 10,
      Math.round(collective * 100), Math.round(rpm * 100), Math.round(torque * 100), Math.round(state.bank * 60), Math.round(state.pitch * 60), mode];
    if (values.join() === last) return; last = values.join();
    const p = panels[layout], ctx = p.ctx, [w, h] = p.pixels;
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, w, h);
    // Both rotors share one simulated speed and both turbines one torque; the labels say so.
    const rows = [['NR 1·2 shared', rpm, `${values[5]}%`, null], ['Collective', collective, `${values[4]}%`, f.hoverCollective], ['TQ 1·2 shared', torque, `${values[6]}%`, null]];
    if (layout === 'compact') {
      draw(ctx, 28, `${type.name.toUpperCase()} · ROTORS / ENGINES`, 22, 34, colors.muted, 'left', 500);
      draw(ctx, 28, mode, w - 22, 34, colors.signal, 'right', 600);
      rows.forEach(([label, amount, shown, mark], i) => gauge(ctx, 22, 96 + i * 56, w - 44, label, amount, shown, 1.15, mark, 175));
    } else {
      draw(ctx, 26, `${type.name.toUpperCase()}   /   ${type.registration}`, 24, 36, colors.muted);
      draw(ctx, 26, mode, w - 24, 36, colors.signal, 'right', 600);
      ctx.save(); ctx.beginPath(); ctx.rect(24, 52, 210, 200); ctx.clip(); ctx.translate(129, 152); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 150);
      ctx.fillStyle = colors.sky; ctx.fillRect(-300, -300, 600, 300); ctx.fillStyle = colors.earth; ctx.fillRect(-300, 0, 600, 300);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-290, 0); ctx.lineTo(290, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(79, 152); ctx.lineTo(111, 152); ctx.lineTo(129, 162); ctx.lineTo(147, 152); ctx.lineTo(179, 152); ctx.stroke();
      [['Speed / kt', values[1]], ['Alt / ft', values[2]], ['VSI / fpm', `${values[3] > 0 ? '+' : ''}${values[3]}`]].forEach(([label, shown], i) => {
        draw(ctx, 24, label, 262, 96 + i * 66, colors.muted, 'left', 400);
        draw(ctx, 44, String(shown), 480, 100 + i * 66, colors.ink, 'right', 500, 'Barlow Condensed');
      });
      ctx.fillStyle = colors.line; ctx.fillRect(506, 54, 2, 196);
      rows.forEach(([label, amount, shown, mark], i) => gauge(ctx, 534, 98 + i * 60, w - 558, label, amount, shown, 1, mark, 190));
      draw(ctx, 24, 'Both rotors share one simulated speed and torque', 534, 252, colors.muted, 'left', 400);
    }
    p.texture.needsUpdate = true;
  };
  return root;
}

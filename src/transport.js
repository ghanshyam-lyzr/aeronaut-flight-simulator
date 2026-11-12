import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { transport as type } from './transport-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
// Ivory airframe with a slate lower body and fin, a thin sand cheat line and chartreuse blade tips.
const palette = {
  shell: 'hsl(48, 20%, 90%)', slate: 'hsl(214, 30%, 27%)', sand: 'hsl(38, 45%, 62%)', ink: 'hsl(205, 21%, 13%)',
  glass: 'hsl(199, 34%, 20%)', metal: 'hsl(200, 11%, 63%)', rubber: 'hsl(210, 15%, 9%)', signal: 'hsl(77, 88%, 67%)',
};
// Metres; nose -Z, rotor axis +Y, tail +Z. Main rotor radius, mast head and ducted tail rotor centre.
export const D = { rotorRadius: 7, rotorY: 2.32, rotorZ: 0.1, fanRadius: 0.6, fanY: 1.1, fanZ: 10.6, wheel: 0.36, noseWheel: 0.3, mainX: 1.5, mainZ: 0.9, noseZ: -3.2 };
// Fuselage stations: z, half width, half height, centre height, superellipse exponent (2 round, larger boxier).
const STATIONS = [
  [-4.45, 0.12, 0.14, -0.2, 2], [-4.2, 0.62, 0.62, -0.12, 2.1], [-3.5, 1.02, 0.98, 0, 2.4], [-2.6, 1.24, 1.12, 0.08, 2.9],
  [-1.6, 1.3, 1.16, 0.1, 3.3], [1.7, 1.3, 1.16, 0.1, 3.3], [2.7, 1.05, 1, 0.28, 3], [3.9, 0.55, 0.62, 0.62, 2.5],
  [5.5, 0.32, 0.38, 0.82, 2.2], [9.4, 0.22, 0.28, 0.98, 2], [10, 0.06, 0.1, 1, 2],
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
/** A point on the hull skin, `lift` metres proud of it. Angle 0 is the right side, π/2 the roof. */
function hull(z, angle, lift = 0) {
  const st = station(z), [x, y] = superellipse(angle, st.n);
  return [x * (st.w + lift), st.y + y * (st.h + lift), z];
}

/** Original procedural Sorna H8 medium transport helicopter; no textures, assets or model downloads. */
export function createTransport() {
  const group = new THREE.Group(); group.name = `${type.name} — ${type.registration}`;
  const standard = (color, roughness = 0.35, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.28, metalness: 0.12, clearcoat: 0.85, side: THREE.DoubleSide }),
    slate: new THREE.MeshPhysicalMaterial({ color: palette.slate, roughness: 0.32, metalness: 0.15, clearcoat: 0.8, side: THREE.DoubleSide }),
    sand: standard(palette.sand, 0.4), ink: standard(palette.ink, 0.5, 0.4), metal: standard(palette.metal, 0.25, 0.85),
    rubber: standard(palette.rubber, 0.88), signal: standard(palette.signal, 0.45),
    glass: new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.07, metalness: 0.5, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  function part(geometry, material, parent = group, name = '') {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const m = part(new THREE.SphereGeometry(1, 24, 14), material, parent);
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

  // A long, rounded passenger cabin that tapers into the tail boom: one lofted skin.
  part(grid(80, 40, (t, v) => hull(mix(STATIONS[0][0], STATIONS.at(-1)[0], t), v * Math.PI * 2)), materials.paint);
  // Slate lower body under a thin sand cheat line; both follow the skin.
  patch(-4.3, 3.6, Math.PI + 0.13, Math.PI * 2 - 0.13, materials.slate, 0.012, 48, 16);
  for (const side of [-1, 1]) {
    const a = side > 0 ? 0 : Math.PI, s = side > 0 ? 1 : -1;
    patch(-4.3, 3.6, a - s * 0.08, a - s * 0.12, materials.sand, 0.014, 48, 1);
    // Cockpit door glass, three square cabin windows each side and a framed sliding door outline.
    patch(-2.95, -1.95, a + s * 0.08, a + s * 0.5, materials.glass, 0.02, 6, 6);
    for (const [z0, z1] of [[-1.15, -0.5], [-0.15, 0.5], [0.85, 1.5]]) patch(z0, z1, a + s * 0.12, a + s * 0.42, materials.glass, 0.02, 4, 4);
    for (const z of [-0.33, 1.68]) patch(z - 0.025, z + 0.025, a - s * 0.06, a + s * 0.62, materials.ink, 0.024, 1, 10);
    // Chin windows below the windscreen keep the landing area visible.
    patch(-4.1, -3.45, a - s * 0.32, a - s * 0.1, materials.glass, 0.02, 6, 4);
  }
  // Wide, two-piece windscreen with a slim centre divider.
  patch(-4.12, -2.95, Math.PI * 0.12, Math.PI * 0.88, materials.glass, 0.02, 10, 14);
  patch(-4.12, -2.95, Math.PI * 0.495, Math.PI * 0.505, materials.ink, 0.026, 10, 1);

  // Twin turbine housings on a roof fairing: front intakes, angled exhausts aft.
  part(grid(20, 18, (t, v) => { const z = mix(-1.55, 2.7, t), r = Math.sin(Math.PI * t) ** 0.35, [x, y] = superellipse(v * Math.PI * 2, 3);
    return [x * 0.95 * r, 1.18 + Math.max(0, y) * 0.24 * r, z]; }), materials.paint);
  for (const side of [-1, 1]) {
    ellipsoid(side * 0.5, 1.48, 0.45, 0.4, 0.34, 1.6, materials.paint);
    ellipsoid(side * 0.5, 1.48, -1.12, 0.27, 0.23, 0.05, materials.ink);
    rod([side * 0.52, 1.5, 1.85], [side * 0.86, 1.56, 2.35], 0.17, materials.metal, group, 0.2);
    ellipsoid(side * 0.86, 1.56, 2.36, 0.19, 0.19, 0.04, materials.ink);
  }
  rod([0, 1.6, D.rotorZ], [0, D.rotorY, D.rotorZ], 0.13);

  // Fin with an enclosed (ducted) tail rotor, a slate fin cap, and a horizontal stabilizer with end plates.
  const fin = new THREE.Shape();
  fin.moveTo(9.25, 0.68); fin.lineTo(10.95, 0.2); fin.lineTo(11.9, 0.35); fin.lineTo(12.05, 1); fin.lineTo(12.6, 2.95);
  fin.lineTo(12.2, 2.95); fin.lineTo(11.35, 1.95); fin.lineTo(10.2, 1.95); fin.lineTo(9.25, 1.15); fin.closePath();
  const duct = new THREE.Path(); duct.absarc(D.fanZ, D.fanY, D.fanRadius, 0, Math.PI * 2, true); fin.holes.push(duct);
  const finGeometry = new THREE.ExtrudeGeometry(fin, { depth: 0.5, bevelEnabled: false, curveSegments: 24 });
  // Shape X becomes tail Z and shape Y stays world Y; centre the extrusion on the boom.
  finGeometry.rotateY(-Math.PI / 2); finGeometry.translate(0.25, 0, 0);
  part(finGeometry, materials.slate);
  const ductWall = part(new THREE.CylinderGeometry(D.fanRadius, D.fanRadius, 0.5, 32, 1, true), materials.ink);
  ductWall.rotation.z = Math.PI / 2; ductWall.position.set(0, D.fanY, D.fanZ);
  for (const side of [-1, 1]) {
    const lip = part(new THREE.TorusGeometry(D.fanRadius + 0.02, 0.035, 8, 40), materials.sand);
    lip.rotation.y = Math.PI / 2; lip.position.set(side * 0.26, D.fanY, D.fanZ);
  }
  rod([-0.2, D.fanY, D.fanZ], [0.2, D.fanY, D.fanZ], 0.08, materials.metal);
  box(0, 0.96, 8.75, 3.3, 0.08, 0.7, materials.paint);
  for (const side of [-1, 1]) box(side * 1.65, 1.05, 8.8, 0.06, 0.55, 0.75, materials.slate);

  // Fixed wheeled landing gear: sponsons carry the mains, a strutted nose wheel ahead.
  const tyre = -type.flight.groundClearance;
  function wheel(x, y, z, radius) {
    const t = part(new THREE.CylinderGeometry(radius, radius, radius * 0.7, 18), materials.rubber, group, 'tyre');
    t.rotation.z = Math.PI / 2; t.position.set(x, y, z);
    const hub = part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.74, 12), materials.metal);
    hub.rotation.z = Math.PI / 2; hub.position.copy(t.position);
  }
  for (const side of [-1, 1]) {
    ellipsoid(side * 1.28, -0.72, D.mainZ, 0.42, 0.3, 1.3, materials.slate);
    rod([side * 1.35, -0.8, D.mainZ], [side * D.mainX, tyre + D.wheel, D.mainZ], 0.08);
    rod([side * 1.05, -0.9, D.mainZ - 0.55], [side * (D.mainX - 0.1), tyre + D.wheel + 0.1, D.mainZ], 0.05);
    wheel(side * D.mainX, tyre + D.wheel, D.mainZ, D.wheel);
  }
  rod([0, -0.95, D.noseZ], [0, tyre + D.noseWheel, D.noseZ], 0.07);
  wheel(0, tyre + D.noseWheel, D.noseZ, D.noseWheel);
  // Navigation and anti-collision lights.
  const light = color => new THREE.MeshBasicMaterial({ color });
  materials.red = light('hsl(0, 80%, 58%)'); materials.green = light('hsl(130, 70%, 52%)');
  ellipsoid(-1.62, -0.6, D.mainZ + 0.4, 0.06, 0.06, 0.08, materials.red);
  ellipsoid(1.62, -0.6, D.mainZ + 0.4, 0.06, 0.06, 0.08, materials.green);
  ellipsoid(0, 1.32, 3.1, 0.07, 0.07, 0.1, materials.red);

  // Merge the static airframe by material; rotors stay independently animated.
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
    const name = material === materials.glass ? 'cabin glazing' : material === materials.rubber ? 'wheels' : `transport ${Object.keys(materials).find(k => materials[k] === material)}`;
    part(mergeGeometries(geometries), material, group, name); geometries.forEach(g => g.dispose());
  }

  // Five-blade main rotor with chartreuse tips and a faint disc at speed.
  const mainRotor = new THREE.Group(); mainRotor.name = 'main rotor'; mainRotor.position.set(0, D.rotorY, D.rotorZ); group.add(mainRotor);
  part(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 20), materials.metal, mainRotor);
  part(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 12), materials.ink, mainRotor).position.y = 0.24;
  for (let i = 0; i < type.rotor.blades; i++) {
    const blade = new THREE.Group(); blade.name = 'main blade'; blade.rotation.y = i * Math.PI * 2 / type.rotor.blades; mainRotor.add(blade);
    const airfoil = part(new THREE.BoxGeometry(D.rotorRadius - 0.75, 0.05, 0.38), materials.ink, blade); airfoil.position.x = (D.rotorRadius + 0.35) / 2; airfoil.rotation.x = -0.07;
    const tip = part(new THREE.BoxGeometry(0.4, 0.052, 0.38), materials.signal, blade); tip.position.x = D.rotorRadius - 0.2;
  }
  const sweep = part(new THREE.RingGeometry(1, D.rotorRadius + 0.05, 72), new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), group, 'rotor sweep');
  sweep.rotation.x = -Math.PI / 2; sweep.position.set(0, D.rotorY, D.rotorZ); sweep.castShadow = false;
  // Enclosed tail rotor: ten blades turning inside the duct about the lateral axis.
  const tailRotor = new THREE.Group(); tailRotor.name = 'tail rotor'; tailRotor.position.set(0, D.fanY, D.fanZ); group.add(tailRotor);
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, blade = part(new THREE.BoxGeometry(0.03, D.fanRadius - 0.14, 0.12), materials.ink, tailRotor, 'tail blade');
    blade.rotation.x = a; blade.position.set(0, Math.cos(a) * (D.fanRadius + 0.1) / 2, Math.sin(a) * (D.fanRadius + 0.1) / 2);
  }

  return {
    group, materials, mainRotor, tailRotor,
    update(dt, collective = type.flight.hoverCollective, state = {}) {
      const rpm = clamp(state.rotorSpeed ?? 1, 0, 1);
      if (!state.crashed) {
        mainRotor.rotation.y = (mainRotor.rotation.y + dt * rpm * type.rotor.rate) % (2 * Math.PI);
        tailRotor.rotation.x = (tailRotor.rotation.x + dt * rpm * type.rotor.tailRate) % (2 * Math.PI);
      }
      sweep.material.opacity = state.crashed ? 0 : rpm * 0.05;
    },
    get gearPosition() { return 1; },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

// Instrument panels in camera-local metres. Each sits in the gap the default HUD leaves: above the instrument
// strip, between the camera chip and the navigation map on desktops; on phones, a full-width strip between the
// map and the camera chip, above the touch controls.
export const COCKPIT = {
  wide: { width: 2.1, height: 0.44, x: 0, y: -0.43, pixels: [1260, 264] },
  // Shifted left of the phone's map and instrument toggles on the right edge.
  compact: { width: 0.96, height: 0.27, x: -0.07, y: 0.16, pixels: [832, 234] },
  z: -1.835,
};

/** Camera-local transport deck: a low live panel, narrow door posts, a slim windscreen divider and a collective lever. */
export function createTransportCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const slate = new THREE.MeshStandardMaterial({ color: palette.slate, roughness: 0.6 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  // The pilot sits left of the centreline; the divider and the overhead beam sit over the cabin centre.
  for (const x of [-1.45, 2.05]) bar([x, -1.5, -1.9], [x * 0.92, 1.45, -2.4], 0.045);
  bar([0.55, -0.62, -2.55], [0.55, 1.55, -2.65], 0.025);
  bar([-1.2, 1.62, -2.5], [1.8, 1.62, -2.5], 0.04, slate);
  // Cyclic ahead of the seat and the collective lever beside it.
  bar([0, -1.55, -1.25], [0, -1.12, -1.4], 0.03, trim);
  const grip = part(new THREE.BoxGeometry(0.08, 0.16, 0.08)); grip.position.set(0, -1.06, -1.42);
  bar([-0.62, -1.55, -1.2], [-0.62, -1.3, -1.6], 0.028, trim);
  const collective = part(new THREE.BoxGeometry(0.08, 0.06, 0.1), slate); collective.position.set(-0.62, -1.28, -1.62);
  // Two fixed-size panels instead of one squeezed one: a wide deck for desktops and a compact rotor/engine strip for phones.
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
    // Both turbine readouts are driven by one simulated torque value, and the labels say so.
    const rows = [['Rotor NR', rpm, `${values[5]}%`, null], ['Collective', collective, `${values[4]}%`, f.hoverCollective], ['TQ 1·2 shared', torque, `${values[6]}%`, null]];
    if (layout === 'compact') {
      // Phones: the HUD already shows speed, altitude and VSI, so the strip carries rotor, collective and engines only.
      draw(ctx, 28, `${type.name.toUpperCase()} · ROTOR / ENGINES`, 22, 34, colors.muted, 'left', 500);
      draw(ctx, 28, mode, w - 22, 34, colors.signal, 'right', 600);
      rows.forEach(([label, amount, shown, mark], i) => gauge(ctx, 22, 96 + i * 56, w - 44, label, amount, shown, 1.15, mark, 175));
    } else {
      draw(ctx, 26, `${type.name.toUpperCase()}   /   ${type.registration}`, 24, 36, colors.muted);
      draw(ctx, 26, mode, w - 24, 36, colors.signal, 'right', 600);
      // Attitude: horizon behind a fixed chartreuse aircraft symbol.
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
      draw(ctx, 24, 'Both turbines share one simulated torque', 534, 252, colors.muted, 'left', 400);
    }
    p.texture.needsUpdate = true;
  };
  return root;
}

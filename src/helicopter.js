import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const palette = {
  shell: 'hsl(48, 18%, 89%)', rescue: 'hsl(9, 73%, 48%)', ink: 'hsl(205, 21%, 13%)',
  glass: 'hsl(197, 32%, 22%)', metal: 'hsl(200, 11%, 63%)', signal: 'hsl(77, 88%, 67%)',
};
const material = (color, roughness = 0.35, metalness = 0.25) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Original Laret H4 light helicopter. Metres; nose -Z, rotor axis +Y, tail +Z. */
export function createHelicopter() {
  const group = new THREE.Group();
  group.name = 'Laret H4 — A-LH04';
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.27, metalness: 0.12, clearcoat: 0.85 }),
    rescue: new THREE.MeshPhysicalMaterial({ color: palette.rescue, roughness: 0.3, metalness: 0.15, clearcoat: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.07, metalness: 0.5, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    ink: material(palette.ink), metal: material(palette.metal, 0.25, 0.85), signal: material(palette.signal),
  };
  function part(geometry, mat, parent = group, name = '') {
    const m = new THREE.Mesh(geometry, mat); m.name = name;
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }
  function ellipsoid(x, y, z, sx, sy, sz, mat) {
    const m = part(new THREE.SphereGeometry(1, 36, 24), mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function rod(a, b, radius, mat = materials.metal, parent = group) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = part(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 10), mat, parent);
    m.position.copy(start).add(end).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return m;
  }
  function tube(points, radius, mat) {
    return part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 30, radius, 8, false), mat);
  }
  // A broad, rounded cabin and a lower rescue-red belly; the glazing follows the cabin exactly.
  ellipsoid(0, 0.05, -0.65, 1.27, 1.26, 2.2, materials.paint);
  ellipsoid(0, -0.55, -0.7, 1.21, 0.65, 1.99, materials.rescue);
  ellipsoid(0, 1.05, 0.45, 0.72, 0.65, 1.3, materials.rescue);
  const hull = (theta, phi) => [1.285 * Math.sin(theta) * Math.sin(phi), 0.05 + 1.275 * Math.cos(theta), -0.65 - 2.218 * Math.sin(theta) * Math.cos(phi)];
  function window(phi0, phi1, theta0 = 0.38, theta1 = 1.6) {
    const vertices = [], indices = [], rows = 14, cols = 18;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) vertices.push(...hull(THREE.MathUtils.lerp(theta0, theta1, i / rows), THREE.MathUtils.lerp(phi0, phi1, j / cols)));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    part(geo, materials.glass, group, 'cabin glazing');
    for (const theta of [theta0, theta1]) tube(Array.from({ length: 13 }, (_, i) => hull(theta, THREE.MathUtils.lerp(phi0, phi1, i / 12))), 0.025, materials.ink);
    for (const phi of [phi0, phi1]) tube(Array.from({ length: 10 }, (_, i) => hull(THREE.MathUtils.lerp(theta0, theta1, i / 9), phi)), 0.025, materials.ink);
  }
  window(-1.14, -0.025); window(0.025, 1.14);
  window(1.23, 2.16, 0.55, 1.68); window(-2.16, -1.23, 0.55, 1.68);
  for (const side of [-1, 1]) {
    rod([side * 1.25, -0.25, 0.1], [side * 1.25, -0.25, 0.4], 0.035, materials.ink);
    // Long curved skids curl upwards at the front; their soles lie 1.6 m below the origin.
    tube([[side * 1.2, -1.285, -2.35], [side * 1.3, -1.495, -1.95], [side * 1.3, -1.505, 0], [side * 1.3, -1.505, 1.8]], 0.06, materials.ink);
    for (const z of [-1.1, 1]) rod([side * 0.7, -0.7, z], [side * 1.3, -1.5, z + 0.1], 0.065);
  }
  // Tapered tail boom, fin, horizontal stabilizer and a visible anti-torque rotor.
  const boom = part(new THREE.CylinderGeometry(0.14, 0.48, 5.2, 24), materials.paint);
  boom.position.set(0, 0.52, 3.8); boom.rotation.x = Math.PI / 2 - 0.055;
  const finShape = new THREE.Shape();
  finShape.moveTo(5.3, 0.6); finShape.lineTo(6.5, 2.5); finShape.lineTo(6.9, 2.5); finShape.lineTo(6.65, -0.1); finShape.closePath();
  const finGeometry = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
  // Shape X is tail Z, shape Y is world Y.
  finGeometry.rotateY(-Math.PI / 2);
  part(finGeometry, materials.rescue);
  const stabilizer = part(new THREE.BoxGeometry(2.6, 0.075, 0.6), materials.rescue);
  stabilizer.position.set(0, 0.55, 5.3);
  rod([0, 1.25, 0], [0, 2.2, 0], 0.11);
  const mainRotor = new THREE.Group(); mainRotor.name = 'main rotor'; mainRotor.position.set(0, 2.15, 0); group.add(mainRotor);
  part(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 16), materials.metal, mainRotor);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group(); blade.rotation.y = i * Math.PI * 2 / 3; mainRotor.add(blade);
    const airfoil = part(new THREE.BoxGeometry(5.1, 0.045, 0.25), materials.ink, blade); airfoil.position.x = 2.75; airfoil.rotation.x = -0.08;
    const tip = part(new THREE.BoxGeometry(0.28, 0.048, 0.26), materials.signal, blade); tip.position.x = 5.16;
  }
  const sweep = part(new THREE.RingGeometry(0.8, 5.3, 64), new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), group, 'rotor sweep');
  sweep.rotation.x = -Math.PI / 2; sweep.position.y = 2.15; sweep.castShadow = false;
  const tailRotor = new THREE.Group(); tailRotor.name = 'tail rotor'; tailRotor.position.set(0.35, 0.95, 6.45); group.add(tailRotor);
  rod([-0.2, 0, 0], [0.15, 0, 0], 0.1, materials.metal, tailRotor);
  for (let i = 0; i < 4; i++) {
    const blade = part(new THREE.BoxGeometry(0.045, 0.88, 0.14), materials.ink, tailRotor);
    blade.rotation.x = i * Math.PI / 2;
    blade.position.set(0.12, Math.cos(blade.rotation.x) * 0.45, Math.sin(blade.rotation.x) * 0.45);
  }
  // Merge only the static hull by material; rotors remain independently animated.
  group.updateMatrixWorld(true);
  for (const [name, mat] of Object.entries(materials)) {
    const meshes = group.children.filter(m => m.isMesh && m.material === mat);
    const geometries = meshes.map(m => {
      let geo = m.geometry.clone().applyMatrix4(m.matrix);
      if (geo.index) { const indexed = geo; geo = indexed.toNonIndexed(); indexed.dispose(); }
      geo.deleteAttribute('uv');
      return geo;
    });
    if (!geometries.length) continue;
    const merged = mergeGeometries(geometries);
    geometries.forEach(geo => geo.dispose());
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); }
    part(merged, mat, group, name === 'glass' ? 'cabin glazing' : `helicopter ${name}`);
  }
  return {
    group, materials, mainRotor, tailRotor,
    update(dt, collective = 0.58, state = {}) {
      const rpm = Math.max(0, Math.min(1, state.rotorSpeed ?? 1));
      if (!state.crashed) { mainRotor.rotation.y = (mainRotor.rotation.y + dt * rpm * 38) % (2 * Math.PI); tailRotor.rotation.x = (tailRotor.rotation.x + dt * rpm * 130) % (2 * Math.PI); }
      sweep.material.opacity = state.crashed ? 0 : rpm * 0.055;
    },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

/** Camera-local helicopter panel: open glazing and live telemetry, with every surface beyond the 1 m near plane. */
export function createHelicopterCockpit() {
  const cockpit = new THREE.Group(); cockpit.name = 'Laret H4 — cockpit';
  const ink = material(palette.ink, 0.8, 0.1), metal = material(palette.metal, 0.3, 0.65);
  const panel = new THREE.Group(); cockpit.add(panel);
  const part = (geo, mat, x, y, z, parent = cockpit) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  // A narrow central pedestal leaves downward visibility through the bubble cabin.
  part(new THREE.BoxGeometry(1.36, 0.57, 0.24), ink, 0, -0.53, -2.1, panel);
  part(new THREE.BoxGeometry(1.48, 0.055, 0.38), ink, 0, -0.22, -2.1, panel);
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([[side * 2, -1.6, -2], [side * 1.85, 0, -2.25], [side * 1.35, 1.3, -2.5], [side * 0.4, 1.75, -2.5]].map(p => new THREE.Vector3(...p)));
    part(new THREE.TubeGeometry(curve, 24, 0.036, 8, false), ink, 0, 0, 0);
    part(new THREE.BoxGeometry(0.04, 0.04, 1), metal, side * 1.8, -1.2, -1.8);
  }
  // Canvas instruments show the actual flight state, rather than painted cruise values.
  let texture, canvas, ctx, lastText = '';
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 360; ctx = canvas.getContext('2d');
    texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    part(new THREE.PlaneGeometry(1.26, 0.44), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), 0, -0.52, -1.97, panel);
  }
  cockpit.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.5, aspect / 0.9)); panel.position.y = aspect < 0.8 ? 0.18 : 0; };
  cockpit.userData.update = state => {
    if (!ctx) return;
    const values = [Math.round(state.speed * 1.94384), Math.round(state.position.y * 3.28084), Math.round(state.verticalSpeed * 196.85), Math.round(state.throttle * 100), Math.round(state.rotorSpeed * 100), state.autopilot];
    if (values.join() === lastText) return; lastText = values.join();
    ctx.fillStyle = palette.ink; ctx.fillRect(0, 0, 1024, 360);
    ctx.textAlign = 'left'; ctx.fillStyle = palette.shell; ctx.font = '500 25px "DM Sans", sans-serif'; ctx.fillText('LARET H4   /   A-LH04', 28, 44);
    ctx.fillStyle = palette.signal; ctx.font = '500 26px "DM Sans", sans-serif'; ctx.textAlign = 'right'; ctx.fillText(state.autopilot ? 'HOVER HOLD' : 'MANUAL', 995, 44);
    for (let i = 0; i < 3; i++) {
      const x = 28 + i * 333; ctx.textAlign = 'left'; ctx.fillStyle = palette.metal; ctx.font = '24px "DM Sans", sans-serif'; ctx.fillText(['AIRSPEED / KT', 'ALTITUDE / FT', 'VSI / FT/MIN'][i], x, 105);
      ctx.fillStyle = palette.shell; ctx.font = '500 74px "Barlow Condensed", sans-serif'; ctx.fillText(String(values[i]), x, 197);
    }
    ctx.fillStyle = palette.metal; ctx.font = '25px "DM Sans", sans-serif'; ctx.fillText(`COLL ${values[3]}%    NR ${values[4]}%    FIXED SKIDS`, 28, 267);
    ctx.fillStyle = palette.signal; ctx.font = '23px "DM Sans", sans-serif'; ctx.fillText('58% HOVER   ·   SPACE: HOVER HOLD', 28, 326); texture.needsUpdate = true;
  };
  return cockpit;
}

export function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { materials.add(m); if (m.map) textures.add(m.map); } });
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = THREE.MathUtils.clamp;
const ease = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));

// Original procedural 737-800 with blended winglets, nose along local -Z, units in metres.
// Boeing D6-58325-7 Rev C §2.2.6: length 39.47 m, span 35.79 m, height 12.55 m.
// This is a visual approximation, not Boeing model data or a systems simulation.
export function create737() {
  const group = new THREE.Group();
  group.name = 'Boeing 737-800 — A-B738';
  const palette = {
    shell: 'hsl(48, 22%, 91%)', teal: 'hsl(188, 48%, 22%)', coral: 'hsl(12, 79%, 56%)',
    glass: 'hsl(202, 38%, 17%)', metal: 'hsl(203, 12%, 65%)', rubber: 'hsl(204, 22%, 9%)',
  };
  const paint = new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.3, metalness: 0.12, clearcoat: 0.8 });
  const teal = new THREE.MeshPhysicalMaterial({ color: palette.teal, roughness: 0.3, metalness: 0.15, clearcoat: 0.8 });
  const coral = new THREE.MeshStandardMaterial({ color: palette.coral, roughness: 0.35, metalness: 0.15 });
  const glass = new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.1, metalness: 0.55, clearcoat: 1, envMapIntensity: 1.5 });
  const metal = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.3, metalness: 0.85 });
  const seam = new THREE.MeshStandardMaterial({ color: 'hsl(200, 10%, 47%)', roughness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: palette.rubber, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(202, 20%, 13%)', roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  const materials = { paint, teal, coral, glass, metal, seam, rubber, dark };
  const engines = [], navigation = [], gearLegs = [], surfaces = {};
  function mesh(geometry, material, parent = group) {
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const object = mesh(new THREE.SphereGeometry(1, 32, 18), material, parent);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    return object;
  }
  function line(points, radius = 0.012, material = seam, parent = group) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), radius, 5, false), material, parent);
  }
  function rod(a, b, radius, material, parent = group) {
    const p1 = new THREE.Vector3(...a), p2 = new THREE.Vector3(...b);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, p1.distanceTo(p2), 12), material, parent);
    object.position.copy(p1).add(p2).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.sub(p1).normalize());
    return object;
  }
  function interpolate(stations, z) {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
    const a = stations[Math.max(0, i - 1)], b = stations[i];
    const c = stations[i + 1], d = stations[Math.min(stations.length - 1, i + 2)];
    const t = clamp((z - b[0]) / (c[0] - b[0]), 0, 1);
    return [1, 2, 3].map(k => {
      const v0 = (c[k] - a[k]) * 0.5, v1 = (d[k] - b[k]) * 0.5;
      return (2 * b[k] - 2 * c[k] + v0 + v1) * t ** 3 + (-3 * b[k] + 3 * c[k] - 2 * v0 - v1) * t ** 2 + v0 * t + b[k];
    });
  }
  function grid(rings, sides, vertex) {
    const vertices = [], indices = [];
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= sides; j++) vertices.push(...vertex(i / rings, j / sides));
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  // Elliptical station loft: smooth longitudinal curvature, no faceted primitives.
  function loft(stations, material, xOffset = 0, yOffset = 0, rings = 64, sides = 48) {
    const z0 = stations[0][0], z1 = stations[stations.length - 1][0];
    return mesh(grid(rings, sides, (s, v) => {
      const z = THREE.MathUtils.lerp(z0, z1, s), [rx, ry, cy] = interpolate(stations, z), angle = v * Math.PI * 2;
      return [xOffset + Math.max(0.002, rx) * Math.cos(angle), yOffset + cy + Math.max(0.002, ry) * Math.sin(angle), z];
    }), material);
  }

  function airfoil(u, chord, thick, camber) {
    const t = 5 * thick * chord * (0.2969 * Math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4);
    return [Math.sin(Math.PI * u) * chord * camber, t];
  }
  function sectionPoint(spec, t, u, top) {
    const s = spec.section(t), [c, th] = airfoil(u, s.chord, spec.thick, spec.camber ?? 0);
    const offset = c + (top ? th : -th);
    const p = new THREE.Vector3(s.x, s.y, s.z + s.chord * u);
    if (spec.vertical) p.x += offset; else p.y += offset;
    p.x *= spec.side ?? 1;
    return p;
  }
  function surfaceGeometry(spec, t0, t1, u0, u1, segments = 16, ring = 36) {
    const vertices = [], indices = [];
    const loop = j => {
      const a = j / ring * Math.PI * 2;
      return [u0 + (u1 - u0) * (1 - Math.cos(a)) * 0.5, a <= Math.PI];
    };
    for (let i = 0; i <= segments; i++) for (let j = 0; j <= ring; j++) {
      const [u, top] = loop(j);
      vertices.push(...sectionPoint(spec, THREE.MathUtils.lerp(t0, t1, i / segments), u, top).toArray());
    }
    for (let i = 0; i < segments; i++) for (let j = 0; j < ring; j++) {
      const a = i * (ring + 1) + j, b = a + ring + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    // End caps get their own vertices so they stay crisp.
    for (const end of [0, segments]) {
      const base = vertices.length / 3;
      for (let j = 0; j < ring; j++) vertices.push(...vertices.slice((end * (ring + 1) + j) * 3, (end * (ring + 1) + j) * 3 + 3));
      for (let j = 1; j < ring - 1; j++) end ? indices.push(base, base + j + 1, base + j) : indices.push(base, base + j, base + j + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Mirroring flips winding; check one upper-surface normal and repair the orientation if needed.
    const probe = Math.floor(segments / 2) * (ring + 1) + Math.floor(ring / 4);
    const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, probe);
    const outward = spec.vertical ? new THREE.Vector3(spec.side ?? 1, 0, 0) : new THREE.Vector3(0, 1, 0);
    if (normal.dot(outward) < 0) {
      const index = geometry.index.array;
      for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
      geometry.computeVertexNormals();
    }
    return geometry;
  }
  function liftingSurface(spec, movable, material, hinge = 0.74) {
    const fixed = [surfaceGeometry(spec, 0, 1, 0, hinge, 20)];
    let edge = 0;
    for (const [, t0, t1] of movable) {
      if (t0 > edge) fixed.push(surfaceGeometry(spec, edge, t0, hinge, 1, 2));
      edge = t1;
    }
    if (edge < 1) fixed.push(surfaceGeometry(spec, edge, 1, hinge, 1, 2));
    mesh(mergeGeometries(fixed), material);
    for (const [name, t0, t1, sign = 1] of movable) {
      const h0 = sectionPoint(spec, t0, hinge, true).add(sectionPoint(spec, t0, hinge, false)).multiplyScalar(0.5);
      const h1 = sectionPoint(spec, t1, hinge, true).add(sectionPoint(spec, t1, hinge, false)).multiplyScalar(0.5);
      const axis = h1.clone().sub(h0).normalize();
      // Positive deflection: trailing edge down (or right, for the rudder).
      if (spec.vertical ? axis.y < 0 : axis.x < 0) axis.negate();
      const pivot = new THREE.Group();
      pivot.position.copy(h0);
      group.add(pivot);
      const geometry = surfaceGeometry(spec, t0, t1, hinge + 0.004, 1, 8);
      geometry.translate(-h0.x, -h0.y, -h0.z);
      mesh(geometry, material, pivot);
      (surfaces[name] ??= []).push({ pivot, axis, sign, angle: 0, hingeZ: h0.z });
    }
  }


  const body = [
    [-19.735, 0.01, 0.01, -0.35], [-19.2, 0.55, 0.5, -0.27], [-18.2, 1.15, 0.98, -0.15],
    [-16.8, 1.65, 1.55, -0.03], [-14.5, 1.88, 1.97, 0], [-11, 1.88, 1.97, 0],
    [9.6, 1.88, 1.97, 0], [12.3, 1.65, 1.65, 0.25], [15, 1.12, 1.15, 0.55],
    [17.8, 0.47, 0.5, 0.85], [19.735, 0.01, 0.01, 1.05],
  ];
  loft(body, paint, 0, 0, 128, 56);
  const hull = (z, a, lift = 0.015) => {
    const [rx, ry, cy] = interpolate(body, z);
    return [(rx + lift) * Math.cos(a), cy + (ry + lift) * Math.sin(a), z];
  };
  // Six angular flight-deck panes follow the nose skin; separate mullions keep the 737 brow legible.
  for (const side of [-1, 1]) for (const [a0, a1, z0, z1] of [
    [0.87, 1.52, -17.9, -16.65], [0.5, 0.84, -17.55, -15.95], [0.23, 0.47, -16.9, -15.4],
  ]) {
    const geometry = grid(10, 8, (u, v) => hull(THREE.MathUtils.lerp(z0, z1, u), side > 0 ? THREE.MathUtils.lerp(a0, a1, v) : Math.PI - THREE.MathUtils.lerp(a0, a1, v), 0.025));
    if (side < 0) {
      const indices = geometry.index.array;
      for (let k = 0; k < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
      geometry.computeVertexNormals();
    }
    mesh(geometry, glass);
  }

  // Passenger windows are batched. Leave space for both entry doors and the two overwing exits.
  const windows = [];
  for (const side of [-1, 1]) for (let i = 0; i < 43; i++) {
    const z = -13.4 + i * 0.62;
    if (Math.abs(z + 2.1) < 0.45 || Math.abs(z + 0.95) < 0.45) continue;
    const [x, y] = hull(z, side > 0 ? 0.26 : Math.PI - 0.26);
    const pane = new THREE.SphereGeometry(1, 12, 8);
    pane.scale(0.045, 0.23, 0.16); pane.rotateZ(side * 0.26); pane.translate(x, y, z);
    windows.push(pane);
  }
  const passengerWindows = mesh(mergeGeometries(windows), glass);
  passengerWindows.name = 'passenger windows';
  windows.forEach(g => g.dispose());
  for (const side of [-1, 1]) {
    for (const [z, width, bottom, top] of [[-14.6, 0.83, -0.55, 0.64], [12.3, 0.83, -0.55, 0.64], [-2.1, 0.55, -0.05, 0.67], [-0.95, 0.55, -0.05, 0.67]]) {
      const outline = [[z - width / 2, bottom], [z + width / 2, bottom], [z + width / 2, top], [z - width / 2, top], [z - width / 2, bottom]];
      const door = line(outline.map(([zz, a]) => hull(zz, side > 0 ? a : Math.PI - a, 0.025)), 0.018, seam);
      door.name = 'entry or overwing exit';
      line([hull(z - 0.12, side > 0 ? 0.03 : Math.PI - 0.03, 0.04), hull(z + 0.12, side > 0 ? 0.03 : Math.PI - 0.03, 0.04)], 0.025, metal);
    }
    // Narrow coral cheat line and a deeper teal ribbon, wrapped onto the cabin skin.
    for (const [a, radius, material] of [[-0.15, 0.065, coral], [-0.25, 0.12, teal]]) {
      line([-17, -14, -8, 0, 8, 12, 15].map(z => hull(z, side > 0 ? a : Math.PI - a, 0.025)), radius, material);
    }
  }

  // Swept, kinked low wing; outboard dihedral leads into blended winglets.
  const wingSection = t => {
    const outer = clamp((t - 0.34) / 0.66, 0, 1);
    return { x: THREE.MathUtils.lerp(1.2, 17.1, t), y: -1.2 + t * 1.2,
      z: -6.37 + t * 10.8, chord: t < 0.34 ? THREE.MathUtils.lerp(7.1, 3.2, t / 0.34) : THREE.MathUtils.lerp(3.2, 1.35, outer) };
  };
  for (const side of [-1, 1]) {
    const wing = { section: wingSection, thick: 0.105, camber: 0.016, side };
    liftingSurface(wing, [['flaps', 0.04, 0.3], ['flaps', 0.34, 0.64], ['ailerons', 0.69, 0.93, side]], paint, 0.72);
    const tip = { vertical: true, thick: 0.07, side, section: t => ({ x: 17.1 + 0.795 * Math.sin(t * Math.PI / 2), y: t * 2.65,
      z: 4.43 + t * 1.8, chord: THREE.MathUtils.lerp(1.35, 0.48, t) }) };
    mesh(surfaceGeometry(tip, 0, 1, 0, 1, 20, 24), teal);
    mesh(surfaceGeometry(tip, 0.83, 1, 0, 1, 4, 24), coral).scale.setScalar(1.001);
    line([0.05, 0.34, 0.7, 0.96].map(t => sectionPoint(wing, t, 0.12, true).add(new THREE.Vector3(0, 0.015, 0)).toArray()), 0.012, seam);
    for (const t of [0.15, 0.37, 0.57]) {
      const section = wingSection(t);
      ellipsoid(side * section.x, section.y - 0.3, section.z + section.chord * 0.83, 0.17, 0.2, 1.6, paint);
    }
  }
  ellipsoid(0, -1.35, -1.5, 2.25, 0.9, 6, paint);

  // CFM-style underwing nacelles: broad inlet, flattened lower lip, visible fans and core exhaust.
  for (const side of [-1, 1]) {
    const x = side * 4.85, y = -2.05;
    const nacelle = loft([[-6.45, 0.93, 0.87, 0], [-6.2, 1.02, 0.94, 0], [-5.6, 1.08, 0.96, 0],
      [-4.4, 0.99, 0.88, 0.02], [-3.3, 0.79, 0.69, 0.07], [-2.85, 0.62, 0.55, 0.08]], paint, x, y, 44, 40);
    nacelle.name = 'underwing turbofan';
    // Flattening the underside gives the distinctive NG nacelle outline and ground clearance.
    const positions = nacelle.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, Math.max(y - 0.8, positions.getY(i)));
    positions.needsUpdate = true; nacelle.geometry.computeVertexNormals();
    const lip = mesh(new THREE.TorusGeometry(0.91, 0.055, 10, 40), metal);
    lip.position.set(x, y, -6.43); lip.scale.y = 0.94;
    const inlet = mesh(new THREE.CircleGeometry(0.9, 40), dark);
    inlet.rotation.y = Math.PI; inlet.position.set(x, y, -6.21); inlet.scale.y = 0.94;
    const blades = [];
    for (let i = 0; i < 24; i++) {
      const blade = new THREE.BoxGeometry(0.075, 0.56, 0.025);
      blade.rotateY(0.5); blade.translate(0, 0.49, 0); blade.rotateZ(i * Math.PI / 12); blades.push(blade);
    }
    const spinner = new THREE.ConeGeometry(0.19, 0.38, 20); spinner.rotateX(-Math.PI / 2); spinner.translate(0, 0, -0.14); blades.push(spinner);
    const bladeMeshes = blades.map(g => g.toNonIndexed());
    const fan = mesh(mergeGeometries(bladeMeshes), metal);
    fan.position.set(x, y, -6.25); fan.name = 'turbofan fan'; engines.push(fan);
    [...blades, ...bladeMeshes].forEach(g => g.dispose());
    const exhaust = mesh(new THREE.CylinderGeometry(0.49, 0.58, 0.65, 32, 1, true), dark);
    exhaust.rotation.x = Math.PI / 2; exhaust.position.set(x, y + 0.08, -2.68);
    const cone = mesh(new THREE.ConeGeometry(0.26, 0.85, 24), metal);
    cone.rotation.x = Math.PI / 2; cone.position.set(x, y + 0.08, -2.45);
    const pylon = { vertical: true, thick: 0.13, section: t => ({ x, y: -1.8 + t * 0.85, z: -5 + t * 0.7, chord: 2.3 - t * 0.3 }) };
    mesh(surfaceGeometry(pylon, 0, 1, 0, 1, 6, 24), paint);
    const band = mesh(new THREE.TorusGeometry(0.83, 0.045, 8, 36), teal); band.scale.y = 0.91; band.position.set(x, y, -3.6);
  }

  // Conventional tail: a large swept fin with dorsal fillet, stabilisers below it.
  const fin = { vertical: true, thick: 0.09, section: t => ({ x: 0, y: 1.2 + t * 7.75, z: 9.5 + t * 6.2, chord: 7.0 - t * 4.9 }) };
  liftingSurface(fin, [['rudder', 0.15, 0.97]], teal, 0.73);
  const dorsal = { vertical: true, thick: 0.06, section: t => ({ x: 0, y: 1.55 + t * 1.5, z: 6 + t * 4.5, chord: 7.0 - t * 3.5 }) };
  mesh(surfaceGeometry(dorsal, 0, 1, 0, 1, 8, 20), teal);
  for (const side of [-1, 1]) {
    const stab = { thick: 0.09, side, section: t => ({ x: 0.55 + t * 6.625, y: 1.3 + t * 1.2, z: 12.8 + t * 3.9, chord: 4.2 - t * 2.9 }) };
    liftingSurface(stab, [['elevators', 0.03, 0.96]], paint, 0.7);
    // An original coral mountain slash on the teal fin.
    line([[side * 0.23, 4.0, 13.0], [side * 0.17, 6.6, 15.2], [side * 0.15, 5.1, 15.6]], 0.14, coral);
  }

  function leg(x, y, z, length, radius, axis, stowAngle) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); group.add(pivot);
    rod([0, 0, 0], [0, -length, 0], 0.085, metal, pivot);
    rod([0, -length * 0.25, -0.6], [0, -length * 0.8, 0], 0.045, metal, pivot);
    rod([0, -length * 0.3, 0], [0, -length * 0.85, 0], 0.12, paint, pivot);
    for (const offset of [-radius * 0.6, radius * 0.6]) {
      const wheel = mesh(new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 10, 24), rubber, pivot);
      wheel.rotation.y = Math.PI / 2; wheel.position.set(offset, -length, 0);
      const hub = mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.18, 16), metal, pivot);
      hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position);
    }
    const door = mesh(new THREE.BoxGeometry(0.06, length * 0.65, 0.85), paint, pivot);
    door.position.set(Math.sign(x || 1) * 0.2, -length * 0.4, 0);
    gearLegs.push({ pivot, axis: new THREE.Vector3(...axis), stowAngle });
  }
  leg(0, -1.7, -15.645, 1.5, 0.4, [1, 0, 0], 1.65);
  for (const side of [-1, 1]) leg(side * 2.86, -1.25, -0.045, 1.8, 0.55, [0, 0, 1], -side * 1.58);

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = palette.teal; ctx.font = '500 155px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AERONAUT', 768, 130);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    const decal = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const side of [-1, 1]) {
      // Wrap the wordmark above the window row so it follows the cabin rather than floating beside it.
      const geometry = grid(24, 8, (u, v) => {
        const z = THREE.MathUtils.lerp(side > 0 ? -6.35 : -12.85, side > 0 ? -12.85 : -6.35, u);
        const angle = THREE.MathUtils.lerp(0.43, 0.83, v);
        return hull(z, side > 0 ? angle : Math.PI - angle, 0.035);
      });
      const uv = [];
      for (let i = 0; i <= 24; i++) for (let j = 0; j <= 8; j++) uv.push(i / 24, j / 8);
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const wordmark = mesh(geometry, decal); wordmark.castShadow = false;
    }
  }
  function nav(x, y, z, color, flash = false) {
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const bulb = ellipsoid(x, y, z, 0.09, 0.08, 0.11, material); bulb.castShadow = false;
    navigation.push({ bulb, flash });
  }
  nav(-17.1, 0.05, 4.6, 'hsl(4, 100%, 60%)'); nav(17.1, 0.05, 4.6, 'hsl(158, 100%, 67%)');
  nav(0, 1.1, 19.6, 'hsl(48, 100%, 92%)'); nav(0, 2.0, -1, 'hsl(4, 100%, 60%)', true); nav(0, -2.2, -1, 'hsl(4, 100%, 60%)', true);

  let gearPosition = 0, flapAngle = 0, clock = 0, last = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 }, turn = new THREE.Quaternion();
  return {
    group, materials,
    update(dt, throttle = 0.72, state = {}) {
      clock = state.time ?? clock + dt;
      const spool = clamp(state.spool ?? throttle, 0, 1);
      for (const fan of engines) fan.rotation.z += dt * (8 + spool * 75);
      const target = state.gearDown ? 1 : 0;
      if (state.grounded || (state.flightTime ?? 1) < 0.05) gearPosition = target;
      else gearPosition += clamp(target - gearPosition, -dt / 5, dt / 5);
      for (const { pivot, axis, stowAngle } of gearLegs) {
        pivot.visible = gearPosition > 0.01;
        pivot.quaternion.setFromAxisAngle(axis, stowAngle * (1 - THREE.MathUtils.smoothstep(gearPosition, 0, 1)));
      }
      if (dt > 0) {
        const now = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        if (!last || (state.flightTime ?? 1) < 0.05) last = now;
        const live = state.grounded || state.crashed ? 0 : 1;
        const headingRate = Math.atan2(Math.sin(now.heading - last.heading), Math.cos(now.heading - last.heading)) / dt;
        deflection.ailerons = ease(deflection.ailerons, clamp(-(now.bank - last.bank) / dt * 0.8, -0.35, 0.35) * live, 6, dt);
        deflection.elevators = ease(deflection.elevators, clamp(-(now.pitch - last.pitch) / dt * 1.7, -0.3, 0.3) * live, 6, dt);
        deflection.rudder = ease(deflection.rudder, clamp((headingRate - 9.81 * Math.tan(now.bank) / Math.max(state.speed ?? 0, 24)) * 3, -0.3, 0.3) * live, 5, dt);
        last = now;
        if ((state.flightTime ?? 1) < 0.05) flapAngle = (state.flaps ?? 0) * Math.PI / 12;
        else flapAngle += clamp((state.flaps ?? 0) * Math.PI / 12 - flapAngle, -dt * 0.1, dt * 0.1);
      }
      const angles = { flaps: () => flapAngle, ailerons: sign => deflection.ailerons * sign, elevators: () => deflection.elevators, rudder: () => deflection.rudder };
      for (const [name, list] of Object.entries(surfaces)) for (const surface of list) {
        surface.angle = angles[name](surface.sign);
        surface.pivot.quaternion.copy(turn.setFromAxisAngle(surface.axis, surface.angle));
        // A modest aft track gives the inboard and outboard flap panels a Fowler-style extension.
        if (name === 'flaps') surface.pivot.position.z = surface.hingeZ + flapAngle * 0.9;
      }
      for (const { bulb, flash } of navigation) if (flash) bulb.visible = clock % 1.4 < 0.12;
    },
    get gearPosition() { return gearPosition; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([name, list]) => [name, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() {
      const geometries = new Set(), materials = new Set(), textures = new Set();
      group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); if (o.material?.map) textures.add(o.material.map); });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    },
  };
}

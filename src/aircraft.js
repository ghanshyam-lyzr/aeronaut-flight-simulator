import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createFleetAircraft, EXPANDED_AIRCRAFT } from './fleet-models.js';
import { createFleetCockpit } from './fleet-cockpit.js';
import { create737 } from './airliner.js';
import { createCargo, createCargoCockpit } from './cargo.js';
import { createFighter } from './fighter.js';
import { createHelicopter, createHelicopterCockpit } from './helicopter.js';
import { aircraftType } from './fleet.js';

const clamp = THREE.MathUtils.clamp;
const ease = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));

export const AIRCRAFT = { name: 'Vela J8', registration: 'A-VJ08' };

/** Builds the procedural airframe for any fleet id; unknown saved choices fall back to the Vela J8. */
export function createAircraft(type = 'jet') {
  if (EXPANDED_AIRCRAFT.includes(type)) return createFleetAircraft(type);
  if (type === 'cargo') return createCargo();
  return type === 'airliner' ? create737() : type === 'helicopter' ? createHelicopter() : type === 'fighter' ? createFighter() : createVela();
}

// An original light twin jet, modelled in metres; the nose points down local -Z.
function createVela() {
  const group = new THREE.Group();
  group.name = `${AIRCRAFT.name} — ${AIRCRAFT.registration}`;
  const palette = {
    shell: '#eeece4', coral: '#e75a36', ink: '#152932', glass: '#1b3542',
    metal: '#9cabb2', rubber: '#12181c', seam: '#7b888b', heat: '#ff9a5c',
  };
  const paint = new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.27, metalness: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.2 });
  const coral = new THREE.MeshPhysicalMaterial({ color: palette.coral, roughness: 0.29, metalness: 0.15, clearcoat: 1 });
  const graphite = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: 0.28, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.09, metalness: 0.57, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.5, polygonOffset: true, polygonOffsetFactor: -1 });
  const metal = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.22, metalness: 0.88 });
  const seam = new THREE.MeshStandardMaterial({ color: palette.seam, roughness: 0.55, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: palette.rubber, roughness: 0.85 });
  const nozzle = new THREE.MeshStandardMaterial({ color: '#3c4448', roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide });
  const materials = { paint, coral, graphite, glass, metal, seam, rubber, nozzle };
  const engines = [];
  const navigation = [];
  const surfaces = {};
  const gearLegs = [];

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

  // Slender pressurised fuselage: a sharp radome, a constant cabin and an upswept tail cone.
  const body = [
    [-7.6, 0.02, 0.02, -0.06], [-7.15, 0.36, 0.32, -0.04], [-6.3, 0.70, 0.64, 0.0],
    [-5.1, 0.92, 0.88, 0.05], [-3.6, 1.0, 0.99, 0.08], [-0.6, 1.0, 1.0, 0.08],
    [2.2, 0.95, 0.96, 0.11], [4.1, 0.74, 0.76, 0.24], [5.8, 0.43, 0.48, 0.43],
    [7.15, 0.13, 0.17, 0.62], [7.55, 0.02, 0.03, 0.66],
  ];
  loft(body, paint, 0, 0, 96, 64);
  const hull = (z, angle, lift = 0) => {
    const [rx, ry, cy] = interpolate(body, z);
    return [(rx + lift) * Math.cos(angle), cy + (ry + lift) * Math.sin(angle), z];
  };

  // Wrap-around windshield: a glass skin offset from the nose, swept back at its side edges.
  mesh(grid(18, 40, (s, v) => {
    const w = v * 2 - 1, z = THREE.MathUtils.lerp(-6.2 + Math.abs(w) ** 1.6 * 0.55, -4.55 - Math.abs(w) * 0.25, s);
    return hull(z, Math.PI / 2 + w * 1.08, 0.012);
  }), glass);
  for (const w of [-1, -0.56, 0, 0.56, 1]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(hull(THREE.MathUtils.lerp(-6.2 + Math.abs(w) ** 1.6 * 0.55, -4.55 - Math.abs(w) * 0.25, i / 6), Math.PI / 2 - w * 1.08, 0.022));
    line(pts, w === 0 ? 0.03 : 0.022, paint);
  }
  const antiGlare = ellipsoid(0, 0.42, -6.42, 0.36, 0.04, 0.42, graphite);
  antiGlare.rotation.x = -0.42;

  // Oval cabin windows, merged into one draw call.
  const windowShapes = [];
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const z = -3.3 + i * 0.86, angle = side > 0 ? 0.3 : Math.PI - 0.3, [x, y] = hull(z, angle, 0.0);
    const pane = new THREE.SphereGeometry(1, 16, 10);
    pane.scale(0.05, 0.19, 0.25);
    pane.rotateZ(side * 0.3);
    pane.translate(x, y, z);
    windowShapes.push(pane);
  }
  mesh(mergeGeometries(windowShapes), glass);
  // Cabin door outline and the house cheat lines, rising toward the tail like the old touring livery.
  for (const side of [-1, 1]) {
    const ring = [];
    for (let j = 0; j <= 20; j++) {
      const a = j / 20 * Math.PI * 2, z = -4.0 + Math.cos(a) * 0.36, angle = 0.05 + Math.sin(a) * 0.62;
      ring.push(hull(z, side > 0 ? angle : Math.PI - angle, 0.008));
    }
    line(ring, 0.009, seam);
    const stripe = (angle, from, to) => [from, -4.8, -2, 1.2, 3.4, to].map((z, i) => {
      const p = hull(z, side > 0 ? angle + i * 0.05 : Math.PI - angle - i * 0.05, 0.012);
      return p;
    });
    line(stripe(-0.2, -6.5, 5.4), 0.045, graphite);
    line(stripe(-0.07, -6.0, 5.1), 0.016, coral);
  }

  // Lifting surfaces are lofted around a NACA-style section; movable surfaces pivot on their hinge line.
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
    const outward = spec.vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
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
      (surfaces[name] ??= []).push({ pivot, axis, sign, angle: 0 });
    }
  }

  // Low, 27°-swept wing with dihedral, inboard flaps and outboard ailerons.
  const wingSection = t => ({ x: THREE.MathUtils.lerp(0.55, 6.85, t), y: -0.64 + t * 0.44, z: THREE.MathUtils.lerp(-1.45, 1.75, t), chord: THREE.MathUtils.lerp(3.35, 1.18, t) });
  for (const side of [-1, 1]) {
    const spec = { section: wingSection, thick: 0.12, camber: 0.02, side };
    liftingSurface(spec, [['flaps', 0.04, 0.5], ['ailerons', 0.55, 0.93, side]], paint);
    // Blended winglets carry the coral livery.
    const winglet = { vertical: true, thick: 0.09, side, section: t => ({ x: 6.85 + t * 0.22, y: -0.2 + t * 1.3, z: THREE.MathUtils.lerp(1.75, 2.75, t), chord: THREE.MathUtils.lerp(1.15, 0.48, t) }) };
    mesh(surfaceGeometry(winglet, 0, 1, 0, 1, 10, 28), coral);
    // Panel seam along the leading-edge slat line.
    line([0.08, 0.5, 0.95].map(t => sectionPoint(spec, t, 0.12, true).add(new THREE.Vector3(0, 0.006, 0)).toArray()), 0.008, seam);
  }
  // Wing-to-body fairing.
  ellipsoid(0, -0.62, 0.3, 0.98, 0.42, 2.7, paint);

  // Fuselage-mounted turbofans on short pylons, clear of the wing wake.
  for (const side of [-1, 1]) {
    const x = side * 1.62, y = 0.66;
    loft([[1.85, 0.41, 0.41, 0], [2.05, 0.48, 0.48, 0], [2.7, 0.51, 0.51, 0], [3.8, 0.48, 0.48, 0], [4.65, 0.39, 0.39, 0], [5.0, 0.33, 0.33, 0]], paint, x, y, 40, 40);
    const lip = mesh(new THREE.TorusGeometry(0.43, 0.045, 10, 40), metal);
    lip.position.set(x, y, 1.86);
    loft([[3.95, 0.475, 0.475, 0], [4.25, 0.455, 0.455, 0]], coral, x, y, 4, 40);
    const fanFace = mesh(new THREE.CircleGeometry(0.42, 32), graphite);
    fanFace.rotation.y = Math.PI;
    fanFace.position.set(x, y, 2.12);
    const bladeParts = [];
    for (let i = 0; i < 16; i++) {
      const blade = new THREE.BoxGeometry(0.055, 0.3, 0.018);
      blade.rotateY(0.45);
      blade.translate(0, 0.25, 0);
      blade.rotateZ(i / 16 * Math.PI * 2);
      bladeParts.push(blade);
    }
    const spinner = new THREE.ConeGeometry(0.11, 0.26, 20);
    spinner.rotateX(-Math.PI / 2);
    spinner.translate(0, 0, -0.1);
    bladeParts.push(spinner);
    const fan = mesh(mergeGeometries(bladeParts.map(g => g.toNonIndexed())), metal);
    fan.position.set(x, y, 2.04);
    const exhaust = mesh(new THREE.CylinderGeometry(0.29, 0.33, 0.34, 32, 1, true), nozzle);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(x, y, 5.12);
    const core = mesh(new THREE.ConeGeometry(0.17, 0.42, 24), graphite);
    core.rotation.x = Math.PI / 2;
    core.position.set(x, y, 5.12);
    const heatMaterial = new THREE.MeshBasicMaterial({ color: palette.heat, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const heat = mesh(new THREE.RingGeometry(0.17, 0.29, 32), heatMaterial);
    heat.position.set(x, y, 5.05);
    heat.castShadow = false;
    engines.push({ fan, heatMaterial, side });
    const pylon = { thick: 0.1, side, section: t => ({ x: THREE.MathUtils.lerp(0.55, 1.4, t), y: THREE.MathUtils.lerp(0.52, 0.64, t), z: 2.65 + t * 0.15, chord: 1.55 - t * 0.2 }) };
    mesh(surfaceGeometry(pylon, 0, 1, 0, 1, 4, 24), paint);
  }

  // T-tail: coral swept fin with a rudder, the elevator-carrying stabiliser on top.
  const finSpec = { vertical: true, thick: 0.1, section: t => ({ x: 0, y: THREE.MathUtils.lerp(0.75, 3.42, t), z: THREE.MathUtils.lerp(4.2, 6.05, t), chord: THREE.MathUtils.lerp(2.65, 1.5, t) }) };
  liftingSurface(finSpec, [['rudder', 0.12, 0.94]], coral, 0.7);
  const dorsal = new THREE.Shape();
  dorsal.moveTo(2.4, 0.9); dorsal.quadraticCurveTo(3.9, 1.05, 4.75, 1.62); dorsal.lineTo(4.75, 0.7); dorsal.closePath();
  const dorsalGeometry = new THREE.ExtrudeGeometry(dorsal, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  dorsalGeometry.rotateY(-Math.PI / 2);
  dorsalGeometry.translate(0.06, 0, 0);
  mesh(dorsalGeometry, coral);
  for (const side of [-1, 1]) {
    const stab = { thick: 0.09, side, section: t => ({ x: THREE.MathUtils.lerp(0.08, 2.75, t), y: 3.4 + t * 0.06, z: THREE.MathUtils.lerp(6.0, 6.95, t), chord: THREE.MathUtils.lerp(1.45, 0.72, t) }) };
    liftingSurface(stab, [['elevators', 0.05, 0.96]], paint, 0.7);
  }
  ellipsoid(0, 3.42, 6.75, 0.14, 0.13, 0.95, graphite);

  // Retractable tricycle undercarriage. Each leg folds about its pivot: the nose forward, the mains inboard.
  function leg(pivotAt, stowAxis, stowAngle, wheelRadius, length, twin) {
    const pivot = new THREE.Group();
    pivot.position.set(...pivotAt);
    group.add(pivot);
    rod([0, 0, 0], [0, -length + wheelRadius * 0.4, 0.06], 0.06, metal, pivot);
    rod([0, -length * 0.45, -0.32], [0, -length * 0.82, 0.05], 0.03, metal, pivot);
    rod([0, -length * 0.4, 0.02], [0, -length + wheelRadius * 0.5, 0.06], 0.08, paint, pivot);
    for (const offset of twin ? [-0.17, 0.17] : [0]) {
      const wheel = mesh(new THREE.TorusGeometry(wheelRadius * 0.7, wheelRadius * 0.32, 12, 28), rubber, pivot);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(offset, -length, 0.06);
      const hub = mesh(new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, 0.13, 20), metal, pivot);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
    }
    const door = mesh(new THREE.BoxGeometry(0.04, length * 0.62, 0.5), paint, pivot);
    door.position.set(twin ? 0 : 0.14, -length * 0.42, 0.05);
    gearLegs.push({ pivot, stowAxis: new THREE.Vector3(...stowAxis).normalize(), stowAngle });
  }
  leg([0, -0.72, -5.15], [1, 0, 0], 1.62, 0.3, 0.86, true);
  for (const side of [-1, 1]) leg([side * 1.62, -0.56, 0.62], [0, 0, 1], -side * 1.5, 0.4, 0.91, false);

  function canvasTexture(width, height, draw) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    draw(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }
  const registration = canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = palette.ink;
    ctx.font = '600 160px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(AIRCRAFT.registration, w / 2, h / 2 + 5);
  });
  if (registration) {
    const decalMaterial = new THREE.MeshBasicMaterial({ map: registration, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const top = sectionPoint({ section: wingSection, thick: 0.12, camber: 0.02 }, 0.52, 0.32, true);
    const wingReg = mesh(new THREE.PlaneGeometry(2.0, 0.5), decalMaterial);
    wingReg.rotation.set(-Math.PI / 2, 0, 0, 'ZXY');
    wingReg.rotation.z = Math.atan2(0.44, 6.3);
    wingReg.position.set(top.x, top.y + 0.02, top.z);
    wingReg.castShadow = false;
    for (const side of [-1, 1]) {
      const reg = mesh(new THREE.PlaneGeometry(1.5, 0.37), decalMaterial);
      reg.position.set(side * 0.82, 0.28, 3.05);
      reg.rotation.y = side * Math.PI / 2;
      reg.castShadow = false;
    }
  }
  rod([0, 0.98, -1.2], [0, 1.4, -0.95], 0.02, graphite);
  rod([0, -0.9, -2.4], [0, -1.22, -2.2], 0.016, paint);

  const haloTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(255,255,255,.75)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,.18)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  function nav(x, y, z, color, flash = false) {
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const bulb = ellipsoid(x, y, z, 0.07, 0.06, 0.09, material);
    bulb.castShadow = false;
    if (haloTexture) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
      sprite.position.set(x, y, z); sprite.scale.setScalar(flash ? 0.55 : 0.37);
      group.add(sprite); navigation.push({ sprite, flash });
    }
  }
  nav(-6.92, -0.17, 1.62, '#ff4534');
  nav(6.92, -0.17, 1.62, '#56ffbb');
  nav(0, 0.66, 7.6, '#fff6df');
  nav(0, 3.58, 6.6, '#ff583d', true);
  nav(0, -1.0, -0.6, '#ff583d', true);

  let clock = 0, gearPosition = 0, flapAngle = 0, lastBank = null, lastPitch = 0, lastHeading = 0;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  const turn = new THREE.Quaternion();
  return {
    group,
    materials,
    update(dt, throttle = 0.7, state = {}) {
      clock = state.time ?? clock + dt;
      const spool = clamp(state.spool ?? throttle, 0, 1);
      for (const { fan, heatMaterial, side } of engines) {
        fan.rotation.z += dt * (14 + spool * 95) * side;
        heatMaterial.opacity = 0.08 + spool * spool * 0.55;
      }

      // Gear runs through a 3-second cycle; on the ground or at a fresh start it is simply down.
      const gearTarget = state.gearDown ? 1 : 0;
      if (state.grounded || (state.flightTime ?? 1) < 0.05) gearPosition = gearTarget;
      else gearPosition += clamp(gearTarget - gearPosition, -dt / 3, dt / 3);
      for (const { pivot, stowAxis, stowAngle } of gearLegs) {
        pivot.visible = gearPosition > 0.01;
        pivot.quaternion.setFromAxisAngle(stowAxis, stowAngle * (1 - THREE.MathUtils.smoothstep(gearPosition, 0, 1)));
      }

      // Control-surface deflections follow the attitude rates the flight model produces.
      if (dt > 0) {
        if (lastBank === null) { lastBank = state.bank ?? 0; lastPitch = state.pitch ?? 0; lastHeading = state.heading ?? 0; }
        const bankRate = ((state.bank ?? 0) - lastBank) / dt;
        const pitchRate = ((state.pitch ?? 0) - lastPitch) / dt;
        const headingRate = Math.atan2(Math.sin((state.heading ?? 0) - lastHeading), Math.cos((state.heading ?? 0) - lastHeading)) / dt;
        const coordinated = 9.81 * Math.tan(state.bank ?? 0) / Math.max(state.speed ?? 0, 24);
        const rate = state.grounded || state.crashed ? 0 : 1;
        deflection.ailerons = ease(deflection.ailerons, clamp(bankRate * 0.45, -0.38, 0.38) * rate, 8, dt);
        deflection.elevators = ease(deflection.elevators, clamp(-pitchRate * 1.4, -0.38, 0.38) * rate, 8, dt);
        deflection.rudder = ease(deflection.rudder, clamp((headingRate - coordinated) * 2.4, -0.35, 0.35) * rate, 6, dt);
        lastBank = state.bank ?? 0; lastPitch = state.pitch ?? 0; lastHeading = state.heading ?? 0;
        flapAngle += clamp((state.flaps ?? 0) * 0.26 - flapAngle, -dt * 0.18, dt * 0.18);
      }
      const angles = { flaps: () => flapAngle, ailerons: sign => -deflection.ailerons * sign, elevators: () => deflection.elevators, rudder: () => deflection.rudder };
      for (const [name, list] of Object.entries(surfaces)) for (const surface of list) {
        surface.angle = angles[name](surface.sign);
        surface.pivot.quaternion.copy(turn.setFromAxisAngle(surface.axis, surface.angle));
      }

      for (const { sprite, flash } of navigation) if (flash) {
        const phase = clock % 1.7;
        sprite.material.opacity = phase < 0.08 || (phase > 0.17 && phase < 0.23) ? 1 : 0.08;
      }
    },
    get gearPosition() { return gearPosition; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([name, list]) => [name, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() {
      group.traverse(o => { if (o.isMesh || o.isSprite) { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); } });
    },
  };
}

// Camera-local cockpit. Attach directly to the active camera; no animation loop is needed.
export function createCockpit(type = 'jet') {
  if (EXPANDED_AIRCRAFT.includes(type)) return createFleetCockpit(type);
  if (type === 'cargo') return createCargoCockpit();
  if (type === 'helicopter') return createHelicopterCockpit();
  const fighter = type === 'fighter', airliner = type === 'airliner';
  const info = aircraftType(type);
  const cockpit = new THREE.Group();
  cockpit.name = `${info.name} — cockpit`;
  const charcoal = new THREE.MeshStandardMaterial({ color: '#162126', roughness: 0.72, metalness: 0.13 });
  const trim = new THREE.MeshStandardMaterial({ color: '#354249', roughness: 0.34, metalness: 0.65 });
  const leather = new THREE.MeshStandardMaterial({ color: '#202b2e', roughness: 0.95, metalness: 0 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#0b1114', roughness: 0.85 });
  function part(geometry, material, parent = cockpit) {
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    parent.add(object);
    return object;
  }
  function tube(points, radius, material) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return part(new THREE.TubeGeometry(curve, 32, radius, 12, false), material);
  }
  // Swept pillars stay at the sides. The horizon has a clear, uninterrupted opening.
  // The fighter's bubble canopy has no pillars: one bow arch ahead of the pilot and low sills.
  if (fighter) {
    tube([[-2.3, -1.0, -1.75], [-2.05, 0.4, -2.05], [-1.3, 1.45, -2.25], [0, 1.85, -2.35], [1.3, 1.45, -2.25], [2.05, 0.4, -2.05], [2.3, -1.0, -1.75]], 0.03, charcoal);
    for (const side of [-1, 1]) tube([[side * 1.52, -0.86, -1.95], [side * 1.6, -0.84, -0.9], [side * 1.62, -0.86, 0.2]], 0.05, charcoal);
    // Head-up display combiner: a faint green-tinted glass above the glare shield.
    const combiner = part(new THREE.PlaneGeometry(0.42, 0.2), new THREE.MeshBasicMaterial({ color: '#9fe3b0', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
    combiner.position.set(0, -0.44, -1.9); combiner.rotation.x = -0.32;
    const frame = part(new THREE.BoxGeometry(0.44, 0.012, 0.012), trim);
    frame.position.set(0, -0.335, -1.935);
  } else for (const side of [-1, 1]) {
    tube([[side * 1.56, -1.15, -1.18], [side * 1.34, -0.36, -1.55], [side * 1.12, 0.58, -1.94], [side * 0.91, 1.28, -2.06]], 0.048, charcoal);
    tube([[side * 1.53, -1.12, -1.18], [side * 1.31, -0.34, -1.55], [side * 1.09, 0.59, -1.94], [side * 0.88, 1.28, -2.06]], 0.008, trim);
    tube([[side * 1.55, -0.83, -1.21], [side * 1.51, -0.71, -1.85], [side * 1.45, -0.67, -2.48]], 0.047, charcoal);
  }
  if (!fighter) tube([[-0.94, 1.27, -2.06], [-0.5, 1.38, -2.02], [0, 1.40, -2.01], [0.5, 1.38, -2.02], [0.94, 1.27, -2.06]], 0.055, charcoal);

  if (airliner) {
    // 737-style centre windshield post and paired control columns; keep everything beyond the 1 m near plane.
    tube([[0.66, -0.78, -2.1], [0.53, 0.55, -2.25], [0.46, 1.6, -2.3]], 0.045, charcoal);
    for (const x of [-0.35, 1.05]) {
      tube([[x, -1.4, -1.3], [x, -0.95, -1.45], [x, -0.73, -1.55]], 0.035, trim);
      tube([[x - 0.16, -0.64, -1.55], [x - 0.16, -0.78, -1.55], [x, -0.84, -1.55], [x + 0.16, -0.78, -1.55], [x + 0.16, -0.64, -1.55]], 0.03, rubber);
    }
  }
  const dashboard = new THREE.Group();
  dashboard.position.set(0, -0.91, -1.75);
  dashboard.rotation.x = -0.17;
  cockpit.add(dashboard);
  const shape = new THREE.Shape();
  shape.moveTo(-1.48, -0.34); shape.lineTo(-1.48, 0.12);
  shape.quadraticCurveTo(-1.45, 0.30, -1.23, 0.33);
  shape.quadraticCurveTo(0, 0.40, 1.23, 0.33);
  shape.quadraticCurveTo(1.45, 0.30, 1.48, 0.12);
  shape.lineTo(1.48, -0.34); shape.closePath();
  const shellGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.035, bevelSegments: 4, curveSegments: 20 });
  part(shellGeometry, charcoal, dashboard);
  const hood = part(new THREE.BoxGeometry(3.03, 0.055, 0.40), leather, dashboard);
  hood.position.set(0, 0.355, -0.03);
  const stitching = tube([[-1.40, -0.515, -1.79], [-0.7, -0.49, -1.79], [0, -0.48, -1.79], [0.7, -0.49, -1.79], [1.4, -0.515, -1.79]], 0.004, trim);
  stitching.name = 'glare-shield stitching';

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 440;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#131d22'; ctx.fillRect(0, 0, W, H);
    // Satin panel finish, with engraved labels and inset instrument bezels.
    const finish = ctx.createLinearGradient(0, 0, 0, H);
    finish.addColorStop(0, '#253136'); finish.addColorStop(0.2, '#1b272b'); finish.addColorStop(1, '#121d22');
    ctx.fillStyle = finish; ctx.fillRect(0, 0, W, H);
    function roundRect(x, y, w, h, radius, fill, stroke = null) {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    }
    function text(label, x, y, size = 14, color = '#b8c6c6', align = 'center', font = 'Arial') {
      ctx.font = `${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y);
    }
    function dial(x, y, radius, label, value, max, units) {
      ctx.save(); ctx.translate(x, y);
      const bezel = ctx.createRadialGradient(-radius * 0.3, -radius * 0.5, radius * 0.25, 0, 0, radius);
      bezel.addColorStop(0, '#435052'); bezel.addColorStop(0.78, '#161f22'); bezel.addColorStop(0.87, '#4a575a'); bezel.addColorStop(1, '#0b1317');
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fillStyle = bezel; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, radius * 0.84, 0, Math.PI * 2); ctx.fillStyle = '#0a1418'; ctx.fill();
      ctx.strokeStyle = '#8de3c3'; ctx.lineWidth = radius * 0.024;
      ctx.beginPath(); ctx.arc(0, 0, radius * 0.71, Math.PI * 0.88, Math.PI * 1.97); ctx.stroke();
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI * 0.75 + i / 40 * Math.PI * 1.5;
        const r1 = radius * (i % 5 === 0 ? 0.61 : 0.67), r2 = radius * 0.75;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.strokeStyle = i % 5 === 0 ? '#d4ded9' : '#79898b'; ctx.lineWidth = i % 5 === 0 ? 2 : 1; ctx.stroke();
        if (i % 10 === 0) text(Math.round(i / 40 * max).toString(), Math.cos(a) * radius * 0.49, Math.sin(a) * radius * 0.49, radius * 0.13, '#d0dbd6');
      }
      text(label, 0, -radius * 0.24, radius * 0.11, '#8daba8');
      text(units, 0, radius * 0.22, radius * 0.095, '#718b89');
      const angle = Math.PI * 0.75 + value / max * Math.PI * 1.5;
      ctx.save(); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(-radius * 0.17, -3); ctx.lineTo(radius * 0.66, 0); ctx.lineTo(-radius * 0.17, 3); ctx.closePath(); ctx.fillStyle = '#e9dfb7'; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, radius * 0.065, 0, Math.PI * 2); ctx.fillStyle = '#b1bcb8'; ctx.fill();
      ctx.restore();
    }
    dial(177, 226, 139, 'AIRSPEED', airliner ? 250 : fighter ? 330 : 210, fighter ? 600 : 400, 'KNOTS');
    dial(482, 226, 139, 'ALTIMETER', 6800, 10000, 'FEET');
    // Central glass avionics: attitude and a small navigation display.
    roundRect(657, 54, 410, 336, 15, '#080e11', '#526165');
    roundRect(674, 70, 376, 301, 4, '#0a1b21');
    ctx.save(); ctx.beginPath(); ctx.rect(687, 112, 350, 224); ctx.clip();
    ctx.fillStyle = '#234752'; ctx.fillRect(687, 112, 350, 112);
    ctx.fillStyle = '#665b40'; ctx.fillRect(687, 224, 350, 112);
    ctx.strokeStyle = '#e7dfba'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(687, 224); ctx.lineTo(1037, 224); ctx.stroke();
    for (const offset of [-75, -50, -25, 25, 50, 75]) {
      const half = Math.abs(offset) % 50 === 0 ? 42 : 25;
      ctx.strokeStyle = '#b3d7c8'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(862 - half, 224 + offset); ctx.lineTo(862 + half, 224 + offset); ctx.stroke();
      text(Math.abs(offset / 2.5).toString(), 862 - half - 17, 224 + offset, 11, '#d0e7da');
    }
    ctx.strokeStyle = '#f7d57d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(799, 224); ctx.lineTo(840, 224); ctx.lineTo(850, 234); ctx.moveTo(925, 224); ctx.lineTo(884, 224); ctx.lineTo(874, 234); ctx.stroke();
    ctx.strokeStyle = '#e3eee0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(862, 218, 83, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    ctx.restore();
    text('HDG  062°', 862, 91, 18, '#b5ebbd', 'center', 'monospace');
    text(airliner ? '250' : fighter ? '330' : '210', 716, 224, 24, '#d3f9d2', 'center', 'monospace');
    text('6,800', 994, 224, 22, '#d3f9d2', 'center', 'monospace');
    text('AP  ·  ALT', 862, 352, 15, '#a6ddb8', 'center', 'monospace');

    roundRect(1090, 54, 408, 336, 15, '#080e11', '#526165');
    roundRect(1107, 71, 374, 300, 4, '#0b211f');
    ctx.save(); ctx.beginPath(); ctx.rect(1107, 71, 374, 300); ctx.clip();
    ctx.strokeStyle = '#1f4a3c'; ctx.lineWidth = 1;
    for (let x = 1115; x < 1490; x += 39) { ctx.beginPath(); ctx.moveTo(x, 95); ctx.lineTo(x, 352); ctx.stroke(); }
    for (let y = 103; y < 370; y += 39) { ctx.beginPath(); ctx.moveTo(1107, y); ctx.lineTo(1481, y); ctx.stroke(); }
    ctx.strokeStyle = '#416b48'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(1107, 314); ctx.bezierCurveTo(1190, 240, 1160, 145, 1275, 130); ctx.bezierCurveTo(1370, 115, 1360, 210, 1480, 190); ctx.stroke();
    ctx.strokeStyle = '#a4db9d'; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.moveTo(1294, 352); ctx.lineTo(1294, 102); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e5f4cb'; ctx.beginPath(); ctx.moveTo(1294, 208); ctx.lineTo(1279, 240); ctx.lineTo(1294, 233); ctx.lineTo(1309, 240); ctx.closePath(); ctx.fill();
    ctx.restore();
    text('NAV  062°  ·  GPS', 1294, 91, 17, '#ade5b4', 'center', 'monospace');
    text('DEST  LOWI', 1130, 345, 13, '#86b79c', 'left', 'monospace');
    text('18.4 NM', 1460, 345, 13, '#86b79c', 'right', 'monospace');
    // Engine monitor and the right-hand analog vertical-speed instrument.
    dial(1834, 226, 139, 'VERTICAL SPEED', 900, 4000, 'FT / MIN');
    roundRect(1525, 92, 137, 278, 6, '#091717', '#4a5b5c');
    text('N1', 1594, 111, 14, '#87a89a');
    text(fighter ? 'ENG    AB' : 'L      R', 1594, 146, 12, '#a9d7b8', 'center', 'monospace');
    for (let i = 0; i < 2; i++) {
      const x = 1564 + i * 59;
      roundRect(x - 13, 174, 26, 114, 2, '#1d3931');
      if (fighter && i === 1) { text('OFF', x, 315, 17, '#86b79c', 'center', 'monospace'); continue; }
      roundRect(x - 10, 203 + i * 2, 20, 82 - i * 2, 1, '#7cb99a');
      text('72', x, 315, 19, '#b5e0bb', 'center', 'monospace');
    }
    text('% RPM', 1594, 346, 11, '#6c9182', 'center', 'monospace');
    text(airliner ? 'BOEING' : fighter ? 'AROLLA' : 'VELA', 45, 27, 17, '#b7c6c5', 'left');
    text(airliner ? '737-800  /  TWIN TURBOFAN' : fighter ? 'F7  /  SINGLE-SEAT FIGHTER' : 'J8  /  TWIN TURBOFAN', fighter ? 150 : 140, 27, 12, '#788f90', 'left');
    text(info.registration, 2004, 27, 15, '#b6c8c6', 'right', 'monospace');
    for (const x of [31, 635, 1510, 2017]) for (const y of [46, 403]) {
      ctx.fillStyle = '#58676a'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#101b20'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const instrumentMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const screen = part(new THREE.PlaneGeometry(2.84, 0.61), instrumentMaterial, dashboard);
    screen.position.set(0, 0.005, 0.174);
  }
  // A short center console and two knurled knobs add depth without covering the view.
  const consoleBody = part(new THREE.BoxGeometry(0.46, 0.42, 0.58), charcoal);
  consoleBody.position.set(0.45, -1.25, -1.28);
  consoleBody.visible = !fighter;
  for (const x of [-0.58, 0.58]) {
    const knob = part(new THREE.CylinderGeometry(0.033, 0.033, 0.065, 20), rubber, dashboard);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, -0.25, 0.21);
    const cap = part(new THREE.CylinderGeometry(0.024, 0.024, 0.068, 20), trim, dashboard);
    cap.rotation.x = Math.PI / 2; cap.position.copy(knob.position);
  }
  return cockpit;
}

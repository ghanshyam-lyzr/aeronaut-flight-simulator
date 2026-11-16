import { createAircraftPaint } from './aircraft-paint.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { interceptor as type } from './interceptor-type.js';
import { disposeObject } from './helicopter.js';

const clamp = THREE.MathUtils.clamp;
const ease = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
const smooth = t => THREE.MathUtils.smoothstep(t, 0, 1);

// Two-tone cool grey with a graphite radome, one restrained bronze accent, gold-tinted glass and burnt-titanium nozzles.
const palette = {
  top: 'hsl(208, 9%, 46%)', belly: 'hsl(205, 10%, 72%)', graphite: 'hsl(210, 12%, 17%)', bronze: 'hsl(32, 40%, 42%)',
  ivory: 'hsl(48, 22%, 91%)', canopy: 'hsl(42, 38%, 24%)', metal: 'hsl(205, 8%, 44%)', titanium: 'hsl(24, 12%, 27%)',
  heatTint: 'hsl(226, 14%, 30%)', rubber: 'hsl(210, 15%, 8%)', throat: 'hsl(18, 30%, 6%)',
};
// Metres; nose -Z, up +Y. Wing root/tip, nozzle and gear placement.
export const D = {
  rootX: 1.3, tipX: 6, rootLE: -1.2, rootTE: 3.6, sweep: 40 * Math.PI / 180, tipChord: 1.4,
  nozzleX: 0.6, nozzleY: 0, nozzleZ: 7.15, nozzleLength: 1.05, nozzleRadius: 0.5,
  noseGear: { z: -5.0, y: -0.42, radius: 0.24 }, mainGear: { x: 1.75, z: 1.35, y: -0.24, radius: 0.34 },
  finX: 0.95, finY: 0.55, finCant: 0.26,
};
const wingY = x => -0.05 - (x - D.rootX) * 0.02;
const leadingZ = x => D.rootLE + (x - D.rootX) * Math.tan(D.sweep);
const trailingZ = x => D.rootTE + (x - D.rootX) * ((leadingZ(D.tipX) + D.tipChord - D.rootTE) / (D.tipX - D.rootX));
const hingeZ = x => trailingZ(x) - (0.78 - (x - D.rootX) * 0.05);

/** Original procedural Taris F12 twin-engine interceptor; no textures, assets or model downloads. */
export function createInterceptor() {
  const group = new THREE.Group();
  group.name = `${type.name} — ${type.registration}`;
  const shell = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.46, metalness: 0.16, clearcoat: 0.4, clearcoatRoughness: 0.45 });
  const belly = new THREE.MeshPhysicalMaterial({ color: palette.belly, roughness: 0.48, metalness: 0.14, clearcoat: 0.35 });
  const graphite = new THREE.MeshStandardMaterial({ color: palette.graphite, roughness: 0.55, metalness: 0.3 });
  const bronze = new THREE.MeshPhysicalMaterial({ color: palette.bronze, roughness: 0.34, metalness: 0.45, clearcoat: 0.7 });
  const ivory = new THREE.MeshPhysicalMaterial({ color: palette.ivory, roughness: 0.3, metalness: 0.08, clearcoat: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({ color: palette.canopy, roughness: 0.05, metalness: 0.68, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7 });
  const metal = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.3, metalness: 0.9 });
  const titanium = new THREE.MeshStandardMaterial({ color: palette.titanium, roughness: 0.42, metalness: 0.88, side: THREE.DoubleSide });
  const heatTint = new THREE.MeshStandardMaterial({ color: palette.heatTint, roughness: 0.38, metalness: 0.9, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: palette.rubber, roughness: 0.86 });
  const stripe = bronze.clone();
  const materials = { shell, belly, graphite, bronze, stripe, ivory, glass, metal, titanium, heatTint, rubber };
  const top = new THREE.Color(palette.top), under = new THREE.Color(palette.belly);
  const surfaces = { flaps: [], ailerons: [], elevators: [], rudder: [] };
  const gearLegs = [], lights = [], navigation = [];

  function mesh(geometry, material, parent = group, name = '') {
    const object = new THREE.Mesh(geometry, material);
    object.name = name; object.castShadow = true; object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function rod(a, b, radius, material, parent = group, segments = 10) {
    const p1 = new THREE.Vector3(...a), p2 = new THREE.Vector3(...b);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, p1.distanceTo(p2), segments), material, parent);
    object.position.copy(p1).add(p2).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.sub(p1).normalize());
    return object;
  }
  function tube(points, radius, material, closed = false, parent = group) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed);
    return mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 5), radius, 6, closed), material, parent);
  }
  function interpolate(stations, z) {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
    const a = stations[Math.max(0, i - 1)], b = stations[i];
    const c = stations[i + 1], d = stations[Math.min(stations.length - 1, i + 2)];
    const t = clamp((z - b[0]) / (c[0] - b[0]), 0, 1);
    return b.slice(1).map((_, n) => {
      const k = n + 1, v0 = (c[k] - a[k]) * 0.5, v1 = (d[k] - b[k]) * 0.5;
      return (2 * b[k] - 2 * c[k] + v0 + v1) * t ** 3 + (-3 * b[k] + 3 * c[k] - 2 * v0 - v1) * t ** 2 + v0 * t + b[k];
    });
  }
  const ring = (angle, rx, ry, n) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [rx * Math.sign(c) * Math.abs(c) ** (2 / n), ry * Math.sign(s) * Math.abs(s) ** (2 / n)];
  };
  // Station loft [z, rx, ry, centreY, exponent], counter-shaded from the darker grey back to the pale belly.
  function loft(stations, material, { x = 0, arc = Math.PI * 2, rings = 64, sides = 48, shade = true } = {}) {
    const vertices = [], colors = [], indices = [], c = new THREE.Color();
    const z0 = stations[0][0], z1 = stations[stations.length - 1][0];
    for (let i = 0; i <= rings; i++) {
      const z = THREE.MathUtils.lerp(z0, z1, i / rings);
      const [rx, ry, cy, n] = interpolate(stations, z);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * arc;
        const [px, py] = ring(angle, Math.max(0.003, rx), Math.max(0.003, ry), Math.max(2, n));
        vertices.push(x + px, cy + py, z);
        if (shade) c.lerpColors(under, top, smooth(clamp(Math.sin(angle) * 1.1 + 0.45, 0, 1))); else c.set('#ffffff');
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(geometry, material);
  }
  // A flat faceted panel from coplanar outline points with per-point thickness; faces facing down take the belly grey.
  function panelGeometry(points, thickness, origin = [0, 0, 0]) {
    const P = points.map(p => new THREE.Vector3(...p).sub(new THREE.Vector3(...origin)));
    const normal = new THREE.Vector3();
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      normal.x += (a.y - b.y) * (a.z + b.z); normal.y += (a.z - b.z) * (a.x + b.x); normal.z += (a.x - b.x) * (a.y + b.y);
    }
    normal.normalize();
    const u = P[1].clone().sub(P[0]).normalize(), v = new THREE.Vector3().crossVectors(normal, u);
    const flat = P.map(p => new THREE.Vector2(p.clone().sub(P[0]).dot(u), p.clone().sub(P[0]).dot(v)));
    const t = P.map((_, i) => (Array.isArray(thickness) ? thickness[i] : thickness) / 2);
    const upper = P.map((p, i) => p.clone().addScaledVector(normal, t[i]));
    const lower = P.map((p, i) => p.clone().addScaledVector(normal, -t[i]));
    const centroid = P.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(P.length);
    const out = [], colors = [], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), face = new THREE.Vector3();
    const tri = (a, b, c, want) => {
      face.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      if (face.dot(want) < 0) [b, c] = [c, b];
      const tint = face.normalize().y < -0.25 ? under : top;
      for (const p of [a, b, c]) { out.push(p.x, p.y, p.z); colors.push(tint.r, tint.g, tint.b); }
    };
    const down = normal.clone().negate();
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) {
      tri(upper[i], upper[j], upper[k], normal);
      tri(lower[i], lower[j], lower[k], down);
    }
    for (let i = 0; i < P.length; i++) {
      const j = (i + 1) % P.length;
      const outward = P[i].clone().add(P[j]).multiplyScalar(0.5).sub(centroid);
      outward.addScaledVector(normal, -outward.dot(normal));
      tri(upper[i], upper[j], lower[j], outward);
      tri(upper[i], lower[j], lower[i], outward);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
  const panel = (points, thickness, material = shell, parent = group) => mesh(panelGeometry(points, thickness), material, parent);
  // A control surface pivots on its hinge line (a → b); axes are normalised so one sign convention serves both sides.
  function hinged(kind, points, thickness, sign = 1, hinge = points) {
    const a = new THREE.Vector3(...hinge[0]), b = new THREE.Vector3(...hinge[1]);
    const pivot = new THREE.Group();
    pivot.name = kind;
    pivot.position.copy(a).add(b).multiplyScalar(0.5);
    group.add(pivot);
    mesh(panelGeometry(points, thickness, pivot.position.toArray()), shell, pivot);
    const axis = b.clone().sub(a).normalize();
    if (kind === 'rudder' ? axis.y < 0 : axis.x < 0) axis.negate();
    surfaces[kind].push({ pivot, axis, sign, angle: 0 });
  }

  // Fuselage: a graphite radome, a slim forebody widening aft of the canopy into a broad twin-engine centre body.
  loft([[-8.85, 0.01, 0.01, 0.02, 2], [-8.4, 0.17, 0.16, 0.02, 2], [-7.6, 0.38, 0.36, 0.03, 2], [-6.85, 0.53, 0.5, 0.04, 2.1]],
    graphite, { rings: 24, sides: 40, shade: false });
  rod([0, 0.02, -8.8], [0, 0.02, -9.15], 0.018, metal, group, 6);
  const body = [
    [-6.9, 0.535, 0.505, 0.04, 2.1], [-5.8, 0.66, 0.6, 0.07, 2.5], [-4.5, 0.8, 0.68, 0.1, 3], [-3, 0.96, 0.72, 0.1, 3.2],
    [-1.5, 1.22, 0.72, 0.06, 3.6], [1, 1.34, 0.7, 0.02, 3.8], [4, 1.3, 0.66, 0, 3.8], [6, 1.18, 0.6, 0, 3.4], [7.2, 1.06, 0.55, 0, 3],
  ];
  loft(body, shell);
  // A dark aft bulkhead between the two nozzles closes the centre body.
  const aft = [];
  for (let j = 0; j < 32; j++) { const [px, py] = ring(j / 32 * Math.PI * 2, 1.04, 0.53, 3); aft.push([px, py, 7.19]); }
  panel(aft, 0.02, graphite);
  // Bubble canopy with gold-tinted glass, graphite bows and sills, a graphite anti-glare and a dorsal spine behind.
  const canopy = [[-5.7, 0.02, 0.02, 0.6, 2], [-5.1, 0.38, 0.4, 0.58, 2], [-4.3, 0.5, 0.56, 0.56, 2], [-3.4, 0.48, 0.52, 0.56, 2], [-2.6, 0.32, 0.34, 0.58, 2], [-2.0, 0.03, 0.03, 0.62, 2]];
  loft(canopy, glass, { arc: Math.PI, sides: 28, rings: 40, shade: false });
  for (const z of [-4.95, -3.0]) {
    const [rx, ry, cy] = interpolate(canopy, z), points = [];
    for (let j = 0; j <= 14; j++) { const a = j / 14 * Math.PI; points.push([Math.cos(a) * (rx + 0.014), cy + Math.sin(a) * (ry + 0.014), z]); }
    tube(points, z > -4 ? 0.03 : 0.022, graphite);
  }
  for (const side of [-1, 1]) tube(canopy.map(([z, rx, , cy]) => [side * (rx + 0.01), cy + 0.01, z]), 0.028, graphite);
  loft([[-2.8, 0.05, 0.05, 0.5, 2], [-2.0, 0.36, 0.32, 0.48, 2], [1, 0.48, 0.38, 0.42, 2.2], [5, 0.4, 0.3, 0.36, 2.2], [6.6, 0.05, 0.05, 0.3, 2]], shell, { rings: 40, sides: 32 });
  const antiGlare = mesh(new THREE.SphereGeometry(1, 24, 12), graphite);
  antiGlare.position.set(0, 0.63, -6.15); antiGlare.scale.set(0.3, 0.04, 0.75); antiGlare.rotation.x = 0.12;

  const intake = [[-3.45, 0.3, 0.42, -0.1, 4], [-2.4, 0.33, 0.45, -0.1, 4], [0, 0.3, 0.42, -0.08, 3.6], [2.6, 0.06, 0.12, -0.02, 3]];
  // Two rectangular side intakes under the canopy rail feed the twin engines, with graphite lips and dark throats.
  for (const side of [-1, 1]) {
    const x = side * 1.2;
    loft(intake, shell, { x, rings: 28, sides: 32 });
    const lip = [], mouth = [];
    for (let j = 0; j < 28; j++) {
      const [px, py] = ring(j / 28 * Math.PI * 2, 0.3, 0.42, 4);
      lip.push([x + px, -0.1 + py, -3.44]);
      mouth.push([x + px * 0.9, -0.1 + py * 0.9, -3.38]);
    }
    tube(lip, 0.026, graphite, true);
    panel(mouth, 0.02, graphite);
  }

  // A thin bronze line runs along each flank at shoulder height, over the intake trunks: the airframe's one accent stripe.
  const skinX = (stations, z, y, offset = 0) => {
    if (z < stations[0][0] || z > stations.at(-1)[0]) return 0;
    const [rx, ry, cy, n] = interpolate(stations, z), h = Math.abs(y - cy) / ry;
    return h >= 1 ? 0 : offset + rx * (1 - h ** n) ** (1 / n);
  };
  for (const side of [-1, 1]) {
    const line = [];
    for (let z = -6.4; z <= 6.6; z += 0.4) {
      const y = interpolate(body, z)[2] + 0.12;
      line.push([side * (Math.max(skinX(body, z, y), skinX(intake, z, y, 1.2)) + 0.012), y, z]);
    }
    tube(line, 0.022, stripe);
  }

  // Swept trapezoidal wings (~40° leading edge) with inboard flaps, outboard ailerons and ivory tip rounds.
  const hingePoint = (x, back = 0, side = 1) => [side * x, wingY(x), hingeZ(x) + back];
  const edge = (x, side) => [side * x, wingY(x), trailingZ(x)];
  for (const side of [-1, 1]) {
    panel([
      [side * D.rootX, wingY(D.rootX), D.rootLE], [side * D.tipX, wingY(D.tipX), leadingZ(D.tipX)], edge(D.tipX, side),
      edge(5.6, side), hingePoint(5.6, 0, side), hingePoint(1.4, 0, side), edge(1.4, side), edge(D.rootX, side),
    ], [0.3, 0.06, 0.05, 0.06, 0.09, 0.2, 0.12, 0.12]);
    const control = (from, to) => [hingePoint(from, 0, side), hingePoint(to, 0, side), edge(to, side), edge(from, side)];
    hinged('flaps', control(1.42, 3.55), [0.16, 0.1, 0.03, 0.04]);
    hinged('ailerons', control(3.65, 5.58), [0.1, 0.07, 0.02, 0.03], side);
    rod([side * 6.04, wingY(6) , leadingZ(6) - 0.2], [side * 6.04, wingY(6), trailingZ(6)], 0.04, graphite, group, 8);
    const round = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 12), ivory);
    round.rotation.x = Math.PI / 2; round.position.set(side * 6.04, wingY(6) - 0.11, leadingZ(6) + 0.6);
    const seeker = mesh(new THREE.ConeGeometry(0.07, 0.3, 12), ivory);
    seeker.rotation.x = -Math.PI / 2; seeker.position.set(side * 6.04, wingY(6) - 0.11, leadingZ(6) - 0.7);
  }

  // All-moving stabilators on one spanwise pivot each; differential travel helps the roll.
  for (const side of [-1, 1]) {
    hinged('elevators', [[side * 1.12, 0, 5.75], [side * 3.95, 0, 7.45], [side * 3.95, 0, 8.1], [side * 1.12, 0, 8.05]],
      [0.12, 0.04, 0.03, 0.08], side, [[side * 1.12, 0, 7.05], [side * 3.6, 0, 7.05]]);
  }

  // Twin vertical tails canted outward, each with a moving rudder and a bronze tip cap.
  const fin = (side, [, y, z]) => [side * (D.finX + y * Math.sin(D.finCant)), D.finY + y * Math.cos(D.finCant), z];
  for (const side of [-1, 1]) {
    const f = points => points.map(p => fin(side, p));
    panel(f([[0, 0, 3.5], [0, 2.92, 6.05], [0, 2.92, 6.95], [0, 2.55, 6.82], [0, 0.35, 6.88], [0, 0, 7.3]]), [0.2, 0.05, 0.05, 0.07, 0.11, 0.12]);
    panel(f([[0, 2.6, 5.77], [0, 2.94, 6.06], [0, 2.94, 6.96], [0, 2.6, 6.83]]), 0.065, bronze);
    hinged('rudder', f([[0, 0.36, 6.88], [0, 2.54, 6.82], [0, 2.54, 7.3], [0, 0.36, 7.56]]), [0.1, 0.06, 0.02, 0.03]);
  }

  // Two round convergent nozzles side by side: burnt titanium with a blued heat band, a heat disc and a restrained plume.
  const heatMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.06, toneMapped: false });
  const flameMaterial = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const outerFlame = flameMaterial('#ff6a2c'), innerFlame = flameMaterial('#ffd08a');
  const throatMaterial = new THREE.MeshBasicMaterial({ color: palette.throat });
  const exhausts = [], plumes = [];
  for (const side of [-1, 1]) {
    const exhaust = new THREE.Group();
    exhaust.name = 'exhaust'; exhaust.position.set(side * D.nozzleX, D.nozzleY, D.nozzleZ);
    group.add(exhaust); exhausts.push(exhaust);
    const r = D.nozzleRadius, L = D.nozzleLength;
    const nozzle = mesh(new THREE.CylinderGeometry(r * 0.9, r, L * 0.7, 28, 1, true), titanium, exhaust);
    nozzle.rotation.x = -Math.PI / 2; nozzle.position.z = L * 0.35;
    const band = mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.9, L * 0.3, 28, 1, true), heatTint, exhaust);
    band.rotation.x = -Math.PI / 2; band.position.z = L * 0.85;
    const throat = mesh(new THREE.CircleGeometry(r * 0.84, 28), throatMaterial, exhaust);
    throat.position.z = L * 0.55; throat.castShadow = false;
    const heat = mesh(new THREE.CircleGeometry(r * 0.78, 28), heatMaterial, exhaust, 'heat');
    heat.position.z = L * 0.57; heat.castShadow = false;
    const plume = new THREE.Group();
    plume.name = 'afterburner'; plume.position.z = L * 0.95;
    exhaust.add(plume); plumes.push(plume);
    for (const [radius, length, material] of [[0.4, 2.5, outerFlame], [0.26, 1.55, innerFlame]]) {
      const geometry = new THREE.CylinderGeometry(0.03, radius, length, 20, 1, true);
      geometry.translate(0, length / 2, 0); geometry.rotateX(Math.PI / 2);
      const flame = mesh(geometry, material, plume, 'flame');
      flame.castShadow = false; flame.receiveShadow = false;
    }
  }

  // Retractable tricycle gear: the nose leg folds forward, the mains fold inward, each over three seconds.
  const tyreDatum = 0.925 - type.groundClearance;
  function leg(name, { x, y, z, radius }, axis, stowAngle, door) {
    const pivot = new THREE.Group();
    pivot.name = name; pivot.position.set(x, y, z);
    group.add(pivot);
    const length = y - (tyreDatum + radius);
    rod([0, 0.04, 0], [0, -length * 0.62, 0], 0.075, metal, pivot);
    rod([0, -length * 0.55, 0], [0, -length + 0.02, 0], 0.055, metal, pivot);
    rod([0, -length * 0.22, -0.02], [0, -length * 0.22, door ? -0.5 : 0.5], 0.032, metal, pivot, 8);
    const tyre = mesh(new THREE.CylinderGeometry(radius, radius, radius * 0.62, 20), rubber, pivot, 'tyre');
    tyre.rotation.z = Math.PI / 2; tyre.position.set(0, -length, 0);
    const hub = mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.66, 16), metal, pivot);
    hub.rotation.z = Math.PI / 2; hub.position.copy(tyre.position);
    if (door) {
      const plate = mesh(new THREE.BoxGeometry(0.035, length * 0.7, 0.85), belly, pivot);
      plate.position.set(Math.sign(x) * 0.13, -length * 0.4, 0);
    }
    pivot.visible = false;
    gearLegs.push({ pivot, axis: new THREE.Vector3(...axis), stowAngle });
  }
  leg('retractable nose gear', { x: 0, ...D.noseGear }, [1, 0, 0], Math.PI * 0.5, false);
  for (const side of [-1, 1]) leg('retractable main gear', { ...D.mainGear, x: side * D.mainGear.x }, [0, 0, 1], -side * Math.PI * 0.5, true);

  // Navigation lights at the wingtips and tail, red strobes on the spine and belly.
  let haloTexture = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.15, 'rgba(255,255,255,.75)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,.18)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    haloTexture = new THREE.CanvasTexture(canvas); haloTexture.colorSpace = THREE.SRGBColorSpace;
  }
  function nav(x, y, z, color, flash = false) {
    const bulb = mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }), group, 'navigation light');
    bulb.position.set(x, y, z); bulb.scale.set(0.06, 0.05, 0.08); bulb.castShadow = false;
    lights.push(bulb);
    const entry = { bulb, sprite: null, flash };
    if (haloTexture) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
      sprite.position.set(x, y, z); sprite.scale.setScalar(flash ? 0.5 : 0.34);
      group.add(sprite); entry.sprite = sprite;
    }
    navigation.push(entry);
  }
  nav(-6.04, wingY(6) + 0.06, leadingZ(6) + 0.1, '#ff4534');
  nav(6.04, wingY(6) + 0.06, leadingZ(6) + 0.1, '#56ffbb');
  nav(0, 0.12, 7.6, '#fff6df');
  nav(0, 0.84, 2.4, '#ff583d', true);
  nav(0, -0.72, 0.6, '#ff583d', true);

  // Batch immutable root meshes by material; gear, surfaces, exhausts and lights keep their own nodes.
  const batches = new Map();
  group.updateMatrixWorld(true);
  for (const object of [...group.children]) if (object.isMesh && !lights.includes(object)) {
    const g = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g; if (g !== flat) g.dispose();
    flat.deleteAttribute('uv');
    if (!object.material.vertexColors) flat.deleteAttribute('color');
    const list = batches.get(object.material) ?? []; list.push(flat); batches.set(object.material, list);
    group.remove(object); object.geometry.dispose();
  }
  for (const [material, geometries] of batches) { mesh(mergeGeometries(geometries), material, group, 'airframe'); geometries.forEach(g => g.dispose()); }

  let clock = 0, gearPosition = 0, flapAngle = 0, burner = 0, last = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  const turn = new THREE.Quaternion();
  return {
    group,
    materials, paint: createAircraftPaint({ body: [shell, belly], accent: [bronze], stripe: [stripe] }),
    update(dt, throttle = 0.72, state = {}) {
      clock = state.time ?? clock + dt;
      const spool = clamp(state.spool ?? throttle, 0, 1);
      // Both engines read the one simulated spool; reheat eases in and its plumes stay short and dim.
      burner = ease(burner, state.afterburner && !state.crashed ? 1 : 0, 6, dt);
      const flicker = 0.9 + Math.sin(clock * 43) * 0.06 + Math.sin(clock * 21) * 0.04, running = state.crashed ? 0 : 1;
      heatMaterial.opacity = (0.06 + spool * spool * 0.45) * running + burner * 0.3;
      heatMaterial.color.set(burner > 0.3 ? '#ffb070' : '#ff8a3d');
      outerFlame.opacity = ((spool > 0.6 ? (spool - 0.6) * 0.11 : 0) * running + burner * 0.33 * flicker);
      innerFlame.opacity = burner * 0.48 * flicker;
      for (const plume of plumes) { plume.scale.set(1, 1, 0.35 + burner * 0.65 * flicker); plume.visible = outerFlame.opacity > 0.002; }

      // Gear runs through a 3-second cycle; on the ground or at a fresh start it is simply where it should be.
      const gearTarget = state.gearDown ? 1 : 0, fresh = (state.flightTime ?? 1) < 0.05;
      if (state.grounded || fresh) gearPosition = gearTarget;
      else gearPosition += clamp(gearTarget - gearPosition, -dt / 3, dt / 3);
      for (const { pivot, axis, stowAngle } of gearLegs) {
        pivot.visible = gearPosition > 0.01;
        pivot.quaternion.setFromAxisAngle(axis, stowAngle * (1 - smooth(gearPosition)));
      }

      // Surfaces follow the body-axis rates the aerobatic flight model supplies (smooth through loops and inverted flight).
      if (dt > 0) {
        const now = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        if (!last || fresh) last = now;
        let bankRate = (now.bank - last.bank) / dt, pitchRate = (now.pitch - last.pitch) / dt, yawRate;
        if (state.bodyRates) ({ roll: bankRate, pitch: pitchRate, yaw: yawRate } = state.bodyRates);
        else {
          const headingRate = Math.atan2(Math.sin(now.heading - last.heading), Math.cos(now.heading - last.heading)) / dt;
          yawRate = headingRate - 9.81 * Math.tan(now.bank) / Math.max(state.speed ?? 0, 24);
        }
        const live = state.grounded || state.crashed ? 0 : 1;
        deflection.ailerons = ease(deflection.ailerons, clamp(bankRate * 0.3, -0.35, 0.35) * live, 10, dt);
        deflection.elevators = ease(deflection.elevators, clamp(pitchRate * 1.2, -0.3, 0.3) * live, 10, dt);
        deflection.rudder = ease(deflection.rudder, clamp(yawRate * 2.4, -0.35, 0.35) * live, 6, dt);
        last = now;
        // 15° per stage at 0.22 rad/s; a fresh flight starts with the flaps where they are set.
        const flapTarget = (state.flaps ?? 0) * Math.PI / 12;
        flapAngle = fresh ? flapTarget : flapAngle + clamp(flapTarget - flapAngle, -dt * 0.22, dt * 0.22);
      }
      // Flaps report trailing-edge-down positive; the other surfaces trailing-edge-up positive, rudder nose-right positive.
      const angle = {
        flaps: () => flapAngle,
        ailerons: sign => deflection.ailerons * sign,
        elevators: sign => deflection.elevators + deflection.ailerons * 0.4 * sign,
        rudder: () => deflection.rudder,
      };
      for (const [name, list] of Object.entries(surfaces)) for (const surface of list) {
        surface.angle = angle[name](surface.sign);
        const rotation = name === 'rudder' || name === 'flaps' ? surface.angle : -surface.angle;
        surface.pivot.quaternion.copy(turn.setFromAxisAngle(surface.axis, rotation));
      }

      for (const { bulb, sprite, flash } of navigation) if (flash) {
        const phase = clock % 1.4, on = phase < 0.07 || (phase > 0.15 && phase < 0.21);
        if (sprite) sprite.material.opacity = on ? 1 : 0.08;
        bulb.material.color.set(on ? '#ff583d' : '#4a1a14');
      }
    },
    get gearPosition() { return gearPosition; },
    get afterburner() { return burner; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([name, list]) => [name, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() { disposeObject(group); },
  };
}

// Camera-local panel layouts, in metres at COCKPIT.z. Each sits in a gap of the page chrome: the wide strip between the
// camera chip, the map and the HTML instrument strip on desktops; the compact strip between the map and the camera chip on phones.
export const COCKPIT = {
  z: -1.835,
  wide: { width: 2.1, height: 0.44, x: 0, y: -0.43, pixels: [1260, 264] },
  compact: { width: 0.92, height: 0.27, x: -0.05, y: 0.16, pixels: [832, 244] },
  // A small HUD combiner just above the wide panel's glare shield, below the horizon. Phones omit it.
  hud: { width: 0.32, height: 0.13, y: -0.075, z: -1.9, pixels: [512, 208] },
};

/** Camera-local single-seat interceptor cockpit: a thin canopy bow, a low graphite panel and a small HUD combiner. */
export function createInterceptorCockpit() {
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(210, 12%, 14%)', roughness: 0.78, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  const bronze = new THREE.MeshStandardMaterial({ color: palette.bronze, metalness: 0.45, roughness: 0.4 });
  function part(g, m = dark, parent = root, name = '') { const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  // Bubble canopy: no centre post, one hairline bow arching well beyond the near plane.
  const bow = new THREE.CatmullRomCurve3([[-2.4, -1.1, -1.7], [-2.15, 0.35, -2.05], [-1.35, 1.5, -2.3], [0, 1.9, -2.4], [1.35, 1.5, -2.3], [2.15, 0.35, -2.05], [2.4, -1.1, -1.7]].map(p => new THREE.Vector3(...p)));
  part(new THREE.TubeGeometry(bow, 48, 0.011, 6, false), trim, root, 'canopy bow');
  const panels = {};
  for (const [name, p] of Object.entries({ wide: COCKPIT.wide, compact: COCKPIT.compact })) {
    const group = new THREE.Group(); group.name = `${name} panel`; group.position.set(p.x, p.y, 0); root.add(group);
    part(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.06, 0.06), dark, group, 'panel shell').position.z = COCKPIT.z - 0.04;
    part(new THREE.BoxGeometry(p.width + 0.06, 0.03, 0.2), trim, group, 'glare shield').position.set(0, p.height / 2 + 0.045, COCKPIT.z - 0.1);
    part(new THREE.BoxGeometry(p.width * 0.4, 0.006, 0.008), bronze, group, 'glare shield edge').position.set(0, p.height / 2 + 0.034, COCKPIT.z + 0.006);
    panels[name] = { ...p, group };
  }
  const h = COCKPIT.hud, hud = new THREE.Group();
  hud.name = 'hud'; hud.position.set(0, h.y, h.z); hud.rotation.x = -0.18; root.add(hud);
  part(new THREE.PlaneGeometry(h.width, h.height), new THREE.MeshBasicMaterial({ color: '#b9d7c3', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }), hud, 'hud glass');
  for (const side of [-1, 1]) part(new THREE.BoxGeometry(0.01, h.height + 0.02, 0.01), trim, hud, 'hud post').position.set(side * (h.width / 2 + 0.005), -0.01, 0);
  let layout = 'wide', force = true;
  const setLayout = name => {
    if (name !== layout) force = true;
    layout = name; panels.wide.group.visible = name === 'wide'; panels.compact.group.visible = name === 'compact'; hud.visible = name === 'wide';
  };
  setLayout('wide');
  root.userData.panels = panels; root.userData.hud = hud;
  root.userData.update = () => {};
  root.userData.fit = aspect => setLayout(aspect < 0.8 ? 'compact' : 'wide');
  if (typeof document === 'undefined') return root;

  const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', line: 'hsl(205 15% 26%)', warn: 'hsl(0 78% 52%)', burner: 'hsl(28 90% 60%)' };
  const canvasFor = ([w, hgt]) => {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hgt;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx: canvas.getContext('2d'), texture };
  };
  for (const p of Object.values(panels)) {
    Object.assign(p, canvasFor(p.pixels));
    part(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshBasicMaterial({ map: p.texture, toneMapped: false }), p.group, 'panel screen').position.z = COCKPIT.z;
  }
  const hudCanvas = canvasFor(h.pixels);
  part(new THREE.PlaneGeometry(h.width, h.height), new THREE.MeshBasicMaterial({ map: hudCanvas.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), hud, 'hud symbology').position.z = 0.002;
  const label = (ctx, text, x, y, size, color = colors.muted, align = 'left') => { ctx.font = `500 ${size}px "DM Sans", sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y); };
  const number = (ctx, text, x, y, size, color = colors.signal, align = 'left') => { ctx.font = `500 ${size}px "Barlow Condensed", monospace`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y); };

  function drawHud({ ctx, canvas, texture }, v) {
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, perDegree = H / 34;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = colors.signal; ctx.fillStyle = colors.signal; ctx.lineWidth = 3;
    // Pitch ladder rolled by bank and shifted by pitch: correct through loops and inverted flight.
    ctx.save(); ctx.beginPath(); ctx.rect(W * 0.2, 4, W * 0.6, H - 8); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-v.bank);
    for (let deg = -90; deg <= 90; deg += 10) {
      const y = (v.pitch - deg) * perDegree; if (Math.abs(y) > H) continue;
      const half = deg === 0 ? W * 0.36 : W * 0.12;
      ctx.setLineDash(deg < 0 ? [10, 7] : []);
      ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(-W * 0.05, y); ctx.moveTo(W * 0.05, y); ctx.lineTo(half, y); ctx.stroke();
      if (deg) number(ctx, String(Math.abs(deg)), half + 6, y, 22);
    }
    ctx.setLineDash([]); ctx.restore();
    // Fixed aircraft reference, speed and altitude either side, heading on top.
    ctx.beginPath(); ctx.moveTo(cx - 44, cy); ctx.lineTo(cx - 16, cy); ctx.lineTo(cx, cy + 12); ctx.lineTo(cx + 16, cy); ctx.lineTo(cx + 44, cy); ctx.stroke();
    number(ctx, String(v.speed), 8, cy, 40); number(ctx, String(v.altitude), W - 8, cy, 40, colors.signal, 'right');
    number(ctx, String(v.heading).padStart(3, '0'), cx, 22, 28, colors.signal, 'center');
    if (v.burner) number(ctx, 'A/B', 8, H - 24, 30);
    texture.needsUpdate = true;
  }

  function drawPanel({ ctx, canvas, texture }, v, compact) {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
    const box = (x, y, w, hgt, title, value, units, size) => {
      ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, hgt);
      label(ctx, title, x + 12, y + 26, 26); number(ctx, value, x + 12, y + hgt * 0.64, size); label(ctx, units, x + w - 10, y + hgt * 0.68, 22, colors.muted, 'right');
    };
    const engines = (x, y, w, hgt) => {
      label(ctx, 'N1 % · one shared spool', x, y + 16, 26);
      for (let i = 0; i < 2; i++) {
        const bx = x + i * (w / 2), barW = w / 2 - 16;
        number(ctx, String(v.n1), bx, y + 54, 34, colors.ink);
        ctx.fillStyle = colors.line; ctx.fillRect(bx, y + 78, barW, hgt - 118);
        ctx.fillStyle = colors.signal; ctx.fillRect(bx, y + 78, barW * v.spool, hgt - 118);
        label(ctx, i ? 'Right' : 'Left', bx, y + hgt - 20, 24);
      }
    };
    const status = (x, y, w, row) => {
      ctx.strokeStyle = v.burner ? colors.burner : colors.line; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, 52);
      if (v.burner) { ctx.fillStyle = colors.burner; ctx.fillRect(x + 2, y + 2, w - 4, 48); }
      number(ctx, 'A/B', x + w / 2, y + 27, 34, v.burner ? colors.background : colors.muted, 'center');
      label(ctx, 'Gear', x, y + 52 + row, 26); number(ctx, v.gear, x + w, y + 52 + row, 32, v.gearDown ? colors.signal : colors.ink, 'right');
      label(ctx, 'Flaps', x, y + 52 + row * 2, 26); number(ctx, `${v.flaps}°`, x + w, y + 52 + row * 2, 32, v.flaps ? colors.signal : colors.ink, 'right');
    };
    if (compact) {
      // One row for phones: speed, altitude, the shared N1, then reheat, gear and flaps.
      box(12, 12, 170, H - 24, 'IAS', String(v.speed), 'KT', 54); box(194, 12, 170, H - 24, 'ALT', String(v.altitude), 'FT', 54);
      engines(384, 12, 220, H - 24); status(624, 14, 196, 52);
    } else {
      label(ctx, `${type.name} / ${type.registration}`, 20, 26, 24);
      box(20, 52, 220, 192, 'Airspeed', String(v.speed), 'KT', 60); box(256, 52, 220, 192, 'Altitude', String(v.altitude), 'FT', 60);
      engines(506, 22, 380, 232); status(920, 30, 316, 56);
      label(ctx, v.stalled ? 'STALL' : type.badge, 1078, 236, 26, v.stalled ? colors.warn : colors.muted, 'center');
    }
    texture.needsUpdate = true;
  }

  let lastKey = '';
  root.userData.update = state => {
    const spool = clamp(state.spool ?? 0, 0, 1), gearDown = !!state.gearDown;
    const v = {
      speed: Math.round((state.speed ?? 0) * 1.94384), altitude: Math.round((state.position?.y ?? 0) * 3.28084),
      heading: ((Math.round((state.heading ?? 0) * 180 / Math.PI) % 360) + 360) % 360,
      bank: Math.round((state.bank ?? 0) * 200) / 200, pitch: Math.round(clamp(state.pitch ?? 0, -Math.PI / 2, Math.PI / 2) * 180 / Math.PI * 4) / 4,
      spool: Math.round(spool * 100) / 100, n1: Math.round(22 + spool * 76), burner: !!state.afterburner,
      gearDown, gear: gearDown ? 'Down' : 'Up', flaps: (state.flaps ?? 0) * 15, stalled: !!state.stalled,
    };
    const key = `${layout}|${Object.values(v).join('|')}`;
    if (key === lastKey && !force) return;
    lastKey = key; force = false;
    drawPanel(panels[layout], v, layout === 'compact');
    if (layout === 'wide') drawHud(hudCanvas, v);
  };
  return root;
}

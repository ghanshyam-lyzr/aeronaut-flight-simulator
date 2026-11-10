import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const ease = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
const smooth = t => THREE.MathUtils.smoothstep(t, 0, 1);

// The Arolla F7: an original single-seat delta fighter, modelled in metres with the nose down local -Z.
// Glacier-grey counter-shading, an ink anti-glare and coral fin caps keep it in the Alpine Flight livery.
export function createFighter() {
  const group = new THREE.Group();
  group.name = 'Arolla F7 — A-F07';
  const palette = {
    top: '#7d888c', belly: '#c8cdca', grey: '#8f999c', ink: '#152932', coral: '#e75a36', ivory: '#eeece4',
    canopy: '#3a3a2d', metal: '#6b7377', burnt: '#3f3c3a', rubber: '#12181c', seam: '#5f6a6e',
  };
  const shell = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.48, metalness: 0.18, clearcoat: 0.35, clearcoatRoughness: 0.5 });
  const grey = new THREE.MeshPhysicalMaterial({ color: palette.grey, roughness: 0.5, metalness: 0.18, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const ink = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: 0.6, metalness: 0.3 });
  const coral = new THREE.MeshPhysicalMaterial({ color: palette.coral, roughness: 0.32, metalness: 0.12, clearcoat: 0.8 });
  const ivory = new THREE.MeshPhysicalMaterial({ color: palette.ivory, roughness: 0.3, metalness: 0.1, clearcoat: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: palette.canopy, roughness: 0.06, metalness: 0.62, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 });
  const metal = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.32, metalness: 0.9 });
  const burnt = new THREE.MeshStandardMaterial({ color: palette.burnt, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: palette.rubber, roughness: 0.85 });
  const materials = { shell, grey, ink, coral, ivory, glass, metal, burnt, rubber };
  const navigation = [];
  const surfaces = { flaps: [], ailerons: [], elevators: [], rudder: [] };
  const gearLegs = [];

  function mesh(geometry, material, parent = group) {
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function rod(a, b, radius, material, parent = group) {
    const p1 = new THREE.Vector3(...a), p2 = new THREE.Vector3(...b);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, p1.distanceTo(p2), 12), material, parent);
    object.position.copy(p1).add(p2).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.sub(p1).normalize());
    return object;
  }
  function tube(points, radius, material, closed = false, parent = group) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed);
    return mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 6), radius, 6, closed), material, parent);
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
  // A superellipse ring: exponent 2 is an ellipse, higher values give the flat-sided chined sections of a fighter.
  const ring = (angle, rx, ry, n) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [rx * Math.sign(c) * Math.abs(c) ** (2 / n), ry * Math.sign(s) * Math.abs(s) ** (2 / n)];
  };
  // Station loft [z, rx, ry, centreY, exponent], counter-shaded from a darker back to a pale belly.
  function loft(stations, material, { x = 0, y = 0, arc = Math.PI * 2, rings = 72, sides = 56, shade = true } = {}) {
    const vertices = [], colors = [], indices = [];
    const top = new THREE.Color(palette.top), belly = new THREE.Color(palette.belly), c = new THREE.Color();
    const z0 = stations[0][0], z1 = stations[stations.length - 1][0];
    for (let i = 0; i <= rings; i++) {
      const z = THREE.MathUtils.lerp(z0, z1, i / rings);
      const [rx, ry, cy, n] = interpolate(stations, z);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * arc;
        const [px, py] = ring(angle, Math.max(0.003, rx), Math.max(0.003, ry), Math.max(2, n));
        vertices.push(x + px, y + cy + py, z);
        c.lerpColors(belly, top, smooth(clamp(Math.sin(angle) * 0.9 + 0.55, 0, 1)));
        if (!shade) c.set('#ffffff');
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
  // A flat, faceted panel from coplanar 3D outline points with per-point thickness: wings, fins and control surfaces.
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
    const out = [], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), face = new THREE.Vector3();
    const tri = (a, b, c, want) => {
      face.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      if (face.dot(want) < 0) [b, c] = [c, b];
      for (const p of [a, b, c]) out.push(p.x, p.y, p.z);
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
    geometry.computeVertexNormals();
    return geometry;
  }
  const panel = (points, thickness, material, parent = group) => mesh(panelGeometry(points, thickness), material, parent);
  // A control surface pivots on its hinge line (a → b); positive deflection lifts or yaws the trailing edge.
  function hinged(kind, points, thickness, material, sign = 1, parent = group, hinge = points) {
    const a = new THREE.Vector3(...hinge[0]), b = new THREE.Vector3(...hinge[1]);
    const pivot = new THREE.Group();
    pivot.position.copy(a).add(b).multiplyScalar(0.5);
    parent.add(pivot);
    mesh(panelGeometry(points, thickness, pivot.position.toArray()), material, pivot);
    const axis = b.clone().sub(a).normalize();
    // Normalise axes so one sign convention works on both sides of the aircraft.
    if (kind === 'rudder' ? axis.y < 0 : axis.x < 0) axis.negate();
    const surface = { pivot, axis, sign, angle: 0 };
    surfaces[kind].push(surface);
    return surface;
  }

  // Fuselage: a needle radome, chined forebody and a broad blended centre section ending at the nozzle.
  loft([
    [-8.1, 0.01, 0.01, 0.05, 2], [-7.6, 0.17, 0.16, 0.05, 2], [-6.6, 0.42, 0.36, 0.08, 2.3],
    [-5.2, 0.66, 0.54, 0.12, 2.8], [-3.6, 0.86, 0.66, 0.14, 3.1], [-1.6, 1.08, 0.72, 0.12, 3.4],
    [1.4, 1.12, 0.72, 0.1, 3.4], [3.8, 0.98, 0.66, 0.1, 3.1], [5.6, 0.76, 0.58, 0.1, 2.6], [6.7, 0.62, 0.54, 0.1, 2.2],
  ], shell);
  // Bubble canopy with a gold-tinted transparency, an ink frame and a dorsal spine behind it.
  const canopyStations = [[-5.75, 0.02, 0.02, 0.5, 2], [-5.1, 0.4, 0.38, 0.5, 2], [-4.2, 0.5, 0.6, 0.5, 2], [-3.2, 0.49, 0.6, 0.5, 2], [-2.3, 0.36, 0.4, 0.52, 2], [-1.5, 0.03, 0.03, 0.56, 2]];
  loft(canopyStations, glass, { arc: Math.PI, sides: 28, rings: 48, shade: false });
  for (const z of [-4.75, -2.85]) {
    const [rx, ry, cy] = interpolate(canopyStations, z), points = [];
    for (let j = 0; j <= 14; j++) { const a = j / 14 * Math.PI; points.push([Math.cos(a) * (rx + 0.015), cy + Math.sin(a) * (ry + 0.015), z]); }
    tube(points, z > -3 ? 0.035 : 0.025, ink);
  }
  for (const side of [-1, 1]) tube(canopyStations.map(([z, rx, , cy]) => [side * (rx + 0.01), cy + 0.01, z]), 0.03, ink);
  loft([[-2.6, 0.05, 0.05, 0.42, 2], [-1.6, 0.42, 0.38, 0.42, 2], [1.5, 0.5, 0.4, 0.38, 2.2], [4.6, 0.36, 0.3, 0.32, 2.2], [6.2, 0.04, 0.05, 0.3, 2]], shell);
  const antiGlare = mesh(new THREE.SphereGeometry(1, 24, 12), ink);
  antiGlare.position.set(0, 0.55, -6.05); antiGlare.scale.set(0.3, 0.035, 0.85); antiGlare.rotation.x = 0.13;
  rod([0, 0.05, -8.05], [0, 0.05, -8.85], 0.02, metal);

  // Caret intakes under the wing roots with ink throats and coral lips.
  for (const side of [-1, 1]) {
    const x = side * 1.12;
    loft([[-2.75, 0.3, 0.42, -0.22, 4], [-1.6, 0.34, 0.46, -0.22, 4], [0.4, 0.32, 0.44, -0.18, 3.6], [2.4, 0.05, 0.1, -0.05, 3]], shell, { x });
    const lip = [], mouth = [];
    for (let j = 0; j < 28; j++) {
      const [px, py] = ring(j / 28 * Math.PI * 2, 0.3, 0.42, 4);
      lip.push([x + px, -0.22 + py, -2.74]);
      mouth.push([x + px * 0.9, -0.22 + py * 0.9, -2.7]);
    }
    tube(lip, 0.028, coral, true);
    panel(mouth, 0.02, ink);
  }

  // Cranked delta wings with a long root extension, trailing-edge flaperons and ailerons, and tip rails.
  const hingeZ = x => 3.62 - (x - 1) * 0.112, hingeY = x => -0.05 - (x - 1) * 0.0133;
  const hingePoint = (x, back = 0, side = 1) => [side * x, hingeY(x), hingeZ(x) + back];
  for (const side of [-1, 1]) {
    panel([
      [side * 0.8, -0.04, -4.9], [side * 1.5, -0.05, -2.2], [side * 4.85, -0.1, 2.35], [side * 5.02, -0.1, 3.05],
      [side * 4.75, -0.1, 3.2], hingePoint(2.85, 0, side), [side * 1.0, -0.05, 3.62],
    ], [0.06, 0.2, 0.07, 0.06, 0.06, 0.13, 0.2], grey);
    hinged('flaps', [hingePoint(1.08, 0, side), hingePoint(2.8, 0, side), hingePoint(2.8, 0.66, side), hingePoint(1.08, 0.74, side)], [0.12, 0.1, 0.03, 0.03], grey);
    hinged('ailerons', [hingePoint(2.9, 0, side), hingePoint(4.62, 0, side), hingePoint(4.62, 0.5, side), hingePoint(2.9, 0.64, side)], [0.1, 0.06, 0.02, 0.03], grey, side);
    // Tip rails carry an ivory, coral-banded acquisition round, the only stores on a clean fighter.
    rod([side * 5.04, -0.1, 0.9], [side * 5.04, -0.1, 3.15], 0.045, ink);
    const round = mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.6, 14), ivory);
    round.rotation.x = Math.PI / 2; round.position.set(side * 5.04, -0.21, 1.95);
    const seeker = mesh(new THREE.ConeGeometry(0.075, 0.32, 14), ivory);
    seeker.rotation.x = -Math.PI / 2; seeker.position.set(side * 5.04, -0.21, 0.49);
    const band = mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.14, 14), coral);
    band.rotation.x = Math.PI / 2; band.position.set(side * 5.04, -0.21, 0.95);
    for (const angle of [0, Math.PI / 2]) {
      const finPoints = [[0, 0, 2.85], [0, 0.22, 3.12], [0, 0.22, 3.25], [0, 0, 3.25]].map(([, r, z]) => [side * 5.04 + Math.cos(angle) * r, -0.21 + Math.sin(angle) * r, z]);
      const finPoints2 = finPoints.map(([px, py, z]) => [2 * side * 5.04 - px, -0.42 - py, z]);
      panel(finPoints, 0.015, ivory); panel(finPoints2, 0.015, ivory);
    }
  }

  // All-moving stabilators pivot on one spanwise axis; differential travel helps the roll.
  for (const side of [-1, 1]) {
    hinged('elevators', [[side * 0.95, 0.05, 5.2], [side * 2.55, 0.05, 6.15], [side * 3.2, 0.05, 6.55], [side * 3.3, 0.05, 7.2], [side * 0.95, 0.05, 7.35]],
      [0.12, 0.06, 0.04, 0.03, 0.06], grey, side, group, [[side * 0.95, 0.05, 6.3], [side * 3, 0.05, 6.3]]);
  }

  // Twin outward-canted fins with rudders, coral caps and the registration in ivory.
  function canvasTexture(width, height, draw) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }
  const registration = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = palette.ivory;
    ctx.font = '600 92px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('A-F07', w / 2, h / 2 + 4);
  });
  for (const side of [-1, 1]) {
    const fin = new THREE.Group();
    fin.position.set(side * 0.78, 0.44, 0);
    fin.rotation.z = -side * 0.36;
    group.add(fin);
    panel([[0, 0, 3.2], [0, 2.55, 5.45], [0, 2.55, 6.3], [0, 2.02, 6.12], [0, 0.34, 6.3], [0, 0, 6.95]], [0.2, 0.05, 0.05, 0.08, 0.12, 0.12], grey, fin);
    panel([[0, 2.24, 5.14], [0, 2.56, 5.45], [0, 2.56, 6.31], [0, 2.24, 6.22]], 0.07, coral, fin);
    hinged('rudder', [[0, 0.36, 6.3], [0, 2.0, 6.13], [0, 2.0, 6.62], [0, 0.36, 6.95]], [0.1, 0.06, 0.02, 0.03], grey, 1, fin);
    if (registration) {
      const decal = mesh(new THREE.PlaneGeometry(1.15, 0.29), new THREE.MeshBasicMaterial({ map: registration, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), fin);
      decal.position.set(side * 0.075, 1.05, 5.55);
      decal.rotation.y = side * Math.PI / 2;
      decal.castShadow = false;
    }
    // Ventral strakes under the engine bay.
    panel([[side * 0.5, -0.46, 4.3], [side * 0.5, -0.42, 5.9], [side * 0.82, -1.0, 6.2], [side * 0.82, -1.0, 5.55]], 0.05, grey);
  }

  // Convergent nozzle: burnt titanium petals around a dark throat, with a heat glow and an afterburner plume.
  loft([[6.2, 0.64, 0.6, 0.1, 2], [6.9, 0.6, 0.57, 0.1, 2], [7.55, 0.5, 0.48, 0.1, 2]], burnt, { shade: false, rings: 8, sides: 32 });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    rod([Math.cos(a) * 0.61, 0.1 + Math.sin(a) * 0.58, 6.95], [Math.cos(a) * 0.51, 0.1 + Math.sin(a) * 0.49, 7.55], 0.012, ink);
  }
  const throat = mesh(new THREE.CircleGeometry(0.47, 32), new THREE.MeshBasicMaterial({ color: '#160f0c' }));
  throat.position.set(0, 0.1, 7.3); throat.castShadow = false;
  const heatMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.1, toneMapped: false });
  const heat = mesh(new THREE.CircleGeometry(0.43, 32), heatMaterial);
  heat.position.set(0, 0.1, 7.32); heat.castShadow = false;
  const plume = new THREE.Group();
  plume.position.set(0, 0.1, 7.5);
  group.add(plume);
  const flame = (radius, length, color) => {
    const geometry = new THREE.CylinderGeometry(0.03, radius, length, 24, 1, true);
    geometry.translate(0, length / 2, 0);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const object = mesh(geometry, material, plume);
    object.castShadow = false; object.receiveShadow = false;
    return material;
  };
  const outerFlame = flame(0.46, 4.2, '#ff6a2c'), innerFlame = flame(0.3, 2.6, '#ffd08a');

  // Tricycle gear: the nose leg folds forward and the mains fold inward, each through a 3-second cycle.
  function leg({ x, y, z, length, radius, axis, stowAngle, doors }) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    group.add(pivot);
    rod([0, 0.05, 0], [0, -length * 0.62, 0], 0.075, metal, pivot);
    rod([0, -length * 0.55, 0], [0, -length + 0.02, 0], 0.055, metal, pivot);
    rod([0, -length * 0.25, -0.02], [0, -length * 0.25, 0.55], 0.035, metal, pivot);
    const wheel = mesh(new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 12, 28), rubber, pivot);
    wheel.rotation.y = Math.PI / 2; wheel.position.set(0, -length, 0);
    const hub = mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.5, 20), metal, pivot);
    hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position);
    if (doors) {
      const door = mesh(new THREE.BoxGeometry(0.035, length * 0.7, 0.9), grey, pivot);
      door.position.set(Math.sign(x) * 0.12, -length * 0.4, 0);
    }
    pivot.visible = false;
    gearLegs.push({ pivot, axis, stowAngle });
  }
  leg({ x: 0, y: -0.33, z: -4.65, length: 1.27, radius: 0.27, axis: new THREE.Vector3(1, 0, 0), stowAngle: Math.PI * 0.5, doors: false });
  for (const side of [-1, 1]) leg({ x: side * 1.38, y: -0.48, z: 1.3, length: 1.03, radius: 0.36, axis: new THREE.Vector3(0, 0, 1), stowAngle: -side * Math.PI * 0.5, doors: true });

  // Navigation lights on the tip rails and fin, with a strobe under the spine.
  const haloTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(255,255,255,.75)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,.18)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  function nav(x, y, z, color, flash = false) {
    const bulb = mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    bulb.position.set(x, y, z); bulb.scale.set(0.06, 0.05, 0.08); bulb.castShadow = false;
    if (haloTexture) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
      sprite.position.set(x, y, z); sprite.scale.setScalar(flash ? 0.5 : 0.34);
      group.add(sprite); navigation.push({ sprite, flash });
    }
  }
  nav(-5.04, -0.02, 0.8, '#ff4534');
  nav(5.04, -0.02, 0.8, '#56ffbb');
  nav(0, 0.12, 7.62, '#fff6df');
  nav(0, 0.74, 2.6, '#ff583d', true);
  nav(0, -0.64, 0.4, '#ff583d', true);

  let clock = 0, gearPosition = 0, flapAngle = 0, burner = 0, last = null;
  const deflection = { ailerons: 0, elevators: 0, rudder: 0 };
  const turn = new THREE.Quaternion();
  return {
    group,
    materials,
    update(dt, throttle = 0.7, state = {}) {
      clock = state.time ?? clock + dt;
      const spool = clamp(state.spool ?? throttle, 0, 1);
      burner = ease(burner, state.afterburner && !state.crashed ? 1 : 0, 6, dt);
      const flicker = 0.88 + Math.sin(clock * 47) * 0.07 + Math.sin(clock * 23) * 0.05;
      heatMaterial.opacity = 0.06 + spool * spool * 0.5 + burner * 0.4;
      heatMaterial.color.set(burner > 0.3 ? '#ffb070' : '#ff8a3d');
      outerFlame.opacity = (spool > 0.6 ? (spool - 0.6) * 0.18 : 0) + burner * 0.55 * flicker;
      innerFlame.opacity = burner * 0.8 * flicker;
      plume.scale.set(1, 1, 0.35 + burner * 0.65 * flicker);

      // Gear runs through a 3-second cycle; on the ground or at a fresh start it is simply where it should be.
      const gearTarget = state.gearDown ? 1 : 0;
      if (state.grounded || (state.flightTime ?? 1) < 0.05) gearPosition = gearTarget;
      else gearPosition += clamp(gearTarget - gearPosition, -dt / 3, dt / 3);
      for (const { pivot, axis, stowAngle } of gearLegs) {
        pivot.visible = gearPosition > 0.01;
        pivot.quaternion.setFromAxisAngle(axis, stowAngle * (1 - smooth(gearPosition)));
      }

      // Control surfaces follow the attitude rates the flight model produces. Body-axis rates, when the
      // flight model supplies them, stay smooth through vertical and inverted flight where Euler angles jump.
      if (dt > 0) {
        const now = { bank: state.bank ?? 0, pitch: state.pitch ?? 0, heading: state.heading ?? 0 };
        if (!last) last = now;
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
        flapAngle += clamp((state.flaps ?? 0) * 0.3 - flapAngle, -dt * 0.25, dt * 0.25);
      }
      // Angles are trailing-edge-up positive, applied as a rotation about the normalised hinge axis.
      const lift = {
        flaps: () => -flapAngle,
        ailerons: sign => deflection.ailerons * sign,
        elevators: sign => deflection.elevators + deflection.ailerons * 0.4 * sign,
        rudder: () => deflection.rudder,
      };
      for (const [name, list] of Object.entries(surfaces)) for (const surface of list) {
        surface.angle = lift[name](surface.sign);
        surface.pivot.quaternion.copy(turn.setFromAxisAngle(surface.axis, name === 'rudder' ? surface.angle : -surface.angle));
      }

      for (const { sprite, flash } of navigation) if (flash) {
        const phase = clock % 1.4;
        sprite.material.opacity = phase < 0.07 || (phase > 0.15 && phase < 0.21) ? 1 : 0.08;
      }
    },
    get gearPosition() { return gearPosition; },
    get afterburner() { return burner; },
    get surfaces() { return Object.fromEntries(Object.entries(surfaces).map(([name, list]) => [name, list.map(s => s.angle)])); },
    setCockpit(enabled) { group.visible = !enabled; },
    dispose() {
      group.traverse(o => { if (o.isMesh || o.isSprite) { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); } });
    },
  };
}

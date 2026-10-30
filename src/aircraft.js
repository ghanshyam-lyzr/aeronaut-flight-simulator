import * as THREE from 'three';

// A composite touring twin, modelled in metres; the nose points down local -Z.
export function createAircraft() {
  const group = new THREE.Group();
  group.name = 'Astra 62 — A-N062';
  const palette = {
    shell: '#eeece4', coral: '#e75a36', ink: '#152932', glass: '#1b3542',
    metal: '#9cabb2', rubber: '#12181c', seam: '#7b888b', light: '#fbf2dd',
  };
  const paint = new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: 0.27, metalness: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.2 });
  const coral = new THREE.MeshPhysicalMaterial({ color: palette.coral, roughness: 0.29, metalness: 0.15, clearcoat: 1 });
  const graphite = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: 0.28, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: palette.glass, roughness: 0.09, metalness: 0.57, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.5 });
  const metal = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.22, metalness: 0.88 });
  const seam = new THREE.MeshStandardMaterial({ color: palette.seam, roughness: 0.55, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: palette.rubber, roughness: 0.85 });
  const materials = { paint, coral, graphite, glass, metal, seam, rubber };
  const propellers = [];
  const navigation = [];
  const gear = new THREE.Group();
  group.add(gear);

  function mesh(geometry, material, parent = group) {
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = group) {
    const object = mesh(new THREE.SphereGeometry(1, 40, 24), material, parent);
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
    const t = THREE.MathUtils.clamp((z - b[0]) / (c[0] - b[0]), 0, 1);
    return [1, 2, 3].map(k => {
      const v0 = (c[k] - a[k]) * 0.5, v1 = (d[k] - b[k]) * 0.5;
      return (2 * b[k] - 2 * c[k] + v0 + v1) * t ** 3 + (-3 * b[k] + 3 * c[k] - 2 * v0 - v1) * t ** 2 + v0 * t + b[k];
    });
  }
  // Elliptical station loft: smooth longitudinal curvature, no faceted primitives.
  function loft(stations, material, xOffset = 0, yOffset = 0) {
    const vertices = [], indices = [];
    const rings = 88, sides = 72;
    const z0 = stations[0][0], z1 = stations[stations.length - 1][0];
    for (let i = 0; i <= rings; i++) {
      const z = THREE.MathUtils.lerp(z0, z1, i / rings);
      const [rx, ry, cy] = interpolate(stations, z);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        vertices.push(xOffset + Math.max(0.002, rx) * Math.cos(angle), yOffset + cy + Math.max(0.002, ry) * Math.sin(angle), z);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(geometry, material);
  }
  loft([
    [-5.8, 0.014, 0.03, 0.08], [-5.45, 0.28, 0.30, 0.08],
    [-4.6, 0.67, 0.54, 0.12], [-3.2, 0.92, 0.76, 0.15],
    [-1.6, 1.0, 0.86, 0.17], [0.0, 0.93, 0.79, 0.15],
    [1.6, 0.72, 0.62, 0.12], [3.1, 0.45, 0.43, 0.22],
    [4.7, 0.21, 0.26, 0.42], [5.7, 0.025, 0.07, 0.57],
  ], paint);

  // The single dark canopy is raised above the fuselage, with thin structural frames.
  const canopyStations = [
    [-3.65, 0.015, 0.03, 0.71], [-3.10, 0.68, 0.67, 0.68],
    [-2.2, 0.88, 0.91, 0.62], [-0.7, 0.91, 0.96, 0.58],
    [0.6, 0.77, 0.78, 0.56], [1.45, 0.39, 0.39, 0.62], [1.85, 0.012, 0.02, 0.69],
  ];
  const canopyVertices = [], canopyIndices = [];
  const canopyRings = 68, canopySides = 40;
  for (let i = 0; i <= canopyRings; i++) {
    const z = THREE.MathUtils.lerp(-3.65, 1.85, i / canopyRings);
    const [rx, ry, cy] = interpolate(canopyStations, z);
    for (let j = 0; j <= canopySides; j++) {
      const a = j / canopySides * Math.PI;
      canopyVertices.push(Math.cos(a) * Math.max(0.003, rx), cy + Math.sin(a) * Math.max(0.003, ry), z);
    }
  }
  for (let i = 0; i < canopyRings; i++) for (let j = 0; j < canopySides; j++) {
    const a = i * (canopySides + 1) + j, b = a + canopySides + 1;
    canopyIndices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const canopyGeometry = new THREE.BufferGeometry();
  canopyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(canopyVertices, 3));
  canopyGeometry.setIndex(canopyIndices);
  canopyGeometry.computeVertexNormals();
  mesh(canopyGeometry, glass);
  for (const z of [-2.75, -0.35, 1.15]) {
    const [rx, ry, cy] = interpolate(canopyStations, z);
    const points = [];
    for (let j = 0; j <= 16; j++) {
      const a = j / 16 * Math.PI;
      points.push([Math.cos(a) * (rx + 0.012), cy + Math.sin(a) * (ry + 0.014), z]);
    }
    line(points, z === -0.35 ? 0.037 : 0.022, paint);
  }
  for (const side of [-1, 1]) {
    const sill = canopyStations.map(([z, rx, , cy]) => [side * (rx + 0.006), cy + 0.014, z]);
    line(sill, 0.032, paint);
    line([[side * 0.68, 0.78, -3.04], [side * 0.77, 1.15, -2.52], [side * 0.51, 1.50, -2.05], [side * 0.1, 1.57, -1.72]], 0.012, metal);
    // The fuselage cheat line rises slightly as it runs toward the tail.
    line([[side * 0.41, 0.11, -5.13], [side * 0.82, 0.08, -3.8], [side * 1.005, 0.06, -1.65], [side * 0.91, 0.04, 0.4], [side * 0.64, 0.17, 2.1], [side * 0.27, 0.42, 4.5]], 0.045, graphite);
    line([[side * 0.73, 0.17, -4.2], [side * 1.003, 0.18, -1.65], [side * 0.86, 0.15, 0.8], [side * 0.55, 0.28, 2.7], [side * 0.28, 0.48, 4.5]], 0.014, coral);
    // Door handle and a fine canopy door cut.
    rod([side * 0.926, 0.68, -0.98], [side * 0.937, 0.68, -0.61], 0.025, metal);
  }
  line([[0, 1.595, -1.92], [0, 1.59, -0.8], [0, 1.5, 0.1], [0, 1.24, 0.9], [0, 0.76, 1.7]], 0.027, paint);

  function wingSection(t, tail = false) {
    const span = tail ? 2.72 : 8.02;
    const x = THREE.MathUtils.lerp(tail ? 0.10 : 0.64, span, t);
    const chord = tail ? THREE.MathUtils.lerp(1.5, 0.83, t) : THREE.MathUtils.lerp(3.12, 1.10, t);
    const leading = tail ? THREE.MathUtils.lerp(3.83, 4.43, t) : THREE.MathUtils.lerp(-1.25, 0.02, t);
    const y = tail ? 2.76 + t * 0.035 : -0.19 + t * 0.35 + Math.pow(t, 6) * 0.18;
    return { x, chord, leading, y };
  }
  function airfoil(u, chord, top, tail = false) {
    const thickness = 5 * (tail ? 0.09 : 0.115) * chord * (0.2969 * Math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4);
    return Math.sin(Math.PI * u) * chord * (tail ? 0.008 : 0.022) + (top ? thickness : -thickness);
  }
  function makeWing(side, tail = false) {
    const vertices = [], indices = [], colors = [];
    const segments = 40, ring = 80;
    const white = new THREE.Color(palette.shell), orange = new THREE.Color(palette.coral);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, section = wingSection(t, tail);
      for (let j = 0; j <= ring; j++) {
        const a = j / ring * Math.PI * 2, u = (1 - Math.cos(a)) * 0.5;
        vertices.push(side * section.x, section.y + airfoil(u, section.chord, j <= ring / 2, tail), section.leading + section.chord * u);
        const c = !tail && t > 0.922 ? orange : white;
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segments; i++) for (let j = 0; j < ring; j++) {
      const a = i * (ring + 1) + j, b = a + ring + 1;
      if (side === 1) indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const wingMaterial = paint.clone();
    wingMaterial.vertexColors = true;
    mesh(geometry, wingMaterial);
    // Control surfaces are legible in the chase view, with small restrained panel gaps.
    const start = tail ? 0.1 : 0.52, end = tail ? 0.97 : 0.91;
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const s = wingSection(THREE.MathUtils.lerp(start, end, i / 20), tail);
      const u = tail ? 0.70 : 0.76;
      points.push([side * s.x, s.y + airfoil(u, s.chord, true, tail) + 0.004, s.leading + s.chord * u]);
    }
    line(points, tail ? 0.007 : 0.009, seam);
    for (const t of tail ? [0.11, 0.96] : [0.21, 0.51, 0.91]) {
      const s = wingSection(t, tail), pts = [];
      for (let j = 0; j <= 8; j++) {
        const u = THREE.MathUtils.lerp(tail ? 0.70 : 0.76, 0.985, j / 8);
        pts.push([side * s.x, s.y + airfoil(u, s.chord, true, tail) + 0.005, s.leading + s.chord * u]);
      }
      line(pts, 0.007, seam);
    }
    if (!tail) {
      // A dark walkway prevents the root from reading as an unbroken toy surface.
      const s = wingSection(0.08);
      const walk = mesh(new THREE.PlaneGeometry(0.32, 1.6), graphite);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(side * 1.4, s.y + 0.17, s.leading + 1.3);
    }
  }
  for (const side of [-1, 1]) { makeWing(side); makeWing(side, true); }

  // Bevelled airfoil fins, assembled in the YZ plane.
  function fin(points, depth, material, x = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const p of points.slice(1)) shape.lineTo(p[0], p[1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 3, steps: 1, curveSegments: 12 });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(x + depth / 2, 0, 0);
    return mesh(geometry, material);
  }
  fin([[3.26, 0.42], [3.94, 1.31], [4.56, 2.96], [4.86, 3.13], [5.41, 3.09], [5.53, 0.64]], 0.15, coral);
  fin([[4.96, 0.67], [5.21, 2.70], [5.43, 2.72], [5.54, 0.67]], 0.157, paint);
  line([[0.105, 0.84, 5.17], [0.105, 1.62, 5.24], [0.105, 2.67, 5.29]], 0.012, graphite);
  for (const side of [-1, 1]) {
    const tip = fin([[0.11, 0.32], [0.30, 0.99], [0.56, 1.27], [0.90, 1.25], [1.05, 0.38]], 0.04, coral, side * 8.0);
    // The tip's span offset is baked into its vertices, so keep its world pivot unrotated.
    // The extruded tip local z points along the aircraft. A small white tip cap.
    ellipsoid(side * 8.1, 1.05, 0.60, 0.045, 0.10, 0.15, paint);
  }

  // Sculpted engine nacelles with metal spinners and three swept carbon blades.
  for (const side of [-1, 1]) {
    const x = side * 3.06;
    loft([[-3.50, 0.31, 0.34, 0], [-3.23, 0.50, 0.48, 0], [-2.5, 0.55, 0.54, 0], [-1.55, 0.48, 0.48, 0], [-0.45, 0.32, 0.34, 0], [0.6, 0.06, 0.10, 0]], paint, x, 0.03);
    loft([[-3.51, 0.32, 0.35, 0], [-3.38, 0.44, 0.44, 0], [-3.15, 0.505, 0.49, 0]], graphite, x, 0.03);
    for (const offset of [-1, 1]) {
      ellipsoid(x + offset * 0.275, -0.18, -3.285, 0.145, 0.115, 0.035, rubber);
      const exhaust = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 14), metal);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x + offset * 0.45, -0.25, -1.73);
    }
    line([[x - 0.46, 0.23, -2.92], [x - 0.28, 0.47, -2.92], [x, 0.55, -2.92], [x + 0.28, 0.47, -2.92], [x + 0.46, 0.23, -2.92]], 0.01, seam);
    const prop = new THREE.Group();
    prop.position.set(x, 0.03, -3.59);
    group.add(prop);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.085, 0.17);
    bladeShape.bezierCurveTo(-0.16, 0.49, -0.12, 0.98, 0.03, 1.52);
    bladeShape.bezierCurveTo(0.1, 1.65, 0.24, 1.59, 0.26, 1.48);
    bladeShape.bezierCurveTo(0.24, 0.96, 0.15, 0.44, 0.085, 0.17);
    bladeShape.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.027, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
    for (let i = 0; i < 3; i++) {
      const blade = mesh(bladeGeometry, graphite, prop);
      blade.rotation.z = i * Math.PI * 2 / 3;
      const cap = mesh(new THREE.BoxGeometry(0.145, 0.10, 0.035), paint, prop);
      const angle = i * Math.PI * 2 / 3;
      cap.position.set(-Math.sin(angle) * 1.48 + Math.cos(angle) * 0.13, Math.cos(angle) * 1.48 + Math.sin(angle) * 0.13, 0.025);
      cap.rotation.z = angle - 0.1;
    }
    const blurMat = new THREE.MeshBasicMaterial({ color: '#ccd4cf', transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false });
    const disc = mesh(new THREE.RingGeometry(0.26, 1.59, 72), blurMat);
    disc.position.set(x, 0.03, -3.62);
    disc.castShadow = false;
    propellers.push({ prop, blurMat, side });
    loft([[-4.15, 0.005, 0.005, 0], [-4.04, 0.15, 0.15, 0], [-3.82, 0.29, 0.29, 0], [-3.59, 0.32, 0.32, 0]], metal, x, 0.03);
  }

  // Retractable tricycle undercarriage (visible only when requested by flight state).
  for (const spec of [{x: -2.72, z: 0.36, main: true}, {x: 2.72, z: 0.36, main: true}, {x: 0, z: -3.60, main: false}]) {
    const { x, z, main } = spec;
    rod([x, -0.33, z], [x, -1.32, z + 0.09], 0.055, metal, gear);
    rod([x, -0.35, z - 0.45], [x, -1.04, z + 0.08], 0.031, metal, gear);
    rod([x, -0.77, z - 0.02], [x, -1.31, z + 0.09], 0.074, paint, gear);
    const wheel = mesh(new THREE.TorusGeometry(main ? 0.27 : 0.20, main ? 0.115 : 0.09, 14, 32), rubber, gear);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(x, main ? -1.48 : -1.39, z + 0.09);
    const hub = mesh(new THREE.CylinderGeometry(main ? 0.18 : 0.13, main ? 0.18 : 0.13, 0.16, 24), metal, gear);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    const door = mesh(new THREE.BoxGeometry(main ? 0.34 : 0.22, 0.72, 0.045), paint, gear);
    door.position.set(x + (x === 0 ? 0.15 : Math.sign(x) * 0.14), -0.67, z);
    door.rotation.z = x === 0 ? 0.1 : Math.sign(x) * -0.15;
  }
  gear.visible = false;

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
    ctx.fillText('A-N062', w / 2, h / 2 + 5);
  });
  if (registration) {
    const decalMaterial = new THREE.MeshBasicMaterial({ map: registration, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const wingReg = mesh(new THREE.PlaneGeometry(2.13, 0.53), decalMaterial);
    wingReg.rotation.x = -Math.PI / 2;
    wingReg.position.set(5.54, 0.29, 0.67);
    wingReg.castShadow = false;
    for (const side of [-1, 1]) {
      const reg = mesh(new THREE.PlaneGeometry(1.28, 0.32), decalMaterial);
      reg.position.set(side * 0.57, 0.29, 2.53);
      reg.rotation.y = side * Math.PI / 2;
      reg.rotation.z = side * -0.09;
      reg.castShadow = false;
    }
  }
  // Subtle black anti-glare panel and aerials complete the silhouette.
  const antiGlare = ellipsoid(0, 0.65, -4.11, 0.47, 0.035, 0.72, graphite);
  antiGlare.rotation.x = -0.19;
  rod([0, 0.95, 2.15], [0, 1.50, 2.35], 0.023, graphite);
  rod([0, -0.60, 1.0], [0, -1.08, 1.25], 0.018, paint);
  ellipsoid(0, 1.02, 1.28, 0.12, 0.065, 0.18, paint);

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
    const bulb = ellipsoid(x, y, z, 0.075, 0.06, 0.09, material);
    bulb.castShadow = false;
    if (haloTexture) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
      sprite.position.set(x, y, z); sprite.scale.setScalar(flash ? 0.55 : 0.37);
      group.add(sprite); navigation.push({ sprite, flash });
    }
  }
  nav(-8.05, 0.51, 0.17, '#ff4534');
  nav(8.05, 0.51, 0.17, '#56ffbb');
  nav(0, 0.62, 5.68, '#fff6df');
  nav(0, 1.04, 1.32, '#ff583d', true);

  let clock = 0;
  return {
    group,
    materials,
    update(dt, throttle = 0.7, state = {}) {
      clock = state.time ?? clock + dt;
      const power = THREE.MathUtils.clamp(throttle, 0, 1);
      for (const { prop, blurMat, side } of propellers) {
        prop.rotation.z += dt * (35 + power * 150) * side;
        blurMat.opacity = 0.035 + power * 0.065;
      }
      gear.visible = !!state.gearDown;
      for (const { sprite, flash } of navigation) if (flash) {
        const phase = clock % 1.7;
        sprite.material.opacity = phase < 0.08 || (phase > 0.17 && phase < 0.23) ? 1 : 0.08;
      }
    },
    setCockpit(enabled) { group.visible = !enabled; },
  };
}

// Camera-local cockpit. Attach directly to the active camera; no animation loop is needed.
export function createCockpit() {
  const cockpit = new THREE.Group();
  cockpit.name = 'Astra 62 — cockpit';
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
  for (const side of [-1, 1]) {
    tube([[side * 1.56, -1.15, -1.18], [side * 1.34, -0.36, -1.55], [side * 1.12, 0.58, -1.94], [side * 0.91, 1.28, -2.06]], 0.048, charcoal);
    tube([[side * 1.53, -1.12, -1.18], [side * 1.31, -0.34, -1.55], [side * 1.09, 0.59, -1.94], [side * 0.88, 1.28, -2.06]], 0.008, trim);
    tube([[side * 1.55, -0.83, -1.21], [side * 1.51, -0.71, -1.85], [side * 1.45, -0.67, -2.48]], 0.047, charcoal);
  }
  tube([[-0.94, 1.27, -2.06], [-0.5, 1.38, -2.02], [0, 1.40, -2.01], [0.5, 1.38, -2.02], [0.94, 1.27, -2.06]], 0.055, charcoal);

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
    dial(177, 226, 139, 'AIRSPEED', 124, 200, 'KNOTS');
    dial(482, 226, 139, 'ALTIMETER', 4200, 10000, 'FEET');
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
    text('124', 716, 224, 24, '#d3f9d2', 'center', 'monospace');
    text('4,200', 994, 224, 22, '#d3f9d2', 'center', 'monospace');
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
    dial(1834, 226, 139, 'VERTICAL SPEED', 520, 2000, 'FT / MIN');
    roundRect(1525, 92, 137, 278, 6, '#091717', '#4a5b5c');
    text('ENG', 1594, 111, 14, '#87a89a');
    text('L      R', 1594, 146, 12, '#a9d7b8', 'center', 'monospace');
    for (let i = 0; i < 2; i++) {
      const x = 1564 + i * 59;
      roundRect(x - 13, 174, 26, 114, 2, '#1d3931');
      roundRect(x - 10, 203 + i * 2, 20, 82 - i * 2, 1, '#7cb99a');
      text('78', x, 315, 19, '#b5e0bb', 'center', 'monospace');
    }
    text('% LOAD', 1594, 346, 11, '#6c9182', 'center', 'monospace');
    text('ASTRA', 45, 27, 17, '#b7c6c5', 'left');
    text('62  /  COMPOSITE TWIN', 170, 27, 12, '#788f90', 'left');
    text('A-N062', 2004, 27, 15, '#b6c8c6', 'right', 'monospace');
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
  for (const x of [-0.58, 0.58]) {
    const knob = part(new THREE.CylinderGeometry(0.033, 0.033, 0.065, 20), rubber, dashboard);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, -0.25, 0.21);
    const cap = part(new THREE.CylinderGeometry(0.024, 0.024, 0.068, 20), trim, dashboard);
    cap.rotation.x = Math.PI / 2; cap.position.copy(knob.position);
  }
  return cockpit;
}

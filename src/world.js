import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function hash(x, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz); return mix(mix(hash(ix, iz), hash(ix + 1, iz), sx), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz); }
function fbm(x, z) { return noise(x, z) * .55 + noise(x * 2.03 + 17, z * 2.03 + 31) * .27 + noise(x * 4.13 + 51, z * 4.13 + 11) * .12 + noise(x * 8.17, z * 8.17) * .06; }
function ridge(x, z) { return 1 - Math.abs(noise(x, z) * 2 - 1); }
let randomSeed = 784391;
function random() { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) | 0; return (randomSeed >>> 0) / 4294967296; }
const airportX = 900, airportZ = -1800, airportY = 78;
function groundHeight(x, z) {
  const curve = Math.sin(z * .00028) * 480 + Math.sin(z * .00074) * 170;
  const dist = Math.abs(x - curve + (noise(x * .00055, z * .00055) - .5) * 230);
  const foot = smooth(1000, 4900, dist);
  const ridges = ridge(x * .00049 + 14, z * .00049 + 8) * .58 + ridge(x * .00118 + 4, z * .00118 + 11) * .28 + ridge(x * .0027, z * .0027) * .14;
  let h = -48 + Math.pow(dist * .008, 2) * .13 + foot * (720 + ridges * 1850);
  h += foot * (noise(x * .0073, z * .0073) - .5) * 165;
  h += foot * (noise(x * .017, z * .017) - .5) * 43;
  h += smooth(-6500, -14500, z) * (700 + ridges * 1800) * (1 - foot * .45);
  h += (fbm(x * .0015, z * .0015) - .45) * (28 + foot * 90);
  // A lake-side apron, wide enough to make an actual flyable runway.
  const airportDistance = Math.sqrt(((x - airportX) / 410) ** 2 + ((z - airportZ) / 840) ** 2);
  h = mix(h, airportY, 1 - smooth(.79, 1.65, airportDistance));
  return h;
}

const terrainShader = /* glsl */`
varying vec3 vAlpinePosition;
varying vec3 vAlpineNormal;
float alpineHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float alpineNoise(vec2 p) { vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(alpineHash(i),alpineHash(i+vec2(1,0)),f.x),mix(alpineHash(i+vec2(0,1)),alpineHash(i+1.),f.x),f.y); }
`;

function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, metalness: 0, dithering: true });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vAlpinePosition; varying vec3 vAlpineNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpinePosition=(modelMatrix*vec4(position,1.)).xyz; vAlpineNormal=normal;');
    shader.fragmentShader = terrainShader + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      vec3 p=vAlpinePosition;
      float grain=alpineNoise(p.xz*.032);
      float detail=alpineNoise(p.xz*.18);
      float strata=sin(p.y*.095+alpineNoise(p.xz*.006)*8.)*.5+.5;
      float broad=alpineNoise(p.xz*.0015);
      float slope=1.-max(vAlpineNormal.y,0.);
      vec3 meadow=mix(vec3(.115,.205,.073),vec3(.26,.345,.13),broad);
      meadow*=.86+grain*.25+detail*.055;
      vec3 rock=mix(vec3(.255,.275,.27),vec3(.43,.445,.41),grain*.63+strata*.2);
      rock*=.85+detail*.28;
      float cliff=smoothstep(.15,.52,slope);
      cliff=max(cliff,smoothstep(1050.,1750.,p.y)*.65);
      vec3 ground=mix(meadow,rock,cliff);
      float scree=smoothstep(1120.,1620.,p.y)*(.36+broad*.35);
      ground=mix(ground,rock,scree);
      float snow=smoothstep(1580.,1870.,p.y+(broad-.5)*330.+grain*38.);
      snow*=1.-smoothstep(.40,.77,slope);
      vec3 snowColor=mix(vec3(.69,.79,.84),vec3(.97,.98,.98),grain*.3+max(vAlpineNormal.y,0.)*.7);
      ground=mix(ground,snowColor,snow);
      float beach=1.-smoothstep(12.,38.,p.y);
      ground=mix(ground,vec3(.40,.44,.30)*( .9+grain*.17),beach*.72);
      diffuseColor.rgb*=ground;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */`
      #include <normal_fragment_maps>
      float alpineBump = grain * 1.4 + detail * .19 + strata * cliff * .45;
      vec3 alpineDx = dFdx(-vViewPosition), alpineDy = dFdy(-vViewPosition);
      vec3 alpineR1 = cross(alpineDy,normal), alpineR2 = cross(normal,alpineDx);
      float alpineDet = dot(alpineDx,alpineR1);
      vec3 alpineGradient = sign(alpineDet) * (dFdx(alpineBump)*alpineR1 + dFdy(alpineBump)*alpineR2);
      normal = normalize(abs(alpineDet)*normal - alpineGradient);
    `);
  };
  return mat;
}

function terrain(scene) {
  const material = makeTerrainMaterial();
  const tiles = 5, size = 8800, segments = 104, meshes = [];
  const lodIndices = {};
  for (const step of [1, 2, 4]) {
    const indices = [];
    for (let z = 0; z < segments; z += step) for (let x = 0; x < segments; x += step) {
      const a = z * (segments + 1) + x, b = a + step, c = a + step * (segments + 1), d = c + step;
      indices.push(a, c, b, b, c, d);
    }
    lodIndices[step] = new THREE.Uint16BufferAttribute(indices, 1);
  }
  for (let tz = 0; tz < tiles; tz++) for (let tx = 0; tx < tiles; tx++) {
    const ox = (tx - 2) * size, oz = (tz - 2) * size;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + ox, z = pos.getZ(i) + oz; pos.setXYZ(i, x, groundHeight(x, z), z); }
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, material);
    mesh.receiveShadow = true;
    mesh.userData.center = new THREE.Vector2(ox, oz);
    mesh.userData.lodIndices = lodIndices;
    meshes.push(mesh);
    scene.add(mesh);
  }
  return meshes;
}

function makeLake(sunDirection) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { time: { value: 0 }, sunDirection: { value: sunDirection.clone() }, sunColor: { value: new THREE.Color(0xfff4dc) }, waterColor: { value: new THREE.Color(0x127d89) }, skyColor: { value: new THREE.Color(0xa8cddd) } },
    ]),
    vertexShader: /* glsl */`
      varying vec3 vLakePosition;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vLakePosition = (modelMatrix * vec4(position,1.)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position,1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float time;
      uniform vec3 waterColor;
      uniform vec3 skyColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vLakePosition;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vLakePosition.xz;
        vec3 eye = normalize(cameraPosition-vLakePosition);
        // Broad, low-amplitude swells stay smooth at flight altitude.
        float w1 = p.x*.017+p.y*.011+time*.65;
        float w2 = p.x*-.009+p.y*.023-time*.43;
        float w3 = p.x*.005+p.y*.007+time*.29;
        vec3 n = normalize(vec3(cos(w1)*.023+cos(w2)*.014,1.,sin(w1)*.017+sin(w3)*.025));
        float fresnel = .035 + pow(1.-max(dot(eye,n),0.),3.)*.64;
        float valleyCenter=sin(p.y*.00028)*480.+sin(p.y*.00074)*170.;
        float shallows=smoothstep(800.,1650.,abs(p.x-valleyCenter));
        vec3 deep = waterColor*(.88+sin(w3)*.025);
        vec3 turquoise = mix(deep,waterColor*vec3(1.15,1.24,1.12),shallows*.52);
        vec3 reflectedSky = skyColor*(.72+.18*max(n.y,0.));
        vec3 color = mix(turquoise,reflectedSky,fresnel);
        float sunGloss=pow(max(dot(n,normalize(eye+sunDirection)),0.),110.);
        color+=sunColor*sunGloss*.24;
        color += waterColor*(sin(w1)*.013+sin(w2)*.009);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(52000,52000),material);
  lake.rotation.x = -Math.PI/2; lake.position.y = 10;
  return lake;
}

function buildForest(scene) {
  const parts = [];
  for (const [radius, height, y] of [[5.4, 14, 10], [4.2, 12, 17], [2.8, 10, 23]]) {
    const g = new THREE.ConeGeometry(radius, height, 5, 1, true); g.translate(0, y, 0); parts.push(g);
  }
  const geometry = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .98 });
  const buckets = Array.from({ length: 36 }, () => []);
  let count = 0;
  for (let attempts = 0; attempts < 195000 && count < 28200; attempts++) {
    const x = (random() - .5) * 19600, z = (random() - .5) * 26200;
    const h = groundHeight(x, z);
    if (h < 30 || h > 1480 || (h > 1180 && random() < smooth(1180, 1500, h))) continue;
    const ap = ((x - airportX) / 430) ** 2 + ((z - airportZ) / 890) ** 2;
    if (ap < 1.5) continue;
    if (fbm(x * .001, z * .001) < .29 || random() > .81) continue;
    const slope = Math.abs(groundHeight(x + 16, z) - h) / 16 + Math.abs(groundHeight(x, z + 16) - h) / 16;
    if (slope > 1.32) continue;
    const ix = Math.min(5, Math.max(0, Math.floor((x + 9800) / 3267))), iz = Math.min(5, Math.max(0, Math.floor((z + 13100) / 4367)));
    buckets[iz * 6 + ix].push([x, h - 2, z, .6 + random() * 1.0, random()]); count++;
  }
  const dummy = new THREE.Object3D(), color = new THREE.Color(), forestMeshes = [];
  for (const trees of buckets) {
    if (!trees.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, mat, trees.length);
    trees.forEach(([x, y, z, size, tone], i) => {
      dummy.position.set(x, y, z); dummy.scale.set(size, size * (1.0 + tone * .3), size); dummy.rotation.y = tone * 8; dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(.265 + tone * .047, .27 + tone * .16, .13 + tone * .075); mesh.setColorAt(i, color);
    });
    mesh.computeBoundingSphere();
    mesh.userData.fullCount = trees.length;
    forestMeshes.push(mesh);
    scene.add(mesh);
  }
  return forestMeshes;
}

function cloudTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const c = canvas.getContext('2d');
  for (let i = 0; i < 58; i++) {
    const x = 180 + random() * 660, y = 200 + (random() - .5) * 135, r = 65 + random() * 96;
    const gradient = c.createRadialGradient(x - r * .20, y - r * .35, r * .04, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,.38)'); gradient.addColorStop(.40, 'rgba(248,251,255,.25)'); gradient.addColorStop(.75, 'rgba(225,237,247,.09)'); gradient.addColorStop(1, 'rgba(221,232,245,0)');
    c.fillStyle = gradient; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function buildClouds(scene) {
  const texture = cloudTexture(), clouds = [];
  for (let i = 0; i < 46; i++) {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: .86, depthWrite: false, fog: true, color: 0xffffff });
    const sprite = new THREE.Sprite(mat);
    const x = (random() - .5) * 37000, z = (random() - .5) * 43000;
    sprite.position.set(x, 2850 + random() * 950, z);
    const size = 3000 + random() * 2700; sprite.scale.set(size, size * .40, 1);
    sprite.userData.baseX = x;
    scene.add(sprite); clouds.push(sprite);
  }
  return clouds;
}

function airport(scene) {
  const group = new THREE.Group(); group.position.set(airportX, airportY + .7, airportZ); scene.add(group);
  const materials = {
    runway: new THREE.MeshStandardMaterial({ color: 0x343b3d, roughness: .94 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8b938d, roughness: .96 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xe3e4d9, roughness: .9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xd5c9af, roughness: .85 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x45545a, roughness: .75 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x41626d, roughness: .2, metalness: .3 })
  };
  function box(w, h, d, x, y, z, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); group.add(m); return m; }
  box(53, .45, 1100, 0, 0, 0, materials.runway);
  box(125, .30, 275, 110, 0, -220, materials.concrete);
  box(90, .30, 15, 65, 0, -115, materials.runway);
  box(90, .30, 15, 65, 0, -330, materials.runway);
  for (let z = -475; z <= 475; z += 65) box(1.25, .1, 31, 0, .36, z, materials.stripe);
  for (const x of [-23, 23]) box(.8, .1, 1075, x, .36, 0, materials.stripe);
  for (const end of [-1, 1]) for (const x of [-18, -12, -6, 6, 12, 18]) box(3.1, .1, 42, x, .37, end * 502, materials.stripe);
  const runwayLightMaterial = new THREE.MeshBasicMaterial({ color: 0xffe1a7 });
  for (let z = -525; z < 550; z += 55) for (const x of [-28, 28]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.7, 5, 4), runwayLightMaterial); light.position.set(x, .9, z); group.add(light);
  }
  for (let i = 0; i < 3; i++) {
    box(48, 16, 43, 142, 8, -310 + i * 58, materials.wall);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 45, 16, 1, false, 0, Math.PI), materials.roof); roof.rotation.x = Math.PI / 2; roof.rotation.z = Math.PI / 2; roof.scale.set(1, .30, 1); roof.position.set(142, 16, -310 + i * 58); group.add(roof);
    box(34, 12, .4, 142, 6.5, -288 + i * 58, materials.roof);
  }
  box(30, 13, 54, 110, 6.5, -65, materials.wall);
  box(32, 1.3, 56, 110, 13.5, -65, materials.roof);
  box(9, 24, 9, 145, 12, -65, materials.wall);
  box(14, 6, 14, 145, 25, -65, materials.glass);
  box(16, 1.2, 16, 145, 28.6, -65, materials.roof);
  // A fully procedural windsock, readable during a low approach.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, 13, 6), materials.stripe); pole.position.set(-60, 6.5, 335); group.add(pole);
  const sock = new THREE.Group(); sock.position.set(-60, 13, 335); sock.rotation.z = -.14; group.add(sock);
  for (let i = 0; i < 5; i++) {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(.9 - i * .1, .8 - i * .1, 1.15, 10, 1, true), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf4eee3 : 0xed6d40, side: THREE.DoubleSide }));
    part.rotation.z = Math.PI / 2; part.position.x = i * 1.15; sock.add(part);
  }
  // Painted identifiers are generated locally and do not need a font asset.
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = '#f2f2df'; context.font = 'bold 90px Arial'; context.textAlign = 'center'; context.fillText('36', 64, 100);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const number = new THREE.Mesh(new THREE.PlaneGeometry(18, 22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); number.rotation.x = -Math.PI / 2; number.position.set(0, .6, 435); group.add(number);
  // Batch the static airport by material: paint marks and runway lights cost
  // one draw each instead of a draw for every small stripe and lamp.
  const batches = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(child.geometry.clone().applyMatrix4(child.matrix));
    group.remove(child); child.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    const combined = mergeGeometries(geometries);
    geometries.forEach(geometry => geometry.dispose());
    group.add(new THREE.Mesh(combined, material));
  }
  return { position: new THREE.Vector3(airportX, airportY, airportZ), runwayLength: 1100, heading: 0, name: 'Alpine Field', elevation: airportY, windsock: sock };
}

function buildVillages(scene) {
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BufferGeometry();
  const roofVertices = new Float32Array([
    -.6,0,-.6, .6,0,-.6, 0,.55,-.6,
    -.6,0,.6, 0,.55,.6, .6,0,.6,
    -.6,0,-.6, 0,.55,-.6, 0,.55,.6, -.6,0,-.6, 0,.55,.6, -.6,0,.6,
    .6,0,-.6, .6,0,.6, 0,.55,.6, .6,0,-.6, 0,.55,.6, 0,.55,-.6,
  ]);
  roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVertices, 3)); roofGeo.computeVertexNormals();
  const spots = [];
  for (const [cx, cz, spread] of [[1650, -1500, 510], [-1800, -3100, 700], [1750, 1900, 590], [-1700, 5500, 700]]) {
    for (let i = 0; i < 37; i++) {
      const x = cx + (random() - .5) * spread, z = cz + (random() - .5) * spread, y = groundHeight(x, z);
      if (y < 28 || y > 700 || Math.abs(groundHeight(x + 12, z) - y) > 10) continue;
      spots.push({ x, y, z, w: 13 + random() * 12, h: 9 + random() * 9, d: 17 + random() * 18, rot: random() * .45 });
    }
  }
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94 }), spots.length);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, side: THREE.DoubleSide }), spots.length);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  spots.forEach((s, i) => {
    dummy.position.set(s.x, s.y + s.h / 2 - 1, s.z); dummy.rotation.y = s.rot; dummy.scale.set(s.w, s.h, s.d); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix);
    color.setHSL(.10 + random() * .04, .10 + random() * .10, .53 + random() * .25); bodies.setColorAt(i, color);
    dummy.position.y = s.y + s.h - 1; dummy.scale.set(s.w, s.w * .6, s.d); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix);
    color.setHSL(.025 + random() * .035, .15 + random() * .13, .20 + random() * .12); roofs.setColorAt(i, color);
  });
  scene.add(bodies, roofs);
  // Quiet lakeside roads: ribbons follow the actual terrain rather than floating.
  for (const side of [-1, 1]) {
    const positions = [], indices = [], n = 210;
    for (let i = 0; i <= n; i++) {
      const z = -6800 + i * 70, curve = Math.sin(z * .00028) * 480 + Math.sin(z * .00074) * 170;
      const x = curve + side * (1580 + Math.sin(z * .0016) * 90);
      for (const dx of [-3.8, 3.8]) positions.push(x + dx, Math.max(groundHeight(x + dx, z) + 1.1, 14), z);
      if (i < n) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x73766b, roughness: 1, side: THREE.DoubleSide })));
  }
}

function buildBoats(scene) {
  const boats = [];
  for (const [x, z, angle] of [[-390, 50, .5], [240, -3200, -.6], [-400, 2900, 1.3], [250, 1300, -.3]]) {
    if (groundHeight(x, z) > 9) continue;
    const boat = new THREE.Group(); boat.position.set(x, 11, z); boat.rotation.y = angle;
    const hull = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 7), new THREE.MeshStandardMaterial({ color: 0xe7e5db, roughness: .55 })); hull.scale.set(.72, .35, 1.9); boat.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, 22, 5), new THREE.MeshStandardMaterial({ color: 0xa8b0ad })); mast.position.y = 11; boat.add(mast);
    const sailGeo = new THREE.BufferGeometry(); sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 21, 0, 0, 3, 0, 0, 3, 8.7], 3)); sailGeo.computeVertexNormals();
    boat.add(new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ color: 0xf6f1da, side: THREE.DoubleSide, roughness: .85 })));
    scene.add(boat); boats.push(boat);
  }
  return boats;
}

export function createWorld(scene, renderer) {
  scene.background = new THREE.Color(0xa5c5d3);
  scene.fog = new THREE.FogExp2(0xb8d3dd, .000043);
  const sky = new Sky(); sky.scale.setScalar(380000); scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 3.2; skyUniforms.rayleigh.value = 1.65; skyUniforms.mieCoefficient.value = .0035; skyUniforms.mieDirectionalG.value = .82;
  const sunDirection = new THREE.Vector3(-.55, .55, -.8).normalize(); skyUniforms.sunPosition.value.copy(sunDirection);
  const hemi = new THREE.HemisphereLight(0xc9e7ff, 0x666445, 1.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0da, 3.25); sun.position.copy(sunDirection).multiplyScalar(7000); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -900; sun.shadow.camera.right = 900; sun.shadow.camera.top = 900; sun.shadow.camera.bottom = -900; sun.shadow.camera.near = 10; sun.shadow.camera.far = 17000; sun.shadow.normalBias = 1.5; sun.shadow.bias = -.00015;
  scene.add(sun, sun.target);
  const terrainMeshes = terrain(scene);
  const lake = makeLake(sunDirection); scene.add(lake);
  const forestMeshes = buildForest(scene);
  const airfield = airport(scene);
  buildVillages(scene);
  const clouds = buildClouds(scene), boats = buildBoats(scene);
  const landmarks = [
    { name: 'Alpine Field', position: new THREE.Vector3(900, 78, -1800), type: 'airport' },
    { name: 'Lake Azure', position: new THREE.Vector3(-100, 10, -2400), type: 'lake' },
    { name: 'Mont Argent', position: new THREE.Vector3(-4500, groundHeight(-4500, -6300), -6300), type: 'peak' },
    { name: 'The Three Sisters', position: new THREE.Vector3(5200, groundHeight(5200, -4100), -4100), type: 'peak' },
    { name: 'Northern Pass', position: new THREE.Vector3(-300, 2200, -12600), type: 'pass' },
  ];
  let weather = 'clear', quality = 'high';
  let lastLodX = Infinity, lastLodZ = Infinity;
  function setWeather(preset = 'clear') {
    weather = preset;
    const golden = preset === 'golden' || preset === 'sunset', overcast = preset === 'overcast' || preset === 'cloudy';
    sunDirection.set(-.62, golden ? .19 : overcast ? .68 : .57, -.78).normalize();
    skyUniforms.sunPosition.value.copy(sunDirection);
    skyUniforms.turbidity.value = golden ? 6.3 : overcast ? 8 : 3.2;
    skyUniforms.rayleigh.value = golden ? 2.8 : overcast ? .55 : 1.65;
    sun.color.set(golden ? 0xffc583 : overcast ? 0xdce4e5 : 0xfff1d9); sun.intensity = overcast ? 1.0 : golden ? 3.0 : 3.25;
    hemi.intensity = overcast ? 1.95 : golden ? 1.25 : 1.55; hemi.color.set(golden ? 0xc4d5e8 : 0xc9e7ff);
    scene.fog.color.set(golden ? 0xd5b3a1 : overcast ? 0xb5c4c8 : 0xb8d3dd); scene.fog.density = overcast ? .000077 : golden ? .000053 : .000043;
    lake.material.uniforms.sunDirection.value.copy(sunDirection); lake.material.uniforms.sunColor.value.copy(sun.color);
    lake.material.uniforms.waterColor.value.set(golden ? 0x22737a : overcast ? 0x347881 : 0x127d89);
    lake.material.uniforms.skyColor.value.set(golden ? 0xd3bba6 : overcast ? 0xaebdc2 : 0xa8cddd);
    for (const cloud of clouds) { cloud.material.color.set(overcast ? 0xabb7bc : golden ? 0xffe1bd : 0xffffff); cloud.material.opacity = overcast ? 1 : .86; }
  }
  function setQuality(value = 'high') {
    quality = value;
    const density = value === 'low' ? .30 : value === 'medium' ? .50 : 1;
    forestMeshes.forEach(mesh => { mesh.count = Math.max(1,Math.floor(mesh.userData.fullCount * density)); });
    clouds.forEach((cloud,i) => { cloud.visible = i < (value === 'low' ? 22 : value === 'medium' ? 34 : 46); });
    sun.castShadow = value === 'high';
    for(const mesh of terrainMeshes) mesh.geometry.setIndex(mesh.userData.lodIndices[value === 'high' ? 1 : 2]);
    lastLodX = Infinity; lastLodZ = Infinity;
  }
  function update(dt, time, position) {
    lake.material.uniforms.time.value = time * .48;
    if (position) {
      sun.target.position.copy(position); sun.position.copy(position).addScaledVector(sunDirection, 7000);
      if(quality === 'low' && Math.hypot(position.x-lastLodX,position.z-lastLodZ)>1200) {
        for(const mesh of terrainMeshes) {
          const c=mesh.userData.center, distance=Math.hypot(position.x-c.x,position.z-c.y);
          mesh.geometry.setIndex(mesh.userData.lodIndices[distance<7500?2:4]);
        }
        lastLodX=position.x; lastLodZ=position.z;
      }
    }
    clouds.forEach((cloud, i) => { cloud.position.x = cloud.userData.baseX + Math.sin(time * .007 + i) * 85; });
    boats.forEach((boat, i) => { boat.rotation.z = Math.sin(time * .72 + i) * .018; boat.position.y = 11 + Math.sin(time * .9 + i) * .12; });
    airfield.windsock.rotation.z = -.15 + Math.sin(time * 2.7) * .035;
  }
  setWeather('clear');
  return { heightAt: (x, z) => Math.max(10, groundHeight(x, z)), update, setWeather, setQuality, landmarks, airport: airfield };
}

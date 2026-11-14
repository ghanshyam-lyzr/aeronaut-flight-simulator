import * as THREE from 'three';
import { AIRFIELD } from './airfield.js';
import { AIRPORTS, ALPINE_FIELD, footprint, localCoordinates, inProtectedArea } from './airports.js';
import { groundHeight, groundShader, fbm, valleyCurve, westValleyCurve, calmeCurve } from './terrain.js';
import { WORLD, CORE, SHAPES, REGIONS, ROUTES, LANDMARKS, VILLAGES, AIRPORT_SITES, WATER_LEVEL, regionAt } from './regions.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let randomSeed = 784391;
function random() { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) | 0; return (randomSeed >>> 0) / 4294967296; }
// The regions' scenery draws from its own sequence, so the original valley's
// forest, villages and clouds stay exactly where they were.
let regionSeed = 1928371;
function regionRandom() { regionSeed = (Math.imul(regionSeed, 1664525) + 1013904223) | 0; return (regionSeed >>> 0) / 4294967296; }
// And the outer regions beyond the Divide draw from a third, so neither moves.
let outerSeed = 5550113;
function outerRandom() { outerSeed = (Math.imul(outerSeed, 1664525) + 1013904223) | 0; return (outerSeed >>> 0) / 4294967296; }
const { x: airportX, z: airportZ, elevation: airportY } = AIRFIELD;
export { groundHeight };

// Alpine air: the haze pools in the valley and thins with height, so peaks stand
// clear above a hazy lake, and it warms slightly on the side the sun is on.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying vec3 vFogView;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\nvFogView = mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
uniform vec3 fogColor;
varying vec3 vFogView;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  float fogDistance = length(vFogView);
  vec3 fogTint = fogColor;
  #ifdef FOG_EXP2
    vec3 fogRay = (vec4(vFogView, 0.) * viewMatrix).xyz;
    float fogRise = .00062 * fogRay.y;
    float fogLayer = exp(-.00062 * (cameraPosition.y - 520.)) * (abs(fogRise) < .001 ? 1. : (1. - exp(-fogRise)) / fogRise);
    float fogFactor = 1. - exp(-fogDensity * fogDensity * fogDistance * fogDistance * clamp(fogLayer, .3, 2.2));
    float fogSun = pow(max(dot(normalize(vec3(fogRay.x, 0., fogRay.z) + 1e-4), vec3(-.622, 0., -.783)), 0.), 6.);
    fogTint *= mix(vec3(1.), vec3(1.09, 1.03, .9), fogSun * .8);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogDistance);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, fogFactor);
#endif
`;

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
      // Olive alpine pasture with drier, sun-cured patches, not lawn green.
      float pasture=alpineNoise(p.xz*.0042+19.);
      vec3 meadow=mix(vec3(.112,.19,.074),vec3(.25,.31,.125),broad);
      meadow=mix(meadow,vec3(.33,.33,.16),smoothstep(.55,.9,pasture)*.45);
      meadow*=.86+grain*.25+detail*.055;
      vec3 rock=mix(vec3(.25,.262,.262),vec3(.45,.44,.405),grain*.63+strata*.2);
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

// Detail by distance from the camera to a tile's nearest edge: [distance, index step].
const FOREST_RANGE = { high: 16000, medium: 12500, low: 8500 };
// The network's fields are drawn within this distance of the camera (from the
// field's centre, so a long runway still shows on a long final); past it the haze
// has hidden them and they cost nothing. Alpine Field is always drawn.
export const AIRPORT_RANGE = { high: 40000, medium: 30000, low: 22000 };
const TERRAIN_LOD = { high: [[9000, 1], [22000, 2], [Infinity, 4]], medium: [[16000, 2], [Infinity, 4]], low: [[7500, 2], [Infinity, 4]] };

// Tiles keep full detail (104 segments, 84.6 m) only within reach of the step-1
// and step-2 meshes; everywhere else a tile is its 26-segment mesh, the very
// vertices of its step-4 mesh. So the resident terrain stays bounded however
// large the world grows: full tiles are built as the camera comes within
// FULL_RANGE (plus a lead) and dropped again past it (plus a lag).
export const SEGMENTS = 104, COARSE_STEP = 4;
const SKIRT_DEPTH = 160;
export const FULL_RANGE = Object.fromEntries(Object.entries(TERRAIN_LOD).map(([quality, lod]) => [quality, lod.filter(([, step]) => step < COARSE_STEP).at(-1)[0]]));
export const FULL_LEAD = 2500, FULL_LAG = 8000;
const URGENT = 4000;

function tileIndices(segments, step) {
  const row = segments + 1, indices = [];
  for (let z = 0; z < segments; z += step) for (let x = 0; x < segments; x += step) {
    const a = z * row + x, b = a + step, c = a + step * row, d = c + step;
    indices.push(a, c, b, b, c, d);
  }
  // A curtain hangs from just under every tile edge (a metre down, so it never
  // fights the surface for the same pixels), and a coarser neighbour never opens
  // a crack to the sky. Both windings: it is seen from either side.
  for (let k = 0; k < 4; k++) for (let i = 0; i < segments; i += step) {
    const a = row * row + k * row + i, b = a + step, sa = a + 4 * row, sb = sa + step;
    indices.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  return new THREE.Uint16BufferAttribute(indices, 1);
}
const FULL_INDICES = { 1: tileIndices(SEGMENTS, 1), 2: tileIndices(SEGMENTS, 2), 4: tileIndices(SEGMENTS, 4) };
const COARSE_INDICES = tileIndices(SEGMENTS / COARSE_STEP, 1);

/** Tile (tx, tz) sampled every `step` vertices of the one world grid. */
export function tileGeometry(tx, tz, step) {
  const building = buildTile(tx, tz, step);
  let next;
  while (!(next = building.next()).done);
  return next.value;
}
// Sampling yields every few rows, so a frame can stop part way through a tile.
function* buildTile(tx, tz, step) {
  const spacing = WORLD.tileSize / SEGMENTS, segments = SEGMENTS / step, row = segments + 1, heights = new Float32Array((row + 2) * (row + 2));
  const edge = [i => i, i => segments * row + i, i => i * row, i => i * row + segments];
  // One extra ring of heights gives every edge vertex the same normal as its
  // neighbour tile's, so light is continuous across the seams.
  // Vertices sit on one world grid, so tiles compute their shared edges bit for bit alike.
  const gx = i => WORLD.minX + (tx * SEGMENTS + i * step) * spacing, gz = j => WORLD.minZ + (tz * SEGMENTS + j * step) * spacing;
  for (let j = -1; j <= row; j++) {
    for (let i = -1; i <= row; i++) heights[(j + 1) * (row + 2) + i + 1] = groundHeight(gx(i), gz(j));
    if (j % 8 === 7) yield;
  }
  const vertices = row * row + 8 * row, position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3);
  const at = (i, j) => heights[(j + 1) * (row + 2) + i + 1];
  for (let j = 0; j < row; j++) for (let i = 0; i < row; i++) {
    const v = (j * row + i) * 3, nx = at(i - 1, j) - at(i + 1, j), nz = at(i, j - 1) - at(i, j + 1), ny = 2 * spacing * step, length = Math.hypot(nx, ny, nz);
    position[v] = gx(i); position[v + 1] = at(i, j); position[v + 2] = gz(j);
    normal[v] = nx / length; normal[v + 1] = ny / length; normal[v + 2] = nz / length;
  }
  for (const [layer, drop] of [[0, 1], [4, SKIRT_DEPTH]]) for (let k = 0; k < 4; k++) for (let i = 0; i < row; i++) {
    const from = edge[k](i) * 3, to = (row * row + (layer + k) * row + i) * 3;
    position[to] = position[from]; position[to + 1] = position[from + 1] - drop; position[to + 2] = position[from + 2];
    normal[to] = normal[from]; normal[to + 1] = normal[from + 1]; normal[to + 2] = normal[from + 2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geom.setIndex(step === 1 ? FULL_INDICES[1] : COARSE_INDICES);
  geom.computeBoundingSphere();
  return geom;
}

// Coarse tiles are drawn in blocks of BLOCK x BLOCK, one draw each; a block with
// any full tile in it draws its tiles one by one instead.
const BLOCK = 2;
function terrain(scene) {
  const material = makeTerrainMaterial(), { tiles, tileSize: size } = WORLD, meshes = [], blocks = [];
  for (let tz = 0; tz < tiles; tz++) for (let tx = 0; tx < tiles; tx++) {
    const coarse = tileGeometry(tx, tz, COARSE_STEP), mesh = new THREE.Mesh(coarse, material);
    mesh.receiveShadow = true; mesh.visible = false;
    mesh.userData = { tx, tz, coarse, full: null, center: new THREE.Vector2(WORLD.minX + (tx + .5) * size, WORLD.minZ + (tz + .5) * size) };
    meshes.push(mesh);
    scene.add(mesh);
  }
  for (let bz = 0; bz < tiles; bz += BLOCK) for (let bx = 0; bx < tiles; bx += BLOCK) {
    const members = meshes.filter(m => m.userData.tx >= bx && m.userData.tx < bx + BLOCK && m.userData.tz >= bz && m.userData.tz < bz + BLOCK);
    const block = new THREE.Mesh(mergeGeometries(members.map(m => m.userData.coarse)), material);
    block.receiveShadow = true; block.userData.members = members;
    blocks.push(block);
    scene.add(block);
  }
  return { meshes, blocks };
}

/** Build a tile's full mesh until done (true) or out of time (false). */
function sharpenTile(mesh, until = Infinity) {
  if (mesh.userData.full) return true;
  const data = mesh.userData;
  data.building ??= buildTile(data.tx, data.tz, 1);
  let next;
  while (!(next = data.building.next()).done) if (performance.now() > until) return false;
  data.full = next.value; data.building = null;
  mesh.geometry = data.full;
  return true;
}
function softenTile(mesh) {
  if (!mesh.userData.full) return;
  mesh.geometry = mesh.userData.coarse;
  // The index buffers are shared by every tile: let go of one before disposing.
  mesh.userData.full.setIndex(null); mesh.userData.full.dispose(); mesh.userData.full = null;
}

// Water the lake shader may treat as deep without sampling the terrain. Both
// claims are checked against groundHeight by tests/world-regions.test.js.
export const DEEP_CHANNEL_SOUTH = 28000;
export function deepBasin(x, z) {
  const { basin } = SHAPES;
  return Math.hypot((x - basin.x) / basin.rx, (z - basin.z) / basin.rz) < .38 && basin.islands.every(([ix, iz, r]) => Math.hypot(x - ix, z - iz) > r * 1.3);
}
function deepBasinGlsl(p) {
  const { basin } = SHAPES, n = v => (Number.isInteger(v) ? `${v}.` : `${v}`);
  return [`length(vec2((${p}.x-(${n(basin.x)}))/${n(basin.rx)},(${p}.y-(${n(basin.z)}))/${n(basin.rz)})) < .38`,
    ...basin.islands.map(([ix, iz, r]) => `length(${p}-vec2(${n(ix)},${n(iz)})) > ${n(r * 1.3)}`)].join(' && ');
}

// The heart of the Mer d'Aurin, away from its islands, is deep as well.
export function deepSea(x, z) {
  const { sea } = SHAPES;
  return Math.hypot((x - sea.x) / sea.rx, (z - sea.z) / sea.rz) < .6 && sea.islands.every(([ix, iz, r]) => Math.hypot(x - ix, z - iz) > r * 1.3);
}
function deepSeaGlsl(p) {
  const { sea } = SHAPES, n = v => (Number.isInteger(v) ? `${v}.` : `${v}`);
  return [`length(vec2((${p}.x-(${n(sea.x)}))/${n(sea.rx)},(${p}.y-(${n(sea.z)}))/${n(sea.rz)})) < .6`,
    ...sea.islands.map(([ix, iz, r]) => `length(${p}-vec2(${n(ix)},${n(iz)})) > ${n(r * 1.3)}`)].join(' && ');
}

function makeLake(sunDirection) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    defines: { ALPINE_SHORE: 1 },
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
      ${groundShader}
      void main() {
        vec2 p = vLakePosition.xz;
        vec3 toEye = cameraPosition-vLakePosition;
        float range = length(toEye);
        vec3 eye = toEye/range;
        // Broad, low-amplitude swells stay smooth at flight altitude; the finer
        // ripples fade out with distance so the far lake never shimmers.
        float w1 = p.x*.017+p.y*.011+time*.65;
        float w2 = p.x*-.009+p.y*.023-time*.43;
        float w3 = p.x*.005+p.y*.007+time*.29;
        float w4 = p.x*.093+p.y*.061+time*1.7;
        float w5 = p.x*-.052+p.y*.118-time*1.45;
        float near = 1.-smoothstep(500.,3800.,range);
        vec2 slope = vec2(cos(w1)*.023+cos(w2)*.014, sin(w1)*.017+sin(w3)*.025);
        slope += vec2(cos(w4)*.026+cos(w5)*.017, sin(w4)*.019-sin(w5)*.024)*near;
        slope *= 1.-smoothstep(4000.,16000.,range)*.6;
        vec3 n = normalize(vec3(slope.x,1.,slope.y));
        float depth = 40.;
        #ifdef ALPINE_SHORE
          // The basin centre is always deep and the far shores are sub-pixel,
          // so only water near a shore pays for the terrain height.
          // The central channel and the basin's heart are both over 26 m deep,
          // which the flat 40 m depth already draws exactly (tests/world-regions).
          float valleyOffset = abs(p.x-sin(p.y*.00028)*480.-sin(p.y*.00074)*170.);
          bool shoreline = valleyOffset > 860. || p.y < -5600. || p.y > ${DEEP_CHANNEL_SOUTH}. || (abs(p.x-${airportX}.) < 680. && abs(p.y-(${airportZ}.)) < 1390.);
          if (${deepBasinGlsl('p')}) shoreline = false;
          if (${deepSeaGlsl('p')}) shoreline = false;
          if (shoreline && range < 11000.) depth = 10.-groundHeight(p.x,p.y);
        #endif
        // Glacial water: pale turquoise over the shelves, deep teal-blue in the basin.
        float shelf = 1.-smoothstep(0.,26.,depth);
        vec3 deep = waterColor*vec3(.5,.66,.82);
        vec3 shallow = waterColor*vec3(1.3,1.42,1.18)+vec3(.035,.05,.03);
        vec3 bed = vec3(.43,.45,.34);
        vec3 body = mix(deep,shallow,shelf);
        body = mix(body,bed,(1.-smoothstep(0.,3.5,depth))*.5);
        body *= .82+.18*max(sunDirection.y,0.)+sin(w3)*.02;
        vec3 reflected = reflect(-eye,n);
        vec3 sky = mix(skyColor*1.02,skyColor*vec3(.74,.86,.99),clamp(reflected.y,0.,1.));
        float fresnel = .02+.98*pow(1.-max(dot(eye,n),0.),5.);
        vec3 color = mix(body,sky,clamp(fresnel*.9+.04,0.,1.));
        vec3 h = normalize(eye+sunDirection);
        float glint = pow(max(dot(n,h),0.),220.)*.75+pow(max(dot(n,h),0.),32.)*.05;
        color += sunColor*glint*(.35+.65*near);
        // A soft lap of foam where the water meets the stones.
        float lap = depth+sin(time*1.4+p.x*.045+p.y*.037)*.12;
        float foam = (1.-smoothstep(.0,.45,lap))*smoothstep(-.3,.05,depth);
        color = mix(color,vec3(.88,.92,.9),foam*.4*near);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size,WORLD.size),material);
  lake.rotation.x = -Math.PI/2; lake.position.set((WORLD.minX+WORLD.maxX)/2, WATER_LEVEL, (WORLD.minZ+WORLD.maxZ)/2);
  return lake;
}

// The network's fields (Alpine Field keeps its own original clearances). The
// test runs only for points within a field's reach, so it costs the scatter little.
const NETWORK = AIRPORTS.filter(a => a !== ALPINE_FIELD).map(a => ({ airport: a, reach: a.runwayLength / 2 + 1900 }));
function nearAirport(x, z, test) {
  for (const { airport, reach } of NETWORK) if (Math.abs(x - airport.x) < reach && Math.abs(z - airport.z) < reach && test(airport, x, z)) return true;
  return false;
}
// Surveyed sites not yet built are kept clear the same way (a built one is in NETWORK).
const SITES = AIRPORT_SITES.filter(site => !AIRPORTS.some(a => a.id === site.id)).map(a => ({ airport: a, reach: a.runwayLength / 2 + 1900 }));
function nearSite(x, z, test) {
  for (const { airport, reach } of SITES) if (Math.abs(x - airport.x) < reach && Math.abs(z - airport.z) < reach && test(airport, x, z)) return true;
  return false;
}
/** On a field's pavement, apron or buildings, with 40 m to spare. */
function onAirfield(airport, x, z) {
  const { along, cross } = localCoordinates(airport, x, z), f = footprint(airport);
  return along > f.along[0] - 40 && along < f.along[1] + 40 && cross > f.cross[0] - 40 && cross < f.cross[1] + 40;
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
  // The regions grow their own forest in tile-sized cells, so far cells can be
  // dropped by distance and the forest stays bounded as the world grows.
  const cell = WORLD.tileSize, cells = CORE.size / cell, regional = Array.from({ length: cells * cells }, () => []);
  for (let attempts = 0, planted = 0; attempts < 420000 && planted < 52000; attempts++) {
    const x = CORE.minX + regionRandom() * CORE.size, z = CORE.minZ + regionRandom() * CORE.size, chance = regionRandom(), tone = regionRandom(), size = regionRandom();
    if (Math.abs(x) < 9800 && Math.abs(z) < 13100) continue;
    // Woods gather in stands with open meadow between; the plateau keeps to groves.
    const open = regionAt(x, z)?.id === 'eastern-plateau' ? .6 : .5;
    if (fbm(x * .0011 + 3, z * .0011 + 7) < open || chance > .9) continue;
    const h = groundHeight(x, z);
    if (h < 30 || h > 1480 || (h > 1180 && chance < smooth(1180, 1500, h))) continue;
    if (nearAirport(x, z, inProtectedArea)) continue;
    const slope = Math.abs(groundHeight(x + 16, z) - h) / 16 + Math.abs(groundHeight(x, z + 16) - h) / 16;
    if (slope > 1.32) continue;
    const ix = Math.min(cells - 1, Math.floor((x - CORE.minX) / cell)), iz = Math.min(cells - 1, Math.floor((z - CORE.minZ) / cell));
    regional[iz * cells + ix].push([x, h - 2, z, .6 + size, tone]); planted++;
  }
  const forestMeshes = [];
  for (const trees of [...buckets, ...regional]) {
    if (!trees.length) continue;
    const mesh = stand(geometry, mat, trees);
    forestMeshes.push(mesh);
    scene.add(mesh);
  }
  return { meshes: forestMeshes, geometry, material: mat };
}

/** One instanced draw of trees ([x, y, z, size, tone] each). */
function stand(geometry, material, trees) {
  const dummy = new THREE.Object3D(), color = new THREE.Color(), mesh = new THREE.InstancedMesh(geometry, material, trees.length);
  trees.forEach(([x, y, z, size, tone], i) => {
    dummy.position.set(x, y, z); dummy.scale.set(size, size * (1.0 + tone * .3), size); dummy.rotation.y = tone * 8; dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(.265 + tone * .047, .27 + tone * .16, .13 + tone * .075); mesh.setColorAt(i, color);
  });
  mesh.computeBoundingSphere();
  mesh.userData.fullCount = trees.length;
  return mesh;
}

// Beyond the Divide the forest is planted a cell (one terrain tile) at a time as
// the camera comes within range, each cell from its own seed, and dropped again
// once far behind: the same trees on every visit, and only the cells around the
// camera resident. Woods gather in stands; the lava tableland keeps to groves and
// the lowland farms to hedgerow woods.
const OUTER_OPEN = { 'western-highlands': .6, 'eastern-lowlands': .6, 'southern-coast': .57 };
export const OUTER_CELL = { attempts: 16000, trees: 2600 };
/** True for the tiles beyond CORE, which plant their forest as the camera nears. */
export const outerCell = (i, j) => {
  const x = WORLD.minX + (i + .5) * WORLD.tileSize, z = WORLD.minZ + (j + .5) * WORLD.tileSize;
  return Math.max(Math.abs(x), Math.abs(z)) > CORE.maxX;
};
/** The trees of one outer cell, the same every time it is planted. */
export function outerTrees(i, j) {
  const planting = plantCell(i, j);
  let step;
  while (!(step = planting.next()).done);
  return step.value;
}
// Planting yields every few hundred attempts, so a frame can stop part way.
function* plantCell(i, j) {
  let seed = (Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) | 0;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const x0 = WORLD.minX + i * WORLD.tileSize, z0 = WORLD.minZ + j * WORLD.tileSize, trees = [];
  for (let attempts = 0; attempts < OUTER_CELL.attempts && trees.length < OUTER_CELL.trees; attempts++) {
    if (attempts % 500 === 499) yield;
    const x = x0 + rand() * WORLD.tileSize, z = z0 + rand() * WORLD.tileSize, chance = rand(), tone = rand(), size = rand();
    if (fbm(x * .0011 + 3, z * .0011 + 7) < (OUTER_OPEN[regionAt(x, z)?.id] ?? .55) || chance > .9) continue;
    const h = groundHeight(x, z);
    if (h < 30 || h > 1480 || (h > 1180 && chance < smooth(1180, 1500, h))) continue;
    if (nearAirport(x, z, inProtectedArea) || nearSite(x, z, inProtectedArea)) continue;
    const slope = Math.abs(groundHeight(x + 16, z) - h) / 16 + Math.abs(groundHeight(x, z + 16) - h) / 16;
    if (slope > 1.32) continue;
    trees.push([x, h - 2, z, .6 + size, tone]);
  }
  return trees;
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

// The original 46 clouds over the valley, 24 over the first regions, then a
// sparser field over the outer regions. Counts per quality: [valley, regions, outer].
const CLOUDS = 110, CLOUD_COUNT = { low: [22, 8, 10], medium: [34, 14, 20], high: [46, 24, 40] };
// Clouds further than this from the camera are left undrawn: past the far plane
// and the haze they show nothing, and the draw calls stay bounded.
const CLOUD_RANGE = 48000;
function buildClouds(scene) {
  const texture = cloudTexture(), clouds = [];
  for (let i = 0; i < CLOUDS; i++) {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: .86, depthWrite: false, fog: true, color: 0xffffff });
    const sprite = new THREE.Sprite(mat);
    let x, z, y, size, tier;
    if (i < 46) { x = (random() - .5) * 37000; z = (random() - .5) * 43000; y = 2850 + random() * 950; size = 3000 + random() * 2700; tier = 0; }
    else if (i < 70) { do { x = (regionRandom() - .5) * CORE.size; z = (regionRandom() - .5) * CORE.size; } while (Math.abs(x) < 18500 && Math.abs(z) < 21500); y = 3000 + regionRandom() * 1100; size = 3200 + regionRandom() * 3000; tier = 1; }
    else { do { x = (outerRandom() - .5) * WORLD.size; z = (outerRandom() - .5) * WORLD.size; } while (Math.abs(x) < CORE.maxX && Math.abs(z) < CORE.maxZ); y = 3100 + outerRandom() * 1300; size = 3400 + outerRandom() * 3400; tier = 2; }
    sprite.position.set(x, y, z); sprite.scale.set(size, size * .40, 1);
    sprite.userData.baseX = x; sprite.userData.tier = tier; sprite.userData.rank = i - [0, 46, 70][tier];
    scene.add(sprite); clouds.push(sprite);
  }
  return clouds;
}

// Every field shares one set of materials, sized and placed in runway-local
// coordinates: x is right of the primary runway's centreline, -z points down it.
function airportMaterials() {
  return {
    runway: new THREE.MeshStandardMaterial({ color: 0x343b3d, roughness: .94 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8b938d, roughness: .96 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xe3e4d9, roughness: .9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xd5c9af, roughness: .85 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x45545a, roughness: .75 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x41626d, roughness: .2, metalness: .3 }),
    // Mown strip and gravel stay in the valley's olive and stone, never lawn green.
    grass: new THREE.MeshStandardMaterial({ color: 0x5b6334, roughness: 1 }),
    mown: new THREE.MeshStandardMaterial({ color: 0x6c7440, roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ color: 0x777264, roughness: 1 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x6b4e36, roughness: .9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x9a978c, roughness: .95 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffe1a7 }),
  };
}

// Batch a field's static parts by material: paint marks and runway lights cost
// one draw each instead of a draw for every small stripe and lamp.
function batchStatic(group) {
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
}

// A fully procedural windsock, readable during a low approach.
function windsock(group, x, z, materials) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, 13, 6), materials.stripe); pole.position.set(x, 6.5, z); group.add(pole);
  const sock = new THREE.Group(); sock.position.set(x, 13, z); sock.rotation.z = -.14; group.add(sock);
  for (let i = 0; i < 5; i++) {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(.9 - i * .1, .8 - i * .1, 1.15, 10, 1, true), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf4eee3 : 0xed6d40, side: THREE.DoubleSide }));
    part.rotation.z = Math.PI / 2; part.position.x = i * 1.15; sock.add(part);
  }
  return sock;
}

// Painted identifiers are generated locally and do not need a font asset.
function numberMaterial(text) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = '#f2f2df'; context.font = 'bold 90px Arial'; context.textAlign = 'center'; context.fillText(text, 64, 100);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
}

function alpineField(scene, materials) {
  const group = new THREE.Group(); group.position.set(airportX, airportY + .7, airportZ); scene.add(group);
  function box(w, h, d, x, y, z, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); group.add(m); return m; }
  box(AIRFIELD.runwayWidth, .45, AIRFIELD.runwayLength, 0, 0, 0, materials.runway);
  box(125, .30, 275, 110, 0, -220, materials.concrete);
  box(90, .30, 15, 65, 0, -115, materials.runway);
  box(90, .30, 15, 65, 0, -330, materials.runway);
  for (let z = -475; z <= 475; z += 65) box(1.25, .1, 31, 0, .36, z, materials.stripe);
  for (const x of [-23, 23]) box(.8, .1, 1075, x, .36, 0, materials.stripe);
  for (const end of [-1, 1]) for (const x of [-18, -12, -6, 6, 12, 18]) box(3.1, .1, 42, x, .37, end * 502, materials.stripe);
  for (let z = -525; z < 550; z += 55) for (const x of [-28, 28]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.7, 5, 4), materials.light); light.position.set(x, .9, z); group.add(light);
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
  const sock = windsock(group, -60, 335, materials);
  const number = new THREE.Mesh(new THREE.PlaneGeometry(18, 22), numberMaterial('36')); number.rotation.x = -Math.PI / 2; number.position.set(0, .6, 435); group.add(number);
  batchStatic(group);
  return { ...ALPINE_FIELD, position: new THREE.Vector3(airportX, airportY, airportZ), windsock: sock };
}

// Threshold bars by runway width, as painted on real runways.
const THRESHOLD_BARS = [[45, 12], [30, 8], [23, 6], [0, 4]];

/** One of the network's fields: runway, markings, apron, windsock and a few buildings in its own character. */
function networkField(scene, airport, materials) {
  const { runwayLength: L, runwayWidth: W, surface, kind } = airport, half = L / 2;
  const group = new THREE.Group(); group.position.set(airport.x, airport.elevation + .7, airport.z); group.rotation.y = -airport.heading; scene.add(group);
  // Runway-local placement: `along` from the primary threshold, `cross` to its right.
  const at = along => half - along;
  function box(w, h, d, x, y, z, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); group.add(m); return m; }
  // A gabled roof: a triangular prism along local z, its ridge `rise` above the eaves.
  function gable(w, rise, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, d, 3).rotateX(-Math.PI / 2).translate(0, .5, 0), mat);
    m.scale.set(w / Math.sqrt(3), rise / 1.5, 1); m.position.set(x, y, z); group.add(m); return m;
  }
  function arch(w, d, x, y, z) {
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 14, 1, false, 0, Math.PI), materials.roof);
    roof.rotation.x = Math.PI / 2; roof.rotation.z = Math.PI / 2; roof.scale.set(1, .3, 1); roof.position.set(x, y, z); group.add(roof);
  }
  const paved = surface === 'asphalt';
  box(W, .45, L, 0, 0, 0, paved ? materials.runway : materials.grass);
  // Apron and its taxiway, toward the buildings' side.
  const apron = airport.apron, side = Math.sign(apron.cross[0] + apron.cross[1]), mid = (apron.along[0] + apron.along[1]) / 2;
  const near = side > 0 ? apron.cross[0] : apron.cross[1], far = side > 0 ? apron.cross[1] : apron.cross[0];
  const apronDepth = Math.abs(far - near), apronLength = apron.along[1] - apron.along[0];
  const large = kind === 'regional' || kind === 'commercial';
  const deck = large || kind === 'lakeside' ? materials.concrete : materials.gravel;
  box(apronDepth, .3, apronLength, (near + far) / 2, 0, at(mid), deck);
  const taxi = Math.abs(near) - W / 2;
  const links = kind === 'commercial' ? [apron.along[0] + 60, mid, apron.along[1] - 60] : kind === 'regional' ? [apron.along[0] + 60, apron.along[1] - 60] : [mid];
  for (const t of links) box(taxi + 2, .3, large ? 23 : 15, side * (W / 2 + taxi / 2), 0, at(t), paved ? materials.runway : materials.gravel);
  if (kind === 'commercial') {
    // A parallel taxiway the length of the runway, so the large jets can taxi to either end, with its centreline.
    const tx = side * (W / 2 + taxi / 2);
    box(23, .3, L - 40, tx, 0, 0, materials.runway);
    for (const t of [20, L - 20]) box(taxi + 2, .3, 23, tx, 0, at(t), materials.runway);
    box(.4, .1, L - 60, tx, .32, 0, materials.stripe);
  }
  if (paved) {
    // Designators, threshold bars, centreline and edge lines, read from each approach.
    const bars = THRESHOLD_BARS.find(([width]) => W >= width)[1], pitch = (W - 6) / bars;
    for (const [end, text] of [[0, airport.runway], [L, airport.reciprocal]]) {
      const inward = end ? -1 : 1, z = along => at(end + inward * along);
      for (let i = 0; i < bars; i++) { const x = -W / 2 + 3 + pitch * (i + .5); if (Math.abs(x) > 1.5) box(Math.min(1.8, pitch * .6), .1, 30, x, .36, z(21), materials.stripe); }
      const number = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(18, W * .5), Math.min(22, W * .62)), numberMaterial(text));
      number.rotation.set(-Math.PI / 2, 0, end ? Math.PI : 0); number.position.set(0, .6, z(56 + Math.min(11, W * .31))); group.add(number);
      // Aiming point, and touchdown zone pairs on the long runway.
      if (L >= 1200) for (const x of [-1, 1]) box(W >= 45 ? 9 : 5, .1, 45, x * W * (W >= 45 ? .26 : .25), .37, z(L >= 2400 ? 400 : 300), materials.stripe);
      if (L >= 2400) for (const d of [150, 550, 700]) for (const x of [-1, 1]) for (const k of [-1, 1]) box(1.8, .1, 22, x * (W * .26 + k * 2.4), .37, z(d), materials.stripe);
    }
    for (let d = 90; d < L - 90; d += 50) box(W >= 30 ? .9 : .6, .1, 30, 0, .36, at(d), materials.stripe);
    for (const x of [-1, 1]) box(.8, .1, L - 6, x * (W / 2 - 1.2), .36, 0, materials.stripe);
  } else {
    // Grass strip: mown lanes, white boards along the edges and across each threshold.
    for (const x of [-W / 3, W / 3]) box(W / 3, .1, L - 4, x, .2, 0, materials.mown);
    for (let d = 0; d <= L; d += 75) for (const x of [-1, 1]) box(2.6, .7, .9, x * (W / 2 + 1.5), .4, at(d), materials.stripe);
    for (const end of [0, L]) for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 6) box(3, .5, 1.1, x, .4, at(end), materials.stripe);
  }
  if (airport.lit) for (let d = 0; d <= L; d += 60) for (const x of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.6, 5, 4), materials.light); light.position.set(x * (W / 2 + 2.5), .9, at(d)); group.add(light);
  }
  // Approach lights on the long runways: a centreline row and a crossbar beyond each
  // threshold, kept to the flat ground the grading leaves past the overrun.
  if (airport.lit && kind === 'commercial') for (const end of [0, L]) {
    const out = end ? 1 : -1;
    for (let d = 30; d <= 300; d += 30) for (const x of d === 150 ? [-12, -8, -4, 0, 4, 8, 12] : [-1.5, 0, 1.5]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(.6, 5, 4), materials.light); light.position.set(x, .9, at(end + out * d)); group.add(light);
    }
  }
  // Buildings stand along the apron's far edge, facing the runway.
  const row = far - side * 22, along = t => at(apron.along[0] + apronLength * t);
  if (kind === 'regional') {
    box(28, 11, 150, row, 5.5, along(.42), materials.wall);
    box(1, 5, 140, row - side * 14.2, 6.5, along(.42), materials.glass);
    box(30, 1.2, 152, row, 11.6, along(.42), materials.roof);
    box(10, 30, 10, row, 15, along(.12), materials.concrete);
    box(15, 6, 15, row, 33, along(.12), materials.glass);
    box(17, 1.2, 17, row, 36.6, along(.12), materials.roof);
    for (const t of [.74, .9]) { box(42, 15, 54, row, 7.5, along(t), materials.wall); arch(44, 56, row, 15, along(t)); box(.4, 11, 40, row - side * 21.2, 6, along(t), materials.roof); }
  } else if (kind === 'commercial') {
    // A long glazed terminal with gate piers reaching toward the runway, a tall tower and a row of arched hangars.
    box(34, 14, 520, row, 7, along(.36), materials.wall);
    box(1, 7, 500, row - side * 17.2, 8, along(.36), materials.glass);
    box(36, 1.4, 524, row, 14.6, along(.36), materials.roof);
    for (const t of [.2, .36, .52]) { box(70, 6, 14, row - side * 52, 4, along(t), materials.wall); box(70, .8, 15, row - side * 52, 7.3, along(t), materials.roof); }
    box(12, 44, 12, row, 22, along(.06), materials.concrete);
    box(18, 7, 18, row, 47.5, along(.06), materials.glass);
    box(20, 1.4, 20, row, 51.6, along(.06), materials.roof);
    for (const t of [.7, .8, .9]) { box(60, 20, 70, row, 10, along(t), materials.wall); arch(62, 72, row, 20, along(t)); box(.4, 15, 54, row - side * 30.2, 8, along(t), materials.roof); }
  } else if (kind === 'grass') {
    box(12, 4.5, 16, row, 2.25, along(.3), materials.timber); gable(13.5, 4, 17, row, 4.5, along(.3), materials.roof);
    box(20, 6, 24, row, 3, along(.72), materials.timber); gable(22, 5, 25, row, 6, along(.72), materials.roof);
    box(.4, 5, 18, row - side * 10.2, 2.6, along(.72), materials.roof);
  } else if (kind === 'lakeside') {
    box(18, 7, 46, row, 3.5, along(.3), materials.wall);
    box(.6, 3.5, 40, row - side * 9.1, 4, along(.3), materials.glass);
    box(20, 1, 48, row, 7.5, along(.3), materials.roof);
    box(7, 18, 7, row + side * 4, 9, along(.08), materials.wall); box(10, 4.5, 10, row + side * 4, 20.2, along(.08), materials.glass); box(11, 1, 11, row + side * 4, 23, along(.08), materials.roof);
    box(32, 11, 36, row, 5.5, along(.78), materials.wall); arch(34, 38, row, 11, along(.78)); box(.4, 8, 28, row - side * 16.2, 4.5, along(.78), materials.roof);
  } else {
    // Mountain: a stone hut and a small hangar under steep roofs that shed snow.
    box(9, 4, 12, row + side * 4, 2, along(.28), materials.stone); gable(10.5, 5.5, 13, row + side * 4, 4, along(.28), materials.roof);
    box(18, 6.5, 22, row, 3.25, along(.72), materials.stone); gable(19.5, 6, 23, row, 6.5, along(.72), materials.roof);
    box(.4, 5.5, 16, row - side * 9.2, 2.9, along(.72), materials.timber);
  }
  // The windsock stands opposite the apron, by the primary threshold.
  const sock = windsock(group, -side * (W / 2 + 25), at(160), materials);
  // Every sock shows the same wind as Alpine Field's.
  sock.rotation.y = airport.heading;
  batchStatic(group);
  return { ...airport, position: new THREE.Vector3(airport.x, airport.elevation, airport.z), windsock: sock, group };
}

function airports(scene) {
  const materials = airportMaterials();
  return AIRPORTS.map(a => a === ALPINE_FIELD ? alpineField(scene, materials) : networkField(scene, a, materials));
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
  // The original four villages keep their sequence; the regions' draw their own.
  VILLAGES.forEach(([cx, cz, spread, houses], v) => {
    const outer = Math.max(Math.abs(cx), Math.abs(cz)) > CORE.maxX, rand = v < 4 ? random : outer ? outerRandom : regionRandom, ceiling = v < 4 ? 700 : 1400;
    for (let i = 0; i < houses; i++) {
      const x = cx + (rand() - .5) * spread, z = cz + (rand() - .5) * spread, y = groundHeight(x, z);
      if (y < 28 || y > ceiling || Math.abs(groundHeight(x + 12, z) - y) > 10) continue;
      spots.push({ x, y, z, w: 13 + rand() * 12, h: 9 + rand() * 9, d: 17 + rand() * 18, rot: rand() * .45, outer,
        clear: !nearAirport(x, z, onAirfield) && !nearSite(x, z, onAirfield) });
    }
  });
  // A house on an airfield is left out after its colours are drawn, so every other house keeps its own.
  const built = spots.filter(s => s.clear).length;
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94 }), built);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, side: THREE.DoubleSide }), built);
  const dummy = new THREE.Object3D(), color = new THREE.Color(), roofColor = new THREE.Color();
  let i = 0;
  for (const s of spots) {
    const rand = s.outer ? outerRandom : random;
    color.setHSL(.10 + rand() * .04, .10 + rand() * .10, .53 + rand() * .25);
    roofColor.setHSL(.025 + rand() * .035, .15 + rand() * .13, .20 + rand() * .12);
    if (!s.clear) continue;
    dummy.position.set(s.x, s.y + s.h / 2 - 1, s.z); dummy.rotation.y = s.rot; dummy.scale.set(s.w, s.h, s.d); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix); bodies.setColorAt(i, color);
    dummy.position.y = s.y + s.h - 1; dummy.scale.set(s.w, s.w * .6, s.d); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix); roofs.setColorAt(i, roofColor);
    i++;
  }
  scene.add(bodies, roofs);
  // Quiet roads: ribbons follow the actual terrain rather than floating.
  const roads = [];
  for (const side of [-1, 1]) {
    const line = [];
    for (let i = 0; i <= 210; i++) { const z = -6800 + i * 70; line.push([valleyCurve(z) + side * (1580 + Math.sin(z * .0016) * 90), z]); }
    roads.push(line);
  }
  // Val Verdance's valley road, the shore road around Lac Serein and the plateau track.
  const westRoad = [];
  for (let z = -19000; z <= 17000; z += 80) westRoad.push([westValleyCurve(z) + 520 + Math.sin(z * .0011) * 160, z]);
  const shoreRoad = [], { basin } = SHAPES;
  for (let a = 3.55; a <= 6.35; a += .012) shoreRoad.push([basin.x + Math.cos(a) * basin.rx * 1.14, basin.z - Math.sin(a) * basin.rz * 1.14]);
  const plateauRoad = [];
  for (const [ax, az, bx, bz] of [[15800, 6200, 23800, 3800], [23800, 3800, 25400, -5200], [25400, -5200, 27800, -9000]]) {
    for (let t = 0; t < 1; t += .01) plateauRoad.push([ax + (bx - ax) * t + Math.sin(t * Math.PI) * 300, az + (bz - az) * t]);
  }
  roads.push(westRoad, shoreRoad.filter(([x, z]) => groundHeight(x, z) > 14), plateauRoad);
  // Beyond the Divide: down the Rampe d'Orvane and along Calmeterre's east
  // terrace, up Val Vauclair, along the Aurin shore and across the Cendre tableland.
  const polyline = (points, step = 80) => {
    const line = [];
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, az] = points[k], [bx, bz] = points[k + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / step);
      for (let i = 0; i < n; i++) line.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    }
    line.push(points.at(-1));
    return line;
  };
  const calmeRoad = [];
  for (let z = -38000; z <= 46000; z += 90) calmeRoad.push([calmeCurve(z) + 3200 + Math.sin(z * .0013) * 200, z]);
  const { sea } = SHAPES, coastRoad = [];
  for (let x = sea.x - sea.rx * .72; x <= sea.x + sea.rx * .74; x += 90) coastRoad.push([x, sea.z - Math.sqrt(1.2 ** 2 - ((x - sea.x) / sea.rx) ** 2) * sea.rz]);
  roads.push(polyline(ROUTES.find(r => r.id === 'rampe-orvane').points.map(([x, z]) => [x, z])), calmeRoad,
    polyline([[50500, -37600], [44800, -39400], [44500, -40200]]), polyline(SHAPES.trough.points.slice(1, 8).reverse()),
    coastRoad.filter(([x, z]) => groundHeight(x, z) > 14),
    polyline([[-40500, -14500], [-44500, -14200], [-47500, -15500], [-50500, -13800]]), polyline([[-47500, -15500], [-48500, -4000], [-49800, 6000], [-50500, 17000], [-48000, 26000]]));
  roads.forEach((line, i) => { if (i > 4) roads[i] = line.filter(([x, z]) => groundHeight(x, z) > 12); });
  const positions = [], indices = [];
  for (const line of roads) for (let i = 0; i < line.length; i++) {
    const [x, z] = line[i], [nx, nz] = line[Math.min(i + 1, line.length - 1)], [px, pz] = line[Math.max(i - 1, 0)];
    const length = Math.hypot(nx - px, nz - pz) || 1, ox = (nz - pz) / length * 3.8, oz = -(nx - px) / length * 3.8;
    const base = positions.length / 3;
    for (const sign of [-1, 1]) positions.push(x + ox * sign, Math.max(groundHeight(x + ox * sign, z + oz * sign) + 1.1, 14), z + oz * sign);
    // Roads stop short of the airfields rather than crossing a runway.
    if (i < line.length - 1 && Math.hypot(nx - x, nz - z) < 400 && !nearAirport(x, z, onAirfield) && !nearAirport(nx, nz, onAirfield)
      && !nearSite(x, z, onAirfield) && !nearSite(nx, nz, onAirfield)) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x73766b, roughness: 1, side: THREE.DoubleSide })));
}

function buildBoats(scene) {
  const boats = [];
  for (const [x, z, angle] of [[-390, 50, .5], [240, -3200, -.6], [-400, 2900, 1.3], [250, 1300, -.3], [-5200, 21800, .9], [3600, 25600, -1.1], [9000, 26400, 2.2], [-400, 29600, .2], [-6800, 27400, -.5],
    [-2500, 51500, .4], [9500, 50000, -1], [-16000, 53800, 2], [39500, -41300, 1.2], [-55600, -10200, .8]]) {
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
  // The active aircraft reflects the actual sky. Only the object handed to
  // reflectSky() samples it: on the terrain and forest it would cost a lot and
  // add little. A new aircraft replaces the previous one, so nothing is retained.
  const pmrem = new THREE.PMREMGenerator(renderer), environmentScene = new THREE.Scene();
  const environmentSky = new THREE.Mesh(sky.geometry, sky.material); environmentSky.scale.setScalar(50);
  const environmentGround = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshBasicMaterial({ color: 0x3d4630 }));
  environmentGround.rotation.x = -Math.PI / 2; environmentGround.position.y = -6;
  environmentScene.add(environmentSky, environmentGround);
  let environment, environmentIntensity = .7;
  let reflective = null;
  function applyEnvironment(root) {
    root.traverse(object => {
      const material = object.material;
      if (!material?.isMeshStandardMaterial) return;
      material.userData.skyReflection ??= material.envMapIntensity;
      material.envMap = environment.texture; material.envMapIntensity = material.userData.skyReflection * environmentIntensity; material.needsUpdate = true;
    });
  }
  function refreshEnvironment() {
    environment?.dispose();
    environment = pmrem.fromScene(environmentScene, 0, .1, 200);
    if (reflective) applyEnvironment(reflective);
  }
  function reflectSky(root) { reflective = root; applyEnvironment(root); }
  const sun = new THREE.DirectionalLight(0xfff0da, 3.25); sun.position.copy(sunDirection).multiplyScalar(7000); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -900; sun.shadow.camera.right = 900; sun.shadow.camera.top = 900; sun.shadow.camera.bottom = -900; sun.shadow.camera.near = 10; sun.shadow.camera.far = 17000; sun.shadow.normalBias = 1.5; sun.shadow.bias = -.00015;
  scene.add(sun, sun.target);
  const { meshes: terrainMeshes, blocks: terrainBlocks } = terrain(scene);
  const lake = makeLake(sunDirection); scene.add(lake);
  const forest = buildForest(scene), forestMeshes = forest.meshes, outerStands = new Map();
  const fields = airports(scene), airfield = fields[0];
  buildVillages(scene);
  const clouds = buildClouds(scene), boats = buildBoats(scene);
  const landmarks = LANDMARKS.map(({ name, type, region, x, z, y }) => ({ name, type, region, position: new THREE.Vector3(x, y ?? Math.max(WATER_LEVEL, groundHeight(x, z)), z) }));
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
    environmentGround.material.color.set(golden ? 0x4a3f2c : overcast ? 0x3a4136 : 0x3d4630);
    environmentIntensity = overcast ? .8 : golden ? .75 : .7;
    refreshEnvironment();
    scene.fog.color.set(golden ? 0xd5b3a1 : overcast ? 0xb5c4c8 : 0xb8d3dd); scene.fog.density = overcast ? .000077 : golden ? .000053 : .000043;
    lake.material.uniforms.sunDirection.value.copy(sunDirection); lake.material.uniforms.sunColor.value.copy(sun.color);
    lake.material.uniforms.waterColor.value.set(golden ? 0x22737a : overcast ? 0x347881 : 0x127d89);
    lake.material.uniforms.skyColor.value.set(golden ? 0xd3bba6 : overcast ? 0xaebdc2 : 0xa8cddd);
    for (const cloud of clouds) { cloud.material.color.set(overcast ? 0xabb7bc : golden ? 0xffe1bd : 0xffffff); cloud.material.opacity = overcast ? 1 : .86; }
  }
  const density = () => quality === 'low' ? .30 : quality === 'medium' ? .50 : 1;
  function setQuality(value = 'high') {
    quality = value;
    forestMeshes.forEach(mesh => { mesh.count = Math.max(1,Math.floor(mesh.userData.fullCount * density())); });
    outerStands.forEach(mesh => { if (mesh) mesh.count = Math.max(1, Math.floor(mesh.userData.fullCount * density())); });
    const counts = CLOUD_COUNT[value] ?? CLOUD_COUNT.high;
    clouds.forEach(cloud => { cloud.userData.enabled = cloud.userData.rank < counts[cloud.userData.tier]; });
    sun.castShadow = value === 'high';
    // The shoreline depth costs a few dozen ALU ops per water pixel; low quality keeps a flat depth.
    const shore = value !== 'low';
    if (Boolean(lake.material.defines.ALPINE_SHORE) !== shore) { if (shore) lake.material.defines.ALPINE_SHORE = 1; else delete lake.material.defines.ALPINE_SHORE; lake.material.needsUpdate = true; }
    lastLodX = Infinity; lastLodZ = Infinity;
  }
  // Terrain detail, forest cells and clouds follow the camera; all are re-chosen
  // only after it has moved 500 m, so a frame pays nothing for them otherwise.
  // Full terrain tiles and outer forest cells it newly needs are queued and built
  // a few milliseconds' worth per frame, nearest first (see grow).
  const pendingTiles = [], pendingStands = [], plantings = new Map(), half = WORLD.tileSize / 2;
  const edgeDistance = (position, x, z) => Math.hypot(Math.max(0, Math.abs(position.x - x) - half), Math.max(0, Math.abs(position.z - z) - half));
  function tileStep(mesh) {
    const lod = TERRAIN_LOD[quality] ?? TERRAIN_LOD.high, step = lod.find(([range]) => mesh.userData.distance < range)[1];
    if (mesh.userData.full && mesh.geometry.index !== FULL_INDICES[step]) mesh.geometry.setIndex(FULL_INDICES[step]);
  }
  function showBlocks() {
    for (const block of terrainBlocks) {
      const split = block.userData.members.some(m => m.userData.full);
      block.visible = !split;
      for (const m of block.userData.members) m.visible = split;
    }
  }
  function updateDetail(position) {
    const forestRange = FOREST_RANGE[quality] ?? FOREST_RANGE.high, full = FULL_RANGE[quality] ?? FULL_RANGE.high;
    pendingTiles.length = 0;
    for (const mesh of terrainMeshes) {
      const c = mesh.userData.center, distance = mesh.userData.distance = edgeDistance(position, c.x, c.y);
      if (distance > full + FULL_LAG) { softenTile(mesh); mesh.userData.building = null; }
      else if (!mesh.userData.full && distance < full + FULL_LEAD) pendingTiles.push(mesh);
      tileStep(mesh);
    }
    showBlocks();
    for (const mesh of forestMeshes) {
      const sphere = mesh.boundingSphere;
      mesh.visible = Math.hypot(position.x - sphere.center.x, position.z - sphere.center.z) - sphere.radius < forestRange;
    }
    pendingStands.length = 0;
    for (let j = 0; j < WORLD.tiles; j++) for (let i = 0; i < WORLD.tiles; i++) {
      if (!outerCell(i, j)) continue;
      const key = j * WORLD.tiles + i, mesh = outerStands.get(key);
      const distance = edgeDistance(position, WORLD.minX + (i + .5) * WORLD.tileSize, WORLD.minZ + (j + .5) * WORLD.tileSize);
      if (mesh !== undefined && distance > forestRange + FULL_LAG) {
        if (mesh) { scene.remove(mesh); mesh.dispose(); }
        outerStands.delete(key);
      } else if (mesh === undefined && distance < forestRange + FULL_LEAD) pendingStands.push({ i, j, key, distance, planting: plantings.get(key) });
      else if (mesh) mesh.visible = distance < forestRange;
    }
    // A cell half planted and no longer wanted starts again next time.
    for (const key of plantings.keys()) if (!pendingStands.some(p => p.key === key)) plantings.delete(key);
    const airportRange = AIRPORT_RANGE[quality] ?? AIRPORT_RANGE.high;
    for (const field of fields) if (field.group) field.group.visible = Math.hypot(position.x - field.x, position.z - field.z) < airportRange;
    for (const cloud of clouds) cloud.visible = cloud.userData.enabled && Math.hypot(position.x - cloud.position.x, position.z - cloud.position.z) < CLOUD_RANGE;
    // Nearest last, so they are popped first.
    pendingTiles.sort((a, b) => b.userData.distance - a.userData.distance);
    pendingStands.sort((a, b) => b.distance - a.distance);
    lastLodX = position.x; lastLodZ = position.z;
  }
  // Build what updateDetail queued: tiles the camera is over (within URGENT) at
  // once, the rest within `budget` milliseconds a frame.
  function grow(budget = 4) {
    const start = performance.now();
    while (pendingTiles.length) {
      const mesh = pendingTiles.at(-1);
      if (!sharpenTile(mesh, mesh.userData.distance < URGENT ? Infinity : start + budget)) break;
      pendingTiles.pop(); tileStep(mesh);
      showBlocks();
    }
    while (pendingStands.length && performance.now() - start < budget) {
      const next = pendingStands.at(-1);
      if (!next.planting) plantings.set(next.key, next.planting = plantCell(next.i, next.j));
      let step;
      while (!(step = next.planting.next()).done && performance.now() - start < budget);
      if (!step.done) break;
      pendingStands.pop(); plantings.delete(next.key);
      const { key, distance } = next, trees = step.value;
      const mesh = trees.length ? stand(forest.geometry, forest.material, trees) : null;
      if (mesh) {
        mesh.count = Math.max(1, Math.floor(mesh.userData.fullCount * density()));
        mesh.visible = distance < (FOREST_RANGE[quality] ?? FOREST_RANGE.high);
        scene.add(mesh);
      }
      outerStands.set(key, mesh);
    }
  }
  function update(dt, time, position) {
    lake.material.uniforms.time.value = time * .48;
    if (position) {
      sun.target.position.copy(position); sun.position.copy(position).addScaledVector(sunDirection, 7000);
      if (Math.hypot(position.x - lastLodX, position.z - lastLodZ) > 500) updateDetail(position);
      if (pendingTiles.length || pendingStands.length) grow();
    }
    clouds.forEach((cloud, i) => { cloud.position.x = cloud.userData.baseX + Math.sin(time * .007 + i) * 85; });
    boats.forEach((boat, i) => { boat.rotation.z = Math.sin(time * .72 + i) * .018; boat.position.y = 11 + Math.sin(time * .9 + i) * .12; });
    fields.forEach((field, i) => { field.windsock.rotation.z = -.15 + Math.sin(time * 2.7 + i * 1.3) * .035; });
  }
  setWeather('clear');
  setQuality('high');
  updateDetail(new THREE.Vector3(0, 0, 1900));
  grow(Infinity);
  return { heightAt: (x, z) => Math.max(WATER_LEVEL, groundHeight(x, z)), update, setWeather, setQuality, reflectSky, landmarks, airport: airfield, airports: fields,
    bounds: WORLD, regions: REGIONS, regionAt };
}

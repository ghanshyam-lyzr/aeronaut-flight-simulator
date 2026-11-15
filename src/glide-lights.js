import * as THREE from 'three';
import { runwayCoordinates } from './airfield.js';
import { TOUCHDOWN_ZONE } from './landing-mission.js';

/**
 * A simplified four-light glide-path training aid, modelled on a PAPI but not a
 * certified installation: it reads the same path the landing mission scores
 * (landingProfile's slope, rising from TOUCHDOWN_ZONE.aim at runway elevation
 * plus the aircraft's ground clearance), measured from the aircraft's position,
 * never the camera. Two white over two red is on that path; more white is high,
 * more red is low.
 */
export const GLIDE_LIGHTS = Object.freeze({
  // Angle offsets (degrees) from the path at which each light turns white, innermost (nearest the runway) first.
  offsets: Object.freeze([0.5, 0.17, -0.17, -0.5]),
  minDistance: 100, maxDistance: 6000, // metres before the aim point
  sector: 10, // degrees either side of the extended centreline, beyond the runway's half width
  maxAngle: 10, // degrees above the aim point: higher is no longer an approach
  edge: 12, spacing: 9, // first unit's distance beyond the runway edge, and between units
});

const rad = d => d * Math.PI / 180;

/**
 * The indication for an aircraft at `position` approaching `field` (a runway
 * direction, as runwayDirection returns): `{ visible, white, units, reason, angle, path }`.
 * `white` counts the white units (0–4), `units` flags each white unit innermost
 * first (the outer ones whiten first); `reason` names why it is hidden.
 * `profile` is landingProfile(type); `state` may carry grounded/crashed.
 */
export function glideIndication(position, field, profile, state = {}) {
  const hidden = reason => ({ visible: false, white: 0, units: [false, false, false, false], reason, angle: null, path: null });
  if (!field || !profile) return hidden('no runway');
  if (profile.helicopter) return hidden('helicopter');
  if (state.crashed) return hidden('crashed');
  if (state.grounded) return hidden('on the ground');
  if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return hidden('invalid');
  const at = runwayCoordinates(position, field), distance = TOUCHDOWN_ZONE.aim - at.along;
  if (distance < GLIDE_LIGHTS.minDistance) return hidden('past the approach');
  if (distance > GLIDE_LIGHTS.maxDistance) return hidden('too far');
  if (Math.abs(at.cross) > field.runwayWidth / 2 + distance * Math.tan(rad(GLIDE_LIGHTS.sector))) return hidden('outside the sector');
  const height = position.y - field.elevation - profile.clearance;
  const angle = Math.atan2(height, distance) * 180 / Math.PI, path = Math.atan(profile.slope) * 180 / Math.PI;
  if (angle > GLIDE_LIGHTS.maxAngle) return hidden('above the sector');
  const units = GLIDE_LIGHTS.offsets.map(o => angle > path + o);
  return { visible: true, white: units.filter(Boolean).length, units, reason: '', angle, path };
}

/** Pilot's left of the runway, unless the field's apron (and its buildings) sits there. */
export const lightSide = field => (field.apron?.cross?.[1] ?? 1) < 0 ? 1 : -1;

/** Runway-local cross offsets of the four units, innermost first. */
export const unitOffsets = field => GLIDE_LIGHTS.offsets.map((_, i) =>
  lightSide(field) * (field.runwayWidth / 2 + GLIDE_LIGHTS.edge + i * GLIDE_LIGHTS.spacing));

const vertex = /* glsl */`
attribute float white;
uniform float viewHeight;
varying float vWhite;
#include <common>
#include <fog_pars_vertex>
void main() {
  vWhite = white;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mvPosition;
  // About a metre across up close, never smaller than a few pixels far out.
  gl_PointSize = clamp(1.2 * projectionMatrix[1][1] * viewHeight * .5 / max(-mvPosition.z, 1.), 4.5 * viewHeight / 900., 40.);
  #include <fog_vertex>
}`;
const fragment = /* glsl */`
uniform vec3 whiteColor;
uniform vec3 redColor;
varying float vWhite;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  if (r > 1.) discard;
  gl_FragColor = vec4(mix(redColor, whiteColor, vWhite), smoothstep(1., .55, r));
  #include <fog_fragment>
}`;

/**
 * The four units for one runway at a time: one point geometry (a vertex per
 * unit, a per-vertex white flag) and one low housing bar, each a single draw,
 * depth-tested against terrain and aircraft and fogged with the world haze. No
 * scene lights. setField() moves the same resources to another runway; update()
 * shows or hides them from glideIndication(); dispose() frees everything.
 */
export function createGlideLights(scene) {
  const group = new THREE.Group(); group.visible = false; group.name = 'glide-lights';
  const positions = new Float32Array(12), white = new Float32Array(4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('white', new THREE.BufferAttribute(white, 1));
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, fog: true, transparent: true, depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { viewHeight: { value: 900 },
      whiteColor: { value: new THREE.Color('hsl(40, 60%, 96%)') }, redColor: { value: new THREE.Color('hsl(2, 90%, 52%)') } }]) });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = renderer => { material.uniforms.viewHeight.value = renderer.getDrawingBufferSize(size).y; };
  const barGeometry = new THREE.BoxGeometry(1, 0.7, 1.6), barMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2d30 });
  const bar = new THREE.Mesh(barGeometry, barMaterial);
  group.add(points, bar); scene.add(group);
  let field = null, shown = -1;
  const lights = {
    group, get field() { return field; }, indication: glideIndication(null, null, null),
    /** Place the units beside `field`'s touchdown aim; a no-op for the runway already in place. */
    setField(next) {
      if (field && next && field.id === next.id && field.runway === next.runway) return;
      field = next; shown = -1; group.visible = false;
      if (!field) return;
      group.position.set(field.x, field.elevation, field.z); group.rotation.y = -field.heading;
      const z = field.runwayLength / 2 - TOUCHDOWN_ZONE.aim, offsets = unitOffsets(field);
      offsets.forEach((cross, i) => positions.set([cross, 1.1, z], i * 3));
      geometry.attributes.position.needsUpdate = true; geometry.computeBoundingSphere();
      bar.scale.x = Math.abs(offsets[3] - offsets[0]) + 3; bar.position.set((offsets[0] + offsets[3]) / 2, 0.35, z);
    },
    /** Recompute from the aircraft (not the camera); only rewrites the colours when the count changes. */
    update(position, profile, state) {
      const ind = lights.indication = glideIndication(position, field, profile, state);
      group.visible = ind.visible;
      if (ind.visible && ind.white !== shown) {
        shown = ind.white;
        ind.units.forEach((on, i) => { white[i] = on ? 1 : 0; });
        geometry.attributes.white.needsUpdate = true;
      }
      return ind;
    },
    dispose() { scene.remove(group); geometry.dispose(); material.dispose(); barGeometry.dispose(); barMaterial.dispose(); field = null; },
  };
  return lights;
}

import * as THREE from 'three';
import { HOVER } from './hover-challenge.js';

/** One open ring at target altitude, a north-pointing arrow and a thin ground tether. No per-frame allocations. */
export function createHoverTarget(scene, signal) {
  const group = new THREE.Group(); group.name = 'hover-target'; group.visible = false;
  const material = new THREE.MeshBasicMaterial({ color: signal, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const geometry = new THREE.TorusGeometry(HOVER.radius, 0.07, 4, 48);
  const ring = new THREE.Mesh(geometry, material); ring.rotation.x = Math.PI / 2; group.add(ring);
  const points = new Float32Array([0, 0, 0, 0, -HOVER.clearance, 0, 0, 0, 2.5, 0, 0, -6.5,
    -1.2, 0, -5, 0, 0, -6.5, 1.2, 0, -5, 0, 0, -6.5]);
  const lines = new THREE.BufferGeometry(); lines.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: signal, transparent: true, opacity: 0.65, depthWrite: false });
  group.add(new THREE.LineSegments(lines, lineMaterial));
  scene.add(group);
  return { group, update(visible, target, inside) {
    group.visible = visible && !!target;
    if (!group.visible) return;
    group.position.set(target.x, target.y, target.z);
    // The arrow points north (target heading); the ring stays a fixed 4 m radius, never a moving goalpost.
    group.rotation.y = -target.heading;
    material.opacity = inside ? 1 : 0.65;
  }, dispose() { scene.remove(group); geometry.dispose(); lines.dispose(); material.dispose(); lineMaterial.dispose(); } };
}

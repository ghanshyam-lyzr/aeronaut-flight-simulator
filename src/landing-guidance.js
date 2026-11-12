import * as THREE from 'three';
import { TOUCHDOWN_ZONE } from './landing-mission.js';

/** Quiet world-space cues; depth testing keeps them behind terrain and aircraft. */
export function createLandingGuidance(scene, field, signal) {
  const group = new THREE.Group();
  group.position.set(field.x, field.elevation, field.z); group.rotation.y = -field.heading;
  const material = new THREE.LineBasicMaterial({ color: signal, transparent: true, opacity: 0.75 });
  const line = points => new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), material);
  const zone = (from, to, halfWidth) => line([
    [-halfWidth, 1.5, field.runwayLength / 2 - from], [halfWidth, 1.5, field.runwayLength / 2 - from],
    [halfWidth, 1.5, field.runwayLength / 2 - to], [-halfWidth, 1.5, field.runwayLength / 2 - to],
    [-halfWidth, 1.5, field.runwayLength / 2 - from],
  ]);
  const runwayZone = zone(TOUCHDOWN_ZONE.start, TOUCHDOWN_ZONE.end, 18);
  const skidZone = zone(TOUCHDOWN_ZONE.aim - 18, TOUCHDOWN_ZONE.aim + 18, 10);
  group.add(runwayZone, skidZone);
  const gates = new THREE.Group();
  for (const along of [-750, -400, -80]) {
    const z = field.runwayLength / 2 - along, y = 2.8 + (TOUCHDOWN_ZONE.aim - along) * 0.05;
    gates.add(line([[-18, y + 7, z], [-18, y, z], [18, y, z], [18, y + 7, z]]));
  }
  group.add(gates); scene.add(group); group.visible = false;
  return { show(active, helicopter = false, clearance = 2.8) { group.visible = active; gates.position.y = clearance - 2.8; gates.visible = runwayZone.visible = !helicopter; skidZone.visible = helicopter; } };
}

import * as THREE from 'three';
import { TOUCHDOWN_ZONE } from './landing-mission.js';

/**
 * Quiet world-space cues for one field and runway; depth testing keeps them behind
 * terrain and aircraft. The group sits at the field centre turned to the runway's
 * heading, so local -z points down the runway. dispose() removes and frees it, so
 * a mission at another field gets fresh cues.
 */
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
  // Outlines stay inside narrower runways: the skid box is never wider than the area the mission scores.
  const runwayZone = zone(TOUCHDOWN_ZONE.start, TOUCHDOWN_ZONE.end, Math.min(18, field.runwayWidth / 2 - 1));
  const skidZone = zone(TOUCHDOWN_ZONE.aim - 18, TOUCHDOWN_ZONE.aim + 18, Math.min(10, field.runwayWidth / 2 - 3));
  group.add(runwayZone, skidZone);
  const gates = new THREE.Group();
  for (const along of [-750, -400, -80]) {
    const z = field.runwayLength / 2 - along, y = 2.8 + (TOUCHDOWN_ZONE.aim - along) * 0.05;
    gates.add(line([[-18, y + 7, z], [-18, y, z], [18, y, z], [18, y + 7, z]]));
  }
  group.add(gates); scene.add(group); group.visible = false;
  return { field, group,
    show(active, helicopter = false, clearance = 2.8) { group.visible = active; gates.position.y = clearance - 2.8; gates.visible = runwayZone.visible = !helicopter; skidZone.visible = helicopter; },
    dispose() { scene.remove(group); group.traverse(o => o.geometry?.dispose()); material.dispose(); } };
}

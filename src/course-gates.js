import * as THREE from 'three';

/**
 * World-space checkpoint gates for one course: each gate is a frame of four bars
 * (two posts and two beams) facing its heading, with thin poles down to the ground
 * so it reads at a distance. The next gate is the signal colour, later gates are a
 * quiet ivory, passed gates are hidden. One shared box geometry and three materials,
 * fogged with the world haze and depth-tested. update() only restyles on a change.
 */
export function createCourseGates(scene, course, heightAt, signal) {
  const group = new THREE.Group(); group.name = 'course-gates'; group.visible = false;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = {
    next: new THREE.MeshBasicMaterial({ color: signal }),
    ahead: new THREE.MeshBasicMaterial({ color: 'hsl(60, 9%, 96%)', transparent: true, opacity: 0.5, depthWrite: false }),
    pole: new THREE.MeshBasicMaterial({ color: 'hsl(210, 8%, 20%)', transparent: true, opacity: 0.6, depthWrite: false }),
  };
  const bar = 3.5, frames = course.gates.map(g => {
    const frame = new THREE.Group(); frame.position.set(g.x, g.y, g.z); frame.rotation.y = -g.heading;
    const w = g.width, h = g.height, parts = [
      [bar, h + bar, bar, -w / 2, 0], [bar, h + bar, bar, w / 2, 0],
      [w + bar, bar, bar, 0, h / 2], [w + bar, bar, bar, 0, -h / 2],
    ].map(([sx, sy, sz, x, y]) => { const m = new THREE.Mesh(geometry, materials.ahead); m.scale.set(sx, sy, sz); m.position.set(x, y, 0); frame.add(m); return m; });
    for (const side of [-1, 1]) {
      const px = g.x + Math.cos(g.heading) * side * w / 2, pz = g.z + Math.sin(g.heading) * side * w / 2;
      const length = Math.max(0, g.y - h / 2 - Math.max(10, heightAt(px, pz)));
      if (length < 1) continue;
      const pole = new THREE.Mesh(geometry, materials.pole); pole.scale.set(1.2, length, 1.2); pole.position.set(side * w / 2, -h / 2 - length / 2, 0); frame.add(pole);
    }
    group.add(frame); return { frame, parts };
  });
  scene.add(group);
  let shown = null;
  return { group, frames,
    /** Show the course while it runs or shows its result; `next` is the gate the pilot must fly next. */
    update(visible, next) {
      group.visible = visible;
      if (!visible || shown === next) return;
      shown = next;
      frames.forEach(({ frame, parts }, i) => {
        frame.visible = i >= next;
        for (const m of parts) m.material = i === next ? materials.next : materials.ahead;
      });
    },
    dispose() { scene.remove(group); geometry.dispose(); Object.values(materials).forEach(m => m.dispose()); } };
}

import * as THREE from 'three';

/** Fit the visible silhouette (or bounds), including long wings in a narrow phone preview. */
export function framePaintPreview(camera, bounds, aspect, angle = -.65, model = null) {
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(Math.sin(angle), .55, -Math.cos(angle)).normalize();
  camera.aspect = aspect;
  camera.position.copy(center).add(direction); camera.lookAt(center);
  const inverse = camera.quaternion.clone().invert(), tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = 1;
  const include = p => {
    distance = Math.max(distance, p.z + 1.18 * Math.max(Math.abs(p.x) / (tan * aspect), Math.abs(p.y) / tan));
  };
  if (model) {
    // Fit the actual silhouette: a wingtip and a tall tail never occupy the same box corner.
    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(inverse).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    const transform = new THREE.Matrix4(), p = new THREE.Vector3();
    model.traverseVisible(object => {
      const positions = object.isMesh && object.geometry?.attributes.position;
      if (!positions) return;
      transform.multiplyMatrices(rotation, object.matrixWorld);
      for (let i = 0; i < positions.count; i++) include(p.fromBufferAttribute(positions, i).applyMatrix4(transform));
    });
  } else {
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) include(new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse));
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.far = distance + bounds.getSize(new THREE.Vector3()).length() * 2;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}

/** One shared renderer, one reusable target, no RAF, model/material creation or flight-camera changes.
 * Only the Object3D hierarchy is cloned; its geometry, materials and environment remain model-owned.
 */
export function createAircraftThemePreview(renderer) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(37, 1, .1, 1000);
  const sun = new THREE.DirectionalLight('hsl(48, 30%, 93%)', 3.1); sun.position.set(-5, 8, -6);
  scene.add(new THREE.HemisphereLight('hsl(200, 35%, 89%)', 'hsl(210, 8%, 27%)', 2), sun);
  const bounds = new THREE.Box3(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  let model = null, copy = null, target = null, canvas = null, context = null, pixels, image, width = 0, height = 0, dirty = true, angle = -.65;
  function releaseModel() { if (copy) scene.remove(copy); copy = null; model = null; }
  return {
    mount(element, aircraft) {
      canvas = element; context = canvas.getContext('2d'); width = height = 0; dirty = true;
      // A semantic CSS token supplies the preview background as well as the surrounding stage.
      scene.background = new THREE.Color(getComputedStyle(canvas).backgroundColor);
      if (model !== aircraft) {
        releaseModel(); model = aircraft; copy = aircraft.group.clone(true);
        copy.position.set(0, 0, 0); copy.quaternion.identity(); copy.visible = true;
        scene.add(copy); bounds.setFromObject(copy); angle = -.65;
      }
    },
    unmount() { canvas = context = null; releaseModel(); },
    invalidate() { dirty = true; },
    turn(delta) { angle += delta; dirty = true; },
    render() {
      if (!canvas?.isConnected || !context || !copy) return;
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(rect.width * ratio)), h = Math.max(1, Math.round(rect.height * ratio));
      if (w !== width || h !== height) {
        width = canvas.width = w; height = canvas.height = h;
        target ??= new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, samples: 4 });
        target.texture.colorSpace = THREE.SRGBColorSpace; target.setSize(w, h);
        pixels = new Uint8Array(w * h * 4); image = context.createImageData(w, h); dirty = true;
      }
      if (!dirty) return;
      framePaintPreview(camera, bounds, w / h, angle, copy);
      const previous = renderer.getRenderTarget(), shadows = renderer.shadowMap.enabled, test = renderer.getScissorTest();
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      try {
        renderer.shadowMap.enabled = false; renderer.setRenderTarget(target); renderer.setScissorTest(false);
        renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
        // WebGL reads bottom-up; the accessible 2D canvas uses top-down rows.
        for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4);
        context.putImageData(image, 0, 0); dirty = false;
      } finally {
        renderer.setRenderTarget(previous); renderer.setViewport(viewport); renderer.setScissor(scissor);
        renderer.setScissorTest(test); renderer.shadowMap.enabled = shadows;
      }
    },
  };
}

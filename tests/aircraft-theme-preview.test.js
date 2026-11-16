import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAircraft } from '../src/aircraft.js';
import { FLEET } from '../src/fleet.js';
import { createAircraftThemePreview, framePaintPreview } from '../src/aircraft-theme-preview.js';

test('all aircraft fit the preview on desktop and phone, through a full rotation', () => {
  for (const id of Object.keys(FLEET)) {
    const model = createAircraft(id), box = new THREE.Box3().setFromObject(model.group);
    try {
      const camera = new THREE.PerspectiveCamera(37, 1, .1, 1000);
      for (const aspect of [640 / 600, 640 / 503, 364 / 170]) for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 3) {
        framePaintPreview(camera, box, aspect, angle, model.group);
        const p = new THREE.Vector3(); let maxX = 0, maxY = 0, maxDepth = 0;
        model.group.traverseVisible(object => {
          const positions = object.isMesh && object.geometry?.attributes.position;
          if (!positions) return;
          for (let i = 0; i < positions.count; i++) {
            p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(camera);
            maxX = Math.max(maxX, Math.abs(p.x)); maxY = Math.max(maxY, Math.abs(p.y)); maxDepth = Math.max(maxDepth, Math.abs(p.z));
          }
        });
        assert.ok(maxX <= .85 && maxY <= .85 && maxDepth < 1, `${id} at ${aspect}, ${angle}: ${maxX}, ${maxY}, ${maxDepth}`);
      }
    } finally { model.dispose(); }
  }
});

test('preview shares model resources, restores renderer state, and does no work until invalidated', () => {
  const model = createAircraft('jet'), world = new THREE.Scene(); world.add(model.group);
  model.group.position.set(900, 1400, -2000); model.group.rotation.set(.1, .7, .2); model.group.visible = false;
  const initial = { position: model.group.position.toArray(), quaternion: model.group.quaternion.toArray() };
  const originalStyle = globalThis.getComputedStyle, originalRatio = globalThis.devicePixelRatio;
  globalThis.getComputedStyle = () => ({ backgroundColor: 'rgb(40, 43, 47)' }); globalThis.devicePixelRatio = 1;
  const rendered = [], originalTarget = {}, viewport = new THREE.Vector4(1, 2, 800, 600), scissor = new THREE.Vector4(3, 4, 500, 400);
  let currentTarget = originalTarget, currentViewport = viewport.clone(), currentScissor = scissor.clone(), scissorTest = true, fail = false;
  const renderer = {
    shadowMap: { enabled: true },
    getRenderTarget: () => currentTarget, setRenderTarget: value => { currentTarget = value; },
    getViewport: v => v.copy(currentViewport), setViewport: v => { currentViewport = v.clone(); },
    getScissor: v => v.copy(currentScissor), setScissor: v => { currentScissor = v.clone(); },
    getScissorTest: () => scissorTest, setScissorTest: value => { scissorTest = value; },
    render(scene) { rendered.push({ target: currentTarget, copy: scene.children.find(o => o.name === model.group.name) }); if (fail) throw new Error('lost context'); },
    readRenderTargetPixels: (_t, _x, _y, _w, _h, buffer) => buffer.fill(255),
  };
  const canvas = () => ({ isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 80 }), getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  try {
    const preview = createAircraftThemePreview(renderer), first = canvas(); preview.mount(first, model); preview.render();
    const copy = rendered[0].copy;
    assert.notEqual(copy, model.group); assert.deepEqual(copy.position.toArray(), [0, 0, 0]); assert.equal(copy.visible, true);
    const originals = [], clones = []; model.group.traverse(o => originals.push(o)); copy.traverse(o => clones.push(o));
    assert.equal(clones.length, originals.length);
    originals.forEach((o, i) => { assert.equal(clones[i].geometry, o.geometry); assert.equal(clones[i].material, o.material); });
    preview.render(); assert.equal(rendered.length, 1, 'paused RAFs never repeat readback/render work');
    model.paint.apply('glacier'); preview.invalidate(); preview.render();
    assert.equal(rendered[1].copy, copy); assert.equal(rendered[1].target, rendered[0].target);
    preview.unmount(); preview.render(); assert.equal(rendered.length, 2);
    const second = canvas(); preview.mount(second, model); preview.render();
    assert.equal(second.width, 100); assert.equal(second.height, 80); assert.equal(rendered[2].target, rendered[0].target, 'reopening reuses the one render target');
    fail = true; preview.turn(.5); assert.throws(() => preview.render(), /lost context/);
    assert.equal(currentTarget, originalTarget); assert.deepEqual(currentViewport, viewport); assert.deepEqual(currentScissor, scissor); assert.equal(scissorTest, true); assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(model.group.parent, world); assert.deepEqual(model.group.position.toArray(), initial.position); assert.deepEqual(model.group.quaternion.toArray(), initial.quaternion); assert.equal(model.group.visible, false);
    preview.unmount();
  } finally { model.dispose(); globalThis.getComputedStyle = originalStyle; globalThis.devicePixelRatio = originalRatio; }
});

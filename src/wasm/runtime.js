// The checked-in optimized module is a Vite asset; browsers need no compiler,
// generated JS runtime, cross-origin isolation or third-party runtime package.
let kernel = null, initializing = null, heightAt = null;
export const numerics = () => kernel;
export const nativeSurface = Symbol('native terrain with water');
export const nativeTerrain = Symbol('native terrain');
export const GRID_CAPACITY = 16384;

export async function initNumerics(bytes) {
  if (kernel) return kernel;
  if (initializing) return initializing;
  initializing = (async () => {
    const imports = { env: { height_at: (x, z) => heightAt(x, z) } };
    let result;
    if (bytes) result = await WebAssembly.instantiate(bytes, imports);
    else {
      const response = await fetch(new URL('./engine.wasm', import.meta.url));
      if (!response.ok) throw new Error(`WebAssembly request failed (${response.status})`);
      // A streaming MIME failure must still work on ordinary static hosts.
      try { result = await WebAssembly.instantiateStreaming(response.clone(), imports); }
      catch { result = await WebAssembly.instantiate(await response.arrayBuffer(), imports); }
    }
    const exports = result.instance.exports;
    exports._initialize?.();
    if (exports.abi_version() !== 1) throw new Error('Unsupported flight engine ABI');
    kernel = exports;
    return kernel;
  })();
  try { return await initializing; }
  finally { initializing = null; }
}

export function runFlight(sample, dt, nativeHeight) {
  const previous = heightAt;
  heightAt = sample;
  try { kernel.flight_update(dt, nativeHeight); }
  finally { heightAt = previous; }
}

// Fill an owned result buffer from batches; views into WASM memory never escape.
export function sampleNativeGrid(target, x, z, dx, dz, width, height, water = false, indexX = 0, indexZ = 0, stride = 1) {
  const k = kernel;
  if (!k) return false;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > GRID_CAPACITY || target.length < width * height) throw new RangeError('Invalid height grid');
  const rows = Math.floor(GRID_CAPACITY / width), scratch = new Float64Array(k.memory.buffer, k.height_buffer(), GRID_CAPACITY);
  for (let row = 0; row < height; row += rows) {
    const count = Math.min(rows, height - row);
    k.height_grid(x, z, dx, dz, width, count, Number(water), indexX, indexZ + row * stride, stride);
    target.set(scratch.subarray(0, width * count), row * width);
  }
  return true;
}

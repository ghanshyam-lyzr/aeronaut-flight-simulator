# C++ WebAssembly engine

The browser initializes `src/wasm/engine.wasm` before building the world. C++ integrates all fixed-wing and helicopter flight models, body-axis aerobatics, autopilot, trim, brakes, stall/load measurements, deterministic wind and touchdown/collision handling. Procedural terrain heights also run in the module. Three.js still renders the scene on WebGL; browser input, instruments, activities and audio keep their existing APIs and behavior.

No npm dependencies were added. The 78,810-byte optimized module is committed as a Vite asset, fingerprinted in production builds. A normal `npm ci`, `npm test` and `npm run build` needs only Node. The app is still a static site. It does not require WASI, a server runtime, threads, cross-origin isolation or a database.

## Rebuild

Install the official [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html), then:

```sh
emsdk install 3.1.64
emsdk activate 3.1.64
source /path/to/emsdk/emsdk_env.sh
npm run build:wasm
npm test
npm run test:wasm
npm run build
```

`EMXX=/path/to/em++ npm run build:wasm` also works. The checked-in binary was built with Emscripten 3.1.64, `-O3`, link-time optimization, no exceptions or RTTI and no fast-math. Rebuilding the same source under another compiler version can produce different binary bytes; commit the binary and its generated manifest together. [Emscripten optimization guidance](https://emscripten.org/docs/optimizing/Optimizing-Code.html).

The build script generates C++ ABI structs and direct JavaScript memory bindings from `src/wasm/schema.js`. C++ terrain is generated from the existing lake shader's arithmetic and region/airport data, with the CPU reference's bounds checks restored. There is no separately maintained copy of world coordinates. `npm run check:wasm` verifies the source fingerprint, binary checksum and generated bindings without requiring a compiler. CI runs both backends and the production build. Changes to native code, the ABI, terrain/world data or the generator require a rebuild; a stale module fails the build.

## Performance design

- One native call per controller update, including up to ten collision-aware physics substeps. No callbacks to JavaScript for normal world terrain or wind sampling.
- Direct generated property access transfers state through reusable typed arrays. Three.js vectors/quaternions and state object identities are preserved, so existing UI, missions, cameras and warnings read the same objects.
- Terrain tiles sample eight rows per call and retain the existing yield points. Map tiles sample their height grid in a batch. A 16,384-sample scratch buffer supports larger requests in chunks; callers receive their own arrays. Tile samples use global integer grid indices so shared edges and normals stay identical.
- Fixed 2 MiB memory, a 64 KiB stack and no native heap allocation or memory growth. Grid dimensions are bounded before native writes.
- IEEE double precision and no unsafe floating-point reassociation. JavaScript and C++ math libraries can differ in their final bits; tested cross-engine heights agree within 1e-7 m, with central-valley preservation checked at 1e-9 m.

The JavaScript numerical code remains the behavioral reference and fallback. If loading or compiling WebAssembly fails, the app logs a warning and starts with JavaScript. Streaming instantiation falls back to byte instantiation when a static host sends the wrong MIME type. A custom terrain callback still works through one imported height function; normal scenery avoids that boundary. `window.aeronaut.getEngine()` reports the active backend.

For scripts outside the app, call `await initNumerics(bytes)` from `src/wasm/runtime.js` before constructing controllers; Node supplies bytes with `readFile`. Controllers default to WebAssembly once initialized. `{ engine: 'javascript' }` as the third constructor argument explicitly uses the reference integrator for comparisons.

## Measurements and verification

`npm run benchmark:wasm` measures median CPU time over seven warmed trials, including JavaScript state transfer, exported calls and output copies. The reference uses JavaScript terrain throughout; the native case uses native terrain. The committed [raw measurements](measurements/webassembly.json) were recorded on this Alpha VM with Node v22.23.4:

- A 107 × 107 terrain height grid: 11.31 ms JavaScript, 6.55 ms WebAssembly (1.73×).
- A 32 × 32 shaded map tile: 1.53 ms versus 0.99 ms (1.55×).
- Trainer/fighter/tandem single-step updates: 1.30–1.45×; ten-substep updates: 2.76–3.22×.

These are CPU workload measurements, not overall FPS improvements or guaranteed speedups on another browser/device. Rendering and GPU cost are unchanged and may dominate frame rate. The benchmark does not impose flaky timing thresholds on CI.

The existing suite runs with both backends. Additional parity scenarios cover every aircraft, variable time steps, wind transitions, heading hold, gear/flaps/trim, runway brakes, resets, arbitrary terrain callbacks, collision telemetry, multi-controller isolation, region/airport/route height samples, exact map pixels, multi-buffer grids and identical adjacent mesh edges/normals.

`scripts/check-wasm.browser.js` runs through the browser MCP against port 5173. It verifies native engine selection, keyboard flight in a trainer, fighter and tandem helicopter, rendered canvases at 1600×900, 1280×800 and 390×844, and continued flight after deliberately blocking the WASM asset. Screenshots go to `/tmp/forge-browser/`.

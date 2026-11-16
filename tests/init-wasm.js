import { readFile } from 'node:fs/promises';
import { initNumerics } from '../src/wasm/runtime.js';
await initNumerics(await readFile(new URL('../src/wasm/engine.wasm', import.meta.url)));

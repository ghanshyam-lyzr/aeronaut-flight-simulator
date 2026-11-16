// Includes state transfer and JS->WASM calls; timings are not GPU/frame-rate claims.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { initNumerics } from '../src/wasm/runtime.js';
import { FlightController } from '../src/flight.js';
import { groundHeight, referenceHeight, heightGrid, surfaceHeight } from '../src/terrain.js';
import { rasterTile } from '../src/navigation.js';
await initNumerics(await readFile(new URL('../src/wasm/engine.wasm',import.meta.url)));
let checksum=0;
function measure(fn, iterations) {
  for(let i=0;i<Math.min(iterations,2000);i++) fn(i);
  const samples=[];
  for(let trial=0;trial<7;trial++) { const start=performance.now(); for(let i=0;i<iterations;i++) fn(i); samples.push((performance.now()-start)/iterations); }
  return samples.sort((a,b)=>a-b)[3];
}
function report(name,js,wasm) { return {workload:name,javascriptMs:+js.toFixed(6),webassemblyMs:+wasm.toFixed(6),speedup:+(js/wasm).toFixed(2)}; }
const results=[];
const width=107, heights=new Float64Array(width*width);
results.push(report('terrain tile (107×107 heights)',
  measure(i=>{heightGrid(heights,-60000+(i%8)*14000,-55000+(i%7)*15000,84.615,84.615,width,width,referenceHeight);checksum+=heights[0];},30),
  measure(i=>{heightGrid(heights,-60000+(i%8)*14000,-55000+(i%7)*15000,84.615,84.615,width,width);checksum+=heights[0];},30)));
results.push(report('map tile (32×32 shaded pixels)',
  measure(i=>{checksum+=rasterTile({minX:-60000+(i%8)*14000,minZ:-55000+(i%7)*15000,size:8800},(x,z)=>Math.max(10,referenceHeight(x,z)))[0];},100),
  measure(i=>{checksum+=rasterTile({minX:-60000+(i%8)*14000,minZ:-55000+(i%7)*15000,size:8800},surfaceHeight)[0];},100)));
for(const id of ['trainer','fighter','tandem']) for(const dt of [1/60,0.25]) {
  const run=engine=>{
    const sample=engine==='javascript' ? (x,z)=>Math.max(10,referenceHeight(x,z)) : surfaceHeight;
    const f=new FlightController(sample,id,{engine});f.state.position.y=100000;f.toggleAutopilot();f.setWind('gusts',{immediate:true});
    return measure(()=>{f.update(dt);checksum+=f.state.speed;},10000);
  };
  results.push(report(`${id} frame (${dt===0.25?'10 substeps':'1 substep'})`,run('javascript'),run('auto')));
}
console.log(JSON.stringify({node:process.version,binaryBytes:(await readFile(new URL('../src/wasm/engine.wasm',import.meta.url))).length,results,checksum},null,2));

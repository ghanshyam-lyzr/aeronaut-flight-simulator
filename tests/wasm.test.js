import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initNumerics, numerics, sampleNativeGrid, GRID_CAPACITY } from '../src/wasm/runtime.js';
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { groundHeight, referenceHeight, heightGrid, surfaceHeight } from '../src/terrain.js';
import { tileGeometry, SEGMENTS } from '../src/world.js';
import { rasterTile } from '../src/navigation.js';
import { AIRPORTS } from '../src/airports.js';
import { LANDMARKS, ROUTES, WORLD } from '../src/regions.js';

await initNumerics(await readFile(new URL('../src/wasm/engine.wasm', import.meta.url)));
const close = (a, b, tolerance = 1e-7, label = '') => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
function compare(a, b, label) {
  for (const key of ['speed', 'airspeed', 'heading', 'pitch', 'bank', 'verticalSpeed', 'gForce', 'pitchTrim', 'spool', 'rotorSpeed', 'distance', 'flightTime']) close(a.state[key], b.state[key], 1e-7, `${label} ${key}`);
  for (const key of ['position', 'quaternion', 'velocity', 'windVelocity']) for (const axis of (key === 'quaternion' ? ['x','y','z','w'] : ['x','y','z'])) close(a.state[key][axis], b.state[key][axis], 1e-7, `${label} ${key}.${axis}`);
  for (const key of ['crashed', 'stalled', 'grounded', 'autopilot', 'headingHold', 'gearDown', 'afterburner', 'crashReason']) assert.equal(a.state[key], b.state[key], `${label} ${key}`);
  close(a.wind.time, b.wind.time, 1e-12, `${label} wind clock`);
  if (a.state.touchdown || b.state.touchdown) {
    assert.ok(a.state.touchdown && b.state.touchdown, `${label} touchdown`);
    for (const key of ['speed', 'sink', 'time', 'heading', 'bank', 'pitch']) close(a.state.touchdown[key], b.state.touchdown[key], 1e-7, `${label} touchdown ${key}`);
  }
}

test('C++ engine loads with fixed memory and no runtime dependencies', () => {
  const k = numerics();
  assert.equal(k.abi_version(), 1);
  assert.equal(k.memory.buffer.byteLength, 2097152);
  assert.equal(new FlightController().backend, 'webassembly');
});

test('C++ terrain agrees with the reference across every region, airport, landmark and route', () => {
  let worst = 0;
  const check = (x, z) => { const d = Math.abs(groundHeight(x,z) - referenceHeight(x,z)); worst = Math.max(worst, d); assert.ok(d < 1e-7, `terrain ${x},${z}: ${d}`); };
  for (let z = WORLD.minZ; z <= WORLD.maxZ; z += 1277) for (let x = WORLD.minX; x <= WORLD.maxX; x += 1291) check(x,z);
  for (const p of [...LANDMARKS, ...AIRPORTS]) check(p.x,p.z);
  for (const route of ROUTES) for (const [x,z] of route.points) check(x,z);
  assert.ok(worst < 1e-7);
});

test('batched raw and water grids span multiple scratch buffers without exposing shared memory', () => {
  for (const sample of [groundHeight, surfaceHeight]) {
    const width = 127, height = 137, result = heightGrid(new Float64Array(width * height), -65000, -62000, 983, 917, width, height, sample);
    assert.ok(result.length > GRID_CAPACITY);
    for (let j=0;j<height;j++) for (let i=0;i<width;i++) close(result[j*width+i], sample(-65000+i*983,-62000+j*917), 1e-7);
    const first = result[0]; groundHeight(0,0); heightGrid(new Float64Array(4),0,0,1,1,2,2); assert.equal(result[0],first);
  }
  assert.throws(() => sampleNativeGrid(new Float64Array(2),0,0,1,1,3,1), RangeError);
  let calls=0; const custom=heightGrid(new Float64Array(6),1,2,3,4,2,3,(x,z)=>{calls++;return x+z;});
  assert.deepEqual([...custom],[3,6,7,10,11,14]); assert.equal(calls,6);
});

test('map raster pixels stay identical with batched native heights', () => {
  for (const [minX,minZ,size] of [[-4000,-4000,8000],[17000,-10000,6000],[-62000,-14000,16000],[40000,-12000,12000],[0,45000,20000]]) {
    assert.deepEqual(rasterTile({minX,minZ,size},surfaceHeight),rasterTile({minX,minZ,size},(x,z)=>Math.max(10,referenceHeight(x,z))));
  }
});

for (const id of Object.keys(FLEET)) {
  test(`${id}: C++ and JavaScript retain the same handling, gusts, assist and reset`, () => {
    const a=new FlightController(()=>78,id), b=new FlightController(()=>78,id,{engine:'javascript'});
    const both=fn=>{fn(a);fn(b);};
    both(f=>{f.state.position.y=5000;f.setWind('gusts',{immediate:true});});
    for (let i=0;i<900;i++) {
      if(i===210) both(f=>f.toggleAutopilot());
      if(i===340) both(f=>f.setWind('breeze'));
      if(i===410) both(f=>{f.setHeadingTarget(287);f.holdSelectedHeading();});
      if(i===520) both(f=>{f.cycleFlaps();f.toggleGear();});
      const controls=i<180 ? {pitch:0.14,roll:0.25,yaw:-0.1,throttle:0.1,trim:0.3} : i>620 ? {pitch:-0.15,roll:-0.25,yaw:0.2,trim:-0.2} : {};
      const dt=[1/60,1/120,0.06,0.001][i%4]; a.update(dt,controls); b.update(dt,controls);
      compare(a,b,`${id} frame ${i}`);
    }
    both(f=>f.reset()); compare(a,b,`${id} reset`);
    both(f=>f.runwayStart(900,78+(f.type.flight.groundClearance??f.type.groundClearance??2.8),-1800));
    for(let i=0;i<200;i++) { a.update(1/30,{throttle:1,brake:1}); b.update(1/30,{throttle:1,brake:1}); }
    compare(a,b,`${id} braked runway`);
    for(const dt of [0,-1,NaN,Infinity]) { a.update(dt); b.update(dt); compare(a,b,`${id} invalid dt`); }
  });
}

test('native terrain collision, touchdown telemetry and per-controller state stay independent', () => {
  for (const id of ['trainer','fighter','helicopter','tandem']) for (const water of [false,true]) {
    const height = water ? (()=>10) : surfaceHeight;
    const a=new FlightController(height,id), b=new FlightController(height,id,{engine:'javascript'});
    for(const f of [a,b]) {
      f.state.position.set(900,water?10.1:78.1,-1800);
      Object.assign(f.state,{gearDown:true,speed:f.type.flight.rotorcraft?0:25,verticalSpeed:-1,pitch:0,bank:0});
      f.state.velocity.set(0,-1,0); f.setQuaternion();
    }
    a.update(0.25);b.update(0.25);compare(a,b,`${id} contact water=${water}`);
    a.reset();a.setAircraft('jet'); a.update(0.1); b.update(0.1);
    assert.equal(a.state.aircraft,'jet'); assert.equal(b.state.aircraft,id);
  }
});


test('native terrain tiles share exactly the same edge vertices and normals', () => {
  const left=tileGeometry(13,7,1), right=tileGeometry(14,7,1), row=SEGMENTS+1;
  for (const attribute of ['position','normal']) {
    const a=left.getAttribute(attribute), b=right.getAttribute(attribute);
    for(let j=0;j<row;j++) for(const read of ['getX','getY','getZ']) assert.equal(a[read](j*row+SEGMENTS),b[read](j*row),`${attribute} edge row ${j}`);
  }
  left.dispose();right.dispose();
});

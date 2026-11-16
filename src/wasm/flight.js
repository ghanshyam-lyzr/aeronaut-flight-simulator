import { STATE, PARAMS, CONTROLS, WIND, IMPACT } from './schema.js';
import { numerics, nativeSurface, runFlight } from './runtime.js';
import { packState, unpackState, packParams } from './bindings.js';

const reasons = ['', 'Hard landing', 'Terrain collision', 'Water collision'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

function bridge(k) {
  const view = (name, fields) => new Float64Array(k.memory.buffer, k[name](), fields.length);
  return {
    state: view('flight_state', STATE), params: view('flight_params', PARAMS), controls: view('flight_controls', CONTROLS),
    wind: view('flight_wind', WIND), impact: view('flight_impact', IMPACT),
  };
}

let buffers;
export function updateWasmFlight(flight, dt, inputs, brakeDeceleration) {
  const k = numerics(), b = buffers ??= bridge(k);
  packState(flight, b.state);
  packParams(flight, b.params, brakeDeceleration(flight.type));
  b.controls[0] = clamp(inputs.pitch, -1, 1); b.controls[1] = clamp(inputs.roll, -1, 1);
  b.controls[2] = clamp(inputs.yaw, -1, 1); b.controls[3] = clamp(inputs.throttle, -1, 1);
  b.controls[4] = clamp(inputs.brake, 0, 1); b.controls[5] = clamp(inputs.trim, -1, 1);
  const wind = flight.wind, config = wind.config, from = wind.from;
  b.wind[0]=wind.time; b.wind[1]=config.direction; b.wind[2]=config.speed; b.wind[3]=config.gust;
  b.wind[4]=config.veer; b.wind[5]=config.seed; b.wind[6]=Number(!!from);
  b.wind[7]=from?.x??0; b.wind[8]=from?.z??0; b.wind[9]=from?.start??0;
  runFlight(flight.heightAt, dt, Number(!!flight.heightAt[nativeSurface]));
  unpackState(flight, b.state);
  wind.time = b.wind[0];
  if (!b.wind[6]) wind.from = null;
  const s = flight.state, t = b.impact;
  if (t[0]) {
    s.touchdown = { position: { x: t[2], y: t[3], z: t[4] }, speed: t[5], sink: t[6], heading: t[7],
      bank: t[8], pitch: t[9], gearDown: !!t[10], flaps: t[11], stalled: !!t[12], time: t[13] };
    s.crashReason = reasons[t[1]];
  }
  return s;
}

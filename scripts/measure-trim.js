// Corrective pitch inputs needed to hold a steady attitude, without and with pitch trim, through the real input pipeline.
import { FlightController, TRIM_LIMIT, hasPitchTrim } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';

const DEG = Math.PI / 180;
const RATE = 60;                  // input/physics frames per second
const BAND = 0.5 * DEG;           // the pilot corrects once the nose is more than half a degree off
const SETTLE = 0.4;               // after letting go, a moment to see what the press did

/**
 * Starting at that attitude, a feedback pilot holds `pitch` (radians) for `seconds` at a fixed power setting with key taps.
 * With `trim`, it first holds the trim
 * key until the trim reads that attitude (one adjustment), then flies hands-off unless the nose leaves the band.
 * Each corrective input is one press of the pitch key, held until the nose is back at the attitude.
 * Returns the corrective pitch presses, trim adjustments and how the attitude and climb rate held over the last 30 s.
 */
export function holdAttitude(id, { pitch, trim = false, seconds = 90, spool = FLEET[id].flight.cruiseThrottle } = {}) {
  const flight = new FlightController(() => 0, id), s = flight.state, input = new FlightInputs(0);
  s.position.y = 2400;
  // Both runs start established at the attitude (the stick already put the nose there) and settled in speed.
  Object.assign(s, { throttle: spool, spool, autopilot: false, pitch });
  let t = 0, taps = 0, trims = 0, busyUntil = 0, trimming = false, worst = 0;
  const vs = [];
  const step = () => { t += 1 / RATE; input.advance(t, (dt, c) => flight.update(dt, c)); };
  if (trim && hasPitchTrim(flight.type)) {
    const target = Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, pitch));
    trims = 1; trimming = true;
    input.set({ trim: Math.sign(target) }, t);
    while (trimming && t < seconds) {
      step();
      if (Math.abs(s.pitchTrim - target) < 0.05 * DEG || Math.abs(s.pitchTrim) >= TRIM_LIMIT) { input.set({}, t); trimming = false; }
    }
  }
  let pressed = 0;
  while (t < seconds && !s.crashed) {
    const error = pitch - s.pitch;
    if (pressed && Math.sign(error) !== pressed) {
      // Let go as the nose reaches the attitude; the pitch rate then stops on its own.
      input.set({}, t); pressed = 0; busyUntil = t + SETTLE;
    } else if (!pressed && t >= busyUntil && Math.abs(error) > BAND) {
      // One corrective input: a key held (full deflection) until the nose is back.
      taps++; pressed = Math.sign(error);
      input.set({ pitch: pressed }, t);
    }
    step();
    if (t > seconds - 30) { worst = Math.max(worst, Math.abs(pitch - s.pitch)); vs.push(s.verticalSpeed); }
  }
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  return { taps, trims, inputs: taps + trims, worst: worst / DEG, verticalSpeed: mean, trim: s.pitchTrim / DEG, crashed: s.crashed };
}

export const SCENARIOS = [
  { name: 'Climb +5°', pitch: 5 * DEG },
  { name: 'Descent −3°', pitch: -3 * DEG, spool: 0.4 },
  { name: 'Cruise +2° (reduced power)', pitch: 2 * DEG, spool: 0.3 },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const fpm = v => Math.round(v * 196.85);
  console.log('| Aircraft | Scenario | Untrimmed inputs | Trimmed inputs | Worst error untrimmed → trimmed | Mean VS fpm untrimmed → trimmed |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const id of ['trainer', 'jet', 'airliner', 'cargo', 'motorglider']) for (const sc of SCENARIOS) {
    const options = { pitch: sc.pitch, spool: sc.spool ?? FLEET[id].flight.cruiseThrottle };
    const free = holdAttitude(id, options), held = holdAttitude(id, { ...options, trim: true });
    console.log(`| ${FLEET[id].name} | ${sc.name} | ${free.inputs} | ${held.inputs} (${held.trims} trim + ${held.taps} pitch) | ${free.worst.toFixed(2)}° → ${held.worst.toFixed(2)}° | ${fpm(free.verticalSpeed)} → ${fpm(held.verticalSpeed)} |`);
  }
  // Free-attitude types have no trim: they already hold any attitude hands-off.
  for (const id of Object.keys(FLEET).filter(id => !FLEET[id].flight.rotorcraft && !hasPitchTrim(FLEET[id]))) for (const sc of SCENARIOS) {
    const free = holdAttitude(id, { pitch: sc.pitch, spool: sc.spool ?? FLEET[id].flight.cruiseThrottle });
    console.log(`| ${FLEET[id].name} (no trim) | ${sc.name} | ${free.inputs} | — | ${free.worst.toFixed(2)}° | ${fpm(free.verticalSpeed)} |`);
  }
}

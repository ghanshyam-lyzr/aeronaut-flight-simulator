// Calm versus wind with ordinary controls, through the real input pipeline (FlightInputs at 60 fps).
// Run: node scripts/measure-wind.js — deterministic; the numbers in docs/wind-model.md come from it.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { groundTrack } from '../src/flight-path.js';
import { KNOT } from '../src/wind.js';

const RATE = 60, flat = () => 40, kt = v => (v / KNOT).toFixed(1), deg = r => (((r * 180 / Math.PI) % 360) + 360) % 360;

/**
 * The Mira T2 trainer at cruise, flown by key presses: 30 s hands-off north, a held right bank (D) for 6 s,
 * 30 s hands-off, then ½ s taps of W/S every 10 s. Returns where it went and what the instruments showed.
 */
function trainerFlight(wind, rate = RATE) {
  const f = new FlightController(flat, 'trainer'), s = f.state, input = new FlightInputs(0);
  f.setWind(wind, { immediate: true });
  const start = s.position.clone();
  const script = [[0, {}], [30, { roll: 1 }], [36, {}], [66, { pitch: -1 }], [66.5, {}], [76, { pitch: 1 }], [76.5, {}], [86, {}]];
  for (const [t, c] of script) input.set(c, t);
  let t = 0, minSpeed = Infinity, maxSpeed = -Infinity, minG = Infinity, maxG = -Infinity;
  while (t < 90 - 1e-9) {
    t += 1 / rate; input.advance(t, (dt, c) => f.update(dt, c));
    if (t > 2) { minSpeed = Math.min(minSpeed, s.speed); maxSpeed = Math.max(maxSpeed, s.speed); minG = Math.min(minG, s.gForce); maxG = Math.max(maxG, s.gForce); }
  }
  const g = groundTrack(s, f.type);
  return { east: s.position.x - start.x, north: start.z - s.position.z, distance: s.distance, heading: deg(s.heading), track: deg(g.track),
    airspeed: s.speed, groundSpeed: g.speed, minSpeed, maxSpeed, minG, maxG, position: s.position.clone() };
}

/** Takeoff roll (m) of the trainer at full power with the stick held back, in a steady wind. */
function takeoffRoll(wind) {
  const f = new FlightController(flat, 'trainer'), s = f.runwayStart(0, 42.8, 0, 0);
  f.setWind(wind, { immediate: true }); s.throttle = 1;
  let t = 0; while (s.grounded && t < 90) { f.update(1 / 120, { pitch: 1 }); t += 1 / 120; }
  return { roll: -s.position.z, sideways: s.position.x, liftoffAirspeed: s.speed };
}

/** The Laret H4 for 60 s: with hover hold, then hands-off with the disc self-levelling. */
function hover(wind, hold) {
  const f = new FlightController(() => 78, 'helicopter'), s = f.state, start = s.position.clone();
  f.setWind(wind, { immediate: true }); if (hold) f.toggleAutopilot();
  for (let i = 0; i < 60 * 120; i++) f.update(1 / 120);
  return { offset: Math.hypot(s.position.x - start.x, s.position.z - start.z), groundSpeed: Math.hypot(s.velocity.x, s.velocity.z), airspeed: s.speed };
}

const winds = { calm: 'calm', breeze: 'breeze', gusts: 'gusts', 'westerly 10 m/s': { direction: 270 * Math.PI / 180, speed: 10 }, 'northerly 10 m/s': { direction: 0, speed: 10 } };
const rows = Object.entries(winds).map(([name, w]) => ({ name, ...trainerFlight(w) }));
console.log('Mira T2, 90 s of key presses (D held 6 s at 30 s, W/S taps at 66 and 76 s), 60 fps');
console.table(rows.map(r => ({ wind: r.name, 'east m': r.east.toFixed(0), 'north m': r.north.toFixed(0), 'flown NM': (r.distance / 1852).toFixed(2),
  'heading °': r.heading.toFixed(1), 'track °': r.track.toFixed(1), 'airspeed kt': kt(r.airspeed), 'ground kt': kt(r.groundSpeed),
  'airspeed range kt': `${kt(r.minSpeed)}–${kt(r.maxSpeed)}`, 'g range': `${r.minG.toFixed(2)}–${r.maxG.toFixed(2)}` })));

const ref = trainerFlight('gusts', 144);
console.log('Frame-rate agreement, gusts, same key presses: end-position difference from 144 fps');
console.table([30, 60, 120].map(rate => ({ fps: rate, 'difference m': trainerFlight('gusts', rate).position.distanceTo(ref.position).toFixed(2) })));

console.log('Takeoff roll, full power, stick back');
console.table(Object.entries({ calm: 'calm', 'headwind 8 m/s': { direction: 0, speed: 8 }, 'tailwind 8 m/s': { direction: Math.PI, speed: 8 }, 'crosswind 8 m/s': { direction: Math.PI / 2, speed: 8 } })
  .map(([name, w]) => { const r = takeoffRoll(w); return { wind: name, 'roll m': r.roll.toFixed(0), 'sideways m': r.sideways.toFixed(2), 'liftoff airspeed kt': kt(r.liftoffAirspeed) }; }));

console.log('Laret H4, 60 s');
console.table(['calm', 'breeze', 'gusts'].flatMap(w => [true, false].map(hold => { const r = hover(w, hold); return { wind: w, mode: hold ? 'hover hold' : 'hands-off',
  'offset m': r.offset.toFixed(1), 'ground speed kt': kt(r.groundSpeed), 'airspeed kt': kt(r.airspeed) }; })));

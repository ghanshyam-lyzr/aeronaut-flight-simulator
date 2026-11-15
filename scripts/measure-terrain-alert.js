// Before/after on a real ridge, and the look-ahead's sampling cost. Run: node scripts/measure-terrain-alert.js
// The ridge: the jet starts 1 km north-west of Alpine Field over the lake at 160 m, flight assist holding height and
// heading 315°, toward the north-western range (lake to ~4 km out, then ~130 m at 4.5 km, ~620 m at 5.5 km).
import { FlightController } from '../src/flight.js';
import { groundHeight } from '../src/world.js';
import { WATER_LEVEL } from '../src/regions.js';
import { TerrainAlert, sampleTerrain, TERRAIN_ALERT } from '../src/terrain-alert.js';

const heightAt = (x, z) => Math.max(WATER_LEVEL, groundHeight(x, z)); // world.heightAt

/** The removed rule: below 100 m above the ground (12 m and sinking for helicopters). */
const before = (s, type) => {
  const agl = s.position.y - heightAt(s.position.x, s.position.z), h = !!type.flight.rotorcraft;
  return !s.grounded && !s.crashed && agl < (h ? 12 : 100) && (!h || s.verticalSpeed < -2);
};

const HEADING = -Math.PI / 4;
export function ridgeRun({ id = 'jet', x = 900 + Math.sin(HEADING) * 1000, z = -1800 - Math.cos(HEADING) * 1000, y = 160, heading = HEADING, respond = false, seconds = 60 } = {}) {
  const flight = new FlightController(heightAt, id), s = flight.state, alert = new TerrainAlert(heightAt);
  s.position.set(x, y, z); s.heading = heading; flight.setQuaternion(); flight.toggleAutopilot();
  const events = { caution: null, warning: null, before: null, crash: null, cleared: null };
  const rate = 120;
  let pulling = false;
  for (let i = 0; i < seconds * rate && !s.crashed; i++) {
    // `respond`: at the first caution the pilot takes over with full power and a moderate pull.
    flight.update(1 / rate, pulling ? { pitch: 0.3, throttle: 1 } : {});
    const t = s.flightTime, a = alert.update(s, flight.type);
    if (respond && !pulling && a.level !== 'clear') { pulling = true; if (s.autopilot) flight.toggleAutopilot(); }
    if (pulling && a.level === 'clear' && events.cleared === null) events.cleared = t;
    if (a.level === 'caution' && events.caution === null) events.caution = t;
    if (a.level === 'warning' && events.warning === null) events.warning = t;
    if (before(s, flight.type) && events.before === null) events.before = t;
  }
  if (s.crashed) events.crash = s.flightTime;
  return { events, crashed: s.crashed, samples: alert.samples, probes: alert.probes, flightTime: s.flightTime };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fmt = v => v === null ? '—' : `${v.toFixed(1)} s`;
  for (const [name, run] of [['level at 160 m toward the ridge', ridgeRun()], ['climbing away at the first caution', ridgeRun({ respond: true, seconds: 40 })]]) {
    const e = run.events;
    console.log(`${name}: crash ${fmt(e.crash)} · before (AGL < 100 m) ${fmt(e.before)} · caution ${fmt(e.caution)} · warning ${fmt(e.warning)}${e.cleared === null ? '' : ` · cleared ${fmt(e.cleared)}`}`);
    if (e.crash !== null) console.log(`  lead before impact: old rule ${e.before === null ? 'none' : fmt(e.crash - e.before)}, caution ${fmt(e.caution === null ? null : e.crash - e.caution)}, warning ${fmt(e.warning === null ? null : e.crash - e.warning)}`);
    console.log(`  ${run.samples} samples, ${run.probes} height lookups over ${run.flightTime.toFixed(1)} flight seconds (${(run.probes / run.flightTime).toFixed(1)}/s)`);
  }
  // Cost of one sample on real terrain, measured on whatever machine runs this script.
  const flight = new FlightController(heightAt, 'jet'), s = flight.state;
  s.position.set(900 + Math.sin(HEADING) * 1000, 160, -1800 - Math.cos(HEADING) * 1000); s.heading = HEADING; flight.setQuaternion(); flight.update(1 / 120, {});
  const n = 20000;
  for (let i = 0; i < 2000; i++) sampleTerrain(s, flight.type, heightAt);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) sampleTerrain(s, flight.type, heightAt);
  const us = (performance.now() - t0) * 1000 / n, perSecond = 1 / TERRAIN_ALERT.fixedWing.interval;
  console.log(`sampleTerrain: ${us.toFixed(1)} µs per sample (${TERRAIN_ALERT.fixedWing.probes + 1} lookups) in Node ${process.version}; at ${perSecond} samples per flight second ≈ ${(us * perSecond / 1000).toFixed(3)} ms per second`);
}

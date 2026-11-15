// The fixed-wing airspeed envelope against each type's own numbers: cruise, full-power level speed, the tuned caution
// and overspeed marks, the dive ceiling and hard clamp, and how long a full-power dive at the pitch limit takes to warn.
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { KNOTS, AirspeedMonitor, airspeedEnvelope, sustainedSpeed, diveCeiling } from '../src/airspeed-envelope.js';

const kt = v => Math.round(v * KNOTS);
function timeToOverspeed(id) {
  const f = new FlightController(() => 40, id), m = new AirspeedMonitor();
  f.state.position.y = 80000;
  f.state.throttle = f.state.spool = 1;
  if (f.type.flight.aerobatic) f.state.pitch = -Math.PI / 3;
  for (let i = 1; i <= 90 * 120; i++) {
    f.update(1 / 120, { pitch: f.type.flight.aerobatic ? 0 : -1 });
    if (m.update(f.state, f.type) === 'overspeed') return (i / 120).toFixed(1);
  }
  return '—';
}

console.log('| Aircraft | Stall clean / full flaps kt | Low margin clean kt | Cruise kt | Full power level kt | Caution kt | Overspeed kt | Dive ceiling kt | Clamp kt | Tape kt | Dive to warning s |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const t of Object.values(FLEET)) {
  if (t.flight.rotorcraft) continue;
  const clean = airspeedEnvelope(t, 0), full = airspeedEnvelope(t, t.noFlaps ? 0 : 2);
  console.log(`| ${t.name} | ${Math.round(clean.stall)} / ${Math.round(full.stall)} | ${Math.round(clean.low)} | ${kt(t.flight.cruiseSpeed)} | ${kt(sustainedSpeed(t))}${t.flight.afterburnerFrom !== null ? ' (burner)' : ''} | ${clean.caution} | ${clean.overspeed} | ${kt(diveCeiling(t))} | ${kt(t.flight.maxSpeed)} | ${clean.scale} | ${timeToOverspeed(t.id)} |`);
}

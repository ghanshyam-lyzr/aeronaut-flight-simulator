// Stopping distances with and without held wheel brakes, at idle on flat ground, through the real input pipeline.
import { FlightController, brakeDeceleration } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { runwayCoordinates } from '../src/airfield.js';
import { airportById, runwayDirection } from '../src/airports.js';
import { LandingMission } from '../src/landing-mission.js';
import { groundHeight } from '../src/world.js';

const STOPPED = 0.5; // m/s; unbraked rolling resistance only approaches zero
export function rollout(id, { speed = FLEET[id].landing.speed * 0.85, brake = 1, from = 0, spool = 0, seconds = 90 } = {}) {
  const flight = new FlightController(() => 78, id), s = flight.runwayStart(0, 78 + (FLEET[id].groundClearance ?? 2.8), 0);
  Object.assign(s, { speed, throttle: spool, spool });
  const input = new FlightInputs(0);
  if (brake) input.set({ brake }, from);
  let t = 0, stopped = null;
  while (t < seconds && stopped === null) {
    t += 1 / 120;
    input.advance(t, (dt, c) => flight.update(dt, c));
    if (s.speed < STOPPED) stopped = { time: t, distance: s.distance };
  }
  return { ...stopped, speed: s.speed, grounded: s.grounded };
}

// The landing tests' feedback pilot, with brakes held once the wheels are down.
export function land(id, field, brake) {
  const flight = new FlightController(groundHeight, id), mission = new LandingMission(field), s = flight.state;
  mission.start(flight);
  const pilot = new FlightInputs(0), m = mission.profile;
  let touchdownAlong = null;
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - field.elevation - m.clearance;
    const sink = height < 8 ? Math.min(1.8, m.maxSink * 0.65) : m.speed * m.slope;
    const idleSink = Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
    const desiredPitch = Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    pilot.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded ? -1 : 0, brake: brake && s.grounded ? 1 : 0 }, (frame - 1) / 60);
    pilot.advance(frame / 60, (step, c) => {
      if (!mission.active) return;
      flight.update(step, c); mission.update(step, s);
      if (s.grounded && touchdownAlong === null) touchdownAlong = runwayCoordinates(s.position, field).along;
    });
  }
  return { mission, s, rollout: runwayCoordinates(s.position, field).along - touchdownAlong, time: s.flightTime };
}

export const LANDINGS = [['trainer', 'alpine-field'], ['jet', 'alpine-field'], ['biplane', 'verdance-meadow'], ['widebody', 'orvane-regional'], ['airliner', 'orvane-regional']];

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = Object.values(FLEET).filter(t => !t.flight.rotorcraft).map(t => {
    const v = t.landing.speed * 0.85, free = rollout(t.id, { brake: 0 }), held = rollout(t.id);
    return { aircraft: t.name, decel: brakeDeceleration(t), kt: Math.round(v * 1.94384), freeM: free.distance.toFixed(0), heldM: held.distance.toFixed(0),
      shorter: `${Math.round((1 - held.distance / free.distance) * 100)}%`, freeS: free.time.toFixed(1), heldS: held.time.toFixed(1) };
  });
  console.table(rows);
  const landings = [];
  for (const [id, airport] of LANDINGS) {
    const a = airportById(airport);
    for (const rw of [a.runway, a.reciprocal]) {
      const field = runwayDirection(a, rw), free = land(id, field, false), held = land(id, field, true);
      landings.push({ aircraft: FLEET[id].name, runway: `${a.ident} ${rw}`, freeRollM: free.rollout.toFixed(0), heldRollM: held.rollout.toFixed(0),
        freeStatus: free.mission.status, heldStatus: held.mission.status, freeS: free.time.toFixed(1), heldS: held.time.toFixed(1) });
    }
  }
  console.table(landings);
}

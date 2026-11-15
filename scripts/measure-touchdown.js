// Touchdown feedback measured on real flights: landing missions flown by the landing tests' feedback pilot to a gentle
// or a firm flare, and circuits on flat ground (runway start, takeoff, climb, descend, land) repeated in one flight.
// The detector reads each 60 Hz frame exactly as main.js does; nothing here writes the pose after a flight begins.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { airportById } from '../src/airports.js';
import { LandingMission } from '../src/landing-mission.js';
import { groundHeight } from '../src/world.js';
import { TouchdownDetector, touchdownResponse } from '../src/touchdown.js';

// Collective lever rate towards the setting that holds vertical speed `target` (m/s), with a little feedback.
// Steady climb rate in this model is g·(collective/hover − 1)/0.8, so the hold setting is hover·(1 + 0.8·target/g).
function collective(flight, target) {
  const f = flight.type.flight, s = flight.state;
  const hold = f.hoverCollective * (1 + 0.8 * target / 9.81) + (target - s.verticalSpeed) * 0.03;
  return Math.max(-1, Math.min(1, (hold - s.throttle) * 25));
}

// `share` is the flare sink as a share of the type's maxTouchdownSink.
export function landMission(id, field, share = 0.3) {
  const flight = new FlightController(groundHeight, id), mission = new LandingMission(field), s = flight.state;
  mission.start(flight);
  const detector = new TouchdownDetector(s), pilot = new FlightInputs(0), m = mission.profile, events = [];
  const heli = m.helicopter, flare = m.maxSink * share;
  for (let frame = 1; frame < 120 * 60 && (mission.active || frame < 2); frame++) {
    const height = s.position.y - field.elevation - m.clearance;
    if (heli) {
      pilot.set({ throttle: s.grounded ? -1 : collective(flight, -flare) }, (frame - 1) / 60);
    } else {
      const sink = height < 8 ? flare : m.speed * m.slope;
      const idleSink = Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
      const desiredPitch = Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
      pilot.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded ? -1 : 0, brake: s.grounded ? 1 : 0 }, (frame - 1) / 60);
    }
    pilot.advance(frame / 60, (step, c) => { if (!mission.active) return; flight.update(step, c); mission.update(step, s); });
    const event = detector.update(s);
    if (event) events.push({ frame, ...touchdownResponse(event, flight.type), record: event });
  }
  return { mission, state: s, events };
}

// Runway start on flat ground, then one circuit (takeoff, climb, descend and land) per flare share, in one flight.
export function circuits(id, shares = [0.3, 0.3]) {
  const ground = 78, flight = new FlightController(() => ground, id), f = flight.type.flight;
  const s = flight.runwayStart(0, ground + (flight.type.groundClearance ?? 2.8), 0);
  const detector = new TouchdownDetector(s), pilot = new FlightInputs(0), events = [], log = [];
  const clearance = f.rotorcraft ? f.groundClearance : flight.type.groundClearance ?? 2.8;
  let phase = 'roll', phaseTime = 0, landed = 0, frame = 0;
  while (frame < 600 * 60 && landed < shares.length && !s.crashed) {
    frame++;
    const share = shares[landed];
    const t = frame / 60, height = s.position.y - ground - clearance;
    phaseTime += 1 / 60;
    let input = {};
    if (f.rotorcraft) {
      if (phase === 'roll') { input = { throttle: 1 }; if (!s.grounded && height > 12) { phase = 'descend'; phaseTime = 0; } }
      else if (phase === 'descend') {
        input = { throttle: collective(flight, -f.maxTouchdownSink * share) };
        if (s.grounded) { phase = 'settle'; phaseTime = 0; }
      } else { input = { throttle: -1 }; if (phaseTime > 3) { landed++; phase = 'roll'; phaseTime = 0; } }
    } else if (phase === 'roll') {
      input = { throttle: 1, pitch: s.speed > f.rotateSpeed + 3 ? 0.6 : 0 };
      if (!s.grounded) { phase = 'climb'; phaseTime = 0; }
    } else if (phase === 'climb') {
      input = { throttle: 0, pitch: (0.08 - s.pitch) * 4 };
      if (phaseTime > 8) { phase = 'descend'; phaseTime = 0; }
    } else if (phase === 'descend') {
      const sink = height < 8 ? f.maxTouchdownSink * share : 3;
      const idleSink = Math.max(0, 0.32 - s.spool) * (f.idleSink ?? 6);
      const speedTarget = FLEET[id].landing.speed;
      input = { pitch: (Math.asin((-sink + idleSink) / Math.max(s.speed, 1)) - s.pitch) * 4, throttle: s.grounded ? -1 : Math.max(-1, Math.min(1, (speedTarget - s.speed) * 0.2)) };
      if (s.grounded) { phase = 'stop'; phaseTime = 0; }
    } else {
      input = { throttle: -1, brake: 1 };
      if (s.speed < 0.5 && phaseTime > 2) { landed++; phase = 'roll'; phaseTime = 0; }
    }
    pilot.set(input, t - 1 / 60);
    pilot.advance(t, (step, c) => flight.update(step, c));
    const event = detector.update(s);
    if (event) events.push({ frame, ...touchdownResponse(event, flight.type), record: event });
    log.push(s.grounded);
  }
  return { state: s, events, landed, groundedFrames: log.filter(Boolean).length };
}

export const CASES = [['trainer', 'alpine-field'], ['airliner', 'orvane-regional'], ['helicopter', 'alpine-field'], ['transport', 'alpine-field']];

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  for (const [id, airport] of CASES) {
    for (const share of [0.25, 0.8]) {
      const field = airportById(airport), r = landMission(id, field, share), e = r.events[0];
      rows.push({ aircraft: FLEET[id].name, flare: share, status: r.mission.status, events: r.events.length,
        sinkFpm: e ? Math.round(e.sink * 196.85) : '-', maxFpm: Math.round(FLEET[id].flight.maxTouchdownSink * 196.85),
        severity: e?.severity.toFixed(2), level: e?.level, class: e?.kind, gain: e?.sound.gain.toFixed(3),
        cockpitCm: e && (e.impulse.cockpit * 100).toFixed(1), outsideCm: e && (e.impulse.outside * 100).toFixed(1), ms: e && Math.round(e.impulse.duration * 1000) });
    }
  }
  console.table(rows);
  console.table(['trainer', 'jet', 'helicopter', 'tandem'].map(id => { const r = circuits(id, [0.25, 0.8]); return { aircraft: FLEET[id].name, landed: r.landed, events: r.events.length, crashed: r.state.crashed, groundedFrames: r.groundedFrames, levels: r.events.map(e => e.level).join(' ') }; }));
}

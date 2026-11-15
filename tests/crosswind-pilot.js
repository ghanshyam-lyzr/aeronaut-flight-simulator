// A deterministic test pilot for crosswind practice (tests/crosswind-practice.test.js, scripts/measure-crosswind.js).
// Ordinary rate inputs through FlightInputs only, like the landing mission's pilot: pitch to hold the 3° path and flare,
// rudder (Q/E) and level wings for the crab, rudder again to straighten just above the runway, then idle and brakes.
// It reads what a pilot sees (the wind on the card, the flight-path marker's track, the runway) and never writes the pose.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { Activities } from '../src/activities.js';
import { CrosswindPractice, STRAIGHTEN_HEIGHT, practiceCue } from '../src/crosswind-practice.js';
import { runwayCoordinates } from '../src/airfield.js';
import { groundTrack } from '../src/flight-path.js';
import { windComponents } from '../src/wind.js';
import { groundHeight } from '../src/world.js';

const angle = a => Math.atan2(Math.sin(a), Math.cos(a)), clamp = v => Math.max(-1, Math.min(1, v));

export function setup(id = 'trainer', pilotWind = 'calm') {
  const flight = new FlightController(groundHeight, id), landing = new LandingMission(), course = new CheckpointCourse();
  const practice = new CrosswindPractice(landing), activities = new Activities(landing, course, practice);
  flight.setWind(pilotWind, { immediate: true });
  return { flight, landing, course, practice, activities, s: flight.state };
}

/**
 * Flies one attempt already started. `correct: false` flies the identical pitch/power/brake pilot with hands off the
 * lateral controls. `rudder: false` is the phone's touch yoke alone: bank to crab, wings level for the flare, the crab left in.
 * `steer: false` leaves the rudder alone on the runway. `straighten` is the height (m) at which rudder takes the crab out (null: never).
 * `followCue: true` ignores `straighten` and does what the card's live cue (practiceCue) says instead: straighten only once
 * it says "Straighten", and with the yoke level the wings once it says so. Returns telemetry, with the cues shown (`cues`).
 */
export function flyApproach({ flight, landing, activities, s }, { correct = true, straighten = STRAIGHTEN_HEIGHT, steer = true, rudder = true, followCue = false, rate = 60, seconds = 150 } = {}) {
  const p = landing.profile, f = landing.field, inputs = new FlightInputs(0);
  let maxOffset = 0, minHeight = Infinity, frames = 0, last = null;
  const cues = [];
  for (let frame = 1; frame < seconds * rate && landing.active; frame++) {
    const height = s.position.y - f.elevation - p.clearance, at = runwayCoordinates(s.position, f);
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const idleSink = Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
    const desiredPitch = Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    let yaw = 0, roll = 0;
    if (correct && !s.grounded) {
      // Crab: point into the wind by the angle the card's crosswind needs, trimmed by the drift the marker shows.
      const c = windComponents(flight.sampleWind(), f.heading).crosswind, track = groundTrack(s, flight.type);
      const drift = Math.sin(angle(track.track - f.heading)) * track.speed;
      const crab = Math.asin(Math.max(-0.5, Math.min(0.5, c / Math.max(s.speed, 1))));
      let want = f.heading + crab - Math.max(-0.12, Math.min(0.12, at.cross * 0.02 + drift * 0.08));
      const cue = followCue ? practiceCue({ height, alignment: Math.abs(angle(s.heading - f.heading)), crab: angle(s.heading - f.heading), drift, cross: at.cross, rudder }) : null;
      if (cue && cue !== last) { cues.push({ height: Math.round(height * 10) / 10, cue }); last = cue; }
      if (followCue ? /^Straighten/.test(cue ?? '') : straighten !== null && height < straighten) want = f.heading;
      if (rudder) { yaw = clamp(angle(want - s.heading) * 8); roll = clamp(-s.bank * 3); }
      // Yoke only: a shallow bank toward the wanted heading, wings level for the flare (below 15 m, or when the cue says so).
      else roll = clamp((((followCue ? /level/i.test(cue ?? '') : height < 15) ? 0 : Math.max(-0.12, Math.min(0.12, angle(want - s.heading) * 2))) - s.bank) * 4);
    }
    // Rollout: idle, brakes, and rudder to keep straight and back toward the centreline.
    if (correct && steer && s.grounded) {
      const turn = clamp(angle(f.heading - s.heading) * 6 - at.cross * 0.05);
      if (rudder) yaw = turn; else roll = turn;
    }
    maxOffset = Math.max(maxOffset, Math.abs(at.cross)); minHeight = Math.min(minHeight, height);
    inputs.set({ pitch: (desiredPitch - s.pitch) * 4, roll, yaw, throttle: s.grounded ? -1 : 0, brake: s.grounded && s.speed > 1 ? 1 : 0 }, (frame - 1) / rate);
    inputs.advance(frame / rate, (step, controls) => { if (!landing.active) return; flight.update(step, controls); activities.update(step, s); });
    frames = frame;
  }
  return { status: landing.status, reason: landing.reason, touchdown: landing.touchdown, maxOffset, time: frames / rate, feedback: activities.practice.feedback(), end: runwayCoordinates(s.position, f), cues };
}

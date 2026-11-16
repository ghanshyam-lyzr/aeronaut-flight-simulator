// Ordinary-input feedback pilots. They read telemetry and queue FlightInputs; no pose, velocity or score writes.
import { FlightInputs } from '../src/controls.js';
import { COURSE } from '../src/checkpoint-course.js';
import { RECOVERY } from '../src/stall-recovery.js';
import { runwayCoordinates } from '../src/airfield.js';
import { groundTrack } from '../src/flight-path.js';
import { windComponents } from '../src/wind.js';

const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

function courseControls({ course, flight, s }) {
  const last = COURSE.gates.at(-1), points = [COURSE.start, ...COURSE.gates,
    { x: last.x + Math.sin(last.heading) * 3000, z: last.z - Math.cos(last.heading) * 3000 }];
  let segment = course.next, a = points[segment], b = points[segment + 1];
  let length = Math.hypot(b.x - a.x, b.z - a.z);
  let distance = clamp(((s.position.x - a.x) * (b.x - a.x) + (s.position.z - a.z) * (b.z - a.z)) / length, 0, length)
    + Math.max(250, s.speed * 5);
  while (distance > length && segment < points.length - 2) {
    distance -= length; segment++; a = points[segment]; b = points[segment + 1]; length = Math.hypot(b.x - a.x, b.z - a.z);
  }
  const target = { x: a.x + (b.x - a.x) * distance / length, z: a.z + (b.z - a.z) * distance / length };
  const err = angle(Math.atan2(target.x - s.position.x, -(target.z - s.position.z)) - s.heading);
  const f = flight.type.flight, limit = Math.min(0.85, (f.bankLimit ?? 1) - 0.05), bank = clamp(err * 3, -limit, limit);
  const pitch = clamp((course.gate.y - s.position.y) * 0.01 - s.verticalSpeed * 0.03, -0.15, 0.15);
  return { roll: clamp((bank - s.bank) * 3), pitch: clamp((pitch - s.pitch) * 4), throttle: clamp((f.cruiseSpeed - s.speed) * 0.2) };
}

function landingControls({ board, flight, landing, s }) {
  const p = landing.profile, f = landing.field, height = s.position.y - f.elevation - p.clearance;
  const at = runwayCoordinates(s.position, f), sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
  const idleSink = p.helicopter ? 0 : Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
  const desiredPitch = p.helicopter ? 0 : Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
  let yaw = 0, roll = 0;
  if (board.activity === 'crosswind' && !s.grounded) {
    const crosswind = windComponents(flight.sampleWind(), f.heading).crosswind, track = groundTrack(s, flight.type);
    const drift = Math.sin(angle(track.track - f.heading)) * track.speed;
    const crab = Math.asin(clamp(crosswind / Math.max(s.speed, 1), -0.5, 0.5));
    const want = height < 3 ? f.heading : f.heading + crab - clamp(at.cross * 0.02 + drift * 0.08, -0.12, 0.12);
    yaw = clamp(angle(want - s.heading) * 8); roll = clamp(-s.bank * 3);
  }
  if (s.grounded) yaw = clamp(angle(f.heading - s.heading) * 6 - at.cross * 0.05);
  return { pitch: (desiredPitch - s.pitch) * 4, roll, yaw,
    throttle: s.grounded || (p.helicopter && s.throttle > p.throttle - 0.03) ? -1 : 0,
    brake: s.grounded && s.speed > 1 ? 1 : 0 };
}

function recoveryControls({ recovery, s }) {
  let pitch = 0, throttle = s.throttle > 0 ? -1 : 0;
  if (recovery.stall) {
    throttle = s.throttle < 0.85 ? 1 : 0;
    const target = s.airspeed < RECOVERY.safeSpeed + 1 ? -0.12 : 0;
    pitch = (target - s.pitch) * 4;
  }
  return { pitch, roll: -s.bank * 4, throttle };
}

/** Reuses the production input ramp and records every actual slice, including partial frame boundaries. */
export function flyRanked(recorder, { rate = 60, seconds = 590, actions = () => [], pause = () => {} } = {}) {
  const simulation = recorder.simulation, { board, activities } = simulation, inputs = new FlightInputs(0);
  for (let frame = 1; frame < rate * seconds && !activities.finished; frame++) {
    pause(recorder, frame);
    const controls = board.activity === 'course' ? courseControls(simulation)
      : board.activity === 'recovery' ? recoveryControls(simulation) : landingControls(simulation);
    inputs.set(controls, (frame - 1) / rate);
    inputs.advance(frame / rate, (dt, normalized) => {
      if (!activities.finished) recorder.step(dt, normalized, actions(recorder, frame));
    });
  }
  return simulation;
}

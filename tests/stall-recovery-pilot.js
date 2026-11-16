// Deterministic pilot: only ordinary pitch/roll/power commands through the same FlightInputs as keyboard and yoke.
// No state/pose/airspeed writes after the exercise start. Used by regression tests and the measurement script.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { CrosswindPractice } from '../src/crosswind-practice.js';
import { StallRecovery, RECOVERY } from '../src/stall-recovery.js';
import { Activities } from '../src/activities.js';
import { groundHeight } from '../src/world.js';

export function setup({ type = 'trainer', wind = 'gusts', terrain = groundHeight } = {}) {
  const flight = new FlightController(terrain, type), landing = new LandingMission(), course = new CheckpointCourse();
  const practice = new CrosswindPractice(landing), recovery = new StallRecovery(), activities = new Activities(landing, course, practice, recovery);
  flight.setWind(wind, { immediate: true });
  return { flight, landing, course, practice, recovery, activities, s: flight.state };
}

/** No recovery, dive too far, bank too far, never lower the nose, never add power, or successful manual flight. */
export function flyRecovery(x, { rate = 60, mode = 'recover', seconds = 110, onFrame = () => {} } = {}) {
  const { flight, activities, recovery, s } = x, inputs = new FlightInputs(0), trace = [];
  let stallSeen = false, minClearance = Infinity;
  for (let frame = 1; frame <= seconds * rate && recovery.active; frame++) {
    onFrame(x, frame / rate);
    const stalled = recovery.stall !== null;
    let pitch = 0, throttle = s.throttle > 0 ? -1 : 0, roll = -s.bank * 4;
    if (mode === 'wait') { throttle = 0; }
    else if (stalled && mode !== 'idle') {
      throttle = mode === 'no-power' ? -1 : s.throttle < 0.85 ? 1 : 0;
      let target = mode === 'dive' ? -0.5 : s.airspeed < RECOVERY.safeSpeed + 1 ? -0.12 : 0;
      if (mode === 'no-nose') target = Math.max(0.05, recovery.stall.pitch);
      if (mode === 'bank') roll = (0.3 - s.bank) * 4;
      pitch = (target - s.pitch) * 4;
    }
    inputs.set({ pitch, roll, throttle }, (frame - 1) / rate);
    inputs.advance(frame / rate, (step, controls) => {
      if (activities.beforeStep(s) || !recovery.active) return;
      flight.update(step, controls); activities.update(step, s);
      stallSeen ||= s.stalled;
      minClearance = Math.min(minClearance, s.position.y - flight.groundAt(s.position.x, s.position.z));
    });
    if (frame % rate === 0 || recovery.finished) trace.push({ time: s.flightTime, speed: s.airspeed, pitch: s.pitch, altitude: s.position.y, stalled: s.stalled, phase: recovery.phase });
  }
  return { ...recovery.snapshot(), stallSeen, minClearance, trace, final: { speed: s.airspeed, pitch: s.pitch, bank: s.bank, sink: s.verticalSpeed } };
}

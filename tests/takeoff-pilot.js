// The production input ramp and flight engine, with no pose/speed/score writes after start.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { CrosswindPractice } from '../src/crosswind-practice.js';
import { StallRecovery } from '../src/stall-recovery.js';
import { TakeoffPractice, TAKEOFF } from '../src/takeoff-practice.js';
import { Activities } from '../src/activities.js';
import { groundHeight } from '../src/world.js';

export function setup({ type = 'trainer', wind = 'gusts', terrain = groundHeight } = {}) {
  const flight = new FlightController(terrain, type), landing = new LandingMission(), course = new CheckpointCourse();
  const practice = new CrosswindPractice(landing), recovery = new StallRecovery(), takeoff = new TakeoffPractice();
  const activities = new Activities(landing, course, practice, recovery, takeoff);
  flight.setWind(wind, { immediate: true });
  return { flight, landing, course, practice, recovery, takeoff, activities, s: flight.state };
}
export function takeoffControls(s, mode = 'yoke') {
  const error = .14 - s.pitch;
  let pitch = s.grounded ? (s.airspeed >= TAKEOFF.rotateSpeed ? 1 : 0)
    : mode === 'keyboard' ? (Math.abs(error) > .02 ? Math.sign(error) : 0) : error * 4;
  if (mode === 'roll-only' || mode === 'wait') pitch = 0;
  if (mode === 'dive' && !s.grounded) pitch = -1;
  return { pitch, throttle: mode === 'wait' ? 0 : 1, roll: mode === 'veer' ? 1 : -s.bank * 3 };
}
export function flyTakeoff(x, { rate = 60, seconds = 100, mode = 'yoke', onFrame = () => {} } = {}) {
  const { s, flight, takeoff, activities } = x, inputs = new FlightInputs(s.flightTime), start = s.flightTime;
  let stallSeen = false; const trace = [];
  for (let frame = 1; frame <= seconds * rate && takeoff.active; frame++) {
    onFrame(x);
    inputs.set(takeoffControls(s, mode), start + (frame - 1) / rate);
    inputs.advance(start + frame / rate, (dt, controls) => {
      if (activities.beforeStep(s)) return;
      flight.update(dt, controls); activities.update(dt, s); stallSeen ||= s.stalled;
    });
    if (frame % rate === 0 || takeoff.finished) trace.push({ time: s.flightTime, speed: s.airspeed, height: takeoff.height(s), pitch: s.pitch, phase: takeoff.phase });
  }
  return { ...takeoff.snapshot(), stallSeen, trace, final: { time: s.flightTime, speed: s.airspeed, pitch: s.pitch, heading: s.heading, bank: s.bank, climb: s.verticalSpeed } };
}

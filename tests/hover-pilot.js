// Test-only pilot: ordinary FlightInputs commands; never writes pose, velocity, power or assist after start.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { CrosswindPractice } from '../src/crosswind-practice.js';
import { StallRecovery } from '../src/stall-recovery.js';
import { HoverChallenge } from '../src/hover-challenge.js';
import { Activities } from '../src/activities.js';
import { groundHeight } from '../src/world.js';

export function setup({ type = 'helicopter', wind = 'gusts', terrain = groundHeight } = {}) {
  const flight = new FlightController(terrain, type), landing = new LandingMission(), course = new CheckpointCourse();
  const practice = new CrosswindPractice(landing), recovery = new StallRecovery(), hover = new HoverChallenge();
  const activities = new Activities(landing, course, practice, recovery, hover);
  flight.setWind(wind, { immediate: true });
  return { flight, landing, course, practice, recovery, hover, activities, s: flight.state };
}
const clamp = (v, n = 1) => Math.max(-n, Math.min(n, v));
export function flyHover(x, { rate = 60, seconds = 90, mode = 'touch', onFrame = () => {} } = {}) {
  const { flight, activities, hover, s } = x, inputs = new FlightInputs(0), f = flight.type.flight;
  let travel = 0, minClearance = Infinity;
  for (let frame = 1; frame <= seconds * rate && hover.active; frame++) {
    onFrame(x, frame / rate);
    const t = hover.target, c = Math.cos(s.heading), h = Math.sin(s.heading);
    const ax = clamp((t.x - s.position.x) * 0.2 - s.velocity.x * 0.9, 1.5);
    const az = clamp((t.z - s.position.z) * 0.2 - s.velocity.z * 0.9, 1.5);
    const targetPitch = Math.atan2(-h * ax + c * az, 9.81), targetBank = Math.atan2(c * ax + h * az, 9.81);
    const level = f.levelRate ?? 1.6;
    let pitch = clamp(((targetPitch - s.pitch) * 3 + level * s.pitch) / f.pitchRate);
    let roll = clamp(((targetBank - s.bank) * 3 + level * s.bank) / f.rollRate);
    let yaw = clamp(Math.atan2(Math.sin(t.heading - s.heading), Math.cos(t.heading - s.heading)) * 1.5 / f.yawRate);
    const collective = f.hoverCollective * (1 + clamp((t.y - s.position.y) * 0.5 - s.velocity.y * 1.1, 1.5) / 9.81);
    let throttle = clamp((collective - s.throttle) * 8);
    // Binary keys / yaw and +/- touch buttons: 100 ms taps sampled with a dead band.
    if (mode === 'keys') {
      const key = v => Math.abs(v) > 0.015 ? Math.sign(v) : 0;
      if (frame === 1 || Math.floor((frame - 1) / rate * 10) !== Math.floor((frame - 2) / rate * 10)) {
        x.keys = { pitch: key(pitch), roll: key(roll), yaw: Math.abs(yaw) > 0.1 ? Math.sign(yaw) : 0,
          throttle: Math.abs(collective - s.throttle) > 0.003 ? Math.sign(throttle) : 0 };
      }
      ({ pitch, roll, yaw, throttle } = x.keys);
    }
    if (mode === 'wait') pitch = roll = yaw = throttle = 0;
    inputs.set({ pitch, roll, yaw, throttle }, (frame - 1) / rate);
    inputs.advance(frame / rate, (dt, controls) => {
      if (activities.beforeStep(s) || !hover.active) return;
      flight.update(dt, controls); activities.update(dt, s);
      travel += (Math.abs(controls.pitch) + Math.abs(controls.roll) + Math.abs(controls.yaw) + Math.abs(controls.throttle)) * dt;
      minClearance = Math.min(minClearance, s.position.y - flight.groundAt(s.position.x, s.position.z));
    });
  }
  return { ...hover.snapshot(), travel, minClearance, final: { position: s.position.toArray(), velocity: s.velocity.toArray(), heading: s.heading, throttle: s.throttle, autopilot: s.autopilot } };
}

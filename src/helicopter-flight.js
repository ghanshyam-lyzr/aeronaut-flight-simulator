import { Vector3, MathUtils } from 'three';
import { angularResponse } from './handling.js';

const { clamp, lerp } = MathUtils;
const mix = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const g = 9.81, tau = 2 * Math.PI;
const up = new Vector3(), local = new Vector3(), air = new Vector3();
const angleError = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Rotor and fuselage drag on the velocity through the air (m/s²), the same law for translation and for wind.
const dragRate = (x, z) => 0.08 + Math.hypot(x, z) * 0.0012;

/**
 * Rotor lift and world-space momentum: no minimum airspeed or fixed-wing turn/lift terms. state.velocity is the
 * ground velocity; drag acts on the velocity through the air (ground velocity minus the wind), so a level disc
 * drifts downwind, and state.speed is the airspeed. Hover hold keeps its ground-fixed point by leaning into the wind.
 */
export function stepHelicopter(flight, dt, controls) {
  const s = flight.state, f = flight.type.flight, v = s.velocity;
  flight.previousVelocity.copy(v);
  const w = flight.advanceWind(dt);
  s.flightTime += dt;
  s.gearDown = true;
  s.flaps = 0;
  s.stalled = s.afterburner = false;
  s.throttle = clamp(s.throttle + controls.throttle * dt * f.throttleRate, 0, 1);

  let pitchTarget, rollTarget, yawTarget;
  if (s.autopilot) {
    // Brake into the captured hover point. Desired acceleration is rotated into the cabin frame.
    // Wind feed-forward: the tilt that cancels the wind's drag at the hold point (zero in calm air).
    const windDrag = w.x || w.z ? dragRate(w.x, w.z) : 0;
    const ax = clamp((flight.holdPosition.x - s.position.x) * 0.18 - v.x * 0.85 - w.x * windDrag, -3, 3);
    const az = clamp((flight.holdPosition.z - s.position.z) * 0.18 - v.z * 0.85 - w.z * windDrag, -3, 3);
    const c = Math.cos(s.heading), h = Math.sin(s.heading);
    local.set(c * ax + h * az, 0, -h * ax + c * az);
    pitchTarget = (Math.atan2(local.z, g) - s.pitch) * 3;
    rollTarget = (Math.atan2(local.x, g) - s.bank) * 3;
    yawTarget = clamp(angleError(flight.holdHeading, s.heading) * 1.5, -f.yawRate, f.yawRate);
    const verticalAcceleration = clamp((flight.holdAltitude - s.position.y) * 0.36 - v.y * 0.95, -3, 3);
    const collective = f.hoverCollective * (1 + verticalAcceleration / g);
    // Lead the slower rotor's lift response, but move the lever continuously from its
    // current setting. Engaging assist must not snap collective by tens of percent.
    const target = clamp(collective + (collective - s.spool) / f.collectiveResponse, 0.2, 0.9);
    s.throttle += clamp(target - s.throttle, -2 * f.throttleRate * dt, 2 * f.throttleRate * dt);
  } else {
    // Blend disc stability continuously: a small held cyclic produces a small tilt,
    // full cyclic retains authority. Translation still needs time or counter-cyclic to stop.
    const level = f.levelRate ?? 1.6;
    pitchTarget = controls.pitch * f.pitchRate - s.pitch * level * (1 - Math.abs(controls.pitch));
    rollTarget = controls.roll * f.rollRate - s.bank * level * (1 - Math.abs(controls.roll));
    yawTarget = controls.yaw * f.yawRate;
  }
  // Assist keeps its existing 3/s attitude servo, with a damped rate handover.
  const pitchLimit = s.autopilot ? 1.8 : f.pitchRate, rollLimit = s.autopilot ? 1.8 : f.rollRate;
  const pitch = angularResponse(flight.pitchRate, clamp(pitchTarget, -pitchLimit, pitchLimit), s.autopilot ? 12 : f.pitchResponse, dt);
  const roll = angularResponse(flight.rollRate, clamp(rollTarget, -rollLimit, rollLimit), s.autopilot ? 12 : f.rollResponse, dt);
  const yaw = angularResponse(flight.yawRate, yawTarget, f.yawResponse ?? 6, dt);
  flight.pitchRate = pitch.rate; flight.rollRate = roll.rate; flight.yawRate = yaw.rate;
  s.pitch += pitch.angle;
  s.bank += roll.angle;
  s.pitch = clamp(s.pitch, ...f.pitchLimits);
  s.bank = clamp(s.bank, -f.bankLimit, f.bankLimit);
  if (!s.grounded) s.heading = (s.heading + yaw.angle + tau) % tau;
  flight.setQuaternion();
  Object.assign(s.bodyRates, { pitch: flight.pitchRate, roll: flight.rollRate, yaw: flight.yawRate });
  s.spool = mix(s.spool, s.throttle, f.collectiveResponse, dt);
  // A governed rotor stays at flight RPM above idle. Collective changes blade pitch, not RPM.
  s.rotorSpeed = mix(s.rotorSpeed, s.throttle > 0.02 ? 1 : 0, s.throttle > 0.02 ? f.rotorSpinUp : f.rotorSpinDown, dt);
  up.set(0, 1, 0).applyQuaternion(s.quaternion);
  // Modest tilt compensation keeps every helicopter accessible while translating.
  const lift = g * s.spool / f.hoverCollective * s.rotorSpeed ** 2 / Math.max(0.6, up.y);
  const ground = flight.groundAt(s.position.x, s.position.z) + f.groundClearance;
  if (s.grounded) {
    v.set(0, 0, 0);
    s.speed = s.verticalSpeed = 0;
    s.gForce = 1;
    s.pitch = s.bank = 0;
    flight.pitchRate = flight.rollRate = flight.yawRate = 0;
    s.bodyRates.pitch = s.bodyRates.roll = s.bodyRates.yaw = 0;
    up.set(0, 1, 0);
    s.position.y = ground;
    flight.setQuaternion();
    if (lift > g + 0.15) {
      s.grounded = false;
      s.position.y += 0.02;
    } else return;
  }

  const airX = v.x - w.x, airZ = v.z - w.z, drag = dragRate(airX, airZ);
  v.x += (up.x * lift - airX * drag) * dt;
  v.z += (up.z * lift - airZ * drag) * dt;
  v.y += (up.y * lift - g - v.y * 0.8) * dt;
  s.position.addScaledVector(v, dt);
  s.distance += Math.hypot(v.x, v.z) * dt;
  s.speed = air.copy(v).sub(w).length(); // true airspeed, including sideways/backwards/vertical flight
  s.verticalSpeed = v.y;
  flight.acceleration.copy(v).sub(flight.previousVelocity).divideScalar(dt);
  flight.acceleration.y += g;
  s.gForce = flight.acceleration.dot(up) / g;

  const surface = flight.groundAt(s.position.x, s.position.z) + f.groundClearance;
  if (s.position.y <= surface) {
    const penetration = surface - s.position.y;
    s.position.y = surface;
    flight.recordTouchdown();
    // Skids or wheels: sample the corners of the type's footprint (the Laret H4's skids by default).
    const [halfWidth, halfLength] = f.footprint ?? [1.2, 1.2];
    const contacts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => flight.groundAt(s.position.x + x * halfWidth, s.position.z + z * halfLength));
    const levelGround = Math.max(...contacts) - Math.min(...contacts) < 0.8;
    const water = flight.heightAt(s.position.x, s.position.z) <= 10.2;
    const gentle = !water && levelGround && penetration < 0.3 && Math.abs(v.y) < f.maxTouchdownSink
      && Math.hypot(v.x, v.z) < f.maxTouchdownSpeed && Math.abs(s.bank) < 0.22 && Math.abs(s.pitch) < 0.22;
    s.grounded = gentle;
    s.crashed = !gentle;
    s.crashReason = gentle ? '' : water ? 'Water collision' : 'Hard landing';
    s.autopilot = false;
    s.speed = s.verticalSpeed = 0;
    s.gForce = gentle ? 1 : s.gForce;
    v.set(0, 0, 0);
  }
}

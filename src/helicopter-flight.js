import { Vector3, MathUtils } from 'three';

const { clamp, lerp } = MathUtils;
const mix = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const g = 9.81, tau = 2 * Math.PI;
const up = new Vector3(), local = new Vector3();
const angleError = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Rotor lift and world-space momentum: no minimum airspeed or fixed-wing turn/lift terms. */
export function stepHelicopter(flight, dt, controls) {
  const s = flight.state, f = flight.type.flight, v = s.velocity;
  flight.previousVelocity.copy(v);
  s.flightTime += dt;
  s.gearDown = true;
  s.flaps = 0;
  s.stalled = s.afterburner = false;
  s.throttle = clamp(s.throttle + controls.throttle * dt * f.throttleRate, 0, 1);

  if (s.autopilot) {
    // Brake into the captured hover point. Desired acceleration is rotated into the cabin frame.
    const ax = clamp((flight.holdPosition.x - s.position.x) * 0.18 - v.x * 0.85, -3, 3);
    const az = clamp((flight.holdPosition.z - s.position.z) * 0.18 - v.z * 0.85, -3, 3);
    const c = Math.cos(s.heading), h = Math.sin(s.heading);
    local.set(c * ax + h * az, 0, -h * ax + c * az);
    s.pitch = mix(s.pitch, Math.atan2(local.z, g), 3, dt);
    s.bank = mix(s.bank, Math.atan2(local.x, g), 3, dt);
    flight.pitchRate = flight.rollRate = 0;
    flight.yawRate = mix(flight.yawRate, clamp(angleError(flight.holdHeading, s.heading) * 1.5, -f.yawRate, f.yawRate), 5, dt);
    const verticalAcceleration = clamp((flight.holdAltitude - s.position.y) * 0.36 - v.y * 0.95, -3, 3);
    s.throttle = clamp(f.hoverCollective * (1 + verticalAcceleration / g), 0.2, 0.9);
  } else {
    flight.pitchRate = mix(flight.pitchRate, controls.pitch * f.pitchRate, f.pitchResponse, dt);
    flight.rollRate = mix(flight.rollRate, controls.roll * f.rollRate, f.rollResponse, dt);
    flight.yawRate = mix(flight.yawRate, controls.yaw * f.yawRate, 6, dt);
    s.pitch += flight.pitchRate * dt;
    s.bank += flight.rollRate * dt;
    // A centered cyclic levels the disc; momentum still needs time or opposite cyclic to stop.
    if (Math.abs(controls.pitch) < 0.001) s.pitch = mix(s.pitch, 0, 1.6, dt);
    if (Math.abs(controls.roll) < 0.001) s.bank = mix(s.bank, 0, 1.6, dt);
  }
  s.pitch = clamp(s.pitch, ...f.pitchLimits);
  s.bank = clamp(s.bank, -f.bankLimit, f.bankLimit);
  if (!s.grounded) s.heading = (s.heading + flight.yawRate * dt + tau) % tau;
  flight.setQuaternion();
  Object.assign(s.bodyRates, { pitch: flight.pitchRate, roll: flight.rollRate, yaw: flight.yawRate });
  s.spool = mix(s.spool, s.throttle, f.collectiveResponse, dt);
  // A governed rotor stays at flight RPM above idle. Collective changes blade pitch, not RPM.
  s.rotorSpeed = mix(s.rotorSpeed, s.throttle > 0.02 ? 1 : 0, s.throttle > 0.02 ? f.rotorSpinUp : f.rotorSpinDown, dt);
  up.set(0, 1, 0).applyQuaternion(s.quaternion);
  // Modest tilt compensation keeps this light helicopter accessible while translating.
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

  const drag = 0.08 + Math.hypot(v.x, v.z) * 0.0012;
  v.x += (up.x * lift - v.x * drag) * dt;
  v.z += (up.z * lift - v.z * drag) * dt;
  v.y += (up.y * lift - g - v.y * 0.8) * dt;
  s.position.addScaledVector(v, dt);
  s.distance += Math.hypot(v.x, v.z) * dt;
  s.speed = v.length(); // true airspeed includes sideways/backwards/vertical flight in still air
  s.verticalSpeed = v.y;
  flight.acceleration.copy(v).sub(flight.previousVelocity).divideScalar(dt);
  flight.acceleration.y += g;
  s.gForce = flight.acceleration.dot(up) / g;

  const surface = flight.groundAt(s.position.x, s.position.z) + f.groundClearance;
  if (s.position.y <= surface) {
    const penetration = surface - s.position.y;
    s.position.y = surface;
    const skidHeights = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([x, z]) => flight.groundAt(s.position.x + x, s.position.z + z));
    const levelGround = Math.max(...skidHeights) - Math.min(...skidHeights) < 0.8;
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

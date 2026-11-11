import * as THREE from 'three';
import { FLEET, aircraftType, DEFAULT_AIRCRAFT } from './fleet.js';
import { stepHelicopter } from './helicopter-flight.js';

const clamp = THREE.MathUtils.clamp;
const mix = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;
const GRAVITY = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Flight assist turns a free-attitude aircraft back to level no faster than this, in rad/s.
const ASSIST_RECOVERY_RATE = 1.2;
const _q = new THREE.Quaternion(), _prev = new THREE.Quaternion(), _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3(), _axis = new THREE.Vector3();

/** Vela J8 performance, in metres per second. Speeds are tuned for the valley, not a certified type. */
export const JET = FLEET.jet.flight;

/** A forgiving, coordinated-turn flight model. All distances are metres. */
export class FlightController {
  constructor(heightAt = () => 0, aircraft = DEFAULT_AIRCRAFT) {
    this.heightAt = heightAt;
    this.type = aircraftType(aircraft);
    this.state = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3() };
    this.holdPosition = new THREE.Vector3();
    this.attitude = new THREE.Euler(0, 0, 0, 'YXZ');
    this.previousVelocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.aircraftUp = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const s = this.state;
    s.position.set(0, Math.max(620, this.groundAt(0, 1900) + 180), 1900);
    s.quaternion.identity();
    const f = this.type.flight;
    Object.assign(s, {
      aircraft: this.type.id,
      speed: f.cruiseSpeed,
      throttle: f.cruiseThrottle,
      spool: f.cruiseThrottle,
      afterburner: false,
      heading: 0,
      pitch: 0,
      bank: 0,
      verticalSpeed: 0,
      gForce: 1,
      gearDown: !!f.rotorcraft,
      rotorSpeed: f.rotorcraft ? 1 : 0,
      flaps: 0,
      crashed: false,
      stalled: false,
      grounded: false,
      flightTime: 0,
      distance: 0,
      autopilot: false,
      crashReason: '',
      bodyRates: { pitch: 0, roll: 0, yaw: 0 },
    });
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    s.velocity.set(0, 0, f.rotorcraft ? 0 : -s.speed);
    this.holdPosition.copy(s.position);
    this.holdAltitude = s.position.y;
    this.holdHeading = 0;
    this.recovering = false;
    this.setQuaternion();
    return s;
  }

  /** Switching aircraft always begins a fresh airborne flight in the new type. */
  setAircraft(id) {
    this.type = aircraftType(id);
    return this.reset();
  }

  /** Parks the current aircraft at rest on a runway threshold, gear down and engines idle. */
  runwayStart(x, y, z, heading = 0) {
    const s = this.reset();
    s.position.set(x, this.type.flight.rotorcraft ? this.groundAt(x, z) + this.type.flight.groundClearance : y, z);
    s.velocity.set(0, 0, 0);
    s.rotorSpeed = 0;
    Object.assign(s, { heading, speed: 0, throttle: 0, spool: 0, gearDown: true, grounded: true, autopilot: false });
    this.holdHeading = heading;
    this.setQuaternion();
    return s;
  }

  groundAt(x, z) {
    const height = this.heightAt(x, z);
    return Math.max(10, Number.isFinite(height) ? height : 0);
  }

  get gearWarning() {
    const s = this.state;
    // 1,000 feet is exactly 304.8 metres; both thresholds are exclusive.
    return !this.type.flight.rotorcraft && !s.gearDown && s.throttle < 0.2
      && s.position.y < this.groundAt(s.position.x, s.position.z) + 304.8;
  }

  toggleAutopilot() {
    if (this.state.crashed || this.state.grounded) return false;
    this.state.autopilot = !this.state.autopilot;
    this.holdAltitude = this.state.position.y;
    this.holdHeading = this.state.heading;
    this.holdPosition.copy(this.state.position);
    // From a free attitude, assist first returns to level flight, then holds what it has there.
    this.recovering = this.state.autopilot && this.type.flight.aerobatic;
    return this.state.autopilot;
  }

  toggleGear() {
    if (this.type.flight.rotorcraft) return true;
    this.state.gearDown = !this.state.gearDown;
    return this.state.gearDown;
  }

  cycleFlaps() {
    if (this.type.flight.rotorcraft) return 0;
    this.state.flaps = (this.state.flaps + 1) % 3;
    return this.state.flaps;
  }

  update(dt, inputs = {}) {
    if (this.state.crashed || !Number.isFinite(dt) || dt <= 0) return this.state;
    // A backgrounded tab must never move the aircraft through a mountain in one frame.
    const elapsed = Math.min(dt, 0.25);
    const steps = Math.max(1, Math.ceil(elapsed / 0.025));
    const controls = {
      pitch: clamp(Number(inputs.pitch) || 0, -1, 1),
      roll: clamp(Number(inputs.roll) || 0, -1, 1),
      yaw: clamp(Number(inputs.yaw) || 0, -1, 1),
      throttle: clamp(Number(inputs.throttle) || 0, -1, 1),
    };
    if (Math.abs(controls.pitch) + Math.abs(controls.roll) + Math.abs(controls.yaw) > (this.type.flight.rotorcraft ? 0.001 : 0.12)
      || (this.type.flight.rotorcraft && Math.abs(controls.throttle) > 0.001)) {
      this.state.autopilot = false;
    }
    for (let i = 0; i < steps && !this.state.crashed; i++) this.step(elapsed / steps, controls);
    return this.state;
  }

  step(dt, controls) {
    if (this.type.flight.rotorcraft) return stepHelicopter(this, dt, controls);
    const s = this.state;
    const f = this.type.flight;
    this.previousVelocity.set(0, 0, -s.speed).applyQuaternion(s.quaternion);
    this.previousVelocity.y = s.verticalSpeed;
    s.flightTime += dt;
    s.throttle = clamp(s.throttle + controls.throttle * dt * f.throttleRate, 0, 1);
    // Engine response lags the lever, slowest near idle.
    s.spool = mix(s.spool, s.throttle, s.spool < 0.35 ? f.spoolUp : f.spoolCruise, dt);
    s.afterburner = f.afterburnerFrom !== null && s.throttle >= f.afterburnerFrom && s.spool > f.afterburnerFrom - 0.05;
    const burner = s.afterburner ? clamp((s.spool - f.afterburnerFrom + 0.05) / (1.05 - f.afterburnerFrom), 0, 1) * f.afterburnerSpeed : 0;

    this.yawRate = mix(this.yawRate, controls.yaw * f.yawRate, 2.8, dt);
    // An aerobatic type flies a free body-axis attitude once airborne: no angle clamps and no self-leveling.
    const free = f.aerobatic && !s.grounded;
    if (free) {
      this.steerFree(dt, controls);
    } else if (s.autopilot) {
      const altitudeError = this.holdAltitude - s.position.y;
      const desiredPitch = clamp((altitudeError * 0.002 - s.verticalSpeed * 0.013) * f.autopilotGain, -0.16, 0.16);
      let headingError = this.holdHeading - s.heading;
      headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));
      s.pitch = mix(s.pitch, desiredPitch, 0.85, dt);
      s.bank = mix(s.bank, clamp(headingError * 1.6, -0.4, 0.4), 1.1, dt);
      this.pitchRate = mix(this.pitchRate, 0, 5, dt);
      this.rollRate = mix(this.rollRate, 0, 5, dt);
    } else {
      this.pitchRate = mix(this.pitchRate, controls.pitch * f.pitchRate, f.pitchResponse, dt);
      this.rollRate = mix(this.rollRate, controls.roll * f.rollRate, f.rollResponse, dt);
      s.pitch += this.pitchRate * dt;
      s.bank += this.rollRate * dt;
      // Soft self-stability makes cruising possible without continuous corrections.
      if (Math.abs(controls.roll) < 0.05) s.bank = mix(s.bank, 0, 0.17, dt);
      if (Math.abs(controls.pitch) < 0.05) s.pitch = mix(s.pitch, 0, 0.045, dt);
    }

    if (!free) {
      if (!f.aerobatic) {
        s.pitch = clamp(s.pitch, f.pitchLimits[0], f.pitchLimits[1]);
        s.bank = clamp(s.bank, -f.bankLimit, f.bankLimit);
      }
      s.bodyRates.pitch = s.bodyRates.roll = s.bodyRates.yaw = 0;
    }

    if (s.grounded) {
      s.stalled = false;
      this.stepGround(dt, controls, burner);
      this.setQuaternion();
      return;
    }

    const flapDrag = s.flaps * f.flapDrag;
    const gearDrag = s.gearDown ? f.gearDrag : 0;
    const bankDrag = Math.abs(Math.sin(s.bank)) * f.bankDrag;
    const climbDrag = Math.max(0, Math.sin(s.pitch)) * f.climbDrag;
    const diveGain = Math.max(0, -Math.sin(s.pitch)) * f.diveGain;
    const thrust = f.idleSpeed + s.spool * f.thrustSpeed + burner;
    const desiredSpeed = clamp(thrust - flapDrag - gearDrag - bankDrag - climbDrag + diveGain, f.minSpeed, f.maxSpeed);
    const nextSpeed = mix(s.speed, desiredSpeed, f.speedRate, dt);
    // A jet's acceleration is thrust-limited, so leaving the runway does not jump to the airborne target.
    s.speed = f.maxAcceleration ? Math.min(nextSpeed, s.speed + f.maxAcceleration * dt) : nextSpeed;

    const stallSpeed = f.stallSpeed - s.flaps * f.flapStallGain;
    s.stalled = s.speed < stallSpeed && !s.grounded;
    const stallAmount = clamp((stallSpeed + 4 - s.speed) / 12, 0, 1);
    if (s.stalled) {
      if (free) this.dropNose(1 - Math.exp(-(0.7 + stallAmount) * dt));
      else s.pitch = mix(s.pitch, -0.25, 0.7 + stallAmount, dt);
      s.autopilot = false;
    }

    const idleSink = Math.max(0, 0.32 - s.spool) * 6;
    const lowSpeedSink = stallAmount * stallAmount * 8;
    if (free) {
      this.turnFree(dt);
      // The flight path follows the nose; only the sink terms lag behind it.
      const forward = _forward.set(0, 0, -1).applyQuaternion(s.quaternion);
      const turnSink = Math.abs(Math.sin(s.bank)) * 0.9;
      s.verticalSpeed = mix(s.verticalSpeed, forward.y * s.speed - idleSink - lowSpeedSink - turnSink, 8, dt);
      s.position.x += forward.x * s.speed * dt;
      s.position.z += forward.z * s.speed * dt;
      s.position.y += s.verticalSpeed * dt;
      s.distance += Math.hypot(forward.x, forward.z) * s.speed * dt;
    } else {
      // Banking produces a coordinated turn; yaw adds a small rudder correction.
      const turnRate = GRAVITY * Math.tan(s.bank) / Math.max(s.speed, 24);
      s.heading = ((s.heading + (turnRate + this.yawRate) * dt) % TAU + TAU) % TAU;
      const turnSink = Math.abs(Math.sin(s.bank)) * 0.9;
      const targetVerticalSpeed = Math.sin(s.pitch) * s.speed - idleSink - lowSpeedSink - turnSink;
      s.verticalSpeed = mix(s.verticalSpeed, targetVerticalSpeed, 2.1, dt);

      const distance = Math.cos(s.pitch) * s.speed * dt;
      s.position.x += Math.sin(s.heading) * distance;
      s.position.z -= Math.cos(s.heading) * distance;
      s.position.y += s.verticalSpeed * dt;
      s.distance += distance;
    }

    if (!free) this.setQuaternion();
    // Specific force along the aircraft's up axis, from its actual flight-path velocity.
    // Quaternion axes stay continuous through vertical, knife-edge and inverted flight.
    this.acceleration.set(0, 0, -s.speed).applyQuaternion(s.quaternion);
    this.acceleration.y = s.verticalSpeed;
    this.acceleration.sub(this.previousVelocity).divideScalar(dt);
    this.acceleration.y += GRAVITY;
    this.aircraftUp.set(0, 1, 0).applyQuaternion(s.quaternion);
    s.gForce = this.acceleration.dot(this.aircraftUp) / GRAVITY;

    const ground = this.groundAt(s.position.x, s.position.z) + 2.8;
    if (s.position.y <= ground) {
      s.position.y = ground;
      const landable = this.heightAt(s.position.x, s.position.z) > 10.2 && s.gearDown && Math.abs(s.verticalSpeed) < f.maxTouchdownSink && s.speed < f.maxTouchdownSpeed && Math.abs(s.bank) < 0.3;
      if (landable) {
        s.grounded = true;
        s.gForce = 1;
        s.stalled = false;
        s.verticalSpeed = 0;
        s.autopilot = false;
      } else {
        s.crashed = true;
        s.crashReason = s.gearDown ? 'Hard landing' : 'Terrain collision';
        s.speed = 0;
        s.verticalSpeed = 0;
        s.autopilot = false;
      }
    }
    if (free) this.readAttitude();
  }

  stepGround(dt, controls, burner = 0) {
    const s = this.state;
    const f = this.type.flight;
    s.gForce = 1;
    // Rolling resistance stops an idle aircraft. Full power allows a takeoff roll.
    const targetSpeed = s.spool > 0.2 ? (s.spool - 0.2) * f.groundThrust + burner : 0;
    s.speed = mix(s.speed, targetSpeed, s.spool < 0.2 ? 0.35 : f.groundRate, dt);
    s.heading = ((s.heading + (controls.yaw + controls.roll * 0.6) * dt * 0.35) % TAU + TAU) % TAU;
    s.bank = mix(s.bank, 0, 5, dt);
    s.pitch = mix(s.pitch, Math.max(0, controls.pitch) * 0.12, 3, dt);
    const distance = s.speed * dt;
    s.position.x += Math.sin(s.heading) * distance;
    s.position.z -= Math.cos(s.heading) * distance;
    s.position.y = this.groundAt(s.position.x, s.position.z) + 2.8;
    s.distance += distance;
    if (s.speed > f.rotateSpeed - s.flaps * f.flapStallGain && controls.pitch > 0.15) {
      s.grounded = false;
      // A free-attitude aircraft keeps the nose where the rotation put it; the Vela J8 resets to its climb angle.
      s.pitch = f.aerobatic ? Math.max(s.pitch, 0.10) : 0.10;
      s.verticalSpeed = 2.5;
      s.position.y += 0.5;
    }
  }

  setQuaternion() {
    const s = this.state;
    this.attitude.set(s.pitch, -s.heading, -s.bank, 'YXZ');
    s.quaternion.setFromEuler(this.attitude);
    this.seen = [s.pitch, s.bank, s.heading];
  }

  /** Derives the displayed pitch (±90°), bank (±180°) and heading (0–360°) from the free attitude. */
  readAttitude() {
    const s = this.state;
    _euler.setFromQuaternion(s.quaternion, 'YXZ');
    s.pitch = _euler.x;
    s.bank = -_euler.z;
    s.heading = ((-_euler.y % TAU) + TAU) % TAU;
    this.seen = [s.pitch, s.bank, s.heading];
  }

  /**
   * Rotates a free attitude about the body axes. Pitch, roll and yaw are rates, so the nose can go over
   * the top and the wings all the way round; released controls damp the rates and hold the attitude.
   */
  steerFree(dt, controls) {
    const s = this.state;
    const f = this.type.flight;
    const q = s.quaternion;
    // Writing pitch, bank or heading directly (a restore, a test) re-seeds the attitude.
    if (s.pitch !== this.seen[0] || s.bank !== this.seen[1] || s.heading !== this.seen[2]) this.setQuaternion();
    _prev.copy(q);
    if (s.autopilot) {
      const altitudeError = this.holdAltitude - s.position.y;
      let desiredPitch = clamp((altitudeError * 0.002 - s.verticalSpeed * 0.013) * f.autopilotGain, -0.16, 0.16);
      let headingError = this.holdHeading - s.heading;
      headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));
      let desiredBank = clamp(headingError * 1.6, -0.4, 0.4);
      if (this.recovering) desiredPitch = desiredBank = 0;
      // From any attitude, assist turns the short way to a near-level target at a capped rate.
      _q.setFromEuler(_euler.set(desiredPitch, -s.heading, -desiredBank, 'YXZ'));
      const angle = q.angleTo(_q);
      if (this.recovering && angle < 0.05) {
        this.recovering = false;
        this.holdAltitude = s.position.y;
        this.holdHeading = s.heading;
      }
      q.rotateTowards(_q, Math.min(angle * (1 - Math.exp(-(this.recovering ? 3 : 1) * dt)), ASSIST_RECOVERY_RATE * dt));
      this.pitchRate = mix(this.pitchRate, 0, 5, dt);
      this.rollRate = mix(this.rollRate, 0, 5, dt);
    } else {
      this.pitchRate = mix(this.pitchRate, controls.pitch * f.pitchRate, f.pitchResponse, dt);
      this.rollRate = mix(this.rollRate, controls.roll * f.rollRate, f.rollResponse, dt);
      _axis.set(this.pitchRate, -this.yawRate, -this.rollRate);
      const angle = _axis.length() * dt;
      if (angle > 0) q.multiply(_q.setFromAxisAngle(_axis.normalize(), angle));
    }
    q.normalize();
    // Body rates of this step feed the control-surface animation.
    _q.copy(_prev).invert().multiply(q);
    const sign = _q.w < 0 ? -2 / dt : 2 / dt;
    Object.assign(s.bodyRates, { pitch: _q.x * sign, yaw: -_q.y * sign, roll: -_q.z * sign });
    this.readAttitude();
  }

  /** Lift tilted with the wings turns the flight path about the vertical, as the Euler model's coordinated turn. */
  turnFree(dt) {
    const s = this.state;
    const up = _up.set(0, 1, 0).applyQuaternion(s.quaternion);
    const side = -_right.set(1, 0, 0).applyQuaternion(s.quaternion).y;
    // 1 / cos(bank) when upright, eased to 1 through knife-edge so the turn rate stays continuous inverted.
    const gain = up.y >= 0.35 ? 1 / up.y : up.y > 0 ? 1 + up.y * (1 / 0.35 - 1) / 0.35 : 1;
    const turnRate = GRAVITY * side * gain / Math.max(s.speed, 24);
    s.quaternion.premultiply(_q.setFromAxisAngle(WORLD_UP, -turnRate * dt)).normalize();
  }

  /** A stall lets the nose fall towards 14° below the horizon, whatever the attitude. */
  dropNose(amount) {
    const s = this.state;
    const forward = _forward.set(0, 0, -1).applyQuaternion(s.quaternion);
    const pitch = Math.asin(clamp(forward.y, -1, 1));
    if (pitch <= -0.25) return;
    _axis.crossVectors(forward, _up.set(0, -1, 0));
    if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0).applyQuaternion(s.quaternion);
    s.quaternion.premultiply(_q.setFromAxisAngle(_axis.normalize(), (pitch + 0.25) * amount)).normalize();
  }
}

/**
 * A chase-camera frame that follows the nose through loops and vertical flight without heading flips.
 * It does not roll with the aircraft, and eases back to the horizon whenever the pilot is not pulling.
 */
export class FollowFrame {
  constructor() {
    this.quaternion = new THREE.Quaternion();
  }

  reset(quaternion) {
    this.quaternion.copy(quaternion);
    this.level(Math.PI);
    return this.quaternion;
  }

  update(quaternion, dt, pitchRate = 0) {
    const from = _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const to = _axis.set(0, 0, -1).applyQuaternion(quaternion);
    this.quaternion.premultiply(_q.setFromUnitVectors(from, to)).normalize();
    const settle = 1 - clamp(Math.abs(pitchRate) / 0.4, 0, 1);
    this.level(1.2 * dt * settle);
    return this.quaternion;
  }

  /** Rolls the frame about its forward axis towards wings-level, by at most maxAngle. */
  level(maxAngle) {
    const forward = _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const horizontal = 1 - forward.y * forward.y;
    if (horizontal < 0.02 || maxAngle <= 0) return;
    const up = _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const target = _right.copy(WORLD_UP).addScaledVector(forward, -forward.y).normalize();
    const error = Math.atan2(_axis.crossVectors(up, target).dot(forward), up.dot(target));
    const step = clamp(error, -maxAngle * horizontal, maxAngle * horizontal);
    this.quaternion.premultiply(_q.setFromAxisAngle(forward, step)).normalize();
  }
}

/** Mix levels for the twin turbofans at a given engine spool (0–1) and airspeed (m/s). */
export function jetSound(spool, speed = 0) {
  const n1 = clamp(Number(spool) || 0, 0, 1);
  const airspeed = clamp(Number(speed) || 0, 0, 150);
  return {
    whine: 900 + n1 * 2600,          // compressor tone, Hz
    whineGain: 0.012 + n1 * 0.026,
    fan: 110 + n1 * 190,             // fan blade-pass hum, Hz
    fanGain: 0.05 + n1 * 0.05,
    roar: 260 + n1 * 820,            // exhaust band centre, Hz
    roarGain: 0.05 + n1 * n1 * 0.38,
    rumbleGain: 0.04 + n1 * n1 * 0.3,
    wind: clamp(airspeed / 480, 0.015, 0.3),
    master: 0.42 + n1 * 0.3,
  };
}

/** Mix levels for the fighter's single turbofan at a spool (0–1), airspeed (m/s) and afterburner state. */
export function fighterSound(spool, speed = 0, afterburner = false) {
  const n1 = clamp(Number(spool) || 0, 0, 1);
  const airspeed = clamp(Number(speed) || 0, 0, 285);
  return {
    whine: 1100 + n1 * 3100,          // compressor tone, Hz
    whineGain: 0.03 + n1 * 0.03,
    roar: 220 + n1 * 900,             // exhaust band centre, Hz
    roarGain: 0.16 + n1 * n1 * 0.4,
    rumbleGain: 0.14 + n1 * n1 * 0.3,
    burnerGain: afterburner ? 0.55 : 0, // the reheat adds a deep, ragged rumble
    wind: clamp(airspeed / 700, 0.015, 0.32),
    master: 0.6 + n1 * 0.3 + (afterburner ? 0.08 : 0),
  };
}

/** Rotor blade-pass thrum, turbine whine and cabin airflow; RPM is independent of collective. */
export function helicopterSound(rotorSpeed, collective = 0.58, speed = 0) {
  const rpm = clamp(Number(rotorSpeed) || 0, 0, 1), load = clamp(Number(collective) || 0, 0, 1);
  return {
    bladePass: rpm * 38 / (2 * Math.PI) * 3, // three blades at the model’s 363 RPM
    rotor: 38 + rpm * 54,
    rotorGain: rpm * (0.08 + load * 0.12),
    chopGain: rpm * (0.12 + load * 0.16),
    turbine: 600 + rpm * 1400 + load * 220,
    turbineGain: rpm * 0.018,
    wind: clamp((Number(speed) || 0) / 350, 0, 0.2),
    master: rpm * (0.55 + load * 0.18),
  };
}

/** Synthesized engines, slipstream and warning horns for every aircraft. Start from a user gesture. */
export class FlightAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.stallActive = false;
    this.stallHorn = null;
  }

  async start() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) {
      const ctx = new AudioContext();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      this.gearHorn = ctx.createGain();
      this.gearHorn.gain.value = 0;
      this.gearHorn.connect(this.master);
      const horn = ctx.createOscillator();
      horn.type = 'square';
      horn.frequency.value = 400;
      horn.connect(this.gearHorn);
      horn.start();
      const noise = (brown) => {
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let previous = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          previous = brown ? (previous + white * 0.035) / 1.035 : white;
          data[i] = brown ? previous * 3.5 : white * 0.5;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.start();
        return source;
      };
      // Each aircraft's engine voices run on their own bus so switching type is a gain change.
      this.jetBus = ctx.createGain();
      this.jetBus.connect(this.master);
      this.fighterBus = ctx.createGain();
      this.fighterBus.gain.value = 0;
      this.fighterBus.connect(this.master);
      this.helicopterBus = ctx.createGain();
      this.helicopterBus.gain.value = 0;
      this.helicopterBus.connect(this.master);
      const voice = (input, type, frequency, q, bus = this.jetBus) => {
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        input.connect(filter).connect(gain).connect(bus);
        return { filter, gain };
      };
      const exhaust = noise(false);
      this.helicopter = { rotor: ctx.createOscillator(), turbine: ctx.createOscillator(), pulse: ctx.createOscillator() };
      const heli = this.helicopter;
      heli.rotor.type = 'triangle'; heli.rotor.start();
      heli.rotorVoice = voice(heli.rotor, 'lowpass', 220, 0.6, this.helicopterBus);
      heli.turbine.type = 'sine'; heli.turbine.start();
      heli.turbineVoice = voice(heli.turbine, 'highpass', 500, 0.5, this.helicopterBus);
      heli.chop = voice(exhaust, 'lowpass', 180, 0.6, this.helicopterBus);
      // Blade-pass modulation chops the broadband rotor wash into a synthesized rotor beat.
      heli.pulse.type = 'sine'; heli.pulse.start(); heli.depth = ctx.createGain();
      heli.pulse.connect(heli.depth).connect(heli.chop.gain.gain);
      this.roar = voice(exhaust, 'bandpass', 400, 0.7);
      this.rumble = voice(exhaust, 'lowpass', 140, 0.5);
      this.fighter = {
        roar: voice(exhaust, 'bandpass', 400, 0.7, this.fighterBus),
        rumble: voice(exhaust, 'lowpass', 150, 0.5, this.fighterBus),
        whine: ctx.createOscillator(),
      };
      this.fighter.whine.type = 'sine';
      this.fighter.whine.frequency.value = 1100;
      this.fighter.whine.start();
      this.fighter.whineVoice = voice(this.fighter.whine, 'highpass', 700, 0.4, this.fighterBus);
      // Two slightly detuned compressors beat against each other, like a real twin.
      this.whines = [1, 1.012].map(ratio => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 900 * ratio;
        osc.start();
        return { osc, ratio, ...voice(osc, 'highpass', 600, 0.4) };
      });
      this.fan = ctx.createOscillator();
      this.fan.type = 'triangle';
      this.fan.frequency.value = 110;
      this.fan.start();
      this.fanVoice = voice(this.fan, 'lowpass', 520, 0.6);
      this.wind = ctx.createGain();
      this.wind.gain.value = 0.05;
      const slipstream = noise(true);
      slipstream.connect(this.wind).connect(this.master);
      this.fighter.burner = voice(slipstream, 'lowpass', 90, 0.9, this.fighterBus);
    }
    this.enabled = true;
    try { await this.context.resume(); } catch { this.enabled = false; }
    return this.enabled;
  }

  toggle() {
    if (!this.enabled) {
      void this.start();
      return true;
    }
    this.enabled = false;
    this.stallActive = false;
    this.stopStallHorn();
    this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
    return false;
  }

  soundStallHorn() {
    const ctx = this.context;
    const now = ctx.currentTime;
    const horn = ctx.createOscillator();
    const gain = ctx.createGain();
    horn.type = 'square';
    horn.frequency.value = 640;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.015);
    gain.gain.setValueAtTime(0.22, now + 0.28);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);
    horn.connect(gain).connect(this.master);
    this.stallHorn = horn;
    horn.onended = () => {
      horn.disconnect();
      gain.disconnect();
      if (this.stallHorn === horn) this.stallHorn = null;
    };
    horn.start(now);
    horn.stop(now + 0.35);
  }

  stopStallHorn() {
    this.stallHorn?.stop();
    this.stallHorn = null;
  }

  update(state, gearWarning = false) {
    if (!this.context || !this.master) return;
    const helicopter = state.aircraft === 'helicopter';
    const stalled = !helicopter && this.enabled && state.stalled && !state.grounded && !state.crashed;
    if (stalled && !this.stallActive) this.soundStallHorn();
    if (!stalled) this.stopStallHorn();
    this.stallActive = stalled;
    const now = this.context.currentTime;
    this.gearHorn.gain.setTargetAtTime(this.enabled && !state.crashed && !helicopter && gearWarning ? 0.12 : 0, now, 0.03);
    const fighter = state.aircraft === 'fighter';
    this.jetBus.gain.setTargetAtTime(fighter || helicopter ? 0 : 1, now, 0.08);
    this.fighterBus.gain.setTargetAtTime(fighter ? 1 : 0, now, 0.08);
    this.helicopterBus.gain.setTargetAtTime(helicopter ? 1 : 0, now, 0.08);
    if (helicopter) {
      const h = helicopterSound(state.rotorSpeed, state.spool ?? state.throttle, state.speed), v = this.helicopter;
      v.rotor.frequency.setTargetAtTime(h.rotor, now, 0.12);
      v.rotorVoice.gain.gain.setTargetAtTime(h.rotorGain, now, 0.12);
      v.pulse.frequency.setTargetAtTime(h.bladePass, now, 0.12);
      v.chop.gain.gain.setTargetAtTime(h.chopGain, now, 0.12);
      v.depth.gain.setTargetAtTime(h.chopGain * 0.8, now, 0.12);
      v.turbine.frequency.setTargetAtTime(h.turbine, now, 0.2);
      v.turbineVoice.gain.gain.setTargetAtTime(h.turbineGain, now, 0.2);
      this.wind.gain.setTargetAtTime(h.wind, now, 0.2);
      this.master.gain.setTargetAtTime(this.enabled && !state.crashed ? h.master : 0, now, 0.1);
      return;
    }
    if (fighter) {
      const f = fighterSound(state.spool ?? state.throttle, state.speed, state.afterburner), v = this.fighter;
      v.whine.frequency.setTargetAtTime(f.whine, now, 0.25);
      v.whineVoice.gain.gain.setTargetAtTime(f.whineGain, now, 0.25);
      v.roar.filter.frequency.setTargetAtTime(f.roar, now, 0.3);
      v.roar.gain.gain.setTargetAtTime(f.roarGain, now, 0.3);
      v.rumble.gain.gain.setTargetAtTime(f.rumbleGain, now, 0.3);
      v.burner.gain.gain.setTargetAtTime(f.burnerGain, now, 0.2);
      this.wind.gain.setTargetAtTime(f.wind, now, 0.3);
      this.master.gain.setTargetAtTime(this.enabled && !state.crashed ? f.master : 0, now, 0.15);
      return;
    }
    const mix = jetSound(state.spool ?? state.throttle, state.speed);
    for (const { osc, ratio, gain } of this.whines) {
      osc.frequency.setTargetAtTime(mix.whine * ratio, now, 0.25);
      gain.gain.setTargetAtTime(mix.whineGain, now, 0.25);
    }
    this.fan.frequency.setTargetAtTime(mix.fan, now, 0.25);
    this.fanVoice.gain.gain.setTargetAtTime(mix.fanGain, now, 0.25);
    this.roar.filter.frequency.setTargetAtTime(mix.roar, now, 0.3);
    this.roar.gain.gain.setTargetAtTime(mix.roarGain, now, 0.3);
    this.rumble.gain.gain.setTargetAtTime(mix.rumbleGain, now, 0.3);
    this.wind.gain.setTargetAtTime(mix.wind, now, 0.3);
    this.master.gain.setTargetAtTime(this.enabled && !state.crashed ? mix.master : 0, now, 0.15);
  }
}

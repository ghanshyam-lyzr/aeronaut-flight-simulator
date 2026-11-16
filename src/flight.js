import * as THREE from 'three';
import { FLEET, aircraftType, DEFAULT_AIRCRAFT } from './fleet.js';
import { stepHelicopter } from './helicopter-flight.js';
import { angularResponse } from './handling.js';
import { Wind } from './wind.js';
import { stallSpeed } from './stall.js';
import { numerics } from './wasm/runtime.js';
import { updateWasmFlight } from './wasm/flight.js';

const clamp = THREE.MathUtils.clamp;
const mix = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;
const GRAVITY = 9.81;
// Velocity differences need a resolved interval. Shorter input slices still move the aircraft and wind clock;
// their load measurement spans the preceding resolved interval instead of amplifying subtraction roundoff.
const LOAD_SAMPLE_INTERVAL = 1e-6;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Flight assist turns a free-attitude aircraft back to level no faster than this, in rad/s.
const ASSIST_RECOVERY_RATE = 1.2;
const _q = new THREE.Quaternion(), _prev = new THREE.Quaternion(), _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3(), _axis = new THREE.Vector3();
const _gustBefore = { x: 0, z: 0 }, _windSample = {};

/**
 * Full wheel-brake deceleration in m/s², added to rolling resistance while grounded. Light singles with good brakes
 * stop hardest; the tailwheel biplane, the single-wheel motorglider and the heavy jets and freighters brake gentler,
 * and land faster, so they need more runway. Arcade tuning, not certified stopping performance.
 */
export const BRAKE_DECELERATION = Object.freeze({
  bush: 3.4, trainer: 3, utility: 3, jet: 3, pushpull: 2.9, aerobatic: 2.8, commuter: 2.8, fighter: 2.7,
  canard: 2.6, racer: 2.6, cityliner: 2.6, regional: 2.6, airliner: 2.4, interceptor: 2.4,
  biplane: 2.2, widebody: 2.1, cargo: 2, motorglider: 2,
});

/** A fixed-wing type's full braking deceleration; helicopters have none (their ground translation is frozen). */
export function brakeDeceleration(type) {
  if (type.flight.rotorcraft) return 0;
  return type.flight.brakeDeceleration ?? BRAKE_DECELERATION[type.id] ?? 2.5;
}

/**
 * Pitch trim, in radians of stick-free pitch attitude: the attitude a conventional (attitude-limited) aircraft settles
 * to with the stick released, on top of its own neutral (level, or a glider's idle glide). Held trim moves at a fixed
 * 2°/s up to ±8°; released, it stays put. Free-attitude types already hold any attitude hands-off, so they have none.
 */
export const TRIM_LIMIT = 8 * Math.PI / 180;
export const TRIM_RATE = 2 * Math.PI / 180;

/** Whether a type has pilot pitch trim: fixed-wing types that self-level, not helicopters or free-attitude aerobatic types. */
export function hasPitchTrim(type) {
  return !type.flight.rotorcraft && !type.flight.aerobatic;
}

/** Vela J8 performance, in metres per second. Speeds are tuned for the valley, not a certified type. */
export const JET = FLEET.jet.flight;

/**
 * A pilot-selected heading in whole degrees, 0–359 (360 reads as 000), or null for anything that is not a finite
 * number: an empty field, text, NaN, Infinity, a boolean or an object. Negative and over-360 values wrap.
 */
export function normalizeHeadingTarget(value) {
  if (typeof value === 'string') value = value.trim() === '' ? NaN : Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return ((Math.round(value) % 360) + 360) % 360;
}

/** Whether a type has the selectable heading bug: every fixed-wing type; helicopters keep their hover hold. */
export function hasHeadingSelect(type) {
  return !type.flight.rotorcraft;
}

/**
 * A forgiving, coordinated-turn flight model. All distances are metres.
 *
 * Wind (src/wind.js): the controller owns one Wind, advanced only by its own physics steps, so it freezes whenever
 * update() is not called (pause, dialogs) and restarts from time zero on every reset. state.windVelocity ({x, 0, z},
 * m/s) is the midpoint wind used for displacement; endpoint samples measure the change over this step for inertia
 * and load factor. Air-relative and ground-relative motion are kept apart:
 * - Fixed-wing state.speed is true airspeed in the air: thrust, drag, stall, turn rate and the speed tape use it.
 *   The aircraft moves at that airspeed along its nose plus the wind, so a crosswind drifts it and a headwind slows
 *   it over the ground; state.distance and every consumer of groundVelocity() (src/flight-path.js) follow that
 *   ground travel. A change in the wind along the nose (a gust, a new preset blending in) briefly changes airspeed
 *   by the opposite amount, as inertia does; a constant wind changes nothing but the ground track, so it adds no
 *   load factor.
 * - On the ground the wheels hold the aircraft: no sideways drift, and state.speed is the wheel (ground) speed of the
 *   existing ground-roll and brake model. Approximation: rotation compares the airspeed (wheel speed plus headwind)
 *   with the rotate speed, liftoff carries that airspeed into the air, and touchdown turns airspeed back into wheel
 *   speed along the heading (plus tailwind); the crosswind component simply vanishes on the tyres and returns on
 *   liftoff. state.airspeed always holds the airspeed for display, on the ground as in the air.
 * - Helicopters keep state.velocity as their ground velocity; rotor drag acts on the velocity through the air, so
 *   a level disc drifts with the wind, and hover hold leans into it to keep its ground-fixed point.
 * setWind(config) changes the wind smoothly and returns the previous configuration (see Wind.set).
 */
export class FlightController {
  constructor(heightAt = () => 0, aircraft = DEFAULT_AIRCRAFT, { engine = 'auto' } = {}) {
    this.engine = engine;
    this.heightAt = heightAt;
    this.type = aircraftType(aircraft);
    this.wind = new Wind();
    this.state = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), windVelocity: new THREE.Vector3() };
    this.windEndpoint = new THREE.Vector3();
    this.holdPosition = new THREE.Vector3();
    this.attitude = new THREE.Euler(0, 0, 0, 'YXZ');
    this.previousVelocity = new THREE.Vector3();
    this.loadVelocity = new THREE.Vector3();
    this.loadPreviousVelocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.aircraftUp = new THREE.Vector3();
    this.rotationStep = new THREE.Vector3();
    this.reset();
  }

  get backend() { return this.engine !== 'javascript' && numerics() ? 'webassembly' : 'javascript'; }

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
      brake: 0,
      pitchTrim: 0,
      heading: 0,
      pitch: 0,
      bank: 0,
      verticalSpeed: 0,
      gForce: 1,
      gearDown: !!f.rotorcraft || !!this.type.fixedGear,
      rotorSpeed: f.rotorcraft ? 1 : 0,
      flaps: 0,
      crashed: false,
      stalled: false,
      grounded: false,
      flightTime: 0,
      distance: 0,
      autopilot: false,
      // The heading bug: a selected heading in degrees (null until chosen), held only while headingHold is on.
      selectedHeading: null,
      headingHold: false,
      crashReason: '',
      touchdown: null,
      bodyRates: { pitch: 0, roll: 0, yaw: 0 },
    });
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.resetLoadSample();
    // A fresh start replays the wind from time zero (the configuration is kept).
    this.wind.reset();
    this.sampleWindNow();
    s.airspeed = s.speed;
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

  /**
   * Sets the wind (a preset id or a configuration; see src/wind.js normalizeWind) and returns the previous
   * configuration. By default the new wind blends in over a few simulation seconds; { immediate: true } applies it at
   * once, for a start or an activity's setup. An activity applies its own wind and restores the pilot's afterwards:
   *   const previous = flight.setWind(practiceWind, { immediate: true }); … flight.setWind(previous);
   */
  setWind(config, options) {
    const previous = this.wind.set(config, options);
    if (options?.immediate) { this.sampleWindNow(); this.resetLoadSample(); }
    return previous;
  }

  /** A frozen summary of the wind now (configuration, clock, air velocity, speed, direction, gust factor). */
  windSnapshot() { return this.wind.snapshot(); }

  /** The wind at the controller's current wind time (read-only for callers; see src/wind.js Wind.sample). */
  sampleWind(target = {}) { return this.wind.sample(this.wind.time, target); }

  sampleWindNow() {
    const w = this.wind.sample(this.wind.time, _windSample);
    this.state.windVelocity.set(w.x, 0, w.z);
    this.windEndpoint.copy(this.state.windVelocity);
  }

  /** Midpoint wind carries this interval; endpoint differences span exactly dt, including a tiny partial slice. */
  advanceWind(dt) {
    const w = this.state.windVelocity;
    _gustBefore.x = this.windEndpoint.x; _gustBefore.z = this.windEndpoint.z;
    this.wind.sample(this.wind.time + dt / 2, _windSample);
    w.set(_windSample.x, 0, _windSample.z);
    this.wind.sample(this.wind.time + dt, _windSample);
    this.windEndpoint.set(_windSample.x, 0, _windSample.z);
    this.wind.advance(dt);
    return w;
  }

  resetLoadSample() { this.loadElapsed = 0; this.loadPreviousElapsed = 0; }

  /** Consumes the new endpoint velocity in this.acceleration and reports specific force along the aircraft's up axis. */
  sampleLoadFactor(dt) {
    if (this.loadElapsed === 0) this.loadVelocity.copy(this.previousVelocity);
    this.loadElapsed += dt;
    const resolved = this.loadElapsed >= LOAD_SAMPLE_INTERVAL;
    if (resolved || this.loadPreviousElapsed > 0) {
      // Include the preceding interval until the current one spans enough time to resolve its own velocity change.
      const elapsed = resolved ? this.loadElapsed : this.loadPreviousElapsed + this.loadElapsed;
      this.acceleration.sub(resolved ? this.loadVelocity : this.loadPreviousVelocity).divideScalar(elapsed);
      this.acceleration.y += GRAVITY;
      this.aircraftUp.set(0, 1, 0).applyQuaternion(this.state.quaternion);
      this.state.gForce = this.acceleration.dot(this.aircraftUp) / GRAVITY;
    }
    if (resolved) {
      this.loadPreviousVelocity.copy(this.loadVelocity);
      this.loadPreviousElapsed = this.loadElapsed;
      this.loadElapsed = 0;
    }
  }

  groundAt(x, z) {
    const height = this.heightAt(x, z);
    return Math.max(10, Number.isFinite(height) ? height : 0);
  }

  get gearWarning() {
    const s = this.state;
    // 1,000 feet is exactly 304.8 metres; both thresholds are exclusive.
    return !this.type.flight.rotorcraft && !this.type.fixedGear && !s.gearDown && s.throttle < 0.2
      && s.position.y < this.groundAt(s.position.x, s.position.z) + 304.8;
  }

  toggleAutopilot() {
    if (this.state.crashed || this.state.grounded) return false;
    this.state.autopilot = !this.state.autopilot;
    // Space and the assist switch capture the current heading, never the bug; the selection stays, inactive.
    this.state.headingHold = false;
    this.holdAltitude = this.state.position.y;
    this.holdHeading = this.state.heading;
    this.holdPosition.copy(this.state.position);
    // From a free attitude, assist first returns to level flight, then holds what it has there.
    this.recovering = this.state.autopilot && this.type.flight.aerobatic;
    return this.state.autopilot;
  }

  /**
   * Selects a heading for flight assist (any value normalizeHeadingTarget accepts) and returns it, or null when the
   * value is invalid or the type has no heading bug, leaving the selection unchanged. Choosing a value never steers
   * or engages assist; while assist is already on it retargets the held heading and keeps the held altitude.
   */
  setHeadingTarget(value) {
    const heading = normalizeHeadingTarget(value);
    if (heading === null || !hasHeadingSelect(this.type)) return null;
    const s = this.state;
    s.selectedHeading = heading;
    if (s.autopilot) {
      s.headingHold = true;
      // A free-attitude recovery keeps levelling; it takes up the selection once level (see steerFree).
      if (!this.recovering) this.holdHeading = heading * Math.PI / 180;
    }
    return heading;
  }

  /**
   * Engages flight assist on the selected heading, holding the current altitude. Refused (false) without a
   * selection, on the ground, after a crash or in a helicopter. Free-attitude types level out first.
   */
  holdSelectedHeading() {
    const s = this.state;
    if (s.selectedHeading === null || s.crashed || s.grounded || !hasHeadingSelect(this.type)) return false;
    if (!s.autopilot) this.toggleAutopilot();
    return this.setHeadingTarget(s.selectedHeading) !== null && s.autopilot;
  }

  /** Forgets the selection. A heading hold in progress becomes an ordinary hold of the heading flown now. */
  clearHeadingTarget() {
    const s = this.state;
    if (s.headingHold && !this.recovering) this.holdHeading = s.heading;
    s.selectedHeading = null;
    s.headingHold = false;
  }

  toggleGear() {
    if (this.type.flight.rotorcraft || this.type.fixedGear) return true;
    this.state.gearDown = !this.state.gearDown;
    return this.state.gearDown;
  }

  cycleFlaps() {
    if (this.type.flight.rotorcraft || this.type.noFlaps) return 0;
    this.state.flaps = (this.state.flaps + 1) % 3;
    return this.state.flaps;
  }

  update(dt, inputs = {}) {
    if (this.state.crashed || !Number.isFinite(dt) || dt <= 0) return this.state;
    if (this.backend === 'webassembly') return updateWasmFlight(this, dt, inputs, brakeDeceleration);
    // A backgrounded tab must never move the aircraft through a mountain in one frame.
    const elapsed = Math.min(dt, 0.25);
    const steps = Math.max(1, Math.ceil(elapsed / 0.025));
    const controls = {
      pitch: clamp(Number(inputs.pitch) || 0, -1, 1),
      roll: clamp(Number(inputs.roll) || 0, -1, 1),
      yaw: clamp(Number(inputs.yaw) || 0, -1, 1),
      throttle: clamp(Number(inputs.throttle) || 0, -1, 1),
      brake: clamp(Number(inputs.brake) || 0, 0, 1),
      trim: clamp(Number(inputs.trim) || 0, -1, 1),
    };
    if (Math.abs(controls.pitch) + Math.abs(controls.roll) + Math.abs(controls.yaw) > (this.type.flight.rotorcraft ? 0.001 : 0.12)
      || (this.type.flight.rotorcraft && Math.abs(controls.throttle) > 0.001)) {
      this.state.autopilot = false;
    }
    for (let i = 0; i < steps && !this.state.crashed; i++) this.step(elapsed / steps, controls);
    // Whatever ended assist (manual input, a stall, touchdown, a crash) also ends the heading hold.
    if (!this.state.autopilot) this.state.headingHold = false;
    return this.state;
  }

  step(dt, controls) {
    if (this.type.flight.rotorcraft) stepHelicopter(this, dt, controls);
    else this.stepFixedWing(dt, controls);
    const s = this.state, w = s.windVelocity;
    if (this.type.flight.rotorcraft) s.airspeed = s.grounded ? Math.hypot(w.x, w.z) : s.speed;
    else s.airspeed = s.grounded ? Math.max(0, s.speed - this.alongWind(w)) : s.speed;
  }

  /** The wind's component (m/s) along the horizontal heading: positive is a tailwind. */
  alongWind(w, heading = this.state.heading) {
    return w.x * Math.sin(heading) - w.z * Math.cos(heading);
  }

  stepFixedWing(dt, controls) {
    const s = this.state;
    const f = this.type.flight;
    // Inertial velocity at this step's start, using wind at the same endpoint as the air-relative velocity.
    this.previousVelocity.set(0, 0, -s.speed).applyQuaternion(s.quaternion);
    this.previousVelocity.y = s.verticalSpeed;
    this.previousVelocity.x += this.windEndpoint.x;
    this.previousVelocity.z += this.windEndpoint.z;
    const wind = this.advanceWind(dt);
    // Inertia: a change in the wind along the flight path changes airspeed by the opposite amount (a headwind gust
    // raises it). A constant wind changes nothing here.
    if (!s.grounded) {
      const cp = Math.cos(s.pitch);
      const along = ((this.windEndpoint.x - _gustBefore.x) * Math.sin(s.heading) - (this.windEndpoint.z - _gustBefore.z) * Math.cos(s.heading)) * cp;
      if (along) s.speed = Math.max(0, s.speed - along);
    }
    s.flightTime += dt;
    // Wheel brakes act only through the tyres: never in the air, never as a speed brake.
    s.brake = 0;
    s.throttle = clamp(s.throttle + controls.throttle * dt * f.throttleRate, 0, 1);
    // Engine response lags the lever, slowest near idle.
    s.spool = mix(s.spool, s.throttle, s.spool < 0.35 ? f.spoolUp : f.spoolCruise, dt);
    s.afterburner = f.afterburnerFrom !== null && s.throttle >= f.afterburnerFrom && s.spool > f.afterburnerFrom - 0.05;
    // The trim wheel turns at a fixed rate while held, in the air or on the ground, with assist on or off.
    const trimBefore = s.pitchTrim;
    if (controls.trim && hasPitchTrim(this.type)) s.pitchTrim = clamp(s.pitchTrim + controls.trim * TRIM_RATE * dt, -TRIM_LIMIT, TRIM_LIMIT);
    const burner = s.afterburner ? clamp((s.spool - f.afterburnerFrom + 0.05) / (1.05 - f.afterburnerFrom), 0, 1) * f.afterburnerSpeed : 0;

    const pitch = angularResponse(this.pitchRate, controls.pitch * f.pitchRate, f.pitchResponse, dt);
    const roll = angularResponse(this.rollRate, controls.roll * f.rollRate, f.rollResponse, dt);
    // Rudder response follows the airframe's inertia, like elevator and ailerons.
    const yaw = angularResponse(this.yawRate, controls.yaw * f.yawRate, f.yawResponse ?? f.pitchResponse, dt);
    this.pitchRate = pitch.rate;
    this.rollRate = roll.rate;
    this.yawRate = yaw.rate;
    this.rotationStep.set(pitch.angle, -yaw.angle, -roll.angle);
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
      s.pitch += pitch.angle;
      s.bank += roll.angle;
      // Soft self-stability makes cruising possible without continuous corrections.
      s.bank = mix(s.bank, 0, 0.17 * clamp((0.1 - Math.abs(controls.roll)) / 0.05, 0, 1), dt);
      // A glider's released stick settles to its idle-power glide attitude rather than level.
      // Airborne, pilot trim moves that stick-free attitude; on the runway, rotation keeps its own behaviour.
      const stickFree = clamp((0.1 - Math.abs(controls.pitch)) / 0.05, 0, 1);
      const trim = (f.glidePitch ? -f.glidePitch * clamp(1 - s.spool / 0.32, 0, 1) : 0) + (s.grounded ? 0 : s.pitchTrim);
      // While the wheel turns, the released nose follows it towards the new trimmed attitude, never past it.
      const turned = s.grounded ? 0 : (s.pitchTrim - trimBefore) * stickFree;
      if (turned > 0 && s.pitch < trim) s.pitch = Math.min(trim, s.pitch + turned);
      else if (turned < 0 && s.pitch > trim) s.pitch = Math.max(trim, s.pitch + turned);
      s.pitch = mix(s.pitch, trim, 0.045 * stickFree, dt);
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

    const effectiveStall = stallSpeed(this.type, s.flaps, s);
    s.stalled = s.speed < effectiveStall;
    const stallAmount = clamp((effectiveStall + 4 - s.speed) / 12, 0, 1);
    if (s.stalled) {
      if (free) this.dropNose(1 - Math.exp(-(0.7 + stallAmount) * dt));
      else s.pitch = mix(s.pitch, -0.25, 0.7 + stallAmount, dt);
      s.autopilot = false;
    }

    const idleSink = Math.max(0, 0.32 - s.spool) * (f.idleSink ?? 6);
    const lowSpeedSink = stallAmount * stallAmount * 8;
    if (free) {
      this.turnFree(dt);
      // The flight path follows the nose; only the sink terms lag behind it.
      const forward = _forward.set(0, 0, -1).applyQuaternion(s.quaternion);
      const turnSink = Math.abs(Math.sin(s.bank)) * 0.9;
      s.verticalSpeed = mix(s.verticalSpeed, forward.y * s.speed - idleSink - lowSpeedSink - turnSink, 8, dt);
      const dx = forward.x * s.speed * dt + wind.x * dt, dz = forward.z * s.speed * dt + wind.z * dt;
      s.position.x += dx;
      s.position.z += dz;
      s.position.y += s.verticalSpeed * dt;
      s.distance += wind.x || wind.z ? Math.hypot(dx, dz) : Math.hypot(forward.x, forward.z) * s.speed * dt;
    } else {
      // Banking produces a coordinated turn; yaw adds a small rudder correction.
      const turnRate = GRAVITY * Math.tan(s.bank) / Math.max(s.speed, 24);
      s.heading = ((s.heading + turnRate * dt + yaw.angle) % TAU + TAU) % TAU;
      const turnSink = Math.abs(Math.sin(s.bank)) * 0.9;
      const targetVerticalSpeed = Math.sin(s.pitch) * s.speed - idleSink - lowSpeedSink - turnSink;
      s.verticalSpeed = mix(s.verticalSpeed, targetVerticalSpeed, 2.1, dt);

      const distance = Math.cos(s.pitch) * s.speed * dt;
      const dx = Math.sin(s.heading) * distance + wind.x * dt, dz = -Math.cos(s.heading) * distance + wind.z * dt;
      s.position.x += dx;
      s.position.z += dz;
      s.position.y += s.verticalSpeed * dt;
      s.distance += wind.x || wind.z ? Math.hypot(dx, dz) : distance;
    }

    if (!free) this.setQuaternion();
    // Specific force along the aircraft's up axis, from its actual flight-path velocity.
    // Quaternion axes stay continuous through vertical, knife-edge and inverted flight.
    this.acceleration.set(0, 0, -s.speed).applyQuaternion(s.quaternion);
    this.acceleration.y = s.verticalSpeed;
    this.acceleration.x += this.windEndpoint.x;
    this.acceleration.z += this.windEndpoint.z;
    this.sampleLoadFactor(dt);

    const ground = this.groundAt(s.position.x, s.position.z) + (this.type.groundClearance ?? 2.8);
    if (s.position.y <= ground) {
      s.position.y = ground;
      this.recordTouchdown();
      const landable = this.heightAt(s.position.x, s.position.z) > 10.2 && s.gearDown && Math.abs(s.verticalSpeed) < f.maxTouchdownSink && s.speed < f.maxTouchdownSpeed && Math.abs(s.bank) < 0.3;
      if (landable) {
        s.grounded = true;
        // The tyres take the ground speed along the heading; the crosswind component stops at the wheels.
        if (wind.x || wind.z) s.speed = Math.max(0, s.speed + this.alongWind(wind));
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

  // Capture impact telemetry before collision handling clears speed, sink and control state.
  recordTouchdown() {
    const s = this.state;
    s.touchdown = { position: { x: s.position.x, y: s.position.y, z: s.position.z },
      speed: this.type.flight.rotorcraft ? Math.hypot(s.velocity.x, s.velocity.z) : s.speed,
      sink: Math.abs(s.verticalSpeed), heading: s.heading, bank: s.bank, pitch: s.pitch,
      gearDown: s.gearDown, flaps: s.flaps, stalled: s.stalled, time: s.flightTime };
  }

  stepGround(dt, controls, burner = 0) {
    const s = this.state;
    const f = this.type.flight;
    s.gForce = 1;
    this.resetLoadSample();
    // Rolling resistance stops an idle aircraft. Full power allows a takeoff roll.
    const targetSpeed = s.spool > 0.2 ? (s.spool - 0.2) * f.groundThrust + burner : 0;
    const nextSpeed = mix(s.speed, targetSpeed, s.spool < 0.2 ? 0.35 : f.groundRate, dt);
    s.speed = f.maxAcceleration ? Math.min(nextSpeed, s.speed + f.maxAcceleration * dt) : nextSpeed;
    // Brakes add a bounded deceleration that stops at zero: they hold low power but never roll the aircraft back.
    s.brake = controls.brake ?? 0;
    if (s.brake > 0) s.speed = Math.max(0, s.speed - s.brake * brakeDeceleration(this.type) * dt);
    s.heading = ((s.heading + (controls.yaw + controls.roll * 0.6) * dt * 0.35) % TAU + TAU) % TAU;
    s.bank = mix(s.bank, 0, 5, dt);
    s.pitch = mix(s.pitch, Math.max(0, controls.pitch) * 0.12, 3, dt);
    const distance = s.speed * dt;
    s.position.x += Math.sin(s.heading) * distance;
    s.position.z -= Math.cos(s.heading) * distance;
    s.position.y = this.groundAt(s.position.x, s.position.z) + (this.type.groundClearance ?? 2.8);
    s.distance += distance;
    // Rotation is by airspeed: wheel speed plus any headwind along the runway.
    const airspeed = s.speed - this.alongWind(s.windVelocity);
    if (airspeed > f.rotateSpeed - s.flaps * f.flapStallGain && controls.pitch > 0.15) {
      s.grounded = false;
      s.speed = Math.max(0, airspeed);
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
    this.seen ??= [];
    this.seen[0] = s.pitch; this.seen[1] = s.bank; this.seen[2] = s.heading;
  }

  /** Derives the displayed pitch (±90°), bank (±180°) and heading (0–360°) from the free attitude. */
  readAttitude() {
    const s = this.state;
    _euler.setFromQuaternion(s.quaternion, 'YXZ');
    s.pitch = _euler.x;
    s.bank = -_euler.z;
    s.heading = ((-_euler.y % TAU) + TAU) % TAU;
    this.seen ??= [];
    this.seen[0] = s.pitch; this.seen[1] = s.bank; this.seen[2] = s.heading;
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
        // A heading chosen during the recovery is honoured once level, not overwritten by the levelled heading.
        this.holdHeading = s.headingHold ? s.selectedHeading * Math.PI / 180 : s.heading;
      }
      q.rotateTowards(_q, Math.min(angle * (1 - Math.exp(-(this.recovering ? 3 : 1) * dt)), ASSIST_RECOVERY_RATE * dt));
      this.pitchRate = mix(this.pitchRate, 0, 5, dt);
      this.rollRate = mix(this.rollRate, 0, 5, dt);
    } else {
      _axis.copy(this.rotationStep);
      const angle = _axis.length();
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

/**
 * Mix levels for a fighter's turbofans at a spool (0–1), airspeed (m/s) and afterburner state.
 * `voice` scales the Arolla F7's single-engine mix for another type on the same bus (the twin Taris F12).
 */
export function fighterSound(spool, speed = 0, afterburner = false, voice = null) {
  const n1 = clamp(Number(spool) || 0, 0, 1);
  const airspeed = clamp(Number(speed) || 0, 0, 285);
  const mix = {
    whine: 1100 + n1 * 3100,          // compressor tone, Hz
    whineGain: 0.03 + n1 * 0.03,
    roar: 220 + n1 * 900,             // exhaust band centre, Hz
    roarGain: 0.16 + n1 * n1 * 0.4,
    rumbleGain: 0.14 + n1 * n1 * 0.3,
    burnerGain: afterburner ? 0.55 : 0, // the reheat adds a deep, ragged rumble
    wind: clamp(airspeed / 700, 0.015, 0.32),
    master: 0.6 + n1 * 0.3 + (afterburner ? 0.08 : 0),
  };
  if (voice) for (const key of ['whine', 'roar', 'roarGain', 'rumbleGain', 'burnerGain']) mix[key] *= voice[key] ?? 1;
  return mix;
}

/** Lower compressor/fan tones and a fuller exhaust on the existing twin-engine bus. */
export function airlinerSound(spool, speed = 0) {
  const mix = jetSound(spool, speed), n1 = clamp(Number(spool) || 0, 0, 1);
  return { ...mix, whine: 650 + n1 * 2100, fan: 75 + n1 * 150,
    roar: 190 + n1 * 650, roarGain: 0.08 + n1 * n1 * 0.42,
    rumbleGain: 0.09 + n1 * n1 * 0.36, master: 0.46 + n1 * 0.3 };
}

/** Piston firing/prop blade-pass tones; the commuter adds a separate turbine whistle. */
export function propellerSound(engine, spool, speed = 0, voice = {}) {
  const { pitch = 1, level = 1, stopBelow = 0 } = voice ?? {};
  const power = clamp(Number(spool) || 0, 0, 1), airspeed = Math.max(0, Number(speed) || 0);
  const turbine = engine === 'turboprop', aerobatic = engine === 'aeroprop';
  // A prop that stops at idle is silent below stopBelow and fades in over the next equal band; airflow stays.
  const running = stopBelow > 0 ? clamp((power - stopBelow) / stopBelow, 0, 1) : 1, gain = level * running;
  return { tone: ((turbine ? 100 : aerobatic ? 48 : 38) + power * (turbine ? 110 : 75)) * pitch,
    toneGain: (0.1 + power * 0.12) * gain, pulse: ((turbine ? 28 : 16) + power * (turbine ? 65 : 34)) * pitch,
    pulseDepth: (turbine ? 0.025 : 0.045) * gain, wash: 180 + power * 650, washGain: (0.03 + power * power * 0.15) * gain,
    turbine: 700 + power * 1800, turbineGain: turbine ? 0.01 + power * 0.025 : 0,
    wind: clamp(airspeed / 500, 0, 0.25), master: 0.42 + power * 0.22 };
}

/** Explicit engine metadata routes each passenger jet to an appropriate fan/exhaust mix. */
export function passengerSound(engine, spool, speed = 0) {
  const base = engine === 'turbofan' ? jetSound(spool, speed) : airlinerSound(spool, speed);
  if (engine === 'regional') return { ...base, whine: base.whine * 1.13, fan: base.fan * 1.18, rumbleGain: base.rumbleGain * 0.8 };
  if (engine === 'widebody') return { ...base, whine: base.whine * 0.78, fan: base.fan * 0.72, rumbleGain: base.rumbleGain * 1.2 };
  // Four small turbofans: a higher, busier fan tone and a softer exhaust than the twin airliners.
  if (engine === 'cityliner') return { ...base, whine: base.whine * 1.22, fan: base.fan * 1.32, roarGain: base.roarGain * 0.82, rumbleGain: base.rumbleGain * 0.75 };
  return base;
}

/**
 * Rotor blade-pass thrum, turbine whine and cabin airflow; RPM is independent of collective.
 * `rotor` describes the type's main rotor (or each of a tandem's two); the defaults are the Laret H4's three blades at 363 RPM.
 */
export function helicopterSound(rotorSpeed, collective = 0.58, speed = 0, rotor = {}) {
  const rpm = clamp(Number(rotorSpeed) || 0, 0, 1), load = clamp(Number(collective) || 0, 0, 1);
  const { blades = 3, rate = 38, turbine = 600, tandem = false } = rotor;
  return {
    // Two counter-rotating rotors (a tandem) pass twice as many blades overhead each turn.
    bladePass: rpm * rate / (2 * Math.PI) * blades * (tandem ? 2 : 1),
    // A larger, slower rotor sits lower in pitch.
    rotor: (38 + rpm * 54) * rate / 38,
    rotorGain: rpm * (0.08 + load * 0.12),
    chopGain: rpm * (0.12 + load * 0.16),
    turbine: turbine + rpm * 1400 + load * 220,
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
    this.gearWarningOn = false;
    this.touchdownVoice = null;
    this.volume = 1;
  }

  /** Master volume (0–1) after every engine, wind and warning voice; 1 is the original mix. */
  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    // A gentle curve, so the lower half of the slider stays usable.
    this.output?.gain.setTargetAtTime(this.volume ** 2, this.context.currentTime, 0.05);
  }

  async start() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) {
      const ctx = new AudioContext();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.output = ctx.createGain();
      this.output.gain.value = this.volume ** 2;
      this.master.connect(this.output).connect(ctx.destination);
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
        if (!brown) this.noiseBuffer ??= buffer;
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
      this.propBus = ctx.createGain(); this.propBus.gain.value = 0; this.propBus.connect(this.master);
      const prop = this.prop = { tone: ctx.createOscillator(), pulse: ctx.createOscillator(), turbine: ctx.createOscillator() };
      prop.tone.type = 'sawtooth'; prop.tone.start();
      prop.toneVoice = voice(prop.tone, 'lowpass', 500, 0.5, this.propBus);
      prop.pulse.type = 'sine'; prop.pulse.start(); prop.depth = ctx.createGain();
      prop.pulse.connect(prop.depth).connect(prop.toneVoice.gain.gain);
      prop.turbine.type = 'sine'; prop.turbine.start(); prop.turbineVoice = voice(prop.turbine, 'highpass', 700, 0.4, this.propBus);
      const exhaust = noise(false);
      prop.wash = voice(exhaust, 'lowpass', 400, 0.4, this.propBus);
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
    this.stopTouchdown();
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

  /**
   * One short procedural contact from touchdownResponse(...).sound: a falling sine body thump plus a band-passed tyre
   * chirp or a low skid scrape over the shared noise buffer, straight to the volume output so engine level never
   * changes it. Plays only while sound is on and the context is running; otherwise the touchdown is dropped, never
   * queued. A sounding stall or gear horn halves it so the warning stays clear. Returns whether it played.
   */
  playTouchdown(sound) {
    const ctx = this.context;
    if (!sound || !this.enabled || !ctx || ctx.state !== 'running' || !this.output || !this.noiseBuffer) return false;
    this.stopTouchdown();
    const now = ctx.currentTime, duck = this.stallActive || this.gearWarningOn ? 0.5 : 1;
    const end = now + Math.max(sound.decay, sound.rollDuration) + 0.05;
    const bus = ctx.createGain();
    bus.gain.value = duck;
    bus.connect(this.output);
    const thump = ctx.createOscillator(), body = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(sound.thumpFrom, now);
    thump.frequency.exponentialRampToValueAtTime(sound.thumpTo, now + sound.decay);
    body.gain.setValueAtTime(0, now);
    body.gain.linearRampToValueAtTime(sound.gain, now + 0.008);
    body.gain.exponentialRampToValueAtTime(0.0001, now + sound.decay);
    thump.connect(body).connect(bus);
    const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), roll = ctx.createGain();
    noise.buffer = this.noiseBuffer;
    filter.type = sound.roll === 'tyre' ? 'bandpass' : 'lowpass';
    filter.frequency.value = sound.rollFrequency;
    filter.Q.value = sound.roll === 'tyre' ? 1.4 : 0.7;
    roll.gain.setValueAtTime(0, now);
    roll.gain.linearRampToValueAtTime(sound.rollGain, now + 0.02);
    roll.gain.exponentialRampToValueAtTime(0.0001, now + sound.rollDuration);
    noise.connect(filter).connect(roll).connect(bus);
    const voice = this.touchdownVoice = { thump, noise, bus, start: now, end, gain: sound.gain * duck };
    thump.onended = () => {
      for (const node of [thump, body, noise, filter, roll, bus]) node.disconnect();
      if (this.touchdownVoice === voice) this.touchdownVoice = null;
    };
    thump.start(now);
    thump.stop(end);
    noise.start(now);
    noise.stop(end);
    return true;
  }

  stopTouchdown() {
    const voice = this.touchdownVoice;
    if (!voice) return;
    this.touchdownVoice = null;
    try { voice.thump.stop(); voice.noise.stop(); } catch { /* already ended */ }
  }

  update(state, gearWarning = false) {
    if (!this.context || !this.master) return;
    const type = aircraftType(state.aircraft), engine = type.engine, propeller = ['piston', 'aeroprop', 'turboprop'].includes(engine);
    const helicopter = !!type.flight.rotorcraft;
    const stalled = !helicopter && this.enabled && state.stalled && !state.grounded && !state.crashed;
    if (stalled && !this.stallActive) this.soundStallHorn();
    if (!stalled) this.stopStallHorn();
    this.stallActive = stalled;
    const now = this.context.currentTime;
    this.gearWarningOn = this.enabled && !state.crashed && !helicopter && !type.fixedGear && !!gearWarning;
    this.gearHorn.gain.setTargetAtTime(this.gearWarningOn ? 0.12 : 0, now, 0.03);
    const fighter = engine === 'fighter';
    this.jetBus.gain.setTargetAtTime(fighter || helicopter || propeller ? 0 : 1, now, 0.08);
    this.fighterBus.gain.setTargetAtTime(fighter ? 1 : 0, now, 0.08);
    this.helicopterBus.gain.setTargetAtTime(helicopter ? 1 : 0, now, 0.08);
    this.propBus?.gain.setTargetAtTime(propeller ? 1 : 0, now, 0.08);
    if (propeller) {
      const p = propellerSound(engine, state.spool ?? state.throttle, state.speed, type.propVoice), v = this.prop;
      v.tone.frequency.setTargetAtTime(p.tone, now, 0.12); v.toneVoice.gain.gain.setTargetAtTime(p.toneGain, now, 0.12);
      v.pulse.frequency.setTargetAtTime(p.pulse, now, 0.12); v.depth.gain.setTargetAtTime(p.pulseDepth, now, 0.12);
      v.wash.filter.frequency.setTargetAtTime(p.wash, now, 0.15); v.wash.gain.gain.setTargetAtTime(p.washGain, now, 0.15);
      v.turbine.frequency.setTargetAtTime(p.turbine, now, 0.2); v.turbineVoice.gain.gain.setTargetAtTime(p.turbineGain, now, 0.2);
      this.wind.gain.setTargetAtTime(p.wind, now, 0.2);
      this.master.gain.setTargetAtTime(this.enabled && !state.crashed ? p.master : 0, now, 0.1);
      return;
    }
    if (helicopter) {
      const h = helicopterSound(state.rotorSpeed, state.spool ?? state.throttle, state.speed, type.rotor), v = this.helicopter;
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
      const f = fighterSound(state.spool ?? state.throttle, state.speed, state.afterburner, type.engineVoice), v = this.fighter;
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
    const mix = passengerSound(engine, state.spool ?? state.throttle, state.speed);
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

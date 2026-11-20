// One local, manual Mira T2 exercise. The controller owns the flight; this only observes it.
import { ActivityWind } from './activity-wind.js';
import { CALM } from './wind.js';
import { resolveAirport } from './airport-selection.js';
import { runwayPoint, runwayCoordinates } from './airfield.js';

const DEG = Math.PI / 180;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Arcade targets measured against the existing clean Mira model (rotateSpeed 30, stallSpeed 25 m/s).
 * Full power, rotate near 60 kt, then a gentle 5–10° nose attitude completes this without trim or configuration changes.
 * No physics, ranked rules, replay schema or online board is changed by this exercise.
 */
export const TAKEOFF = Object.freeze({
  name: 'Takeoff practice', aircraft: 'trainer', airport: 'alpine-field', runway: '36', wind: CALM,
  startAlong: 100, rotateSpeed: 31, minSpeed: 32, maxSpeed: 65, height: 45.72, stableSeconds: 3,
  minPitch: 2 * DEG, maxPitch: 18 * DEG, maxBank: 15 * DEG, maxAlignment: 20 * DEG,
  minClimb: 1, minPower: 0.8, timeout: 90,
});
export const takeoffField = () => resolveAirport(TAKEOFF.airport, TAKEOFF.runway).field;
export function takeoffAvailability(type) {
  return type.id === TAKEOFF.aircraft ? { available: true, reason: '' }
    : { available: false, reason: 'This exercise uses the Mira T2 and its measured takeoff targets. Switch explicitly to fly it' };
}

export class TakeoffPractice extends ActivityWind {
  constructor() { super(); this.field = takeoffField(); this.clear(); }
  clear() {
    this.status = 'idle'; this.phase = 'roll'; this.reason = ''; this.elapsed = 0; this.lastTime = 0;
    this.stableTime = 0; this.liftoff = null; this.result = null; this.groundDistance = 0;
  }
  get active() { return this.status === 'flying'; }
  get finished() { return this.status === 'success' || this.status === 'failed'; }
  canStart(flight) { return takeoffAvailability(flight.type).available; }
  start(flight) {
    if (!this.canStart(flight)) return null;
    this.borrow(flight, TAKEOFF.wind); this.clear();
    const p = runwayPoint(TAKEOFF.startAlong, 0, this.field), clearance = flight.type.groundClearance ?? 2.8;
    const s = flight.runwayStart(p.x, flight.groundAt(p.x, p.z) + clearance, p.z, this.field.heading);
    // runwayStart's general-purpose reset leaves the old airborne airspeed until its first slice.
    s.airspeed = 0;
    this.watchFlight(s); this.status = 'flying'; return s;
  }
  end() { const restored = this.release(); this.clear(); return restored; }
  cancel() { return this.end(); }
  height(state) { return state.position.y - this.field.elevation - (this.flight.type.groundClearance ?? 2.8); }
  alignment(state) { return angle(state.heading - this.field.heading); }
  finish(status, reason, state) {
    this.status = status; this.reason = reason;
    this.result = { liftoff: this.liftoff && { ...this.liftoff }, elapsed: this.elapsed, stableTime: this.stableTime,
      groundDistance: this.groundDistance, height: this.height(state), speed: state.airspeed };
  }
  checkAssist(state) {
    if (this.active && state.autopilot) this.finish('failed', 'Assist was used. Retry in manual flight', state);
  }
  update(dt, state) {
    if (this.status === 'idle') return;
    // Watch finished results too: resets and aircraft changes always return the pilot's wind.
    if (this.observeFlight(state)) { this.end(); return; }
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = state.flightTime - this.lastTime;
    this.lastTime = state.flightTime; this.elapsed = state.flightTime;
    const fail = reason => this.finish('failed', reason, state), r = TAKEOFF;
    if (state.crashed) return fail(state.crashReason || 'The aircraft crashed');
    this.checkAssist(state); if (this.finished) return;
    if (state.flaps !== 0) return fail('Keep flaps retracted for this clean-configuration exercise');
    if (this.elapsed >= r.timeout) return fail('The sustained climb was not reached within 90 seconds');
    if (!(elapsed > 0)) return;
    if (!this.liftoff) {
      this.groundDistance = state.distance;
      const at = runwayCoordinates(state.position, this.field);
      if (Math.abs(at.cross) > this.field.runwayWidth / 2 - 2 || at.along < 0 || at.along > this.field.runwayLength)
        return fail('The takeoff roll left the runway. Keep straight and rotate near 60 kt');
      if (state.grounded) return;
      this.liftoff = { distance: this.groundDistance, speed: state.airspeed, alignment: this.alignment(state),
        cross: at.cross, along: at.along, time: state.flightTime };
    } else if (state.grounded) return fail('The aircraft touched the ground again. Hold a gentle climb after liftoff');
    const stable = !state.stalled && this.height(state) >= r.height && state.airspeed >= r.minSpeed && state.airspeed <= r.maxSpeed
      && state.verticalSpeed >= r.minClimb && state.pitch >= r.minPitch && state.pitch <= r.maxPitch
      && Math.abs(state.bank) <= r.maxBank && Math.abs(this.alignment(state)) <= r.maxAlignment && state.throttle >= r.minPower;
    this.stableTime = stable ? this.stableTime + elapsed : 0;
    this.phase = stable ? 'hold' : 'climb';
    if (this.stableTime >= r.stableSeconds) this.finish('success', '', state);
  }
  guidance(state, { touch = false } = {}) {
    const pull = touch ? 'pull the yoke gently back' : 'tap S / ↓ gently', power = touch ? 'hold +' : 'hold Shift';
    if (state.throttle < TAKEOFF.minPower) return `Add full power · ${power} · release Brake / B`;
    if (!this.liftoff) return state.airspeed < TAKEOFF.rotateSpeed
      ? 'Build to 60 kt · keep centred with small steering inputs'
      : `At 60 kt, ${pull} to lift the nose`;
    if (state.stalled || state.pitch > TAKEOFF.maxPitch) return 'Nose too high · ease the yoke forward and let speed build';
    if (Math.abs(this.alignment(state)) > TAKEOFF.maxAlignment || Math.abs(state.bank) > TAKEOFF.maxBank) return 'Wings nearly level · gently turn back toward 360°';
    if (state.airspeed < TAKEOFF.minSpeed) return 'Ease the nose down slightly · build above 62 kt';
    if (state.airspeed > TAKEOFF.maxSpeed) return 'Ease power toward 80% · stay below 126 kt';
    if (state.pitch < TAKEOFF.minPitch || state.verticalSpeed < TAKEOFF.minClimb) return `Raise the nose to about 5–10° · ${pull}`;
    return this.phase === 'hold' ? 'Hold this climb for 3 continuous seconds · manual flight' : 'Keep a gentle 5–10° climb · reach 150 ft above the runway';
  }
  snapshot() {
    return { status: this.status, phase: this.phase, reason: this.reason, elapsed: this.elapsed, stableTime: this.stableTime,
      groundDistance: this.groundDistance, liftoff: this.liftoff && { ...this.liftoff },
      result: this.result && { ...this.result, liftoff: this.result.liftoff && { ...this.result.liftoff } }, owning: this.owning };
  }
}

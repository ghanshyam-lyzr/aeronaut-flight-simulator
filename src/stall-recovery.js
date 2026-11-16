import { ActivityWind } from './activity-wind.js';
import { CALM } from './wind.js';
import { stallSpeed } from './stall.js';

const DEG = Math.PI / 180;

/** Measured gameplay targets for the Mira T2 only; never aircraft operating data. Metres, seconds, radians. */
export const RECOVERY = Object.freeze({
  name: 'Stall recovery', aircraft: 'trainer', wind: CALM,
  x: 0, z: 4000, altitude: 1800, clearance: 900, startSpeed: 42, startPower: 0.54,
  safeSpeed: 35, maxSpeed: 55, stableSeconds: 3, pitchLimit: 3 * DEG, bankLimit: 5 * DEG, sinkLimit: 2,
  noseDrop: 4 * DEG, power: 0.8, maxLoss: 250, minClearance: 150, slowLimit: 60, recoveryLimit: 45,
});

export function recoveryAvailability(type) {
  return type.id === RECOVERY.aircraft ? { available: true, reason: '' }
    : { available: false, reason: 'This exercise is measured for the Mira T2 only. Switch explicitly to fly its setup and targets' };
}

/** One manual, flight-time driven attempt. Reads the controller's real stall, airspeed and attitude; never flies it. */
export class StallRecovery extends ActivityWind {
  constructor() { super(); this.clear(); }
  clear() {
    this.status = 'idle'; this.phase = 'slow'; this.reason = ''; this.stall = null; this.result = null;
    this.startAltitude = 0; this.minimum = Infinity; this.stallMinimum = Infinity; this.lastTime = 0;
    this.elapsed = 0; this.stableTime = 0; this.noseLowered = false; this.powerAdded = false;
  }
  get active() { return this.status === 'flying'; }
  get finished() { return this.status === 'success' || this.status === 'failed'; }
  canStart(flight) { return recoveryAvailability(flight.type).available; }

  start(flight) {
    if (!this.canStart(flight)) return null;
    this.borrow(flight, RECOVERY.wind); this.clear();
    const s = flight.reset(), r = RECOVERY;
    s.position.set(r.x, Math.max(r.altitude, flight.groundAt(r.x, r.z) + r.clearance), r.z);
    Object.assign(s, { speed: r.startSpeed, airspeed: r.startSpeed, throttle: r.startPower, spool: r.startPower,
      pitch: 0, bank: 0, heading: 0, verticalSpeed: 0, autopilot: false, gearDown: true, flaps: 0 });
    s.velocity.set(0, 0, -s.speed); flight.setQuaternion(); this.watchFlight(s);
    this.startAltitude = this.minimum = s.position.y; this.status = 'flying';
    return s;
  }

  end() { const restored = this.release(); this.clear(); return restored; }
  cancel() { return this.end(); }
  finish(status, reason, state) {
    this.status = status; this.reason = reason;
    this.result = { recoveryTime: this.stall ? state.flightTime - this.stall.time : null,
      heightLost: this.stall ? Math.max(0, this.stall.altitude - this.stallMinimum) : null,
      attemptTime: this.elapsed, speed: state.airspeed, altitude: state.position.y };
  }

  /** Check BEFORE physics too: the controller itself switches assist off again during a stalled step. */
  checkAssist(state) {
    if (!this.active || !state.autopilot) return;
    this.finish('failed', 'Assist was used. Retry and keep this exercise in manual flight', state);
  }

  update(dt, state) {
    if (this.status === 'idle') return;
    // Results also release their borrowed wind when a controller reset or aircraft change ends the old flight.
    if (this.observeFlight(state)) { this.end(); return; }
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = state.flightTime - this.lastTime;
    this.lastTime = state.flightTime;
    this.elapsed = state.flightTime;
    this.minimum = Math.min(this.minimum, state.position.y);
    if (this.stall) this.stallMinimum = Math.min(this.stallMinimum, state.position.y);
    const fail = reason => this.finish('failed', reason, state), r = RECOVERY;
    if (state.crashed || state.grounded) return fail(state.crashReason || 'The attempt reached the ground');
    this.checkAssist(state); if (this.finished) return;
    if (state.flaps !== 0) return fail('Keep flaps retracted for this clean-configuration exercise');
    if (this.startAltitude - this.minimum > r.maxLoss) return fail(`Height loss exceeded ${r.maxLoss} m`);
    if (state.position.y - this.flight.groundAt(state.position.x, state.position.z) < r.minClearance) return fail('Terrain clearance fell below 150 m');
    if (!this.stall && this.elapsed >= r.slowLimit) return fail('No stall recorded within 60 seconds');
    if (this.stall && state.flightTime - this.stall.time >= r.recoveryLimit) return fail('Stable recovery was not reached within 45 seconds');
    if (!(elapsed > 0)) return;

    if (!this.stall) {
      if (!state.stalled) return;
      if (state.throttle > 0.2 || Math.abs(state.bank) > 10 * DEG) return fail('Enter the stall at idle power with the wings level');
      this.stall = { time: state.flightTime, altitude: state.position.y, pitch: state.pitch, speed: state.airspeed };
      this.stallMinimum = state.position.y; this.phase = 'recover';
    }
    // These are observed attitude and lever changes, not claims about elevator force or real-world technique.
    this.noseLowered ||= state.pitch <= Math.min(0, this.stall.pitch - r.noseDrop);
    this.powerAdded ||= state.throttle >= r.power;
    const safeSpeed = Math.max(r.safeSpeed, stallSpeed(this.flight.type, state.flaps, state) * 1.3);
    const regained = this.noseLowered && this.powerAdded && !state.stalled && state.airspeed >= safeSpeed;
    this.phase = regained ? 'stabilize' : 'recover';
    const stable = regained && state.airspeed <= r.maxSpeed && state.throttle >= r.power
      && Math.abs(state.pitch) <= r.pitchLimit && Math.abs(state.bank) <= r.bankLimit && Math.abs(state.verticalSpeed) <= r.sinkLimit;
    this.stableTime = stable ? this.stableTime + elapsed : 0;
    if (this.stableTime >= r.stableSeconds) this.finish('success', '', state);
  }

  guidance(state, { touch = false } = {}) {
    const down = touch ? 'push the yoke gently forward' : 'W / ↑ gently lowers the nose', up = touch ? '+ adds power' : 'Shift adds power';
    if (!this.stall) return `Idle power (${touch ? 'hold −' : 'hold Ctrl'}) · keep wings level and the nose near the horizon`;
    if (!this.noseLowered || state.stalled) return `Lower the nose below the horizon · ${down}; ${up}`;
    if (state.throttle < RECOVERY.power) return `Add power to at least 80% · ${touch ? 'hold +' : 'hold Shift'}`;
    if (state.airspeed < RECOVERY.safeSpeed) return 'Let speed build to 68 kt before easing back to the horizon';
    if (state.airspeed > RECOVERY.maxSpeed) return 'Above 107 kt · ease power toward 80% and level out';
    return 'Ease back to the horizon · wings level · hold 68–107 kt for 3 seconds';
  }

  snapshot() {
    return { status: this.status, phase: this.phase, reason: this.reason, elapsed: this.elapsed, stableTime: this.stableTime,
      aircraft: RECOVERY.aircraft, stall: this.stall && { ...this.stall }, noseLowered: this.noseLowered, powerAdded: this.powerAdded,
      heightLost: this.stall ? Math.max(0, this.stall.altitude - this.stallMinimum) : null, result: this.result && { ...this.result }, owning: this.owning };
  }
}

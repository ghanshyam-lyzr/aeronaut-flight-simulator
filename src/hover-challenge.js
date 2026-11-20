import { ActivityWind } from './activity-wind.js';
import { CALM } from './wind.js';
import { runwayPoint } from './airfield.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const spot = runwayPoint(250);
/** Arcade targets validated with ordinary cyclic, yaw and collective inputs; metres, radians, simulation seconds. */
export const HOVER = Object.freeze({
  name: 'Hover challenge', aircraft: 'helicopter', wind: CALM,
  x: spot.x, z: spot.z, clearance: 22, heading: 0,
  radius: 4, height: 2, headingLimit: 8 * DEG, seconds: 10,
  startX: 10, startZ: 8, startHeight: -4, startHeading: -20 * DEG,
});
export const hoverAvailability = type => type.id === HOVER.aircraft ? { available: true, reason: '' }
  : { available: false, reason: 'This challenge is measured for the Laret H4 only. Switch explicitly to use its setup and targets' };

/** Observes manual flight only. The existing flight controller remains the sole source of motion. */
export class HoverChallenge extends ActivityWind {
  constructor() { super(); this.clear(); }
  clear() {
    this.status = 'idle'; this.reason = ''; this.target = null; this.errors = null; this.result = null;
    this.elapsed = 0; this.lastTime = 0; this.holdTime = 0; this.bestHold = 0; this.excursions = 0; this.inside = false;
  }
  get active() { return this.status === 'flying'; }
  get finished() { return this.status === 'success' || this.status === 'failed'; }
  canStart(flight) { return hoverAvailability(flight.type).available; }
  start(flight) {
    if (!this.canStart(flight)) return null;
    this.borrow(flight, HOVER.wind); this.clear();
    const s = flight.reset(), h = HOVER;
    this.target = { x: h.x, y: flight.groundAt(h.x, h.z) + h.clearance, z: h.z, heading: h.heading };
    s.position.set(h.x + h.startX, this.target.y + h.startHeight, h.z + h.startZ);
    s.heading = (h.heading + h.startHeading + TAU) % TAU;
    flight.setQuaternion(); this.watchFlight(s);
    this.errors = this.measure(s); this.status = 'flying';
    return s;
  }
  end() { const restored = this.release(); this.clear(); return restored; }
  cancel() { return this.end(); }
  measure(s) {
    const t = this.target;
    return { position: Math.hypot(s.position.x - t.x, s.position.z - t.z), height: s.position.y - t.y,
      heading: Math.atan2(Math.sin(s.heading - t.heading), Math.cos(s.heading - t.heading)) };
  }
  finish(status, reason, state) {
    this.status = status; this.reason = reason;
    this.errors = this.measure(state);
    this.result = { elapsed: this.elapsed, bestHold: this.bestHold, excursions: this.excursions, ...this.errors };
  }
  // Called before physics as well: even a manual input that immediately drops hover hold cannot hide its use.
  checkAssist(state) {
    if (this.active && state.autopilot) this.finish('failed', 'Hover hold / assist was used. Retry in manual flight', state);
  }
  update(dt, state) {
    if (this.status === 'idle') return;
    if (this.observeFlight(state)) { this.end(); return; }
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = state.flightTime - this.lastTime;
    this.lastTime = state.flightTime;
    this.elapsed = state.flightTime;
    this.errors = this.measure(state);
    if (state.crashed || state.grounded) return this.finish('failed', state.crashReason || 'Ground contact ended the airborne hover', state);
    this.checkAssist(state); if (this.finished || !(elapsed > 0)) return;
    const e = this.errors, h = HOVER;
    const inside = e.position <= h.radius + 1e-10 && Math.abs(e.height) <= h.height + 1e-10 && Math.abs(e.heading) <= h.headingLimit + 1e-10;
    // Only whole observed intervals inside ALL three limits count; entry earns no retroactive time.
    // dt and the controller's 250 ms safety cap also prevent a clock jump from completing a hold.
    if (inside && this.inside) this.holdTime = Math.min(h.seconds, this.holdTime + Math.min(dt, elapsed, 0.25));
    else {
      if (!inside && this.holdTime > 0) this.excursions++;
      this.holdTime = 0;
    }
    this.inside = inside;
    this.bestHold = Math.max(this.bestHold, this.holdTime);
    if (this.holdTime >= h.seconds - 1e-9) {
      this.holdTime = this.bestHold = h.seconds;
      this.finish('success', '', state);
    }
  }
  guidance(s, { touch = false } = {}) {
    const e = this.errors, h = HOVER, t = this.target;
    if (e.position > h.radius) {
      const dx = t.x - s.position.x, dz = t.z - s.position.z, c = Math.cos(s.heading), a = Math.sin(s.heading);
      const right = c * dx + a * dz, back = -a * dx + c * dz;
      const direction = Math.abs(right) > Math.abs(back) ? (right > 0 ? 'right' : 'left') : (back > 0 ? 'back' : 'forward');
      return `Move ${direction} toward the ring · ${touch ? 'small cyclic inputs' : 'tap W/S and A/D'}; counter-cyclic brakes drift`;
    }
    if (Math.abs(e.height) > h.height) return `${e.height > 0 ? 'High · lower' : 'Low · raise'} collective with ${touch ? 'short − / + taps' : 'short Ctrl / Shift taps'} · ${Math.round(this.flight.type.flight.hoverCollective * 100)}% holds height`;
    if (Math.abs(e.heading) > h.headingLimit) return `Yaw ${e.heading > 0 ? 'left' : 'right'} toward 000° · ${touch ? 'use the yaw buttons' : 'tap Q / E'}`;
    return 'All three errors within limits · brake drift, centre cyclic and hold manually';
  }
  snapshot() {
    return { status: this.status, reason: this.reason, aircraft: HOVER.aircraft, target: this.target && { ...this.target },
      errors: this.errors && { ...this.errors }, elapsed: this.elapsed, holdTime: this.holdTime, bestHold: this.bestHold,
      excursions: this.excursions, inside: this.inside, result: this.result && { ...this.result }, owning: this.owning };
  }
}

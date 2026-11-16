// Advisory only. Feet MSL come from position.y; seconds come from flightTime. No controller writes or audio.
export const FEET_PER_METRE = 3.28084;
export const ALTITUDE_REMINDER = Object.freeze({ min: 0, max: 60000, approach: 1000, approachExit: 1200,
  capture: 100, deviation: 200, deviationExit: 150, deviationDelay: 1 });

export function normalizeAltitudeTarget(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value), c = ALTITUDE_REMINDER;
  return Number.isFinite(n) && n >= c.min && n <= c.max ? Math.round(n) : null;
}

/** A pure state machine: update observes samples, select/arm/disarm/acknowledge express pilot intent.
 * Acknowledging approach quiets it until capture. Acknowledging deviation quiets that entire excursion;
 * only a return to the capture band rearms it. New targets always start a new approach cycle.
 */
export class AltitudeReminder {
  constructor() { this.reset(); }

  reset() {
    this.target = null; this.phase = 'off'; this.alert = ''; this.acknowledged = '';
    this.approachSeen = false; this.excursionSeen = false; this.outsideSince = null;
    this.lastTime = null; this.lastError = null; this.aircraft = null;
    this.suppressed = ''; this.events = 0; this.lastEvent = null;
    return this;
  }

  sync(state) {
    if ((this.aircraft !== null && state.aircraft !== this.aircraft) ||
        (this.lastTime !== null && state.flightTime < this.lastTime)) this.reset();
    this.aircraft = state.aircraft;
  }

  select(value, state) {
    const target = normalizeAltitudeTarget(value);
    if (target === null) return null;
    this.sync(state); this.target = target; this.arm(state);
    return target;
  }

  arm(state) {
    this.sync(state);
    if (this.target === null || state.crashed) return false;
    this.phase = 'approach'; this.alert = ''; this.acknowledged = '';
    this.approachSeen = false; this.excursionSeen = false; this.outsideSince = null;
    this.lastTime = state.flightTime; this.lastError = this.target - state.position.y * FEET_PER_METRE;
    // Selecting the altitude already flown captures the band without an approach alert.
    if (!state.grounded && Math.abs(this.lastError) <= ALTITUDE_REMINDER.capture) this.phase = 'deviation';
    return true;
  }

  disarm() { this.phase = 'off'; this.alert = ''; this.acknowledged = ''; this.outsideSince = null; }

  acknowledge() {
    if (!this.alert) return false;
    this.acknowledged = this.alert; this.alert = ''; this.outsideSince = null;
    return true;
  }

  raise(kind, time) {
    this.alert = kind; this.acknowledged = ''; this.events++;
    this.lastEvent = { kind, time, target: this.target };
  }

  update(state, { suspended = false, finished = false } = {}) {
    this.sync(state);
    const time = state.flightTime, error = this.target === null ? null : this.target - state.position.y * FEET_PER_METRE;
    const previous = this.lastError, advanced = this.lastTime !== null && time > this.lastTime;
    this.lastTime = time; this.lastError = error;
    this.suppressed = state.crashed ? 'crashed' : finished ? 'finished' : state.grounded ? 'grounded' : suspended ? 'suspended' : '';
    if (state.crashed || finished) { this.disarm(); return this.snapshot(); }
    if (state.grounded) {
      // No capture or crossing carried across a landing/takeoff; the chosen target may still be armed on the runway.
      if (this.phase !== 'off') this.phase = 'approach';
      this.alert = ''; this.acknowledged = ''; this.approachSeen = false; this.excursionSeen = false; this.outsideSince = null;
      return this.snapshot();
    }
    if (suspended) { this.outsideSince = null; return this.snapshot(); }
    if (this.phase === 'off' || error === null || !Number.isFinite(error) || !advanced) return this.snapshot();
    const c = ALTITUDE_REMINDER, distance = Math.abs(error);
    if (this.phase === 'approach') {
      // A high-rate climb/descent can cross the entire capture band between two samples.
      if (distance <= c.capture || (previous !== null && previous * error < 0)) {
        this.phase = 'deviation'; this.alert = ''; this.acknowledged = ''; this.outsideSince = null;
      } else if (!this.approachSeen && distance <= c.approach && previous !== null && distance < Math.abs(previous)) {
        this.approachSeen = true; this.raise('approach', time);
      } else if (distance > c.approachExit) this.alert = '';
    } else {
      if (distance <= c.capture) { this.excursionSeen = false; this.acknowledged = ''; }
      if (distance <= c.deviationExit) { this.alert = ''; this.outsideSince = null; }
      else if (distance >= c.deviation && !this.excursionSeen) {
        this.outsideSince ??= time;
        if (time - this.outsideSince >= c.deviationDelay) { this.excursionSeen = true; this.outsideSince = null; this.raise('deviation', time); }
      } else if (!this.excursionSeen) this.outsideSince = null;
    }
    return this.snapshot();
  }

  snapshot() {
    return { target: this.target, armed: this.phase !== 'off', phase: this.phase, alert: this.alert,
      acknowledged: this.acknowledged, suppressed: this.suppressed, error: this.lastError, time: this.lastTime,
      outsideSince: this.outsideSince, approachSeen: this.approachSeen, excursionSeen: this.excursionSeen,
      events: this.events, lastEvent: this.lastEvent && { ...this.lastEvent } };
  }
}

export function altitudeReminderNotice(view) {
  if (!view.alert || view.suppressed) return '';
  return `${view.alert === 'approach' ? 'Approaching' : 'Altitude deviation from'} ${view.target.toLocaleString('en')} ft MSL`;
}

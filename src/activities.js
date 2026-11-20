/**
 * One scored activity: landing, checkpoint course, crosswind practice, stall recovery or hover challenge; otherwise free flight.
 * Starting one ends the others first. The old wind lease releases before a new owner starts (activity-wind.js).
 * Each activity keeps its own start, scoring and controls. No DOM: the interface reads `kind`, `finished` and the activities.
 */
export class Activities {
  constructor(landing, course, practice = null, recovery = null, hover = null) { this.landing = landing; this.course = course; this.practice = practice; this.recovery = recovery; this.hover = hover; }

  get kind() {
    if (this.hover && this.hover.status !== 'idle') return 'hover';
    if (this.practice?.running) return 'crosswind';
    if (this.recovery && this.recovery.status !== 'idle') return 'recovery';
    return this.landing.status !== 'idle' ? 'landing' : this.course.status !== 'idle' ? 'course' : 'free';
  }
  get finished() { return this.landing.finished || this.course.finished || !!this.recovery?.finished || !!this.hover?.finished; }

  startLanding(flight, field) { this.hover?.end(); this.recovery?.end(); this.course.cancel(); this.practice?.end(); return this.landing.start(flight, field); }
  startCourse(flight) { this.hover?.end(); this.recovery?.end(); this.practice?.end(); this.landing.cancel(); return this.course.start(flight); }
  /** Begin or retry crosswind practice; null when the aircraft cannot fly it (then nothing else is ended). */
  startCrosswind(flight) {
    if (!this.practice?.canStart(flight)) return null;
    this.hover?.end(); this.recovery?.end();
    const s = this.practice.start(flight);
    if (s) this.course.cancel();
    return s;
  }
  startRecovery(flight) {
    if (!this.recovery?.canStart(flight)) return null;
    this.hover?.end(); this.practice?.end(); this.landing.cancel(); this.course.cancel();
    return this.recovery.start(flight);
  }
  startHover(flight) {
    if (!this.hover?.canStart(flight)) return null;
    this.practice?.end(); this.recovery?.end(); this.landing.cancel(); this.course.cancel();
    return this.hover.start(flight);
  }
  cancel() { this.practice?.end(); this.hover?.end(); this.recovery?.end(); this.landing.cancel(); this.course.cancel(); }

  holdPilotChoice(config) { return !!(this.practice?.holdPilotChoice(config) || this.recovery?.holdPilotChoice(config) || this.hover?.holdPilotChoice(config)); }
  pilotWind(live) {
    const owner = this.practice?.owning ? this.practice : this.recovery?.owning ? this.recovery : this.hover;
    return owner?.pilotWind(live) ?? live;
  }

  /** Read manual status before physics can disengage assist on a stall. A finished attempt freezes the flight. */
  beforeStep(state) { this.recovery?.checkAssist(state); this.hover?.checkAssist(state); return this.finished; }

  /** One physics slice: only the activity underway reads it. */
  update(dt, state) { this.landing.update(dt, state); this.course.update(state); this.practice?.update(dt, state); this.recovery?.update(dt, state); this.hover?.update(dt, state); }
}

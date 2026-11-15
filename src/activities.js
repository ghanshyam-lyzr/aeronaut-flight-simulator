/**
 * The one scored activity underway: a landing mission, the checkpoint course, crosswind practice (a landing mission
 * in a borrowed wind, src/crosswind-practice.js) or none (free flight). Starting any of them ends the others first,
 * so they never run together, and ending the practice by any route gives the pilot's wind back; each keeps its own
 * start, scoring and controls. No DOM: the interface reads `kind`, `finished` and the activities.
 */
export class Activities {
  constructor(landing, course, practice = null) { this.landing = landing; this.course = course; this.practice = practice; }

  get kind() {
    if (this.practice?.running) return 'crosswind';
    return this.landing.status !== 'idle' ? 'landing' : this.course.status !== 'idle' ? 'course' : 'free';
  }
  get finished() { return this.landing.finished || this.course.finished; }

  startLanding(flight, field) { this.course.cancel(); this.practice?.end(); return this.landing.start(flight, field); }
  startCourse(flight) { this.practice?.end(); this.landing.cancel(); return this.course.start(flight); }
  /** Begin or retry crosswind practice; null when the aircraft cannot fly it (then nothing else is ended). */
  startCrosswind(flight) {
    if (!this.practice) return null;
    const s = this.practice.start(flight);
    if (s) this.course.cancel();
    return s;
  }
  cancel() { this.practice?.end(); this.landing.cancel(); this.course.cancel(); }

  /** One physics slice: only the activity underway reads it. */
  update(dt, state) { this.landing.update(dt, state); this.course.update(state); this.practice?.update(dt, state); }
}

/**
 * The one scored activity underway: a landing mission, the checkpoint course, or neither (free flight).
 * Starting either cancels the other first, so they never run together; each keeps its own start,
 * scoring and controls. No DOM: the interface reads `kind`, `finished` and the two activities.
 */
export class Activities {
  constructor(landing, course) { this.landing = landing; this.course = course; }

  get kind() { return this.landing.status !== 'idle' ? 'landing' : this.course.status !== 'idle' ? 'course' : 'free'; }
  get finished() { return this.landing.finished || this.course.finished; }

  startLanding(flight, field) { this.course.cancel(); return this.landing.start(flight, field); }
  startCourse(flight) { this.landing.cancel(); return this.course.start(flight); }
  cancel() { this.landing.cancel(); this.course.cancel(); }

  /** One physics slice: only the activity underway reads it. */
  update(dt, state) { this.landing.update(dt, state); this.course.update(state); }
}

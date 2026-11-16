import { normalizeWind } from './wind.js';

/**
 * A scored activity may borrow one wind configuration. First start saves the pilot's selection; retries reapply
 * the exercise wind without replacing that selection. Weather choices made meanwhile replace the saved choice.
 * Every exit calls release(), which restores it exactly once. Activities ends the old owner BEFORE a new one
 * starts, so one exercise never snapshots another's wind. Results retain ownership; Retry keeps it, an exit releases it.
 */
export class ActivityWind {
  constructor() { this.owning = false; this.previous = null; this.flight = null; this.watch = null; }

  borrow(flight, config) {
    if (this.owning && this.flight !== flight) this.release();
    const previous = flight.setWind(config, { immediate: true });
    if (!this.owning) this.previous = previous;
    this.owning = true; this.flight = flight;
  }

  /** Call after the activity's reset; observeFlight also watches finished results for an external reset. */
  watchFlight(state) {
    // reset() replaces the existing bodyRates record. Its identity catches a reset even at flight time zero,
    // before time/distance can decrease; no controller hook, extra physics state or wall clock is needed.
    this.watch = { aircraft: state.aircraft, time: state.flightTime, distance: state.distance, rates: state.bodyRates };
  }
  observeFlight(state) {
    const before = this.watch;
    const changed = before && (state.aircraft !== before.aircraft || state.flightTime < before.time
      || state.distance < before.distance || state.bodyRates !== before.rates);
    this.watchFlight(state);
    return !!changed;
  }

  holdPilotChoice(config) { if (!this.owning) return false; this.previous = normalizeWind(config); return true; }
  pilotWind(live) { return this.owning ? this.previous : live; }

  release() {
    const restored = this.owning;
    if (restored) this.flight.setWind(this.previous, { immediate: true });
    this.owning = false; this.previous = null; this.flight = null; this.watch = null;
    return restored;
  }
}

import { RULES_VERSION, REPLAY_VERSION, RUN_LIMITS, CONTROL_AXES, requireRun, validateAttempt,
  isRecord } from './ranked-rules.js';
import { referenceHeight } from './terrain.js';
import { createRankedSimulation, validateSlice, stepReplay, runStatus, runSucceeded, prescribedWind, readReplay } from './run-replay.js';

/** A single-use local recorder that owns actual physics slices. Pass existing {flight, activities} to use the UI's
 * flight, or omit it for an isolated simulation. It never accepts a client result as proof: the server replays.
 * Continuous controls are post-FlightInputs values; absent axes are zero, out-of-range inputs are refused.
 */
export class RunRecorder {
  #steps = [];
  #seconds = 0;
  #actions = 0;
  #sliceCount = 0;
  #rates;
  #attempt;
  #state = 'recording';
  #reason = '';

  constructor(attempt, { now, existing = null } = {}) {
    const board = validateAttempt(attempt, now);
    this.#attempt = { id: attempt.id, board, status: 'open', issuedAt: attempt.issuedAt, expiresAt: attempt.expiresAt };
    this.simulation = createRankedSimulation(board, existing);
    this.#rates = this.simulation.s.bodyRates;
  }

  get state() { return this.#state; }
  get reason() { return this.#reason; }
  get seconds() { return this.#seconds; }
  get slices() { return this.#sliceCount; }

  /** Call at the user action, including assist-on followed by assist-off between slices. Sticky until a new recorder. */
  invalidate(reason = 'INELIGIBLE_RUN') {
    if (this.#state === 'recording') { this.#state = 'invalid'; this.#reason = reason; this.#steps = []; this.#sliceCount = 0; }
  }

  #open() { requireRun(this.#state === 'recording', this.#state === 'finalized' ? 'RECORDING_FINALIZED' : 'INELIGIBLE_RUN', this.#reason || 'Recording is already finalized'); }

  /** Also call while paused and before result actions. A reset at time zero changes bodyRates identity. */
  observe() {
    this.#open();
    const { board, flight, activities, s } = this.simulation;
    const stale = s !== flight.state || s.bodyRates !== this.#rates || s.aircraft !== board.aircraft || flight.type.id !== board.aircraft
      || s.flightTime !== this.#seconds || activities.kind !== board.activity || runStatus(this.simulation) === 'idle';
    const alteredSetup = flight.backend !== 'javascript' || flight.heightAt !== referenceHeight
      || flight.windSnapshot().config !== prescribedWind(board);
    if (stale || alteredSetup || s.autopilot || s.crashed || runStatus(this.simulation) === 'failed') {
      this.invalidate(stale ? 'STALE_RECORDING' : alteredSetup ? 'SETUP_CHANGED' : s.autopilot ? 'ASSIST_USED' : 'FAILED_RUN');
      this.#open();
    }
    return true;
  }

  /** One call = exactly one live FlightController.update and Activities.update. Do not step those again externally. */
  step(dt, controls = {}, actions = []) {
    this.observe();
    try {
      requireRun(isRecord(controls) && Object.keys(controls).every(key => CONTROL_AXES.includes(key)), 'INVALID_CONTROLS', 'Unknown control axis');
      requireRun(Array.isArray(actions) && actions.length <= 3, 'INVALID_ACTION', 'At most three actions per slice');
      const slice = validateSlice([dt, ...CONTROL_AXES.map(axis => Object.hasOwn(controls, axis) ? controls[axis] : 0), [...actions]]);
      requireRun(this.#steps.length < RUN_LIMITS.slices && this.#seconds + dt <= RUN_LIMITS.seconds
        && this.#actions + actions.length <= RUN_LIMITS.actions, 'REPLAY_LIMIT', 'Recording exceeds its bounds');
      stepReplay(this.simulation, slice);
      this.#steps.push(slice); this.#sliceCount++; this.#seconds += dt; this.#actions += actions.length;
      this.observe();
      return this.simulation.s;
    } catch (error) {
      this.invalidate(error.code ?? 'INELIGIBLE_RUN');
      throw error;
    }
  }

  /** Pauses add no slice or duration. now is server-clock-aligned wall time, used only for attempt expiry. */
  finish({ now } = {}) {
    this.observe();
    try {
      validateAttempt(this.#attempt, now);
      requireRun(runSucceeded(this.simulation), 'INCOMPLETE_RUN', 'Only a completed manual run can be submitted');
      const replay = { version: REPLAY_VERSION, rulesVersion: RULES_VERSION, attemptId: this.#attempt.id,
        board: this.#attempt.board, steps: this.#steps };
      // Reuse the wire check, returning a detached object; later simulation/input mutations cannot rewrite it.
      const result = readReplay(replay).replay;
      this.#state = 'finalized'; this.#steps = [];
      return result;
    } catch (error) {
      this.invalidate(error.code ?? 'INELIGIBLE_RUN');
      throw error;
    }
  }
}

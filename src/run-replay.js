// Canonical simulation and bounded wire validation, shared by the recorder and authoritative verifier.
import { FlightController, hasPitchTrim } from './flight.js';
import { referenceHeight } from './terrain.js';
import { LandingMission } from './landing-mission.js';
import { CheckpointCourse, COURSE } from './checkpoint-course.js';
import { CrosswindPractice, PRACTICE, practiceField } from './crosswind-practice.js';
import { StallRecovery } from './stall-recovery.js';
import { Activities } from './activities.js';
import { CALM, WIND_PRESETS } from './wind.js';
import { RULES_VERSION, REPLAY_VERSION, RUN_LIMITS, CONTROL_AXES, RUN_ACTIONS,
  requireRun, exactFields, validRunId, validateBoard, boardField } from './ranked-rules.js';

/** Configure an existing flight/activity pair, or make an isolated simulation. Normal APIs are unchanged.
 * Ranked v1 explicitly uses the JS reference engine AND terrain on both ends, even when WASM is initialized.
 * Callers using an existing flight restore its previous engine/heightAt after leaving ranked play.
 */
export function createRankedSimulation(value, existing = null) {
  const board = validateBoard(value), flight = existing?.flight ?? new FlightController(referenceHeight, board.aircraft, { engine: 'javascript' });
  const landing = existing?.activities.landing ?? new LandingMission();
  const course = existing?.activities.course ?? new CheckpointCourse();
  const practice = existing?.activities.practice ?? new CrosswindPractice(landing);
  const recovery = existing?.activities.recovery ?? new StallRecovery();
  const activities = existing?.activities ?? new Activities(landing, course, practice, recovery);
  requireRun(activities.practice && activities.recovery, 'INVALID_SIMULATION', 'All four activity rules are required');
  requireRun(practice.landing === landing, 'INVALID_SIMULATION', 'Crosswind and Activities must share the landing mission');
  activities.cancel();
  course.course = COURSE; practice.field = practiceField();
  flight.engine = 'javascript'; flight.heightAt = referenceHeight;
  if (flight.type.id !== board.aircraft) flight.setAircraft(board.aircraft);
  flight.setWind(WIND_PRESETS[board.setup] ?? CALM, { immediate: true });
  let state;
  if (board.activity === 'course') state = activities.startCourse(flight);
  if (board.activity === 'landing') state = activities.startLanding(flight, boardField(board));
  if (board.activity === 'crosswind') state = activities.startCrosswind(flight);
  if (board.activity === 'recovery') state = activities.startRecovery(flight);
  requireRun(!!state, 'INVALID_SIMULATION', 'Prescribed activity could not start');
  return { board, flight, activities, landing, course, practice, recovery, s: state };
}

export function runStatus({ board, activities }) {
  return board.activity === 'course' ? activities.course.status
    : board.activity === 'recovery' ? activities.recovery.status : activities.landing.status;
}
export function runSucceeded(simulation) { return runStatus(simulation) === (simulation.board.activity === 'course' ? 'complete' : 'success'); }

export function validateSlice(slice) {
  requireRun(Array.isArray(slice) && slice.length === 8, 'INVALID_SLICE', 'Expected dt, six normalized controls and actions');
  requireRun(typeof slice[0] === 'number' && Number.isFinite(slice[0]) && slice[0] > 0 && slice[0] <= RUN_LIMITS.sliceSeconds,
    'INVALID_SLICE', 'Invalid simulation slice duration');
  for (let i = 0; i < CONTROL_AXES.length; i++) requireRun(typeof slice[i + 1] === 'number' && Number.isFinite(slice[i + 1])
    && slice[i + 1] >= (CONTROL_AXES[i] === 'brake' ? 0 : -1) && slice[i + 1] <= 1, 'INVALID_CONTROLS', 'Controls must be finite and normalized');
  requireRun(Array.isArray(slice[7]) && slice[7].length <= RUN_ACTIONS.length
    && new Set(slice[7]).size === slice[7].length && slice[7].every(action => RUN_ACTIONS.includes(action)),
  'INVALID_ACTION', 'Only one gear, flaps and trim-neutral action per slice is allowed');
  return slice;
}

/** Called before physics, in recorded array order. Holding trim is the sixth continuous control. */
export function applyRunActions(flight, actions) {
  for (const action of actions) {
    requireRun(RUN_ACTIONS.includes(action), 'INVALID_ACTION', 'Unsupported action');
    if (action === 'gear') flight.toggleGear();
    if (action === 'flaps') flight.cycleFlaps();
    if (action === 'trim-neutral' && hasPitchTrim(flight.type)) flight.state.pitchTrim = 0;
  }
}

export function stepReplay(simulation, slice) {
  requireRun(!simulation.activities.finished, 'TRAILING_SLICES', 'Replay continues after the activity finished');
  applyRunActions(simulation.flight, slice[7]);
  requireRun(!simulation.activities.beforeStep(simulation.s), 'INELIGIBLE_RUN', 'Activity ended before the slice');
  simulation.flight.update(slice[0], Object.fromEntries(CONTROL_AXES.map((axis, i) => [axis, slice[i + 1]])));
  simulation.activities.update(slice[0], simulation.s);
}

/** UTF-8 byte cap is enforced on the JSON, including object inputs. HTTP must also cap bytes before parsing. */
export function readReplay(input) {
  let replay = input;
  try {
    if (typeof input === 'string') {
      requireRun(input.length <= RUN_LIMITS.bytes && new TextEncoder().encode(input).byteLength <= RUN_LIMITS.bytes,
        'REPLAY_LIMIT', 'Replay exceeds the byte limit');
      replay = JSON.parse(input);
    }
  } catch (error) {
    if (error.code) throw error;
    requireRun(false, 'INVALID_REPLAY', 'Replay must be bounded valid JSON');
  }
  requireRun(exactFields(replay, ['version', 'rulesVersion', 'attemptId', 'board', 'steps']), 'INVALID_REPLAY', 'Unexpected replay fields');
  requireRun(replay.version === REPLAY_VERSION, 'UNSUPPORTED_REPLAY', 'Unsupported replay version');
  requireRun(replay.rulesVersion === RULES_VERSION, 'UNSUPPORTED_RULES', 'Unsupported ranked rules version');
  validateBoard(replay.board);
  requireRun(validRunId(replay.attemptId), 'INVALID_ATTEMPT', 'Invalid replay attempt id');
  requireRun(Array.isArray(replay.steps) && replay.steps.length > 0 && replay.steps.length <= RUN_LIMITS.slices,
    'REPLAY_LIMIT', 'Replay has no slices or too many slices');
  let seconds = 0, actions = 0;
  for (const slice of replay.steps) {
    validateSlice(slice); seconds += slice[0]; actions += slice[7].length;
    requireRun(seconds <= RUN_LIMITS.seconds && actions <= RUN_LIMITS.actions, 'REPLAY_LIMIT', 'Replay exceeds simulation or action limits');
  }
  // Serialize only the now-bounded schema. Unknown fields and nested control/action objects were already rejected.
  let json;
  try { json = JSON.stringify(replay); }
  catch { requireRun(false, 'INVALID_REPLAY', 'Replay must be bounded valid JSON'); }
  requireRun(new TextEncoder().encode(json).byteLength <= RUN_LIMITS.bytes, 'REPLAY_LIMIT', 'Replay exceeds the byte limit');
  return { replay: JSON.parse(json), seconds };
}

/** Every metric originates in activity/controller observations from the reconstructed simulation. */
export function verifiedMetrics(simulation) {
  requireRun(runSucceeded(simulation), 'INCOMPLETE_RUN', 'Only a completed successful run can rank');
  const { board, activities, s } = simulation, integer = value => {
    const result = Math.round(value);
    requireRun(Number.isSafeInteger(result) && result >= 0, 'INVALID_METRICS', 'Nonfinite simulation result');
    return result === 0 ? 0 : result;
  };
  if (board.activity === 'course') return { elapsedMs: integer(activities.course.elapsed * 1000),
    splitsMs: activities.course.splits.map(time => integer(time * 1000)) };
  if (board.activity === 'recovery') {
    const result = activities.recovery.result;
    return { heightLostMm: integer(result.heightLost * 1000), recoveryMs: integer(result.recoveryTime * 1000),
      attemptMs: integer(result.attemptTime * 1000) };
  }
  const touchdown = activities.landing.touchdown;
  return { sinkMmPerSecond: integer(touchdown.sink * 1000), centrelineMm: integer(Math.abs(touchdown.cross) * 1000),
    alignmentMilliDegrees: integer(touchdown.alignment * 1000), touchdownAlongMm: integer(touchdown.along * 1000),
    speedMmPerSecond: integer(touchdown.speed * 1000), elapsedMs: integer(s.flightTime * 1000) };
}

/** The effective setup is checked by the local recorder too; later wind edits cannot continue a ranked attempt. */
export function prescribedWind(board) {
  return board.activity === 'crosswind' ? PRACTICE.wind : WIND_PRESETS[board.setup] ?? CALM;
}

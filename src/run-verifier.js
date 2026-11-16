import { RankedRunError, requireRun, validateAttempt, boardKey } from './ranked-rules.js';
import { createRankedSimulation, readReplay, stepReplay, verifiedMetrics, runSucceeded } from './run-replay.js';

/** Pure authoritative replay: trusted attempt + server time in, bounded result out. No client score/pose is read.
 * Service callers load the attempt by authenticated owner, lock/finalize it transactionally and isolate CPU work.
 */
export function verifyReplay(input, attempt, { now } = {}) {
  try {
    const board = validateAttempt(attempt, now), { replay, seconds } = readReplay(input);
    requireRun(replay.attemptId === attempt.id, 'ATTEMPT_MISMATCH', 'Replay belongs to a different attempt');
    requireRun(boardKey(replay.board) === boardKey(board), 'BOARD_MISMATCH', 'Replay does not match the issued board');
    const simulation = createRankedSimulation(board);
    for (const slice of replay.steps) stepReplay(simulation, slice);
    requireRun(runSucceeded(simulation) && !simulation.s.autopilot && !simulation.s.crashed,
      'INCOMPLETE_RUN', 'Replay did not complete a successful manual run');
    return { ok: true, board, boardKey: boardKey(board), metrics: verifiedMetrics(simulation),
      simulationSeconds: seconds, slices: replay.steps.length };
  } catch (error) {
    if (!(error instanceof RankedRunError)) throw error;
    return { ok: false, code: error.code, message: error.message };
  }
}

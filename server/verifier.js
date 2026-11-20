import { Worker } from 'node:worker_threads';
import { HttpError } from './protocol.js';

export function verifyInWorker(replay, attempt, now, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./verify-worker.js', import.meta.url), {
      workerData: { replay, attempt, now }, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Keep the database semaphore until the worker has actually stopped, including timeout paths.
      await worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new HttpError(503, 'VERIFICATION_BUSY', 'Verification timed out; retry the same replay')), timeoutMs);
    worker.once('message', result => finish(null, result));
    worker.once('error', error => finish(error));
    worker.once('exit', () => finish(new Error('Replay worker exited without a result')));
  });
}

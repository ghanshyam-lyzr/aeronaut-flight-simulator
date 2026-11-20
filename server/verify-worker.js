import { parentPort, workerData } from 'node:worker_threads';
import { verifyReplay } from '../src/run-verifier.js';

parentPort.postMessage(verifyReplay(workerData.replay, workerData.attempt, { now: workerData.now }));

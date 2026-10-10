// Worker thread: runs searchTheme for one job at a time and posts the result back.
import { parentPort, workerData } from 'node:worker_threads';
import { searchTheme } from '../build-drop.mjs';

parentPort.on('message', (job) => {
  const started = performance.now();
  try {
    const result = searchTheme(job.theme, job.dropId, {
      attempts: job.attempts, seconds: job.seconds, eligible: job.eligible, blockset: workerData.blockset,
    });
    parentPort.postMessage({ id: job.theme.id, result, ms: performance.now() - started });
  } catch (err) {
    parentPort.postMessage({ id: job.theme.id, error: err.stack ?? String(err) });
  }
});

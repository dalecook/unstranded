// Worker thread: runs the theme search for one job at a time and posts the result back.
import { parentPort, workerData } from 'node:worker_threads';
import { searchJob } from '../build-drop.mjs';

parentPort.on('message', (job) => {
  const started = performance.now();
  try {
    const result = searchJob(job, workerData.blockset);
    parentPort.postMessage({ id: job.theme.id, result, ms: performance.now() - started });
  } catch (err) {
    parentPort.postMessage({ id: job.theme.id, error: err.stack ?? String(err) });
  }
});

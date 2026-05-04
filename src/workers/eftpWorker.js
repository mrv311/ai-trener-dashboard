/**
 * eFTP Web Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs estimateFTPFromWorkout over multiple historical workouts in a
 * background thread so the UI never jank during batch processing.
 *
 * Protocol:
 *   Main → Worker:  { type: 'BATCH_EFTP', workouts: [ { id, sensorData } ] }
 *   Worker → Main:  { type: 'BATCH_EFTP_RESULT', results: [ { id, eFTP } ] }
 *
 *   Main → Worker:  { type: 'SINGLE_EFTP', id, sensorData }
 *   Worker → Main:  { type: 'SINGLE_EFTP_RESULT', id, eFTP }
 */

// ── Inline copies of the pure math functions ────────────────────────────────
// We duplicate them here because Web Workers can't import ES modules from the
// main bundle in all browsers. These are small, self-contained functions.

function getPeakPowerForDuration(sensorData, windowSeconds) {
  if (
    !Array.isArray(sensorData) ||
    sensorData.length < windowSeconds ||
    windowSeconds <= 0
  ) {
    return null;
  }

  let windowSum = 0;
  for (let i = 0; i < windowSeconds; i++) {
    windowSum += (sensorData[i].power || 0);
  }

  let maxSum = windowSum;

  for (let i = windowSeconds; i < sensorData.length; i++) {
    windowSum += (sensorData[i].power || 0);
    windowSum -= (sensorData[i - windowSeconds].power || 0);
    if (windowSum > maxSum) {
      maxSum = windowSum;
    }
  }

  return Math.round(maxSum / windowSeconds);
}

function estimateFTPFromWorkout(sensorData) {
  const T5 = 300;
  const T20 = 1200;

  if (!Array.isArray(sensorData) || sensorData.length < T20) {
    return null;
  }

  const peak5 = getPeakPowerForDuration(sensorData, T5);
  const peak20 = getPeakPowerForDuration(sensorData, T20);

  if (peak5 === null || peak20 === null || peak5 === 0 || peak20 === 0) {
    return null;
  }

  const work5 = peak5 * T5;
  const work20 = peak20 * T20;
  const criticalPower = (work20 - work5) / (T20 - T5);
  const ftp95 = peak20 * 0.95;

  return Math.round((criticalPower + ftp95) / 2);
}

// ── Message handler ─────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const { type } = e.data;

  if (type === 'BATCH_EFTP') {
    const { workouts } = e.data;
    const results = [];

    for (let i = 0; i < workouts.length; i++) {
      const { id, sensorData } = workouts[i];
      const eFTP = estimateFTPFromWorkout(sensorData);
      results.push({ id, eFTP });

      // Yield progress every 5 workouts so the main thread can show updates
      if (i % 5 === 0) {
        self.postMessage({
          type: 'BATCH_EFTP_PROGRESS',
          processed: i + 1,
          total: workouts.length,
        });
      }
    }

    self.postMessage({ type: 'BATCH_EFTP_RESULT', results });
  }

  if (type === 'SINGLE_EFTP') {
    const { id, sensorData } = e.data;
    const eFTP = estimateFTPFromWorkout(sensorData);
    self.postMessage({ type: 'SINGLE_EFTP_RESULT', id, eFTP });
  }
};

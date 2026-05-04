import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { estimateFTPFromWorkout } from '../utils/performanceMetrics';

/**
 * useEFTPWorker
 * ─────────────────────────────────────────────────────────────────────────────
 * Custom hook that provides two capabilities:
 *
 * 1. **Memoized single-workout eFTP** — runs `estimateFTPFromWorkout` on the
 *    main thread but wrapped in `useMemo` with a strict dependency on the
 *    sensorData reference. Safe for arrays up to ~10 000 samples because the
 *    underlying algorithm is O(n) with zero allocations.
 *
 * 2. **Batch eFTP via Web Worker** — when given multiple historical workouts
 *    with full sensor streams, delegates the heavy loop to a background thread
 *    so the UI stays responsive.
 *
 * @param {Array|null} currentSensorData
 *   1 Hz sensor array for the "current" workout (may be null).
 * @returns {{
 *   currentEFTP: number|null,
 *   batchResults: Array<{id: string, eFTP: number|null}>,
 *   batchProgress: {processed: number, total: number}|null,
 *   isBatchProcessing: boolean,
 *   processBatch: (workouts: Array<{id: string, sensorData: Array}>) => void
 * }}
 */
export function useEFTPWorker(currentSensorData = null) {
  // ── 1. Memoized single-workout eFTP (main thread, O(n)) ────────────────
  //    This prevents re-computation on every render. The dependency is the
  //    sensorData array *reference* — callers must stabilise it via useState
  //    or useRef to avoid spurious recalcs.
  const currentEFTP = useMemo(() => {
    if (!currentSensorData || currentSensorData.length === 0) return null;
    return estimateFTPFromWorkout(currentSensorData);
  }, [currentSensorData]);

  // ── 2. Batch processing via Web Worker ─────────────────────────────────
  const workerRef = useRef(null);
  const [batchResults, setBatchResults] = useState([]);
  const [batchProgress, setBatchProgress] = useState(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // Lazily create the Worker on first batch request, not on mount
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/eftpWorker.js', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (e) => {
        const { type } = e.data;

        if (type === 'BATCH_EFTP_PROGRESS') {
          setBatchProgress({
            processed: e.data.processed,
            total: e.data.total,
          });
        }

        if (type === 'BATCH_EFTP_RESULT') {
          setBatchResults(e.data.results);
          setIsBatchProcessing(false);
          setBatchProgress(null);
        }

        if (type === 'SINGLE_EFTP_RESULT') {
          // Not used in the hook's public API currently, but available
          // for future per-workout streaming results.
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('[useEFTPWorker] Worker error:', err);
        setIsBatchProcessing(false);
        setBatchProgress(null);
      };
    }
    return workerRef.current;
  }, []);

  // Terminate worker on unmount to free resources
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  /**
   * Send an array of workouts to the Web Worker for batch eFTP computation.
   * Each item must have `{ id: string, sensorData: Array }`.
   */
  const processBatch = useCallback(
    (workouts) => {
      if (!workouts || workouts.length === 0) return;

      setIsBatchProcessing(true);
      setBatchResults([]);
      setBatchProgress({ processed: 0, total: workouts.length });

      const worker = getWorker();
      worker.postMessage({ type: 'BATCH_EFTP', workouts });
    },
    [getWorker]
  );

  return {
    currentEFTP,
    batchResults,
    batchProgress,
    isBatchProcessing,
    processBatch,
  };
}

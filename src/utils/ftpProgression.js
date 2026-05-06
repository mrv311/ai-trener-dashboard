/**
 * Longitudinal FTP Progression Engine
 * ---------------------------------------------------------------------------
 * Evaluates a training block (e.g. 3 weeks of structured workouts) and
 * recommends an updated FTP based on two key signals:
 *
 *   1. Plan Adherence  — Did the athlete hit the prescribed intensities?
 *   2. EF Trend        — Is aerobic efficiency (NP / HR) improving over time?
 *
 * All calculations run in a single O(n) pass over the workouts array.
 */

// ── FTP Detection Cooldown ──────────────────────────────────────────────────

/** Minimum days between FTP detection attempts */
const FTP_COOLDOWN_DAYS = 30;

/** Milliseconds in one day */
const MS_PER_DAY = 86_400_000;

/**
 * Checks whether the user is allowed to run a new eFTP detection based on a
 * 30-day cooldown period since their last update.
 *
 * @param {string|number|null} lastUpdateTimestamp
 *   ISO 8601 string, Unix epoch (ms), or `null` if the user has never run
 *   a detection. Any falsy / unparseable value is treated as "never updated"
 *   and immediately allows detection.
 * @returns {{ allowed: boolean, daysRemaining: number }}
 *   - `allowed`       — `true` if ≥ 30 days have elapsed (or no prior update).
 *   - `daysRemaining`  — Days left until the next detection is allowed
 *     (0 when `allowed` is `true`).
 *
 * @example
 *   const { allowed, daysRemaining } = canDetectFTP(profile.lastFtpUpdate);
 *   if (!allowed) console.log(`Čekaj još ${daysRemaining} dana`);
 */
export function canDetectFTP(lastUpdateTimestamp) {
  // No prior update → always allowed
  if (!lastUpdateTimestamp) {
    return { allowed: true, daysRemaining: 0 };
  }

  const lastDate = new Date(lastUpdateTimestamp);

  // Guard against invalid / corrupt timestamps
  if (isNaN(lastDate.getTime())) {
    return { allowed: true, daysRemaining: 0 };
  }

  const elapsedMs = Date.now() - lastDate.getTime();
  const elapsedDays = elapsedMs / MS_PER_DAY;

  if (elapsedDays >= FTP_COOLDOWN_DAYS) {
    return { allowed: true, daysRemaining: 0 };
  }

  return {
    allowed: false,
    daysRemaining: Math.ceil(FTP_COOLDOWN_DAYS - elapsedDays),
  };
}

// ── Tuning Constants ────────────────────────────────────────────────────────
/** Minimum adherence ratio to qualify for an FTP increase */
const ADHERENCE_THRESHOLD_GROWTH = 0.98;

/** Adherence ratio below which a penalty is applied */
const ADHERENCE_THRESHOLD_DROP = 0.90;

/** Minimum EF improvement ratio (second-half / first-half) for growth */
const EF_IMPROVEMENT_MIN = 1.02;

/** Maximum FTP growth percentage per block (cap) */
const MAX_GROWTH_PCT = 0.05;

/** Minimum FTP growth percentage when conditions are met */
const MIN_GROWTH_PCT = 0.02;

/** FTP penalty percentage when adherence is poor */
const DROP_PCT = 0.02;

/**
 * Calculates a recommended FTP adjustment after a structured training block.
 *
 * Only **interval sessions** (`isInterval === true`) are considered — endurance
 * rides and recovery spins are excluded because their NP/HR relationship
 * carries different physiological meaning.
 *
 * ### Algorithm (single O(n) pass)
 *
 * 1. Iterate through `blockWorkouts` once, accumulating:
 *    - Total `actualNP` and `targetNP` (for adherence).
 *    - Per-session EF values split into first-half and second-half buckets
 *      (by workout index, not calendar date — keeps it deterministic).
 *
 * 2. **Plan Adherence** = Σ(actualNP) / Σ(targetNP).
 *
 * 3. **EF Trend** = mean EF of the second half / mean EF of the first half.
 *
 * 4. Decision matrix:
 *    | Adherence  | EF Trend  | Action                          |
 *    |------------|-----------|---------------------------------|
 *    | ≥ 98 %     | > 1.02    | Increase FTP by 2–5 %          |
 *    | < 90 %     | any       | Decrease FTP by 2 %            |
 *    | otherwise  | any       | Hold current FTP                |
 *
 *    When growing, the increase is linearly interpolated between
 *    `MIN_GROWTH_PCT` and `MAX_GROWTH_PCT` based on how far the EF
 *    improvement exceeds the 1.02 threshold (capped at 1.10).
 *
 * @param {number} baseFTP
 *   The athlete's current FTP in watts before the block.
 * @param {Array<{
 *   actualNP: number,
 *   targetNP: number,
 *   avgHR: number,
 *   duration: number,
 *   isInterval: boolean
 * }>} blockWorkouts
 *   Chronologically ordered array of workout summaries for the block.
 *
 * @returns {{
 *   newFTP: number,
 *   delta: number,
 *   deltaPct: string,
 *   decision: 'increase' | 'decrease' | 'hold',
 *   adherence: string,
 *   efTrend: string,
 *   intervalCount: number
 * }}
 *   An object describing the recommendation:
 *   - `newFTP`         — Recommended FTP (rounded integer).
 *   - `delta`          — Absolute change in watts.
 *   - `deltaPct`       — Percentage change (e.g. "+3.2 %").
 *   - `decision`       — One of `'increase'`, `'decrease'`, `'hold'`.
 *   - `adherence`      — Plan adherence ratio as a readable string.
 *   - `efTrend`        — EF improvement ratio as a readable string.
 *   - `intervalCount`  — Number of interval sessions analysed.
 *
 * @example
 *   const result = calculateLongitudinalFTP(250, [
 *     { actualNP: 245, targetNP: 250, avgHR: 155, duration: 3600, isInterval: true },
 *     { actualNP: 248, targetNP: 250, avgHR: 153, duration: 3600, isInterval: true },
 *     { actualNP: 252, targetNP: 250, avgHR: 151, duration: 3600, isInterval: true },
 *     { actualNP: 200, targetNP: 200, avgHR: 130, duration: 5400, isInterval: false }, // ignored
 *   ]);
 *   // => { newFTP: 257, delta: 7, deltaPct: "+2.8 %", decision: "increase", ... }
 */
export function calculateLongitudinalFTP(baseFTP, blockWorkouts) {
  // ── Input validation ────────────────────────────────────────────────────
  // Coerce to number — profile.ftp can arrive as a string from localStorage,
  // and "275" + 0 = "2750" (string concatenation!) instead of 275.
  const safeFTP = Number(baseFTP) || 0;

  if (safeFTP <= 0) {
    return _buildResult(safeFTP, 0, 'hold', 0, 0, 0);
  }

  if (!Array.isArray(blockWorkouts) || blockWorkouts.length === 0) {
    return _buildResult(safeFTP, 0, 'hold', 0, 0, 0);
  }

  // ── Single O(n) pass ──────────────────────────────────────────────────
  // Collect interval-only workouts and their metrics in one sweep.
  const intervals = [];
  let totalAdherenceScore = 0;
  let validAdherenceCount = 0;

  for (let i = 0; i < blockWorkouts.length; i++) {
    const w = blockWorkouts[i];
    if (!w.isInterval) continue;

    // Guard against invalid / missing fields
    const actual = w.actualNP || 0;
    const target = w.targetNP || 0;
    const hr = w.avgHR || 0;

    if (target > 0) {
      // Cap individual adherence at 1.2 (120%) to prevent over-performing from skewing
      const score = Math.min(actual / target, 1.2);
      totalAdherenceScore += score;
      validAdherenceCount++;
    }

    // EF = NP / HR  (only meaningful when HR > 0)
    const ef = hr > 0 ? actual / hr : 0;
    intervals.push(ef);
  }

  const intervalCount = intervals.length;

  // Need at least 2 interval sessions to compute a trend
  if (intervalCount < 2) {
    return _buildResult(safeFTP, 0, 'hold', 0, 0, intervalCount);
  }

  // ── Plan Adherence ────────────────────────────────────────────────────
  const adherence = validAdherenceCount > 0 ? (totalAdherenceScore / validAdherenceCount) : 1;

  // ── EF Trend (first half vs second half) ──────────────────────────────
  const midpoint = Math.floor(intervalCount / 2);

  let efSumFirst = 0;
  let efSumSecond = 0;

  // First half: indices [0, midpoint)
  for (let i = 0; i < midpoint; i++) {
    efSumFirst += intervals[i];
  }
  // Second half: indices [midpoint, end)
  for (let i = midpoint; i < intervalCount; i++) {
    efSumSecond += intervals[i];
  }

  const efMeanFirst = efSumFirst / midpoint;
  const efMeanSecond = efSumSecond / (intervalCount - midpoint);

  // Protect against zero-division (all-zero HR data)
  const efTrend = efMeanFirst > 0 ? efMeanSecond / efMeanFirst : 1;

  // ── Decision Matrix ───────────────────────────────────────────────────
  let decision = 'hold';
  let growthFactor = 0;

  if (adherence >= ADHERENCE_THRESHOLD_GROWTH && efTrend > EF_IMPROVEMENT_MIN) {
    decision = 'increase';

    // Linearly interpolate growth between MIN and MAX based on EF overshoot.
    // EF_IMPROVEMENT_MIN (1.02) → MIN_GROWTH_PCT (2 %)
    // 1.10 or above          → MAX_GROWTH_PCT (5 %)
    const efOvershoot = Math.min(efTrend - EF_IMPROVEMENT_MIN, 0.08); // cap at 0.08
    const t = efOvershoot / 0.08; // normalise to [0, 1]
    growthFactor = MIN_GROWTH_PCT + t * (MAX_GROWTH_PCT - MIN_GROWTH_PCT);
  } else if (adherence < ADHERENCE_THRESHOLD_DROP) {
    decision = 'decrease';
    growthFactor = -DROP_PCT;
  }

  const delta = Math.round(safeFTP * growthFactor);
  return _buildResult(safeFTP, delta, decision, adherence, efTrend, intervalCount);
}

// ── Private helper ──────────────────────────────────────────────────────────

/**
 * Builds a standardised result object.
 * @private
 */
function _buildResult(baseFTP, delta, decision, adherence, efTrend, intervalCount) {
  const newFTP = baseFTP + delta;
  const deltaPct = baseFTP > 0 ? ((delta / baseFTP) * 100).toFixed(1) : '0.0';
  const sign = delta >= 0 ? '+' : '';

  return {
    newFTP,
    delta,
    deltaPct: `${sign}${deltaPct} %`,
    decision,
    adherence: (adherence * 100).toFixed(1) + ' %',
    efTrend: efTrend.toFixed(3),
    intervalCount,
  };
}

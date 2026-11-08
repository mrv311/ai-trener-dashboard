/**
 * Coggan Performance Metrics Engine
 * Optimizirani "Sliding Window" O(1) izračun metrika u realnom vremenu
 * Isti kod koristi se i za parsanje usklađeno s Intervals.icu standardima.
 */

/**
 * Vraća Tailwind CSS klasu za boju zone ovisno o postotku FTP-a
 * @param {number} percentFTP - Postotak FTP-a (0-200+)
 * @returns {string} - Tailwind CSS klasa
 */
export const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-zinc-500';
  if (percentFTP < 75) return 'bg-sky-500';
  if (percentFTP < 90) return 'bg-emerald-500';
  if (percentFTP < 105) return 'bg-amber-500';
  if (percentFTP < 120) return 'bg-rose-500';
  return 'bg-purple-500';
};

/**
 * Računa detaljne Coggan metrike iz apsolutnog polja wata
 * @param {number[]} powerArray - Niz wata sekundu-po-sekundu 
 * @param {number} ftp - Korisnikov FTP (ili default)
 * @returns {Object} { np, avgPower, tss, ifFactor, workKj }
 */
export function calculateCogganMetrics(powerArray, ftp) {
  if (!powerArray || powerArray.length === 0) {
    return { np: 0, avgPower: 0, tss: 0, ifFactor: "0.00", workKj: 0 };
  }
  
  const validFtp = ftp && ftp > 0 ? ftp : 200; // Osiguranje od / 0
  let totalWorkJ = 0;
  
  let sumPwr4 = 0;
  let currentWindowSum = 0;
  
  // Inicijaliziraj prvi 30-sekundni prozor
  const windowSize = 30;
  for (let i = 0; i < Math.min(windowSize, powerArray.length); i++) {
    const p = powerArray[i] || 0;
    totalWorkJ += p;
    currentWindowSum += p;
  }
  
  // Ako imamo manje od 30 sekundi, koristimo što imamo
  if (powerArray.length < windowSize) {
    const avg = currentWindowSum / powerArray.length;
    sumPwr4 = Math.pow(avg, 4) * powerArray.length;
  } else {
    // Dodaj prvi puni prozor
    const avg30 = currentWindowSum / windowSize;
    sumPwr4 += Math.pow(avg30, 4);
    
    // Sliding window za ostatak - O(1) po iteraciji
    for (let i = windowSize; i < powerArray.length; i++) {
      const p = powerArray[i] || 0;
      totalWorkJ += p;
      
      // Pomakni prozor: dodaj novi, oduzmi stari
      currentWindowSum += p;
      currentWindowSum -= (powerArray[i - windowSize] || 0);
      
      const avg30 = currentWindowSum / windowSize;
      sumPwr4 += Math.pow(avg30, 4);
    }
  }
  
  // Zaštita od dijeljenja s nulom
  let avgPower = powerArray.length > 0 ? Math.round(totalWorkJ / powerArray.length) : 0;
  let np = powerArray.length > 0 ? Math.round(Math.pow(sumPwr4 / powerArray.length, 0.25)) : 0;
  
  // Zaštita od dijeljenja s nulom i Infinity
  let IF = (validFtp > 0 && np > 0) ? (np / validFtp) : 0;
  let tss = powerArray.length > 0 ? (powerArray.length / 3600) * (IF * IF) * 100 : 0;
  let workKj = totalWorkJ / 1000;
  
  return {
    np,
    avgPower,
    tss: Math.round(tss),
    ifFactor: IF.toFixed(2),
    workKj: Math.round(workKj)
  };
}

/**
 * Pomoćna metoda za predikcijski izračun TSS-a unaprijed iz sažetih koraka (Parser)
 * @param {Array} steps - Niz objekata { power: broj (često % FTP-a), duration: sekunde }
 * @param {number} ftp - FTP koji će se primijeniti (ako power predstavlja postotak)
 * @returns {number[]} powerArray - Rastegnuti sekundu-po-sekundu array wata
 */
export function expandStepsToSeconds(steps, ftp) {
  const result = [];
  if (!Array.isArray(steps)) return result;
  const validFtp = ftp && ftp > 0 ? ftp : 200;

  const toWatts = (val) => {
    const num = Number(val) || 0;
    if (num > 0 && num <= 3) return num * validFtp; // decimalni omjer (npr. 0.85)
    if (num >= 0 && num <= 300) return (num / 100) * validFtp; // % FTP-a
    return num; // apsolutni wati (>300)
  };

  steps.forEach(step => {
    if (!step) return;
    const durSec = Math.max(0, Math.round(Number(step.duration) || 0));
    if (durSec <= 0) return;

    const pMin = step.powerMin ?? (typeof step.power === 'object' && step.power ? (step.power.min ?? step.power.start ?? step.power.low) : null);
    const pMax = step.powerMax ?? (typeof step.power === 'object' && step.power ? (step.power.max ?? step.power.end ?? step.power.high) : null);
    const hasRamp = !!(step.ramp || (step.power && step.power.ramp));

    if (hasRamp && pMin != null && pMax != null && pMin !== pMax && durSec > 1) {
      const startW = toWatts(pMin);
      const endW = toWatts(pMax);
      for (let i = 0; i < durSec; i++) {
        result.push(startW + ((endW - startW) * i) / (durSec - 1));
      }
    } else if (pMin != null && pMax != null && pMin !== pMax) {
      // Za statički raspon (npr. 65-75%), koristimo srednju vrijednost za metrike (NP, TSS)
      const avgW = toWatts((Number(pMin) + Number(pMax)) / 2);
      for (let i = 0; i < durSec; i++) {
        result.push(avgW);
      }
    } else {
      let rawPwr = 50;
      if (typeof step.power === 'object' && step.power !== null) {
        const val = step.power.value;
        const pM = step.power.min ?? step.power.start ?? step.power.low;
        const pX = step.power.max ?? step.power.end ?? step.power.high;
        if (pM != null && pX != null) rawPwr = (Number(pM) + Number(pX)) / 2;
        else if (val != null && Number(val) > 0) rawPwr = Number(val);
        else if (pM != null) rawPwr = Number(pM);
        else if (pX != null) rawPwr = Number(pX);
      } else if (step.power != null && Number(step.power) > 0) {
        rawPwr = Number(step.power);
      }
      const watts = toWatts(rawPwr);
      for (let i = 0; i < durSec; i++) {
        result.push(watts);
      }
    }
  });

  return result;
}

/**
 * Računa Efficiency Factor (EF)
 * Odnos Normalized Power i prosječnog pulsa. Što veći, to je aerobna efikasnost bolja.
 */
export function calculateEF(np, avgHr) {
  if (!np || !avgHr || avgHr <= 0) return 0;
  return Number((np / avgHr).toFixed(2));
}

/**
 * Računa Variability Index (VI)
 * Odnos Normalized Power i prosječne snage. Prikazuje koliko je vožnja bila 'glatka' (ideally ~1.0 za TT, >1.2 za kriterij).
 */
export function calculateVI(np, avgPower) {
  if (!np || !avgPower || avgPower <= 0) return 0;
  return Number((np / avgPower).toFixed(2));
}

/**
 * Računa Aerobic Decoupling (Pw:HR %) prema dr. Andrewu Cogganu.
 * Uspoređuje Efficiency Factor (EF = NP / Avg HR) prve i druge polovice glavnog dijela treninga.
 * Pozitivna vrijednost (< 5% stabilna baza, > 5% zamor/kardijalni drift) označava rast pulsa u odnosu na snagu.
 *
 * @param {Array<Object>} streamData - Niz točaka s poljima (watts|power|p) i (hr|heartrate|heartRate)
 * @param {number} [ftp=250] - FTP sportaša
 * @returns {{ decoupling: number, efFirst: number, efSecond: number } | null}
 */
export function calculateAerobicDecoupling(streamData, ftp = 250) {
  if (!Array.isArray(streamData) || streamData.length < 300) return null;

  const normalized = [];
  for (let i = 0; i < streamData.length; i++) {
    const pt = streamData[i];
    if (!pt) continue;
    const p = Number(pt.watts ?? pt.power ?? pt.p ?? 0);
    const hr = Number(pt.hr ?? pt.heartrate ?? pt.heartRate ?? 0);
    const t = pt.time ?? pt.t ?? i;
    if (hr > 40) {
      normalized.push({ t, p: p > 0 ? p : 0, hr });
    }
  }

  // Treba nam barem ~10 minuta validnih HR+Power točaka
  if (normalized.length < 300) return null;

  // Ako trening traje duže (>35 min), preskačemo prvih ~8% (zagrijavanje) i zadnjih ~5% (hlađenje)
  // kako početno dizanje pulsa ne bi umjetno iskrivilo aerobni drift
  let core = normalized;
  if (normalized.length >= 1000) {
    const startIdx = Math.floor(normalized.length * 0.08);
    const endIdx = Math.floor(normalized.length * 0.95);
    if (endIdx - startIdx >= 400) {
      core = normalized.slice(startIdx, endIdx);
    }
  }

  const mid = Math.floor(core.length / 2);
  const firstHalf = core.slice(0, mid);
  const secondHalf = core.slice(mid);

  if (firstHalf.length < 120 || secondHalf.length < 120) return null;

  const m1 = calculateCogganMetrics(firstHalf.map(x => x.p), ftp);
  const m2 = calculateCogganMetrics(secondHalf.map(x => x.p), ftp);

  const avgHr1 = firstHalf.reduce((s, x) => s + x.hr, 0) / firstHalf.length;
  const avgHr2 = secondHalf.reduce((s, x) => s + x.hr, 0) / secondHalf.length;

  const pwr1 = m1.np > 0 ? m1.np : m1.avgPower;
  const pwr2 = m2.np > 0 ? m2.np : m2.avgPower;

  if (!pwr1 || !pwr2 || avgHr1 <= 0 || avgHr2 <= 0) return null;

  const ef1 = pwr1 / avgHr1;
  const ef2 = pwr2 / avgHr2;
  if (ef1 <= 0) return null;

  const decoupling = ((ef1 - ef2) / ef1) * 100;

  return {
    decoupling: Number(decoupling.toFixed(1)),
    efFirst: Number(ef1.toFixed(2)),
    efSecond: Number(ef2.toFixed(2))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// eFTP (Estimated FTP) Detection — Single-Workout Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds the peak (maximum) average power over a given duration using an O(n)
 * sliding window algorithm. No array copies or nested loops are created.
 *
 * @param {Array<{timestamp: number, power: number, heartRate: number, cadence: number}>} sensorData
 *   Array of 1 Hz sensor samples. Each object must contain at least a numeric
 *   `power` field; missing or falsy values are treated as 0 W.
 * @param {number} windowSeconds
 *   Duration of the averaging window in seconds (e.g. 300 for 5 min).
 * @returns {number|null}
 *   The peak average power (watts, rounded to nearest integer) for the
 *   requested duration, or `null` if the recording is shorter than `windowSeconds`.
 *
 * @example
 *   const peak5 = getPeakPowerForDuration(ride, 300);  // 5-min peak
 *   const peak20 = getPeakPowerForDuration(ride, 1200); // 20-min peak
 */
export function getPeakPowerForDuration(sensorData, windowSeconds) {
  if (
    !Array.isArray(sensorData) ||
    sensorData.length < windowSeconds ||
    windowSeconds <= 0
  ) {
    return null;
  }

  // Seed the window with the first `windowSeconds` samples
  let windowSum = 0;
  for (let i = 0; i < windowSeconds; i++) {
    windowSum += (sensorData[i].power || 0);
  }

  let maxSum = windowSum;

  // Slide one sample at a time — O(n)
  for (let i = windowSeconds; i < sensorData.length; i++) {
    windowSum += (sensorData[i].power || 0);
    windowSum -= (sensorData[i - windowSeconds].power || 0);

    if (windowSum > maxSum) {
      maxSum = windowSum;
    }
  }

  return Math.round(maxSum / windowSeconds);
}

/**
 * Estimates FTP from a single workout using a hybrid approach:
 *
 * 1. **CP 2-Parameter Model** — Extracts 5-min and 20-min peak powers,
 *    computes total work (W = P × t) for each, and solves for the slope
 *    (Critical Power) of the Work–Time relationship:
 *
 *        CP = (W_20 − W_5) / (t_20 − t_5)
 *
 * 2. **Classic 95 % Rule** — Takes 95 % of the 20-minute peak power,
 *    the well-established Allen & Coggan heuristic.
 *
 * The final estimate is the **average** of both values, providing a more
 * robust single-ride eFTP that smooths out the weaknesses of each method.
 *
 * @param {Array<{timestamp: number, power: number, heartRate: number, cadence: number}>} sensorData
 *   Array of 1 Hz sensor samples (same format as `getPeakPowerForDuration`).
 * @returns {number|null}
 *   Estimated FTP in watts (integer), or `null` if the recording is shorter
 *   than 20 minutes (1 200 samples at 1 Hz).
 *
 * @example
 *   const eFTP = estimateFTPFromWorkout(rideData);
 *   if (eFTP !== null) {
 *     console.log(`Estimated FTP: ${eFTP} W`);
 *   }
 */
export function estimateFTPFromWorkout(sensorData) {
  const T5 = 300;   // 5 minutes in seconds
  const T20 = 1200; // 20 minutes in seconds

  // Guard: need at least 20 minutes of data
  if (!Array.isArray(sensorData) || sensorData.length < T20) {
    return null;
  }

  const peak5 = getPeakPowerForDuration(sensorData, T5);
  const peak20 = getPeakPowerForDuration(sensorData, T20);

  // Safety check — peaks should never be null given the length guard above,
  // but defend against corrupted / all-zero data.
  if (peak5 === null || peak20 === null || peak5 === 0 || peak20 === 0) {
    return null;
  }

  // ── CP 2-Parameter Model ──────────────────────────────────────────────
  // Work (joules) = Power (watts) × Duration (seconds)
  const work5 = peak5 * T5;
  const work20 = peak20 * T20;

  // Critical Power = slope of the W–t line through the two points
  const criticalPower = (work20 - work5) / (T20 - T5);

  // ── Classic 95 % of 20-min Rule ──────────────────────────────────────
  const ftp95 = peak20 * 0.95;

  // ── Hybrid Average ────────────────────────────────────────────────────
  const eFTP = Math.round((criticalPower + ftp95) / 2);

  return eFTP;
}

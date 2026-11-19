import { calculateCogganMetrics, expandStepsToSeconds } from './performanceMetrics.js';

// Očekivani izlaz: { title, description, duration_seconds, difficulty_score, steps: [{ name, duration, power }] }

// Zadane Intervals.icu (Coggan) power zone u % FTP-a: [donja, gornja] granica
const DEFAULT_POWER_ZONES = {
  1: [45, 55],
  2: [56, 75],
  3: [76, 90],
  4: [91, 105],
  5: [106, 120],
  6: [121, 150],
  7: [151, 200]
};

const isZoneUnits = (u) => u === 'power_zone' || u === 'zone' || u === 'z';
const isWattUnits = (u) => u === 'w' || u === 'watts' || u === 'watt';
const isFtpPctUnits = (u) => u === '%ftp' || u === 'ftp' || u === '%' || u === 'percent_ftp';
// Jedinice koje NE opisuju snagu (puls, tempo, % MMP...) — iz njih ne možemo izračunati % FTP-a
const isNonPowerUnits = (u) => !!u && !isZoneUnits(u) && !isWattUnits(u) && !isFtpPctUnits(u);

/**
 * Pretvara zonu (npr. 2 ili 2.5) u raspon % FTP-a.
 */
function zoneToPctRange(zoneVal) {
  const z = Number(zoneVal);
  if (!Number.isFinite(z) || z <= 0) return null;
  const zi = Math.min(7, Math.max(1, Math.round(z)));
  const [lo, hi] = DEFAULT_POWER_ZONES[zi];
  return { min: lo, max: hi };
}

export function normalizeStepPowerPct(power, ftp = 200) {
  const validFtp = Number(ftp) > 0 ? Number(ftp) : 200;
  if (power == null) return { avg: 50, min: 50, max: 50, isRange: false };

  const conv = (val, units = '') => {
    if (val == null) return null;
    let cleanVal = val;
    if (typeof cleanVal === 'string') {
      cleanVal = cleanVal.replace('%', '').trim();
    }
    const num = Number(cleanVal);
    if (!Number.isFinite(num) || num <= 0) return null;
    const u = String(units || '').toLowerCase();
    if (isWattUnits(u)) return Math.round((num / validFtp) * 100);
    // Decimalni zapis (0.65 = 65% FTP) dopuštamo SAMO kad jedinice nisu navedene
    if (!u && num <= 3) return Math.round(num * 100);
    return Math.round(num);
  };

  // Zone (Intervals.icu "Z2" → { value: 2, units: "power_zone" }) — mapiramo u raspon % FTP-a
  if (power && typeof power === 'object') {
    const u = String(power.units || '').toLowerCase();
    if (isZoneUnits(u)) {
      const zLo = zoneToPctRange(power.start ?? power.min ?? power.value);
      const zHi = zoneToPctRange(power.end ?? power.max ?? power.value);
      if (zLo && zHi) {
        const minVal = Math.min(zLo.min, zHi.min);
        const maxVal = Math.max(zLo.max, zHi.max);
        return { avg: Math.round((minVal + maxVal) / 2), min: minVal, max: maxVal, isRange: minVal !== maxVal };
      }
      return { avg: 50, min: 50, max: 50, isRange: false };
    }
    if (isNonPowerUnits(u)) {
      return null; // pozivatelj treba koristiti _power ili zadani fallback
    }
  }

  // 1. Ako je power string tipa "65-75%" ili "65%-75%" ili "70%"
  if (typeof power === 'string') {
    const rangeMatch = power.match(/(\d+(?:\.\d+)?)\s*[%]?\s*-\s*(\d+(?:\.\d+)?)\s*[%]?/);
    if (rangeMatch) {
      const pMin = conv(rangeMatch[1]);
      const pMax = conv(rangeMatch[2]);
      if (pMin != null && pMax != null) {
        const minVal = Math.min(pMin, pMax);
        const maxVal = Math.max(pMin, pMax);
        return {
          avg: Math.round((minVal + maxVal) / 2),
          min: minVal,
          max: maxVal,
          isRange: minVal !== maxVal
        };
      }
    }
    const single = conv(power);
    if (single != null) return { avg: single, min: single, max: single, isRange: false };
  }

  // 2. Ako je power običan broj
  if (typeof power === 'number') {
    const p = conv(power) || 50;
    return { avg: p, min: p, max: p, isRange: false };
  }

  // 3. Ako je power objekt (Intervals.icu / Zwift format)
  if (typeof power === 'object') {
    const units = power.units || '';

    // Provjeri min/max raspon (Intervals.icu { min: 65, max: 75, units: "%ftp" } ili { start: 65, end: 75 })
    const rawMin = power.min ?? power.start ?? power.low;
    const rawMax = power.max ?? power.end ?? power.high;

    const pMin = conv(rawMin, units);
    const pMax = conv(rawMax, units);

    if (pMin != null && pMax != null && (pMin > 0 || pMax > 0)) {
      const minVal = Math.min(pMin, pMax);
      const maxVal = Math.max(pMin, pMax);
      return {
        avg: Math.round((minVal + maxVal) / 2),
        min: minVal,
        max: maxVal,
        isRange: minVal !== maxVal
      };
    }

    // Fiksna vrijednost (ako postoji i veća je od 0 — ignoriramo ako je 0 ili null)
    if (power.value != null && Number(power.value) > 0) {
      const p = conv(power.value, units);
      if (p != null && p > 0) {
        return { avg: p, min: p, max: p, isRange: false };
      }
    }

    // Pojedinačni fallback na min ili max ako samo jedan postoji
    if (pMin != null && pMin > 0) return { avg: pMin, min: pMin, max: pMin, isRange: false };
    if (pMax != null && pMax > 0) return { avg: pMax, min: pMax, max: pMax, isRange: false };
  }

  return { avg: 50, min: 50, max: 50, isRange: false };
}

/**
 * Određuje % FTP raspon jednog koraka iz Intervals.icu / lokalnog formata.
 * Redoslijed: eksplicitni powerMin/Max → power (%ftp / W / zona) → _power (vati koje je Intervals razriješio) → 50%.
 * docFtp = FTP s kojim je Intervals.icu računao _power vate (workout_doc.ftp).
 */
export function resolveStepPowerPct(step, ftp = 200, docFtp = null) {
  if (!step) return { avg: 50, min: 50, max: 50, isRange: false };

  if (step.powerMin != null && step.powerMax != null && Number(step.powerMin) > 0 && Number(step.powerMax) > 0) {
    const mn = Math.round(Number(step.powerMin));
    const mx = Math.round(Number(step.powerMax));
    const avg = typeof step.power === 'number' && step.power > 0 ? Math.round(step.power) : Math.round((mn + mx) / 2);
    return { avg, min: Math.min(mn, mx), max: Math.max(mn, mx), isRange: mn !== mx };
  }

  const powerUnits = step.power && typeof step.power === 'object' ? String(step.power.units || '').toLowerCase() : '';
  const preferResolved = step._power && (isZoneUnits(powerUnits) || isNonPowerUnits(powerUnits));

  if (step.power != null && !preferResolved) {
    const res = normalizeStepPowerPct(step.power, ftp);
    if (res) return res;
  }

  // Fallback: Intervals.icu razriješeni vati (_power: { start, end } ili { value })
  if (step._power && typeof step._power === 'object') {
    const baseFtp = Number(docFtp) > 0 ? Number(docFtp) : (Number(ftp) > 0 ? Number(ftp) : 200);
    const toPct = (w) => {
      const n = Number(w);
      return Number.isFinite(n) && n > 0 ? Math.round((n / baseFtp) * 100) : null;
    };
    const lo = toPct(step._power.start ?? step._power.min ?? step._power.value);
    const hi = toPct(step._power.end ?? step._power.max ?? step._power.value);
    if (lo != null && hi != null) {
      const mn = Math.min(lo, hi);
      const mx = Math.max(lo, hi);
      return { avg: Math.round((mn + mx) / 2), min: mn, max: mx, isRange: mn !== mx };
    }
  }

  // Zona bez _power → zadana tablica zona
  if (step.power != null && preferResolved) {
    const res = normalizeStepPowerPct(step.power, ftp);
    if (res) return res;
  }

  return { avg: 50, min: 50, max: 50, isRange: false };
}

export function flattenStructuredSteps(stepsArray, ftp = 200, docFtp = null) {
  const flat = [];
  if (!Array.isArray(stepsArray)) return flat;

  stepsArray.forEach(step => {
    if (!step) return;
    if (Array.isArray(step.steps) && step.steps.length > 0) {
      const reps = Math.max(1, parseInt(step.reps || step.count || 1, 10) || 1);
      const inner = flattenStructuredSteps(step.steps, ftp, docFtp);
      for (let r = 0; r < reps; r++) {
        inner.forEach(s => flat.push({ ...s }));
      }
      return;
    }

    const dur = Math.max(0, Math.round(Number(step.duration) || 0));
    if (dur <= 0) return;

    const pwr = resolveStepPowerPct(step, ftp, docFtp);
    const pMin = pwr.min;
    const pMax = pwr.max;
    const isRange = pMin !== pMax;
    const pAvg = pwr.avg || Math.round((pMin + pMax) / 2);

    const isRamp = !!(step.ramp || (step.power && step.power.ramp) || /\bramp\b/i.test(step.text || ''));

    flat.push({
      name: step.name || step.text || (pMin >= 85 ? 'Interval' : (pMax <= 75 ? 'Oporavak' : 'Tempo')),
      text: step.text || step.name || '',
      duration: dur,
      power: pAvg,
      powerMin: pMin,
      powerMax: pMax,
      isRange,
      ramp: isRamp
    });
  });

  return flat;
}

export const extractIntensityData = (workoutDoc) => {
  if (!workoutDoc) return [];

  let allSteps = [];
  if (Array.isArray(workoutDoc)) {
    allSteps = flattenStructuredSteps(workoutDoc);
  } else if (typeof workoutDoc === 'string') {
    allSteps = parseIntervalsCode(workoutDoc).allSteps;
  } else if (workoutDoc.steps && Array.isArray(workoutDoc.steps)) {
    const docFtp = Number(workoutDoc.ftp) > 0 ? Number(workoutDoc.ftp) : 200;
    allSteps = flattenStructuredSteps(workoutDoc.steps, docFtp, docFtp);
  }

  const arr = [];
  allSteps.forEach(step => {
    const mins = Math.max(1, Math.round((step.duration || 60) / 60));
    for (let i = 0; i < mins; i++) {
      arr.push(step.power || 50);
    }
  });
  return arr;
};

function stepsToTextLines(steps, indent = '', ftp = 200) {
  const lines = [];
  if (!steps || !Array.isArray(steps)) return lines;

  steps.forEach(step => {
    if (step.steps && Array.isArray(step.steps)) {
      const reps = step.reps || step.count || 1;
      if (step.text) {
        lines.push(`${indent}${step.text}`);
      }
      if (reps > 1) {
        lines.push(`${indent}${reps}x`);
      }
      const subLines = stepsToTextLines(step.steps, indent, ftp);
      lines.push(...subLines);
      if (reps > 1) {
        lines.push('');
      }
    } else {
      const formatDuration = (secs) => {
        if (!secs || secs <= 0) return '0m';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.round(secs % 60);
        let parts = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 && h === 0) parts.push(`${s}s`);
        return parts.join('') || '0m';
      };
      const dur = formatDuration(step.duration || 0);
      const norm = resolveStepPowerPct(step, ftp);
      const pwr = norm.min !== norm.max ? `${norm.min}-${norm.max}%` : `${norm.avg}%`;
      const text = (step.text || step.name) ? ` ${step.text || step.name}` : '';
      lines.push(`${indent}- ${dur} ${pwr}${text}`);
    }
  });

  return lines;
}

function buildMetricsFromSteps(allSteps, ftp = 200, blocks = null) {
  const validFtp = Number(ftp) > 0 ? Number(ftp) : 200;
  const totalSecs = allSteps.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
  const powerArray = expandStepsToSeconds(allSteps, validFtp);
  const metrics = calculateCogganMetrics(powerArray, validFtp);

  const zoneStats = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, ss: 0 };
  const secArray = expandStepsToSeconds(allSteps, 100);
  secArray.forEach(p => {
    if (p < 55) zoneStats.z1++;
    else if (p < 76) zoneStats.z2++;
    else if (p < 88) zoneStats.z3++;
    else if (p < 95) zoneStats.ss++;
    else if (p < 106) zoneStats.z4++;
    else if (p < 121) zoneStats.z5++;
    else zoneStats.z6++;
  });

  return {
    duration: totalSecs,
    tss: metrics.tss,
    np: metrics.np,
    workKj: metrics.workKj,
    ifFactor: metrics.ifFactor,
    avgPower: metrics.avgPower,
    variability: metrics.avgPower > 0 ? (metrics.np / metrics.avgPower).toFixed(2) : 1,
    blocks: blocks || [{ name: 'Main', steps: allSteps }],
    allSteps,
    zones: zoneStats
  };
}

export const parseWorkoutDoc = (workoutDoc, ftp = 200) => {
  if (!workoutDoc) return null;
  if (Array.isArray(workoutDoc)) {
    const flat = flattenStructuredSteps(workoutDoc, ftp);
    return buildMetricsFromSteps(flat, ftp);
  }
  if (typeof workoutDoc === 'string') {
    return parseIntervalsCode(workoutDoc, ftp);
  }
  if (workoutDoc.steps && Array.isArray(workoutDoc.steps)) {
    const flat = flattenStructuredSteps(workoutDoc.steps, ftp, workoutDoc.ftp);
    return buildMetricsFromSteps(flat, ftp);
  }
  return null;
};

const isCooldownOrWarmupLine = (line = '') =>
  /\b(hlađ\w*|hlad\w*|cool\s*-?\s*down|zagrijav\w*|warm\s*-?\s*up|opušta\w*)\b/i.test(String(line));

/**
 * Sigurno parsira trajanje koraka iz početka linije (prije opisa/oznake koraka)
 * kako tekstualne oznake poput "(30/15s)" ili "(1h ukupno)" ne bi udvostručile trajanje.
 */
function parseStepDurationSeconds(cleanLine = '') {
  const withoutDash = String(cleanLine).replace(/^\s*-\s*/, '').trim();
  if (!withoutDash) return 0;

  // Ako postoji broj s jedinicom prije % ili W, analiziraj samo prefiks do prvog % / W
  const metricIdx = withoutDash.search(/\d+(?:\.\d+)?\s*(?:%|w\b)/i);
  const candidate = metricIdx > 0 ? withoutDash.slice(0, metricIdx).trim() : withoutDash;

  const colonMatch = candidate.match(/\b(\d+):(\d{2})\b/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }

  let secs = 0;
  const hMatch = candidate.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs)(?![a-zA-Z])/i);
  const mMatch = candidate.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins)(?![a-zA-Z])/i);
  const sMatch = candidate.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs)(?![a-zA-Z])/i);

  if (hMatch) secs += Math.round(parseFloat(hMatch[1]) * 3600);
  if (mMatch) secs += Math.round(parseFloat(mMatch[1]) * 60);
  if (sMatch) secs += Math.round(parseFloat(sMatch[1]));
  return secs;
}

export const parseIntervalsCode = (code, ftp = 200) => {
  if (!code || typeof code !== 'string') {
    return { duration: 0, tss: 0, np: 0, blocks: [], allSteps: [], zones: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, ss: 0 } };
  }

  const validFtp = Number(ftp) > 0 ? Number(ftp) : 200;
  let blocks = [];
  let currentBlock = { name: 'Main', steps: [] };
  let allSteps = [];

  let activeRepeatCount = 1;
  let pendingRepeatSteps = [];

  const flushRepeatBuffer = () => {
    if (pendingRepeatSteps.length === 0) {
      activeRepeatCount = 1;
      return;
    }
    const reps = Math.max(1, activeRepeatCount);
    for (let r = 0; r < reps; r++) {
      pendingRepeatSteps.forEach(st => {
        currentBlock.steps.push({ ...st });
        allSteps.push({ ...st });
      });
    }
    pendingRepeatSteps = [];
    activeRepeatCount = 1;
  };

  const lines = code.split(/\r?\n/);
  lines.forEach(line => {
    const cleanLine = line.trim();

    // Prazan red zatvara aktivni Nx blok ponavljanja (Intervals.icu konvencija)
    if (!cleanLine) {
      if (activeRepeatCount > 1 && pendingRepeatSteps.length > 0) {
        flushRepeatBuffer();
      }
      return;
    }

    const isStep = cleanLine.startsWith('-') || /^\d+:\d{2}/.test(cleanLine) || /^\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)(?![a-zA-Z])/i.test(cleanLine);
    const pureMultiplierMatch = cleanLine.match(/^(\d+)\s*x\s*:?$/i);
    const headerMultiplierMatch = !isStep && !cleanLine.includes('%') ? cleanLine.match(/\b(\d+)\s*x\b/i) : null;

    if (pureMultiplierMatch) {
      flushRepeatBuffer();
      activeRepeatCount = Math.min(30, Math.max(1, parseInt(pureMultiplierMatch[1], 10)));
      return;
    }

    if (!isStep) {
      flushRepeatBuffer();
      if (currentBlock.steps.length > 0) blocks.push(currentBlock);
      currentBlock = { name: cleanLine, steps: [] };
      if (headerMultiplierMatch) {
        activeRepeatCount = Math.min(30, Math.max(1, parseInt(headerMultiplierMatch[1], 10)));
      }
      return;
    }

    // Zaštita: ako je AI zaboravio prazan red nakon Nx bloka prije Hlađenja / Zagrijavanja, zatvori blok
    if (activeRepeatCount > 1 && pendingRepeatSteps.length >= 1 && isCooldownOrWarmupLine(cleanLine)) {
      flushRepeatBuffer();
    }

    const secs = parseStepDurationSeconds(cleanLine);

    let powerMin = 0, powerMax = 0, powerAvg = 0;
    // Podržava 65-75%, 65%-75%, 65% - 75%, 65-75% FTP, ramp 65-75%
    const pRangeMatch = cleanLine.match(/(\d+(?:\.\d+)?)\s*%\s*-\s*(\d+(?:\.\d+)?)\s*%\s*(?:FTP)?/i)
      || cleanLine.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%\s*(?:FTP)?/i);

    const wRangeMatch = !pRangeMatch ? (
      cleanLine.match(/(\d+)\s*w\s*-\s*(\d+)\s*w\b/i)
      || cleanLine.match(/(\d+)\s*-\s*(\d+)\s*w\b/i)
    ) : null;

    const pMatch = !pRangeMatch && !wRangeMatch ? cleanLine.match(/(\d+(?:\.\d+)?)\s*%\s*(?:FTP)?/i) : null;
    const wMatch = !pRangeMatch && !wRangeMatch && !pMatch ? cleanLine.match(/(\d+)\s*w\b/i) : null;

    const isRamp = /\bramp\b/i.test(cleanLine);

    let rampStart = null, rampEnd = null;
    if (pRangeMatch) {
      const p1 = Math.round(parseFloat(pRangeMatch[1]));
      const p2 = Math.round(parseFloat(pRangeMatch[2]));
      powerMin = Math.min(p1, p2);
      powerMax = Math.max(p1, p2);
      powerAvg = Math.round((powerMin + powerMax) / 2);
      if (isRamp && p1 !== p2) { rampStart = p1; rampEnd = p2; }
    } else if (wRangeMatch) {
      const p1 = Math.round((parseInt(wRangeMatch[1], 10) / validFtp) * 100);
      const p2 = Math.round((parseInt(wRangeMatch[2], 10) / validFtp) * 100);
      powerMin = Math.min(p1, p2);
      powerMax = Math.max(p1, p2);
      powerAvg = Math.round((powerMin + powerMax) / 2);
      if (isRamp && p1 !== p2) { rampStart = p1; rampEnd = p2; }
    } else if (pMatch) {
      powerMin = Math.round(parseFloat(pMatch[1]));
      powerMax = powerMin;
      powerAvg = powerMin;
    } else if (wMatch) {
      powerMin = Math.round((parseInt(wMatch[1], 10) / validFtp) * 100);
      powerMax = powerMin;
      powerAvg = powerMin;
    }

    if (secs > 0) {
      const isRange = powerMin > 0 && powerMax > 0 && powerMin !== powerMax;
      const stepObj = {
        text: cleanLine,
        duration: secs,
        powerMin: powerMin > 0 ? powerMin : 55,
        powerMax: powerMax > 0 ? powerMax : 55,
        power: powerAvg > 0 ? powerAvg : 55,
        isRange,
        ramp: isRamp,
        ...(rampStart != null && rampEnd != null ? { rampStart, rampEnd } : {})
      };

      if (activeRepeatCount > 1) {
        pendingRepeatSteps.push(stepObj);
      } else {
        currentBlock.steps.push({ ...stepObj });
        allSteps.push({ ...stepObj });
      }
    }
  });

  flushRepeatBuffer();

  if (currentBlock.steps.length > 0 || blocks.length === 0) {
    blocks.push(currentBlock);
  }

  return buildMetricsFromSteps(allSteps, validFtp, blocks);
};

export async function parseWorkoutFile(fileText, fileName) {
  const isZwo = fileName.toLowerCase().endsWith('.zwo');
  const isErg = fileName.toLowerCase().endsWith('.erg');

  let parsedWorkout;

  if (isZwo) parsedWorkout = parseZWO(fileText);
  else if (isErg) parsedWorkout = parseERG(fileText);
  else throw new Error('Nepodržan format datoteke. Učitajte .ZWO ili .ERG datoteku.');

  if (fileName) {
    parsedWorkout.title = fileName.replace(/\.[^/.]+$/, "");
  }

  return parsedWorkout;
}

function expandRampsForCategorization(steps) {
  const out = [];
  for (const s of steps) {
    if (!s) continue;
    const dur = s.duration || 0;
    const isRamp = !!(s.ramp || (s.power && s.power.ramp));
    const rStart = s.rampStart != null ? Number(s.rampStart) : (s.powerMin != null ? Number(s.powerMin) : null);
    const rEnd = s.rampEnd != null ? Number(s.rampEnd) : (s.powerMax != null ? Number(s.powerMax) : null);
    if (isRamp && rStart != null && rEnd != null && Math.abs(rEnd - rStart) >= 5 && dur >= 60) {
      const slices = Math.min(12, Math.max(4, Math.round(dur / 60)));
      let used = 0;
      for (let i = 0; i < slices; i++) {
        const d = i === slices - 1 ? dur - used : Math.round(dur / slices);
        used += d;
        const p = Math.round(rStart + (rEnd - rStart) * ((i + 0.5) / slices));
        if (d > 0) out.push({ duration: d, power: p });
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

export function categorizeWorkout(steps) {
  if (!steps || steps.length === 0) return 'Ostalo';

  const expandedSteps = expandRampsForCategorization(steps);
  const totalDur = expandedSteps.reduce((sum, s) => sum + (s.duration || 0), 0);
  if (totalDur === 0) return 'Ostalo';

  // 1. Prepoznavanje čistih Oporavak (Active Recovery) vožnji:
  // većina vremena u Z1 (<= 56% FTP), prosjek <= 58% i najviše do 60s kratkih spin-upova >= 76%
  let z1Dur = 0;
  let highDur = 0;
  let weightedSum = 0;
  expandedSteps.forEach(s => {
    const p = s.power || 0;
    const d = s.duration || 0;
    weightedSum += p * d;
    if (p <= 56) z1Dur += d;
    if (p >= 76) highDur += d;
  });
  const avgPct = weightedSum / totalDur;
  if (highDur <= 60 && ((z1Dur / totalDur >= 0.65 && avgPct <= 58) || avgPct <= 54)) {
    return 'Oporavak';
  }

  // 2. Kontinuirani Over-Under / Criss-Cross blokovi (>= 150s bez pada ispod 76%)
  //    + VO2 Max mikro-intervalne serije (npr. Rønnestad 30/15, 40/20, 30/30 na 115-132% s kratkim odmorom)
  const effectiveSteps = [];
  let idx = 0;
  while (idx < expandedSteps.length) {
    // 2a. Provjera VO2 Max mikro-intervalne serije (>= 5 uzastopnih ON/OFF parova)
    const isMicroOn = (st) => {
      const d = st?.duration || 0;
      const p = st?.power || 0;
      return d >= 20 && d <= 45 && p >= 115 && p <= 132;
    };
    const isMicroOff = (st, onDur) => {
      const d = st?.duration || 0;
      const p = st?.power || 0;
      return d >= 10 && d <= 35 && d <= onDur && p < 95;
    };
    if (isMicroOn(expandedSteps[idx])) {
      let pairs = 0;
      let cursor = idx;
      let totalOnDur = 0;
      while (cursor < expandedSteps.length && isMicroOn(expandedSteps[cursor])) {
        const onStep = expandedSteps[cursor];
        const offStep = expandedSteps[cursor + 1];
        if (offStep && isMicroOff(offStep, onStep.duration)) {
          pairs++;
          totalOnDur += onStep.duration;
          cursor += 2;
        } else {
          // Zadnji ON u seriji bez pratećeg kratkog OFF-a
          if (pairs >= 4) {
            pairs++;
            totalOnDur += onStep.duration;
            cursor += 1;
          }
          break;
        }
      }
      if (pairs >= 5) {
        // Mikro-intervalna VO2 Max serija: preslikavamo efektivni rad na VO2 Max zonu (~116%)
        effectiveSteps.push({ duration: totalOnDur, power: 116 });
        idx = cursor;
        continue;
      }
    }

    // 2b. Kontinuirani Over-Under / Criss-Cross blokovi
    if ((expandedSteps[idx].power || 0) >= 76) {
      let end = idx;
      let blockDur = 0;
      let baseDur = 0;
      let maxSurgeDur = 0;
      while (end < expandedSteps.length && (expandedSteps[end].power || 0) >= 76) {
        const d = expandedSteps[end].duration || 0;
        const p = expandedSteps[end].power || 0;
        blockDur += d;
        if (p <= 106) baseDur += d;
        else if (d > maxSurgeDur) maxSurgeDur = d;
        end++;
      }
      if (blockDur >= 150 && baseDur > 0 && baseDur / blockDur >= 0.65 && maxSurgeDur <= 60) {
        let blockWeighted = 0;
        for (let k = idx; k < end; k++) {
          const d = expandedSteps[k].duration || 0;
          const p = expandedSteps[k].power || 0;
          const pEff = (d <= 15 && p > 135) ? 120 : p;
          blockWeighted += pEff * d;
        }
        effectiveSteps.push({ duration: blockDur, power: Math.round(blockWeighted / blockDur) });
        idx = end;
        continue;
      }
    }
    effectiveSteps.push(expandedSteps[idx]);
    idx++;
  }

  // 3. Bodovanje po zonama uz prigušenje izoliranih <= 20s neuromuskularnih openera
  const scores = { recovery: 0, endurance: 0, tempo: 0, sweetspot: 0, threshold: 0, vo2max: 0, anaerobic: 0 };

  effectiveSteps.forEach(s => {
    const p = s.power || 0;
    const dur = s.duration || 0;
    const cappedP = (dur <= 20 && p > 145) ? 145 : Math.min(p, 170);
    const intensity = cappedP / 100;
    const tss = (dur / 3600) * (intensity * intensity) * 100;

    if (p <= 55) scores.recovery += tss * 0.35; // Sniženo bodovanje (zagrijavanje / hlađenje)
    else if (p < 76) scores.endurance += tss * 0.55;
    else if (p < 88) scores.tempo += tss * 1.5;
    else if (p < 95) scores.sweetspot += tss * 2.2; // Sweet Spot je često dominantan cilj
    else if (p < 106) scores.threshold += tss * 2.8;
    else if (p < 121) scores.vo2max += tss * 3.5;
    else scores.anaerobic += tss * (dur <= 20 ? 2.6 : 3.8);
  });

  let maxScore = -1;
  let dominantCategory = 'recovery';

  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      dominantCategory = cat;
    }
  }

  const map = {
    recovery: 'Oporavak',
    endurance: 'Endurance',
    tempo: 'Tempo',
    sweetspot: 'Sweet Spot',
    threshold: 'Threshold',
    vo2max: 'VO2 Max',
    anaerobic: 'Anaerobni'
  };

  return map[dominantCategory] || 'Sweet Spot';
}

export const CANONICAL_CATEGORIES = [
  'Oporavak',
  'Endurance',
  'Tempo',
  'Sweet Spot',
  'Threshold',
  'VO2 Max',
  'Anaerobni',
  'Testiranje',
  'Ostalo'
];

/**
 * Normalizira bilo koji unos kategorije u točno standardizirano ime foldera u knjižnici
 * (npr. 'sweetspot' -> 'Sweet Spot', 'anaerobic' -> 'Anaerobni', 'vo2max' -> 'VO2 Max').
 */
export function normalizeCategory(rawCat) {
  if (!rawCat) return 'Sweet Spot';
  const c = String(rawCat).trim().toLowerCase();

  if (c.includes('sweet') || c === 'ss') return 'Sweet Spot';
  if (c.includes('anaerob') || c.includes('ana')) return 'Anaerobni';
  if (c.includes('vo2') || c.includes('v02')) return 'VO2 Max';
  if (c.includes('thresh') || c.includes('prag') || c.includes('ftp') || c.includes('suprathresh')) return 'Threshold';
  if (c.includes('tempo') || c === 'z3') return 'Tempo';
  if (c.includes('endur') || c.includes('izdrž') || c.includes('izdrz') || c === 'z2') return 'Endurance';
  if (c.includes('oporav') || c.includes('recov') || c === 'z1') return 'Oporavak';
  if (c.includes('test') || c.includes('ramp')) return 'Testiranje';

  const exact = CANONICAL_CATEGORIES.find(k => k.toLowerCase() === c);
  if (exact) return exact;

  return 'Ostalo';
}

/**
 * Parsira bilo koji format trajanja (HH:MM:SS, MM:SS, 45m, 1h15m, 45) u točan broj minuta.
 */
export function parseDurationMinutes(rawStr) {
  if (!rawStr) return null;
  const s = String(rawStr).trim();

  // Format HH:MM:SS ili H:MM:SS (npr. 00:45:00 ili 01:15:00)
  const hmsMatch = s.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1], 10);
    const mins = parseInt(hmsMatch[2], 10);
    const secs = parseInt(hmsMatch[3], 10);
    return Math.round(hours * 60 + mins + secs / 60);
  }

  // Format MM:SS (npr. 45:00)
  const msMatch = s.match(/\b(\d{1,3}):(\d{2})\b/);
  if (msMatch) {
    const mins = parseInt(msMatch[1], 10);
    const secs = parseInt(msMatch[2], 10);
    return Math.round(mins + secs / 60);
  }

  // Format s satima i/ili minutama (npr. "1h 15m", "1h", "45m", "45 min")
  let totalMins = 0;
  let matched = false;
  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i);
  if (hMatch) {
    totalMins += parseFloat(hMatch[1]) * 60;
    matched = true;
  }
  const mMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)\b/i);
  if (mMatch) {
    totalMins += parseFloat(mMatch[1]);
    matched = true;
  }
  if (matched && totalMins > 0) {
    return Math.round(totalMins);
  }

  // Običan broj (npr. "45")
  const numMatch = s.match(/\b(\d+)\b/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val > 0) return val;
  }

  return null;
}

function clampVal(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function rampWeight(p, zeroAt, fullAt) {
  if (p <= zeroAt) return 0;
  if (p >= fullAt) return 1;
  return (p - zeroAt) / (fullAt - zeroAt);
}

/**
 * Glatka fiziološka krivulja napora po minuti ovisno o % FTP-a:
 * - C1-glatka na prijelazu u supraprag (95% FTP)
 * - Strmiji rast iznad praga u skladu s padom vremena do iscrpljenja (TTE)
 * - Meko prigušenje iznad 160–180% FTP kako 10s neuromuskularni sprintevi ne bi eksplodirali ocjenu
 */
function physioCostPerMin(p) {
  const pc = Math.max(0, p);
  const effP = pc <= 180 ? pc : 180 + (pc - 180) * 0.25;
  const sub = Math.pow(effP / 100, 2.3);
  if (effP <= 95) return sub;
  const above = Math.min(effP - 95, 65);
  const extra = effP > 160 ? (effP - 160) * 0.04 : 0;
  return sub + 0.30 * Math.pow(above / 10, 1.45) + extra;
}

/**
 * Glatka zonska težina i efektivni trošak po kategoriji (bez oštrih „litica” na granicama zona).
 * Gornje prigušenje ostaje strogo rastuće pa veća snaga nikad ne može smanjiti ocjenu težine.
 */
function getEffectiveSecondCost(p, category) {
  const rawCost = physioCostPerMin(p);
  const cfg = {
    'Oporavak':   [25,  42,  60, 0.10],
    'Endurance':  [46,  57,  78, 0.20],
    'Tempo':      [66,  76,  92, 0.30],
    'Sweet Spot': [74,  86, 100, 0.40],
    'Threshold':  [82,  94, 115, 0.40],
    'VO2 Max':    [94, 106, 138, 0.35],
    'Anaerobni':  [106, 120, 175, 0.30]
  }[category] || [50, 65, 160, 0.30];

  const w = rampWeight(p, cfg[0], cfg[1]);
  const cap = physioCostPerMin(cfg[2]);
  const effCost = rawCost <= cap ? rawCost : cap + (rawCost - cap) * cfg[3];
  return { w, cost: effCost };
}

/**
 * Evolucijski 1-Hz fiziološki izračun faktora težine (LVL) unutar kategorije:
 *  - Radi sekundu-po-sekundu (rampe, hard-start i over-under blokovi bez grešaka brojanja koraka)
 *  - Dvokomponentna anaerobna rezerva (brzi PCr buffer + spori glikolitički W'bal) za rad > 100% FTP
 *  - Akutni metabolički/mišićni umor F(t) za odmor i duljinu blokova ispod praga (Tempo/SS/Threshold)
 *  - Strogo monotona integracija (dodavanje hlađenja ili Z2 završetka nikad ne smanjuje težinu)
 *  - Nema umjetnog gornjeg limita na 10.0 prema zahtjevu korisnika
 */
export function calculateCategoryDifficulty(steps, category) {
  if (!Array.isArray(steps) || steps.length === 0) return 1.0;

  const normalizedCategory = normalizeCategory(category);
  const powerArray = expandStepsToSeconds(steps, 100);
  const totalSecs = powerArray.length;
  if (totalSecs === 0) return 1.0;

  const metrics = calculateCogganMetrics(powerArray, 100);
  const totalTSS = metrics.tss;

  // Dvokomponentna suprapražna rezerva (u %·s, normirano na tipičnog biciklista)
  const PCR_MAX = 1100; // brzi alaktični/PCr buffer (~10–15s šprint / kratki mikropulsevi)
  const W_MAX = 6500;   // spora glikolitička W' rezerva
  let pcrBal = PCR_MAX;
  let wBal = W_MAX;
  let peakWDepl = 0;

  // Praćenje dubine pojedinačnog intervala u sporom W' (razlikuje 5×2m od 20×30s na istoj snazi)
  let boutWDrain = 0;
  let maxBoutWDrain = 0;

  // Akutni podpražni umor F(t) ∈ [0, 1] (nakuplja se u radu, eksponencijalno opada u odmoru)
  let fatigueF = 0;
  let workFloor = 75;
  if (normalizedCategory === 'Threshold') workFloor = 82;
  else if (normalizedCategory === 'VO2 Max') workFloor = 90;
  else if (normalizedCategory === 'Anaerobni') workFloor = 95;
  else if (normalizedCategory === 'Endurance') workFloor = 55;

  const betaF = ({
    'Oporavak': 0.0,
    'Endurance': 0.20,
    'Tempo': 0.65,
    'Sweet Spot': 0.90,
    'Threshold': 1.15,
    'VO2 Max': 0.35,
    'Anaerobni': 0.15
  })[normalizedCategory] ?? 0.50;

  const gammaW = ({
    'Oporavak': 0.0,
    'Endurance': 0.10,
    'Tempo': 0.25,
    'Sweet Spot': 0.50,
    'Threshold': 1.00,
    'VO2 Max': 1.55,
    'Anaerobni': 2.40
  })[normalizedCategory] ?? 0.80;

  let zoneStrain = 0;
  let totalStrain = 0;
  let enduranceWorkMins = 0;

  for (let i = 0; i < totalSecs; i++) {
    const p = powerArray[i] || 0;

    // 1. Ažuriranje brze (PCr) i spore (W') anaerobne rezerve
    if (p > 100) {
      const exc = p <= 170 ? (p - 100) : 70 + (p - 170) * 0.25;
      const pcrShare = Math.min(pcrBal, exc * 0.58);
      pcrBal -= pcrShare;
      const wShare = exc - pcrShare;
      wBal = Math.max(0, wBal - wShare);
      boutWDrain += wShare;
      if (boutWDrain > maxBoutWDrain) maxBoutWDrain = boutWDrain;
    } else {
      const dCp = 100 - p;
      const pcrRate = clampVal(dCp / 50, 0.20, 1.25);
      pcrBal += (PCR_MAX - pcrBal) / (36 / pcrRate);

      const tauW = 460 * Math.exp(-0.022 * dCp) + 170;
      wBal += (W_MAX - wBal) / tauW;

      const boutDecayTau = p <= 75 ? 40 : (p <= 90 ? 120 : 400);
      boutWDrain *= Math.exp(-1 / boutDecayTau);
    }

    const wDepl = 1 - (wBal / W_MAX);
    const pcrDepl = 1 - (pcrBal / PCR_MAX);
    const combinedDepl = clampVal(wDepl * 0.88 + pcrDepl * 0.12, 0, 1);
    if (wDepl > peakWDepl) peakWDepl = wDepl;

    // 2. Ažuriranje podpražnog akutnog umora F(t)
    if (p >= workFloor) {
      let tauChargeSec;
      if (p < 75) tauChargeSec = 5400;
      else if (p < 86) tauChargeSec = 2400;
      else if (p < 95) tauChargeSec = 1500;
      else if (p < 103) tauChargeSec = 960;
      else tauChargeSec = 480;
      fatigueF += (1 - fatigueF) / tauChargeSec;
    } else {
      const recDepth = clampVal((workFloor - p) / 28, 0.15, 1.3);
      fatigueF *= Math.exp(-1 / (300 / recDepth));
    }

    // 3. Nenegativna akumulacija napora (jamči strogu monotonost)
    const { w, cost } = getEffectiveSecondCost(p, normalizedCategory);
    const mult = 1 + betaF * fatigueF + gammaW * Math.pow(combinedDepl, 1.45);
    zoneStrain += (cost / 60) * w * mult;
    totalStrain += (physioCostPerMin(p) / 60) * (1 + 0.45 * fatigueF + 1.0 * Math.pow(combinedDepl, 1.45));

    if (p >= 55) enduranceWorkMins += 1 / 60;
  }

  const peakBoutFrac = clampVal(maxBoutWDrain / W_MAX, 0, 1.3);
  const volGate = clampVal(zoneStrain / 22, 0.30, 1.0);
  let score = 1.0;

  switch (normalizedCategory) {
    case 'Oporavak':
      score = 1.0 + Math.pow(zoneStrain, 0.72) * 0.085;
      break;
    case 'Endurance': {
      // Blagi glikogenski/durability bonus nakon ~110 min aktivnog rada
      const durBonus = enduranceWorkMins > 110 ? Math.pow((enduranceWorkMins - 110) / 60, 1.25) * 0.45 : 0;
      score = 1.0 + zoneStrain * 0.070 + durBonus;
      break;
    }
    case 'Tempo': {
      const durBonus = enduranceWorkMins > 110 ? Math.pow((enduranceWorkMins - 110) / 60, 1.2) * 0.35 : 0;
      score = 1.0 + zoneStrain * 0.078 + durBonus;
      break;
    }
    case 'Sweet Spot':
      score = 1.0 + zoneStrain * 0.080;
      break;
    case 'Threshold':
      score = 1.0 + zoneStrain * 0.072;
      break;
    case 'VO2 Max':
      score = 1.0
        + Math.pow(zoneStrain, 0.78) * 0.172
        + (Math.pow(peakWDepl, 1.6) * 1.5 + Math.pow(peakBoutFrac, 1.5) * 1.0) * volGate;
      break;
    case 'Anaerobni':
      score = 1.0
        + Math.pow(zoneStrain, 0.65) * 0.21
        + (Math.pow(peakWDepl, 1.4) * 1.4 + Math.pow(peakBoutFrac, 1.35) * 2.3) * volGate;
      break;
    case 'Testiranje':
      score = 2.0 + Math.pow(totalStrain, 0.72) * 0.15 + Math.pow(peakWDepl, 1.2) * 3.8;
      break;
    default:
      score = 1.0 + Math.pow(totalStrain, 0.80) * 0.105;
      break;
  }

  // Mali pozadinski doprinos ukupnog volumena (ne može poništiti učinak odmora)
  if (normalizedCategory !== 'Oporavak' && normalizedCategory !== 'Testiranje') {
    score += totalTSS * 0.0035;
  }

  if (score < 1.0) score = 1.0;
  // Ne postoji umjetni cap na 10.0 prema zahtjevu korisnika!

  return parseFloat(score.toFixed(1));
}

function parseZWO(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');

  const getTag = (tag) => {
    const el = xml.getElementsByTagName(tag)[0];
    return el ? el.textContent : '';
  };

  const title = getTag('name') || 'Uvezeni ZWO Trening';
  const description = getTag('description') || '';

  const steps = [];
  const workoutNodes = xml.getElementsByTagName('workout')[0]?.children;

  if (!workoutNodes) throw new Error('ZWO datoteka ne sadrži <workout> sekciju.');

  const getAttr = (node, ...names) => {
    for (let name of names) {
      if (node.hasAttribute(name)) return node.getAttribute(name);
      if (node.hasAttribute(name.toLowerCase())) return node.getAttribute(name.toLowerCase());
      if (node.hasAttribute(name.toUpperCase())) return node.getAttribute(name.toUpperCase());
    }
    return null;
  };

  for (let i = 0; i < workoutNodes.length; i++) {
    const node = workoutNodes[i];
    const typeStr = node.tagName || '';
    const type = typeStr.toLowerCase();

    const zoneMap = { 1: 50, 2: 65, 3: 82, 4: 98, 5: 113, 6: 135, 7: 160 };
    const getZonePct = (attrName, def = 65) => {
      const z = parseInt(getAttr(node, attrName, attrName.toLowerCase()));
      return (z && zoneMap[z]) ? zoneMap[z] : def;
    };

    if (type === 'warmup' || type === 'cooldown' || type === 'ramp') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      const powerLowAttr = getAttr(node, 'PowerLow', 'powerlow');
      const powerHighAttr = getAttr(node, 'PowerHigh', 'powerhigh');
      const singlePwr = getAttr(node, 'Power', 'power');

      let powerLow = powerLowAttr ? parseFloat(powerLowAttr) * 100 : (singlePwr ? parseFloat(singlePwr) * 100 : getZonePct('Zone', 50));
      let powerHigh = powerHighAttr ? parseFloat(powerHighAttr) * 100 : (singlePwr ? parseFloat(singlePwr) * 100 : getZonePct('Zone', 50));

      const rStart = Math.round(powerLow);
      const rEnd = Math.round(powerHigh);
      const pMin = Math.min(rStart, rEnd);
      const pMax = Math.max(rStart, rEnd);
      const isRamp = Math.abs(rEnd - rStart) >= 2;

      steps.push({
        name: type === 'warmup' ? 'Zagrijavanje' : (type === 'cooldown' ? 'Hlađenje' : 'Rampa'),
        duration: duration || 0,
        power: Math.round((pMin + pMax) / 2),
        ...(isRamp ? { powerMin: pMin, powerMax: pMax, isRange: true, ramp: true, rampStart: rStart, rampEnd: rEnd } : {})
      });
    } else if (type === 'steadystate' || type === 'solidstate') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      const powerAttr = getAttr(node, 'Power', 'power');
      let power = powerAttr ? parseFloat(powerAttr) * 100 : null;
      if (power === null) {
        const pl = getAttr(node, 'PowerLow', 'powerlow');
        const ph = getAttr(node, 'PowerHigh', 'powerhigh');
        if (pl || ph) power = ((parseFloat(pl || 0.6) + parseFloat(ph || 0.6)) * 50);
        else power = getZonePct('Zone', 65);
      }
      steps.push({
        name: power < 55 ? 'Oporavak' : 'Interval',
        duration: duration || 0,
        power: Math.round(power)
      });
    } else if (type === 'intervalst') {
      const repeat = parseInt(getAttr(node, 'Repeat', 'repeat')) || 1;
      const onDur = parseInt(getAttr(node, 'OnDuration', 'onduration'));
      const offDur = parseInt(getAttr(node, 'OffDuration', 'offduration'));
      const onPowAttr = getAttr(node, 'OnPower', 'onpower', 'PowerOn');
      const offPowAttr = getAttr(node, 'OffPower', 'offpower', 'PowerOff');

      let onPow = onPowAttr ? parseFloat(onPowAttr) * 100 : null;
      if (onPow === null) {
        const onLow = getAttr(node, 'PowerOnLow', 'poweronlow');
        const onHigh = getAttr(node, 'PowerOnHigh', 'poweronhigh');
        if (onLow || onHigh) onPow = ((parseFloat(onLow || 1) + parseFloat(onHigh || 1)) * 50);
        else onPow = getZonePct('PowerOnZone', 100);
      }

      let offPow = offPowAttr ? parseFloat(offPowAttr) * 100 : null;
      if (offPow === null) {
        const offLow = getAttr(node, 'PowerOffLow', 'powerofflow');
        const offHigh = getAttr(node, 'PowerOffHigh', 'poweroffhigh');
        if (offLow || offHigh) offPow = ((parseFloat(offLow || 0.5) + parseFloat(offHigh || 0.5)) * 50);
        else offPow = getZonePct('PowerOffZone', 50);
      }

      for (let r = 0; r < repeat; r++) {
        if (onDur) steps.push({ name: `On (${r + 1}/${repeat})`, duration: onDur, power: Math.round(onPow) });
        if (offDur) steps.push({ name: `Off`, duration: offDur, power: Math.round(offPow) });
      }
    } else if (type === 'freeride') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      const isFtpTest = getAttr(node, 'ftptest', 'flatroad') === '1' && duration >= 600;
      steps.push({
        name: isFtpTest ? 'FTP Test' : 'Slobodna Vožnja',
        duration: duration || 0,
        power: isFtpTest ? 100 : 55
      });
    } else if (type === 'maxeffort') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      steps.push({
        name: 'Maksimalni Napor',
        duration: duration || 0,
        power: 150
      });
    }
  }

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
  const category = categorizeWorkout(steps);
  const diffScore = calculateCategoryDifficulty(steps, category);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    category,
    steps
  };
}

function parseERG(ergText) {
  const lines = ergText.split('\n');
  let title = 'Uvezeni ERG Trening';
  let description = '';
  let inData = false;
  let dataLines = [];
  let ftpParams = 250;
  let unitsPercent = false;

  for (let line of lines) {
    const cl = line.trim();
    if (cl.startsWith('DESCRIPTION=')) description = cl.replace('DESCRIPTION=', '').trim();
    if (cl.startsWith('FILE NAME=') || cl.startsWith('FILENAME=')) title = cl.replace(/FILE NAME=|FILENAME=/g, '').trim();
    if (/^FTP\s*=/i.test(cl)) ftpParams = parseFloat(cl.replace(/^FTP\s*=/i, '')) || 250;
    if (/^MINUTES\s+PERCENT/i.test(cl)) unitsPercent = true;

    if (cl === '[COURSE DATA]') {
      inData = true;
      continue;
    }
    if (cl === '[END COURSE DATA]') {
      inData = false;
      continue;
    }
    if (inData && cl) {
      dataLines.push(cl);
    }
  }

  if (dataLines.length === 0) throw new Error('ERG datoteka ne sadrži [COURSE DATA] sekciju.');

  const points = dataLines.map(l => {
    const parts = l.split(/\s+/).map(Number);
    return { min: parts[0], val: parts[1] };
  });

  const toPct = (val) => {
    if (unitsPercent || !ftpParams || val <= 0) return Math.round(val || 0);
    return Math.round((val / ftpParams) * 100);
  };

  const steps = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];

    if (end.min > start.min) {
      const durationSec = Math.round((end.min - start.min) * 60);
      const pStart = toPct(start.val);
      const pEnd = toPct(end.val);
      const isRamp = Math.abs(pEnd - pStart) >= 2;
      const pMin = Math.min(pStart, pEnd);
      const pMax = Math.max(pStart, pEnd);

      steps.push({
        name: isRamp ? 'Rampa' : 'ERG Interval',
        duration: durationSec,
        power: Math.round((pMin + pMax) / 2),
        ...(isRamp ? { powerMin: pMin, powerMax: pMax, isRange: true, ramp: true, rampStart: pStart, rampEnd: pEnd } : {})
      });
    }
  }

  // Grupiranje uzastopnih koraka s istom snagom za čišći UI (rampe se ne spajaju)
  const mergedSteps = [];
  steps.forEach(s => {
    const prev = mergedSteps[mergedSteps.length - 1];
    if (prev && !prev.ramp && !s.ramp && prev.power === s.power) {
      prev.duration += s.duration;
    } else {
      mergedSteps.push(s);
    }
  });

  const totalDuration = mergedSteps.reduce((sum, s) => sum + s.duration, 0);
  const category = categorizeWorkout(mergedSteps);
  const diffScore = calculateCategoryDifficulty(mergedSteps, category);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    category,
    steps: mergedSteps
  };
}

/**
 * Pretvara strukturirani niz koraka u Intervals.icu tekstualni kod.
 */
export function stepsToIntervalsCode(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  return steps.map(st => {
    const sec = Math.max(10, Math.round(Number(st.duration) || 60));
    const mins = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    let durStr = '';
    if (mins > 0 && remSec === 0) durStr = `${mins}m`;
    else if (mins > 0 && remSec > 0) durStr = `${mins}m${remSec}s`;
    else durStr = `${remSec}s`;

    let pwrStr = '50%';
    if (typeof st.power === 'string' && st.power.trim()) {
      pwrStr = st.power.includes('%') ? st.power.trim() : `${st.power.trim()}%`;
    } else {
      const norm = resolveStepPowerPct(st);
      pwrStr = norm.min !== norm.max ? `${norm.min}-${norm.max}%` : `${norm.avg}%`;
    }

    const rawLabel = st.name
      ? String(st.name).trim()
      : (st.text
        ? String(st.text)
            .replace(/^\s*-\s*/, '')
            .replace(/^(?:\d+:\d{2}|(?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)\s*)+)\s*(?:ramp\s*)?(?:\d+(?:\.\d+)?\s*(?:%?\s*-\s*\d+(?:\.\d+)?\s*)?(?:%|w)\s*(?:FTP)?\s*)?/i, '')
            .trim()
        : '');
    const label = rawLabel ? ` ${rawLabel}` : '';
    return `- ${durStr} ${pwrStr}${label}`;
  }).join('\n');
}

/**
 * Proširuje "Nx" blokove s više koraka u eksplicitni niz koraka
 * kako bi ErgVibe parser i Intervals.icu tekst bili 100% usklađeni.
 */
export function normalizeIntervalsWorkoutText(rawCode = '') {
  if (!rawCode || typeof rawCode !== 'string') return '';
  const lines = rawCode.split(/\r?\n/);
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const isStepLine = trimmed.startsWith('-') || /^\d+:\d{2}/.test(trimmed) || /^\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)(?![a-zA-Z])/i.test(trimmed);
    const pureRepMatch = trimmed.match(/^(\d+)\s*x\s*:?$/i);
    const headerRepMatch = !pureRepMatch && !isStepLine && !trimmed.includes('%') ? trimmed.match(/\b(\d+)\s*x\b/i) : null;
    const repMatch = pureRepMatch || headerRepMatch;

    if (repMatch) {
      const reps = Math.min(30, Math.max(1, parseInt(repMatch[1], 10)));
      if (headerRepMatch) {
        const cleanHeader = trimmed.replace(/\b\d+\s*x\b/i, '').trim();
        if (cleanHeader) output.push(cleanHeader);
      }
      const blockSteps = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) {
          j++;
          break;
        }
        const nextIsStep = nextLine.startsWith('-') || /^\d+:\d{2}/.test(nextLine) || /^\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)(?![a-zA-Z])/i.test(nextLine);
        if (!nextIsStep) {
          break;
        }
        if (blockSteps.length >= 1 && isCooldownOrWarmupLine(nextLine)) {
          break;
        }
        blockSteps.push(nextLine.startsWith('-') ? nextLine : `- ${nextLine}`);
        j++;
      }

      if (blockSteps.length > 0) {
        for (let r = 0; r < reps; r++) {
          blockSteps.forEach(s => output.push(s));
        }
        i = j;
        continue;
      }
    }

    output.push(lines[i]);
    i++;
  }

  return output.join('\n').trim();
}

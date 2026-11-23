/**
 * ErgVibe Longitudinal History Service
 * Spaja povijesne baze treninga s novim CSV uvozima i live aktivnostima iz aplikacije.
 *
 * Razina 1: Bogata deterministička JS pred-obrada (godišnji, mjesečni [12 mj.], tjedni [10 tj.] agregati,
 *           osobni rekordi, zadnjih 40 detaljnih vožnji s usponom, kadencom, RHR, HRRc, W>FTP).
 * Razina 2: Pametni lokalni "mini-RAG" nad cijelim CSV-om prema pitanju korisnika (razdoblja, mjeseci,
 *           godine, godišnja doba, nazivi ruta/treninga, zone intenziteta, rekordi/ekstremi).
 */

import { tr } from '../i18n/i18nCore.js';

const STORAGE_KEY_EXTRA_HISTORY = 'ergvibe_extra_historical_workouts_v1';

let cachedBaseHistory = null;

/**
 * Lazy-load ugrađene povijesne baze (Vite će je odvojiti u zaseban chunk).
 */
export async function loadBaseHistory() {
  // Osobna arhiva vlasnika dostupna je isključivo u lokalnom dev modu (nikada u produkcijskom buildu)
  if (!import.meta.env.DEV) return [];
  if (cachedBaseHistory) return cachedBaseHistory;
  try {
    const mod = await import('../data/historical_workouts.json');
    cachedBaseHistory = Array.isArray(mod.default) ? mod.default : (Array.isArray(mod) ? mod : []);
    return cachedBaseHistory;
  } catch (err) {
    console.warn('[historyService] Nije moguće učitati ugrađenu bazu:', err);
    return [];
  }
}

export function getHistoryOptions(userId = null) {
  // Za produkciju i goste ugrađena arhiva vlasnika uopće ne postoji
  if (!import.meta.env.DEV || userId === 'guest') {
    return { includeBaseHistory: false };
  }

  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
  const key = `ergvibe_include_coach_archive_${userId || 'owner'}`;
  const savedPref = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;

  let includeBaseHistory = false;
  if (savedPref !== null) {
    includeBaseHistory = savedPref === 'true';
  } else if (isLocalhost) {
    // Na lokalnom razvoju kod vlasnika uključeno po defaultu
    includeBaseHistory = true;
  } else {
    // Na produkciji (npr. Vercel) za druge korisnike po defaultu isključeno
    includeBaseHistory = false;
  }

  return { includeBaseHistory };
}

export function setIncludeCoachArchive(include, userId = null) {
  if (userId === 'guest') return;
  const key = `ergvibe_include_coach_archive_${userId || 'owner'}`;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, include ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('ergvibe-history-settings-updated', { detail: { include, userId } }));
  }
}

export function getExtraImportedHistory(userId = null) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const specificKey = `ergvibe_extra_historical_workouts_${userId || 'guest'}`;
    const specificData = localStorage.getItem(specificKey);
    if (specificData) return JSON.parse(specificData);

    // Fallback na v1 ključ ako postoji
    const v1Data = localStorage.getItem(STORAGE_KEY_EXTRA_HISTORY);
    if (v1Data) return JSON.parse(v1Data);
    return [];
  } catch {
    return [];
  }
}

export function clearExtraImportedHistory(userId = null) {
  try {
    if (typeof localStorage === 'undefined') return;
    const specificKey = `ergvibe_extra_historical_workouts_${userId || 'guest'}`;
    localStorage.removeItem(specificKey);
    if (!userId || userId === 'owner') {
      localStorage.removeItem(STORAGE_KEY_EXTRA_HISTORY);
    }
  } catch (e) {
    console.warn('[historyService] Greška pri brisanju CSV povijesti:', e);
  }
}

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

const toNum = (v, decimals = 0) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (decimals === 0) return Math.round(n);
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
};

/**
 * Parsira novi Intervals.icu CSV export iz preglednika i sprema nove zapise u localStorage.
 */
export async function importIntervalsCsvText(csvText, userId = null) {
  if (!csvText || typeof csvText !== 'string') {
    throw new Error(tr('CSV datoteka je prazna ili neispravna.', 'CSV file is empty or invalid.'));
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error(tr('CSV datoteka ne sadrži zapise o treninzima.', 'CSV file does not contain any workout records.'));
  }

  const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, '')).map(h => h.replace(/^"|"$/g, '').trim());
  if (!headers.includes('Date') || !headers.includes('Name')) {
    throw new Error(
      tr(
        'Nepoznat CSV format. Koristi standardni Intervals.icu CSV izvoz aktivnosti.',
        'Unrecognized CSV format. Please use the standard Intervals.icu activities CSV export.'
      )
    );
  }

  const existingExtra = getExtraImportedHistory(userId);

  const knownKeys = new Set();
  existingExtra.forEach(r => {
    knownKeys.add(String(r.id));
    if (r.date) knownKeys.add(`${r.date.slice(0, 10)}_${(r.name || '').toLowerCase().trim()}`);
  });

  const newlyParsed = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const raw = {};
    headers.forEach((h, idx) => {
      raw[h] = vals[idx] !== undefined ? vals[idx] : '';
    });

    if (!raw.Date) continue;
    const idKey = String(raw.id || `csv_${i}`);
    const dateNameKey = `${raw.Date.slice(0, 10)}_${(raw.Name || '').toLowerCase().trim()}`;

    if (knownKeys.has(idKey) || knownKeys.has(dateNameKey)) continue;

    let elapsedSec = toNum(raw['Moving time'] || raw['Elapsed time'], 0);
    if (elapsedSec !== null && (elapsedSec < 0 || elapsedSec > 86400)) {
      elapsedSec = toNum(raw['Elapsed time'], 0);
      if (elapsedSec !== null && (elapsedSec < 0 || elapsedSec > 86400)) elapsedSec = null;
    }
    const workAboveFtpJ = toNum(raw['Work >FTP'], 0);
    const rawDist = toNum(raw.Distance, 1);
    const distKm = rawDist !== null && rawDist > 0
      ? (rawDist > 500 ? Math.round((rawDist / 1000) * 10) / 10 : rawDist)
      : null;
    const avgTempRaw = toNum(raw['Avg Temp'], 1);
    const temp = avgTempRaw !== null && avgTempRaw > -25 && avgTempRaw < 55 ? avgTempRaw : null;
    const isRace = String(raw.Race || '').trim().toLowerCase() === 'true' ? true : null;

    const rec = {
      id: idKey,
      type: raw.Type || 'Ride',
      date: raw.Date,
      name: raw.Name || 'Trening',
      durMin: elapsedSec ? Math.round(elapsedSec / 60) : null,
      distKm,
      avgPwr: toNum(raw['Avg Power'], 0),
      np: toNum(raw['Norm Power'], 0),
      ifPct: toNum(raw.Intensity, 1),
      tss: toNum(raw.Load, 0),
      ftp: toNum(raw.FTP, 0),
      wt: toNum(raw.Weight, 1),
      avgHr: toNum(raw['Avg HR'], 0),
      maxHr: toNum(raw['Max HR'], 0),
      rhr: toNum(raw['Resting HR'], 0),
      hrr: toNum(raw.HRRc, 0),
      cad: toNum(raw.Cadence, 0),
      ef: toNum(raw.Efficiency, 2),
      dec: toNum(raw.Decoupling, 1),
      vi: toNum(raw.Variability, 2),
      ctl: toNum(raw.Fitness, 1),
      tsb: toNum(raw.Form, 0),
      climb: toNum(raw.Climbing, 0),
      pMax: toNum(raw['Activity pMax'] || raw.Pmax, 0),
      eCP: toNum(raw['Activity eCP'], 0),
      wFtpKj: workAboveFtpJ !== null ? Math.round((workAboveFtpJ / 1000) * 10) / 10 : null,
      temp,
      isRace
    };

    const compact = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v !== null && v !== undefined && v !== '') compact[k] = v;
    }

    newlyParsed.push(compact);
    knownKeys.add(idKey);
    knownKeys.add(dateNameKey);
  }

  const mergedExtra = [...newlyParsed, ...existingExtra].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const specificKey = `ergvibe_extra_historical_workouts_${userId || 'guest'}`;
  localStorage.setItem(specificKey, JSON.stringify(mergedExtra));
  if (!userId || userId === 'owner') {
    localStorage.setItem(STORAGE_KEY_EXTRA_HISTORY, JSON.stringify(mergedExtra));
  }

  return {
    addedCount: newlyParsed.length,
    totalExtraCount: mergedExtra.length,
    totalCount: mergedExtra.length
  };
}

/**
 * Normalizira live aktivnost iz ErgVibe / Intervals.icu u isti format kao povijesni zapis.
 */
function normalizeLiveWorkout(w, fallbackFtp = 270) {
  const dateStr = w.started_at || w.start_date_local || w.date || '';
  const np = Number(w.np || w.icu_weighted_avg_watts || 0) || null;
  const avgPwr = Number(w.average_power || w.avg_power || 0) || null;
  const avgHr = Number(w.average_heartrate || w.avg_hr || 0) || null;
  const maxHr = Number(w.max_heartrate || w.max_hr || 0) || null;
  const ftp = Number(w.ftp_used || w.icu_ftp || fallbackFtp) || 270;
  const durMin = Number(w.duration) || (w.duration_seconds ? Math.round(w.duration_seconds / 60) : null);
  const tss = Number(w.tss ?? w.icu_training_load ?? 0) || null;
  const ifPct = np && ftp ? Math.round((np / ftp) * 1000) / 10 : (w.if_factor ? Math.round(Number(w.if_factor) * 1000) / 10 : null);
  const ef = np && avgHr ? Math.round((np / avgHr) * 100) / 100 : null;
  const vi = np && avgPwr ? Math.round((np / avgPwr) * 100) / 100 : null;
  const climb = Number(w.total_elevation_gain || w.climbing || 0) || null;
  const cad = Number(w.average_cadence || w.avg_cadence || 0) || null;

  return {
    id: String(w.actId || w.id || `live_${dateStr}`),
    type: w.type || 'Ride',
    date: dateStr,
    name: w.title || w.name || 'Trening',
    durMin,
    avgPwr,
    np,
    ifPct,
    tss,
    ftp,
    avgHr,
    maxHr,
    cad: cad ? Math.round(cad) : null,
    climb: climb ? Math.round(climb) : null,
    ef,
    vi,
    dec: w.decoupling != null ? Number(w.decoupling) : null,
    isLive: true
  };
}

/**
 * Vraća kompletnu, dedupliciranu kronološku listu svih odrađenih treninga (od najnovijeg prema najstarijem).
 * options: { userId, includeBaseHistory }
 */
export async function getMergedHistoricalWorkouts(liveWorkouts = [], fallbackFtp = 270, options = {}) {
  const { userId = null, includeBaseHistory } = options;
  const resolvedIncludeBase = includeBaseHistory !== undefined
    ? includeBaseHistory
    : getHistoryOptions(userId).includeBaseHistory;

  let base = [];
  if (resolvedIncludeBase) {
    base = await loadBaseHistory();
  }
  const extra = getExtraImportedHistory(userId);

  const mapByKey = new Map();
  const dateTitleSet = new Set();

  // Prvo punimo povijesne (ako su uključeni ili ako ima uvezenih)
  [...extra, ...base].forEach(item => {
    const cleanId = String(item.id).replace(/^act-/, '');
    mapByKey.set(cleanId, item);
    if (item.date) {
      dateTitleSet.add(`${item.date.slice(0, 10)}_${(item.name || '').toLowerCase().trim()}`);
    }
  });

  // Dodaj live odrađene treninge koji još nisu u CSV/JSON bazi
  if (Array.isArray(liveWorkouts)) {
    liveWorkouts
      .filter(w => Boolean(w?.isCompleted))
      .forEach(w => {
        const norm = normalizeLiveWorkout(w, fallbackFtp);
        const cleanId = norm.id.replace(/^act-/, '');
        const dtKey = `${(norm.date || '').slice(0, 10)}_${(norm.name || '').toLowerCase().trim()}`;
        if (!mapByKey.has(cleanId) && !dateTitleSet.has(dtKey)) {
          mapByKey.set(cleanId, norm);
          dateTitleSet.add(dtKey);
        }
      });
  }

  return Array.from(mapByKey.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Pokušava pronaći točan povijesni zapis za aktivnost (kako bismo obogatili podatke s Decouplingom, HRRc, RHR, CTL, TSB).
 */
export async function findExactHistoricalRecord(activity, options = {}) {
  if (!activity) return null;
  const all = await getMergedHistoricalWorkouts([], 270, options);
  const targetId = String(activity.actId || activity.id || '').replace(/^act-/, '');
  const targetDate = (activity.started_at || activity.date || '').slice(0, 10);
  const targetTitle = (activity.title || activity.name || '').toLowerCase().trim();

  return all.find(r => {
    if (targetId && String(r.id) === targetId) return true;
    if (targetDate && r.date?.slice(0, 10) === targetDate) {
      if (targetTitle && (r.name || '').toLowerCase().trim() === targetTitle) return true;
    }
    return false;
  }) || null;
}

function normalizeSearchText(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/č/g, 'c')
    .replace(/ć/g, 'c')
    .replace(/ž/g, 'z')
    .replace(/š/g, 's')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanWorkoutBaseName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/\s*-\s*trainerroad/gi, '')
    .replace(/\s*-\s*zwift/gi, '')
    .replace(/[^a-z0-9čćžšđ\s+-]/gi, '')
    .trim();
}

function getIsoWeekStart(dateStr) {
  if (!dateStr || dateStr.length < 10) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Ned, 1=Pon ... 6=Sub
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

function addDaysUtc(isoDate, days) {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function avgArr(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

function isValidEf(ef) {
  return ef != null && ef > 0.7 && ef < 2.9;
}

function isValidDec(dec) {
  return dec != null && dec > -15 && dec < 25;
}

function isPrintableDec(dec) {
  return dec != null && dec > -40 && dec < 60;
}

/**
 * Klasifikacija treninga u 3 makro-zone intenziteta (za distribuciju intenziteta).
 */
function classifyIntensityBucket(r) {
  const norm = normalizeSearchText(r.name || '');
  if (
    r.isRace ||
    (r.ifPct != null && r.ifPct >= 91) ||
    (r.ifPct >= 80 && r.wFtpKj >= 35 && r.vi >= 1.18 && (r.durMin || 0) <= 110) ||
    /\b(vo2|vo2max|threshold|treshold|supra|utrk|prvenstv|5x3|4x4|4x5|mills|anticosti|walden)\b/.test(norm)
  ) {
    return 'hi';
  }
  if (
    (r.ifPct != null && r.ifPct > 75) ||
    /\b(sweet\s*spot|sweetspot|sst|ss\s+\d|tempo|over[\s-]*under|\bou\b)\b/.test(norm)
  ) {
    return 'mod';
  }
  return 'low';
}

/**
 * Pronalazi najsličnije povijesne treninge (isti naziv treninga + treninzi iste zone intenziteta i trajanja).
 */
export async function findSimilarHistoricalWorkouts(target, liveWorkouts = [], limit = 8, options = {}) {
  const all = await getMergedHistoricalWorkouts(liveWorkouts, target?.ftp || 270, options);
  const targetDate = (target?.date || target?.started_at || '').slice(0, 10);
  const targetId = String(target?.actId || target?.id || '').replace(/^act-/, '');
  const targetCleanName = cleanWorkoutBaseName(target?.title || target?.name || '');

  const targetFtp = Number(target?.ftp || 270);
  const targetNp = Number(target?.np || 0);
  const targetIfPct = Number(target?.ifPct) || (targetNp && targetFtp ? (targetNp / targetFtp) * 100 : 0);
  const targetDur = Number(target?.durMin || target?.duration || 0);

  const candidates = all.filter(r => {
    if (targetId && String(r.id) === targetId) return false;
    if (targetDate && r.date?.slice(0, 10) === targetDate && cleanWorkoutBaseName(r.name) === targetCleanName) {
      return false;
    }
    return (r.np > 0 || r.avgPwr > 0) && r.durMin > 10;
  });

  // 1. Isti ili vrlo sličan naziv treninga (npr. "Penley", "Anticosti", "Pettit")
  const sameNameMatches = targetCleanName.length >= 4
    ? candidates.filter(r => {
        const cn = cleanWorkoutBaseName(r.name);
        return cn === targetCleanName || (cn.length >= 5 && (cn.includes(targetCleanName) || targetCleanName.includes(cn)));
      })
    : [];

  // 2. Fiziološki slični treninzi po IF% (±8%) i trajanju (±25%)
  const metricMatches = candidates
    .filter(r => !sameNameMatches.includes(r))
    .map(r => {
      const rIf = r.ifPct || (r.np && r.ftp ? (r.np / r.ftp) * 100 : 0);
      const ifDiff = targetIfPct > 0 && rIf > 0 ? Math.abs(rIf - targetIfPct) : 50;
      const durRatioDiff = targetDur > 0 && r.durMin > 0 ? Math.abs(r.durMin - targetDur) / targetDur : 1;
      const score = ifDiff * 1.5 + durRatioDiff * 30;
      return { r, ifDiff, durRatioDiff, score };
    })
    .filter(x => x.ifDiff <= 9 && x.durRatioDiff <= 0.35 && x.r.avgHr > 0)
    .sort((a, b) => a.score - b.score)
    .map(x => x.r);

  return [...sameNameMatches.slice(0, 4), ...metricMatches].slice(0, limit);
}

/**
 * Izračunava točne agregatne metrike nad proizvoljnim skupom vožnji (za godišnje, mjesečne, tjedne i RAG sažetke).
 */
export function summarizeWorkoutSubset(workouts = []) {
  let count = 0;
  let minutes = 0;
  let tss = 0;
  let climb = 0;
  let distKm = 0;
  const ftps = [];
  const nps = [];
  const ifs = [];
  const z2Efs = [];
  const z2Decs = [];
  const sstEfs = [];
  const rhrs = [];
  const wts = [];
  let peakCtl = null;
  let minTsb = null;
  let endCtl = null;
  const mix = { low: 0, mod: 0, hi: 0 };

  workouts.forEach((r, idx) => {
    count += 1;
    if (r.durMin > 0 && r.durMin < 1440) minutes += r.durMin;
    if (r.tss > 0) tss += r.tss;
    if (r.climb > 0 && r.climb < 15000) climb += r.climb;
    if (r.distKm > 0 && r.distKm < 1000) distKm += r.distKm;
    if (r.ftp > 0) ftps.push(r.ftp);
    if (r.np > 0) nps.push(r.np);
    if (r.ifPct > 0 && r.ifPct < 200) ifs.push(r.ifPct);
    if (r.rhr > 25 && r.rhr < 110) rhrs.push(r.rhr);
    if (r.wt > 35 && r.wt < 150) wts.push(r.wt);
    if (r.ctl != null && r.ctl > 0) {
      if (peakCtl === null || r.ctl > peakCtl) peakCtl = r.ctl;
      if (idx === 0) endCtl = r.ctl; // pretpostavlja silazni poredak po datumu
    }
    if (r.tsb != null && r.tsb > -120 && r.tsb < 100) {
      if (minTsb === null || r.tsb < minTsb) minTsb = r.tsb;
    }

    if (r.durMin >= 35 && r.ifPct > 0 && isValidEf(r.ef)) {
      if (r.ifPct >= 55 && r.ifPct <= 75) {
        z2Efs.push(r.ef);
        if (isValidDec(r.dec)) z2Decs.push(r.dec);
      } else if (r.ifPct > 75 && r.ifPct <= 93) {
        sstEfs.push(r.ef);
      }
    }

    const bucket = classifyIntensityBucket(r);
    mix[bucket] += 1;
  });

  return {
    count,
    hours: Math.round((minutes / 60) * 10) / 10,
    tss: Math.round(tss),
    climb: Math.round(climb),
    distKm: distKm > 0 ? Math.round(distKm * 10) / 10 : null,
    minFtp: ftps.length ? Math.min(...ftps) : null,
    maxFtp: ftps.length ? Math.max(...ftps) : null,
    avgFtp: ftps.length ? Math.round(avgArr(ftps)) : null,
    avgNp: nps.length ? Math.round(avgArr(nps)) : null,
    avgIf: ifs.length ? Number(avgArr(ifs).toFixed(1)) : null,
    avgZ2Ef: z2Efs.length ? Number(avgArr(z2Efs).toFixed(2)) : null,
    avgZ2Dec: z2Decs.length ? Number(avgArr(z2Decs).toFixed(1)) : null,
    avgSstEf: sstEfs.length ? Number(avgArr(sstEfs).toFixed(2)) : null,
    avgRhr: rhrs.length ? Math.round(avgArr(rhrs)) : null,
    avgWt: wts.length ? Number(avgArr(wts).toFixed(1)) : null,
    peakCtl: peakCtl !== null ? Number(peakCtl.toFixed(1)) : null,
    endCtl: endCtl !== null ? Number(endCtl.toFixed(1)) : null,
    minTsb: minTsb !== null ? Math.round(minTsb) : null,
    mix
  };
}

/**
 * Čisti, sinkroni proračun cjelokupne Razina 1 statistike nad listom vožnji (godišnje, mjesečne, tjedne, rekordi).
 */
export function computeHistoricalStats(all = []) {
  if (!Array.isArray(all) || !all.length) return null;

  const byYearMap = {};
  const byMonthMap = {};
  const byWeekMap = {};

  let totalTss = 0;
  let totalMinutes = 0;
  let totalClimb = 0;
  let peakFtp = 0;
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  const z2EfList = [];
  const z2DecList = [];
  const sstEfList = [];
  const sstDecList = [];
  const vo2EfList = [];

  // Osobni rekordi i ekstremi
  const records = {
    longestRide: null,
    highestTss: null,
    biggestClimb: null,
    highestNp45: null,
    highestNp20: null,
    peakECP: null,
    peakPmax: null,
    highestWorkAboveFtp: null,
    peakCtl: null,
    bestZ2Ef: null
  };

  all.forEach(r => {
    const dateStr = (r.date || '').slice(0, 10);
    if (dateStr && dateStr < minDate) minDate = dateStr;
    if (dateStr && dateStr > maxDate) maxDate = dateStr;

    const y = dateStr && /^\d{4}/.test(dateStr) ? dateStr.slice(0, 4) : 'Ostalo';
    if (!byYearMap[y]) byYearMap[y] = [];
    byYearMap[y].push(r);

    const ym = dateStr && /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : null;
    if (ym) {
      if (!byMonthMap[ym]) byMonthMap[ym] = [];
      byMonthMap[ym].push(r);
    }

    const wk = getIsoWeekStart(dateStr);
    if (wk) {
      if (!byWeekMap[wk]) byWeekMap[wk] = [];
      byWeekMap[wk].push(r);
    }

    if (r.tss > 0) totalTss += r.tss;
    if (r.durMin > 0 && r.durMin < 1440) totalMinutes += r.durMin;
    if (r.climb > 0 && r.climb < 15000) totalClimb += r.climb;
    if (r.ftp > 0 && r.ftp > peakFtp) peakFtp = r.ftp;

    // Benchmarkovi po zonama (samo treninzi >= 35 min s validnim EF)
    if (r.durMin >= 35 && r.ifPct > 0 && isValidEf(r.ef)) {
      if (r.ifPct >= 55 && r.ifPct <= 75) {
        z2EfList.push({ date: dateStr, ef: r.ef });
        if (isValidDec(r.dec)) z2DecList.push(r.dec);
      } else if (r.ifPct > 75 && r.ifPct <= 93) {
        sstEfList.push(r.ef);
        if (isValidDec(r.dec)) sstDecList.push(r.dec);
      } else if (r.ifPct > 93) {
        vo2EfList.push(r.ef);
      }
    }

    // Osobni rekordi (sa zaštitom od pokvarenih/ekstremnih senzorskih vrijednosti)
    if (r.durMin > 0 && r.durMin < 1440 && (!records.longestRide || r.durMin > records.longestRide.durMin)) {
      records.longestRide = r;
    }
    if (r.tss > 0 && r.tss < 1500 && (!records.highestTss || r.tss > records.highestTss.tss)) {
      records.highestTss = r;
    }
    if (r.climb > 0 && r.climb < 12000 && (!records.biggestClimb || r.climb > records.biggestClimb.climb)) {
      records.biggestClimb = r;
    }
    if (r.durMin >= 45 && r.np > 0 && r.np < 700 && (!records.highestNp45 || r.np > records.highestNp45.np)) {
      records.highestNp45 = r;
    }
    if (r.durMin >= 20 && r.np > 0 && r.np < 750 && (!records.highestNp20 || r.np > records.highestNp20.np)) {
      records.highestNp20 = r;
    }
    if (r.eCP > 0 && r.eCP < 650 && (!records.peakECP || r.eCP > records.peakECP.eCP)) {
      records.peakECP = r;
    }
    if (r.pMax > 0 && r.pMax < 2500 && (!records.peakPmax || r.pMax > records.peakPmax.pMax)) {
      records.peakPmax = r;
    }
    if (r.wFtpKj > 0 && r.wFtpKj < 1500 && (!records.highestWorkAboveFtp || r.wFtpKj > records.highestWorkAboveFtp.wFtpKj)) {
      records.highestWorkAboveFtp = r;
    }
    if (r.ctl > 0 && r.ctl < 250 && (!records.peakCtl || r.ctl > records.peakCtl.ctl)) {
      records.peakCtl = r;
    }
    if (
      r.durMin >= 45 &&
      r.ifPct >= 55 &&
      r.ifPct <= 75 &&
      r.avgHr >= 90 &&
      isValidEf(r.ef) &&
      (!records.bestZ2Ef || r.ef > records.bestZ2Ef.ef)
    ) {
      records.bestZ2Ef = r;
    }
  });

  const yearlyStats = Object.entries(byYearMap)
    .filter(([year]) => /^\d{4}$/.test(year))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, list]) => {
      const s = summarizeWorkoutSubset(list);
      const allEfs = list.filter(r => isValidEf(r.ef)).map(r => r.ef);
      return {
        year,
        count: s.count,
        hours: Math.round(s.hours),
        tss: s.tss,
        climb: s.climb,
        minFtp: s.minFtp,
        maxFtp: s.maxFtp,
        avgFtp: s.avgFtp,
        peakCtl: s.peakCtl,
        avgZ2Ef: s.avgZ2Ef,
        avgZ2Dec: s.avgZ2Dec,
        avgRhr: s.avgRhr,
        avgWt: s.avgWt,
        avgEf: allEfs.length ? Number(avgArr(allEfs).toFixed(2)) : null
      };
    });

  const allMonthlyStats = Object.entries(byMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({
      month,
      ...summarizeWorkoutSubset(list)
    }));

  const recentMonthlyStats = allMonthlyStats.slice(-12);

  const weeklyStats = Object.entries(byWeekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([weekStart, list]) => ({
      weekStart,
      weekEnd: addDaysUtc(weekStart, 6),
      ...summarizeWorkoutSubset(list)
    }));

  const recentZ2Efs = z2EfList.slice(0, 25).map(x => x.ef);

  return {
    totalWorkouts: all.length,
    totalHours: Math.round(totalMinutes / 60),
    totalTss: Math.round(totalTss),
    totalClimb: Math.round(totalClimb),
    minDate,
    maxDate,
    peakFtp,
    latestRecord: all[0] || null,
    yearlyStats,
    allMonthlyStats,
    recentMonthlyStats,
    weeklyStats,
    records,
    benchmarks: {
      z2AvgEfAllTime: z2EfList.length ? Number(avgArr(z2EfList.map(x => x.ef)).toFixed(2)) : null,
      z2AvgEfRecent: recentZ2Efs.length ? Number(avgArr(recentZ2Efs).toFixed(2)) : null,
      z2AvgDecoupling: z2DecList.length ? Number(avgArr(z2DecList).toFixed(1)) : null,
      sstAvgEf: sstEfList.length ? Number(avgArr(sstEfList).toFixed(2)) : null,
      sstAvgDecoupling: sstDecList.length ? Number(avgArr(sstDecList).toFixed(1)) : null,
      highIntAvgEf: vo2EfList.length ? Number(avgArr(vo2EfList).toFixed(2)) : null
    }
  };
}

/**
 * Računa višegodišnju statistiku i osobne benchmarke po zonama za UI i AI Trenera.
 */
export async function getHistoricalDashboardStats(liveWorkouts = [], options = {}) {
  const all = await getMergedHistoricalWorkouts(liveWorkouts, 270, options);
  return computeHistoricalStats(all);
}

/**
 * Kompaktni prikaz jednog treninga sa svim relevantnim CSV metrikama (uklj. uspon, kadencu, RHR, HRRc, W>FTP).
 */
export function formatHistoryRowCompact(r) {
  const typeTag = r.type && r.type !== 'Ride'
    ? (r.type === 'VirtualRide' ? '[Indoor]' : r.type === 'GravelRide' ? '[Gravel]' : r.type === 'MountainBikeRide' ? '[MTB]' : `[${r.type}]`)
    : null;
  const titleStr = `"${r.name || 'Trening'}"${r.isRace ? ' [UTRKA]' : ''}`;
  const hrStr = r.avgHr
    ? `HR:${r.avgHr}${r.maxHr && r.maxHr > r.avgHr ? '/' + r.maxHr : ''}bpm`
    : null;

  const parts = [
    `${(r.date || '').slice(0, 10)}`,
    typeTag,
    titleStr,
    r.durMin ? `${r.durMin}min` : null,
    r.distKm ? `${r.distKm}km` : null,
    r.climb > 0 ? `+${r.climb}m` : null,
    r.np ? `NP:${r.np}W` : (r.avgPwr ? `Avg:${r.avgPwr}W` : null),
    r.ifPct ? `IF:${r.ifPct}%` : null,
    r.tss != null ? `TSS:${r.tss}` : null,
    hrStr,
    r.cad > 0 ? `Cad:${r.cad}rpm` : null,
    isValidEf(r.ef) ? `EF:${r.ef}` : null,
    isPrintableDec(r.dec) ? `Dec:${r.dec}%` : null,
    r.vi > 0 && r.vi < 4 ? `VI:${r.vi}` : null,
    r.wFtpKj >= 5 ? `W>FTP:${r.wFtpKj}kJ` : null,
    r.rhr > 25 && r.rhr < 110 ? `RHR:${r.rhr}` : null,
    r.hrr > 0 ? `HRRc:${r.hrr}` : null,
    r.ctl != null ? `CTL:${r.ctl}` : null,
    r.tsb != null ? `TSB:${r.tsb}` : null,
    r.temp != null ? `${r.temp}°C` : null
  ].filter(Boolean);
  return `- ${parts.join(' | ')}`;
}

// ============================================================================
// RAZINA 2: PAMETNI LOKALNI "MINI-RAG" NAD CIJELIM CSV-OM
// ============================================================================

const MONTH_PATTERNS = [
  { month: 1, label: 'siječanj', regex: /\b(?:sijec(?:anj|nj[a-z]*)|januar[a-z]*|january)\b/g },
  { month: 2, label: 'veljača', regex: /\b(?:veljac[a-z]*|februar[a-z]*|february)\b/g },
  { month: 3, label: 'ožujak', regex: /\b(?:ozuj(?:ak|k[a-z]*)|mart[a-z]*|march)\b/g },
  { month: 4, label: 'travanj', regex: /\b(?:trav(?:anj|nj[a-z]*)|april[a-z]*)\b/g },
  { month: 5, label: 'svibanj', regex: /\b(?:svib(?:anj|nj[a-z]*)|maj(?:a|u|em)?|may)\b/g },
  { month: 6, label: 'lipanj', regex: /\b(?:lip(?:anj|nj[a-z]*)|jun(?:i|a|u|ij[a-z]*)?|june)\b/g },
  { month: 7, label: 'srpanj', regex: /\b(?:srp(?:anj|nj[a-z]*)|jul(?:i|a|u|ij[a-z]*)?|july)\b/g },
  { month: 8, label: 'kolovoz', regex: /\b(?:kolovoz[a-z]*|august[a-z]*|avgust[a-z]*)\b/g },
  { month: 9, label: 'rujan', regex: /\b(?:ruj(?:an|n[a-z]*)|septemb[a-z]*)\b/g },
  { month: 10, label: 'listopad', regex: /\b(?:listopad[a-z]*|oktob[a-z]*|octob[a-z]*)\b/g },
  { month: 11, label: 'studeni', regex: /\b(?:studen(?:i|og|om|oga|omu)|novemb[a-z]*)\b/g },
  { month: 12, label: 'prosinac', regex: /\b(?:prosin(?:ac|c[a-z]*)|decemb[a-z]*)\b/g }
];

const SEASON_PATTERNS = [
  { id: 'spring', label: 'proljeće', months: [3, 4, 5], regex: /\bproljec[a-z]*\b/ },
  { id: 'summer', label: 'ljeto', months: [6, 7, 8], regex: /\bljet[a-z]*\b/ },
  { id: 'autumn', label: 'jesen', months: [9, 10, 11], regex: /\bjesen[a-z]*\b/ },
  { id: 'winter', label: 'zima', months: [12, 1, 2], regex: /\bzim(?:a|e|i|u|om|sk[a-z]*)\b/ }
];

const HISTORICAL_INTENT_REGEX = /\b(povijest\w*|uspored\w*|analiz\w*|trend\w*|napred\w*|koliko\w*|kada\b|prosl\w*|lanjsk\w*|lani\b|ranij\w*|prije\b|zadnj\w*|posljednj\w*|protekl\w*|kroz\b|sezon\w*|godin\w*|mjesec\w*|tjedn\w*|pokaz\w*|izlist\w*|svi\b|sve\b|svih\b|ikad\w*|rezultat\w*|vozil\w*|vozio\b|odvoz\w*|odrad\w*|penja\w*|izvedb\w*|statist\w*|pregled\w*|kolik\w*|histor\w*|csv\b|baz[aei]\b|drift\w*|kako\s+sam|jesam\s+li|imam\s+li)\b/;

const COMPARISON_TO_NOW_REGEX = /\b(danasnj\w*|sadasnj\w*|trenutn\w*|nedavn\w*|ovim\s+tjedn\w*|ovog\s+mjesec\w*|ovih\s+dana)\b/;
const COMPARE_VERB_REGEX = /\b(uspored\w*|naspram|vs\.?|u\s+odnosu)\b/;

const QUERY_STOPWORDS = new Set([
  'kako', 'koliko', 'kada', 'gdje', 'zasto', 'koji', 'koja', 'koje', 'kojih', 'kojem', 'kojoj',
  'sam', 'smo', 'ste', 'jesam', 'nisam', 'bio', 'bila', 'bilo', 'bili', 'biti', 'bude', 'bih', 'bismo',
  'moj', 'moja', 'moje', 'mojih', 'mojim', 'moju', 'mogu', 'moze', 'mozes', 'mozemo', 'trebam', 'treba',
  'zelim', 'hocu', 'imam', 'imao', 'imala', 'imali', 'nema', 'nemam', 'ovaj', 'ovog', 'ovom', 'ova', 'ove', 'ovo',
  'taj', 'toga', 'tom', 'tada', 'onda', 'sada', 'danas', 'sutra', 'jucer', 'prekjucer', 'uvijek', 'nikad', 'ikad',
  'vise', 'manje', 'bolje', 'gore', 'dobro', 'lose', 'super', 'jako', 'malo', 'puno', 'mnogo', 'sve', 'svi', 'svih',
  'jedan', 'jedna', 'dva', 'dvije', 'tri', 'cetiri', 'pet', 'sest', 'sedam', 'osam', 'devet', 'deset',
  'trening', 'treninga', 'treninge', 'treninzi', 'treninzima', 'treningu', 'trenirati', 'treniram', 'trenirao',
  'voznja', 'voznje', 'voznji', 'voznju', 'voznjama', 'voziti', 'vozim', 'vozio', 'vozila', 'odvozio', 'odradio', 'odraditi',
  'bicikl', 'biciklizam', 'biciklisticki', 'tjedan', 'tjedna', 'tjednu', 'tjedana', 'tjedno',
  'mjesec', 'mjeseca', 'mjesecu', 'mjeseci', 'mjesecno', 'godina', 'godine', 'godini', 'godinu', 'godisnje', 'sezona', 'sezone', 'sezoni',
  'zadnji', 'zadnja', 'zadnje', 'zadnjih', 'zadnjim', 'posljednji', 'posljednjih', 'prosli', 'prosla', 'proslo', 'prosle', 'proslog', 'proslom',
  'protekli', 'proteklih', 'raniji', 'ranijih', 'lani', 'lanjske', 'lanjski',
  'usporedi', 'usporediti', 'usporedba', 'analiziraj', 'analiza', 'analizu', 'pokazi', 'prikazi', 'izlistaj', 'pregled',
  'reci', 'napisi', 'napravi', 'predlozi', 'slozi', 'kreiraj', 'savjet', 'savjetuj', 'objasni', 'provjeri', 'pogledaj',
  'plan', 'plana', 'planu', 'blok', 'faza', 'cilj', 'cilja', 'forma', 'forme', 'formu', 'umor', 'umora', 'oporavak', 'oporavka',
  'snaga', 'snage', 'snagu', 'watt', 'watti', 'watta', 'puls', 'pulsa', 'srca', 'kadenca', 'kadence', 'uspon', 'uspona', 'usponi',
  'brdo', 'brda', 'brdu', 'penjanje', 'penjao', 'penjanja', 'visinska', 'visinskih', 'metara',
  'zona', 'zone', 'zoni', 'intenzitet', 'intenziteta', 'tempo', 'prag', 'praga', 'interval', 'intervali', 'intervala', 'intervale',
  'sweet', 'spot', 'sweetspot', 'threshold', 'treshold', 'endurance', 'recovery', 'vo2max', 'anaerobni', 'aerobni', 'aerobna',
  'baza', 'baze', 'bazu', 'bazni', 'duzina', 'duzine', 'duzinu', 'utrka', 'utrke', 'utrku', 'utrci', 'utrkama', 'race',
  'trenazer', 'trenazeru', 'trenazera', 'indoor', 'outdoor', 'vanjski', 'vanjske', 'vanjskih', 'vani', 'cesta', 'cesti',
  'decoupling', 'drift', 'kardijalni', 'efikasnost', 'efficiency', 'variability', 'fitness', 'fatigue', 'form',
  'najduza', 'najduzi', 'najduze', 'najteza', 'najtezi', 'najteze', 'najveci', 'najveca', 'najvece', 'najvisi', 'najvisa',
  'najbolji', 'najbolja', 'najbolje', 'najgori', 'najgora', 'najjaci', 'najjaca', 'rekord', 'rekordi', 'rekordni', 'maksimalni',
  'povijest', 'povijesti', 'podaci', 'podatke', 'podacima', 'baza', 'bazi', 'csv', 'statistika', 'statistiku', 'trend', 'napredak',
  'minuta', 'minute', 'minuti', 'sati', 'sata', 'sat', 'satu', 'satom', 'satima', 'dana', 'dane', 'dan', 'kroz', 'izmedu', 'nakon', 'prije', 'tokom', 'tijekom',
  'prema', 'protiv', 'zbog', 'nego', 'isto', 'samo', 'jako', 'ovdje', 'tamo', 'meni', 'mene', 'sebe', 'svoj', 'svoje', 'svoju', 'svojih',
  'ride', 'virtualride', 'gravelride', 'trainerroad', 'rouvy', 'zwift', 'workout', 'workouts', 'training', 'cycling', 'test', 'testa',
  'proljece', 'proljeca', 'proljecu', 'ljeto', 'ljeta', 'ljetu', 'ljetni', 'jesen', 'jeseni', 'jesenski', 'zima', 'zime', 'zimi', 'zimski',
  'sijecanj', 'sijecnja', 'sijecnju', 'veljaca', 'veljace', 'veljaci', 'ozujak', 'ozujka', 'ozujku', 'travanj', 'travnja', 'travnju',
  'svibanj', 'svibnja', 'svibnju', 'lipanj', 'lipnja', 'lipnju', 'srpanj', 'srpnja', 'srpnju', 'kolovoz', 'kolovoza', 'kolovozu',
  'rujan', 'rujna', 'rujnu', 'listopad', 'listopada', 'listopadu', 'studeni', 'studenog', 'studenom', 'prosinac', 'prosinca', 'prosincu',
  'januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'august', 'septembar', 'oktobar', 'novembar', 'decembar',
  'danasnji', 'danasnjim', 'danasnjom', 'sadasnji', 'sadasnjim', 'trenutni', 'trenutnim', 'nedavni', 'nedavnim',
  'priprema', 'pripreme', 'pripremiti', 'spreman', 'spremanje', 'novi', 'nova', 'novo', 'novih', 'stari', 'stara', 'starih',
  'maraton', 'maratona', 'maratonu', 'unos', 'unosa', 'ugljikohidrata', 'ugljikohidrati', 'proteina', 'kofein', 'kofeina',
  'hidracija', 'hidratacija', 'voda', 'vode', 'hrana', 'hrane', 'gelova', 'elektrolita', 'spavanje', 'spavanja',
  'odmor', 'odmora', 'odmoriti', 'pauza', 'pauze', 'preskocim', 'preskociti', 'bolest', 'bolestan', 'grlo', 'ventilator', 'ventilatora',
  'idealan', 'idealno', 'optimalan', 'optimalno', 'kakav', 'kakva', 'kakvo', 'kakvi', 'kakve', 'visok', 'nizak', 'lagano', 'tesko',
  'ponedjeljak', 'utorak', 'srijeda', 'cetvrtak', 'petak', 'subota', 'nedjelja', 'subotu', 'nedjelju', 'vikend', 'vikenda',
  'rhr', 'hrr', 'hrrc', 'ftp', 'tss', 'ctl', 'atl', 'tsb', 'pmax', 'ecp', 'wkg', 'bpm', 'rpm'
]);

const CATEGORY_DETECTORS = [
  {
    id: 'vo2max',
    label: 'VO2 Max',
    queryRegex: /\b(vo2\s*max|vo2max|vo2|maksimaln\w*\s+kisik\w*|z5)\b/,
    matchWorkout: (r, normName) =>
      /\b(vo2|vo2max|5x3|4x4|4x5|3x4|6x3|30\/15|30\/30|40\/20|mills|baird|spencer|anticosti|walden|english|bluebell)\b/.test(normName) ||
      (r.ifPct >= 93 && (r.durMin || 0) >= 20) ||
      (r.ifPct >= 80 && (r.wFtpKj || 0) >= 35 && (r.vi || 0) >= 1.18 && (r.durMin || 0) <= 110)
  },
  {
    id: 'sweetspot',
    label: 'Sweet Spot / Tempo',
    queryRegex: /\b(sweet\s*spot|sweetspot|sst|\bss\b|tempo|z3)\b/,
    matchWorkout: (r, normName) =>
      /\b(sweet\s*spot|sweetspot|sst|ss\s+\d|tempo|antelope|carson|mono|cloudripper|wright|tallac|galena)\b/.test(normName) ||
      (r.ifPct >= 76 && r.ifPct <= 90 && (r.durMin || 0) >= 45 && (r.wFtpKj == null || r.wFtpKj < 18) && (r.vi == null || r.vi <= 1.15))
  },
  {
    id: 'threshold',
    label: 'Threshold / Over-Unders / FTP Test',
    queryRegex: /\b(threshold|treshold|over[\s-]*under|\bou\b|supra[\s-]*threshold|ftp\s*test|2x20|z4|prag\w*)\b/,
    matchWorkout: (r, normName) =>
      /\b(threshold|treshold|over[\s-]*under|\bou\b|supra[\s-]*threshold|ftp\s*test|2x20|3x12|4x10|4x8|4x12|3x15|lamarck)\b/.test(normName) ||
      (r.ifPct >= 88 && r.ifPct <= 105 && (r.durMin || 0) >= 35 && (r.vi == null || r.vi <= 1.18))
  },
  {
    id: 'z2',
    label: 'Z2 Endurance / Aerobna baza',
    queryRegex: /\b(z2|zona\s*2|endurance|baz[aeu]\b|bazn\w*|duzin\w*|izdrzljivost\w*|decoupling|aerobn\w*\s+(?:baza|ef|ispiranje))\b/,
    matchWorkout: (r, normName) =>
      /\b(z2|zona\s*2|endurance|aerobno\s+ispiranje|duzina|pettit|townsend|penley|capulin|harrah|tuscola|carter|volunteer|bald|ophir|daemon)\b/.test(normName) ||
      (r.ifPct >= 55 && r.ifPct <= 75 && (r.durMin || 0) >= 40)
  },
  {
    id: 'race',
    label: 'Utrke',
    queryRegex: /\b(utrk\w*|race|prvenstv\w*|gran\s*fondo|maraton\w*|kriterij\w*)\b/,
    matchWorkout: (r, normName) =>
      Boolean(r.isRace) ||
      /\b(utrk\w*|prvenstv\w*|cener|kolo\b|race|maraton|fondo|kriterij|putevima\s+cvijec|ucka\s+20|sljeme)\b/.test(normName)
  },
  {
    id: 'climbing',
    label: 'Brdske vožnje / Usponi',
    queryRegex: /\b(brd\w*|uspon\w*|penj\w*|visinsk\w*|climb\w*)\b/,
    matchWorkout: (r) => (r.climb || 0) >= 350,
    preferSort: (a, b) => (b.climb || 0) - (a.climb || 0)
  },
  {
    id: 'sprint',
    label: 'Sprint / Anaerobno / pMax',
    queryRegex: /\b(sprint\w*|pmax|anaerobn\w*|w\s*>\s*ftp|rad\s+iznad\s+ftp|eksploziv\w*)\b/,
    matchWorkout: (r, normName) =>
      /\bsprint\w*|anaerob|neuro/.test(normName) || (r.wFtpKj || 0) >= 60 || (r.pMax || 0) >= 750,
    preferSort: (a, b) => (b.wFtpKj || b.pMax || 0) - (a.wFtpKj || a.pMax || 0)
  },
  {
    id: 'indoor',
    label: 'Indoor / Trenažer',
    queryRegex: /\b(trenazer\w*|indoor|virtual\w*|rouvy|zwift|trainerroad|dvoransk\w*)\b/,
    matchWorkout: (r, normName) =>
      r.type === 'VirtualRide' || /\b(trainerroad|rouvy|zwift|dvoransk)\b/.test(normName)
  },
  {
    id: 'outdoor',
    label: 'Vanjske vožnje (Outdoor / Gravel)',
    queryRegex: /\b(vanjsk\w*|vani\b|outdoor|gravel\w*)\b/,
    matchWorkout: (r) => (r.climb || 0) > 0 || r.type === 'GravelRide' || r.type === 'MountainBikeRide'
  },
  {
    id: 'autonomic',
    label: 'Autonomni markeri (RHR / HRRc / TSB)',
    queryRegex: /\b(rhr|jutarnj\w*\s+puls|hrr|hrrc|oporavak\s+pulsa|pretreniran\w*|dubok\w*\s+umor)\b/,
    matchWorkout: (r) => (r.hrr || 0) > 0 || (r.rhr || 0) >= 52 || (r.tsb != null && r.tsb <= -20)
  }
];

const RANKING_DETECTORS = [
  {
    id: 'longest',
    label: 'Najduže vožnje',
    regex: /\b(najduz\w*|longest|najvise\s+sati|najvise\s+vremena)\b/,
    filter: r => (r.durMin || 0) > 0 && r.durMin < 1440,
    sort: (a, b) => (b.durMin || 0) - (a.durMin || 0)
  },
  {
    id: 'hardest',
    label: 'Najteže vožnje (najveći TSS)',
    regex: /\b(najtez\w*|najzahtjevnij\w*|najvec\w*\s+(?:tss|load|opterecenj\w*)|rekord\w*\s+tss)\b/,
    filter: r => (r.tss || 0) > 0 && r.tss < 1500,
    sort: (a, b) => (b.tss || 0) - (a.tss || 0)
  },
  {
    id: 'biggest_climb',
    label: 'Vožnje s najvećim usponom',
    regex: /\b(najvec\w*\s+(?:uspon\w*|penjanj\w*|visin\w*)|najvise\s+(?:penjanj\w*|uspon\w*|visinsk\w*))\b/,
    filter: r => (r.climb || 0) > 0 && r.climb < 12000,
    sort: (a, b) => (b.climb || 0) - (a.climb || 0)
  },
  {
    id: 'best_ef',
    label: 'Najviši Efficiency Factor (EF)',
    regex: /\b((?:najbolj\w*|najvis\w*|najvec\w*|rekord\w*)\s+ef\b|najefikasnij\w*)\b/,
    filter: r => (r.durMin || 0) >= 35 && isValidEf(r.ef) && (r.avgHr || 0) >= 90,
    sort: (a, b) => (b.ef || 0) - (a.ef || 0)
  },
  {
    id: 'highest_np',
    label: 'Najveća normalizirana snaga (NP ≥ 20 min)',
    regex: /\b((?:najvec\w*|najvis\w*|najjac\w*|najbolj\w*|rekord\w*)\s+(?:np|snag\w*|watt\w*|ecp|pmax))\b/,
    filter: r => (r.durMin || 0) >= 20 && (r.np || 0) > 0 && r.np < 750,
    sort: (a, b) => (b.np || 0) - (a.np || 0)
  },
  {
    id: 'worst_dec',
    label: 'Najveći kardijalni drift (Decoupling na Z2/Z3 ≥ 45m)',
    regex: /\b((?:najvec\w*|najgor\w*)\s+(?:decoupling|drift)|kardijaln\w*\s+drift)\b/,
    filter: r => (r.durMin || 0) >= 45 && r.ifPct >= 55 && r.ifPct <= 90 && r.dec != null && r.dec > 0 && r.dec < 35,
    sort: (a, b) => (b.dec || 0) - (a.dec || 0)
  }
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stemCroatianToken(tok) {
  if (!tok || tok.length < 4) return tok;
  const suffixes = ['ama', 'ima', 'oga', 'omu', 'ega', 'emu', 'ski', 'ska', 'sko', 'ske', 'ih', 'im', 'om', 'em', 'oj', 'ej', 'a', 'e', 'i', 'o', 'u'];
  for (const suf of suffixes) {
    if (tok.endsWith(suf) && tok.length - suf.length >= 3) {
      return tok.slice(0, -suf.length);
    }
  }
  return tok;
}

/**
 * Parsira vremenske filtre iz korisničkog pitanja (mjeseci, godine, godišnja doba, relativna razdoblja).
 */
function extractTimePeriods(normQuery, allWorkouts, refIsoDate) {
  const periods = [];
  const availableMonths = new Set();
  const availableYears = new Set();
  allWorkouts.forEach(r => {
    const d = (r.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}/.test(d)) {
      availableMonths.add(d.slice(0, 7));
      availableYears.add(Number(d.slice(0, 4)));
    }
  });
  const sortedYearsDesc = Array.from(availableYears).sort((a, b) => b - a);
  const refYear = Number(refIsoDate.slice(0, 4));
  const refMonth = Number(refIsoDate.slice(5, 7));
  const latestAvailableYear = sortedYearsDesc[0] || refYear;

  const addedKeys = new Set();
  const pushPeriod = (period) => {
    if (!period || addedKeys.has(period.key)) return;
    addedKeys.add(period.key);
    periods.push(period);
  };

  // 1. Eksplicitni ISO datumi (YYYY-MM-DD) ili hrvatski (DD.MM.YYYY)
  const isoDateMatches = [...normQuery.matchAll(/\b(20[12]\d)-(\d{2})-(\d{2})\b/g)];
  isoDateMatches.forEach(m => {
    const dt = `${m[1]}-${m[2]}-${m[3]}`;
    pushPeriod({
      key: `day:${dt}`,
      label: dt,
      type: 'range',
      startDate: addDaysUtc(dt, -2),
      endDate: addDaysUtc(dt, 2)
    });
  });

  const hrDateMatches = [...normQuery.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20[12]\d)\.?\b/g)];
  hrDateMatches.forEach(m => {
    const dd = pad2(Number(m[1]));
    const mm = pad2(Number(m[2]));
    const yyyy = m[3];
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      const dt = `${yyyy}-${mm}-${dd}`;
      pushPeriod({
        key: `day:${dt}`,
        label: `${dd}.${mm}.${yyyy}.`,
        type: 'range',
        startDate: addDaysUtc(dt, -2),
        endDate: addDaysUtc(dt, 2)
      });
    }
  });

  // 2. Numerički YYYY-MM ili MM/YYYY ili MM.YYYY
  for (const m of normQuery.matchAll(/\b(20[12]\d)[-/.](0?[1-9]|1[0-2])\b(?!-\d{2})/g)) {
    const ym = `${m[1]}-${pad2(Number(m[2]))}`;
    pushPeriod({ key: `month:${ym}`, label: ym, type: 'month', monthKey: ym });
  }
  for (const m of normQuery.matchAll(/\b(0?[1-9]|1[0-2])[/.](20[12]\d)\b/g)) {
    const ym = `${m[2]}-${pad2(Number(m[1]))}`;
    pushPeriod({ key: `month:${ym}`, label: ym, type: 'month', monthKey: ym });
  }

  // 3. Tekstualni mjeseci + godine (s podrškom za parove poput "svibanj 2025 i svibanj 2026" ili "svibanj 2025 i 2026")
  const mentionedMonths = [];
  MONTH_PATTERNS.forEach(mp => {
    const rx = new RegExp(mp.regex.source, 'g');
    let match;
    while ((match = rx.exec(normQuery)) !== null) {
      mentionedMonths.push({ month: mp.month, label: mp.label, index: match.index, end: match.index + match[0].length });
    }
  });
  mentionedMonths.sort((a, b) => a.index - b.index);

  const mentionedYears = [];
  for (const ym of normQuery.matchAll(/\b(20[12]\d)\b/g)) {
    mentionedYears.push({ year: Number(ym[1]), index: ym.index, end: ym.index + ym[0].length });
  }

  const usedYearIndices = new Set();
  const isPrevCue = /\b(prosl\w*|lanjsk\w*|lani)\b/.test(normQuery);

  if (mentionedMonths.length > 0) {
    // Prvo spoji parove gdje godina stoji neposredno iza mjeseca (unutar 14 znakova)
    const pairedMonths = new Set();
    mentionedMonths.forEach((mm, mIdx) => {
      const closeYearIdx = mentionedYears.findIndex((yy, yIdx) => !usedYearIndices.has(yIdx) && yy.index >= mm.end && yy.index - mm.end <= 14);
      if (closeYearIdx !== -1) {
        const y = mentionedYears[closeYearIdx].year;
        const ym = `${y}-${pad2(mm.month)}`;
        pushPeriod({ key: `month:${ym}`, label: `${mm.label} ${y}.`, type: 'month', monthKey: ym });
        pairedMonths.add(mIdx);
        usedYearIndices.add(closeYearIdx);
      }
    });

    // Zatim za preostale nespajane mjesece ili godine (npr. "travanj i svibanj 2026" ili "svibanj 2025 i 2026")
    const remainingMonths = mentionedMonths.filter((_, idx) => !pairedMonths.has(idx));
    const remainingYears = mentionedYears.filter((_, idx) => !usedYearIndices.has(idx));

    if (remainingMonths.length > 0 && mentionedYears.length > 0) {
      // Ako ima spomenutih godina (npr. "travanj i svibanj 2026"), pridruži ih
      const targetYears = remainingYears.length > 0 ? remainingYears.map(x => x.year) : [mentionedYears[mentionedYears.length - 1].year];
      remainingMonths.forEach(mm => {
        targetYears.forEach(y => {
          const ym = `${y}-${pad2(mm.month)}`;
          pushPeriod({ key: `month:${ym}`, label: `${mm.label} ${y}.`, type: 'month', monthKey: ym });
        });
      });
      remainingYears.forEach((_, idx) => {
        const origIdx = mentionedYears.indexOf(remainingYears[idx]);
        if (origIdx !== -1) usedYearIndices.add(origIdx);
      });
    } else if (remainingMonths.length === 0 && remainingYears.length > 0 && mentionedMonths.length === 1) {
      // Slučaj "svibanj 2025 i 2026"
      const mm = mentionedMonths[0];
      remainingYears.forEach(yy => {
        const ym = `${yy.year}-${pad2(mm.month)}`;
        pushPeriod({ key: `month:${ym}`, label: `${mm.label} ${yy.year}.`, type: 'month', monthKey: ym });
        const origIdx = mentionedYears.indexOf(yy);
        if (origIdx !== -1) usedYearIndices.add(origIdx);
      });
    } else if (remainingMonths.length > 0) {
      // Mjesec spomenut BEZ godine (npr. "kakav mi je bio svibanj?" ili "prošli svibanj")
      remainingMonths.forEach(mm => {
        const candidates = sortedYearsDesc.filter(y => availableMonths.has(`${y}-${pad2(mm.month)}`));
        let chosenYear = candidates[0] || (mm.month > refMonth ? refYear - 1 : refYear);
        if (isPrevCue && candidates.length >= 2 && chosenYear === refYear) {
          chosenYear = candidates[1];
        }
        const ym = `${chosenYear}-${pad2(mm.month)}`;
        pushPeriod({ key: `month:${ym}`, label: `${mm.label} ${chosenYear}.`, type: 'month', monthKey: ym });
      });
    }
  }

  // 4. Godišnja doba (proljeće, ljeto, jesen, zima)
  const matchedSeasons = SEASON_PATTERNS.filter(sp => sp.regex.test(normQuery));
  if (matchedSeasons.length > 0) {
    const unusedYears = mentionedYears.filter((_, idx) => !usedYearIndices.has(idx));
    matchedSeasons.forEach(sp => {
      const targetYears = unusedYears.length > 0 ? unusedYears.map(x => x.year) : [];
      if (targetYears.length === 0) {
        // Pronađi najnoviju sezonu koja ima vožnje u bazi
        let resolvedYear = latestAvailableYear;
        if (sp.id === 'winter') {
          // Zima = Dec (Y-1) + Jan, Feb (Y). Pronađi najnoviju Y koja ima barem 1 zimski mjesec
          const candidate = sortedYearsDesc.find(y =>
            availableMonths.has(`${y}-01`) || availableMonths.has(`${y}-02`) || availableMonths.has(`${y - 1}-12`)
          );
          resolvedYear = candidate || latestAvailableYear;
          if (isPrevCue && resolvedYear === refYear && refMonth <= 3) {
            resolvedYear = resolvedYear - 1;
          }
        } else {
          const candidates = sortedYearsDesc.filter(y => sp.months.some(m => availableMonths.has(`${y}-${pad2(m)}`)));
          resolvedYear = candidates[0] || latestAvailableYear;
          if (isPrevCue && candidates.length >= 2 && resolvedYear === refYear) {
            resolvedYear = candidates[1];
          }
        }
        targetYears.push(resolvedYear);
      } else {
        unusedYears.forEach(yy => {
          const origIdx = mentionedYears.indexOf(yy);
          if (origIdx !== -1) usedYearIndices.add(origIdx);
        });
      }

      targetYears.forEach(y => {
        const monthKeys = sp.id === 'winter'
          ? [`${y - 1}-12`, `${y}-01`, `${y}-02`]
          : sp.months.map(m => `${y}-${pad2(m)}`);
        const label = sp.id === 'winter' ? `zima ${y - 1}/${y}.` : `${sp.label} ${y}.`;
        pushPeriod({
          key: `season:${sp.id}:${y}`,
          label,
          type: 'months',
          monthKeys
        });
      });
    });
  }

  // 5. Samostalne godine (npr. "kakva je bila 2025." ili "usporedi 2024 i 2025")
  mentionedYears.forEach((yy, idx) => {
    if (usedYearIndices.has(idx)) return;
    // Provjeri nije li dio datuma koji je već obrađen
    const alreadyInDayOrMonth = periods.some(p =>
      (p.type === 'range' && p.key.includes(String(yy.year))) ||
      (p.type === 'month' && p.monthKey.startsWith(String(yy.year)))
    );
    if (alreadyInDayOrMonth) return;
    pushPeriod({
      key: `year:${yy.year}`,
      label: `${yy.year}. godina`,
      type: 'year',
      year: yy.year
    });
  });

  // 6. Relativna razdoblja ("zadnja 3 mjeseca", "prošli mjesec", "ovaj mjesec", "zadnjih 8 tjedana", "prošle godine", "ove godine")
  const relMonthsMatch = normQuery.match(/\b(?:zadnj\w*|posljednj\w*|protekl\w*)\s+(\d{1,2})\s+mjesec\w*\b/);
  if (relMonthsMatch) {
    const n = Math.max(1, Math.min(36, Number(relMonthsMatch[1])));
    const startDate = addDaysUtc(refIsoDate, -(n * 30));
    pushPeriod({
      key: `rel_months:${n}`,
      label: `zadnjih ${n} mj. (${startDate} do ${refIsoDate})`,
      type: 'range',
      startDate,
      endDate: refIsoDate
    });
  }

  const relWeeksMatch = normQuery.match(/\b(?:zadnj\w*|posljednj\w*|protekl\w*)\s+(\d{1,2})\s+tjedn\w*\b/);
  if (relWeeksMatch) {
    const n = Math.max(1, Math.min(52, Number(relWeeksMatch[1])));
    const startDate = addDaysUtc(refIsoDate, -(n * 7));
    pushPeriod({
      key: `rel_weeks:${n}`,
      label: `zadnjih ${n} tj. (${startDate} do ${refIsoDate})`,
      type: 'range',
      startDate,
      endDate: refIsoDate
    });
  }

  if (/\bprosl(?:i|og|om|oga)\s+mjesec\w*\b/.test(normQuery)) {
    const prevY = refMonth === 1 ? refYear - 1 : refYear;
    const prevM = refMonth === 1 ? 12 : refMonth - 1;
    const ym = `${prevY}-${pad2(prevM)}`;
    pushPeriod({ key: `month:${ym}`, label: `prošli mjesec (${ym})`, type: 'month', monthKey: ym });
  }

  if (/\bov(?:aj|og|om|oga)\s+mjesec\w*\b/.test(normQuery)) {
    const ym = `${refYear}-${pad2(refMonth)}`;
    pushPeriod({ key: `month:${ym}`, label: `ovaj mjesec (${ym})`, type: 'month', monthKey: ym });
  }

  if (/\b(?:prosl\w*\s+godin\w*|lani\b|lanjsk\w*)\b/.test(normQuery) && periods.length === 0) {
    const py = refYear - 1;
    pushPeriod({ key: `year:${py}`, label: `prošla godina (${py}.)`, type: 'year', year: py });
  }

  if (/\b(?:ov[aeou]\s+godin\w*|ovogodisnj\w*|ove\s+sezon\w*)\b/.test(normQuery) && !periods.some(p => p.type === 'year' && p.year === refYear)) {
    pushPeriod({ key: `year:${refYear}`, label: `ova godina (${refYear}.)`, type: 'year', year: refYear });
  }

  return periods;
}

function workoutMatchesPeriod(r, period) {
  const d = (r.date || '').slice(0, 10);
  if (!d) return false;
  if (period.type === 'month') return d.startsWith(period.monthKey);
  if (period.type === 'months') return period.monthKeys.some(mk => d.startsWith(mk));
  if (period.type === 'year') return d.startsWith(String(period.year));
  if (period.type === 'range') return d >= period.startDate && d <= period.endDate;
  return false;
}

/**
 * Traži specifične nazive ruta, utrka ili treninga iz upita u cijelom CSV-u (uz hrvatski stemming + IDF zaštitu).
 */
function findEntityNameMatches(normQuery, allWorkouts) {
  const rawTokens = normQuery
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^-+|-+$/g, ''))
    .filter(t => t.length >= 4 && !/^\d+$/.test(t) && !QUERY_STOPWORDS.has(t));

  if (rawTokens.length === 0) return { matchedTokens: [], workouts: [] };

  const uniqueTokens = [...new Set(rawTokens)];
  const totalCount = Math.max(1, allWorkouts.length);

  // Pripremi normalizirane riječi po treningu
  const indexedWorkouts = allWorkouts.map(r => {
    const normName = normalizeSearchText(r.name || '');
    const words = normName.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
    return { r, normName, words };
  });

  const tokenMatchesMap = new Map();

  uniqueTokens.forEach(qTok => {
    const qStem = stemCroatianToken(qTok);
    const hits = [];

    for (const item of indexedWorkouts) {
      let matched = false;
      for (const w of item.words) {
        if (w === qTok) {
          matched = true;
          break;
        }
        // Stem prefix match (npr. "ucku" -> "uck" spaja "ucka"; "sljemenu" -> "sljemen" spaja "sljeme")
        if (qStem.length >= 4 && (w.startsWith(qStem) || qTok.startsWith(stemCroatianToken(w)) && stemCroatianToken(w).length >= 4)) {
          if (Math.abs(w.length - qTok.length) <= 4) {
            matched = true;
            break;
          }
        } else if (qStem.length === 3 && w.startsWith(qStem) && w.length <= 6 && Math.abs(w.length - qTok.length) <= 2) {
          matched = true;
          break;
        }
      }
      if (matched) hits.push(item.r);
    }

    // Automatski IDF filter: odbaci pregenerične riječi koje se javljaju u >35% svih treninga
    if (hits.length > 0 && hits.length / totalCount <= 0.35) {
      tokenMatchesMap.set(qTok, hits);
    }
  });

  if (tokenMatchesMap.size === 0) return { matchedTokens: [], workouts: [] };

  // Rangiraj treninge po broju pogođenih različitih pojmova iz pitanja
  const scoreMap = new Map();
  for (const [, list] of tokenMatchesMap.entries()) {
    list.forEach(r => {
      scoreMap.set(r, (scoreMap.get(r) || 0) + 1);
    });
  }

  const maxScore = Math.max(...scoreMap.values());
  const minRequiredScore = maxScore >= 2 ? 2 : 1;

  const matchedWorkouts = Array.from(scoreMap.entries())
    .filter(([, sc]) => sc >= minRequiredScore)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(b[0].date || '').localeCompare(String(a[0].date || ''));
    })
    .map(([r]) => r);

  return {
    matchedTokens: Array.from(tokenMatchesMap.keys()),
    workouts: matchedWorkouts
  };
}

/**
 * Odabire reprezentativan podskup ako je rezultat prevelik (> maxRows) kako bismo čuvali tokene i preciznost.
 */
function pickRepresentativeRows(list, maxRows = 45, preferSort = null) {
  if (list.length <= maxRows) return list;
  if (preferSort) {
    return [...list].sort(preferSort).slice(0, maxRows);
  }
  // Za velike vremenske raspone: uzmi 12 najnovijih + 12 najvećeg TSS-a + ravnomjerno raspoređene ostatke
  const selected = new Set();
  list.slice(0, 12).forEach(r => selected.add(r));
  [...list].sort((a, b) => (b.tss || 0) - (a.tss || 0)).slice(0, 12).forEach(r => selected.add(r));
  const remaining = list.filter(r => !selected.has(r));
  const slotsLeft = Math.max(0, maxRows - selected.size);
  if (slotsLeft > 0 && remaining.length > 0) {
    const step = remaining.length / slotsLeft;
    for (let i = 0; i < slotsLeft; i++) {
      const idx = Math.min(remaining.length - 1, Math.floor(i * step));
      selected.add(remaining[idx]);
    }
  }
  return Array.from(selected).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function formatSubsetSummaryLine(label, summary) {
  const parts = [
    `${summary.count} vožnji`,
    `${summary.hours}h`,
    `${summary.tss} TSS`,
    summary.climb > 0 ? `+${summary.climb}m uspona` : null,
    summary.distKm ? `${summary.distKm}km` : null,
    summary.avgFtp ? `FTP ${summary.minFtp === summary.maxFtp ? `${summary.avgFtp}W` : `${summary.minFtp}–${summary.maxFtp}W`}` : null,
    summary.avgNp ? `Prosj. NP:${summary.avgNp}W` : null,
    summary.peakCtl != null ? `Peak CTL:${summary.peakCtl}` : null,
    summary.minTsb != null ? `Min TSB:${summary.minTsb}` : null,
    summary.avgZ2Ef ? `Z2 EF:${summary.avgZ2Ef}${summary.avgZ2Dec != null ? ` (Dec:${summary.avgZ2Dec}%)` : ''}` : null,
    summary.avgSstEf ? `SST EF:${summary.avgSstEf}` : null,
    summary.avgRhr ? `Prosj. RHR:${summary.avgRhr}` : null
  ].filter(Boolean);
  return `- **${label}:** ${parts.join(' | ')}`;
}

/**
 * RAZINA 2: Pametna lokalna pretraga cjelokupne CSV baze na temelju pitanja korisnika (0 dodatnih API poziva).
 */
export function queryHistoricalWorkouts(allWorkouts = [], queryText = '', options = {}) {
  const {
    contextQuery = '',
    maxRows = 50,
    todayIso = new Date().toISOString().slice(0, 10)
  } = options;

  if (!Array.isArray(allWorkouts) || allWorkouts.length === 0) return null;
  const cleanQuery = String(queryText || '').trim();
  if (!cleanQuery) return null;

  const normQuery = normalizeSearchText(cleanQuery);
  const normContext = normalizeSearchText(contextQuery || '');

  // Odredi referentni datum (danas ako postoje nedavne vožnje unutar 60 dana, inače zadnja vožnja u bazi za arhive)
  const latestWorkoutDate = (allWorkouts[0]?.date || '').slice(0, 10);
  let refIsoDate = todayIso;
  if (latestWorkoutDate && /^\d{4}-\d{2}-\d{2}$/.test(latestWorkoutDate)) {
    const cutoff60 = addDaysUtc(todayIso, -60);
    if (latestWorkoutDate < cutoff60) {
      refIsoDate = latestWorkoutDate;
    }
  }

  // 1. Detektor vremenskih razdoblja
  let periods = extractTimePeriods(normQuery, allWorkouts, refIsoDate);

  // Follow-up rukovanje: ako korisnik pita "a godinu prije?" / "a prošli mjesec?" nakon pitanja s godinom u contextQuery
  if (periods.length === 0 && normContext && /\b(godin\w*\s+prije|ranij\w*\s+godin\w*|prethodn\w*\s+godin\w*)\b/.test(normQuery)) {
    const prevPeriods = extractTimePeriods(normContext, allWorkouts, refIsoDate);
    prevPeriods.forEach(p => {
      if (p.type === 'year') {
        periods.push({ key: `year:${p.year - 1}`, label: `${p.year - 1}. godina`, type: 'year', year: p.year - 1 });
      } else if (p.type === 'month') {
        const y = Number(p.monthKey.slice(0, 4)) - 1;
        const m = p.monthKey.slice(5, 7);
        periods.push({ key: `month:${y}-${m}`, label: `${y}-${m}`, type: 'month', monthKey: `${y}-${m}` });
      }
    });
  }

  // 2. Detektor specifičnih naziva treninga/ruta/utrka
  let entityMatch = findEntityNameMatches(normQuery, allWorkouts);

  // 3. Detektor ekstrema/rekorda
  const matchedRankings = RANKING_DETECTORS.filter(rd => rd.regex.test(normQuery));

  // 4. Detektor fizioloških zona i kategorija (aktivira se SAMO kad postoji povijesna/analitička namjera ili vremenski/rekordni filter!)
  const hasHistoricalIntent = HISTORICAL_INTENT_REGEX.test(normQuery) || periods.length > 0 || matchedRankings.length > 0;
  let matchedCategories = hasHistoricalIntent
    ? CATEGORY_DETECTORS.filter(cd => cd.queryRegex.test(normQuery))
    : [];

  // Ako je kratko potpitanje ("a godinu prije?", "a kako je bilo tada?") bez vlastite kategorije/naziva, naslijedi iz contextQuery
  if (normContext && cleanQuery.length < 95 && periods.length > 0 && entityMatch.workouts.length === 0 && matchedCategories.length === 0) {
    const ctxEntity = findEntityNameMatches(normContext, allWorkouts);
    if (ctxEntity.workouts.length > 0) entityMatch = ctxEntity;
    else matchedCategories = CATEGORY_DETECTORS.filter(cd => cd.queryRegex.test(normContext));
  }

  // Ako nijedan dubinski povijesni okidač nije aktiviran → 0 dodatnih tokena!
  if (
    periods.length === 0 &&
    entityMatch.workouts.length === 0 &&
    matchedRankings.length === 0 &&
    matchedCategories.length === 0
  ) {
    return null;
  }

  const sections = [];
  const reasons = [];
  let totalRowsSelected = 0;

  // Helper za provjeru kategorija
  const matchesCategories = (r) => {
    if (matchedCategories.length === 0) return true;
    const normName = normalizeSearchText(r.name || '');
    return matchedCategories.some(cd => cd.matchWorkout(r, normName));
  };

  // A) Specifični nazivi ruta/treninga (najviši prioritet ako postoje!)
  if (entityMatch.workouts.length > 0) {
    let subset = entityMatch.workouts;
    if (periods.length > 0) {
      const inPeriods = subset.filter(r => periods.some(p => workoutMatchesPeriod(r, p)));
      if (inPeriods.length > 0) subset = inPeriods;
    }
    const label = `Pretraga po nazivu (${entityMatch.matchedTokens.join(', ')})${periods.length > 0 ? ` · ${periods.map(p => p.label).join(' / ')}` : ''}`;
    const summary = summarizeWorkoutSubset(subset);
    const rows = pickRepresentativeRows(subset, Math.min(30, maxRows));
    sections.push({
      title: label,
      summaryLines: [formatSubsetSummaryLine(label, summary)],
      totalMatched: subset.length,
      rows
    });
    reasons.push(`naziv:${entityMatch.matchedTokens.join('+')}`);
    totalRowsSelected += rows.length;
  }

  // B) Eksplicitni rekordi / rang-liste (najduža, najteža, najveći uspon, najbolji EF...)
  if (matchedRankings.length > 0) {
    matchedRankings.forEach(rd => {
      let pool = allWorkouts.filter(rd.filter);
      if (periods.length > 0) {
        const scoped = pool.filter(r => periods.some(p => workoutMatchesPeriod(r, p)));
        if (scoped.length > 0) pool = scoped;
      }
      if (matchedCategories.length > 0) {
        const scopedCat = pool.filter(matchesCategories);
        if (scopedCat.length > 0) pool = scopedCat;
      }
      const topRows = [...pool].sort(rd.sort).slice(0, 10);
      if (topRows.length > 0) {
        const label = `${rd.label}${periods.length > 0 ? ` (${periods.map(p => p.label).join(', ')})` : ''}`;
        sections.push({
          title: label,
          summaryLines: [formatSubsetSummaryLine(`Top ${topRows.length} · ${label}`, summarizeWorkoutSubset(topRows))],
          totalMatched: pool.length,
          rows: topRows
        });
        reasons.push(`ranking:${rd.id}`);
        totalRowsSelected += topRows.length;
      }
    });
  }

  // C) Vremenska razdoblja (mjeseci, godine, godišnja doba, zadnjih N mj./tj.) — opcijski filtrirano po zoni/kategoriji!
  if (periods.length > 0 && entityMatch.workouts.length === 0) {
    const remainingBudget = Math.max(12, maxRows - totalRowsSelected);
    const perPeriodCap = Math.max(8, Math.floor(remainingBudget / periods.length));
    const catLabels = matchedCategories.map(c => c.label).join(' + ');
    const preferSort = matchedCategories.length === 1 ? matchedCategories[0].preferSort || null : null;

    periods.forEach(period => {
      const allInPeriod = allWorkouts.filter(r => workoutMatchesPeriod(r, period));
      if (allInPeriod.length === 0) {
        sections.push({
          title: period.label,
          summaryLines: [`- **${period.label}:** Nema zabilježenih vožnji u CSV/povijesnoj bazi za ovo razdoblje.`],
          totalMatched: 0,
          rows: []
        });
        reasons.push(`period:${period.key}(0)`);
        return;
      }

      const summaryLines = [formatSubsetSummaryLine(`Ukupno (${period.label})`, summarizeWorkoutSubset(allInPeriod))];

      // Ako je tražena cijela godina (ili razdoblje > 45 vožnji), dodaj točnu mjesečnu tablicu za to razdoblje!
      if (period.type === 'year' || allInPeriod.length > 45) {
        const subMonths = {};
        allInPeriod.forEach(r => {
          const ym = (r.date || '').slice(0, 7);
          if (!ym) return;
          if (!subMonths[ym]) subMonths[ym] = [];
          subMonths[ym].push(r);
        });
        Object.entries(subMonths)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([ym, list]) => {
            summaryLines.push(`  ${formatSubsetSummaryLine(ym, summarizeWorkoutSubset(list))}`);
          });
      }

      let targetRowsPool = allInPeriod;
      if (matchedCategories.length > 0) {
        const catSubset = allInPeriod.filter(matchesCategories);
        summaryLines.push(
          catSubset.length > 0
            ? formatSubsetSummaryLine(`Filtrirano [${catLabels}] (${period.label})`, summarizeWorkoutSubset(catSubset))
            : `- **Filtrirano [${catLabels}] (${period.label}):** 0 vožnji.`
        );
        if (catSubset.length > 0) targetRowsPool = catSubset;
      }

      const rows = pickRepresentativeRows(targetRowsPool, perPeriodCap, preferSort);
      sections.push({
        title: catLabels ? `${period.label} · ${catLabels}` : period.label,
        summaryLines,
        totalMatched: targetRowsPool.length,
        rows
      });
      reasons.push(`period:${period.key}(${allInPeriod.length})`);
      totalRowsSelected += rows.length;
    });

    // Ako korisnik uspoređuje prošli period + kategoriju s "današnjim/nedavnim" (npr. "SweetSpot iz zime s današnjim")
    const hasOnlyRelativeRecent = periods.every(p => p.key.startsWith('rel_'));
    if (matchedCategories.length > 0 && !hasOnlyRelativeRecent && (COMPARISON_TO_NOW_REGEX.test(normQuery) || (COMPARE_VERB_REGEX.test(normQuery) && periods.length === 1))) {
      const recentCutoff = addDaysUtc(refIsoDate, -60);
      let recentCatSubset = allWorkouts.filter(
        r => (r.date || '').slice(0, 10) >= recentCutoff && !periods.some(p => workoutMatchesPeriod(r, p)) && matchesCategories(r)
      );
      let recentLabel = `Nedavno (zadnjih 60 dana) · ${catLabels}`;
      if (recentCatSubset.length < 3) {
        const latestOutside = allWorkouts
          .filter(r => !periods.some(p => workoutMatchesPeriod(r, p)) && matchesCategories(r))
          .slice(0, 8);
        if (latestOutside.length > recentCatSubset.length) {
          recentCatSubset = latestOutside;
          recentLabel = `Najnoviji treninzi izvan traženog razdoblja · ${catLabels}`;
        }
      }
      if (recentCatSubset.length > 0) {
        const rows = recentCatSubset.slice(0, 8);
        sections.push({
          title: recentLabel,
          summaryLines: [formatSubsetSummaryLine(recentLabel, summarizeWorkoutSubset(recentCatSubset))],
          totalMatched: recentCatSubset.length,
          rows
        });
        reasons.push('compare:recent');
        totalRowsSelected += rows.length;
      }
    }
  }

  // D) Čista kategorija/zona bez vremenskog filtera i bez naziva (npr. "kako mi se kreće Z2 EF kroz povijest?", "pokaži moje utrke")
  if (periods.length === 0 && entityMatch.workouts.length === 0 && matchedRankings.length === 0 && matchedCategories.length > 0) {
    const remainingBudget = Math.max(15, maxRows - totalRowsSelected);
    const perCatCap = Math.max(12, Math.floor(remainingBudget / matchedCategories.length));

    matchedCategories.forEach(cd => {
      const subset = allWorkouts.filter(r => cd.matchWorkout(r, normalizeSearchText(r.name || '')));
      if (subset.length === 0) return;

      const summaryLines = [formatSubsetSummaryLine(`${cd.label} (cijela povijest)`, summarizeWorkoutSubset(subset))];

      // Dodaj godišnji trend za tu kategoriju ako se proteže kroz više godina
      const byYr = {};
      subset.forEach(r => {
        const y = (r.date || '').slice(0, 4);
        if (!/^\d{4}$/.test(y)) return;
        if (!byYr[y]) byYr[y] = [];
        byYr[y].push(r);
      });
      const yrKeys = Object.keys(byYr).sort();
      if (yrKeys.length >= 2) {
        yrKeys.forEach(y => {
          summaryLines.push(`  ${formatSubsetSummaryLine(`${cd.label} ${y}.`, summarizeWorkoutSubset(byYr[y]))}`);
        });
      }

      const rows = pickRepresentativeRows(subset, perCatCap, cd.preferSort || null);
      sections.push({
        title: cd.label,
        summaryLines,
        totalMatched: subset.length,
        rows
      });
      reasons.push(`cat:${cd.id}(${subset.length})`);
      totalRowsSelected += rows.length;
    });
  }

  if (sections.length === 0) return null;

  return {
    query: cleanQuery,
    reasons,
    totalRowsSelected,
    sections
  };
}

function formatQueryContextSection(queryResult) {
  if (!queryResult || !queryResult.sections?.length) return '';

  const lines = [];
  lines.push('\n## CILJANI IZVADAK IZ CIJELE CSV POVIJESTI (PAMETNA PRETRAGA ZA TRENUTNO PITANJE)');
  lines.push('*(Izračunato izravno iz cjelokupne baze sportaša — koristi ove točne brojke i zapise kao primarni dokaz u odgovoru.)*');

  queryResult.sections.forEach(sec => {
    lines.push(`\n### ${sec.title}`);
    sec.summaryLines.forEach(l => lines.push(l));
    if (sec.rows.length > 0) {
      if (sec.totalMatched > sec.rows.length) {
        lines.push(`Prikazano ${sec.rows.length} reprezentativnih/najrelevantnijih od ukupno ${sec.totalMatched} pronađenih vožnji (gornji zbrojevi obuhvaćaju SVIH ${sec.totalMatched}):`);
      }
      sec.rows.forEach(r => lines.push(formatHistoryRowCompact(r)));
    }
  });

  return lines.join('\n');
}

function formatPersonalRecordLine(label, r, metricText) {
  if (!r) return null;
  return `  * ${label}: ${metricText} — "${r.name || 'Trening'}" (${(r.date || '').slice(0, 10)})`;
}

/**
 * Gradi bogati povijesni i trenutni kontekst sportaša za Gemini prompt (Razina 1 + Razina 2).
 */
export async function buildAthleteContextPrompt({
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  targetActivity = null,
  userQuery = '',
  contextQuery = '',
  recentLimit = 40,
  userId = null,
  includeBaseHistory
}) {
  const resolvedIncludeBase = includeBaseHistory !== undefined
    ? includeBaseHistory
    : getHistoryOptions(userId).includeBaseHistory;

  const ftp = Number(athleteProfile?.ftp) || 270;
  const weight = Number(athleteProfile?.weight) || 74;
  const wkg = weight > 0 ? (ftp / weight).toFixed(2) : '-';

  const allWorkouts = await getMergedHistoricalWorkouts(liveWorkouts, ftp, { userId, includeBaseHistory: resolvedIncludeBase });
  const stats = computeHistoricalStats(allWorkouts);

  // Dohvati najsvježiji PMC (CTL / ATL / TSB) iz wellnessData ili zadnjeg povijesnog zapisa
  let pmcLine = '';
  const todayIso = new Date().toISOString().slice(0, 10);
  const wellnessDates = Object.keys(wellnessData || {}).filter(d => d <= todayIso).sort();
  if (wellnessDates.length > 0) {
    const latestWDate = wellnessDates[wellnessDates.length - 1];
    const w = wellnessData[latestWDate];
    const ctl = Math.round(Number(w.ctl || 0));
    const atl = Math.round(Number(w.atl || 0));
    const tsb = Math.round(Number(w.tsb ?? (ctl - atl)));
    pmcLine = `Trenutni PMC (${latestWDate}): Fitness (CTL) = ${ctl}, Fatigue (ATL) = ${atl}, Form (TSB) = ${tsb > 0 ? '+' + tsb : tsb}${w.restingHR ? `, Jutarnji puls (RHR) = ${w.restingHR} bpm` : ''}${w.hrv ? `, HRV = ${w.hrv}` : ''}`;
  } else if (stats?.latestRecord?.ctl != null) {
    const lr = stats.latestRecord;
    pmcLine = `Zadnji zabilježeni PMC (${(lr.date || '').slice(0, 10)}): Fitness (CTL) = ${lr.ctl}, Form (TSB) = ${lr.tsb > 0 ? '+' + lr.tsb : lr.tsb}${lr.rhr ? `, Jutarnji puls (RHR) = ${lr.rhr} bpm` : ''}`;
  }

  // Zadnjih 40 odrađenih treninga za dublji uvid u zadnjih ~6–10 tjedana
  const resolvedRecentLimit = Math.max(10, Math.min(60, Number(recentLimit) || 40));
  const recentCompleted = allWorkouts.slice(0, resolvedRecentLimit);

  // Nadolazeći planirani treninzi u kalendaru (idućih 10 dana / 7 stavki)
  const upcomingPlanned = Array.isArray(liveWorkouts)
    ? liveWorkouts
        .filter(w => !w.isCompleted && w.date >= todayIso)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(0, 7)
    : [];

  const lines = [];
  lines.push('## PROFIL SPORTAŠA I TRENUTNO STANJE');
  lines.push(`- Ime: ${athleteProfile?.username || 'Vozač'}`);
  lines.push(`- Trenutni FTP: ${ftp} W | Težina: ${weight} kg (${wkg} W/kg)`);
  lines.push(`- Max HR: ${athleteProfile?.maxHr || 180} bpm | LTHR (Prag pulsa): ${athleteProfile?.thresholdHr || 160} bpm`);
  if (athleteProfile?.hoursPerWeek) lines.push(`- Raspoloživo vrijeme za trening: ~${athleteProfile.hoursPerWeek} h/tjedno`);
  if (athleteProfile?.primaryGoal) lines.push(`- Primarni cilj: ${athleteProfile.primaryGoal}${athleteProfile.goalDate ? ` (Ciljni datum: ${athleteProfile.goalDate})` : ''}`);
  if (pmcLine) lines.push(`- ${pmcLine}`);

  if (stats && stats.totalWorkouts > 0) {
    lines.push('\n## POVIJEST TRENINGA SPORTAŠA (TOČNI AGREGATI IZ CIJELE CSV BAZE)');
    lines.push('*(Napomena: Svi zbrojevi i prosjeci ispod izračunati su točno u pregledniku nad cjelokupnom bazom — oslanjaj se na njih bez izmišljanja nepostojećih vožnji.)*');
    lines.push(`- Ukupno analiziranih treninga u bazi: ${stats.totalWorkouts} (${stats.totalHours} sati, ${stats.totalTss} TSS${stats.totalClimb > 0 ? `, +${stats.totalClimb}m uspona` : ''}, raspon ${stats.minDate} do ${stats.maxDate}, vršni FTP: ${stats.peakFtp} W).`);

    if (stats.benchmarks?.z2AvgEfAllTime) {
      lines.push('- Osobni fiziološki benchmarkovi sportaša:');
      lines.push(`  * Z2 Endurance (55–75% FTP): prosječni EF = ${stats.benchmarks.z2AvgEfAllTime ?? '-'}, nedavni Z2 EF = ${stats.benchmarks.z2AvgEfRecent ?? '-'}, prosječni Z2 Decoupling = ${stats.benchmarks.z2AvgDecoupling ?? '-'}%`);
      lines.push(`  * Tempo / Sweet Spot (76–93% FTP): prosječni EF = ${stats.benchmarks.sstAvgEf ?? '-'}, prosječni Decoupling = ${stats.benchmarks.sstAvgDecoupling ?? '-'}%`);
      lines.push(`  * Threshold / VO2max (>93% FTP): prosječni EF = ${stats.benchmarks.highIntAvgEf ?? '-'}`);
    }

    // Osobni rekordi i ekstremi (Razina 1)
    const rec = stats.records || {};
    const recordLines = [
      rec.longestRide ? formatPersonalRecordLine('Najduža vožnja', rec.longestRide, `${rec.longestRide.durMin} min (${(rec.longestRide.durMin / 60).toFixed(1)}h), ${rec.longestRide.tss ?? '-'} TSS`) : null,
      rec.highestTss ? formatPersonalRecordLine('Najveći TSS', rec.highestTss, `${rec.highestTss.tss} TSS (${rec.highestTss.durMin ?? '-'} min)`) : null,
      rec.biggestClimb ? formatPersonalRecordLine('Najveći uspon', rec.biggestClimb, `+${rec.biggestClimb.climb}m (${rec.biggestClimb.durMin ?? '-'} min)`) : null,
      rec.highestNp45 ? formatPersonalRecordLine('Najviši NP (≥45 min)', rec.highestNp45, `NP ${rec.highestNp45.np}W (${rec.highestNp45.durMin} min, IF ${rec.highestNp45.ifPct ?? '-'}%)`) : null,
      rec.highestNp20 && rec.highestNp20 !== rec.highestNp45 ? formatPersonalRecordLine('Najviši NP (≥20 min)', rec.highestNp20, `NP ${rec.highestNp20.np}W (${rec.highestNp20.durMin} min)`) : null,
      rec.peakECP ? formatPersonalRecordLine('Vršni eCP', rec.peakECP, `${rec.peakECP.eCP} W`) : null,
      rec.peakPmax ? formatPersonalRecordLine('Vršni Sprint (pMax)', rec.peakPmax, `${rec.peakPmax.pMax} W`) : null,
      rec.highestWorkAboveFtp ? formatPersonalRecordLine('Najveći rad > FTP', rec.highestWorkAboveFtp, `${rec.highestWorkAboveFtp.wFtpKj} kJ`) : null,
      rec.peakCtl ? formatPersonalRecordLine('Vršni Fitness (CTL)', rec.peakCtl, `CTL ${rec.peakCtl.ctl}`) : null,
      rec.bestZ2Ef ? formatPersonalRecordLine('Najbolji Z2 EF (≥45m)', rec.bestZ2Ef, `EF ${rec.bestZ2Ef.ef} (NP ${rec.bestZ2Ef.np}W @ ${rec.bestZ2Ef.avgHr}bpm)`) : null
    ].filter(Boolean);

    if (recordLines.length > 0) {
      lines.push('- Osobni rekordi i ekstremi (cijela povijest):');
      recordLines.forEach(rl => lines.push(rl));
    }

    // Godišnji sažetak
    if (stats.yearlyStats && stats.yearlyStats.length > 0) {
      lines.push('- Sažetak po sezonama:');
      stats.yearlyStats.forEach(y => {
        lines.push(
          `  * ${y.year}: ${y.count} vožnji, ${y.hours}h, ${y.tss} TSS${y.climb > 0 ? `, +${y.climb}m` : ''} | FTP ${y.minFtp ?? '-'}-${y.maxFtp ?? '-'}W (prosj. ${y.avgFtp ?? '-'}W)${y.peakCtl ? ` | Peak CTL:${y.peakCtl}` : ''} | Z2 EF:${y.avgZ2Ef ?? '-'}${y.avgZ2Dec != null ? ` (Dec:${y.avgZ2Dec}%)` : ''}${y.avgWt ? ` | Tež:${y.avgWt}kg` : ''}`
        );
      });
    }

    // Mjesečni pregled (zadnjih 12 aktivnih mjeseci)
    if (stats.recentMonthlyStats && stats.recentMonthlyStats.length > 0) {
      lines.push(`- Mjesečni pregled (zadnjih ${stats.recentMonthlyStats.length} aktivnih mjeseci):`);
      stats.recentMonthlyStats.forEach(m => {
        lines.push(
          `  * ${m.month}: ${m.count} vožnji, ${m.hours}h, ${m.tss} TSS${m.climb > 0 ? `, +${m.climb}m` : ''} | FTP:${m.avgFtp ?? '-'}W${m.peakCtl ? ` | Peak CTL:${m.peakCtl}` : ''}${m.minTsb != null ? ` (min TSB:${m.minTsb})` : ''} | Z2 EF:${m.avgZ2Ef ?? '-'}${m.avgZ2Dec != null ? ` (Dec:${m.avgZ2Dec}%)` : ''}${m.avgRhr ? ` | RHR:${m.avgRhr}` : ''} | Mix Z1-2/Mod/HI:${m.mix.low}/${m.mix.mod}/${m.mix.hi}`
        );
      });
    }

    // Tjedni pregled (zadnjih 10 aktivnih tjedana)
    if (stats.weeklyStats && stats.weeklyStats.length > 0) {
      lines.push(`- Tjedni pregled (zadnjih ${stats.weeklyStats.length} aktivnih tjedana):`);
      stats.weeklyStats.forEach(w => {
        lines.push(
          `  * ${w.weekStart}..${w.weekEnd.slice(5)}: ${w.count} vožnji, ${w.hours}h, ${w.tss} TSS${w.climb > 0 ? `, +${w.climb}m` : ''}${w.endCtl != null ? ` | CTL:${w.endCtl}` : ''}${w.minTsb != null ? ` (min TSB:${w.minTsb})` : ''}${w.avgZ2Ef ? ` | Z2 EF:${w.avgZ2Ef}` : ''}${w.avgRhr ? ` | RHR:${w.avgRhr}` : ''} | Mix:${w.mix.low}/${w.mix.mod}/${w.mix.hi}`
        );
      });
    }
  } else {
    lines.push('\n## POVIJEST TRENINGA');
    lines.push('- Sportaš nema učitanu višegodišnju povijest vožnji. Sve analize, savjete i planove temelji na njegovom trenutnom profilu, unesenom FTP-u, zadanim ciljevima i znanstvenim načelima sportske fiziologije.');
  }

  if (recentCompleted.length > 0) {
    lines.push(`\n## NEDAVNI TRENINZI (ZADNJIH ${recentCompleted.length} AKTIVNOSTI)`);
    recentCompleted.forEach(r => lines.push(formatHistoryRowCompact(r)));
  }

  if (upcomingPlanned.length > 0) {
    lines.push('\n## NADOLAZEĆI PLANIRANI TRENINZI U KALENDARU');
    upcomingPlanned.forEach(p => {
      lines.push(`- ${p.date} | "${p.title}" | Planirano: ${p.duration || '-'}min | TSS: ${p.tss || '-'} | Kategorija: ${p.category || '-'}`);
    });
  }

  // RAZINA 2: Ciljani izvadak iz cijele CSV baze na temelju pitanja korisnika
  if (userQuery && allWorkouts.length > 0) {
    const queryResult = queryHistoricalWorkouts(allWorkouts, userQuery, {
      contextQuery,
      todayIso
    });
    if (queryResult) {
      lines.push(formatQueryContextSection(queryResult));
    }
  }

  if (targetActivity) {
    const similar = await findSimilarHistoricalWorkouts(targetActivity, liveWorkouts, 8, { userId, includeBaseHistory: resolvedIncludeBase });
    if (similar.length > 0) {
      lines.push('\n## USPOREDBE ZA OVAJ TRENING (ISTI NAZIV ILI ZONA INTENZITETA I TRAJANJA)');
      similar.forEach(s => lines.push(formatHistoryRowCompact(s)));
    }
  }

  return lines.join('\n');
}

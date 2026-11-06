/**
 * ErgVibe Longitudinal History Service
 * Spaja povijesne baze treninga s novim CSV uvozima i live aktivnostima iz aplikacije.
 */

const STORAGE_KEY_EXTRA_HISTORY = 'ergvibe_extra_historical_workouts_v1';

let cachedBaseHistory = null;

/**
 * Lazy-load ugrađene povijesne baze (Vite će je odvojiti u zaseban chunk).
 */
export async function loadBaseHistory() {
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
  // Za goste ugrađena arhiva vlasnika uopće ne postoji
  if (userId === 'guest') {
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
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur.replace(/^"|"$/g, '').trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.replace(/^"|"$/g, '').trim());
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
    throw new Error('CSV datoteka je prazna ili neispravna.');
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV datoteka ne sadrži zapise o treninzima.');
  }

  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.replace(/^"|"$/g, '').trim());
  if (!headers.includes('Date') || !headers.includes('Name')) {
    throw new Error('Nepoznat CSV format. Koristi standardni Intervals.icu CSV izvoz aktivnosti.');
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

    let elapsedSec = toNum(raw['Elapsed time'], 0);
    if (elapsedSec !== null && (elapsedSec < 0 || elapsedSec > 86400)) elapsedSec = null;
    const workAboveFtpJ = toNum(raw['Work >FTP'], 0);

    const rec = {
      id: idKey,
      type: raw.Type || 'Ride',
      date: raw.Date,
      name: raw.Name || 'Trening',
      durMin: elapsedSec ? Math.round(elapsedSec / 60) : null,
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
      wFtpKj: workAboveFtpJ !== null ? Math.round((workAboveFtpJ / 1000) * 10) / 10 : null
    };

    const compact = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v !== null && v !== '') compact[k] = v;
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
  const ftp = Number(w.ftp_used || w.icu_ftp || fallbackFtp) || 270;
  const durMin = Number(w.duration) || (w.duration_seconds ? Math.round(w.duration_seconds / 60) : null);
  const tss = Number(w.tss ?? w.icu_training_load ?? 0) || null;
  const ifPct = np && ftp ? Math.round((np / ftp) * 1000) / 10 : (w.if_factor ? Math.round(Number(w.if_factor) * 1000) / 10 : null);
  const ef = np && avgHr ? Math.round((np / avgHr) * 100) / 100 : null;
  const vi = np && avgPwr ? Math.round((np / avgPwr) * 100) / 100 : null;

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

function cleanWorkoutBaseName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/\s*-\s*trainerroad/gi, '')
    .replace(/\s*-\s*zwift/gi, '')
    .replace(/[^a-z0-9čćžšđ\s+-]/gi, '')
    .trim();
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

  const combined = [...sameNameMatches.slice(0, 4), ...metricMatches].slice(0, limit);
  return combined;
}

/**
 * Računa višegodišnju statistiku i osobne benchmarke po zonama za UI i AI Trenera.
 */
export async function getHistoricalDashboardStats(liveWorkouts = [], options = {}) {
  const all = await getMergedHistoricalWorkouts(liveWorkouts, 270, options);
  if (!all.length) return null;

  const byYearMap = {};
  let totalTss = 0;
  let totalMinutes = 0;
  let peakFtp = 0;
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  const z2EfList = [];
  const z2DecList = [];
  const sstEfList = [];
  const sstDecList = [];
  const vo2EfList = [];

  all.forEach(r => {
    const dateStr = (r.date || '').slice(0, 10);
    if (dateStr && dateStr < minDate) minDate = dateStr;
    if (dateStr && dateStr > maxDate) maxDate = dateStr;

    const y = dateStr ? dateStr.slice(0, 4) : 'Ostalo';
    if (!byYearMap[y]) {
      byYearMap[y] = { year: y, count: 0, tss: 0, minutes: 0, ftps: [], z2Efs: [], efs: [] };
    }

    const yr = byYearMap[y];
    yr.count += 1;
    if (r.tss > 0) {
      yr.tss += r.tss;
      totalTss += r.tss;
    }
    if (r.durMin > 0 && r.durMin < 1440) {
      yr.minutes += r.durMin;
      totalMinutes += r.durMin;
    }
    if (r.ftp > 0) {
      yr.ftps.push(r.ftp);
      if (r.ftp > peakFtp) peakFtp = r.ftp;
    }
    if (r.ef > 0.5 && r.ef < 3.0) {
      yr.efs.push(r.ef);
    }

    // Klasifikacija za benchmarke (samo treninzi >= 35 min s validnim EF)
    if (r.durMin >= 35 && r.ifPct > 0 && r.ef > 0.8 && r.ef < 2.8) {
      if (r.ifPct >= 55 && r.ifPct <= 75) {
        z2EfList.push({ date: dateStr, ef: r.ef });
        yr.z2Efs.push(r.ef);
        if (r.dec != null && r.dec > -15 && r.dec < 25) z2DecList.push(r.dec);
      } else if (r.ifPct > 75 && r.ifPct <= 93) {
        sstEfList.push(r.ef);
        if (r.dec != null && r.dec > -15 && r.dec < 25) sstDecList.push(r.dec);
      } else if (r.ifPct > 93) {
        vo2EfList.push(r.ef);
      }
    }
  });

  const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

  const yearlyStats = Object.values(byYearMap)
    .filter(y => /^\d{4}$/.test(y.year))
    .sort((a, b) => a.year.localeCompare(b.year))
    .map(y => ({
      year: y.year,
      count: y.count,
      hours: Math.round(y.minutes / 60),
      tss: Math.round(y.tss),
      minFtp: y.ftps.length ? Math.min(...y.ftps) : null,
      maxFtp: y.ftps.length ? Math.max(...y.ftps) : null,
      avgFtp: y.ftps.length ? Math.round(avg(y.ftps)) : null,
      avgZ2Ef: y.z2Efs.length ? Number(avg(y.z2Efs).toFixed(2)) : null,
      avgEf: y.efs.length ? Number(avg(y.efs).toFixed(2)) : null
    }));

  const recentZ2Efs = z2EfList.slice(0, 25).map(x => x.ef);

  return {
    totalWorkouts: all.length,
    totalHours: Math.round(totalMinutes / 60),
    totalTss: Math.round(totalTss),
    minDate,
    maxDate,
    peakFtp,
    latestRecord: all[0] || null,
    yearlyStats,
    benchmarks: {
      z2AvgEfAllTime: z2EfList.length ? Number(avg(z2EfList.map(x => x.ef)).toFixed(2)) : null,
      z2AvgEfRecent: recentZ2Efs.length ? Number(avg(recentZ2Efs).toFixed(2)) : null,
      z2AvgDecoupling: z2DecList.length ? Number(avg(z2DecList).toFixed(1)) : null,
      sstAvgEf: sstEfList.length ? Number(avg(sstEfList).toFixed(2)) : null,
      sstAvgDecoupling: sstDecList.length ? Number(avg(sstDecList).toFixed(1)) : null,
      highIntAvgEf: vo2EfList.length ? Number(avg(vo2EfList).toFixed(2)) : null
    }
  };
}

function formatHistoryRowCompact(r) {
  const parts = [
    `${(r.date || '').slice(0, 10)}`,
    `"${r.name}"`,
    r.durMin ? `${r.durMin}min` : null,
    r.np ? `NP:${r.np}W` : (r.avgPwr ? `Avg:${r.avgPwr}W` : null),
    r.ifPct ? `IF:${r.ifPct}%` : null,
    r.tss != null ? `TSS:${r.tss}` : null,
    r.avgHr ? `HR:${r.avgHr}bpm` : null,
    r.ef ? `EF:${r.ef}` : null,
    r.dec != null ? `Dec:${r.dec}%` : null,
    r.vi ? `VI:${r.vi}` : null,
    r.ctl != null ? `CTL:${r.ctl}` : null,
    r.tsb != null ? `TSB:${r.tsb}` : null
  ].filter(Boolean);
  return `- ${parts.join(' | ')}`;
}

/**
 * Gradi bogati povijesni i trenutni kontekst sportaša za Gemini prompt.
 */
export async function buildAthleteContextPrompt({
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  targetActivity = null,
  userId = null,
  includeBaseHistory
}) {
  const resolvedIncludeBase = includeBaseHistory !== undefined
    ? includeBaseHistory
    : getHistoryOptions(userId).includeBaseHistory;

  const ftp = Number(athleteProfile?.ftp) || 270;
  const weight = Number(athleteProfile?.weight) || 74;
  const wkg = weight > 0 ? (ftp / weight).toFixed(2) : '-';

  const stats = await getHistoricalDashboardStats(liveWorkouts, { userId, includeBaseHistory: resolvedIncludeBase });
  const allWorkouts = await getMergedHistoricalWorkouts(liveWorkouts, ftp, { userId, includeBaseHistory: resolvedIncludeBase });

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

  // Zadnjih 16 odrađenih treninga za uvid u akutni blok
  const recentCompleted = allWorkouts.slice(0, 16);

  // Nadolazeći planirani treninzi u kalendaru (idućih 10 dana)
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
    lines.push('\n## POVIJEST TRENINGA SPORTAŠA');
    lines.push(`- Ukupno analiziranih treninga u bazi: ${stats.totalWorkouts} (${stats.totalHours} sati, ${stats.totalTss} TSS, raspon ${stats.minDate} do ${stats.maxDate}, vršni FTP: ${stats.peakFtp} W).`);
    if (stats.benchmarks?.z2AvgEfAllTime) {
      lines.push('- Osobni fiziološki benchmarkovi sportaša:');
      lines.push(`  * Z2 Endurance (55–75% FTP): prosječni EF = ${stats.benchmarks.z2AvgEfAllTime ?? '-'}, nedavni Z2 EF = ${stats.benchmarks.z2AvgEfRecent ?? '-'}, prosječni Z2 Decoupling = ${stats.benchmarks.z2AvgDecoupling ?? '-'}%`);
      lines.push(`  * Tempo / Sweet Spot (76–93% FTP): prosječni EF = ${stats.benchmarks.sstAvgEf ?? '-'}, prosječni Decoupling = ${stats.benchmarks.sstAvgDecoupling ?? '-'}%`);
      lines.push(`  * Threshold / VO2max (>93% FTP): prosječni EF = ${stats.benchmarks.highIntAvgEf ?? '-'}`);
    }
    if (stats.yearlyStats && stats.yearlyStats.length > 0) {
      lines.push('- Sažetak po sezonama:');
      stats.yearlyStats.forEach(y => {
        lines.push(`  * ${y.year}: ${y.count} vožnji, ${y.hours}h, ${y.tss} TSS | FTP ${y.minFtp}-${y.maxFtp}W (prosjek ${y.avgFtp}W) | Z2 EF: ${y.avgZ2Ef ?? '-'}`);
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

  if (targetActivity) {
    const similar = await findSimilarHistoricalWorkouts(targetActivity, liveWorkouts, 8, { userId, includeBaseHistory: resolvedIncludeBase });
    if (similar.length > 0) {
      lines.push('\n## USPOREDBE ZA OVAJ TRENING (ISTI NAZIV ILI ZONA INTENZITETA I TRAJANJA)');
      similar.forEach(s => lines.push(formatHistoryRowCompact(s)));
    }
  }

  return lines.join('\n');
}

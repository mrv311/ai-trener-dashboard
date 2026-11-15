/**
 * Pomoćne funkcije i konfiguracije za AI Planer Treninga i kalendarske proračune.
 */

export const WEEKDAY_DEFS = [
  { key: 'mon', index: 0, jsDay: 1, short: 'PON', name: 'Ponedjeljak' },
  { key: 'tue', index: 1, jsDay: 2, short: 'UTO', name: 'Utorak' },
  { key: 'wed', index: 2, jsDay: 3, short: 'SRI', name: 'Srijeda' },
  { key: 'thu', index: 3, jsDay: 4, short: 'ČET', name: 'Četvrtak' },
  { key: 'fri', index: 4, jsDay: 5, short: 'PET', name: 'Petak' },
  { key: 'sat', index: 5, jsDay: 6, short: 'SUB', name: 'Subota' },
  { key: 'sun', index: 6, jsDay: 0, short: 'NED', name: 'Nedjelja' }
];

export const DURATION_TIERS = [
  { id: 'short', label: '45m', minutes: 45, desc: 'Brzi / Trenažer' },
  { id: 'standard', label: '60m', minutes: 60, desc: 'Standardni trenažer' },
  { id: 'medium', label: '90m', minutes: 90, desc: 'Srednji / Prag' },
  { id: 'long', label: '2h+', minutes: 135, desc: 'Duža vožnja' },
  { id: 'epic', label: '3h+', minutes: 200, desc: 'Duga Z2 / Vikend' }
];

export const DEFAULT_WEEKLY_SCHEDULE = {
  mon: { enabled: false, minutes: 60 },
  tue: { enabled: true, minutes: 60 },
  wed: { enabled: false, minutes: 60 },
  thu: { enabled: true, minutes: 60 },
  fri: { enabled: false, minutes: 45 },
  sat: { enabled: true, minutes: 135 },
  sun: { enabled: true, minutes: 90 }
};

export const EVENT_TYPE_OPTIONS = [
  { id: 'Gran Fondo / Cestovni maraton', label: 'Gran Fondo / Maraton', desc: 'Duga izdržljivost i konstantni usponi' },
  { id: 'Cestovna utrka / Kriterij', label: 'Cestovna utrka', desc: 'Visoki skokovi snage, VO2max i napadi' },
  { id: 'Gravel / MTB maraton', label: 'Gravel / MTB maraton', desc: 'Promjenjiv ritam, ponovljeni prag i snaga' },
  { id: 'Brdski uspon / Sportive', label: 'Brdski uspon / Alpe', desc: 'Omjer W/kg i dugi napori na pragu' },
  { id: 'Kronometar (TT)', label: 'Kronometar (TT)', desc: 'Stabilna snaga na FTP-u i izdržljivost praga' }
];

export const FITNESS_PRESET_GOALS = [
  { id: 'Podizanje FTP-a i Sweet Spot izdržljivosti', label: 'Podizanje FTP-a', desc: 'Sweet Spot i Threshold progresija' },
  { id: 'Z2 Aerobna baza i izdržljivost', label: 'Aerobna baza (Z2)', desc: 'Mitohondrijska gustoća i efikasnost' },
  { id: 'VO2 Max i probijanje platoa', label: 'VO2 Max & Snaga', desc: 'Kratki visoko-intenzivni intervali' },
  { id: 'Održavanje kondicije uz nizak umor', label: 'Održavanje forme', desc: 'Fleksibilno uz manji tjedni stres' }
];

export const PHASE_META = {
  base: { label: 'Baza', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', bar: 'bg-sky-400' },
  build: { label: 'Build', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', bar: 'bg-amber-400' },
  peak: { label: 'Peak', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', bar: 'bg-rose-400' },
  taper: { label: 'Taper', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', bar: 'bg-emerald-400' },
  race: { label: 'Event', cls: 'bg-volt-400/15 text-volt-400 border-volt-400/35', bar: 'bg-volt-400' }
};

export function parseIsoLocal(dateIso) {
  if (!dateIso || typeof dateIso !== 'string') return new Date();
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

export function formatIsoLocal(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getLocalIsoToday() {
  return formatIsoLocal(new Date());
}

export function addDaysIso(baseDateIso, daysToAdd) {
  const dt = parseIsoLocal(baseDateIso);
  dt.setDate(dt.getDate() + Number(daysToAdd || 0));
  return formatIsoLocal(dt);
}

export function diffDaysIso(fromIso, toIso) {
  const a = parseIsoLocal(fromIso);
  const b = parseIsoLocal(toIso);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Vraća indeks dana u tjednu (0 = PON ... 6 = NED).
 */
export function getWeekdayIndexFromIso(dateIso) {
  const dt = parseIsoLocal(dateIso);
  const jsDay = dt.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Vraća ponedjeljak tjedna za zadani datum.
 */
export function getMondayOfWeekIso(dateIso) {
  const dt = parseIsoLocal(dateIso);
  const offset = getWeekdayIndexFromIso(dateIso);
  dt.setDate(dt.getDate() - offset);
  return formatIsoLocal(dt);
}

/**
 * Vraća sljedeći ponedjeljak ako je danas nedjelja ili nakon ponedjeljka,
 * ili ponedjeljak tekućeg tjedna.
 */
export function getDefaultPlanStartDateIso() {
  const todayIso = getLocalIsoToday();
  const idx = getWeekdayIndexFromIso(todayIso);
  // Ako je petak/subota/nedjelja, predloži sljedeći ponedjeljak; inače sutra
  if (idx >= 4) {
    return addDaysIso(todayIso, 7 - idx);
  }
  return addDaysIso(todayIso, 1);
}

/**
 * Izračunava broj kalendarskih tjedana od tjedna početka do tjedna eventa (uključivo).
 */
export function calculatePlanWeeksCount(startDateIso, eventDateIso) {
  if (!startDateIso || !eventDateIso) return 4;
  const startMon = getMondayOfWeekIso(startDateIso);
  const eventMon = getMondayOfWeekIso(eventDateIso);
  const daysBetween = diffDaysIso(startMon, eventMon);
  const weeks = Math.floor(daysBetween / 7) + 1;
  return Math.max(1, Math.min(40, weeks));
}

/**
 * Dijeli ukupan broj tjedana u blokove po 4 tjedna (npr. 1-4, 5-8, ...).
 */
export function chunkWeeksIntoBlocks(totalWeeks, blockSize = 4) {
  const safeTotal = Math.max(1, Math.min(40, Number(totalWeeks) || 4));
  const blocks = [];
  let start = 1;
  let idx = 1;
  while (start <= safeTotal) {
    const end = Math.min(safeTotal, start + blockSize - 1);
    blocks.push({
      blockIndex: idx,
      key: `${start}-${end}`,
      weekFrom: start,
      weekTo: end,
      weekCount: end - start + 1
    });
    start = end + 1;
    idx++;
  }
  return blocks;
}

/**
 * Sažima tjedni raspored u statistike i tekst za AI prompt.
 */
export function summarizeWeeklySchedule(weeklySchedule = DEFAULT_WEEKLY_SCHEDULE) {
  const activeDays = [];
  const promptLines = [];
  let totalMinutes = 0;

  WEEKDAY_DEFS.forEach(day => {
    const cfg = weeklySchedule?.[day.key];
    if (cfg?.enabled) {
      const mins = Math.max(30, Number(cfg.minutes) || 60);
      totalMinutes += mins;
      activeDays.push({ ...day, minutes: mins });
      const hint = mins >= 120 ? 'duga vožnja / vani ili duži Z2' : (mins <= 50 ? 'kratki intenzivni / trenažer' : 'trenažer / standardni trening');
      promptLines.push(`- ${day.name} (${day.key}): TRENING max ${mins} min (${hint})`);
    } else {
      promptLines.push(`- ${day.name} (${day.key}): DAN ODMORA (ne zakazuj trening!)`);
    }
  });

  return {
    activeDays,
    workoutsPerWeek: activeDays.length,
    hoursPerWeek: Number((totalMinutes / 60).toFixed(1)),
    totalMinutes,
    promptText: promptLines.join('\n')
  };
}

export function formatShortHrDate(dateIso) {
  if (!dateIso) return '';
  const dt = parseIsoLocal(dateIso);
  const months = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
  return `${dt.getDate()}. ${months[dt.getMonth()]}`;
}

export function getPlanStorageKey(userId) {
  return `ergvibe_ai_macro_plan_v2_${userId || 'guest'}`;
}

export function loadSavedPlan(userId) {
  try {
    const raw = localStorage.getItem(getPlanStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.blueprint ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSavedPlan(userId, expectedPlanId = null) {
  try {
    const key = getPlanStorageKey(userId);
    if (expectedPlanId) {
      const existing = loadSavedPlan(userId);
      if (existing?.blueprint?.planId && existing.blueprint.planId !== expectedPlanId) {
        return false;
      }
    }
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gradi bogati AI prompt za analizu trenutnog ili sinkroniziranog plana treninga.
 */
export function buildPlanAnalysisPrompt({
  planTitle,
  methodology,
  totalWeeks,
  startDate,
  endDate,
  goalTitle,
  eventDate,
  summary,
  workoutsInCalendar = []
}) {
  const sorted = [...workoutsInCalendar].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const completed = sorted.filter(w => w.isCompleted);
  const upcoming = sorted.filter(w => !w.isCompleted);
  const totalPlannedTss = sorted.reduce((acc, w) => acc + (Number(w.plannedTss || w.tss) || 0), 0);

  const previewLines = sorted.slice(0, 28).map(w => {
    const status = w.isCompleted ? 'ODRAĐENO' : (w.statusColor === 'red-missed' ? 'PROPUŠTENO' : 'PLANIRANO');
    const dur = Math.round(Number(w.plannedDuration || w.duration) || 0);
    const tss = Math.round(Number(w.plannedTss || w.tss) || 0);
    return `- ${w.date} [${status}]: ${w.title} (${dur}m, ~${tss} TSS, kat: ${w.category || 'WORKOUT'})`;
  });

  return [
    `Molim te napravi detaljnu trenersku analizu mog plana treninga "${planTitle || 'AI Plan Treninga'}".`,
    methodology ? `• Metodologija: ${methodology}` : null,
    totalWeeks ? `• Trajanje makrociklusa: ${totalWeeks} tjedana` : null,
    startDate ? `• Početak plana u kalendaru: ${startDate}${endDate ? ` do ${endDate}` : ''}` : null,
    goalTitle ? `• Cilj: ${goalTitle}${eventDate ? ` (${eventDate})` : ''}` : null,
    summary ? `• Sažetak plana: ${summary}` : null,
    sorted.length > 0
      ? `• Stavke u kalendaru: ${sorted.length} treninga (${completed.length} odrađeno, ${upcoming.length} nadolazećih, ukupno ~${Math.round(totalPlannedTss)} TSS)`
      : null,
    previewLines.length > 0
      ? `\nRaspored treninga:\n${previewLines.join('\n')}${sorted.length > 28 ? `\n... i još ${sorted.length - 28} treninga` : ''}`
      : null,
    '\nOcijeni konkretno:',
    '1. Je li progresija opterećenja (TSS / volumen) i omjer intenziteta i Z2 oporavka optimalan za moj trenutni CTL/ATL/TSB i cilj?',
    '2. Ima li u planu nerealnih, preteških ili loše raspoređenih treninga za pametni trenažer?',
    '3. Što bi konkretno prilagodio ili poboljšao u idućim treninzima / blokovima?'
  ].filter(Boolean).join('\n');
}

/**
 * Grupira sinkronizirane blokove iz registra planova po planu i određuje prvi dan
 * na kalendaru za prikaz interaktivne oznake plana.
 */
export function buildCalendarPlanMarkers({ planRegistry = [], savedPlan = null, workouts = [] }) {
  if (!Array.isArray(planRegistry) || planRegistry.length === 0) return [];

  const groups = new Map();
  planRegistry.forEach(entry => {
    if (!entry?.blockKey) return;
    const key = entry.planId || entry.blockKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  const markers = [];

  groups.forEach((rawEntries, groupKey) => {
    const entries = [...rawEntries].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const earliestEntry = entries[0];
    const entryPlanId = earliestEntry.planId || null;

    const blockKeys = entries.map(e => e.blockKey);
    const blockKeySet = new Set(blockKeys);
    const localIdSet = new Set();
    const intervalsIdSet = new Set();

    entries.forEach(e => {
      (e.localIds || []).forEach(id => localIdSet.add(String(id)));
      (e.intervalsIds || []).forEach(id => intervalsIdSet.add(String(id)));
    });

    const startDates = entries.map(e => e.startDate).filter(Boolean).sort();
    const endDates = entries.map(e => e.endDate).filter(Boolean).sort();
    const earliestBlockStart = startDates[0] || '';
    const latestBlockEnd = endDates[endDates.length - 1] || earliestBlockStart;

    const matchingWorkouts = (workouts || []).filter(w => {
      if (!w) return false;
      const wId = String(w.id || '');
      const rawLocalId = wId.replace(/^local-/, '');
      const rawEventLocalId = String(w.eventId || '').replace(/^local-/, '');
      const rawEvId = String(w.eventId || wId.replace(/^ev-/, ''));
      return (
        (entryPlanId && w.planId === entryPlanId) ||
        (w.blockKey && blockKeySet.has(w.blockKey)) ||
        (wId.startsWith('local-') && localIdSet.has(rawLocalId)) ||
        (String(w.eventId || '').startsWith('local-') && localIdSet.has(rawEventLocalId)) ||
        intervalsIdSet.has(rawEvId)
      );
    });

    const nonRaceWorkouts = matchingWorkouts
      .filter(w => !['RACE_A', 'RACE_B', 'RACE_C'].includes(w.eventCategory))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const firstLiveWorkoutDate = nonRaceWorkouts[0]?.date || '';
    const savedBlueprintMatch = savedPlan?.blueprint && entryPlanId && savedPlan.blueprint.planId === entryPlanId
      ? savedPlan.blueprint
      : null;

    const candidatePlanStart = savedBlueprintMatch?.startDate || earliestEntry.planStartDate || '';
    const isCandidateWithinBlocks = candidatePlanStart && (
      (!earliestBlockStart || candidatePlanStart >= earliestBlockStart) &&
      (!latestBlockEnd || candidatePlanStart <= latestBlockEnd)
    );

    const markerDate = (isCandidateWithinBlocks ? candidatePlanStart : '')
      || firstLiveWorkoutDate
      || earliestEntry.firstWorkoutDate
      || earliestBlockStart;

    if (!markerDate) return;

    const cleanTitle = savedBlueprintMatch?.planTitle
      || earliestEntry.planTitle
      || String(earliestEntry.title || 'AI Plan Treninga').split(' • Blok ')[0];

    const primaryBlockSubKey = earliestEntry.blockKey.includes(':')
      ? earliestEntry.blockKey.split(':')[1]
      : earliestEntry.blockKey;

    markers.push({
      id: groupKey,
      planId: entryPlanId,
      title: cleanTitle,
      methodology: savedBlueprintMatch?.recommendedMethodology || earliestEntry.methodology || '',
      totalWeeks: savedBlueprintMatch?.totalWeeks || earliestEntry.totalWeeks || null,
      summary: savedBlueprintMatch?.summary || '',
      goalTitle: savedBlueprintMatch?.goalTitle || earliestEntry.goalTitle || '',
      eventDate: savedBlueprintMatch?.eventDate || earliestEntry.eventDate || '',
      markerDate,
      startDate: markerDate,
      endDate: latestBlockEnd || savedBlueprintMatch?.endDate || markerDate,
      blockKeys,
      primaryBlockKey: earliestEntry.blockKey,
      primaryBlockSubKey,
      blocks: entries,
      hasSavedBlueprint: Boolean(savedBlueprintMatch),
      intervalsCount: entries.reduce((sum, e) => sum + (e.intervalsIds?.length || 0), 0),
      localCount: entries.reduce((sum, e) => sum + (e.localIds?.length || 0), 0),
      workouts: nonRaceWorkouts,
      totalWorkouts: nonRaceWorkouts.length,
      completedCount: nonRaceWorkouts.filter(w => w.isCompleted).length,
      upcomingCount: nonRaceWorkouts.filter(w => !w.isCompleted).length,
      totalPlannedTss: Math.round(
        nonRaceWorkouts.reduce((sum, w) => sum + (Number(w.plannedTss || w.tss) || 0), 0)
      )
    });
  });

  return markers.sort((a, b) => a.markerDate.localeCompare(b.markerDate));
}

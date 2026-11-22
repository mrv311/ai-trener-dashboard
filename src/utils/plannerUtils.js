/**
 * Pomoćne funkcije i konfiguracije za AI Planer Treninga i kalendarske proračune.
 */
import { isStrengthType, isRunningType, isSwimmingType } from './sportTypes.js';
import { tr, getCurrentLanguage, getLocale } from '../i18n/i18nCore.js';

export const WEEKDAY_DEFS = [
  { key: 'mon', index: 0, jsDay: 1, shortHr: 'PON', shortEn: 'MON', nameHr: 'Ponedjeljak', nameEn: 'Monday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'tue', index: 1, jsDay: 2, shortHr: 'UTO', shortEn: 'TUE', nameHr: 'Utorak', nameEn: 'Tuesday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'wed', index: 2, jsDay: 3, shortHr: 'SRI', shortEn: 'WED', nameHr: 'Srijeda', nameEn: 'Wednesday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'thu', index: 3, jsDay: 4, shortHr: 'ČET', shortEn: 'THU', nameHr: 'Četvrtak', nameEn: 'Thursday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'fri', index: 4, jsDay: 5, shortHr: 'PET', shortEn: 'FRI', nameHr: 'Petak', nameEn: 'Friday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'sat', index: 5, jsDay: 6, shortHr: 'SUB', shortEn: 'SAT', nameHr: 'Subota', nameEn: 'Saturday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } },
  { key: 'sun', index: 6, jsDay: 0, shortHr: 'NED', shortEn: 'SUN', nameHr: 'Nedjelja', nameEn: 'Sunday', get short() { return tr(this.shortHr, this.shortEn); }, get name() { return tr(this.nameHr, this.nameEn); } }
];

export function getWeekdayShort(dayOrKey, lang = getCurrentLanguage()) {
  const def = typeof dayOrKey === 'string'
    ? WEEKDAY_DEFS.find(
        d =>
          d.key === dayOrKey ||
          d.shortHr.toLowerCase() === dayOrKey.toLowerCase() ||
          d.shortEn.toLowerCase() === dayOrKey.toLowerCase() ||
          d.nameHr.toLowerCase() === dayOrKey.toLowerCase() ||
          d.nameEn.toLowerCase() === dayOrKey.toLowerCase()
      )
    : dayOrKey;
  if (!def) return typeof dayOrKey === 'string' ? dayOrKey : '';
  return lang === 'en' ? (def.shortEn || def.short) : (def.shortHr || def.short);
}

export function getWeekdayName(dayOrKey, lang = getCurrentLanguage()) {
  const def = typeof dayOrKey === 'string'
    ? WEEKDAY_DEFS.find(
        d =>
          d.key === dayOrKey ||
          d.nameHr.toLowerCase() === dayOrKey.toLowerCase() ||
          d.nameEn.toLowerCase() === dayOrKey.toLowerCase() ||
          d.shortHr.toLowerCase() === dayOrKey.toLowerCase() ||
          d.shortEn.toLowerCase() === dayOrKey.toLowerCase()
      )
    : dayOrKey;
  if (!def) return typeof dayOrKey === 'string' ? dayOrKey : '';
  return lang === 'en' ? (def.nameEn || def.name) : (def.nameHr || def.name);
}

export const DURATION_TIERS = [
  { id: 'short', label: '45m', minutes: 45, descHr: 'Brzi / Trenažer', descEn: 'Quick / Smart Trainer', get desc() { return tr(this.descHr, this.descEn); } },
  { id: 'standard', label: '60m', minutes: 60, descHr: 'Standardni trenažer', descEn: 'Standard Trainer', get desc() { return tr(this.descHr, this.descEn); } },
  { id: 'medium', label: '90m', minutes: 90, descHr: 'Srednji / Prag', descEn: 'Medium / Threshold', get desc() { return tr(this.descHr, this.descEn); } },
  { id: 'long', label: '2h+', minutes: 135, descHr: 'Duža vožnja', descEn: 'Long Ride', get desc() { return tr(this.descHr, this.descEn); } },
  { id: 'epic', label: '3h+', minutes: 200, descHr: 'Duga Z2 / Vikend', descEn: 'Long Z2 / Weekend', get desc() { return tr(this.descHr, this.descEn); } }
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
  {
    id: 'Gran Fondo / Cestovni maraton',
    labelHr: 'Gran Fondo / Maraton',
    labelEn: 'Gran Fondo / Marathon',
    descHr: 'Duga izdržljivost i konstantni usponi',
    descEn: 'Long endurance and sustained climbs',
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Cestovna utrka / Kriterij',
    labelHr: 'Cestovna utrka',
    labelEn: 'Road Race / Crit',
    descHr: 'Visoki skokovi snage, VO2max i napadi',
    descEn: 'High power surges, VO2 Max, and attacks',
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Gravel / MTB maraton',
    labelHr: 'Gravel / MTB maraton',
    labelEn: 'Gravel / MTB Marathon',
    descHr: 'Promjenjiv ritam, ponovljeni prag i snaga',
    descEn: 'Variable pacing, repeated threshold, and force',
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Brdski uspon / Sportive',
    labelHr: 'Brdski uspon / Alpe',
    labelEn: 'Mountain Climb / Sportive',
    descHr: 'Omjer W/kg i dugi napori na pragu',
    descEn: 'W/kg ratio and long threshold climbs',
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Kronometar (TT)',
    labelHr: 'Kronometar (TT)',
    labelEn: 'Time Trial (TT)',
    descHr: 'Stabilna snaga na FTP-u i izdržljivost praga',
    descEn: 'Steady FTP power and threshold stamina',
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  }
];

export const FITNESS_PRESET_GOALS = [
  {
    id: 'Podizanje FTP-a i Sweet Spot izdržljivosti',
    goalHr: 'Podizanje FTP-a i Sweet Spot izdržljivosti',
    goalEn: 'Raise FTP & Sweet Spot Endurance',
    labelHr: 'Podizanje FTP-a',
    labelEn: 'Raise FTP',
    descHr: 'Sweet Spot i Threshold progresija',
    descEn: 'Sweet Spot & Threshold progression',
    get goal() { return tr(this.goalHr, this.goalEn); },
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Z2 Aerobna baza i izdržljivost',
    goalHr: 'Z2 Aerobna baza i izdržljivost',
    goalEn: 'Z2 Aerobic Base & Endurance',
    labelHr: 'Aerobna baza (Z2)',
    labelEn: 'Aerobic Base (Z2)',
    descHr: 'Mitohondrijska gustoća i efikasnost',
    descEn: 'Mitochondrial density & efficiency',
    get goal() { return tr(this.goalHr, this.goalEn); },
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'VO2 Max i probijanje platoa',
    goalHr: 'VO2 Max i probijanje platoa',
    goalEn: 'VO2 Max & Breaking Plateaus',
    labelHr: 'VO2 Max & Snaga',
    labelEn: 'VO2 Max & Power',
    descHr: 'Kratki visoko-intenzivni intervali',
    descEn: 'Short high-intensity intervals',
    get goal() { return tr(this.goalHr, this.goalEn); },
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  },
  {
    id: 'Održavanje kondicije uz nizak umor',
    goalHr: 'Održavanje kondicije uz nizak umor',
    goalEn: 'Maintain Fitness with Low Fatigue',
    labelHr: 'Održavanje forme',
    labelEn: 'Maintain Fitness',
    descHr: 'Fleksibilno uz manji tjedni stres',
    descEn: 'Flexible with lower weekly stress',
    get goal() { return tr(this.goalHr, this.goalEn); },
    get label() { return tr(this.labelHr, this.labelEn); },
    get desc() { return tr(this.descHr, this.descEn); }
  }
];

export const PHASE_META = {
  base: {
    labelHr: 'Baza',
    labelEn: 'Base',
    get label() { return tr(this.labelHr, this.labelEn); },
    cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    bar: 'bg-sky-400'
  },
  build: {
    labelHr: 'Build',
    labelEn: 'Build',
    get label() { return tr(this.labelHr, this.labelEn); },
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bar: 'bg-amber-400'
  },
  peak: {
    labelHr: 'Peak',
    labelEn: 'Peak',
    get label() { return tr(this.labelHr, this.labelEn); },
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    bar: 'bg-rose-400'
  },
  taper: {
    labelHr: 'Taper',
    labelEn: 'Taper',
    get label() { return tr(this.labelHr, this.labelEn); },
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    bar: 'bg-emerald-400'
  },
  race: {
    labelHr: 'Event',
    labelEn: 'Race / Event',
    get label() { return tr(this.labelHr, this.labelEn); },
    cls: 'bg-volt-400/15 text-volt-400 border-volt-400/35',
    bar: 'bg-volt-400'
  }
};

export function getLocalizedPhaseLabel(phaseType, rawLabel, lang = getCurrentLanguage()) {
  const meta = PHASE_META[phaseType] || PHASE_META.base;
  if (!rawLabel) return lang === 'en' ? meta.labelEn : meta.labelHr;
  const trimmed = String(rawLabel).trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'baza' || lower === 'base') return lang === 'en' ? 'Base' : 'Baza';
  if (lower === 'build' || lower === 'izgradnja') return 'Build';
  if (lower === 'peak' || lower === 'vrhunac') return 'Peak';
  if (lower === 'taper' || lower === 'rasterećenje') return 'Taper';
  if (lower === 'oporavak' || lower === 'recovery' || lower === 'rest') return lang === 'en' ? 'Recovery' : 'Oporavak';
  if (lower === 'event' || lower === 'utrka' || lower === 'race' || lower === 'race / event') return lang === 'en' ? 'Race / Event' : 'Event';
  return trimmed;
}

export function getLocalizedEventType(eventTypeId, lang = getCurrentLanguage()) {
  if (!eventTypeId) return '';
  const match = EVENT_TYPE_OPTIONS.find(
    o => o.id === eventTypeId || o.labelHr === eventTypeId || o.labelEn === eventTypeId
  );
  if (!match) return eventTypeId;
  return lang === 'en' ? match.labelEn : match.labelHr;
}

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
  const lang = getCurrentLanguage();
  const activeDays = [];
  const promptLines = [];
  let totalMinutes = 0;

  WEEKDAY_DEFS.forEach(day => {
    const cfg = weeklySchedule?.[day.key];
    const dayLabel = lang === 'en' ? day.nameEn : day.nameHr;
    if (cfg?.enabled) {
      const mins = Math.max(30, Number(cfg.minutes) || 60);
      totalMinutes += mins;
      activeDays.push({ ...day, minutes: mins });
      const hint = mins >= 120
        ? tr('duga vožnja / vani ili duži Z2', 'long ride / outdoor or extended Z2', null, lang)
        : (mins <= 50
          ? tr('kratki intenzivni / trenažer', 'short intense / smart trainer', null, lang)
          : tr('trenažer / standardni trening', 'smart trainer / standard workout', null, lang));
      promptLines.push(
        lang === 'en'
          ? `- ${dayLabel} (${day.key}): WORKOUT max ${mins} min (${hint})`
          : `- ${dayLabel} (${day.key}): TRENING max ${mins} min (${hint})`
      );
    } else {
      promptLines.push(
        lang === 'en'
          ? `- ${dayLabel} (${day.key}): REST DAY (do not schedule a workout!)`
          : `- ${dayLabel} (${day.key}): DAN ODMORA (ne zakazuj trening!)`
      );
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

export function formatShortHrDate(dateIso, lang = getCurrentLanguage()) {
  if (!dateIso) return '';
  const dt = parseIsoLocal(dateIso);
  try {
    return dt.toLocaleDateString(getLocale(lang), { day: 'numeric', month: 'short' });
  } catch {
    if (lang === 'en') {
      const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthsEn[dt.getMonth()]} ${dt.getDate()}`;
    }
    const months = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
    return `${dt.getDate()}. ${months[dt.getMonth()]}`;
  }
}

const REST_EVENT_CATEGORIES = new Set(['REST', 'ODMOR', 'DAY_OFF', 'NOTE', 'HOLIDAY', 'SICK']);
const RACE_EVENT_CATEGORIES = new Set(['RACE_A', 'RACE_B', 'RACE_C']);

/**
 * Prepoznaje stavke koje predstavljaju potpuni dan odmora (bez treninga)
 * kako se ne bi tretirale kao neodrađeni treninzi u planu ili kalendaru.
 * Ne zahvaća stvarne treninge aktivnog oporavka (npr. "Aktivni oporavak", "Z1 oporavak").
 */
export function isRestDayWorkout(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isCompleted || item.status === 'completed') return false;

  const evCat = String(item.eventCategory || '').trim().toUpperCase();
  const cat = String(item.category || '').trim().toUpperCase();
  if (RACE_EVENT_CATEGORIES.has(evCat) || RACE_EVENT_CATEGORIES.has(cat)) return false;
  if (REST_EVENT_CATEGORIES.has(evCat) || REST_EVENT_CATEGORIES.has(cat)) return true;

  const rawTitle = String(item.title ?? item.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (rawTitle) {
    const strippedTitle = rawTitle
      .replace(/^(?:ponedjeljak|utorak|srijeda|četvrtak|cetvrtak|petak|subota|nedjelja|pon|uto|sri|čet|cet|pet|sub|ned|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*[-–:|]\s*/i, '')
      .replace(/[.!?]+$/g, '')
      .trim();

    const hasActiveRideHint = /\b(aktivn\w*|active|z[12]|vožnj\w*|voznj\w*|ride|spin)\b/i.test(strippedTitle);
    const matchesRestPhrase =
      /\bpotpun[ioa]?\s+odmor\b/i.test(strippedTitle) ||
      /\bdan\s+(?:za\s+)?odmor(?:a)?\b/i.test(strippedTitle) ||
      /\bdani?\s+odmora\b/i.test(strippedTitle) ||
      /\bslobodan\s+dan\b/i.test(strippedTitle) ||
      /\bpasivn[ioa]?\s+odmor\b/i.test(strippedTitle) ||
      /\bbez\s+treninga\b/i.test(strippedTitle) ||
      /\b(?:complete|full|total)\s+rest\b/i.test(strippedTitle) ||
      /\brest[\s-]+day\b/i.test(strippedTitle) ||
      /\bday[\s-]+off\b/i.test(strippedTitle) ||
      /\boff[\s-]+day\b/i.test(strippedTitle) ||
      /^(?:odmor|rest|off|rest\s*\/\s*off)$/i.test(strippedTitle);

    if (matchesRestPhrase && !hasActiveRideHint) {
      return true;
    }
  }

  if (isStrengthType(item.type) || isRunningType(item.type) || isSwimmingType(item.type)) {
    return false;
  }

  const hasExplicitZeroDuration =
    (item.durationMinutes != null && Number(item.durationMinutes) <= 0) ||
    (item.duration != null && Number(item.duration) <= 0 && item.moving_time == null && item.duration_seconds == null);
  const resolvedTss = Number(item.estimatedTss ?? item.tss ?? item.icu_training_load ?? item.plannedTss ?? 0);
  const hasStepsArray = Array.isArray(item.steps) && item.steps.length > 0;
  const codeCandidate = item.intervalsCode ?? item.workout_doc ?? item.descriptionText;
  const hasCodeSteps = typeof codeCandidate === 'string' && codeCandidate.trim().length > 0;

  if (hasExplicitZeroDuration && resolvedTss <= 0 && !hasStepsArray && !hasCodeSteps) {
    return true;
  }

  return false;
}

export const PLAN_STORAGE_EVENT = 'ergvibe-saved-plan-changed';
const LEGACY_PLANNER_SCHEDULE_KEY = 'ergvibe_planner_schedule_v1';

export function getPlanStorageKey(userId) {
  return `ergvibe_ai_macro_plan_v2_${userId || 'guest'}`;
}

export function getPlannerScheduleKey(userId) {
  return `${LEGACY_PLANNER_SCHEDULE_KEY}_${userId || 'guest'}`;
}

export function loadPlannerSchedule(userId) {
  try {
    const scopedRaw = localStorage.getItem(getPlannerScheduleKey(userId));
    const raw = scopedRaw ?? localStorage.getItem(LEGACY_PLANNER_SCHEDULE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_WEEKLY_SCHEDULE, ...parsed };
      }
    }
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_WEEKLY_SCHEDULE };
}

export function savePlannerSchedule(userId, schedule) {
  if (!schedule || typeof schedule !== 'object') return;
  try {
    localStorage.setItem(getPlannerScheduleKey(userId), JSON.stringify(schedule));
  } catch {
    // ignore quota errors
  }
}

export function loadSavedPlan(userId) {
  try {
    const key = getPlanStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.blueprint) return null;

    let changed = false;
    if (parsed.blocks && typeof parsed.blocks === 'object') {
      Object.values(parsed.blocks).forEach(block => {
        if (!Array.isArray(block?.weeks)) return;
        block.weeks.forEach(week => {
          if (!Array.isArray(week?.workouts)) return;
          const filtered = week.workouts.filter(w => !isRestDayWorkout(w));
          if (filtered.length !== week.workouts.length) {
            week.workouts = filtered;
            changed = true;
          }
        });
      });
    }

    if (changed) {
      try {
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch {
        // ignore quota errors
      }
    }

    return parsed;
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
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(PLAN_STORAGE_EVENT, {
        detail: {
          userId: userId || 'guest',
          action: 'cleared',
          planId: expectedPlanId || null
        }
      }));
    }
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
  const lang = getCurrentLanguage();
  const isEn = lang === 'en';
  const sorted = [...workoutsInCalendar].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const completed = sorted.filter(w => w.isCompleted);
  const upcoming = sorted.filter(w => !w.isCompleted);
  const totalPlannedTss = sorted.reduce((acc, w) => acc + (Number(w.plannedTss || w.tss) || 0), 0);

  const previewLines = sorted.slice(0, 28).map(w => {
    const status = w.isCompleted
      ? tr('ODRAĐENO', 'COMPLETED', null, lang)
      : (w.statusColor === 'red-missed'
        ? tr('PROPUŠTENO', 'MISSED', null, lang)
        : tr('PLANIRANO', 'PLANNED', null, lang));
    const dur = Math.round(Number(w.plannedDuration || w.duration) || 0);
    const tss = Math.round(Number(w.plannedTss || w.tss) || 0);
    const catLabel = isEn ? 'cat' : 'kat';
    return `- ${w.date} [${status}]: ${w.title} (${dur}m, ~${tss} TSS, ${catLabel}: ${w.category || 'WORKOUT'})`;
  });

  if (isEn) {
    return [
      `Please provide a detailed coaching analysis of my training plan "${planTitle || 'AI Training Plan'}".`,
      methodology ? `• Methodology: ${methodology}` : null,
      totalWeeks ? `• Macrocycle duration: ${totalWeeks} weeks` : null,
      startDate ? `• Plan start in calendar: ${startDate}${endDate ? ` to ${endDate}` : ''}` : null,
      goalTitle ? `• Goal: ${goalTitle}${eventDate ? ` (${eventDate})` : ''}` : null,
      summary ? `• Plan summary: ${summary}` : null,
      sorted.length > 0
        ? `• Calendar items: ${sorted.length} workouts (${completed.length} completed, ${upcoming.length} upcoming, ~${Math.round(totalPlannedTss)} total TSS)`
        : null,
      previewLines.length > 0
        ? `\nWorkout schedule:\n${previewLines.join('\n')}${sorted.length > 28 ? `\n... and ${sorted.length - 28} more workouts` : ''}`
        : null,
      '\nPlease evaluate specifically:',
      '1. Is the load progression (TSS / volume) and intensity-to-Z2 recovery ratio optimal for my current CTL/ATL/TSB and goal?',
      '2. Are there any unrealistic, overly hard, or poorly placed workouts for a smart trainer?',
      '3. What specific adjustments or improvements would you recommend for the upcoming workouts / blocks?'
    ].filter(Boolean).join('\n');
  }

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
      || String(earliestEntry.title || tr('AI Plan Treninga', 'AI Training Plan')).split(/\s*•\s*(?:Blok|Block)\s+/)[0];

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

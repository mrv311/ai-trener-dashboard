/**
 * Centralizirane pomoćne funkcije za prepoznavanje vrste sporta / treninga
 * (biciklizam za trenažer vs. trening snage / teretana, trčanje, plivanje, ostalo).
 */

const CYCLING_TYPES = new Set([
  'ride',
  'virtualride',
  'mountainbikeride',
  'gravelride',
  'ebikeride',
  'emountainbikeride',
  'handcycle',
  'velomobile',
  'trackride',
  'cycling',
  'biking',
  'indoorcycling',
  'spin',
  'bike'
]);

const STRENGTH_TYPES = new Set([
  'strength',
  'weighttraining',
  'strengthtraining',
  'gym',
  'crossfit',
  'weights',
  'snaga',
  'treningsnage',
  'teretana',
  'core',
  'mobility',
  'pilates',
  'yoga',
  'stretching',
  'calisthenics'
]);

const RUN_TYPES = new Set([
  'run',
  'virtualrun',
  'trailrun',
  'treadmill',
  'running',
  'trcanje'
]);

const SWIM_TYPES = new Set([
  'swim',
  'openwaterswim',
  'poolswim',
  'swimming',
  'plivanje'
]);

const RACE_EVENT_CATEGORIES = new Set(['RACE_A', 'RACE_B', 'RACE_C']);

const STRENGTH_TITLE_RE = /\b(trening\s+snage|snag[aeu]?|strength(?:\s+training)?|weight\s*training|teretan[aeu]?|gym|utezi|core\b|mobilnost|mobility|yoga|pilates|crossfit|funkcionaln\w*)\b/i;
const CYCLING_TITLE_HINT_RE = /\b(bicikl\w*|vožnj\w*|voznj\w*|ride|cycling|spin|trainer|trenažer|trenazer|ftp|vo2|sweet\s*spot|endurance|tempo|kadenc\w*|cadence|watt\w*|z[1-6])\b/i;
const RUN_TITLE_RE = /\b(trčanj[aeu]?|trcanj[aeu]?|running|trail\s*run|jogging|maraton|polumaraton)\b/i;
const SWIM_TITLE_RE = /\b(plivanj[aeu]?|swimming|bazen)\b/i;

export function normalizeSportToken(raw) {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

export function isStrengthType(typeStr) {
  const norm = normalizeSportToken(typeStr);
  return norm ? STRENGTH_TYPES.has(norm) : false;
}

export function isRunningType(typeStr) {
  const norm = normalizeSportToken(typeStr);
  return norm ? RUN_TYPES.has(norm) : false;
}

export function isSwimmingType(typeStr) {
  const norm = normalizeSportToken(typeStr);
  return norm ? SWIM_TYPES.has(norm) : false;
}

export function isCyclingType(typeStr) {
  if (!typeStr) return true; // zadano je biciklizam ako tip nije specificiran
  const norm = normalizeSportToken(typeStr);
  return CYCLING_TYPES.has(norm);
}

/**
 * Provjerava sadrži li tekstualni opis eksplicitne biciklističke ciljeve snage (% FTP, W, zone).
 */
export function hasExplicitCyclingPowerSyntax(text) {
  if (!text || typeof text !== 'string') return false;
  return /(?:^|\s)\d+(?:\.\d+)?\s*(?:%|w\b)/im.test(text) || /\bz[1-7]\b/i.test(text);
}

function hasCyclingSteps(workout) {
  if (!workout || typeof workout !== 'object') return false;
  if (Array.isArray(workout.steps) && workout.steps.length > 0) return true;
  if (Array.isArray(workout.allSteps) && workout.allSteps.length > 0) return true;
  if (workout.workout_doc?.steps && Array.isArray(workout.workout_doc.steps) && workout.workout_doc.steps.length > 0) return true;
  if (typeof workout.workout_doc === 'string' && hasExplicitCyclingPowerSyntax(workout.workout_doc)) return true;
  if (typeof workout.intervalsCode === 'string' && hasExplicitCyclingPowerSyntax(workout.intervalsCode)) return true;
  return false;
}

function isStrengthTitleWithoutCyclingHints(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  return STRENGTH_TITLE_RE.test(t) && !CYCLING_TITLE_HINT_RE.test(t);
}

/**
 * Određuje treba li Intervals/lokalni planirani event tretirati kao ne-biciklistički
 * prije parsiranja intervala (kako se bilješke vježbi ne bi krivo pretvorile u korake snage).
 */
export function isNonCyclingEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.type) return !isCyclingType(ev.type);
  if (isStrengthType(ev.category)) return true;
  if (String(ev.category || '').toUpperCase() === 'OTHER') return true;
  if (hasCyclingSteps(ev) || hasExplicitCyclingPowerSyntax(ev.description)) return false;
  return isStrengthTitleWithoutCyclingHints(ev.name || ev.title);
}

/**
 * Određuje kanonsku vrstu aktivnosti za prikaz i ponašanje u UI-ju:
 * 'race' | 'strength' | 'run' | 'swim' | 'other' | 'ride'
 */
export function getWorkoutSportKind(workout) {
  if (!workout || typeof workout !== 'object') return 'ride';

  if (RACE_EVENT_CATEGORIES.has(workout.eventCategory)) return 'race';

  const title = String(workout.title || workout.name || '');
  const rawType = workout.type || workout.sportType || '';

  if (rawType) {
    if (isStrengthType(rawType)) return 'strength';
    if (isRunningType(rawType)) return 'run';
    if (isSwimmingType(rawType)) return 'swim';
    if (isCyclingType(rawType)) {
      // Za postojeće zapise kojima je ostao generički 'ride' bez koraka, ali imaju jasan naziv snage
      if (!workout.isNewDraft && !hasCyclingSteps(workout) && isStrengthTitleWithoutCyclingHints(title)) {
        return 'strength';
      }
      return 'ride';
    }
    if (STRENGTH_TITLE_RE.test(title) || isStrengthType(workout.category)) return 'strength';
    if (RUN_TITLE_RE.test(title)) return 'run';
    if (SWIM_TITLE_RE.test(title)) return 'swim';
    return 'other';
  }

  const src = String(workout.workout_source || '');
  if (src.toLowerCase().startsWith('external_upload_')) {
    const srcSport = src.slice('external_upload_'.length);
    if (isStrengthType(srcSport)) return 'strength';
    if (isRunningType(srcSport)) return 'run';
    if (isSwimmingType(srcSport)) return 'swim';
    if (!isCyclingType(srcSport)) return 'other';
  }

  if (isStrengthType(workout.category)) return 'strength';
  if (hasCyclingSteps(workout)) return 'ride';

  const cat = String(workout.category || '').toUpperCase();
  if (cat === 'OTHER') {
    if (STRENGTH_TITLE_RE.test(title)) return 'strength';
    if (RUN_TITLE_RE.test(title)) return 'run';
    if (SWIM_TITLE_RE.test(title)) return 'swim';
    return 'other';
  }

  if (isStrengthTitleWithoutCyclingHints(title)) return 'strength';

  return 'ride';
}

/**
 * Određuje može li se trening pokrenuti u pametnom trenažeru.
 * Samo ne-završeni biciklistički treninzi se mogu pokrenuti u trenažeru.
 */
export function canRunInTrainer(workout) {
  if (!workout || workout.isCompleted || workout.status === 'completed') return false;
  return getWorkoutSportKind(workout) === 'ride';
}

/**
 * Pretvara interni/tekstualni tip u službeni Intervals.icu sport tip.
 */
export function toIntervalsSportType(typeStr) {
  if (!typeStr) return 'Ride';
  if (isStrengthType(typeStr)) return 'WeightTraining';
  if (isRunningType(typeStr)) return 'Run';
  if (isSwimmingType(typeStr)) return 'Swim';
  if (isCyclingType(typeStr)) return 'Ride';
  return String(typeStr);
}

/**
 * Vraća čitljivi hrvatski naziv vrste treninga.
 */
export function getSportLabel(kindOrWorkout) {
  const kind = typeof kindOrWorkout === 'string' ? kindOrWorkout : getWorkoutSportKind(kindOrWorkout);
  switch (kind) {
    case 'strength': return 'Trening snage';
    case 'run': return 'Trčanje';
    case 'swim': return 'Plivanje';
    case 'other': return 'Ostali trening';
    case 'race': return 'Ciljni Event';
    default: return 'Biciklizam';
  }
}

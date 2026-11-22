import { CATALOG_DESCRIPTIONS_EN } from './catalogDescriptionsEn.js';

const STORAGE_KEY = 'ergvibe_lang';
const REGIONAL_HR_PREFIXES = ['hr', 'bs', 'sr', 'sl', 'cnr'];

export function normalizeLang(raw) {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'hr' || lower.startsWith('hr-')) return 'hr';
  return null;
}

export function detectInitialLanguage() {
  if (typeof window === 'undefined') return 'en';

  // 1. URL query override (?lang=en ili ?lang=hr) — idealno za dijeljenje linkova (npr. forum.intervals.icu)
  try {
    const params = new URLSearchParams(window.location.search);
    const urlLang = normalizeLang(params.get('lang'));
    if (urlLang) {
      try {
        window.localStorage.setItem(STORAGE_KEY, urlLang);
      } catch (_) {}
      return urlLang;
    }
  } catch (_) {}

  // 2. Spremljena korisnička postavka
  try {
    const saved = normalizeLang(window.localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (_) {}

  // 3. Automatska detekcija jezika preglednika (regija -> HR, ostatak svijeta -> EN)
  try {
    const navLangs =
      Array.isArray(window.navigator?.languages) && window.navigator.languages.length > 0
        ? window.navigator.languages
        : [window.navigator?.language || 'en'];
    const primary = String(navLangs[0] || 'en').toLowerCase();
    if (REGIONAL_HR_PREFIXES.some((prefix) => primary === prefix || primary.startsWith(`${prefix}-`))) {
      return 'hr';
    }
  } catch (_) {}

  return 'en';
}

let _currentLang = detectInitialLanguage();
const _listeners = new Set();

export function getCurrentLanguage() {
  return _currentLang;
}

export function isEnglish() {
  return _currentLang === 'en';
}

export function getLocale(lang = _currentLang) {
  return lang === 'en' ? 'en-US' : 'hr-HR';
}

export function subscribeLanguage(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function setCurrentLanguage(nextLang) {
  const normalized = normalizeLang(nextLang);
  if (!normalized) return _currentLang;
  _currentLang = normalized;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_) {}
  }
  _listeners.forEach((fn) => {
    try {
      fn(normalized);
    } catch (_) {}
  });
  return normalized;
}

function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

/**
 * Inline dvojezični helper (HR / EN).
 * Radi i unutar React komponenti (preko useI18n().tr) i unutar čistih JS servisa.
 */
export function tr(hr, en, vars, lang = _currentLang) {
  const raw = lang === 'en' ? en : hr;
  return vars ? interpolate(raw, vars) : raw;
}

/**
 * Kanonski nazivi zona treninga u bazi ostaju stabilni ('Oporavak', 'Anaerobni', 'Testiranje'...),
 * a UI prikazuje lokalizirani naziv.
 */
const CATEGORY_EN_MAP = {
  sve: 'All',
  'sve kategorije': 'All Categories',
  oporavak: 'Recovery',
  recovery: 'Recovery',
  endurance: 'Endurance',
  izdržljivost: 'Endurance',
  izdrzljivost: 'Endurance',
  tempo: 'Tempo',
  'sweet spot': 'Sweet Spot',
  threshold: 'Threshold',
  prag: 'Threshold',
  'vo2 max': 'VO2 Max',
  vo2max: 'VO2 Max',
  anaerobni: 'Anaerobic',
  anaerobic: 'Anaerobic',
  testiranje: 'Testing',
  testing: 'Testing',
  'ftp test': 'FTP Test',
  snaga: 'Strength',
  'trening snage': 'Strength Training',
  'općenito': 'General',
  opcenito: 'General',
  ostalo: 'Other',
  klasici: 'Classics',
  utrka: 'Race'
};

export function translateCategory(category, lang = _currentLang) {
  if (!category) return '';
  if (lang !== 'en') return category;
  const key = String(category).trim().toLowerCase();
  return CATEGORY_EN_MAP[key] || category;
}

/**
 * Lokalizacija tipičnih hrvatskih naziva intervalnih koraka za prikaz na engleskom.
 */
const STEP_EXACT_EN = {
  zagrijavanje: 'Warmup',
  'hlađenje': 'Cooldown',
  hladjenje: 'Cooldown',
  oporavak: 'Recovery',
  odmor: 'Rest',
  lagano: 'Easy',
  priprema: 'Prep',
  aktivacija: 'Openers',
  ubrzanje: 'Burst',
  'z1 oporavak': 'Z1 Recovery',
  'z2 baza': 'Z2 Base',
  'z2 aerobna baza': 'Z2 Aerobic Base',
  'z2 završnica': 'Z2 Finisher',
  'radni interval': 'Work Interval',
  'glavni dio': 'Main Set',
  'priprema (primers)': 'Primers',
  'visoka kadenca': 'High Cadence',
  'niska kadenca': 'Low Cadence',
  'snažna kadenca': 'Low Cadence Force',
  'tehnika jednom nogom': 'Single-Leg Drill',
  'lagano obje noge': 'Easy Both Legs',
  'puni oporavak': 'Full Recovery',
  'oporavak prije testa': 'Pre-Test Recovery',
  'slobodna vožnja': 'Free Ride',
  'set oporavak': 'Set Recovery',
  'opener prag': 'Threshold Opener',
  '5m pražnjenje': '5m Blowout',
  '15s aktivacija': '15s Opener',
  '8m test blok 1': '8m Test Block 1',
  '8m test blok 2': '8m Test Block 2',
  '12m prag test': '12m Threshold Test'
};

const STEP_PREFIX_RULES = [
  [/^Prag\b/i, 'Threshold'],
  [/^Rampa\b/i, 'Ramp'],
  [/^Uspon\b/i, 'Climb'],
  [/^Spust\b/i, 'Descent'],
  [/^Vrh\b/i, 'Crest'],
  [/^Napad\b/i, 'Attack'],
  [/^Bijeg\b/i, 'Breakaway'],
  [/^Zavoj\b/i, 'Corner'],
  [/^Grupa\b/i, 'Pack'],
  [/^Start iz mjesta\b/i, 'Standing Start'],
  [/^Kadenca\b/i, 'Cadence'],
  [/^Oporavak\b/i, 'Recovery'],
  [/^Zagrijavanje\b/i, 'Warmup'],
  [/^Hlađenje\b/i, 'Cooldown'],
  [/^Ubrzanje\b/i, 'Burst'],
  [/^Snaga\b/i, 'Force'],
  [/^Baza\b/i, 'Base'],
  [/^Interval\b/i, 'Interval']
];

export function translateStepName(name, lang = _currentLang) {
  if (!name || lang !== 'en') return name || '';
  const trimmed = String(name).trim();
  const exact = STEP_EXACT_EN[trimmed.toLowerCase()];
  if (exact) return exact;
  let out = trimmed;
  for (const [re, replacement] of STEP_PREFIX_RULES) {
    if (re.test(out)) {
      out = out.replace(re, replacement);
    }
  }
  return out;
}

/**
 * Lokalizacija opisa treninga iz 252-trening javnog ErgVibe kataloga kad je aktivan EN jezik.
 */
export function translateWorkoutDescription(title, description, lang = _currentLang) {
  if (!description || lang !== 'en') return description || '';
  if (title && CATALOG_DESCRIPTIONS_EN[title]) {
    return CATALOG_DESCRIPTIONS_EN[title];
  }
  return description;
}

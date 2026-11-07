// Persistent Web Bluetooth (BLE) Black-Box Diagnostic Logger
// Stores ring buffer in localStorage AND allows attaching session BLE events
// to Supabase `completed_activities.stream_data[0].ble_log` for remote debugging
// (e.g. garage PC -> main PC).

const BLE_LOG_STORAGE_KEY = 'ergvibe_ble_diagnostic_log_v1';
const MAX_LOCAL_BLE_LOGS = 180;

let cachedLogs = null;
const subscribers = new Set();

function loadFromStorage() {
  if (cachedLogs !== null) return cachedLogs;
  if (typeof window === 'undefined') {
    cachedLogs = [];
    return cachedLogs;
  }
  try {
    const raw = window.localStorage.getItem(BLE_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cachedLogs = Array.isArray(parsed) ? parsed.slice(-MAX_LOCAL_BLE_LOGS) : [];
  } catch {
    cachedLogs = [];
  }
  return cachedLogs;
}

function saveToStorage(entries) {
  cachedLogs = entries.slice(-MAX_LOCAL_BLE_LOGS);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(BLE_LOG_STORAGE_KEY, JSON.stringify(cachedLogs));
    } catch {
      // Ignore quota errors
    }
  }
  subscribers.forEach((cb) => {
    try {
      cb(cachedLogs);
    } catch {
      // Ignore subscriber errors
    }
  });
}

function stringifyDetail(detail) {
  if (detail == null || detail === '') return '';
  if (typeof detail === 'string') return detail.slice(0, 500);
  if (detail instanceof Error) {
    const name = detail.name || 'Error';
    const msg = detail.message || String(detail);
    return `${name}: ${msg}`.slice(0, 500);
  }
  try {
    return JSON.stringify(detail).slice(0, 500);
  } catch {
    return String(detail).slice(0, 500);
  }
}

function formatLocalTime(date) {
  try {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return '';
  }
}

/**
 * Append a BLE diagnostic event.
 * @param {'info'|'ok'|'warn'|'error'} level
 * @param {'PM'|'TRAINER'|'HR'|'CLICK'|'SYS'} sensor
 * @param {string} event
 * @param {any} [detail]
 */
export function logBleEvent(level, sensor, event, detail = '') {
  const now = new Date();
  const detailStr = stringifyDetail(detail);
  const entry = {
    ts: now.toISOString(),
    timeLocal: formatLocalTime(now),
    level: level || 'info',
    sensor: sensor || 'SYS',
    event: String(event || ''),
    ...(detailStr ? { detail: detailStr } : {}),
  };

  const current = loadFromStorage();
  saveToStorage([...current, entry]);

  const prefix = `[BLE:${entry.sensor}] ${entry.event}`;
  if (level === 'error') {
    console.error(prefix, detailStr);
  } else if (level === 'warn') {
    console.warn(prefix, detailStr);
  } else {
    console.info(prefix, detailStr);
  }

  return entry;
}

export function getBleLogs() {
  return [...loadFromStorage()];
}

export function clearBleLogs() {
  saveToStorage([]);
}

export function subscribeBleLogs(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Returns compact BLE logs suitable for attaching to `stream_data[0].ble_log`
 * when syncing a completed workout to Supabase. Includes events from 45 min
 * before `sinceIso` (to capture pre-workout pairing struggles in the garage).
 */
export function getSessionBleLogs(sinceIso, limit = 80) {
  const all = loadFromStorage();
  if (!all.length) return [];

  let cutoffMs = Date.now() - 3 * 60 * 60 * 1000; // default last 3 hours
  if (sinceIso) {
    const parsed = new Date(sinceIso).getTime();
    if (Number.isFinite(parsed)) {
      cutoffMs = parsed - 45 * 60 * 1000; // include 45 min pre-ride setup window
    }
  }

  const filtered = all.filter((e) => {
    const t = new Date(e.ts).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });

  return (filtered.length ? filtered : all.slice(-30)).slice(-limit);
}

export function formatBleLogsAsText(logs = getBleLogs()) {
  if (!logs || logs.length === 0) {
    return 'Nema zabilježenih BLE događaja na ovom uređaju.';
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const header = `ErgVibe BLE Diagnostic Log (${new Date().toISOString()})\nUA: ${ua}\n---`;
  const lines = logs.map((e) => {
    const lvl = String(e.level || 'info').toUpperCase().padEnd(5, ' ');
    const sns = String(e.sensor || 'SYS').padEnd(7, ' ');
    return `${e.timeLocal || e.ts} [${lvl}] [${sns}] ${e.event}${e.detail ? ` — ${e.detail}` : ''}`;
  });
  return [header, ...lines].join('\n');
}

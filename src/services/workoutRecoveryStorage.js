/**
 * ErgVibe Active Workout Crash Recovery Storage
 *
 * Lokalna "crna kutija" za nezavršene treninge (radi 100% offline):
 * - Primarno spremište: IndexedDB (asinkrono, velik kapacitet, ne koči graf/BLE)
 * - Sekundarni sigurnosni sloj: localStorage (sinkroni upis za pagehide / beforeunload)
 * - Rok čuvanja nezavršenog treninga: 48 sati
 */

const DB_NAME = 'ergvibe_workout_recovery';
const DB_VERSION = 1;
const STORE_NAME = 'active_sessions';
const LS_FALLBACK_PREFIX = 'ergvibe_active_workout_v1_';

export const RECOVERY_TTL_MS = 48 * 60 * 60 * 1000; // 48 sati
export const MIN_RECOVERY_SECONDS = 5;
const MAX_LS_CHARS = 450_000; // ~450 KB sigurno za localStorage (pokriva >4h treninga u kompaktnom formatu)

let persistentStorageRequested = false;

function normalizeUserKey(userId) {
  return String(userId || 'guest').trim() || 'guest';
}

function getFallbackKey(userId) {
  return `${LS_FALLBACK_PREFIX}${normalizeUserKey(userId)}`;
}

/**
 * Zatraži od preglednika trajnu pohranu (sprječava automatsko čišćenje IndexedDB-a pod pritiskom diska).
 */
export function requestPersistentStorageOnce() {
  if (persistentStorageRequested) return;
  persistentStorageRequested = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }
  } catch {
    // ignore
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB nije podržan u ovom pregledniku.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Greška pri otvaranju recovery IndexedDB baze.'));
  });
}

function safeCloneJson(val) {
  if (val == null) return null;
  try {
    return JSON.parse(JSON.stringify(val));
  } catch {
    return null;
  }
}

/**
 * Pakira 1Hz povijest u kompaktni niz brojeva [[t, p, hr, cad], ...] (~65% manji zapis).
 */
function packWorkoutHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.map((pt) => [
    Number(pt?.time ?? pt?.t ?? 0) || 0,
    Math.max(0, Math.round(Number(pt?.power ?? pt?.p ?? 0) || 0)),
    Math.max(0, Math.round(Number(pt?.hr ?? 0) || 0)),
    Math.max(0, Math.round(Number(pt?.cadence ?? pt?.cad ?? 0) || 0))
  ]);
}

/**
 * Raspakirava kompaktni niz natrag u standardni format [{ time, power, hr, cadence }, ...].
 */
function unpackWorkoutHistory(record) {
  if (Array.isArray(record?.historyPacked)) {
    return record.historyPacked.map((row) => ({
      time: Number(row?.[0]) || 0,
      power: Number(row?.[1]) || 0,
      hr: Number(row?.[2]) || 0,
      cadence: Number(row?.[3]) || 0
    }));
  }
  if (Array.isArray(record?.workoutHistory)) {
    return record.workoutHistory.map((pt) => ({
      time: Number(pt?.time ?? pt?.t ?? 0) || 0,
      power: Number(pt?.power ?? pt?.p ?? 0) || 0,
      hr: Number(pt?.hr ?? 0) || 0,
      cadence: Number(pt?.cadence ?? pt?.cad ?? 0) || 0
    }));
  }
  return [];
}

function buildRecord(userId, payload) {
  const key = normalizeUserKey(userId);
  const nowMs = Date.now();

  const sanitizedWorkout = safeCloneJson(payload?.workoutFromCalendar);
  if (sanitizedWorkout && typeof sanitizedWorkout === 'object') {
    delete sanitizedWorkout.__recoveredNonce;
  }

  const sanitizedRecipe = Array.isArray(payload?.workoutRecipe)
    ? safeCloneJson(payload.workoutRecipe) || []
    : [];

  return {
    id: key,
    userId: key,
    schemaVersion: 1,
    savedAtMs: nowMs,
    savedAt: new Date(nowMs).toISOString(),
    sessionStartTime: payload?.sessionStartTime || null,
    elapsedTime: Math.max(0, Math.round(Number(payload?.elapsedTime) || 0)),
    workoutFromCalendar: sanitizedWorkout,
    workoutRecipe: sanitizedRecipe,
    historyPacked: packWorkoutHistory(payload?.workoutHistory),
    ergIntensity: Number(payload?.ergIntensity) || 100,
    controlMode: payload?.controlMode === 'RES' ? 'RES' : 'ERG',
    virtualGear: Number(payload?.virtualGear) || 12,
    powerMatchEnabled: Boolean(payload?.powerMatchEnabled),
    sensors: safeCloneJson(payload?.sensors) || { trainer: null, pm: null, hr: null, click: null }
  };
}

function writeLocalStorageFallback(userId, record) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const serialized = JSON.stringify(record);
    if (serialized.length > MAX_LS_CHARS) {
      return false;
    }
    window.localStorage.setItem(getFallbackKey(userId), serialized);
    return true;
  } catch {
    // QuotaExceededError ili privatni način rada — IndexedDB ostaje primarni sloj
    return false;
  }
}

function readLocalStorageFallback(userId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(getFallbackKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function removeLocalStorageFallback(userId) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(getFallbackKey(userId));
    }
  } catch {
    // ignore
  }
}

async function writeIdbRecord(record) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Neuspjelo spremanje recovery snapshota u IndexedDB.'));
    });
    return true;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

async function readIdbRecord(userId) {
  const key = normalizeUserKey(userId);
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Greška pri čitanju recovery snapshota iz IndexedDB.'));
    });
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

async function deleteIdbRecord(userId) {
  const key = normalizeUserKey(userId);
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Greška pri brisanju recovery snapshota iz IndexedDB.'));
    });
    return true;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function isValidCandidate(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (!Array.isArray(rec.workoutRecipe) || rec.workoutRecipe.length === 0) return false;
  const elapsed = Number(rec.elapsedTime) || 0;
  if (elapsed < MIN_RECOVERY_SECONDS) return false;
  const savedAtMs = Number(rec.savedAtMs) || (rec.savedAt ? Date.parse(rec.savedAt) : 0);
  if (!savedAtMs || Number.isNaN(savedAtMs)) return false;
  return true;
}

/**
 * Asinkroni checkpoint zapis (IndexedDB + localStorage backup).
 * Poziva se svakih 5 sekundi i kod ključnih promjena (pauza, skip, +5m, ERG/RES promjena).
 */
export async function saveActiveWorkoutCheckpoint(userId, payload) {
  if (!payload || (Number(payload.elapsedTime) || 0) < MIN_RECOVERY_SECONDS) {
    return false;
  }
  const record = buildRecord(userId, payload);
  let lsOk = writeLocalStorageFallback(userId, record);
  let idbOk = false;
  try {
    idbOk = await writeIdbRecord(record);
  } catch (err) {
    console.warn('[workoutRecoveryStorage] IndexedDB save upozorenje:', err);
  }
  return idbOk || lsOk;
}

/**
 * Sinkroni hitni zapis za `beforeunload` / `pagehide` / `visibilitychange`.
 * Odmah zapisuje u localStorage i pokreće best-effort IndexedDB upis.
 */
export function saveActiveWorkoutSyncBackup(userId, payload) {
  if (!payload || (Number(payload.elapsedTime) || 0) < MIN_RECOVERY_SECONDS) {
    return false;
  }
  const record = buildRecord(userId, payload);
  const lsOk = writeLocalStorageFallback(userId, record);
  // Best-effort IDB upis (ne čekamo Promise jer preglednik možda odmah zatvara tab)
  writeIdbRecord(record).catch(() => {});
  return lsOk;
}

/**
 * Briše nezavršenu sesiju iz oba lokalna spremišta.
 */
export async function clearActiveWorkoutCheckpoint(userId) {
  removeLocalStorageFallback(userId);
  try {
    await deleteIdbRecord(userId);
  } catch (err) {
    console.warn('[workoutRecoveryStorage] IndexedDB clear upozorenje:', err);
  }
}

/**
 * Učitava najnoviji važeći (<= 48h) nezavršeni trening za korisnika.
 * Ako je zapis stariji od 48 sati, automatski ga briše i vraća null.
 */
export async function loadActiveWorkoutCheckpoint(userId) {
  const lsRec = readLocalStorageFallback(userId);
  let idbRec = null;
  try {
    idbRec = await readIdbRecord(userId);
  } catch (err) {
    console.warn('[workoutRecoveryStorage] IndexedDB load upozorenje:', err);
  }

  const candidates = [idbRec, lsRec].filter(isValidCandidate);
  if (candidates.length === 0) {
    return null;
  }

  // Odaberi noviji zapis (ili onaj s više odrađenih sekundi ako su jednako svježi)
  candidates.sort((a, b) => {
    const aMs = Number(a.savedAtMs) || Date.parse(a.savedAt) || 0;
    const bMs = Number(b.savedAtMs) || Date.parse(b.savedAt) || 0;
    if (bMs !== aMs) return bMs - aMs;
    return (Number(b.elapsedTime) || 0) - (Number(a.elapsedTime) || 0);
  });

  const best = candidates[0];
  const savedAtMs = Number(best.savedAtMs) || Date.parse(best.savedAt) || 0;
  const ageMs = Date.now() - savedAtMs;

  if (ageMs > RECOVERY_TTL_MS) {
    await clearActiveWorkoutCheckpoint(userId);
    return null;
  }

  const workoutHistory = unpackWorkoutHistory(best);
  const totalDuration = best.workoutRecipe.reduce((acc, s) => acc + (Number(s?.duration) || 0), 0);
  const lastHistoryTime = workoutHistory.length > 0 ? (workoutHistory[workoutHistory.length - 1].time || 0) : 0;
  const safeElapsed = Math.min(
    Math.max(Number(best.elapsedTime) || 0, lastHistoryTime),
    totalDuration || Math.max(Number(best.elapsedTime) || 0, lastHistoryTime)
  );

  if (safeElapsed < MIN_RECOVERY_SECONDS) {
    return null;
  }

  return {
    userId: best.userId,
    savedAt: best.savedAt || new Date(savedAtMs).toISOString(),
    savedAtMs,
    ageMs,
    sessionStartTime: best.sessionStartTime || null,
    elapsedTime: safeElapsed,
    totalDuration,
    workoutFromCalendar: best.workoutFromCalendar || null,
    workoutRecipe: best.workoutRecipe,
    workoutHistory,
    ergIntensity: Number(best.ergIntensity) || 100,
    controlMode: best.controlMode === 'RES' ? 'RES' : 'ERG',
    virtualGear: Number(best.virtualGear) || 12,
    powerMatchEnabled: Boolean(best.powerMatchEnabled),
    sensors: best.sensors || { trainer: null, pm: null, hr: null, click: null }
  };
}

/**
 * Formatira proteklo vrijeme od prekida u čitljiv hrvatski oblik.
 */
export function formatRecoveryAge(ageMs) {
  const safeMs = Math.max(0, Number(ageMs) || 0);
  const mins = Math.floor(safeMs / 60000);
  if (mins < 1) return 'upravo sada';
  if (mins < 60) return `prije ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `prije ${hours} h ${remMins} min` : `prije ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return 'jučer';
  return `prije ${days} dana`;
}

/**
 * Izračunava sažetak nezavršenog treninga za prikaz u Recovery modalu / banneru.
 */
export function buildRecoverySummary(snapshot) {
  if (!snapshot) return null;
  const recipe = Array.isArray(snapshot.workoutRecipe) ? snapshot.workoutRecipe : [];
  const totalDuration = snapshot.totalDuration || recipe.reduce((acc, s) => acc + (Number(s?.duration) || 0), 0);
  const elapsedTime = snapshot.elapsedTime || 0;
  const progressPct = totalDuration > 0 ? Math.min(100, Math.round((elapsedTime / totalDuration) * 100)) : 0;

  let currentStepIndex = 0;
  let accum = 0;
  for (let i = 0; i < recipe.length; i++) {
    const dur = Number(recipe[i]?.duration) || 0;
    if (elapsedTime >= accum && elapsedTime < accum + dur) {
      currentStepIndex = i;
      break;
    }
    accum += dur;
    if (i === recipe.length - 1) {
      currentStepIndex = i;
    }
  }

  const currentStep = recipe[currentStepIndex] || null;
  const history = Array.isArray(snapshot.workoutHistory) ? snapshot.workoutHistory : [];
  const pwrSamples = history.filter((h) => h.power > 0);
  const hrSamples = history.filter((h) => h.hr > 0);
  const avgPower = pwrSamples.length
    ? Math.round(pwrSamples.reduce((a, b) => a + b.power, 0) / pwrSamples.length)
    : 0;
  const avgHr = hrSamples.length
    ? Math.round(hrSamples.reduce((a, b) => a + b.hr, 0) / hrSamples.length)
    : 0;

  const sensors = snapshot.sensors || {};
  const connectedSensorList = [
    sensors.trainer ? { key: 'trainer', label: sensors.trainer } : null,
    sensors.pm ? { key: 'pm', label: sensors.pm } : null,
    sensors.hr ? { key: 'hr', label: sensors.hr } : null,
    sensors.click ? { key: 'click', label: sensors.click } : null
  ].filter(Boolean);

  const savedDate = snapshot.savedAt ? new Date(snapshot.savedAt) : null;
  const savedTimeLocal = savedDate && !Number.isNaN(savedDate.getTime())
    ? savedDate.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return {
    title: snapshot.workoutFromCalendar?.title || 'Slobodna Vožnja',
    elapsedTime,
    totalDuration,
    progressPct,
    isAtEnd: totalDuration > 0 && elapsedTime >= totalDuration,
    currentStepIndex,
    totalSteps: recipe.length,
    currentStepName: currentStep?.name || 'Interval',
    sampleCount: history.length,
    avgPower,
    avgHr,
    ergIntensity: snapshot.ergIntensity || 100,
    controlMode: snapshot.controlMode || 'ERG',
    virtualGear: snapshot.virtualGear || 12,
    ageText: formatRecoveryAge(Date.now() - (snapshot.savedAtMs || Date.now())),
    savedTimeLocal,
    connectedSensorList
  };
}

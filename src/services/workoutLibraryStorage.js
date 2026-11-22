/**
 * ErgVibe Workout Library Storage Layer
 *
 * Arhitektura knjižnice treninga:
 * - Javni katalog (Supabase `workouts`, `user_id IS NULL`): vidljiv svima, read-only za korisnike (uređuje samo Admin).
 * - Privatna knjižnica prijavljenog korisnika (Supabase `workouts`, `user_id = auth.uid()`): vidljiva i uređiva isključivo vlasniku (RLS).
 * - Privatna knjižnica Gosta (lokalno u pregledniku `localStorage`): nikad ne dira Supabase tablicu, migrira se pri registraciji.
 */

import { supabase } from './supabaseClient';

const GUEST_PRIVATE_WORKOUTS_KEY = 'ergvibe_guest_private_workouts_v1';
const LIBRARY_UPDATED_EVENT = 'ergvibe-library-updated';

export const isGuestUser = (userId) => !userId || userId === 'guest';

export function emitLibraryUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LIBRARY_UPDATED_EVENT));
  }
}

export function onLibraryUpdated(callback) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LIBRARY_UPDATED_EVENT, callback);
  return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, callback);
}

/**
 * Određuje je li trening privatan (pripada korisniku ili gostu) ili javni katalog.
 */
export function isPrivateWorkout(workout) {
  if (!workout) return false;
  return Boolean(workout.isLocalOnly || (workout.user_id !== null && workout.user_id !== undefined && workout.user_id !== ''));
}

/**
 * Određuje smije li trenutni korisnik uređivati ili brisati zadani trening.
 */
export function canManageWorkout(workout, userId, isAdmin = false) {
  if (!workout) return false;
  if (isGuestUser(userId)) {
    return Boolean(workout.isLocalOnly || workout.user_id === 'guest');
  }
  if (isAdmin) {
    // Admin može upravljati javnim katalogom (user_id == null) i vlastitim privatnim treninzima
    return !workout.user_id || workout.user_id === userId;
  }
  return Boolean(workout.user_id && workout.user_id === userId);
}

// --- LOKALNO SPREMIŠTE ZA GOSTE ---

export function loadGuestPrivateWorkouts() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_PRIVATE_WORKOUTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((w) => ({
      ...w,
      user_id: 'guest',
      isLocalOnly: true
    }));
  } catch {
    return [];
  }
}

function saveGuestPrivateWorkouts(list) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_PRIVATE_WORKOUTS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch (err) {
    console.warn('[workoutLibraryStorage] Nije moguće spremiti lokalne treninge gosta:', err);
    throw new Error('Lokalna memorija preglednika je puna. Prijavi se za pohranu u oblaku.');
  }
}

export function clearGuestPrivateWorkouts() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_PRIVATE_WORKOUTS_KEY);
  } catch {
    // ignore
  }
}

function sanitizeWorkoutRecord(w) {
  return {
    title: String(w?.title || 'Novi Trening').trim() || 'Novi Trening',
    description: String(w?.description || '').trim(),
    duration_seconds: Math.max(60, Math.round(Number(w?.duration_seconds) || 0)),
    difficulty_score: Number.isFinite(Number(w?.difficulty_score)) ? Number(w.difficulty_score) : 1.0,
    category: w?.category || 'Ostalo',
    steps: Array.isArray(w?.steps) ? w.steps : []
  };
}

// --- GLAVNE OPERACIJE KNJIŽNICE ---

/**
 * Dohvaća javni katalog + privatne treninge korisnika (cloud ili guest lokalno).
 */
export async function fetchLibraryWorkouts(userId) {
  let remoteWorkouts = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('workouts')
      .select('*')
      .order('difficulty_score', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    remoteWorkouts = remoteWorkouts.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  // Dodatna klijentska zaštita (uz Supabase RLS): gost vidi samo javni katalog iz baze + svoje lokalne treninge
  if (isGuestUser(userId)) {
    const publicOnly = remoteWorkouts.filter((w) => !w.user_id);
    const guestPrivate = loadGuestPrivateWorkouts();
    return [...guestPrivate, ...publicOnly];
  }

  // Prijavljeni korisnik vidi javni katalog (user_id == null) + vlastite (user_id === userId)
  return remoteWorkouts.filter((w) => !w.user_id || w.user_id === userId);
}

/**
 * Sprema jedan ili više treninga:
 * - Gost -> isključivo lokalno u preglednik
 * - Prijavljeni korisnik -> u Supabase pod njegovim `user_id` (privatno)
 * - Admin uz `asPublic: true` -> u Supabase s `user_id: null` (javni katalog)
 */
export async function insertLibraryWorkouts({ workouts, userId, isAdmin = false, asPublic = false }) {
  const list = Array.isArray(workouts) ? workouts : [workouts];
  if (list.length === 0) return [];

  if (isGuestUser(userId)) {
    const existing = loadGuestPrivateWorkouts();
    const nowIso = new Date().toISOString();
    const created = list.map((w, idx) => ({
      ...sanitizeWorkoutRecord(w),
      id: `guest_wk_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: 'guest',
      isLocalOnly: true,
      created_at: nowIso
    }));
    saveGuestPrivateWorkouts([...created, ...existing]);
    emitLibraryUpdated();
    return created;
  }

  const targetUserId = asPublic && isAdmin ? null : userId;
  const payload = list.map((w) => ({
    ...sanitizeWorkoutRecord(w),
    user_id: targetUserId
  }));

  const { data, error } = await supabase.from('workouts').insert(payload).select();
  if (error) {
    // Ako user_id stupac još nije dodan u staroj Supabase shemi, javi jasnu poruku
    if (String(error.message || '').includes('user_id')) {
      throw new Error(
        'Tablica workouts još nema stupac user_id. Pokreni SQL migraciju (supabase_security_and_library_migration.sql) u Supabaseu.'
      );
    }
    throw error;
  }

  emitLibraryUpdated();
  return data || [];
}

/**
 * Ažurira naslov, kategoriju, opis ili ocjenu težine treninga.
 */
export async function updateLibraryWorkout({ workout, patch, userId, isAdmin = false }) {
  if (!workout?.id) throw new Error('Nedostaje ID treninga.');
  if (!canManageWorkout(workout, userId, isAdmin)) {
    throw new Error('Nemaš dopuštenje za uređivanje javnog treninga.');
  }

  if (workout.isLocalOnly || isGuestUser(userId)) {
    const existing = loadGuestPrivateWorkouts();
    const next = existing.map((w) => (w.id === workout.id ? { ...w, ...patch } : w));
    saveGuestPrivateWorkouts(next);
    emitLibraryUpdated();
    return;
  }

  const { error } = await supabase.from('workouts').update(patch).eq('id', workout.id);
  if (error) throw error;
  emitLibraryUpdated();
}

/**
 * Briše trening (samo vlastiti privatni ili javni ako je korisnik Admin).
 */
export async function deleteLibraryWorkout({ workout, userId, isAdmin = false }) {
  if (!workout?.id) throw new Error('Nedostaje ID treninga.');
  if (!canManageWorkout(workout, userId, isAdmin)) {
    throw new Error('Nemaš dopuštenje za brisanje javnog treninga.');
  }

  if (workout.isLocalOnly || isGuestUser(userId)) {
    const existing = loadGuestPrivateWorkouts();
    const next = existing.filter((w) => w.id !== workout.id);
    saveGuestPrivateWorkouts(next);
    emitLibraryUpdated();
    return;
  }

  const { error } = await supabase.from('workouts').delete().eq('id', workout.id);
  if (error) throw error;
  emitLibraryUpdated();
}

/**
 * Samo Admin: prebacuje trening između Javnog kataloga (`user_id: null`) i svoje Privatne knjižnice (`user_id: adminId`).
 */
export async function setWorkoutPublicStatus({ workout, makePublic, userId, isAdmin = false }) {
  if (!isAdmin || isGuestUser(userId)) {
    throw new Error('Samo administrator može mijenjati vidljivost u javnom katalogu.');
  }
  if (!workout?.id || workout.isLocalOnly) {
    throw new Error('Ovaj trening nije pohranjen u Supabase bazi.');
  }

  const nextUserId = makePublic ? null : userId;
  const { error } = await supabase
    .from('workouts')
    .update({ user_id: nextUserId })
    .eq('id', workout.id);

  if (error) throw error;
  emitLibraryUpdated();
}

/**
 * Pri prelasku Gosta u prijavljeni račun, prebacuje njegove lokalne privatne treninge u Supabase pod njegovim `user_id`.
 */
export async function migrateGuestPrivateWorkoutsToSupabase(newUserId) {
  if (!newUserId || newUserId === 'guest') return 0;
  const guestWorkouts = loadGuestPrivateWorkouts();
  if (guestWorkouts.length === 0) return 0;

  try {
    const payload = guestWorkouts.map((w) => ({
      ...sanitizeWorkoutRecord(w),
      user_id: newUserId
    }));
    const { error } = await supabase.from('workouts').insert(payload);
    if (!error) {
      clearGuestPrivateWorkouts();
      emitLibraryUpdated();
      return payload.length;
    }
    console.warn('[workoutLibraryStorage] Migracija gost treninga nije uspjela:', error.message);
    return 0;
  } catch (err) {
    console.warn('[workoutLibraryStorage] Greška pri migraciji gost treninga:', err);
    return 0;
  }
}

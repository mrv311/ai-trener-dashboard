import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchIntervalsData, updateEventDate, updateEventDetails } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';
import { parseWorkoutDoc, categorizeWorkout, calculateCategoryDifficulty } from '../utils/workoutParser';

// Helper: određuje je li aktivnost cycling tipa na temelju workout_source
const isCyclingActivity = (sbAct) => {
  if (!sbAct.workout_source) return true; // default je cycling
  const src = sbAct.workout_source.toLowerCase();
  if (src === 'free_ride' || src === 'calendar' || src === 'library' || src === 'local') return true;
  if (src.startsWith('external_upload_')) {
    const sport = src.replace('external_upload_', '');
    return ['cycling', 'virtual_ride', 'biking', 'ride'].includes(sport);
  }
  if (src === 'external_upload') {
    return sbAct.avg_power > 0; // pretpostavljamo cycling ako ima wate
  }
  return true;
};

// localStorage ključevi za persistenciju parova
const STORAGE_KEY_UNPAIRED = 'ergvibe_unpaired_list';
const STORAGE_KEY_EXPLICIT_PAIRS = 'ergvibe_explicit_pairs';

export function useIntervalsData(intervalsId, intervalsKey, userId, { onRescheduleError } = {}) {
  const [rawActivities, setRawActivities] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [wellnessData, setWellnessData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Inicijaliziraj iz localStorage za persistenciju
  const [unpairedList, setUnpairedList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_UNPAIRED) || '[]'); } catch { return []; }
  });
  const [explicitPairings, setExplicitPairings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_EXPLICIT_PAIRS) || '{}'); } catch { return {}; }
  });
  const [localRefreshTrigger, setLocalRefreshTrigger] = useState(0);
  const [supabaseActivities, setSupabaseActivities] = useState([]);

  // Persist unpairedList i explicitPairings u localStorage kad se promijene
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_UNPAIRED, JSON.stringify(unpairedList)); } catch {}
  }, [unpairedList]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_EXPLICIT_PAIRS, JSON.stringify(explicitPairings)); } catch {}
  }, [explicitPairings]);

  const fetchWorkouts = useCallback(async () => {
    if (!intervalsId || !intervalsKey) {
      setRawActivities([]);
      setRawEvents([]);
      setWellnessData({});
    }
    setIsLoading(true);
    setError(null);
    try {
      // 1. Dohvati Intervals.icu podatke (ako postoje)
      if (intervalsId && intervalsKey) {
        const data = await fetchIntervalsData(intervalsId, intervalsKey);

        const hiddenList = JSON.parse(localStorage.getItem(`ai_trener_hidden_intervals_activities_${userId || 'guest'}`) || '[]');
        setRawActivities(data.activities.filter(act => !hiddenList.includes(String(act.id))));
        setRawEvents(data.events);

        const mappedWellness = {};
        data.wellness.forEach(w => {
          const formatDur = (mins) => {
            const h = Math.floor(mins / 60);
            return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`;
          };
          mappedWellness[w.id] = {
            restingHR: w.restingHR,
            hrv: w.hrv,
            sleep: w.sleepSecs ? formatDur(Math.round(w.sleepSecs / 60)) : null,
            ctl: w.ctl,
            atl: w.atl,
            tsb: w.tsb
          };
        });
        setWellnessData(mappedWellness);
      }

      // 2. Dohvati lokalne aktivnosti iz Supabase (zadnjih 90 dana)
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        if (!userId) {
          setSupabaseActivities([]);
          return;
        }

        const { data: supabaseData, error: supabaseError } = await supabase
          .from('completed_activities')
          .select('id, started_at, title, workout_source, duration_seconds, avg_power, avg_hr, np, tss, if_factor')
          .eq('user_id', userId)
          .in('workout_source', ['local', 'free_ride', 'calendar', 'library']) // Svi treninzi odrađeni u ovoj aplikaciji
          .gte('started_at', ninetyDaysAgo.toISOString())
          .order('started_at', { ascending: false });

        let combinedLocalActivities = [];

        if (!supabaseError && supabaseData) {
          console.log('[useIntervalsData] Dohvaćeno', supabaseData.length, 'lokalnih aktivnosti iz Supabase');
          combinedLocalActivities = [...supabaseData];
        } else if (supabaseError) {
          console.warn('[useIntervalsData] Greška pri dohvaćanju Supabase aktivnosti:', supabaseError);
        }

        // Pročitaj i localStorage fallback aktivnosti
        try {
          const localFallback = JSON.parse(localStorage.getItem(`ai_trener_local_completed_activities_${userId || 'guest'}`) || '[]');

          // Dodaj one iz localStorage-a koje već nemamo u Supabase podacima
          // Uspoređujemo po started_at (isti trening bi trebao imati vrlo sličan timestamp)
          localFallback.forEach(localAct => {
            // Provjeri postoji li već aktivnost s istim vremenom početka (±1 minutu tolerancije)
            const localTime = new Date(localAct.started_at).getTime();
            const existingSbAct = combinedLocalActivities.find(sbAct => {
              const sbTime = new Date(sbAct.started_at).getTime();
              return Math.abs(sbTime - localTime) < 60000;
            });

            if (!existingSbAct) {
              combinedLocalActivities.push(localAct);
            } else if (localAct.workout_doc && !existingSbAct.workout_doc) {
              existingSbAct.workout_doc = localAct.workout_doc;
            }
          });
        } catch (e) {
          console.warn('[useIntervalsData] Greška pri čitanju localStorage aktivnosti:', e);
        }

        // Sortiraj descending po datumu
        combinedLocalActivities.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
        setSupabaseActivities(combinedLocalActivities);

      } catch (supabaseErr) {
        console.warn('[useIntervalsData] Lokalno dohvaćanje nije uspjelo:', supabaseErr);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [intervalsId, intervalsKey, userId]);

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  // Listener za ažuriranje naziva aktivnosti
  useEffect(() => {
    const handleTitleUpdate = (event) => {
      const { activityId, newTitle } = event.detail;
      console.log('[useIntervalsData] Ažuriram naziv aktivnosti:', activityId, 'na:', newTitle);

      // Ažuriraj u rawActivities ako postoji
      setRawActivities(prev => prev.map(act =>
        `act-${act.id}` === activityId || act.id.toString() === activityId.replace('act-', '')
          ? { ...act, name: newTitle }
          : act
      ));

      // Trigger refresh da se workouts useMemo ponovno izračuna
      setLocalRefreshTrigger(prev => prev + 1);
    };

    window.addEventListener('activity-title-updated', handleTitleUpdate);
    return () => window.removeEventListener('activity-title-updated', handleTitleUpdate);
  }, []);

  const workouts = useMemo(() => {
    console.log('[useIntervalsData] Računam workouts. Supabase aktivnosti:', supabaseActivities.length, 'Intervals aktivnosti:', rawActivities.length);

    const finalWorkouts = [];
    const consumedEvents = new Set();
    const consumedLocalIds = new Set();
    const consumedSupabaseIds = new Set();
    const supabaseDateMap = new Map(); // Mapa za brzu provjeru Supabase aktivnosti po datumu
    const todayStr = new Date().toISOString().split('T')[0];

    const localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');

    // Kreiraj Map objekte za O(1) lookup - OPTIMIZACIJA
    const eventsByDate = new Map();
    rawEvents.forEach(e => {
      if (e.category !== 'WORKOUT') return;
      const date = e.start_date_local?.split('T')[0];
      if (!date) return;
      if (!eventsByDate.has(date)) eventsByDate.set(date, []);
      eventsByDate.get(date).push(e);
    });

    const localByDate = new Map();
    localScheduled.forEach(lw => {
      if (!localByDate.has(lw.date)) localByDate.set(lw.date, []);
      localByDate.get(lw.date).push(lw);
    });

    // 0. PRIORITET: Prvo dodaj Supabase lokalne aktivnosti (najsvježije, upravo završene)
    supabaseActivities.forEach(sbAct => {
      let actDate = '';
      if (sbAct.started_at) {
        // Parse date in local timezone to avoid UTC boundary issues
        const d = new Date(sbAct.started_at);
        actDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      // Debug logging za provjeru duplikata
      if (supabaseDateMap.has(actDate)) {
        console.warn('[useIntervalsData] DUPLIKAT DETEKTIRAN: Već postoji Supabase aktivnost za datum', actDate, 'ID:', supabaseDateMap.get(actDate), 'Nova ID:', sbAct.id);
      }

      supabaseDateMap.set(actDate, sbAct.id); // Označi da ovaj datum ima Supabase aktivnost

      const actKey = `supabase-${sbAct.id}`;
      const isCycling = isCyclingActivity(sbAct);

      // Pokušaj spariti s Intervals.icu eventom PRVO (viši prioritet) - O(k) gdje je k broj evenata za datum
      let pairedEvent = null;
      let separatedEventIds = [];

      const eventsForDate = eventsByDate.get(actDate) || [];

      // 1. PROVJERA: Ima li eksplicitno sparen event (korisnik je ručno spojio)?
      const explicitEventId = explicitPairings[actKey];
      if (explicitEventId && !String(explicitEventId).startsWith('local-')) {
        const explicitEvent = eventsForDate.find(e => String(e.id) === String(explicitEventId));
        if (explicitEvent && !consumedEvents.has(explicitEvent.id)) {
          pairedEvent = explicitEvent;
          consumedEvents.add(explicitEvent.id);
        }
      }

      // 2. Ako nema eksplicitnog para, traži po tipu/sportu
      if (!pairedEvent) {
        for (let e of eventsForDate) {
          if (unpairedList.includes(`supabase-${sbAct.id}-${e.id}`)) {
            separatedEventIds.push(e.id);
          } else if (!consumedEvents.has(e.id) && !pairedEvent) {
            // SMART MATCHING: Cycling eventi (WORKOUT) se sparuju samo s cycling aktivnostima
            if (!isCycling) {
              // Non-cycling aktivnost ne bi trebala automatski hvatati cycling event
              separatedEventIds.push(e.id);
              continue;
            }
            pairedEvent = e;
            consumedEvents.add(e.id);
          }
        }
      }

      // 3. Ako nema Intervals eventa, pokušaj spariti s lokalnim planiranim treningom
      let pairedLocal = null;
      if (!pairedEvent) {
        // Provjeri eksplicitni lokalni par
        if (explicitEventId && String(explicitEventId).startsWith('local-')) {
          const localId = explicitEventId.replace('local-', '');
          const localForDate = localByDate.get(actDate) || [];
          const explicitLocal = localForDate.find(lw => lw.id === localId);
          if (explicitLocal && !consumedLocalIds.has(explicitLocal.id)) {
            pairedLocal = explicitLocal;
            consumedLocalIds.add(explicitLocal.id);
          }
        }

        if (!pairedLocal) {
          const localForDate = localByDate.get(actDate) || [];
          for (let lw of localForDate) {
            if (unpairedList.includes(`supabase-${sbAct.id}-local-${lw.id}`)) {
              separatedEventIds.push(`local-${lw.id}`);
            } else if (!consumedLocalIds.has(lw.id) && isCycling) {
              // Samo cycling aktivnosti automatski sparuju s lokalnim treninzima
              pairedLocal = lw;
              consumedLocalIds.add(lw.id);
              break;
            }
          }
        }
      }

      let plannedTssDisplay = null;
      let plannedDurDisplay = null;
      let eventIdObj = null;
      let diffScore = null;
      let actCategory = null;
      let workoutDoc = null;
      let complianceColor = 'blue';

      // Postavi podatke ovisno o tome što je spareno
      if (pairedEvent) {
        eventIdObj = pairedEvent.id;
        plannedTssDisplay = Math.round(pairedEvent.icu_training_load || 0);
        plannedDurDisplay = Math.round((pairedEvent.moving_time || 0) / 60);
        workoutDoc = pairedEvent.workout_doc;
      } else if (pairedLocal) {
        eventIdObj = `local-${pairedLocal.id}`;
        plannedTssDisplay = Math.round(pairedLocal.tss || 0);
        plannedDurDisplay = pairedLocal.duration_seconds ? Math.round(pairedLocal.duration_seconds / 60) : pairedLocal.duration;
        diffScore = pairedLocal.difficulty_score;
        actCategory = pairedLocal.category;
        workoutDoc = pairedLocal.steps;
      }

      // Izračunaj compliance ako je spareno
      if (pairedEvent || pairedLocal) {
        const actualTss = Math.round(sbAct.tss || 0);
        const actualDur = Math.round((sbAct.duration_seconds || 0) / 60);

        let ratio = 1;
        if (plannedTssDisplay > 0 && actualTss > 0) ratio = actualTss / plannedTssDisplay;
        else if (plannedDurDisplay > 0 && actualDur > 0) ratio = actualDur / plannedDurDisplay;

        if (ratio >= 0.8 && ratio <= 1.2) complianceColor = 'green';
        else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) complianceColor = 'yellow';
        else complianceColor = 'red';
      } else {
        // Fallback ako nije spareno s planiranim treningom (free ride ili garmin sync)
        if (sbAct.tss > 0 || sbAct.duration_seconds > 0) {
          complianceColor = 'blue'; // Plavi ako je odrađen ali neplaniran
        }
      }

      // Ako je spojen event s intervalima, procesiraj za difficulty
      let targetNpVal = null;
      if (pairedEvent && !diffScore && pairedEvent.workout_doc) {
        try {
          // parse intervals code to extract difficulty
          const ftp = Number(localStorage.getItem('ai_trener_user_ftp')) || 250;
          const parsed = parseWorkoutDoc(pairedEvent.workout_doc, ftp);
          if (parsed && parsed.allSteps && parsed.allSteps.length > 0) {
            actCategory = categorizeWorkout(parsed.allSteps);
            diffScore = calculateCategoryDifficulty(parsed.allSteps, actCategory);
            targetNpVal = parsed.np;
          }
        } catch (e) {
          console.error("Error parsing intervals code for supabase activity:", e);
        }
      }

      // Koristi isCycling iz gornjeg smart matching bloka
      let defaultCategory = isCycling ? 'WORKOUT' : 'OTHER';

      finalWorkouts.push({
        id: `supabase-${sbAct.id}`,
        actId: `supabase-${sbAct.id}`,
        supabaseId: sbAct.id,
        eventId: eventIdObj,
        separatedEventIds,
        date: actDate,
        started_at: sbAct.started_at,
        title: sbAct.title || 'Lokalni Trening',
        duration: Math.round((sbAct.duration_seconds || 0) / 60),
        plannedDuration: plannedDurDisplay,
        tss: Math.round(sbAct.tss || 0),
        plannedTss: plannedTssDisplay,
        statusColor: complianceColor,
        isCompleted: true,
        isSupabase: true, // Oznaka da je iz Supabase-a (prioritet!)
        workout_source: sbAct.workout_source || 'local', // Izvor aktivnosti (calendar, library, free_ride, garmin, strava, etc.)
        difficulty_score: diffScore,
        category: actCategory || defaultCategory,
        workout_doc: workoutDoc || sbAct.workout_doc,
        targetNP: targetNpVal ? Math.round(targetNpVal) : null,
        np: Math.round(sbAct.np || 0),
        average_power: Math.round(sbAct.avg_power || 0),
        average_heartrate: Math.round(sbAct.avg_hr || 0)
      });

      consumedSupabaseIds.add(sbAct.id);
    });

    // 1. Dodaj Intervals.icu aktivnosti (samo ako NE postoji Supabase aktivnost za taj datum)
    rawActivities.forEach(act => {
      const actDate = act.start_date_local ? act.start_date_local.split('T')[0] : '';

      // PROVJERA: Preskoči ako već postoji Supabase aktivnost s istim ili sličnim vremenom početka (±15 min)
      // Ovo sprječava dupliciranje istog treninga koji je poslan na Intervals pa se sad vraća
      const actTime = new Date(act.start_date).getTime();
      const isDuplicate = supabaseActivities.some(sbAct => {
        const sbTime = new Date(sbAct.started_at).getTime();
        return Math.abs(sbTime - actTime) < 15 * 60 * 1000;
      });

      if (isDuplicate) {
        console.log('[useIntervalsData] ✓ Preskačem Intervals.icu aktivnost', act.id, 'jer je duplikat Supabase aktivnosti (slično vrijeme početka)');
        return;
      }

      let pairedEvent = null;
      let separatedEventIds = [];

      const actKey = `act-${act.id}`;
      const isActCycling = ['Ride', 'VirtualRide', 'EBikeRide', 'Handcycle'].includes(act.type);
      let defaultCategory = isActCycling ? 'WORKOUT' : 'OTHER';

      // O(k) lookup umjesto O(n)
      const eventsForDate = eventsByDate.get(actDate) || [];

      // 1. Provjeri eksplicitni par
      const explicitEventId = explicitPairings[actKey];
      if (explicitEventId && !String(explicitEventId).startsWith('local-')) {
        const explicitEvent = eventsForDate.find(e => String(e.id) === String(explicitEventId));
        if (explicitEvent && !consumedEvents.has(explicitEvent.id)) {
          pairedEvent = explicitEvent;
          consumedEvents.add(explicitEvent.id);
        }
      }

      // 2. Auto-matching ako nema eksplicitnog para
      if (!pairedEvent) {
        for (let e of eventsForDate) {
          if (unpairedList.includes(`${act.id}-${e.id}`)) {
            separatedEventIds.push(e.id);
          } else if (!consumedEvents.has(e.id) && !pairedEvent) {
            // SMART MATCHING: Cycling eventi se sparuju samo s cycling aktivnostima
            if (!isActCycling) {
              separatedEventIds.push(e.id);
              continue;
            }
            pairedEvent = e;
            consumedEvents.add(e.id);
          }
        }
      }

      let pairedLocal = null;
      if (!pairedEvent) {
        // Provjeri eksplicitni lokalni par
        if (explicitEventId && String(explicitEventId).startsWith('local-')) {
          const localId = explicitEventId.replace('local-', '');
          const localForDate = localByDate.get(actDate) || [];
          const explicitLocal = localForDate.find(lw => lw.id === localId);
          if (explicitLocal && !consumedLocalIds.has(explicitLocal.id)) {
            pairedLocal = explicitLocal;
            consumedLocalIds.add(explicitLocal.id);
          }
        }

        if (!pairedLocal) {
          const localForDate = localByDate.get(actDate) || [];
          for (let lw of localForDate) {
            if (unpairedList.includes(`${act.id}-local-${lw.id}`)) {
              separatedEventIds.push(`local-${lw.id}`);
            } else if (!pairedEvent && !pairedLocal && !consumedLocalIds.has(lw.id)) {
              pairedLocal = lw;
              consumedLocalIds.add(lw.id);
            }
          }
        }
      }

      let complianceColor = 'blue';
      let plannedTssDisplay = null;
      let plannedDurDisplay = null;
      let eventIdObj = null;
      let diffScore = null;
      let actCategory = null;
      let workoutDoc = null;
      let targetNpVal = null;

      if (pairedEvent || pairedLocal) {
        if (pairedEvent) {
          eventIdObj = pairedEvent.id;
          plannedTssDisplay = Math.round(pairedEvent.icu_training_load || 0);
          plannedDurDisplay = Math.round((pairedEvent.moving_time || 0) / 60);
          workoutDoc = pairedEvent.workout_doc;
        } else {
          eventIdObj = `local-${pairedLocal.id}`;
          plannedTssDisplay = Math.round(pairedLocal.tss || 0);
          plannedDurDisplay = pairedLocal.duration_seconds ? Math.round(pairedLocal.duration_seconds / 60) : pairedLocal.duration;
          diffScore = pairedLocal.difficulty_score;
          actCategory = pairedLocal.category;
          workoutDoc = pairedLocal.steps;
        }

        const actualTss = Math.round(act.icu_training_load || 0);
        const actualDur = Math.round((act.moving_time || 0) / 60);

        let ratio = 1;
        if (plannedTssDisplay > 0 && actualTss > 0) ratio = actualTss / plannedTssDisplay;
        else if (plannedDurDisplay > 0 && actualDur > 0) ratio = actualDur / plannedDurDisplay;

        if (ratio >= 0.8 && ratio <= 1.2) complianceColor = 'green';
        else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) complianceColor = 'yellow';
        else complianceColor = 'red';
      } else {
        // Fallback ako nije spareno s planiranim treningom (free ride ili garmin sync)
        if (act.icu_training_load > 0 || act.moving_time > 0) {
          complianceColor = 'blue';
        }
      }

      // Ako je to Intervals aktivnost, pokušaj parsati opis (koji bi trebao sadržavati workout_doc)
      if (!diffScore && (workoutDoc || act.description)) {
        try {
          const ftp = Number(localStorage.getItem('ai_trener_user_ftp')) || 250;
          const docToParse = workoutDoc || act.description;
          const parsed = parseWorkoutDoc(docToParse, ftp);
          if (parsed && parsed.allSteps && parsed.allSteps.length > 0) {
            actCategory = categorizeWorkout(parsed.allSteps);
            diffScore = calculateCategoryDifficulty(parsed.allSteps, actCategory);
            targetNpVal = parsed.np;
          }
        } catch (e) {
          console.error("Error parsing intervals code for activity:", e);
        }
      }

      finalWorkouts.push({
        id: `act-${act.id}`, actId: act.id, eventId: eventIdObj, separatedEventIds,
        date: actDate, started_at: act.start_date_local || act.start_date, title: act.name || 'Trening',
        duration: Math.round((act.moving_time || 0) / 60), plannedDuration: plannedDurDisplay,
        tss: Math.round(act.icu_training_load || 0), plannedTss: plannedTssDisplay,
        statusColor: complianceColor, isCompleted: true,
        difficulty_score: diffScore,
        category: actCategory || defaultCategory,
        workout_doc: workoutDoc,
        targetNP: targetNpVal ? Math.round(targetNpVal) : null,
        np: Math.round(act.icu_normalized_power || act.normalized_power || 0),
        average_power: Math.round(act.icu_average_power || act.average_watts || act.average_power || 0),
        max_power: Math.round(act.icu_max_power || act.max_watts || act.max_power || 0),
        average_heartrate: Math.round(act.icu_average_hr || act.average_heartrate || act.average_hr || 0)
      });
    });

    // 2. Dodaj planirane evente iz Intervals.icu
    rawEvents.forEach(ev => {
      if (ev.category !== 'WORKOUT' || consumedEvents.has(ev.id)) return;
      if (ev.activity_id && !unpairedList.some(pair => pair.endsWith(`-${ev.id}`))) return;

      const evDate = ev.start_date_local ? ev.start_date_local.split('T')[0] : '';
      let complianceColor = 'grey';
      if (evDate < todayStr) complianceColor = 'red-missed';

      let diffScore = null;
      let actCategory = null;

      if (ev.workout_doc || ev.description) {
        try {
          const ftp = Number(localStorage.getItem('ai_trener_user_ftp')) || 250;
          const docToParse = ev.workout_doc || ev.description;
          const parsed = parseWorkoutDoc(docToParse, ftp);
          if (parsed && parsed.allSteps && parsed.allSteps.length > 0) {
            actCategory = categorizeWorkout(parsed.allSteps);
            diffScore = calculateCategoryDifficulty(parsed.allSteps, actCategory);
          }
        } catch (e) {
          console.error("Error parsing intervals code for event:", e);
        }
      }

      finalWorkouts.push({
        id: `ev-${ev.id}`, eventId: ev.id, date: evDate, title: ev.name || 'Planirano',
        duration: Math.round((ev.moving_time || 0) / 60), plannedDuration: Math.round((ev.moving_time || 0) / 60),
        tss: Math.round(ev.icu_training_load || 0), plannedTss: Math.round(ev.icu_training_load || 0),
        statusColor: complianceColor, isCompleted: false,
        workout_doc: ev.workout_doc,
        difficulty_score: diffScore,
        category: actCategory
      });
    });

    // 3. Dodaj lokalne planirane treninze (koji nisu spareni)
    localScheduled.forEach(sched => {
      if (consumedLocalIds.has(sched.id)) return;
      let complianceColor = 'grey';
      if (sched.date < todayStr) complianceColor = 'red-missed';
      finalWorkouts.push({
        id: `local-${sched.id}`,
        date: sched.date,
        title: sched.title,
        duration: sched.duration_seconds ? Math.round(sched.duration_seconds / 60) : sched.duration,
        plannedDuration: sched.duration_seconds ? Math.round(sched.duration_seconds / 60) : sched.duration,
        tss: sched.tss,
        plannedTss: sched.tss,
        statusColor: complianceColor,
        isCompleted: false,
        isLocal: true,
        steps: sched.steps,
        category: sched.category,
        difficulty_score: sched.difficulty_score
      });
    });

    console.log('[useIntervalsData] Završeno računanje. Ukupno workouts:', finalWorkouts.length, 'Supabase datumi u mapi:', Array.from(supabaseDateMap.keys()).sort());

    return finalWorkouts;
  }, [rawActivities, rawEvents, supabaseActivities, unpairedList, explicitPairings, localRefreshTrigger]);

  const handleUnpair = useCallback((actId, eventId) => {
    if (!actId || !eventId) return;
    setUnpairedList(prev => [...prev, `${actId}-${eventId}`]);
    // Obriši eksplicitni par ako postoji
    setExplicitPairings(prev => {
      const next = { ...prev };
      delete next[actId];
      return next;
    });
  }, []);

  const handlePair = useCallback((actId, eventId) => {
    if (!actId || !eventId) return;
    setUnpairedList(prev => prev.filter(pair => pair !== `${actId}-${eventId}`));
    // Spremi eksplicitni par koji će preživjeti refresh
    setExplicitPairings(prev => ({ ...prev, [actId]: eventId }));
  }, []);

  const handleDeleteLocalActivity = useCallback(async (workoutId) => {
    if (!workoutId) return;

    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      localScheduled = localScheduled.filter(w => w.id !== rawId);
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
      setLocalRefreshTrigger(prev => prev + 1);
    } else if (workoutId.startsWith('ev-')) {
      const rawId = workoutId.replace('ev-', '');
      // Optimistic delete
      setRawEvents(prev => prev.filter(e => String(e.id) !== rawId));
      try {
        const { deleteEvent } = await import('../services/intervalsApi');
        await deleteEvent(intervalsId, intervalsKey, rawId);
        setLocalRefreshTrigger(prev => prev + 1);
      } catch (err) {
        console.error('Delete Event API error:', err);
        // Fallback u slučaju greške bi bio ponovno učitavanje, ali za sad samo logiramo
      }
    }
  }, [intervalsId, intervalsKey]);

  /**
   * Briše odrađenu aktivnost iz Supabase baze.
   * Koristi se za brisanje lokalnih završenih treninga iz kalendara.
   */
  const handleDeleteCompletedActivity = useCallback(async (activityId) => {
    if (!activityId) return;

    if (activityId.startsWith('supabase-')) {
      const rawId = activityId.replace('supabase-', '');
      try {
        const { error } = await supabase
          .from('completed_activities')
          .delete()
          .eq('id', rawId);

        if (error) {
          console.warn('Greška pri brisanju Supabase aktivnosti, pokušavam obrisati samo lokalno:', error);
        }

        // Obriši i iz localStorage fallbacka
        try {
          const localFallback = JSON.parse(localStorage.getItem(`ai_trener_local_completed_activities_${userId || 'guest'}`) || '[]');
          const updatedFallback = localFallback.filter(act => act.id !== rawId && act.id !== `local_act_${rawId}`);
          localStorage.setItem(`ai_trener_local_completed_activities_${userId || 'guest'}`, JSON.stringify(updatedFallback));
        } catch (e) {
          console.warn('Greška pri brisanju iz localStorage:', e);
        }

        // Odmah ukloni iz lokalnog stanja
        setSupabaseActivities(prev => prev.filter(act => act.id !== rawId && act.id !== `local_act_${rawId}`));

        // Osvježi podatke
        setLocalRefreshTrigger(prev => prev + 1);
        return { success: true };
      } catch (err) {
        console.error('Kritična greška pri brisanju:', err);
        return { success: false, error: err.message };
      }
    } else if (activityId.startsWith('act-')) {
      // Skrivanje Intervals.icu aktivnosti lokalno
      const rawId = activityId.replace('act-', '');
      try {
        const hiddenList = JSON.parse(localStorage.getItem(`ai_trener_hidden_intervals_activities_${userId || 'guest'}`) || '[]');
        if (!hiddenList.includes(rawId)) {
          hiddenList.push(rawId);
          localStorage.setItem(`ai_trener_hidden_intervals_activities_${userId || 'guest'}`, JSON.stringify(hiddenList));
        }
        
        // Ažuriraj stanje i triggeraj osvježavanje kako bi nestalo iz UI-ja
        setRawActivities(prev => prev.filter(act => String(act.id) !== rawId));
        setLocalRefreshTrigger(prev => prev + 1);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    } else {
      return { success: false, error: 'Ovu aktivnost nije moguće obrisati.' };
    }
  }, []);

  /**
   * Premješta trening na novi datum (D&D reschedule).
   * Podržava lokalne treninge (localStorage) i Intervals.icu evente (API PUT).
   * Koristi optimistic UI — odmah ažurira stanje, API poziv u pozadini.
   */
  const handleRescheduleWorkout = useCallback(async (workoutId, newDate) => {
    // --- Lokalni treninzi ---
    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const idx = localScheduled.findIndex(w => w.id === rawId);
      if (idx === -1) return;
      localScheduled[idx].date = newDate;
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
      setLocalRefreshTrigger(prev => prev + 1);
      return;
    }

    // --- Intervals.icu eventi ---
    if (workoutId.startsWith('ev-')) {
      const eventId = workoutId.replace('ev-', '');
      // Optimistic: odmah pomakni u lokalnom stanju
      const oldDate = rawEvents.find(e => String(e.id) === eventId)?.start_date_local?.split('T')[0];
      setRawEvents(prev => prev.map(e =>
        String(e.id) === eventId
          ? { ...e, start_date_local: `${newDate}T08:00:00` }
          : e
      ));

      try {
        await updateEventDate(intervalsId, intervalsKey, eventId, newDate);
      } catch (err) {
        // Revert na stari datum ako API poziv padne
        console.error('Reschedule API error:', err);
        if (oldDate) {
          setRawEvents(prev => prev.map(e =>
            String(e.id) === eventId
              ? { ...e, start_date_local: `${oldDate}T08:00:00` }
              : e
          ));
        }
        onRescheduleError?.(err.message || 'Greška pri premještanju treninga');
      }
    }
  }, [rawEvents, intervalsId, intervalsKey, onRescheduleError]);

  const handleUpdateWorkout = useCallback(async (workoutId, title, workout_doc, calculatedTss, calculatedDuration) => {
    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const idx = localScheduled.findIndex(w => w.id === rawId);
      if (idx > -1) {
        localScheduled[idx].title = title;
        localScheduled[idx].steps = workout_doc;
        localScheduled[idx].tss = calculatedTss;
        localScheduled[idx].duration = calculatedDuration;
        localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
        setLocalRefreshTrigger(prev => prev + 1);
      }
      return;
    }

    if (workoutId.startsWith('ev-')) {
      const eventId = workoutId.replace('ev-', '');
      const oldEvent = rawEvents.find(e => String(e.id) === eventId);
      if (!oldEvent) return;

      // Optimistic upate
      setRawEvents(prev => prev.map(e =>
        String(e.id) === eventId
          ? { ...e, name: title, workout_doc: workout_doc, icu_training_load: calculatedTss, moving_time: calculatedDuration * 60 }
          : e
      ));

      try {
        // Event details update requires passing existing info so we don't clear other options.
        // Actually, we can just pass name and workout_doc (the Intervals.icu backend usually updates patch-like).
        await updateEventDetails(intervalsId, intervalsKey, eventId, {
          name: title,
          workout_doc: workout_doc
        });
      } catch (err) {
        console.error('Update Workout API error:', err);
        // Revert on error
        setRawEvents(prev => prev.map(e =>
          String(e.id) === eventId ? oldEvent : e
        ));
        throw err;
      }
    }
  }, [rawEvents, intervalsId, intervalsKey]);

  const handleCreateWorkout = useCallback(async (workoutObj) => {
    // 1. Priprema optimističnog stanja (kreiramo lokalni zapis)
    let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
    const newLocalWorkout = {
      id: workoutObj.id.replace('local-', ''),
      date: workoutObj.date,
      title: workoutObj.title,
      duration: workoutObj.duration,
      duration_seconds: workoutObj.duration * 60,
      tss: workoutObj.tss,
      steps: workoutObj.description,
      category: workoutObj.category || 'WORKOUT',
      type: workoutObj.type || 'ride'
    };

    localScheduled.push(newLocalWorkout);
    localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
    setLocalRefreshTrigger(prev => prev + 1);

    // Ako nemamo API ključeve, stajemo ovdje, ostaje samo lokalno
    if (!intervalsId || !intervalsKey) return;

    // 2. Slanje na Intervals.icu u pozadini
    try {
      const { createEvent } = await import('../services/intervalsApi');
      const payload = {
        start_date_local: `${workoutObj.date}T08:00:00`,
        category: 'WORKOUT',
        name: workoutObj.title,
        description: workoutObj.description,
        icu_training_load: workoutObj.tss,
        moving_time: workoutObj.duration * 60,
        type: workoutObj.type === 'run' ? 'Run' : (workoutObj.type === 'strength' ? 'WeightTraining' : 'Ride')
      };

      const newEvent = await createEvent(intervalsId, intervalsKey, payload);

      // Uspješno dodano na Intervals!
      // Brišemo lokalni i dodajemo pravi event
      localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      localScheduled = localScheduled.filter(w => w.id !== newLocalWorkout.id);
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));

      setRawEvents(prev => [...prev, newEvent]);
      setLocalRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Create Workout API error:', err);
      // Ako api pukne, workout ostaje u lokalnom storageu što je ok fallback.
    }
  }, [intervalsId, intervalsKey]);

  return {
    workouts,
    wellnessData,
    isLoading,
    error,
    fetchWorkouts,
    handlePair,
    handleUnpair,
    handleDeleteLocalActivity,
    handleDeleteCompletedActivity,
    handleRescheduleWorkout,
    handleUpdateWorkout,
    handleCreateWorkout
  };
}

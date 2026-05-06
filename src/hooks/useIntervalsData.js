import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchIntervalsData, updateEventDate, updateEventDetails } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';
import { parseWorkoutDoc, categorizeWorkout, calculateCategoryDifficulty } from '../utils/workoutParser';

export function useIntervalsData(intervalsId, intervalsKey, { onRescheduleError } = {}) {
  const [rawActivities, setRawActivities] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [wellnessData, setWellnessData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unpairedList, setUnpairedList] = useState([]);
  const [localRefreshTrigger, setLocalRefreshTrigger] = useState(0);
  const [supabaseActivities, setSupabaseActivities] = useState([]);

  const fetchWorkouts = useCallback(async () => {
    if (!intervalsId || !intervalsKey) {
      setRawActivities([]);
      setRawEvents([]);
      setWellnessData({});
      // Ali i dalje dohvaćamo Supabase aktivnosti
    }
    setIsLoading(true);
    setError(null);
    try {
      // 1. Dohvati Intervals.icu podatke (ako postoje)
      if (intervalsId && intervalsKey) {
        const data = await fetchIntervalsData(intervalsId, intervalsKey);

        setRawActivities(data.activities);
        setRawEvents(data.events);

        const mappedWellness = {};
        data.wellness.forEach(w => {
          const formatDur = (mins) => {
            const h = Math.floor(mins / 60);
            return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`;
          };
          mappedWellness[w.id] = {
            restingHR: w.restingHR,
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

        const { data: supabaseData, error: supabaseError } = await supabase
          .from('completed_activities')
          .select('id, started_at, title, workout_source, duration_seconds, avg_power, avg_hr, np, tss, if_factor')
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
          const localFallback = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities') || '[]');

          // Dodaj one iz localStorage-a koje već nemamo u Supabase podacima
          // Uspoređujemo po started_at (isti trening bi trebao imati vrlo sličan timestamp)
          localFallback.forEach(localAct => {
            // Provjeri postoji li već aktivnost s istim vremenom početka (±1 minutu tolerancije)
            const localTime = new Date(localAct.started_at).getTime();
            const existsInSupabase = combinedLocalActivities.some(sbAct => {
              const sbTime = new Date(sbAct.started_at).getTime();
              return Math.abs(sbTime - localTime) < 60000;
            });

            if (!existsInSupabase) {
              combinedLocalActivities.push(localAct);
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
  }, [intervalsId, intervalsKey]);

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

    const localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');

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

      // Pokušaj spariti s Intervals.icu eventom PRVO (viši prioritet) - O(k) gdje je k broj evenata za datum
      let pairedEvent = null;
      let separatedEventIds = [];

      const eventsForDate = eventsByDate.get(actDate) || [];
      for (let e of eventsForDate) {
        if (unpairedList.includes(`supabase-${sbAct.id}-${e.id}`)) {
          separatedEventIds.push(e.id);
        } else if (!consumedEvents.has(e.id) && !pairedEvent) {
          pairedEvent = e;
          consumedEvents.add(e.id);
        }
      }

      // Ako nema Intervals eventa, pokušaj spariti s lokalnim planiranim treningom
      let pairedLocal = null;
      if (!pairedEvent) {
        const localForDate = localByDate.get(actDate) || [];
        for (let lw of localForDate) {
          if (unpairedList.includes(`supabase-${sbAct.id}-local-${lw.id}`)) {
            separatedEventIds.push(`local-${lw.id}`);
          } else if (!consumedLocalIds.has(lw.id)) {
            pairedLocal = lw;
            consumedLocalIds.add(lw.id);
            break;
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
          complianceColor = 'green'; // Zelen je ako je odrađen (barem ima tss ili trajanje)
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

      finalWorkouts.push({
        id: `supabase-${sbAct.id}`,
        actId: `supabase-${sbAct.id}`,
        supabaseId: sbAct.id,
        eventId: eventIdObj,
        separatedEventIds,
        date: actDate,
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
        category: actCategory,
        workout_doc: workoutDoc,
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

      // PROVJERA: Preskoči ako već postoji Supabase aktivnost za ovaj datum
      if (supabaseDateMap.has(actDate)) {
        console.log('[useIntervalsData] ✓ Preskačem Intervals.icu aktivnost', act.id, 'jer postoji Supabase aktivnost', supabaseDateMap.get(actDate), 'za datum:', actDate);
        return;
      }

      let pairedEvent = null;
      let separatedEventIds = [];

      // O(k) lookup umjesto O(n)
      const eventsForDate = eventsByDate.get(actDate) || [];
      for (let e of eventsForDate) {
        const isIdMatch = e.activity_id === act.id;
        if (isIdMatch || true) { // Uvijek provjeravamo datum match jer smo već filtrirali po datumu
          if (unpairedList.includes(`${act.id}-${e.id}`)) {
            separatedEventIds.push(e.id);
          } else if (!consumedEvents.has(e.id) && !pairedEvent) {
            pairedEvent = e;
            consumedEvents.add(e.id);
          }
        }
      }

      let pairedLocal = null;
      const localForDate = localByDate.get(actDate) || [];
      for (let lw of localForDate) {
        if (unpairedList.includes(`${act.id}-local-${lw.id}`)) {
          separatedEventIds.push(`local-${lw.id}`);
        } else if (!pairedEvent && !pairedLocal && !consumedLocalIds.has(lw.id)) {
          pairedLocal = lw;
          consumedLocalIds.add(lw.id);
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
          complianceColor = 'green';
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
        date: actDate, title: act.name || 'Trening',
        duration: Math.round((act.moving_time || 0) / 60), plannedDuration: plannedDurDisplay,
        tss: Math.round(act.icu_training_load || 0), plannedTss: plannedTssDisplay,
        statusColor: complianceColor, isCompleted: true,
        difficulty_score: diffScore,
        category: actCategory,
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
  }, [rawActivities, rawEvents, supabaseActivities, unpairedList, localRefreshTrigger]);

  const handleUnpair = useCallback((actId, eventId) => {
    if (!actId || !eventId) return;
    setUnpairedList(prev => [...prev, `${actId}-${eventId}`]);
  }, []);

  const handlePair = useCallback((actId, eventId) => {
    if (!actId || !eventId) return;
    setUnpairedList(prev => prev.filter(pair => pair !== `${actId}-${eventId}`));
  }, []);

  const handleDeleteLocalActivity = useCallback(async (workoutId) => {
    if (!workoutId) return;

    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
      localScheduled = localScheduled.filter(w => w.id !== rawId);
      localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));
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

    // Samo Supabase aktivnosti se mogu brisati
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
          const localFallback = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities') || '[]');
          const updatedFallback = localFallback.filter(act => act.id !== rawId && act.id !== `local_act_${rawId}`);
          localStorage.setItem('ai_trener_local_completed_activities', JSON.stringify(updatedFallback));
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
    } else {
      return { success: false, error: 'Samo lokalne aktivnosti se mogu brisati iz kalendara.' };
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
      let localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
      const idx = localScheduled.findIndex(w => w.id === rawId);
      if (idx === -1) return;
      localScheduled[idx].date = newDate;
      localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));
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
      let localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
      const idx = localScheduled.findIndex(w => w.id === rawId);
      if (idx > -1) {
        localScheduled[idx].title = title;
        localScheduled[idx].steps = workout_doc;
        localScheduled[idx].tss = calculatedTss;
        localScheduled[idx].duration = calculatedDuration;
        localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));
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
    let localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
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
    localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));
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
      localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
      localScheduled = localScheduled.filter(w => w.id !== newLocalWorkout.id);
      localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));

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

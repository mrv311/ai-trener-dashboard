import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchIntervalsData, updateEventDate, updateEventDetails } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';

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

        if (!supabaseError && supabaseData) {
          console.log('[useIntervalsData] Dohvaćeno', supabaseData.length, 'lokalnih aktivnosti iz Supabase');
          setSupabaseActivities(supabaseData);
        } else if (supabaseError) {
          console.warn('[useIntervalsData] Greška pri dohvaćanju Supabase aktivnosti:', supabaseError);
        }
      } catch (supabaseErr) {
        console.warn('[useIntervalsData] Supabase dohvaćanje nije uspjelo:', supabaseErr);
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

  const workouts = useMemo(() => {
    console.log('[useIntervalsData] Računam workouts. Supabase aktivnosti:', supabaseActivities.length, 'Intervals aktivnosti:', rawActivities.length);
    
    const finalWorkouts = [];
    const consumedEvents = new Set();
    const consumedLocalIds = new Set();
    const consumedSupabaseIds = new Set();
    const supabaseDateMap = new Map(); // Mapa za brzu provjeru Supabase aktivnosti po datumu
    const todayStr = new Date().toISOString().split('T')[0];

    const localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');

    // 0. PRIORITET: Prvo dodaj Supabase lokalne aktivnosti (najsvježije, upravo završene)
    supabaseActivities.forEach(sbAct => {
      const actDate = sbAct.started_at ? sbAct.started_at.split('T')[0] : '';
      
      // Debug logging za provjeru duplikata
      if (supabaseDateMap.has(actDate)) {
        console.warn('[useIntervalsData] DUPLIKAT DETEKTIRAN: Već postoji Supabase aktivnost za datum', actDate, 'ID:', supabaseDateMap.get(actDate), 'Nova ID:', sbAct.id);
      }
      
      supabaseDateMap.set(actDate, sbAct.id); // Označi da ovaj datum ima Supabase aktivnost

      // Pokušaj spariti s Intervals.icu eventom PRVO (viši prioritet)
      let pairedEvent = null;
      let separatedEventIds = [];
      
      for (let e of rawEvents) {
        if (e.category !== 'WORKOUT') continue;
        const isDateMatch = e.start_date_local && e.start_date_local.split('T')[0] === actDate;
        
        if (isDateMatch) {
          if (unpairedList.includes(`supabase-${sbAct.id}-${e.id}`)) {
            separatedEventIds.push(e.id);
          } else if (!consumedEvents.has(e.id) && !pairedEvent) {
            pairedEvent = e;
            consumedEvents.add(e.id);
          }
        }
      }

      // Ako nema Intervals eventa, pokušaj spariti s lokalnim planiranim treningom
      let pairedLocal = null;
      if (!pairedEvent) {
        for (let lw of localScheduled) {
          if (lw.date === actDate) {
            if (unpairedList.includes(`supabase-${sbAct.id}-local-${lw.id}`)) {
              separatedEventIds.push(`local-${lw.id}`);
            } else if (!consumedLocalIds.has(lw.id)) {
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
      }

      finalWorkouts.push({
        id: `supabase-${sbAct.id}`,
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

      for (let e of rawEvents) {
        if (e.category !== 'WORKOUT') continue;
        const isDateMatch = e.start_date_local && e.start_date_local.split('T')[0] === actDate;
        const isIdMatch = e.activity_id === act.id;

        if (isDateMatch || isIdMatch) {
          if (unpairedList.includes(`${act.id}-${e.id}`)) {
            separatedEventIds.push(e.id);
          } else if (!consumedEvents.has(e.id) && !pairedEvent) {
            pairedEvent = e;
            consumedEvents.add(e.id);
          }
        }
      }

      let pairedLocal = null;
      for (let lw of localScheduled) {
        if (lw.date === actDate) {
          if (unpairedList.includes(`${act.id}-local-${lw.id}`)) {
            separatedEventIds.push(`local-${lw.id}`);
          } else if (!pairedEvent && !pairedLocal && !consumedLocalIds.has(lw.id)) {
            pairedLocal = lw;
            consumedLocalIds.add(lw.id);
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
        np: Math.round(act.icu_normalized_power || act.normalized_power || 0),
        average_power: Math.round(act.icu_average_power || act.average_watts || act.average_power || 0),
        max_power: Math.round(act.icu_max_power || act.max_watts || act.max_power || 0),
        average_heartrate: Math.round(act.icu_average_hr || act.average_heartrate || 0)
      });
    });

    // 2. Dodaj planirane evente iz Intervals.icu
    rawEvents.forEach(ev => {
      if (ev.category !== 'WORKOUT' || consumedEvents.has(ev.id)) return;
      if (ev.activity_id && !unpairedList.some(pair => pair.endsWith(`-${ev.id}`))) return;

      const evDate = ev.start_date_local ? ev.start_date_local.split('T')[0] : '';
      let complianceColor = 'grey';
      if (evDate < todayStr) complianceColor = 'red-missed';

      finalWorkouts.push({
        id: `ev-${ev.id}`, eventId: ev.id, date: evDate, title: ev.name || 'Planirano',
        duration: Math.round((ev.moving_time || 0) / 60), plannedDuration: Math.round((ev.moving_time || 0) / 60),
        tss: Math.round(ev.icu_training_load || 0), plannedTss: Math.round(ev.icu_training_load || 0),
        statusColor: complianceColor, isCompleted: false,
        workout_doc: ev.workout_doc
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

  const handleDeleteLocalActivity = useCallback((localId) => {
    const rawId = localId.replace('local-', '');
    let localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
    localScheduled = localScheduled.filter(w => w.id !== rawId);
    localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify(localScheduled));
    setLocalRefreshTrigger(prev => prev + 1);
  }, []);

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
        
        if (error) throw error;
        
        // Odmah ukloni iz lokalnog stanja
        setSupabaseActivities(prev => prev.filter(act => act.id !== rawId));
        
        // Osvježi podatke
        setLocalRefreshTrigger(prev => prev + 1);
        return { success: true };
      } catch (err) {
        console.error('Greška pri brisanju Supabase aktivnosti:', err);
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
        category: workoutObj.category || 'WORKOUT',
        name: workoutObj.title,
        workout_doc: workoutObj.description,
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

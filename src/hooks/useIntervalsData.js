import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchIntervalsData, updateEventDate, updateEventDetails } from '../services/intervalsApi';

export function useIntervalsData(intervalsId, intervalsKey, { onRescheduleError } = {}) {
  const [rawActivities, setRawActivities] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [wellnessData, setWellnessData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unpairedList, setUnpairedList] = useState([]);
  const [localRefreshTrigger, setLocalRefreshTrigger] = useState(0);

  const fetchWorkouts = useCallback(async () => {
    if (!intervalsId || !intervalsKey) {
      setRawActivities([]);
      setRawEvents([]);
      setWellnessData({});
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
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
    const finalWorkouts = [];
    const consumedEvents = new Set();
    const consumedLocalIds = new Set();
    const todayStr = new Date().toISOString().split('T')[0];

    const localScheduled = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');

    rawActivities.forEach(act => {
      const actDate = act.start_date_local ? act.start_date_local.split('T')[0] : '';
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

      if (pairedEvent || pairedLocal) {
        if (pairedEvent) {
          eventIdObj = pairedEvent.id;
          plannedTssDisplay = Math.round(pairedEvent.icu_training_load || 0);
          plannedDurDisplay = Math.round((pairedEvent.moving_time || 0) / 60);
        } else {
          eventIdObj = `local-${pairedLocal.id}`;
          plannedTssDisplay = Math.round(pairedLocal.tss || 0);
          plannedDurDisplay = pairedLocal.duration_seconds ? Math.round(pairedLocal.duration_seconds / 60) : pairedLocal.duration;
          diffScore = pairedLocal.difficulty_score;
          actCategory = pairedLocal.category;
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
        category: actCategory
      });
    });

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

    return finalWorkouts;
  }, [rawActivities, rawEvents, unpairedList, localRefreshTrigger]); 

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

  return {
    workouts,
    wellnessData,
    isLoading,
    error,
    fetchWorkouts,
    handlePair,
    handleUnpair,
    handleDeleteLocalActivity,
    handleRescheduleWorkout,
    handleUpdateWorkout
  };
}

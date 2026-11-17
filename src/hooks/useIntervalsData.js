import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  fetchIntervalsData,
  updateEventDate,
  updateEventDetails,
  createEvent,
  createEventsBatch,
  deleteEvent,
  deleteEventsBatch
} from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';
import { parseWorkoutDoc, categorizeWorkout, calculateCategoryDifficulty } from '../utils/workoutParser';
import { isRestDayWorkout } from '../utils/plannerUtils';
import { isCyclingType, isNonCyclingEvent, toIntervalsSportType } from '../utils/sportTypes';

const formatLocalDate = (d = new Date()) => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
};

const PLANNED_EVENT_CATEGORIES = new Set(['WORKOUT', 'RACE_A', 'RACE_B', 'RACE_C']);
const isRaceEventCategory = (cat) => cat === 'RACE_A' || cat === 'RACE_B' || cat === 'RACE_C';

const getPlanRegistryKey = (userId) => `ergvibe_plan_registry_${userId || 'guest'}`;

const readPlanRegistry = (userId) => {
  try {
    const raw = JSON.parse(localStorage.getItem(getPlanRegistryKey(userId)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const writePlanRegistry = (userId, list) => {
  try {
    localStorage.setItem(getPlanRegistryKey(userId), JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    // ignore quota error
  }
};

const normalizeDurationMinutes = (workoutObj, isRace = false) => {
  const isCycling = isCyclingType(workoutObj?.type);
  if (isRace || !isCycling) {
    const rawMin = Number(workoutObj?.duration ?? 0);
    if (rawMin > 0) {
      let cleanMin = Math.round(rawMin);
      if (cleanMin >= 360 && cleanMin % 60 === 0) cleanMin = Math.round(cleanMin / 60);
      else if (cleanMin > 1440) cleanMin = Math.round(cleanMin / 60);
      return cleanMin;
    }
    if (workoutObj?.duration_seconds > 0) {
      return Math.max(1, Math.round(workoutObj.duration_seconds / 60));
    }
    return 0;
  }
  let durMin = workoutObj?.duration;
  if (durMin && durMin >= 360 && durMin % 60 === 0) {
    durMin = Math.round(durMin / 60);
  } else if (durMin > 1440) {
    durMin = Math.round(durMin / 60);
  } else if (!durMin && workoutObj?.duration_seconds) {
    durMin = Math.round(workoutObj.duration_seconds / 60);
  }
  return Math.max(10, Math.round(durMin || 60));
};

const buildIntervalsEventPayload = (workoutObj) => {
  const eventCategory = workoutObj?.eventCategory || 'WORKOUT';
  const isRace = isRaceEventCategory(eventCategory);
  const durMin = normalizeDurationMinutes(workoutObj, isRace);
  const durSec = durMin * 60;
  const payload = {
    start_date_local: `${workoutObj.date}T08:00:00`,
    category: eventCategory,
    name: workoutObj.title || (isRace ? 'Ciljni Event' : 'Trening'),
    description: isRace
      ? (workoutObj.descriptionText || workoutObj.description || '')
      : (workoutObj.description ?? workoutObj.descriptionText ?? ''),
    type: toIntervalsSportType(workoutObj.type)
  };
  if (workoutObj.tss && Number(workoutObj.tss) > 0) {
    payload.icu_training_load = Math.round(Number(workoutObj.tss));
  }
  if (durSec > 0) {
    payload.moving_time = durSec;
  }
  return payload;
};

// Helper: određuje je li aktivnost cycling tipa na temelju workout_source
const isCyclingActivity = (sbAct) => {
  if (!sbAct.workout_source) return true; // default je cycling
  const src = sbAct.workout_source.toLowerCase();
  if (src === 'free_ride' || src === 'calendar' || src === 'library' || src === 'local') return true;
  if (src.startsWith('external_upload_')) {
    const sport = src.replace('external_upload_', '');
    return isCyclingType(sport);
  }
  if (src === 'external_upload') {
    return sbAct.avg_power > 0; // pretpostavljamo cycling ako ima wate
  }
  return true;
};

const buildIntervalSummary = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const formatDur = (s) => {
    const m = Math.round(s / 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return remM > 0 ? `${h}h${remM}m` : `${h}h`;
    }
    return `${m}m`;
  };

  const formatStepPwr = (st) => {
    if (st.powerMin && st.powerMax && st.powerMin !== st.powerMax) {
      return `${st.powerMin}-${st.powerMax}%`;
    }
    return `${Math.round(st.power || 50)}%`;
  };

  if (steps.length === 1) {
    return `${formatDur(steps[0].duration)} @ ${formatStepPwr(steps[0])}`;
  }

  if (steps.length <= 4) {
    return steps.map(st => `${formatDur(st.duration)} @ ${formatStepPwr(st)}`).join(' · ');
  }

  const workSteps = steps.filter(st => (st.powerMin || st.power || 0) >= 75);
  if (workSteps.length > 0) {
    const firstWork = workSteps[0];
    const sameWork = workSteps.filter(st => Math.abs((st.power || 0) - (firstWork.power || 0)) <= 3);
    if (sameWork.length > 1) {
      return `${sameWork.length}x ${formatDur(firstWork.duration)} @ ${formatStepPwr(firstWork)}`;
    }
    return `${workSteps.length} intervala (vrh ${Math.max(...workSteps.map(s => s.powerMax || s.power || 0))}%)`;
  }

  return `${steps.length} segmenata · ${formatDur(steps.reduce((a, b) => a + (b.duration || 0), 0))}`;
};

const extractEventPlannedMetrics = (ev, userFtp = 250) => {
  if (!ev) return { tss: 0, durationMin: 0, category: null, diffScore: null, targetNp: null, workoutDoc: null, descriptionText: '' };
  const isEvCycling = !isNonCyclingEvent(ev);
  const docToParse = ev.workout_doc || ev.description;
  let parsed = null;
  let actCategory = isEvCycling ? null : 'OTHER';
  let diffScore = null;
  let targetNp = null;

  if (isEvCycling && docToParse) {
    try {
      parsed = parseWorkoutDoc(docToParse, userFtp);
      if (parsed && Array.isArray(parsed.allSteps) && parsed.allSteps.length > 0) {
        actCategory = categorizeWorkout(parsed.allSteps);
        diffScore = calculateCategoryDifficulty(parsed.allSteps, actCategory);
        targetNp = parsed.np || null;
      }
    } catch (e) {
      console.warn('[useIntervalsData] Greška pri parsiranju planiranog eventa:', e);
    }
  }

  const candidatesTss = [
    ev.icu_training_load,
    ev.load,
    ev.tss,
    isEvCycling ? ev.workout_doc?.tss : null,
    parsed?.tss
  ];
  let resolvedTss = 0;
  for (const val of candidatesTss) {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      resolvedTss = Math.round(num);
      break;
    }
  }

  const candidatesSec = [
    ev.moving_time,
    isEvCycling ? ev.workout_doc?.duration : null,
    ev.elapsed_time,
    parsed?.duration
  ];
  let resolvedMin = 0;
  for (const sec of candidatesSec) {
    const num = Number(sec);
    if (Number.isFinite(num) && num > 0) {
      let mins = Math.round(num / 60);
      if (mins > 1440) mins = Math.round(mins / 60);
      resolvedMin = Math.max(1, mins);
      break;
    }
  }

  return {
    tss: resolvedTss,
    durationMin: resolvedMin,
    category: actCategory,
    diffScore,
    targetNp,
    steps: isEvCycling ? (parsed?.allSteps || null) : null,
    intervalDescription: isEvCycling && parsed?.allSteps?.length > 0 ? buildIntervalSummary(parsed.allSteps) : null,
    workoutDoc: isEvCycling ? (ev.workout_doc || (parsed?.allSteps?.length > 0 ? ev.description : null)) : null,
    descriptionText: typeof ev.description === 'string' ? ev.description : ''
  };
};

const extractActivityCompletedMetrics = (act, userFtp = 250) => {
  if (!act) return { tss: 0, durationMin: 0, np: 0 };
  const durSec = Number(act.moving_time || act.elapsed_time || 0) || 0;
  const np = Number(
    act.icu_weighted_avg_watts ||
    act.icu_normalized_power ||
    act.normalized_power ||
    act.icu_average_watts ||
    act.average_watts ||
    act.icu_average_power ||
    act.average_power ||
    0
  ) || 0;

  const candidatesTss = [
    act.icu_training_load,
    act.training_load,
    act.tss,
    act.hr_load
  ];
  let resolvedTss = 0;
  for (const val of candidatesTss) {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      resolvedTss = Math.round(num);
      break;
    }
  }

  if (resolvedTss <= 0 && durSec > 0 && np > 0 && userFtp > 0) {
    resolvedTss = Math.round((durSec / 3600) * Math.pow(np / userFtp, 2) * 100);
  }

  return {
    tss: resolvedTss,
    durationMin: Math.round(durSec / 60),
    np: Math.round(np)
  };
};

// localStorage ključevi za persistenciju parova
const STORAGE_KEY_UNPAIRED = 'ergvibe_unpaired_list';
const STORAGE_KEY_EXPLICIT_PAIRS = 'ergvibe_explicit_pairs';

export function useIntervalsData(intervalsId, intervalsKey, userId, { onRescheduleError, ftp: profileFtp } = {}) {
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
  const [intervalsConnected, setIntervalsConnected] = useState(false);
  const [athleteInfo, setAthleteInfo] = useState(null);
  const cleanedRestEventIdsRef = useRef(new Set());

  // Ako se uklone kljuÄŤevi, odmah ugasi vezu i oÄŤisti athleteInfo
  useEffect(() => {
    if (!intervalsId || !intervalsKey) {
      setIntervalsConnected(false);
      setAthleteInfo(null);
    }
  }, [intervalsId, intervalsKey]);

  // Persist unpairedList i explicitPairings u localStorage kad se promijene
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_UNPAIRED, JSON.stringify(unpairedList)); } catch {}
  }, [unpairedList]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_EXPLICIT_PAIRS, JSON.stringify(explicitPairings)); } catch {}
  }, [explicitPairings]);

  const fetchWorkouts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Opcionalno dohvati Intervals.icu podatke (greška NE smije blokirati lokalne/ErgVibe podatke)
      if (!intervalsId || !intervalsKey) {
        setRawActivities([]);
        setRawEvents([]);
        setWellnessData({});
        setIntervalsConnected(false);
        setAthleteInfo(null);
      } else {
        try {
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
          setIntervalsConnected(true);
          if (data.athlete) setAthleteInfo(data.athlete);
        } catch (intervalsErr) {
          console.warn('[useIntervalsData] Intervals.icu dohvat nije uspio (nastavljam u samostalnom načinu):', intervalsErr);
          setError(intervalsErr.message);
          setIntervalsConnected(false);
          setAthleteInfo(null);
        }
      }

      // 2. Dohvati ErgVibe aktivnosti (Supabase za prijavljene korisnike + localStorage za Gosta / offline)
      try {
        if (!userId) {
          setSupabaseActivities([]);
          return;
        }

        let combinedLocalActivities = [];

        if (userId !== 'guest') {
          const oneYearAgo = new Date();
          oneYearAgo.setDate(oneYearAgo.getDate() - 365);

          const { data: supabaseData, error: supabaseError } = await supabase
            .from('completed_activities')
            .select('id, started_at, title, workout_source, duration_seconds, avg_power, avg_hr, avg_cadence, np, tss, if_factor, work_kj, distance_m, avg_speed_kmh')
            .eq('user_id', userId)
            .gte('started_at', oneYearAgo.toISOString())
            .order('started_at', { ascending: false });

          if (!supabaseError && supabaseData) {
            combinedLocalActivities = [...supabaseData];
          } else if (supabaseError) {
            console.warn('[useIntervalsData] Greška pri dohvaćanju Supabase aktivnosti:', supabaseError);
          }
        }

        // Pročitaj i localStorage aktivnosti (primarno spremište za Gosta + offline backup)
        try {
          const localFallback = JSON.parse(localStorage.getItem(`ai_trener_local_completed_activities_${userId || 'guest'}`) || '[]');

          localFallback.forEach(localAct => {
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
    } finally {
      setIsLoading(false);
    }
  }, [intervalsId, intervalsKey, userId]);

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  // Automatski ukloni eventualne stare "Potpuni odmor" / "Rest day" WORKOUT evente iz Intervals.icu
  useEffect(() => {
    if (!intervalsConnected || !intervalsId || !intervalsKey || rawEvents.length === 0) return;

    const restEventsToClean = rawEvents.filter(ev => {
      if (!ev || ev.category !== 'WORKOUT' || ev.id == null) return false;
      const cleanupKey = `${intervalsId}:${ev.id}`;
      if (cleanedRestEventIdsRef.current.has(cleanupKey)) return false;
      return isRestDayWorkout(ev);
    });

    if (restEventsToClean.length === 0) return;

    const targetIds = new Set();
    restEventsToClean.forEach(ev => {
      cleanedRestEventIdsRef.current.add(`${intervalsId}:${ev.id}`);
      targetIds.add(String(ev.id));
    });

    setRawEvents(prev => prev.filter(e => !targetIds.has(String(e.id))));

    let cancelled = false;
    (async () => {
      for (const ev of restEventsToClean) {
        if (cancelled) return;
        try {
          await deleteEvent(intervalsId, intervalsKey, ev.id);
        } catch (err) {
          console.warn('[useIntervalsData] Greška pri uklanjanju lažnog rest-day eventa s Intervals.icu:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [intervalsConnected, intervalsId, intervalsKey, rawEvents]);

  // Listeneri za lokalna ažuriranja (Knjižnica, upload .FIT/.TCX, preimenovanje aktivnosti)
  useEffect(() => {
    const handleTitleUpdate = (event) => {
      const { activityId, newTitle } = event.detail || {};

      if (activityId === 'refresh') {
        fetchWorkouts();
        return;
      }

      if (activityId && newTitle) {
        setRawActivities(prev => prev.map(act =>
          `act-${act.id}` === activityId || act.id.toString() === activityId.replace('act-', '')
            ? { ...act, name: newTitle }
            : act
        ));
        setSupabaseActivities(prev => prev.map(act =>
          `supabase-${act.id}` === activityId || String(act.id) === String(activityId).replace('supabase-', '')
            ? { ...act, title: newTitle }
            : act
        ));
      }

      setLocalRefreshTrigger(prev => prev + 1);
    };

    const handleLocalWorkoutsUpdated = () => {
      setLocalRefreshTrigger(prev => prev + 1);
    };

    window.addEventListener('activity-title-updated', handleTitleUpdate);
    window.addEventListener('local-workouts-updated', handleLocalWorkoutsUpdated);
    return () => {
      window.removeEventListener('activity-title-updated', handleTitleUpdate);
      window.removeEventListener('local-workouts-updated', handleLocalWorkoutsUpdated);
    };
  }, [fetchWorkouts]);

  const workouts = useMemo(() => {
    const finalWorkouts = [];
    const consumedEvents = new Set();
    const consumedLocalIds = new Set();
    const consumedSupabaseIds = new Set();
    const consumedIntervalsActIds = new Set();
    const supabaseDateMap = new Map();
    const todayStr = formatLocalDate(new Date());
    const effectiveFtp =
      Number(profileFtp) ||
      Number(athleteInfo?.icu_ftp || athleteInfo?.ftp) ||
      Number(localStorage.getItem('ai_trener_user_ftp')) ||
      250;

    const rawLocalScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
    let needsLocalFix = false;
    const filteredLocalScheduled = rawLocalScheduled.filter(item => {
      if (isRestDayWorkout(item)) {
        needsLocalFix = true;
        return false;
      }
      return true;
    });
    const localScheduled = filteredLocalScheduled.map(item => {
      let d = item.duration;
      let s = item.duration_seconds;
      let fixed = false;
      if (s && s > 43200 && s % 60 === 0) {
        s = Math.round(s / 60);
        fixed = true;
      }
      if (d && d >= 600 && (!s || d === s) && d % 60 === 0) {
        d = Math.round(d / 60);
        fixed = true;
      } else if (!d && s) {
        d = Math.round(s / 60);
        fixed = true;
      }
      if (fixed) {
        needsLocalFix = true;
        return { ...item, duration: d, duration_seconds: s || (d * 60) };
      }
      return item;
    });
    if (needsLocalFix) {
      try {
        localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
      } catch {
        // ignore
      }
    }

    const rawActivityIdSet = new Set(rawActivities.map(a => String(a.id)));

    // Kreiraj Map objekte za O(1) lookup (utrke RACE_A/B/C ostaju zasebno vidljive i ne troše se na automatsko sparivanje)
    const eventsByDate = new Map();
    rawEvents.forEach(e => {
      if (!PLANNED_EVENT_CATEGORIES.has(e.category)) return;
      if (isRaceEventCategory(e.category)) return;
      if (isRestDayWorkout(e)) return;
      const date = e.start_date_local?.split('T')[0];
      if (!date) return;
      if (!eventsByDate.has(date)) eventsByDate.set(date, []);
      eventsByDate.get(date).push(e);
    });

    const localByDate = new Map();
    localScheduled.forEach(lw => {
      if (isRaceEventCategory(lw.eventCategory)) return;
      if (!localByDate.has(lw.date)) localByDate.set(lw.date, []);
      localByDate.get(lw.date).push(lw);
    });

    const getLocalPlannedMetrics = (lw) => {
      if (!lw) return { tss: 0, durationMin: 0, category: null, diffScore: null, workoutDoc: null, descriptionText: '' };
      const isLocCycling = !isNonCyclingEvent(lw);
      let parsed = null;
      const docSource = isLocCycling ? (lw.steps || lw.workout_doc) : null;
      if (isLocCycling && (!lw.tss || Number(lw.tss) <= 0 || !lw.category) && docSource) {
        try {
          parsed = parseWorkoutDoc(docSource, effectiveFtp);
        } catch {
          parsed = null;
        }
      }
      const rawTss = Number(lw.tss ?? lw.plannedTss) || Number(parsed?.tss) || 0;
      let durMin = lw.duration_seconds
        ? Math.round(Number(lw.duration_seconds) / 60)
        : (Number(lw.duration || lw.plannedDuration) || (parsed?.duration ? Math.round(parsed.duration / 60) : 0));
      if (durMin > 1440) durMin = Math.round(durMin / 60);

      let cat = isLocCycling ? (lw.category || null) : 'OTHER';
      let diff = isLocCycling ? (lw.difficulty_score ?? null) : null;
      if (isLocCycling && (!cat || cat === 'WORKOUT') && parsed?.allSteps?.length > 0) {
        cat = categorizeWorkout(parsed.allSteps);
        if (diff == null) diff = calculateCategoryDifficulty(parsed.allSteps, cat);
      }

      const rawNotes = typeof lw.descriptionText === 'string'
        ? lw.descriptionText
        : (typeof lw.workout_doc === 'string' ? lw.workout_doc : (typeof lw.description === 'string' ? lw.description : ''));

      return {
        tss: Math.max(0, Math.round(rawTss)),
        durationMin: Math.max(0, Math.round(durMin)),
        category: cat,
        diffScore: diff,
        steps: isLocCycling ? (parsed?.allSteps || (Array.isArray(lw.steps) ? lw.steps : null)) : null,
        intervalDescription: isLocCycling && parsed?.allSteps?.length > 0 ? buildIntervalSummary(parsed.allSteps) : null,
        workoutDoc: isLocCycling ? (lw.workout_doc || lw.steps) : null,
        descriptionText: rawNotes
      };
    };

    const matchEventForActivity = ({
      eventsForDate,
      primaryUnpairPrefix,
      secondaryUnpairPrefix,
      explicitEventId,
      nativeIntervalsAct,
      isSportCycling,
      actualTss,
      actualDurMin
    }) => {
      let pairedEvent = null;
      const separatedEventIds = [];

      const isManuallyUnpaired = (evId) =>
        unpairedList.includes(`${primaryUnpairPrefix}-${evId}`) ||
        (secondaryUnpairPrefix ? unpairedList.includes(`${secondaryUnpairPrefix}-${evId}`) : false);

      // 1. Eksplicitno ručno sparivanje
      if (explicitEventId && !String(explicitEventId).startsWith('local-')) {
        const explicitEvent = eventsForDate.find(e => String(e.id) === String(explicitEventId));
        if (explicitEvent && !consumedEvents.has(explicitEvent.id)) {
          pairedEvent = explicitEvent;
          consumedEvents.add(explicitEvent.id);
        }
      }

      // 2. Izvorno Intervals.icu sparivanje (paired_event_id / paired_activity_id / activity_id)
      if (!pairedEvent && nativeIntervalsAct) {
        const nativeActIdStr = String(nativeIntervalsAct.id);
        const nativeEvIdStr = nativeIntervalsAct.paired_event_id != null ? String(nativeIntervalsAct.paired_event_id) : null;
        const nativeMatch = eventsForDate.find(e => {
          if (consumedEvents.has(e.id)) return false;
          return (
            (nativeEvIdStr && String(e.id) === nativeEvIdStr) ||
            (e.paired_activity_id != null && String(e.paired_activity_id) === nativeActIdStr) ||
            (e.activity_id != null && String(e.activity_id) === nativeActIdStr)
          );
        });

        if (nativeMatch) {
          if (isManuallyUnpaired(nativeMatch.id)) {
            separatedEventIds.push(nativeMatch.id);
          } else {
            pairedEvent = nativeMatch;
            consumedEvents.add(nativeMatch.id);
          }
        }
      }

      // 3. Pametno automatsko sparivanje po istom danu i sportu
      if (!pairedEvent) {
        const candidates = [];
        for (const e of eventsForDate) {
          if (consumedEvents.has(e.id)) continue;
          if (isManuallyUnpaired(e.id)) {
            if (!separatedEventIds.includes(e.id)) separatedEventIds.push(e.id);
            continue;
          }
          const isEvCycling = !isNonCyclingEvent(e);
          if (isEvCycling !== isSportCycling) {
            separatedEventIds.push(e.id);
            continue;
          }
          // Ne kradi event koji je na Intervals.icu već eksplicitno vezan za drugu aktivnost
          const boundOtherActId = e.paired_activity_id || e.activity_id;
          if (
            boundOtherActId &&
            (!nativeIntervalsAct || String(boundOtherActId) !== String(nativeIntervalsAct.id)) &&
            rawActivityIdSet.has(String(boundOtherActId)) &&
            !consumedIntervalsActIds.has(String(boundOtherActId))
          ) {
            continue;
          }
          candidates.push(e);
        }

        if (candidates.length === 1) {
          pairedEvent = candidates[0];
          consumedEvents.add(pairedEvent.id);
        } else if (candidates.length > 1) {
          // Odaberi event najbliži po TSS-u ili trajanju
          let best = candidates[0];
          let bestDiff = Infinity;
          candidates.forEach(c => {
            const cMetrics = extractEventPlannedMetrics(c, effectiveFtp);
            const score = cMetrics.tss > 0 && actualTss > 0
              ? Math.abs(cMetrics.tss - actualTss)
              : Math.abs((cMetrics.durationMin || 60) - (actualDurMin || 60));
            if (score < bestDiff) {
              bestDiff = score;
              best = c;
            }
          });
          pairedEvent = best;
          consumedEvents.add(pairedEvent.id);
        }
      } else {
        // Zabilježi ostale ručno odspojene evente za gumb ponovnog spajanja
        for (const e of eventsForDate) {
          if (!consumedEvents.has(e.id) && isManuallyUnpaired(e.id) && !separatedEventIds.includes(e.id)) {
            separatedEventIds.push(e.id);
          }
        }
      }

      return { pairedEvent, separatedEventIds };
    };

    // 0. PRIORITET: Prvo dodaj ErgVibe / Supabase aktivnosti
    supabaseActivities.forEach(sbAct => {
      let actDate = '';
      const sbStartMs = sbAct.started_at ? new Date(sbAct.started_at).getTime() : NaN;
      if (!isNaN(sbStartMs)) {
        actDate = formatLocalDate(new Date(sbStartMs));
      }

      supabaseDateMap.set(actDate, sbAct.id);

      const actKey = `supabase-${sbAct.id}`;
      const isCycling = isCyclingActivity(sbAct);
      const sbDurSec = Math.max(0, Number(sbAct.duration_seconds) || 0);
      const sbDurMs = Math.max(60, sbDurSec) * 1000;
      const sbEndMs = !isNaN(sbStartMs) ? sbStartMs + sbDurMs : NaN;

      // Pronađi eventualni duplikat iste vožnje na Intervals.icu (preklapanje vremenskog prozora >= 40% ili start unutar 5 min)
      let matchedIntervalsAct = null;
      if (!isNaN(sbStartMs)) {
        for (const act of rawActivities) {
          if (consumedIntervalsActIds.has(String(act.id))) continue;
          const isActCyc = isCyclingType(act.type);
          if (isActCyc !== isCycling) continue;

          const actStartMs = act.start_date
            ? new Date(act.start_date).getTime()
            : (act.start_date_local ? new Date(act.start_date_local).getTime() : NaN);
          if (isNaN(actStartMs)) continue;

          const actDurSec = Math.max(60, Number(act.elapsed_time || act.moving_time || 0));
          const actEndMs = actStartMs + actDurSec * 1000;
          const overlapMs = Math.max(0, Math.min(sbEndMs, actEndMs) - Math.max(sbStartMs, actStartMs));
          const minDurMs = Math.min(sbDurMs, actDurSec * 1000);

          if (overlapMs >= 0.4 * minDurMs || Math.abs(sbStartMs - actStartMs) <= 5 * 60 * 1000) {
            matchedIntervalsAct = act;
            consumedIntervalsActIds.add(String(act.id));
            break;
          }
        }
      }

      const fallbackIcuMetrics = matchedIntervalsAct
        ? extractActivityCompletedMetrics(matchedIntervalsAct, effectiveFtp)
        : null;

      let actualTss = Math.round(Number(sbAct.tss) || 0);
      if (actualTss <= 0 && fallbackIcuMetrics?.tss > 0) {
        actualTss = fallbackIcuMetrics.tss;
      } else if (actualTss <= 0 && sbDurSec > 0 && (sbAct.np || sbAct.avg_power) > 0 && effectiveFtp > 0) {
        const effPwr = Number(sbAct.np || sbAct.avg_power);
        actualTss = Math.round((sbDurSec / 3600) * Math.pow(effPwr / effectiveFtp, 2) * 100);
      }
      const actualDur = Math.round(sbDurSec / 60) || fallbackIcuMetrics?.durationMin || 0;

      const eventsForDate = eventsByDate.get(actDate) || [];
      const explicitEventId =
        explicitPairings[actKey] ||
        (matchedIntervalsAct ? explicitPairings[`act-${matchedIntervalsAct.id}`] : undefined);

      const { pairedEvent, separatedEventIds } = matchEventForActivity({
        eventsForDate,
        primaryUnpairPrefix: `supabase-${sbAct.id}`,
        secondaryUnpairPrefix: matchedIntervalsAct ? String(matchedIntervalsAct.id) : null,
        explicitEventId,
        nativeIntervalsAct: matchedIntervalsAct,
        isSportCycling: isCycling,
        actualTss,
        actualDurMin: actualDur
      });

      // Ako nema Intervals eventa, pokušaj spariti s lokalnim planiranim treningom
      let pairedLocal = null;
      if (!pairedEvent) {
        if (explicitEventId && String(explicitEventId).startsWith('local-')) {
          const localId = String(explicitEventId).replace('local-', '');
          const localForDate = localByDate.get(actDate) || [];
          const explicitLocal = localForDate.find(lw => String(lw.id) === localId);
          if (explicitLocal && !consumedLocalIds.has(explicitLocal.id)) {
            pairedLocal = explicitLocal;
            consumedLocalIds.add(explicitLocal.id);
          }
        }

        if (!pairedLocal) {
          const localForDate = localByDate.get(actDate) || [];
          for (const lw of localForDate) {
            if (unpairedList.includes(`supabase-${sbAct.id}-local-${lw.id}`)) {
              separatedEventIds.push(`local-${lw.id}`);
            } else if (!consumedLocalIds.has(lw.id)) {
              const isLocCycling = !isNonCyclingEvent(lw);
              if (isLocCycling === isCycling) {
                pairedLocal = lw;
                consumedLocalIds.add(lw.id);
                break;
              }
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
      let targetNpVal = null;
      let pairedDescriptionText = '';
      let pairedType = null;
      let complianceColor = 'blue';

      if (pairedEvent) {
        const evMetrics = extractEventPlannedMetrics(pairedEvent, effectiveFtp);
        eventIdObj = pairedEvent.id;
        plannedTssDisplay = evMetrics.tss;
        plannedDurDisplay = evMetrics.durationMin;
        diffScore = evMetrics.diffScore;
        actCategory = evMetrics.category;
        targetNpVal = evMetrics.targetNp;
        workoutDoc = evMetrics.workoutDoc;
        pairedDescriptionText = evMetrics.descriptionText || '';
        pairedType = pairedEvent.type || null;
      } else if (pairedLocal) {
        const locMetrics = getLocalPlannedMetrics(pairedLocal);
        eventIdObj = `local-${pairedLocal.id}`;
        plannedTssDisplay = locMetrics.tss;
        plannedDurDisplay = locMetrics.durationMin;
        diffScore = locMetrics.diffScore;
        actCategory = locMetrics.category;
        workoutDoc = locMetrics.workoutDoc;
        pairedDescriptionText = locMetrics.descriptionText || '';
        pairedType = pairedLocal.type || null;
      }

      if (pairedEvent || pairedLocal) {
        let ratio = 1;
        if (plannedTssDisplay > 0 && actualTss > 0) ratio = actualTss / plannedTssDisplay;
        else if (plannedDurDisplay > 0 && actualDur > 0) ratio = actualDur / plannedDurDisplay;

        if (ratio >= 0.8 && ratio <= 1.2) complianceColor = 'green';
        else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) complianceColor = 'yellow';
        else complianceColor = 'red';
      } else if (actualTss > 0 || sbDurSec > 0) {
        complianceColor = 'blue';
      }

      const defaultCategory = isCycling ? 'WORKOUT' : 'OTHER';

      finalWorkouts.push({
        id: `supabase-${sbAct.id}`,
        actId: `supabase-${sbAct.id}`,
        supabaseId: sbAct.id,
        matchedIntervalsActId: matchedIntervalsAct ? String(matchedIntervalsAct.id) : null,
        eventId: eventIdObj,
        separatedEventIds,
        date: actDate,
        started_at: sbAct.started_at,
        title: sbAct.title || matchedIntervalsAct?.name || 'Lokalni Trening',
        type: matchedIntervalsAct?.type || pairedType || (isCycling ? 'Ride' : 'Other'),
        duration: actualDur,
        plannedDuration: plannedDurDisplay,
        tss: actualTss,
        plannedTss: plannedTssDisplay,
        statusColor: complianceColor,
        isCompleted: true,
        isSupabase: true,
        workout_source: sbAct.workout_source || 'local',
        difficulty_score: isCycling ? diffScore : null,
        category: isCycling ? (actCategory && actCategory !== 'OTHER' ? actCategory : defaultCategory) : 'OTHER',
        workout_doc: isCycling ? (workoutDoc || sbAct.workout_doc) : null,
        descriptionText: pairedDescriptionText || matchedIntervalsAct?.description || '',
        targetNP: targetNpVal ? Math.round(targetNpVal) : null,
        np: Math.round(sbAct.np || fallbackIcuMetrics?.np || 0),
        average_power: Math.round(sbAct.avg_power || 0),
        average_heartrate: Math.round(sbAct.avg_hr || 0)
      });

      consumedSupabaseIds.add(sbAct.id);
    });

    // 1. Dodaj Intervals.icu aktivnosti (koje nisu već spojene kao duplikat ErgVibe vožnje)
    rawActivities.forEach(act => {
      if (consumedIntervalsActIds.has(String(act.id))) return;

      const actDate = act.start_date_local
        ? act.start_date_local.split('T')[0]
        : (act.start_date ? formatLocalDate(new Date(act.start_date)) : '');
      if (!actDate) return;

      const actKey = `act-${act.id}`;
      const isActCycling = isCyclingType(act.type);
      const defaultCategory = isActCycling ? 'WORKOUT' : 'OTHER';
      const completedMetrics = extractActivityCompletedMetrics(act, effectiveFtp);
      const actualTss = completedMetrics.tss;
      const actualDur = completedMetrics.durationMin;

      const eventsForDate = eventsByDate.get(actDate) || [];
      const explicitEventId = explicitPairings[actKey];

      const { pairedEvent, separatedEventIds } = matchEventForActivity({
        eventsForDate,
        primaryUnpairPrefix: String(act.id),
        secondaryUnpairPrefix: actKey,
        explicitEventId,
        nativeIntervalsAct: act,
        isSportCycling: isActCycling,
        actualTss,
        actualDurMin: actualDur
      });

      let pairedLocal = null;
      if (!pairedEvent) {
        if (explicitEventId && String(explicitEventId).startsWith('local-')) {
          const localId = String(explicitEventId).replace('local-', '');
          const localForDate = localByDate.get(actDate) || [];
          const explicitLocal = localForDate.find(lw => String(lw.id) === localId);
          if (explicitLocal && !consumedLocalIds.has(explicitLocal.id)) {
            pairedLocal = explicitLocal;
            consumedLocalIds.add(explicitLocal.id);
          }
        }

        if (!pairedLocal) {
          const localForDate = localByDate.get(actDate) || [];
          for (const lw of localForDate) {
            if (unpairedList.includes(`${act.id}-local-${lw.id}`)) {
              separatedEventIds.push(`local-${lw.id}`);
            } else if (!consumedLocalIds.has(lw.id)) {
              const isLocCycling = !isNonCyclingEvent(lw);
              if (isLocCycling === isActCycling) {
                pairedLocal = lw;
                consumedLocalIds.add(lw.id);
                break;
              }
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
      let pairedDescriptionText = '';

      if (pairedEvent || pairedLocal) {
        if (pairedEvent) {
          const evMetrics = extractEventPlannedMetrics(pairedEvent, effectiveFtp);
          eventIdObj = pairedEvent.id;
          plannedTssDisplay = evMetrics.tss;
          plannedDurDisplay = evMetrics.durationMin;
          diffScore = evMetrics.diffScore;
          actCategory = evMetrics.category;
          targetNpVal = evMetrics.targetNp;
          workoutDoc = evMetrics.workoutDoc;
          pairedDescriptionText = evMetrics.descriptionText || '';
        } else {
          const locMetrics = getLocalPlannedMetrics(pairedLocal);
          eventIdObj = `local-${pairedLocal.id}`;
          plannedTssDisplay = locMetrics.tss;
          plannedDurDisplay = locMetrics.durationMin;
          diffScore = locMetrics.diffScore;
          actCategory = locMetrics.category;
          workoutDoc = locMetrics.workoutDoc;
          pairedDescriptionText = locMetrics.descriptionText || '';
        }

        let ratio = 1;
        if (plannedTssDisplay > 0 && actualTss > 0) ratio = actualTss / plannedTssDisplay;
        else if (plannedDurDisplay > 0 && actualDur > 0) ratio = actualDur / plannedDurDisplay;

        if (ratio >= 0.8 && ratio <= 1.2) complianceColor = 'green';
        else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) complianceColor = 'yellow';
        else complianceColor = 'red';
      } else if (actualTss > 0 || actualDur > 0) {
        complianceColor = 'blue';
      }

      if (isActCycling && !diffScore && (workoutDoc || act.description)) {
        try {
          const docToParse = workoutDoc || act.description;
          const parsed = parseWorkoutDoc(docToParse, effectiveFtp);
          if (parsed && parsed.allSteps && parsed.allSteps.length > 0) {
            actCategory = categorizeWorkout(parsed.allSteps);
            diffScore = calculateCategoryDifficulty(parsed.allSteps, actCategory);
            targetNpVal = parsed.np;
          }
        } catch (e) {
          console.error('Error parsing intervals code for activity:', e);
        }
      }

      finalWorkouts.push({
        id: `act-${act.id}`,
        actId: act.id,
        eventId: eventIdObj,
        separatedEventIds,
        date: actDate,
        started_at: act.start_date_local || act.start_date,
        title: act.name || 'Trening',
        type: act.type || null,
        duration: actualDur,
        plannedDuration: plannedDurDisplay,
        tss: actualTss,
        plannedTss: plannedTssDisplay,
        statusColor: complianceColor,
        isCompleted: true,
        difficulty_score: isActCycling ? diffScore : null,
        category: isActCycling ? (actCategory && actCategory !== 'OTHER' ? actCategory : defaultCategory) : 'OTHER',
        workout_doc: isActCycling ? workoutDoc : null,
        descriptionText: act.description || pairedDescriptionText || '',
        targetNP: targetNpVal ? Math.round(targetNpVal) : null,
        np: completedMetrics.np,
        average_power: Math.round(act.icu_average_watts || act.icu_average_power || act.average_watts || act.average_power || 0),
        max_power: Math.round(act.icu_max_power || act.max_watts || act.max_power || 0),
        average_heartrate: Math.round(act.icu_average_hr || act.average_heartrate || act.average_hr || 0)
      });
    });

    // 2. Dodaj preostale planirane evente iz Intervals.icu (WORKOUT i RACE_A/B/C)
    rawEvents.forEach(ev => {
      if (!PLANNED_EVENT_CATEGORIES.has(ev.category) || consumedEvents.has(ev.id)) return;
      if (isRestDayWorkout(ev)) return;

      const evDate = ev.start_date_local ? ev.start_date_local.split('T')[0] : '';
      if (!evDate) return;

      const isRace = isRaceEventCategory(ev.category);
      let complianceColor = isRace ? 'race' : 'grey';
      if (!isRace && evDate < todayStr) complianceColor = 'red-missed';

      const evMetrics = extractEventPlannedMetrics(ev, effectiveFtp);
      const isEvCycling = !isNonCyclingEvent(ev);

      finalWorkouts.push({
        id: `ev-${ev.id}`,
        eventId: ev.id,
        eventCategory: ev.category || 'WORKOUT',
        type: ev.type || (isRace ? ev.category : (isEvCycling ? 'Ride' : 'WeightTraining')),
        date: evDate,
        title: ev.name || (isRace ? 'Utrka' : 'Planirano'),
        duration: isRace ? (evMetrics.durationMin || 0) : evMetrics.durationMin,
        plannedDuration: isRace ? (evMetrics.durationMin || 0) : evMetrics.durationMin,
        tss: evMetrics.tss,
        plannedTss: evMetrics.tss,
        statusColor: complianceColor,
        isCompleted: false,
        steps: (isRace || !isEvCycling) ? null : evMetrics.steps,
        intervalDescription: (isRace || !isEvCycling) ? null : evMetrics.intervalDescription,
        workout_doc: (isRace || !isEvCycling) ? null : evMetrics.workoutDoc,
        descriptionText: isRace ? (ev.description || '') : (evMetrics.descriptionText || ''),
        difficulty_score: (isRace || !isEvCycling) ? null : evMetrics.diffScore,
        category: isRace ? ev.category : (isEvCycling ? evMetrics.category : 'OTHER')
      });
    });

    // 3. Dodaj lokalne planirane treninge (koji nisu spareni)
    localScheduled.forEach(sched => {
      if (consumedLocalIds.has(sched.id)) return;
      if (!sched.date) return;

      const evCat = sched.eventCategory || 'WORKOUT';
      const isRace = isRaceEventCategory(evCat);
      let complianceColor = isRace ? 'race' : 'grey';
      if (!isRace && sched.date < todayStr) complianceColor = 'red-missed';

      const isLocCycling = !isNonCyclingEvent(sched);
      const locMetrics = getLocalPlannedMetrics(sched);
      const cleanDuration = isRace
        ? (locMetrics.durationMin || 0)
        : (locMetrics.durationMin > 0 ? locMetrics.durationMin : (isLocCycling ? 60 : 0));

      finalWorkouts.push({
        id: `local-${sched.id}`,
        eventCategory: evCat,
        type: sched.type || (isRace ? evCat : (isLocCycling ? 'ride' : 'strength')),
        planId: sched.planId || null,
        blockKey: sched.blockKey || null,
        date: sched.date,
        title: sched.title || (isRace ? 'Ciljni Event' : 'Planirani trening'),
        duration: cleanDuration,
        plannedDuration: cleanDuration,
        tss: locMetrics.tss,
        plannedTss: locMetrics.tss,
        statusColor: complianceColor,
        isCompleted: false,
        isLocal: true,
        steps: (isRace || !isLocCycling) ? null : (locMetrics.steps || sched.steps),
        intervalDescription: (isRace || !isLocCycling) ? null : locMetrics.intervalDescription,
        workout_doc: (isRace || !isLocCycling) ? null : locMetrics.workoutDoc,
        descriptionText: isRace ? (sched.descriptionText || '') : (locMetrics.descriptionText || ''),
        category: isRace ? evCat : (isLocCycling ? locMetrics.category : 'OTHER'),
        difficulty_score: (isRace || !isLocCycling) ? null : locMetrics.diffScore
      });
    });

    return finalWorkouts;
  }, [rawActivities, rawEvents, supabaseActivities, unpairedList, explicitPairings, localRefreshTrigger, userId, profileFtp, athleteInfo]);

  // Unificirani PMC engine (CTL / ATL / TSB): spaja stvarnu povijest s budućom projekcijom planiranih treninga
  const effectiveWellnessData = useMemo(() => {
    const today = new Date();
    const todayStr = formatLocalDate(today);

    const completedLoadByDate = new Map();
    const uncompletedPlannedLoadByDate = new Map();
    let minWorkoutDateStr = todayStr;
    let maxWorkoutDateStr = todayStr;
    let earliestUnsyncedLocalDate = null;

    (workouts || []).forEach(w => {
      if (!w?.date) return;
      if (w.date < minWorkoutDateStr) minWorkoutDateStr = w.date;
      if (w.date > maxWorkoutDateStr) maxWorkoutDateStr = w.date;

      if (w.isCompleted) {
        const load = Math.max(0, Number(w.tss) || 0);
        if (load > 0) {
          completedLoadByDate.set(w.date, (completedLoadByDate.get(w.date) || 0) + load);
        }
        if (w.isSupabase && !w.matchedIntervalsActId && w.date < todayStr) {
          if (!earliestUnsyncedLocalDate || w.date < earliestUnsyncedLocalDate) {
            earliestUnsyncedLocalDate = w.date;
          }
        }
      } else {
        const planned = Math.max(0, Number(w.plannedTss ?? w.tss) || 0);
        if (planned > 0) {
          uncompletedPlannedLoadByDate.set(w.date, (uncompletedPlannedLoadByDate.get(w.date) || 0) + planned);
        }
      }
    });

    const hasIntervalsWellness = wellnessData && Object.keys(wellnessData).length > 0;

    // U samostalnom načinu uključi i eventualno uvezenu CSV povijest za točniju CTL bazu
    if (!hasIntervalsWellness) {
      try {
        const extraCsv = JSON.parse(localStorage.getItem(`ergvibe_extra_historical_workouts_${userId || 'guest'}`) || '[]');
        extraCsv.forEach(item => {
          const dStr = String(item.date || '').split('T')[0];
          const load = Number(item.tss) || 0;
          if (dStr && dStr < todayStr && load > 0 && !completedLoadByDate.has(dStr)) {
            completedLoadByDate.set(dStr, load);
            if (dStr < minWorkoutDateStr) minWorkoutDateStr = dStr;
          }
        });
      } catch {
        // ignore
      }
    }

    if (!hasIntervalsWellness && completedLoadByDate.size === 0 && uncompletedPlannedLoadByDate.size === 0) {
      return {};
    }

    const computed = {};
    const kCtl = 1 - Math.exp(-1 / 42);
    const kAtl = 1 - Math.exp(-1 / 7);

    // Projekcija barem 60 dana unaprijed (pokriva sve tjedne u Kalendaru i graf Kondicije)
    const futureHorizon = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 60));
    const futureHorizonStr = futureHorizon.toISOString().split('T')[0];
    let endProjStr = futureHorizonStr;
    if (maxWorkoutDateStr >= endProjStr) {
      const [my, mm, md] = maxWorkoutDateStr.split('-').map(Number);
      const ext = new Date(Date.UTC(my, mm - 1, md + 14));
      endProjStr = ext.toISOString().split('T')[0];
    }

    // Pronađi najkasnije pouzdano povijesno sidro iz Intervals.icu (< todayStr i prije eventualnih nesinkroniziranih lokalnih vožnji)
    let anchorDateStr = null;
    if (hasIntervalsWellness) {
      const anchorLimit = earliestUnsyncedLocalDate && earliestUnsyncedLocalDate < todayStr
        ? earliestUnsyncedLocalDate
        : todayStr;

      const validPastDates = Object.keys(wellnessData)
        .filter(d => d < anchorLimit && wellnessData[d]?.ctl != null && wellnessData[d]?.atl != null)
        .sort();

      if (validPastDates.length > 0) {
        anchorDateStr = validPastDates[validPastDates.length - 1];
      }

      // Kopiraj sve izvorne wellness podatke (HRV, puls u mirovanju, san, te povijesni CTL/ATL do sidra)
      Object.entries(wellnessData).forEach(([dStr, wVal]) => {
        if (!wVal) return;
        if (anchorDateStr && dStr <= anchorDateStr) {
          const c = Number(wVal.ctl) || 0;
          const a = Number(wVal.atl) || 0;
          const t = wVal.tsb != null ? Number(wVal.tsb) : c - a;
          computed[dStr] = {
            ...wVal,
            ctl: c,
            atl: a,
            tsb: t,
            actualCtl: c,
            actualAtl: a,
            actualTsb: t,
            isProjected: false
          };
        } else {
          // Zadrži biometriju (HRV, restingHR, sleep) za danas/budućnost dok se CTL/ATL preračunaju dolje
          computed[dStr] = { ...wVal };
        }
      });
    }

    let startCalcDateUTC;
    let ctl = 0;
    let atl = 0;

    if (anchorDateStr) {
      ctl = Number(wellnessData[anchorDateStr].ctl) || 0;
      atl = Number(wellnessData[anchorDateStr].atl) || 0;
      const [ay, am, ad] = anchorDateStr.split('-').map(Number);
      startCalcDateUTC = new Date(Date.UTC(ay, am - 1, ad + 1));
    } else {
      // Samostalni izračun od barem 90 dana unatrag radi stabilizacije CTL (42d) krivulje
      const ninetyDaysAgo = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - 90));
      const minBaselineStr = ninetyDaysAgo.toISOString().split('T')[0];
      const effStartStr = minBaselineStr < minWorkoutDateStr ? minBaselineStr : minWorkoutDateStr;
      const [sy, sm, sd] = effStartStr.split('-').map(Number);
      startCalcDateUTC = new Date(Date.UTC(sy, sm - 1, sd));

      // Ako na samom današnjem danu postoji jedini Intervals zapis bez prošlosti, preuzmi ga kao početnu bazu
      if (hasIntervalsWellness && wellnessData[todayStr]?.ctl != null && completedLoadByDate.size === 0) {
        ctl = Number(wellnessData[todayStr].ctl) || 0;
        atl = Number(wellnessData[todayStr].atl) || 0;
        const [ty, tm, td] = todayStr.split('-').map(Number);
        startCalcDateUTC = new Date(Date.UTC(ty, tm - 1, td));
      }
    }

    const [ey, em, ed] = endProjStr.split('-').map(Number);
    const endDateUTC = new Date(Date.UTC(ey, em - 1, ed));
    const cur = new Date(startCalcDateUTC);

    while (cur <= endDateUTC) {
      const dStr = cur.toISOString().split('T')[0];
      const existingBio = computed[dStr] || {};

      if (dStr < todayStr) {
        // Prošli dani: u PMC ulaze isključivo stvarno odrađeni treninzi (propušteni treninzi nose 0 TSS)
        const actualLoad = completedLoadByDate.get(dStr) || 0;
        ctl = ctl + (actualLoad - ctl) * kCtl;
        atl = atl + (actualLoad - atl) * kAtl;
        const tsb = ctl - atl;
        computed[dStr] = {
          ...existingBio,
          ctl,
          atl,
          tsb,
          actualCtl: ctl,
          actualAtl: atl,
          actualTsb: tsb,
          isProjected: false
        };
      } else if (dStr === todayStr) {
        // Današnji dan: actualCtl odražava stanje UPRAVO SADA, a ctl projicira kraj dana (s preostalim planom za danas)
        const actualLoadToday = completedLoadByDate.get(dStr) || 0;
        const remainingPlannedToday = uncompletedPlannedLoadByDate.get(dStr) || 0;

        let actualCtlToday;
        let actualAtlToday;

        // Ako postoji svjež Intervals.icu zapis za danas i nema lokalnih nesinkroniziranih vožnji danas, drži 100% paritet s Intervalsom za trenutno stanje
        if (
          hasIntervalsWellness &&
          wellnessData[todayStr]?.ctl != null &&
          wellnessData[todayStr]?.atl != null &&
          !(workouts || []).some(w => w.date === todayStr && w.isCompleted && w.isSupabase && !w.matchedIntervalsActId)
        ) {
          actualCtlToday = Number(wellnessData[todayStr].ctl);
          actualAtlToday = Number(wellnessData[todayStr].atl);
        } else {
          actualCtlToday = ctl + (actualLoadToday - ctl) * kCtl;
          actualAtlToday = atl + (actualLoadToday - atl) * kAtl;
        }

        const totalProjectedLoadToday = actualLoadToday + remainingPlannedToday;
        if (remainingPlannedToday > 0) {
          ctl = ctl + (totalProjectedLoadToday - ctl) * kCtl;
          atl = atl + (totalProjectedLoadToday - atl) * kAtl;
        } else {
          ctl = actualCtlToday;
          atl = actualAtlToday;
        }

        computed[dStr] = {
          ...existingBio,
          ctl,
          atl,
          tsb: ctl - atl,
          actualCtl: actualCtlToday,
          actualAtl: actualAtlToday,
          actualTsb: actualCtlToday - actualAtlToday,
          hasUncompletedToday: remainingPlannedToday > 0,
          isProjected: remainingPlannedToday > 0
        };
      } else {
        // Budući dani: projekcija na temelju planiranog TSS-a (i prirodnog opadanja u danima odmora)
        const futureLoad = (completedLoadByDate.get(dStr) || 0) + (uncompletedPlannedLoadByDate.get(dStr) || 0);
        ctl = ctl + (futureLoad - ctl) * kCtl;
        atl = atl + (futureLoad - atl) * kAtl;
        computed[dStr] = {
          ...existingBio,
          ctl,
          atl,
          tsb: ctl - atl,
          isProjected: true
        };
      }

      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return computed;
  }, [wellnessData, workouts, userId]);

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
  }, [intervalsId, intervalsKey, userId]);

  /**
   * Briše odrađenu aktivnost iz Supabase baze.
   * Koristi se za brisanje lokalnih završenih treninga iz kalendara.
   */
  const handleDeleteCompletedActivity = useCallback(async (activityId) => {
    if (!activityId) return;

    if (activityId.startsWith('supabase-')) {
      const rawId = activityId.replace('supabase-', '');
      try {
        if (userId && userId !== 'guest' && !String(rawId).startsWith('local_act_')) {
          const { error } = await supabase
            .from('completed_activities')
            .delete()
            .eq('id', rawId);

          if (error) {
            console.warn('Greška pri brisanju Supabase aktivnosti, pokušavam obrisati samo lokalno:', error);
          }
        }

        // Obriši i iz localStorage fallbacka
        try {
          const localFallback = JSON.parse(localStorage.getItem(`ai_trener_local_completed_activities_${userId || 'guest'}`) || '[]');
          const updatedFallback = localFallback.filter(act => String(act.id) !== String(rawId) && String(act.id) !== `local_act_${rawId}`);
          localStorage.setItem(`ai_trener_local_completed_activities_${userId || 'guest'}`, JSON.stringify(updatedFallback));
        } catch (e) {
          console.warn('Greška pri brisanju iz localStorage:', e);
        }

        // Odmah ukloni iz lokalnog stanja
        setSupabaseActivities(prev => prev.filter(act => String(act.id) !== String(rawId) && String(act.id) !== `local_act_${rawId}`));

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
  }, [userId]);

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
  }, [rawEvents, intervalsId, intervalsKey, onRescheduleError, userId]);

  const handleUpdateWorkout = useCallback(async (workoutId, title, workout_doc, calculatedTss, calculatedDuration, extraFields = {}) => {
    const cleanTss = Math.max(0, Math.round(Number(calculatedTss) || 0));
    const cleanDurMin = Math.max(0, Math.round(Number(calculatedDuration) || 0));

    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const idx = localScheduled.findIndex(w => String(w.id) === String(rawId));
      if (idx > -1) {
        const nextType = extraFields.type || localScheduled[idx].type || 'ride';
        const isCycling = isCyclingType(nextType);
        const notes = extraFields.descriptionText !== undefined
          ? String(extraFields.descriptionText || '')
          : (typeof workout_doc === 'string' ? workout_doc : '');

        localScheduled[idx].title = title;
        localScheduled[idx].type = nextType;
        localScheduled[idx].tss = cleanTss;
        localScheduled[idx].duration = cleanDurMin;
        localScheduled[idx].duration_seconds = cleanDurMin * 60;

        if (isCycling) {
          localScheduled[idx].workout_doc = workout_doc;
          localScheduled[idx].steps = Array.isArray(extraFields.allSteps) && extraFields.allSteps.length > 0 ? extraFields.allSteps : workout_doc;
          localScheduled[idx].descriptionText = extraFields.descriptionText ?? '';
          if (extraFields.category) localScheduled[idx].category = extraFields.category;
          if (extraFields.difficulty_score !== undefined) localScheduled[idx].difficulty_score = extraFields.difficulty_score;
        } else {
          localScheduled[idx].workout_doc = '';
          localScheduled[idx].steps = [];
          localScheduled[idx].descriptionText = notes;
          localScheduled[idx].category = 'OTHER';
          localScheduled[idx].difficulty_score = null;
        }
        localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
        setLocalRefreshTrigger(prev => prev + 1);
      }
      return;
    }

    if (workoutId.startsWith('ev-')) {
      const eventId = workoutId.replace('ev-', '');
      const oldEvent = rawEvents.find(e => String(e.id) === eventId);
      if (!oldEvent) return;

      const nextType = extraFields.type ? toIntervalsSportType(extraFields.type) : (oldEvent.type || 'Ride');
      const isCycling = isCyclingType(nextType);
      const notes = extraFields.descriptionText !== undefined
        ? String(extraFields.descriptionText || '')
        : (typeof workout_doc === 'string' ? workout_doc : '');

      const apiPayload = {
        name: title,
        type: nextType,
        icu_training_load: cleanTss,
        moving_time: cleanDurMin * 60
      };
      if (isCycling) {
        if (workout_doc) {
          apiPayload.workout_doc = workout_doc;
        } else {
          apiPayload.description = '';
        }
      } else {
        apiPayload.description = notes;
      }

      // Optimistic update
      setRawEvents(prev => prev.map(e =>
        String(e.id) === eventId
          ? {
              ...e,
              name: title,
              type: nextType,
              description: isCycling ? (typeof workout_doc === 'string' ? workout_doc : e.description) : notes,
              workout_doc: isCycling ? workout_doc : null,
              icu_training_load: cleanTss,
              moving_time: cleanDurMin * 60
            }
          : e
      ));

      try {
        await updateEventDetails(intervalsId, intervalsKey, eventId, apiPayload);
      } catch (err) {
        console.error('Update Workout API error:', err);
        // Revert on error
        setRawEvents(prev => prev.map(e =>
          String(e.id) === eventId ? oldEvent : e
        ));
        throw err;
      }
    }
  }, [rawEvents, intervalsId, intervalsKey, userId]);

  const planRegistry = useMemo(() => readPlanRegistry(userId), [userId, localRefreshTrigger]);

  const buildLocalScheduledRecord = useCallback((wo, { idFallback, planIdOverride = null, blockKeyOverride = null } = {}) => {
    const evCat = wo.eventCategory || 'WORKOUT';
    const isRace = isRaceEventCategory(evCat);
    const isCycling = isCyclingType(wo.type);
    const durMin = normalizeDurationMinutes(wo, isRace);
    const rawId = String(wo.id || idFallback || `local-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).replace(/^local-/, '');
    const notes = wo.descriptionText ?? (typeof wo.description === 'string' ? wo.description : '') ?? '';

    return {
      id: rawId,
      date: wo.date,
      title: wo.title,
      duration: durMin,
      duration_seconds: durMin * 60,
      tss: Math.max(0, Math.round(Number(wo.tss) || 0)),
      workout_doc: (isRace || !isCycling) ? '' : (wo.description || ''),
      steps: (isRace || !isCycling)
        ? []
        : (Array.isArray(wo.allSteps) && wo.allSteps.length > 0 ? wo.allSteps : (wo.description || '')),
      category: isRace ? evCat : (isCycling ? (wo.category || 'WORKOUT') : 'OTHER'),
      eventCategory: evCat,
      planId: planIdOverride || wo.planId || null,
      blockKey: blockKeyOverride || wo.blockKey || null,
      descriptionText: isRace ? (wo.descriptionText || wo.description || '') : (isCycling ? (wo.descriptionText || '') : notes),
      difficulty_score: (isRace || !isCycling) ? null : (wo.difficulty_score ?? null),
      type: wo.type || (isRace ? evCat : 'ride')
    };
  }, []);

  const handleCreateWorkout = useCallback(async (workoutObj, options = {}) => {
    const { syncToIntervals = true } = options;
    const eventCategory = workoutObj.eventCategory || 'WORKOUT';
    const isRace = isRaceEventCategory(eventCategory);
    const durMin = normalizeDurationMinutes(workoutObj, isRace);

    let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
    const newLocalWorkout = buildLocalScheduledRecord(workoutObj);

    localScheduled.push(newLocalWorkout);
    localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));
    setLocalRefreshTrigger(prev => prev + 1);

    // Ako nemamo API ključeve ili je odabran isključivo lokalni upis, stajemo ovdje
    if (!syncToIntervals || !intervalsId || !intervalsKey) {
      return { success: true, id: `local-${newLocalWorkout.id}`, intervalsSynced: false };
    }

    // 2. Slanje na Intervals.icu u pozadini
    try {
      const payload = buildIntervalsEventPayload({ ...workoutObj, eventCategory, duration: durMin });
      const newEvent = await createEvent(intervalsId, intervalsKey, payload);

      // Uspješno dodano na Intervals! Brišemo lokalni privremeni i dodajemo pravi event
      localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      localScheduled = localScheduled.filter(w => w.id !== newLocalWorkout.id);
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify(localScheduled));

      setRawEvents(prev => [...prev, newEvent]);
      setLocalRefreshTrigger(prev => prev + 1);
      return { success: true, id: `ev-${newEvent.id}`, intervalsSynced: true, intervalsEventId: newEvent.id };
    } catch (err) {
      console.error('Create Workout API error:', err);
      return { success: true, id: `local-${newLocalWorkout.id}`, intervalsSynced: false, error: err?.message || 'Greška pri slanju na Intervals.icu' };
    }
  }, [intervalsId, intervalsKey, userId, buildLocalScheduledRecord]);

  /**
   * Grupno upisuje cijeli trenažni blok (i eventualni ciljni event) u lokalni Kalendar
   * te po želji sinkronizira sve stavke na Intervals.icu uz zaštitu od rate limita.
   */
  const handleCreatePlanBatch = useCallback(async (
    workoutObjs = [],
    {
      planId,
      blockKey,
      blockTitle = 'AI Trenažni Blok',
      planTitle = '',
      planStartDate = '',
      methodology = '',
      totalWeeks = null,
      blockIndex = null,
      firstWorkoutDate = '',
      goalTitle = '',
      eventDate = '',
      startDate = '',
      endDate = '',
      syncToIntervals = true,
      onProgress
    } = {}
  ) => {
    const itemsList = Array.isArray(workoutObjs) ? workoutObjs : [];
    if (itemsList.length === 0) {
      return { total: 0, intervalsCount: 0, localCount: 0, errors: [], blockKey };
    }

    const storageKey = `ai_trener_scheduled_workouts_${userId || 'guest'}`;
    let localScheduled = [];
    try {
      localScheduled = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      localScheduled = [];
    }

    const canSyncIntervals = Boolean(syncToIntervals && intervalsId && intervalsKey);
    const createdIntervalsIds = [];
    const createdLocalIds = [];
    const errors = [];

    if (canSyncIntervals) {
      const payloads = itemsList.map(wo => buildIntervalsEventPayload(wo));
      const { created, errors: batchErrors } = await createEventsBatch(intervalsId, intervalsKey, payloads, {
        onProgress,
        delayMs: 150
      });

      const createdIndexSet = new Set();
      const newEvents = [];
      created.forEach(({ index, event }) => {
        createdIndexSet.add(index);
        if (event) {
          newEvents.push(event);
          if (event.id != null) createdIntervalsIds.push(String(event.id));
        }
      });

      if (newEvents.length > 0) {
        setRawEvents(prev => [...prev, ...newEvents]);
      }

      batchErrors.forEach(errItem => {
        errors.push({ title: errItem.payload?.name || 'Trening', error: errItem.error });
      });

      // Ako neka stavka nije prošla na Intervals.icu, sačuvaj je lokalno da ništa ne nestane
      itemsList.forEach((wo, idx) => {
        if (!createdIndexSet.has(idx)) {
          const rec = buildLocalScheduledRecord(wo, {
            idFallback: `local-ai_${Date.now()}_${idx}`,
            planIdOverride: planId,
            blockKeyOverride: blockKey
          });
          localScheduled.push(rec);
          createdLocalIds.push(rec.id);
        }
      });
    } else {
      itemsList.forEach((wo, idx) => {
        if (onProgress) onProgress({ done: idx + 1, total: itemsList.length, currentName: wo.title || 'Trening' });
        const rec = buildLocalScheduledRecord(wo, {
          idFallback: `local-ai_${Date.now()}_${idx}`,
          planIdOverride: planId,
          blockKeyOverride: blockKey
        });
        localScheduled.push(rec);
        createdLocalIds.push(rec.id);
      });
    }

    if (createdLocalIds.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(localScheduled));
    }

    // Zabilježi u registar planova radi mogućnosti brisanja ili zamjene cijelog bloka/plana jednim klikom
    const resolvedBlockKey = blockKey || `block_${Date.now()}`;
    const registry = readPlanRegistry(userId).filter(entry => entry.blockKey !== resolvedBlockKey);
    registry.push({
      blockKey: resolvedBlockKey,
      planId: planId || null,
      title: blockTitle,
      planTitle: planTitle || undefined,
      planStartDate: planStartDate || undefined,
      methodology: methodology || undefined,
      totalWeeks: totalWeeks || undefined,
      blockIndex: blockIndex || undefined,
      firstWorkoutDate: firstWorkoutDate || undefined,
      goalTitle: goalTitle || undefined,
      eventDate: eventDate || undefined,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      intervalsIds: createdIntervalsIds,
      localIds: createdLocalIds
    });
    writePlanRegistry(userId, registry);
    setLocalRefreshTrigger(prev => prev + 1);

    return {
      total: itemsList.length,
      intervalsCount: createdIntervalsIds.length,
      localCount: createdLocalIds.length,
      errors,
      blockKey: resolvedBlockKey
    };
  }, [intervalsId, intervalsKey, userId]);

  /**
   * Jednim klikom briše sve treninge za jedan ili više blokova plana iz lokalnog kalendara i s Intervals.icu.
   */
  const handleDeletePlanBlocks = useCallback(async (blockKeys = [], { onProgress } = {}) => {
    const targetKeys = Array.from(new Set((Array.isArray(blockKeys) ? blockKeys : []).filter(Boolean)));
    if (targetKeys.length === 0) {
      return { deletedLocal: 0, deletedIntervals: 0, errors: [] };
    }

    const targetKeySet = new Set(targetKeys);
    const registry = readPlanRegistry(userId);
    const matchingEntries = registry.filter(item => targetKeySet.has(item.blockKey));

    const storageKey = `ai_trener_scheduled_workouts_${userId || 'guest'}`;
    let localScheduled = [];
    try {
      localScheduled = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      localScheduled = [];
    }

    const localIdSet = new Set();
    const intervalsIds = [];
    const seenIntervalsIds = new Set();

    matchingEntries.forEach(entry => {
      (entry?.localIds || []).forEach(id => localIdSet.add(String(id)));
      (entry?.intervalsIds || []).forEach(id => {
        const sId = String(id);
        if (!seenIntervalsIds.has(sId)) {
          seenIntervalsIds.add(sId);
          intervalsIds.push(sId);
        }
      });
    });

    const beforeLen = localScheduled.length;
    localScheduled = localScheduled.filter(
      w => !localIdSet.has(String(w.id)) && !targetKeySet.has(w.blockKey)
    );
    const deletedLocal = beforeLen - localScheduled.length;
    localStorage.setItem(storageKey, JSON.stringify(localScheduled));

    let deletedIntervals = 0;
    let errors = [];
    if (intervalsIds.length > 0 && intervalsId && intervalsKey) {
      const idSet = new Set(intervalsIds);
      setRawEvents(prev => prev.filter(e => !idSet.has(String(e.id))));
      const res = await deleteEventsBatch(intervalsId, intervalsKey, intervalsIds, { onProgress, delayMs: 120 });
      deletedIntervals = res.deleted.length;
      errors = res.errors;
    }

    writePlanRegistry(userId, registry.filter(item => !targetKeySet.has(item.blockKey)));
    setLocalRefreshTrigger(prev => prev + 1);

    return { deletedLocal, deletedIntervals, errors };
  }, [intervalsId, intervalsKey, userId]);

  /**
   * Jednim klikom briše sve treninge određenog bloka plana iz lokalnog kalendara i s Intervals.icu.
   */
  const handleDeletePlanBlock = useCallback(async (blockKey, options = {}) => {
    if (!blockKey) return { deletedLocal: 0, deletedIntervals: 0, errors: [] };
    return handleDeletePlanBlocks([blockKey], options);
  }, [handleDeletePlanBlocks]);

  return {
    workouts,
    wellnessData: effectiveWellnessData,
    intervalsConnected,
    athleteInfo,
    isLoading,
    error,
    planRegistry,
    fetchWorkouts,
    handlePair,
    handleUnpair,
    handleDeleteLocalActivity,
    handleDeleteCompletedActivity,
    handleRescheduleWorkout,
    handleUpdateWorkout,
    handleCreateWorkout,
    handleCreatePlanBatch,
    handleDeletePlanBlock,
    handleDeletePlanBlocks
  };
}

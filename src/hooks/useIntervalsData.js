import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchIntervalsData, updateEventDate, updateEventDetails } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';
import { parseWorkoutDoc, categorizeWorkout, calculateCategoryDifficulty } from '../utils/workoutParser';

const formatLocalDate = (d = new Date()) => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
};

const PLANNED_EVENT_CATEGORIES = new Set(['WORKOUT', 'RACE_A', 'RACE_B', 'RACE_C']);

const isIntervalsCyclingType = (typeStr) => {
  if (!typeStr) return true; // default je biciklizam kad tip nije specificiran na treningu
  const norm = String(typeStr).toLowerCase().replace(/[\s_-]/g, '');
  return [
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
    'spin'
  ].includes(norm);
};

// Helper: određuje je li aktivnost cycling tipa na temelju workout_source
const isCyclingActivity = (sbAct) => {
  if (!sbAct.workout_source) return true; // default je cycling
  const src = sbAct.workout_source.toLowerCase();
  if (src === 'free_ride' || src === 'calendar' || src === 'library' || src === 'local') return true;
  if (src.startsWith('external_upload_')) {
    const sport = src.replace('external_upload_', '');
    return isIntervalsCyclingType(sport);
  }
  if (src === 'external_upload') {
    return sbAct.avg_power > 0; // pretpostavljamo cycling ako ima wate
  }
  return true;
};

const extractEventPlannedMetrics = (ev, userFtp = 250) => {
  if (!ev) return { tss: 0, durationMin: 0, category: null, diffScore: null, targetNp: null, workoutDoc: null };
  const isEvCycling = isIntervalsCyclingType(ev.type);
  const docToParse = ev.workout_doc || ev.description;
  let parsed = null;
  let actCategory = isEvCycling ? null : 'OTHER';
  let diffScore = null;
  let targetNp = null;

  if (docToParse) {
    try {
      parsed = parseWorkoutDoc(docToParse, userFtp);
      if (isEvCycling && parsed && Array.isArray(parsed.allSteps) && parsed.allSteps.length > 0) {
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
    ev.workout_doc?.tss,
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
    ev.workout_doc?.duration,
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
    workoutDoc: ev.workout_doc || (parsed?.allSteps?.length > 0 ? ev.description : null)
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
    const localScheduled = rawLocalScheduled.map(item => {
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

    // Kreiraj Map objekte za O(1) lookup (uključuje WORKOUT i planirane utrke RACE_A/B/C)
    const eventsByDate = new Map();
    rawEvents.forEach(e => {
      if (!PLANNED_EVENT_CATEGORIES.has(e.category)) return;
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

    const getLocalPlannedMetrics = (lw) => {
      if (!lw) return { tss: 0, durationMin: 0, category: null, diffScore: null, workoutDoc: null };
      const isLocCycling = !lw.type || isIntervalsCyclingType(lw.type);
      let parsed = null;
      const docSource = lw.steps || lw.workout_doc;
      if ((!lw.tss || Number(lw.tss) <= 0 || !lw.category) && docSource) {
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
      let diff = lw.difficulty_score ?? null;
      if (isLocCycling && (!cat || cat === 'WORKOUT') && parsed?.allSteps?.length > 0) {
        cat = categorizeWorkout(parsed.allSteps);
        if (diff == null) diff = calculateCategoryDifficulty(parsed.allSteps, cat);
      }

      return {
        tss: Math.max(0, Math.round(rawTss)),
        durationMin: Math.max(0, Math.round(durMin)),
        category: cat,
        diffScore: diff,
        workoutDoc: lw.workout_doc || lw.steps
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
          const isEvCycling = isIntervalsCyclingType(e.type);
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
          const isActCyc = isIntervalsCyclingType(act.type);
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
              const isLocCycling = !lw.type || isIntervalsCyclingType(lw.type);
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
      } else if (pairedLocal) {
        const locMetrics = getLocalPlannedMetrics(pairedLocal);
        eventIdObj = `local-${pairedLocal.id}`;
        plannedTssDisplay = locMetrics.tss;
        plannedDurDisplay = locMetrics.durationMin;
        diffScore = locMetrics.diffScore;
        actCategory = locMetrics.category;
        workoutDoc = locMetrics.workoutDoc;
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
        duration: actualDur,
        plannedDuration: plannedDurDisplay,
        tss: actualTss,
        plannedTss: plannedTssDisplay,
        statusColor: complianceColor,
        isCompleted: true,
        isSupabase: true,
        workout_source: sbAct.workout_source || 'local',
        difficulty_score: diffScore,
        category: isCycling ? (actCategory && actCategory !== 'OTHER' ? actCategory : defaultCategory) : 'OTHER',
        workout_doc: workoutDoc || sbAct.workout_doc,
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
      const isActCycling = isIntervalsCyclingType(act.type);
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
              const isLocCycling = !lw.type || isIntervalsCyclingType(lw.type);
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
        } else {
          const locMetrics = getLocalPlannedMetrics(pairedLocal);
          eventIdObj = `local-${pairedLocal.id}`;
          plannedTssDisplay = locMetrics.tss;
          plannedDurDisplay = locMetrics.durationMin;
          diffScore = locMetrics.diffScore;
          actCategory = locMetrics.category;
          workoutDoc = locMetrics.workoutDoc;
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
        duration: actualDur,
        plannedDuration: plannedDurDisplay,
        tss: actualTss,
        plannedTss: plannedTssDisplay,
        statusColor: complianceColor,
        isCompleted: true,
        difficulty_score: diffScore,
        category: isActCycling ? (actCategory && actCategory !== 'OTHER' ? actCategory : defaultCategory) : 'OTHER',
        workout_doc: workoutDoc,
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

      const evDate = ev.start_date_local ? ev.start_date_local.split('T')[0] : '';
      if (!evDate) return;

      let complianceColor = 'grey';
      if (evDate < todayStr) complianceColor = 'red-missed';

      const evMetrics = extractEventPlannedMetrics(ev, effectiveFtp);
      const isEvCycling = isIntervalsCyclingType(ev.type);

      finalWorkouts.push({
        id: `ev-${ev.id}`,
        eventId: ev.id,
        date: evDate,
        title: ev.name || (ev.category?.startsWith('RACE') ? 'Utrka' : 'Planirano'),
        duration: evMetrics.durationMin,
        plannedDuration: evMetrics.durationMin,
        tss: evMetrics.tss,
        plannedTss: evMetrics.tss,
        statusColor: complianceColor,
        isCompleted: false,
        workout_doc: evMetrics.workoutDoc,
        difficulty_score: evMetrics.diffScore,
        category: isEvCycling ? evMetrics.category : 'OTHER'
      });
    });

    // 3. Dodaj lokalne planirane treninge (koji nisu spareni)
    localScheduled.forEach(sched => {
      if (consumedLocalIds.has(sched.id)) return;
      if (!sched.date) return;

      let complianceColor = 'grey';
      if (sched.date < todayStr) complianceColor = 'red-missed';

      const locMetrics = getLocalPlannedMetrics(sched);
      const cleanDuration = locMetrics.durationMin > 0 ? locMetrics.durationMin : 60;

      finalWorkouts.push({
        id: `local-${sched.id}`,
        date: sched.date,
        title: sched.title || 'Planirani trening',
        duration: cleanDuration,
        plannedDuration: cleanDuration,
        tss: locMetrics.tss,
        plannedTss: locMetrics.tss,
        statusColor: complianceColor,
        isCompleted: false,
        isLocal: true,
        steps: sched.steps,
        workout_doc: locMetrics.workoutDoc,
        category: locMetrics.category,
        difficulty_score: locMetrics.diffScore
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
    if (workoutId.startsWith('local-')) {
      const rawId = workoutId.replace('local-', '');
      let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const idx = localScheduled.findIndex(w => String(w.id) === String(rawId));
      if (idx > -1) {
        localScheduled[idx].title = title;
        localScheduled[idx].workout_doc = workout_doc;
        localScheduled[idx].steps = Array.isArray(extraFields.allSteps) && extraFields.allSteps.length > 0 ? extraFields.allSteps : workout_doc;
        localScheduled[idx].tss = calculatedTss;
        localScheduled[idx].duration = calculatedDuration;
        localScheduled[idx].duration_seconds = (calculatedDuration || 0) * 60;
        if (extraFields.category) localScheduled[idx].category = extraFields.category;
        if (extraFields.difficulty_score != null) localScheduled[idx].difficulty_score = extraFields.difficulty_score;
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
        await updateEventDetails(intervalsId, intervalsKey, eventId, {
          name: title,
          workout_doc: workout_doc,
          icu_training_load: calculatedTss,
          moving_time: (calculatedDuration || 0) * 60
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
  }, [rawEvents, intervalsId, intervalsKey, userId]);

  const handleCreateWorkout = useCallback(async (workoutObj) => {
    // 1. Priprema optimističnog stanja (kreiramo lokalni zapis)
    let durMin = workoutObj.duration;
    if (durMin && durMin >= 360 && durMin % 60 === 0) {
      durMin = Math.round(durMin / 60);
    } else if (durMin > 1440) {
      durMin = Math.round(durMin / 60);
    } else if (!durMin && workoutObj.duration_seconds) {
      durMin = Math.round(workoutObj.duration_seconds / 60);
    }
    durMin = Math.max(10, Math.round(durMin || 60));
    const durSec = durMin * 60;

    let localScheduled = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
    const newLocalWorkout = {
      id: workoutObj.id.replace('local-', ''),
      date: workoutObj.date,
      title: workoutObj.title,
      duration: durMin,
      duration_seconds: durSec,
      tss: workoutObj.tss,
      workout_doc: workoutObj.description,
      steps: Array.isArray(workoutObj.allSteps) && workoutObj.allSteps.length > 0 ? workoutObj.allSteps : workoutObj.description,
      category: workoutObj.category || 'WORKOUT',
      difficulty_score: workoutObj.difficulty_score ?? null,
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
        moving_time: durSec,
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
  }, [intervalsId, intervalsKey, userId]);

  return {
    workouts,
    wellnessData: effectiveWellnessData,
    intervalsConnected,
    athleteInfo,
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

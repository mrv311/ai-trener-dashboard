import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar, Trophy, Flag, Sparkles, CheckCircle2, AlertTriangle,
  Trash2, RefreshCw, ChevronRight, Loader2, ExternalLink, Info,
  Layers, Activity, Clock, Zap, Check, Plus, Cloud, HardDrive,
  MessageSquare, Send, X, SlidersHorizontal
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import {
  PHASE_META,
  WEEKDAY_DEFS,
  DURATION_TIERS,
  DEFAULT_WEEKLY_SCHEDULE,
  getWeekdayShort,
  getWeekdayName,
  getLocalizedPhaseLabel,
  getLocalizedEventType,
  chunkWeeksIntoBlocks,
  getLocalIsoToday,
  diffDaysIso,
  addDaysIso,
  formatShortHrDate,
  getMondayOfWeekIso,
  getPlanStorageKey,
  loadSavedPlan,
  clearSavedPlan,
  buildPlanAnalysisPrompt,
  summarizeWeeklySchedule,
  PLAN_STORAGE_EVENT,
  savePlannerSchedule
} from '../../utils/plannerUtils';
import {
  generateMacrocycleBlueprint,
  generatePlanBlockWorkouts,
  reviseSinglePlanWorkout
} from '../../services/geminiService';
import { AIWorkoutCard, buildErgVibeWorkoutObject } from '../ai/AIMarkdown';
import PlanQuestionnaire from './PlanQuestionnaire';

export default function TrainingPlannerView({
  profile,
  setProfile,
  workouts = [],
  wellnessData = {},
  userId = null,
  intervalsConnected = false,
  selectedModel,
  initialPrefill = null,
  forceOpenWizard = false,
  plannerLaunchRequest = null,
  onClearPrefill,
  onAddWorkoutToCalendar,
  onCreatePlanBatch,
  onDeletePlanBlock,
  onDeletePlanBlocks,
  planRegistry = [],
  onStartWorkoutInTrainer,
  onNavigateToCalendar,
  onAnalyzePlanInCoach,
  onGeneratingChange
}) {
  const { lang, isEn, tr } = useI18n();
  const todayIso = getLocalIsoToday();
  const ftp = Number(profile?.ftp) || 200;

  const [savedPlan, setSavedPlan] = useState(() => loadSavedPlan(userId));
  const [showWizard, setShowWizard] = useState(() => !loadSavedPlan(userId) || Boolean(forceOpenWizard) || Boolean(initialPrefill));
  const [activeBlockKey, setActiveBlockKey] = useState(() => {
    const existing = loadSavedPlan(userId);
    if (!existing?.blueprint) return '1-4';
    const blocks = chunkWeeksIntoBlocks(existing.blueprint.totalWeeks, 4);
    return blocks[0]?.key || '1-4';
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState(null);
  const [genError, setGenError] = useState(null);
  const [isGeneratingBlock, setIsGeneratingBlock] = useState(false);
  const [showRationale, setShowRationale] = useState(false);

  // Block & single-workout AI feedback / revision state
  const [showBlockFeedbackBox, setShowBlockFeedbackBox] = useState(false);
  const [blockFeedbackText, setBlockFeedbackText] = useState('');
  const [editingWorkoutKey, setEditingWorkoutKey] = useState(null);
  const [workoutFeedbackText, setWorkoutFeedbackText] = useState('');
  const [revisingWorkoutKey, setRevisingWorkoutKey] = useState(null);

  // Weekly schedule editor (za prilagodbu dana/sati za iduće ili aktivni blok)
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [draftSchedule, setDraftSchedule] = useState(null);
  const [scheduleEditorError, setScheduleEditorError] = useState('');

  // Plan deletion state
  const [showDeletePlanConfirm, setShowDeletePlanConfirm] = useState(false);
  const [deleteAlsoCalendar, setDeleteAlsoCalendar] = useState(true);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  const [planDeletedNotice, setPlanDeletedNotice] = useState('');
  const lastHandledLaunchNonceRef = useRef(null);

  // Sync panel state
  const [syncToIntervals, setSyncToIntervals] = useState(intervalsConnected);
  const [collisionMode, setCollisionMode] = useState('skip'); // 'skip' | 'alongside' | 'replace'
  const [includeTargetEventInSync, setIncludeTargetEventInSync] = useState(true);
  const [syncProgress, setSyncProgress] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);

  // Reload saved plan when userId switches
  useEffect(() => {
    const loaded = loadSavedPlan(userId);
    setSavedPlan(loaded);
    if (loaded?.blueprint) {
      const blocks = chunkWeeksIntoBlocks(loaded.blueprint.totalWeeks, 4);
      setActiveBlockKey(blocks[0]?.key || '1-4');
      if (!forceOpenWizard && !initialPrefill) {
        setShowWizard(false);
      }
    } else {
      setShowWizard(true);
    }
  }, [userId]);

  // Sinkroniziraj stanje ako je plan obrisan izvana (npr. direktno iz Kalendara dok je Planer ostao u pozadini)
  useEffect(() => {
    const handleExternalPlanChange = (e) => {
      const targetUser = e?.detail?.userId || 'guest';
      const currentUser = userId || 'guest';
      if (targetUser !== currentUser) return;

      const latest = loadSavedPlan(userId);
      setSavedPlan(latest);
      if (!latest?.blueprint) {
        setActiveBlockKey('1-4');
        setShowDeletePlanConfirm(false);
        setShowBlockFeedbackBox(false);
        setShowScheduleEditor(false);
        setEditingWorkoutKey(null);
        setSyncStatus(null);
        setShowWizard(true);
      }
    };

    window.addEventListener(PLAN_STORAGE_EVENT, handleExternalPlanChange);
    return () => window.removeEventListener(PLAN_STORAGE_EVENT, handleExternalPlanChange);
  }, [userId]);

  useEffect(() => {
    if (forceOpenWizard || initialPrefill) {
      setShowWizard(true);
    }
  }, [forceOpenWizard, initialPrefill]);

  useEffect(() => {
    if (!plannerLaunchRequest?.nonce) return;
    if (lastHandledLaunchNonceRef.current === plannerLaunchRequest.nonce) return;
    lastHandledLaunchNonceRef.current = plannerLaunchRequest.nonce;

    if (!plannerLaunchRequest.openWizard && !plannerLaunchRequest.prefill) {
      setShowWizard(false);
      if (plannerLaunchRequest.focusBlockKey) {
        const subKey = plannerLaunchRequest.focusBlockKey.includes(':')
          ? plannerLaunchRequest.focusBlockKey.split(':')[1]
          : plannerLaunchRequest.focusBlockKey;
        if (subKey) setActiveBlockKey(subKey);
      }
      if (plannerLaunchRequest.openFeedback) {
        setShowBlockFeedbackBox(true);
      }
      onClearPrefill?.();
    }
  }, [plannerLaunchRequest, onClearPrefill]);

  useEffect(() => {
    if (intervalsConnected) {
      setSyncToIntervals(true);
    }
  }, [intervalsConnected]);

  useEffect(() => {
    onGeneratingChange?.(isGenerating || isGeneratingBlock || Boolean(revisingWorkoutKey) || isDeletingPlan);
  }, [isGenerating, isGeneratingBlock, revisingWorkoutKey, isDeletingPlan, onGeneratingChange]);

  const persistPlan = (nextPlan) => {
    setSavedPlan(nextPlan);
    try {
      localStorage.setItem(getPlanStorageKey(userId), JSON.stringify(nextPlan));
    } catch {
      // ignore quota errors
    }
  };

  const blueprint = savedPlan?.blueprint || null;
  const questionnaire = savedPlan?.questionnaire || null;
  const generatedBlocks = savedPlan?.blocks || {};

  const blockMetas = useMemo(() => {
    if (!blueprint) return [];
    return chunkWeeksIntoBlocks(blueprint.totalWeeks, 4);
  }, [blueprint]);

  const activeBlockMeta = useMemo(() => {
    if (blockMetas.length === 0) return null;
    return blockMetas.find(b => b.key === activeBlockKey) || blockMetas[0];
  }, [blockMetas, activeBlockKey]);

  const activeBlockData = activeBlockMeta ? generatedBlocks[activeBlockMeta.key] || null : null;

  const registryBlockKey = blueprint && activeBlockMeta
    ? `${blueprint.planId}:${activeBlockMeta.key}`
    : null;

  const activeSyncedRecord = useMemo(() => {
    if (!registryBlockKey) return null;
    return planRegistry.find(p => p.blockKey === registryBlockKey) || null;
  }, [planRegistry, registryBlockKey]);

  const hasUnsyncedBlockChanges = useMemo(() => {
    if (!activeSyncedRecord || !activeBlockData?.updatedAt || !activeSyncedRecord?.createdAt) {
      return false;
    }
    return String(activeBlockData.updatedAt) > String(activeSyncedRecord.createdAt);
  }, [activeSyncedRecord, activeBlockData?.updatedAt]);

  const syncedPlanBlocksForCurrentPlan = useMemo(() => {
    if (!blueprint?.planId) return [];
    return planRegistry.filter(p => p.planId === blueprint.planId);
  }, [planRegistry, blueprint?.planId]);

  const isEventInCalendar = useMemo(() => {
    if (!blueprint || blueprint.goalMode !== 'event' || !blueprint.eventDate) return false;
    return workouts.some(
      w => w.date === blueprint.eventDate && ['RACE_A', 'RACE_B', 'RACE_C'].includes(w.eventCategory)
    );
  }, [blueprint, workouts]);

  const activeBlockWorkouts = useMemo(() => {
    if (!activeBlockData?.weeks) return [];
    const list = [];
    activeBlockData.weeks.forEach(week => {
      (week.workouts || []).forEach(w => list.push({ ...w, weekNumber: week.weekNumber }));
    });
    return list;
  }, [activeBlockData]);

  // Collisions with already-planned (uncompleted, non-race) workouts
  const collidingDates = useMemo(() => {
    if (activeBlockWorkouts.length === 0) return [];
    const plannedDates = new Set(
      workouts
        .filter(w => !w.isCompleted && !['RACE_A', 'RACE_B', 'RACE_C'].includes(w.eventCategory))
        .map(w => w.date)
    );
    const seen = new Set();
    const overlaps = [];
    activeBlockWorkouts.forEach(w => {
      if (w.date && plannedDates.has(w.date) && !seen.has(w.date)) {
        seen.add(w.date);
        overlaps.push(w.date);
      }
    });
    return overlaps.sort();
  }, [activeBlockWorkouts, workouts]);

  const activeBlockDateRange = useMemo(() => {
    if (activeBlockData?.weeks?.length) {
      const start = activeBlockData.weeks[0].startDate;
      const end = activeBlockData.weeks[activeBlockData.weeks.length - 1].endDate;
      return { start, end };
    }
    if (blueprint?.baseMondayIso && activeBlockMeta) {
      const start = addDaysIso(blueprint.baseMondayIso, (activeBlockMeta.weekFrom - 1) * 7);
      const end = addDaysIso(blueprint.baseMondayIso, activeBlockMeta.weekTo * 7 - 1);
      return { start, end };
    }
    return { start: todayIso, end: todayIso };
  }, [activeBlockData, blueprint, activeBlockMeta, todayIso]);

  const overlappingRegistryBlocks = useMemo(() => {
    if (!activeBlockDateRange.start || !activeBlockDateRange.end) return [];
    return planRegistry.filter(
      p => p.startDate <= activeBlockDateRange.end && p.endDate >= activeBlockDateRange.start
    );
  }, [planRegistry, activeBlockDateRange]);

  const buildRaceEventPayload = () => {
    if (!blueprint || blueprint.goalMode !== 'event' || !blueprint.eventDate) return null;
    const descParts = [
      getLocalizedEventType(blueprint.eventType, lang) || tr('Ciljni Event', 'Target Event'),
      blueprint.eventDistanceKm ? `${blueprint.eventDistanceKm} km` : '',
      blueprint.eventElevationM ? tr('{m} m uspona', '{m} m elevation', { m: blueprint.eventElevationM }) : ''
    ].filter(Boolean);

    return {
      title: blueprint.goalTitle || tr('Ciljni Event', 'Target Event'),
      date: blueprint.eventDate,
      category: blueprint.eventType || tr('Utrka / Event', 'Race / Event'),
      eventCategory: blueprint.eventPriority || 'RACE_A',
      duration: 0,
      tss: 0,
      steps: [],
      descriptionText: descParts.join(' • '),
      isLocal: true
    };
  };

  const handleQuestionnaireSubmit = async (formData) => {
    setIsGenerating(true);
    setGenError(null);
    setSyncStatus(null);
    setPlanDeletedNotice('');
    setGenerationStage('blueprint');

    // Sačuvaj podatke o cilju i profilu u korisnički profil
    if (setProfile) {
      setProfile(prev => ({
        ...prev,
        primaryGoal: formData.goalTitle,
        goalDate: formData.goalMode === 'event' ? formData.eventDate : '',
        hoursPerWeek: formData.hoursPerWeek,
        experience: formData.experience,
        riderType: formData.riderType,
        weakness: formData.weakness
      }));
    }

    try {
      const newBlueprint = await generateMacrocycleBlueprint({
        ...formData,
        athleteProfile: { ...profile, ...formData },
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });

      const enrichedBlueprint = {
        ...newBlueprint,
        eventDistanceKm: formData.eventDistanceKm || '',
        eventElevationM: formData.eventElevationM || ''
      };

      const blocks = chunkWeeksIntoBlocks(enrichedBlueprint.totalWeeks, 4);
      const firstBlock = blocks[0];

      setGenerationStage('block1');

      const firstBlockData = await generatePlanBlockWorkouts({
        blueprint: enrichedBlueprint,
        weekFrom: firstBlock.weekFrom,
        weekTo: firstBlock.weekTo,
        weeklySchedule: formData.weeklySchedule,
        minWorkoutDate: formData.startDate,
        prioritizeCustomSources: Boolean(formData.prioritizeCustomSources),
        notes: formData.notes,
        athleteProfile: { ...profile, ...formData },
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });

      const nextPlan = {
        blueprint: enrichedBlueprint,
        questionnaire: formData,
        blocks: {
          [firstBlock.key]: firstBlockData
        },
        updatedAt: new Date().toISOString()
      };

      persistPlan(nextPlan);
      setActiveBlockKey(firstBlock.key);
      setIncludeTargetEventInSync(formData.goalMode === 'event' && formData.addEventToCalendar !== false);
      setShowWizard(false);
      onClearPrefill?.();
    } catch (err) {
      setGenError(err?.message || tr('Greška pri generiranju makro-plana.', 'Error generating macrocycle plan.'));
    } finally {
      setIsGenerating(false);
      setGenerationStage(null);
    }
  };

  const handleGenerateBlock = async (blockMeta, blockFeedback = '', options = {}) => {
    if (!blueprint || !blockMeta || isGeneratingBlock || revisingWorkoutKey) return;
    const trimmedFeedback = String(blockFeedback || '').trim();
    const basePlan = options?.basePlanOverride || savedPlan;
    const baseBlocks = basePlan?.blocks || generatedBlocks;
    const activeQuestionnaire = basePlan?.questionnaire || questionnaire;
    setIsGeneratingBlock(true);
    setGenError(null);
    setSyncStatus(null);

    try {
      const schedule = options?.scheduleOverride || activeQuestionnaire?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE;
      const minDate = activeQuestionnaire?.startDate || blueprint.startDate || todayIso;

      const blockData = await generatePlanBlockWorkouts({
        blueprint,
        weekFrom: blockMeta.weekFrom,
        weekTo: blockMeta.weekTo,
        weeklySchedule: schedule,
        minWorkoutDate: minDate,
        prioritizeCustomSources: Boolean(activeQuestionnaire?.prioritizeCustomSources),
        notes: activeQuestionnaire?.notes || '',
        blockFeedback: trimmedFeedback,
        previousBlockData: trimmedFeedback ? baseBlocks[blockMeta.key] || null : null,
        athleteProfile: profile,
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });

      const nowIso = new Date().toISOString();
      const nextPlan = {
        ...basePlan,
        blocks: {
          ...baseBlocks,
          [blockMeta.key]: {
            ...blockData,
            updatedAt: nowIso
          }
        },
        updatedAt: nowIso
      };
      persistPlan(nextPlan);
      setActiveBlockKey(blockMeta.key);
      setEditingWorkoutKey(null);
      setWorkoutFeedbackText('');

      const isAlreadySynced = planRegistry.some(
        p => p.blockKey === `${blueprint.planId}:${blockMeta.key}`
      );

      if (trimmedFeedback) {
        setShowBlockFeedbackBox(false);
        setBlockFeedbackText('');

        setSyncStatus({
          type: isAlreadySynced ? 'warning' : 'success',
          canQuickUpdate: isAlreadySynced,
          text: isAlreadySynced
            ? tr(
                'Blok {idx} je ažuriran prema komentaru. Klikni "Ažuriraj blok u Kalendaru" da se nova verzija odmah prenese.',
                'Block {idx} has been updated based on your feedback. Click "Update Block in Calendar" to sync the new version now.',
                { idx: blockMeta.blockIndex }
              )
            : tr(
                'Blok {idx} je ažuriran prema tvom komentaru!',
                'Block {idx} has been updated based on your feedback!',
                { idx: blockMeta.blockIndex }
              )
        });
      } else if (isAlreadySynced) {
        setSyncStatus({
          type: 'warning',
          canQuickUpdate: true,
          text: tr(
            'Blok {idx} je ponovno generiran. Klikni "Ažuriraj blok u Kalendaru" za zamjenu stare verzije.',
            'Block {idx} has been regenerated. Click "Update Block in Calendar" to replace the previous version.',
            { idx: blockMeta.blockIndex }
          )
        });
      }
    } catch (err) {
      setGenError(err?.message || tr('Greška pri generiranju Bloka {idx}.', 'Error generating Block {idx}.', { idx: blockMeta.blockIndex }));
    } finally {
      setIsGeneratingBlock(false);
    }
  };

  const openScheduleEditor = () => {
    const current = questionnaire?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE;
    const cloned = {};
    WEEKDAY_DEFS.forEach((d) => {
      cloned[d.key] = {
        enabled: Boolean(current[d.key]?.enabled),
        minutes: Number(current[d.key]?.minutes) || 60
      };
    });
    setDraftSchedule(cloned);
    setScheduleEditorError('');
    setShowScheduleEditor(true);
  };

  const toggleDraftDay = (dayKey) => {
    setDraftSchedule((prev) => ({
      ...prev,
      [dayKey]: {
        ...(prev?.[dayKey] || { enabled: false, minutes: 60 }),
        enabled: !prev?.[dayKey]?.enabled
      }
    }));
    setScheduleEditorError('');
  };

  const setDraftDayMinutes = (dayKey, minutes) => {
    setDraftSchedule((prev) => ({
      ...prev,
      [dayKey]: {
        enabled: true,
        minutes
      }
    }));
    setScheduleEditorError('');
  };

  const applyDraftSchedulePreset = (preset) => {
    const presets = {
      '3x': {
        mon: { enabled: false, minutes: 60 },
        tue: { enabled: true, minutes: 60 },
        wed: { enabled: false, minutes: 60 },
        thu: { enabled: true, minutes: 60 },
        fri: { enabled: false, minutes: 45 },
        sat: { enabled: true, minutes: 135 },
        sun: { enabled: false, minutes: 90 }
      },
      '4x': { ...DEFAULT_WEEKLY_SCHEDULE },
      '5x': {
        mon: { enabled: false, minutes: 60 },
        tue: { enabled: true, minutes: 60 },
        wed: { enabled: true, minutes: 60 },
        thu: { enabled: true, minutes: 90 },
        fri: { enabled: false, minutes: 45 },
        sat: { enabled: true, minutes: 135 },
        sun: { enabled: true, minutes: 90 }
      }
    };
    if (presets[preset]) {
      setDraftSchedule(presets[preset]);
      setScheduleEditorError('');
    }
  };

  const handleSaveSchedule = async ({ regenerateActiveBlock = false } = {}) => {
    if (!draftSchedule || !savedPlan) return;
    const summary = summarizeWeeklySchedule(draftSchedule);
    if (summary.workoutsPerWeek === 0) {
      setScheduleEditorError(tr('Označi barem jedan dan u tjednu kad možeš trenirati.', 'Select at least one day per week when you can train.'));
      return;
    }

    const nextPlan = {
      ...savedPlan,
      questionnaire: {
        ...(savedPlan.questionnaire || {}),
        weeklySchedule: draftSchedule,
        hoursPerWeek: summary.hoursPerWeek,
        workoutsPerWeek: summary.workoutsPerWeek
      },
      updatedAt: new Date().toISOString()
    };

    persistPlan(nextPlan);
    savePlannerSchedule(userId, draftSchedule);
    if (setProfile) {
      setProfile((prev) => ({ ...prev, hoursPerWeek: summary.hoursPerWeek }));
    }
    setShowScheduleEditor(false);
    setScheduleEditorError('');

    if (regenerateActiveBlock && activeBlockMeta) {
      await handleGenerateBlock(activeBlockMeta, '', {
        scheduleOverride: draftSchedule,
        basePlanOverride: nextPlan
      });
    } else {
      setSyncStatus({
        type: 'success',
        text: tr(
          'Tjedni raspored je spremljen ({perWeek}× tj., ~{hours} h/tj.). Primijenit će se na sve nove ili regenerirane blokove.',
          'Weekly schedule saved ({perWeek}×/wk, ~{hours} h/wk). It will apply to all new or regenerated blocks.',
          { perWeek: summary.workoutsPerWeek, hours: summary.hoursPerWeek }
        )
      });
    }
  };

  const handleReviseSingleWorkout = async (week, workout, workoutIndex) => {
    if (!blueprint || !activeBlockMeta || !workout || revisingWorkoutKey || isGeneratingBlock) return;
    const trimmedFeedback = String(workoutFeedbackText || '').trim();
    if (!trimmedFeedback) return;

    const workoutKey = `${week.weekNumber}-${workout.date}-${workoutIndex}`;
    setRevisingWorkoutKey(workoutKey);
    setGenError(null);
    setSyncStatus(null);

    try {
      const schedule = questionnaire?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE;
      const dayKeysByJsDay = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const inferredDayKey = workout.dayKey || (
        workout.date ? dayKeysByJsDay[new Date(`${workout.date}T12:00:00`).getDay()] : null
      );
      const scheduledMins = Number(schedule[inferredDayKey]?.minutes ?? schedule[inferredDayKey]?.maxMinutes) || 0;
      const dayMaxMinutes = Math.max(scheduledMins, Number(workout.durationMinutes) || 0) || 60;

      const revisedWorkout = await reviseSinglePlanWorkout({
        blueprint,
        weekMeta: {
          weekNumber: week.weekNumber,
          phaseType: week.phaseType,
          phaseLabel: week.phaseLabel,
          theme: week.theme,
          targetTss: week.targetTss,
          isRecoveryWeek: week.isRecoveryWeek
        },
        workout,
        feedback: trimmedFeedback,
        dayMaxMinutes,
        athleteProfile: profile,
        wellnessData,
        model: selectedModel,
        userId
      });

      const currentBlockData = generatedBlocks[activeBlockMeta.key];
      if (!currentBlockData) {
        throw new Error(tr('Aktivni blok nije pronađen za spremanje izmjene.', 'Active block not found to save the revision.'));
      }

      const updatedWeeks = (currentBlockData.weeks || []).map(wk => {
        if (wk.weekNumber !== week.weekNumber) return wk;
        return {
          ...wk,
          workouts: (wk.workouts || []).map((item, idx) =>
            idx === workoutIndex ? revisedWorkout : item
          )
        };
      });

      const nowIso = new Date().toISOString();
      const nextPlan = {
        ...savedPlan,
        blocks: {
          ...generatedBlocks,
          [activeBlockMeta.key]: {
            ...currentBlockData,
            weeks: updatedWeeks,
            updatedAt: nowIso
          }
        },
        updatedAt: nowIso
      };

      persistPlan(nextPlan);
      setEditingWorkoutKey(null);
      setWorkoutFeedbackText('');

      const isAlreadySynced = planRegistry.some(
        p => p.blockKey === `${blueprint.planId}:${activeBlockMeta.key}`
      );
      setSyncStatus({
        type: isAlreadySynced ? 'warning' : 'success',
        canQuickUpdate: isAlreadySynced,
        text: isAlreadySynced
          ? tr(
              'Trening "{title}" ({date}) je zamijenjen u planu. Klikni "Ažuriraj blok u Kalendaru" da se izmjena odmah prenese.',
              'Workout "{title}" ({date}) has been updated in the plan. Click "Update Block in Calendar" to sync the change now.',
              { title: revisedWorkout.title, date: formatShortHrDate(revisedWorkout.date, lang) }
            )
          : tr(
              'Trening za {date} je ažuriran: "{title}".',
              'Workout for {date} updated: "{title}".',
              { date: formatShortHrDate(revisedWorkout.date, lang), title: revisedWorkout.title }
            )
      });
    } catch (err) {
      setGenError(err?.message || tr('Greška pri korekciji odabranog treninga.', 'Error revising the selected workout.'));
    } finally {
      setRevisingWorkoutKey(null);
    }
  };

  const handleAddRaceEventOnly = async () => {
    if (!onAddWorkoutToCalendar) return;
    const payload = buildRaceEventPayload();
    if (!payload) return;

    setSyncStatus(null);
    const res = await onAddWorkoutToCalendar(payload, { syncToIntervals: intervalsConnected && syncToIntervals });
    if (res?.success) {
      setSyncStatus({
        type: 'success',
        text: res.intervalsSynced
          ? tr(
              'Event "{title}" ({date}) dodan u Kalendar i Intervals.icu!',
              'Event "{title}" ({date}) added to Calendar and Intervals.icu!',
              { title: payload.title, date: formatShortHrDate(payload.date, lang) }
            )
          : tr(
              'Event "{title}" ({date}) dodan u lokalni Kalendar.',
              'Event "{title}" ({date}) added to local Calendar.',
              { title: payload.title, date: formatShortHrDate(payload.date, lang) }
            ),
        targetDate: payload.date
      });
    } else {
      setSyncStatus({
        type: 'error',
        text: res?.error || tr('Nije uspjelo dodavanje eventa u kalendar.', 'Failed to add event to calendar.')
      });
    }
  };

  const createProgressHandler = (mode, fallbackTotal, buildMessage) => (progressArg, legacyTotal) => {
    const isObj = progressArg && typeof progressArg === 'object';
    const done = Number(isObj ? progressArg.done : progressArg) || 0;
    const total = Math.max(1, Number(isObj ? progressArg.total : (legacyTotal ?? fallbackTotal)) || 1);
    const currentName = isObj && progressArg.currentName ? String(progressArg.currentName) : '';
    setSyncProgress({
      mode,
      done,
      total,
      message: buildMessage({ done, total, currentName })
    });
  };

  const handleSyncActiveBlock = async ({ replaceCurrentSynced = false } = {}) => {
    if (!activeBlockData || !activeBlockMeta || !blueprint || !onCreatePlanBatch) return;

    setSyncStatus(null);

    try {
      // 1-klik ažuriranje već sinkroniziranog bloka: prvo ukloni staru verziju istog bloka
      if (replaceCurrentSynced && activeSyncedRecord && onDeletePlanBlock) {
        const oldTotal = Math.max(1, (activeSyncedRecord.localIds?.length || 0) + (activeSyncedRecord.intervalsIds?.length || 0));
        setSyncProgress({
          mode: 'delete',
          done: 0,
          total: oldTotal,
          message: tr('Uklanjanje stare verzije Bloka {idx}...', 'Removing previous version of Block {idx}...', { idx: activeBlockMeta.blockIndex })
        });
        await onDeletePlanBlock(activeSyncedRecord.blockKey, {
          onProgress: createProgressHandler(
            'delete',
            oldTotal,
            ({ done, total }) => tr('Uklanjanje stare verzije bloka ({done}/{total})...', 'Removing previous block version ({done}/{total})...', { done, total })
          )
        });
      } else if (collisionMode === 'replace' && overlappingRegistryBlocks.length > 0 && onDeletePlanBlock) {
        // Ako je odabrana zamjena prethodnih AI blokova koji se preklapaju
        for (const oldBlock of overlappingRegistryBlocks) {
          const oldTotal = Math.max(1, (oldBlock.localIds?.length || 0) + (oldBlock.intervalsIds?.length || 0));
          setSyncProgress({
            mode: 'delete',
            done: 0,
            total: oldTotal,
            message: tr('Uklanjanje starog bloka ({title})...', 'Removing previous block ({title})...', { title: oldBlock.title })
          });
          await onDeletePlanBlock(oldBlock.blockKey, {
            onProgress: createProgressHandler(
              'delete',
              oldTotal,
              ({ done, total }) => tr('Uklanjanje prethodnog bloka ({done}/{total})...', 'Removing previous block ({done}/{total})...', { done, total })
            )
          });
        }
      }

      const occupiedDates = new Set(collidingDates);
      const workoutsToSync = activeBlockWorkouts.filter(w => {
        if (!replaceCurrentSynced && collisionMode === 'skip' && occupiedDates.has(w.date)) return false;
        return true;
      });

      const workoutPayloads = workoutsToSync.map(w =>
        buildErgVibeWorkoutObject({
          title: w.title,
          category: w.category || 'Endurance',
          type: w.type || 'ride',
          intervalsCode: w.intervalsCode,
          steps: w.steps,
          durationMinutes: w.durationMinutes,
          estimatedTss: w.estimatedTss,
          descriptionText: w.descriptionText || '',
          coachNote: w.coachNote || '',
          date: w.date,
          ftp
        })
      );

      const shouldAddRaceEventSeparately = Boolean(
        !replaceCurrentSynced &&
        includeTargetEventInSync &&
        blueprint.goalMode === 'event' &&
        !isEventInCalendar &&
        onAddWorkoutToCalendar
      );

      if (workoutPayloads.length === 0 && !shouldAddRaceEventSeparately) {
        setSyncStatus({
          type: 'warning',
          text: tr(
            'Svi datumi ovog bloka već su zauzeti postojećim treninzima pa ništa nije dodano. Odaberi "Dodaj uz postojeće" ili oslobodi dane u kalendaru.',
            'All dates in this block already have scheduled workouts, so nothing was added. Choose "Add alongside existing" or free up days in your calendar.'
          )
        });
        setSyncProgress(null);
        return;
      }

      const useIntervals = Boolean(intervalsConnected && syncToIntervals);
      let result = { total: 0, intervalsCount: 0, localCount: 0, errors: [] };

      if (workoutPayloads.length > 0) {
        setSyncProgress({
          mode: 'add',
          done: 0,
          total: workoutPayloads.length,
          message: useIntervals
            ? tr('Sinkronizacija s Kalendarom i Intervals.icu (0/{total})...', 'Syncing with Calendar & Intervals.icu (0/{total})...', { total: workoutPayloads.length })
            : tr('Spremanje treninga u ErgVibe Kalendar...', 'Saving workouts to ErgVibe Calendar...')
        });

        const firstWorkoutDate = workoutsToSync
          .map(w => w.date)
          .filter(Boolean)
          .sort()[0] || activeBlockDateRange.start;

        result = await onCreatePlanBatch(workoutPayloads, {
          planId: blueprint.planId,
          blockKey: registryBlockKey,
          blockTitle: tr(
            '{plan} • Blok {idx} (Tj. {from}–{to})',
            '{plan} • Block {idx} (Wks {from}–{to})',
            { plan: blueprint.planTitle, idx: activeBlockMeta.blockIndex, from: activeBlockMeta.weekFrom, to: activeBlockMeta.weekTo }
          ),
          planTitle: blueprint.planTitle,
          planStartDate: blueprint.startDate || questionnaire?.startDate || activeBlockDateRange.start,
          methodology: blueprint.recommendedMethodology || '',
          totalWeeks: blueprint.totalWeeks || null,
          blockIndex: activeBlockMeta.blockIndex,
          firstWorkoutDate,
          goalTitle: blueprint.goalTitle || '',
          eventDate: blueprint.eventDate || '',
          startDate: activeBlockDateRange.start,
          endDate: activeBlockDateRange.end,
          syncToIntervals: useIntervals,
          onProgress: createProgressHandler(
            'add',
            workoutPayloads.length,
            ({ done, total, currentName }) => {
              const label = currentName ? `: ${currentName}` : '';
              return useIntervals
                ? tr('Slanje na Intervals.icu ({done}/{total}){label}', 'Pushing to Intervals.icu ({done}/{total}){label}', { done, total, label })
                : tr('Spremanje u kalendar ({done}/{total}){label}', 'Saving to calendar ({done}/{total}){label}', { done, total, label });
            }
          )
        });
      }

      // Ciljni event (utrka) dodaje se ZASEBNO od bloka tako da brisanje/ažuriranje Bloka 1 nikada ne obriše samu utrku!
      let raceEventAdded = false;
      if (shouldAddRaceEventSeparately) {
        const racePayload = buildRaceEventPayload();
        if (racePayload) {
          const raceRes = await onAddWorkoutToCalendar(racePayload, { syncToIntervals: useIntervals });
          raceEventAdded = Boolean(raceRes?.success);
        }
      }

      setSyncProgress(null);

      const raceNote = raceEventAdded ? tr(' + ciljni event dodan zasebno', ' + target event added separately') : '';
      const actionVerb = replaceCurrentSynced ? tr('Ažurirano', 'Updated') : tr('Dodano', 'Added');

      if (result.errors?.length > 0 && result.intervalsCount === 0 && useIntervals) {
        setSyncStatus({
          type: 'warning',
          text: tr(
            '{total} treninga spremljeno lokalno{raceNote}, ali Intervals.icu sinkronizacija je javila grešku ({err}).',
            '{total} workouts saved locally{raceNote}, but Intervals.icu sync reported an error ({err}).',
            { total: result.total, raceNote, err: result.errors[0]?.error || tr('API greška', 'API error') }
          ),
          targetDate: activeBlockDateRange.start
        });
      } else if (useIntervals) {
        setSyncStatus({
          type: 'success',
          text: tr(
            '{verb} {total} treninga u Kalendar ({ic} sinkronizirano na Intervals.icu{raceNote}).',
            '{verb} {total} workouts to Calendar ({ic} synced to Intervals.icu{raceNote}).',
            { verb: actionVerb, total: result.total, ic: result.intervalsCount, raceNote }
          ),
          targetDate: activeBlockDateRange.start
        });
      } else {
        setSyncStatus({
          type: 'success',
          text: tr(
            '{verb} {total} treninga u lokalni ErgVibe Kalendar{raceNote}.',
            '{verb} {total} workouts to local ErgVibe Calendar{raceNote}.',
            { verb: actionVerb, total: result.total, raceNote }
          ),
          targetDate: activeBlockDateRange.start
        });
      }
    } catch (err) {
      setSyncProgress(null);
      setSyncStatus({
        type: 'error',
        text: err?.message || tr('Greška pri sinkronizaciji bloka.', 'Error syncing training block.')
      });
    }
  };

  const handleUpdateSyncedBlock = () => handleSyncActiveBlock({ replaceCurrentSynced: true });

  const handleRemoveSyncedBlock = async () => {
    if (!activeSyncedRecord || !onDeletePlanBlock) return;
    setSyncStatus(null);
    const deleteTotal = Math.max(1, (activeSyncedRecord.localIds?.length || 0) + (activeSyncedRecord.intervalsIds?.length || 0));
    setSyncProgress({
      mode: 'delete',
      done: 0,
      total: deleteTotal,
      message: tr('Uklanjanje sinkroniziranog bloka iz Kalendara...', 'Removing synced block from Calendar...')
    });

    try {
      const res = await onDeletePlanBlock(activeSyncedRecord.blockKey, {
        onProgress: createProgressHandler(
          'delete',
          deleteTotal,
          ({ done, total }) => tr('Brisanje stavki ({done}/{total})...', 'Deleting items ({done}/{total})...', { done, total })
        )
      });
      setSyncProgress(null);
      setSyncStatus({
        type: 'success',
        text: tr(
          'Uklonjeno {loc} lokalnih i {ic} Intervals.icu stavki za ovaj blok.',
          'Removed {loc} local and {ic} Intervals.icu items for this block.',
          { loc: res.deletedLocal, ic: res.deletedIntervals }
        )
      });
    } catch (err) {
      setSyncProgress(null);
      setSyncStatus({
        type: 'error',
        text: err?.message || tr('Greška pri uklanjanju bloka.', 'Error removing training block.')
      });
    }
  };

  const handleDeleteEntirePlan = async () => {
    if (!blueprint || isDeletingPlan) return;
    setIsDeletingPlan(true);
    setGenError(null);
    setSyncStatus(null);

    try {
      let calStats = null;
      if (deleteAlsoCalendar && syncedPlanBlocksForCurrentPlan.length > 0) {
        const blockKeys = syncedPlanBlocksForCurrentPlan.map(b => b.blockKey);
        const totalItems = syncedPlanBlocksForCurrentPlan.reduce(
          (sum, b) => sum + (b.localIds?.length || 0) + (b.intervalsIds?.length || 0),
          0
        );
        const totalCount = Math.max(1, totalItems);
        setSyncProgress({
          mode: 'delete',
          done: 0,
          total: totalCount,
          message: tr('Uklanjanje sinkroniziranih treninga plana iz Kalendara...', 'Removing synced plan workouts from Calendar...')
        });

        if (onDeletePlanBlocks) {
          calStats = await onDeletePlanBlocks(blockKeys, {
            onProgress: createProgressHandler(
              'delete',
              totalCount,
              ({ done, total }) => tr('Brisanje treninga ({done}/{total})...', 'Deleting workouts ({done}/{total})...', { done, total })
            )
          });
        } else if (onDeletePlanBlock) {
          let deletedLocal = 0;
          let deletedIntervals = 0;
          const errors = [];
          for (const key of blockKeys) {
            const res = await onDeletePlanBlock(key);
            deletedLocal += res?.deletedLocal || 0;
            deletedIntervals += res?.deletedIntervals || 0;
            if (res?.errors?.length) errors.push(...res.errors);
          }
          calStats = { deletedLocal, deletedIntervals, errors };
        }
        setSyncProgress(null);
      }

      const deletedTitle = blueprint.planTitle;
      clearSavedPlan(userId);
      setSavedPlan(null);
      setActiveBlockKey('1-4');
      setShowDeletePlanConfirm(false);
      setShowBlockFeedbackBox(false);
      setBlockFeedbackText('');
      setEditingWorkoutKey(null);
      setWorkoutFeedbackText('');
      setShowWizard(true);

      if (calStats) {
        setPlanDeletedNotice(
          tr(
            'Plan "{title}" je obrisan (uklonjeno {loc} lokalnih i {ic} Intervals.icu stavki).',
            'Plan "{title}" deleted (removed {loc} local and {ic} Intervals.icu items).',
            { title: deletedTitle, loc: calStats.deletedLocal, ic: calStats.deletedIntervals }
          )
        );
      } else {
        setPlanDeletedNotice(
          tr('Plan "{title}" je obrisan iz AI Planera.', 'Plan "{title}" deleted from AI Planner.', { title: deletedTitle })
        );
      }
    } catch (err) {
      setSyncProgress(null);
      setGenError(err?.message || tr('Greška pri brisanju plana.', 'Error deleting plan.'));
    } finally {
      setIsDeletingPlan(false);
    }
  };

  const handleAnalyzeCurrentPlan = () => {
    if (!blueprint || !onAnalyzePlanInCoach) return;
    const blockWorkoutsList = [];
    Object.values(generatedBlocks || {}).forEach(blk => {
      (blk?.weeks || []).forEach(wk => {
        (wk?.workouts || []).forEach(wo => {
          blockWorkoutsList.push({
            date: wo.date,
            title: wo.title,
            duration: wo.durationMinutes,
            plannedDuration: wo.durationMinutes,
            tss: wo.estimatedTss,
            plannedTss: wo.estimatedTss,
            category: wo.category || 'WORKOUT',
            isCompleted: false
          });
        });
      });
    });

    const prompt = buildPlanAnalysisPrompt({
      planTitle: blueprint.planTitle,
      methodology: blueprint.recommendedMethodology,
      totalWeeks: blueprint.totalWeeks,
      startDate: blueprint.startDate,
      endDate: blueprint.endDate,
      goalTitle: blueprint.goalTitle,
      eventDate: blueprint.eventDate,
      summary: blueprint.summary,
      workoutsInCalendar: blockWorkoutsList
    });
    onAnalyzePlanInCoach(prompt);
  };

  // --- VIEW 1: WIZARD UPITNIK ---
  if (showWizard || !blueprint) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar space-y-4">
        {planDeletedNotice && (
          <div className="max-w-4xl mx-auto p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/35 text-xs text-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{planDeletedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setPlanDeletedNotice('')}
              className="text-emerald-300/70 hover:text-emerald-100 p-0.5"
              title={tr('Zatvori', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <PlanQuestionnaire
          initialPrefill={initialPrefill}
          profile={profile}
          userId={userId}
          wellnessData={wellnessData}
          intervalsConnected={intervalsConnected}
          isGenerating={isGenerating}
          generationStage={generationStage}
          error={genError}
          hasExistingPlan={Boolean(blueprint)}
          onCancel={() => {
            setShowWizard(false);
            setGenError(null);
            onClearPrefill?.();
          }}
          onSubmit={handleQuestionnaireSubmit}
        />
      </div>
    );
  }

  // --- VIEW 2: MAKRO-PLAN I BLOKOVI ---
  const daysToEvent = blueprint.goalMode === 'event' && blueprint.eventDate
    ? diffDaysIso(todayIso, blueprint.eventDate)
    : null;

  const isSyncBusy = Boolean(syncProgress);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar space-y-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* 1. MACROCYCLE HEADER CARD */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {blueprint.goalMode === 'event' ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <Trophy className="w-3.5 h-3.5" />
                    {blueprint.eventPriority === 'RACE_B' ? tr('Prioritet B', 'B-Priority') : tr('Cilj A', 'A-Goal')} • {getLocalizedEventType(blueprint.eventType, lang)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <Activity className="w-3.5 h-3.5" />
                    {tr('Opći Fitness Makro-Plan', 'General Fitness Macrocycle')}
                  </span>
                )}

                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-volt-400/15 text-volt-400 border border-volt-400/30">
                  {isEn
                    ? `${blueprint.totalWeeks} ${blueprint.totalWeeks === 1 ? 'week' : 'weeks'}`
                    : `${blueprint.totalWeeks} ${blueprint.totalWeeks === 1 ? 'tjedan' : (blueprint.totalWeeks < 5 ? 'tjedna' : 'tjedana')}`}
                </span>

                {blueprint.recommendedMethodology && (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {blueprint.recommendedMethodology}
                  </span>
                )}

                {daysToEvent !== null && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-zinc-950 text-zinc-200 border border-zinc-700">
                    {daysToEvent > 0
                      ? tr('{days} dana do eventa ({date})', '{days} days to event ({date})', { days: daysToEvent, date: formatShortHrDate(blueprint.eventDate, lang) })
                      : tr('Event: {date}', 'Event: {date}', { date: formatShortHrDate(blueprint.eventDate, lang) })}
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {blueprint.planTitle}
              </h2>
              <p className="text-sm text-zinc-300 leading-relaxed max-w-3xl">
                {blueprint.summary}
              </p>
              {blueprint.methodologyReason && (
                <p className="text-xs text-zinc-400">
                  <span className="text-volt-400 font-semibold">{tr('Metodologija:', 'Methodology:')}</span> {blueprint.methodologyReason}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {blueprint.goalMode === 'event' && (
                isEventInCalendar ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25">
                    <Check className="w-3.5 h-3.5" />
                    {tr('Event u kalendaru', 'Event in Calendar')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddRaceEventOnly}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    {tr('Dodaj Event u Kalendar', 'Add Event to Calendar')}
                  </button>
                )
              )}

              {onNavigateToCalendar && (
                <button
                  type="button"
                  onClick={() => onNavigateToCalendar(activeBlockDateRange.start || blueprint.startDate)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5 text-volt-400" />
                  {tr('Otvori u Kalendaru', 'Open in Calendar')}
                </button>
              )}

              {onAnalyzePlanInCoach && (
                <button
                  type="button"
                  disabled={isGenerating || isGeneratingBlock || Boolean(revisingWorkoutKey) || isDeletingPlan}
                  onClick={handleAnalyzeCurrentPlan}
                  title={tr('Pošalji ovaj plan na detaljnu analizu AI Treneru', 'Send this plan to AI Coach for a detailed review')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors disabled:opacity-50"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {tr('Analiziraj s AI', 'Analyze with AI')}
                </button>
              )}

              <button
                type="button"
                disabled={isGenerating || isGeneratingBlock || Boolean(revisingWorkoutKey) || isDeletingPlan}
                onClick={() => {
                  setGenError(null);
                  setShowWizard(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-volt-400/15 hover:bg-volt-400/25 text-volt-400 border border-volt-400/30 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {tr('Novi plan / Upitnik', 'New Plan / Setup')}
              </button>

              <button
                type="button"
                disabled={isGenerating || isGeneratingBlock || Boolean(revisingWorkoutKey) || isSyncBusy || isDeletingPlan}
                onClick={() => {
                  setDeleteAlsoCalendar(syncedPlanBlocksForCurrentPlan.length > 0);
                  setShowDeletePlanConfirm(true);
                }}
                title={tr('Obriši cijeli stvoreni plan', 'Delete the entire generated plan')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {tr('Obriši plan', 'Delete Plan')}
              </button>
            </div>
          </div>

          {/* Phase Timeline Bar */}
          {Array.isArray(blueprint.phases) && blueprint.phases.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                <span>{tr('Makrociklus i Faze Periodizacije', 'Macrocycle & Periodization Phases')}</span>
                <button
                  type="button"
                  onClick={() => setShowRationale(v => !v)}
                  className="inline-flex items-center gap-1 text-zinc-400 hover:text-volt-400 transition-colors normal-case font-medium"
                >
                  <Info className="w-3.5 h-3.5" />
                  {showRationale ? tr('Sakrij objašnjenje trenera', 'Hide coach rationale') : tr('Zašto ovakva periodizacija?', 'Why this periodization?')}
                </button>
              </div>

              <div className="flex h-3 rounded-full overflow-hidden bg-zinc-950 border border-zinc-800 gap-0.5 p-0.5">
                {blueprint.phases.map((phase, idx) => {
                  const span = Math.max(1, (phase.weekTo || 1) - (phase.weekFrom || 1) + 1);
                  const pct = (span / blueprint.totalWeeks) * 100;
                  const meta = PHASE_META[phase.type] || PHASE_META.base;
                  const phaseTitle = getLocalizedPhaseLabel(phase.type, phase.label, lang);
                  return (
                    <div
                      key={`${phase.type}-${idx}`}
                      style={{ width: `${pct}%` }}
                      title={`${phaseTitle} (${tr('Tj.', 'Wk')} ${phase.weekFrom}–${phase.weekTo}): ${phase.focus || ''}`}
                      className={`${meta.bar} rounded-full transition-all`}
                    />
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {blueprint.phases.map((phase, idx) => {
                  const meta = PHASE_META[phase.type] || PHASE_META.base;
                  const phaseTitle = getLocalizedPhaseLabel(phase.type, phase.label, lang);
                  return (
                    <div
                      key={`legend-${idx}`}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${meta.cls}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${meta.bar}`} />
                      <span className="font-bold">{phaseTitle}</span>
                      <span className="opacity-80">{tr('Tj.', 'Wk')} {phase.weekFrom === phase.weekTo ? phase.weekFrom : `${phase.weekFrom}–${phase.weekTo}`}</span>
                      {phase.focus && <span className="hidden sm:inline opacity-75">• {phase.focus}</span>}
                    </div>
                  );
                })}
              </div>

              {showRationale && blueprint.physiologicalRationale && (
                <div className="mt-2 p-3.5 rounded-xl bg-zinc-950/90 border border-zinc-800 text-xs text-zinc-300 leading-relaxed">
                  {blueprint.physiologicalRationale}
                </div>
              )}
            </div>
          )}

          {/* Compact Weekly Blueprint Strip */}
          {Array.isArray(blueprint.weeks) && blueprint.weeks.length > 0 && (
            <div className="pt-2">
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {blueprint.weeks.map(wk => {
                  const meta = PHASE_META[wk.phaseType] || PHASE_META.base;
                  const parentBlock = blockMetas.find(b => wk.weekNumber >= b.weekFrom && wk.weekNumber <= b.weekTo);
                  const isInActiveBlock = parentBlock?.key === activeBlockMeta?.key;
                  return (
                    <button
                      key={wk.weekNumber}
                      type="button"
                      onClick={() => parentBlock && setActiveBlockKey(parentBlock.key)}
                      className={`shrink-0 w-28 text-left p-2.5 rounded-xl border transition-all ${
                        isInActiveBlock
                          ? 'bg-zinc-800/90 border-volt-400/50 shadow-sm'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold text-white">{tr('Tj.', 'Wk')} {wk.weekNumber}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${meta.cls}`}>
                          {wk.isRecoveryWeek ? 'Rest' : getLocalizedPhaseLabel(wk.phaseType, null, lang)}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-1">
                        {formatShortHrDate(wk.startDate, lang)}
                      </div>
                      <div className="text-[11px] font-semibold text-zinc-200 mt-0.5">
                        ~{wk.targetTss} TSS
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 2. BLOCK SELECTOR TABS */}
        {blockMetas.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {blockMetas.map(meta => {
                const isActive = meta.key === activeBlockMeta?.key;
                const isGenerated = Boolean(generatedBlocks[meta.key]);
                const isSynced = planRegistry.some(p => p.blockKey === `${blueprint.planId}:${meta.key}`);
                return (
                  <button
                    key={meta.key}
                    type="button"
                    onClick={() => {
                      setActiveBlockKey(meta.key);
                      setSyncStatus(null);
                      setShowBlockFeedbackBox(false);
                      setEditingWorkoutKey(null);
                      setWorkoutFeedbackText('');
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                      isActive
                        ? 'bg-volt-400 text-zinc-950 border-volt-400 shadow-lg shadow-volt-400/15'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      {tr('Blok', 'Block')} {meta.blockIndex} ({meta.weekFrom === meta.weekTo ? `${tr('Tj.', 'Wk')} ${meta.weekFrom}` : `${tr('Tj.', 'Wks')} ${meta.weekFrom}–${meta.weekTo}`})
                    </span>
                    {isSynced ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isActive ? 'bg-zinc-950/20 text-zinc-950' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {tr('U kalendaru ✓', 'In Calendar ✓')}
                      </span>
                    ) : isGenerated ? (
                      <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-zinc-950' : 'bg-volt-400'}`} title={tr('Treninzi generirani', 'Workouts generated')} />
                    ) : (
                      <span className={`text-[10px] opacity-75 ${isActive ? 'text-zinc-900' : 'text-zinc-500'}`}>
                        {tr('Nacrt', 'Draft')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {questionnaire?.weeklySchedule && (
                <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>
                    {tr('Aktivni dani:', 'Active days:')}{' '}
                    <strong className="text-zinc-200">
                      {WEEKDAY_DEFS.filter(d => questionnaire.weeklySchedule[d.key]?.enabled)
                        .map(d => getWeekdayShort(d, lang))
                        .join(', ')}
                    </strong>
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={isGeneratingBlock || isSyncBusy || Boolean(revisingWorkoutKey) || isDeletingPlan}
                onClick={() => {
                  if (showScheduleEditor) {
                    setShowScheduleEditor(false);
                  } else {
                    openScheduleEditor();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50 ${
                  showScheduleEditor
                    ? 'bg-volt-400/15 text-volt-300 border-volt-400/40'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-volt-300 border-zinc-800 hover:border-zinc-700'
                }`}
                title={tr('Prilagodi slobodne dane i trajanje po danu za iduće ili aktivni blok', 'Adjust available days and daily time limits for upcoming or active blocks')}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{tr('Uredi dane / sate', 'Edit Days / Hours')}</span>
              </button>
            </div>
          </div>
        )}

        {/* INLINE UREĐIVAČ TJEDNOG RASPOREDA (za buduće ili regenerirane blokove) */}
        {showScheduleEditor && draftSchedule && (() => {
          const draftSummary = summarizeWeeklySchedule(draftSchedule);
          return (
            <div className="bg-zinc-900/95 border border-volt-400/35 rounded-2xl p-4 sm:p-5 space-y-4 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-volt-400" />
                    {tr('Prilagodba tjednog rasporeda', 'Edit Weekly Schedule')}
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {tr('Promijeni slobodne dane ili dostupno vrijeme po danu — novi raspored vrijedi za sve buduće blokove bez izrade novog makrociklusa.', 'Update your available days or daily time limits — the new schedule applies to all future blocks without rebuilding your macrocycle.')}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">{tr('Brzo:', 'Quick:')}</span>
                  {[
                    { id: '3x', label: tr('3× tj.', '3×/wk') },
                    { id: '4x', label: tr('4× tj.', '4×/wk') },
                    { id: '5x', label: tr('5× tj.', '5×/wk') }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyDraftSchedulePreset(p.id)}
                      className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono font-bold text-zinc-300 hover:text-volt-400 transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowScheduleEditor(false)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 ml-1"
                    title={tr('Zatvori', 'Close')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                {WEEKDAY_DEFS.map((day) => {
                  const cfg = draftSchedule[day.key] || { enabled: false, minutes: 60 };
                  return (
                    <div
                      key={day.key}
                      className={`rounded-xl border p-2.5 flex flex-col gap-2 transition-all ${
                        cfg.enabled
                          ? 'bg-zinc-950 border-volt-400/45'
                          : 'bg-zinc-950/50 border-zinc-800/80 opacity-65 hover:opacity-90'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDraftDay(day.key)}
                        className="flex md:flex-col items-center justify-between md:justify-center gap-1 w-full text-left md:text-center"
                      >
                        <span className={`font-display font-bold uppercase tracking-wider text-xs ${
                          cfg.enabled ? 'text-volt-400' : 'text-zinc-400'
                        }`}>
                          {getWeekdayShort(day, lang)}
                        </span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                          cfg.enabled
                            ? 'bg-volt-400/15 text-volt-300 border-volt-400/30'
                            : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                        }`}>
                          {cfg.enabled ? tr('TRENING', 'WORKOUT') : tr('ODMOR', 'REST')}
                        </span>
                      </button>

                      {cfg.enabled && (
                        <div className="flex flex-row md:flex-col gap-1 pt-1 border-t border-zinc-800/80 flex-wrap">
                          {DURATION_TIERS.map((tier) => {
                            const isSelected = cfg.minutes === tier.minutes;
                            return (
                              <button
                                key={tier.id}
                                type="button"
                                onClick={() => setDraftDayMinutes(day.key, tier.minutes)}
                                title={tr(tier.descHr, tier.descEn)}
                                className={`flex-1 md:flex-none px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                                  isSelected
                                    ? 'bg-volt-400 text-zinc-950 border-volt-400'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                                }`}
                              >
                                {tier.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {scheduleEditorError && (
                <div className="text-xs text-rose-300 font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{scheduleEditorError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-zinc-800/80">
                <div className="font-mono text-xs text-zinc-300 telemetry-num">
                  {tr('Novi raspored:', 'New schedule:')} <strong className="text-volt-400">{draftSummary.workoutsPerWeek}{tr('× tj.', '×/wk')}</strong> · ~<strong className="text-zinc-100">{draftSummary.hoursPerWeek} h</strong> {tr('tjedno', 'per week')}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowScheduleEditor(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-950 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 transition-colors"
                  >
                    {tr('Odustani', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveSchedule({ regenerateActiveBlock: false })}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition-colors"
                  >
                    {tr('Spremi raspored', 'Save Schedule')}
                  </button>
                  {activeBlockMeta && activeBlockData && (
                    <button
                      type="button"
                      disabled={isGeneratingBlock}
                      onClick={() => handleSaveSchedule({ regenerateActiveBlock: true })}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBlock ? 'animate-spin' : ''}`} />
                      {tr('Spremi i regeneriraj Blok {idx}', 'Save & Regenerate Block {idx}', { idx: activeBlockMeta.blockIndex })}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Global Error Banner */}
        {genError && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-sm text-rose-200 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{genError}</span>
          </div>
        )}

        {/* Obavijest o statusu kad je odabran još negenerirani blok (npr. nakon spremanja novog rasporeda) */}
        {activeBlockMeta && !activeBlockData && syncStatus && (
          <div className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
            syncStatus.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/35 text-emerald-200'
              : syncStatus.type === 'warning'
              ? 'bg-amber-950/40 border-amber-500/35 text-amber-200'
              : 'bg-rose-950/40 border-rose-500/35 text-rose-200'
          }`}>
            <div className="flex items-center gap-2">
              {syncStatus.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{syncStatus.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncStatus(null)}
              className="text-zinc-400 hover:text-zinc-100 p-0.5"
              title={tr('Zatvori', 'Close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 3. ACTIVE BLOCK CONTENT OR ON-DEMAND GENERATOR */}
        {activeBlockMeta && !activeBlockData && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-volt-400/15 border border-volt-400/30 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6 text-volt-400" />
            </div>

            <div className="space-y-1.5 max-w-xl mx-auto">
              <h3 className="text-lg font-bold text-white">
                {tr(
                  'Blok {idx} (Tjedni {from}–{to}) još nije raspisan po danima',
                  'Block {idx} (Weeks {from}–{to}) has not been scheduled day-by-day yet',
                  { idx: activeBlockMeta.blockIndex, from: activeBlockMeta.weekFrom, to: activeBlockMeta.weekTo }
                )}
              </h3>
              <p className="text-xs sm:text-sm text-zinc-400">
                {tr(
                  'Makrociklus je već isplanirao faze i ciljani tjedni volumen za ovaj blok. Klikni ispod kada želiš da AI trener raspiše konkretne strukturirane treninge za svaki tvoj slobodan dan.',
                  'The macrocycle has already mapped out the phases and target weekly volume for this block. Click below whenever you want the AI coach to build structured workouts for each available training day.'
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-left max-w-4xl mx-auto">
              {(blueprint.weeks || [])
                .filter(w => w.weekNumber >= activeBlockMeta.weekFrom && w.weekNumber <= activeBlockMeta.weekTo)
                .map(wk => {
                  const meta = PHASE_META[wk.phaseType] || PHASE_META.base;
                  return (
                    <div key={wk.weekNumber} className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{tr('Tjedan', 'Week')} {wk.weekNumber}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.cls}`}>
                          {getLocalizedPhaseLabel(wk.phaseType, null, lang)}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {formatShortHrDate(wk.startDate, lang)} – {formatShortHrDate(wk.endDate, lang)}
                      </div>
                      <div className="text-xs font-semibold text-volt-400">
                        {tr('Cilj:', 'Target:')} ~{wk.targetTss} TSS {wk.isRecoveryWeek ? tr('• Oporavak', '• Recovery') : ''}
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-2">{wk.theme}</p>
                    </div>
                  );
                })}
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={isGeneratingBlock}
                onClick={() => handleGenerateBlock(activeBlockMeta)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-all shadow-lg shadow-volt-400/20 disabled:opacity-60"
              >
                {isGeneratingBlock ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {tr('Generiranje treninga za Blok {idx}...', 'Generating workouts for Block {idx}...', { idx: activeBlockMeta.blockIndex })}
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    {tr('Generiraj detaljne treninge za Blok {idx}', 'Generate Detailed Workouts for Block {idx}', { idx: activeBlockMeta.blockIndex })}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {activeBlockMeta && activeBlockData && (
          <>
            {/* SMART CALENDAR & INTERVALS.ICU SYNC PANEL */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      {tr(
                        'Sinkronizacija Bloka {idx} (Tjedni {from}–{to})',
                        'Block {idx} Sync (Weeks {from}–{to})',
                        { idx: activeBlockMeta.blockIndex, from: activeBlockMeta.weekFrom, to: activeBlockMeta.weekTo }
                      )}
                    </h3>
                    {activeSyncedRecord && !hasUnsyncedBlockChanges && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        {tr('Sinkronizirano', 'Synced')}
                      </span>
                    )}
                    {activeSyncedRecord && hasUnsyncedBlockChanges && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/35">
                        <AlertTriangle className="w-3 h-3" />
                        {tr('Izmjene čekaju ažuriranje', 'Changes pending sync')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    {activeBlockData.blockSummary || tr(
                      '{count} strukturiranih treninga ({start} – {end})',
                      '{count} structured workouts ({start} – {end})',
                      {
                        count: activeBlockWorkouts.length,
                        start: formatShortHrDate(activeBlockDateRange.start, lang),
                        end: formatShortHrDate(activeBlockDateRange.end, lang)
                      }
                    )}
                  </p>
                </div>

                {/* Intervals.icu Toggle */}
                <div className="flex flex-wrap items-center gap-3">
                  {intervalsConnected ? (
                    <label className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={syncToIntervals}
                        onChange={(e) => setSyncToIntervals(e.target.checked)}
                        disabled={isSyncBusy}
                        className="accent-volt-400 w-4 h-4 rounded"
                      />
                      <Cloud className={`w-4 h-4 ${syncToIntervals ? 'text-sky-400' : 'text-zinc-500'}`} />
                      <span className="text-xs font-semibold text-zinc-200">
                        {tr('Pošalji i na Intervals.icu', 'Also push to Intervals.icu')}
                      </span>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400">
                      <HardDrive className="w-4 h-4 text-zinc-500" />
                      <span>{tr('Samo lokalni Kalendar (Intervals.icu nije spojen)', 'Local Calendar only (Intervals.icu not connected)')}</span>
                    </div>
                  )}

                  {activeSyncedRecord ? (
                    <>
                      {hasUnsyncedBlockChanges && (
                        <button
                          type="button"
                          disabled={isSyncBusy || isGeneratingBlock || Boolean(revisingWorkoutKey)}
                          onClick={handleUpdateSyncedBlock}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-all shadow-lg shadow-volt-400/20 disabled:opacity-50"
                        >
                          {isSyncBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {tr('Ažuriraj blok u Kalendaru', 'Update Block in Calendar')}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isSyncBusy}
                        onClick={handleRemoveSyncedBlock}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {tr(
                          'Ukloni blok iz Kalendara{intervals}',
                          'Remove Block from Calendar{intervals}',
                          { intervals: activeSyncedRecord.intervalsIds?.length > 0 ? ' & Intervals.icu' : '' }
                        )}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isSyncBusy || activeBlockWorkouts.length === 0}
                      onClick={() => handleSyncActiveBlock()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-all shadow-lg shadow-volt-400/15 disabled:opacity-50"
                    >
                      {isSyncBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {tr(
                        'Dodaj Blok {idx} ({count} treninga) u Kalendar',
                        'Add Block {idx} ({count} workouts) to Calendar',
                        { idx: activeBlockMeta.blockIndex, count: activeBlockWorkouts.length }
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isGeneratingBlock || isSyncBusy || Boolean(revisingWorkoutKey)}
                    onClick={() => setShowBlockFeedbackBox(prev => !prev)}
                    title={tr('Upiši komentar ili uputu AI treneru za prilagodbu cijelog bloka', 'Give the AI coach instructions to adjust the entire block')}
                    className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                      showBlockFeedbackBox
                        ? 'bg-volt-400/15 border-volt-400/40 text-volt-300'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {tr('Komentiraj / Prilagodi blok', 'Comment / Adjust Block')}
                  </button>

                  <button
                    type="button"
                    disabled={isGeneratingBlock || isSyncBusy || Boolean(revisingWorkoutKey)}
                    onClick={() => handleGenerateBlock(activeBlockMeta)}
                    title={tr('Ponovno generiraj treninge samo za ovaj blok', 'Regenerate workouts for this block only')}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBlock ? 'animate-spin' : ''}`} />
                    {tr('Regeneriraj blok', 'Regenerate Block')}
                  </button>
                </div>
              </div>

              {/* Block-level AI Feedback & Revision Panel */}
              {showBlockFeedbackBox && (
                <div className="p-4 rounded-xl bg-zinc-950/90 border border-volt-400/30 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-volt-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        {tr(
                          'Komentar za AI trenera — prilagodba Bloka {idx}',
                          'AI Coach Feedback — Adjust Block {idx}',
                          { idx: activeBlockMeta.blockIndex }
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        {tr(
                          'Napiši što ne štima u trenutnom bloku (npr. nerealni over-under intervali, prejak intenzitet, trajanje ili raspored) i AI će regenerirati blok uz uvažavanje tvoje upute.',
                          'Tell the AI coach what to change in this block (e.g. unrealistic over-under intervals, too intense, duration, or day order) and it will regenerate the block accordingly.'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isGeneratingBlock}
                      onClick={() => setShowBlockFeedbackBox(false)}
                      className="text-zinc-500 hover:text-zinc-300 p-1 disabled:opacity-50"
                      title={tr('Zatvori', 'Close')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      tr('Zamijeni over-under s klasičnim intervalima', 'Replace over-unders with classic intervals'),
                      tr('Smanji intenzitet za ~10%', 'Reduce intensity by ~10%'),
                      tr('Više Z2 izdržljivosti, manje stresa', 'More Z2 endurance, less training stress'),
                      tr('Skraćuj treninge na ~45-50m', 'Shorten workouts to ~45–50m')
                    ].map(chip => (
                      <button
                        key={chip}
                        type="button"
                        disabled={isGeneratingBlock}
                        onClick={() => setBlockFeedbackText(chip)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={2}
                    value={blockFeedbackText}
                    onChange={(e) => setBlockFeedbackText(e.target.value)}
                    disabled={isGeneratingBlock}
                    placeholder={tr(
                      'Npr. Ukloni čudne over-under treninge i stavi klasične 4x4m / 5x3m VO2max intervale, a srijedu smanji na lakši oporavak...',
                      'e.g. Replace awkward over-unders with classic 4x4m / 5x3m VO2 Max intervals, and make Wednesday an easier recovery ride...'
                    )}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-volt-400/50 focus:outline-none text-xs text-white placeholder:text-zinc-500 resize-y"
                  />

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isGeneratingBlock}
                      onClick={() => {
                        setShowBlockFeedbackBox(false);
                        setBlockFeedbackText('');
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 transition-colors disabled:opacity-50"
                    >
                      {tr('Odustani', 'Cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={!blockFeedbackText.trim() || isGeneratingBlock || Boolean(revisingWorkoutKey)}
                      onClick={() => handleGenerateBlock(activeBlockMeta, blockFeedbackText)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-colors disabled:opacity-50"
                    >
                      {isGeneratingBlock ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {tr('Prilagođavam blok...', 'Adjusting block...')}
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          {tr('Primijeni korekciju na blok', 'Apply Changes to Block')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Target race inclusion checkbox */}
              {blueprint.goalMode === 'event' && !isEventInCalendar && !activeSyncedRecord && (
                <label className="inline-flex items-center gap-2 text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 px-3 py-2 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTargetEventInSync}
                    onChange={(e) => setIncludeTargetEventInSync(e.target.checked)}
                    disabled={isSyncBusy}
                    className="accent-amber-400 w-4 h-4 rounded"
                  />
                  <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    {tr('Uključi i ciljni event', 'Also include target event')}{' '}
                    <strong>{blueprint.goalTitle}</strong> ({formatShortHrDate(blueprint.eventDate, lang)})
                  </span>
                </label>
              )}

              {/* Collision Warning & Strategy */}
              {!activeSyncedRecord && (collidingDates.length > 0 || overlappingRegistryBlocks.length > 0) && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-2.5">
                  <div className="flex items-start gap-2.5 text-xs text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">
                        {tr(
                          'Pronađena preklapanja u kalendaru ({count} dana):',
                          'Calendar overlaps detected ({count} days):',
                          { count: collidingDates.length }
                        )}
                      </span>{' '}
                      <span className="text-amber-300/90">
                        {collidingDates.slice(0, 6).map(d => formatShortHrDate(d, lang)).join(', ')}
                        {collidingDates.length > 6 ? tr(' i još {n}', ' and {n} more', { n: collidingDates.length - 6 }) : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCollisionMode('skip')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        collisionMode === 'skip'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-100'
                          : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {tr('Preskoči zauzete dane', 'Skip occupied days')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollisionMode('alongside')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        collisionMode === 'alongside'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-100'
                          : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {tr('Dodaj uz postojeće', 'Add alongside existing')}
                    </button>
                    {overlappingRegistryBlocks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCollisionMode('replace')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          collisionMode === 'replace'
                            ? 'bg-rose-500/25 border-rose-400 text-rose-100'
                            : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {tr(
                          'Zamijeni prethodni AI blok ({count})',
                          'Replace previous AI block ({count})',
                          { count: overlappingRegistryBlocks.length }
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Live Sync Progress */}
              {syncProgress && (
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 font-medium flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-volt-400" />
                      {syncProgress.message}
                    </span>
                    <span className="text-zinc-400 font-mono">
                      {syncProgress.done}/{syncProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-volt-400 transition-all duration-200"
                      style={{ width: `${Math.round((syncProgress.done / Math.max(1, syncProgress.total)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Sync Feedback */}
              {syncStatus && (
                <div className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
                  syncStatus.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-500/35 text-emerald-200'
                    : syncStatus.type === 'warning'
                    ? 'bg-amber-950/40 border-amber-500/35 text-amber-200'
                    : 'bg-rose-950/40 border-rose-500/35 text-rose-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {syncStatus.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{syncStatus.text}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {syncStatus.canQuickUpdate && activeSyncedRecord && (
                      <button
                        type="button"
                        disabled={isSyncBusy || isGeneratingBlock}
                        onClick={handleUpdateSyncedBlock}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-bold transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {tr('Ažuriraj blok u Kalendaru', 'Update Block in Calendar')}
                      </button>
                    )}
                    {syncStatus.targetDate && onNavigateToCalendar && (
                      <button
                        type="button"
                        onClick={() => onNavigateToCalendar(getMondayOfWeekIso(syncStatus.targetDate))}
                        className="inline-flex items-center gap-1 font-bold underline hover:text-white"
                      >
                        {tr('Pogledaj u Kalendaru', 'View in Calendar')}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 4. WEEKLY WORKOUTS LIST */}
            <div className="space-y-6">
              {(activeBlockData.weeks || []).map(week => {
                const phaseMeta = PHASE_META[week.phaseType] || PHASE_META.base;
                const weekWorkouts = week.workouts || [];
                const totalWeekMins = weekWorkouts.reduce((acc, w) => acc + (Number(w.durationMinutes) || 0), 0);
                const totalWeekTss = weekWorkouts.reduce((acc, w) => acc + (Number(w.estimatedTss) || 0), 0);

                return (
                  <div key={week.weekNumber} className="bg-zinc-900/50 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black text-white">
                            {tr('Tjedan', 'Week')} {week.weekNumber}
                          </span>
                          <span className="text-xs text-zinc-400 font-medium">
                            {formatShortHrDate(week.startDate, lang)} – {formatShortHrDate(week.endDate, lang)}
                          </span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${phaseMeta.cls}`}>
                            {getLocalizedPhaseLabel(week.phaseType, week.phaseLabel, lang)}
                          </span>
                          {week.isRecoveryWeek && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {tr('Tjedan oporavka', 'Recovery Week')}
                            </span>
                          )}
                        </div>
                        {week.theme && (
                          <p className="text-xs text-zinc-400">{week.theme}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-zinc-300 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800">
                          {weekWorkouts.length} {tr('treninga', weekWorkouts.length === 1 ? 'workout' : 'workouts')}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800">
                          {(totalWeekMins / 60).toFixed(1)}h
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-volt-400 font-bold">
                          ~{totalWeekTss || week.targetTss} TSS
                        </span>
                      </div>
                    </div>

                    {weekWorkouts.length === 0 ? (
                      <div className="text-xs text-zinc-500 py-4 text-center">
                        {tr(
                          'Nema zakazanih treninga u ovom tjednu (npr. tjedan završava prije odabranih dana ili počinje kasnije).',
                          'No workouts scheduled in this week (e.g. week ends before your chosen days or starts later).'
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {weekWorkouts.map((w, wIdx) => {
                          const workoutKey = `${week.weekNumber}-${w.date}-${wIdx}`;
                          const isEditingThis = editingWorkoutKey === workoutKey;
                          const isRevisingThis = revisingWorkoutKey === workoutKey;

                          return (
                            <div key={workoutKey} className="space-y-2">
                              <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
                                <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                                  <ChevronRight className="w-3.5 h-3.5 text-volt-400" />
                                  {getWeekdayName(w.dayKey || w.dayName, lang) || w.dayName} • {formatShortHrDate(w.date, lang)}
                                </span>

                                <button
                                  type="button"
                                  disabled={isGeneratingBlock || Boolean(revisingWorkoutKey)}
                                  onClick={() => {
                                    if (isEditingThis) {
                                      setEditingWorkoutKey(null);
                                      setWorkoutFeedbackText('');
                                    } else {
                                      setEditingWorkoutKey(workoutKey);
                                      setWorkoutFeedbackText('');
                                    }
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold border transition-colors disabled:opacity-50 ${
                                    isEditingThis
                                      ? 'bg-volt-400/15 border-volt-400/40 text-volt-300'
                                      : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300 hover:text-white'
                                  }`}
                                >
                                  {isRevisingThis ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin text-volt-400" />
                                      <span>{tr('Popravljam...', 'Revising...')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <MessageSquare className="w-3 h-3" />
                                      <span>{tr('Komentiraj / Popravi', 'Comment / Revise')}</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              {isEditingThis && (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    handleReviseSingleWorkout(week, w, wIdx);
                                  }}
                                  className="p-3 rounded-xl bg-zinc-950/90 border border-volt-400/30 space-y-2.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-volt-300 flex items-center gap-1.5">
                                      <Sparkles className="w-3.5 h-3.5" />
                                      {tr('Uputa AI treneru za ovaj trening', 'Instruction to AI coach for this workout')}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={isRevisingThis}
                                      onClick={() => {
                                        setEditingWorkoutKey(null);
                                        setWorkoutFeedbackText('');
                                      }}
                                      className="text-zinc-500 hover:text-zinc-300 p-0.5 disabled:opacity-50"
                                      title={tr('Zatvori', 'Close')}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  <div className="flex flex-wrap gap-1.5">
                                    {[
                                      tr('Klasični VO2max (5x3m)', 'Classic VO2 Max (5x3m)'),
                                      tr('Lakši Sweet Spot', 'Easier Sweet Spot'),
                                      tr('Prebaci u Z2', 'Switch to Z2 Endurance'),
                                      tr('Skraćeno (45m)', 'Shorter (45m)')
                                    ].map(chip => (
                                      <button
                                        key={chip}
                                        type="button"
                                        disabled={isRevisingThis}
                                        onClick={() => setWorkoutFeedbackText(chip)}
                                        className="px-2 py-1 rounded-md text-[10px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors disabled:opacity-50"
                                      >
                                        {chip}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="text"
                                      value={workoutFeedbackText}
                                      onChange={(e) => setWorkoutFeedbackText(e.target.value)}
                                      disabled={isRevisingThis}
                                      placeholder={tr(
                                        'Npr. ovaj over-under nije izvediv, stavi klasični VO2max 5x3m ili lakši Sweet Spot...',
                                        'e.g. this over-under is too hard, swap for classic 5x3m VO2 Max or easier Sweet Spot...'
                                      )}
                                      className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-volt-400/50 focus:outline-none text-xs text-white placeholder:text-zinc-500"
                                    />
                                    <button
                                      type="submit"
                                      disabled={!workoutFeedbackText.trim() || isRevisingThis || isGeneratingBlock}
                                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-colors shrink-0 disabled:opacity-50"
                                    >
                                      {isRevisingThis ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          {tr('Popravljam...', 'Revising...')}
                                        </>
                                      ) : (
                                        <>
                                          <Send className="w-3.5 h-3.5" />
                                          {tr('Popravi trening', 'Revise Workout')}
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </form>
                              )}

                              <AIWorkoutCard
                                key={`${w.date}-${w.title}-${w.durationMinutes}-${w.estimatedTss}-${(w.intervalsCode || '').length}-${wIdx}`}
                                structuredWorkout={{
                                  title: w.title,
                                  category: w.category || 'Endurance',
                                  type: w.type || 'ride',
                                  date: w.date,
                                  durationMinutes: w.durationMinutes,
                                  estimatedTss: w.estimatedTss,
                                  descriptionText: w.descriptionText,
                                  coachNote: w.coachNote,
                                  intervalsCode: w.intervalsCode,
                                  steps: w.steps
                                }}
                                ftp={ftp}
                                onAddToCalendar={(workoutObj) =>
                                  onAddWorkoutToCalendar?.(workoutObj, {
                                    syncToIntervals: Boolean(intervalsConnected && syncToIntervals)
                                  })
                                }
                                onStartInTrainer={onStartWorkoutInTrainer}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Modal za potvrdu brisanja cijelog plana (portal iznad zaglavlja i mobilne navigacije) */}
      {showDeletePlanConfirm && blueprint && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => !isDeletingPlan && setShowDeletePlanConfirm(false)}
        >
          <div
            className="bg-zinc-900 border border-rose-500/35 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{tr('Obriši stvoreni plan?', 'Delete training plan?')}</h3>
                  <p className="text-xs text-zinc-400 line-clamp-1">{blueprint.planTitle}</p>
                </div>
              </div>
              {!isDeletingPlan && (
                <button
                  type="button"
                  onClick={() => setShowDeletePlanConfirm(false)}
                  className="text-zinc-500 hover:text-zinc-200 p-1"
                  title={tr('Zatvori', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              {tr(
                'Ova radnja trajno briše makrociklus i sve generirane blokove iz AI Planera. Nakon brisanja možeš odmah izraditi novi plan.',
                'This permanently deletes the macrocycle and all generated blocks from AI Planner. You can create a new plan immediately afterward.'
              )}
            </p>

            {syncedPlanBlocksForCurrentPlan.length > 0 && (() => {
              const totalLoc = syncedPlanBlocksForCurrentPlan.reduce((s, b) => s + (b.localIds?.length || 0), 0);
              const totalInt = syncedPlanBlocksForCurrentPlan.reduce((s, b) => s + (b.intervalsIds?.length || 0), 0);
              return (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/25 border border-rose-500/25 text-xs text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteAlsoCalendar}
                    onChange={(e) => setDeleteAlsoCalendar(e.target.checked)}
                    disabled={isDeletingPlan}
                    className="mt-0.5 accent-rose-500 w-4 h-4 rounded shrink-0"
                  />
                  <span>
                    {isEn
                      ? `Also remove synced workouts from Calendar (${syncedPlanBlocksForCurrentPlan.length} ${syncedPlanBlocksForCurrentPlan.length === 1 ? 'block' : 'blocks'}${totalInt > 0 ? ` • ${totalInt} on Intervals.icu` : ''}${totalLoc > 0 ? ` • ${totalLoc} local` : ''}).`
                      : `Ukloni i sinkronizirane treninge iz Kalendara (${syncedPlanBlocksForCurrentPlan.length} blok(a)${totalInt > 0 ? ` • ${totalInt} na Intervals.icu` : ''}${totalLoc > 0 ? ` • ${totalLoc} lokalno` : ''}).`}
                  </span>
                </label>
              );
            })()}

            {isDeletingPlan && syncProgress && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-200">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                    {syncProgress.message}
                  </span>
                  <span className="font-mono text-zinc-400">
                    {syncProgress.done}/{syncProgress.total}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-200"
                    style={{ width: `${Math.round((syncProgress.done / Math.max(1, syncProgress.total)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={() => setShowDeletePlanConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors disabled:opacity-50"
              >
                {tr('Odustani', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={handleDeleteEntirePlan}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
              >
                {isDeletingPlan ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {tr('Brišem plan...', 'Deleting plan...')}
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    {tr('Trajno obriši plan', 'Permanently Delete Plan')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

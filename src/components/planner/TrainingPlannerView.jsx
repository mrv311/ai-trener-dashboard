import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar, Trophy, Flag, Sparkles, CheckCircle2, AlertTriangle,
  Trash2, RefreshCw, ChevronRight, Loader2, ExternalLink, Info,
  Layers, Activity, Clock, Zap, Check, Plus, Cloud, HardDrive
} from 'lucide-react';
import {
  PHASE_META,
  WEEKDAY_DEFS,
  DEFAULT_WEEKLY_SCHEDULE,
  chunkWeeksIntoBlocks,
  getLocalIsoToday,
  diffDaysIso,
  addDaysIso,
  formatShortHrDate,
  getMondayOfWeekIso
} from '../../utils/plannerUtils';
import {
  generateMacrocycleBlueprint,
  generatePlanBlockWorkouts
} from '../../services/geminiService';
import { AIWorkoutCard, buildErgVibeWorkoutObject } from '../ai/AIMarkdown';
import PlanQuestionnaire from './PlanQuestionnaire';

function getPlanStorageKey(userId) {
  return `ergvibe_ai_macro_plan_v2_${userId || 'guest'}`;
}

function loadSavedPlan(userId) {
  try {
    const raw = localStorage.getItem(getPlanStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.blueprint ? parsed : null;
  } catch {
    return null;
  }
}

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
  onClearPrefill,
  onAddWorkoutToCalendar,
  onCreatePlanBatch,
  onDeletePlanBlock,
  planRegistry = [],
  onStartWorkoutInTrainer,
  onNavigateToCalendar,
  onGeneratingChange
}) {
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

  useEffect(() => {
    if (forceOpenWizard || initialPrefill) {
      setShowWizard(true);
    }
  }, [forceOpenWizard, initialPrefill]);

  useEffect(() => {
    if (intervalsConnected) {
      setSyncToIntervals(true);
    }
  }, [intervalsConnected]);

  useEffect(() => {
    onGeneratingChange?.(isGenerating || isGeneratingBlock);
  }, [isGenerating, isGeneratingBlock, onGeneratingChange]);

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
      blueprint.eventType || 'Ciljni Event',
      blueprint.eventDistanceKm ? `${blueprint.eventDistanceKm} km` : '',
      blueprint.eventElevationM ? `${blueprint.eventElevationM} m uspona` : ''
    ].filter(Boolean);

    return {
      title: blueprint.goalTitle || 'Ciljni Event',
      date: blueprint.eventDate,
      category: blueprint.eventType || 'Utrka / Event',
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

      setGenerationStage('block');

      const firstBlockData = await generatePlanBlockWorkouts({
        blueprint: enrichedBlueprint,
        weekFrom: firstBlock.weekFrom,
        weekTo: firstBlock.weekTo,
        weeklySchedule: formData.weeklySchedule,
        minWorkoutDate: formData.startDate,
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
      setGenError(err?.message || 'Greška pri generiranju makro-plana.');
    } finally {
      setIsGenerating(false);
      setGenerationStage(null);
    }
  };

  const handleGenerateBlock = async (blockMeta) => {
    if (!blueprint || !blockMeta || isGeneratingBlock) return;
    setIsGeneratingBlock(true);
    setGenError(null);
    setSyncStatus(null);

    try {
      const schedule = questionnaire?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE;
      const minDate = questionnaire?.startDate || blueprint.startDate || todayIso;

      const blockData = await generatePlanBlockWorkouts({
        blueprint,
        weekFrom: blockMeta.weekFrom,
        weekTo: blockMeta.weekTo,
        weeklySchedule: schedule,
        minWorkoutDate: minDate,
        notes: questionnaire?.notes || '',
        athleteProfile: profile,
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });

      const nextPlan = {
        ...savedPlan,
        blocks: {
          ...generatedBlocks,
          [blockMeta.key]: blockData
        },
        updatedAt: new Date().toISOString()
      };
      persistPlan(nextPlan);
      setActiveBlockKey(blockMeta.key);
    } catch (err) {
      setGenError(err?.message || `Greška pri generiranju Bloka ${blockMeta.blockIndex}.`);
    } finally {
      setIsGeneratingBlock(false);
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
          ? `Event "${payload.title}" (${formatShortHrDate(payload.date)}) dodan u Kalendar i Intervals.icu!`
          : `Event "${payload.title}" (${formatShortHrDate(payload.date)}) dodan u lokalni Kalendar.`,
        targetDate: payload.date
      });
    } else {
      setSyncStatus({
        type: 'error',
        text: res?.error || 'Nije uspjelo dodavanje eventa u kalendar.'
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

  const handleSyncActiveBlock = async () => {
    if (!activeBlockData || !activeBlockMeta || !blueprint || !onCreatePlanBatch) return;

    setSyncStatus(null);

    try {
      // Ako je odabrana zamjena prethodnih AI blokova koji se preklapaju
      if (collisionMode === 'replace' && overlappingRegistryBlocks.length > 0 && onDeletePlanBlock) {
        for (const oldBlock of overlappingRegistryBlocks) {
          const oldTotal = Math.max(1, (oldBlock.localIds?.length || 0) + (oldBlock.intervalsIds?.length || 0));
          setSyncProgress({
            mode: 'delete',
            done: 0,
            total: oldTotal,
            message: `Uklanjanje starog bloka (${oldBlock.title})...`
          });
          await onDeletePlanBlock(oldBlock.blockKey, {
            onProgress: createProgressHandler(
              'delete',
              oldTotal,
              ({ done, total }) => `Uklanjanje prethodnog bloka (${done}/${total})...`
            )
          });
        }
      }

      const occupiedDates = new Set(collidingDates);
      const workoutsToSync = activeBlockWorkouts.filter(w => {
        if (collisionMode === 'skip' && occupiedDates.has(w.date)) return false;
        return true;
      });

      const workoutPayloads = workoutsToSync.map(w =>
        buildErgVibeWorkoutObject({
          title: w.title,
          category: w.category || 'Endurance',
          intervalsCode: w.intervalsCode,
          steps: w.steps,
          durationMinutes: w.durationMinutes,
          estimatedTss: w.estimatedTss,
          date: w.date,
          ftp
        })
      );

      if (includeTargetEventInSync && blueprint.goalMode === 'event' && !isEventInCalendar) {
        const racePayload = buildRaceEventPayload();
        if (racePayload) {
          workoutPayloads.push(racePayload);
        }
      }

      if (workoutPayloads.length === 0) {
        setSyncStatus({
          type: 'warning',
          text: 'Svi datumi ovog bloka već su zauzeti postojećim treninzima pa ništa nije dodano. Odaberi "Dodaj uz postojeće" ili oslobodi dane u kalendaru.'
        });
        setSyncProgress(null);
        return;
      }

      const useIntervals = Boolean(intervalsConnected && syncToIntervals);
      setSyncProgress({
        mode: 'add',
        done: 0,
        total: workoutPayloads.length,
        message: useIntervals
          ? `Sinkronizacija s Kalendarom i Intervals.icu (0/${workoutPayloads.length})...`
          : `Spremanje treninga u ErgVibe Kalendar...`
      });

      const result = await onCreatePlanBatch(workoutPayloads, {
        planId: blueprint.planId,
        blockKey: registryBlockKey,
        blockTitle: `${blueprint.planTitle} • Blok ${activeBlockMeta.blockIndex} (Tj. ${activeBlockMeta.weekFrom}–${activeBlockMeta.weekTo})`,
        startDate: activeBlockDateRange.start,
        endDate: activeBlockDateRange.end,
        syncToIntervals: useIntervals,
        onProgress: createProgressHandler(
          'add',
          workoutPayloads.length,
          ({ done, total, currentName }) => {
            const label = currentName ? `: ${currentName}` : '';
            return useIntervals
              ? `Slanje na Intervals.icu (${done}/${total})${label}`
              : `Spremanje u kalendar (${done}/${total})${label}`;
          }
        )
      });

      setSyncProgress(null);

      if (result.errors?.length > 0 && result.intervalsCount === 0 && useIntervals) {
        setSyncStatus({
          type: 'warning',
          text: `${result.total} treninga spremljeno lokalno, ali Intervals.icu sinkronizacija je javila grešku (${result.errors[0]?.error || 'API greška'}).`,
          targetDate: activeBlockDateRange.start
        });
      } else if (useIntervals) {
        setSyncStatus({
          type: 'success',
          text: `Dodano ${result.total} stavki u Kalendar (${result.intervalsCount} sinkronizirano na Intervals.icu).`,
          targetDate: activeBlockDateRange.start
        });
      } else {
        setSyncStatus({
          type: 'success',
          text: `Dodano ${result.total} stavki u lokalni ErgVibe Kalendar.`,
          targetDate: activeBlockDateRange.start
        });
      }
    } catch (err) {
      setSyncProgress(null);
      setSyncStatus({
        type: 'error',
        text: err?.message || 'Greška pri sinkronizaciji bloka.'
      });
    }
  };

  const handleRemoveSyncedBlock = async () => {
    if (!activeSyncedRecord || !onDeletePlanBlock) return;
    setSyncStatus(null);
    const deleteTotal = Math.max(1, (activeSyncedRecord.localIds?.length || 0) + (activeSyncedRecord.intervalsIds?.length || 0));
    setSyncProgress({
      mode: 'delete',
      done: 0,
      total: deleteTotal,
      message: 'Uklanjanje sinkroniziranog bloka iz Kalendara...'
    });

    try {
      const res = await onDeletePlanBlock(activeSyncedRecord.blockKey, {
        onProgress: createProgressHandler(
          'delete',
          deleteTotal,
          ({ done, total }) => `Brisanje stavki (${done}/${total})...`
        )
      });
      setSyncProgress(null);
      setSyncStatus({
        type: 'success',
        text: `Uklonjeno ${res.deletedLocal} lokalnih i ${res.deletedIntervals} Intervals.icu stavki za ovaj blok.`
      });
    } catch (err) {
      setSyncProgress(null);
      setSyncStatus({
        type: 'error',
        text: err?.message || 'Greška pri uklanjanju bloka.'
      });
    }
  };

  // --- VIEW 1: WIZARD UPITNIK ---
  if (showWizard || !blueprint) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <PlanQuestionnaire
          initialPrefill={initialPrefill}
          profile={profile}
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
                    {blueprint.eventPriority === 'RACE_B' ? 'Prioritet B' : 'Cilj A'} • {blueprint.eventType}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <Activity className="w-3.5 h-3.5" />
                    Opći Fitness Makro-Plan
                  </span>
                )}

                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-volt-400/15 text-volt-400 border border-volt-400/30">
                  {blueprint.totalWeeks} tjedana
                </span>

                {blueprint.recommendedMethodology && (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {blueprint.recommendedMethodology}
                  </span>
                )}

                {daysToEvent !== null && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-zinc-950 text-zinc-200 border border-zinc-700">
                    {daysToEvent > 0 ? `${daysToEvent} dana do eventa (${formatShortHrDate(blueprint.eventDate)})` : `Event: ${formatShortHrDate(blueprint.eventDate)}`}
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
                  <span className="text-volt-400 font-semibold">Metodologija:</span> {blueprint.methodologyReason}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {blueprint.goalMode === 'event' && (
                isEventInCalendar ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25">
                    <Check className="w-3.5 h-3.5" />
                    Event u kalendaru
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddRaceEventOnly}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Dodaj Event u Kalendar
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
                  Otvori u Kalendaru
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setGenError(null);
                  setShowWizard(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-volt-400/15 hover:bg-volt-400/25 text-volt-400 border border-volt-400/30 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Novi plan / Upitnik
              </button>
            </div>
          </div>

          {/* Phase Timeline Bar */}
          {Array.isArray(blueprint.phases) && blueprint.phases.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                <span>Makrociklus i Faze Periodizacije</span>
                <button
                  type="button"
                  onClick={() => setShowRationale(v => !v)}
                  className="inline-flex items-center gap-1 text-zinc-400 hover:text-volt-400 transition-colors normal-case font-medium"
                >
                  <Info className="w-3.5 h-3.5" />
                  {showRationale ? 'Sakrij objašnjenje trenera' : 'Zašto ovakva periodizacija?'}
                </button>
              </div>

              <div className="flex h-3 rounded-full overflow-hidden bg-zinc-950 border border-zinc-800 gap-0.5 p-0.5">
                {blueprint.phases.map((phase, idx) => {
                  const span = Math.max(1, (phase.weekTo || 1) - (phase.weekFrom || 1) + 1);
                  const pct = (span / blueprint.totalWeeks) * 100;
                  const meta = PHASE_META[phase.type] || PHASE_META.base;
                  return (
                    <div
                      key={`${phase.type}-${idx}`}
                      style={{ width: `${pct}%` }}
                      title={`${phase.label || meta.label} (Tj. ${phase.weekFrom}–${phase.weekTo}): ${phase.focus || ''}`}
                      className={`${meta.bar} rounded-full transition-all`}
                    />
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {blueprint.phases.map((phase, idx) => {
                  const meta = PHASE_META[phase.type] || PHASE_META.base;
                  return (
                    <div
                      key={`legend-${idx}`}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${meta.cls}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${meta.bar}`} />
                      <span className="font-bold">{phase.label || meta.label}</span>
                      <span className="opacity-80">Tj. {phase.weekFrom === phase.weekTo ? phase.weekFrom : `${phase.weekFrom}–${phase.weekTo}`}</span>
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
                        <span className="text-[11px] font-bold text-white">Tj. {wk.weekNumber}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${meta.cls}`}>
                          {wk.isRecoveryWeek ? 'Rest' : meta.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-1">
                        {formatShortHrDate(wk.startDate)}
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
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                      isActive
                        ? 'bg-volt-400 text-zinc-950 border-volt-400 shadow-lg shadow-volt-400/15'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      Blok {meta.blockIndex} ({meta.weekFrom === meta.weekTo ? `Tj. ${meta.weekFrom}` : `Tj. ${meta.weekFrom}–${meta.weekTo}`})
                    </span>
                    {isSynced ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isActive ? 'bg-zinc-950/20 text-zinc-950' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        U kalendaru ✓
                      </span>
                    ) : isGenerated ? (
                      <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-zinc-950' : 'bg-volt-400'}`} title="Treninzi generirani" />
                    ) : (
                      <span className={`text-[10px] opacity-75 ${isActive ? 'text-zinc-900' : 'text-zinc-500'}`}>
                        Nacrt
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {questionnaire?.weeklySchedule && (
              <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                <span>
                  Aktivni dani:{' '}
                  {WEEKDAY_DEFS.filter(d => questionnaire.weeklySchedule[d.key]?.enabled)
                    .map(d => d.short)
                    .join(', ')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Global Error Banner */}
        {genError && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-sm text-rose-200 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{genError}</span>
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
                Blok {activeBlockMeta.blockIndex} (Tjedni {activeBlockMeta.weekFrom}–{activeBlockMeta.weekTo}) još nije raspisan po danima
              </h3>
              <p className="text-xs sm:text-sm text-zinc-400">
                Makrociklus je već isplanirao faze i ciljani tjedni volumen za ovaj blok. Klikni ispod kada želiš da AI trener raspiše konkretne strukturirane treninge za svaki tvoj slobodan dan.
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
                        <span className="text-xs font-bold text-white">Tjedan {wk.weekNumber}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {formatShortHrDate(wk.startDate)} – {formatShortHrDate(wk.endDate)}
                      </div>
                      <div className="text-xs font-semibold text-volt-400">
                        Cilj: ~{wk.targetTss} TSS {wk.isRecoveryWeek ? '• Oporavak' : ''}
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
                    Generiranje treninga za Blok {activeBlockMeta.blockIndex}...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Generiraj detaljne treninge za Blok {activeBlockMeta.blockIndex}
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
                      Sinkronizacija Bloka {activeBlockMeta.blockIndex} (Tjedni {activeBlockMeta.weekFrom}–{activeBlockMeta.weekTo})
                    </h3>
                    {activeSyncedRecord && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        Sinkronizirano
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    {activeBlockData.blockSummary || `${activeBlockWorkouts.length} strukturiranih treninga (${formatShortHrDate(activeBlockDateRange.start)} – ${formatShortHrDate(activeBlockDateRange.end)})`}
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
                        Pošalji i na Intervals.icu
                      </span>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400">
                      <HardDrive className="w-4 h-4 text-zinc-500" />
                      <span>Samo lokalni Kalendar (Intervals.icu nije spojen)</span>
                    </div>
                  )}

                  {activeSyncedRecord ? (
                    <button
                      type="button"
                      disabled={isSyncBusy}
                      onClick={handleRemoveSyncedBlock}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Ukloni blok iz Kalendara{activeSyncedRecord.intervalsIds?.length > 0 ? ' & Intervals.icu' : ''}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSyncBusy || activeBlockWorkouts.length === 0}
                      onClick={handleSyncActiveBlock}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-all shadow-lg shadow-volt-400/15 disabled:opacity-50"
                    >
                      {isSyncBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Dodaj Blok {activeBlockMeta.blockIndex} ({activeBlockWorkouts.length} treninga) u Kalendar
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isGeneratingBlock || isSyncBusy}
                    onClick={() => handleGenerateBlock(activeBlockMeta)}
                    title="Ponovno generiraj treninge samo za ovaj blok"
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBlock ? 'animate-spin' : ''}`} />
                    Regeneriraj blok
                  </button>
                </div>
              </div>

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
                    Uključi i ciljni event <strong>{blueprint.goalTitle}</strong> ({formatShortHrDate(blueprint.eventDate)})
                  </span>
                </label>
              )}

              {/* Collision Warning & Strategy */}
              {!activeSyncedRecord && (collidingDates.length > 0 || overlappingRegistryBlocks.length > 0) && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-2.5">
                  <div className="flex items-start gap-2.5 text-xs text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Pronađena preklapanja u kalendaru ({collidingDates.length} dana):</span>{' '}
                      <span className="text-amber-300/90">
                        {collidingDates.slice(0, 6).map(formatShortHrDate).join(', ')}
                        {collidingDates.length > 6 ? ` i još ${collidingDates.length - 6}` : ''}
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
                      Preskoči zauzete dane
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
                      Dodaj uz postojeće
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
                        Zamijeni prethodni AI blok ({overlappingRegistryBlocks.length})
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
                  {syncStatus.targetDate && onNavigateToCalendar && (
                    <button
                      type="button"
                      onClick={() => onNavigateToCalendar(getMondayOfWeekIso(syncStatus.targetDate))}
                      className="inline-flex items-center gap-1 font-bold underline hover:text-white"
                    >
                      Pogledaj u Kalendaru
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
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
                            Tjedan {week.weekNumber}
                          </span>
                          <span className="text-xs text-zinc-400 font-medium">
                            {formatShortHrDate(week.startDate)} – {formatShortHrDate(week.endDate)}
                          </span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${phaseMeta.cls}`}>
                            {week.phaseLabel || phaseMeta.label}
                          </span>
                          {week.isRecoveryWeek && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Tjedan oporavka
                            </span>
                          )}
                        </div>
                        {week.theme && (
                          <p className="text-xs text-zinc-400">{week.theme}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-zinc-300 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800">
                          {weekWorkouts.length} treninga
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
                        Nema zakazanih treninga u ovom tjednu (npr. tjedan završava prije odabranih dana ili počinje kasnije).
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {weekWorkouts.map((w, wIdx) => (
                          <div key={`${w.date}-${wIdx}`} className="space-y-1.5">
                            <div className="flex items-center justify-between px-1 text-[11px]">
                              <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                                <ChevronRight className="w-3.5 h-3.5 text-volt-400" />
                                {w.dayName} • {formatShortHrDate(w.date)}
                              </span>
                            </div>

                            <AIWorkoutCard
                              structuredWorkout={{
                                title: w.title,
                                category: w.category || 'Endurance',
                                date: w.date,
                                durationMinutes: w.durationMinutes,
                                estimatedTss: w.estimatedTss,
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
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useMemo, useEffect } from 'react';
import {
  Flag, Activity, Calendar, Clock, Sparkles, ArrowRight, ArrowLeft,
  AlertCircle, Loader2, Trophy, Gauge, X, BookOpen
} from 'lucide-react';
import { getCustomKnowledgeSources } from '../../services/aiKnowledgeBase';
import { useI18n } from '../../i18n/I18nContext';
import {
  WEEKDAY_DEFS,
  DURATION_TIERS,
  DEFAULT_WEEKLY_SCHEDULE,
  EVENT_TYPE_OPTIONS,
  FITNESS_PRESET_GOALS,
  getWeekdayShort,
  getLocalIsoToday,
  addDaysIso,
  diffDaysIso,
  getDefaultPlanStartDateIso,
  calculatePlanWeeksCount,
  summarizeWeeklySchedule,
  formatShortHrDate,
  loadPlannerSchedule,
  savePlannerSchedule
} from '../../utils/plannerUtils';

const EXPERIENCE_OPTIONS = [
  { id: '<1', labelHr: 'Početnik (<1 god)', labelEn: 'Beginner (<1 yr)' },
  { id: '1-3', labelHr: 'Rekreativac (1–3 god)', labelEn: 'Recreational (1–3 yrs)' },
  { id: '3-5', labelHr: 'Napredni (3–5 god)', labelEn: 'Advanced (3–5 yrs)' },
  { id: '5+', labelHr: 'Natjecatelj (5+ god)', labelEn: 'Competitive (5+ yrs)' }
];

const RIDER_TYPE_OPTIONS = [
  { id: 'all-rounder', labelHr: 'All-rounder', labelEn: 'All-Rounder' },
  { id: 'climber', labelHr: 'Penjač (Climber)', labelEn: 'Climber' },
  { id: 'puncheur', labelHr: 'Puncheur / Brda', labelEn: 'Puncheur / Classics' },
  { id: 'time-trialist', labelHr: 'Kronometraš (TT)', labelEn: 'Time Trialist (TT)' },
  { id: 'sprinter', labelHr: 'Sprinter', labelEn: 'Sprinter' }
];

const WEAKNESS_PRESETS = [
  { id: 'climbs', hr: 'Dugi usponi (W/kg i prag)', en: 'Long climbs (W/kg & threshold)' },
  { id: 'vo2', hr: 'VO2 Max i kratki napadi', en: 'VO2 Max & short surges' },
  { id: 'z2', hr: 'Izdržljivost preko 3h (Z2)', en: 'Endurance over 3h (Z2)' },
  { id: 'recovery', hr: 'Oporavak između intervala', en: 'Recovery between intervals' }
];

const METHODOLOGY_OPTIONS = [
  {
    id: 'auto',
    labelHr: 'AI Preporuka (Automatski)',
    labelEn: 'AI Recommended (Auto)',
    descHr: 'AI odabire optimalni model prema cilju, satima i trenutnom umoru (CTL/TSB)',
    descEn: 'AI selects the optimal model based on your goal, weekly hours, and current fatigue (CTL/TSB)'
  },
  {
    id: 'Polarizirani 80/20 (Seiler)',
    labelHr: 'Polarizirani 80/20 (Seiler)',
    labelEn: 'Polarized 80/20 (Seiler)',
    descHr: '~80% lagana Z2 vožnja ispod LT1 + ~20% jaki VO2max / Threshold intervali',
    descEn: '~80% easy Z2 riding below LT1 + ~20% high-intensity VO2 Max / Threshold intervals'
  },
  {
    id: 'Piramidalni / Sweet Spot',
    labelHr: 'Piramidalni / Sweet Spot',
    labelEn: 'Pyramidal / Sweet Spot',
    descHr: 'Z2 baza + fokus na Sweet Spot (88–94% FTP) i Tempo — odlično za 4–8h/tj.',
    descEn: 'Z2 base + focus on Sweet Spot (88–94% FTP) and Tempo — ideal for 4–8h/wk'
  },
  {
    id: 'VO2 Max Fokus (Intenzivni blok)',
    labelHr: 'VO2 Max Fokus',
    labelEn: 'VO2 Max Focus',
    descHr: 'Klasični VO2max blok (5x3m, 4x4m @ 108–118%, 30/15s) uz čisti Z2 oporavak',
    descEn: 'Classic VO2 Max block (5x3m, 4x4m @ 108–118%, 30/15s) paired with pure Z2 recovery'
  },
  {
    id: 'Coggan Threshold Fokus',
    labelHr: 'Coggan Threshold / FTP',
    labelEn: 'Coggan Threshold / FTP',
    descHr: 'Specifično podizanje laktatnog praga (95–105% FTP, 2x20m, Over-Under)',
    descEn: 'Targeted lactate threshold progression (95–105% FTP, 2x20m, Over-Under)'
  },
  {
    id: 'Joe Friel Periodizacija',
    labelHr: 'Joe Friel Periodizacija',
    labelEn: 'Joe Friel Periodization',
    descHr: 'Progresivni ciklusi opterećenja (3:1 tjedan rasterećenja) i vrhunac forme za cilj',
    descEn: 'Progressive load cycles (3:1 recovery week) peaking cleanly for your target date'
  }
];

export default function PlanQuestionnaire({
  initialPrefill = null,
  profile,
  userId = null,
  wellnessData = {},
  intervalsConnected = false,
  isGenerating = false,
  generationStage = null,
  error = null,
  hasExistingPlan = false,
  onCancel,
  onSubmit
}) {
  const { lang, isEn, tr } = useI18n();
  const todayIso = getLocalIsoToday();
  const defaultStart = getDefaultPlanStartDateIso();
  const defaultEventDate = addDaysIso(defaultStart, 83); // ~12 tjedana unaprijed

  const initialHasFutureGoalDate = Boolean(profile?.goalDate && profile.goalDate > addDaysIso(todayIso, 6));

  const [step, setStep] = useState(1);
  const [goalMode, setGoalMode] = useState(() => {
    if (initialPrefill?.goalMode) return initialPrefill.goalMode;
    return initialHasFutureGoalDate ? 'event' : 'event';
  });

  // Korak 1: Event / Fitness
  const [eventTitle, setEventTitle] = useState(
    initialPrefill?.goalTitle || profile?.primaryGoal || ''
  );
  const [eventDate, setEventDate] = useState(() => {
    if (initialPrefill?.eventDate && initialPrefill.eventDate > todayIso) return initialPrefill.eventDate;
    if (initialHasFutureGoalDate) return profile.goalDate;
    return defaultEventDate;
  });
  const [eventType, setEventType] = useState(EVENT_TYPE_OPTIONS[0].id);
  const [eventPriority, setEventPriority] = useState(initialPrefill?.eventPriority || 'RACE_A');
  const [eventDistanceKm, setEventDistanceKm] = useState('');
  const [eventElevationM, setEventElevationM] = useState('');
  const [addEventToCalendar, setAddEventToCalendar] = useState(
    initialPrefill?.skipAddEvent ? false : true
  );

  const [fitnessGoal, setFitnessGoal] = useState(() =>
    tr(FITNESS_PRESET_GOALS[0].goalHr, FITNESS_PRESET_GOALS[0].goalEn)
  );
  const [fitnessWeeks, setFitnessWeeks] = useState(8);
  const [startDate, setStartDate] = useState(defaultStart);

  // Korak 2: Tjedni raspored (odvojeno po korisniku)
  const [weeklySchedule, setWeeklySchedule] = useState(() => loadPlannerSchedule(userId));

  useEffect(() => {
    setWeeklySchedule(loadPlannerSchedule(userId));
  }, [userId]);

  // Korak 3: Profil & Fokus
  const [experience, setExperience] = useState(profile?.experience || '3-5');
  const [riderType, setRiderType] = useState(profile?.riderType || 'all-rounder');
  const [weakness, setWeakness] = useState(profile?.weakness || '');
  const [methodology, setMethodology] = useState('auto');
  const [methodologyTouched, setMethodologyTouched] = useState(false);
  const customSources = useMemo(() => getCustomKnowledgeSources(), []);
  const [prioritizeCustomSources, setPrioritizeCustomSources] = useState(false);
  const [notes, setNotes] = useState(initialPrefill?.notes || '');
  const [validationError, setValidationError] = useState(null);

  // Ako korisnik prebaci jezik dok je odabran unaprijed zadani preset, ažuriraj tekst preseta
  useEffect(() => {
    setFitnessGoal((prev) => {
      const matched = FITNESS_PRESET_GOALS.find((g) => prev === g.goalHr || prev === g.goalEn);
      return matched ? (lang === 'en' ? matched.goalEn : matched.goalHr) : prev;
    });
    setWeakness((prev) => {
      const matched = WEAKNESS_PRESETS.find((p) => prev === p.hr || prev === p.en);
      return matched ? (lang === 'en' ? matched.en : matched.hr) : prev;
    });
  }, [lang]);

  // Ako korisnik dođe iz Kalendara s prefillom za određeni event
  useEffect(() => {
    if (!initialPrefill) return;
    if (initialPrefill.goalMode) setGoalMode(initialPrefill.goalMode);
    if (initialPrefill.goalTitle) setEventTitle(initialPrefill.goalTitle);
    if (initialPrefill.eventDate) setEventDate(initialPrefill.eventDate);
    if (initialPrefill.eventPriority) setEventPriority(initialPrefill.eventPriority);
    if (initialPrefill.skipAddEvent !== undefined) setAddEventToCalendar(!initialPrefill.skipAddEvent);
    setStep(1);
  }, [initialPrefill]);

  const scheduleSummary = useMemo(() => summarizeWeeklySchedule(weeklySchedule), [weeklySchedule]);

  const totalWeeks = useMemo(() => {
    if (goalMode === 'event') {
      return calculatePlanWeeksCount(startDate, eventDate);
    }
    return Math.max(2, Math.min(24, Number(fitnessWeeks) || 8));
  }, [goalMode, startDate, eventDate, fitnessWeeks]);

  const daysUntilEvent = useMemo(() => {
    if (goalMode !== 'event' || !eventDate) return null;
    return diffDaysIso(todayIso, eventDate);
  }, [goalMode, eventDate, todayIso]);

  // Zadnji poznati CTL/TSB iz wellnessData
  const latestPmc = useMemo(() => {
    const dates = Object.keys(wellnessData || {}).filter(d => d <= todayIso).sort();
    if (dates.length === 0) return null;
    const last = wellnessData[dates[dates.length - 1]];
    if (!last || last.ctl == null) return null;
    const ctl = Math.round(Number(last.ctl));
    const atl = Math.round(Number(last.atl || 0));
    const tsb = Math.round(Number(last.tsb ?? (ctl - atl)));
    return { ctl, atl, tsb };
  }, [wellnessData, todayIso]);

  const ftp = Number(profile?.ftp) || 200;
  const weight = Number(profile?.weight) || 75;
  const wkg = weight > 0 ? (ftp / weight).toFixed(2) : '-';

  const toggleDay = (dayKey) => {
    setWeeklySchedule(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        enabled: !prev[dayKey]?.enabled
      }
    }));
    setValidationError(null);
  };

  const setDayMinutes = (dayKey, minutes) => {
    setWeeklySchedule(prev => ({
      ...prev,
      [dayKey]: {
        enabled: true,
        minutes
      }
    }));
  };

  const applySchedulePreset = (preset) => {
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
      '4x': DEFAULT_WEEKLY_SCHEDULE,
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
    if (presets[preset]) setWeeklySchedule(presets[preset]);
  };

  const nextMondayIso = useMemo(() => {
    const dt = new Date();
    const dow = dt.getDay();
    const daysToMon = dow === 0 ? 1 : (8 - dow);
    return addDaysIso(todayIso, daysToMon);
  }, [todayIso]);

  const validateStep1 = () => {
    if (goalMode === 'event') {
      if (!eventTitle.trim()) {
        setValidationError(tr('Unesi naziv eventa ili utrke za koju se pripremaš.', 'Please enter the name of the event or race you are training for.'));
        return false;
      }
      if (!eventDate || eventDate <= startDate) {
        setValidationError(tr('Datum eventa mora biti nakon početnog datuma plana.', 'Event date must be after the plan start date.'));
        return false;
      }
    } else if (!fitnessGoal.trim()) {
      setValidationError(tr('Odaberi ili upiši svoj glavni fitness cilj.', 'Select or enter your primary fitness goal.'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  const validateStep2 = () => {
    if (scheduleSummary.workoutsPerWeek === 0) {
      setValidationError(tr('Označi barem jedan dan u tjednu kad možeš trenirati.', 'Select at least one day per week when you can train.'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleNext = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep(s => Math.min(3, s + 1));
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (step < 3) {
      handleNext(e);
      return;
    }
    if (!validateStep1() || !validateStep2()) return;

    savePlannerSchedule(userId, weeklySchedule);

    onSubmit({
      goalMode,
      goalTitle: goalMode === 'event' ? eventTitle.trim() : fitnessGoal.trim(),
      eventDate: goalMode === 'event' ? eventDate : null,
      eventType: goalMode === 'event' ? eventType : '',
      eventPriority: goalMode === 'event' ? eventPriority : null,
      eventDistanceKm: goalMode === 'event' ? eventDistanceKm.trim() : '',
      eventElevationM: goalMode === 'event' ? eventElevationM.trim() : '',
      addEventToCalendar: goalMode === 'event' ? addEventToCalendar : false,
      startDate,
      totalWeeks,
      weeklySchedule,
      hoursPerWeek: scheduleSummary.hoursPerWeek,
      workoutsPerWeek: scheduleSummary.workoutsPerWeek,
      experience,
      riderType,
      weakness: weakness.trim(),
      methodology,
      prioritizeCustomSources: customSources.length > 0 && prioritizeCustomSources,
      notes: notes.trim()
    });
  };

  if (isGenerating) {
    return (
      <div className="carbon-panel rounded-xl p-8 md:p-12 flex flex-col items-center justify-center text-center gap-5 min-h-[380px]">
        <div className="relative w-16 h-16 rounded-2xl bg-volt-400/15 border border-volt-400/40 flex items-center justify-center text-volt-400 shadow-volt-glow">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-volt-400">
            {generationStage === 'block1'
              ? tr('Korak 2 / 2 · Detaljni treninzi', 'Step 2 / 2 · Detailed Workouts')
              : tr('Korak 1 / 2 · Arhitektura makrociklusa', 'Step 1 / 2 · Macrocycle Architecture')}
          </span>
          <h3 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100">
            {generationStage === 'block1'
              ? tr('Slažem strukturirane treninge za Blok 1...', 'Building structured workouts for Block 1...')
              : tr('AI Fiziolog projektira periodizaciju do cilja...', 'AI Physiologist is designing periodization to your goal...')}
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {generationStage === 'block1'
              ? tr('Prilagođavam intervale u % FTP-a tvojim slobodnim danima i maksimalnom trajanju po danu.', 'Tailoring % FTP intervals to your available training days and daily time limits.')
              : tr(
                  'Računam faze (Baza → Build → Peak{taper}) i tjedno opterećenje za {weeks} tjedana.',
                  'Calculating phases (Base → Build → Peak{taper}) and weekly training load across {weeks} weeks.',
                  { taper: goalMode === 'event' ? ' → Taper' : '', weeks: totalWeeks }
                )}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <span className={`px-3 py-1 rounded-full border ${
            generationStage === 'block1'
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-volt-400/15 text-volt-400 border-volt-400/40 animate-pulse'
          }`}>
            {tr('1. Makrociklus ({weeks} tj.)', '1. Macrocycle ({weeks} wks)', { weeks: totalWeeks })}
          </span>
          <span className="text-zinc-600">→</span>
          <span className={`px-3 py-1 rounded-full border ${
            generationStage === 'block1'
              ? 'bg-volt-400/15 text-volt-400 border-volt-400/40 animate-pulse'
              : 'bg-zinc-900 text-zinc-500 border-zinc-800'
          }`}>
            {tr('2. Treninzi za Blok 1', '2. Block 1 Workouts')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="carbon-panel rounded-xl overflow-hidden">
      {/* Zaglavlje wizarda i indikatori koraka */}
      <div className="px-5 py-4 md:px-6 border-b border-zinc-800 bg-zinc-950/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-volt-400" />
            <h3 className="text-base md:text-lg font-display font-bold uppercase tracking-wide text-zinc-100">
              {tr('AI Trening Planer · Upitnik', 'AI Training Planner · Setup')}
            </h3>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {tr('Odgovori na 3 brza koraka da AI izradi cjelokupni plan i upiše ga u tvoj kalendar', 'Complete 3 quick steps so AI can build your full plan and sync it to your calendar')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {[
            { num: 1, label: tr('Cilj', 'Goal') },
            { num: 2, label: tr('Raspored', 'Schedule') },
            { num: 3, label: tr('Metodologija & Profil', 'Methodology & Profile') }
          ].map(item => {
            const active = step === item.num;
            const passed = step > item.num;
            return (
              <button
                key={item.num}
                type="button"
                onClick={() => {
                  if (item.num < step) setStep(item.num);
                  else if (item.num === 2 && validateStep1()) setStep(2);
                  else if (item.num === 3 && validateStep1() && validateStep2()) setStep(3);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider border transition-all ${
                  active
                    ? 'bg-volt-400 text-zinc-950 border-volt-400 shadow-volt-glow'
                    : passed
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
                }`}
              >
                <span>0{item.num}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}

          {hasExistingPlan && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              title={tr('Vrati se na trenutni plan', 'Back to current plan')}
              className="ml-1 p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tijelo koraka */}
      <div className="p-5 md:p-6 space-y-5">
        {/* ================= KORAK 1: CILJ & EVENT ================= */}
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                {tr('Za što treniraš?', 'What are you training for?')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setGoalMode('event'); setValidationError(null); }}
                  className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
                    goalMode === 'event'
                      ? 'bg-volt-400/10 border-volt-400 shadow-volt-glow'
                      : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg border shrink-0 ${
                    goalMode === 'event'
                      ? 'bg-volt-400 text-zinc-950 border-volt-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}>
                    <Trophy className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-display font-bold uppercase tracking-wide text-sm text-zinc-100">
                      {tr('Priprema za Event / Utrku', 'Event / Race Preparation')}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {tr('Unesi datum cilja (Gran Fondo, utrka, brdski maraton) i AI slaže sve faze + taper do starta.', 'Enter your target date (Gran Fondo, race, alpine marathon) and AI builds every phase + taper to race day.')}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setGoalMode('fitness'); setValidationError(null); }}
                  className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
                    goalMode === 'fitness'
                      ? 'bg-volt-400/10 border-volt-400 shadow-volt-glow'
                      : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg border shrink-0 ${
                    goalMode === 'fitness'
                      ? 'bg-volt-400 text-zinc-950 border-volt-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}>
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-display font-bold uppercase tracking-wide text-sm text-zinc-100">
                      {tr('Opći Fitness & Napredak', 'General Fitness & Progression')}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {tr('Bez konkretne utrke — ciljano podizanje FTP-a, aerobne Z2 baze ili održavanje forme.', 'No specific race — targeted FTP gains, aerobic Z2 base building, or fitness maintenance.')}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {goalMode === 'event' ? (
              <div className="space-y-4 bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 md:p-5">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
                  <div className="md:col-span-5">
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                      {tr('Naziv eventa / utrke *', 'Event / Race Name *')}
                    </label>
                    <input
                      type="text"
                      value={eventTitle}
                      onChange={(e) => { setEventTitle(e.target.value); setValidationError(null); }}
                      placeholder={tr('npr. Istra 300, Maraton Franja, Gran Fondo', 'e.g. Etape du Tour, Gran Fondo, Local Crit')}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-volt-400 outline-none"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                      {tr('Datum eventa *', 'Event Date *')}
                    </label>
                    <input
                      type="date"
                      value={eventDate}
                      min={addDaysIso(todayIso, 7)}
                      onChange={(e) => { setEventDate(e.target.value); setValidationError(null); }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 font-mono text-xs font-bold text-zinc-100 focus:border-volt-400 outline-none"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                      {tr('Prioritet', 'Priority')}
                    </label>
                    <select
                      value={eventPriority}
                      onChange={(e) => setEventPriority(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-bold text-zinc-100 focus:border-volt-400 outline-none"
                    >
                      <option value="RACE_A">{tr('A-Event (Glavni cilj)', 'A-Race (Main Goal)')}</option>
                      <option value="RACE_B">{tr('B-Event (Pripremni)', 'B-Race (Prep Event)')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    {tr('Tip događaja', 'Event Discipline')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {EVENT_TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setEventType(opt.id)}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          eventType === opt.id
                            ? 'bg-volt-400/12 border-volt-400/50 text-volt-300'
                            : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                      >
                        <div className="text-xs font-bold text-zinc-100 leading-tight">{tr(opt.labelHr, opt.labelEn)}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{tr(opt.descHr, opt.descEn)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      {tr('Duljina (km, opcionalno)', 'Distance (km, optional)')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={eventDistanceKm}
                      onChange={(e) => setEventDistanceKm(e.target.value)}
                      placeholder={tr('npr. 155', 'e.g. 155')}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 font-mono text-xs text-zinc-100 focus:border-volt-400 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      {tr('Uspon (m, opcionalno)', 'Elevation Gain (m, optional)')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={20000}
                      value={eventElevationM}
                      onChange={(e) => setEventElevationM(e.target.value)}
                      placeholder={tr('npr. 2400', 'e.g. 2400')}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 font-mono text-xs text-zinc-100 focus:border-volt-400 outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 cursor-pointer hover:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={addEventToCalendar}
                      onChange={(e) => setAddEventToCalendar(e.target.checked)}
                      className="accent-volt-400 w-4 h-4 rounded"
                    />
                    <span className="text-xs text-zinc-200 font-medium leading-tight">
                      {tr(
                        'Upiši event u Kalendar{intervals}',
                        'Add event to Calendar{intervals}',
                        { intervals: intervalsConnected ? ' & Intervals.icu' : '' }
                      )}
                    </span>
                  </label>
                </div>

                {daysUntilEvent != null && daysUntilEvent > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-xs">
                    <span className="text-zinc-400 flex items-center gap-1.5">
                      <Flag className="w-3.5 h-3.5 text-amber-400" />
                      {isEn ? (
                        <>
                          <strong className="font-mono text-volt-400">{daysUntilEvent} {daysUntilEvent === 1 ? 'day' : 'days'}</strong> until <strong className="text-zinc-100">{eventTitle || 'your goal'}</strong>
                        </>
                      ) : (
                        <>
                          Do eventa <strong className="text-zinc-100">{eventTitle || 'cilja'}</strong> ostalo je <strong className="font-mono text-volt-400">{daysUntilEvent} dana</strong>
                        </>
                      )}
                    </span>
                    <span className="font-mono text-[11px] font-bold px-2.5 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/25">
                      {isEn
                        ? `Planned macrocycle: ${totalWeeks} ${totalWeeks === 1 ? 'week' : 'weeks'}`
                        : `Planirani makrociklus: ${totalWeeks} ${totalWeeks === 1 ? 'tjedan' : (totalWeeks < 5 ? 'tjedna' : 'tjedana')}`}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 md:p-5">
                <div>
                  <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    {tr('Glavni fitness cilj *', 'Primary Fitness Goal *')}
                  </label>
                  <input
                    type="text"
                    value={fitnessGoal}
                    onChange={(e) => { setFitnessGoal(e.target.value); setValidationError(null); }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 focus:border-volt-400 outline-none mb-2.5"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {FITNESS_PRESET_GOALS.map(g => {
                      const isPresetActive = fitnessGoal === g.goalHr || fitnessGoal === g.goalEn;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            setFitnessGoal(tr(g.goalHr, g.goalEn));
                            if (!methodologyTouched && g.id.toLowerCase().includes('vo2')) {
                              setMethodology('VO2 Max Fokus (Intenzivni blok)');
                            }
                          }}
                          className={`p-2.5 rounded-lg border text-left transition-all ${
                            isPresetActive
                              ? 'bg-volt-400/12 border-volt-400/50 text-volt-300'
                              : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <div className="text-xs font-bold text-zinc-100">{tr(g.labelHr, g.labelEn)}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">{tr(g.descHr, g.descEn)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    {tr('Trajanje ciklusa', 'Cycle Duration')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { w: 4, label: tr('4 tjedna · 1 blok', '4 weeks · 1 block') },
                      { w: 8, label: tr('8 tjedana · 2 bloka', '8 weeks · 2 blocks') },
                      { w: 12, label: tr('12 tjedana · 3 bloka', '12 weeks · 3 blocks') }
                    ].map(opt => (
                      <button
                        key={opt.w}
                        type="button"
                        onClick={() => setFitnessWeeks(opt.w)}
                        className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold border transition-all ${
                          fitnessWeeks === opt.w
                            ? 'bg-volt-400 text-zinc-950 border-volt-400'
                            : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Početak plana */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-950/60 border border-zinc-800 rounded-xl p-4">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {tr('Kada krećeš s prvim treningom?', 'When do you start your first workout?')}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {tr('Odaberi točan datum ili brzi početak od sutra / sljedećeg ponedjeljka', 'Pick an exact date or quick-start tomorrow / next Monday')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStartDate(addDaysIso(todayIso, 1))}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    startDate === addDaysIso(todayIso, 1)
                      ? 'bg-volt-400/15 text-volt-400 border-volt-400/40'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {tr('Od sutra ({date})', 'Tomorrow ({date})', { date: formatShortHrDate(addDaysIso(todayIso, 1), lang) })}
                </button>
                <button
                  type="button"
                  onClick={() => setStartDate(nextMondayIso)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    startDate === nextMondayIso
                      ? 'bg-volt-400/15 text-volt-400 border-volt-400/40'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {tr('Slj. ponedjeljak ({date})', 'Next Monday ({date})', { date: formatShortHrDate(nextMondayIso, lang) })}
                </button>
                <input
                  type="date"
                  value={startDate}
                  min={todayIso}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 font-mono text-xs font-bold text-zinc-200 focus:border-volt-400 outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* ================= KORAK 2: TJEDNI RASPORED ================= */}
        {step === 2 && (
          <div className="space-y-4 animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-volt-400" /> {tr('Koje dane u tjednu treniraš?', 'Which days of the week do you train?')}
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {tr('Klikni dane kad si slobodan i odaberi koliko vremena imaš taj dan — AI će slagati treninge točno na te dane.', 'Toggle your available days and pick your time limit per day — AI schedules workouts strictly on those days.')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">{tr('Brzo:', 'Quick:')}</span>
                {[
                  { id: '3x', label: tr('3x tj.', '3x/wk') },
                  { id: '4x', label: tr('4x tj.', '4x/wk') },
                  { id: '5x', label: tr('5x tj.', '5x/wk') }
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applySchedulePreset(p.id)}
                    className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono font-bold text-zinc-300 hover:text-volt-400 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {WEEKDAY_DEFS.map(day => {
                const cfg = weeklySchedule[day.key] || { enabled: false, minutes: 60 };
                return (
                  <div
                    key={day.key}
                    className={`rounded-xl border p-3 flex flex-col gap-2.5 transition-all ${
                      cfg.enabled
                        ? 'bg-zinc-900/90 border-volt-400/45'
                        : 'bg-zinc-950/60 border-zinc-800/80 opacity-65 hover:opacity-90'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDay(day.key)}
                      className="flex md:flex-col items-center justify-between md:justify-center gap-1.5 w-full text-left md:text-center"
                    >
                      <span className={`font-display font-bold uppercase tracking-wider text-sm ${
                        cfg.enabled ? 'text-volt-400' : 'text-zinc-400'
                      }`}>
                        {getWeekdayShort(day, lang)}
                      </span>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        cfg.enabled
                          ? 'bg-volt-400/15 text-volt-300 border-volt-400/30'
                          : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                      }`}>
                        {cfg.enabled ? tr('TRENING', 'WORKOUT') : tr('ODMOR', 'REST')}
                      </span>
                    </button>

                    {cfg.enabled && (
                      <div className="flex flex-row md:flex-col gap-1 pt-1 border-t border-zinc-800/80 flex-wrap">
                        {DURATION_TIERS.map(tier => {
                          const isSelected = cfg.minutes === tier.minutes;
                          return (
                            <button
                              key={tier.id}
                              type="button"
                              onClick={() => setDayMinutes(day.key, tier.minutes)}
                              title={tr(tier.descHr, tier.descEn)}
                              className={`flex-1 md:flex-none px-2 py-1 rounded text-[11px] font-mono font-bold transition-all border ${
                                isSelected
                                  ? 'bg-volt-400 text-zinc-950 border-volt-400'
                                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
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

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 font-mono telemetry-num">
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <Calendar className="w-4 h-4 text-volt-400" />
                  <strong>{scheduleSummary.workoutsPerWeek}</strong> {tr('treninga / tj.', 'workouts / wk')}
                </span>
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <Clock className="w-4 h-4 text-sky-400" />
                  ~<strong>{scheduleSummary.hoursPerWeek} h</strong> {tr('/ tjedno', '/ week')}
                </span>
              </div>
              <span className="text-zinc-400 text-[11px]">
                {tr('Preporuka: ostavi barem 1–2 dana odmora tjedno za superkompenzaciju.', 'Tip: leave at least 1–2 rest days per week for supercompensation.')}
              </span>
            </div>
          </div>
        )}

        {/* ================= KORAK 3: PROFIL & FOKUS ================= */}
        {step === 3 && (
          <div className="space-y-5 animate-in fade-in">
            {/* Trenutna fiziologija povučena iz profila */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-volt-400/10 border border-volt-400/25 text-volt-400">
                  <Gauge className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                    {tr('Učitana fiziologija iz profila', 'Loaded Profile Physiology')}
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono telemetry-num mt-0.5">
                    <span className="font-bold text-volt-400">FTP {ftp} W</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-200">{weight} kg ({wkg} W/kg)</span>
                    {latestPmc && (
                      <>
                        <span className="text-zinc-600">·</span>
                        <span className="text-sky-400">CTL {latestPmc.ctl}</span>
                        <span className={latestPmc.tsb >= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                          TSB {latestPmc.tsb > 0 ? `+${latestPmc.tsb}` : latestPmc.tsb}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                {tr(
                  '{weeks} tj. · {perWeek}x/tj. · ~{hours}h',
                  '{weeks} wks · {perWeek}x/wk · ~{hours}h',
                  { weeks: totalWeeks, perWeek: scheduleSummary.workoutsPerWeek, hours: scheduleSummary.hoursPerWeek }
                )}
              </span>
            </div>

            {/* Trenerska metodologija — istaknuti odabir na Koraku 3 */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {tr('Trenerska metodologija treninga *', 'Coaching Training Methodology *')}
                </label>
                <span className="text-[10px] text-zinc-500">
                  {tr('Odaberi pristup po kojem AI slaže plan i intervale', 'Choose the approach AI uses to structure your plan and intervals')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {METHODOLOGY_OPTIONS.map(opt => {
                  const selected = methodology === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setMethodology(opt.id);
                        setMethodologyTouched(true);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? 'bg-volt-400/12 border-volt-400/60 shadow-sm'
                          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className={`text-xs font-bold leading-tight ${selected ? 'text-volt-300' : 'text-zinc-100'}`}>
                        {tr(opt.labelHr, opt.labelEn)}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-1 leading-snug">
                        {tr(opt.descHr, opt.descEn)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {customSources.length > 0 && (
                <label className="mt-3 flex items-start gap-2.5 p-3 rounded-xl bg-sky-950/25 border border-sky-500/30 cursor-pointer hover:border-sky-500/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={prioritizeCustomSources}
                    onChange={(e) => setPrioritizeCustomSources(e.target.checked)}
                    className="accent-sky-400 w-4 h-4 rounded mt-0.5 shrink-0"
                  />
                  <div className="text-xs leading-snug">
                    <div className="font-bold text-sky-200 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                      {tr(
                        'Daj prednost mojim dodanim izvorima iz Baze znanja ({count})',
                        'Prioritize my custom Knowledge Base sources ({count})',
                        { count: customSources.length }
                      )}
                    </div>
                    <div className="text-[11px] text-sky-300/75 mt-0.5">
                      {tr('Izvori:', 'Sources:')} {customSources.slice(0, 3).map(s => s.title).join(', ')}{customSources.length > 3 ? ` +${customSources.length - 3}` : ''}
                    </div>
                  </div>
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                  {tr('Biciklističko iskustvo', 'Cycling Experience')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {EXPERIENCE_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setExperience(opt.id)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border text-left transition-all ${
                        experience === opt.id
                          ? 'bg-volt-400/15 text-volt-300 border-volt-400/50'
                          : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {tr(opt.labelHr, opt.labelEn)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                  {tr('Profil vozača', 'Rider Profile')}
                </label>
                <select
                  value={riderType}
                  onChange={(e) => setRiderType(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs font-bold text-zinc-200 focus:border-volt-400 outline-none"
                >
                  {RIDER_TYPE_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>{tr(opt.labelHr, opt.labelEn)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                {tr('Na čemu najviše želiš napredovati? (opcionalno)', 'What do you most want to improve? (optional)')}
              </label>
              <input
                type="text"
                value={weakness}
                onChange={(e) => setWeakness(e.target.value)}
                placeholder={tr('npr. dugi usponi, držanje praga nakon 3h vožnje...', 'e.g. long climbs, holding threshold after 3h of riding...')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-volt-400 outline-none mb-2"
              />
              <div className="flex flex-wrap gap-1.5">
                {WEAKNESS_PRESETS.map(preset => {
                  const presetLabel = tr(preset.hr, preset.en);
                  const isActivePreset = weakness === preset.hr || weakness === preset.en;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setWeakness(presetLabel)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded border transition-colors ${
                        isActivePreset
                          ? 'bg-volt-400/15 text-volt-300 border-volt-400/40'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {presetLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                {tr('Posebne želje ili ograničenja (opcionalno)', 'Special requests or constraints (optional)')}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tr(
                  'Npr. Radnim danom vozim isključivo na pametnom trenažeru u ERG modu, vikendom idem vani...',
                  'e.g. Weekdays indoors on smart trainer in ERG mode only, outdoor rides on weekends...'
                )}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-volt-400 outline-none resize-none"
              />
            </div>
          </div>
        )}

        {(validationError || error) && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{validationError || error}</span>
          </div>
        )}
      </div>

      {/* Footer navigacija */}
      <div className="px-5 py-4 md:px-6 border-t border-zinc-800 bg-zinc-950/70 flex items-center justify-between gap-3">
        <div>
          {step > 1 ? (
            <button
              type="button"
              onClick={() => { setValidationError(null); setStep(s => s - 1); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-300 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {tr('Natrag', 'Back')}
            </button>
          ) : hasExistingPlan && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {tr('Odustani', 'Cancel')}
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {step < 3 ? (
            <button
              key="wizard-next-btn"
              type="button"
              onClick={handleNext}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs shadow-volt-glow transition-all"
            >
              {tr('Dalje', 'Next')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              key="wizard-submit-btn"
              type="button"
              onClick={handleSubmit}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs shadow-volt-glow transition-all"
            >
              <Sparkles className="w-4 h-4" /> {tr('Izradi AI Plan & Blok 1', 'Generate AI Plan & Block 1')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

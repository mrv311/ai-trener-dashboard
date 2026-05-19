import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Target, TrendingUp, Trophy, ArrowUpRight, Flame, Clock, Award, Info,
  Zap, Heart, ChevronUp, ChevronDown, Minus, Lock, ShieldCheck
} from 'lucide-react';

import { calculateLongitudinalFTP, canDetectFTP } from '../utils/ftpProgression';
import { useEFTPWorker } from '../hooks/useEFTPWorker';

// ── Zone config ─────────────────────────────────────────────────────────────
const ZONES = [
  { id: 'Endurance', name: 'Z2 Endurance', color: 'text-sky-400', bg: 'bg-sky-500', icon: <Clock className="w-5 h-5 text-sky-400" /> },
  { id: 'Tempo', name: 'Z3 Tempo', color: 'text-emerald-400', bg: 'bg-emerald-500', icon: <Target className="w-5 h-5 text-emerald-400" /> },
  { id: 'Sweet Spot', name: 'Sweet Spot', color: 'text-yellow-400', bg: 'bg-yellow-500', icon: <TrendingUp className="w-5 h-5 text-yellow-400" /> },
  { id: 'Threshold', name: 'Z4 Threshold', color: 'text-orange-500', bg: 'bg-orange-500', icon: <Flame className="w-5 h-5 text-orange-500" /> },
  { id: 'VO2 Max', name: 'Z5 VO2 Max', color: 'text-rose-500', bg: 'bg-rose-500', icon: <Award className="w-5 h-5 text-rose-500" /> },
  { id: 'Anaerobni', name: 'Z6 Anaerobni', color: 'text-fuchsia-500', bg: 'bg-fuchsia-500', icon: <Trophy className="w-5 h-5 text-fuchsia-500" /> },
];

// ── Decision badge helper ───────────────────────────────────────────────────
const DECISION_CONFIG = {
  increase: {
    icon: ChevronUp,
    label: 'Povećanje',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]',
  },
  decrease: {
    icon: ChevronDown,
    label: 'Smanjenje',
    textColor: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    glow: 'shadow-[0_0_20px_rgba(244,63,94,0.15)]',
  },
  hold: {
    icon: Minus,
    label: 'Zadrži',
    textColor: 'text-zinc-400',
    bgColor: 'bg-zinc-800/50',
    borderColor: 'border-zinc-700/50',
    glow: '',
  },
};

export default function ProgressionTab({ workouts = [], profile, setProfile }) {
  const [levels, setLevels] = useState({});
  const [history, setHistory] = useState([]);

  // ── eFTP from the most recent workout's sensor data ─────────────────────
  // If sensor data is loaded separately (e.g. from Supabase stream_data),
  // it would be passed here. For now we use null — the hook safely returns
  // null and does not run the O(n) computation.
  const { currentEFTP } = useEFTPWorker(null);

  // ── 30-day FTP detection cooldown (memoized) ────────────────────────────
  //    Only recomputes when the profile's lastFtpUpdate value actually
  //    changes — no extra renders from parent state churn.
  const cooldown = useMemo(
    () => canDetectFTP(profile?.lastFtpUpdate),
    [profile?.lastFtpUpdate]
  );

  // ── Longitudinal FTP progression (memoized, O(n)) ───────────────────────
  //    useMemo ensures this only recomputes when the workouts array reference
  //    or the profile FTP actually changes — NOT on every parent re-render.
  //    MUST be declared before handleApplyFTP which depends on it.
  const longitudinalResult = useMemo(() => {
    const ftp = Number(profile?.ftp) || 0;
    if (ftp <= 0) return null;

    // Build the blockWorkouts summary array from recent completed workouts
    const completedWorkouts = workouts.filter(w => w.isCompleted);
    if (completedWorkouts.length === 0) return null;

    // Look back 30 days for a full training block
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const blockWorkouts = completedWorkouts
      .filter(w => new Date(w.date) > thirtyDaysAgo)
      .map(w => {
        const np = Number(w.np) || Number(w.average_power) || 0;
        const hr = Number(w.average_heartrate) || Number(w.avg_hr) || 0;

        // Detect interval sessions by intensity:
        // IF (Intensity Factor) = NP / FTP. Sessions at ≥ 75% FTP
        // are considered structured intensity work (Sweet Spot+).
        // Falls back to category label when available.
        const intensityFactor = ftp > 0 ? np / ftp : 0;
        const hasIntensityCategory = !!(w.category && ['Threshold', 'VO2 Max', 'Sweet Spot', 'Anaerobni'].includes(w.category));
        const isInterval = hasIntensityCategory || intensityFactor >= 0.75;

        return {
          actualNP: np,
          targetNP: Number(w.targetNP) || 0,
          avgHR: hr,
          duration: (Number(w.duration) || 0) * 60,
          isInterval,
        };
      });

    if (blockWorkouts.length < 2) return null;

    return calculateLongitudinalFTP(ftp, blockWorkouts);
  }, [workouts, profile?.ftp]);

  // ── Apply detected FTP to profile ───────────────────────────────────────
  const handleApplyFTP = useCallback(() => {
    if (!cooldown.allowed || !longitudinalResult || !setProfile) return;

    const newFTP = longitudinalResult.newFTP;
    if (!newFTP || newFTP <= 0) return;

    setProfile(prev => ({
      ...prev,
      ftp: newFTP,
      lastFtpUpdate: new Date().toISOString(),
    }));
  }, [cooldown.allowed, longitudinalResult, setProfile]);

  // ── Reject detected FTP and reset cooldown ─────────────────────────────
  const handleRejectFTP = useCallback(() => {
    if (!cooldown.allowed || !setProfile) return;

    setProfile(prev => ({
      ...prev,
      lastFtpUpdate: new Date().toISOString(),
    }));
  }, [cooldown.allowed, setProfile]);

  // ── Existing zone-level logic (unchanged from original) ─────────────────
  useEffect(() => {
    const loadHistory = () => {
      try {
        const localHistory = JSON.parse(localStorage.getItem('ai_trener_completed_workouts') || '[]');

        const historyMap = new Map();

        localHistory.forEach(loc => {
          historyMap.set(loc.id, loc);
        });

        workouts.forEach(w => {
          if (w.isCompleted && w.difficulty_score && w.category) {
            historyMap.set(w.id, {
              id: w.id,
              date: w.date,
              title: w.title,
              category: w.category,
              difficulty_score: w.difficulty_score,
              np: w.np || w.average_power || 0,
              tss: w.tss || 0,
              duration: w.duration || 0,
              targetNP: w.targetNP || 0
            });
          }
        });

        const mergedHistory = Array.from(historyMap.values());
        setHistory(mergedHistory);

        const currentLevels = {
          'Endurance': 1.0, 'Tempo': 1.0, 'Sweet Spot': 1.0,
          'Threshold': 1.0, 'VO2 Max': 1.0, 'Anaerobni': 1.0
        };

        const now = new Date();
        const currentFTP = Number(profile?.ftp) || 200;

        mergedHistory.forEach(w => {
          const wDate = new Date(w.date);
          const ageDays = (now - wDate) / (1000 * 60 * 60 * 24);

          if (currentLevels[w.category] !== undefined) {
            let decayedScore = w.difficulty_score;

            // 1. FTP Penalty logic
            const durationSecs = (w.duration || 0) * 60;
            const np = w.np || 0;
            const tss = w.tss || 0;

            let estimatedFTP = 0;
            if (durationSecs > 0 && np > 0 && tss > 0) {
              estimatedFTP = Math.sqrt((durationSecs * Math.pow(np, 2) * 100) / (tss * 3600));
            }

            if (estimatedFTP > 0 && currentFTP > estimatedFTP) {
              const ftpIncreaseRatio = (currentFTP - estimatedFTP) / estimatedFTP;
              if (ftpIncreaseRatio >= 0.01) { // Apply penalty if increase >= 1%
                const ftpIncreasePercent = ftpIncreaseRatio * 100;
                const penalty = ftpIncreasePercent * 0.15;
                decayedScore -= penalty;
              }
            }

            // 2. Apply gradual decay instead of a hard 30-day cliff:
            // Score drops by 0.2 points for every week after 14 days
            if (ageDays > 14) {
              const weeksOld = (ageDays - 14) / 7;
              decayedScore -= (weeksOld * 0.2);
            }

            if (decayedScore > currentLevels[w.category]) {
              currentLevels[w.category] = decayedScore;
            }
          }
        });

        setLevels(currentLevels);
      } catch (e) {
        console.error("Greška kod učitavanja razina napretka", e);
      }
    };

    loadHistory();
  }, [workouts, profile?.ftp]);

  const formatLevel = (val) => parseFloat(val).toFixed(1);
  const getPercentage = (level) => Math.min(100, Math.max(10, (level / 10) * 100));

  // ── Render ──────────────────────────────────────────────────────────────
  const decisionCfg = longitudinalResult
    ? DECISION_CONFIG[longitudinalResult.decision]
    : DECISION_CONFIG.hold;
  const DecisionIcon = decisionCfg.icon;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      {/* HEADER */}
      <div className="bg-zinc-950/50 rounded-3xl shadow-2xl border border-zinc-800/80 p-6 md:p-10 flex flex-col sm:flex-row items-center justify-between shrink-0 gap-6 relative overflow-hidden backdrop-blur-md">
        <div className="absolute -top-20 -right-20 p-6 opacity-[0.03]">
          <TrendingUp className="w-96 h-96 text-orange-500" />
        </div>

        <div className="relative z-10 flex items-center gap-4 w-full">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-4 rounded-2xl shadow-[0_0_20px_rgba(249,115,22,0.4)] md:shrink-0 hidden md:block">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-3xl md:text-4xl font-black text-zinc-100 tracking-tight lowercase">Faktor <span className="text-orange-500">n</span>apretka</h2>
            <p className="text-zinc-400 font-medium text-sm mt-2 max-w-2xl mx-auto md:mx-0">
              Prati tvoju trenutnu sposobnost i izdržljivost unutar različitih zona snage. Završetkom težih treninga (iznad 85% trajanja) podižeš svoj Faktor Težine! Razine polagano propadaju tijekom vremena (nakon 14 dana) ako se sustavno ne treniraju.
            </p>
          </div>
        </div>
      </div>

      {/* eFTP INTELLIGENCE CARD */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">

        {/* Current eFTP / Profile FTP */}
        <div className={`relative overflow-hidden rounded-3xl border p-6 backdrop-blur-xl transition-all ${decisionCfg.borderColor} ${decisionCfg.bgColor} ${decisionCfg.glow}`}>
          {/* Decorative gradient orb */}
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br from-orange-500/20 to-transparent blur-2xl pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-zinc-950/50 p-2 rounded-xl border border-zinc-800">
                <Zap className="w-5 h-5 text-orange-400" />
              </div>
              <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Trenutni eFTP</span>
            </div>

            <div className="flex items-end gap-3 mb-2">
              <span className="text-5xl font-black text-zinc-100 tabular-nums leading-none">
                {currentEFTP ?? profile?.ftp ?? '—'}
              </span>
              <span className="text-lg font-bold text-zinc-500 mb-1">W</span>
            </div>

            {longitudinalResult && (
              <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold mt-2 ${decisionCfg.bgColor} ${decisionCfg.textColor} border ${decisionCfg.borderColor}`}>
                <DecisionIcon className="w-3.5 h-3.5" />
                {longitudinalResult.deltaPct}
                <span className="text-zinc-500 ml-1">({decisionCfg.label})</span>
              </div>
            )}

            {/* ── Detect FTP Button + Cooldown Gate ──────────────── */}
            <div className="mt-4 pt-4 border-t border-zinc-800/40">
              {!cooldown.allowed ? (
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border bg-zinc-900/60 text-zinc-600 border-zinc-800/60 opacity-50 cursor-not-allowed"
                >
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Sljedeća procjena moguća za <span className="text-amber-500/90 tabular-nums">{cooldown.daysRemaining}</span> {cooldown.daysRemaining === 1 ? 'dan' : 'dana'}</span>
                </button>
              ) : longitudinalResult ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleRejectFTP}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all border bg-zinc-800/50 text-zinc-300 border-zinc-700/50 hover:bg-zinc-700 hover:text-white"
                    title="Odbaci prijedlog i zadrži trenutni FTP"
                  >
                    <Minus className="w-4 h-4" /> Zadrži
                  </button>
                  <button
                    id="detect-ftp-btn"
                    onClick={handleApplyFTP}
                    className="flex-[2] flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all border bg-gradient-to-r from-orange-500 to-orange-600 text-white border-orange-500/30 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <ShieldCheck className="w-4 h-4" /> Primijeni eFTP
                  </button>
                </div>
              ) : (
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border bg-zinc-900/60 text-zinc-600 border-zinc-800/60 opacity-50 cursor-not-allowed"
                >
                  <Info className="w-4 h-4 shrink-0" />
                  <span>Nedovoljno podataka za procjenu</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Longitudinal Progression Detail */}
        <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 rounded-3xl p-6 flex flex-col relative overflow-hidden">
          <div className="flex items-center gap-2 mb-5">
            <div className="bg-zinc-950/50 p-2 rounded-xl border border-zinc-800">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Progresija (30 dana)</span>
          </div>

          {longitudinalResult ? (
            <div className="flex-1 flex flex-col justify-between gap-4">
              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-3">
                <MetricPill label="Adherencija" value={longitudinalResult.adherence} />
                <MetricPill label="EF trend" value={longitudinalResult.efTrend} />
                <MetricPill label="Interval sesija" value={longitudinalResult.intervalCount} />
                <MetricPill
                  label="Predloženi FTP"
                  value={`${longitudinalResult.newFTP} W`}
                  highlight={longitudinalResult.decision === 'increase'}
                />
              </div>

              {/* Visual bar */}
              <div className="mt-auto">
                <div className="flex justify-between text-[10px] font-bold text-zinc-600 mb-1.5">
                  <span>{profile?.ftp || '—'} W</span>
                  <span>{longitudinalResult.newFTP} W</span>
                </div>
                <div className="h-2.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${longitudinalResult.decision === 'increase'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      : longitudinalResult.decision === 'decrease'
                        ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                        : 'bg-zinc-600'
                      }`}
                    style={{
                      width: `${Math.min(100, Math.max(5, ((longitudinalResult.newFTP) / ((profile?.ftp || 200) * 1.1)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm font-medium italic">
              <Info className="w-4 h-4 mr-2 shrink-0" />
              Nedovoljno interval sesija za analizu
            </div>
          )}
        </div>


      </div>

      {/* ZONE PROGRESSION CARDS (preserved from original) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {ZONES.map(zone => {
          const currentLevel = levels[zone.id] || 1.0;
          const percentage = getPercentage(currentLevel);
          const hasAdvanced = currentLevel > 1.0;

          const heroWorkout = history
            .filter(w => w.category === zone.id)
            .sort((a, b) => {
              const now = new Date();
              const currentFTP = Number(profile?.ftp) || 200;

              const getDecayed = (wk) => {
                const ageDays = (now - new Date(wk.date)) / (1000 * 60 * 60 * 24);
                let score = wk.difficulty_score;

                const durationSecs = (wk.duration || 0) * 60;
                const np = wk.np || 0;
                const tss = wk.tss || 0;
                let estimatedFTP = 0;
                if (durationSecs > 0 && np > 0 && tss > 0) {
                  estimatedFTP = Math.sqrt((durationSecs * Math.pow(np, 2) * 100) / (tss * 3600));
                }

                if (estimatedFTP > 0 && currentFTP > estimatedFTP) {
                  const ftpIncreaseRatio = (currentFTP - estimatedFTP) / estimatedFTP;
                  if (ftpIncreaseRatio >= 0.01) {
                    const ftpIncreasePercent = ftpIncreaseRatio * 100;
                    const penalty = ftpIncreasePercent * 0.15;
                    score -= penalty;
                  }
                }

                if (ageDays > 14) {
                  const weeksOld = (ageDays - 14) / 7;
                  score -= ((weeksOld) * 0.2);
                }
                return score;
              };
              return getDecayed(b) - getDecayed(a);
            })[0];

          return (
            <div key={zone.id} className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 rounded-3xl p-6 flex flex-col relative overflow-hidden group hover:border-zinc-700 transition-colors">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-800">
                    {zone.icon}
                  </div>
                  <h3 className="text-lg font-bold text-zinc-100">{zone.name}</h3>
                </div>
                <div className={`text-4xl font-black ${hasAdvanced ? 'text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'text-zinc-700'}`}>
                  {formatLevel(currentLevel)}
                </div>
              </div>

              {/* BAR CHART */}
              <div className="h-4 w-full bg-zinc-950 rounded-full overflow-hidden shadow-inner flex mb-6 border border-zinc-800">
                <div
                  className={`h-full ${zone.bg} transition-all duration-1000 ease-out`}
                  style={{ width: `${percentage}%`, filter: hasAdvanced ? 'brightness(1.2)' : 'grayscale(1)' }}
                >
                  {hasAdvanced && <div className="w-full h-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)] animate-[shimmer_2s_infinite]"></div>}
                </div>
              </div>

              {/* HERO WORKOUT */}
              <div className="mt-auto pt-4 border-t border-zinc-800/60 min-h-[4rem] flex flex-col justify-center">
                {heroWorkout ? (
                  <div className="flex items-center justify-between text-xs">
                    <div className="text-zinc-500 font-medium truncate pr-2 flex items-center gap-1.5">
                      <ArrowUpRight className={`w-3.5 h-3.5 ${zone.color}`} />
                      Zaslužno: <span className="text-zinc-300 font-bold truncate max-w-[120px]">{heroWorkout.title}</span>
                    </div>
                    <span className="font-bold text-zinc-400 bg-zinc-950 px-2 py-1 rounded max-w-fit flex-shrink-0">
                      Prije {Math.floor((Date.now() - new Date(heroWorkout.date)) / (1000 * 60 * 60 * 24))} d
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center text-xs text-zinc-600 gap-1.5 font-medium italic">
                    <Info className="w-3.5 h-3.5" /> Nema završenih treninga
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Small metric pill used inside the progression cards */
function MetricPill({ label, value, highlight = false }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 border transition-colors ${highlight
      ? 'bg-emerald-500/5 border-emerald-500/20'
      : 'bg-zinc-950/50 border-zinc-800/60'
      }`}>
      <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest mb-0.5">{label}</p>
      <p className={`text-sm font-black tabular-nums ${highlight ? 'text-emerald-400' : 'text-zinc-200'}`}>{value}</p>
    </div>
  );
}

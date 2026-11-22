import React, { useState, useMemo } from 'react';
import {
  RotateCcw, Play, CheckCircle2, Trash2, Clock, Zap, Heart,
  Bluetooth, AlertTriangle, X, Layers
} from 'lucide-react';
import { buildRecoverySummary } from '../../services/workoutRecoveryStorage';
import { useI18n } from '../../i18n/I18nContext';

const formatClock = (secs) => {
  const safe = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default function WorkoutRecoveryModal({
  snapshot,
  isOpen,
  onResume,
  onSaveAsFinished,
  onDiscard,
  onDismissForNow
}) {
  const { isEn, locale, tr, tStep } = useI18n();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const summary = useMemo(() => buildRecoverySummary(snapshot), [snapshot]);

  const localizedAgeText = useMemo(() => {
    const safeMs = Math.max(0, Date.now() - (Number(snapshot?.savedAtMs) || Date.now()));
    const mins = Math.floor(safeMs / 60000);
    if (mins < 1) return tr('upravo sada', 'just now');
    if (mins < 60) return tr(`prije ${mins} min`, `${mins}m ago`);
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
      const remMins = mins % 60;
      return remMins > 0
        ? tr(`prije ${hours} h ${remMins} min`, `${hours}h ${remMins}m ago`)
        : tr(`prije ${hours} h`, `${hours}h ago`);
    }
    const days = Math.floor(hours / 24);
    if (days === 1) return tr('jučer', 'yesterday');
    return tr(`prije ${days} dana`, `${days} days ago`);
  }, [snapshot?.savedAtMs, tr]);

  const localizedSavedTime = useMemo(() => {
    const savedDate = snapshot?.savedAt ? new Date(snapshot.savedAt) : null;
    if (!savedDate || Number.isNaN(savedDate.getTime())) return '';
    return savedDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }, [snapshot?.savedAt, locale]);

  if (!isOpen || !snapshot || !summary) return null;

  const displayStepName = (name) => {
    if (!name) return '';
    if (isEn) {
      if (name === 'Z2 Aerobna Baza') return 'Z2 Aerobic Base';
      if (name === 'Radni Interval') return 'Work Interval';
    }
    return tStep(name);
  };

  const localizeSensorLabel = (label) => {
    if (label === 'Pulsmetar' || label === 'HR Monitor') return tr('Pulsmetar', 'HR Monitor');
    if (label === 'FTMS Trenažer' || label === 'FTMS Trainer') return tr('FTMS Trenažer', 'FTMS Trainer');
    if (label === 'Trenažer' || label === 'Trainer') return tr('Trenažer', 'Trainer');
    return label;
  };

  const localizedTitle = snapshot.workoutFromCalendar?.title || tr('Slobodna Vožnja', 'Free Ride');
  const localizedStepName = displayStepName(summary.currentStepName);

  const handleDiscardClick = () => {
    if (summary.elapsedTime >= 60 && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    setConfirmingDiscard(false);
    onDiscard();
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
      <div className="carbon-panel border-amber-400/40 rounded-2xl p-5 md:p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4 max-h-[94dvh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/35 text-amber-300 shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                {tr('OPORAVAK SESIJE · AUTOSAVE (48H)', 'SESSION RECOVERY · AUTOSAVE (48H)')}
              </div>
              <h2 className="font-display font-bold text-xl md:text-2xl uppercase tracking-wide text-zinc-100 leading-tight">
                {tr('Pronađen nezavršen trening', 'Unfinished workout found')}
              </h2>
            </div>
          </div>

          {onDismissForNow && (
            <button
              type="button"
              onClick={() => {
                setConfirmingDiscard(false);
                onDismissForNow();
              }}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800 transition-colors shrink-0"
              title={tr('Odlučit ću kasnije (ostaje na vrhu zaslona)', 'Decide later (stays at top of screen)')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Kartica pronađenog treninga */}
        <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-display font-bold text-lg md:text-xl uppercase tracking-wide text-zinc-100 truncate">
                {localizedTitle}
              </div>
              <div className="font-mono text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>
                  {tr('Prekinuto', 'Interrupted')} <strong className="text-amber-300">{localizedAgeText}</strong>
                  {localizedSavedTime ? ` (${localizedSavedTime})` : ''}
                </span>
                <span className="text-zinc-700">·</span>
                <span>
                  {summary.controlMode === 'ERG'
                    ? `ERG ${summary.ergIntensity}%`
                    : tr(`RES Brzina ${summary.virtualGear}`, `RES Gear ${summary.virtualGear}`)}
                </span>
              </div>
            </div>
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-volt-400/15 text-volt-400 border border-volt-400/30 telemetry-num shrink-0">
              {summary.progressPct}%
            </span>
          </div>

          {/* Traka napretka */}
          <div className="flex flex-col gap-1.5">
            <div className="h-2 w-full rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
              <div
                className="h-full bg-volt-400 shadow-[0_0_10px_rgba(var(--accent-400),0.6)] transition-all"
                style={{ width: `${Math.max(2, summary.progressPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] telemetry-num">
              <span className="text-zinc-200 font-bold flex items-center gap-1">
                <Clock className="w-3 h-3 text-volt-400" />
                {tr('Odrađeno:', 'Completed:')} {formatClock(summary.elapsedTime)}
              </span>
              <span className="text-zinc-500">
                {tr('Ukupno:', 'Total:')} {formatClock(summary.totalDuration)}
              </span>
            </div>
          </div>

          {/* Brze metrike */}
          <div className="grid grid-cols-3 gap-2 pt-1 font-mono telemetry-num">
            <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1">
                <Layers className="w-3 h-3 text-volt-400" /> {tr('Blok', 'Block')}
              </div>
              <div className="text-xs font-bold text-zinc-100 truncate mt-0.5" title={localizedStepName}>
                {summary.currentStepIndex + 1}/{summary.totalSteps} · {localizedStepName}
              </div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" /> {tr('Avg Snaga', 'Avg Power')}
              </div>
              <div className="text-xs font-bold text-zinc-100 mt-0.5">
                {summary.avgPower > 0 ? `${summary.avgPower} W` : '—'}
              </div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1">
                <Heart className="w-3 h-3 text-rose-400" /> {tr('Avg Puls', 'Avg HR')}
              </div>
              <div className="text-xs font-bold text-zinc-100 mt-0.5">
                {summary.avgHr > 0 ? `${summary.avgHr} bpm` : '—'}
              </div>
            </div>
          </div>

          {/* Prethodno spojeni BLE senzori */}
          {summary.connectedSensorList.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1 mr-1">
                <Bluetooth className="w-3 h-3 text-sky-400" /> {tr('Senzori prije prekida:', 'Sensors before disconnect:')}
              </span>
              {summary.connectedSensorList.map((s) => (
                <span
                  key={s.key}
                  className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800"
                >
                  {localizeSensorLabel(s.label)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Akcije */}
        <div className="flex flex-col gap-2">
          {!summary.isAtEnd && (
            <button
              type="button"
              onClick={onResume}
              className="w-full flex flex-col items-center justify-center py-3 px-4 rounded-xl bg-volt-400 hover:bg-volt-300 text-zinc-950 font-bold transition-all shadow-volt-glow active:scale-[0.99]"
            >
              <span className="flex items-center gap-2 text-sm md:text-base font-display uppercase tracking-wider font-bold">
                <Play className="w-4 h-4 fill-current" />
                {tr('Nastavi gdje si stao', 'Resume where you left off')}
              </span>
              <span className="text-[10px] font-mono font-bold text-zinc-900/75 mt-0.5">
                {tr('Otvara Trenažer u pauzi · prvo spoji senzore, pa ručno pokreni', 'Opens Trainer paused · reconnect sensors first, then start manually')}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onSaveAsFinished}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/35 font-bold text-xs md:text-sm transition-colors"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {tr('Spremi dosadašnje ({time}) kao završen trening', 'Save progress ({time}) as finished workout', {
                time: formatClock(summary.elapsedTime)
              })}
            </span>
          </button>

          {!confirmingDiscard ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleDiscardClick}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{tr('Odbaci sesiju', 'Discard session')}</span>
              </button>

              {onDismissForNow && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDiscard(false);
                    onDismissForNow();
                  }}
                  className="px-3 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 text-xs font-mono font-bold uppercase tracking-wider transition-colors"
                >
                  {tr('Odlučit ću kasnije', 'Decide later')}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 flex flex-col sm:flex-row items-center justify-between gap-2.5 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs text-rose-200 font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  {tr('Trajno obrisati {time} telemetrije?', 'Permanently delete {time} of telemetry?', {
                    time: formatClock(summary.elapsedTime)
                  })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleDiscardClick}
                  className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-colors"
                >
                  {tr('Da, obriši', 'Yes, delete')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-bold transition-colors"
                >
                  {tr('Odustani', 'Cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

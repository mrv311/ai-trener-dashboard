import React, { useMemo, useState } from 'react';
import { Square, Award, CheckCircle2, Download, Route, Gauge, Loader2, AlertCircle, Clock, RefreshCw, Image as ImageIcon } from 'lucide-react';
import WorkoutAIAnalysisPanel from '../ai/WorkoutAIAnalysisPanel';
import RideCardModal from '../RideCardModal';
import { useI18n } from '../../i18n/I18nContext';

const formatDurationClock = (totalSeconds) => {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default function TrainerModals({
  showStopPrompt,
  isFinished,
  confirmStop,
  cancelStop,
  summaryStats,
  workoutFromCalendar,
  isPmConnected,
  saveStatus,
  isIntervalsConfigured,
  intervalsUploadStatus,
  intervalsUploadError,
  onRetryIntervalsUpload,
  handleReset,
  handleExportTcx,
  handleExportFit,
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  onAddWorkoutToCalendar,
  workoutHistory = [],
  workoutRecipe = [],
  controlMode = 'ERG',
  sessionStartTime = null
}) {
  const { tr, tCat } = useI18n();
  const [showRideCard, setShowRideCard] = useState(false);

  const rideCardPayload = useMemo(() => {
    if (!summaryStats) return null;
    const validHrs = Array.isArray(workoutHistory)
      ? workoutHistory.map((p) => Number(p?.hr || 0)).filter((v) => v > 35)
      : [];
    const maxHr = validHrs.length > 0 ? Math.max(...validHrs) : 0;
    const modeLabel =
      controlMode === 'ERG'
        ? isPmConnected
          ? 'ERG MODE · POWER MATCH'
          : 'ERG MODE · SMART FTMS'
        : isPmConnected
          ? '24G VIRTUAL SHIFT · PM'
          : '24G VIRTUAL SHIFT · FTMS';

    return {
      title: workoutFromCalendar ? workoutFromCalendar.title : tr('Slobodna Vožnja', 'Free Ride'),
      category: workoutFromCalendar?.category ? tCat(workoutFromCalendar.category) : '',
      date: sessionStartTime || new Date().toISOString(),
      modeBadge: modeLabel,
      durationSeconds: summaryStats.totalDur || 0,
      avgPower: summaryStats.avgPower || 0,
      np: summaryStats.np || 0,
      ifFactor: summaryStats.ifFactor || 0,
      tss: summaryStats.tss || 0,
      workKj: summaryStats.workKj || 0,
      avgHr: summaryStats.avgHr || 0,
      maxHr,
      avgCadence: summaryStats.avgCadence || 0,
      distanceKm: summaryStats.distanceKm || 0,
      avgSpeedKmh: summaryStats.avgSpeedKmh || 0,
      ef: summaryStats.ef || null,
      decoupling: summaryStats.decoupling ?? null,
      ftp: athleteProfile?.ftp || 200,
      weight: athleteProfile?.weight || null,
      steps: workoutFromCalendar ? workoutRecipe : [],
      stream: workoutHistory
    };
  }, [
    summaryStats,
    workoutHistory,
    workoutRecipe,
    workoutFromCalendar,
    controlMode,
    isPmConnected,
    sessionStartTime,
    athleteProfile,
    tr,
    tCat
  ]);

  return (
    <>
      {/* MODAL: Upozorenje prije prekida */}
      {showStopPrompt && !isFinished && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in zoom-in-95 duration-200">
          <div className="carbon-panel rounded-2xl p-6 md:p-8 short:p-5 max-w-sm w-full shadow-2xl flex flex-col items-center text-center">
            <div className="bg-rose-500/10 border border-rose-500/25 p-3.5 short:p-2.5 rounded-xl mb-4 short:mb-3">
              <Square className="w-8 h-8 text-rose-500 fill-current" />
            </div>
            <h2 className="text-xl md:text-2xl font-display font-bold text-zinc-100 uppercase tracking-wide mb-2">
              {tr('Prekinuti trening?', 'End workout?')}
            </h2>
            <p className="text-zinc-400 mb-6 short:mb-4 text-xs md:text-sm">
              {tr('Želiš li ranije završiti sesiju i spremiti dosadašnju telemetriju?', 'Do you want to end the session early and save your telemetry so far?')}
            </p>
            <div className="flex flex-col gap-2.5 w-full">
              <button onClick={confirmStop} className="w-full py-3 short:py-2.5 bg-rose-500 text-white rounded-xl font-bold hover:bg-rose-600 transition-colors">
                {tr('Da, završi i spremi', 'Yes, finish & save')}
              </button>
              <button onClick={cancelStop} className="w-full py-3 short:py-2.5 bg-zinc-900 text-zinc-300 rounded-xl font-bold hover:bg-zinc-800 transition-colors border border-zinc-800">
                {tr('Ne, nastavi vožnju', 'No, keep riding')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Završetak treninga */}
      {isFinished && summaryStats && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in zoom-in-95 duration-300">
          <div className="carbon-panel rounded-2xl p-5 md:p-7 short:p-4 max-w-2xl w-full shadow-2xl flex flex-col items-center text-center max-h-[94dvh] overflow-y-auto custom-scrollbar">
            <div className="bg-volt-400/10 border border-volt-400/30 p-3 md:p-3.5 rounded-xl mb-3 shrink-0">
              <Award className="w-9 h-9 md:w-12 md:h-12 text-volt-400" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.22em] text-volt-400 shrink-0">
              {tr('SESIJA ZAVRŠENA', 'SESSION COMPLETE')}
            </span>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-zinc-100 uppercase tracking-wide mt-0.5 shrink-0">
              {workoutFromCalendar ? workoutFromCalendar.title : tr('Slobodna Vožnja', 'Free Ride')}
            </h2>
            <div className="h-3 shrink-0" />

            {/* Glavne metrike: Vrijeme, Snaga, Puls, Kadenca */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full mb-2.5 shrink-0">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-mono font-bold uppercase text-volt-400 tracking-widest mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {tr('Vrijeme', 'Time')}
                </p>
                <p className="text-lg md:text-xl font-display font-bold text-zinc-100 telemetry-num">
                  {formatDurationClock(summaryStats.totalDur)}
                </p>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-mono font-bold uppercase text-zinc-400 tracking-widest mb-1">
                  {tr('Avg Snaga', 'Avg Power')}
                </p>
                <p className="text-lg md:text-xl font-display font-bold text-zinc-100 telemetry-num">
                  {summaryStats.avgPower} <span className="text-xs font-mono text-zinc-500">W</span>
                </p>
                {isPmConnected && <p className="text-[8px] font-mono text-violet-400 font-bold mt-0.5">POWERMETER</p>}
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-mono font-bold uppercase text-rose-400 tracking-widest mb-1">
                  {tr('Avg Puls', 'Avg HR')}
                </p>
                <p className="text-lg md:text-xl font-display font-bold text-zinc-100 telemetry-num">
                  {summaryStats.avgHr || '-'} <span className="text-xs font-mono text-zinc-500">bpm</span>
                </p>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-mono font-bold uppercase text-sky-400 tracking-widest mb-1">
                  {tr('Kadenca', 'Cadence')}
                </p>
                <p className="text-lg md:text-xl font-display font-bold text-zinc-100 telemetry-num">
                  {summaryStats.avgCadence || '-'} <span className="text-xs font-mono text-zinc-500">rpm</span>
                </p>
              </div>
            </div>

            {/* Udaljenost i brzina */}
            <div className="grid grid-cols-2 gap-2 w-full mb-2.5 shrink-0">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center justify-between px-4">
                <div className="flex items-center gap-2 text-left">
                  <Route className="w-4 h-4 text-volt-400 shrink-0" />
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 tracking-wider">
                    {tr('Udaljenost', 'Distance')}
                  </span>
                </div>
                <p className="text-lg font-display font-bold text-zinc-100 telemetry-num">{summaryStats.distanceKm || '0.0'} <span className="text-[11px] font-mono text-zinc-500">km</span></p>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center justify-between px-4">
                <div className="flex items-center gap-2 text-left">
                  <Gauge className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 tracking-wider">
                    {tr('Avg Brzina', 'Avg Speed')}
                  </span>
                </div>
                <p className="text-lg font-display font-bold text-zinc-100 telemetry-num">{summaryStats.avgSpeedKmh || '0.0'} <span className="text-[11px] font-mono text-zinc-500">km/h</span></p>
              </div>
            </div>

            {/* Coggan metrike: NP, IF, TSS, Rad, EF, Decoupling */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 w-full mb-4 shrink-0 font-mono telemetry-num">
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">NP</p>
                <p className="text-sm md:text-base font-bold text-zinc-100">{summaryStats.np || 0} <span className="text-[10px] text-zinc-500">W</span></p>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">IF</p>
                <p className="text-sm md:text-base font-bold text-zinc-100">{summaryStats.ifFactor || '0.00'}</p>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">TSS</p>
                <p className="text-sm md:text-base font-bold text-volt-400">{summaryStats.tss || 0}</p>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">{tr('Rad', 'Work')}</p>
                <p className="text-sm md:text-base font-bold text-zinc-100">{summaryStats.workKj || 0} <span className="text-[10px] text-zinc-500">kJ</span></p>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">EF</p>
                <p className="text-sm md:text-base font-bold text-sky-400">{summaryStats.ef || '-'}</p>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col items-center justify-center">
                <p className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-0.5">Pw:HR</p>
                <p className={`text-sm md:text-base font-bold ${
                  summaryStats.decoupling != null
                    ? summaryStats.decoupling <= 5 ? 'text-volt-400' : 'text-amber-400'
                    : 'text-zinc-400'
                }`}>
                  {summaryStats.decoupling != null ? `${summaryStats.decoupling}%` : '-'}
                </p>
              </div>
            </div>

            {/* AI Analiza završenog treninga */}
            <div className="w-full mb-4 shrink-0">
              <WorkoutAIAnalysisPanel
                compact
                activity={{
                  id: `trainer_done_${new Date().toISOString().slice(0, 10)}_${workoutFromCalendar?.title || 'free'}`,
                  title: workoutFromCalendar ? workoutFromCalendar.title : tr('Slobodna Vožnja', 'Free Ride'),
                  date: new Date().toISOString().slice(0, 10),
                  category: workoutFromCalendar?.category || 'Trenažer'
                }}
                metrics={{
                  np: summaryStats.np,
                  avgPower: summaryStats.avgPower,
                  maxPower: summaryStats.maxPower || 0,
                  avgHr: summaryStats.avgHr,
                  avgCadence: summaryStats.avgCadence,
                  durationMin: Math.round((summaryStats.totalDur || 0) / 60),
                  plannedDurationMin: workoutFromCalendar?.duration || 0,
                  tss: summaryStats.tss,
                  plannedTss: workoutFromCalendar?.tss || 0,
                  ef: summaryStats.ef,
                  vi: summaryStats.vi,
                  decoupling: summaryStats.decoupling,
                  efFirst: summaryStats.efFirst,
                  efSecond: summaryStats.efSecond,
                  workKj: summaryStats.workKj,
                  ftp: athleteProfile?.ftp || 270
                }}
                athleteProfile={athleteProfile}
                liveWorkouts={liveWorkouts}
                wellnessData={wellnessData}
                onAddWorkoutToCalendar={onAddWorkoutToCalendar}
              />
            </div>

            {/* Status spremanja i opcionalne sinkronizacije */}
            <div className="flex flex-col gap-2 w-full mb-5 shrink-0">
              {saveStatus && (
                <div className={`flex items-center gap-2 w-full px-4 py-2.5 rounded-xl border text-xs font-bold ${
                  saveStatus === 'saving' ? 'bg-zinc-800/50 border-zinc-700 text-zinc-400' :
                  (saveStatus === 'saved' || saveStatus === 'saved_local') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                  'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                  {saveStatus === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> {tr('Spremanje treninga u ErgVibe...', 'Saving workout to ErgVibe...')}</>}
                  {saveStatus === 'saved' && <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {tr('Spremljeno u ErgVibe kalendar', 'Saved to ErgVibe calendar')}</>}
                  {saveStatus === 'saved_local' && <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {tr('Spremljeno lokalno u ErgVibe', 'Saved locally in ErgVibe')}</>}
                  {saveStatus === 'error' && <><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {tr('Greška pri spremanju — preuzmi .FIT datoteku ispod', 'Save failed — download the .FIT file below')}</>}
                </div>
              )}

              {isIntervalsConfigured && intervalsUploadStatus && (
                <div className={`flex items-center justify-between gap-2 w-full px-4 py-2.5 rounded-xl border text-xs font-bold ${
                  intervalsUploadStatus === 'uploading' ? 'bg-volt-400/10 border-volt-400/25 text-volt-400' :
                  intervalsUploadStatus === 'uploaded' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                  'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                  <div className="flex items-center gap-2 text-left min-w-0">
                    {intervalsUploadStatus === 'uploading' && <><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span>{tr('Slanje .FIT datoteke na Intervals.icu...', 'Uploading .FIT file to Intervals.icu...')}</span></>}
                    {intervalsUploadStatus === 'uploaded' && <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> <span>{tr('Poslano na Intervals.icu', 'Uploaded to Intervals.icu')}</span></>}
                    {intervalsUploadStatus === 'error' && (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate" title={intervalsUploadError || ''}>
                          {tr('Intervals.icu prijenos nije uspio', 'Intervals.icu upload failed')}
                        </span>
                      </>
                    )}
                  </div>
                  {intervalsUploadStatus === 'error' && onRetryIntervalsUpload && (
                    <button
                      onClick={onRetryIntervalsUpload}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[11px] font-black shrink-0 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> {tr('Ponovi', 'Retry')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Izvoz datoteka (.FIT primarni, Strava Ride Card, .TCX) */}
            <div className="flex flex-col sm:flex-row gap-2.5 w-full shrink-0">
              <button
                onClick={handleExportFit}
                className="flex-[2] flex flex-col items-center justify-center py-3 px-4 rounded-xl font-bold transition-all bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow"
              >
                <span className="flex items-center gap-2 text-sm md:text-base font-display uppercase tracking-wide font-bold">
                  <Download className="w-4 h-4 md:w-5 md:h-5" />
                  {tr('Preuzmi .FIT datoteku', 'Download .FIT File')}
                </span>
                <span className="text-[10px] font-mono font-bold text-zinc-900/80 mt-0.5">
                  GARMIN CONNECT · STRAVA · WAHOO
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowRideCard(true)}
                className="flex-1 flex flex-col items-center justify-center py-3 px-3.5 rounded-xl font-bold transition-all bg-zinc-950 text-volt-400 hover:bg-zinc-900 border border-volt-400/35 hover:border-volt-400"
              >
                <span className="flex items-center gap-1.5 text-xs md:text-sm font-display uppercase tracking-wide font-bold">
                  <ImageIcon className="w-4 h-4 shrink-0" />
                  {tr('Strava Kartica', 'Ride Card')}
                </span>
                <span className="text-[9px] font-mono text-zinc-400 mt-0.5">
                  1200×900 PNG
                </span>
              </button>

              <button
                onClick={handleExportTcx}
                className="sm:w-auto flex items-center justify-center gap-1.5 py-3 px-3.5 rounded-xl font-bold transition-all text-xs bg-zinc-950 text-zinc-300 hover:bg-zinc-900 border border-zinc-800"
                title={tr('Preuzmi .TCX datoteku', 'Download .TCX file')}
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                .TCX
              </button>
            </div>

            <button onClick={handleReset} className="mt-5 text-zinc-400 font-mono font-bold uppercase tracking-wider hover:text-volt-400 text-xs transition-colors">
              {tr('Zatvori i vrati se', 'Close & Return')}
            </button>
          </div>
        </div>
      )}

      <RideCardModal
        isOpen={showRideCard}
        onClose={() => setShowRideCard(false)}
        payload={rideCardPayload}
      />
    </>
  );
}


import React from 'react';
import { Square, Award, UploadCloud, CheckCircle2 } from 'lucide-react';

export default function TrainerModals({
  showStopPrompt,
  isFinished,
  confirmStop,
  cancelStop,
  summaryStats,
  workoutFromCalendar,
  isPmConnected,
  uploadStatus,
  setUploadStatus,
  handleReset
}) {
  return (
    <>
      {/* MODAL: Upozorenje prije prekida */}
      {showStopPrompt && !isFinished && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm rounded-[32px] flex items-center justify-center p-4 md:p-6 animate-in zoom-in-95 duration-200">
          <div className="bg-zinc-900 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center border border-zinc-800">
            <div className="bg-rose-500/10 border border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.1)] p-4 rounded-full mb-4">
              <Square className="w-8 h-8 md:w-10 md:h-10 text-rose-500 fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
            </div>
            <h2 className="text-xl md:text-2xl font-black text-zinc-100 uppercase tracking-tight mb-2">Prekinuti trening?</h2>
            <p className="text-zinc-400 font-medium mb-6 md:mb-8 text-xs md:text-sm">Želiš li ranije završiti trening i spremiti dosadašnje rezultate?</p>
            <div className="flex flex-col gap-3 w-full">
              <button onClick={confirmStop} className="w-full py-3.5 bg-rose-500 text-white rounded-xl font-black hover:bg-rose-600 transition-colors shadow-lg shadow-rose-500/20">Da, završi trening</button>
              <button onClick={cancelStop} className="w-full py-3.5 bg-zinc-800 text-zinc-300 rounded-xl font-black hover:bg-zinc-700 transition-colors border border-zinc-700">Ne, nastavi s vožnjom</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Završetak treninga */}
      {isFinished && summaryStats && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm rounded-[32px] flex items-center justify-center p-4 md:p-6 animate-in zoom-in-95 duration-300">
          <div className="bg-zinc-900 rounded-3xl p-6 md:p-10 max-w-lg w-full shadow-2xl flex flex-col items-center text-center border border-zinc-800 max-h-full overflow-y-auto">
            <div className="bg-orange-500/10 border border-orange-500/20 shadow-[inset_0_0_15px_rgba(249,115,22,0.1)] p-3 md:p-4 rounded-full mb-4 md:mb-6 shrink-0">
              <Award className="w-10 h-10 md:w-16 md:h-16 text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.6)]" />
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-zinc-100 uppercase tracking-tight shrink-0">Trening Završen!</h2>
            <p className="text-zinc-500 font-bold mt-1 md:mt-2 mb-6 md:mb-8 text-sm md:text-base shrink-0">{workoutFromCalendar ? workoutFromCalendar.title : 'Slobodna Vožnja'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 w-full mb-6 md:mb-10 shrink-0">
              <div className="bg-zinc-950/50 p-3 md:p-4 rounded-2xl border border-zinc-800 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                <p className="text-[10px] sm:text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-0 sm:mb-1">Avg Power</p>
                <div>
                  <p className="text-xl md:text-2xl font-black text-zinc-100">{summaryStats.avgPower} <span className="text-xs md:text-sm font-bold text-zinc-500">W</span></p>
                  {isPmConnected && <p className="text-[9px] text-violet-400 font-bold mt-0.5 sm:mt-1 drop-shadow-[0_0_2px_rgba(167,139,250,0.5)]">PowerMeter</p>}
                </div>
              </div>
              <div className="bg-zinc-950/50 p-3 md:p-4 rounded-2xl border border-zinc-800 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                <p className="text-[10px] sm:text-[10px] font-black uppercase text-rose-500 tracking-widest mb-0 sm:mb-1">Avg HR</p>
                <p className="text-xl md:text-2xl font-black text-zinc-100">{summaryStats.avgHr} <span className="text-xs md:text-sm font-bold text-zinc-500">bpm</span></p>
              </div>
              <div className="bg-zinc-950/50 p-3 md:p-4 rounded-2xl border border-zinc-800 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                <p className="text-[10px] sm:text-[10px] font-black uppercase text-orange-500 tracking-widest mb-0 sm:mb-1">Cadence</p>
                <p className="text-xl md:text-2xl font-black text-zinc-100">{summaryStats.avgCadence} <span className="text-xs md:text-sm font-bold text-zinc-500">rpm</span></p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 md:gap-3 w-full shrink-0">
              <button onClick={() => setUploadStatus('intervals')} className={`flex items-center justify-center gap-2 md:gap-3 w-full py-3 md:py-4 rounded-xl font-black transition-all text-sm md:text-base ${uploadStatus === 'intervals' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700'}`}>
                {uploadStatus === 'intervals' ? <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5" /> : <UploadCloud className="w-4 h-4 md:w-5 md:h-5" />}
                {uploadStatus === 'intervals' ? 'Poslano!' : 'Upload (Intervals)'}
              </button>
              <button onClick={() => setUploadStatus('strava')} className={`flex items-center justify-center gap-2 md:gap-3 w-full py-3 md:py-4 rounded-xl font-black transition-all text-sm md:text-base ${uploadStatus === 'strava' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-[#fc4c02] text-white hover:bg-[#e34402] shadow-[0_0_15px_rgba(252,76,2,0.3)]'}`}>
                {uploadStatus === 'strava' ? <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5" /> : <UploadCloud className="w-4 h-4 md:w-5 md:h-5" />}
                {uploadStatus === 'strava' ? 'Poslano!' : 'Upload (Strava)'}
              </button>
            </div>
            <button onClick={handleReset} className="mt-8 text-zinc-500 font-bold hover:text-zinc-300 text-sm transition-colors">
              Zatvori i resetiraj
            </button>
          </div>
        </div>
      )}
    </>
  );
}

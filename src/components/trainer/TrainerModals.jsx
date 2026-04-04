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
        <div className="absolute inset-0 z-50 bg-stone-900/60 backdrop-blur-md rounded-[32px] flex items-center justify-center p-6 animate-in zoom-in-95 duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center border border-stone-200">
            <div className="bg-rose-100 p-4 rounded-full mb-4">
              <Square className="w-10 h-10 text-rose-500 fill-current" />
            </div>
            <h2 className="text-2xl font-black text-stone-800 uppercase tracking-tight mb-2">Prekinuti trening?</h2>
            <p className="text-stone-500 font-medium mb-8 text-sm">Želiš li ranije završiti trening i spremiti dosadašnje rezultate?</p>
            <div className="flex flex-col gap-3 w-full">
              <button onClick={confirmStop} className="w-full py-3.5 bg-rose-500 text-white rounded-xl font-black hover:bg-rose-600 transition-colors shadow-lg shadow-rose-500/20">Da, završi trening</button>
              <button onClick={cancelStop} className="w-full py-3.5 bg-stone-100 text-stone-600 rounded-xl font-black hover:bg-stone-200 transition-colors">Ne, nastavi s vožnjom</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Završetak treninga */}
      {isFinished && summaryStats && (
        <div className="absolute inset-0 z-50 bg-stone-900/60 backdrop-blur-md rounded-[32px] flex items-center justify-center p-6 animate-in zoom-in-95 duration-300">
          <div className="bg-white rounded-3xl p-10 max-w-lg w-full shadow-2xl flex flex-col items-center text-center border border-stone-200">
            <div className="bg-orange-100 p-4 rounded-full mb-6">
              <Award className="w-16 h-16 text-orange-500" />
            </div>
            <h2 className="text-3xl font-black text-stone-800 uppercase tracking-tight">Trening Završen!</h2>
            <p className="text-stone-500 font-bold mt-2 mb-8">{workoutFromCalendar ? workoutFromCalendar.title : 'Slobodna Vožnja'}</p>
            <div className="grid grid-cols-3 gap-4 w-full mb-10">
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest mb-1">Avg Power</p>
                <p className="text-2xl font-black text-stone-800">{summaryStats.avgPower} <span className="text-sm font-bold text-stone-400">W</span></p>
                {isPmConnected && <p className="text-[9px] text-violet-500 font-bold mt-1">PowerMeter</p>}
              </div>
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <p className="text-[10px] font-black uppercase text-rose-400 tracking-widest mb-1">Avg HR</p>
                <p className="text-2xl font-black text-stone-800">{summaryStats.avgHr} <span className="text-sm font-bold text-stone-400">bpm</span></p>
              </div>
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <p className="text-[10px] font-black uppercase text-orange-400 tracking-widest mb-1">Avg Cadence</p>
                <p className="text-2xl font-black text-stone-800">{summaryStats.avgCadence} <span className="text-sm font-bold text-stone-400">rpm</span></p>
              </div>
            </div>
            <div className="flex flex-col gap-3 w-full">
              <button onClick={() => setUploadStatus('intervals')} className={`flex items-center justify-center gap-3 w-full py-4 rounded-xl font-black transition-all ${uploadStatus === 'intervals' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-stone-800 text-white hover:bg-stone-700'}`}>
                {uploadStatus === 'intervals' ? <CheckCircle2 className="w-5 h-5" /> : <UploadCloud className="w-5 h-5" />}
                {uploadStatus === 'intervals' ? 'Poslano na Intervals.icu!' : 'Upload na Intervals.icu'}
              </button>
              <button onClick={() => setUploadStatus('strava')} className={`flex items-center justify-center gap-3 w-full py-4 rounded-xl font-black transition-all ${uploadStatus === 'strava' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[#fc4c02] text-white hover:bg-[#e34402] shadow-lg shadow-orange-500/20'}`}>
                {uploadStatus === 'strava' ? <CheckCircle2 className="w-5 h-5" /> : <UploadCloud className="w-5 h-5" />}
                {uploadStatus === 'strava' ? 'Poslano na Stravu!' : 'Upload na Stravu'}
              </button>
            </div>
            <button onClick={handleReset} className="mt-8 text-stone-400 font-bold hover:text-stone-600 text-sm">
              Zatvori i resetiraj
            </button>
          </div>
        </div>
      )}
    </>
  );
}

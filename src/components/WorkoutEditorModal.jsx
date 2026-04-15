import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Clock, Activity } from 'lucide-react';

export const parseWorkoutCode = (code) => {
  if (!code) return { duration: 0, tss: 0 };
  let totalDurMins = 0;
  let totalTss = 0;

  const lines = code.split('\n');
  lines.forEach(line => {
    let mins = 0;
    
    // Tražimo vrijeme: x h, x m, ili kombinacije
    const hMatch = line.match(/(\d+)\s*h/i);
    const mMatch = line.match(/(\d+)\s*m/i);
    const sMatch = line.match(/(\d+)\s*s/i);

    if (hMatch) mins += parseInt(hMatch[1]) * 60;
    if (mMatch) mins += parseInt(mMatch[1]);
    if (sMatch) mins += parseInt(sMatch[1]) / 60;

    // Ako nismo našli s h/m/s ekstenzijama, probajmo parsati kao čisti broj na početku ako ima smisla, ali preskočit ćemo za sada radi sigurnosti.
    
    let perc = 0;
    const pMatch = line.match(/(\d+)%\s*FTP/i) || line.match(/(\d+)%/i);
    if (pMatch) perc = parseInt(pMatch[1]);

    // Aproksimacija: ako imamo i petlju (npr 4x) jednostavnim regexom možemo probati pomnožiti (opcionalno, za budućnost)
    let multiplier = 1;
    const xMatch = line.match(/(\d+)x/i);
    if (xMatch && !pMatch && mins === 0) {
      // Ovo je samo "4x" linija, nećemo obrađivati u ovom jednostavnom aproksimatoru
    } else if (xMatch) {
       multiplier = parseInt(xMatch[1]);
    }

    if (mins > 0 && perc > 0) {
      const lineTss = (mins / 60) * Math.pow(perc / 100, 2) * 100;
      totalDurMins += (mins * multiplier);
      totalTss += (lineTss * multiplier);
    } else if (mins > 0) {
      // Nema FTP%, vjerojatno odmor (Z1)
      const lineTss = (mins / 60) * Math.pow(0.5, 2) * 100; // aproksimacija 50%
      totalDurMins += (mins * multiplier);
      totalTss += (lineTss * multiplier);
    }
  });

  return { duration: Math.round(totalDurMins), tss: Math.round(totalTss) };
};

export default function WorkoutEditorModal({ workout, isOpen, onClose, onSave, isLoading }) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (workout && isOpen) {
      setTitle(workout.title || '');
      setCode(workout.workout_doc || workout.steps || '');
    }
  }, [workout, isOpen]);

  const stats = useMemo(() => parseWorkoutCode(code), [code]);

  if (!isOpen || !workout) return null;

  const handleSave = () => {
    onSave(workout.id, title, code, stats.tss, stats.duration);
  };

  const formatDur = (mins) => {
    const h = Math.floor(mins / 60);
    return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-950/50">
          <h2 className="text-lg font-bold text-zinc-100 placeholder-zinc-500 flex-1">
            <input 
              type="text" 
              value={title} 
              onChange={e => setTitle(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-zinc-100 focus:ring-0 p-0"
              placeholder="Naziv treninga..."
            />
          </h2>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-full transition-colors ml-4">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Workout Code (Intervals.icu syntax)</label>
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 font-mono focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-none transition-all custom-scrollbar placeholder-zinc-700"
              placeholder="- 10m 60% FTP\n- 5m 110% FTP\n- 10m 50% FTP"
              spellCheck={false}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-3 flex flex-col items-center justify-center">
              <div className="flex items-center text-orange-500 gap-1.5 mb-1">
                <Clock className="w-4 h-4 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]" />
                <span className="text-[10px] font-black uppercase tracking-widest">Trajanje</span>
              </div>
              <span className="text-xl font-bold text-zinc-100">{formatDur(stats.duration)}</span>
            </div>
            
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-3 flex flex-col items-center justify-center">
               <div className="flex items-center text-orange-500 gap-1.5 mb-1">
                <Activity className="w-4 h-4 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]" />
                <span className="text-[10px] font-black uppercase tracking-widest">TSS (Procjena)</span>
              </div>
              <span className="text-xl font-bold text-zinc-100">{stats.tss > 0 ? stats.tss : '-'}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Odustani
          </button>
          <button 
            onClick={handleSave}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-400 text-zinc-950 rounded-xl text-sm font-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(249,115,22,0.3)]"
          >
             {isLoading ? <span className="animate-spin text-xl leading-none w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full" /> : <Save className="w-4 h-4" />}
             Spremi
          </button>
        </div>
      </div>
    </div>
  );
}

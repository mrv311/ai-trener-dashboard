import React from 'react';
import { ChevronLeft, ChevronRight, Clock, Activity, CheckCircle2, XCircle, Target, Unlink, Link2, Heart, Moon, Play, Trash2 } from 'lucide-react';

const formatDur = (mins) => {
  const h = Math.floor(mins / 60);
  return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`;
};

const getCardBg = (sc) => {
  if (sc === 'green') return "bg-emerald-950/30 border-emerald-500/20 border shadow-[0_4px_10px_rgba(16,185,129,0.05)]"; 
  if (sc === 'yellow') return "bg-amber-950/30 border-amber-500/20 border shadow-[0_4px_10px_rgba(245,158,11,0.05)]";
  if (sc === 'red') return "bg-rose-950/30 border-rose-500/20 border shadow-[0_4px_10px_rgba(244,63,94,0.05)]"; 
  if (sc === 'red-missed') return "bg-rose-950/10 border-rose-500/20 border-dashed border opacity-80";
  if (sc === 'blue') return "bg-sky-950/30 border-sky-500/20 border shadow-[0_4px_10px_rgba(14,165,233,0.05)]"; 
  if (sc === 'grey') return "bg-zinc-800/40 border-zinc-700 border-dashed border";
  return "bg-zinc-900/50 border-zinc-800 border";
};

const getTopCol = (sc) => {
  if (sc === 'green') return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"; 
  if (sc === 'yellow') return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"; 
  if (sc === 'red') return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
  if (sc === 'red-missed') return "bg-rose-500/50"; 
  if (sc === 'blue') return "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]"; 
  if (sc === 'grey') return "bg-zinc-600"; 
  return "bg-zinc-700";
};

export default function CalendarTab({ currentDate, setCurrentDate, workouts, wellnessData, handleUnpair, handlePair, handleDeleteLocalActivity, onSelectWorkout }) {
  const cy = currentDate.getFullYear(); 
  const cm = currentDate.getMonth();
  const daysInMo = new Date(cy, cm + 1, 0).getDate();
  const startOff = new Date(cy, cm, 1).getDay() === 0 ? 6 : new Date(cy, cm, 1).getDay() - 1; 
  
  const calDays = []; 
  const daysPrev = new Date(cy, cm, 0).getDate();
  
  for (let i = startOff - 1; i >= 0; i--) {
    calDays.push({ day: daysPrev - i, dateStr: `${cy}-${String(cm).padStart(2, '0')}-${String(daysPrev - i).padStart(2, '0')}`, isCurrentMonth: false });
  }
  for (let i = 1; i <= daysInMo; i++) {
    calDays.push({ day: i, dateStr: `${cy}-${String(cm + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`, isCurrentMonth: true });
  }
  let nx = 1; 
  while (calDays.length % 7 !== 0) { 
    calDays.push({ day: nx, dateStr: `${cy}-${String(cm + 2).padStart(2, '0')}-${String(nx).padStart(2, '0')}`, isCurrentMonth: false }); 
    nx++; 
  }
  
  const weeks = []; 
  for (let i = 0; i < calDays.length; i += 7) weeks.push(calDays.slice(i, i + 7));
  
  const monthNames = ["Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj", "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac"];
  const dayNames = ["PON", "UTO", "SRI", "ČET", "PET", "SUB", "NED"];
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-[1600px] mx-auto bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-800/80 flex flex-col min-h-[700px] animate-in fade-in overflow-hidden">
      
        {/* ZAGLAVLJE KALENDARA */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/80 bg-zinc-950/50">
        <span className="px-4 font-bold text-lg text-zinc-100 drop-shadow-sm">{monthNames[cm]} {cy}</span>
        <div className="flex bg-zinc-900/80 rounded-lg p-1 border border-zinc-800 gap-1">
          <button onClick={() => setCurrentDate(new Date(cy, cm - 1, 1))} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCurrentDate(new Date())} className="px-4 py-1.5 hover:bg-zinc-800 rounded-md text-[11px] font-bold text-zinc-300 uppercase transition-colors">Danas</button>
          <button onClick={() => setCurrentDate(new Date(cy, cm + 1, 1))} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* DANI U TJEDNU (Desktop) */}
      <div className="hidden md:grid grid-cols-8 border-b border-zinc-800/80 bg-zinc-900/80 font-bold text-[10px] text-zinc-500 uppercase tracking-widest">
        {dayNames.map((d, i) => <div key={i} className="py-3 px-3 border-r border-zinc-800/80">{d}</div>)}
        <div className="py-3 text-center bg-orange-500/10 text-orange-400 border-l border-zinc-800 shadow-[inset_0_0_10px_rgba(249,115,22,0.05)]">Sažetak</div>
      </div>

      {/* VERTIKALNA LISTA DANA (Mobile) */}
      <div className="flex md:hidden flex-col bg-zinc-950 gap-[1px] flex-1 overflow-y-auto">
        {calDays.filter(d => d.isCurrentMonth).map((dObj) => {
          const dStr = dObj.dateStr; 
          const dWorks = workouts.filter(w => w.date === dStr);
          const isTdy = dStr === todayStr; 
          const dWell = wellnessData[dStr];
          const dayOfWeek = dayNames[(new Date(dStr).getDay() + 6) % 7];

          return (
            <div key={dStr} className={`p-4 flex flex-col bg-zinc-900/60 ${isTdy ? 'border-l-4 border-l-orange-500 shadow-[inset_4px_0_10px_rgba(249,115,22,0.1)]' : ''}`}>
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-black ${isTdy ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]' : 'text-zinc-200'}`}>{dObj.day}.</span>
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{dayOfWeek}</span>
                </div>
                {dWell && (
                  <div className="flex gap-3 text-xs font-bold text-zinc-400 bg-zinc-950/50 px-3 py-1 rounded-full border border-zinc-800 shadow-inner">
                    {dWell.restingHR && <span className="flex items-center text-rose-500 drop-shadow-[0_0_4px_rgba(244,63,94,0.5)]"><Heart className="w-3.5 h-3.5 mr-1" fill="currentColor" />{dWell.restingHR}</span>}
                    {dWell.sleep && <span className="flex items-center text-indigo-400 drop-shadow-[0_0_4px_rgba(129,140,248,0.5)]"><Moon className="w-3.5 h-3.5 mr-1" fill="currentColor" />{dWell.sleep}</span>}
                  </div>
                )}
              </div>
              
              <div className="flex flex-col gap-2">
                {dWorks.length > 0 ? dWorks.map(w => (
                  <div key={w.id} className={`rounded-xl flex flex-col overflow-hidden ${getCardBg(w.statusColor)}`}>
                    <div className={`h-1.5 w-full shrink-0 ${getTopCol(w.statusColor)}`} />
                    <div className="p-3.5 flex flex-col gap-2">
                      <div className="font-bold text-sm flex items-start justify-between text-zinc-100 leading-tight">
                        <span className="pr-2">{w.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!w.isCompleted && onSelectWorkout && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); onSelectWorkout(w); }} 
                              className="text-orange-400 bg-orange-500/10 hover:bg-orange-500 hover:text-white rounded-lg p-1.5 transition-all shadow-[0_0_8px_rgba(249,115,22,0.2)] hover:shadow-[0_0_12px_rgba(249,115,22,0.6)] border border-orange-500/20" 
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          )}
                          {w.statusColor === 'green' && <CheckCircle2 className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" />}
                          {w.statusColor === 'red-missed' && <XCircle className="w-4 h-4 text-rose-500" />}
                          {w.isLocal && !w.isCompleted && handleDeleteLocalActivity && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteLocalActivity(w.id); }} 
                              className="text-zinc-500 hover:text-red-500 rounded-lg p-1 transition-colors" 
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-xs text-zinc-400 font-medium bg-zinc-950/40 px-2 py-1.5 rounded-lg border border-zinc-800 border-dashed">
                        <span>{formatDur(w.duration)} {w.plannedDuration && <span className="text-zinc-600 text-[10px] ml-1">/ {formatDur(w.plannedDuration)}</span>}</span>
                        <span className="font-mono text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded shadow-sm border border-zinc-700">{w.tss > 0 ? w.tss : '-'} TSS</span>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="text-xs text-zinc-600 italic px-2 py-2 bg-zinc-900/40 rounded-lg border border-zinc-800 border-dashed mr-auto">Odmor</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MREŽA TJEDANA I DANA (Desktop) */}
      <div className="hidden md:flex flex-1 flex-col bg-zinc-800 border-l border-zinc-800 gap-[1px]">
        {weeks.map((wk, wi) => {
          let aT=0; let pT=0; let aD=0; let pD=0;
          return (
            <div key={wi} className="grid grid-cols-8 gap-[1px] flex-1 min-h-[180px]">
              {wk.map((dObj) => {
                const dStr = dObj.dateStr; 
                const dWorks = workouts.filter(w => w.date === dStr);
                const isTdy = dStr === todayStr; 
                const dWell = wellnessData[dStr];
                
                dWorks.forEach(w => { 
                  if (w.isCompleted) { 
                    aT += w.tss; aD += w.duration; 
                    if(w.plannedTss) pT += w.plannedTss; 
                    if(w.plannedDuration) pD += w.plannedDuration; 
                  } else { 
                    pT += w.tss; pD += w.duration; 
                  } 
                });

                return (
                  <div key={dStr} className={`p-3 flex flex-col group relative transition-all duration-300 ${dObj.isCurrentMonth ? 'bg-zinc-900/60 hover:bg-zinc-800/80' : 'bg-zinc-950/80'} ${isTdy ? 'ring-inset ring-2 ring-orange-500' : ''}`}>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-xs font-bold ${isTdy ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]' : (dObj.isCurrentMonth ? 'text-zinc-400' : 'text-zinc-600')}`}>{dObj.day}</span>
                      {dWell && (
                        <div className="flex gap-2 text-[10px] font-bold text-zinc-500">
                          {dWell.restingHR && <span className="flex items-center text-rose-500/80"><Heart className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.restingHR}</span>}
                          {dWell.sleep && <span className="flex items-center text-indigo-400/80"><Moon className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.sleep}</span>}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                      {dWorks.map(w => (
                        <div key={w.id} className={`rounded-xl flex flex-col overflow-hidden min-h-[86px] backdrop-blur-sm ${getCardBg(w.statusColor)} ${!dObj.isCurrentMonth && 'opacity-60 saturate-50'}`}>
                          <div className={`h-1.5 w-full shrink-0 ${getTopCol(w.statusColor)}`} />
                          <div className="p-2.5 flex flex-col justify-between flex-1 gap-2.5">
                            <div className="font-bold text-xs flex items-start justify-between text-zinc-200 leading-tight">
                              <span className="line-clamp-2 pr-1">{w.title}</span>
                              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                                
                                {!w.isCompleted && onSelectWorkout && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onSelectWorkout(w); }} 
                                    className="text-orange-400 hover:text-white bg-orange-500/10 hover:bg-orange-500 rounded-md p-1 transition-all border border-orange-500/20" 
                                    title="Pošalji na trenažer"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                )}

                                {w.actId && w.eventId && <button onClick={() => handleUnpair(w.actId, w.eventId)} className="text-zinc-500 hover:text-orange-400 transition-colors" title="Razdvoji planirano i odrađeno"><Unlink className="w-3.5 h-3.5" /></button>}
                                {w.actId && w.separatedEventId && <button onClick={() => handlePair(w.actId, w.separatedEventId)} className="text-zinc-500 hover:text-emerald-400 transition-colors" title="Spoji s planiranim treningom"><Link2 className="w-3.5 h-3.5" /></button>}
                                {w.statusColor === 'green' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_3px_rgba(16,185,129,0.5)]" />}
                                {w.statusColor === 'red-missed' && <XCircle className="w-3.5 h-3.5 text-rose-500" />}
                                {w.statusColor === 'grey' && !w.isLocal && <Target className="w-3.5 h-3.5 text-zinc-500" />}
                                {w.isLocal && !w.isCompleted && handleDeleteLocalActivity && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteLocalActivity(w.id); }} 
                                    className="text-zinc-600 hover:text-red-500 rounded p-0.5 transition-colors" 
                                    title="Obriši planirani trening"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between items-end text-xs text-zinc-400 font-medium">
                              <span title={w.plannedDuration ? `Plan: ${formatDur(w.plannedDuration)}` : ''}>{formatDur(w.duration)}</span>
                              <span className="font-mono text-zinc-400 bg-zinc-950/50 px-1 py-0.5 rounded border border-zinc-700/50" title={w.plannedTss ? `Plan: ${w.plannedTss} TSS` : ''}>{w.tss > 0 ? w.tss : '-'} TSS</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              
              {/* SAŽETAK TJEDNA */}
              <div className="bg-gradient-to-b from-orange-500/5 to-transparent p-4 flex flex-col justify-end items-end border-l border-zinc-800 bg-zinc-900/40 text-right space-y-3">
                <div className="w-full">
                  <p className="text-[9px] font-black text-orange-500 uppercase tracking-tighter mb-1">Ukupno Vrijeme</p>
                  <div className="flex items-center justify-end gap-1.5 text-xs"><Clock className="w-3.5 h-3.5 text-orange-500 drop-shadow-[0_0_4px_rgba(249,115,22,0.5)]" /><span className="font-bold text-zinc-100">{formatDur(aD)}</span><span className="text-zinc-700">/</span><span className="text-zinc-400 font-medium">{formatDur(pD)}</span></div>
                </div>
                <div className="pt-2 border-t border-zinc-800 w-full">
                  <p className="text-[9px] font-black text-orange-500 uppercase tracking-tighter mb-1">Ukupno TSS</p>
                  <div className="flex items-center justify-end gap-1.5 text-xs"><Activity className="w-3.5 h-3.5 text-orange-500 drop-shadow-[0_0_4px_rgba(249,115,22,0.5)]" /><span className="font-bold text-zinc-100">{aT}</span><span className="text-zinc-700">/</span><span className="text-zinc-400 font-medium">{pT}</span></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
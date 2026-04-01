import React from 'react';
import { ChevronLeft, ChevronRight, Clock, Activity, CheckCircle2, XCircle, Target, Unlink, Link2, Heart, Moon, Play } from 'lucide-react';

const formatDur = (mins) => {
  const h = Math.floor(mins / 60);
  return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`;
};

const getCardBg = (sc) => {
  if (sc === 'green') return "bg-emerald-50 border-emerald-200 border shadow-sm"; 
  if (sc === 'yellow') return "bg-amber-50 border-amber-200 border shadow-sm";
  if (sc === 'red') return "bg-rose-50 border-rose-200 border shadow-sm"; 
  if (sc === 'red-missed') return "bg-rose-50 border-rose-200 border-dashed border opacity-80";
  if (sc === 'blue') return "bg-sky-50 border-sky-200 border shadow-sm"; 
  if (sc === 'grey') return "bg-stone-50 border-stone-200 border-dashed border";
  return "bg-white border-stone-200 border";
};

const getTopCol = (sc) => {
  if (sc === 'green') return "bg-emerald-500"; 
  if (sc === 'yellow') return "bg-amber-400"; 
  if (sc === 'red') return "bg-rose-500";
  if (sc === 'red-missed') return "bg-rose-400"; 
  if (sc === 'blue') return "bg-sky-500"; 
  if (sc === 'grey') return "bg-stone-300"; 
  return "bg-stone-200";
};

// DODANO: onSelectWorkout u prope komponente
export default function CalendarTab({ currentDate, setCurrentDate, workouts, wellnessData, handleUnpair, handlePair, onSelectWorkout }) {
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
    <div className="max-w-[1600px] mx-auto bg-white rounded-xl shadow-sm border border-stone-200 flex flex-col min-h-[700px] animate-in fade-in">
      
      {/* ZAGLAVLJE KALENDARA */}
      <div className="flex items-center justify-between p-4 border-b border-stone-200 bg-white">
        <span className="px-4 font-bold text-lg text-stone-700">{monthNames[cm]} {cy}</span>
        <div className="flex bg-stone-50 rounded-lg p-1 border border-stone-200 gap-1">
          <button onClick={() => setCurrentDate(new Date(cy, cm - 1, 1))} className="p-1.5 hover:bg-white rounded-md text-stone-600 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCurrentDate(new Date())} className="px-4 py-1.5 hover:bg-white rounded-md text-[11px] font-bold text-stone-700 uppercase transition-colors">Danas</button>
          <button onClick={() => setCurrentDate(new Date(cy, cm + 1, 1))} className="p-1.5 hover:bg-white rounded-md text-stone-600 transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* DANI U TJEDNU */}
      <div className="grid grid-cols-8 border-b border-stone-200 bg-stone-50/80 font-bold text-[10px] text-stone-500 uppercase tracking-widest">
        {dayNames.map((d, i) => <div key={i} className="py-3 px-3 border-r border-stone-200">{d}</div>)}
        <div className="py-3 text-center bg-orange-50/80 text-orange-700 border-l border-orange-100">Sažetak</div>
      </div>

      {/* MREŽA TJEDANA I DANA */}
      <div className="flex-1 flex flex-col bg-stone-200 gap-[1px]">
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
                  <div key={dStr} className={`p-3 flex flex-col group relative transition-colors ${dObj.isCurrentMonth ? 'bg-white hover:bg-stone-50' : 'bg-stone-100/60'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-xs font-bold ${isTdy ? 'text-orange-600' : (dObj.isCurrentMonth ? 'text-stone-600' : 'text-stone-400')}`}>{dObj.day}</span>
                      {dWell && (
                        <div className="flex gap-2 text-[10px] font-bold text-stone-400">
                          {dWell.restingHR && <span className="flex items-center text-rose-500"><Heart className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.restingHR}</span>}
                          {dWell.sleep && <span className="flex items-center text-indigo-400"><Moon className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.sleep}</span>}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                      {dWorks.map(w => (
                        <div key={w.id} className={`rounded-md flex flex-col overflow-hidden min-h-[86px] ${getCardBg(w.statusColor)} ${!dObj.isCurrentMonth && 'opacity-80'}`}>
                          <div className={`h-2.5 w-full shrink-0 ${getTopCol(w.statusColor)}`} />
                          <div className="p-2.5 flex flex-col justify-between flex-1 gap-2.5">
                            <div className="font-bold text-xs flex items-start justify-between text-stone-800 leading-tight">
                              <span className="line-clamp-2 pr-1">{w.title}</span>
                              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                                
                                {/* NOVO: Gumb PLAY za slanje na trenažer (samo za planirane treninge) */}
                                {!w.isCompleted && onSelectWorkout && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onSelectWorkout(w); }} 
                                    className="text-orange-500 hover:text-white bg-orange-100 hover:bg-orange-500 rounded-md p-1 transition-all" 
                                    title="Pošalji na trenažer"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                )}

                                {w.actId && w.eventId && <button onClick={() => handleUnpair(w.actId, w.eventId)} className="text-stone-400 hover:text-orange-600 transition-colors" title="Razdvoji planirano i odrađeno"><Unlink className="w-3.5 h-3.5" /></button>}
                                {w.actId && w.separatedEventId && <button onClick={() => handlePair(w.actId, w.separatedEventId)} className="text-stone-400 hover:text-emerald-600 transition-colors" title="Spoji s planiranim treningom"><Link2 className="w-3.5 h-3.5" /></button>}
                                {w.statusColor === 'green' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                                {w.statusColor === 'red-missed' && <XCircle className="w-3.5 h-3.5 text-rose-500" />}
                                {w.statusColor === 'grey' && <Target className="w-3.5 h-3.5 text-stone-500" />}
                              </div>
                            </div>
                            <div className="flex justify-between items-end text-xs text-stone-600 font-medium">
                              <span title={w.plannedDuration ? `Plan: ${formatDur(w.plannedDuration)}` : ''}>{formatDur(w.duration)}</span>
                              <span className="font-mono text-stone-700" title={w.plannedTss ? `Plan: ${w.plannedTss} TSS` : ''}>{w.tss > 0 ? w.tss : '-'} TSS</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              
              {/* SAŽETAK TJEDNA */}
              <div className="bg-gradient-to-b from-orange-50/50 to-orange-100/30 p-4 flex flex-col justify-end items-end border-l border-orange-200 text-right space-y-3">
                <div className="w-full">
                  <p className="text-[9px] font-black text-orange-600 uppercase tracking-tighter mb-1">Ukupno Vrijeme</p>
                  <div className="flex items-center justify-end gap-1.5 text-xs"><Clock className="w-3.5 h-3.5 text-orange-400" /><span className="font-bold text-orange-950">{formatDur(aD)}</span><span className="text-orange-300">/</span><span className="text-orange-700 font-medium">{formatDur(pD)}</span></div>
                </div>
                <div className="pt-2 border-t border-orange-200/50 w-full">
                  <p className="text-[9px] font-black text-orange-600 uppercase tracking-tighter mb-1">Ukupno TSS</p>
                  <div className="flex items-center justify-end gap-1.5 text-xs"><Activity className="w-3.5 h-3.5 text-orange-400" /><span className="font-bold text-orange-950">{aT}</span><span className="text-orange-300">/</span><span className="text-orange-700 font-medium">{pT}</span></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
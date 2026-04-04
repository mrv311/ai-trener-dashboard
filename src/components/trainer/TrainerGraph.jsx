import React, { useMemo, useState } from 'react';

export const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-sky-300';
  if (percentFTP < 75) return 'bg-sky-400';
  if (percentFTP < 90) return 'bg-emerald-400';
  if (percentFTP < 105) return 'bg-amber-400';
  if (percentFTP < 120) return 'bg-rose-500';
  return 'bg-purple-600';
};

export default function TrainerGraph({ 
  workoutRecipe, 
  workoutHistory, 
  totalDuration, 
  progressPercent, 
  profile 
}) {
  const [hoveredStep, setHoveredStep] = useState(null);

  // Zbrajanje vremena provedenog u zonama (1 element u povijesti = 1 sekunda)
  const zoneStats = useMemo(() => {
    let zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0 };
    if (!profile || !profile.ftp) return zones;
    
    workoutHistory.forEach(h => {
      if (h.power === 0) return;
      const p = (h.power / profile.ftp) * 100;
      if (p < 55) zones.z1++;
      else if (p < 75) zones.z2++;
      else if (p < 90) zones.z3++;
      else if (p < 105) zones.z4++;
      else if (p < 120) zones.z5++;
      else zones.z6++;
    });
    return zones;
  }, [workoutHistory, profile]);

  const totalRecordedSecs = workoutHistory.filter(h => h.power > 0).length || 1; // da izbjegnemo dijeljenje s nula

  return (
    <div className="flex flex-col flex-1 w-full gap-2">
      {/* Glavni Graf */}
      <div className="relative flex-1 w-full bg-stone-50 rounded-t-xl flex items-end overflow-hidden border border-stone-200">
        {workoutRecipe.map((step, i) => {
          const widthPercent = (step.duration / totalDuration) * 100;
          const heightPercent = Math.min(Math.max((step.power / 150) * 100, 15), 100);
          const targetW = Math.round((step.power / 100) * profile?.ftp);
          
          return (
            <div 
              key={i} 
              onMouseEnter={() => setHoveredStep({ ...step, targetW })}
              onMouseLeave={() => setHoveredStep(null)}
              style={{ width: `${widthPercent}%`, height: `${heightPercent}%` }} 
              className={`${getZoneColorForTrainer(step.power)} border-r border-white/20 transition-all duration-300 opacity-90 group relative cursor-pointer hover:opacity-100 hover:z-40`}
            >
              {/* Tooltip prikaza bloka na hover */}
              {hoveredStep && hoveredStep.name === step.name && hoveredStep.duration === step.duration && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-stone-900 text-white text-[10px] font-bold px-3 py-2 rounded-lg shadow-xl pointer-events-none whitespace-nowrap z-50">
                  <span className="block text-stone-300">{step.name}</span>
                  <span className="text-sm text-orange-400">{targetW} W</span> <span className="font-normal text-stone-400">({step.power}% FTP)</span>
                  <span className="block mt-1 font-normal">{Math.floor(step.duration / 60)} min {step.duration % 60} sec</span>
                </div>
              )}
            </div>
          );
        })}

        <div className="absolute top-0 bottom-0 left-0 bg-stone-900/30 z-10 pointer-events-none transition-all duration-1000 ease-linear" style={{ width: `${progressPercent}%` }} />

        {workoutHistory.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none z-20">
            <polyline
              points={workoutHistory.map(p => {
                const x = (p.time / totalDuration) * 100;
                const hrPercent = Math.min(Math.max((p.hr / (profile?.maxHr || 180)) * 100, 0), 100);
                return `${x},${100 - hrPercent}`;
              }).join(' ')}
              fill="none" stroke="#ef4444" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.4))' }}
            />
            <polyline
              points={workoutHistory.map(p => {
                const x = (p.time / totalDuration) * 100;
                const powerInPercentFTP = (p.power / profile?.ftp) * 100;
                const heightPercent = Math.min(Math.max((powerInPercentFTP / 150) * 100, 15), 100);
                return `${x},${100 - heightPercent}`;
              }).join(' ')}
              fill="none" stroke="#ffffff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.6))' }}
            />
          </svg>
        )}

        {/* Linija koja pokazuje točan trenutni progres */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-stone-800 shadow-[0_0_8px_rgba(0,0,0,0.5)] z-30 transition-all duration-1000 ease-linear" style={{ left: `${progressPercent}%` }}>
          <div className="absolute -top-1.5 -left-[5px] w-3 h-3 bg-stone-800 rounded-full border-2 border-white"></div>
        </div>
      </div>

      {/* Traka za stvarni postotak vremena proveden u zonama (Z1-Z6) */}
      {workoutHistory.length > 10 && (
        <div className="w-full flex h-2 rounded-full overflow-hidden mt-2 bg-stone-100">
           {zoneStats.z1 > 0 && <div style={{width: `${(zoneStats.z1/totalRecordedSecs)*100}%`}} className="bg-sky-300" title={`Z1 Recovery: ${Math.round((zoneStats.z1/totalRecordedSecs)*100)}%`} />}
           {zoneStats.z2 > 0 && <div style={{width: `${(zoneStats.z2/totalRecordedSecs)*100}%`}} className="bg-sky-400" title={`Z2 Endurance: ${Math.round((zoneStats.z2/totalRecordedSecs)*100)}%`} />}
           {zoneStats.z3 > 0 && <div style={{width: `${(zoneStats.z3/totalRecordedSecs)*100}%`}} className="bg-emerald-400" title={`Z3 Tempo: ${Math.round((zoneStats.z3/totalRecordedSecs)*100)}%`} />}
           {zoneStats.z4 > 0 && <div style={{width: `${(zoneStats.z4/totalRecordedSecs)*100}%`}} className="bg-amber-400" title={`Z4 Threshold: ${Math.round((zoneStats.z4/totalRecordedSecs)*100)}%`} />}
           {zoneStats.z5 > 0 && <div style={{width: `${(zoneStats.z5/totalRecordedSecs)*100}%`}} className="bg-rose-500" title={`Z5 VO2Max: ${Math.round((zoneStats.z5/totalRecordedSecs)*100)}%`} />}
           {zoneStats.z6 > 0 && <div style={{width: `${(zoneStats.z6/totalRecordedSecs)*100}%`}} className="bg-purple-600" title={`Z6 Anaerobic: ${Math.round((zoneStats.z6/totalRecordedSecs)*100)}%`} />}
        </div>
      )}
    </div>
  );
}

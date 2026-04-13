import React, { useMemo, useState } from 'react';
import { getZoneColorForTrainer } from '../../utils/workoutUtils';

export default function TrainerGraph({
  workoutRecipe,
  workoutHistory,
  totalDuration,
  progressPercent,
  profile,
  ergIntensity = 100
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
      <div className="relative flex-1 min-h-[150px] w-full bg-zinc-950/50 rounded-t-xl border border-zinc-800/80 overflow-visible">
        {/* Sloj za overlay i SVG — clipan */}
        <div className="absolute inset-0 overflow-hidden rounded-t-xl pointer-events-none">
          <div className="absolute top-0 bottom-0 left-0 bg-black/40 z-10 transition-all duration-1000 ease-linear" style={{ width: `${progressPercent}%` }} />

          {workoutHistory.length > 0 && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-20">
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const maxVal = Math.max((profile?.ftp || 200) * 1.5, 200);
                  const heightPercent = Math.min(Math.max((p.power / maxVal) * 100, 15), 100);
                  return `${x},${100 - heightPercent}`;
                }).join(' ')}
                fill="none" stroke="#f4f4f5" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0px 0px 4px rgba(255,255,255,0.4))' }}
              />
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const maxVal = Math.max((profile?.ftp || 200) * 1.5, 200);
                  const scaledHr = Math.min(Math.max((p.hr / maxVal) * 100, 15), 100);
                  return `${x},${100 - scaledHr}`;
                }).join(' ')}
                fill="none" stroke="#f43f5e" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0px 0px 3px rgba(244,63,94,0.6))' }}
              />
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const maxVal = Math.max((profile?.ftp || 200) * 1.5, 200);
                  const cadPercent = Math.min(Math.max((p.cadence / maxVal) * 100, 15), 100);
                  return `${x},${100 - cadPercent}`;
                }).join(' ')}
                fill="none" stroke="#eab308" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0px 0px 3px rgba(234,179,8,0.6))', opacity: 0.8 }}
              />
            </svg>
          )}

          {/* Linija koja pokazuje točan trenutni progres */}
          <div className="absolute top-0 bottom-0 w-[2px] bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)] z-30 transition-all duration-1000 ease-linear" style={{ left: `${progressPercent}%` }}>
            <div className="absolute -top-1.5 -left-[5px] w-3 h-3 bg-zinc-900 rounded-full border-2 border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"></div>
          </div>
        </div>

        {/* Sloj za stupce (barove) — NIJE clipan, tako da tooltip može izviriti */}
        <div className="absolute inset-0 flex items-end w-full z-[5]">
          {workoutRecipe.map((step, i) => {
            const widthPercent = (step.duration / totalDuration) * 100;
            const scaledPower = step.power * (ergIntensity / 100);
            const targetW = Math.round((scaledPower / 100) * profile?.ftp);
            const maxVal = Math.max((profile?.ftp || 200) * 1.5, 200);
            const heightPercent = Math.min(Math.max((targetW / maxVal) * 100, 15), 100);

            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredStep({ ...step, targetW, scaledPower, index: i })}
                onMouseLeave={() => setHoveredStep(null)}
                style={{ width: `${widthPercent}%`, height: `${heightPercent}%` }}
                className={`${getZoneColorForTrainer(scaledPower)} border-r border-zinc-950/40 transition-all duration-300 opacity-80 relative cursor-pointer hover:opacity-100`}
              >
                {/* Tooltip */}
                {hoveredStep && hoveredStep.index === i && (
                  <div
                    className="absolute bottom-full mb-2 bg-zinc-900/95 backdrop-blur-sm text-zinc-100 text-[11px] font-bold px-3 py-2 rounded-lg shadow-xl shadow-black/50 border border-zinc-700 pointer-events-none whitespace-nowrap z-[100]"
                    style={{
                      left: i <= 1 ? '0' : (i >= workoutRecipe.length - 2 ? 'auto' : '50%'),
                      right: i >= workoutRecipe.length - 2 ? '0' : 'auto',
                      transform: (i <= 1 || i >= workoutRecipe.length - 2) ? 'none' : 'translateX(-50%)'
                    }}
                  >
                    <span className="block text-zinc-400 mb-0.5">{step.name}</span>
                    <span className="text-sm text-orange-500 drop-shadow-[0_0_3px_rgba(249,115,22,0.4)]">{targetW} W</span> <span className="font-normal text-zinc-500">({Math.round(hoveredStep.scaledPower)}% FTP)</span>
                    <span className="block mt-1 font-normal text-zinc-400">{Math.floor(step.duration / 60)} min {step.duration % 60} sec</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Traka za stvarni postotak vremena proveden u zonama (Z1-Z6) */}
      {workoutHistory.length > 10 && (
        <div className="w-full flex h-2 rounded-full overflow-hidden mt-2 bg-zinc-900 border border-zinc-800">
          {zoneStats.z1 > 0 && <div style={{ width: `${(zoneStats.z1 / totalRecordedSecs) * 100}%` }} className="bg-zinc-500" title={`Z1 Recovery: ${Math.round((zoneStats.z1 / totalRecordedSecs) * 100)}%`} />}
          {zoneStats.z2 > 0 && <div style={{ width: `${(zoneStats.z2 / totalRecordedSecs) * 100}%` }} className="bg-sky-500" title={`Z2 Endurance: ${Math.round((zoneStats.z2 / totalRecordedSecs) * 100)}%`} />}
          {zoneStats.z3 > 0 && <div style={{ width: `${(zoneStats.z3 / totalRecordedSecs) * 100}%` }} className="bg-emerald-500" title={`Z3 Tempo: ${Math.round((zoneStats.z3 / totalRecordedSecs) * 100)}%`} />}
          {zoneStats.z4 > 0 && <div style={{ width: `${(zoneStats.z4 / totalRecordedSecs) * 100}%` }} className="bg-amber-500" title={`Z4 Threshold: ${Math.round((zoneStats.z4 / totalRecordedSecs) * 100)}%`} />}
          {zoneStats.z5 > 0 && <div style={{ width: `${(zoneStats.z5 / totalRecordedSecs) * 100}%` }} className="bg-rose-500" title={`Z5 VO2Max: ${Math.round((zoneStats.z5 / totalRecordedSecs) * 100)}%`} />}
          {zoneStats.z6 > 0 && <div style={{ width: `${(zoneStats.z6 / totalRecordedSecs) * 100}%` }} className="bg-purple-500" title={`Z6 Anaerobic: ${Math.round((zoneStats.z6 / totalRecordedSecs) * 100)}%`} />}
        </div>
      )}
    </div>
  );
}

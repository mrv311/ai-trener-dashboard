import React, { useMemo, useState, useRef } from 'react';
import { getZoneColorForTrainer } from '../../utils/performanceMetrics';

export default function TrainerGraph({
  workoutRecipe,
  workoutHistory,
  totalDuration,
  progressPercent,
  profile,
  ergIntensity = 100
}) {
  const [hoveredStep, setHoveredStep] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);
  const graphRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!graphRef.current) return;
    const rect = graphRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const percentX = (x / width) * 100;

    // Find which step we are hovering based on percentX
    let accumPercent = 0;
    let foundStep = null;
    let stepIndex = -1;

    for (let i = 0; i < workoutRecipe.length; i++) {
      const step = workoutRecipe[i];
      const stepWidth = (step.duration / totalDuration) * 100;
      if (percentX >= accumPercent && percentX <= accumPercent + stepWidth) {
        foundStep = step;
        stepIndex = i;
        break;
      }
      accumPercent += stepWidth;
    }

    if (foundStep) {
      const scaledPower = foundStep.power * (ergIntensity / 100);
      const targetW = Math.round((scaledPower / 100) * profile?.ftp);
      setHoveredStep({ ...foundStep, targetW, scaledPower, index: stepIndex });
      setHoverPosition(percentX);
    } else {
      setHoveredStep(null);
      setHoverPosition(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredStep(null);
    setHoverPosition(null);
  };

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
    <div className="flex flex-col flex-1 w-full gap-1">
      {/* Glavni Graf */}
      <div
        ref={graphRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative flex-1 min-h-[60px] w-full bg-zinc-950/50 rounded-t-xl border border-zinc-800/80 overflow-visible group cursor-crosshair"
      >
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
          <div className="absolute top-0 bottom-0 w-[2px] bg-orange-500 shadow-[0_0_10px_rgba(34,211,238,0.8)] z-30 transition-all duration-1000 ease-linear" style={{ left: `${progressPercent}%` }}>
            <div className="absolute -top-1.5 -left-[5px] w-3 h-3 bg-zinc-900 rounded-full border-2 border-orange-500 shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
          </div>
        </div>

        {/* Sloj za stupce (barove) — NIJE clipan, tako da tooltip može izviriti */}
        <div className="absolute inset-0 flex items-end w-full z-[5] pointer-events-none">
          {workoutRecipe.map((step, i) => {
            const widthPercent = (step.duration / totalDuration) * 100;
            const scaledPower = step.power * (ergIntensity / 100);
            const targetW = Math.round((scaledPower / 100) * profile?.ftp);
            const maxVal = Math.max((profile?.ftp || 200) * 1.5, 200);
            const heightPercent = Math.min(Math.max((targetW / maxVal) * 100, 15), 100);

            return (
              <div
                key={i}
                style={{ width: `${widthPercent}%`, height: `${heightPercent}%` }}
                className={`${getZoneColorForTrainer(scaledPower)} border-r border-zinc-950/40 transition-all duration-300 opacity-80 relative`}
              >
              </div>
            );
          })}
        </div>

        {/* Intervals.icu style vertical line and tooltip */}
        {hoverPosition !== null && hoveredStep && (
          <div
            className="absolute top-0 bottom-0 z-[100] pointer-events-none"
            style={{ left: `${hoverPosition}%` }}
          >
            {/* Okomita crta */}
            <div className="absolute top-0 bottom-0 w-[1px] bg-zinc-400/50 shadow-[0_0_5px_rgba(0,0,0,0.5)]"></div>

            {/* Oznaka s metrikom */}
            <div
              className="absolute top-2 bg-zinc-900/95 backdrop-blur-sm text-zinc-100 font-bold px-3 py-2 rounded-md shadow-xl border border-zinc-700 whitespace-nowrap"
              style={{
                transform: hoverPosition > 80 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)'
              }}
            >
              <div className="flex flex-col gap-1">
                <span className="text-zinc-200 text-[10px] uppercase tracking-wider font-black">{hoveredStep.name}</span>
                <span className="text-orange-400 text-sm drop-shadow-[0_0_2px_rgba(251,146,60,0.4)]">{hoveredStep.targetW} W <span className="text-zinc-300 text-[11px] font-semibold">({Math.round(hoveredStep.scaledPower)}%)</span></span>
                <span className="text-zinc-300 text-[11px] font-medium">{Math.floor(hoveredStep.duration / 60)}m {hoveredStep.duration % 60}s</span>
              </div>
            </div>
          </div>
        )}
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

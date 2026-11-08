import React, { useMemo, useState, useRef } from 'react';
import { getZoneColorForTrainer } from '../../utils/performanceMetrics';

export default function TrainerGraph({
  workoutRecipe,
  workoutHistory,
  totalDuration,
  progressPercent,
  profile,
  ergIntensity = 100,
  currentStepIndex = 0
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
      const isRange = !!(foundStep.isRange && foundStep.powerMin && foundStep.powerMax && foundStep.powerMin !== foundStep.powerMax);
      const scaledMin = (foundStep.powerMin || foundStep.power) * (ergIntensity / 100);
      const scaledMax = (foundStep.powerMax || foundStep.power) * (ergIntensity / 100);
      const ftpVal = profile?.ftp || 200;
      const targetMinW = Math.round((scaledMin / 100) * ftpVal);
      const targetMaxW = Math.round((scaledMax / 100) * ftpVal);

      const scaledPower = foundStep.power * (ergIntensity / 100);
      const targetW = Math.round((scaledPower / 100) * ftpVal);
      setHoveredStep({ ...foundStep, targetW, targetMinW, targetMaxW, scaledPower, scaledMin, scaledMax, isRange, index: stepIndex });
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
  const ftpVal = profile?.ftp || 200;
  const maxChartVal = Math.max(ftpVal * 1.5, 200);
  const ftpLineBottomPct = Math.min(Math.max((ftpVal / maxChartVal) * 100, 15), 100);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full gap-1 short:gap-0.5">
      {/* Glavni Graf */}
      <div
        ref={graphRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative flex-1 min-h-[44px] short:min-h-[38px] w-full bg-zinc-950 bg-telemetry-grid rounded-t-lg border border-zinc-800 overflow-visible group cursor-crosshair"
      >
        {/* Sloj za overlay i SVG — clipan */}
        <div className="absolute inset-0 overflow-hidden rounded-t-lg pointer-events-none">
          {/* 100% FTP referentna linija */}
          <div
            className="absolute left-0 right-0 border-t border-dashed border-volt-400/25 z-[8] flex justify-end pr-1.5"
            style={{ bottom: `${ftpLineBottomPct}%` }}
          >
            <span className="text-[8px] font-mono font-bold text-volt-400/60 -mt-3 bg-zinc-950/80 px-1 rounded">
              FTP {ftpVal}W
            </span>
          </div>

          <div className="absolute top-0 bottom-0 left-0 bg-black/45 z-10 transition-all duration-1000 ease-linear" style={{ width: `${progressPercent}%` }} />

          {workoutHistory.length > 0 && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-20">
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const heightPercent = Math.min(Math.max((p.power / maxChartVal) * 100, 15), 100);
                  return `${x},${100 - heightPercent}`;
                }).join(' ')}
                fill="none" stroke="#f4f4f5" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0px 0px 4px rgba(255,255,255,0.35))' }}
              />
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const scaledHr = Math.min(Math.max((p.hr / maxChartVal) * 100, 15), 100);
                  return `${x},${100 - scaledHr}`;
                }).join(' ')}
                fill="none" stroke="#f43f5e" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0px 0px 3px rgba(244,63,94,0.5))' }}
              />
              <polyline
                points={workoutHistory.map(p => {
                  const x = (p.time / totalDuration) * 100;
                  const cadPercent = Math.min(Math.max((p.cadence / maxChartVal) * 100, 15), 100);
                  return `${x},${100 - cadPercent}`;
                }).join(' ')}
                fill="none" stroke="#38bdf8" strokeWidth="1.3"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ opacity: 0.75 }}
              />
            </svg>
          )}

          {/* Oštra Acid Volt igla napretka */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-volt-400 shadow-[0_0_12px_rgba(var(--accent-400),0.9)] z-30 transition-all duration-1000 ease-linear"
            style={{ left: `${progressPercent}%` }}
          >
            <div className="absolute -top-1 -left-[4px] w-2.5 h-2.5 bg-zinc-950 rotate-45 border-2 border-volt-400 shadow-[0_0_8px_rgba(var(--accent-400),0.9)]" />
          </div>
        </div>

        {/* Sloj za stupce (barove) s 2px top-cap rubom */}
        <div className="absolute inset-0 flex items-end w-full z-[5] pointer-events-none">
          {workoutRecipe.map((step, i) => {
            const widthPercent = (step.duration / totalDuration) * 100;
            const scaledPower = step.power * (ergIntensity / 100);
            const targetW = Math.round((scaledPower / 100) * ftpVal);
            const heightPercent = Math.min(Math.max((targetW / maxChartVal) * 100, 15), 100);
            const isCurrent = i === currentStepIndex;
            const zoneBg = getZoneColorForTrainer(scaledPower);

            return (
              <div
                key={i}
                style={{ width: `${widthPercent}%`, height: `${heightPercent}%` }}
                className={`border-r border-zinc-950/70 transition-all duration-300 relative overflow-hidden ${
                  isCurrent ? 'ring-1 ring-inset ring-white/30 z-[6]' : ''
                }`}
              >
                <div className={`absolute inset-0 ${zoneBg} ${isCurrent ? 'opacity-85' : 'opacity-55'}`} style={{ maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 100%)', WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 100%)' }} />
                <div className={`absolute top-0 left-0 right-0 h-[2px] ${zoneBg} brightness-125`} />
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
            <div className="absolute top-0 bottom-0 w-px bg-volt-400/50" />

            <div
              className="absolute top-2 bg-zinc-950/95 text-zinc-100 px-3 py-2 rounded-lg shadow-2xl border border-zinc-700 whitespace-nowrap"
              style={{
                transform: hoverPosition > 80 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)'
              }}
            >
              <div className="flex flex-col gap-0.5 font-mono telemetry-num">
                <span className="text-zinc-300 text-[10px] uppercase tracking-wider font-sans font-bold">{hoveredStep.name}</span>
                <span className="text-volt-400 text-sm font-bold">
                  {hoveredStep.isRange
                    ? `${hoveredStep.targetMinW}–${hoveredStep.targetMaxW} W `
                    : `${hoveredStep.targetW} W `}
                  <span className="text-zinc-400 text-[11px] font-normal">
                    ({hoveredStep.isRange
                      ? `${Math.round(hoveredStep.scaledMin)}–${Math.round(hoveredStep.scaledMax)}% FTP`
                      : `${Math.round(hoveredStep.scaledPower)}% FTP`})
                  </span>
                </span>
                <span className="text-zinc-400 text-[11px]">{Math.floor(hoveredStep.duration / 60)}m {hoveredStep.duration % 60}s</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Traka za stvarni postotak vremena proveden u zonama (Z1-Z6) */}
      {workoutHistory.length > 10 && (
        <div className="w-full flex h-1.5 rounded-sm overflow-hidden mt-1.5 bg-zinc-950 border border-zinc-800">
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

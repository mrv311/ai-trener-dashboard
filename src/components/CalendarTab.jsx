import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Activity, CheckCircle2, XCircle, Target, Unlink, Link2, Heart, Moon, Play, Trash2, GripVertical, Bike, Upload, PenLine } from 'lucide-react';
import { DndContext, pointerWithin, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import WorkoutEditorModal from './WorkoutEditorModal';
import { updateEventDetails } from '../services/intervalsApi';
import ActivityDetailModal from './ActivityDetailModal';
import { extractIntensityData, parseWorkoutFile } from '../utils/workoutParser';

const formatDur = (mins) => {
  if (!mins || isNaN(mins) || mins <= 0) return '00m';
  let cleanMins = Math.round(mins);
  if (cleanMins >= 360 && cleanMins % 60 === 0) {
    cleanMins = Math.round(cleanMins / 60);
  } else if (cleanMins > 1440) {
    cleanMins = Math.round(cleanMins / 60);
  }
  const h = Math.floor(cleanMins / 60);
  return `${h > 0 ? h + 'h ' : ''}${String(cleanMins % 60).padStart(2, '0')}m`;
};

const getCardBg = (sc) => {
  if (sc === 'green') return "bg-emerald-950/25 border-emerald-500/25 hover:border-emerald-500/45 border";
  if (sc === 'yellow') return "bg-amber-950/25 border-amber-500/25 hover:border-amber-500/45 border";
  if (sc === 'red') return "bg-rose-950/25 border-rose-500/25 hover:border-rose-500/45 border";
  if (sc === 'red-missed') return "bg-rose-950/10 border-rose-500/20 border-dashed border opacity-80";
  if (sc === 'blue') return "bg-sky-950/25 border-sky-500/25 hover:border-sky-500/45 border";
  if (sc === 'grey') return "bg-zinc-900/90 border-zinc-800 hover:border-zinc-700 border";
  return "bg-zinc-900/90 border-zinc-800 hover:border-zinc-700 border";
};

const getTopCol = (sc) => {
  if (sc === 'green') return "bg-emerald-400";
  if (sc === 'yellow') return "bg-amber-400";
  if (sc === 'red') return "bg-rose-500";
  if (sc === 'red-missed') return "bg-rose-500/50";
  if (sc === 'blue') return "bg-sky-400";
  if (sc === 'grey') return "bg-volt-400/70";
  return "bg-zinc-600";
};

const isDraggable = (w) => !w.isCompleted && (w.isLocal || w.id.startsWith('ev-'));

const ZONE_COLORS = {
  1: 'bg-zinc-500',
  2: 'bg-sky-500',
  3: 'bg-emerald-500',
  4: 'bg-amber-500',
  5: 'bg-rose-500'
};

const BORDER_COLORS = {
  1: 'border-zinc-400',
  2: 'border-sky-400',
  3: 'border-emerald-400',
  4: 'border-amber-400',
  5: 'border-rose-400'
};

// Mapiranje % FTP u zone za graf
const getZoneFromFtpPercent = (percent) => {
  if (!percent) return 1;
  if (percent < 55) return 1;
  if (percent <= 75) return 2;
  if (percent <= 90) return 3;
  if (percent <= 105) return 4;
  return 5;
};

const getSourceBadgeMeta = (src) => {
  if (!src) return null;
  if (src === 'calendar') return { label: 'KALENDAR', dot: 'bg-volt-400', cls: 'text-zinc-300 border-zinc-700 bg-zinc-950' };
  if (src === 'library') return { label: 'KNJIŽNICA', dot: 'bg-volt-400', cls: 'text-zinc-300 border-zinc-700 bg-zinc-950' };
  if (src === 'free_ride') return { label: 'SLOBODNO', dot: 'bg-sky-400', cls: 'text-sky-300 border-sky-500/25 bg-sky-500/10' };
  if (src === 'garmin') return { label: 'GARMIN', dot: 'bg-emerald-400', cls: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10' };
  if (src === 'strava') return { label: 'STRAVA', dot: 'bg-orange-400', cls: 'text-orange-300 border-orange-500/25 bg-orange-500/10' };
  if (src === 'wahoo') return { label: 'WAHOO', dot: 'bg-sky-400', cls: 'text-sky-300 border-sky-500/25 bg-sky-500/10' };
  if (src.startsWith('external_upload')) return { label: 'FIT UVOZ', dot: 'bg-violet-400', cls: 'text-violet-300 border-violet-500/25 bg-violet-500/10' };
  if (src === 'external') return { label: 'VANJSKI', dot: 'bg-zinc-400', cls: 'text-zinc-300 border-zinc-700 bg-zinc-950' };
  return { label: String(src).toUpperCase(), dot: 'bg-zinc-400', cls: 'text-zinc-300 border-zinc-700 bg-zinc-950' };
};



// ============================================================
// WorkoutGraph (Performance Guardrail)
// ============================================================
// ============================================================
// WorkoutGraph (Performance & Scaling Fix)
// ============================================================
// ============================================================
// WorkoutGraph (Final Solid Visuals Fix)
// ============================================================
// ============================================================
// WorkoutGraph (Final Polish with Seams)
// ============================================================
// ============================================================
// WorkoutGraph (Final Solid Visuals Fix)
// ============================================================
const WorkoutGraph = React.memo(function WorkoutGraph({ workoutDoc, isCompleted }) {
  const intensityArray = useMemo(() => {
    return extractIntensityData(workoutDoc);
  }, [workoutDoc]);

  if (intensityArray.length === 0) return null;

  const displayData = intensityArray;

  return (
    <div className="relative flex items-end h-9 w-full mt-2 bg-zinc-950/90 rounded border border-zinc-800/80 overflow-hidden px-[1px] pt-1">
      {displayData.map((val, i) => {
        const zone = getZoneFromFtpPercent(val);
        const heightPercent = Math.min((val / 150) * 100, 100);

        return (
          <div
            key={i}
            className={`flex-1 transition-all duration-300 border-t ${BORDER_COLORS[zone]} ${ZONE_COLORS[zone]} ${isCompleted ? 'opacity-85' : 'opacity-50'}`}
            style={{
              height: `${heightPercent}%`,
              minWidth: '1px'
            }}
          />
        );
      })}

      {/* 100% FTP Baseline Indikator (Suptilna linija praga) */}
      <div className="absolute bottom-[66.6%] left-0 w-full border-b border-dashed border-volt-400/25 pointer-events-none" />
    </div>
  );
});

// ============================================================
// WorkoutCard
// ============================================================
const WorkoutCard = React.memo(function WorkoutCard({ w, isDragging, isDesktop, onSelectWorkout, handleUnpair, handlePair, handleDeleteLocalActivity, handleDeleteCompletedActivity, onEditWorkout, onViewActivity, isCurrentMonth, compact }) {
  const canDrag = isDesktop && isDraggable(w);

  const { attributes, listeners, setNodeRef } = useDraggable({
    id: w.id,
    disabled: !canDrag,
    data: { workout: w }
  });

  const style = {
    touchAction: canDrag ? 'none' : 'auto'
  };

  const sourceMeta = w.isSupabase && w.workout_source ? getSourceBadgeMeta(w.workout_source) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
      onClick={() => {
        if (!isDragging) {
          if (w.isCompleted || w.status === 'completed' || w.id.startsWith('act-') || w.id.startsWith('supabase-')) {
            if (onViewActivity) onViewActivity(w);
          } else if (onEditWorkout && (w.isLocal || w.id.startsWith('ev-'))) {
            onEditWorkout(w);
          }
        }
      }}
      className={`workout-card-element group/wcard rounded-lg flex flex-col overflow-hidden ${compact ? 'min-h-[40px]' : 'min-h-[96px]'} transition-all duration-150 ${getCardBg(w.statusColor)} ${isDragging ? 'opacity-20 border-dashed border-2 border-volt-400' : 'cursor-pointer'} ${canDrag && !isDragging ? 'hover:border-volt-400/40' : ''}`}
    >
      <div className={`h-[2px] w-full shrink-0 ${getTopCol(w.statusColor)}`} />
      <div className={`${isDesktop ? (compact ? 'p-1.5' : 'p-2.5') : 'p-3.5'} flex flex-col justify-between flex-1`}>
        {compact ? (
          // Compact: just title + duration + status icon
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-[9px] font-bold text-zinc-300 truncate flex-1">{w.title}</span>
            <span className="text-[9px] font-mono telemetry-num text-zinc-400 shrink-0">{formatDur(w.duration)}</span>
            {w.statusColor === 'green' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
            {w.statusColor === 'red-missed' && <XCircle className="w-3 h-3 text-rose-500 shrink-0" />}
          </div>
        ) : (
          <div className="flex flex-col gap-1 w-full">
            {/* Header: Sport icon, duration, actions */}
            <div className="flex justify-between items-center w-full gap-1">
              <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono font-bold telemetry-num uppercase tracking-wider">
                <Bike className={`${isDesktop ? 'w-3 h-3 text-zinc-500' : 'w-4 h-4 text-zinc-400'}`} />
                <span title={w.plannedDuration ? `Plan: ${formatDur(w.plannedDuration)}` : ''}>
                  {formatDur(w.duration)}
                  {!isDesktop && w.plannedDuration && <span className="text-zinc-600 text-[9px] ml-1">/ {formatDur(w.plannedDuration)}</span>}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-1" onPointerDown={(e) => { }}>
                {w.actId && w.eventId && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleUnpair(w.actId, w.eventId); }}
                    className="text-zinc-500 hover:text-volt-400 transition-opacity md:opacity-0 md:group-hover/wcard:opacity-100 p-0.5"
                    title="Razdvoji planirano i odrađeno"
                  >
                    <Unlink className="w-3 h-3" />
                  </button>
                )}
                {w.actId && w.separatedEventIds && w.separatedEventIds.map(sepId => (
                  <button
                    key={sepId}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handlePair(w.actId, sepId); }}
                    className="text-zinc-500 hover:text-emerald-400 transition-opacity md:opacity-0 md:group-hover/wcard:opacity-100 p-0.5"
                    title="Spoji s planiranim treningom"
                  >
                    <Link2 className="w-3 h-3" />
                  </button>
                ))}
                {!w.isCompleted && handleDeleteLocalActivity && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleDeleteLocalActivity(w.id); }}
                    className="text-zinc-500 hover:text-rose-400 rounded p-0.5 transition-opacity md:opacity-0 md:group-hover/wcard:opacity-100"
                    title="Obriši planirani trening"
                  >
                    <Trash2 className={`${isDesktop ? 'w-3 h-3' : 'w-4 h-4'}`} />
                  </button>
                )}
                {w.isCompleted && handleDeleteCompletedActivity && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (window.confirm('Sigurno želiš obrisati ovaj odrađeni trening?')) {
                        const result = await handleDeleteCompletedActivity(w.id);
                        if (!result.success) alert('Greška pri brisanju: ' + (result.error || 'Nepoznata greška'));
                      }
                    }}
                    className="text-zinc-500 hover:text-rose-400 rounded p-0.5 transition-opacity md:opacity-0 md:group-hover/wcard:opacity-100"
                    title="Obriši odrađeni trening"
                  >
                    <Trash2 className={`${isDesktop ? 'w-3 h-3' : 'w-4 h-4'}`} />
                  </button>
                )}
                {!w.isCompleted && onSelectWorkout && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onSelectWorkout(w); }}
                    className={`text-volt-400 hover:text-zinc-950 bg-volt-400/12 hover:bg-volt-400 ${isDesktop ? 'rounded p-1' : 'rounded-lg p-1.5'} transition-all border border-volt-400/30`}
                    title="Pokreni u trenažeru"
                  >
                    <Play className={`${isDesktop ? 'w-3 h-3' : 'w-4 h-4'} fill-current`} />
                  </button>
                )}
                {w.statusColor === 'green' && <CheckCircle2 className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-emerald-400`} />}
                {w.statusColor === 'red-missed' && <XCircle className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-rose-500`} />}
              </div>
            </div>
            {/* Title */}
            <div className={`font-bold ${isDesktop ? 'text-xs' : 'text-sm'} text-zinc-100 leading-snug line-clamp-2`}>
              {canDrag && <GripVertical className="inline-block w-3 h-3 mr-0.5 -ml-1 text-zinc-600 group-hover/wcard:text-zinc-400 align-middle pointer-events-none transition-colors" />}
              {w.title}
            </div>
            {sourceMeta && (
              <div className="flex items-center">
                <span className={`inline-flex items-center gap-1 text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sourceMeta.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sourceMeta.dot}`} />
                  {sourceMeta.label}
                </span>
              </div>
            )}
            {/* Metrics */}
            <div className="flex flex-col gap-1 mt-1.5">
              <div className="flex items-center gap-1.5 flex-wrap font-mono telemetry-num">
                {w.isCompleted ? (
                  // Odrađeni trening: TSS ostvareni / planirani + postotak u boji kartice
                  <>
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">TSS</span>
                    <span className="text-xs font-bold text-zinc-100">{w.tss > 0 ? w.tss : '-'}</span>
                    {w.plannedTss > 0 && (
                      <>
                        <span className="text-[9px] text-zinc-600">/</span>
                        <span className="text-xs text-zinc-500">{w.plannedTss}</span>
                      </>
                    )}
                    {w.plannedTss > 0 && w.tss > 0 && (
                      <span className={`text-[9px] font-bold ml-auto px-1 rounded ${w.statusColor === 'green' ? 'text-emerald-400 bg-emerald-500/10' :
                        w.statusColor === 'yellow' ? 'text-amber-400 bg-amber-500/10' :
                          w.statusColor === 'red' ? 'text-rose-400 bg-rose-500/10' :
                            'text-zinc-400 bg-zinc-800'
                        }`}>
                        {Math.round((w.tss / w.plannedTss) * 100)}%
                      </span>
                    )}
                  </>
                ) : (
                  // Planirani trening: samo planirani TSS
                  <>
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">PLAN TSS</span>
                    <span className="text-xs font-bold text-zinc-300">{w.plannedTss > 0 ? w.plannedTss : '-'}</span>
                  </>
                )}
              </div>
              {w.intervalDescription && (
                <span className="text-[10px] font-mono text-zinc-400/85 leading-tight line-clamp-1">{w.intervalDescription}</span>
              )}
              {w.category && w.difficulty_score && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="bg-zinc-950 text-zinc-300 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-zinc-800">{w.category}</span>
                  <span className="text-volt-400 font-mono telemetry-num text-[10px] font-bold">LVL {w.difficulty_score.toFixed(1)}</span>
                </div>
              )}
            </div>
            {/* Graph */}
            <WorkoutGraph
              workoutDoc={w.workout_doc || w.steps}
              isCompleted={w.isCompleted || w.status === 'completed'}
            />
          </div>
        )}
      </div>
    </div>
  );
});
// ============================================================
// CalendarDay
// ============================================================
const CalendarDay = React.memo(function CalendarDay({ dObj, dWorks, isTdy, dWell, isDesktop, todayStr, activeId, onSelectWorkout, handleUnpair, handlePair, handleDeleteLocalActivity, handleDeleteCompletedActivity, onEditWorkout, onViewActivity, compact, onAddWorkoutClick }) {
  const { isOver, setNodeRef } = useDroppable({ id: dObj.dateStr });

  if (!isDesktop) {
    const dayNames = ["PON", "UTO", "SRI", "ČET", "PET", "SUB", "NED"];
    const dayOfWeek = dayNames[(new Date(dObj.dateStr).getDay() + 6) % 7];
    return (
      <div
        className={`p-4 flex flex-col cursor-pointer bg-zinc-900/80 ${isTdy ? 'border-l-2 border-l-volt-400 bg-volt-400/[0.03]' : ''}`}
        onClick={(e) => {
          if (e.target.closest('.workout-card-element')) return;
          if (onAddWorkoutClick) {
            onAddWorkoutClick(dObj.dateStr);
          }
        }}
      >
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-mono telemetry-num font-bold ${isTdy ? 'text-volt-400' : 'text-zinc-200'}`}>{dObj.day}.</span>
            <span className="text-xs font-mono font-bold text-zinc-500 uppercase tracking-wider">{dayOfWeek}</span>
            {isTdy && <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-volt-400/15 text-volt-400 border border-volt-400/30">DANAS</span>}
          </div>
          {dWell && (
            <div className="flex gap-2.5 text-[11px] font-mono telemetry-num font-bold text-zinc-400 bg-zinc-950 px-2.5 py-1 rounded-lg border border-zinc-800">
              {dWell.restingHR && <span className="flex items-center text-rose-400"><Heart className="w-3 h-3 mr-1" fill="currentColor" />{dWell.restingHR}</span>}
              {dWell.hrv && <span className="flex items-center text-sky-400" title="HRV"><Activity className="w-3 h-3 mr-1" />{Math.round(dWell.hrv)}ms</span>}
              {dWell.sleep && <span className="flex items-center text-indigo-400"><Moon className="w-3 h-3 mr-1" fill="currentColor" />{dWell.sleep}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {dWorks.length > 0 ? dWorks.map(w => (
            <WorkoutCard key={w.id} w={w} isDesktop={false} isDragging={false} onSelectWorkout={onSelectWorkout} handleUnpair={handleUnpair} handlePair={handlePair} handleDeleteLocalActivity={handleDeleteLocalActivity} handleDeleteCompletedActivity={handleDeleteCompletedActivity} onEditWorkout={onEditWorkout} onViewActivity={onViewActivity} />
          )) : (
            <div className="text-[11px] font-mono text-zinc-500 px-2.5 py-1.5 bg-zinc-950/60 rounded border border-zinc-800/80 border-dashed mr-auto uppercase tracking-wider">Dan odmora · + Dodaj</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col group relative transition-all duration-150 cursor-pointer hover:bg-zinc-900/90
        ${compact ? 'p-1.5' : 'p-2.5'}
        ${dObj.isCurrentMonth ? 'bg-zinc-950/75' : 'bg-zinc-950'}
        ${isTdy ? 'border-t-2 border-t-volt-400 bg-volt-400/[0.025]' : ''}
        ${isOver ? 'bg-volt-400/10 ring-1 ring-volt-400/60 ring-inset' : ''}
      `}
      onClick={(e) => {
        if (e.target.closest('.workout-card-element')) return;
        if (onAddWorkoutClick) {
          onAddWorkoutClick(dObj.dateStr);
        }
      }}
    >
      <div className={`flex justify-between items-center ${compact ? 'mb-1' : 'mb-2.5'}`}>
        <div className="flex items-center gap-1.5">
          <span className={`font-mono telemetry-num font-bold text-xs ${isTdy ? 'text-volt-400' : (dObj.isCurrentMonth ? 'text-zinc-200' : 'text-zinc-600')}`}>{dObj.day}</span>
          {isTdy && !compact && (
            <span className="text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-volt-400/15 text-volt-400 border border-volt-400/30">
              DANAS
            </span>
          )}
        </div>
        {!compact && dWell && (
          <div className="flex gap-1.5 text-[10px] font-mono telemetry-num font-bold text-zinc-500">
            {dWell.restingHR && <span className="flex items-center text-rose-400/85"><Heart className="w-2.5 h-2.5 mr-0.5" fill="currentColor" />{dWell.restingHR}</span>}
            {dWell.hrv && <span className="flex items-center text-sky-400/85" title="HRV"><Activity className="w-2.5 h-2.5 mr-0.5" />{Math.round(dWell.hrv)}</span>}
            {dWell.sleep && <span className="flex items-center text-indigo-400/85"><Moon className="w-2.5 h-2.5 mr-0.5" fill="currentColor" />{dWell.sleep}</span>}
          </div>
        )}
        {compact && dWell && (
          <div className="flex gap-1 text-[9px] font-mono telemetry-num font-bold text-zinc-600">
            {dWell.restingHR && <span className="flex items-center text-rose-500/60"><Heart className="w-2.5 h-2.5" fill="currentColor" />{dWell.restingHR}</span>}
            {dWell.hrv && <span className="flex items-center text-sky-400/60" title="HRV"><Activity className="w-2.5 h-2.5" />{Math.round(dWell.hrv)}</span>}
          </div>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto pr-0.5 custom-scrollbar ${compact ? 'space-y-1' : 'space-y-2'}`}>
        {dWorks.map(w => (
          <WorkoutCard
            key={w.id}
            w={w}
            isDesktop={true}
            isDragging={activeId === w.id}
            isCurrentMonth={dObj.isCurrentMonth}
            onSelectWorkout={compact ? null : onSelectWorkout}
            handleUnpair={compact ? null : handleUnpair}
            handlePair={compact ? null : handlePair}
            handleDeleteLocalActivity={compact ? null : handleDeleteLocalActivity}
            handleDeleteCompletedActivity={compact ? null : handleDeleteCompletedActivity}
            onEditWorkout={compact ? null : onEditWorkout}
            onViewActivity={onViewActivity}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
});

// ============================================================
// DragOverlay Preview
// ============================================================
function DragOverlayCard({ workout, activeWidth }) {
  if (!workout) return null;

  return (
    <div
      style={{ width: activeWidth ? `${activeWidth}px` : '200px' }}
      className="rounded-lg overflow-hidden border border-volt-400 bg-zinc-900/95 shadow-volt-glow pointer-events-none cursor-grabbing scale-105 opacity-95 transition-transform flex flex-col"
    >
      <div className={`h-[2px] w-full ${getTopCol(workout.statusColor)}`} />
      <div className="p-2.5 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono telemetry-num font-bold uppercase tracking-wide">
          <Bike className="w-3 h-3" />
          <span>{formatDur(workout.duration)}</span>
        </div>
        <span className="font-bold text-xs text-zinc-100 line-clamp-1 leading-tight">{workout.title}</span>
        <div className="flex items-baseline gap-1 bg-zinc-950 rounded px-1.5 py-0.5 border border-zinc-800 w-fit mt-1 font-mono telemetry-num">
          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">TSS</span>
          <span className="text-xs font-bold text-volt-400">{workout.tss > 0 ? workout.tss : (workout.plannedTss > 0 ? workout.plannedTss : '-')}</span>
        </div>
        <WorkoutGraph
          workoutDoc={workout.workout_doc || workout.steps}
          isCompleted={workout.isCompleted || workout.status === 'completed'}
        />
      </div>
    </div>
  );
}

// ============================================================
// CalendarTab
// ============================================================
export default function CalendarTab({ currentDate, setCurrentDate, workouts, wellnessData, handleUnpair, handlePair, handleDeleteLocalActivity, handleDeleteCompletedActivity, handleRescheduleWorkout, handleUpdateWorkout, handleCreateWorkout, onSelectWorkout, profile, intervalsId, intervalsKey, userId }) {
  const cy = currentDate.getFullYear();
  const cm = currentDate.getMonth();
  const [activeId, setActiveId] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [activeWidth, setActiveWidth] = useState(0);
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [viewingActivity, setViewingActivity] = useState(null);
  const [selectedDateForNew, setSelectedDateForNew] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(cm);
  const [pickerYear, setPickerYear] = useState(cy);
  const monthPickerRef = useRef(null);
  const fileInputRef = useRef(null);
  const activityFileInputRef = useRef(null);

  // Sync picker with currentDate when it changes externally
  useEffect(() => {
    setPickerMonth(cm);
    setPickerYear(cy);
  }, [cm, cy]);

  // Close picker on outside click
  useEffect(() => {
    if (!showMonthPicker) return;
    const handler = (e) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target)) {
        setShowMonthPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMonthPicker]);

  const goWeekBack = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  };

  const goWeekForward = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Build a 7-day week (Mon–Sun) offset by N weeks from currentDate
  const buildWeek = useCallback((offsetWeeks) => {
    const dow = currentDate.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diff + offsetWeeks * 7);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { day: d.getDate(), dateStr, month: d.getMonth(), year: d.getFullYear(), isCurrentMonth: d.getMonth() === currentDate.getMonth() };
    });
  }, [currentDate]);

  const prevWeek = useMemo(() => buildWeek(-1), [buildWeek]);
  const currentWeek = useMemo(() => buildWeek(0), [buildWeek]);
  const nextWeek = useMemo(() => buildWeek(1), [buildWeek]);

  const threeWeeks = [
    { days: prevWeek, isActive: false },
    { days: currentWeek, isActive: true },
    { days: nextWeek, isActive: false },
  ];

  // Month picker sync — use the month of Monday of current week
  const weekStartMonth = currentWeek[0].month;
  const weekStartYear = currentWeek[0].year;

  // Header label: month(s) and year of the active week
  const headerLabel = useMemo(() => {
    const start = currentWeek[0];
    const end = currentWeek[6];
    const mn = ["siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja", "srpnja", "kolovoza", "rujna", "listopada", "studenog", "prosinca"];
    const mnKratki = ["Sij", "Velj", "Ožu", "Tra", "Svi", "Lip", "Srp", "Kol", "Ruj", "Lis", "Stu", "Pro"];

    if (start.month === end.month) {
      // Isti mjesec: "21. – 27. travnja 2026"
      return `${start.day}. – ${end.day}. ${mn[start.month]} ${start.year}`;
    }
    if (start.year !== end.year) {
      // Različite godine: "29. pro 2025 – 4. sij 2026"
      return `${start.day}. ${mnKratki[start.month]} ${start.year} – ${end.day}. ${mnKratki[end.month]} ${end.year}`;
    }
    // Ista godina, različiti mjeseci: "28. tra – 4. svi 2026"
    return `${start.day}. ${mnKratki[start.month]} – ${end.day}. ${mnKratki[end.month]} ${end.year}`;
  }, [currentWeek]);

  // Keep picker in sync with week start
  useEffect(() => {
    setPickerMonth(weekStartMonth);
    setPickerYear(weekStartYear);
  }, [weekStartMonth, weekStartYear]);

  // calDays for mobile (shows current month days)
  const calDays = useMemo(() => {
    const cy2 = weekStartYear;
    const cm2 = weekStartMonth;
    const firstOfMonth = new Date(cy2, cm2, 1);
    const firstDow = firstOfMonth.getDay();
    const mondayOffset = firstDow === 0 ? -6 : 1 - firstDow;
    const startDate = new Date(cy2, cm2, 1 + mondayOffset);
    const lastOfMonth = new Date(cy2, cm2 + 1, 0);
    const lastDow = lastOfMonth.getDay();
    const sundayOffset = lastDow === 0 ? 0 : 7 - lastDow;
    const endDate = new Date(cy2, cm2 + 1, sundayOffset);
    const days = [];
    const cur = new Date(startDate);
    while (cur <= endDate) {
      const d = new Date(cur);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ day: d.getDate(), dateStr, isCurrentMonth: d.getMonth() === cm2 });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [weekStartYear, weekStartMonth]);

  const workoutsByDate = useMemo(() => {
    const map = {};
    workouts.forEach(w => {
      if (!map[w.date]) map[w.date] = [];
      map[w.date].push(w);
    });
    return map;
  }, [workouts]);

  const monthNames = ["Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj", "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac"];
  const dayNames = ["PON", "UTO", "SRI", "ČET", "PET", "SUB", "NED"];
  const nowLocal = new Date();
  const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
    setActiveWorkout(event.active.data?.current?.workout || null);
    if (event.active.rect.current?.initial) {
      setActiveWidth(event.active.rect.current.initial.width);
    }
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveWorkout(null);

    if (!over || !active) return;
    const workoutId = active.id;
    const newDate = over.id;

    const draggedWorkout = workouts.find(w => w.id === workoutId);
    if (!draggedWorkout) return;

    if (draggedWorkout.date === newDate) return;

    if (handleRescheduleWorkout) {
      handleRescheduleWorkout(workoutId, newDate);
    }
  }, [workouts, handleRescheduleWorkout]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveWorkout(null);
  }, []);

  const handleSaveWorkout = async (updatedWorkout) => {
    setIsUpdating(true);
    try {
      const existsInCalendar = workouts.some(w => w.id === updatedWorkout.id);
      if (!existsInCalendar && updatedWorkout.id.startsWith('local-')) {
        await handleCreateWorkout(updatedWorkout);
      } else {
        await handleUpdateWorkout(
          updatedWorkout.id,
          updatedWorkout.title,
          updatedWorkout.description,
          updatedWorkout.tss,
          updatedWorkout.duration,
          {
            allSteps: updatedWorkout.allSteps,
            category: updatedWorkout.category,
            difficulty_score: updatedWorkout.difficulty_score
          }
        );
      }
      setEditingWorkout(null);
    } catch (error) {
      console.error("Greška pri spremanju:", error);
      alert(error.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleManualCreate = () => {
    const newWorkout = {
      id: `local-${Date.now()}`,
      date: selectedDateForNew,
      title: 'Novi Trening',
      duration: 0,
      plannedDuration: 0,
      tss: 0,
      plannedTss: 0,
      statusColor: 'grey',
      isCompleted: false,
      isLocal: true,
      category: 'WORKOUT',
      type: 'ride',
      steps: []
    };
    setSelectedDateForNew(null);
    setEditingWorkout(newWorkout);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = await parseWorkoutFile(text, file.name);

      const newWorkout = {
        id: `local-${Date.now()}`,
        date: selectedDateForNew,
        title: parsed.title || 'Učitani Trening',
        duration: Math.round(parsed.duration_seconds / 60) || 60,
        plannedDuration: Math.round(parsed.duration_seconds / 60) || 60,
        tss: 0, // WorkoutEditorModal will recalculate this
        plannedTss: 0,
        statusColor: 'grey',
        isCompleted: false,
        isLocal: true,
        category: parsed.category || 'WORKOUT',
        type: 'ride',
        workout_doc: parsed.steps
      };

      setSelectedDateForNew(null);
      setEditingWorkout(newWorkout);
    } catch (err) {
      alert("Greška pri učitavanju datoteke: " + err.message);
    } finally {
      // Reset input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleActivityFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsUpdating(true);
      let parsedActivity;
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (extension === 'fit') {
        const buffer = await file.arrayBuffer();
        const { parseFIT } = await import('../utils/activityParser');
        parsedActivity = await parseFIT(buffer);
      } else if (extension === 'tcx') {
        const text = await file.text();
        const { parseTCX } = await import('../utils/activityParser');
        parsedActivity = parseTCX(text);
      } else {
        throw new Error("Nepodržan format datoteke.");
      }

      // If user selected a specific date in the calendar, overwrite it
      if (selectedDateForNew) {
        if (parsedActivity.startedAt instanceof Date && !isNaN(parsedActivity.startedAt)) {
          const hh = String(parsedActivity.startedAt.getHours()).padStart(2, '0');
          const mm = String(parsedActivity.startedAt.getMinutes()).padStart(2, '0');
          const ss = String(parsedActivity.startedAt.getSeconds()).padStart(2, '0');
          parsedActivity.startedAt = new Date(`${selectedDateForNew}T${hh}:${mm}:${ss}`);
        } else {
          parsedActivity.startedAt = new Date(`${selectedDateForNew}T12:00:00`);
        }
      }

      const ftp = Number(profile?.ftp) || Number(localStorage.getItem('ai_trener_user_ftp')) || 250;
      const mass = Number(profile?.weight) || Number(localStorage.getItem('ai_trener_user_weight')) || 75;

      const { processActivityStream } = await import('../utils/activityParser');
      const activityPayload = processActivityStream(parsedActivity, ftp, mass);

      // 1. Spremi u localStorage (primarno za Gosta + lokalni backup)
      const localKey = `ai_trener_local_completed_activities_${userId || 'guest'}`;
      const localActivities = JSON.parse(localStorage.getItem(localKey) || '[]');
      const localRecord = {
        id: 'local_act_' + Date.now(),
        ...activityPayload
      };
      localStorage.setItem(localKey, JSON.stringify([localRecord, ...localActivities].slice(0, 50)));

      // 2. Ako je prijavljeni korisnik, spremi i u Supabase
      if (userId && userId !== 'guest') {
        const { supabase } = await import('../services/supabaseClient');
        const { error } = await supabase
          .from('completed_activities')
          .insert({ ...activityPayload, user_id: userId });
        if (error) {
          console.warn('Upozorenje: aktivnost je spremljena lokalno, ali Supabase upis nije uspio:', error);
        }
      }
      
      setSelectedDateForNew(null);
      
      // Osvježi listu aktivnosti u kalendaru
      window.dispatchEvent(new CustomEvent('activity-title-updated', { detail: { activityId: 'refresh', newTitle: '' }}));
      
      alert("Aktivnost uspješno učitana!");
    } catch (err) {
      alert("Greška pri učitavanju aktivnosti: " + err.message);
    } finally {
      setIsUpdating(false);
      if (activityFileInputRef.current) activityFileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full carbon-panel rounded-xl flex flex-col h-full min-h-0 animate-in fade-in overflow-hidden">
      {/* Modali */}
      <WorkoutEditorModal
        workout={editingWorkout}
        isOpen={!!editingWorkout}
        onClose={() => setEditingWorkout(null)}
        onSave={handleSaveWorkout}
        isLoading={isUpdating}
        userFtp={profile?.ftp}
      />
      <ActivityDetailModal
        activity={viewingActivity}
        isOpen={!!viewingActivity}
        onClose={() => setViewingActivity(null)}
        intervalsId={intervalsId}
        intervalsKey={intervalsKey}
        userId={userId}
        userProfile={profile}
        workouts={workouts}
        wellnessData={wellnessData}
        onAddWorkoutToCalendar={handleCreateWorkout}
        onStartWorkoutInTrainer={onSelectWorkout}
      />
      {selectedDateForNew && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setSelectedDateForNew(null)}>
          <div className="carbon-panel rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-3.5 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedDateForNew(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200 transition-colors">
              <XCircle className="w-5 h-5" />
            </button>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">{selectedDateForNew}</span>
              <h2 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100">Dodaj u Kalendar</h2>
            </div>

            <button
              onClick={handleManualCreate}
              className="flex items-center gap-3.5 w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/50 transition-all group"
            >
              <div className="bg-volt-400/10 border border-volt-400/25 p-2.5 rounded-lg text-volt-400 group-hover:bg-volt-400 group-hover:text-zinc-950 transition-colors">
                <PenLine className="w-5 h-5" />
              </div>
              <div className="flex flex-col text-left">
                <span className="font-bold text-sm text-zinc-100">Ručni unos treninga</span>
                <span className="text-xs text-zinc-500">Kreiraj strukturirani trening (npr. - 10m 65%)</span>
              </div>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-3.5 w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-sky-500/50 transition-all group"
            >
              <div className="bg-sky-500/10 border border-sky-500/25 p-2.5 rounded-lg text-sky-400 group-hover:bg-sky-500 group-hover:text-zinc-950 transition-colors">
                <Upload className="w-5 h-5" />
              </div>
              <div className="flex flex-col text-left">
                <span className="font-bold text-sm text-zinc-100">Uvezi recept datoteku</span>
                <span className="text-xs font-mono text-zinc-500">.ZWO · .ERG</span>
              </div>
            </button>
            <input
              type="file"
              accept=".zwo,.erg"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />

            <button
              onClick={() => activityFileInputRef.current?.click()}
              className="flex items-center gap-3.5 w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 transition-all group"
            >
              <div className="bg-emerald-500/10 border border-emerald-500/25 p-2.5 rounded-lg text-emerald-400 group-hover:bg-emerald-500 group-hover:text-zinc-950 transition-colors">
                <Activity className="w-5 h-5" />
              </div>
              <div className="flex flex-col text-left">
                <span className="font-bold text-sm text-zinc-100">Odrađena aktivnost</span>
                <span className="text-xs font-mono text-zinc-500">.FIT · .TCX telemetrija</span>
              </div>
            </button>
            <input
              type="file"
              accept=".fit,.tcx"
              ref={activityFileInputRef}
              style={{ display: 'none' }}
              onChange={handleActivityFileUpload}
            />
          </div>
        </div>
      )}

      {/* FIKSNO ZAGLAVLJE KALENDARA */}
      <div className="flex flex-col z-20 shrink-0 relative">
        <div className="flex items-center justify-between px-4 py-3 short:py-1.5 border-b border-zinc-800 bg-zinc-950 relative z-50">
        {/* Month/Year button that opens mini calendar picker */}
        <div className="relative" ref={monthPickerRef}>
          <button
            onClick={() => setShowMonthPicker(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors group"
          >
            <span className="font-display font-bold uppercase tracking-wide text-base md:text-lg text-zinc-100">{headerLabel}</span>
            <ChevronRight className={`w-4 h-4 text-zinc-400 group-hover:text-volt-400 transition-all duration-200 ${showMonthPicker ? 'rotate-90 text-volt-400' : 'rotate-0'}`} />
          </button>

          {/* Mini calendar dropdown */}
          {showMonthPicker && (
            <div className="absolute top-full left-0 mt-2 z-50 carbon-panel rounded-xl shadow-2xl p-4 w-72 select-none">
              {/* Picker header */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => {
                    if (pickerMonth === 0) { setPickerMonth(11); setPickerYear(y => y - 1); }
                    else setPickerMonth(m => m - 1);
                  }}
                  className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold uppercase tracking-wide text-sm text-zinc-100">{monthNames[pickerMonth]}</span>
                  <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-md px-2 py-0.5 font-mono telemetry-num">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPickerYear(y => y - 1); }}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors text-xs font-bold"
                    >‹</button>
                    <span className="font-bold text-xs text-volt-400 min-w-[36px] text-center">{pickerYear}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPickerYear(y => y + 1); }}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors text-xs font-bold"
                    >›</button>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (pickerMonth === 11) { setPickerMonth(0); setPickerYear(y => y + 1); }
                    else setPickerMonth(m => m + 1);
                  }}
                  className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"].map(d => (
                  <div key={d} className="text-center text-[10px] font-mono font-bold text-zinc-500 uppercase py-1">{d}</div>
                ))}
              </div>

              {/* Days grid */}
              {(() => {
                const firstDay = new Date(pickerYear, pickerMonth, 1).getDay();
                const offset = firstDay === 0 ? 6 : firstDay - 1;
                const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
                const prevDays = new Date(pickerYear, pickerMonth, 0).getDate();
                const cells = [];

                for (let i = offset - 1; i >= 0; i--) {
                  cells.push({ day: prevDays - i, month: pickerMonth - 1, year: pickerMonth === 0 ? pickerYear - 1 : pickerYear, current: false });
                }
                for (let i = 1; i <= daysInMonth; i++) {
                  cells.push({ day: i, month: pickerMonth, year: pickerYear, current: true });
                }
                let nx = 1;
                while (cells.length % 7 !== 0) {
                  cells.push({ day: nx++, month: pickerMonth + 1, year: pickerMonth === 11 ? pickerYear + 1 : pickerYear, current: false });
                }

                const todayD = new Date();
                const rows = [];
                for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

                return rows.map((row, ri) => (
                  <div key={ri} className="grid grid-cols-7">
                    {row.map((cell, ci) => {
                      const isToday = cell.day === todayD.getDate() && cell.month === todayD.getMonth() && cell.year === todayD.getFullYear();
                      const isSelected = cell.day === currentDate.getDate() && cell.month === currentDate.getMonth() && cell.year === currentDate.getFullYear();
                      return (
                        <button
                          key={ci}
                          onClick={() => {
                            setCurrentDate(new Date(cell.year, cell.month, cell.day));
                            setShowMonthPicker(false);
                          }}
                          className={`
                            text-center text-xs font-mono telemetry-num py-1.5 rounded-md mx-0.5 my-0.5 transition-colors font-medium
                            ${isSelected ? 'bg-volt-400 text-zinc-950 font-bold' : ''}
                            ${isToday && !isSelected ? 'ring-1 ring-volt-400 text-volt-400 font-bold' : ''}
                            ${!isSelected && !isToday && cell.current ? 'text-zinc-200 hover:bg-zinc-800' : ''}
                            ${!isSelected && !isToday && !cell.current ? 'text-zinc-600 hover:bg-zinc-900' : ''}
                          `}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        {/* Week navigation */}
        <div className="flex items-stretch bg-zinc-900 rounded-lg p-1 border border-zinc-800 gap-1">
          <button
            onClick={goWeekBack}
            title="Prošli tjedan (-7 dana)"
            className="px-2 py-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors flex flex-col items-center justify-center gap-0.5 group/nav"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-500 group-hover/nav:text-zinc-300 leading-none">-1 tjedan</span>
          </button>
          <button
            onClick={goToday}
            title="Idi na današnji tjedan"
            className="px-3 py-1 hover:bg-zinc-800 rounded text-[11px] font-mono font-bold text-volt-400 uppercase tracking-wider transition-colors flex flex-col items-center justify-center border-x border-zinc-800/80"
          >
            <span>Danas</span>
          </button>
          <button
            onClick={goWeekForward}
            title="Sljedeći tjedan (+7 dana)"
            className="px-2 py-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors flex flex-col items-center justify-center gap-0.5 group/nav"
          >
            <ChevronRight className="w-4 h-4" />
            <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-500 group-hover/nav:text-zinc-300 leading-none">+1 tjedan</span>
          </button>
        </div>
      </div>

        <div className="hidden md:grid grid-cols-8 border-b border-zinc-800 bg-zinc-900/95 font-mono font-bold text-[11px] text-zinc-400 uppercase tracking-[0.18em]">
          {dayNames.map((d, i) => <div key={i} className="py-2.5 short:py-1.5 px-3 border-r border-zinc-800/80">{d}</div>)}
          <div className="py-2.5 short:py-1.5 text-center bg-volt-400/10 text-volt-400 border-l border-zinc-800">Sažetak</div>
        </div>
      </div>

      <div className="flex md:hidden flex-col bg-zinc-950 gap-[1px] flex-1 overflow-y-auto">
        {calDays.filter(d => d.isCurrentMonth).map((dObj) => (
          <CalendarDay
            key={dObj.dateStr}
            dObj={dObj}
            dWorks={workoutsByDate[dObj.dateStr] || []}
            isTdy={dObj.dateStr === todayStr}
            dWell={wellnessData[dObj.dateStr]}
            isDesktop={false}
            todayStr={todayStr}
            activeId={null}
            onSelectWorkout={onSelectWorkout}
            handleUnpair={handleUnpair}
            handlePair={handlePair}
            handleDeleteLocalActivity={handleDeleteLocalActivity}
            handleDeleteCompletedActivity={handleDeleteCompletedActivity}
            onViewActivity={setViewingActivity}
            onEditWorkout={setEditingWorkout}
            onAddWorkoutClick={setSelectedDateForNew}
          />
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="hidden md:flex flex-1 flex-col bg-zinc-800 border-l border-zinc-800 gap-[1px] overflow-y-auto">
          {threeWeeks.map(({ days, isActive }, wi) => {
            let aT_cycle = 0; let pT_cycle = 0; let aD = 0; let pD = 0;
            let aT_other = 0; let pT_other = 0; let aD_other = 0; let pD_other = 0;
            
            // Week label: date range
            const wStart = days[0];
            const wEnd = days[6];
            const mn = ["Sij", "Velj", "Ožu", "Tra", "Svi", "Lip", "Srp", "Kol", "Ruj", "Lis", "Stu", "Pro"];
            const weekRangeLabel = wStart.month === wEnd.month
              ? `${wStart.day}–${wEnd.day} ${mn[wStart.month]}`
              : `${wStart.day} ${mn[wStart.month]} – ${wEnd.day} ${mn[wEnd.month]}`;

            const weekStartStr = wStart.dateStr;
            const weekEndStr = wEnd.dateStr;
            const isPastWeek = weekEndStr < todayStr;
            const isFutureWeek = weekStartStr > todayStr;
            const isCurrentCalendarWeek = !isPastWeek && !isFutureWeek;

            // CTL/ATL/TSB — Projekcija na kraju tjedna (nedjelja)
            let endCtl = null, endAtl = null, endTsb = null;
            for (let di = 6; di >= 0; di--) {
              const wd = wellnessData?.[days[di].dateStr];
              if (wd && wd.ctl != null) {
                endCtl = Math.round(Number(wd.ctl));
                endAtl = Math.round(Number(wd.atl));
                endTsb = endCtl - endAtl;
                break;
              }
            }

            // CTL/ATL/TSB — Trenutno stanje (do današnjeg dana)
            let currentCtl = null, currentAtl = null, currentTsb = null;
            if (!isFutureWeek) {
              for (let di = 6; di >= 0; di--) {
                if (days[di].dateStr <= todayStr) {
                  const wd = wellnessData?.[days[di].dateStr];
                  if (wd && (wd.actualCtl != null || wd.ctl != null)) {
                    const cRaw = isPastWeek ? wd.ctl : (wd.actualCtl ?? wd.ctl);
                    const aRaw = isPastWeek ? wd.atl : (wd.actualAtl ?? wd.atl);
                    currentCtl = Math.round(Number(cRaw));
                    currentAtl = Math.round(Number(aRaw));
                    currentTsb = currentCtl - currentAtl;
                    break;
                  }
                }
              }
            }

            const todayWell = wellnessData?.[todayStr];
            const showWeekProjection = isCurrentCalendarWeek && (weekEndStr > todayStr || Boolean(todayWell?.hasUncompletedToday));

            // Prikaz: za tekući tjedan u tijeku uvijek prikaži "trenutno (projekcija u ned)", za budući "(projekcija)", za prošli "konačno"
            const renderMetric = (curr, plan) => {
              if (curr != null && plan != null && (showWeekProjection || curr !== plan)) {
                return `${curr} (${plan})`;
              }
              if (curr != null) return `${curr}`;
              if (plan != null) return `(${plan})`;
              return null;
            };

            const displayCtl = renderMetric(currentCtl, endCtl);
            const displayAtl = renderMetric(currentAtl, endAtl);
            
            const formatSigned = (v) => (v > 0 ? `+${v}` : `${v}`);
            const displayTsb = () => {
              if (currentTsb != null && endTsb != null && (showWeekProjection || currentTsb !== endTsb)) {
                return `${formatSigned(currentTsb)} (${formatSigned(endTsb)})`;
              }
              if (currentTsb != null) return formatSigned(currentTsb);
              if (endTsb != null) return `(${formatSigned(endTsb)})`;
              return null;
            };
            const renderedTsb = displayTsb();
            const colorTsbVal = currentTsb != null ? currentTsb : endTsb;

            // Ramp Rate — CTL na kraju prošlog tjedna (nedjelja prije ovog ponedjeljka) u odnosu na trenutni / projicirani nedjeljni CTL
            let prevWeekCtl = null;
            const mondayDate = new Date(days[0].year, days[0].month, days[0].day);
            for (let di = 6; di >= 0; di--) {
              const prevDate = new Date(mondayDate);
              prevDate.setDate(prevDate.getDate() - 7 + di);
              const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
              const pwd = wellnessData?.[prevDateStr];
              if (pwd && pwd.ctl != null) {
                prevWeekCtl = Math.round(Number(pwd.ctl));
                break;
              }
            }
            
            const currentRamp = currentCtl != null && prevWeekCtl != null ? currentCtl - prevWeekCtl : null;
            const endRamp = endCtl != null && prevWeekCtl != null ? endCtl - prevWeekCtl : null;
            
            const displayRamp = () => {
              if (currentRamp != null && endRamp != null && (showWeekProjection || currentRamp !== endRamp)) {
                return `${formatSigned(currentRamp)} (${formatSigned(endRamp)})`;
              }
              if (currentRamp != null) return formatSigned(currentRamp);
              if (endRamp != null) return `(${formatSigned(endRamp)})`;
              return null;
            };
            const renderedRamp = displayRamp();
            const colorRampVal = endRamp != null && isFutureWeek ? endRamp : (currentRamp != null ? currentRamp : endRamp);

            const getTsbColor = (tsb) => {
              if (tsb == null) return 'text-zinc-600';
              if (tsb > 25) return 'text-amber-400';
              if (tsb >= 5) return 'text-emerald-400';
              if (tsb >= -10) return 'text-zinc-400';
              return 'text-rose-400';
            };
            const getRampColor = (rr) => {
              if (rr == null) return 'text-zinc-600';
              if (rr > 8) return 'text-orange-400';  // agresivan ramp — rizik
              if (rr >= 3) return 'text-emerald-400'; // optimalan ramp
              if (rr >= 0) return 'text-zinc-400';    // umjeren / neutralan
              if (rr >= -5) return 'text-sky-400';    // lagani taper
              return 'text-rose-400';                  // agresivan taper / pad
            };

            return (
              <div
                key={wi}
                className={`grid grid-cols-8 gap-[1px] shrink-0 transition-all
                  ${isActive
                    ? 'min-h-[168px] ring-1 ring-inset ring-volt-400/35'
                    : 'min-h-[112px] opacity-65 hover:opacity-90'
                  }`}
              >
                {days.map((dObj) => {
                  const dWorks = workoutsByDate[dObj.dateStr] || [];
                  dWorks.forEach(w => {
                    const actTssVal = Math.max(0, Math.round(Number(w.tss) || 0));
                    const planTssVal = Math.max(0, Math.round(Number(w.plannedTss ?? w.tss) || 0));
                    const actDurVal = Math.max(0, Math.round(Number(w.duration) || 0));
                    const planDurVal = Math.max(0, Math.round(Number(w.plannedDuration ?? w.duration) || 0));

                    if (w.isCompleted) {
                      if (w.category !== 'OTHER') {
                        aT_cycle += actTssVal;
                        aD += actDurVal;
                        if (w.plannedTss != null && Number(w.plannedTss) > 0) {
                          pT_cycle += Math.round(Number(w.plannedTss));
                        }
                        if (w.plannedDuration != null && Number(w.plannedDuration) > 0) {
                          pD += Math.round(Number(w.plannedDuration));
                        }
                      } else {
                        aT_other += actTssVal;
                        aD_other += actDurVal;
                        if (w.plannedTss != null && Number(w.plannedTss) > 0) {
                          pT_other += Math.round(Number(w.plannedTss));
                        }
                        if (w.plannedDuration != null && Number(w.plannedDuration) > 0) {
                          pD_other += Math.round(Number(w.plannedDuration));
                        }
                      }
                    } else {
                      if (w.category !== 'OTHER') {
                        pT_cycle += planTssVal;
                        pD += planDurVal;
                      } else {
                        pT_other += planTssVal;
                        pD_other += planDurVal;
                      }
                    }
                  });
                  return (
                    <CalendarDay
                      key={dObj.dateStr}
                      dObj={dObj}
                      dWorks={dWorks}
                      isTdy={dObj.dateStr === todayStr}
                      dWell={wellnessData?.[dObj.dateStr]}
                      isDesktop={true}
                      todayStr={todayStr}
                      activeId={activeId}
                      onSelectWorkout={onSelectWorkout}
                      handleUnpair={handleUnpair}
                      handlePair={handlePair}
                      handleDeleteLocalActivity={handleDeleteLocalActivity}
                      handleDeleteCompletedActivity={handleDeleteCompletedActivity}
                      onEditWorkout={setEditingWorkout}
                      onViewActivity={setViewingActivity}
                      onAddWorkoutClick={setSelectedDateForNew}
                      compact={false}
                    />
                  );
                })}

                {/* Week summary column */}
                {(() => {
                  const hasCycle = aT_cycle > 0 || pT_cycle > 0 || aD > 0 || pD > 0;
                  const mainActualDur = hasCycle ? aD : aD_other;
                  const mainPlannedDur = hasCycle ? pD : pD_other;
                  const mainActualTss = hasCycle ? aT_cycle : aT_other;
                  const mainPlannedTss = hasCycle ? pT_cycle : pT_other;

                  const durPctRaw = mainPlannedDur > 0 ? Math.round((mainActualDur / mainPlannedDur) * 100) : (mainActualDur > 0 ? 100 : 0);
                  const durBarPct = Math.min(100, durPctRaw);
                  const tssPctRaw = mainPlannedTss > 0 ? Math.round((mainActualTss / mainPlannedTss) * 100) : (mainActualTss > 0 ? 100 : 0);
                  const tssBarPct = Math.min(100, tssPctRaw);

                  const pmcHeaderLabel = showWeekProjection
                    ? 'PMC · DANAS (NED)'
                    : isFutureWeek
                    ? 'PMC · PROJEKCIJA'
                    : 'PMC FORMA';

                  return (
                    <div className={`p-3 flex flex-col justify-between border-l border-zinc-800 text-right font-mono telemetry-num
                      ${isActive ? 'bg-zinc-900/90' : 'bg-zinc-950/90'}`}
                    >
                      <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isActive ? 'text-volt-400' : 'text-zinc-500'}`}>
                        {weekRangeLabel}
                      </p>
                      <div className="space-y-2.5">
                        <div>
                          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider mb-0.5">
                            <span className={isActive ? 'text-zinc-400' : 'text-zinc-600'}>VRIJEME</span>
                            {mainPlannedDur > 0 && <span className={durPctRaw >= 90 ? 'text-volt-400' : 'text-zinc-500'}>{durPctRaw}%</span>}
                          </div>
                          <div className="flex items-center justify-end gap-1 text-[11px]" title="Odrađeno / Planirano vrijeme">
                            <Clock className={`w-3 h-3 mr-auto ${isActive ? 'text-volt-400' : 'text-zinc-600'}`} />
                            <span className={`font-bold ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`}>{formatDur(mainActualDur)}</span>
                            <span className="text-zinc-700">/</span>
                            <span className="text-zinc-500">{formatDur(mainPlannedDur)}</span>
                          </div>
                          <div className="h-1 w-full bg-zinc-950 border border-zinc-800/80 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full transition-all duration-500 ${isActive ? 'bg-volt-400' : 'bg-zinc-500'}`}
                              style={{ width: `${durBarPct}%` }}
                            />
                          </div>
                        </div>

                        <div className={`pt-2 border-t ${isActive ? 'border-zinc-800' : 'border-zinc-800/60'}`}>
                          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider mb-0.5">
                            <span className={isActive ? 'text-zinc-400' : 'text-zinc-600'}>TSS LOAD</span>
                            {mainPlannedTss > 0 && <span className={tssPctRaw >= 90 ? 'text-volt-400' : 'text-zinc-500'}>{tssPctRaw}%</span>}
                          </div>
                          <div className="flex items-center justify-end gap-1 text-[11px]" title="Odrađeni TSS / Planirani TSS">
                            {hasCycle ? (
                              <Bike className={`w-3 h-3 mr-auto ${isActive ? 'text-zinc-400' : 'text-zinc-600'}`} />
                            ) : (
                              <Activity className={`w-3 h-3 mr-auto ${isActive ? 'text-zinc-400' : 'text-zinc-600'}`} />
                            )}
                            <span className={`font-bold ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`}>{mainActualTss}</span>
                            <span className="text-zinc-700">/</span>
                            <span className="text-zinc-500">{mainPlannedTss}</span>
                          </div>
                          <div className="h-1 w-full bg-zinc-950 border border-zinc-800/80 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full transition-all duration-500 ${isActive ? 'bg-volt-400' : 'bg-zinc-500'}`}
                              style={{ width: `${tssBarPct}%` }}
                            />
                          </div>
                          {hasCycle && (aT_other > 0 || pT_other > 0) && (
                            <div className="flex items-center justify-end gap-1 text-[10px] mt-1" title="Ostali sportovi TSS (ulazi u PMC projekciju)">
                              <Activity className="w-2.5 h-2.5 mr-auto text-zinc-500" />
                              <span className="font-bold text-zinc-300">{aT_other}</span>
                              <span className="text-zinc-700">/</span>
                              <span className="text-zinc-500">{pT_other}</span>
                            </div>
                          )}
                        </div>

                        {/* CTL / ATL / TSB blok s projekcijom u zagradama */}
                        {(displayCtl != null || displayAtl != null) && (
                          <div
                            className={`pt-2 border-t ${isActive ? 'border-zinc-800' : 'border-zinc-800/60'}`}
                            title={showWeekProjection ? 'Prvi broj = trenutno stanje danas · (u zagradi) = projekcija na kraju tjedna u nedjelju prema planu' : 'Projekcija / stanje kondicije na kraju tjedna'}
                          >
                            <p className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${isActive ? 'text-sky-400' : 'text-zinc-600'}`}>
                              {pmcHeaderLabel}
                            </p>
                            <div className="flex flex-col gap-0.5 items-end text-[11px]">
                              {displayCtl != null && (
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-zinc-500 text-[10px] font-bold">CTL</span>
                                  <span className={`font-bold ${isActive ? 'text-sky-400' : 'text-zinc-400'}`}>{displayCtl}</span>
                                </div>
                              )}
                              {displayAtl != null && (
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-zinc-500 text-[10px] font-bold">ATL</span>
                                  <span className={`font-bold ${isActive ? 'text-purple-400' : 'text-zinc-400'}`}>{displayAtl}</span>
                                </div>
                              )}
                              {renderedTsb != null && (
                                <div className="flex items-center justify-between w-full mt-0.5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800/80">
                                  <span className="text-zinc-500 text-[10px] font-bold">TSB</span>
                                  <span className={`font-bold ${getTsbColor(colorTsbVal)}`}>
                                    {renderedTsb}
                                  </span>
                                </div>
                              )}
                              {renderedRamp != null && (
                                <div className="flex items-center justify-between w-full mt-0.5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800/80" title="Ramp Rate: tjedna promjena CTL-a (optimalno +3 do +8)">
                                  <span className="text-zinc-500 text-[10px] font-bold">RR</span>
                                  <span className={`font-bold ${getRampColor(colorRampVal)}`}>
                                    {renderedRamp}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <DragOverlay
          modifiers={[snapCenterToCursor]}
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
        >
          {activeWorkout ? <DragOverlayCard workout={activeWorkout} activeWidth={activeWidth} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
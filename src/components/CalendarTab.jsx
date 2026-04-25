import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Activity, CheckCircle2, XCircle, Target, Unlink, Link2, Heart, Moon, Play, Trash2, GripVertical, Bike } from 'lucide-react';
import { DndContext, pointerWithin, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import WorkoutEditorModal from './WorkoutEditorModal';
import { updateEventDetails } from '../services/intervalsApi';
import ActivityDetailModal from './ActivityDetailModal';
import { extractIntensityData } from '../utils/workoutParser';

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

const isDraggable = (w) => !w.isCompleted && (w.isLocal || w.id.startsWith('ev-'));

const ZONE_COLORS = {
  1: 'bg-slate-500',
  2: 'bg-emerald-500',
  3: 'bg-amber-400',
  4: 'bg-orange-500',
  5: 'bg-rose-500'
};

const BORDER_COLORS = {
  1: 'border-slate-500',
  2: 'border-emerald-500',
  3: 'border-amber-400',
  4: 'border-orange-500',
  5: 'border-rose-500'
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

const DEFAULT_INTENSITY = [
  { ftpPercent: 50 }, { ftpPercent: 50 }, { ftpPercent: 65 }, { ftpPercent: 65 }, { ftpPercent: 80 },
  { ftpPercent: 50 }, { ftpPercent: 95 }, { ftpPercent: 95 }, { ftpPercent: 50 }, { ftpPercent: 110 },
  { ftpPercent: 50 }, { ftpPercent: 65 }, { ftpPercent: 65 }, { ftpPercent: 50 }
];

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

  const displayData = intensityArray.length > 0 ? intensityArray : DEFAULT_INTENSITY.map(d => d.ftpPercent);

  return (
    <div className="relative flex items-end h-10 w-full mt-2.5 bg-zinc-950/60 rounded-sm overflow-hidden">
      {displayData.map((val, i) => {
        const zone = getZoneFromFtpPercent(val);
        // Maksimalna visina je 150% FTP-a
        const heightPercent = Math.min((val / 150) * 100, 100);

        return (
          <div
            key={i}
            // isCompleted određuje hoće li boja biti puna ili izblijedjela (opacity-40)
            className={`flex-1 transition-all duration-300 ${ZONE_COLORS[zone]} ${isCompleted ? 'opacity-100' : 'opacity-40'}`}
            style={{
              height: `${heightPercent}%`,
              minWidth: '1px' // Sprječava da stupac potpuno nestane ako ih ima previše
            }}
          />
        );
      })}

      {/* 100% FTP Baseline Indikator (Suptilna linija praga) */}
      <div className="absolute bottom-[66.6%] left-0 w-full border-b border-white/10 pointer-events-none" />
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
      className={`workout-card-element rounded-lg flex flex-col overflow-hidden ${compact ? 'min-h-[40px]' : 'min-h-[100px]'} backdrop-blur-sm transition-all duration-150 ${getCardBg(w.statusColor)} ${isCurrentMonth === false ? 'opacity-60 saturate-50' : ''} ${isDragging ? 'opacity-20 border-dashed border-2 border-orange-500' : ''} ${canDrag && !isDragging ? 'cursor-grab hover:shadow-[0_0_15px_rgba(249,115,22,0.15)]' : ''}`}
    >
      <div className={`h-1.5 w-full shrink-0 ${getTopCol(w.statusColor)}`} />
      <div className={`${isDesktop ? (compact ? 'p-1.5' : 'p-3') : 'p-3.5'} flex flex-col justify-between flex-1`}>
        {compact ? (
          // Compact: just title + duration + status icon
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-[9px] font-bold text-zinc-300 truncate flex-1">{w.title}</span>
            <span className="text-[9px] text-zinc-500 shrink-0">{formatDur(w.duration)}</span>
            {w.statusColor === 'green' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
            {w.statusColor === 'red-missed' && <XCircle className="w-3 h-3 text-rose-500 shrink-0" />}
          </div>
        ) : (
          <div className="flex flex-col gap-1 w-full">
            {/* Header: Sport icon, duration, actions */}
            <div className="flex justify-between items-start w-full">
              <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-bold uppercase tracking-wide">
                <Bike className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                <span title={w.plannedDuration ? `Plan: ${formatDur(w.plannedDuration)}` : ''}>
                  {formatDur(w.duration)}
                  {!isDesktop && w.plannedDuration && <span className="text-zinc-600 text-[9px] ml-1">/ {formatDur(w.plannedDuration)}</span>}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-1" onPointerDown={(e) => { }}>
                {!w.isCompleted && onSelectWorkout && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onSelectWorkout(w); }}
                    className={`text-orange-400 hover:text-white bg-orange-500/10 hover:bg-orange-500 ${isDesktop ? 'rounded-md p-1' : 'rounded-lg p-1.5 shadow-[0_0_8px_rgba(249,115,22,0.2)] hover:shadow-[0_0_12px_rgba(249,115,22,0.6)]'} transition-all border border-orange-500/20`}
                    title="Pošalji na trenažer"
                  >
                    <Play className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill-current`} />
                  </button>
                )}
                {w.actId && w.eventId && (
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleUnpair(w.actId, w.eventId); }} className="text-zinc-500 hover:text-orange-400 transition-colors" title="Razdvoji planirano i odrađeno">
                    <Unlink className="w-3.5 h-3.5" />
                  </button>
                )}
                {w.actId && w.separatedEventIds && w.separatedEventIds.map(sepId => (
                  <button key={sepId} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handlePair(w.actId, sepId); }} className="text-zinc-500 hover:text-emerald-400 transition-colors" title="Spoji s planiranim treningom">
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                ))}
                {w.statusColor === 'green' && <CheckCircle2 className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-emerald-400 drop-shadow-[0_0_${isDesktop ? '3' : '5'}px_rgba(16,185,129,0.5)]`} />}
                {w.statusColor === 'red-missed' && <XCircle className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-rose-500`} />}
                {w.statusColor === 'grey' && !w.isLocal && <Target className="w-3.5 h-3.5 text-zinc-500" />}
                {w.isLocal && !w.isCompleted && handleDeleteLocalActivity && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleDeleteLocalActivity(w.id); }}
                    className={`text-zinc-${isDesktop ? '600' : '500'} hover:text-red-500 rounded${isDesktop ? ' p-0.5' : '-lg p-1'} transition-colors`}
                    title="Obriši planirani trening"
                  >
                    <Trash2 className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                  </button>
                )}
                {w.isSupabase && w.isCompleted && handleDeleteCompletedActivity && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (window.confirm('Sigurno želiš obrisati ovaj odrađeni trening?')) {
                        const result = await handleDeleteCompletedActivity(w.id);
                        if (!result.success) alert('Greška pri brisanju: ' + (result.error || 'Nepoznata greška'));
                      }
                    }}
                    className={`text-zinc-${isDesktop ? '600' : '500'} hover:text-red-500 rounded${isDesktop ? ' p-0.5' : '-lg p-1'} transition-colors`}
                    title="Obriši odrađeni trening"
                  >
                    <Trash2 className={`${isDesktop ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                  </button>
                )}
              </div>
            </div>
            {/* Title */}
            <div className={`font-bold ${isDesktop ? 'text-xs' : 'text-sm'} text-zinc-100 leading-tight line-clamp-3`}>
              {canDrag && <GripVertical className="inline-block w-3 h-3 mr-0.5 -ml-1 text-zinc-500 align-middle pointer-events-none" />}
              {w.title}
              {w.isSupabase && w.workout_source && (
                <span className="ml-1.5 inline-flex items-center bg-violet-500/10 text-violet-400 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/20">
                  {w.workout_source === 'calendar' ? '📅 Kalendar' :
                   w.workout_source === 'library' ? '📚 Knjižnica' :
                   w.workout_source === 'free_ride' ? '🚴 Slobodno' :
                   w.workout_source === 'garmin' ? '🟢 Garmin' :
                   w.workout_source === 'strava' ? '🟠 Strava' :
                   w.workout_source === 'wahoo' ? '🔵 Wahoo' :
                   w.workout_source === 'external' ? '🌐 Vanjski' :
                   w.workout_source}
                </span>
              )}
            </div>
            {/* Metrics */}
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {w.isCompleted ? (
                  // Odrađeni trening: TSS ostvareni / planirani + postotak u boji kartice
                  <>
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">TSS</span>
                    <span className="font-mono text-xs font-semibold text-zinc-200">{w.tss > 0 ? w.tss : '-'}</span>
                    {w.plannedTss > 0 && (
                      <>
                        <span className="text-[9px] text-zinc-600">/</span>
                        <span className="font-mono text-xs text-zinc-500">{w.plannedTss}</span>
                      </>
                    )}
                    {w.plannedTss > 0 && w.tss > 0 && (
                      <span className={`text-[9px] font-black ${
                        w.statusColor === 'green' ? 'text-emerald-400' :
                        w.statusColor === 'yellow' ? 'text-amber-400' :
                        w.statusColor === 'red' ? 'text-rose-400' :
                        'text-zinc-400'
                      }`}>
                        {Math.round((w.tss / w.plannedTss) * 100)}%
                      </span>
                    )}
                  </>
                ) : (
                  // Planirani trening: samo planirani TSS
                  <>
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">TSS</span>
                    <span className="font-mono text-xs font-semibold text-zinc-400">{w.plannedTss > 0 ? w.plannedTss : '-'}</span>
                  </>
                )}
              </div>
              {w.intervalDescription && (
                <span className="text-[10px] text-zinc-400/80 leading-tight line-clamp-1 italic">{w.intervalDescription}</span>
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
const CalendarDay = React.memo(function CalendarDay({ dObj, dWorks, isTdy, dWell, isDesktop, todayStr, activeId, onSelectWorkout, handleUnpair, handlePair, handleDeleteLocalActivity, handleDeleteCompletedActivity, onEditWorkout, onViewActivity, compact }) {
  const { isOver, setNodeRef } = useDroppable({ id: dObj.dateStr });

  if (!isDesktop) {
    const dayNames = ["PON", "UTO", "SRI", "ČET", "PET", "SUB", "NED"];
    const dayOfWeek = dayNames[(new Date(dObj.dateStr).getDay() + 6) % 7];
    return (
      <div className={`p-4 flex flex-col bg-zinc-900/60 ${isTdy ? 'border-l-4 border-l-orange-500 shadow-[inset_4px_0_10px_rgba(249,115,22,0.1)]' : ''}`}>
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
            <WorkoutCard key={w.id} w={w} isDesktop={false} isDragging={false} onSelectWorkout={onSelectWorkout} handleUnpair={handleUnpair} handlePair={handlePair} handleDeleteLocalActivity={handleDeleteLocalActivity} handleDeleteCompletedActivity={handleDeleteCompletedActivity} onEditWorkout={onEditWorkout} onViewActivity={onViewActivity} />
          )) : (
            <div className="text-xs text-zinc-600 italic px-2 py-2 bg-zinc-900/40 rounded-lg border border-zinc-800 border-dashed mr-auto">Odmor</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col group relative transition-all duration-200
        ${compact ? 'p-1.5' : 'p-3'}
        ${dObj.isCurrentMonth ? 'bg-zinc-900/60 hover:bg-zinc-800/80 cursor-pointer' : 'bg-zinc-950/80'}
        ${isTdy ? 'ring-inset ring-2 ring-orange-500' : ''}
        ${isOver ? 'bg-orange-500/10 ring-2 ring-orange-500/50 ring-inset shadow-[inset_0_0_20px_rgba(249,115,22,0.1)]' : ''}
      `}
      onClick={(e) => {
        if (e.target.closest('.workout-card-element')) return;
        if (!compact && dObj.isCurrentMonth) {
          const newWorkout = {
            id: `local-${Date.now()}`,
            date: dObj.dateStr,
            title: 'Novi Trening',
            duration: 60,
            plannedDuration: 60,
            tss: 0,
            plannedTss: 0,
            statusColor: 'grey',
            isCompleted: false,
            isLocal: true,
            category: 'WORKOUT',
            type: 'ride',
            intervalDescription: 'Slatka točka: 3x15m na 90%',
            steps: [{ duration: 600, power: 50 }, { duration: 900, power: 90 }, { duration: 300, power: 50 }, { duration: 900, power: 90 }, { duration: 300, power: 50 }, { duration: 900, power: 90 }, { duration: 600, power: 50 }]
          };
          onEditWorkout(newWorkout);
        }
      }}
    >
      <div className={`flex justify-between items-start ${compact ? 'mb-1' : 'mb-3'}`}>
        <span className={`font-bold ${compact ? 'text-[10px]' : 'text-xs'} ${isTdy ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]' : (dObj.isCurrentMonth ? 'text-zinc-400' : 'text-zinc-600')}`}>{dObj.day}</span>
        {!compact && dWell && (
          <div className="flex gap-2 text-[10px] font-bold text-zinc-500">
            {dWell.restingHR && <span className="flex items-center text-rose-500/80"><Heart className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.restingHR}</span>}
            {dWell.sleep && <span className="flex items-center text-indigo-400/80"><Moon className="w-3 h-3 mr-0.5" fill="currentColor" />{dWell.sleep}</span>}
          </div>
        )}
        {compact && dWell && (
          <div className="flex gap-1 text-[9px] font-bold text-zinc-600">
            {dWell.restingHR && <span className="flex items-center text-rose-500/60"><Heart className="w-2.5 h-2.5" fill="currentColor" />{dWell.restingHR}</span>}
          </div>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto pr-1 custom-scrollbar ${compact ? 'space-y-1' : 'space-y-3'}`}>
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
      className="rounded-lg overflow-hidden border-2 border-orange-500/80 bg-zinc-900/95 shadow-2xl shadow-orange-500/30 backdrop-blur-xl pointer-events-none cursor-grabbing scale-105 opacity-90 transition-transform flex flex-col"
    >
      <div className={`h-1.5 w-full ${getTopCol(workout.statusColor)}`} />
      <div className="p-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-bold uppercase tracking-wide">
          <Bike className="w-3.5 h-3.5" />
          <span>{formatDur(workout.duration)}</span>
        </div>
        <span className="font-bold text-xs text-zinc-100 line-clamp-1 leading-tight">{workout.title}</span>
        <div className="flex items-baseline gap-1 bg-zinc-950/40 rounded px-1.5 py-0.5 border border-zinc-800/50 w-fit mt-1">
          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Load</span>
          <span className="font-mono text-xs font-semibold text-zinc-200">{workout.tss > 0 ? workout.tss : '-'}</span>
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
export default function CalendarTab({ currentDate, setCurrentDate, workouts, wellnessData, handleUnpair, handlePair, handleDeleteLocalActivity, handleDeleteCompletedActivity, handleRescheduleWorkout, handleUpdateWorkout, handleCreateWorkout, onSelectWorkout, profile, intervalsId, intervalsKey }) {
  const cy = currentDate.getFullYear();
  const cm = currentDate.getMonth();
  const [activeId, setActiveId] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [activeWidth, setActiveWidth] = useState(0);
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [viewingActivity, setViewingActivity] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(cm);
  const [pickerYear, setPickerYear] = useState(cy);
  const monthPickerRef = useRef(null);

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
      return { day: d.getDate(), dateStr, month: d.getMonth(), year: d.getFullYear() };
    });
  }, [currentDate]);

  const prevWeek    = useMemo(() => buildWeek(-1), [buildWeek]);
  const currentWeek = useMemo(() => buildWeek(0),  [buildWeek]);
  const nextWeek    = useMemo(() => buildWeek(1),  [buildWeek]);

  const threeWeeks = [
    { days: prevWeek,    isActive: false },
    { days: currentWeek, isActive: true  },
    { days: nextWeek,    isActive: false },
  ];

  // Month picker sync — use the month of Monday of current week
  const weekStartMonth = currentWeek[0].month;
  const weekStartYear  = currentWeek[0].year;

  // Header label: month(s) and year of the active week
  const headerLabel = useMemo(() => {
    const start = currentWeek[0];
    const end   = currentWeek[6];
    const mn = ["siječnja","veljače","ožujka","travnja","svibnja","lipnja","srpnja","kolovoza","rujna","listopada","studenog","prosinca"];
    const mnKratki = ["Sij","Velj","Ožu","Tra","Svi","Lip","Srp","Kol","Ruj","Lis","Stu","Pro"];

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
  const todayStr = new Date().toISOString().split('T')[0];

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
      if (updatedWorkout.id.startsWith('local-')) {
        await handleCreateWorkout(updatedWorkout);
      } else {
        await handleUpdateWorkout(
          updatedWorkout.id,
          updatedWorkout.title,
          updatedWorkout.description,
          updatedWorkout.tss,
          updatedWorkout.duration
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

  return (
    <div className="max-w-[1600px] mx-auto bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-800/80 flex flex-col min-h-[700px] animate-in fade-in overflow-hidden">
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
      />
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/80 bg-zinc-950/50">
        {/* Month/Year button that opens mini calendar picker */}
        <div className="relative" ref={monthPickerRef}>
          <button
            onClick={() => setShowMonthPicker(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors group"
          >
            <span className="font-bold text-lg text-zinc-100 drop-shadow-sm">{headerLabel}</span>
            <ChevronRight className={`w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-all duration-200 ${showMonthPicker ? 'rotate-90' : 'rotate-0'}`} />
          </button>

          {/* Mini calendar dropdown */}
          {showMonthPicker && (
            <div className="absolute top-full left-0 mt-2 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 w-72 select-none">
              {/* Picker header */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => {
                    if (pickerMonth === 0) { setPickerMonth(11); setPickerYear(y => y - 1); }
                    else setPickerMonth(m => m - 1);
                  }}
                  className="p-1.5 hover:bg-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-zinc-100">{monthNames[pickerMonth]}</span>
                  {/* Godina s +/- gumbima */}
                  <div className="flex items-center gap-1 bg-zinc-800 rounded-lg px-2 py-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPickerYear(y => y - 1); }}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors text-xs font-bold"
                    >‹</button>
                    <span className="font-bold text-sm text-orange-400 min-w-[36px] text-center">{pickerYear}</span>
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
                  className="p-1.5 hover:bg-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {["Po","Ut","Sr","Če","Pe","Su","Ne"].map(d => (
                  <div key={d} className="text-center text-[10px] font-bold text-zinc-500 uppercase py-1">{d}</div>
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
                            text-center text-xs py-1.5 rounded-full mx-0.5 my-0.5 transition-colors font-medium
                            ${isSelected ? 'bg-orange-500 text-white font-bold' : ''}
                            ${isToday && !isSelected ? 'ring-1 ring-orange-500 text-orange-400' : ''}
                            ${!isSelected && !isToday && cell.current ? 'text-zinc-200 hover:bg-zinc-700' : ''}
                            ${!isSelected && !isToday && !cell.current ? 'text-zinc-600 hover:bg-zinc-800' : ''}
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
        <div className="flex bg-zinc-900/80 rounded-lg p-1 border border-zinc-800 gap-1">
          <button onClick={goWeekBack} title="Prošli tjedan" className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={goToday} title="Idi na današnji tjedan" className="px-4 py-1.5 hover:bg-zinc-800 rounded-md text-[11px] font-bold text-zinc-300 uppercase transition-colors">Danas</button>
          <button onClick={goWeekForward} title="Sljedeći tjedan" className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-8 border-b border-zinc-800/80 bg-zinc-900/80 font-bold text-[10px] text-zinc-500 uppercase tracking-widest">
        {dayNames.map((d, i) => <div key={i} className="py-3 px-3 border-r border-zinc-800/80">{d}</div>)}
        <div className="py-3 text-center bg-orange-500/10 text-orange-400 border-l border-zinc-800 shadow-[inset_0_0_10px_rgba(249,115,22,0.05)]">Sažetak</div>
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
        <div className="hidden md:flex flex-1 flex-col bg-zinc-800 border-l border-zinc-800 gap-[1px]">
          {threeWeeks.map(({ days, isActive }, wi) => {
            let aT = 0; let pT = 0; let aD = 0; let pD = 0;
            // Week label: date range
            const wStart = days[0];
            const wEnd   = days[6];
            const mn = ["Sij","Velj","Ožu","Tra","Svi","Lip","Srp","Kol","Ruj","Lis","Stu","Pro"];
            const weekRangeLabel = wStart.month === wEnd.month
              ? `${wStart.day}–${wEnd.day} ${mn[wStart.month]}`
              : `${wStart.day} ${mn[wStart.month]} – ${wEnd.day} ${mn[wEnd.month]}`;

            // CTL/ATL/TSB — uzimamo nedjelju (zadnji dan tjedna) ili najbliži dostupni datum unatrag
            let weekCtl = null, weekAtl = null;
            for (let di = 6; di >= 0; di--) {
              const wd = wellnessData[days[di].dateStr];
              if (wd && (wd.ctl != null || wd.atl != null)) {
                weekCtl = wd.ctl != null ? Math.round(wd.ctl) : null;
                weekAtl = wd.atl != null ? Math.round(wd.atl) : null;
                break;
              }
            }
            const weekTsb = (weekCtl != null && weekAtl != null) ? weekCtl - weekAtl : null;

            // Ramp Rate — CTL prošlog tjedna (7 dana ranije od Monday ovog tjedna)
            let prevWeekCtl = null;
            const mondayDate = new Date(days[0].year, days[0].month, days[0].day);
            for (let di = 6; di >= 0; di--) {
              const prevDate = new Date(mondayDate);
              prevDate.setDate(prevDate.getDate() - 7 + di);
              const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
              const pwd = wellnessData[prevDateStr];
              if (pwd && pwd.ctl != null) {
                prevWeekCtl = Math.round(pwd.ctl);
                break;
              }
            }
            const rampRate = (weekCtl != null && prevWeekCtl != null) ? weekCtl - prevWeekCtl : null;

            const getTsbColor = (tsb) => {
              if (tsb == null) return 'text-zinc-600';
              if (tsb > 25) return 'text-amber-400';
              if (tsb >= 5)  return 'text-emerald-400';
              if (tsb >= -10) return 'text-zinc-400';
              return 'text-rose-400';
            };
            const getRampColor = (rr) => {
              if (rr == null) return 'text-zinc-600';
              if (rr > 8)  return 'text-orange-400';  // agresivan ramp — rizik
              if (rr >= 3) return 'text-emerald-400'; // optimalan ramp
              if (rr >= 0) return 'text-zinc-400';    // umjeren / neutralan
              if (rr >= -5) return 'text-sky-400';    // lagani taper
              return 'text-rose-400';                  // agresivan taper / pad
            };

            return (
              <div
                key={wi}
                className={`grid grid-cols-8 gap-[1px] flex-1 transition-all
                  ${isActive
                    ? 'min-h-[160px] ring-1 ring-inset ring-orange-500/50'
                    : 'min-h-[110px] opacity-60 hover:opacity-80'
                  }`}
              >
                {days.map((dObj) => {
                  const dWorks = workoutsByDate[dObj.dateStr] || [];
                  dWorks.forEach(w => {
                    if (w.isCompleted) {
                      aT += w.tss; aD += w.duration;
                      if (w.plannedTss) pT += w.plannedTss;
                      if (w.plannedDuration) pD += w.plannedDuration;
                    } else {
                      pT += w.tss; pD += w.duration;
                    }
                  });
                  return (
                    <CalendarDay
                      key={dObj.dateStr}
                      dObj={dObj}
                      dWorks={dWorks}
                      isTdy={dObj.dateStr === todayStr}
                      dWell={wellnessData[dObj.dateStr]}
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
                      compact={!isActive}
                    />
                  );
                })}

                {/* Week summary column */}
                <div className={`p-3 flex flex-col justify-between border-l border-zinc-800 text-right
                  ${isActive ? 'bg-gradient-to-b from-orange-500/8 to-transparent bg-zinc-900/40' : 'bg-zinc-900/20'}`}
                >
                  <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${isActive ? 'text-orange-400' : 'text-zinc-600'}`}>
                    {weekRangeLabel}
                  </p>
                  <div className="space-y-2">
                    <div>
                      <p className={`text-[8px] font-black uppercase tracking-tighter mb-0.5 ${isActive ? 'text-orange-500' : 'text-zinc-600'}`}>Vrijeme</p>
                      <div className="flex items-center justify-end gap-1 text-[10px]">
                        <Clock className={`w-3 h-3 ${isActive ? 'text-orange-500' : 'text-zinc-600'}`} />
                        <span className={`font-bold ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`}>{formatDur(aD)}</span>
                        <span className="text-zinc-700">/</span>
                        <span className="text-zinc-500 font-medium">{formatDur(pD)}</span>
                      </div>
                    </div>
                    <div className={`pt-1.5 border-t ${isActive ? 'border-zinc-700' : 'border-zinc-800'}`}>
                      <p className={`text-[8px] font-black uppercase tracking-tighter mb-0.5 ${isActive ? 'text-orange-500' : 'text-zinc-600'}`}>TSS</p>
                      <div className="flex items-center justify-end gap-1 text-[10px]">
                        <Activity className={`w-3 h-3 ${isActive ? 'text-orange-500' : 'text-zinc-600'}`} />
                        <span className={`font-bold ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`}>{aT}</span>
                        <span className="text-zinc-700">/</span>
                        <span className="text-zinc-500 font-medium">{pT}</span>
                      </div>
                    </div>

                    {/* CTL / ATL / TSB blok */}
                    {(weekCtl != null || weekAtl != null) && (
                      <div className={`pt-1.5 border-t ${isActive ? 'border-zinc-700' : 'border-zinc-800'}`}>
                        <p className={`text-[8px] font-black uppercase tracking-tighter mb-1 ${isActive ? 'text-sky-500' : 'text-zinc-600'}`}>Forma</p>
                        <div className="flex flex-col gap-0.5 items-end">
                          {weekCtl != null && (
                            <div className="flex items-center gap-1 text-[9px]">
                              <span className="text-zinc-600 font-bold">CTL</span>
                              <span className={`font-mono font-bold ${isActive ? 'text-sky-400' : 'text-zinc-500'}`}>{weekCtl}</span>
                            </div>
                          )}
                          {weekAtl != null && (
                            <div className="flex items-center gap-1 text-[9px]">
                              <span className="text-zinc-600 font-bold">ATL</span>
                              <span className={`font-mono font-bold ${isActive ? 'text-purple-400' : 'text-zinc-500'}`}>{weekAtl}</span>
                            </div>
                          )}
                          {weekTsb != null && (
                            <div className={`flex items-center gap-1 text-[9px] mt-0.5 px-1 rounded ${isActive ? 'bg-zinc-800/60' : 'bg-zinc-900/60'}`}>
                              <span className="text-zinc-600 font-bold">TSB</span>
                              <span className={`font-mono font-bold ${getTsbColor(weekTsb)}`}>
                                {weekTsb > 0 ? `+${weekTsb}` : weekTsb}
                              </span>
                            </div>
                          )}
                          {rampRate != null && (
                            <div className={`flex items-center gap-1 text-[9px] mt-0.5 px-1 rounded ${isActive ? 'bg-zinc-800/60' : 'bg-zinc-900/60'}`} title="Ramp Rate: tjedna promjena CTL-a. Optimalno: +3 do +8">
                              <span className="text-zinc-600 font-bold">RR</span>
                              <span className={`font-mono font-bold ${getRampColor(rampRate)}`}>
                                {rampRate > 0 ? `+${rampRate}` : rampRate}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
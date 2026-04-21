import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Pencil, Eye } from 'lucide-react';
import { parseIntervalsCode } from '../utils/workoutParser';


// ============================================================
// Konverter: workout_doc JSON → čitljivi Intervals.icu tekst
// ============================================================
function formatDuration(secs) {
  if (!secs || secs <= 0) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  let parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && h === 0) parts.push(`${s}s`);
  return parts.join('') || '0m';
}

function formatPower(power) {
  if (!power) return '50%';
  if (typeof power === 'number') return `${Math.round(power)}%`;
  if (power.value != null) return `${Math.round(power.value)}%`;
  if (power.start != null && power.end != null) {
    return `${Math.round(power.start)}-${Math.round(power.end)}%`;
  }
  return '50%';
}

function stepsToTextLines(steps, indent = '') {
  const lines = [];
  if (!steps || !Array.isArray(steps)) return lines;

  steps.forEach(step => {
    // Grupni korak (ima pod-steps i/ili reps)
    if (step.steps && Array.isArray(step.steps)) {
      const reps = step.reps || step.count || 1;
      // Ako ima tekst/naziv, to je naziv sekcije
      if (step.text) {
        lines.push(`${indent}${step.text}`);
      }
      if (reps > 1) {
        lines.push(`${indent}${reps}x`);
      }
      const subLines = stepsToTextLines(step.steps, indent);
      lines.push(...subLines);
    } else {
      // Pojedinačni korak
      const dur = formatDuration(step.duration || 0);
      const pwr = formatPower(step.power);
      const text = step.text ? ` ${step.text}` : '';
      lines.push(`${indent}- ${dur} ${pwr}${text}`);
    }
  });

  return lines;
}

/**
 * Pretvara workout_doc JSON objekt iz Intervals.icu API-ja u čitljivi tekst.
 * Podržava i lokalne step nizove iz Library/Schedule sustava.
 */
function workoutDocToCode(workoutDoc) {
  if (!workoutDoc) return '';
  if (typeof workoutDoc === 'string') return workoutDoc;

  // Intervals.icu format: { steps: [...] }
  if (workoutDoc.steps && Array.isArray(workoutDoc.steps)) {
    return stepsToTextLines(workoutDoc.steps).join('\n');
  }

  // Direktni niz koraka (lokalni format: [{ name, duration, power }])
  if (Array.isArray(workoutDoc)) {
    return workoutDoc.map(step => {
      const dur = formatDuration(step.duration || 0);
      const pwr = `${Math.round(step.power || 50)}%`;
      const name = step.name ? ` ${step.name}` : '';
      return `- ${dur} ${pwr}${name}`;
    }).join('\n');
  }

  return '';
}


// ============================================================
// Pomoćne funkcije
// ============================================================
const formatDurSec = (secs) => {
  if (!secs || secs <= 0) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2, '0') + 'm' : ''}`;
  return `${m}m`;
};

const formatDurMinSec = (secs) => {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

const getZoneInfo = (pct) => {
  if (pct < 55) return { name: 'Z1', color: 'bg-zinc-500', textColor: 'text-zinc-400', barColor: '#71717a' };
  if (pct < 76) return { name: 'Z2', color: 'bg-emerald-500', textColor: 'text-emerald-400', barColor: '#10b981' };
  if (pct < 88) return { name: 'Z3', color: 'bg-amber-400', textColor: 'text-amber-400', barColor: '#fbbf24' };
  if (pct < 95) return { name: 'SS', color: 'bg-orange-500', textColor: 'text-orange-400', barColor: '#f97316' };
  if (pct < 106) return { name: 'Z4', color: 'bg-rose-500', textColor: 'text-rose-400', barColor: '#f43f5e' };
  if (pct < 121) return { name: 'Z5', color: 'bg-red-600', textColor: 'text-red-400', barColor: '#dc2626' };
  return { name: 'Z6', color: 'bg-purple-600', textColor: 'text-purple-400', barColor: '#9333ea' };
};

const getZoneColor = (pct) => {
  if (pct < 55) return '#71717a';
  if (pct < 76) return '#10b981';
  if (pct < 88) return '#fbbf24';
  if (pct < 95) return '#f97316';
  if (pct < 106) return '#f43f5e';
  if (pct < 121) return '#dc2626';
  return '#9333ea';
};


// ============================================================
// Zone Bar Komponenta
// ============================================================
function ZoneBar({ zones, totalSecs }) {
  if (totalSecs <= 0) return null;

  const zoneConfig = [
    { key: 'z1', label: 'Z1', color: '#71717a' },
    { key: 'z2', label: 'Z2', color: '#10b981' },
    { key: 'z3', label: 'Z3', color: '#fbbf24' },
    { key: 'ss', label: 'SS', color: '#f97316' },
    { key: 'z4', label: 'Z4', color: '#f43f5e' },
    { key: 'z5', label: 'Z5', color: '#dc2626' },
    { key: 'z6', label: 'Z6', color: '#9333ea' },
  ];

  return (
    <div className="space-y-1.5">
      {zoneConfig.map(z => {
        const secs = zones[z.key] || 0;
        if (secs <= 0) return null;
        const pct = ((secs / totalSecs) * 100).toFixed(1);
        const mins = Math.round(secs / 60);
        return (
          <div key={z.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-6 font-black text-zinc-400 text-right">{z.label}</span>
            <div className="flex-1 h-4 bg-zinc-900 rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{ width: `${Math.max(parseFloat(pct), 1.5)}%`, backgroundColor: z.color }}
              />
            </div>
            <span className="w-12 font-bold text-zinc-300 text-right tabular-nums">{mins}m</span>
            <span className="w-12 font-medium text-zinc-500 text-right tabular-nums">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}


// ============================================================
// Mini Graf Komponenta
// ============================================================
function MiniWorkoutGraph({ allSteps, ftp, totalSecs }) {
  if (!allSteps || allSteps.length === 0 || totalSecs <= 0) return null;

  const maxPower = Math.max(...allSteps.map(s => s.power), 130);
  const ftpLine = (100 / maxPower) * 100;

  return (
    <div className="relative w-full h-24 bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      {/* FTP Line */}
      <div
        className="absolute left-0 right-0 border-t border-dashed border-zinc-600 z-10"
        style={{ bottom: `${Math.min(ftpLine, 95)}%` }}
      >
        <span className="absolute right-1 -top-3 text-[9px] font-bold text-zinc-500">FTP</span>
      </div>

      <div className="absolute inset-0 flex items-end">
        {allSteps.map((step, i) => {
          const widthPct = (step.duration / totalSecs) * 100;
          const heightPct = Math.min((step.power / maxPower) * 100, 100);
          const color = getZoneColor(step.power);

          return (
            <div
              key={i}
              style={{
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                backgroundColor: color,
              }}
              className="border-r border-zinc-950/40 opacity-80 transition-all"
            />
          );
        })}
      </div>

      {/* Skala vremena */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-0.5 text-[8px] text-zinc-600 font-mono">
        <span>0:00</span>
        <span>{formatDurSec(Math.round(totalSecs / 4))}</span>
        <span>{formatDurSec(Math.round(totalSecs / 2))}</span>
        <span>{formatDurSec(Math.round((totalSecs * 3) / 4))}</span>
        <span>{formatDurSec(totalSecs)}</span>
      </div>
    </div>
  );
}


// ============================================================
// Step List (View Mode)
// ============================================================
function StepList({ blocks, ftp }) {
  return (
    <div className="space-y-4 overflow-y-auto max-h-[340px] pr-1 custom-scrollbar">
      {blocks.map((block, bi) => (
        <div key={bi}>
          <h3 className="text-[11px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 border-b border-zinc-800/60 pb-1">
            {block.name}
          </h3>
          <ul className="space-y-0.5">
            {block.steps.map((step, si) => {
              const zone = getZoneInfo(step.power);
              const wMin = Math.round((step.powerMin / 100) * ftp);
              const wMax = Math.round((step.powerMax / 100) * ftp);
              const isRange = step.powerMin !== step.powerMax;

              return (
                <li key={si} className="flex items-center gap-2 text-[12px] py-1 pl-2 group hover:bg-zinc-800/30 rounded-md transition-colors">
                  <div className={`w-1.5 h-5 rounded-full ${zone.color} shrink-0 opacity-80`} />
                  <span className="font-bold text-zinc-200 w-12 shrink-0 tabular-nums">{formatDurMinSec(step.duration)}</span>
                  <span className={`font-bold ${zone.textColor} tabular-nums shrink-0`}>
                    {isRange ? `${step.powerMin}-${step.powerMax}%` : `${step.power}%`}
                  </span>
                  <span className="text-zinc-500 tabular-nums">
                    ({isRange ? `${wMin}-${wMax}w` : `${wMin}w`})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}


// ============================================================
// Stat Box Komponenta
// ============================================================
function StatBox({ label, value, sub, className = '' }) {
  return (
    <div className={`flex flex-col items-end ${className}`}>
      <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-black text-zinc-100 leading-tight tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-zinc-500 font-medium">{sub}</span>}
    </div>
  );
}


// ============================================================
// MAIN MODAL
// ============================================================
export default function WorkoutEditorModal({ workout, isOpen, onClose, onSave, isLoading, userFtp }) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('view'); // 'view' | 'edit'

  const ftp = userFtp && userFtp > 0 ? userFtp : 200;

  useEffect(() => {
    if (workout && isOpen) {
      setTitle(workout.title || '');
      // Dohvat koda iz različitih mogućih izvora (JSON ili Array pretvaramo u tekst)
      const workoutData = workout.workout_doc || workout.steps || '';
      setCode(workoutDocToCode(workoutData));
      setMode('view');
    }
  }, [workout, isOpen]);

  const stats = useMemo(() => parseIntervalsCode(code, ftp), [code, ftp]);

  if (!isOpen || !workout) return null;

  // ===== KLJUČNA PROMJENA =====
    const handleSave = () => {
    // Pakiramo SVE u jedan objekt
    onSave({
      ...workout,            // Zadržava originalni ID i ostale postavke
      title: title,          // Novi (ili stari) naslov
      description: code,     // Ažurirani tekst/kod iz textarea
      tss: stats.tss,        // Preračunati TSS
      duration: Math.round(stats.duration / 60), // Trajanje u minutama
      type: workout.type || 'ride',
      intensityFactor: stats.ifFactor,
      plannedDuration: Math.round(stats.duration / 60),
      plannedTss: stats.tss,
      category: workout.category || 'WORKOUT'
    });
  };
  // ==============================

  const totalSecs = stats.duration || 0;

  // Informacije o datumu treninga
  const workoutDate = workout.date ? new Date(workout.date) : null;
  const dayNames = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota'];
  const dayName = workoutDate ? dayNames[workoutDate.getDay()] : '';
  const dateStr = workoutDate
    ? `${workoutDate.getDate()} ${['Sij', 'Velj', 'Ožu', 'Tra', 'Svi', 'Lip', 'Srp', 'Kol', 'Ruj', 'Lis', 'Stu', 'Pro'][workoutDate.getMonth()]}`
    : '';
  const timeStr = workout.time || '08:00';


  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============ HEADER ============ */}
        <div className="flex justify-between items-start px-5 py-4 border-b border-zinc-800 bg-zinc-950/60" onKeyDown={e => e.stopPropagation()}>
          <div className="flex flex-col gap-0.5">
            {mode === 'edit' ? (
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-xl font-bold text-zinc-100 focus:ring-0 p-0"
                placeholder="Naziv treninga..."
              />
            ) : (
              <h1 className="text-xl font-bold text-zinc-100">{title || workout.name || 'Bez naziva'}</h1>
            )}
            <div className="text-sm text-zinc-400 font-medium">
              {dayName}, {dateStr} • {timeStr}
            </div>
          </div>

          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-full transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ============ BODY ============ */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col lg:flex-row gap-0 lg:gap-0">

                        {/* LIJEVI STUPAC: Steps / Editor */}
            <div className="flex-1 p-5 border-b lg:border-b-0 lg:border-r border-zinc-800 min-w-0" onKeyDown={e => e.stopPropagation()}>
              {mode === 'edit' ? (
                <div className="flex flex-col gap-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                    Workout Code (Intervals.icu syntax)
                  </label>
                  <textarea
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="w-full h-[320px] bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-[12px] text-zinc-300 font-mono leading-relaxed focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-none transition-all custom-scrollbar placeholder-zinc-700"
                    placeholder={`Warmup\n- 15m 50-70%\n- 1m 100%\n- 1m 50%\n\nMain Set (Over-Unders)\n4x\n- 2m 88-92%\n- 1m 110-115%\n\nCooldown\n- 5m 50%`}
                    spellCheck={false}
                  />
                </div>
              ) : (
                stats.blocks.length > 0 && stats.allSteps.length > 0 ? (
                  <StepList blocks={stats.blocks} ftp={ftp} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-40 text-zinc-600 text-sm">
                    <Pencil className="w-8 h-8 mb-3 text-zinc-700" />
                    <p>Nema koraka za prikaz.</p>
                    <button onClick={() => setMode('edit')} className="mt-2 text-orange-500 hover:text-orange-400 font-bold text-sm transition-colors">
                      Uredi kod treninga
                    </button>
                  </div>
                )
              )}
            </div>

            {/* DESNI STUPAC: Zone statistike */}
            <div className="w-full lg:w-[280px] shrink-0 p-5 flex flex-col gap-4">
              {/* Zone Bar */}
              <ZoneBar zones={stats.zones} totalSecs={totalSecs} />

              {/* PI Score */}
              {stats.np > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/60">
                  <span className="font-bold">PI</span>
                  <span className="text-zinc-300 font-black">{stats.variability}</span>
                </div>
              )}

              {/* Statistike */}
              <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                <StatBox label="Normalized" value={stats.np > 0 ? `${stats.np}w` : '-'} />
                <StatBox label="Average" value={stats.avgPower > 0 ? `${stats.avgPower}w` : '-'} />
                <StatBox label="Variability" value={stats.variability || '-'} />
                <StatBox label="Work" value={stats.workKj > 0 ? `${stats.workKj} kJ` : '-'} />
                {ftp > 0 && (
                  <StatBox
                    label="Work>FTP"
                    value={
                      stats.zones.z4 + stats.zones.z5 + stats.zones.z6 > 0
                        ? `${Math.round(((stats.zones.z4 + stats.zones.z5 + stats.zones.z6) / totalSecs) * (stats.workKj || 0))} kJ`
                        : '0 kJ'
                    }
                  />
                )}
              </div>

              {/* SS / IF Score */}
              {stats.tss > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/60">
                  <span className="text-[10px] font-bold text-zinc-500">SS</span>
                  <span className="text-sm font-black text-zinc-100">{stats.tss}</span>
                  <div className="ml-auto flex gap-1">
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-black px-1.5 py-0.5 rounded">{stats.tss}</span>
                    <span className="bg-amber-500/20 text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded">{stats.ifFactor}</span>
                    <span className="bg-rose-500/20 text-rose-400 text-[10px] font-black px-1.5 py-0.5 rounded">{stats.variability}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ============ GRAPH ============ */}
          <div className="px-5 pb-4">
            <MiniWorkoutGraph allSteps={stats.allSteps} ftp={ftp} totalSecs={totalSecs} />
          </div>
        </div>

        {/* ============ FOOTER ============ */}
        <div className="p-3 px-5 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3">
          {/* Lijeva strana: Mode toggleovi */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all border ${mode === 'edit'
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 shadow-[0_0_10px_rgba(249,115,22,0.1)]'
                  : 'bg-zinc-800/50 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
            >
              {mode === 'edit' ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
              {mode === 'edit' ? 'View' : 'Edit'}
            </button>
          </div>

          {/* Desna strana: Akcije */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors uppercase tracking-wider"
            >
              Close
            </button>
            {mode === 'edit' && (
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-orange-500 hover:bg-orange-400 text-zinc-950 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(249,115,22,0.3)]"
              >
                {isLoading ? (
                  <span className="animate-spin w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Spremi
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
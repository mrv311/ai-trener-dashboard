import React, { useState, useMemo } from 'react';
import { CalendarPlus, Play, Check, Clock, Activity } from 'lucide-react';
import { parseIntervalsCode, categorizeWorkout, calculateCategoryDifficulty } from '../../utils/workoutParser';

/**
 * Pretvara strukturirani niz koraka (npr. iz AI JSON plana) u Intervals.icu tekstualni kod.
 */
export function stepsToIntervalsCode(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  return steps.map(st => {
    const sec = st.duration || 60;
    const mins = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    let durStr = '';
    if (mins > 0 && remSec === 0) durStr = `${mins}m`;
    else if (mins > 0 && remSec > 0) durStr = `${mins}m${remSec}s`;
    else durStr = `${remSec}s`;

    let pwrStr = '50%';
    if (st.powerMin && st.powerMax && st.powerMin !== st.powerMax) {
      pwrStr = `${st.powerMin}-${st.powerMax}%`;
    } else if (typeof st.power === 'number') {
      pwrStr = `${Math.round(st.power)}%`;
    } else if (typeof st.power === 'object' && st.power) {
      const pMin = st.power.min ?? st.power.start ?? st.power.low;
      const pMax = st.power.max ?? st.power.end ?? st.power.high;
      if (pMin != null && pMax != null && pMin !== pMax) {
        pwrStr = `${Math.round(pMin)}-${Math.round(pMax)}%`;
      } else if (st.power.value != null && Number(st.power.value) > 0) {
        pwrStr = `${Math.round(st.power.value)}%`;
      } else if (pMin != null) {
        pwrStr = `${Math.round(pMin)}%`;
      }
    } else if (st.power) {
      pwrStr = `${st.power}%`;
    }

    const label = st.name || st.text ? ` ${st.name || st.text}` : '';
    return `- ${durStr} ${pwrStr}${label}`;
  }).join('\n');
}

/**
 * Proširuje "3x" blokove s više koraka (npr. radni interval + odmor) u eksplicitni niz koraka
 * kako bi ErgVibe parser i Intervals.icu tekst bili 100% usklađeni.
 */
export function normalizeIntervalsWorkoutText(rawCode = '') {
  if (!rawCode || typeof rawCode !== 'string') return '';
  const lines = rawCode.split(/\r?\n/);
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const repMatch = trimmed.match(/^(\d+)\s*x\s*$/i);

    if (repMatch) {
      const reps = Math.min(30, Math.max(1, parseInt(repMatch[1], 10)));
      const blockSteps = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) {
          j++;
          break;
        }
        if (nextLine.startsWith('-') || /^\d+\s*[hms]/i.test(nextLine)) {
          blockSteps.push(nextLine.startsWith('-') ? nextLine : `- ${nextLine}`);
          j++;
        } else {
          break;
        }
      }

      if (blockSteps.length > 0) {
        for (let r = 0; r < reps; r++) {
          blockSteps.forEach(s => output.push(s));
        }
        i = j;
        continue;
      }
    }

    output.push(lines[i]);
    i++;
  }

  return output.join('\n').trim();
}

/**
 * Gradi standardni ErgVibe workout objekt spreman za handleCreateWorkout ili TrainerTab.
 */
export function buildErgVibeWorkoutObject({
  title = 'AI Trening',
  category = '',
  intervalsCode = '',
  steps,
  durationMinutes,
  estimatedTss,
  date,
  ftp = 270
}) {
  let effectiveCode = intervalsCode;
  if (!effectiveCode && Array.isArray(steps) && steps.length > 0) {
    effectiveCode = stepsToIntervalsCode(steps);
  }

  const normalizedCode = normalizeIntervalsWorkoutText(effectiveCode);
  const parsed = parseIntervalsCode(normalizedCode, ftp);

  // Koraci: iz parsiranog teksta ili izravno predani niz
  let enrichedSteps = [];
  if (parsed.allSteps && parsed.allSteps.length > 0) {
    enrichedSteps = parsed.allSteps.map((st, idx) => ({
      ...st,
      name: st.name || (idx === 0 && st.power <= 65 ? 'Zagrijavanje' : st.power >= 85 ? 'Radni Interval' : 'Aerobno / Oporavak')
    }));
  } else if (Array.isArray(steps) && steps.length > 0) {
    enrichedSteps = steps.map((st, idx) => ({
      ...st,
      name: st.name || (idx === 0 && st.power <= 65 ? 'Zagrijavanje' : st.power >= 85 ? 'Radni Interval' : 'Aerobno / Oporavak')
    }));
  }

  // PRAVILAN IZRAČUN TRAJANJA:
  // parseIntervalsCode vraća duration u SEKUNDAMA (totalDurMins * 60).
  let calculatedDurationMin = 0;
  if (parsed.duration && parsed.duration > 0) {
    calculatedDurationMin = Math.round(parsed.duration / 60);
  } else if (enrichedSteps.length > 0) {
    const totalStepSec = enrichedSteps.reduce((acc, s) => acc + (s.duration || 0), 0);
    calculatedDurationMin = Math.round(totalStepSec / 60);
  } else if (durationMinutes && Number(durationMinutes) > 0) {
    calculatedDurationMin = Number(durationMinutes);
  } else {
    calculatedDurationMin = 60;
  }

  // Sigurnosna zaštita: ako je trajanje slučajno došlo u sekundama (npr. >= 600 i djeljivo sa 60 ili >= 1440)
  if (calculatedDurationMin >= 600 && calculatedDurationMin % 60 === 0) {
    calculatedDurationMin = Math.round(calculatedDurationMin / 60);
  } else if (calculatedDurationMin > 1440) {
    calculatedDurationMin = Math.round(calculatedDurationMin / 60);
  }

  const durationMin = Math.max(10, Math.round(calculatedDurationMin));
  const durationSec = durationMin * 60;

  const resolvedCategory = category || categorizeWorkout(enrichedSteps) || 'Endurance';
  const diffScore = calculateCategoryDifficulty(enrichedSteps, resolvedCategory);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const resolvedTss = Math.max(5, Math.round(parsed.tss || estimatedTss || (durationMin * 0.75)));

  return {
    id: `local-ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: date || tomorrowIso,
    title: title.trim() || 'AI Strukturirani Trening',
    duration: durationMin,
    duration_seconds: durationSec,
    plannedDuration: durationMin,
    plannedTss: resolvedTss,
    tss: resolvedTss,
    description: normalizedCode,
    workout_doc: normalizedCode,
    allSteps: enrichedSteps,
    steps: enrichedSteps,
    category: resolvedCategory,
    difficulty_score: diffScore,
    type: 'ride'
  };
}

function getBarColor(powerPct) {
  if (powerPct < 56) return 'bg-zinc-500/80 border-t-2 border-zinc-400';
  if (powerPct < 76) return 'bg-sky-500/80 border-t-2 border-sky-300';
  if (powerPct < 91) return 'bg-emerald-500/80 border-t-2 border-emerald-300';
  if (powerPct < 106) return 'bg-amber-400/85 border-t-2 border-amber-200';
  if (powerPct < 121) return 'bg-rose-500/85 border-t-2 border-rose-300';
  return 'bg-purple-500/85 border-t-2 border-purple-300';
}

export function AIWorkoutCard({
  rawBlock,
  structuredWorkout,
  ftp = 270,
  onAddToCalendar,
  onStartInTrainer
}) {
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [targetDate, setTargetDate] = useState(structuredWorkout?.date || tomorrowIso);
  const [added, setAdded] = useState(false);

  let title = structuredWorkout?.title || 'AI Preporučeni Trening';
  let category = structuredWorkout?.category || '';
  let stepsCode = structuredWorkout?.intervalsCode || '';
  let stepsArray = structuredWorkout?.steps || null;
  let durationMinutes = structuredWorkout?.durationMinutes || null;
  let estimatedTss = structuredWorkout?.estimatedTss || null;

  if (rawBlock && !structuredWorkout) {
    const trimmed = rawBlock.trim();
    // Provjera je li rawBlock JSON (npr. iz ergvibe-workout ili sličnog bloka)
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (parsedJson.title) title = parsedJson.title;
        if (parsedJson.category) category = parsedJson.category;
        if (parsedJson.durationMinutes) durationMinutes = parsedJson.durationMinutes;
        if (parsedJson.estimatedTss) estimatedTss = parsedJson.estimatedTss;
        if (Array.isArray(parsedJson.steps)) {
          stepsArray = parsedJson.steps;
          stepsCode = stepsToIntervalsCode(parsedJson.steps);
        }
        if (parsedJson.intervalsCode) stepsCode = parsedJson.intervalsCode;
      } catch {
        // nije JSON, nastavi s linijskim parsiranjem
      }
    }

    if (!stepsCode && !stepsArray) {
      const lines = rawBlock.split(/\r?\n/);
      const stepLines = [];
      let inSteps = false;

      lines.forEach(l => {
        const t = l.trim();
        if (/^TITLE:/i.test(t)) title = t.replace(/^TITLE:\s*/i, '').trim();
        else if (/^CATEGORY:/i.test(t)) category = t.replace(/^CATEGORY:\s*/i, '').trim();
        else if (/^DURATION:/i.test(t)) {
          const rawDurStr = t.replace(/^DURATION:\s*/i, '').replace(/m(in)?/i, '').trim();
          const parsedD = parseInt(rawDurStr, 10);
          if (!isNaN(parsedD) && parsedD > 0) {
            durationMinutes = parsedD >= 600 && parsedD % 60 === 0 ? Math.round(parsedD / 60) : parsedD;
          }
        } else if (/^TSS:/i.test(t)) {
          const parsedT = parseInt(t.replace(/^TSS:\s*/i, '').trim(), 10);
          if (!isNaN(parsedT)) estimatedTss = parsedT;
        } else if (/^STEPS:/i.test(t)) {
          inSteps = true;
        } else if (inSteps || t.startsWith('-') || /^\d+x$/i.test(t)) {
          stepLines.push(l);
        }
      });
      stepsCode = stepLines.join('\n').trim();
    }
  }

  const built = useMemo(() => {
    return buildErgVibeWorkoutObject({
      title,
      category,
      intervalsCode: stepsCode,
      steps: stepsArray,
      durationMinutes,
      estimatedTss,
      date: targetDate,
      ftp
    });
  }, [title, category, stepsCode, stepsArray, durationMinutes, estimatedTss, targetDate, ftp]);

  const totalSec = built.allSteps.reduce((s, x) => s + (x.duration || 0), 0) || 1;

  const handleAdd = async () => {
    if (!onAddToCalendar) return;
    await onAddToCalendar({ ...built, date: targetDate });
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  };

  return (
    <div className="my-4 carbon-panel border-volt-400/30 rounded-xl p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/30">
              {built.category}
            </span>
            <h4 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-sm md:text-base">{built.title}</h4>
          </div>
          {structuredWorkout?.coachNote && (
            <p className="text-xs text-zinc-400 mt-1">{structuredWorkout.coachNote}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-zinc-200 telemetry-num shrink-0">
          <span className="flex items-center gap-1 bg-zinc-950 px-2.5 py-1 rounded-md border border-zinc-800">
            <Clock className="w-3.5 h-3.5 text-volt-400" /> {built.duration}m
          </span>
          <span className="flex items-center gap-1 bg-zinc-950 px-2.5 py-1 rounded-md border border-zinc-800">
            <Activity className="w-3.5 h-3.5 text-amber-400" /> {built.tss} TSS
          </span>
        </div>
      </div>

      {/* Vizualni profil intervala */}
      {built.allSteps.length > 0 && (
        <div className="relative h-16 w-full bg-zinc-950 bg-telemetry-grid rounded-lg px-1.5 pt-2 pb-1 flex items-end gap-[1px] border border-zinc-800/90 mb-3 overflow-hidden">
          <div
            className="absolute inset-x-0 border-t border-dashed border-volt-400/35 pointer-events-none z-10"
            style={{ bottom: `${Math.min(95, (100 / 135) * 100)}%` }}
          />
          {built.allSteps.map((st, idx) => {
            const widthPct = Math.max(1.2, (st.duration / totalSec) * 100);
            const heightPct = Math.min(100, Math.max(18, (st.power / 135) * 100));
            const watts = Math.round((st.power / 100) * ftp);
            return (
              <div
                key={idx}
                style={{ width: `${widthPct}%`, height: `${heightPct}%` }}
                title={`${Math.round(st.duration / 60)}m @ ${st.power}% FTP (${watts}W)`}
                className={`${getBarColor(st.power)} rounded-t-[2px] opacity-90 hover:opacity-100 transition-opacity`}
              />
            );
          })}
        </div>
      )}

      {/* Akcijski gumbi */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {onAddToCalendar && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 font-mono text-xs text-zinc-200 focus:border-volt-400 outline-none"
            />
            <button
              type="button"
              onClick={handleAdd}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                added
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-volt-400 border-volt-400/35'
              }`}
            >
              {added ? <Check className="w-3.5 h-3.5" /> : <CalendarPlus className="w-3.5 h-3.5" />}
              {added ? 'Dodano u kalendar!' : 'Dodaj u kalendar'}
            </button>
          </div>
        )}

        {onStartInTrainer && built.allSteps.length > 0 && (
          <button
            type="button"
            onClick={() => onStartInTrainer(built)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-display font-bold uppercase tracking-wider text-xs bg-volt-400 hover:bg-volt-300 text-zinc-950 transition-all shadow-volt-glow"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Pokreni u Trenažeru
          </button>
        )}
      </div>
    </div>
  );
}

function renderInlineFormatting(text) {
  if (!text) return null;
  // Split na **bold** i `code`
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith('**') && tok.endsWith('**')) {
      return <strong key={idx} className="font-bold text-zinc-100">{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith('`') && tok.endsWith('`')) {
      return (
        <code key={idx} className="px-1.5 py-0.5 rounded bg-zinc-900 text-volt-300 font-mono text-[11px] border border-zinc-800">
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{tok}</React.Fragment>;
  });
}

function MarkdownSection({ content }) {
  const lines = content.split(/\r?\n/);
  const elements = [];
  let listBuffer = [];
  let listOrdered = false;

  const flushList = (keySuffix) => {
    if (!listBuffer.length) return;
    if (listOrdered) {
      elements.push(
        <ol key={`ol_${keySuffix}`} className="list-decimal list-inside space-y-1.5 my-2 text-zinc-300 text-sm leading-relaxed pl-1">
          {listBuffer.map((item, i) => (
            <li key={i} className="marker:text-volt-400 marker:font-mono marker:font-bold">{renderInlineFormatting(item)}</li>
          ))}
        </ol>
      );
    } else {
      elements.push(
        <ul key={`ul_${keySuffix}`} className="space-y-1.5 my-2 text-zinc-300 text-sm leading-relaxed">
          {listBuffer.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-sm bg-volt-400 mt-2 shrink-0" />
              <span className="flex-1">{renderInlineFormatting(item)}</span>
            </li>
          ))}
        </ul>
      );
    }
    listBuffer = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(idx);
      return;
    }

    if (/^---+$/.test(line)) {
      flushList(idx);
      elements.push(<hr key={idx} className="border-zinc-800 my-3" />);
      return;
    }

    if (line.startsWith('#### ')) {
      flushList(idx);
      elements.push(
        <h4 key={idx} className="text-sm font-display font-bold uppercase tracking-wide text-volt-300 mt-4 mb-1.5">
          {renderInlineFormatting(line.slice(5))}
        </h4>
      );
      return;
    }

    if (line.startsWith('### ')) {
      flushList(idx);
      elements.push(
        <h3 key={idx} className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 mt-4 mb-2 pb-1 border-b border-zinc-800/80 flex items-center gap-2">
          {renderInlineFormatting(line.slice(4))}
        </h3>
      );
      return;
    }

    if (line.startsWith('## ') || line.startsWith('# ')) {
      flushList(idx);
      const clean = line.replace(/^#+\s*/, '');
      elements.push(
        <h2 key={idx} className="text-lg font-display font-bold uppercase tracking-wide text-volt-400 mt-4 mb-2">
          {renderInlineFormatting(clean)}
        </h2>
      );
      return;
    }

    if (line.startsWith('> ')) {
      flushList(idx);
      elements.push(
        <blockquote key={idx} className="border-l-2 border-volt-400 bg-volt-400/5 px-3.5 py-2 my-2 rounded-r-lg text-xs md:text-sm text-zinc-300 italic">
          {renderInlineFormatting(line.slice(2))}
        </blockquote>
      );
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (listOrdered) flushList(idx);
      listOrdered = false;
      listBuffer.push(bulletMatch[1]);
      return;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)/);
    if (orderedMatch) {
      if (!listOrdered && listBuffer.length) flushList(idx);
      listOrdered = true;
      listBuffer.push(orderedMatch[1]);
      return;
    }

    flushList(idx);
    elements.push(
      <p key={idx} className="text-sm text-zinc-300 leading-relaxed my-1.5">
        {renderInlineFormatting(line)}
      </p>
    );
  });

  flushList('end');
  return <>{elements}</>;
}

export default function AIMarkdown({
  text = '',
  ftp = 270,
  onAddWorkoutToCalendar,
  onStartWorkoutInTrainer
}) {
  if (!text) return null;

  // Odvoji ```workout ... ``` ili ```ergvibe-workout ... ``` blokove od običnog markdowna
  const segments = [];
  const regex = /```(?:workout|ergvibe-workout)\s*([\s\S]*?)```/gi;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'md', content: text.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'workout', content: match[1] });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'md', content: text.slice(lastIdx) });
  }

  return (
    <div className="space-y-1">
      {segments.map((seg, i) =>
        seg.type === 'workout' ? (
          <AIWorkoutCard
            key={i}
            rawBlock={seg.content}
            ftp={ftp}
            onAddToCalendar={onAddWorkoutToCalendar}
            onStartInTrainer={onStartWorkoutInTrainer}
          />
        ) : (
          <MarkdownSection key={i} content={seg.content} />
        )
      )}
    </div>
  );
}

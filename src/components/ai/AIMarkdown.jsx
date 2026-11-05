import React, { useState } from 'react';
import { CalendarPlus, Play, Check, Clock, Activity } from 'lucide-react';
import { parseIntervalsCode, categorizeWorkout, calculateCategoryDifficulty } from '../../utils/workoutParser';

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
  date,
  ftp = 270
}) {
  const normalizedCode = normalizeIntervalsWorkoutText(intervalsCode);
  const parsed = parseIntervalsCode(normalizedCode, ftp);

  const enrichedSteps = (parsed.allSteps || []).map((st, idx) => ({
    ...st,
    name: st.name || (idx === 0 && st.power <= 65 ? 'Zagrijavanje' : st.power >= 85 ? 'Radni Interval' : 'Aerobno / Oporavak')
  }));

  const resolvedCategory = category || categorizeWorkout(enrichedSteps) || 'Endurance';
  const diffScore = calculateCategoryDifficulty(enrichedSteps, resolvedCategory);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  return {
    id: `local-ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: date || tomorrowIso,
    title: title.trim() || 'AI Strukturirani Trening',
    duration: Math.max(10, Math.round(parsed.duration || 60)),
    duration_seconds: Math.max(600, Math.round((parsed.duration || 60) * 60)),
    tss: Math.max(5, Math.round(parsed.tss || 45)),
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
  if (powerPct < 56) return 'bg-zinc-500';
  if (powerPct < 76) return 'bg-emerald-500';
  if (powerPct < 91) return 'bg-amber-400';
  if (powerPct < 106) return 'bg-orange-500';
  if (powerPct < 121) return 'bg-rose-500';
  return 'bg-purple-500';
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

  if (rawBlock && !structuredWorkout) {
    const lines = rawBlock.split(/\r?\n/);
    const stepLines = [];
    let inSteps = false;

    lines.forEach(l => {
      const t = l.trim();
      if (/^TITLE:/i.test(t)) title = t.replace(/^TITLE:\s*/i, '').trim();
      else if (/^CATEGORY:/i.test(t)) category = t.replace(/^CATEGORY:\s*/i, '').trim();
      else if (/^DURATION:/i.test(t) || /^TSS:/i.test(t)) {
        // izračunat ćemo točno iz koraka uz fallback
      } else if (/^STEPS:/i.test(t)) {
        inSteps = true;
      } else if (inSteps || t.startsWith('-') || /^\d+x$/i.test(t)) {
        stepLines.push(l);
      }
    });
    stepsCode = stepLines.join('\n').trim();
  }

  const built = buildErgVibeWorkoutObject({
    title,
    category,
    intervalsCode: stepsCode,
    date: targetDate,
    ftp
  });

  const totalSec = built.allSteps.reduce((s, x) => s + (x.duration || 0), 0) || 1;

  const handleAdd = async () => {
    if (!onAddToCalendar) return;
    await onAddToCalendar({ ...built, date: targetDate });
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  };

  return (
    <div className="my-4 bg-zinc-950/80 border border-cyan-500/30 rounded-2xl p-4 shadow-[0_0_20px_rgba(34,211,238,0.08)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              {built.category}
            </span>
            <h4 className="font-black text-zinc-100 text-sm md:text-base">{built.title}</h4>
          </div>
          {structuredWorkout?.coachNote && (
            <p className="text-xs text-zinc-400 mt-1">{structuredWorkout.coachNote}</p>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs font-bold text-zinc-300 shrink-0">
          <span className="flex items-center gap-1 bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-800">
            <Clock className="w-3.5 h-3.5 text-cyan-400" /> {built.duration} min
          </span>
          <span className="flex items-center gap-1 bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-800">
            <Activity className="w-3.5 h-3.5 text-orange-400" /> {built.tss} TSS
          </span>
        </div>
      </div>

      {/* Vizualni profil intervala */}
      {built.allSteps.length > 0 && (
        <div className="h-14 w-full bg-zinc-900/80 rounded-xl p-1.5 flex items-end gap-0.5 border border-zinc-800/80 mb-3 overflow-hidden">
          {built.allSteps.map((st, idx) => {
            const widthPct = Math.max(1.2, (st.duration / totalSec) * 100);
            const heightPct = Math.min(100, Math.max(18, (st.power / 135) * 100));
            const watts = Math.round((st.power / 100) * ftp);
            return (
              <div
                key={idx}
                style={{ width: `${widthPct}%`, height: `${heightPct}%` }}
                title={`${Math.round(st.duration / 60)}m @ ${st.power}% FTP (${watts}W)`}
                className={`${getBarColor(st.power)} rounded-t-sm opacity-85 hover:opacity-100 transition-opacity`}
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
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-medium focus:border-cyan-500 outline-none"
            />
            <button
              type="button"
              onClick={handleAdd}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                added
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border-cyan-500/30'
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-black bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 transition-all shadow-[0_0_12px_rgba(34,211,238,0.25)]"
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
        <code key={idx} className="px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-300 font-mono text-[11px] border border-zinc-700/60">
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
            <li key={i} className="marker:text-cyan-400 marker:font-bold">{renderInlineFormatting(item)}</li>
          ))}
        </ol>
      );
    } else {
      elements.push(
        <ul key={`ul_${keySuffix}`} className="space-y-1.5 my-2 text-zinc-300 text-sm leading-relaxed">
          {listBuffer.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0" />
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
        <h4 key={idx} className="text-sm font-black text-cyan-300 mt-4 mb-1.5">
          {renderInlineFormatting(line.slice(5))}
        </h4>
      );
      return;
    }

    if (line.startsWith('### ')) {
      flushList(idx);
      elements.push(
        <h3 key={idx} className="text-base font-black text-zinc-100 mt-4 mb-2 pb-1 border-b border-zinc-800/80 flex items-center gap-2">
          {renderInlineFormatting(line.slice(4))}
        </h3>
      );
      return;
    }

    if (line.startsWith('## ') || line.startsWith('# ')) {
      flushList(idx);
      const clean = line.replace(/^#+\s*/, '');
      elements.push(
        <h2 key={idx} className="text-lg font-black text-cyan-400 mt-4 mb-2">
          {renderInlineFormatting(clean)}
        </h2>
      );
      return;
    }

    if (line.startsWith('> ')) {
      flushList(idx);
      elements.push(
        <blockquote key={idx} className="border-l-2 border-cyan-400 bg-cyan-500/5 px-3.5 py-2 my-2 rounded-r-xl text-xs md:text-sm text-zinc-300 italic">
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

  // Odvoji ```workout ... ``` blokove od običnog markdowna
  const segments = [];
  const regex = /```workout\s*([\s\S]*?)```/gi;
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

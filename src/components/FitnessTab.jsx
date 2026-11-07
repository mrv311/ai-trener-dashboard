import React, { useState, useMemo, useCallback } from 'react';
import { Activity, TrendingUp, AlertTriangle, Zap, CalendarDays } from 'lucide-react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const CHART_MARGIN = { top: 10, right: 10, left: -20, bottom: 0 };
const AXIS_TICK = { fontSize: 11, fill: '#71717a', fontFamily: 'JetBrains Mono, monospace' };
const LEFT_DOMAIN = [0, 'auto'];
const TOOLTIP_CONTENT_STYLE = {
  borderRadius: '10px',
  backgroundColor: '#09090b',
  border: '1px solid #27272a',
  boxShadow: '0 12px 32px rgba(0,0,0,0.75)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px'
};
const TOOLTIP_LABEL_STYLE = { fontWeight: 'bold', color: '#f4f4f5', marginBottom: '4px' };
const ACTIVE_DOT_FITNESS = { r: 5, fill: '#38bdf8', stroke: '#09090b', strokeWidth: 2 };
const ACTIVE_DOT_FATIGUE = { r: 4, fill: '#a855f7', stroke: '#09090b', strokeWidth: 1.5 };

function getFormColor(tsb) {
  if (tsb > 25) return "text-amber-400";
  if (tsb >= 5 && tsb <= 25) return "text-volt-400";
  if (tsb >= -10 && tsb < 5) return "text-zinc-300";
  return "text-rose-500";
}

function getFormStatus(tsb) {
  if (tsb > 25) return "Tranzicija / Gubitak forme";
  if (tsb >= 5 && tsb <= 25) return "Optimalno · Spreman za utrku";
  if (tsb >= -10 && tsb < 5) return "Produktivna zona treninga";
  return "Visoki zamor · Potreban odmor";
}

function FilterButton({ label, value, active, onClick }) {
  return (
    <button 
      type="button"
      onClick={() => onClick(value)}
      className={`px-3.5 py-1 rounded-md text-xs font-mono font-bold transition-all uppercase tracking-wider ${
        active 
          ? 'bg-volt-400 text-zinc-950 shadow-volt-glow' 
          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}

export default function FitnessTab({ wellnessData }) {
  const [timeFilter, setTimeFilter] = useState('3M'); // '1M', '3M', '6M', '1Y'
  const [visibleLines, setVisibleLines] = useState({
    Fitness: true,
    Fatigue: true,
    Form: true
  });

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // 1. Pretvaramo objekt u niz i sortiramo (za danas koristimo actualCtl ako postoji za KPI kartice, a projekciju na grafu)
  const allChartData = useMemo(() => {
    if (!wellnessData || typeof wellnessData !== 'object') return [];
    return Object.entries(wellnessData)
      .map(([date, vals]) => {
        if (!vals) return null;
        const ctl = typeof vals.ctl === 'number' ? vals.ctl : Number(vals.ctl) || 0;
        const atl = typeof vals.atl === 'number' ? vals.atl : Number(vals.atl) || 0;
        const tsb = ctl - atl;
        const actCtl = vals.actualCtl != null ? Number(vals.actualCtl) : ctl;
        const actAtl = vals.actualAtl != null ? Number(vals.actualAtl) : atl;
        return {
          date: String(date),
          Fitness: Math.round(ctl),
          Fatigue: Math.round(atl),
          Form: Math.round(tsb),
          ActualFitness: Math.round(actCtl),
          ActualFatigue: Math.round(actAtl),
          ActualForm: Math.round(actCtl - actAtl)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [wellnessData]);

  // 2. Filtriramo podatke ovisno o odabranom periodu + 21 dan projekcije unaprijed
  const filteredChartData = useMemo(() => {
    if (!allChartData.length) return [];
    
    const today = new Date();
    const cutoffDate = new Date(today);

    if (timeFilter === '1M') cutoffDate.setMonth(today.getMonth() - 1);
    else if (timeFilter === '3M') cutoffDate.setMonth(today.getMonth() - 3);
    else if (timeFilter === '6M') cutoffDate.setMonth(today.getMonth() - 6);
    else if (timeFilter === '1Y') cutoffDate.setFullYear(today.getFullYear() - 1);

    const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

    const futureCap = new Date(today);
    futureCap.setDate(today.getDate() + 21);
    const futureCapStr = `${futureCap.getFullYear()}-${String(futureCap.getMonth() + 1).padStart(2, '0')}-${String(futureCap.getDate()).padStart(2, '0')}`;
    
    return allChartData.filter(d => d.date >= cutoffStr && d.date <= futureCapStr);
  }, [allChartData, timeFilter]);

  // 3. Podaci za DANAŠNJI dan (za velike kartice na vrhu — trenutna stvarna forma)
  const latest = useMemo(() => {
    if (!allChartData.length) return { Fitness: 0, Fatigue: 0, Form: 0 };
    const pastAndPresentData = allChartData.filter(d => d.date <= todayStr);
    const pt = pastAndPresentData.length > 0 
      ? pastAndPresentData[pastAndPresentData.length - 1] 
      : allChartData[0] || { Fitness: 0, Fatigue: 0, Form: 0 };
    return {
      Fitness: pt.ActualFitness ?? pt.Fitness,
      Fatigue: pt.ActualFatigue ?? pt.Fatigue,
      Form: pt.ActualForm ?? pt.Form
    };
  }, [allChartData, todayStr]);

  const hasTodayInChart = useMemo(() => {
    return filteredChartData.some(d => d.date === todayStr);
  }, [filteredChartData, todayStr]);

  const formatDateTick = useCallback((val) => {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    if (timeFilter === '1Y') {
      return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`;
    }
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  }, [timeFilter]);

  const toggleLine = useCallback((key) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-5 short:gap-3 animate-in fade-in pb-8 short:pb-3">
      
      {/* KARTICE STATUSNA FORMA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 short:gap-3 shrink-0">
        <div className="carbon-panel rounded-xl p-5 short:p-3.5 flex flex-col relative overflow-hidden group hover:border-sky-500/40 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-sky-400" />
          <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity"><TrendingUp className="w-12 h-12 short:w-9 short:h-9 text-sky-400"/></div>
          <div className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-[0.2em] mb-1 short:mb-0.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Fitness · CTL</div>
          <div className="text-4xl md:text-5xl short:text-3xl font-display font-bold telemetry-num text-zinc-100 my-1.5 short:my-0.5">{latest.Fitness}</div>
          <div className="text-xs font-mono text-zinc-500 mt-auto">42-dnevno kronično opterećenje</div>
        </div>

        <div className="carbon-panel rounded-xl p-5 short:p-3.5 flex flex-col relative overflow-hidden group hover:border-purple-500/40 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-purple-400" />
          <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity"><Zap className="w-12 h-12 short:w-9 short:h-9 text-purple-400"/></div>
          <div className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-[0.2em] mb-1 short:mb-0.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Fatigue · ATL</div>
          <div className="text-4xl md:text-5xl short:text-3xl font-display font-bold telemetry-num text-zinc-100 my-1.5 short:my-0.5">{latest.Fatigue}</div>
          <div className="text-xs font-mono text-zinc-500 mt-auto">7-dnevni akutni zamor</div>
        </div>

        <div className="carbon-panel rounded-xl p-5 short:p-3.5 flex flex-col relative overflow-hidden group hover:border-volt-400/40 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-volt-400" />
          <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity"><AlertTriangle className="w-12 h-12 short:w-9 short:h-9 text-volt-400"/></div>
          <div className="text-[10px] font-mono font-bold text-volt-400 uppercase tracking-[0.2em] mb-1 short:mb-0.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Form · TSB</div>
          <div className={`text-4xl md:text-5xl short:text-3xl font-display font-bold telemetry-num my-1.5 short:my-0.5 ${getFormColor(latest.Form)}`}>{latest.Form > 0 ? `+${latest.Form}` : latest.Form}</div>
          <div className="text-xs font-mono font-bold mt-auto text-zinc-400">{getFormStatus(latest.Form)}</div>
        </div>
      </div>

      {/* GRAFIKON KARTICA */}
      <div className="carbon-panel bg-telemetry-grid rounded-xl p-4 md:p-6 short:p-3.5 flex flex-col">
        
        {/* ZAGLAVLJE GRAFA S FILTERIMA */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 short:mb-2.5 gap-3">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">PMC TELEMETRIJA</span>
            <h3 className="text-zinc-100 font-display font-bold uppercase tracking-wide text-lg md:text-xl">Performance Management Chart</h3>
          </div>
          
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 w-full sm:w-auto overflow-x-auto shrink-0">
            <CalendarDays className="w-3.5 h-3.5 text-zinc-500 ml-2 mr-1 shrink-0" />
            <FilterButton label="1M" value="1M" active={timeFilter === '1M'} onClick={setTimeFilter} />
            <FilterButton label="3M" value="3M" active={timeFilter === '3M'} onClick={setTimeFilter} />
            <FilterButton label="6M" value="6M" active={timeFilter === '6M'} onClick={setTimeFilter} />
            <FilterButton label="1Y" value="1Y" active={timeFilter === '1Y'} onClick={setTimeFilter} />
          </div>
        </div>

        {/* INTERAKTIVNA KORISNIČKA LEGENDA (Sprječava Recharts v3 Legend dispatcher crash) */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-4 mb-4 short:mb-2 select-none font-mono">
          <button
            type="button"
            onClick={() => toggleLine('Fitness')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Fitness 
                ? 'bg-sky-500/12 border-sky-500/35 text-sky-300' 
                : 'bg-zinc-950 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${visibleLines.Fitness ? 'bg-sky-400' : 'bg-zinc-600'}`} />
            <span>CTL Fitness</span>
          </button>

          <button
            type="button"
            onClick={() => toggleLine('Fatigue')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Fatigue 
                ? 'bg-purple-500/12 border-purple-500/35 text-purple-300' 
                : 'bg-zinc-950 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${visibleLines.Fatigue ? 'bg-purple-400' : 'bg-zinc-600'}`} />
            <span>ATL Fatigue</span>
          </button>

          <button
            type="button"
            onClick={() => toggleLine('Form')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Form 
                ? 'bg-amber-500/12 border-amber-500/35 text-amber-300' 
                : 'bg-zinc-950 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${visibleLines.Form ? 'bg-amber-400' : 'bg-zinc-600'}`} />
            <span>TSB Form</span>
          </button>
        </div>
        
        {filteredChartData.length > 0 ? (
          <div className="w-full h-[360px] md:h-[440px] short:h-[260px] vshort:h-[210px] min-h-[300px] short:min-h-[195px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={filteredChartData} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="ctlAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#23252c" />
                <XAxis 
                  dataKey="date" 
                  tick={AXIS_TICK} 
                  tickMargin={10}
                  stroke="#27272a"
                  tickFormatter={formatDateTick}
                />
                <YAxis yAxisId="left" tick={AXIS_TICK} stroke="#27272a" domain={LEFT_DOMAIN} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} stroke="#27272a" />
                
                <ReferenceLine yAxisId="right" y={25} stroke="#f59e0b" strokeDasharray="3 3" opacity={0.25} />
                <ReferenceLine yAxisId="right" y={5} stroke="#a3e635" strokeDasharray="3 3" opacity={0.35} />
                <ReferenceLine yAxisId="right" y={-10} stroke="#f43f5e" strokeDasharray="3 3" opacity={0.3} />
                {hasTodayInChart && (
                  <ReferenceLine x={todayStr} yAxisId="left" stroke="#a3e635" strokeWidth={1.5} strokeDasharray="4 4" />
                )}

                <Tooltip 
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                
                {visibleLines.Fitness && (
                  <Area 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="Fitness" 
                    stroke="#38bdf8" 
                    strokeWidth={2.5} 
                    fill="url(#ctlAreaFill)"
                    dot={false} 
                    activeDot={ACTIVE_DOT_FITNESS} 
                    name="Fitness (CTL)" 
                    isAnimationActive={false}
                  />
                )}
                {visibleLines.Fatigue && (
                  <Line 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="Fatigue" 
                    stroke="#a855f7" 
                    strokeWidth={2} 
                    dot={false} 
                    activeDot={ACTIVE_DOT_FATIGUE} 
                    opacity={0.85} 
                    name="Fatigue (ATL)" 
                    isAnimationActive={false}
                  />
                )}
                {visibleLines.Form && (
                  <Line 
                    yAxisId="right" 
                    type="step" 
                    dataKey="Form" 
                    stroke="#f59e0b" 
                    strokeWidth={2} 
                    dot={false} 
                    name="Form (TSB)" 
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-center px-4 text-zinc-500 font-medium gap-1.5 bg-zinc-950/60 rounded-xl border border-dashed border-zinc-800">
            <p className="text-zinc-300 font-display font-bold uppercase tracking-wide text-base">Nema zabilježene telemetrije forme</p>
            <p className="text-xs font-mono text-zinc-500">Odvozi trening na trenažeru, sinkroniziraj Intervals.icu ili uvezi .FIT/.TCX datoteku.</p>
          </div>
        )}
      </div>

    </div>
  );
}

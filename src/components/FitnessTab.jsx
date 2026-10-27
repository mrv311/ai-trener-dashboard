import React, { useState, useMemo, useCallback } from 'react';
import { Activity, TrendingUp, AlertTriangle, Zap, CalendarDays } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const CHART_MARGIN = { top: 10, right: 10, left: -20, bottom: 0 };
const AXIS_TICK = { fontSize: 11, fill: '#a1a1aa' };
const LEFT_DOMAIN = [0, 'auto'];
const TOOLTIP_CONTENT_STYLE = {
  borderRadius: '12px',
  backgroundColor: 'rgba(24,24,27,0.92)',
  backdropFilter: 'blur(8px)',
  border: '1px solid #3f3f46',
  boxShadow: '0 8px 30px rgba(0,0,0,0.5)'
};
const TOOLTIP_LABEL_STYLE = { fontWeight: 'bold', color: '#f4f4f5', marginBottom: '4px' };
const ACTIVE_DOT_FITNESS = { r: 6, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 };
const ACTIVE_DOT_FATIGUE = { r: 4, fill: '#a855f7' };

function getFormColor(tsb) {
  if (tsb > 25) return "text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]"; 
  if (tsb >= 5 && tsb <= 25) return "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"; 
  if (tsb >= -10 && tsb < 5) return "text-zinc-400"; 
  return "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]"; 
}

function getFormStatus(tsb) {
  if (tsb > 25) return "Tranzicija / Gubitak forme";
  if (tsb >= 5 && tsb <= 25) return "Optimalno (Spreman za utrku)";
  if (tsb >= -10 && tsb < 5) return "Siva Zona (Normalan trening)";
  return "Visoki rizik (Potreban odmor!)";
}

function FilterButton({ label, value, active, onClick }) {
  return (
    <button 
      type="button"
      onClick={() => onClick(value)}
      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider border ${
        active 
          ? 'bg-zinc-800 text-zinc-100 border-zinc-700 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' 
          : 'bg-zinc-950/50 text-zinc-500 hover:bg-zinc-800 border-zinc-800/80 hover:text-zinc-300'
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

  // 1. Pretvaramo objekt u niz i sortiramo
  const allChartData = useMemo(() => {
    if (!wellnessData || typeof wellnessData !== 'object') return [];
    return Object.entries(wellnessData)
      .map(([date, vals]) => {
        if (!vals) return null;
        const ctl = typeof vals.ctl === 'number' ? vals.ctl : Number(vals.ctl) || 0;
        const atl = typeof vals.atl === 'number' ? vals.atl : Number(vals.atl) || 0;
        const tsb = ctl - atl;
        return {
          date: String(date),
          Fitness: Math.round(ctl),
          Fatigue: Math.round(atl),
          Form: Math.round(tsb)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [wellnessData]);

  // 2. Filtriramo podatke ovisno o odabranom periodu
  const filteredChartData = useMemo(() => {
    if (!allChartData.length) return [];
    
    const today = new Date();
    let cutoffDate = new Date();

    if (timeFilter === '1M') cutoffDate.setMonth(today.getMonth() - 1);
    else if (timeFilter === '3M') cutoffDate.setMonth(today.getMonth() - 3);
    else if (timeFilter === '6M') cutoffDate.setMonth(today.getMonth() - 6);
    else if (timeFilter === '1Y') cutoffDate.setFullYear(today.getFullYear() - 1);

    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    // Uvijek ostavljamo podatke u budućnosti (da vidimo planirani TSB), 
    // ali režemo prošlost do cutoff datuma.
    return allChartData.filter(d => d.date >= cutoffStr);
  }, [allChartData, timeFilter]);

  // 3. Podaci za DANAŠNJI dan (za velike kartice na vrhu)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  
  const latest = useMemo(() => {
    if (!allChartData.length) return { Fitness: 0, Fatigue: 0, Form: 0 };
    const pastAndPresentData = allChartData.filter(d => d.date <= todayStr);
    return pastAndPresentData.length > 0 
      ? pastAndPresentData[pastAndPresentData.length - 1] 
      : allChartData[allChartData.length - 1] || { Fitness: 0, Fatigue: 0, Form: 0 };
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
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6 animate-in fade-in pb-8">
      
      {/* KARTICE STATUSNA FORMA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
        <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col relative overflow-hidden group hover:border-sky-500/30 transition-colors">
          <div className="absolute top-0 right-0 p-4 md:p-6 opacity-10 group-hover:opacity-20 transition-opacity"><TrendingUp className="w-12 h-12 md:w-16 md:h-16 text-sky-500"/></div>
          <div className="text-[10px] md:text-xs font-black text-sky-400 uppercase tracking-widest mb-1 flex items-center gap-1.5 drop-shadow-[0_0_5px_rgba(56,189,248,0.5)]"><Activity className="w-3 h-3 md:w-4 md:h-4"/> Fitness (CTL)</div>
          <div className="text-4xl md:text-5xl font-black text-zinc-100 my-1 md:my-2">{latest.Fitness}</div>
          <div className="text-sm font-medium text-zinc-500 mt-auto">Kondicija na današnji dan.</div>
        </div>

        <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col relative overflow-hidden group hover:border-purple-500/30 transition-colors">
          <div className="absolute top-0 right-0 p-4 md:p-6 opacity-10 group-hover:opacity-20 transition-opacity"><Zap className="w-12 h-12 md:w-16 md:h-16 text-purple-500"/></div>
          <div className="text-[10px] md:text-xs font-black text-purple-400 uppercase tracking-widest mb-1 flex items-center gap-1.5 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]"><Activity className="w-3 h-3 md:w-4 md:h-4"/> Fatigue (ATL)</div>
          <div className="text-4xl md:text-5xl font-black text-zinc-100 my-1 md:my-2">{latest.Fatigue}</div>
          <div className="text-sm font-medium text-zinc-500 mt-auto">Umor akumuliran do danas.</div>
        </div>

        <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col relative overflow-hidden group hover:border-amber-500/30 transition-colors">
          <div className="absolute top-0 right-0 p-4 md:p-6 opacity-10 group-hover:opacity-20 transition-opacity"><AlertTriangle className="w-12 h-12 md:w-16 md:h-16 text-amber-500"/></div>
          <div className="text-[10px] md:text-xs font-black text-orange-400 uppercase tracking-widest mb-1 flex items-center gap-1.5 drop-shadow-[0_0_5px_rgba(251,146,60,0.5)]"><Activity className="w-3 h-3 md:w-4 md:h-4"/> Form (TSB)</div>
          <div className={`text-4xl md:text-5xl font-black my-1 md:my-2 ${getFormColor(latest.Form)}`}>{latest.Form > 0 ? `+${latest.Form}` : latest.Form}</div>
          <div className="text-sm font-bold mt-auto text-zinc-400">{getFormStatus(latest.Form)}</div>
        </div>
      </div>

      {/* GRAFIKON KARTICA */}
      <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-800/80 p-4 md:p-6 flex flex-col">
        
        {/* ZAGLAVLJE GRAFA S FILTERIMA */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 gap-3 md:gap-4">
          <div>
            <h3 className="text-zinc-100 font-bold text-lg tracking-tight">Performance Management Chart</h3>
            <p className="text-xs text-zinc-500 font-medium mt-0.5">Praćenje opterećenja, zamora i svježine kroz vrijeme</p>
          </div>
          
          <div className="flex items-center gap-1 md:gap-2 bg-zinc-950/50 p-1 md:p-1.5 rounded-xl border border-zinc-800 w-full sm:w-auto overflow-x-auto shrink-0">
            <CalendarDays className="w-4 h-4 text-zinc-500 ml-1 md:ml-2 mr-1 shrink-0" />
            <FilterButton label="1M" value="1M" active={timeFilter === '1M'} onClick={setTimeFilter} />
            <FilterButton label="3M" value="3M" active={timeFilter === '3M'} onClick={setTimeFilter} />
            <FilterButton label="6M" value="6M" active={timeFilter === '6M'} onClick={setTimeFilter} />
            <FilterButton label="1Y" value="1Y" active={timeFilter === '1Y'} onClick={setTimeFilter} />
          </div>
        </div>

        {/* INTERAKTIVNA KORISNIČKA LEGENDA (Sprječava Recharts v3 Legend dispatcher crash) */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mb-4 select-none">
          <button
            type="button"
            onClick={() => toggleLine('Fitness')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Fitness 
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.15)]' 
                : 'bg-zinc-950/40 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${visibleLines.Fitness ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.7)]' : 'bg-zinc-600'}`}></span>
            <span>Fitness (CTL)</span>
          </button>

          <button
            type="button"
            onClick={() => toggleLine('Fatigue')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Fatigue 
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.15)]' 
                : 'bg-zinc-950/40 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${visibleLines.Fatigue ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.7)]' : 'bg-zinc-600'}`}></span>
            <span>Fatigue (ATL)</span>
          </button>

          <button
            type="button"
            onClick={() => toggleLine('Form')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              visibleLines.Form 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]' 
                : 'bg-zinc-950/40 border-zinc-800 text-zinc-600 line-through opacity-60 hover:opacity-80'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${visibleLines.Form ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]' : 'bg-zinc-600'}`}></span>
            <span>Form (TSB)</span>
          </button>
        </div>
        
        {filteredChartData.length > 0 ? (
          <div className="w-full h-[360px] md:h-[440px] min-h-[300px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" />
                <XAxis 
                  dataKey="date" 
                  tick={AXIS_TICK} 
                  tickMargin={10}
                  tickFormatter={formatDateTick}
                />
                <YAxis yAxisId="left" tick={AXIS_TICK} domain={LEFT_DOMAIN} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} />
                
                <ReferenceLine yAxisId="right" y={25} stroke="#f59e0b" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine yAxisId="right" y={5} stroke="#10b981" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine yAxisId="right" y={-10} stroke="#f43f5e" strokeDasharray="3 3" opacity={0.3} />
                {hasTodayInChart && (
                  <ReferenceLine x={todayStr} yAxisId="left" stroke="#52525b" strokeWidth={2} strokeDasharray="4 4" />
                )}

                <Tooltip 
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                
                {visibleLines.Fitness && (
                  <Line 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="Fitness" 
                    stroke="#0ea5e9" 
                    strokeWidth={3} 
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
                    opacity={0.7} 
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
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-center px-4 text-zinc-500 font-medium gap-1">
            <p className="text-zinc-400 font-bold">Još nema zabilježenih treninga za izračun kondicije i forme.</p>
            <p className="text-xs text-zinc-500">Odvozi prvi trening na trenažeru, dodaj plan u Kalendar ili uvezi .FIT/.TCX datoteku.</p>
          </div>
        )}
      </div>

    </div>
  );
}

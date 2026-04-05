import React, { useState, useMemo } from 'react';
import { Activity, TrendingUp, AlertTriangle, Zap, CalendarDays } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function FitnessTab({ wellnessData }) {
  const [timeFilter, setTimeFilter] = useState('3M'); // Opcije: '1M', '3M', '6M', '1Y'

  // 1. Pretvaramo objekt u niz i sortiramo
  const allChartData = useMemo(() => {
    if (!wellnessData) return [];
    return Object.entries(wellnessData)
      .map(([date, vals]) => {
        const ctl = vals.ctl || 0;
        const atl = vals.atl || 0;
        const tsb = ctl - atl;
        return {
          date,
          Fitness: Math.round(ctl),
          Fatigue: Math.round(atl),
          Form: Math.round(tsb)
        };
      })
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
  const todayStr = new Date().toISOString().split('T')[0];
  const pastAndPresentData = allChartData.filter(d => d.date <= todayStr);
  const latest = pastAndPresentData.length > 0 
    ? pastAndPresentData[pastAndPresentData.length - 1] 
    : { Fitness: 0, Fatigue: 0, Form: 0 };

  const getFormColor = (tsb) => {
    if (tsb > 25) return "text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]"; 
    if (tsb >= 5 && tsb <= 25) return "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"; 
    if (tsb >= -10 && tsb < 5) return "text-zinc-400"; 
    return "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]"; 
  };

  const getFormStatus = (tsb) => {
    if (tsb > 25) return "Tranzicija / Gubitak forme";
    if (tsb >= 5 && tsb <= 25) return "Optimalno (Spreman za utrku)";
    if (tsb >= -10 && tsb < 5) return "Siva Zona (Normalan trening)";
    return "Visoki rizik (Potreban odmor!)";
  };

  const FilterButton = ({ label, value }) => (
    <button 
      onClick={() => setTimeFilter(value)}
      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider border ${
        timeFilter === value 
          ? 'bg-zinc-800 text-zinc-100 border-zinc-700 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' 
          : 'bg-zinc-950/50 text-zinc-500 hover:bg-zinc-800 border-zinc-800/80 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      
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

      <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-800/80 p-4 md:p-6 flex-1 min-h-[300px] md:min-h-[400px] flex flex-col">
        
        {/* ZAGLAVLJE GRAFA S FILTERIMA */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 gap-3 md:gap-4">
          <h3 className="text-zinc-100 font-bold text-lg tracking-tight">Performance Management Chart</h3>
          
          <div className="flex items-center gap-1 md:gap-2 bg-zinc-950/50 p-1 md:p-1.5 rounded-xl border border-zinc-800 w-full sm:w-auto overflow-x-auto shrink-0">
            <CalendarDays className="w-4 h-4 text-zinc-500 ml-1 md:ml-2 mr-1 shrink-0" />
            <FilterButton label="1M" value="1M" />
            <FilterButton label="3M" value="3M" />
            <FilterButton label="6M" value="6M" />
            <FilterButton label="1Y" value="1Y" />
          </div>
        </div>
        
        {filteredChartData.length > 0 ? (
          <div className="flex-1 w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11, fill: '#a1a1aa' }} 
                  tickMargin={10}
                  tickFormatter={(val) => {
                    const d = new Date(val);
                    // Ako gledamo cijelu godinu, prikazujemo samo mjesece da ne bude gužva
                    if (timeFilter === '1Y') {
                      return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`;
                    }
                    return `${d.getDate()}.${d.getMonth() + 1}.`;
                  }}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#a1a1aa' }} domain={[0, 'auto']} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                
                <ReferenceLine yAxisId="right" y={25} stroke="#f59e0b" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine yAxisId="right" y={5} stroke="#10b981" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine yAxisId="right" y={-10} stroke="#f43f5e" strokeDasharray="3 3" opacity={0.3} />
                <ReferenceLine x={todayStr} yAxisId="left" stroke="#52525b" strokeWidth={2} strokeDasharray="4 4" />

                <Tooltip 
                  contentStyle={{ borderRadius: '12px', backgroundColor: 'rgba(24,24,27,0.85)', backdropFilter: 'blur(8px)', border: '1px solid #3f3f46', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#f4f4f5', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px', color: '#a1a1aa' }} />
                
                <Line yAxisId="left" type="monotone" dataKey="Fitness" stroke="#0ea5e9" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }} name="Fitness (CTL)" />
                <Line yAxisId="left" type="monotone" dataKey="Fatigue" stroke="#a855f7" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#a855f7' }} opacity={0.6} name="Fatigue (ATL)" />
                <Line yAxisId="right" type="step" dataKey="Form" stroke="#f59e0b" strokeWidth={2} dot={false} name="Form (TSB)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 font-medium">
            Nema dostupnih podataka o formi. Osvježi API.
          </div>
        )}
      </div>

    </div>
  );
}
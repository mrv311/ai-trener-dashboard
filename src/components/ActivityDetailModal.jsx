import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, Activity, Heart, Zap, Clock, TrendingUp, BarChart2, Database } from 'lucide-react';
import { downloadActivityFitFile, getActivityStreams } from '../services/intervalsApi';
import { calculateEF, calculateVI, calculateCogganMetrics } from '../utils/performanceMetrics';
import { supabase } from '../services/supabaseClient';
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const formatDur = (mins) => {
  if (!mins) return '-';
  const h = Math.floor(mins / 60);
  return `${h > 0 ? h + 'h ' : ''}${String(Math.floor(mins % 60)).padStart(2, '0')}m`;
};

const formatSeconds = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if(h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

export default function ActivityDetailModal({ activity, isOpen, onClose, intervalsId, intervalsKey }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [streamsData, setStreamsData] = useState([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [userFtp, setUserFtp] = useState(200);
  const [streamMetrics, setStreamMetrics] = useState({ np: 0, avgPower: 0, maxPower: 0, avgHr: 0 });
  const [supabaseMetrics, setSupabaseMetrics] = useState(null);
  const [dataSource, setDataSource] = useState(null); // 'intervals' | 'supabase' | null

  // Učitaj FTP iz profila
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ai_trener_profile') || '{}');
      if (stored.ftp && stored.ftp > 0) setUserFtp(stored.ftp);
    } catch(e) {}
  }, []);

  useEffect(() => {
    if (!isOpen || !activity) {
      setStreamsData([]);
      setSupabaseMetrics(null);
      setDataSource(null);
      return;
    }

    let mounted = true;

    const fetchData = async () => {
      setIsLoadingStreams(true);
      setDataSource(null);

      // 1. Pokušaj Intervals.icu streamove
      let intervalsSuccess = false;
      if (intervalsId && intervalsKey && (activity.id || activity.actId)) {
        try {
          const realActivityId = activity.actId || activity.id.toString().replace('act-', '');
          const rawStreams = await getActivityStreams(intervalsId, intervalsKey, realActivityId);
          
          if (!mounted) return;
          
          const getStream = (type) => rawStreams.find(s => s.type === type)?.data || [];
          const wattsStream = getStream('watts');
          const hrStream = getStream('heartrate');
          
          if (wattsStream.length > 0 || hrStream.length > 0) {
            intervalsSuccess = true;
            setDataSource('intervals');
            
            let maxP = 0; 
            let totalHr = 0; let validHr = 0;
            for (let i = 0; i < wattsStream.length; i++) {
              if (wattsStream[i] > maxP) maxP = wattsStream[i];
            }
            for (let i = 0; i < hrStream.length; i++) {
              if (hrStream[i] > 0) { totalHr += hrStream[i]; validHr++; }
            }
            
            const cMetrics = calculateCogganMetrics(wattsStream, userFtp);
            if (mounted) {
              setStreamMetrics({
                np: cMetrics.np,
                avgPower: cMetrics.avgPower,
                maxPower: maxP,
                avgHr: validHr > 0 ? Math.round(totalHr / validHr) : 0
              });
            }
            
            let maxLength = Math.max(wattsStream.length, hrStream.length);
            const step = Math.max(1, Math.ceil(maxLength / 3000)); 
            const finalData = [];
            for (let i = 0; i < maxLength; i += step) {
              finalData.push({ time: i, watts: wattsStream[i] || 0, hr: hrStream[i] || 0 });
            }
            setStreamsData(finalData);
          }
        } catch (err) {
          console.warn("Intervals.icu streams nedostupni:", err.message);
        }
      }

      // 2. Fallback: Supabase completed_activities
      if (!intervalsSuccess && mounted) {
        try {
          const actDate = activity.date;
          if (actDate) {
            const dayStart = `${actDate}T00:00:00`;
            const dayEnd = `${actDate}T23:59:59`;
            
            const { data, error } = await supabase
              .from('completed_activities')
              .select('id, avg_power, np, avg_hr, avg_cadence, tss, if_factor, work_kj, duration_seconds, distance_m, avg_speed_kmh, ftp_used, stream_data')
              .gte('started_at', dayStart)
              .lte('started_at', dayEnd)
              .order('started_at', { ascending: false })
              .limit(1);
            
            if (!mounted) return;
            
            if (!error && data && data.length > 0) {
              const record = data[0];
              setDataSource('supabase');
              setSupabaseMetrics(record);
              
              // Postavi metrike iz Supabase-a
              setStreamMetrics({
                np: record.np || 0,
                avgPower: record.avg_power || 0,
                maxPower: 0, // Supabase nema max_power, izračunat ćemo iz streama
                avgHr: record.avg_hr || 0
              });
              
              // Pretvori Supabase stream format {t, p, hr, cad, spd, dist} u chart format
              if (record.stream_data && record.stream_data.length > 0) {
                const rawStream = record.stream_data;
                const step = Math.max(1, Math.ceil(rawStream.length / 3000));
                const finalData = [];
                let maxP = 0;
                
                for (let i = 0; i < rawStream.length; i += step) {
                  const pt = rawStream[i];
                  if (pt.p > maxP) maxP = pt.p;
                  finalData.push({ time: pt.t || i, watts: pt.p || 0, hr: pt.hr || 0 });
                }
                
                // Update maxPower iz streama
                if (maxP > 0) {
                  setStreamMetrics(prev => ({ ...prev, maxPower: maxP }));
                }
                
                setStreamsData(finalData);
              }
            }
          }
        } catch (err) {
          console.error("Supabase fallback error:", err);
        }
      }

      if (mounted) setIsLoadingStreams(false);
    };
    
    fetchData();
    return () => { mounted = false; };
  }, [activity, isOpen, intervalsId, intervalsKey, userFtp]);

  const maxPowerStream = useMemo(() => {
    if (!streamsData.length) return 300;
    let md = Math.max(...streamsData.map(d => d.watts));
    return md > 0 ? md : 300;
  }, [streamsData]);

  if (!isOpen || !activity) return null;

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      const realActivityId = activity.actId || activity.id.toString().replace('act-', '');
      await downloadActivityFitFile(intervalsId, intervalsKey, realActivityId);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsDownloading(false);
    }
  };

  // Metrike: koristimo Supabase ako je dostupan kao fallback
  const sb = supabaseMetrics || {};
  const actualTss = activity.tss || activity.icu_training_load || sb.tss || 0;
  const plannedTss = activity.plannedTss || 0;
  const actualDur = activity.duration || (sb.duration_seconds ? Math.round(sb.duration_seconds / 60) : 0);
  const plannedDur = activity.plannedDuration || 0;
  const actualNp = activity.np || streamMetrics.np || sb.np || 0;
  const actualAvgPower = activity.average_power || streamMetrics.avgPower || sb.avg_power || 0;
  const actualAvgHr = activity.average_heartrate || streamMetrics.avgHr || sb.avg_hr || 0;
  const actualMaxPower = activity.max_power || streamMetrics.maxPower || 0;

  const ef = calculateEF(actualNp, actualAvgHr);
  const vi = calculateVI(actualNp, actualAvgPower);

  // Compliance calculations
  let tssColor = "text-zinc-100"; let tssBgColor = "bg-zinc-800/50";
  if (plannedTss > 0) {
    const ratio = actualTss / plannedTss;
    if (ratio >= 0.95 && ratio <= 1.05) { tssColor = "text-emerald-400"; tssBgColor = "bg-emerald-500/10 border-emerald-500/20"; }
    else if (ratio >= 0.8 && ratio <= 1.2) { tssColor = "text-amber-400"; tssBgColor = "bg-amber-500/10 border-amber-500/20"; }
    else { tssColor = "text-rose-400"; tssBgColor = "bg-rose-500/10 border-rose-500/20"; }
  }

  let durColor = "text-zinc-100"; let durBgColor = "bg-zinc-800/50";
  if (plannedDur > 0) {
    const ratio = actualDur / plannedDur;
    if (ratio >= 0.95 && ratio <= 1.05) { durColor = "text-emerald-400"; durBgColor = "bg-emerald-500/10 border-emerald-500/20"; }
    else if (ratio >= 0.8 && ratio <= 1.2) { durColor = "text-amber-400"; durBgColor = "bg-amber-500/10 border-amber-500/20"; }
    else { durColor = "text-rose-400"; durBgColor = "bg-rose-500/10 border-rose-500/20"; }
  }

  // Definicija gradienta ovisno o max snazi na grafu
  const z1 = Math.min((userFtp * 0.55 / maxPowerStream) * 100, 100);
  const z2 = Math.min((userFtp * 0.75 / maxPowerStream) * 100, 100);
  const z3 = Math.min((userFtp * 0.90 / maxPowerStream) * 100, 100);
  const z4 = Math.min((userFtp * 1.05 / maxPowerStream) * 100, 100);
  const z5 = Math.min((userFtp * 1.20 / maxPowerStream) * 100, 100);
  const z6 = Math.min((userFtp * 1.50 / maxPowerStream) * 100, 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-zinc-800/80 bg-zinc-950/50">
          <div>
            <h2 className="text-xl font-black text-zinc-100 leading-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              {activity.title || "Detalji aktivnosti"}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm font-medium text-zinc-500">{activity.date}</p>
              {dataSource && (
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${dataSource === 'supabase' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-sky-500/10 text-sky-400 border-sky-500/20'}`}>
                  {dataSource === 'supabase' ? '📊 Lokalni podaci' : '☁️ Intervals.icu'}
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-rose-500/20 rounded-lg transition-colors border border-transparent hover:border-rose-500/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          {/* Glavne Metrike - Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center shadow-inner">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-400" /> Normalized Power</span>
              <span className="text-3xl font-black text-zinc-100">{actualNp || '-'} <span className="text-sm text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center shadow-inner">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><BarChart2 className="w-3 h-3 text-sky-400" /> Average Power</span>
              <span className="text-3xl font-bold text-zinc-200">{actualAvgPower || '-'} <span className="text-sm text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center shadow-inner">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-orange-400" /> Max Power</span>
              <span className="text-3xl font-bold text-zinc-200">{actualMaxPower || '-'} <span className="text-sm text-zinc-600 font-medium lowercase">W</span></span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 flex flex-col items-center justify-center shadow-inner">
              <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><Heart className="w-3 h-3 text-rose-500" /> Average HR</span>
              <span className="text-3xl font-bold text-zinc-200">{actualAvgHr || '-'} <span className="text-sm text-zinc-600 font-medium lowercase">bpm</span></span>
            </div>
          </div>

          {/* Performance Chart */}
          <div className="bg-zinc-950/30 border border-zinc-800/80 rounded-xl p-5">
             <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Performance Chart</h3>
             <div className="h-64 w-full relative">
                {isLoadingStreams ? (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm font-medium">Dohvaćanje podataka...</div>
                ) : streamsData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={streamsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="powerZones" x1="0" y1="1" x2="0" y2="0">
                          {/* Y-axis ide od 0 dolje do 1 gore za gradient */}
                          <stop offset="0%" stopColor="#64748b" stopOpacity={0.6} /> {/* Z1 Slate */}
                          <stop offset={`${z1}%`} stopColor="#64748b" stopOpacity={0.6} />
                          
                          <stop offset={`${z1}%`} stopColor="#10b981" stopOpacity={0.6} /> {/* Z2 Emerald */}
                          <stop offset={`${z2}%`} stopColor="#10b981" stopOpacity={0.6} />
                          
                          <stop offset={`${z2}%`} stopColor="#fbbf24" stopOpacity={0.6} /> {/* Z3 Amber */}
                          <stop offset={`${z3}%`} stopColor="#fbbf24" stopOpacity={0.6} />
                          
                          <stop offset={`${z3}%`} stopColor="#f97316" stopOpacity={0.6} /> {/* Z4 Orange */}
                          <stop offset={`${z4}%`} stopColor="#f97316" stopOpacity={0.6} />
                          
                          <stop offset={`${z4}%`} stopColor="#f43f5e" stopOpacity={0.6} /> {/* Z5 Rose */}
                          <stop offset={`${z5}%`} stopColor="#f43f5e" stopOpacity={0.6} />
                          
                          <stop offset={`${z5}%`} stopColor="#a855f7" stopOpacity={0.6} /> {/* Z6 Purple */}
                          <stop offset={`${z6}%`} stopColor="#a855f7" stopOpacity={0.6} />

                          <stop offset={`${z6}%`} stopColor="#d946ef" stopOpacity={0.6} /> {/* Z7 Fuchsia */}
                          <stop offset="100%" stopColor="#d946ef" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis 
                         dataKey="time" 
                         tickFormatter={formatSeconds} 
                         stroke="#52525b" 
                         tick={{ fill: '#71717a', fontSize: 10 }}
                         minTickGap={30}
                      />
                      <YAxis 
                         yAxisId="left"
                         stroke="#52525b" 
                         tick={{ fill: '#71717a', fontSize: 10 }}
                         domain={[0, 'dataMax']}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', color: '#e4e4e7', fontSize: '12px' }}
                        itemStyle={{ color: '#e4e4e7' }}
                        labelFormatter={formatSeconds}
                        formatter={(value, name) => {
                          if (name === 'watts') return [<span className="font-bold text-amber-500">{value} W</span>, 'Snaga'];
                          if (name === 'hr') return [<span className="font-bold text-rose-500">{value} bpm</span>, 'Puls'];
                          return [value, name];
                        }}
                      />
                      <Area yAxisId="left" type="linear" dataKey="watts" stroke="#f59e0b" strokeWidth={1.5} fill="url(#powerZones)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-600 font-medium text-sm border border-dashed border-zinc-800 rounded-lg">
                     Graf nije dostupan (nema podataka)
                  </div>
                )}
             </div>
          </div>

          {/* Usporedba i Advanced Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">Plan vs Realizacija</h3>
              <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/30">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-zinc-900/50 border-b border-zinc-800/80 text-zinc-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Metrika</th>
                      <th className="px-4 py-3 font-semibold">Planirano</th>
                      <th className="px-4 py-3 font-semibold">Ostvareno</th>
                      <th className="px-4 py-3 font-semibold">Status (Score)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    <tr className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-zinc-300 flex items-center gap-2"><Clock className="w-4 h-4 text-zinc-500" /> Trajanje</td>
                      <td className="px-4 py-3 text-zinc-400">{plannedDur ? formatDur(plannedDur) : '-'}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-200">{actualDur ? formatDur(actualDur) : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${durBgColor} ${durColor}`}>
                           {plannedDur ? `${Math.round((actualDur/plannedDur)*100)}%` : 'N/A'}
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-zinc-300 flex items-center gap-2"><Activity className="w-4 h-4 text-zinc-500" /> TSS</td>
                      <td className="px-4 py-3 text-zinc-400">{plannedTss || '-'}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-200">{actualTss || actualTss === 0 ? actualTss : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${tssBgColor} ${tssColor}`}>
                           {plannedTss ? `${Math.round((actualTss/plannedTss)*100)}%` : 'N/A'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">Napredne Metrike</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 flex flex-col justify-center shadow-inner">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1">Variability Index (VI)</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-zinc-100">{vi || '-'}</span>
                    <span className="text-xs text-zinc-500 font-medium">NP / Avg Pwr</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {vi > 1.1 ? "Neravnomjeran napor (kriterij, MTB)" : vi > 1.0 ? "Umjereno ravnomjerno" : "Vrlo glatko (TT)"}
                  </div>
                </div>
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 flex flex-col justify-center shadow-inner">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1">Efficiency Factor (EF)</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-zinc-100">{ef || '-'}</span>
                    <span className="text-xs text-zinc-500 font-medium">NP / Avg HR</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    Pokazatelj aerobne efikasnosti pogona
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="flex justify-end p-5 border-t border-zinc-800/80 bg-zinc-950/50 gap-3">
          <button 
            type="button" 
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm text-zinc-300 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-white transition-all border border-zinc-700/50"
          >
            Zatvori
          </button>
          
          <button
            onClick={handleDownload}
            disabled={isDownloading || (!activity.id && !activity.actId)}
            className="px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <Download className="w-4 h-4" />
            )}
            Preuzmi .FIT datoteku
          </button>
        </div>
      </div>
    </div>
  );
}

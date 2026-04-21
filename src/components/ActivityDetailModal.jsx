import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, Activity, Heart, Zap, Clock, TrendingUp, BarChart2 } from 'lucide-react';
import { downloadActivityFitFile, getActivityStreams } from '../services/intervalsApi';
import { calculateEF, calculateVI } from '../utils/performanceMetrics';
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

export default function ActivityDetailModal({ activity, isOpen, onClose }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [streamsData, setStreamsData] = useState([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [userFtp, setUserFtp] = useState(200);

  useEffect(() => {
    if (!isOpen || !activity) {
      setStreamsData([]);
      return;
    }

    let mounted = true;
    
    // Pročitaj profile data
    const profileStr = localStorage.getItem('userProfile');
    let intervalsId = '', intervalsKey = '';
    if (profileStr) {
      const profile = JSON.parse(profileStr);
      if (profile.ftp) setUserFtp(profile.ftp);
      intervalsId = profile.intervalsId;
      intervalsKey = profile.intervalsApiKey;
    }

    if (!intervalsId || !intervalsKey || (!activity.id && !activity.actId)) {
      return;
    }

    const fetchStreams = async () => {
      try {
        setIsLoadingStreams(true);
        const realActivityId = activity.actId || activity.id.toString().replace('act-', '');
        const rawStreams = await getActivityStreams(intervalsId, intervalsKey, realActivityId);
        
        if (!mounted) return;
        
        const getStream = (type) => rawStreams.find(s => s.type === type)?.data || [];
        
        const wattsStream = getStream('watts');
        const hrStream = getStream('heartrate');
        
        let maxLength = Math.max(wattsStream.length, hrStream.length);
        
        // Optimizacija - downsampling ako ima previše točaka (max 1500 točaka za Recharts je obično ok, ciljamo <5000)
        // Ako je stream manji od 2000, koristimo sve
        const step = Math.max(1, Math.ceil(maxLength / 1500)); 
        
        const finalData = [];
        // useMemo inside effect logic is basically just reducing list here
        for (let i = 0; i < maxLength; i += step) {
          finalData.push({
            time: i,
            watts: wattsStream[i] || 0,
            hr: hrStream[i] || 0
          });
        }
        
        setStreamsData(finalData);
      } catch (err) {
        console.error("Streams error", err);
      } finally {
        if (mounted) setIsLoadingStreams(false);
      }
    };
    
    fetchStreams();

    return () => { mounted = false; };
  }, [activity, isOpen]);

  const maxPowerStream = useMemo(() => {
    if (!streamsData.length) return 300;
    let md = Math.max(...streamsData.map(d => d.watts));
    return md > 0 ? md : 300;
  }, [streamsData]);

  if (!isOpen || !activity) return null;

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      const profileStr = localStorage.getItem('userProfile');
      let intervalsId = '', intervalsKey = '';
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        intervalsId = profile.intervalsId;
        intervalsKey = profile.intervalsApiKey;
      }
      
      if (!intervalsId || !intervalsKey) throw new Error("Nedostaju Intervals.icu podaci za prijavu.");
      
      const realActivityId = activity.actId || activity.id.toString().replace('act-', '');
      await downloadActivityFitFile(intervalsId, intervalsKey, realActivityId);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const actualTss = activity.tss || activity.icu_training_load || 0;
  const plannedTss = activity.plannedTss || 0;
  const actualDur = activity.duration || 0;
  const plannedDur = activity.plannedDuration || 0;
  const actualNp = activity.np || activity.normalized_power || 0;
  const actualAvgPower = activity.average_power || activity.avgPower || 0;
  const actualAvgHr = activity.average_heartrate || activity.averageHr || 0;
  const actualMaxPower = activity.max_power || activity.maxPower || 0;

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
            <p className="text-sm font-medium text-zinc-500 mt-1">{activity.date}</p>
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
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm font-medium">Dohvaćanje podataka s Intervals.icu...</div>
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
                      <Area yAxisId="left" type="monotone" dataKey="watts" stroke="#f59e0b" strokeWidth={1} fill="url(#powerZones)" isAnimationActive={false} />
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

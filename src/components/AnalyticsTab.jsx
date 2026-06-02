import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, BarChart2, PieChart as PieChartIcon, Activity, CalendarDays, Zap, Heart, TrendingUp } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import { supabase } from '../services/supabaseClient';

export default function AnalyticsTab({ intervalsId, intervalsKey }) {
  const [allActivities, setAllActivities] = useState([]);
  const [activityFilter, setActivityFilter] = useState('cycling');
  const [wellnessData, setWellnessData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const pastDate = new Date();
    pastDate.setMonth(today.getMonth() - 3);
    return {
      startDate: pastDate.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    };
  });
  const [zoneType, setZoneType] = useState('power');

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!intervalsId || !intervalsKey) {
        setError("Nedostaju API podaci. Poveži se u Postavkama.");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const authString = btoa(`API_KEY:${String(intervalsKey || '').trim()}`);

        const oldest = dateRange.startDate;
        const newest = dateRange.endDate;

        const [activitiesResponse, wellnessResponse] = await Promise.all([
          fetch(
            `https://intervals.icu/api/v1/athlete/${String(intervalsId || '').trim()}/activities?oldest=${oldest}&newest=${newest}`,
            { headers: { 'Authorization': `Basic ${authString}`, 'Accept': 'application/json' } }
          ),
          fetch(
            `https://intervals.icu/api/v1/athlete/${String(intervalsId || '').trim()}/wellness?oldest=${oldest}&newest=${newest}`,
            { headers: { 'Authorization': `Basic ${authString}`, 'Accept': 'application/json' } }
          )
        ]);

        if (!activitiesResponse.ok) throw new Error("Nije moguće preuzeti vožnje za analitiku.");
        if (!wellnessResponse.ok) throw new Error("Nije moguće preuzeti wellness podatke.");

        const data = await activitiesResponse.json();
        const wData = await wellnessResponse.json();

        const hiddenList = JSON.parse(localStorage.getItem('ai_trener_hidden_intervals_activities') || '[]');
        
        const validActivities = data.filter(
          act => !hiddenList.includes(String(act.id)) && (act.icu_training_load > 0 || act.moving_time > 0)
        );

        const isCyclingActivity = (sbAct) => {
          if (!sbAct.workout_source) return true;
          const src = sbAct.workout_source.toLowerCase();
          if (src === 'free_ride' || src === 'calendar' || src === 'library' || src === 'local') return true;
          if (src.startsWith('external_upload_')) {
            const sport = src.replace('external_upload_', '');
            return ['cycling', 'virtual_ride', 'biking', 'ride'].includes(sport);
          }
          if (src === 'external_upload') {
            return (sbAct.avg_power || 0) > 0;
          }
          return true;
        };

        // Dohvati lokalne treninge iz Supabase/localStorage (koji možda još nisu uploadani na Intervals)
        try {
          const { data: supabaseData } = await supabase
            .from('completed_activities')
            .select('id, started_at, title, duration_seconds, tss, workout_source, avg_power')
            .gte('started_at', oldest)
            .lte('started_at', newest + 'T23:59:59');

          const localFallback = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities') || '[]');
          const combinedLocalActivities = [...(supabaseData || [])];
          
          localFallback.forEach(localAct => {
            const localTime = new Date(localAct.started_at).getTime();
            const existingSbAct = combinedLocalActivities.find(sbAct => Math.abs(new Date(sbAct.started_at).getTime() - localTime) < 60000);
            if (!existingSbAct) combinedLocalActivities.push(localAct);
          });

          combinedLocalActivities.forEach(sbAct => {
            if (sbAct.tss > 0 || sbAct.duration_seconds > 0) {
              const sbTime = new Date(sbAct.started_at).getTime();
              const isDuplicate = validActivities.some(act => {
                // Koristimo striktno UTC datume ako su dostupni za precizniju usporedbu
                const actTime = act.start_date ? new Date(act.start_date).getTime() : new Date(act.start_date_local).getTime();
                return Math.abs(sbTime - actTime) < 45 * 60 * 1000; // Povećana tolerancija na 45 min
              });
              
              if (!isDuplicate) {
                validActivities.push({
                  id: `supabase-${sbAct.id}`,
                  type: isCyclingActivity(sbAct) ? 'VirtualRide' : 'Workout', // Dodjeljujemo točan sport
                  name: sbAct.title || 'Lokalni Trening',
                  start_date_local: sbAct.started_at,
                  icu_training_load: sbAct.tss || 0,
                  moving_time: sbAct.duration_seconds || 0,
                });
              }
            }
          });
        } catch (err) {
          console.warn("[AnalyticsTab] Neuspješno dohvaćanje lokalnih aktivnosti:", err);
        }

        setAllActivities(validActivities);
        setWellnessData(wData);

      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, [intervalsId, intervalsKey, dateRange]);

  const activities = useMemo(() => {
    if (activityFilter === 'cycling') {
      return allActivities.filter(act => act.type === 'Ride' || act.type === 'VirtualRide' || act.type === 'IndoorCycling' || act.type === 'EBikeRide');
    }
    return allActivities;
  }, [allActivities, activityFilter]);

  // === POPRAVLJENA LOGIKA ZA ZONE SNAGE ===
  const zoneData = useMemo(() => {
    if (!activities.length) return [];

    const zones = [0, 0, 0, 0, 0, 0, 0];
    let hasAnyData = false;

    activities.forEach(act => {
      let targetZoneSecs = [];

      if (zoneType === 'power') {
        const zoneTimes = act.icu_zone_times || [];
        targetZoneSecs = zoneTimes.map(zt => (zt && typeof zt.secs === 'number' ? zt.secs : 0));
      } else {
        targetZoneSecs = act.icu_hr_zone_times || [];
      }

      if (targetZoneSecs && Array.isArray(targetZoneSecs) && targetZoneSecs.length > 0) {
        targetZoneSecs.forEach((secs, i) => {
          if (i < 7) {
            zones[i] += (secs || 0);
            if (secs > 0) hasAnyData = true;
          }
        });
      }
    });

    if (!hasAnyData) return [];

    const zoneNames = zoneType === 'power'
      ? ['Z1 Oporavak', 'Z2 Baza', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2Max', 'Z6 Anaerobno', 'Z7 Neuromišićno']
      : ['Z1 Oporavak', 'Z2 Baza', 'Z3 Tempo', 'Z4 Threshold', 'Z5 Anaerobno', 'Z6+', 'Z7+'];

    const zoneColors = ['#52525b', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#d946ef', '#8b5cf6'];

    return zones
      .map((secs, i) => ({
        name: zoneNames[i],
        value: Math.round(secs / 3600 * 10) / 10,
        color: zoneColors[i]
      }))
      .filter(z => z.value > 0);
  }, [activities, zoneType]);

  const weeklyData = useMemo(() => {
    if (!activities.length) return [];

    const weeksMap = {};

    activities.forEach(act => {
      if (!act.start_date_local) return;

      const d = new Date(act.start_date_local);
      const day = d.getDay() || 7;
      d.setHours(-24 * (day - 1));

      const weekStart = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear().toString().substring(2, 4)}.`;

      if (!weeksMap[weekStart]) {
        weeksMap[weekStart] = { name: weekStart, tss: 0, hours: 0, originalDate: new Date(d) };
      }

      weeksMap[weekStart].tss += act.icu_training_load || 0;
      weeksMap[weekStart].hours += (act.moving_time || 0) / 3600;
    });

    return Object.values(weeksMap)
      .sort((a, b) => a.originalDate - b.originalDate)
      .map(w => ({
        ...w,
        tss: Math.round(w.tss),
        hours: Math.round(w.hours * 10) / 10
      }));
  }, [activities]);

  const ftpData = useMemo(() => {
    if (!activities.length) return [];

    const extractedData = activities
      .filter(act => act.icu_ftp > 0 && act.start_date_local)
      .map(act => ({
        date: act.start_date_local.substring(0, 10),
        displayDate: `${act.start_date_local.substring(8, 10)}.${act.start_date_local.substring(5, 7)}.${act.start_date_local.substring(2, 4)}.`,
        ftp: act.icu_ftp
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const uniqueData = [];
    const seenDates = new Set();

    extractedData.forEach(item => {
      if (!seenDates.has(item.date)) {
        seenDates.add(item.date);
        uniqueData.push(item);
      }
    });

    return uniqueData;
  }, [activities]);

  const wellnessChartData = useMemo(() => {
    if (!wellnessData.length) return [];

    return wellnessData
      .filter(w => w.restingHR > 0 || w.hrv > 0)
      .map(w => ({
        date: w.id,
        displayDate: `${w.id.substring(8, 10)}.${w.id.substring(5, 7)}.${w.id.substring(2, 4)}.`,
        rhr: w.restingHR,
        hrv: w.hrv ? Math.round(w.hrv) : null
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [wellnessData]);

  const handleQuickFilter = (months) => {
    const today = new Date();
    const pastDate = new Date();
    pastDate.setMonth(today.getMonth() - months);
    setDateRange({
      startDate: pastDate.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    });
  };

  const renderCustomizedLabel = ({ cx, cy, midAngle, outerRadius, percent }) => {
    if (percent < 0.02) return null;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius * 1.15;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="#a1a1aa"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize="11px"
        fontWeight="bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const CustomFtpTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-900/90 backdrop-blur-md p-3 border border-zinc-700 shadow-2xl rounded-xl">
          <p className="font-bold text-zinc-400 mb-1 text-xs uppercase tracking-widest">{label}</p>
          <p className="font-black text-orange-500 text-xl drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]">
            {payload[0].value} <span className="text-sm font-bold text-zinc-500">W</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      {/* Header */}
      <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-orange-500/10 border border-orange-500/20 shadow-[inset_0_0_10px_rgba(249,115,22,0.1)] p-3 rounded-xl">
            <BarChart2 className="w-6 h-6 text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.6)]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-100 tracking-tight">Analitika Treninga</h2>
            <p className="text-sm text-zinc-500 font-medium">Uvid u tvoju distribuciju i konzistentnost kroz vrijeme.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
          <div className="flex items-center bg-zinc-950/50 p-1.5 rounded-xl border border-zinc-800">
            <button 
              onClick={() => setActivityFilter('cycling')} 
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activityFilter === 'cycling' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Samo Biciklizam
            </button>
            <button 
              onClick={() => setActivityFilter('all')} 
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activityFilter === 'all' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Svi Sportovi
            </button>
          </div>

          <div className="flex items-center gap-1 bg-zinc-950/50 p-2 rounded-xl border border-zinc-800">
            <button onClick={() => handleQuickFilter(1)} className="px-3 py-1 rounded-md text-xs font-bold transition-all uppercase bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700">1M</button>
            <button onClick={() => handleQuickFilter(3)} className="px-3 py-1 rounded-md text-xs font-bold transition-all uppercase bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700">3M</button>
            <button onClick={() => handleQuickFilter(6)} className="px-3 py-1 rounded-md text-xs font-bold transition-all uppercase bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700">6M</button>
            <button onClick={() => handleQuickFilter(12)} className="px-3 py-1 rounded-md text-xs font-bold transition-all uppercase bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700">1Y</button>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-zinc-500 shrink-0 hidden sm:block" />
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              style={{ colorScheme: 'dark' }}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-500 transition-colors cursor-pointer"
            />
            <span className="text-zinc-500 text-xs font-bold">-</span>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              style={{ colorScheme: 'dark' }}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-500 transition-colors cursor-pointer"
            />
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex-1 flex items-center justify-center text-red-400 text-center bg-red-500/10 border border-red-500/20 rounded-2xl p-6 shadow-[0_0_15px_rgba(248,113,113,0.1)]">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
          {/* Distribucija zona */}
          <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col relative min-h-[350px] md:min-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-zinc-100 font-bold flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-orange-500" /> Distribucija
              </h3>

              <div className="flex items-center bg-zinc-950/50 rounded-lg p-1 border border-zinc-800">
                <button
                  onClick={() => setZoneType('power')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${zoneType === 'power' ? 'bg-zinc-800 text-orange-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                >
                  <Zap className="w-3 h-3" /> Snaga
                </button>
                <button
                  onClick={() => setZoneType('hr')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${zoneType === 'hr' ? 'bg-zinc-800 text-rose-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                >
                  <Heart className="w-3 h-3" /> Puls
                </button>
              </div>
            </div>

            <p className="text-[11px] text-zinc-500 font-medium mb-2 uppercase tracking-widest">
              Vrijeme provedeno u zonama {zoneType === 'power' ? 'snage' : 'pulsa'}
            </p>

            {zoneData.length > 0 ? (
              <div className="flex-1 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={zoneData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                      label={renderCustomizedLabel}
                      labelLine={false}
                    >
                      {zoneData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{ borderRadius: '12px', backgroundColor: 'rgba(24,24,27,0.85)', backdropFilter: 'blur(8px)', border: '1px solid #3f3f46', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
                      itemStyle={{ color: '#f4f4f5', fontWeight: 'bold' }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={80}
                      iconType="circle"
                      wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#a1a1aa' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-sm italic text-center px-4 bg-zinc-950/40 rounded-xl border border-zinc-800 mt-4">
                <p>Nema zabilježenih podataka o zonama {zoneType === 'power' ? 'snage' : 'pulsa'} za odabrani period.</p>

                {zoneType === 'power' && (
                  <p className="text-amber-500/80 text-xs mt-3">
                    Napomena: Neke vožnje nemaju power meter ili nisu imale postavljen FTP.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Konzistentnost treninga */}
          <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col lg:col-span-2 relative min-h-[300px] md:min-h-[400px]">
            <h3 className="text-zinc-100 font-bold mb-1 flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-500" /> Konzistentnost Treninga
            </h3>
            <p className="text-[11px] text-zinc-500 font-medium mb-6 uppercase tracking-widest">
              TSS i Sati po tjednima
            </p>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#a1a1aa', fontWeight: 600 }}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ borderRadius: '12px', backgroundColor: 'rgba(24,24,27,0.85)', backdropFilter: 'blur(8px)', border: '1px solid #3f3f46', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
                    itemStyle={{ color: '#f4f4f5', fontWeight: 'bold' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px', color: '#a1a1aa' }} />
                  <Bar yAxisId="left" dataKey="hours" name="Sati" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar yAxisId="right" dataKey="tss" name="TSS" fill="#ea580c" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Povijest FTP-a */}
          <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col lg:col-span-3 relative h-[300px] md:h-[350px]">
            <h3 className="text-zinc-100 font-bold mb-1 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-500" /> Povijest FTP-a
            </h3>
            <p className="text-[11px] text-zinc-500 font-medium mb-6 uppercase tracking-widest">
              Kretanje tvoje kondicije kroz odabrani period
            </p>

            {ftpData.length > 0 ? (
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ftpData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorFtp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ea580c" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" opacity={0.5} />
                    <XAxis
                      dataKey="displayDate"
                      tick={{ fontSize: 11, fill: '#a1a1aa', fontWeight: 600 }}
                      tickMargin={10}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      domain={['dataMin - 10', 'dataMax + 10']}
                      tick={{ fontSize: 11, fill: '#a1a1aa' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip content={<CustomFtpTooltip />} cursor={{ stroke: '#f59e0b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Area
                      type="stepAfter"
                      dataKey="ftp"
                      name="FTP (W)"
                      stroke="#ea580c"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#colorFtp)"
                      activeDot={{ r: 6, fill: '#ea580c', stroke: '#18181b', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm italic text-center px-4">
                Nema zabilježenih podataka o snazi ili promjenama FTP-a u odabranom periodu.
              </div>
            )}
          </div>

          {/* Wellness Podaci (RHR & HRV) */}
          <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-800/80 p-4 md:p-6 flex flex-col lg:col-span-3 relative h-[300px] md:h-[350px]">
            <h3 className="text-zinc-100 font-bold mb-1 flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500" /> Wellness Podaci (RHR & HRV)
            </h3>
            <p className="text-[11px] text-zinc-500 font-medium mb-6 uppercase tracking-widest">
              Trendovi pulsa u mirovanju i varijabilnosti srčanog ritma
            </p>

            {wellnessChartData.length > 0 ? (
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={wellnessChartData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" />
                    <XAxis
                      dataKey="displayDate"
                      tick={{ fontSize: 11, fill: '#a1a1aa', fontWeight: 600 }}
                      tickMargin={10}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      domain={['dataMin - 5', 'dataMax + 5']}
                      tick={{ fontSize: 11, fill: '#a1a1aa' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 11, fill: '#a1a1aa' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: '12px', backgroundColor: 'rgba(24,24,27,0.85)', backdropFilter: 'blur(8px)', border: '1px solid #3f3f46', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
                      itemStyle={{ fontWeight: 'bold' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px', color: '#a1a1aa' }} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="rhr"
                      name="RHR (bpm)"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, fill: '#f43f5e', strokeWidth: 0 }}
                      connectNulls
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="hrv"
                      name="HRV (ms)"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, fill: '#38bdf8', strokeWidth: 0 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm italic text-center px-4">
                Nema zabilježenih wellness podataka za odabrani period.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
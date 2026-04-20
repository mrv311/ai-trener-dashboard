import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { exportTCXFromStream, exportFITFromStream } from '../utils/exportUtils';
import {
  Clock, Zap, Heart, Activity, Gauge, Download, Trash2, ChevronRight,
  X, TrendingUp, Flame, Route, Timer, Loader2, AlertCircle, RefreshCw
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend
} from 'recharts';

const formatDuration = (totalSeconds) => {
  if (!totalSeconds) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (isoString) => {
  const d = new Date(isoString);
  return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatTime = (isoString) => {
  const d = new Date(isoString);
  return d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
};

// Smanjuje stream podatke na max ~200 točaka za grafikon (downsampling)
const downsampleStream = (stream, maxPoints = 200) => {
  if (!stream || stream.length <= maxPoints) return stream || [];
  const step = Math.ceil(stream.length / maxPoints);
  const result = [];
  for (let i = 0; i < stream.length; i += step) {
    result.push(stream[i]);
  }
  // Uvijek uključi zadnju točku
  if (result[result.length - 1] !== stream[stream.length - 1]) {
    result.push(stream[stream.length - 1]);
  }
  return result;
};

// Custom tooltip za Recharts
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const mins = Math.floor(label / 60);
  const secs = label % 60;
  return (
    <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[11px] font-bold text-zinc-400 mb-2">{mins}:{String(secs).padStart(2, '0')}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-bold" style={{ color: entry.color }}>
          {entry.name}: {Math.round(entry.value)} {entry.name === 'Snaga' ? 'W' : entry.name === 'Puls' ? 'bpm' : entry.name === 'Kadenca' ? 'rpm' : 'km/h'}
        </p>
      ))}
    </div>
  );
};

// Stat kartica u detaljnom pogledu
function StatCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="bg-zinc-950/60 p-3 md:p-4 rounded-2xl border border-zinc-800/60 flex flex-col items-center justify-center gap-1 hover:border-zinc-700/80 transition-colors">
      <Icon className={`w-4 h-4 ${color} mb-0.5`} />
      <p className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">{label}</p>
      <p className="text-lg md:text-xl font-black text-zinc-100">
        {value} <span className="text-[11px] font-bold text-zinc-500">{unit}</span>
      </p>
    </div>
  );
}

export default function HistoryTab() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('completed_activities')
        .select('id, created_at, started_at, title, workout_source, duration_seconds, avg_power, avg_hr, avg_cadence, np, tss, if_factor, work_kj, distance_m, avg_speed_kmh, ftp_used, weight_kg')
        .order('started_at', { ascending: false });

      if (fetchError) throw fetchError;
      setActivities(data || []);
    } catch (err) {
      console.error('Greška pri dohvaćanju povijesti:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const handleViewDetail = async (activity) => {
    try {
      const { data, error: fetchError } = await supabase
        .from('completed_activities')
        .select('stream_data')
        .eq('id', activity.id)
        .single();

      if (fetchError) throw fetchError;
      setSelectedActivity({ ...activity, stream_data: data.stream_data });
    } catch (err) {
      console.error('Greška pri dohvaćanju stream podataka:', err);
      alert('Nije moguće učitati detalje treninga.');
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error: delError } = await supabase
        .from('completed_activities')
        .delete()
        .eq('id', id);

      if (delError) throw delError;
      setActivities(prev => prev.filter(a => a.id !== id));
      setDeleteConfirm(null);
      if (selectedActivity?.id === id) setSelectedActivity(null);
    } catch (err) {
      console.error('Greška pri brisanju:', err);
      alert('Brisanje nije uspjelo.');
    }
  };

  const handleExportTCX = (activity) => {
    const doExport = async () => {
      let streamData = activity.stream_data;
      if (!streamData) {
        const { data } = await supabase
          .from('completed_activities')
          .select('stream_data')
          .eq('id', activity.id)
          .single();
        streamData = data?.stream_data;
      }
      if (streamData) {
        exportTCXFromStream(streamData, activity.title, activity.started_at);
      }
    };
    doExport();
  };

  const handleExportFIT = (activity) => {
    const doExport = async () => {
      let streamData = activity.stream_data;
      if (!streamData) {
        const { data } = await supabase
          .from('completed_activities')
          .select('stream_data')
          .eq('id', activity.id)
          .single();
        streamData = data?.stream_data;
      }
      if (streamData) {
        exportFITFromStream(streamData, activity.title, activity.started_at);
      }
    };
    doExport();
  };

  // Detail modal chart data
  const chartData = selectedActivity?.stream_data
    ? downsampleStream(selectedActivity.stream_data)
    : [];

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 md:gap-6 animate-in fade-in pb-20 md:pb-0">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight">Povijest treninga</h2>
          <p className="text-xs md:text-sm text-zinc-500 font-medium mt-1">
            {activities.length} {activities.length === 1 ? 'trening' : 'treninga'} ukupno
          </p>
        </div>
        <button
          onClick={fetchActivities}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold border border-zinc-800 transition-all hover:border-zinc-700"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Osvježi
        </button>
      </div>

      {/* LOADING */}
      {loading && activities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          <p className="text-zinc-500 font-medium">Učitavanje povijesti...</p>
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* EMPTY STATE */}
      {!loading && !error && activities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="bg-zinc-900/50 p-5 rounded-full border border-zinc-800">
            <Clock className="w-10 h-10 text-zinc-600" />
          </div>
          <h3 className="text-lg font-bold text-zinc-400">Nema završenih treninga</h3>
          <p className="text-sm text-zinc-600 max-w-xs text-center">
            Pokreni trening na Trenažer tabu — rezultati će se automatski spremiti ovdje.
          </p>
        </div>
      )}

      {/* ACTIVITY LIST */}
      {!loading && activities.length > 0 && (
        <div className="flex flex-col gap-3">
          {activities.map((a) => (
            <div
              key={a.id}
              className="group bg-zinc-900/40 backdrop-blur-xl rounded-2xl border border-zinc-800/80 hover:border-zinc-700/80 transition-all shadow-lg hover:shadow-xl cursor-pointer overflow-hidden"
            >
              <div
                className="flex items-center gap-4 p-4 md:p-5"
                onClick={() => handleViewDetail(a)}
              >
                {/* Datum kolona */}
                <div className="shrink-0 w-14 md:w-16 flex flex-col items-center bg-zinc-950/50 rounded-xl py-2.5 px-2 border border-zinc-800/60">
                  <span className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">
                    {new Date(a.started_at).toLocaleDateString('hr-HR', { month: 'short' })}
                  </span>
                  <span className="text-xl md:text-2xl font-black text-zinc-200 leading-none mt-0.5">
                    {new Date(a.started_at).getDate()}
                  </span>
                </div>

                {/* Glavni info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm md:text-base font-bold text-zinc-100 truncate">{a.title}</h3>
                    {a.workout_source && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-700/50 shrink-0">
                        {a.workout_source}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] md:text-xs text-zinc-500 font-medium">
                    <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {formatDuration(a.duration_seconds)}</span>
                    {a.avg_power > 0 && <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500/70" /> {a.avg_power}W</span>}
                    {a.np > 0 && <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-sky-500/70" /> NP {a.np}W</span>}
                    {a.avg_hr > 0 && <span className="flex items-center gap-1"><Heart className="w-3 h-3 text-rose-500/70" /> {a.avg_hr}bpm</span>}
                    {a.tss > 0 && <span className="flex items-center gap-1"><Flame className="w-3 h-3 text-orange-500/70" /> TSS {Math.round(a.tss)}</span>}
                    {a.distance_m > 0 && <span className="flex items-center gap-1"><Route className="w-3 h-3 text-emerald-500/70" /> {(a.distance_m / 1000).toFixed(1)}km</span>}
                  </div>
                </div>

                {/* Akcije */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExportTCX(a); }}
                    className="p-2.5 rounded-xl hover:bg-sky-500/10 text-zinc-500 hover:text-sky-400 transition-colors"
                    title="Preuzmi TCX"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(a.id); }}
                    className="p-2.5 rounded-xl hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                    title="Obriši"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors ml-1" />
                </div>
              </div>

              {/* Delete confirmation inline */}
              {deleteConfirm === a.id && (
                <div className="flex items-center justify-between bg-red-500/5 border-t border-red-500/10 px-5 py-3 animate-in slide-in-from-top-2">
                  <p className="text-xs font-bold text-red-400">Sigurno želiš obrisati ovaj trening?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-xs font-bold text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors">Ne</button>
                    <button onClick={() => handleDelete(a.id)} className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">Da, obriši</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
          <div className="bg-zinc-900 rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl border border-zinc-800 animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 px-5 md:px-8 py-4 md:py-5 flex items-center justify-between rounded-t-3xl">
              <div>
                <h3 className="text-lg md:text-xl font-black text-zinc-100 tracking-tight">{selectedActivity.title}</h3>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  {formatDate(selectedActivity.started_at)} u {formatTime(selectedActivity.started_at)}
                  <span className="mx-2 text-zinc-700">·</span>
                  {formatDuration(selectedActivity.duration_seconds)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportFIT(selectedActivity)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold border border-emerald-500/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> FIT
                </button>
                <button
                  onClick={() => handleExportTCX(selectedActivity)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-xl text-xs font-bold border border-sky-500/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> TCX
                </button>
                <button
                  onClick={() => setSelectedActivity(null)}
                  className="p-2.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Stats grid */}
            <div className="px-5 md:px-8 py-5 md:py-6">
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-3 mb-6">
                <StatCard icon={Zap} label="Avg Power" value={selectedActivity.avg_power || 0} unit="W" color="text-amber-500" />
                <StatCard icon={TrendingUp} label="NP" value={selectedActivity.np || 0} unit="W" color="text-sky-500" />
                <StatCard icon={Flame} label="TSS" value={Math.round(selectedActivity.tss || 0)} unit="" color="text-orange-500" />
                <StatCard icon={Heart} label="Avg HR" value={selectedActivity.avg_hr || 0} unit="bpm" color="text-rose-500" />
                <StatCard icon={Activity} label="Cadence" value={selectedActivity.avg_cadence || 0} unit="rpm" color="text-orange-500" />
                <StatCard icon={Gauge} label="IF" value={selectedActivity.if_factor || '0.00'} unit="" color="text-violet-500" />
                <StatCard icon={Flame} label="Work" value={selectedActivity.work_kj || 0} unit="kJ" color="text-emerald-500" />
                <StatCard icon={Route} label="Udaljenost" value={selectedActivity.distance_m ? (selectedActivity.distance_m / 1000).toFixed(1) : '0.0'} unit="km" color="text-emerald-500" />
                <StatCard icon={Gauge} label="Avg Brzina" value={selectedActivity.avg_speed_kmh || '0.0'} unit="km/h" color="text-sky-500" />
                <StatCard icon={Zap} label="FTP" value={selectedActivity.ftp_used || '—'} unit="W" color="text-zinc-400" />
              </div>

              {/* Graf */}
              {chartData.length > 0 && (
                <div className="bg-zinc-950/50 rounded-2xl border border-zinc-800/60 p-3 md:p-5">
                  <h4 className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-4">Stream podatci</h4>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <defs>
                        <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis
                        dataKey="t"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        tickFormatter={(v) => `${Math.floor(v / 60)}'`}
                        stroke="#3f3f46"
                      />
                      <YAxis tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: 11, fontWeight: 700 }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Area type="monotone" dataKey="p" name="Snaga" stroke="#f59e0b" fill="url(#powerGrad)" strokeWidth={1.5} dot={false} />
                      <Area type="monotone" dataKey="hr" name="Puls" stroke="#f43f5e" fill="url(#hrGrad)" strokeWidth={1.5} dot={false} />
                      <Area type="monotone" dataKey="cad" name="Kadenca" stroke="#fb923c" fill="none" strokeWidth={1} strokeDasharray="4 2" dot={false} />
                      <Area type="monotone" dataKey="spd" name="Brzina" stroke="#34d399" fill="none" strokeWidth={1} strokeDasharray="4 2" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

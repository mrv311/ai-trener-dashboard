import React, { useState, useMemo } from 'react';
import { User, Zap, Save, CheckCircle2, Activity, CalendarDays, Clock, Heart } from 'lucide-react';

export default function ProfileTab({ profile, setProfile, workouts = [] }) {
  const [formData, setFormData] = useState({
    username: profile?.username || 'Odvažni Vozač',
    weight: profile?.weight || 75.9,
    ftp: profile?.ftp || 270,
    maxHr: profile?.maxHr || 180,
    thresholdHr: profile?.thresholdHr || 160
  });

  const [isSaved, setIsSaved] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setIsSaved(false);
  };

  const handleSave = () => {
    const updatedData = { ...formData };
    if (formData.ftp !== profile?.ftp) {
      updatedData.lastFtpUpdate = new Date().toISOString();
    }
    setProfile(updatedData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const powerZones = [
    { id: 'Z1', name: 'Active Recovery', min: 0, max: 55 }, { id: 'Z2', name: 'Endurance', min: 56, max: 75 },
    { id: 'Z3', name: 'Tempo', min: 76, max: 90 }, { id: 'Z4', name: 'Threshold', min: 91, max: 105 },
    { id: 'Z5', name: 'VO2 Max', min: 106, max: 120 }, { id: 'Z6', name: 'Anaerobic', min: 121, max: 150 },
    { id: 'Z7', name: 'Neuromuscular', min: 151, max: null }, { id: 'SS', name: 'Sweet Spot', min: 84, max: 97, isSubZone: true }
  ];

  const hrZones = [
    { id: 'Z1', name: 'Recovery', min: 0, max: 79 }, { id: 'Z2', name: 'Aerobic', min: 80, max: 89 },
    { id: 'Z3', name: 'Tempo', min: 89, max: 93 }, { id: 'Z4', name: 'SubThreshold', min: 93, max: 99 },
    { id: 'Z5', name: 'SuperThreshold', min: 100, max: 102 }, { id: 'Z6', name: 'Aerobic Capacity', min: 103, max: 106 },
    { id: 'Z7', name: 'Anaerobic', min: 106, max: null }
  ];

  const recentWorkouts = useMemo(() => {
    if (!workouts || !Array.isArray(workouts)) return [];
    
    const completed = workouts.filter(w => {
      const hasEffort = (w.icu_training_load > 0 || w.tss > 0 || w.moving_time > 0);
      const isPast = new Date(w.start_date_local || w.date) <= new Date();
      return hasEffort || isPast;
    });

    completed.sort((a, b) => new Date(b.start_date_local || b.date) - new Date(a.start_date_local || a.date));
    return completed.slice(0, 5);
  }, [workouts]);

  const formatDuration = (secs) => {
    if (!secs) return "-";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}min`;
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">

      {/* ZAGLAVLJE */}
      <div className="bg-zinc-950/50 rounded-3xl shadow-2xl border border-zinc-800/80 p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-6 relative overflow-hidden backdrop-blur-md">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-2 rounded-xl shadow-[0_0_10px_rgba(249,115,22,0.4)]"><User className="w-6 h-6 text-white" /></div>
            <h2 className="text-2xl font-black text-zinc-100 tracking-tight">Profil i Postavke</h2>
          </div>
          <p className="text-zinc-400 font-medium max-w-xl text-sm leading-relaxed">
            Osnovni podaci potrebni za izvođenje treninga, kalkulaciju W/kg i generiranje zona.
          </p>
        </div>

        <button
          onClick={handleSave}
          className={`relative z-10 flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg ${isSaved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-[0_4px_15px_rgba(249,115,22,0.3)] border border-orange-500/50'
            }`}
        >
          {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
          {isSaved ? 'Spremljeno' : 'Spremi Promjene'}
        </button>
      </div>

      {/* 1. OSNOVNI PARAMETRI */}
      <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6 flex flex-col gap-5 relative overflow-hidden">
        <div className="flex items-center gap-2 text-zinc-100 font-bold border-b border-zinc-800/80 pb-3">
          <Zap className="w-5 h-5 text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]" /> Fiziološki Podaci
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <div className="md:col-span-1">
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Korisničko Ime</label>
            <input type="text" name="username" value={formData.username} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-zinc-100 font-bold focus:ring-1 focus:ring-orange-500 focus:border-orange-500 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Težina (kg)</label>
            <input type="number" step="0.1" name="weight" value={formData.weight} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-zinc-100 font-bold focus:ring-1 focus:ring-orange-500 focus:border-orange-500 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Trenutni FTP (W)</label>
            <input type="number" name="ftp" value={formData.ftp} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-zinc-100 font-bold focus:ring-1 focus:ring-orange-500 focus:border-orange-500 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Max Puls (bpm)</label>
            <input type="number" name="maxHr" value={formData.maxHr} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-zinc-100 font-bold focus:ring-1 focus:ring-orange-500 focus:border-orange-500 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Threshold Puls</label>
            <input type="number" name="thresholdHr" value={formData.thresholdHr} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-zinc-100 font-bold focus:ring-1 focus:ring-orange-500 focus:border-orange-500 focus:outline-none transition-all" />
          </div>
        </div>
      </div>

      {/* 2. ZONE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6">
          <h3 className="text-sm font-bold text-zinc-200 mb-4 flex items-center bg-purple-500/10 text-purple-400 border border-purple-500/20 px-3 py-1.5 rounded-lg w-fit shadow-[0_0_10px_rgba(168,85,247,0.1)]"><Activity className="w-4 h-4 mr-2" /> Zone Snage (Power)</h3>
          <div className="text-xs text-zinc-400 space-y-1">
            {powerZones.map(z => {
              const minW = Math.round((formData.ftp * z.min) / 100);
              const maxW = z.max ? Math.round((formData.ftp * z.max) / 100) : null;
              return (
                <div key={z.id} className={`flex items-center justify-between py-2 border-b border-zinc-800/50 ${z.isSubZone ? 'mt-4 border-t border-zinc-700/50 pt-3 text-purple-400 font-bold' : ''}`}>
                  <div className="w-8 font-bold text-zinc-300">{z.id}</div><div className="flex-1">{z.name}</div><div className="w-20 text-right text-zinc-500">{z.min}% {z.max ? `- ${z.max}%` : '+'}</div><div className="w-24 text-right font-bold text-zinc-200">{minW}W - {maxW ? `${maxW}W` : '+'}</div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6">
          <h3 className="text-sm font-bold text-zinc-200 mb-4 flex items-center bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg w-fit shadow-[0_0_10px_rgba(244,63,94,0.1)]"><Heart className="w-4 h-4 mr-2" /> Zone Pulsa (HR)</h3>
          <div className="text-xs text-zinc-400 space-y-1">
            {hrZones.map(z => {
              const minBpm = Math.round((formData.thresholdHr * z.min) / 100);
              const maxBpm = z.max ? Math.round((formData.thresholdHr * z.max) / 100) : null;
              return (
                <div key={z.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50">
                  <div className="w-8 font-bold text-zinc-300">{z.id}</div><div className="flex-1">{z.name}</div><div className="w-20 text-right text-zinc-500">{z.min}% {z.max ? `- ${z.max}%` : '+'}</div><div className="w-24 text-right font-bold text-zinc-200">{minBpm}bpm - {maxBpm ? `${maxBpm}bpm` : formData.maxHr}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. ZADNJI TRENINGZI (POVIJEST) */}
      {recentWorkouts.length > 0 && (
        <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-center gap-2 text-zinc-100 font-bold border-b border-zinc-800/80 pb-3">
            <Activity className="w-5 h-5 text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]" /> Zadnjih 5 Treninga
          </div>
          
          <div className="flex flex-col gap-3">
            {recentWorkouts.map((workout, index) => {
              const dateStr = workout.start_date_local || workout.date;
              const displayDate = dateStr ? new Date(dateStr).toLocaleDateString('hr-HR') : 'Nepoznat datum';
              const title = workout.name || workout.title || 'Trening';
              const duration = workout.moving_time || workout.elapsed_time || workout.duration || 0;
              const tss = workout.icu_training_load || workout.tss || 0;

              return (
                <div key={workout.id || index} className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/50 hover:border-zinc-700 transition-colors">
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-100">{title}</span>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                        <CalendarDays className="w-3 h-3" /> {displayDate}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                        <Clock className="w-3 h-3" /> {formatDuration(duration)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">TSS</span>
                      <span className="font-bold text-orange-400">{Math.round(tss)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
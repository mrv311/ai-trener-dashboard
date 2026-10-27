import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, Zap, Save, CheckCircle2, Activity, CalendarDays, 
  Clock, Heart, Cloud, LogIn, HelpCircle, ChevronRight, RefreshCw 
} from 'lucide-react';
import ActivityDetailModal from './ActivityDetailModal';

export default function ProfileTab({ 
  profile, 
  setProfile, 
  workouts = [],
  userId,
  userEmail,
  intervalsId,
  intervalsKey,
  intervalsConnected,
  athleteInfo,
  onOpenAuthModal,
  onOpenOnboarding
}) {
  const [formData, setFormData] = useState({
    username: profile?.username || 'Odvažni Vozač',
    weight: profile?.weight || 75.9,
    ftp: profile?.ftp || 270,
    maxHr: profile?.maxHr || 180,
    thresholdHr: profile?.thresholdHr || 160
  });

  const [selectedActivity, setSelectedActivity] = useState(null);
  const [showAllWorkouts, setShowAllWorkouts] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFormData({
      username: profile.username || 'Odvažni Vozač',
      weight: profile.weight ?? 75.9,
      ftp: profile.ftp ?? 270,
      maxHr: profile.maxHr ?? 180,
      thresholdHr: profile.thresholdHr ?? 160
    });
  }, [profile?.username, profile?.weight, profile?.ftp, profile?.maxHr, profile?.thresholdHr]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setIsSaved(false);
  };

  const handleSave = () => {
    const updatedData = {
      ...formData,
      username: String(formData.username || '').trim() || 'Gost Vozač',
      weight: Number(formData.weight) || 75,
      ftp: Number(formData.ftp) || 200,
      maxHr: Number(formData.maxHr) || 180,
      thresholdHr: Number(formData.thresholdHr) || 160
    };
    if (Number(updatedData.ftp) !== Number(profile?.ftp)) {
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

  const allCompletedWorkouts = useMemo(() => {
    if (!workouts || !Array.isArray(workouts)) return [];
    
    const completed = workouts.filter(w => Boolean(w.isCompleted));
    completed.sort((a, b) => new Date(b.started_at || b.start_date_local || b.date) - new Date(a.started_at || a.start_date_local || a.date));
    return completed;
  }, [workouts]);

  const displayedWorkouts = useMemo(() => {
    return showAllWorkouts ? allCompletedWorkouts : allCompletedWorkouts.slice(0, 5);
  }, [allCompletedWorkouts, showAllWorkouts]);

  const formatDuration = (secs) => {
    if (!secs) return "-";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}min`;
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">

      {/* RAČUN I SINKRONIZACIJA OBLAKA BANNER */}
      {userId === 'guest' ? (
        <div className="bg-gradient-to-r from-cyan-950/40 via-zinc-900/80 to-zinc-900/80 border border-cyan-500/30 rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-[0_0_20px_rgba(34,211,238,0.06)]">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-zinc-100 text-base">Način rada: Gost</h3>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">Lokalno u pregledniku</span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Tvoji treninzi i profil spremaju se lokalno u ovom pregledniku. Prijavi se ili registriraj mailom za trajno čuvanje i sinkronizaciju među uređajima (svi trenutni lokalni podaci bit će automatski preneseni).
              </p>
            </div>
          </div>
          {onOpenAuthModal && (
            <button
              onClick={onOpenAuthModal}
              className="shrink-0 flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 px-5 py-2.5 rounded-xl font-bold text-xs shadow-[0_0_15px_rgba(34,211,238,0.25)] transition-all"
            >
              <LogIn className="w-4 h-4" /> Prijavi se / Registriraj
            </button>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900/40 border border-emerald-500/20 rounded-3xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-zinc-100 text-sm">ErgVibe Oblak Račun</h3>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Sinkronizacija aktivna</span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Prijavljen: <span className="text-zinc-200 font-bold">{userEmail || 'Korisnik'}</span>. Podaci i treninzi automatski se čuvaju u Supabase oblaku.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STATUS INTERVALS.ICU POVEZANOSTI */}
      {intervalsConnected && (
        <div className="bg-gradient-to-r from-cyan-950/30 to-zinc-900/60 border border-cyan-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
            <div>
              <span className="font-bold text-zinc-200">
                Intervals.icu je povezan
              </span>
              {athleteInfo?.name && (
                <span className="text-zinc-400 ml-1.5 font-medium">
                  (Sportaš: <strong className="text-cyan-300">{athleteInfo.name}</strong>)
                </span>
              )}
              <span className="text-zinc-500 block text-[11px] mt-0.5">
                Aktivnosti i planirani treninzi sinkroniziraju se s Intervals.icu računom.
              </span>
            </div>
          </div>
          {athleteInfo && (
            <button
              onClick={() => {
                const athleteFirstName = athleteInfo.firstname || (athleteInfo.name ? athleteInfo.name.trim().split(' ')[0] : '');
                const updated = {
                  ...formData,
                  username: athleteFirstName || formData.username,
                  ftp: Number(athleteInfo.icu_ftp || athleteInfo.ftp) || formData.ftp,
                  weight: Number(athleteInfo.weight || athleteInfo.icu_weight) || formData.weight,
                  maxHr: Number(athleteInfo.icu_max_hr || athleteInfo.max_hr) || formData.maxHr,
                  thresholdHr: Number(athleteInfo.icu_threshold_hr || athleteInfo.lthr) || formData.thresholdHr
                };
                setFormData(updated);
                setProfile(updated);
                setIsSaved(true);
                setTimeout(() => setIsSaved(false), 3000);
              }}
              className="shrink-0 flex items-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-xl font-bold text-xs transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Osvježi profil s Intervals.icu
            </button>
          )}
        </div>
      )}

      {/* ZAGLAVLJE */}
      <div className="bg-zinc-950/50 rounded-3xl shadow-2xl border border-zinc-800/80 p-6 md:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-6 relative overflow-hidden backdrop-blur-md">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gradient-to-br from-cyan-500 to-emerald-500 p-2 rounded-xl shadow-[0_0_10px_rgba(34,211,238,0.4)]"><User className="w-6 h-6 text-zinc-950" /></div>
            <h2 className="text-2xl font-black text-zinc-100 tracking-tight">Profil i Postavke</h2>
          </div>
          <p className="text-zinc-400 font-medium max-w-xl text-sm leading-relaxed">
            Osnovni podaci potrebni za izvođenje treninga, kalkulaciju W/kg i generiranje zona.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {onOpenOnboarding && (
            <button
              onClick={onOpenOnboarding}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition-all text-xs"
              title="Pokreni vodič za početnike ponovno"
            >
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              Vodič za početnike
            </button>
          )}

          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg text-xs md:text-sm ${isSaved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 shadow-[0_4px_15px_rgba(34,211,238,0.3)] border border-cyan-500/30'
              }`}
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {isSaved ? 'Spremljeno' : 'Spremi Promjene'}
          </button>
        </div>
      </div>

      {/* 1. OSNOVNI PARAMETRI */}
      <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6 flex flex-col gap-5 relative overflow-hidden">
        <div className="flex items-center gap-2 text-zinc-100 font-bold border-b border-zinc-800/80 pb-3">
          <Zap className="w-5 h-5 text-orange-500 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]" /> Fiziološki Podaci
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
      {allCompletedWorkouts.length > 0 && (
        <div className="bg-zinc-900/40 backdrop-blur-md rounded-3xl shadow-xl border border-zinc-800/80 p-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-zinc-100 font-bold">
              <Activity className="w-5 h-5 text-orange-500 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]" />
              <span>{showAllWorkouts ? `Svi Odrađeni Treninzi (${allCompletedWorkouts.length})` : 'Zadnjih 5 Treninga'}</span>
            </div>
            <span className="text-[11px] text-zinc-400 font-medium hidden sm:inline">
              Klikni na trening za analizu, streamove i .FIT izvoz
            </span>
          </div>
          
          <div className="flex flex-col gap-2.5">
            {displayedWorkouts.map((workout, index) => {
              const dateStr = workout.started_at || workout.start_date_local || workout.date;
              const displayDate = dateStr ? new Date(dateStr).toLocaleDateString('hr-HR') : 'Nepoznat datum';
              const title = workout.name || workout.title || 'Trening';
              const durationSecs = workout.moving_time || workout.elapsed_time || (workout.duration ? workout.duration * 60 : 0);
              const tss = workout.icu_training_load || workout.tss || 0;
              const avgPwr = workout.avg_power || (workout.icu_weighted_avg_watts ? Math.round(workout.icu_weighted_avg_watts) : 0);

              return (
                <div 
                  key={workout.id || index} 
                  onClick={() => setSelectedActivity(workout)}
                  className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/60 hover:border-cyan-500/40 hover:bg-zinc-800/50 transition-all cursor-pointer group shadow-sm"
                  title="Otvori detalje treninga"
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors flex items-center gap-2">
                      {title}
                      {workout.isSupabase && (
                        <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          ErgVibe
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                        <CalendarDays className="w-3 h-3 text-zinc-500" /> {displayDate}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                        <Clock className="w-3 h-3 text-zinc-500" /> {formatDuration(durationSecs)}
                      </span>
                      {avgPwr > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                          <Zap className="w-3 h-3 text-orange-400" /> {Math.round(avgPwr)}W
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-5 text-right">
                    {tss > 0 && (
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">TSS</span>
                        <span className="font-bold text-orange-400">{Math.round(tss)}</span>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              );
            })}
          </div>

          {allCompletedWorkouts.length > 5 && (
            <button
              onClick={() => setShowAllWorkouts(!showAllWorkouts)}
              className="w-full py-2.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-all flex items-center justify-center gap-2 mt-1"
            >
              {showAllWorkouts ? 'Prikaži samo zadnjih 5' : `Prikaži svih ${allCompletedWorkouts.length} treninga`}
            </button>
          )}
        </div>
      )}

      {/* MODAL DETALJA TRENINGA */}
      <ActivityDetailModal
        activity={selectedActivity}
        isOpen={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
        intervalsId={intervalsId}
        intervalsKey={intervalsKey}
        userId={userId}
        userProfile={profile}
      />

    </div>
  );
}

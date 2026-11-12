import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, Zap, Save, CheckCircle2, Activity, CalendarDays, 
  Clock, Heart, Cloud, LogIn, HelpCircle, ChevronRight, RefreshCw,
  Lock, Gauge, Award, ShieldCheck, Palette
} from 'lucide-react';
import ActivityDetailModal from './ActivityDetailModal';
import { extractIntervalsAthleteMetrics } from '../services/intervalsApi';

const UI_THEMES = [
  {
    id: 'volt',
    name: 'Carbon & Acid Volt',
    tag: 'ZADANO',
    desc: 'Fluorescentna trkaća zelena maksimalnog kontrasta na karbonskoj podlozi.',
    swatch: '#a3e635'
  },
  {
    id: 'corsa',
    name: 'Atelier Corsa',
    tag: 'UTRKA',
    desc: 'Talijanska natjecateljska crveno-narančasta za agresivan trkaći kokpit.',
    swatch: '#ff4d1c'
  },
  {
    id: 'aero',
    name: 'Stealth Aero',
    tag: 'AERO',
    desc: 'Hladna ledeno-plava telemetrija inspirirana zračnim tunelom.',
    swatch: '#38bdf8'
  }
];

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
  onOpenOnboarding,
  onNavigateToCalendar,
  uiTheme = 'volt',
  setUiTheme
}) {
  const [formData, setFormData] = useState({
    username: profile?.username || 'Odvažni Vozač',
    weight: profile?.weight !== undefined && profile?.weight !== null ? profile.weight : 75.9,
    ftp: profile?.ftp !== undefined && profile?.ftp !== null ? profile.ftp : 270,
    maxHr: profile?.maxHr !== undefined && profile?.maxHr !== null ? profile.maxHr : 180,
    thresholdHr: profile?.thresholdHr !== undefined && profile?.thresholdHr !== null ? profile.thresholdHr : 160
  });

  const [selectedActivity, setSelectedActivity] = useState(null);
  const [isSaved, setIsSaved] = useState(false);
  const athleteMetrics = useMemo(() => extractIntervalsAthleteMetrics(athleteInfo), [athleteInfo]);

  useEffect(() => {
    if (!profile) return;
    setFormData({
      username: profile.username || 'Odvažni Vozač',
      weight: profile.weight !== undefined && profile.weight !== null ? profile.weight : 75.9,
      ftp: profile.ftp !== undefined && profile.ftp !== null ? profile.ftp : 270,
      maxHr: profile.maxHr !== undefined && profile.maxHr !== null ? profile.maxHr : 180,
      thresholdHr: profile.thresholdHr !== undefined && profile.thresholdHr !== null ? profile.thresholdHr : 160
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
      weight: Number(formData.weight) || 75.9,
      ftp: Number(formData.ftp) || 200,
      maxHr: Number(formData.maxHr) || 180,
      thresholdHr: Number(formData.thresholdHr) || 160,
      isManualFtp: true,
      isManualWeight: true,
      isManualHr: true,
      lastFtpUpdate: new Date().toISOString()
    };
    setProfile(updatedData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleRefreshFromIntervals = () => {
    if (!athleteInfo) return;
    const metrics = extractIntervalsAthleteMetrics(athleteInfo);
    const athleteFirstName = metrics?.firstName || athleteInfo.firstname || (athleteInfo.name ? athleteInfo.name.trim().split(' ')[0] : '');
    const icuFtp = metrics?.ftp || Number(athleteInfo.icu_ftp || athleteInfo.ftp);
    const icuWeight = metrics?.weight || Number(athleteInfo.weight || athleteInfo.icu_weight);
    const icuMaxHr = metrics?.maxHr || Number(athleteInfo.icu_max_hr || athleteInfo.max_hr);
    const icuLthr = metrics?.thresholdHr || Number(athleteInfo.icu_threshold_hr || athleteInfo.lthr);

    const updated = {
      ...formData,
      username: athleteFirstName || formData.username,
      ftp: icuFtp || formData.ftp,
      weight: icuWeight || formData.weight,
      maxHr: icuMaxHr || formData.maxHr,
      thresholdHr: icuLthr || formData.thresholdHr,
      isManualFtp: false,
      isManualWeight: false,
      isManualHr: false,
      lastSyncWithIntervals: new Date().toISOString()
    };
    setFormData(updated);
    setProfile(updated);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  // Dinamički izračun W/kg omjera i kategorije
  const currentWeight = Number(formData.weight) || 75.9;
  const currentFtp = Number(formData.ftp) || 200;
  const wKg = currentWeight > 0 ? (currentFtp / currentWeight).toFixed(2) : '0.00';

  const getWKgCategory = (val) => {
    const num = parseFloat(val);
    if (num < 2.5) return { label: 'Rekreativac', color: 'text-zinc-400 bg-zinc-800/80 border-zinc-700' };
    if (num < 3.2) return { label: 'Klupski vozač (Z2/Z3)', color: 'text-sky-400 bg-sky-950/40 border-sky-500/30' };
    if (num < 4.0) return { label: 'Natjecatelj / Gran Fondo', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30' };
    if (num < 4.8) return { label: 'Elita (Cat 1/2)', color: 'text-orange-400 bg-orange-950/40 border-orange-500/30' };
    return { label: 'Pro / UCI razina', color: 'text-purple-400 bg-purple-950/40 border-purple-500/30' };
  };

  const wKgCat = getWKgCategory(wKg);

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

  // Strogo ograničeno na zadnjih 5 treninga radi brzine i izbjegavanja zagušenja DOM-a
  const displayedWorkouts = useMemo(() => {
    return allCompletedWorkouts.slice(0, 5);
  }, [allCompletedWorkouts]);

  const formatDuration = (secs) => {
    if (!secs) return "-";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}min`;
  };

  const getZoneColorDot = (zoneId) => {
    switch (zoneId) {
      case 'Z1': return 'bg-zinc-500';
      case 'Z2': return 'bg-sky-500';
      case 'Z3': return 'bg-emerald-500';
      case 'SS': return 'bg-volt-400';
      case 'Z4': return 'bg-amber-400';
      case 'Z5': return 'bg-rose-500';
      case 'Z6': return 'bg-purple-500';
      case 'Z7': return 'bg-fuchsia-500';
      default: return 'bg-zinc-400';
    }
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5 animate-in fade-in h-full pb-8">

      {/* RAČUN I SINKRONIZACIJA OBLAKA BANNER */}
      {userId === 'guest' ? (
        <div className="carbon-panel border-volt-400/30 rounded-xl p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-volt-400/10 border border-volt-400/30 text-volt-400 shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-base">Način rada: Gost</h3>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">LOKALNA MEMORIJA</span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Tvoji treninzi i profil spremaju se lokalno u ovom pregledniku. Prijavi se ili registriraj mailom za trajno čuvanje i sinkronizaciju među uređajima (svi trenutni lokalni podaci bit će automatski preneseni).
              </p>
            </div>
          </div>
          {onOpenAuthModal && (
            <button
              onClick={onOpenAuthModal}
              className="shrink-0 flex items-center gap-2 bg-volt-400 hover:bg-volt-300 text-zinc-950 px-5 py-2.5 rounded-lg font-display font-bold uppercase tracking-wider text-xs shadow-volt-glow transition-all"
            >
              <LogIn className="w-4 h-4" /> Prijavi se / Registriraj
            </button>
          )}
        </div>
      ) : (
        <div className="carbon-panel border-emerald-500/25 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-sm">ErgVibe Oblak Račun</h3>
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">SYNC AKTIVAN</span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Prijavljen: <span className="text-zinc-200 font-mono font-bold">{userEmail || 'Korisnik'}</span>. Podaci i treninzi automatski se čuvaju u bazi.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STATUS INTERVALS.ICU POVEZANOSTI */}
      {intervalsConnected && (
        <div className="carbon-panel border-volt-400/20 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-volt-400 animate-pulse shrink-0" />
            <div>
              <span className="font-bold text-zinc-200">
                Intervals.icu je povezan
              </span>
              {athleteInfo?.name && (
                <span className="text-zinc-400 ml-1.5 font-medium">
                  (Sportaš: <strong className="text-volt-400 font-mono">{athleteInfo.name}</strong>
                  {athleteMetrics?.ftp && (
                    <> · FTP na ICU: <strong className="text-volt-400 font-mono">{athleteMetrics.ftp}W</strong></>
                  )})
                </span>
              )}
              <span className="text-zinc-500 block text-[11px] mt-0.5">
                Aktivnosti i planirani treninzi sinkroniziraju se s Intervals.icu računom.
              </span>
            </div>
          </div>
          {athleteInfo && (
            <button
              onClick={handleRefreshFromIntervals}
              className="shrink-0 flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-volt-400 border border-volt-400/35 px-3 py-1.5 rounded-lg font-bold text-xs transition-all"
              title="Povuci svježi FTP, težinu i puls s Intervals.icu profila"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Osvježi profil s Intervals.icu
            </button>
          )}
        </div>
      )}

      {/* ZAGLAVLJE */}
      <div className="carbon-panel rounded-xl p-6 md:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-5 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="bg-volt-400/15 border border-volt-400/40 p-2 rounded-lg text-volt-400"><User className="w-6 h-6" /></div>
            <h2 className="text-2xl font-display font-bold uppercase tracking-wide text-zinc-100">Profil i Postavke</h2>
          </div>
          <p className="text-zinc-400 font-medium max-w-xl text-sm leading-relaxed">
            Fiziološki parametri za upravljanje trenažerom, izračun zona snage, analitiku treninga i izgled telemetrije.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          {onOpenOnboarding && (
            <button
              onClick={onOpenOnboarding}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition-all text-xs"
              title="Pokreni vodič za početnike ponovno"
            >
              <HelpCircle className="w-4 h-4 text-volt-400" />
              Vodič za početnike
            </button>
          )}

          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-display font-bold uppercase tracking-wider transition-all text-xs md:text-sm ${
              isSaved 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/35' 
                : 'bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow'
            }`}
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {isSaved ? 'Spremljeno (Zaključano)' : 'Spremi Promjene'}
          </button>
        </div>
      </div>

      {/* VIZUALNI IDENTITET / TEMA TELEMETRIJE */}
      {setUiTheme && (
        <div className="carbon-panel rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-zinc-100 font-display font-bold uppercase tracking-wide">
              <Palette className="w-5 h-5 text-volt-400" />
              <span>Boja Telemetrije (Vizualni Identitet)</span>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
              AKTIVNO: {UI_THEMES.find(t => t.id === uiTheme)?.name || 'Carbon & Acid Volt'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {UI_THEMES.map((themeItem) => {
              const active = uiTheme === themeItem.id;
              return (
                <button
                  key={themeItem.id}
                  type="button"
                  onClick={() => setUiTheme(themeItem.id)}
                  className={`text-left p-4 rounded-lg border transition-all flex flex-col gap-2 ${
                    active
                      ? 'bg-zinc-950 border-volt-400 shadow-volt-glow'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-4 h-4 rounded-sm border border-white/20 shrink-0"
                        style={{ backgroundColor: themeItem.swatch, boxShadow: `0 0 10px ${themeItem.swatch}66` }}
                      />
                      <span className="font-display font-bold uppercase tracking-wide text-sm text-zinc-100">
                        {themeItem.name}
                      </span>
                    </div>
                    <span className={`font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                      active
                        ? 'bg-volt-400/15 text-volt-400 border-volt-400/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}>
                      {active ? 'AKTIVNA' : themeItem.tag}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {themeItem.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 1. OSNOVNI PARAMETRI I W/KG METRIKA */}
      <div className="carbon-panel rounded-xl p-6 flex flex-col gap-5 relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-zinc-100 font-display font-bold uppercase tracking-wide">
            <Zap className="w-5 h-5 text-volt-400" /> 
            <span>Fiziološki Podaci</span>
          </div>
          
          {/* Status izvora FTP-a */}
          {profile?.isManualFtp ? (
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded">
              <Lock className="w-3.5 h-3.5" />
              <span>Ručni unos zaključan (prioritet nad Intervals.icu)</span>
            </div>
          ) : intervalsConnected ? (
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-volt-400 bg-volt-400/10 border border-volt-400/25 px-2.5 py-1 rounded">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sinkronizirano s Intervals.icu</span>
            </div>
          ) : null}
        </div>

        {/* Polja unosa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <div className="md:col-span-1">
            <label className="block font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Korisničko Ime</label>
            <input type="text" name="username" value={formData.username} onChange={handleChange} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-zinc-100 font-bold focus:border-volt-400 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Težina (kg)</label>
            <input type="number" step="0.1" name="weight" value={formData.weight} onChange={handleChange} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 font-mono telemetry-num text-zinc-100 font-bold focus:border-volt-400 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Trenutni FTP (W)</label>
            <input type="number" name="ftp" value={formData.ftp} onChange={handleChange} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 font-mono telemetry-num text-volt-400 font-bold focus:border-volt-400 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Max Puls (bpm)</label>
            <input type="number" name="maxHr" value={formData.maxHr} onChange={handleChange} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 font-mono telemetry-num text-zinc-100 font-bold focus:border-volt-400 focus:outline-none transition-all" />
          </div>
          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Threshold Puls</label>
            <input type="number" name="thresholdHr" value={formData.thresholdHr} onChange={handleChange} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 font-mono telemetry-num text-zinc-100 font-bold focus:border-volt-400 focus:outline-none transition-all" />
          </div>
        </div>

        {/* W/KG INTERAKTIVNA KARTICA */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-lg bg-volt-400/10 border border-volt-400/25 text-volt-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-zinc-400 font-medium">Relativna snaga:</span>
                <span className="text-xl font-display font-bold telemetry-num text-volt-400">{wKg} W/kg</span>
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${wKgCat.color}`}>
                  {wKgCat.label}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Izračunato na temelju: <strong className="font-mono text-zinc-300">{formData.ftp} W</strong> / <strong className="font-mono text-zinc-300">{formData.weight} kg</strong>. Promjenom brojeva gore omjer se odmah osvježava.
              </p>
            </div>
          </div>
          <div className="text-[11px] text-zinc-400 sm:text-right">
            Klikom na <strong className="text-volt-400">"Spremi Promjene"</strong> zaključavaš ove parametre za trenažer i zone snage.
          </div>
        </div>
      </div>

      {/* 2. ZONE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="carbon-panel rounded-xl p-6">
          <h3 className="text-xs font-display font-bold uppercase tracking-wider text-volt-400 mb-4 flex items-center bg-volt-400/10 border border-volt-400/25 px-3 py-1.5 rounded-md w-fit">
            <Activity className="w-4 h-4 mr-2" /> Zone Snage (Power)
          </h3>
          <div className="text-xs text-zinc-400 space-y-1">
            {powerZones.map(z => {
              const minW = Math.round((formData.ftp * z.min) / 100);
              const maxW = z.max ? Math.round((formData.ftp * z.max) / 100) : null;
              return (
                <div key={z.id} className={`flex items-center justify-between py-2 border-b border-zinc-800/60 ${z.isSubZone ? 'mt-4 border-t border-zinc-700/60 pt-3 text-volt-400 font-bold' : ''}`}>
                  <div className="w-11 font-mono font-bold text-zinc-200 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-sm ${getZoneColorDot(z.id)}`} />
                    {z.id}
                  </div>
                  <div className="flex-1">{z.name}</div>
                  <div className="w-20 text-right font-mono telemetry-num text-zinc-500">{z.min}%{z.max ? `–${z.max}%` : '+'}</div>
                  <div className="w-28 text-right font-mono telemetry-num font-bold text-zinc-100">{minW}W – {maxW ? `${maxW}W` : '+'}</div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="carbon-panel rounded-xl p-6">
          <h3 className="text-xs font-display font-bold uppercase tracking-wider text-rose-400 mb-4 flex items-center bg-rose-500/10 border border-rose-500/25 px-3 py-1.5 rounded-md w-fit">
            <Heart className="w-4 h-4 mr-2" /> Zone Pulsa (HR)
          </h3>
          <div className="text-xs text-zinc-400 space-y-1">
            {hrZones.map(z => {
              const minBpm = Math.round((formData.thresholdHr * z.min) / 100);
              const maxBpm = z.max ? Math.round((formData.thresholdHr * z.max) / 100) : null;
              return (
                <div key={z.id} className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <div className="w-11 font-mono font-bold text-zinc-200 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-sm ${getZoneColorDot(z.id)}`} />
                    {z.id}
                  </div>
                  <div className="flex-1">{z.name}</div>
                  <div className="w-20 text-right font-mono telemetry-num text-zinc-500">{z.min}%{z.max ? `–${z.max}%` : '+'}</div>
                  <div className="w-28 text-right font-mono telemetry-num font-bold text-zinc-100">{minBpm}–{maxBpm ? `${maxBpm}` : `${formData.maxHr}`} bpm</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. ZADNJI TRENINGZI (POVIJEST) - OPTIMIZIRANO NA ZADNJIH 5 S LINKOM NA KALENDAR */}
      {allCompletedWorkouts.length > 0 && (
        <div className="carbon-panel rounded-xl p-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-zinc-100 font-display font-bold uppercase tracking-wide">
              <Activity className="w-5 h-5 text-volt-400" />
              <span>Zadnjih 5 Odrađenih Treninga</span>
              <span className="font-mono telemetry-num text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                UKUPNO: {allCompletedWorkouts.length}
              </span>
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
                  className="flex items-center justify-between p-4 rounded-lg bg-zinc-950 border border-zinc-800/80 hover:border-volt-400/40 hover:bg-zinc-900/70 transition-all cursor-pointer group"
                  title="Otvori detalje treninga"
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-100 group-hover:text-volt-400 transition-colors flex items-center gap-2">
                      {title}
                      {workout.isSupabase && (
                        <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/25">
                          ERGVIBE
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap font-mono telemetry-num text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3 text-zinc-500" /> {displayDate}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-500" /> {formatDuration(durationSecs)}
                      </span>
                      {avgPwr > 0 && (
                        <span className="flex items-center gap-1 text-volt-400 font-bold">
                          <Zap className="w-3 h-3" /> {Math.round(avgPwr)}W
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-5 text-right">
                    {tss > 0 && (
                      <div className="flex flex-col font-mono telemetry-num">
                        <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">TSS</span>
                        <span className="font-bold text-amber-400">{Math.round(tss)}</span>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-volt-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80 flex-wrap gap-3">
            <span className="text-xs text-zinc-400">
              Prikazano je zadnjih 5 aktivnosti radi optimalne brzine rada.
            </span>
            {onNavigateToCalendar && (
              <button
                onClick={onNavigateToCalendar}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-wider bg-zinc-900 hover:bg-zinc-800 text-volt-400 border border-volt-400/35 transition-all"
              >
                <CalendarDays className="w-4 h-4" />
                Pogledaj cijelu povijest u Kalendaru
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
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
        workouts={workouts}
      />

    </div>
  );
}

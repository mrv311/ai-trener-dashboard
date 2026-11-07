import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';
import { Play, Loader2, Database, Clock, RefreshCw, Plus, UploadCloud, Trash2, Activity, Folder, FolderOpen, ArrowLeft, Edit2, Check, X, Zap, ArrowUp, ArrowDown, CalendarDays, CalendarPlus, CheckSquare, Sparkles, Search } from 'lucide-react';
import { getZoneColorForTrainer } from '../utils/performanceMetrics';
import { parseWorkoutFile } from '../utils/workoutParser';
import { calculateCogganMetrics, expandStepsToSeconds } from '../utils/performanceMetrics';
import { generateLocalWorkout } from '../utils/workoutGenerator';
import { stepsToIntervalsCode } from './ai/AIMarkdown';

export default function LibraryTab({ onSelectWorkout, onScheduleWorkout, ftp = 250, userId }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeFolder, setActiveFolder] = useState(null);
  const [editingWorkoutId, setEditingWorkoutId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedDetailWorkout, setSelectedDetailWorkout] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [scheduleSuccess, setScheduleSuccess] = useState(false);
  const [isSavingAi, setIsSavingAi] = useState(false);

  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [genType, setGenType] = useState('Endurance');
  const [genDuration, setGenDuration] = useState(60);
  const [genDifficulty, setGenDifficulty] = useState(3);

  const handleGenerate = () => {
    const newWorkout = generateLocalWorkout(genType, genDuration, genDifficulty);
    setSelectedDetailWorkout(newWorkout);
    setShowGeneratorModal(false);
  };

  const handleScheduleWorkout = async () => {
    if (!selectedDetailWorkout || !scheduleDate) return;
    const metrics = getCachedWorkoutMetrics(selectedDetailWorkout);
    const durSec = Number(selectedDetailWorkout.duration_seconds) ||
      (Array.isArray(selectedDetailWorkout.steps)
        ? selectedDetailWorkout.steps.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)
        : 3600);
    const durMin = Math.max(10, Math.round(durSec / 60));

    if (onScheduleWorkout) {
      const descriptionCode = Array.isArray(selectedDetailWorkout.steps)
        ? stepsToIntervalsCode(selectedDetailWorkout.steps)
        : (typeof selectedDetailWorkout.steps === 'string' ? selectedDetailWorkout.steps : '');

      await onScheduleWorkout({
        id: `local-${Date.now()}`,
        date: scheduleDate,
        title: selectedDetailWorkout.title || 'Trening iz knjižnice',
        duration: durMin,
        duration_seconds: durSec,
        tss: Math.round(Number(metrics.tss) || 0),
        description: descriptionCode,
        allSteps: Array.isArray(selectedDetailWorkout.steps) ? selectedDetailWorkout.steps : undefined,
        category: selectedDetailWorkout.category || 'WORKOUT',
        difficulty_score: selectedDetailWorkout.difficulty_score ?? null,
        type: 'ride'
      });
    } else {
      const records = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const newRecord = {
        ...selectedDetailWorkout,
        id: Date.now().toString(),
        date: scheduleDate,
        duration: durMin,
        duration_seconds: durSec,
        tss: Math.round(Number(metrics.tss) || 0),
        np: metrics.np,
        if_factor: metrics.if_factor,
        workout_source: 'library'
      };
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify([...records, newRecord]));
      window.dispatchEvent(new CustomEvent('local-workouts-updated'));
    }

    setScheduleSuccess(true);
    setTimeout(() => {
      setScheduleSuccess(false);
      setSelectedDetailWorkout(null);
    }, 1500);
  };

  const handleSaveAiToLibrary = async () => {
    if (!selectedDetailWorkout) return;
    try {
      setIsSavingAi(true);
      const workoutPayload = {
        title: selectedDetailWorkout.title,
        description: selectedDetailWorkout.description || '',
        duration_seconds: selectedDetailWorkout.duration_seconds,
        difficulty_score: selectedDetailWorkout.difficulty_score || 50,
        category: selectedDetailWorkout.category,
        steps: selectedDetailWorkout.steps
      };

      const { error } = await supabase.from('workouts').insert([workoutPayload]);
      if (error) throw error;
      
      await fetchWorkouts();
      setSelectedDetailWorkout(null);
    } catch (err) {
      console.error(err);
      alert("Greška pri spremanju u knjižnicu: " + err.message);
    } finally {
      setIsSavingAi(false);
    }
  };

  useEffect(() => {
    fetchWorkouts();
  }, []);

  const fetchWorkouts = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.from('workouts').select('*').order('difficulty_score', { ascending: true });
      if (error) throw error;
      setWorkouts(data || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError(null);

        const uploadedWorkouts = [];
    const errors = [];
    let duplicateCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        const parsedWorkout = await parseWorkoutFile(text, file.name);
        
        // Provjera duplikata po naslovu treninga u trenutnoj listi `workouts`
        const isDuplicate = workouts.some(
          existing => existing.title.toLowerCase() === parsedWorkout.title.toLowerCase()
        );

        if (isDuplicate) {
          duplicateCount++;
        } else {
          uploadedWorkouts.push(parsedWorkout);
        }
      } catch (err) {
        console.error(`Greška pri parsiranju fajla ${file.name}:`, err);
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (uploadedWorkouts.length > 0) {
      try {
        const { error: insertError } = await supabase.from('workouts').insert(uploadedWorkouts).select();
        if (insertError) throw insertError;
        // Osježi listu i vrati se na početak (zatvori mape)
        setActiveFolder(null);
        await fetchWorkouts();
      } catch (err) {
        console.error(err);
        setError("Greška pri spremanju u bazu: " + err.message);
      }
    }

    let errorMessage = '';
    if (errors.length > 0) {
      errorMessage += `Neuspješan uvoz nekih datoteka:\n${errors.join('\n')}\n`;
    }
    if (duplicateCount > 0) {
      errorMessage += `Preskočeno duplikata (već postoje u bazi): ${duplicateCount}`;
    }

    if (errorMessage) {
      setError(errorMessage.trim());
    }

    setIsUploading(false);
    // Reset inputa
    event.target.value = null;
  };

  const handleDeleteWorkout = async (workoutId) => {
    try {
      const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
      if (error) throw error;
      await fetchWorkouts();
    } catch (err) {
      console.error(err);
      setError("Greška pri brisanju: " + err.message);
    }
  };

  const handleUpdateWorkout = async () => {
    if (!editingWorkoutId || !editTitle.trim()) return;
    try {
      const { error } = await supabase.from('workouts').update({ title: editTitle.trim(), category: editCategory }).eq('id', editingWorkoutId);
      if (error) throw error;
      setEditingWorkoutId(null);
      await fetchWorkouts();
    } catch (err) {
      console.error(err);
      setError("Greška pri promjeni: " + err.message);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    return `${m} min`;
  };

  const getWorkoutMetrics = (workout) => {
    if (!workout || !workout.steps || workout.steps.length === 0) return { np: 0, avg: 0, tss: 0, if_factor: "0.00" };
    
    const powerArray = expandStepsToSeconds(workout.steps, ftp);
    const metrics = calculateCogganMetrics(powerArray, ftp);
    
    return {
      np: metrics.np,
      avg: metrics.avgPower,
      tss: metrics.tss,
      if_factor: metrics.ifFactor
    };
  };

  const metricsMap = useMemo(() => {
    const map = new Map();
    workouts.forEach(w => {
      map.set(w.id, getWorkoutMetrics(w));
    });
    return map;
  }, [workouts, ftp]);

  const getCachedWorkoutMetrics = (workout) => {
    if (!workout) return { np: 0, avg: 0, tss: 0, if_factor: "0.00" };
    return metricsMap.get(workout.id) || getWorkoutMetrics(workout);
  };

  const getCategoryMeta = (cat) => {
    switch (cat) {
      case 'Oporavak': return { zone: 'Z1 · REC', topBar: 'bg-zinc-400', text: 'text-zinc-300', border: 'hover:border-zinc-500/60', badge: 'bg-zinc-800/80 text-zinc-300 border-zinc-700' };
      case 'Endurance': return { zone: 'Z2 · END', topBar: 'bg-sky-400', text: 'text-sky-400', border: 'hover:border-sky-500/50', badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
      case 'Tempo': return { zone: 'Z3 · TMP', topBar: 'bg-emerald-400', text: 'text-emerald-400', border: 'hover:border-emerald-500/50', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
      case 'Sweet Spot': return { zone: 'SS · 88-94%', topBar: 'bg-volt-400', text: 'text-volt-400', border: 'hover:border-volt-400/50', badge: 'bg-volt-400/10 text-volt-300 border-volt-400/30' };
      case 'Threshold': return { zone: 'Z4 · FTP', topBar: 'bg-amber-400', text: 'text-amber-400', border: 'hover:border-amber-500/50', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
      case 'VO2 Max': return { zone: 'Z5 · VO2', topBar: 'bg-rose-500', text: 'text-rose-400', border: 'hover:border-rose-500/50', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30' };
      case 'Anaerobni': return { zone: 'Z6 · ANA', topBar: 'bg-purple-500', text: 'text-purple-400', border: 'hover:border-purple-500/50', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30' };
      case 'Testiranje': return { zone: 'RAMP / FTP', topBar: 'bg-cyan-400', text: 'text-cyan-400', border: 'hover:border-cyan-500/50', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' };
      default: return { zone: 'MIX', topBar: 'bg-zinc-500', text: 'text-zinc-300', border: 'hover:border-zinc-600', badge: 'bg-zinc-900 text-zinc-400 border-zinc-800' };
    }
  };

  const categoryOrder = ['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni', 'Testiranje', 'Ostalo'];

  const groupedWorkouts = workouts.reduce((acc, workout) => {
    const cat = workout.category || 'Ostalo';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(workout);
    return acc;
  }, {});

  const sortedCategories = Object.keys(groupedWorkouts).sort((a, b) => {
    let indexA = categoryOrder.indexOf(a);
    let indexB = categoryOrder.indexOf(b);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    return indexA - indexB;
  });

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 animate-in fade-in pb-20 md:pb-4">
      {/* ZAGLAVLJE S PRETRAGOM I AKCIJAMA */}
      <div className="carbon-panel rounded-xl p-4 md:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">STRUKTURIRANI RECEPTI · {workouts.length} UKUPNO</span>
          <h2 className="text-2xl font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2.5 mt-0.5">
            <Database className="text-volt-400 w-5 h-5" /> Knjižnica Treninga
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-64 lg:w-72 min-w-[180px]">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pretraži trening ili opis..."
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-volt-400 rounded-lg pl-9 pr-8 py-2 text-xs font-medium text-zinc-100 placeholder-zinc-600 outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                title="Očisti pretragu"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button 
            onClick={() => setShowGeneratorModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/50 text-zinc-100 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-volt-400" />
            <span className="hidden sm:inline">Generator</span>
          </button>

          <label className="flex items-center gap-1.5 px-3.5 py-2 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer transition-all shadow-volt-glow">
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isUploading ? 'Uvoz...' : 'Uvezi ZWO/ERG'}</span>
            <span className="sm:hidden">Uvezi</span>
            <input type="file" multiple className="absolute w-0 h-0 opacity-0 pointer-events-none" onChange={handleFileUpload} disabled={isUploading} />
          </label>

          <button 
            onClick={fetchWorkouts} 
            disabled={loading || isUploading}
            title="Osvježi knjižnicu"
            className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 hover:text-volt-400 hover:border-zinc-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-volt-400' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-300 p-4 rounded-xl flex items-center gap-3 text-xs font-mono font-bold whitespace-pre-line">
          Greška pri dohvaćanju baze: {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3 carbon-panel rounded-xl">
          <Loader2 className="w-8 h-8 text-volt-400 animate-spin" />
          <span className="text-zinc-500 font-mono font-bold tracking-[0.2em] uppercase text-[11px]">Sinkronizacija recepata...</span>
        </div>
      ) : (
        <div className="w-full">
          {!activeFolder && !searchQuery.trim() ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {sortedCategories.map(cat => {
                const meta = getCategoryMeta(cat);
                const catList = groupedWorkouts[cat] || [];
                return (
                  <button 
                    key={cat}
                    onClick={() => setActiveFolder(cat)}
                    className={`carbon-panel rounded-xl p-5 text-left flex flex-col justify-between min-h-[136px] relative overflow-hidden transition-all duration-150 group hover:-translate-y-0.5 ${meta.border}`}
                  >
                    <div className={`absolute top-0 left-0 right-0 h-[3px] ${meta.topBar}`} />
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${meta.badge}`}>
                        {meta.zone}
                      </span>
                      <Folder className={`w-5 h-5 ${meta.text} opacity-75 group-hover:opacity-100 transition-opacity`} />
                    </div>
                    <div className="mt-5">
                      <h3 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100 group-hover:text-white transition-colors">
                        {cat}
                      </h3>
                      <p className="text-[11px] font-mono telemetry-num text-zinc-500 uppercase tracking-widest mt-0.5">
                        {catList.length} {catList.length === 1 ? 'trening' : 'treninga'}
                      </p>
                    </div>
                  </button>
                );
              })}
              {workouts.length === 0 && !loading && !error && (
                <div className="col-span-full py-16 text-center flex flex-col items-center carbon-panel rounded-xl">
                  <Database className="w-12 h-12 text-zinc-700 mb-3" />
                  <h3 className="text-lg font-display font-bold uppercase text-zinc-300 mb-1">Knjižnica je prazna</h3>
                  <p className="text-zinc-500 font-mono text-xs">Uvezi .ZWO ili .ERG datoteke putem gumba u zaglavlju.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              <div className="carbon-panel rounded-xl p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                    {activeFolder ? <FolderOpen className="w-5 h-5 text-volt-400" /> : <Search className="w-5 h-5 text-volt-400" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold uppercase tracking-wide text-zinc-100">
                      {activeFolder ? activeFolder : `Pretraga: "${searchQuery}"`}
                    </h3>
                    <p className="text-[10px] font-mono telemetry-num font-bold text-zinc-500 uppercase tracking-widest">
                      {(() => {
                        const baseList = activeFolder ? (groupedWorkouts[activeFolder] || []) : workouts;
                        const count = searchQuery.trim()
                          ? baseList.filter(w => {
                              const q = searchQuery.toLowerCase();
                              return (w.title && w.title.toLowerCase().includes(q)) || (w.description && w.description.toLowerCase().includes(q));
                            }).length
                          : baseList.length;
                        return `${count} treninga ${activeFolder ? 'u kategoriji' : 'pronađeno'}`;
                      })()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
                  <div className="flex gap-1.5">
                    <select 
                      value={sortBy} 
                      onChange={(e) => setSortBy(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-1.5 text-xs font-mono font-bold outline-none focus:border-volt-400"
                    >
                      <option value="name">Naziv</option>
                      <option value="difficulty">Težina (LVL)</option>
                      <option value="duration">Trajanje</option>
                      <option value="tss">TSS Load</option>
                      <option value="np">NP (W)</option>
                    </select>

                    <button 
                      onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} 
                      className="p-1.5 px-2.5 flex items-center justify-center bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 hover:text-volt-400 hover:border-zinc-700 transition"
                      title="Promijeni smjer sortiranja"
                    >
                      {sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {activeFolder ? (
                    <button onClick={() => setActiveFolder(null)} className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-volt-400 hover:border-volt-400/40 transition-all font-mono font-bold text-xs uppercase tracking-wider">
                      <ArrowLeft className="w-3.5 h-3.5" /> Kategorije
                    </button>
                  ) : (
                    <button onClick={() => setSearchQuery('')} className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-volt-400 transition-all font-mono font-bold text-xs uppercase tracking-wider">
                      <X className="w-3.5 h-3.5" /> Sve kategorije
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(() => {
                  let items = activeFolder ? [...(groupedWorkouts[activeFolder] || [])] : [...workouts];
                  if (searchQuery.trim()) {
                    const q = searchQuery.toLowerCase();
                    items = items.filter(w => 
                      (w.title && w.title.toLowerCase().includes(q)) || 
                      (w.description && w.description.toLowerCase().includes(q))
                    );
                  }
                  if (items.length === 0) {
                    return (
                      <div className="col-span-full py-16 text-center text-zinc-500 font-mono text-xs carbon-panel rounded-xl">
                        Nema pronađenih treninga za pojam &quot;{searchQuery}&quot;.
                      </div>
                    );
                  }
                  items.sort((a, b) => {
                    if (sortBy === 'name') {
                      return sortOrder === 'asc' 
                        ? a.title.localeCompare(b.title) 
                        : b.title.localeCompare(a.title);
                    }
                    
                    let valA = 0; let valB = 0;
                    if (sortBy === 'difficulty') {
                      valA = a.difficulty_score; valB = b.difficulty_score;
                    } else if (sortBy === 'duration') {
                      valA = a.duration_seconds; valB = b.duration_seconds;
                    } else {
                      const metricsA = getCachedWorkoutMetrics(a);
                      const metricsB = getCachedWorkoutMetrics(b);
                      if (sortBy === 'tss') { valA = metricsA.tss; valB = metricsB.tss; }
                      if (sortBy === 'np') { valA = metricsA.np; valB = metricsB.np; }
                    }
                    return sortOrder === 'asc' ? valA - valB : valB - valA;
                  });

                  return items.map((workout) => {
                    const catMeta = getCategoryMeta(workout.category);
                    const metrics = getCachedWorkoutMetrics(workout);
                    return (
                      <div
                        key={workout.id}
                        onClick={() => setSelectedDetailWorkout(workout)}
                        className="carbon-panel rounded-xl p-4 hover:border-volt-400/50 transition-all group/card flex flex-col h-full relative overflow-hidden cursor-pointer"
                      >
                        <div className={`absolute top-0 left-0 right-0 h-[2px] ${catMeta.topBar}`} />
                        <div className="flex justify-between items-start gap-2 mb-2 relative z-10 w-full">
                          {editingWorkoutId === workout.id ? (
                            <div className="flex flex-col gap-2 w-full p-2 rounded-lg bg-zinc-950 border border-volt-400/40">
                              <input 
                                type="text" 
                                value={editTitle} 
                                onChange={e => setEditTitle(e.target.value)}
                                onKeyDown={e => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') handleUpdateWorkout();
                                }}
                                onClick={e => e.stopPropagation()}
                                className="bg-zinc-900 border border-zinc-800 text-white rounded text-sm font-bold w-full outline-none px-2 py-1 focus:border-volt-400"
                                autoFocus 
                              />
                              <div className="flex gap-1.5">
                                <select
                                  value={editCategory}
                                  onChange={e => setEditCategory(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="bg-zinc-900 border border-zinc-800 text-white rounded text-xs font-bold flex-1 outline-none px-2 py-1 focus:border-volt-400"
                                >
                                  {categoryOrder.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <button onClick={(e) => { e.stopPropagation(); handleUpdateWorkout(); }} className="text-volt-400 hover:text-volt-300 shrink-0 p-1.5 bg-zinc-900 border border-zinc-800 rounded">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setEditingWorkoutId(null); }} className="text-rose-400 hover:text-rose-300 shrink-0 p-1.5 bg-zinc-900 border border-zinc-800 rounded">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1">
                                {!activeFolder && workout.category && (
                                  <span className={`inline-block text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border mb-1 ${catMeta.badge}`}>
                                    {workout.category}
                                  </span>
                                )}
                                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 group-hover/card:text-volt-400 transition-colors leading-snug line-clamp-2">
                                  {workout.title}
                                </h3>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setEditTitle(workout.title); 
                                    setEditCategory(workout.category || 'Ostalo');
                                    setEditingWorkoutId(workout.id); 
                                  }}
                                  className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-sky-400 hover:border-sky-500/40 md:opacity-0 md:group-hover/card:opacity-100 transition-all"
                                  title="Uredi trening"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleDeleteWorkout(workout.id); }}
                                  className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-rose-400 hover:border-rose-500/40 md:opacity-0 md:group-hover/card:opacity-100 transition-all"
                                  title="Obriši"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                                <div className="flex items-center justify-center px-2 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-mono telemetry-num font-bold text-volt-400 shrink-0" title="Faktor težine">
                                  {typeof workout.difficulty_score === 'number' ? Number(workout.difficulty_score).toFixed(1).replace(/\.0$/, '') : workout.difficulty_score}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        
                        {workout.description && (
                          <p className="text-zinc-500 text-xs mb-3 leading-relaxed flex-1 line-clamp-2">
                            {workout.description}
                          </p>
                        )}

                        {/* MALI PREVIEW GRAF */}
                        <div className="h-14 w-full flex items-end mb-3.5 rounded-lg overflow-hidden bg-zinc-950 bg-telemetry-grid border border-zinc-800/90 px-0.5 pt-1 relative mt-auto">
                          <div className="absolute left-0 right-0 bottom-[66.6%] border-t border-dashed border-volt-400/25 pointer-events-none z-10" />
                          {workout.steps && workout.steps.length > 0 ? (
                            workout.steps.map((wStep, i) => {
                              const widthP = (wStep.duration / workout.duration_seconds) * 100;
                              const heightP = Math.min(Math.max((wStep.power / 150) * 100, 14), 100);
                              const watts = Math.round((wStep.power / 100) * ftp);
                              const mins = Math.round(wStep.duration / 60 * 10) / 10;
                              const zBg = getZoneColorForTrainer(wStep.power);
                              return (
                                <div 
                                  key={i} 
                                  title={`${wStep.name || 'Segment'}: ${wStep.duration >= 60 ? mins + ' min' : wStep.duration + ' sec'} @ ${watts}W (${wStep.power}%)`}
                                  style={{ width: `${widthP}%`, height: `${heightP}%` }} 
                                  className="relative overflow-hidden min-w-[2px] border-r border-zinc-950/60"
                                >
                                  <div className={`absolute inset-0 ${zBg} opacity-65 group-hover/card:opacity-80 transition-opacity`} />
                                  <div className={`absolute top-0 left-0 right-0 h-[2px] ${zBg} brightness-125`} />
                                </div>
                              );
                            })
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] font-mono uppercase font-bold">Nema Podataka</div>
                          )}
                        </div>

                        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 gap-2 w-full font-mono telemetry-num">
                          <div className="flex gap-1.5 items-center flex-wrap flex-1 min-w-0 text-[10px]">
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-200 font-bold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-zinc-500" /> {formatTime(workout.duration_seconds)}
                            </span>
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-300 font-bold" title={`Prosječna snaga: ${metrics.avg}W`}>
                              NP {metrics.np}W · IF {metrics.if_factor}
                            </span>
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-volt-400 font-bold">
                              TSS {metrics.tss}
                            </span>
                          </div>
                          
                          <button 
                            onClick={(e) => { e.stopPropagation(); onSelectWorkout(workout); }}
                            className="flex outline-none shrink-0 items-center justify-center gap-1 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono font-bold px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all shadow-volt-glow"
                          >
                            <Play className="w-3 h-3" fill="currentColor" /> VOZI
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL DETALJA TRENINGA I ZAKAZIVANJE */}
      {selectedDetailWorkout && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setSelectedDetailWorkout(null)}>
          <div className="carbon-panel rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 md:p-6 border-b border-zinc-800 bg-zinc-950 shrink-0">
              <div>
                <p className="text-[10px] font-mono font-bold text-volt-400 uppercase tracking-[0.2em]">
                  {selectedDetailWorkout.category} · LVL {selectedDetailWorkout.difficulty_score}
                </p>
                <h2 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wide text-zinc-100 pr-4 mt-0.5">
                  {selectedDetailWorkout.title}
                </h2>
              </div>
              <button onClick={() => setSelectedDetailWorkout(null)} className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors shrink-0">
                <X className="w-5 h-5"/>
              </button>
            </div>
            
            <div className="p-5 md:p-6 overflow-y-auto max-h-[75vh] custom-scrollbar">
              {selectedDetailWorkout.description && (
                <p className="text-sm text-zinc-300 mb-5 leading-relaxed border-l-2 border-volt-400 pl-4">
                  {selectedDetailWorkout.description}
                </p>
              )}
              
              {/* GRAFIKA U DETALJIMA */}
              {(() => {
                const maxPwr = Math.max(...(selectedDetailWorkout.steps?.map(s => s.power) || [100]));
                const scaleMax = Math.max(120, maxPwr + 10);
                const ftpLinePercent = (100 / scaleMax) * 100;
                
                return (
                  <div className="h-40 w-full flex items-end mb-6 rounded-xl overflow-hidden bg-zinc-950 bg-telemetry-grid border border-zinc-800 relative px-0.5 pt-2">
                    <div className="absolute left-0 right-0 h-0 border-t border-dashed border-volt-400/45 z-20 pointer-events-none" style={{ bottom: `${ftpLinePercent}%` }}>
                      <span className="absolute right-2 bottom-1 text-[10px] font-mono font-bold text-volt-400 bg-zinc-950/90 px-1.5 py-0.5 rounded">FTP {ftp}W</span>
                    </div>
                    {selectedDetailWorkout.steps?.map((wStep, i) => {
                      const widthP = (wStep.duration / selectedDetailWorkout.duration_seconds) * 100;
                      const heightP = Math.min(Math.max((wStep.power / scaleMax) * 100, 5), 100);
                      const watts = Math.round((wStep.power / 100) * ftp);
                      const mins = Math.round(wStep.duration / 60 * 10) / 10;
                      const zBg = getZoneColorForTrainer(wStep.power);
                      return (
                        <div
                          key={i}
                          title={`${wStep.name || 'Segment'}: ${wStep.duration >= 60 ? mins + ' min' : wStep.duration + ' sec'} @ ${watts}W (${wStep.power}%)`}
                          style={{ width: `${widthP}%`, height: `${heightP}%` }}
                          className="relative overflow-hidden cursor-crosshair min-w-[2px] border-r border-zinc-950/70"
                        >
                          <div className={`absolute inset-0 ${zBg} opacity-75 hover:opacity-95 transition-opacity`} />
                          <div className={`absolute top-0 left-0 right-0 h-[2px] ${zBg} brightness-125`} />
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* METRIKE */}
              {(() => {
                const m = getCachedWorkoutMetrics(selectedDetailWorkout);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">Trajanje</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-zinc-100">{Math.round(selectedDetailWorkout.duration_seconds / 60)} <span className="text-xs font-mono text-zinc-500">min</span></p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">TSS Load</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-volt-400">{m.tss}</p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">Normalized Pwr</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-zinc-100">{m.np} <span className="text-xs font-mono text-zinc-500">W</span></p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">Intensity (IF)</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-sky-400">{m.if_factor}</p>
                    </div>
                  </div>
                );
              })()}

              {/* ZAKAZIVANJE I POKRETANJE */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 relative overflow-hidden">
                <h3 className="flex items-center gap-2 text-xs font-mono font-bold text-volt-400 uppercase tracking-[0.18em] mb-4">
                  <CalendarPlus className="w-4 h-4" /> Planiraj u Kalendar ili Pokreni Odmah
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    type="date" 
                    value={scheduleDate} 
                    onChange={(e) => setScheduleDate(e.target.value)} 
                    onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                    className="sm:w-48 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2.5 font-mono text-xs font-bold outline-none focus:border-volt-400 cursor-pointer"
                  />
                  <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
                    <button 
                      onClick={handleScheduleWorkout}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all border ${
                        scheduleSuccess
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border-zinc-700 hover:border-volt-400/50'
                      }`}
                    >
                      {scheduleSuccess ? <CheckSquare className="w-4 h-4"/> : <CalendarDays className="w-4 h-4 text-volt-400" />}
                      {scheduleSuccess ? 'Dodano u Kalendar!' : 'Spremi u Kalendar'}
                    </button>

                    <button
                      onClick={() => {
                        const target = selectedDetailWorkout;
                        setSelectedDetailWorkout(null);
                        onSelectWorkout(target);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow transition-all"
                    >
                      <Play className="w-4 h-4" fill="currentColor" /> Vozi u Trenažeru
                    </button>
                  </div>
                </div>

                {selectedDetailWorkout.isLocalGenerated && (
                  <button 
                    onClick={handleSaveAiToLibrary}
                    disabled={isSavingAi}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-volt-400 hover:border-volt-400/40 disabled:opacity-50"
                  >
                    {isSavingAi ? <Loader2 className="w-4 h-4 animate-spin"/> : <Database className="w-4 h-4" />}
                    {isSavingAi ? 'Spremanje...' : 'Spremi trajno u bazu knjižnice'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showGeneratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setShowGeneratorModal(false)}>
          <div className="carbon-panel rounded-2xl p-6 md:p-7 max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">ALGORITAMSKI GENERATOR</span>
            <h3 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100 mb-5 flex items-center gap-2.5 mt-0.5">
              <Sparkles className="text-volt-400 w-5 h-5" /> Brzi Generator Treninga
            </h3>
            
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2">Zona / Tip Treninga</label>
                <select value={genType} onChange={e => setGenType(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-100 outline-none focus:border-volt-400 font-bold">
                  {['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2">Trajanje (min)</label>
                <div className="grid grid-cols-5 gap-1.5 font-mono telemetry-num">
                  {[30, 45, 60, 90, 120].map(d => (
                    <button key={d} onClick={() => setGenDuration(d)} className={`py-2 rounded-lg text-xs font-bold transition-all border ${genDuration === d ? 'bg-volt-400 text-zinc-950 border-volt-400 shadow-volt-glow' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2 flex justify-between">
                  <span>Faktor Težine</span>
                  <span className={genDifficulty > 3 ? 'text-rose-400' : genDifficulty < 3 ? 'text-sky-400' : 'text-volt-400'}>
                    {genDifficulty === 1 ? 'Vrlo lagano' : genDifficulty === 2 ? 'Lagano' : genDifficulty === 3 ? 'Srednje' : genDifficulty === 4 ? 'Teško' : 'Ekstremno'}
                  </span>
                </label>
                <input 
                  type="range" 
                  min="1" max="5" 
                  value={genDifficulty} 
                  onChange={e => setGenDifficulty(parseInt(e.target.value))}
                  className="w-full accent-lime-400 h-2 bg-zinc-950 rounded-lg appearance-none cursor-pointer border border-zinc-800" 
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-600 font-bold px-1 mt-1">
                  <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                </div>
              </div>
            </div>

            <div className="mt-7 flex gap-2.5">
              <button onClick={() => setShowGeneratorModal(false)} className="flex-1 py-2.5 bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 text-zinc-300 font-mono text-xs uppercase tracking-wider font-bold rounded-lg transition-colors">Odustani</button>
              <button onClick={handleGenerate} className="flex-1 py-2.5 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono text-xs uppercase tracking-wider font-bold rounded-lg transition-all shadow-volt-glow">Generiraj</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

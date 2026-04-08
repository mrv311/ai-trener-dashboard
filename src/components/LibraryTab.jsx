import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Play, Loader2, Database, Clock, RefreshCw, Plus, UploadCloud, Trash2, Activity, Folder, FolderOpen, ArrowLeft, Edit2, Check, X, Zap, ArrowUp, ArrowDown, CalendarDays, CalendarPlus, CheckSquare } from 'lucide-react';
import { getZoneColorForTrainer } from '../utils/workoutUtils';
import { parseWorkoutFile } from '../utils/workoutParser';

export default function LibraryTab({ onSelectWorkout, ftp = 250 }) {
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

  const [selectedDetailWorkout, setSelectedDetailWorkout] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleSuccess, setScheduleSuccess] = useState(false);

  const handleScheduleWorkout = () => {
    if (!selectedDetailWorkout || !scheduleDate) return;
    const records = JSON.parse(localStorage.getItem('ai_trener_scheduled_workouts') || '[]');
    const newRecord = {
      ...selectedDetailWorkout,
      id: Date.now().toString(),
      date: scheduleDate
    };
    localStorage.setItem('ai_trener_scheduled_workouts', JSON.stringify([...records, newRecord]));
    setScheduleSuccess(true);
    setTimeout(() => {
      setScheduleSuccess(false);
      setSelectedDetailWorkout(null);
    }, 1500);
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

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        const parsedWorkout = await parseWorkoutFile(text, file.name);
        uploadedWorkouts.push(parsedWorkout);
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

    if (errors.length > 0) {
      setError(`Neuspješan uvoz nekih datoteka:\n${errors.join('\n')}`);
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
    if (!workout.steps || workout.steps.length === 0) return { np: 0, avg: 0, tss: 0 };
    let totalDuration = 0, totalWork = 0, totalTSS = 0;
    
    workout.steps.forEach(s => {
      let intensity = s.power / 100;
      let stepTss = (s.duration / 3600) * (intensity * intensity) * 100;
      totalTSS += stepTss;
      totalDuration += s.duration;
      totalWork += ((s.power / 100) * ftp) * s.duration;
    });
    
    let avgPower = totalWork / totalDuration;
    let IF = Math.sqrt(totalTSS / ((totalDuration/3600) * 100)) || 0;
    let np = IF * ftp;
    
    return {
      np: Math.round(np),
      avg: Math.round(avgPower),
      tss: Math.round(totalTSS),
      if_factor: IF.toFixed(2)
    };
  };

  const getFolderStyles = (cat) => {
    switch (cat) {
      case 'Oporavak': return 'border-gray-500/50 text-gray-400 hover:bg-gray-500/10 shadow-[0_0_15px_rgba(107,114,128,0.1)]';
      case 'Endurance': return 'border-blue-500/50 text-blue-400 hover:bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]';
      case 'Tempo': return 'border-green-500/50 text-green-400 hover:bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]';
      case 'Sweet Spot': return 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]';
      case 'Threshold': return 'border-orange-500/50 text-orange-400 hover:bg-orange-500/10 shadow-[0_0_15px_rgba(249,115,22,0.1)]';
      case 'VO2 Max': return 'border-red-500/50 text-red-400 hover:bg-red-500/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]';
      case 'Anaerobni': return 'border-purple-500/50 text-purple-400 hover:bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.1)]';
      case 'Testiranje': return 'border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 shadow-[0_0_15px_rgba(6,182,212,0.1)]';
      default: return 'border-zinc-500/50 text-zinc-400 hover:bg-zinc-500/10 shadow-[0_0_15px_rgba(113,113,122,0.1)]';
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
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-black text-zinc-100 flex items-center gap-3">
            <Database className="text-orange-500 w-6 h-6" /> Knjižnica Treninga
          </h2>
          <p className="text-zinc-500 text-sm mt-1">Strukturirani treninzi iz baze spremni za vožnju.</p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-400 text-white font-bold rounded-xl cursor-pointer transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)]">
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span className="hidden sm:inline">{isUploading ? 'Učitavanje...' : 'Dodaj ZWO/ERG'}</span>
            <span className="sm:hidden">Dodaj</span>
            <input type="file" multiple className="absolute w-0 h-0 opacity-0 pointer-events-none" onChange={handleFileUpload} disabled={isUploading} />
          </label>
          <button 
            onClick={fetchWorkouts} 
            disabled={loading || isUploading}
            className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-orange-500' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center gap-3 font-bold">
          Greška pri dohvaćanju baze: {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
          <span className="text-zinc-500 font-bold tracking-widest uppercase text-xs">Učitavanje iz baze...</span>
        </div>
      ) : (
        <div className="w-full">
          {!activeFolder ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
              {sortedCategories.map(cat => (
                <button 
                  key={cat}
                  onClick={() => setActiveFolder(cat)}
                  className={`flex flex-col items-center justify-center p-6 rounded-[2rem] border bg-zinc-900/60 transition-all ${getFolderStyles(cat)} group hover:-translate-y-2`}
                >
                  <div className="mb-4 p-5 rounded-3xl bg-zinc-950/50 backdrop-blur-sm shadow-inner group-hover:scale-110 transition-transform">
                    <Folder className="w-12 h-12" fill="currentColor" fillOpacity={0.2} />
                  </div>
                  <h3 className="text-xl font-black tracking-tight">{cat}</h3>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-widest mt-1">{groupedWorkouts[cat].length} treninga</p>
                </button>
              ))}
              {workouts.length === 0 && !loading && !error && (
                <div className="col-span-full py-20 text-center flex flex-col items-center">
                  <Database className="w-16 h-16 text-zinc-800 mb-4" />
                  <h3 className="text-xl font-bold text-zinc-500 mb-2">Knjižnica je prazna</h3>
                  <p className="text-zinc-600 text-sm">Učini prvi korak i učitaj neki trening na gumb dodaj.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4 bg-zinc-900/40 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-zinc-950/50 shadow-inner">
                    <FolderOpen className="w-6 h-6 text-zinc-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black tracking-tight text-white">{activeFolder}</h3>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{groupedWorkouts[activeFolder].length} treninga u mapi</p>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-3 w-full sm:w-auto">
                  <div className="flex gap-2">
                    <select 
                      value={sortBy} 
                      onChange={(e) => setSortBy(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:border-orange-500 font-bold"
                    >
                      <option value="name">Ime</option>
                      <option value="difficulty">Faktor Težine</option>
                      <option value="duration">Trajanje</option>
                      <option value="tss">TSS</option>
                      <option value="np">NP (Snaga)</option>
                    </select>

                    <button 
                      onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} 
                      className="p-2 flex items-center justify-center bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700 transition shadow-sm"
                      title="Promijeni smjer sortiranja"
                    >
                      {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                    </button>
                  </div>
                  <button onClick={() => setActiveFolder(null)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-all font-bold text-sm shadow-sm">
                    <ArrowLeft className="w-4 h-4" /> Nazad na mape
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {(() => {
                  const items = [...(groupedWorkouts[activeFolder] || [])];
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
                      const metricsA = getWorkoutMetrics(a);
                      const metricsB = getWorkoutMetrics(b);
                      if (sortBy === 'tss') { valA = metricsA.tss; valB = metricsB.tss; }
                      if (sortBy === 'np') { valA = metricsA.np; valB = metricsB.np; }
                    }
                    return sortOrder === 'asc' ? valA - valB : valB - valA;
                  });

                  return items.map((workout) => (
                  <div key={workout.id} onClick={() => setSelectedDetailWorkout(workout)} className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800 rounded-2xl p-5 hover:border-orange-500/50 hover:shadow-[0_0_20px_rgba(249,115,22,0.1)] transition-all group/card flex flex-col h-full relative overflow-hidden cursor-pointer">
                    <div className="flex justify-between items-start mb-3 relative z-10 w-full">
                      {editingWorkoutId === workout.id ? (
                        <div className="flex flex-col gap-2 w-full pr-20 p-2 rounded-xl bg-zinc-950 border border-orange-500/50 shadow-inner">
                          <input 
                            type="text" 
                            value={editTitle} 
                            onChange={e => setEditTitle(e.target.value)}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === 'Enter') handleUpdateWorkout();
                            }}
                            onClick={e => e.stopPropagation()}
                            className="bg-zinc-900 border border-zinc-800 text-white rounded text-sm font-bold w-full outline-none px-2 py-1 focus:border-orange-500"
                            autoFocus 
                          />
                          <div className="flex gap-2">
                             <select
                               value={editCategory}
                               onChange={e => setEditCategory(e.target.value)}
                               onClick={e => e.stopPropagation()}
                               className="bg-zinc-900 border border-zinc-800 text-white rounded text-xs font-bold flex-1 outline-none px-2 py-1 focus:border-orange-500"
                             >
                               {categoryOrder.map(c => <option key={c} value={c}>{c}</option>)}
                             </select>
                             <button onClick={(e) => { e.stopPropagation(); handleUpdateWorkout(); }} className="text-green-500 hover:text-green-400 shrink-0 p-1 bg-zinc-800 rounded-md">
                               <Check className="w-4 h-4" />
                             </button>
                             <button onClick={(e) => { e.stopPropagation(); setEditingWorkoutId(null); }} className="text-red-500 hover:text-red-400 shrink-0 p-1 bg-zinc-800 rounded-md">
                               <X className="w-4 h-4" />
                             </button>
                          </div>
                        </div>
                      ) : (
                        <h3 className="text-lg font-black text-zinc-100 group-hover/card:text-orange-500 transition-colors pr-24 leading-tight">
                          {workout.title}
                        </h3>
                      )}
                      
                      <div className="absolute right-0 top-0 flex gap-1.5">
                        {editingWorkoutId !== workout.id && (
                          <button 
                            onClick={(e) => { 
                               e.stopPropagation(); 
                               setEditTitle(workout.title); 
                               setEditCategory(workout.category || 'Ostalo');
                               setEditingWorkoutId(workout.id); 
                            }}
                            className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-blue-500 hover:border-blue-500/50 shadow-sm shadow-black shrink-0 transition-colors"
                            title="Uredi trening"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteWorkout(workout.id); }}
                          className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-red-500 hover:border-red-500/50 shadow-sm shadow-black shrink-0 transition-colors"
                          title="Obriši"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 text-xs font-black text-zinc-400 shadow-sm shadow-black shrink-0">
                          {workout.difficulty_score}
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-zinc-500 text-sm mb-5 leading-relaxed flex-1 relative z-10">
                      {workout.description}
                    </p>

                    {/* MALI PREVIEW GRAF */}
                    <div className="h-16 w-full flex items-end mb-5 rounded-lg overflow-hidden bg-zinc-950/80 border border-zinc-800/60 p-0.5 relative z-10 group/graph">
                      {workout.steps && workout.steps.length > 0 ? (
                        workout.steps.map((wStep, i) => {
                          const widthP = (wStep.duration / workout.duration_seconds) * 100;
                          const heightP = Math.min(Math.max((wStep.power / 150) * 100, 15), 100);
                          const watts = Math.round((wStep.power / 100) * ftp);
                          const mins = Math.round(wStep.duration / 60 * 10) / 10;
                          return (
                            <div 
                              key={i} 
                              title={`${wStep.name || 'Segment'}: ${mins} min @ ${watts}W (${wStep.power}%)`}
                              style={{ width: `${widthP}%`, height: `${heightP}%` }} 
                              className={`${getZoneColorForTrainer(wStep.power)} opacity-80 border-r border-zinc-950 hover:opacity-100 hover:brightness-125 cursor-crosshair transition-all`}
                            />
                          )
                        })
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] uppercase font-bold">Nema Podataka</div>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4 mt-auto relative z-10 gap-2 w-full">
                      <div className="flex gap-1 items-center flex-wrap flex-1 min-w-0">
                        <div className="flex bg-zinc-950 px-1 py-1 rounded border border-zinc-800 items-center justify-center gap-1 shadow-inner shrink-0 cursor-default">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span className="text-zinc-300 font-extrabold text-[9px] tracking-wider whitespace-nowrap">{formatTime(workout.duration_seconds)}</span>
                        </div>
                        {(() => {
                          const metrics = getWorkoutMetrics(workout);
                          return (
                            <>
                              <div className="flex bg-zinc-950 px-1 py-1 rounded border border-zinc-800 items-center justify-center gap-1 shadow-inner shrink-0 cursor-default" title={`Prosječna snaga: ${metrics.avg}W`}>
                                 <Activity className="w-3 h-3 text-zinc-500" />
                                 <span className="text-zinc-300 font-extrabold text-[9px] tracking-wider whitespace-nowrap">NP {metrics.np} | IF {metrics.if_factor}</span>
                              </div>
                              <div className="flex bg-zinc-950 px-1 py-1 rounded border border-zinc-800 items-center justify-center gap-1 shadow-inner shrink-0 cursor-default" title="Training Stress Score">
                                 <Zap className="w-3 h-3 text-zinc-500" />
                                 <span className="text-zinc-300 font-extrabold text-[9px] tracking-wider whitespace-nowrap">TSS {metrics.tss}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      
                      <button 
                        onClick={(e) => { e.stopPropagation(); onSelectWorkout(workout); }}
                        className="flex outline-none shrink-0 items-center justify-center gap-1 bg-orange-500 hover:bg-orange-400 text-white font-extrabold px-2.5 py-1.5 rounded-md text-[10px] uppercase tracking-wider transition-all shadow-[0_0_8px_rgba(249,115,22,0.3)] group-hover/card:shadow-[0_0_12px_rgba(249,115,22,0.5)]"
                      >
                        <Play className="w-3 h-3" fill="currentColor" /> KRENI
                      </button>
                    </div>
                    
                    {/* Ukrasni sjaj iza */}
                    <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-orange-500/10 blur-[50px] rounded-full pointer-events-none group-hover/card:bg-orange-500/20 transition-colors"></div>
                  </div>
                ))})()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL DETALJA TRENINGA I ZAKAZIVANJE */}
      {selectedDetailWorkout && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in" onClick={() => setSelectedDetailWorkout(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-6 border-b border-zinc-800/80 bg-zinc-950/50 rounded-t-3xl shrink-0">
               <div>
                  <h2 className="text-2xl font-black text-zinc-100 pr-4">{selectedDetailWorkout.title}</h2>
                  <p className="text-xs font-bold text-orange-500 uppercase tracking-widest mt-1.5">{selectedDetailWorkout.category} • FAKTOR TEŽINE {selectedDetailWorkout.difficulty_score}</p>
               </div>
               <button onClick={() => setSelectedDetailWorkout(null)} className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-full transition-colors shrink-0"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[70vh]">
               {selectedDetailWorkout.description && (
                  <p className="text-sm text-zinc-400 mb-6 italic leading-relaxed border-l-2 border-orange-500/50 pl-4">{selectedDetailWorkout.description}</p>
               )}
               
               {/* GRAFIKA U DETALJIMA */}
               {(() => {
                 const maxPwr = Math.max(...(selectedDetailWorkout.steps?.map(s => s.power) || [100]));
                 const scaleMax = Math.max(120, maxPwr + 10);
                 const ftpLinePercent = (100 / scaleMax) * 100;
                 
                 return (
                   <div className="h-40 w-full flex items-end mb-8 rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-inner relative">
                     <div className="absolute left-0 right-0 h-0 border-t border-dashed border-white/60 z-20 pointer-events-none" style={{ bottom: `${ftpLinePercent}%` }}>
                        <span className="absolute left-1 bottom-1 text-[10px] font-black text-white/90 leading-none drop-shadow-md">FTP {ftp}W</span>
                     </div>
                     {selectedDetailWorkout.steps?.map((wStep, i) => {
                        const widthP = (wStep.duration / selectedDetailWorkout.duration_seconds) * 100;
                        const heightP = Math.min(Math.max((wStep.power / scaleMax) * 100, 5), 100);
                        return <div key={i} title={`${Math.round(wStep.power)}%`} style={{ width: `${widthP}%`, height: `${heightP}%` }} className={`${getZoneColorForTrainer(wStep.power)} border-r border-zinc-950/50 opacity-90 transition-opacity`} />
                     })}
                   </div>
                 );
               })()}

               {/* METRIKE */}
               {(() => {
                 const m = getWorkoutMetrics(selectedDetailWorkout);
                 return (
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                      <div className="bg-zinc-950/50 p-4 border border-zinc-800/80 rounded-xl relative overflow-hidden">
                         <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1.5">Trajanje</p>
                         <p className="text-2xl font-black text-zinc-100">{Math.round(selectedDetailWorkout.duration_seconds / 60)} <span className="text-sm text-zinc-500 font-bold">min</span></p>
                      </div>
                      <div className="bg-zinc-950/50 p-4 border border-zinc-800/80 rounded-xl">
                         <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1.5">TSS</p>
                         <p className="text-2xl font-black text-zinc-100">{m.tss}</p>
                      </div>
                      <div className="bg-zinc-950/50 p-4 border border-zinc-800/80 rounded-xl">
                         <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1.5">NP</p>
                         <p className="text-2xl font-black text-zinc-100">{m.np} <span className="text-sm text-zinc-500 font-bold">W</span></p>
                      </div>
                      <div className="bg-zinc-950/50 p-4 border border-zinc-800/80 rounded-xl">
                         <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1.5">IF</p>
                         <p className="text-2xl font-black text-zinc-100">{m.if_factor}</p>
                      </div>
                   </div>
                 );
               })()}

               {/* ZAKAZIVANJE */}
               <div className="bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-zinc-900 to-zinc-900 border border-orange-500/20 rounded-2xl p-6 shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5"><CalendarDays className="w-32 h-32 text-orange-500" /></div>
                  <h3 className="flex items-center gap-2 text-md font-black text-orange-400 uppercase tracking-widest mb-6 relative z-10">
                    <CalendarPlus className="w-6 h-6" /> Zakaži za trening u Kalendaru
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-4 relative z-10">
                    <input 
                       type="date" 
                       value={scheduleDate} 
                       onChange={(e) => setScheduleDate(e.target.value)} 
                       onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                       className="sm:w-1/2 bg-zinc-950 border border-zinc-700 text-white rounded-xl px-5 py-3.5 font-bold outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 shadow-inner cursor-pointer"
                    />
                    <button 
                       onClick={handleScheduleWorkout}
                       className={`sm:w-1/2 flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl text-sm font-black transition-all ${
                         scheduleSuccess ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-[0_4px_15px_rgba(249,115,22,0.3)] border border-orange-500/50'
                       }`}
                    >
                       {scheduleSuccess ? <CheckSquare className="w-5 h-5"/> : <CalendarDays className="w-5 h-5" />}
                       {scheduleSuccess ? 'TRENING DODAN!' : 'SPREMI U KALENDAR'}
                    </button>
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

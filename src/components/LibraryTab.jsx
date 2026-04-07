import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Play, Loader2, Database, Clock, RefreshCw, Plus, UploadCloud, Trash2, Activity, Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { getZoneColorForTrainer } from '../utils/workoutUtils';
import { parseWorkoutFile } from '../utils/workoutParser';

export default function LibraryTab({ onSelectWorkout, ftp = 250 }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [openFolders, setOpenFolders] = useState([]);

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
        const { data, error } = await supabase.from('workouts').insert(uploadedWorkouts).select();
        if (error) throw error;
        // Osježi listu i vrati se na početak (zatvori foldere)
        setOpenFolders([]);
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

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    return `${m} min`;
  };

  const getCategoryColor = (cat) => {
    switch (cat) {
      case 'Oporavak': return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
      case 'Endurance': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Tempo': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Sweet Spot': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'Threshold': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'VO2 Max': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'Anaerobni': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/50';
    }
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
      tss: Math.round(totalTSS)
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
      default: return 'border-zinc-500/50 text-zinc-400 hover:bg-zinc-500/10 shadow-[0_0_15px_rgba(113,113,122,0.1)]';
    }
  };

  const categoryOrder = ['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni', 'Ostalo'];

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

  const toggleFolder = (cat) => {
    setOpenFolders(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };


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
        <div className="flex flex-col gap-4">
          {sortedCategories.map(cat => {
            const isOpen = openFolders.includes(cat);
            const folderWorkouts = groupedWorkouts[cat];
            
            return (
              <div key={cat} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <button 
                  onClick={() => toggleFolder(cat)}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border bg-zinc-900/60 transition-all ${getFolderStyles(cat)}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-xl bg-zinc-950/50 backdrop-blur-sm shadow-inner group-hover:scale-110 transition-transform">
                      {isOpen ? <FolderOpen className="w-6 h-6" fill="currentColor" fillOpacity={0.2} /> : <Folder className="w-6 h-6" fill="currentColor" fillOpacity={0.2} />}
                    </div>
                    <div className="text-left">
                      <h3 className="text-xl font-black tracking-tight">{cat}</h3>
                      <p className="text-xs font-bold opacity-60 uppercase tracking-widest">{folderWorkouts.length} treninga u mapi</p>
                    </div>
                  </div>
                  <div>
                    {isOpen ? <ChevronDown className="w-6 h-6 opacity-70" /> : <ChevronRight className="w-6 h-6 opacity-70" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-4 ml-2 pl-4 border-l-2 border-zinc-800/50 pb-2">
                    {folderWorkouts.map((workout) => (
                      <div key={workout.id} className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800 rounded-2xl p-5 hover:border-orange-500/50 hover:shadow-[0_0_20px_rgba(249,115,22,0.1)] transition-all group/card flex flex-col h-full relative overflow-hidden">
                        <div className="flex justify-between items-start mb-3 relative z-10">
                          <h3 className="text-lg font-black text-zinc-100 group-hover/card:text-orange-500 transition-colors pr-16 leading-tight">
                            {workout.title}
                          </h3>
                          <div className="absolute right-0 top-0 flex gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteWorkout(workout.id); }}
                              className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-red-500 hover:border-red-500/50 shadow-sm shadow-black shrink-0 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
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

                        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4 mt-auto relative z-10">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 items-center gap-2">
                              <Clock className="w-4 h-4 text-zinc-500" />
                              <span className="text-zinc-300 font-bold text-sm tracking-wide">{formatTime(workout.duration_seconds)}</span>
                            </div>
                            {(() => {
                              const metrics = getWorkoutMetrics(workout);
                              return (
                                <div className="flex bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 items-center gap-2" title={`Avg: ${metrics.avg}W | TSS: ${metrics.tss}`}>
                                   <Activity className="w-4 h-4 text-zinc-500" />
                                   <span className="text-zinc-300 font-bold text-sm tracking-wide">NP {metrics.np}W</span>
                                </div>
                              );
                            })()}
                          </div>
                          
                          <button 
                            onClick={() => onSelectWorkout(workout)}
                            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-bold px-4 py-2 rounded-lg text-sm transition-all shadow-[0_0_10px_rgba(249,115,22,0.3)] group-hover/card:shadow-[0_0_15px_rgba(249,115,22,0.5)]"
                          >
                            <Play className="w-4 h-4" fill="currentColor" /> Kreni
                          </button>
                        </div>
                        
                        {/* Ukrasni sjaj iza */}
                        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-orange-500/10 blur-[50px] rounded-full pointer-events-none group-hover/card:bg-orange-500/20 transition-colors"></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {workouts.length === 0 && !loading && !error && (
             <div className="py-20 text-center flex flex-col items-center">
               <Database className="w-16 h-16 text-zinc-800 mb-4" />
               <h3 className="text-xl font-bold text-zinc-500 mb-2">Knjižnica je prazna</h3>
               <p className="text-zinc-600 text-sm">Učini prvi korak i učitaj neki trening na gumb dodaj.</p>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

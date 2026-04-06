import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Play, Loader2, Database, Clock, RefreshCw, Plus, UploadCloud } from 'lucide-react';
import { getZoneColorForTrainer } from '../utils/workoutUtils';
import { parseWorkoutFile } from '../utils/workoutParser';

export default function LibraryTab({ onSelectWorkout }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

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
        // Osježi listu
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

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    return `${m} min`;
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {workouts.map((workout) => (
            <div key={workout.id} className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800 rounded-2xl p-5 hover:border-orange-500/50 hover:shadow-[0_0_20px_rgba(249,115,22,0.1)] transition-all group flex flex-col h-full relative overflow-hidden">
              <div className="flex justify-between items-start mb-3 relative z-10">
                <h3 className="text-lg font-black text-zinc-100 group-hover:text-orange-500 transition-colors pr-8 leading-tight">
                  {workout.title}
                </h3>
                <div className="absolute right-0 top-0 flex items-center justify-center w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 text-xs font-black text-zinc-400 shadow-sm shadow-black shrink-0">
                  {workout.difficulty_score}
                </div>
              </div>
              
              <p className="text-zinc-500 text-sm mb-5 leading-relaxed flex-1 relative z-10">
                {workout.description}
              </p>

              {/* MALI PREVIEW GRAF */}
              <div className="h-16 w-full flex items-end mb-5 rounded-lg overflow-hidden bg-zinc-950/80 border border-zinc-800/60 p-0.5 relative z-10">
                {workout.steps && workout.steps.length > 0 ? (
                  workout.steps.map((wStep, i) => {
                    const widthP = (wStep.duration / workout.duration_seconds) * 100;
                    const heightP = Math.min(Math.max((wStep.power / 150) * 100, 15), 100);
                    return (
                      <div 
                        key={i} 
                        style={{ width: `${widthP}%`, height: `${heightP}%` }} 
                        className={`${getZoneColorForTrainer(wStep.power)} opacity-80 border-r border-zinc-950`}
                      />
                    )
                  })
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] uppercase font-bold">Nema Podataka</div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4 mt-auto relative z-10">
                <div className="flex bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-500" />
                  <span className="text-zinc-300 font-bold text-sm tracking-wide">{formatTime(workout.duration_seconds)}</span>
                </div>
                
                <button 
                  onClick={() => onSelectWorkout(workout)}
                  className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-bold px-4 py-2 rounded-lg text-sm transition-all shadow-[0_0_10px_rgba(249,115,22,0.3)] group-hover:shadow-[0_0_15px_rgba(249,115,22,0.5)]"
                >
                  <Play className="w-4 h-4" fill="currentColor" /> Kreni
                </button>
              </div>
              
              {/* Ukrasni sjaj iza */}
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-orange-500/10 blur-[50px] rounded-full pointer-events-none group-hover:bg-orange-500/20 transition-colors"></div>
            </div>
          ))}

          {workouts.length === 0 && !loading && !error && (
             <div className="col-span-full py-20 text-center flex flex-col items-center">
               <Database className="w-16 h-16 text-zinc-800 mb-4" />
               <h3 className="text-xl font-bold text-zinc-500 mb-2">Knjižnica je prazna</h3>
               <p className="text-zinc-600 text-sm">U bazi (Supabase) trenutno nema unesenih treninga.</p>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

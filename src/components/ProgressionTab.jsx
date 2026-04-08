import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Trophy, ArrowUpRight, Flame, Clock, Award, Info } from 'lucide-react';

const ZONES = [
  { id: 'Endurance', name: 'Z2 Endurance', color: 'text-sky-400', bg: 'bg-sky-500', icon: <Clock className="w-5 h-5 text-sky-400" /> },
  { id: 'Tempo', name: 'Z3 Tempo', color: 'text-emerald-400', bg: 'bg-emerald-500', icon: <Target className="w-5 h-5 text-emerald-400" /> },
  { id: 'Sweet Spot', name: 'Sweet Spot', color: 'text-yellow-400', bg: 'bg-yellow-500', icon: <TrendingUp className="w-5 h-5 text-yellow-400" /> },
  { id: 'Threshold', name: 'Z4 Threshold', color: 'text-orange-500', bg: 'bg-orange-500', icon: <Flame className="w-5 h-5 text-orange-500" /> },
  { id: 'VO2 Max', name: 'Z5 VO2 Max', color: 'text-rose-500', bg: 'bg-rose-500', icon: <Award className="w-5 h-5 text-rose-500" /> },
  { id: 'Anaerobni', name: 'Z6 Anaerobni', color: 'text-fuchsia-500', bg: 'bg-fuchsia-500', icon: <Trophy className="w-5 h-5 text-fuchsia-500" /> },
];

export default function ProgressionTab({ workouts = [] }) {
  const [levels, setLevels] = useState({});
  const [history, setHistory] = useState([]);

  useEffect(() => {
    // 1. Čitanje povijesti odvoženih treninga (lokalno + intervals povezane aktivnosti)
    const loadHistory = () => {
      try {
        const localHistory = JSON.parse(localStorage.getItem('ai_trener_completed_workouts') || '[]');
        
        const allCompleted = [...localHistory];
        
        // Dodaj sve zavrsene aktivnosti koje su bile uspjesno uparene i imaju faktor tezine
        workouts.forEach(w => {
           if (w.isCompleted && w.difficulty_score && w.category) {
              const alreadyExists = allCompleted.some(loc => loc.id === w.id);
              if (!alreadyExists) {
                  allCompleted.push({
                      id: w.id,
                      date: w.date,
                      title: w.title,
                      category: w.category,
                      difficulty_score: w.difficulty_score
                  });
              }
           }
        });

        // Svi zapisi idu u history za lakše rudarenje "heroj" treninga
        setHistory(allCompleted);
        
        // 2. Izračun aktualnih razina (maksimalni score u zadnjih 30 dana) po zonama
        const currentLevels = {
          'Endurance': 1.0, 'Tempo': 1.0, 'Sweet Spot': 1.0, 
          'Threshold': 1.0, 'VO2 Max': 1.0, 'Anaerobni': 1.0
        };

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        allCompleted.forEach(w => {
          const wDate = new Date(w.date);
          if (wDate > thirtyDaysAgo && currentLevels[w.category] !== undefined) {
             if (w.difficulty_score > currentLevels[w.category]) {
                currentLevels[w.category] = w.difficulty_score;
             }
          }
        });

        setLevels(currentLevels);
      } catch(e) {
        console.error("Greška kod učitavanja razina napretka", e);
      }
    };

    loadHistory();
  }, [workouts]);

  // Formatiranje razine
  const formatLevel = (val) => {
    return parseFloat(val).toFixed(1);
  };

  const getPercentage = (level) => {
    // Maksimalni vizualni level je 10.0
    return Math.min(100, Math.max(10, (level / 10) * 100));
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      {/* HEADER */}
      <div className="bg-zinc-950/50 rounded-3xl shadow-2xl border border-zinc-800/80 p-6 md:p-10 flex flex-col sm:flex-row items-center justify-between shrink-0 gap-6 relative overflow-hidden backdrop-blur-md">
        <div className="absolute -top-20 -right-20 p-6 opacity-[0.03]">
          <TrendingUp className="w-96 h-96 text-orange-500" />
        </div>
        
        <div className="relative z-10 flex items-center gap-4 w-full">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-4 rounded-2xl shadow-[0_0_20px_rgba(249,115,22,0.4)] md:shrink-0 hidden md:block">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-3xl md:text-4xl font-black text-zinc-100 tracking-tight lowercase">Faktor <span className="text-orange-500">n</span>apretka</h2>
            <p className="text-zinc-400 font-medium text-sm mt-2 max-w-2xl mx-auto md:mx-0">
              Prati tvoju trenutnu sposobnost i izdržljivost unutar različitih zona snage. Završetkom težih treninga (iznad 85% trajanja) podižeš svoj Faktor Težine! Razine polagano propadaju ako se sustavno ne treniraju zadnjih 30 dana.
            </p>
          </div>
        </div>
      </div>

      {/* RAZINE ZONE (Grafikoni) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {ZONES.map(zone => {
          const currentLevel = levels[zone.id] || 1.0;
          const percentage = getPercentage(currentLevel);
          const hasAdvanced = currentLevel > 1.0;

          // Zadnji najteži trening u ovoj zoni?
          const heroWorkout = history
            .filter(w => w.category === zone.id && new Date(w.date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .sort((a, b) => b.difficulty_score - a.difficulty_score)[0];

          return (
            <div key={zone.id} className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 rounded-3xl p-6 flex flex-col relative overflow-hidden group hover:border-zinc-700 transition-colors">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-800">
                    {zone.icon}
                  </div>
                  <h3 className="text-lg font-bold text-zinc-100">{zone.name}</h3>
                </div>
                <div className={`text-4xl font-black ${hasAdvanced ? 'text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'text-zinc-700'}`}>
                  {formatLevel(currentLevel)}
                </div>
              </div>

              {/* BAR CHART */}
              <div className="h-4 w-full bg-zinc-950 rounded-full overflow-hidden shadow-inner flex mb-6 border border-zinc-800">
                <div 
                  className={`h-full ${zone.bg} transition-all duration-1000 ease-out`}
                  style={{ width: `${percentage}%`, filter: hasAdvanced ? 'brightness(1.2)' : 'grayscale(1)' }}
                >
                  {hasAdvanced && <div className="w-full h-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)] animate-[shimmer_2s_infinite]"></div>}
                </div>
              </div>

              {/* HEROS WORKOUT */}
              <div className="mt-auto pt-4 border-t border-zinc-800/60 min-h-[4rem] flex flex-col justify-center">
                {heroWorkout ? (
                  <div className="flex items-center justify-between text-xs">
                    <div className="text-zinc-500 font-medium truncate pr-2 flex items-center gap-1.5">
                      <ArrowUpRight className={`w-3.5 h-3.5 ${zone.color}`} />
                      Zaslužno: <span className="text-zinc-300 font-bold truncate max-w-[120px]">{heroWorkout.title}</span>
                    </div>
                    <span className="font-bold text-zinc-400 bg-zinc-950 px-2 py-1 rounded max-w-fit flex-shrink-0">
                      Prije {Math.floor((Date.now() - new Date(heroWorkout.date)) / (1000 * 60 * 60 * 24))} d
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center text-xs text-zinc-600 gap-1.5 font-medium italic">
                    <Info className="w-3.5 h-3.5" /> Nema završenih treninga
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

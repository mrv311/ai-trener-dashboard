import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchIntervalsData, getActivityStreams } from '../services/intervalsApi';
import { RefreshCw, Database, CheckCircle2, AlertCircle } from 'lucide-react';

export default function SupabaseSyncModule({ intervalsId, intervalsKey }) {
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [statusMsg, setStatusMsg] = useState(null);
  const [statusType, setStatusType] = useState(null); // 'success' | 'error' | 'info'

  const handleSync = async () => {
    if (!intervalsId || !intervalsKey) {
      setStatusType('error');
      setStatusMsg('Nema API ključeva za Intervals.icu. Poveži se prvo!');
      return;
    }

    if (!startDate || !endDate) {
      setStatusType('error');
      setStatusMsg('Molim odaberi početni i završni datum.');
      return;
    }

    setIsSyncing(true);
    setStatusType('info');
    setStatusMsg('Dohvaćanje aktivnosti od ' + startDate + ' do ' + endDate + '...');
    setProgress({ current: 0, total: 0 });

    try {
      const data = await fetchIntervalsData(intervalsId, intervalsKey, { oldest: startDate, newest: endDate });
      const activities = data.activities || [];
      
      if (activities.length === 0) {
        setStatusType('info');
        setStatusMsg('Nema pronađenih aktivnosti u odabranom rasponu.');
        setIsSyncing(false);
        return;
      }

      setProgress({ current: 0, total: activities.length });
      setStatusMsg(`Pronađeno ${activities.length} aktivnosti. Kreće dohvat streamova i slanje u bazu...`);

      let successCount = 0;
      let errorCount = 0;
      let lastDbError = null;

      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        
        try {
          // Preuzimanje streamova (stream_data jsonb)
          const streams = await getActivityStreams(intervalsId, intervalsKey, act.id).catch(() => []);
          
          // Određivanje izvora aktivnosti (Garmin, Strava, itd.)
          // Koristimo 'type' polje iz Intervals.icu API-ja koje sadrži izvor
          let workoutSource = 'external'; // Default za vanjske aktivnosti
          if (act.type) {
            const typeStr = String(act.type).toLowerCase();
            if (typeStr.includes('garmin')) workoutSource = 'garmin';
            else if (typeStr.includes('strava')) workoutSource = 'strava';
            else if (typeStr.includes('wahoo')) workoutSource = 'wahoo';
          }
          
          const record = {
            started_at: act.start_date_local,
            title: act.name || 'Trening',
            workout_source: workoutSource,
            intervals_activity_id: act.id, // Spremi Intervals.icu ID za detekciju duplikata
            duration_seconds: act.moving_time || 0,
            avg_power: (act.icu_average_power || act.average_watts || act.average_power) ? Math.round(act.icu_average_power || act.average_watts || act.average_power) : null,
            avg_hr: (act.icu_average_hr || act.average_heartrate) ? Math.round(act.icu_average_hr || act.average_heartrate) : null,
            avg_cadence: act.average_cadence ? Math.round(act.average_cadence) : null,
            np: (act.icu_normalized_power || act.normalized_power) ? Math.round(act.icu_normalized_power || act.normalized_power) : null,
            tss: act.icu_training_load ? Number(act.icu_training_load) : null,
            if_factor: act.icu_intensity ? Number((act.icu_intensity > 5 ? act.icu_intensity / 100 : act.icu_intensity).toFixed(2)) : null,
            work_kj: act.icu_joules ? Math.round(act.icu_joules / 1000) : null,
            distance_m: act.distance ? Number(act.distance) : null,
            avg_speed_kmh: act.average_speed ? Number((act.average_speed * 3.6).toFixed(1)) : null,
            ftp_used: act.icu_ftp ? Math.round(act.icu_ftp) : null,
            weight_kg: act.icu_weight ? Number(act.icu_weight) : null,
            stream_data: streams 
          };

          const { error } = await supabase.from('completed_activities').insert([record]);
          if (error) {
              lastDbError = error.message || JSON.stringify(error);
              throw error;
          }
          
          successCount++;
        } catch (err) {
          console.error(`Greška za aktivnost ${act.id}:`, err);
          errorCount++;
        }
        
        setProgress({ current: i + 1, total: activities.length });
      }

      setStatusType(errorCount > 0 ? 'error' : 'success');
      setStatusMsg(`Sinkronizacija završena: ${successCount} uspješno, ${errorCount} s greškom. ${errorCount > 0 && lastDbError ? 'Zadnja greška: ' + lastDbError : ''}`);

    } catch (err) {
      console.error(err);
      setStatusType('error');
      setStatusMsg('Greška pri dohvaćanju: ' + (err.message || 'Nepoznata greška'));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-6 shadow-lg backdrop-blur-md relative mt-8">
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[50px] rounded-full pointer-events-none"></div>
      
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.15)] border border-blue-500/30 flex items-center justify-center">
          <Database className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-100">Supabase Povijesni Sync</h3>
          <p className="text-xs text-zinc-400">Pohrani povijesne Intervals.icu treninge u bazu podataka.</p>
        </div>
      </div>

      <div className="space-y-4 relative z-10 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Datum od:</label>
            <input 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)} 
              className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-zinc-200 transition-all [color-scheme:dark]" 
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Datum do:</label>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)} 
              className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-zinc-200 transition-all [color-scheme:dark]" 
            />
          </div>
        </div>

        {statusMsg && (
          <div className={`p-3 rounded-lg flex items-start gap-2 border text-xs ${
            statusType === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
            statusType === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
            'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}>
            {statusType === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> :
             statusType === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> :
             <RefreshCw className={`w-4 h-4 shrink-0 mt-0.5 ${isSyncing ? 'animate-spin' : ''}`} />}
            <span>{statusMsg}</span>
          </div>
        )}

        {isSyncing && progress.total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold text-zinc-400 mb-1">
              <span>Napredak...</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              ></div>
            </div>
          </div>
        )}

        <div className="pt-2">
          <button 
            onClick={handleSync}
            disabled={isSyncing}
            className={`w-full py-3 rounded-lg font-bold transition-all text-sm uppercase tracking-wider flex items-center justify-center gap-2 border ${
              isSyncing 
              ? 'bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white shadow-[0_4px_15px_rgba(59,130,246,0.2)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.4)] border-blue-400/30'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} /> 
            {isSyncing ? 'Sinkronizacija u tijeku...' : 'Pokreni Sync'}
          </button>
        </div>
      </div>
    </div>
  );
}

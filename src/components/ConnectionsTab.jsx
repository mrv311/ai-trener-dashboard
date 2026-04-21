import React from 'react';
import { CheckCircle, XCircle, Clock, Link as LinkIcon, Activity } from 'lucide-react';
import SupabaseSyncModule from './SupabaseSyncModule';

export default function ConnectionsTab({ connectionStatus, intervalsId, setId, intervalsKey, setKey, onSave }) {
  const saveSettings = () => { 
    if (intervalsKey) setKey(String(intervalsKey).trim());
    if (intervalsId) setId(String(intervalsId).trim());
    setTimeout(() => {
      onSave(); 
    }, 50);
  };

  return (
    <div className="max-w-5xl mx-auto bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-800/80 animate-in fade-in flex flex-col p-8 mb-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="mb-8 border-b border-zinc-800/80 pb-6 relative z-10">
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          Integracije i Spajanje
        </h2>
        <p className="text-zinc-400 text-sm mt-2">Povežite aplikaciju sa željenim platformama za analizu i dohvaćanje podataka.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        
        {/* Intervals.icu - Glavna integracija */}
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-6 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500/20 to-orange-600/10 rounded-xl shadow-[0_0_15px_rgba(249,115,22,0.15)] border border-orange-500/30 flex items-center justify-center">
              <span className="font-black text-xl text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.8)]">i</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-100">Intervals.icu</h3>
              <p className="text-xs text-zinc-400">Glavni izvor tvojih struktuiranih treninga.</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-950/50 p-3 rounded-lg border border-zinc-800 mb-6">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Status veze:</p>
            
            {connectionStatus === 'connected' && (
              <div className="flex items-center text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.1)]">
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Spojeno
              </div>
            )}
            {connectionStatus === 'error' && (
              <div className="flex items-center text-red-400 bg-red-500/10 px-3 py-1 rounded-full text-xs font-bold border border-red-500/20 shadow-[0_0_10px_rgba(248,113,113,0.1)]">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Greška
              </div>
            )}
            {connectionStatus === 'connecting' && (
              <div className="flex items-center text-orange-400 bg-orange-500/10 px-3 py-1 rounded-full text-xs font-bold border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.1)]">
                <Clock className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Obrada...
              </div>
            )}
            {connectionStatus === 'idle' && (
              <div className="flex items-center text-zinc-400 bg-zinc-800/50 px-3 py-1 rounded-full text-xs font-bold border border-zinc-700">
                Odspojeno
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">Intervals ID</label>
              <input type="text" value={intervalsId} onChange={e => setId(e.target.value)} className="w-full bg-zinc-900/80 border border-zinc-700 rounded-lg p-2.5 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] font-mono text-sm text-zinc-200 transition-all placeholder:text-zinc-600" placeholder="npr. 15670332" />
            </div>
            
            <div>
              <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">API Key</label>
              <input type="password" value={intervalsKey} onChange={e => setKey(e.target.value)} className="w-full bg-zinc-900/80 border border-zinc-700 rounded-lg p-2.5 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] font-mono text-sm text-zinc-200 transition-all placeholder:text-zinc-600" placeholder="Zalijepi API ključ" />
            </div>
            
            <div className="pt-2">
              <button onClick={saveSettings} className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white py-3 rounded-lg font-bold shadow-[0_4px_15px_rgba(249,115,22,0.3)] hover:shadow-[0_4px_20px_rgba(249,115,22,0.5)] transition-all text-sm uppercase tracking-wider flex items-center justify-center gap-2 border border-orange-400/30">
                <LinkIcon className="w-4 h-4" /> Spremi i Poveži
              </button>
            </div>
          </div>
        </div>

        {/* Ostale, Dummy Integracije */}
        <div className="space-y-4">
          <DummyIntegration name="Strava" description="Preuzimanje GPS rute i segmenta." colorClass="text-orange-400 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]" bgClass="bg-orange-500/10 border-orange-500/20" letter="S" />
          <DummyIntegration name="Garmin Connect" description="Sinkronizacija wellness metrike i spavanja." colorClass="text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]" bgClass="bg-cyan-500/10 border-cyan-500/20" letter="G" />
          <DummyIntegration name="TrainingPeaks" description="Uvoz kupljenih trenažnih planova." colorClass="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]" bgClass="bg-emerald-500/10 border-emerald-500/20" letter="T" />
          <DummyIntegration name="TrainerDay" description="Preuzimanje workout blockova." colorClass="text-indigo-400 drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]" bgClass="bg-indigo-500/10 border-indigo-500/20" letter="TD" />

          {/* NOVI MODUL - Sinhronizacija s bazom */}
          <SupabaseSyncModule intervalsId={intervalsId} intervalsKey={intervalsKey} />
        </div>

      </div>
    </div>
  );
}

function DummyIntegration({ name, description, colorClass, bgClass, letter }) {
  return (
    <div className="flex items-center justify-between p-4 border border-zinc-800/80 rounded-2xl bg-zinc-900/30 backdrop-blur-sm shadow-sm hover:bg-zinc-800/50 hover:shadow-lg transition-all group">
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 ${bgClass} border rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110`}>
            <span className={`font-black text-sm ${colorClass}`}>{letter}</span>
        </div>
        <div>
          <h4 className="font-bold text-zinc-100 text-sm flex items-center gap-2 group-hover:text-white transition-colors">
            {name}
          </h4>
          <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
        </div>
      </div>
      <button className="px-5 py-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold transition-all shrink-0 border border-zinc-700 group-hover:border-zinc-600">
        Poveži
      </button>
    </div>
  );
}

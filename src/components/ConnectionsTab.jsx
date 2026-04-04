import React from 'react';
import { CheckCircle, XCircle, Clock, Link as LinkIcon, Activity } from 'lucide-react';

export default function ConnectionsTab({ connectionStatus, intervalsId, setId, intervalsKey, setKey, onSave }) {
  const saveSettings = () => { 
    localStorage.setItem('intervalsId', intervalsId); 
    localStorage.setItem('intervalsKey', intervalsKey.trim()); 
    onSave(); 
  };

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-sm border border-stone-200 animate-in fade-in flex flex-col p-8 mb-8">
      <div className="mb-8 border-b border-stone-100 pb-6">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          Integracije i Spajanje
        </h2>
        <p className="text-stone-500 text-sm mt-2">Povežite aplikaciju sa željenim platformama za analizu i dohvaćanje podataka.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Intervals.icu - Glavna integracija */}
        <div className="bg-orange-50/50 border border-orange-100 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-orange-100 flex items-center justify-center">
              <span className="font-black text-xl text-orange-600">i</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-800">Intervals.icu</h3>
              <p className="text-xs text-stone-500">Glavni izvor tvojih struktuiranih treninga.</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-stone-100 mb-6">
            <p className="text-stone-500 text-xs font-bold uppercase tracking-wider">Status veze:</p>
            
            {connectionStatus === 'connected' && (
              <div className="flex items-center text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200">
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Spojeno
              </div>
            )}
            {connectionStatus === 'error' && (
              <div className="flex items-center text-red-600 bg-red-50 px-3 py-1 rounded-full text-xs font-bold border border-red-200">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Greška
              </div>
            )}
            {connectionStatus === 'connecting' && (
              <div className="flex items-center text-orange-600 bg-orange-50 px-3 py-1 rounded-full text-xs font-bold border border-orange-200">
                <Clock className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Obrada...
              </div>
            )}
            {connectionStatus === 'idle' && (
              <div className="flex items-center text-stone-500 bg-stone-100 px-3 py-1 rounded-full text-xs font-bold border border-stone-200">
                Odspojeno
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-1.5">Intervals ID</label>
              <input type="text" value={intervalsId} onChange={e => setId(e.target.value)} className="w-full bg-white border border-stone-200 rounded-lg p-2.5 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 font-mono text-sm" placeholder="npr. 15670332" />
            </div>
            
            <div>
              <label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-1.5">API Key</label>
              <input type="password" value={intervalsKey} onChange={e => setKey(e.target.value)} className="w-full bg-white border border-stone-200 rounded-lg p-2.5 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 font-mono text-sm" placeholder="Zalijepi API ključ" />
            </div>
            
            <div className="pt-2">
              <button onClick={saveSettings} className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3 rounded-lg font-bold shadow-sm transition-colors text-sm uppercase tracking-wider flex items-center justify-center gap-2">
                <LinkIcon className="w-4 h-4" /> Spremi i Poveži
              </button>
            </div>
          </div>
        </div>

        {/* Ostale, Dummy Integracije */}
        <div className="space-y-4">
          <DummyIntegration name="Strava" description="Preuzimanje GPS rute i segmenta." colorClass="text-orange-500" bgClass="bg-orange-100" letter="S" />
          <DummyIntegration name="Garmin Connect" description="Sinkronizacija wellness metrike i spavanja." colorClass="text-blue-500" bgClass="bg-blue-100" letter="G" />
          <DummyIntegration name="TrainingPeaks" description="Uvoz kupljenih trenažnih planova." colorClass="text-green-500" bgClass="bg-green-100" letter="T" />
          <DummyIntegration name="TrainerDay" description="Preuzimanje workout blockova." colorClass="text-indigo-500" bgClass="bg-indigo-100" letter="TD" />
        </div>

      </div>
    </div>
  );
}

function DummyIntegration({ name, description, colorClass, bgClass, letter }) {
  return (
    <div className="flex items-center justify-between p-4 border border-stone-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 ${bgClass} rounded-full flex items-center justify-center shrink-0`}>
            <span className={`font-black text-sm ${colorClass}`}>{letter}</span>
        </div>
        <div>
          <h4 className="font-bold text-stone-800 text-sm flex items-center gap-2">
            {name}
          </h4>
          <p className="text-xs text-stone-400 mt-0.5">{description}</p>
        </div>
      </div>
      <button className="px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg text-xs font-bold transition-colors shrink-0">
        Poveži
      </button>
    </div>
  );
}

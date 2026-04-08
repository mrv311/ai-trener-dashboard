import React, { useState } from 'react';
import { User, Activity, Heart, Save, CheckCircle2 } from 'lucide-react';

export default function SettingsTab({ profile, setProfile }) {
  const [formData, setFormData] = useState({
    weight: profile?.weight || 75.9,
    ftp: profile?.ftp || 270,
    thresholdHr: profile?.thresholdHr || 160,
    maxHr: profile?.maxHr || 180
  });

  const [isSaved, setIsSaved] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setIsSaved(false);
  };

  const handleSave = () => {
    setProfile(prev => ({ ...prev, ...formData }));
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

  return (
    <div className="max-w-5xl mx-auto bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-800/80 animate-in fade-in flex flex-col min-h-[700px] overflow-hidden">
      <div className="flex justify-between items-center border-b border-zinc-800/80 px-8 py-4 gap-6 bg-zinc-950/30">
        <button className="pb-1 text-sm font-bold uppercase tracking-widest border-b-2 transition-all border-orange-500 text-orange-400 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]">Osobne Postavke i Zone</button>
        <button 
          onClick={handleSave}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-lg ${
            isSaved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-[0_4px_15px_rgba(249,115,22,0.3)] border border-orange-500/50'
          }`}
        >
          {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {isSaved ? 'Spremljeno' : 'Spremi Promjene'}
        </button>
      </div>

      <div className="p-8">
        <div className="space-y-10 animate-in fade-in">
          <div>
            <h3 className="text-lg font-bold text-zinc-100 mb-4 flex items-center"><User className="w-5 h-5 mr-2 text-zinc-500" /> Osnovni parametri</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div><label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Težina (kg)</label><input type="number" name="weight" value={formData.weight} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-3 text-zinc-100 font-bold outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] transition-all" /></div>
              <div><label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">FTP (W)</label><input type="number" name="ftp" value={formData.ftp} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-3 text-zinc-100 font-bold outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] transition-all" /></div>
              <div><label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Threshold HR (BPM)</label><input type="number" name="thresholdHr" value={formData.thresholdHr} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-3 text-zinc-100 font-bold outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] transition-all" /></div>
              <div><label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Max HR (BPM)</label><input type="number" name="maxHr" value={formData.maxHr} onChange={handleChange} className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl p-3 text-zinc-100 font-bold outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:shadow-[0_0_10px_rgba(249,115,22,0.2)] transition-all" /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 border-t border-zinc-800/80 pt-8">
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-4 flex items-center bg-purple-500/10 text-purple-400 border border-purple-500/20 px-3 py-1.5 rounded-lg w-fit shadow-[0_0_10px_rgba(168,85,247,0.1)]"><Activity className="w-4 h-4 mr-2" /> Power Zones</h3>
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
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-4 flex items-center bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg w-fit shadow-[0_0_10px_rgba(244,63,94,0.1)]"><Heart className="w-4 h-4 mr-2" /> Heart Rate Zones</h3>
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
        </div>
      </div>
    </div>
  );
}
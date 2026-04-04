import React from 'react';
import { User, Activity, Heart } from 'lucide-react';

export default function SettingsTab({ profile, setProfile }) {

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
    <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-sm border border-stone-200 animate-in fade-in flex flex-col min-h-[700px]">
      <div className="flex border-b border-stone-200 px-8 pt-6 gap-6 bg-stone-50/50 rounded-t-xl">
        <button className="pb-4 text-sm font-bold uppercase tracking-widest border-b-2 transition-colors border-orange-600 text-orange-700">Osobne Postavke i Zone</button>
      </div>

      <div className="p-8">
        <div className="space-y-10 animate-in fade-in">
          <div>
            <h3 className="text-lg font-bold text-stone-800 mb-4 flex items-center"><User className="w-5 h-5 mr-2 text-stone-400" /> Osnovni parametri</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div><label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">Težina (kg)</label><input type="number" value={profile.weight} onChange={e => setProfile({...profile, weight: e.target.value})} className="w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-800 font-bold outline-none focus:border-orange-500" /></div>
              <div><label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">FTP (W)</label><input type="number" value={profile.ftp} onChange={e => setProfile({...profile, ftp: e.target.value})} className="w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-800 font-bold outline-none focus:border-orange-500" /></div>
              <div><label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">Threshold HR (BPM)</label><input type="number" value={profile.thresholdHr} onChange={e => setProfile({...profile, thresholdHr: e.target.value})} className="w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-800 font-bold outline-none focus:border-orange-500" /></div>
              <div><label className="block text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">Max HR (BPM)</label><input type="number" value={profile.maxHr} onChange={e => setProfile({...profile, maxHr: e.target.value})} className="w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-800 font-bold outline-none focus:border-orange-500" /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 border-t border-stone-100 pt-8">
            <div>
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex items-center bg-purple-100 text-purple-800 px-3 py-1.5 rounded-md w-fit"><Activity className="w-4 h-4 mr-2" /> Power Zones</h3>
              <div className="text-xs text-stone-600 space-y-1">
                {powerZones.map(z => {
                  const minW = Math.round((profile.ftp * z.min) / 100);
                  const maxW = z.max ? Math.round((profile.ftp * z.max) / 100) : null;
                  return (
                    <div key={z.id} className={`flex items-center justify-between py-2 border-b border-stone-100 ${z.isSubZone ? 'mt-4 border-t border-stone-200' : ''}`}>
                      <div className="w-8 font-bold text-stone-800">{z.id}</div><div className="flex-1">{z.name}</div><div className="w-20 text-right text-stone-400">{z.min}% {z.max ? `- ${z.max}%` : '+'}</div><div className="w-24 text-right font-bold text-stone-800">{minW}W - {maxW ? `${maxW}W` : '+'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex items-center bg-rose-100 text-rose-800 px-3 py-1.5 rounded-md w-fit"><Heart className="w-4 h-4 mr-2" /> Heart Rate Zones</h3>
              <div className="text-xs text-stone-600 space-y-1">
                {hrZones.map(z => {
                  const minBpm = Math.round((profile.thresholdHr * z.min) / 100);
                  const maxBpm = z.max ? Math.round((profile.thresholdHr * z.max) / 100) : null;
                  return (
                    <div key={z.id} className="flex items-center justify-between py-2 border-b border-stone-100">
                      <div className="w-8 font-bold text-stone-800">{z.id}</div><div className="flex-1">{z.name}</div><div className="w-20 text-right text-stone-400">{z.min}% {z.max ? `- ${z.max}%` : '+'}</div><div className="w-24 text-right font-bold text-stone-800">{minBpm}bpm - {maxBpm ? `${maxBpm}bpm` : profile.maxHr}</div>
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
import React, { useState, useEffect } from 'react';
import { User, Zap, Target, Clock, Save, BrainCircuit, CheckCircle2 } from 'lucide-react';

export default function ProfileTab({ profile, setProfile }) {
  // Proširujemo postojeći profil s novim podacima za AI
  const [formData, setFormData] = useState({
    weight: profile?.weight || 75.9,
    ftp: profile?.ftp || 270,
    maxHr: profile?.maxHr || 180,
    thresholdHr: profile?.thresholdHr || 160,
    birthYear: profile?.birthYear || 1985,
    height: profile?.height || 180,
    experience: profile?.experience || '3-5', // godine treniranja
    riderType: profile?.riderType || 'all-rounder',
    hoursPerWeek: profile?.hoursPerWeek || 8,
    primaryGoal: profile?.primaryGoal || 'Istra 300',
    goalDate: profile?.goalDate || '2026-09-26',
    weakness: profile?.weakness || 'kratki usponi (VO2Max)'
  });

  const [isSaved, setIsSaved] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setIsSaved(false);
  };

  const handleSave = () => {
    setProfile(formData);
    // U pravoj aplikaciji ovdje bismo spremili u localStorage ili bazu
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      
      {/* ZAGLAVLJE */}
      <div className="bg-stone-800 rounded-3xl shadow-sm border border-stone-800 p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-10"><BrainCircuit className="w-32 h-32 text-white"/></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-orange-500 p-2 rounded-xl"><User className="w-6 h-6 text-white"/></div>
            <h2 className="text-2xl font-black text-white tracking-tight">Atletski Profil</h2>
          </div>
          <p className="text-stone-400 font-medium max-w-xl text-sm leading-relaxed">
            Ovi podaci predstavljaju tvoj "DNK" u aplikaciji. Naš AI trener (uskoro dostupan) čitat će ovaj upitnik kako bi ti kreirao potpuno individualizirane treninge, predvidio vrijeme oporavka i optimizirao put do tvog glavnog cilja.
          </p>
        </div>

        <button 
          onClick={handleSave}
          className={`relative z-10 flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-sm ${
            isSaved ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-orange-600 text-white hover:bg-orange-500'
          }`}
        >
          {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
          {isSaved ? 'Profil Spremljen' : 'Spremi Promjene'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 1. BIOMETRIJA I ISKUSTVO */}
        <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-center gap-2 text-stone-800 font-bold border-b border-stone-100 pb-3">
            <User className="w-5 h-5 text-orange-500" /> Fizički Podaci & Iskustvo
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Godina Rođenja</label>
              <input type="number" name="birthYear" value={formData.birthYear} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Iskustvo (Godine)</label>
              <select name="experience" value={formData.experience} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all">
                <option value="<1">Manje od 1 god.</option>
                <option value="1-3">1 do 3 godine</option>
                <option value="3-5">3 do 5 godina</option>
                <option value="5-10">5 do 10 godina</option>
                <option value="10+">Više od 10 godina</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Težina (kg)</label>
              <input type="number" step="0.1" name="weight" value={formData.weight} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Visina (cm)</label>
              <input type="number" name="height" value={formData.height} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
          </div>
        </div>

        {/* 2. FIZIOLOGIJA */}
        <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-center gap-2 text-stone-800 font-bold border-b border-stone-100 pb-3">
            <Zap className="w-5 h-5 text-orange-500" /> Fiziološki Profil
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Trenutni FTP (W)</label>
              <input type="number" name="ftp" value={formData.ftp} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Tip Vozača</label>
              <select name="riderType" value={formData.riderType} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all">
                <option value="all-rounder">All-Rounder</option>
                <option value="climber">Brdaš (Climber)</option>
                <option value="sprinter">Sprinter</option>
                <option value="tt">Kronometraš (TT / Triatlon)</option>
                <option value="puncheur">Puncheur (Kratki usponi)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Max Puls (bpm)</label>
              <input type="number" name="maxHr" value={formData.maxHr} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Threshold Puls (LTHR)</label>
              <input type="number" name="thresholdHr" value={formData.thresholdHr} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
            </div>
          </div>
        </div>

        {/* 3. VRIJEME I CILJEVI (Spanning full width on large screens) */}
        <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col gap-5 md:col-span-2 relative overflow-hidden">
          <div className="flex items-center gap-2 text-stone-800 font-bold border-b border-stone-100 pb-3">
            <Target className="w-5 h-5 text-orange-500" /> Ciljevi i Logistika
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 border-r-0 md:border-r border-stone-100 md:pr-6 flex flex-col gap-4">
              <div>
                 <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Sati tjedno</label>
                 <div className="flex items-center gap-3">
                   <input type="range" name="hoursPerWeek" min="3" max="25" value={formData.hoursPerWeek} onChange={handleChange} className="flex-1 accent-orange-500" />
                   <span className="font-bold text-stone-800 w-12 text-right">{formData.hoursPerWeek} h</span>
                 </div>
              </div>
              <p className="text-xs text-stone-500 font-medium">Realno procijeni koliko sati tjedno možeš odvojiti za trening. AI će prilagoditi volumen kako ne bi došlo do "burnouta".</p>
            </div>

            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Glavni Cilj (A-Utrka ili Događaj)</label>
                <input type="text" name="primaryGoal" value={formData.primaryGoal} onChange={handleChange} placeholder="Npr. Istra 300, Granfondo Zadar, Obaranje FTP rekorda..." className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
              </div>
              <div>
                <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Datum Cilja</label>
                <input type="date" name="goalDate" value={formData.goalDate} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all" />
              </div>
              <div>
                <label className="block text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Fokus: Što želiš popraviti?</label>
                <select name="weakness" value={formData.weakness} onChange={handleChange} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5 text-stone-800 font-bold focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all">
                  <option value="base">Izdržljivost (Baza / Z2)</option>
                  <option value="sweetspot">Dugi usponi (SweetSpot / FTP)</option>
                  <option value="vo2max">Kratki oštri usponi (VO2Max)</option>
                  <option value="sprint">Sprint i eksplozivnost</option>
                  <option value="recovery">Sposobnost oporavka između napora</option>
                </select>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Calendar as CalendarIcon, BarChart2, Settings, LineChart, User, Loader2, Monitor } from 'lucide-react';

import CalendarTab from './components/CalendarTab';
import TrainerTab from './components/TrainerTab';
import SettingsTab from './components/SettingsTab';
import FitnessTab from './components/FitnessTab'; // DODAN IMPORT NOVE KOMPONENTE
import PowerCurveTab from './components/PowerCurveTab';
import ProfileTab from './components/ProfileTab';
import AnalyticsTab from './components/AnalyticsTab';

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [intervalsId, setIntervalsId] = useState(() => localStorage.getItem('intervalsId') || '');
  const [intervalsKey, setIntervalsKey] = useState(() => localStorage.getItem('intervalsKey') || '');
  
  const [rawActivities, setRawActivities] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [wellnessData, setWellnessData] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);
  const [unpairedList, setUnpairedList] = useState([]);

  const [athleteProfile, setAthleteProfile] = useState({
    weight: 75.9, ftp: 270, thresholdHr: 160, maxHr: 180
  });
  
  const [currentDate, setCurrentDate] = useState(new Date()); 

  const fetchWorkouts = async () => {
    if (!intervalsId || !intervalsKey) return;
    setIsLoading(true);
    try {
      const cleanId = intervalsId.trim();
      const cleanKey = intervalsKey.trim();
      const authString = btoa(`API_KEY:${cleanKey}`);
      
      const todayObj = new Date();
      const pastDate = new Date(); pastDate.setMonth(todayObj.getMonth() - 12);
      const futureDate = new Date(); futureDate.setMonth(todayObj.getMonth() + 3);

      const oldest = pastDate.toISOString().split('T')[0];
      const newest = futureDate.toISOString().split('T')[0];

      const headers = { 'Authorization': `Basic ${authString}`, 'Accept': 'application/json' };

      const actRes = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/activities?oldest=${oldest}&newest=${newest}`, { headers });
      if (actRes.status === 401) throw new Error("API ključ ili ID su neispravni.");
      if (actRes.status === 429) throw new Error("Previše zahtjeva prema serveru. Pričekaj malo.");
      if (!actRes.ok) throw new Error("Greška pri spajanju na server.");

      const wellRes = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/wellness?oldest=${oldest}&newest=${newest}`, { headers });
      const evRes = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/events?oldest=${oldest}&newest=${newest}`, { headers });
      
      setRawActivities(await actRes.json());
      if (evRes.ok) setRawEvents(await evRes.json());
      
      if (wellRes.ok) {
        const wellData = await wellRes.json();
        const mappedWellness = {};
        wellData.forEach(w => {
          const formatDur = (mins) => { const h = Math.floor(mins / 60); return `${h > 0 ? h + 'h ' : ''}${String(mins % 60).padStart(2, '0')}m`; };
          mappedWellness[w.id] = {
            restingHR: w.restingHR, 
            sleep: w.sleepSecs ? formatDur(Math.round(w.sleepSecs / 60)) : null,
            // AŽURIRANO: Sada spremamo i podatke za fitness grafikon!
            ctl: w.ctl,
            atl: w.atl,
            tsb: w.tsb
          };
        });
        setWellnessData(mappedWellness);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (intervalsId && intervalsKey) fetchWorkouts();
  }, []);

  const workouts = useMemo(() => {
    const finalWorkouts = [];
    const consumedEvents = new Set();
    const todayStr = new Date().toISOString().split('T')[0];

    rawActivities.forEach(act => {
      const actDate = act.start_date_local ? act.start_date_local.split('T')[0] : '';
      let pairedEvent = null;
      let separatedEventId = null;

      for (let e of rawEvents) {
        if (e.category !== 'WORKOUT') continue;
        const isDateMatch = e.start_date_local && e.start_date_local.split('T')[0] === actDate;
        const isIdMatch = e.activity_id === act.id;

        if (isDateMatch || isIdMatch) {
          if (unpairedList.includes(`${act.id}-${e.id}`)) {
            separatedEventId = e.id;
          } else if (!consumedEvents.has(e.id)) {
            pairedEvent = e;
            consumedEvents.add(e.id);
            break; 
          }
        }
      }

      let complianceColor = 'blue'; 
      let plannedTssDisplay = null;
      let plannedDurDisplay = null;
      let eventIdObj = null;

      if (pairedEvent) {
        eventIdObj = pairedEvent.id;
        plannedTssDisplay = Math.round(pairedEvent.icu_training_load || 0);
        plannedDurDisplay = Math.round((pairedEvent.moving_time || 0) / 60);

        const actualTss = Math.round(act.icu_training_load || 0);
        const actualDur = Math.round((act.moving_time || 0) / 60);

        let ratio = 1;
        if (plannedTssDisplay > 0 && actualTss > 0) ratio = actualTss / plannedTssDisplay;
        else if (plannedDurDisplay > 0 && actualDur > 0) ratio = actualDur / plannedDurDisplay;

        if (ratio >= 0.8 && ratio <= 1.2) complianceColor = 'green';
        else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) complianceColor = 'yellow';
        else complianceColor = 'red';
      }

      finalWorkouts.push({
        id: `act-${act.id}`, actId: act.id, eventId: eventIdObj, separatedEventId: separatedEventId,
        date: actDate, title: act.name || 'Trening',
        duration: Math.round((act.moving_time || 0) / 60), plannedDuration: plannedDurDisplay,
        tss: Math.round(act.icu_training_load || 0), plannedTss: plannedTssDisplay,
        statusColor: complianceColor, isCompleted: true
      });
    });

    rawEvents.forEach(ev => {
      if (ev.category !== 'WORKOUT' || consumedEvents.has(ev.id)) return; 
      if (ev.activity_id && !unpairedList.some(pair => pair.endsWith(`-${ev.id}`))) return; 

      const evDate = ev.start_date_local ? ev.start_date_local.split('T')[0] : '';
      let complianceColor = 'grey'; 
      if (evDate < todayStr) complianceColor = 'red-missed'; 

      finalWorkouts.push({
        id: `ev-${ev.id}`, eventId: ev.id, date: evDate, title: ev.name || 'Planirano',
        duration: Math.round((ev.moving_time || 0) / 60), plannedDuration: Math.round((ev.moving_time || 0) / 60),
        tss: Math.round(ev.icu_training_load || 0), plannedTss: Math.round(ev.icu_training_load || 0),
        statusColor: complianceColor, isCompleted: false
      });
    });

    return finalWorkouts;
  }, [rawActivities, rawEvents, unpairedList]); 

  const handleUnpair = (actId, eventId) => { if (!actId || !eventId) return; setUnpairedList(prev => [...prev, `${actId}-${eventId}`]); };
  const handlePair = (actId, eventId) => { if (!actId || !eventId) return; setUnpairedList(prev => prev.filter(pair => pair !== `${actId}-${eventId}`)); };

  return (
    <div className="flex h-screen bg-stone-50 text-stone-900 font-sans">
      
      {/* LIJEVA NAVIGACIJA */}
      <div className="w-20 md:w-64 bg-white border-r border-stone-200 flex flex-col shadow-sm z-10 shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-stone-100">
          <div className="bg-orange-600 p-1.5 rounded-lg mr-3 shadow-sm"><Activity className="w-5 h-5 text-white" /></div>
          <span className="font-bold text-lg hidden md:block tracking-tight text-stone-800">Make it Green!</span>
        </div>
        <nav className="mt-6 flex-1 px-3 space-y-1">
          <NavItem icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <NavItem icon={<Monitor />} label="Trenažer" active={activeTab === 'trainer'} onClick={() => setActiveTab('trainer')} />
          <NavItem icon={<Activity />} label="Fitness" active={activeTab === 'fitness'} onClick={() => setActiveTab('fitness')} />
          <NavItem icon={<LineChart />} label="Krivulja snage" active={activeTab === 'power'} onClick={() => setActiveTab('power')} />
          <NavItem icon={<BarChart2 />} label="Analitika" active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <NavItem icon={<Settings />} label="Postavke" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          <NavItem icon={<User />} label="Profil" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </nav>
      </div>

      {/* GLAVNI SADRŽAJ */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-stone-800">
              {activeTab === 'settings' && 'Postavke Aplikacije'}
              {activeTab === 'calendar' && 'Dnevnik Treninga'}
              {activeTab === 'trainer' && 'Virtualna Vožnja (Trenažer)'}
              {activeTab === 'fitness' && 'Kondicija i Umor (PMC)'}
            </h1>
            {isLoading && <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />}
          </div>
          {(activeTab === 'calendar' || activeTab === 'fitness') && (
            <button onClick={fetchWorkouts} className="flex items-center gap-2 bg-stone-100 hover:bg-stone-200 text-stone-600 px-4 py-2 rounded-lg text-xs font-bold transition-colors border border-stone-200">
               Osvježi podatke
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8 bg-stone-50">
          
          {activeTab === 'trainer' && <TrainerTab profile={athleteProfile} />}

          {activeTab === 'calendar' && (
            <CalendarTab 
              currentDate={currentDate} 
              setCurrentDate={setCurrentDate} 
              workouts={workouts} 
              wellnessData={wellnessData} 
              handleUnpair={handleUnpair} 
              handlePair={handlePair} 
            />
          )}

          {/* PRIKAZ NOVE KOMPONENTE ZA FITNESS */}
          {activeTab === 'fitness' && (
            <FitnessTab wellnessData={wellnessData} />
          )}

          {activeTab === 'settings' && (
            <SettingsTab 
              intervalsId={intervalsId} 
              setId={setIntervalsId} 
              intervalsKey={intervalsKey} 
              setKey={setIntervalsKey} 
              profile={athleteProfile} 
              setProfile={setAthleteProfile} 
              onSave={fetchWorkouts} 
            />
          )}
          {activeTab === 'power' && (
  <PowerCurveTab intervalsId={intervalsId} intervalsKey={intervalsKey} profile={athleteProfile} />
)}
{activeTab === 'profile' && (
  <ProfileTab profile={athleteProfile} setProfile={setAthleteProfile} />
)}
{activeTab === 'analytics' && (
  <AnalyticsTab intervalsId={intervalsId} intervalsKey={intervalsKey} />
)}
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center px-4 py-3 rounded-lg transition-all ${active ? 'bg-orange-50 text-orange-700 font-semibold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}>
      {React.cloneElement(icon, { className: `w-5 h-5 ${active ? 'text-orange-600' : 'text-stone-400'}` })}
      <span className="ml-3 text-sm hidden md:block">{label}</span>
    </button>
  );
}
import React, { useState } from 'react';
import { Activity, Calendar as CalendarIcon, BarChart2, Settings, LineChart, User, Loader2, Monitor, LogOut, Link as LinkIcon } from 'lucide-react';

import CalendarTab from './components/CalendarTab';
import TrainerTab from './components/TrainerTab';
import SettingsTab from './components/SettingsTab';
import FitnessTab from './components/FitnessTab';
import PowerCurveTab from './components/PowerCurveTab';
import ProfileTab from './components/ProfileTab';
import AnalyticsTab from './components/AnalyticsTab';
import ConnectionsTab from './components/ConnectionsTab';

import { useLocalStorage } from './hooks/useLocalStorage';
import { useIntervalsData } from './hooks/useIntervalsData';

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [intervalsId, setIntervalsId] = useLocalStorage('intervalsId', '');
  const [intervalsKey, setIntervalsKey] = useLocalStorage('intervalsKey', '');
  
  const { workouts, wellnessData, isLoading, error, fetchWorkouts, handlePair, handleUnpair } = useIntervalsData(intervalsId, intervalsKey);

  const [selectedWorkout, setSelectedWorkout] = useState(null);

  const [athleteProfile, setAthleteProfile] = useState({
    weight: 75.9, ftp: 270, thresholdHr: 160, maxHr: 180
  });
  
  const [currentDate, setCurrentDate] = useState(new Date()); 

  const connectionStatus = isLoading ? 'connecting' : (error ? 'error' : (intervalsId && intervalsKey && workouts.length > 0 ? 'connected' : 'idle'));

  return (
    <div className="flex h-screen bg-stone-50 text-stone-900 font-sans">
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
        <div className="p-3 border-t border-stone-100 mt-auto flex flex-col gap-1">
          <button 
            onClick={() => setActiveTab('connections')} 
            className={`w-full flex items-center px-4 py-3 rounded-lg transition-all ${activeTab === 'connections' ? 'bg-orange-50 text-orange-700 font-semibold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
          >
            <LinkIcon className={`w-5 h-5 ${activeTab === 'connections' ? 'text-orange-600' : 'text-stone-400'}`} />
            <span className="ml-3 text-sm hidden md:block font-medium">Spajanje API-ja</span>
          </button>

          <button 
            onClick={() => { 
              setIntervalsId(''); 
              setIntervalsKey(''); 
            }} 
            className="w-full flex items-center px-4 py-3 rounded-lg transition-all text-stone-400 hover:bg-stone-100 hover:text-red-600"
          >
            <LogOut className="w-5 h-5" />
            <span className="ml-3 text-sm hidden md:block font-medium">Odjava</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-stone-800">
              {activeTab === 'settings' && 'Postavke Aplikacije'}
              {activeTab === 'calendar' && 'Dnevnik Treninga'}
              {activeTab === 'trainer' && 'Virtualna Vožnja (Trenažer)'}
              {activeTab === 'fitness' && 'Kondicija i Umor (PMC)'}
              {activeTab === 'profile' && 'Moj Profil'}
              {activeTab === 'power' && 'Krivulja Snage'}
              {activeTab === 'analytics' && 'Analitika'}
              {activeTab === 'connections' && 'Vanjske Veze'}
            </h1>
            {isLoading && <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />}
            {error && <span className="text-xs font-bold bg-red-100 text-red-600 px-3 py-1 rounded-full border border-red-200">{error}</span>}
          </div>
          {(activeTab === 'calendar' || activeTab === 'fitness') && (
            <button onClick={fetchWorkouts} className="flex items-center gap-2 bg-stone-100 hover:bg-stone-200 text-stone-600 px-4 py-2 rounded-lg text-xs font-bold transition-colors border border-stone-200">
               Osvježi podatke
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8 bg-stone-50">
          {activeTab === 'calendar' && (
            <CalendarTab 
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              workouts={workouts}
              wellnessData={wellnessData}
              handleUnpair={handleUnpair}
              handlePair={handlePair}
              onSelectWorkout={(workout) => {
                setSelectedWorkout(workout);
                setActiveTab('trainer'); 
              }} 
            />
          )}

          {activeTab === 'trainer' && (
            <TrainerTab 
              profile={athleteProfile} 
              workoutFromCalendar={selectedWorkout} 
            />
          )}

          {activeTab === 'fitness' && <FitnessTab wellnessData={wellnessData} />}
          {activeTab === 'settings' && <SettingsTab profile={athleteProfile} setProfile={setAthleteProfile} />}
          {activeTab === 'power' && <PowerCurveTab intervalsId={intervalsId} intervalsKey={intervalsKey} profile={athleteProfile} />}
          {activeTab === 'profile' && <ProfileTab profile={athleteProfile} setProfile={setAthleteProfile} />}
          {activeTab === 'analytics' && <AnalyticsTab intervalsId={intervalsId} intervalsKey={intervalsKey} />}
          {activeTab === 'connections' && <ConnectionsTab connectionStatus={connectionStatus} intervalsId={intervalsId} setId={setIntervalsId} intervalsKey={intervalsKey} setKey={setIntervalsKey} onSave={fetchWorkouts} />}
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
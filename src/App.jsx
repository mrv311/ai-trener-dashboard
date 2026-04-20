import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Calendar as CalendarIcon, BarChart2, Settings, LineChart,
  User, Loader2, Monitor, LogOut, Link as LinkIcon,
  MoreHorizontal, X, Database, TrendingUp, ClipboardList
} from 'lucide-react';

import CalendarTab from './components/CalendarTab';
import TrainerTab from './components/TrainerTab';
import SettingsTab from './components/SettingsTab';
import FitnessTab from './components/FitnessTab';
import PowerCurveTab from './components/PowerCurveTab';
import ProfileTab from './components/ProfileTab';
import AnalyticsTab from './components/AnalyticsTab';
import ConnectionsTab from './components/ConnectionsTab';
import LibraryTab from './components/LibraryTab';
import ProgressionTab from './components/ProgressionTab';
import HistoryTab from './components/HistoryTab';

import { useLocalStorage } from './hooks/useLocalStorage';
import { useProfileSync } from './hooks/useProfileSync';
import { useIntervalsData } from './hooks/useIntervalsData';

// 1. Centralizirana konfiguracija tabova za lakše održavanje
const TABS = {
  calendar: { label: 'Kalendar', icon: <CalendarIcon />, component: CalendarTab },
  library: { label: 'Knjižnica', icon: <Database />, component: LibraryTab },
  trainer: { label: 'Trenažer', icon: <Monitor />, component: TrainerTab },
  history: { label: 'Povijest', icon: <ClipboardList />, component: HistoryTab },
  fitness: { label: 'Kondicija', icon: <Activity />, component: FitnessTab },
  progression: { label: 'Napredak', icon: <TrendingUp />, component: ProgressionTab },
  power: { label: 'Snaga', icon: <LineChart />, component: PowerCurveTab },
  analytics: { label: 'Analitika', icon: <BarChart2 />, component: AnalyticsTab },
  settings: { label: 'Postavke', icon: <Settings />, component: SettingsTab },
  profile: { label: 'Profil', icon: <User />, component: ProfileTab },
  connections: { label: 'Veze', icon: <LinkIcon />, component: ConnectionsTab }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [intervalsId, setIntervalsId] = useLocalStorage('intervalsId', '');
  const [intervalsKey, setIntervalsKey] = useLocalStorage('intervalsKey', '');

  const { workouts, wellnessData, isLoading, error, fetchWorkouts, handlePair, handleUnpair, handleDeleteLocalActivity, handleRescheduleWorkout, handleUpdateWorkout, handleCreateWorkout } = useIntervalsData(intervalsId, intervalsKey);

  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [athleteProfile, setAthleteProfile] = useProfileSync({
    username: 'Odvažni Vozač', weight: 75.9, ftp: 270, thresholdHr: 160, maxHr: 180,
    birthYear: 1985, height: 180, experience: '3-5', riderType: 'all-rounder',
    hoursPerWeek: 8, primaryGoal: 'Istra 300', goalDate: '2026-09-26', weakness: 'kratki usponi (VO2Max)'
  });

  const [currentDate, setCurrentDate] = useState(new Date());

  // 2. Optimizacija statusa veze
  const connectionStatus = useMemo(() => {
    if (isLoading) return 'connecting';
    if (error) return 'error';
    return (intervalsId && intervalsKey && workouts.length > 0) ? 'connected' : 'idle';
  }, [isLoading, error, intervalsId, intervalsKey, workouts.length]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-orange-500/30">

      {/* SIDEBAR (Desktop) */}
      <div className="hidden md:flex w-64 bg-zinc-900/60 backdrop-blur-xl border-r border-zinc-800/80 flex-col shadow-2xl z-10 shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-zinc-800/80">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-1.5 rounded-lg mr-3 shadow-[0_0_15px_rgba(249,115,22,0.4)]">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-zinc-100 drop-shadow-sm">Make it Green!</span>
        </div>

        <nav className="mt-6 flex-1 px-3 space-y-2">
          {['calendar', 'library', 'trainer', 'history', 'fitness', 'progression', 'power', 'analytics', 'settings', 'profile'].map(tabId => (
            <NavItem
              key={tabId}
              icon={TABS[tabId].icon}
              label={TABS[tabId].label.split(' ')[0]} // Kraći labeli za sidebar
              active={activeTab === tabId}
              onClick={() => handleTabChange(tabId)}
            />
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-800/80 mt-auto flex flex-col gap-2">
          
          {/* User Profile Banner */}
          <div className="flex items-center gap-3 px-4 py-2 mb-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
            <div className="bg-gradient-to-br from-orange-400 to-orange-600 text-white rounded-full w-9 h-9 flex items-center justify-center font-bold shadow-[0_0_10px_rgba(249,115,22,0.3)] shrink-0">
              {(athleteProfile.username || 'K').charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col truncate">
               <span className="text-sm font-bold text-zinc-100 truncate" title={athleteProfile.username || 'Korisnik'}>{athleteProfile.username || 'Korisnik'}</span>
               <span className="text-[10px] text-zinc-500 truncate">FTP: <span className="font-bold text-orange-400">{athleteProfile.ftp}W</span> | {athleteProfile.weight}kg</span>
            </div>
          </div>
          <button
            onClick={() => handleTabChange('connections')}
            className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeTab === 'connections' ? 'bg-orange-500/10 text-orange-400 font-semibold border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.1)]' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
          >
            <LinkIcon className={`w-5 h-5 ${activeTab === 'connections' ? 'text-orange-500' : 'text-zinc-500'}`} />
            <span className="ml-3 text-sm font-medium">API Veze</span>
          </button>

          <button
            onClick={() => { setIntervalsId(''); setIntervalsKey(''); }}
            className="w-full flex items-center px-4 py-3 rounded-xl transition-all text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="w-5 h-5" />
            <span className="ml-3 text-sm font-medium">Odjava</span>
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 md:h-16 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 flex items-center justify-between px-4 md:px-8 shrink-0 z-20">
          <div className="flex items-center gap-3 md:gap-4">
            <h1 className="text-lg md:text-xl font-bold text-zinc-100 truncate tracking-tight">
              {TABS[activeTab]?.label || 'Dashboard'}
            </h1>
            {isLoading && <Loader2 className="w-4 h-4 md:w-5 md:h-5 text-orange-500 animate-spin shrink-0 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />}
            {error && <span className="text-[10px] md:text-xs font-bold bg-red-500/10 text-red-400 px-2 md:px-3 py-1 rounded-full border border-red-500/20 truncate max-w-[120px] md:max-w-xs">{error}</span>}
          </div>
          {(activeTab === 'calendar' || activeTab === 'fitness') && (
            <button onClick={fetchWorkouts} className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-xs font-bold transition-all border border-zinc-700 hover:shadow-lg">
              Osvježi
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-3 md:p-8 bg-zinc-950 md:pb-8 pb-20 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-900/10 via-zinc-950 to-zinc-950 pointer-events-none"></div>

          <div className="relative z-10 w-full h-full">
                        {activeTab === 'calendar' && (
              <CalendarTab
                currentDate={currentDate} setCurrentDate={setCurrentDate}
                workouts={workouts} wellnessData={wellnessData}
                handleUnpair={handleUnpair} handlePair={handlePair}
                handleDeleteLocalActivity={handleDeleteLocalActivity}
                handleRescheduleWorkout={handleRescheduleWorkout}
                handleUpdateWorkout={handleUpdateWorkout}
                handleCreateWorkout={handleCreateWorkout}
                onSelectWorkout={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
                profile={athleteProfile}
              />
            )}

            {/* Persistence-critical tab */}
            <div className={activeTab === 'trainer' ? 'block h-full' : 'hidden'}>
              <TrainerTab
                profile={athleteProfile}
                workoutFromCalendar={selectedWorkout}
                onClose={() => handleTabChange('library')}
              />
            </div>

            {activeTab === 'history' && <HistoryTab />}
            {activeTab === 'fitness' && <FitnessTab wellnessData={wellnessData} />}
            {activeTab === 'progression' && <ProgressionTab workouts={workouts} />}
            {activeTab === 'library' && (
              <LibraryTab
                ftp={athleteProfile.ftp}
                onSelectWorkout={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
              />
            )}
            {activeTab === 'settings' && <SettingsTab profile={athleteProfile} setProfile={setAthleteProfile} />}
            {activeTab === 'power' && <PowerCurveTab intervalsId={intervalsId} intervalsKey={intervalsKey} profile={athleteProfile} />}
            {activeTab === 'profile' && <ProfileTab profile={athleteProfile} setProfile={setAthleteProfile} />}
            {activeTab === 'analytics' && <AnalyticsTab intervalsId={intervalsId} intervalsKey={intervalsKey} />}
            {activeTab === 'connections' && <ConnectionsTab connectionStatus={connectionStatus} intervalsId={intervalsId} setId={setIntervalsId} intervalsKey={intervalsKey} setKey={setIntervalsKey} onSave={fetchWorkouts} />}
          </div>
        </main>

        {/* MOBILE NAVIGATION */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/80 z-40 px-2 pt-1 pb-safe-bottom">
          <div className="flex justify-around items-center h-14">
            <MobileTab icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => handleTabChange('calendar')} />
            <MobileTab icon={<Monitor />} label="Trenažer" active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
            <MobileTab icon={<ClipboardList />} label="Povijest" active={activeTab === 'history'} onClick={() => handleTabChange('history')} />
            <MobileTab icon={<Activity />} label="Fitness" active={activeTab === 'fitness'} onClick={() => handleTabChange('fitness')} />
            <MobileTab icon={<MoreHorizontal />} label="Više" active={['settings', 'profile', 'connections', 'power', 'analytics'].includes(activeTab) || isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
          </div>
        </div>

        {/* MOBILE MENU OVERLAY (Simplified grid render) */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 shadow-2xl animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-gradient-to-br from-orange-400 to-orange-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shadow-[0_0_10px_rgba(249,115,22,0.3)]">
                    {(athleteProfile.username || 'K').charAt(0).toUpperCase()}
                  </div>
                  <h3 className="text-lg font-black text-zinc-100 tracking-tight">Bok, {athleteProfile.username || 'Korisnik'}</h3>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {['analytics', 'power', 'settings', 'profile', 'connections', 'library', 'progression'].map(tabId => (
                  <MobileMenuGridBtn key={tabId} icon={TABS[tabId].icon} label={TABS[tabId].label} active={activeTab === tabId} onClick={() => handleTabChange(tabId)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 3. Sub-komponente s React.memo bi bile idealne ovdje ako postanu kompleksnije
function NavItem({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all relative ${active ? 'bg-gradient-to-r from-orange-500/20 to-transparent text-orange-400 font-bold border border-orange-500/20' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}`}>
      {active && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-orange-500 rounded-r-md shadow-[0_0_10px_rgba(249,115,22,0.8)]" />}
      {React.cloneElement(icon, { className: `w-5 h-5 ${active ? 'text-orange-500' : 'text-zinc-500'}` })}
      <span className="ml-3 text-sm">{label}</span>
    </button>
  );
}

function MobileTab({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${active ? 'text-orange-500' : 'text-zinc-500'}`}>
      {React.cloneElement(icon, { className: 'w-[22px] h-[22px]' })}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function MobileMenuGridBtn({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${active ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300'}`}>
      {React.cloneElement(icon, { className: 'w-7 h-7' })}
      <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
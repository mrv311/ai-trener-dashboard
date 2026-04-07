import React, { useState } from 'react';
import { Activity, Calendar as CalendarIcon, BarChart2, Settings, LineChart, User, Loader2, Monitor, LogOut, Link as LinkIcon, MoreHorizontal, X, Database } from 'lucide-react';

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

import { useLocalStorage } from './hooks/useLocalStorage';
import { useIntervalsData } from './hooks/useIntervalsData';

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [intervalsId, setIntervalsId] = useLocalStorage('intervalsId', '');
  const [intervalsKey, setIntervalsKey] = useLocalStorage('intervalsKey', '');
  
  const { workouts, wellnessData, isLoading, error, fetchWorkouts, handlePair, handleUnpair } = useIntervalsData(intervalsId, intervalsKey);

  const [selectedWorkout, setSelectedWorkout] = useState(null);

  const [athleteProfile, setAthleteProfile] = useState({
    weight: 75.9, ftp: 270, thresholdHr: 160, maxHr: 180
  });
  
  const [currentDate, setCurrentDate] = useState(new Date()); 

  const connectionStatus = isLoading ? 'connecting' : (error ? 'error' : (intervalsId && intervalsKey && workouts.length > 0 ? 'connected' : 'idle'));

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-orange-500/30">
      
      {/* SIDEBAR (Desktop) */}
      <div className="hidden md:flex w-64 bg-zinc-900/60 backdrop-blur-xl border-r border-zinc-800/80 flex-col shadow-2xl z-10 shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-zinc-800/80">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-1.5 rounded-lg mr-3 shadow-[0_0_15px_rgba(249,115,22,0.4)]"><Activity className="w-5 h-5 text-white" /></div>
          <span className="font-bold text-lg tracking-tight text-zinc-100 drop-shadow-sm">Make it Green!</span>
        </div>
        <nav className="mt-6 flex-1 px-3 space-y-2">
          <NavItem icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => handleTabChange('calendar')} />
          <NavItem icon={<Database />} label="Knjižnica" active={activeTab === 'library'} onClick={() => handleTabChange('library')} />
          <NavItem icon={<Monitor />} label="Trenažer" active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
          <NavItem icon={<Activity />} label="Fitness" active={activeTab === 'fitness'} onClick={() => handleTabChange('fitness')} />
          <NavItem icon={<TrendingUp />} label="Napredak" active={activeTab === 'progression'} onClick={() => handleTabChange('progression')} />
          <NavItem icon={<LineChart />} label="Krivulja snage" active={activeTab === 'power'} onClick={() => handleTabChange('power')} />
          <NavItem icon={<BarChart2 />} label="Analitika" active={activeTab === 'analytics'} onClick={() => handleTabChange('analytics')} />
          <NavItem icon={<Settings />} label="Postavke" active={activeTab === 'settings'} onClick={() => handleTabChange('settings')} />
          <NavItem icon={<User />} label="Profil" active={activeTab === 'profile'} onClick={() => handleTabChange('profile')} />
        </nav>
        <div className="p-3 border-t border-zinc-800/80 mt-auto flex flex-col gap-2">
          <button 
            onClick={() => handleTabChange('connections')} 
            className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeTab === 'connections' ? 'bg-orange-500/10 text-orange-400 font-semibold border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.1)]' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
          >
            <LinkIcon className={`w-5 h-5 ${activeTab === 'connections' ? 'text-orange-500' : 'text-zinc-500'}`} />
            <span className="ml-3 text-sm font-medium">Spajanje API-ja</span>
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
        
        {/* HEADER */}
        <header className="h-14 md:h-16 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 flex items-center justify-between px-4 md:px-8 shrink-0 z-20">
          <div className="flex items-center gap-3 md:gap-4">
            <h1 className="text-lg md:text-xl font-bold text-zinc-100 truncate tracking-tight">
              {activeTab === 'settings' && 'Postavke Aplikacije'}
              {activeTab === 'calendar' && 'Dnevnik Treninga'}
              {activeTab === 'library' && 'Knjižnica Treninga'}
              {activeTab === 'trainer' && 'Virtualna Vožnja'}
              {activeTab === 'fitness' && 'Kondicija i Umor'}
              {activeTab === 'progression' && 'Faktor Napretka'}
              {activeTab === 'profile' && 'Moj Profil'}
              {activeTab === 'power' && 'Krivulja Snage'}
              {activeTab === 'analytics' && 'Analitika Treninga'}
              {activeTab === 'connections' && 'Vanjske Veze'}
            </h1>
            {isLoading && <Loader2 className="w-4 h-4 md:w-5 md:h-5 text-orange-500 animate-spin shrink-0 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />}
            {error && <span className="text-[10px] md:text-xs font-bold bg-red-500/10 text-red-400 px-2 md:px-3 py-1 rounded-full border border-red-500/20 truncate max-w-[120px] md:max-w-xs">{error}</span>}
          </div>
          {(activeTab === 'calendar' || activeTab === 'fitness') && (
            <button onClick={fetchWorkouts} className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-xs font-bold transition-all border border-zinc-700 shrink-0 hover:shadow-lg">
               Osvježi<span className="hidden sm:inline"> podatke</span>
            </button>
          )}
        </header>

        {/* PAGE CONTENT */}
        <main className="flex-1 overflow-auto p-3 md:p-8 bg-zinc-950 md:pb-8 pb-20 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-900/10 via-zinc-950 to-zinc-950 pointer-events-none"></div>
          
          <div className="relative z-10 w-full h-full">
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
                  handleTabChange('trainer'); 
                }} 
              />
            )}

            {/* TRENAŽER TAB - ostaje uvijek renderiran u DOM-u kako bi trening tekao u pozadini, samo se CSS-om skriva */}
            <div className={activeTab === 'trainer' ? 'block' : 'hidden'}>
              <TrainerTab 
                profile={athleteProfile} 
                workoutFromCalendar={selectedWorkout} 
              />
            </div>

            {activeTab === 'fitness' && <FitnessTab wellnessData={wellnessData} />}
            {activeTab === 'progression' && <ProgressionTab />}
            {activeTab === 'library' && (
              <LibraryTab 
                ftp={athleteProfile.ftp}
                onSelectWorkout={(workout) => {
                  setSelectedWorkout(workout);
                  handleTabChange('trainer');
                }} 
              />
            )}
            {activeTab === 'settings' && <SettingsTab profile={athleteProfile} setProfile={setAthleteProfile} />}
            {activeTab === 'power' && <PowerCurveTab intervalsId={intervalsId} intervalsKey={intervalsKey} profile={athleteProfile} />}
            {activeTab === 'profile' && <ProfileTab profile={athleteProfile} setProfile={setAthleteProfile} />}
            {activeTab === 'analytics' && <AnalyticsTab intervalsId={intervalsId} intervalsKey={intervalsKey} />}
            {activeTab === 'connections' && <ConnectionsTab connectionStatus={connectionStatus} intervalsId={intervalsId} setId={setIntervalsId} intervalsKey={intervalsKey} setKey={setIntervalsKey} onSave={fetchWorkouts} />}
          </div>
        </main>

        {/* MOBILE BOTTOM NAV */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/80 z-40 px-2 pt-1 pb-safe-bottom">
          <div className="flex justify-around items-center h-14">
            <MobileTab icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => handleTabChange('calendar')} />
            <MobileTab icon={<Database />} label="Knjižnica" active={activeTab === 'library'} onClick={() => handleTabChange('library')} />
            <MobileTab icon={<Monitor />} label="Trenažer" active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
            <MobileTab icon={<Activity />} label="Fitness" active={activeTab === 'fitness'} onClick={() => handleTabChange('fitness')} />
            <MobileTab icon={<TrendingUp />} label="Napredak" active={activeTab === 'progression'} onClick={() => handleTabChange('progression')} />
            <MobileTab icon={<MoreHorizontal />} label="Više" active={['power', 'analytics', 'settings', 'profile', 'connections'].includes(activeTab) || isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
          </div>
        </div>

        {/* MOBILE "MORE" OVERLAY MENU */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
            <div 
              className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 shadow-2xl animate-in slide-in-from-bottom"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-zinc-100 tracking-tight">Ostale opcije</h3>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-200"><X className="w-5 h-5" /></button>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-6">
                 <MobileMenuGridBtn icon={<BarChart2 />} label="Analitika" active={activeTab === 'analytics'} onClick={() => handleTabChange('analytics')} />
                 <MobileMenuGridBtn icon={<LineChart />} label="Krivulja snage" active={activeTab === 'power'} onClick={() => handleTabChange('power')} />
                 <MobileMenuGridBtn icon={<Settings />} label="Postavke" active={activeTab === 'settings'} onClick={() => handleTabChange('settings')} />
                 <MobileMenuGridBtn icon={<User />} label="Moj Profil" active={activeTab === 'profile'} onClick={() => handleTabChange('profile')} />
                 <MobileMenuGridBtn icon={<LinkIcon />} label="API / Veze" active={activeTab === 'connections'} onClick={() => handleTabChange('connections')} />
              </div>
              
              <button 
                onClick={() => { setIntervalsId(''); setIntervalsKey(''); setIsMobileMenuOpen(false); }} 
                className="w-full flex justify-center items-center gap-2 py-3.5 bg-red-500/10 text-red-500 font-bold rounded-xl border border-red-500/20"
              >
                <LogOut className="w-5 h-5" /> Odjava
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all relative ${active ? 'bg-gradient-to-r from-orange-500/20 to-transparent text-orange-400 font-bold border border-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.05)]' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200 font-medium'}`}>
      {active && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-orange-500 rounded-r-md shadow-[0_0_10px_rgba(249,115,22,0.8)]" />}
      {React.cloneElement(icon, { className: `w-5 h-5 ${active ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]' : 'text-zinc-500'}` })}
      <span className="ml-3 text-sm">{label}</span>
    </button>
  );
}

function MobileTab({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${active ? 'text-orange-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {React.cloneElement(icon, { className: `w-[22px] h-[22px] ${active ? 'drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]' : ''}` })}
      <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
    </button>
  );
}

function MobileMenuGridBtn({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${active ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:bg-zinc-800'}`}>
      {React.cloneElement(icon, { className: `w-7 h-7 ${active ? 'text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]' : 'text-zinc-500'}` })}
      <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
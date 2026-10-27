import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Calendar as CalendarIcon, BarChart2, Settings, LineChart,
  User, Loader2, Monitor, LogOut, Link as LinkIcon,
  MoreHorizontal, X, Database, TrendingUp, ClipboardList, PanelLeftClose, PanelLeftOpen,
  LogIn, HelpCircle
} from 'lucide-react';

import CalendarTab from './components/CalendarTab';
import TrainerTab from './components/TrainerTab';
import FitnessTab from './components/FitnessTab';
import ProfileTab from './components/ProfileTab';
import ConnectionsTab from './components/ConnectionsTab';
import LibraryTab from './components/LibraryTab';
import AuthPage from './components/AuthPage';
import AuthModal from './components/AuthModal';
import OnboardingModal from './components/OnboardingModal';
import { supabase } from './services/supabaseClient';

import { useLocalStorage } from './hooks/useLocalStorage';
import { useProfileSync } from './hooks/useProfileSync';
import { useIntervalsData } from './hooks/useIntervalsData';
// Force Vite HMR to pick up the new logo
import { version as pkgVersion } from '../package.json';
import appLogo from './assets/logo.png';

const APP_VERSION = `v${pkgVersion}`;

const DEFAULT_GUEST_PROFILE = {
  username: 'Gost Vozač', weight: 75.9, ftp: 200, thresholdHr: 160, maxHr: 180,
  birthYear: 1985, height: 180, experience: '3-5', riderType: 'all-rounder',
  hoursPerWeek: 8, primaryGoal: '', goalDate: '', weakness: ''
};

// 1. Centralizirana konfiguracija tabova za lakše održavanje
const TABS = {
  calendar: { label: 'Kalendar', icon: <CalendarIcon />, component: CalendarTab },
  library: { label: 'Knjižnica', icon: <Database />, component: LibraryTab },
  trainer: { label: 'Trenažer', icon: <Monitor />, component: TrainerTab },
  fitness: { label: 'Kondicija', icon: <Activity />, component: FitnessTab },
  profile: { label: 'Profil', icon: <User />, component: ProfileTab },
  connections: { label: 'Veze', icon: <LinkIcon />, component: ConnectionsTab }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('sidebarCollapsed', false);
  const [session, setSession] = useState(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isGuest, setIsGuest] = useLocalStorage('ergvibe_is_guest', false);
  const currentUserId = session?.user?.id || (isGuest ? 'guest' : null);

  const [intervalsId, setIntervalsId] = useLocalStorage(currentUserId ? `intervalsId_${currentUserId}` : 'intervalsId', '');
  const [intervalsKey, setIntervalsKey] = useLocalStorage(currentUserId ? `intervalsKey_${currentUserId}` : 'intervalsKey', '');

  const { workouts, wellnessData, intervalsConnected, athleteInfo, isLoading, error, fetchWorkouts, handlePair, handleUnpair, handleDeleteLocalActivity, handleDeleteCompletedActivity, handleRescheduleWorkout, handleUpdateWorkout, handleCreateWorkout } = useIntervalsData(intervalsId, intervalsKey, currentUserId);

  const [selectedWorkout, setSelectedWorkout] = useState(null);

  // Modali za autentifikaciju i onboarding vodič
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  const onboardingKey = currentUserId ? `ergvibe_onboarding_done_${currentUserId}` : 'ergvibe_onboarding_done_guest';
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useLocalStorage(onboardingKey, false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [athleteProfile, setAthleteProfile] = useProfileSync(DEFAULT_GUEST_PROFILE, currentUserId);

  const [currentDate, setCurrentDate] = useState(new Date());

  // Sinkronizacija imena i parametara s Intervals.icu profila kad je povezan
  useEffect(() => {
    if (athleteInfo && intervalsConnected) {
      // Prioritet dajemo samo imenu (firstname) kako ne bi sjeklo prezime u uskom bočnom izborniku
      const athleteFirstName = athleteInfo.firstname || (athleteInfo.name ? athleteInfo.name.trim().split(' ')[0] : '');
      setAthleteProfile(prev => {
        const isGenericName = !prev?.username || ['Gost Vozač', 'Gost', 'Korisnik', 'Odvažni Vozač'].includes(prev.username);
        // Ako je ime generičko ili ako je ranije bilo pohranjeno puno ime s prezimenom iz Intervals.icu
        const hasFullLastName = prev?.username && athleteInfo.name && prev.username.trim() === athleteInfo.name.trim();
        const nextUsername = (isGenericName || hasFullLastName) && athleteFirstName ? athleteFirstName : (prev?.username || athleteFirstName || 'Vozač');
        const nextFtp = Number(athleteInfo.icu_ftp || athleteInfo.ftp) || prev?.ftp || 200;
        const nextWeight = Number(athleteInfo.weight || athleteInfo.icu_weight) || prev?.weight || 75;
        const nextMaxHr = Number(athleteInfo.icu_max_hr || athleteInfo.max_hr) || prev?.maxHr || 180;
        const nextThresholdHr = Number(athleteInfo.icu_threshold_hr || athleteInfo.lthr) || prev?.thresholdHr || 160;

        if (
          prev?.username === nextUsername &&
          prev?.ftp === nextFtp &&
          prev?.weight === nextWeight &&
          prev?.maxHr === nextMaxHr &&
          prev?.thresholdHr === nextThresholdHr
        ) {
          return prev;
        }

        return {
          ...prev,
          username: nextUsername,
          ftp: nextFtp,
          weight: nextWeight,
          maxHr: nextMaxHr,
          thresholdHr: nextThresholdHr
        };
      });
    }
  }, [athleteInfo, intervalsConnected, setAthleteProfile]);

  // Automatsko pokretanje onboarding vodiča za nove korisnike ili goste
  useEffect(() => {
    if (!isSessionLoading && (session || isGuest) && !hasCompletedOnboarding) {
      setShowOnboardingModal(true);
    }
  }, [isSessionLoading, session, isGuest, hasCompletedOnboarding]);

  // Listener za osvježavanje workouts nakon spremanja Supabase aktivnosti
  useEffect(() => {
    const handleSupabaseActivitySaved = () => {
      console.log('[App] Supabase aktivnost spremljena, osvježavam workouts...');
      fetchWorkouts();
    };

    window.addEventListener('supabase-activity-saved', handleSupabaseActivitySaved);
    return () => window.removeEventListener('supabase-activity-saved', handleSupabaseActivitySaved);
  }, [fetchWorkouts]);

  // 2. Optimizacija statusa veze s opcionalnim Intervals.icu API-jem
  const connectionStatus = useMemo(() => {
    if (!intervalsId || !intervalsKey) return 'idle';
    if (isLoading) return 'connecting';
    if (error) return 'error';
    return intervalsConnected ? 'connected' : 'idle';
  }, [isLoading, error, intervalsId, intervalsKey, intervalsConnected]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    try {
      if (session) {
        await supabase.auth.signOut().catch(() => {});
      }
    } catch (e) {
      console.warn('Signout warning:', e);
    }

    setSession(null);
    setIsGuest(false);

    // Potpuno čišćenje lokalnih podataka gosta i Intervals veze pri odjavi
    setIntervalsId('');
    setIntervalsKey('');
    try {
      localStorage.removeItem('ai_trener_profile_guest');
      localStorage.removeItem('ai_trener_profile');
      localStorage.removeItem('intervalsId_guest');
      localStorage.removeItem('intervalsKey_guest');
      localStorage.removeItem('intervalsId');
      localStorage.removeItem('intervalsKey');
      localStorage.removeItem('ergvibe_onboarding_done_guest');
      localStorage.removeItem('ergvibe_is_guest');
    } catch (e) {}

    setAthleteProfile(DEFAULT_GUEST_PROFILE);
  };

  const handleIntervalsDisconnect = () => {
    setIntervalsId('');
    setIntervalsKey('');
    try {
      localStorage.removeItem('intervalsId_guest');
      localStorage.removeItem('intervalsKey_guest');
      localStorage.removeItem('intervalsId');
      localStorage.removeItem('intervalsKey');
      localStorage.removeItem('ai_trener_profile_guest');
    } catch (e) {}

    if (currentUserId === 'guest') {
      setAthleteProfile(DEFAULT_GUEST_PROFILE);
    }
  };

  const handleOnboardingComplete = () => {
    setHasCompletedOnboarding(true);
    setShowOnboardingModal(false);
  };

  // Provjera je li vozač sa zadanim imenom (Gost) ili stvarnim imenom
  const isDefaultGuestName = !athleteProfile?.username || ['Gost Vozač', 'Gost', 'Korisnik', 'Odvažni Vozač'].includes(athleteProfile.username);
  const displayName = isDefaultGuestName ? 'Gost Vozač' : athleteProfile.username.trim().split(' ')[0];

  if (isSessionLoading) {
    return <div className="h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /></div>;
  }

  if (!session && !isGuest) {
    return <AuthPage onGuestLogin={() => setIsGuest(true)} />;
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-cyan-500/30">

      {/* SIDEBAR (Desktop) */}
      <div className={`hidden md:flex bg-zinc-900/80 backdrop-blur-xl border-r border-zinc-800/80 flex-col shadow-2xl z-10 shrink-0 transition-all duration-300 ease-in-out relative ${isSidebarCollapsed ? 'w-[72px]' : 'w-56'}`}>
        <div className={`h-16 md:h-20 flex items-center border-b border-zinc-800/80 ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-4'}`}>
          {!isSidebarCollapsed ? (
            <>
              <img src={appLogo} alt="ErgVibe Logo" className="w-14 h-14 rounded-2xl shadow-[0_0_15px_rgba(34,211,238,0.3)] object-cover shrink-0" />
              <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
                <span className="font-black text-2xl tracking-tight text-white drop-shadow-[0_0_8px_rgba(34,211,238,0.4)] whitespace-nowrap">ErgVibe</span>
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest leading-none mt-[-1px]">{APP_VERSION}</span>
              </div>
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                title="Sažmi izbornik"
              >
                <PanelLeftClose className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center w-full h-full"
              title="Proširi izbornik"
            >
              <PanelLeftOpen className="w-6 h-6" />
            </button>
          )}
        </div>

        <nav className="mt-6 flex-1 px-3 space-y-2 overflow-y-auto hide-scrollbar">
          {['calendar', 'library', 'trainer', 'fitness', 'profile'].map(tabId => (
            <NavItem
              key={tabId}
              icon={TABS[tabId].icon}
              label={TABS[tabId].label.split(' ')[0]} // Kraći labeli za sidebar
              active={activeTab === tabId}
              onClick={() => handleTabChange(tabId)}
              collapsed={isSidebarCollapsed}
            />
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-800/80 mt-auto flex flex-col gap-2">

          {/* User Profile Banner */}
          {!isSidebarCollapsed ? (
            <div className="flex items-center gap-3 px-4 py-2 mb-1 bg-zinc-800/40 rounded-xl border border-zinc-700/40">
              <div className="bg-gradient-to-br from-cyan-400 to-emerald-500 text-zinc-950 rounded-full w-9 h-9 flex items-center justify-center font-bold shadow-[0_0_10px_rgba(34,211,238,0.3)] shrink-0">
                {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
              </div>
              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-sm font-bold text-zinc-100 truncate" title={athleteProfile.username || 'Korisnik'}>{displayName}</span>
                  {currentUserId === 'guest' ? (
                    intervalsConnected ? (
                      <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800 shrink-0">ICU</span>
                    ) : (
                      !isDefaultGuestName ? (
                        <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-700/80 text-zinc-300 shrink-0">Gost</span>
                      ) : null
                    )
                  ) : (
                    intervalsConnected ? (
                      <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800 shrink-0">+ ICU</span>
                    ) : null
                  )}
                </div>
                <span className="text-[10px] text-zinc-500 truncate">FTP: <span className="font-bold text-cyan-400">{athleteProfile.ftp}W</span> | {athleteProfile.weight}kg</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-center mb-1">
              <div className="bg-gradient-to-br from-cyan-400 to-emerald-500 text-zinc-950 rounded-full w-9 h-9 flex items-center justify-center font-bold shadow-[0_0_10px_rgba(34,211,238,0.3)] shrink-0 cursor-pointer" title={athleteProfile.username} onClick={() => handleTabChange('profile')}>
                {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
              </div>
            </div>
          )}

          {/* Gost gumb za prijavu / sinkronizaciju */}
          {currentUserId === 'guest' && (
            <button
              onClick={() => setShowAuthModal(true)}
              title="Prijava ili Registracija mailom"
              className={`w-full flex items-center justify-center md:justify-start px-0 md:px-4 py-3 rounded-xl transition-all text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 shadow-[0_0_12px_rgba(34,211,238,0.15)]`}
            >
              <LogIn className="w-5 h-5 shrink-0" />
              {!isSidebarCollapsed && <span className="ml-3 text-sm font-bold">Prijava / Račun</span>}
            </button>
          )}

          <button
            onClick={() => handleTabChange('connections')}
            title="API Veze"
            className={`w-full flex items-center justify-center md:justify-start px-0 md:px-4 py-3 rounded-xl transition-all ${activeTab === 'connections' ? 'bg-cyan-500/10 text-cyan-400 font-semibold border border-cyan-500/20 shadow-[0_0_10px_rgba(34,211,238,0.1)]' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
          >
            <LinkIcon className={`w-5 h-5 ${activeTab === 'connections' ? 'text-cyan-400' : 'text-zinc-500'}`} />
            {!isSidebarCollapsed && <span className="ml-3 text-sm font-medium">API Veze</span>}
          </button>

          <button
            onClick={handleLogout}
            title={currentUserId === 'guest' ? 'Izađi' : 'Odjava'}
            className="w-full flex items-center justify-center md:justify-start px-0 md:px-4 py-3 rounded-xl transition-all text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="w-5 h-5" />
            {!isSidebarCollapsed && <span className="ml-3 text-sm font-medium">{currentUserId === 'guest' ? 'Izađi' : 'Odjava'}</span>}
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 md:h-20 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 flex items-center justify-between px-4 md:px-8 shrink-0 z-20">
          <div className="flex items-center gap-3 md:gap-4">
            <h1 className="text-lg md:text-xl font-bold text-zinc-100 truncate tracking-tight">
              {TABS[activeTab]?.label || 'Dashboard'}
            </h1>
            {isLoading && <Loader2 className="w-4 h-4 md:w-5 md:h-5 text-cyan-400 animate-spin shrink-0 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />}
            {intervalsId && intervalsKey && error && <span className="text-[10px] md:text-xs font-bold bg-red-500/10 text-red-400 px-2 md:px-3 py-1 rounded-full border border-red-500/20 truncate max-w-[140px] md:max-w-xs" title={error}>Intervals: {error}</span>}
          </div>
          {(activeTab === 'calendar' || activeTab === 'fitness') && (
            <button onClick={fetchWorkouts} className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-xs font-bold transition-all border border-zinc-700 hover:shadow-lg">
              Osvježi
            </button>
          )}
        </header>

        <main className={`flex-1 ${['trainer', 'calendar'].includes(activeTab) ? 'overflow-hidden p-1 md:p-2 pb-20 md:pb-2' : 'overflow-auto p-3 md:p-8 pb-20 md:pb-8'} bg-zinc-950 relative flex flex-col`}>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-900/10 via-zinc-950 to-zinc-950 pointer-events-none"></div>

          <div className={`relative z-10 w-full ${['trainer', 'calendar'].includes(activeTab) ? 'flex-1 flex flex-col min-h-0 h-full' : ''}`}>
            {activeTab === 'calendar' && (
              <CalendarTab
                currentDate={currentDate} setCurrentDate={setCurrentDate}
                workouts={workouts} wellnessData={wellnessData}
                handleUnpair={handleUnpair} handlePair={handlePair}
                handleDeleteLocalActivity={handleDeleteLocalActivity}
                handleDeleteCompletedActivity={handleDeleteCompletedActivity}
                handleRescheduleWorkout={handleRescheduleWorkout}
                handleUpdateWorkout={handleUpdateWorkout}
                handleCreateWorkout={handleCreateWorkout}
                onSelectWorkout={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
                profile={athleteProfile}
                intervalsId={intervalsId}
                intervalsKey={intervalsKey}
                userId={currentUserId}
              />
            )}

            {/* Persistence-critical tab */}
            <div className={activeTab === 'trainer' ? 'flex-1 flex flex-col min-h-0 w-full overflow-y-auto pb-1 md:pb-2 hide-scrollbar' : 'hidden'}>
              <TrainerTab
                profile={athleteProfile}
                userId={currentUserId}
                workoutFromCalendar={selectedWorkout}
                intervalsId={intervalsId}
                intervalsKey={intervalsKey}
                onClose={() => { setSelectedWorkout(null); handleTabChange('calendar'); }}
              />
            </div>

            {activeTab === 'fitness' && <FitnessTab wellnessData={wellnessData} />}

            {activeTab === 'library' && (
              <LibraryTab
                ftp={athleteProfile.ftp}
                onSelectWorkout={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
                userId={currentUserId}
              />
            )}
            {activeTab === 'profile' && (
              <ProfileTab 
                profile={athleteProfile} 
                setProfile={setAthleteProfile} 
                workouts={workouts}
                userId={currentUserId}
                userEmail={session?.user?.email}
                intervalsId={intervalsId}
                intervalsKey={intervalsKey}
                intervalsConnected={intervalsConnected}
                athleteInfo={athleteInfo}
                onOpenAuthModal={() => setShowAuthModal(true)}
                onOpenOnboarding={() => setShowOnboardingModal(true)}
              />
            )}
            {activeTab === 'connections' && (
              <ConnectionsTab 
                connectionStatus={connectionStatus} 
                connectionError={error} 
                intervalsId={intervalsId} 
                setId={setIntervalsId} 
                intervalsKey={intervalsKey} 
                setKey={setIntervalsKey} 
                onSave={fetchWorkouts} 
                onDisconnect={handleIntervalsDisconnect} 
                userId={currentUserId} 
              />
            )}
          </div>
        </main>

        {/* MOBILE NAVIGATION */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/80 z-40 px-2 pt-1 pb-safe-bottom">
          <div className="flex justify-around items-center h-14">
            <MobileTab icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => handleTabChange('calendar')} />
            <MobileTab icon={<Monitor />} label="Trenažer" active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
            <MobileTab icon={<ClipboardList />} label="Kondicija" active={activeTab === 'fitness'} onClick={() => handleTabChange('fitness')} />
            <MobileTab icon={<MoreHorizontal />} label="Više" active={['library', 'profile', 'connections'].includes(activeTab) || isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
          </div>
        </div>

        {/* MOBILE MENU OVERLAY (Simplified grid render) */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 shadow-2xl animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-gradient-to-br from-cyan-400 to-emerald-500 text-zinc-950 rounded-full w-10 h-10 flex items-center justify-center font-bold shadow-[0_0_10px_rgba(34,211,238,0.3)]">
                    {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-zinc-100 tracking-tight">Bok, {displayName}</h3>
                    {intervalsConnected ? (
                      <span className="text-[10px] font-bold text-cyan-400">Intervals.icu povezan</span>
                    ) : (
                      currentUserId === 'guest' && <span className="text-[10px] font-bold text-zinc-400">Način rada: Gost</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400"><X className="w-5 h-5" /></button>
              </div>

              {currentUserId === 'guest' && (
                <div className="mb-5">
                  <button
                    onClick={() => { setIsMobileMenuOpen(false); setShowAuthModal(true); }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold text-sm shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                  >
                    <LogIn className="w-4 h-4" /> Prijavi se / Registriraj mailom
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-6">
                {['library', 'profile', 'connections'].map(tabId => (
                  <MobileMenuGridBtn key={tabId} icon={TABS[tabId].icon} label={TABS[tabId].label} active={activeTab === tabId} onClick={() => handleTabChange(tabId)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AUTH MODAL ZA PRIJAVU/REGISTRACIJU MAILOM */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        currentUserId={currentUserId}
        onAuthSuccess={(newSession) => {
          if (newSession) setSession(newSession);
          setIsGuest(false);
          setShowAuthModal(false);
        }}
      />

      {/* ONBOARDING MODAL VODIČ ZA POČETNIKE */}
      <OnboardingModal
        isOpen={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
        initialProfile={athleteProfile}
        onSaveProfile={(updatedProfile) => {
          setAthleteProfile(updatedProfile);
        }}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
}

// 3. Sub-komponente s React.memo bi bile idealne ovdje ako postanu kompleksnije
function NavItem({ icon, label, active, onClick, collapsed }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center justify-center md:justify-start px-0 md:px-4 py-3 rounded-xl transition-all relative ${active ? 'bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-400 font-bold border border-cyan-500/20' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}`}
    >
      {active && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-cyan-400 rounded-r-md shadow-[0_0_10px_rgba(34,211,238,0.6)]" />}
      {React.cloneElement(icon, { className: `w-5 h-5 ${active ? 'text-cyan-400' : 'text-zinc-500'}` })}
      {!collapsed && <span className="ml-3 text-sm">{label}</span>}
    </button>
  );
}

function MobileTab({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${active ? 'text-cyan-400' : 'text-zinc-500'}`}>
      {React.cloneElement(icon, { className: 'w-[22px] h-[22px]' })}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function MobileMenuGridBtn({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${active ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300'}`}>
      {React.cloneElement(icon, { className: 'w-7 h-7' })}
      <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

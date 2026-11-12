import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Calendar as CalendarIcon,
  User, Loader2, Monitor, LogOut, Link as LinkIcon,
  MoreHorizontal, X, Database, ClipboardList, PanelLeftClose, PanelLeftOpen,
  LogIn, Sparkles, RefreshCw, CheckCircle2, AlertCircle
} from 'lucide-react';

import CalendarTab from './components/CalendarTab';
import TrainerTab from './components/TrainerTab';
import FitnessTab from './components/FitnessTab';
import ProfileTab from './components/ProfileTab';
import ConnectionsTab from './components/ConnectionsTab';
import LibraryTab from './components/LibraryTab';
import AICoachTab from './components/AICoachTab';
import AuthPage from './components/AuthPage';
import AuthModal from './components/AuthModal';
import OnboardingModal from './components/OnboardingModal';
import BrandLogo from './components/BrandLogo';
import { supabase } from './services/supabaseClient';

import { useLocalStorage } from './hooks/useLocalStorage';
import { useProfileSync } from './hooks/useProfileSync';
import { useIntervalsData } from './hooks/useIntervalsData';
import { handleIntervalsOAuthCallback } from './services/intervalsOAuth';
import { extractIntervalsAthleteMetrics } from './services/intervalsApi';

const DEFAULT_GUEST_PROFILE = {
  username: 'Gost Vozač', weight: 75.9, ftp: 200, thresholdHr: 160, maxHr: 180,
  birthYear: 1985, height: 180, experience: '3-5', riderType: 'all-rounder',
  hoursPerWeek: 8, primaryGoal: '', goalDate: '', weakness: '',
  isManualFtp: false, isManualWeight: false, isManualHr: false
};

// 1. Centralizirana konfiguracija tabova za lakše održavanje
const TABS = {
  calendar: { label: 'Kalendar Treninga', shortLabel: 'Kalendar', code: 'CAL', icon: <CalendarIcon />, component: CalendarTab },
  library: { label: 'Knjižnica Treninga', shortLabel: 'Knjižnica', code: 'LIB', icon: <Database />, component: LibraryTab },
  trainer: { label: 'Trenažer · Cockpit', shortLabel: 'Trenažer', code: 'ERG', icon: <Monitor />, component: TrainerTab },
  aiCoach: { label: 'AI Fiziolog & Planer', shortLabel: 'AI Trener', code: 'LAB', icon: <Sparkles />, component: AICoachTab },
  fitness: { label: 'Kondicija & Forma (PMC)', shortLabel: 'Kondicija', code: 'PMC', icon: <Activity />, component: FitnessTab },
  profile: { label: 'Profil & Zone Vozača', shortLabel: 'Profil', code: 'ATH', icon: <User />, component: ProfileTab },
  connections: { label: 'Senzori & API Veze', shortLabel: 'API Veze', code: 'SYS', icon: <LinkIcon />, component: ConnectionsTab }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('sidebarCollapsed', false);
  const [uiTheme, setUiTheme] = useLocalStorage('ergvibe_ui_theme', 'volt');
  const [isTrainerPlaying, setIsTrainerPlaying] = useState(false);
  const [isTrainerFullscreen, setIsTrainerFullscreen] = useState(false);

  const [session, setSession] = useState(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isGuest, setIsGuest] = useLocalStorage('ergvibe_is_guest', false);
  const currentUserId = session?.user?.id || (isGuest ? 'guest' : null);

  const [intervalsId, setIntervalsId] = useLocalStorage(currentUserId ? `intervalsId_${currentUserId}` : 'intervalsId', '');
  const [intervalsKey, setIntervalsKey] = useLocalStorage(currentUserId ? `intervalsKey_${currentUserId}` : 'intervalsKey', '');

  const [athleteProfile, setAthleteProfile] = useProfileSync(DEFAULT_GUEST_PROFILE, currentUserId);

  const { workouts, wellnessData, intervalsConnected, athleteInfo, isLoading, error, fetchWorkouts, handlePair, handleUnpair, handleDeleteLocalActivity, handleDeleteCompletedActivity, handleRescheduleWorkout, handleUpdateWorkout, handleCreateWorkout } = useIntervalsData(intervalsId, intervalsKey, currentUserId, { ftp: athleteProfile?.ftp });

  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);
  const [isOAuthProcessing, setIsOAuthProcessing] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(new URLSearchParams(window.location.search).get('code'));
  });

  // Detekcija i obrada povratka iz Supabase email potvrde (URL hash/params)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const full = hash + '&' + search;

    // 1. Ako je došlo do greške pri potvrdi emaila (npr. istekla poveznica)
    const errMatch = full.match(/(?:[#?&])error_description=([^&]+)/);
    if (errMatch) {
      const decoded = decodeURIComponent(errMatch[1].replace(/\+/g, ' '));
      setAuthNotice({
        type: 'error',
        text: decoded.toLowerCase().includes('expired') || decoded.toLowerCase().includes('invalid')
          ? 'Poveznica za potvrdu emaila je istekla ili je već iskorištena. Prijavite se sa svojom lozinkom.'
          : `Autentifikacija: ${decoded}`
      });
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    // 2. Ako je potvrda uspješna (type=signup ili email_change)
    if (hash.includes('type=signup') || hash.includes('type=email_change')) {
      setAuthNotice({
        type: 'success',
        text: 'Email adresa je uspješno potvrđena! Račun je aktivan i prijavljeni ste.'
      });
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => setAuthNotice(null), 8000);
    } else if (hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Obrada povratka iz Intervals.icu OAuth autorizacije
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code) {
      // Očisti URL odmah da token ne stoji u traci preglednika
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState(null, '', cleanUrl);

      setAuthNotice({
        type: 'info',
        text: 'Povezivanje s Intervals.icu u tijeku...'
      });

      handleIntervalsOAuthCallback(code, state)
        .then(async (result) => {
          const athleteId = result.athleteId || '0';
          const authKey = result.authKey;
          const athleteName = result.athleteName || '';

          setIntervalsId(athleteId);
          setIntervalsKey(authKey);

          // Provjeri postoji li već aktivna Supabase sesija
          const { data: sessionData } = await supabase.auth.getSession();
          const activeSession = sessionData?.session;

          if (activeSession?.user) {
            // Korisnik je već prijavljen u svoj račun (npr. spojio se iz Connections taba)
            try {
              await supabase.auth.updateUser({
                data: {
                  intervals_id: athleteId,
                  intervals_key: authKey,
                  intervals_athlete_name: athleteName
                }
              });
            } catch (metaErr) {
              console.warn('[Intervals OAuth] Greška pri spremanju u user_metadata:', metaErr);
            }
          } else {
            // Korisnik se prijavljuje s početnog ekrana (AuthPage ili Gost)
            // Automatski prijavljujemo ili registriramo namjenski račun povezan s Intervals ID-jem
            const cleanAthleteId = String(athleteId).toLowerCase().replace(/[^a-z0-9]/g, '');
            const intervalsEmail = `intervals_${cleanAthleteId}@auth.ergvibe.app`;
            const intervalsPassword = `ErgVibe!${cleanAthleteId}#Auth2026`;

            let authRes = await supabase.auth.signInWithPassword({
              email: intervalsEmail,
              password: intervalsPassword
            });

            if (authRes.error) {
              // Ako račun ne postoji, kreiramo ga (signUp odmah vraća sesiju u našem Supabase projektu)
              authRes = await supabase.auth.signUp({
                email: intervalsEmail,
                password: intervalsPassword,
                options: {
                  data: {
                    intervals_id: athleteId,
                    intervals_key: authKey,
                    intervals_athlete_name: athleteName,
                    username: athleteName || 'Vozač'
                  }
                }
              });
            } else if (authRes.data?.session) {
              // Ažuriraj token ako je račun već postojao
              await supabase.auth.updateUser({
                data: {
                  intervals_id: athleteId,
                  intervals_key: authKey,
                  intervals_athlete_name: athleteName
                }
              }).catch(() => {});
            }

            if (authRes.data?.session) {
              const newSession = authRes.data.session;
              setSession(newSession);
              setIsGuest(false);

              // Pohrani i u per-user localStorage ključeve za trenutnu dostupnost
              try {
                localStorage.setItem(`intervalsId_${newSession.user.id}`, athleteId);
                localStorage.setItem(`intervalsKey_${newSession.user.id}`, authKey);
              } catch (e) {}

              // Migriraj podatke gosta ako su postojali na ovom uređaju
              try {
                const guestProfile = JSON.parse(localStorage.getItem('ai_trener_profile_guest') || '{}');
                if (guestProfile && Object.keys(guestProfile).length > 0) {
                  await supabase.from('profiles').upsert({
                    user_id: newSession.user.id,
                    ...guestProfile,
                    username: athleteName || guestProfile.username || 'Vozač'
                  });
                }
                const guestActivities = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities_guest') || '[]');
                if (guestActivities.length > 0) {
                  const recordsToInsert = guestActivities.map(act => {
                    const { id, ...rest } = act;
                    return { ...rest, user_id: newSession.user.id };
                  });
                  await supabase.from('completed_activities').insert(recordsToInsert);
                }
              } catch (migErr) {
                console.warn('[Intervals OAuth] Migracija gost podataka:', migErr);
              }
            } else if (authRes.error) {
              throw authRes.error;
            }
          }

          setAuthNotice({
            type: 'success',
            text: `Uspješno prijavljeni putem Intervals.icu! ${athleteName ? `Dobrodošao, ${athleteName}.` : ''}`
          });
          setTimeout(() => setAuthNotice(null), 6000);
        })
        .catch((err) => {
          console.error('[Intervals OAuth] Greška pri obradi autorizacije:', err);
          setAuthNotice({
            type: 'error',
            text: `Greška pri prijavi s Intervals.icu: ${err.message}`
          });
        })
        .finally(() => {
          setIsOAuthProcessing(false);
        });
    }
  }, [setIntervalsId, setIntervalsKey]);

  // Modali za autentifikaciju i onboarding vodič
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  const onboardingKey = currentUserId ? `ergvibe_onboarding_done_${currentUserId}` : 'ergvibe_onboarding_done_guest';
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useLocalStorage(onboardingKey, false);

  // Primijeni odabranu temu akcenta na <html>
  useEffect(() => {
    const validThemes = ['volt', 'corsa', 'aero'];
    const active = validThemes.includes(uiTheme) ? uiTheme : 'volt';
    document.documentElement.setAttribute('data-theme', active);
  }, [uiTheme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut().catch(() => {});
        setSession(null);
      } else {
        setSession(session);
      }
      setIsSessionLoading(false);
    }).catch(() => {
      setIsSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
      } else if (newSession) {
        setSession(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const [currentDate, setCurrentDate] = useState(new Date());

  // Sinkronizacija imena i parametara s Intervals.icu profila kad je povezan
  useEffect(() => {
    if (athleteInfo && intervalsConnected) {
      const metrics = extractIntervalsAthleteMetrics(athleteInfo);
      const athleteFirstName = metrics?.firstName || athleteInfo.firstname || (athleteInfo.name ? athleteInfo.name.trim().split(' ')[0] : '');

      const icuFtp = metrics?.ftp || Number(athleteInfo.icu_ftp || athleteInfo.ftp) || null;
      const icuWeight = metrics?.weight || Number(athleteInfo.weight || athleteInfo.icu_weight) || null;
      const icuMaxHr = metrics?.maxHr || Number(athleteInfo.icu_max_hr || athleteInfo.max_hr) || null;
      const icuLthr = metrics?.thresholdHr || Number(athleteInfo.icu_threshold_hr || athleteInfo.lthr) || null;

      setAthleteProfile(prev => {
        const isGenericName = !prev?.username || ['Gost Vozač', 'Gost', 'Korisnik', 'Odvažni Vozač'].includes(prev.username);
        const hasFullLastName = prev?.username && athleteInfo.name && prev.username.trim() === athleteInfo.name.trim();
        const nextUsername = (isGenericName || hasFullLastName) && athleteFirstName ? athleteFirstName : (prev?.username || athleteFirstName || 'Vozač');

        // Ako korisnik NIJE ručno zaključao FTP (isManualFtp: false) ili ako je FTP na zadanih 200W, preuzmi stvarni FTP s Intervals.icu
        const shouldUpdateFtp = !prev?.isManualFtp || prev?.ftp === 200;
        const nextFtp = (shouldUpdateFtp && icuFtp) ? icuFtp : (prev?.ftp || icuFtp || 200);

        const shouldUpdateWeight = !prev?.isManualWeight || prev?.weight === 75 || prev?.weight === 75.9;
        const nextWeight = (shouldUpdateWeight && icuWeight) ? icuWeight : (prev?.weight || icuWeight || 75.9);

        const shouldUpdateHr = !prev?.isManualHr || prev?.maxHr === 180;
        const nextMaxHr = (shouldUpdateHr && icuMaxHr) ? icuMaxHr : (prev?.maxHr || icuMaxHr || 180);
        const nextThresholdHr = (shouldUpdateHr && icuLthr) ? icuLthr : (prev?.thresholdHr || icuLthr || 160);

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

  // Sinkronizacija Intervals podataka iz Supabase user_metadata kad se korisnik prijavi
  useEffect(() => {
    if (session?.user?.user_metadata && currentUserId && currentUserId !== 'guest') {
      const meta = session.user.user_metadata;
      if (meta.intervals_key && (!intervalsKey || intervalsKey !== meta.intervals_key)) {
        setIntervalsKey(meta.intervals_key);
        if (meta.intervals_id && meta.intervals_id !== intervalsId) {
          setIntervalsId(meta.intervals_id);
        }
      }
    }
  }, [session, currentUserId, intervalsKey, intervalsId, setIntervalsKey, setIntervalsId]);

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
    if (tab !== 'trainer') {
      setIsTrainerFullscreen(false);
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
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

  const handleIntervalsDisconnect = async () => {
    setIntervalsId('');
    setIntervalsKey('');
    try {
      localStorage.removeItem('intervalsId_guest');
      localStorage.removeItem('intervalsKey_guest');
      localStorage.removeItem('intervalsId');
      localStorage.removeItem('intervalsKey');
      if (currentUserId) {
        localStorage.removeItem(`intervalsId_${currentUserId}`);
        localStorage.removeItem(`intervalsKey_${currentUserId}`);
      }
      localStorage.removeItem('ai_trener_profile_guest');
    } catch (e) {}

    if (currentUserId && currentUserId !== 'guest') {
      try {
        await supabase.auth.updateUser({
          data: {
            intervals_id: '',
            intervals_key: '',
            intervals_athlete_name: ''
          }
        });
      } catch (e) {
        console.warn('[Intervals] Greška pri čišćenju user_metadata:', e);
      }
    }

    if (currentUserId === 'guest') {
      setAthleteProfile(DEFAULT_GUEST_PROFILE);
    }
  };

  const handleSetIntervalsId = (newId) => {
    setIntervalsId(newId);
    if (currentUserId && currentUserId !== 'guest') {
      supabase.auth.updateUser({ data: { intervals_id: newId } }).catch(() => {});
    }
  };

  const handleSetIntervalsKey = (newKey) => {
    setIntervalsKey(newKey);
    if (currentUserId && currentUserId !== 'guest') {
      supabase.auth.updateUser({ data: { intervals_key: newKey } }).catch(() => {});
    }
  };

  const handleOnboardingComplete = () => {
    setHasCompletedOnboarding(true);
    setShowOnboardingModal(false);
  };

  const isDefaultGuestName = !athleteProfile?.username || ['Gost Vozač', 'Gost', 'Korisnik', 'Odvažni Vozač'].includes(athleteProfile.username);
  const displayName = isDefaultGuestName ? 'Gost Vozač' : athleteProfile.username.trim().split(' ')[0];
  const athleteWkg = ((Number(athleteProfile?.ftp) || 200) / (Number(athleteProfile?.weight) || 75)).toFixed(2);

  if (isSessionLoading || isOAuthProcessing) {
    return (
      <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center gap-3">
        <BrandLogo size={52} spinning />
        <span className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          {isOAuthProcessing ? 'Povezivanje i prijava putem Intervals.icu...' : 'Inicijalizacija sustava...'}
        </span>
      </div>
    );
  }

  if (!session && !isGuest) {
    return (
      <AuthPage
        onGuestLogin={() => setIsGuest(true)}
        authNotice={authNotice}
        onClearNotice={() => setAuthNotice(null)}
      />
    );
  }

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-zinc-950 text-zinc-200 font-sans selection:bg-volt-400 selection:text-zinc-950">

      {/* SIDEBAR (Desktop Hardware Rail) */}
      <aside className={`${activeTab === 'trainer' && isTrainerFullscreen ? 'hidden' : 'hidden md:flex'} bg-zinc-900 border-r border-zinc-800 flex-col z-20 shrink-0 transition-all duration-300 ease-in-out relative ${isSidebarCollapsed ? 'w-[68px]' : 'w-52 lg:w-56 xl:w-60'}`}>
        {/* Brand Header */}
        <div className={`h-14 md:h-16 short:h-12 flex items-center border-b border-zinc-800 bg-zinc-950/40 shrink-0 ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'}`}>
          {!isSidebarCollapsed ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandLogo size={34} spinning={isTrainerPlaying} />
                <div className="flex flex-col leading-none">
                  <div className="font-display font-bold text-lg xl:text-xl tracking-wider uppercase text-zinc-100 whitespace-nowrap">
                    ERG<span className="text-volt-400">VIBE</span>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500 mt-1 short:hidden whitespace-nowrap">
                    TRAINING SUITE
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0"
                title="Sažmi izbornik"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="group flex flex-col items-center justify-center w-full h-full gap-0.5 text-zinc-400 hover:text-zinc-100 transition-colors"
              title="Proširi izbornik"
            >
              <BrandLogo size={32} spinning={isTrainerPlaying} className="group-hover:scale-105 transition-transform" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="mt-3 short:mt-1.5 flex-1 px-2 space-y-1 short:space-y-0.5 overflow-y-auto hide-scrollbar">
          {!isSidebarCollapsed && (
            <div className="px-2.5 pb-1 text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-600 short:hidden">
              Telemetrija &amp; Plan
            </div>
          )}
          {['calendar', 'library', 'trainer', 'aiCoach', 'fitness', 'profile'].map(tabId => (
            <NavItem
              key={tabId}
              icon={TABS[tabId].icon}
              label={TABS[tabId].shortLabel}
              code={TABS[tabId].code}
              active={activeTab === tabId}
              liveBadge={tabId === 'trainer' && isTrainerPlaying}
              onClick={() => handleTabChange(tabId)}
              collapsed={isSidebarCollapsed}
            />
          ))}

          {isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="w-full flex items-center justify-center py-2 short:py-1.5 mt-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              title="Proširi bočnu traku"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
        </nav>

        {/* Athlete Telemetry Pod & System Controls */}
        <div className="p-2.5 short:p-2 border-t border-zinc-800 mt-auto flex flex-col gap-1.5 short:gap-1 bg-zinc-950/30 shrink-0">
          {!isSidebarCollapsed ? (
            <div
              onClick={() => handleTabChange('profile')}
              className="flex items-center gap-2.5 px-2.5 py-2 short:py-1.5 mb-0.5 bg-zinc-950/80 hover:bg-zinc-850 rounded-lg border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors"
            >
              <div className="bg-volt-400 text-zinc-950 rounded-md w-7 h-7 flex items-center justify-center font-display font-bold text-xs shrink-0">
                {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-bold text-zinc-100 truncate" title={athleteProfile.username || 'Korisnik'}>
                    {displayName}
                  </span>
                  {intervalsConnected ? (
                    <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/30 shrink-0">
                      ICU
                    </span>
                  ) : currentUserId === 'guest' && !isDefaultGuestName ? (
                    <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
                      GOST
                    </span>
                  ) : null}
                </div>
                <div className="font-mono text-[10px] text-zinc-500 telemetry-num truncate">
                  <span className="text-volt-400 font-bold">{athleteProfile.ftp}W</span> · {athleteWkg} W/kg
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center mb-0.5">
              <button
                onClick={() => handleTabChange('profile')}
                title={`${athleteProfile.username} · ${athleteProfile.ftp}W`}
                className="bg-volt-400 text-zinc-950 rounded-md w-8 h-8 flex items-center justify-center font-display font-bold text-xs shrink-0 hover:bg-volt-300 transition-colors"
              >
                {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
              </button>
            </div>
          )}

          {currentUserId === 'guest' && (
            <button
              onClick={() => setShowAuthModal(true)}
              title="Prijava ili Registracija mailom"
              className="w-full flex items-center justify-center md:justify-start px-0 md:px-3 py-2 short:py-1.5 rounded-lg transition-all text-volt-400 bg-volt-400/10 hover:bg-volt-400/15 border border-volt-400/30"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && <span className="ml-2.5 text-xs font-bold uppercase tracking-wider font-display">Prijava / Oblak</span>}
            </button>
          )}

          <button
            onClick={() => handleTabChange('connections')}
            title="API Veze & Integracije"
            className={`w-full flex items-center justify-center md:justify-start px-0 md:px-3 py-2 short:py-1.5 rounded-lg transition-all ${
              activeTab === 'connections'
                ? 'bg-volt-400/10 text-volt-400 font-semibold border border-volt-400/25'
                : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <LinkIcon className={`w-4 h-4 shrink-0 ${activeTab === 'connections' ? 'text-volt-400' : 'text-zinc-500'}`} />
            {!isSidebarCollapsed && (
              <span className="ml-2.5 text-xs font-medium flex-1 text-left flex items-center justify-between">
                <span>API Veze</span>
                <span className={`w-2 h-2 rounded-full ${intervalsConnected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              </span>
            )}
          </button>

          <button
            onClick={handleLogout}
            title={currentUserId === 'guest' ? 'Izađi' : 'Odjava'}
            className="w-full flex items-center justify-center md:justify-start px-0 md:px-3 py-1.5 short:py-1 rounded-lg transition-all text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="ml-2.5 text-xs font-medium">{currentUserId === 'guest' ? 'Izađi iz sesije' : 'Odjava'}</span>}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <header className={`h-12 md:h-14 short:h-11 bg-zinc-950/95 border-b border-zinc-800 flex items-center justify-between px-3.5 md:px-6 shrink-0 z-20 ${activeTab === 'trainer' ? (isTrainerFullscreen ? 'hidden' : 'md:short:hidden') : ''}`}>
          <div className="flex items-center gap-2.5 md:gap-3.5 min-w-0">
            <div className="md:hidden">
              <BrandLogo size={28} spinning={isTrainerPlaying} />
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="hidden sm:inline-flex font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-volt-400">
                {TABS[activeTab]?.code || 'ERG'}
              </span>
              <h1 className="font-display font-bold text-lg md:text-xl uppercase tracking-wider text-zinc-100 truncate">
                {TABS[activeTab]?.label || 'Dashboard'}
              </h1>
            </div>
            {isLoading && <Loader2 className="w-4 h-4 text-volt-400 animate-spin shrink-0" />}
            {intervalsId && intervalsKey && error && (
              <span className="font-mono text-[10px] md:text-xs font-semibold bg-rose-500/10 text-rose-400 px-2.5 py-0.5 rounded border border-rose-500/25 truncate max-w-[140px] md:max-w-xs" title={error}>
                ICU: {error}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Brzi telemetrijski čip na većim ekranima */}
            <div
              onClick={() => handleTabChange('profile')}
              title="Fiziološki parametri vozača (klikni za uređenje)"
              className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors font-mono text-xs telemetry-num"
            >
              <span className="text-zinc-500">FTP</span>
              <span className="font-bold text-volt-400">{athleteProfile.ftp}W</span>
              <span className="text-zinc-700">|</span>
              <span className="text-zinc-300 font-semibold">{athleteWkg} W/kg</span>
              {intervalsConnected && (
                <>
                  <span className="text-zinc-700">|</span>
                  <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> ICU
                  </span>
                </>
              )}
            </div>

            {(activeTab === 'calendar' || activeTab === 'fitness') && (
              <button
                onClick={fetchWorkouts}
                className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border border-zinc-800 hover:border-zinc-700 shadow-hardware"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-volt-400 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Sinkroniziraj</span>
              </button>
            )}
          </div>
        </header>

        {authNotice && (
          <div className={`px-4 py-2.5 text-xs font-semibold flex items-center justify-between border-b animate-in fade-in z-30 ${
            authNotice.type === 'error'
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
          }`}>
            <div className="flex items-center gap-2">
              {authNotice.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{authNotice.text}</span>
            </div>
            <button
              onClick={() => setAuthNotice(null)}
              className="p-1 hover:opacity-80 transition-opacity ml-3 text-zinc-400 hover:text-zinc-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className={`flex-1 min-h-0 ${['trainer', 'calendar'].includes(activeTab) ? `overflow-hidden p-1 md:p-2 short:p-1.5 ${activeTab === 'trainer' && isTrainerFullscreen ? 'pb-1.5' : 'pb-16 md:pb-2 short:md:pb-1.5'}` : 'overflow-auto p-3 md:p-6 short:p-3 pb-20 md:pb-6 short:md:pb-3'} bg-zinc-950 bg-telemetry-grid relative flex flex-col`}>
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
            <div className={activeTab === 'trainer' ? 'flex-1 flex flex-col min-h-0 h-full w-full overflow-y-auto hide-scrollbar' : 'hidden'}>
              <TrainerTab
                profile={athleteProfile}
                userId={currentUserId}
                workoutFromCalendar={selectedWorkout}
                intervalsId={intervalsId}
                intervalsKey={intervalsKey}
                workouts={workouts}
                wellnessData={wellnessData}
                onAddWorkoutToCalendar={handleCreateWorkout}
                onPlayingChange={setIsTrainerPlaying}
                onFullscreenChange={setIsTrainerFullscreen}
                onClose={() => { setSelectedWorkout(null); handleTabChange('calendar'); }}
              />
            </div>

            {activeTab === 'aiCoach' && (
              <AICoachTab
                profile={athleteProfile}
                workouts={workouts}
                wellnessData={wellnessData}
                userId={currentUserId}
                onAddWorkoutToCalendar={handleCreateWorkout}
                onStartWorkoutInTrainer={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
              />
            )}

            {activeTab === 'fitness' && <FitnessTab wellnessData={wellnessData} />}

            {activeTab === 'library' && (
              <LibraryTab
                ftp={athleteProfile.ftp}
                onSelectWorkout={(workout) => { setSelectedWorkout(workout); handleTabChange('trainer'); }}
                onScheduleWorkout={handleCreateWorkout}
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
                uiTheme={uiTheme}
                setUiTheme={setUiTheme}
                onOpenAuthModal={() => setShowAuthModal(true)}
                onOpenOnboarding={() => setShowOnboardingModal(true)}
                onNavigateToCalendar={() => handleTabChange('calendar')}
              />
            )}
            {activeTab === 'connections' && (
              <ConnectionsTab
                connectionStatus={connectionStatus}
                connectionError={error}
                intervalsId={intervalsId}
                setId={handleSetIntervalsId}
                intervalsKey={intervalsKey}
                setKey={handleSetIntervalsKey}
                onSave={fetchWorkouts}
                onDisconnect={handleIntervalsDisconnect}
                userId={currentUserId}
                athleteInfo={athleteInfo}
              />
            )}
          </div>
        </main>

        {/* MOBILE NAVIGATION */}
        <div className={`${activeTab === 'trainer' && isTrainerFullscreen ? 'hidden' : 'md:hidden'} fixed bottom-0 left-0 right-0 bg-zinc-950/95 border-t border-zinc-800 z-40 px-2 pb-safe-bottom`}>
          <div className="flex justify-around items-center h-14">
            <MobileTab icon={<CalendarIcon />} label="Kalendar" active={activeTab === 'calendar'} onClick={() => handleTabChange('calendar')} />
            <MobileTab icon={<Monitor />} label="Trenažer" live={isTrainerPlaying} active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
            <MobileTab icon={<Sparkles />} label="AI Trener" active={activeTab === 'aiCoach'} onClick={() => handleTabChange('aiCoach')} />
            <MobileTab icon={<ClipboardList />} label="Kondicija" active={activeTab === 'fitness'} onClick={() => handleTabChange('fitness')} />
            <MobileTab icon={<MoreHorizontal />} label="Više" active={['library', 'profile', 'connections'].includes(activeTab) || isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
          </div>
        </div>

        {/* MOBILE MENU OVERLAY */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/75 animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl p-5 shadow-2xl animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-5 pb-4 border-b border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="bg-volt-400 text-zinc-950 rounded-md w-10 h-10 flex items-center justify-center font-display font-bold text-lg">
                    {(isDefaultGuestName ? 'G' : displayName.charAt(0)).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-lg uppercase tracking-wide text-zinc-100">{displayName}</h3>
                    <div className="font-mono text-xs text-zinc-400 telemetry-num">
                      <span className="text-volt-400 font-bold">{athleteProfile.ftp}W</span> · {athleteWkg} W/kg
                      {intervalsConnected && <span className="text-emerald-400 ml-2">● ICU</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {currentUserId === 'guest' && (
                <div className="mb-4">
                  <button
                    onClick={() => { setIsMobileMenuOpen(false); setShowAuthModal(true); }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm transition-colors"
                  >
                    <LogIn className="w-4 h-4" /> Prijavi se / Sinkroniziraj Oblak
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2.5 mb-3">
                {['library', 'profile', 'connections'].map(tabId => (
                  <MobileMenuGridBtn key={tabId} icon={TABS[tabId].icon} label={TABS[tabId].shortLabel} active={activeTab === tabId} onClick={() => handleTabChange(tabId)} />
                ))}
              </div>

              <button
                onClick={() => { setIsMobileMenuOpen(false); handleLogout(); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-rose-400 text-xs font-semibold mt-1"
              >
                <LogOut className="w-4 h-4" /> {currentUserId === 'guest' ? 'Izađi iz sesije' : 'Odjavi se'}
              </button>
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

function NavItem({ icon, label, code, active, liveBadge, onClick, collapsed }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center justify-center md:justify-start px-0 md:px-2.5 py-2.5 short:py-1.5 rounded-lg transition-all relative group ${
        active
          ? 'bg-volt-400/10 text-volt-400 font-semibold border border-volt-400/25 shadow-hardware'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 border border-transparent'
      }`}
    >
      {active && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-volt-400 rounded-r" />}
      <div className="relative shrink-0">
        {React.cloneElement(icon, { className: `w-[18px] h-[18px] ${active ? 'text-volt-400' : 'text-zinc-500 group-hover:text-zinc-300'}` })}
        {liveBadge && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-volt-400 animate-ping" />
        )}
      </div>
      {!collapsed && (
        <div className="ml-3 flex items-center justify-between flex-1 min-w-0">
          <span className="text-[13px] truncate">{label}</span>
          <span className={`font-mono text-[9px] tracking-wider uppercase ${active ? 'text-volt-400/80' : 'text-zinc-600 group-hover:text-zinc-500'}`}>
            {liveBadge ? 'LIVE' : code}
          </span>
        </div>
      )}
    </button>
  );
}

function MobileTab({ icon, label, active, live, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center w-16 h-full gap-1 transition-all ${
        active ? 'text-volt-400' : 'text-zinc-500'
      }`}
    >
      {active && <span className="absolute top-0 left-3 right-3 h-[2px] bg-volt-400 rounded-b" />}
      <div className="relative">
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
        {live && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-volt-400 animate-pulse" />}
      </div>
      <span className="text-[10px] font-semibold tracking-tight">{label}</span>
    </button>
  );
}

function MobileMenuGridBtn({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 p-3.5 rounded-lg border transition-all ${
        active
          ? 'bg-volt-400/10 border-volt-400/35 text-volt-400'
          : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
      }`}
    >
      {React.cloneElement(icon, { className: 'w-5 h-5' })}
      <span className="font-display text-xs font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

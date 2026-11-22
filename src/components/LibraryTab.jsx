import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Play, Loader2, Database, Clock, RefreshCw, UploadCloud, Trash2, Activity,
  Folder, FolderOpen, ArrowLeft, Edit2, Check, X, ArrowUp, ArrowDown,
  CalendarDays, CalendarPlus, CheckSquare, Sparkles, Search, Star, Timer,
  Target, Compass, Flame, Lock, Globe, ShieldCheck, Copy
} from 'lucide-react';
import { getZoneColorForTrainer } from '../utils/performanceMetrics';
import { parseWorkoutFile, normalizeCategory, calculateCategoryDifficulty } from '../utils/workoutParser';
import { calculateCogganMetrics, expandStepsToSeconds } from '../utils/performanceMetrics';
import { generateLocalWorkout } from '../utils/workoutGenerator';
import { stepsToIntervalsCode } from './ai/AIMarkdown';
import {
  fetchLibraryWorkouts,
  insertLibraryWorkouts,
  updateLibraryWorkout,
  deleteLibraryWorkout,
  setWorkoutPublicStatus,
  canManageWorkout,
  isPrivateWorkout,
  isGuestUser,
  onLibraryUpdated
} from '../services/workoutLibraryStorage';
import { useI18n } from '../i18n/I18nContext';

const FAMOUS_CLASSICS = [
  'classic', 'over-under classic', 'rønnestad', 'ronnestad', 'billat', 'seiler',
  'tabata', 'ramp test', '20-min ftp test', '2×20', '2x20', '3×15', '3x15',
  '3×20', '3x20', '4×8', '4x8', '5×4', '5x4', '4×4', '4x4',
  'gran fondo base', 'fatmax', 'hard-start', 'over-under', 'over under'
];

export function isClassicWorkout(workout) {
  if (!workout?.title) return false;
  const t = workout.title.toLowerCase();
  return FAMOUS_CLASSICS.some(c => t.includes(c));
}

export const DURATION_CHIPS = [
  { id: 'all', label: 'Sva trajanja', labelHr: 'Sva trajanja', labelEn: 'All durations' },
  { id: 'under45', label: '< 45 min', labelHr: '< 45 min', labelEn: '< 45 min' },
  { id: '45to60', label: '45–60 min', labelHr: '45–60 min', labelEn: '45–60 min' },
  { id: '60to75', label: '60–75 min', labelHr: '60–75 min', labelEn: '60–75 min' },
  { id: '75to90', label: '75–90 min', labelHr: '75–90 min', labelEn: '75–90 min' },
  { id: 'over90', label: '90+ min', labelHr: '90+ min', labelEn: '90+ min' },
];

export const SMART_COLLECTIONS = [
  {
    id: 'classics',
    title: 'Zlatni Klasici',
    titleHr: 'Zlatni Klasici',
    titleEn: 'Gold Classics',
    subtitle: 'Provjereni recepti i progresije',
    subtitleHr: 'Provjereni recepti i progresije',
    subtitleEn: 'Proven workouts & progressions',
    icon: Star,
    color: 'text-amber-400 bg-amber-400/10 border-amber-400/30 hover:border-amber-400/60',
    predicate: (w) => isClassicWorkout(w)
  },
  {
    id: 'time_crunched',
    title: 'Time-Crunched',
    titleHr: 'Time-Crunched',
    titleEn: 'Time-Crunched',
    subtitle: '≤ 45 min · Maksimalan efekt',
    subtitleHr: '≤ 45 min · Maksimalan efekt',
    subtitleEn: '≤ 45 min · Maximum impact',
    icon: Timer,
    color: 'text-volt-400 bg-volt-400/10 border-volt-400/30 hover:border-volt-400/60',
    predicate: (w) => {
      const mins = Math.round((w.duration_seconds || 3600) / 60);
      return mins <= 45;
    }
  },
  {
    id: 'ftp_booster',
    title: 'FTP & Prag',
    titleHr: 'FTP & Prag',
    titleEn: 'FTP & Threshold',
    subtitle: 'Threshold i Over-Unders',
    subtitleHr: 'Threshold i Over-Unders',
    subtitleEn: 'Threshold & Over-Unders',
    icon: Target,
    color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30 hover:border-emerald-400/60',
    predicate: (w) => {
      const c = normalizeCategory(w.category);
      const t = (w.title || '').toLowerCase();
      return c === 'Threshold' || t.includes('over-under') || t.includes('prag') || t.includes('ftp') || t.includes('suprathresh');
    }
  },
  {
    id: 'winter_base',
    title: 'Zimska Baza',
    titleHr: 'Zimska Baza',
    titleEn: 'Winter Base',
    subtitle: 'Z2 Aerobik & Kontrolirani tempo',
    subtitleHr: 'Z2 Aerobik & Kontrolirani tempo',
    subtitleEn: 'Z2 Aerobic & Controlled Tempo',
    icon: Compass,
    color: 'text-sky-400 bg-sky-400/10 border-sky-400/30 hover:border-sky-400/60',
    predicate: (w) => {
      const c = normalizeCategory(w.category);
      return c === 'Endurance' || c === 'Tempo';
    }
  },
  {
    id: 'vo2_hiit',
    title: 'VO2 Max Intervali',
    titleHr: 'VO2 Max Intervali',
    titleEn: 'VO2 Max Intervals',
    subtitle: '30/30, 40/20 i mikropulsacije',
    subtitleHr: '30/30, 40/20 i mikropulsacije',
    subtitleEn: '30/30, 40/20 & micro-intervals',
    icon: Flame,
    color: 'text-rose-400 bg-rose-400/10 border-rose-400/30 hover:border-rose-400/60',
    predicate: (w) => {
      const c = normalizeCategory(w.category);
      return c === 'VO2 Max' || c === 'Anaerobni';
    }
  },
  {
    id: 'testing',
    title: 'Testovi & Rampa',
    titleHr: 'Testovi & Rampa',
    titleEn: 'Tests & Ramp',
    subtitle: 'FTP provjere & Kalibracija',
    subtitleHr: 'FTP provjere & Kalibracija',
    subtitleEn: 'FTP checks & Calibration',
    icon: Activity,
    color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30 hover:border-cyan-400/60',
    predicate: (w) => {
      const c = normalizeCategory(w.category);
      const t = (w.title || '').toLowerCase();
      return c === 'Testiranje' || t.includes('ramp') || t.includes('test') || t.includes('kolokvij') || t.includes('20 min');
    }
  }
];

export default function LibraryTab({ onSelectWorkout, onScheduleWorkout, ftp = 250, userId, isAdmin = false }) {
  const { tr, tCat, tStep, tDesc, locale } = useI18n();
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [libraryScope, setLibraryScope] = useState('public'); // 'public' | 'private' | 'all'
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [durationFilter, setDurationFilter] = useState('all');
  const [editingWorkoutId, setEditingWorkoutId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [togglingVisibilityId, setTogglingVisibilityId] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedDetailWorkout, setSelectedDetailWorkout] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [scheduleSuccess, setScheduleSuccess] = useState(false);
  const [isSavingAi, setIsSavingAi] = useState(false);

  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [genType, setGenType] = useState('Endurance');
  const [genDuration, setGenDuration] = useState(60);
  const [genDifficulty, setGenDifficulty] = useState(3);

  const handleGenerate = () => {
    const newWorkout = generateLocalWorkout(genType, genDuration, genDifficulty);
    setSelectedDetailWorkout(newWorkout);
    setShowGeneratorModal(false);
  };

  const handleScheduleWorkout = async () => {
    if (!selectedDetailWorkout || !scheduleDate) return;
    const metrics = getCachedWorkoutMetrics(selectedDetailWorkout);
    const durSec = Number(selectedDetailWorkout.duration_seconds) ||
      (Array.isArray(selectedDetailWorkout.steps)
        ? selectedDetailWorkout.steps.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)
        : 3600);
    const durMin = Math.max(10, Math.round(durSec / 60));

    if (onScheduleWorkout) {
      const descriptionCode = Array.isArray(selectedDetailWorkout.steps)
        ? stepsToIntervalsCode(selectedDetailWorkout.steps)
        : (typeof selectedDetailWorkout.steps === 'string' ? selectedDetailWorkout.steps : '');

      await onScheduleWorkout({
        id: `local-${Date.now()}`,
        date: scheduleDate,
        title: selectedDetailWorkout.title || tr('Trening iz knjižnice', 'Library Workout'),
        duration: durMin,
        duration_seconds: durSec,
        tss: Math.round(Number(metrics.tss) || 0),
        description: descriptionCode,
        allSteps: Array.isArray(selectedDetailWorkout.steps) ? selectedDetailWorkout.steps : undefined,
        category: selectedDetailWorkout.category || 'WORKOUT',
        difficulty_score: selectedDetailWorkout.difficulty_score ?? null,
        type: 'ride'
      });
    } else {
      const records = JSON.parse(localStorage.getItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`) || '[]');
      const newRecord = {
        ...selectedDetailWorkout,
        id: Date.now().toString(),
        date: scheduleDate,
        duration: durMin,
        duration_seconds: durSec,
        tss: Math.round(Number(metrics.tss) || 0),
        np: metrics.np,
        if_factor: metrics.if_factor,
        workout_source: 'library'
      };
      localStorage.setItem(`ai_trener_scheduled_workouts_${userId || 'guest'}`, JSON.stringify([...records, newRecord]));
      window.dispatchEvent(new CustomEvent('local-workouts-updated'));
    }

    setScheduleSuccess(true);
    setTimeout(() => {
      setScheduleSuccess(false);
      setSelectedDetailWorkout(null);
    }, 1500);
  };

  const fetchWorkouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allWorkouts = await fetchLibraryWorkouts(userId);
      setWorkouts(allWorkouts);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  useEffect(() => {
    return onLibraryUpdated(() => {
      fetchWorkouts();
    });
  }, [fetchWorkouts]);

  const handleSaveAiToLibrary = async (asPublic = false) => {
    if (!selectedDetailWorkout) return;
    try {
      setIsSavingAi(true);
      const workoutPayload = {
        title: selectedDetailWorkout.title,
        description: selectedDetailWorkout.description || '',
        duration_seconds: selectedDetailWorkout.duration_seconds,
        difficulty_score: selectedDetailWorkout.difficulty_score ?? 1.0,
        category: selectedDetailWorkout.category,
        steps: selectedDetailWorkout.steps
      };

      await insertLibraryWorkouts({
        workouts: [workoutPayload],
        userId,
        isAdmin,
        asPublic: Boolean(asPublic && isAdmin)
      });

      await fetchWorkouts();
      if (!asPublic) {
        setLibraryScope('private');
        setActiveFolder(null);
        setActiveCollection(null);
      }
      setSelectedDetailWorkout(null);
    } catch (err) {
      console.error(err);
      alert(tr('Greška pri spremanju u knjižnicu: {msg}', 'Error saving to library: {msg}', { msg: err.message }));
    } finally {
      setIsSavingAi(false);
    }
  };

  const handleCopyToPrivate = async (workout) => {
    if (!workout) return;
    try {
      setIsSavingAi(true);
      await insertLibraryWorkouts({
        workouts: [{
          title: workout.title,
          description: workout.description || '',
          duration_seconds: workout.duration_seconds,
          difficulty_score: workout.difficulty_score ?? 1.0,
          category: workout.category,
          steps: workout.steps
        }],
        userId,
        isAdmin: false,
        asPublic: false
      });
      await fetchWorkouts();
      setLibraryScope('private');
      setActiveFolder(null);
      setActiveCollection(null);
      setSelectedDetailWorkout(null);
    } catch (err) {
      console.error(err);
      alert(tr('Greška pri kopiranju u Moje Treninge: {msg}', 'Error copying to My Workouts: {msg}', { msg: err.message }));
    } finally {
      setIsSavingAi(false);
    }
  };

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError(null);

    const uploadedWorkouts = [];
    const errors = [];
    let duplicateCount = 0;

    // Provjera duplikata isključivo unutar korisnikovih privatnih treninga
    const existingPrivate = workouts.filter((w) => isPrivateWorkout(w));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        const parsedWorkout = await parseWorkoutFile(text, file.name);

        const isDuplicate =
          existingPrivate.some((existing) => existing.title.toLowerCase() === parsedWorkout.title.toLowerCase()) ||
          uploadedWorkouts.some((pending) => pending.title.toLowerCase() === parsedWorkout.title.toLowerCase());

        if (isDuplicate) {
          duplicateCount++;
        } else {
          uploadedWorkouts.push(parsedWorkout);
        }
      } catch (err) {
        console.error(`Greška pri parsiranju fajla ${file.name}:`, err);
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (uploadedWorkouts.length > 0) {
      try {
        await insertLibraryWorkouts({
          workouts: uploadedWorkouts,
          userId,
          isAdmin,
          asPublic: false // Uvijek u privatnu bazu korisnika (Admin jednim klikom može objaviti u javni katalog)
        });
        setLibraryScope('private');
        setActiveFolder(null);
        setActiveCollection(null);
        await fetchWorkouts();
      } catch (err) {
        console.error(err);
        setError(tr('Greška pri spremanju u bazu: {msg}', 'Error saving to database: {msg}', { msg: err.message }));
      }
    }

    let errorMessage = '';
    if (errors.length > 0) {
      errorMessage += tr('Neuspješan uvoz nekih datoteka:\n{errors}\n', 'Failed to import some files:\n{errors}\n', { errors: errors.join('\n') });
    }
    if (duplicateCount > 0) {
      errorMessage += tr('Preskočeno duplikata u Mojim Treninzima: {count}', 'Skipped duplicates in My Workouts: {count}', { count: duplicateCount });
    }

    if (errorMessage) {
      setError(errorMessage.trim());
    }

    setIsUploading(false);
    event.target.value = null;
  };

  const handleDeleteWorkout = async (workout) => {
    if (!canManageWorkout(workout, userId, isAdmin)) return;
    const isPub = !isPrivateWorkout(workout);
    if (isPub && typeof window !== 'undefined') {
      const ok = window.confirm(
        tr(
          'Obrisati javni trening "{title}" iz ErgVibe Kataloga za sve korisnike?',
          'Delete public workout "{title}" from the ErgVibe Catalog for all users?',
          { title: workout.title }
        )
      );
      if (!ok) return;
    }
    try {
      await deleteLibraryWorkout({ workout, userId, isAdmin });
      if (selectedDetailWorkout?.id === workout.id) {
        setSelectedDetailWorkout(null);
      }
      await fetchWorkouts();
    } catch (err) {
      console.error(err);
      setError(tr('Greška pri brisanju: {msg}', 'Error deleting workout: {msg}', { msg: err.message }));
    }
  };

  const handleUpdateWorkout = async () => {
    if (!editingWorkoutId || !editTitle.trim()) return;
    try {
      const nextCategory = normalizeCategory(editCategory);
      const targetWorkout = workouts.find((w) => w.id === editingWorkoutId);
      if (!targetWorkout || !canManageWorkout(targetWorkout, userId, isAdmin)) return;

      const updatePayload = {
        title: editTitle.trim(),
        category: nextCategory
      };
      if (Array.isArray(targetWorkout.steps) && targetWorkout.steps.length > 0) {
        updatePayload.difficulty_score = calculateCategoryDifficulty(targetWorkout.steps, nextCategory);
      }

      await updateLibraryWorkout({
        workout: targetWorkout,
        patch: updatePayload,
        userId,
        isAdmin
      });
      setEditingWorkoutId(null);
      await fetchWorkouts();
    } catch (err) {
      console.error(err);
      setError(tr('Greška pri promjeni: {msg}', 'Error updating workout: {msg}', { msg: err.message }));
    }
  };

  const handleTogglePublicStatus = async (workout) => {
    if (!isAdmin || !workout?.id || workout.isLocalOnly) return;
    const makePublic = isPrivateWorkout(workout);
    try {
      setTogglingVisibilityId(workout.id);
      await setWorkoutPublicStatus({ workout, makePublic, userId, isAdmin });
      if (selectedDetailWorkout?.id === workout.id) {
        setSelectedDetailWorkout((prev) => (prev ? { ...prev, user_id: makePublic ? null : userId } : null));
      }
      await fetchWorkouts();
    } catch (err) {
      console.error(err);
      setError(tr('Greška pri promjeni vidljivosti: {msg}', 'Error changing visibility: {msg}', { msg: err.message }));
    } finally {
      setTogglingVisibilityId(null);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    return `${m} min`;
  };

  const getWorkoutMetrics = (workout) => {
    if (!workout || !workout.steps || workout.steps.length === 0) return { np: 0, avg: 0, tss: 0, if_factor: "0.00" };
    
    const powerArray = expandStepsToSeconds(workout.steps, ftp);
    const metrics = calculateCogganMetrics(powerArray, ftp);
    
    return {
      np: metrics.np,
      avg: metrics.avgPower,
      tss: metrics.tss,
      if_factor: metrics.ifFactor
    };
  };

  const metricsMap = useMemo(() => {
    const map = new Map();
    workouts.forEach(w => {
      map.set(w.id, getWorkoutMetrics(w));
    });
    return map;
  }, [workouts, ftp]);

  const getCachedWorkoutMetrics = (workout) => {
    if (!workout) return { np: 0, avg: 0, tss: 0, if_factor: "0.00" };
    return metricsMap.get(workout.id) || getWorkoutMetrics(workout);
  };

  const getCategoryMeta = (cat) => {
    switch (cat) {
      case 'Oporavak': return { zone: 'Z1 · REC', topBar: 'bg-zinc-400', text: 'text-zinc-300', border: 'hover:border-zinc-500/60', badge: 'bg-zinc-800/80 text-zinc-300 border-zinc-700' };
      case 'Endurance': return { zone: 'Z2 · END', topBar: 'bg-sky-400', text: 'text-sky-400', border: 'hover:border-sky-500/50', badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
      case 'Tempo': return { zone: 'Z3 · TMP', topBar: 'bg-emerald-400', text: 'text-emerald-400', border: 'hover:border-emerald-500/50', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
      case 'Sweet Spot': return { zone: 'SS · 88-94%', topBar: 'bg-volt-400', text: 'text-volt-400', border: 'hover:border-volt-400/50', badge: 'bg-volt-400/10 text-volt-300 border-volt-400/30' };
      case 'Threshold': return { zone: 'Z4 · FTP', topBar: 'bg-amber-400', text: 'text-amber-400', border: 'hover:border-amber-500/50', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
      case 'VO2 Max': return { zone: 'Z5 · VO2', topBar: 'bg-rose-500', text: 'text-rose-400', border: 'hover:border-rose-500/50', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30' };
      case 'Anaerobni': return { zone: 'Z6 · ANA', topBar: 'bg-purple-500', text: 'text-purple-400', border: 'hover:border-purple-500/50', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30' };
      case 'Testiranje': return { zone: 'RAMP / FTP', topBar: 'bg-cyan-400', text: 'text-cyan-400', border: 'hover:border-cyan-500/50', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' };
      default: return { zone: 'MIX', topBar: 'bg-zinc-500', text: 'text-zinc-300', border: 'hover:border-zinc-600', badge: 'bg-zinc-900 text-zinc-400 border-zinc-800' };
    }
  };

  const categoryOrder = ['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni', 'Testiranje', 'Ostalo'];

  const publicWorkouts = useMemo(
    () => workouts.filter((w) => !isPrivateWorkout(w)),
    [workouts]
  );

  const privateWorkouts = useMemo(
    () => workouts.filter((w) => isPrivateWorkout(w)),
    [workouts]
  );

  const scopedWorkouts = useMemo(() => {
    if (libraryScope === 'public') return publicWorkouts;
    if (libraryScope === 'private') return privateWorkouts;
    return workouts;
  }, [libraryScope, publicWorkouts, privateWorkouts, workouts]);

  const groupedWorkouts = useMemo(() => {
    return scopedWorkouts.reduce((acc, workout) => {
      const cat = normalizeCategory(workout.category);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(workout);
      return acc;
    }, {});
  }, [scopedWorkouts]);

  const categoryDurationStats = useMemo(() => {
    const stats = {};
    scopedWorkouts.forEach(w => {
      const cat = normalizeCategory(w.category);
      if (!stats[cat]) stats[cat] = { under45: 0, std60: 0, long75: 0 };
      const mins = Math.round((w.duration_seconds || 3600) / 60);
      if (mins < 45) stats[cat].under45++;
      else if (mins <= 60) stats[cat].std60++;
      else stats[cat].long75++;
    });
    return stats;
  }, [scopedWorkouts]);

  const activeDurationCounts = useMemo(() => {
    let base = [];
    if (activeFolder) {
      base = groupedWorkouts[activeFolder] || [];
    } else if (activeCollection) {
      const col = SMART_COLLECTIONS.find(c => c.id === activeCollection);
      base = col ? scopedWorkouts.filter(col.predicate) : scopedWorkouts;
    } else {
      base = scopedWorkouts;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(w => {
        const localizedDesc = w.description ? tDesc(w.title, w.description) : '';
        const localizedCat = w.category ? tCat(w.category) : '';
        return (
          (w.title && w.title.toLowerCase().includes(q)) ||
          (w.description && w.description.toLowerCase().includes(q)) ||
          (localizedDesc && localizedDesc.toLowerCase().includes(q)) ||
          (w.category && w.category.toLowerCase().includes(q)) ||
          (localizedCat && localizedCat.toLowerCase().includes(q))
        );
      });
    }

    const counts = { all: base.length, under45: 0, '45to60': 0, '60to75': 0, '75to90': 0, over90: 0 };
    base.forEach(w => {
      const mins = Math.round((w.duration_seconds || 3600) / 60);
      if (mins < 45) counts.under45++;
      else if (mins <= 60) counts['45to60']++;
      else if (mins <= 75) counts['60to75']++;
      else if (mins <= 90) counts['75to90']++;
      else counts.over90++;
    });
    return counts;
  }, [scopedWorkouts, activeFolder, activeCollection, searchQuery, groupedWorkouts, tDesc, tCat]);

  const sortedCategories = useMemo(() => {
    return Object.keys(groupedWorkouts).sort((a, b) => {
      let indexA = categoryOrder.indexOf(a);
      let indexB = categoryOrder.indexOf(b);
      if (indexA === -1) indexA = 999;
      if (indexB === -1) indexB = 999;
      return indexA - indexB;
    });
  }, [groupedWorkouts]);

  // U tabu "Moji Treninzi" prikaži kartice odmah ako korisnik ima manji broj osobnih treninga (<= 24)
  const isCompactPrivateView = libraryScope === 'private' && privateWorkouts.length > 0 && privateWorkouts.length <= 24;
  const isViewingWorkoutsList = Boolean(
    activeFolder || activeCollection || searchQuery.trim() || durationFilter !== 'all' || isCompactPrivateView
  );

  const displayWorkouts = useMemo(() => {
    let list = [];
    if (activeFolder) {
      list = [...(groupedWorkouts[activeFolder] || [])];
    } else if (activeCollection) {
      const col = SMART_COLLECTIONS.find(c => c.id === activeCollection);
      list = col ? scopedWorkouts.filter(col.predicate) : [...scopedWorkouts];
    } else {
      list = [...scopedWorkouts];
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(w => {
        const localizedDesc = w.description ? tDesc(w.title, w.description) : '';
        const localizedCat = w.category ? tCat(w.category) : '';
        return (
          (w.title && w.title.toLowerCase().includes(q)) ||
          (w.description && w.description.toLowerCase().includes(q)) ||
          (localizedDesc && localizedDesc.toLowerCase().includes(q)) ||
          (w.category && w.category.toLowerCase().includes(q)) ||
          (localizedCat && localizedCat.toLowerCase().includes(q))
        );
      });
    }

    if (durationFilter !== 'all') {
      list = list.filter(w => {
        const mins = Math.round((w.duration_seconds || 3600) / 60);
        if (durationFilter === 'under45') return mins < 45;
        if (durationFilter === '45to60') return mins >= 45 && mins <= 60;
        if (durationFilter === '60to75') return mins > 60 && mins <= 75;
        if (durationFilter === '75to90') return mins > 75 && mins <= 90;
        if (durationFilter === 'over90') return mins > 90;
        return true;
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'name') {
        return sortOrder === 'asc'
          ? a.title.localeCompare(b.title, locale)
          : b.title.localeCompare(a.title, locale);
      }
      let valA = 0; let valB = 0;
      if (sortBy === 'difficulty') {
        valA = a.difficulty_score; valB = b.difficulty_score;
      } else if (sortBy === 'duration') {
        valA = a.duration_seconds; valB = b.duration_seconds;
      } else {
        const metricsA = getCachedWorkoutMetrics(a);
        const metricsB = getCachedWorkoutMetrics(b);
        if (sortBy === 'tss') { valA = metricsA.tss; valB = metricsB.tss; }
        if (sortBy === 'np') { valA = metricsA.np; valB = metricsB.np; }
      }
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [scopedWorkouts, activeFolder, activeCollection, searchQuery, durationFilter, sortBy, sortOrder, groupedWorkouts, tDesc, tCat, locale]);

  const handleScopeChange = (nextScope) => {
    setLibraryScope(nextScope);
    setActiveFolder(null);
    setActiveCollection(null);
    setDurationFilter('all');
    setEditingWorkoutId(null);
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 animate-in fade-in pb-20 md:pb-4">
      {/* ZAGLAVLJE S PRETRAGOM I AKCIJAMA */}
      <div className="carbon-panel rounded-xl p-4 md:p-5 flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">
                {tr(
                  'STRUKTURIRANI RECEPTI · {pub} JAVNIH · {priv} MOJIH',
                  'STRUCTURED WORKOUTS · {pub} PUBLIC · {priv} MY WORKOUTS',
                  { pub: publicWorkouts.length, priv: privateWorkouts.length }
                )}
              </span>
              {isAdmin && (
                <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/35">
                  <ShieldCheck className="w-3 h-3" /> {tr('Admin Mod', 'Admin Mode')}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2.5 mt-0.5">
              <Database className="text-volt-400 w-5 h-5" /> {tr('Knjižnica Treninga', 'Workout Library')}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-64 lg:w-72 min-w-[180px]">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr('Pretraži trening ili opis...', 'Search workout or description...')}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-volt-400 rounded-lg pl-9 pr-8 py-2 text-xs font-medium text-zinc-100 placeholder-zinc-600 outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                  title={tr('Očisti pretragu', 'Clear search')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGeneratorModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/50 text-zinc-100 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 text-volt-400" />
              <span className="hidden sm:inline">{tr('Generator', 'Generator')}</span>
            </button>

            <label
              title={tr('Uvezeni .ZWO/.ERG treninzi spremaju se privatno u Moje Treninge', 'Imported .ZWO/.ERG workouts are saved privately to My Workouts')}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer transition-all shadow-volt-glow"
            >
              {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isUploading ? tr('Uvoz...', 'Importing...') : tr('Uvezi ZWO/ERG', 'Import ZWO/ERG')}</span>
              <span className="sm:hidden">{tr('Uvezi', 'Import')}</span>
              <input type="file" multiple className="absolute w-0 h-0 opacity-0 pointer-events-none" onChange={handleFileUpload} disabled={isUploading} />
            </label>

            <button
              type="button"
              onClick={fetchWorkouts}
              disabled={loading || isUploading}
              title={tr('Osvježi knjižnicu', 'Refresh library')}
              className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 hover:text-volt-400 hover:border-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-volt-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* PREKIDAČ JAVNI KATALOG vs. MOJI PRIVATNI TRENINZI */}
        <div className="pt-3 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-zinc-950 border border-zinc-800 self-start">
            <button
              type="button"
              onClick={() => handleScopeChange('public')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                libraryScope === 'public'
                  ? 'bg-volt-400 text-zinc-950 shadow-volt-glow'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{tr('ErgVibe Katalog', 'ErgVibe Catalog')}</span>
              <span className={`text-[10px] px-1.5 rounded-full ${libraryScope === 'public' ? 'bg-zinc-950/20 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                {publicWorkouts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleScopeChange('private')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                libraryScope === 'private'
                  ? 'bg-sky-400 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{tr('Moji Treninzi', 'My Workouts')}</span>
              <span className={`text-[10px] px-1.5 rounded-full ${libraryScope === 'private' ? 'bg-zinc-950/20 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                {privateWorkouts.length}
              </span>
            </button>

            {privateWorkouts.length > 0 && (
              <button
                type="button"
                onClick={() => handleScopeChange('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                  libraryScope === 'all'
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                    : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                <span>{tCat('Sve')}</span>
                <span className="text-[10px] px-1.5 rounded-full bg-zinc-900 text-zinc-400">
                  {workouts.length}
                </span>
              </button>
            )}
          </div>

          <span className="text-[11px] text-zinc-500 font-mono">
            {libraryScope === 'private'
              ? (isGuestUser(userId)
                  ? tr('Privatno · spremljeno lokalno u ovom pregledniku', 'Private · saved locally in this browser')
                  : tr('Privatna baza · vidljivo isključivo tebi na svim uređajima', 'Private library · visible only to you across all devices'))
              : (isAdmin
                  ? tr('Admin: uređuj ili prebacuj treninge između Javnog i Privatnog', 'Admin: edit or move workouts between Public and Private')
                  : tr('Javni ErgVibe katalog · tvoji uvezeni treninzi idu u Moji Treninzi', 'Public ErgVibe catalog · your imported workouts go to My Workouts'))}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-300 p-4 rounded-xl flex items-center gap-3 text-xs font-mono font-bold whitespace-pre-line">
          {tr('Greška pri dohvaćanju baze: {error}', 'Error loading library: {error}', { error })}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3 carbon-panel rounded-xl">
          <Loader2 className="w-8 h-8 text-volt-400 animate-spin" />
          <span className="text-zinc-500 font-mono font-bold tracking-[0.2em] uppercase text-[11px]">
            {tr('Sinkronizacija recepata...', 'Syncing workouts...')}
          </span>
        </div>
      ) : (
        <div className="w-full">
          {!isViewingWorkoutsList ? (
            <div className="flex flex-col gap-6">
              
              {/* SEKCIJA 1: PAMETNE KOLEKCIJE & CILJANI PROGRAMI */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> {tr('Pametne Kolekcije & Ciljani Programi', 'Smart Collections & Targeted Programs')}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">
                    {tr('Brzi odabir prema fiziološkom cilju i vremenu', 'Quick picks by physiological goal and duration')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {SMART_COLLECTIONS.map(col => {
                    const Icon = col.icon;
                    const count = scopedWorkouts.filter(col.predicate).length;
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => {
                          setActiveCollection(col.id);
                          setActiveFolder(null);
                          setDurationFilter('all');
                        }}
                        className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all duration-150 group hover:-translate-y-0.5 min-h-[110px] ${col.color}`}
                      >
                        <div className="flex items-center justify-between w-full mb-2">
                          <div className="p-1.5 rounded-lg bg-zinc-950/70 border border-white/5 group-hover:scale-105 transition-transform">
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950/80 border border-white/10 text-zinc-200">
                            {count}
                          </span>
                        </div>
                        <div>
                          <h4 className="text-xs font-display font-bold uppercase tracking-wider text-zinc-100 group-hover:text-white line-clamp-1">
                            {tr(col.titleHr, col.titleEn)}
                          </h4>
                          <p className="text-[9px] text-zinc-400 font-mono mt-0.5 line-clamp-1">
                            {tr(col.subtitleHr, col.subtitleEn)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SEKCIJA 2: MAPE PO FIZIOLOŠKIM ZONAMA */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-zinc-400" /> {tr('Mape po Fiziološkim Zonama', 'Folders by Physiological Zone')}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">{tr('8 standardnih Coggan zona', '8 standard Coggan zones')}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {sortedCategories.map(cat => {
                    const meta = getCategoryMeta(cat);
                    const catList = groupedWorkouts[cat] || [];
                    const stats = categoryDurationStats[cat] || { under45: 0, std60: 0, long75: 0 };
                    return (
                      <button 
                        key={cat}
                        onClick={() => {
                          setActiveFolder(cat);
                          setActiveCollection(null);
                          setDurationFilter('all');
                        }}
                        className={`carbon-panel rounded-xl p-5 text-left flex flex-col justify-between min-h-[148px] relative overflow-hidden transition-all duration-150 group hover:-translate-y-0.5 ${meta.border}`}
                      >
                        <div className={`absolute top-0 left-0 right-0 h-[3px] ${meta.topBar}`} />
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${meta.badge}`}>
                            {meta.zone}
                          </span>
                          <Folder className={`w-5 h-5 ${meta.text} opacity-75 group-hover:opacity-100 transition-opacity`} />
                        </div>
                        <div className="mt-4">
                          <h3 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100 group-hover:text-white transition-colors">
                            {tCat(cat)}
                          </h3>
                          <p className="text-[11px] font-mono telemetry-num text-zinc-500 uppercase tracking-widest mt-0.5">
                            {catList.length} {catList.length === 1 ? tr('trening', 'workout') : tr('treninga', 'workouts')}
                          </p>
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-zinc-800/60 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-400">
                            &lt;45m: <strong className="text-zinc-200">{stats.under45 || 0}</strong>
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-400">
                            60m: <strong className="text-volt-300">{stats.std60 || 0}</strong>
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-400">
                            75m+: <strong className="text-zinc-200">{stats.long75 || 0}</strong>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {scopedWorkouts.length === 0 && !loading && !error && (
                    <div className="col-span-full py-16 text-center flex flex-col items-center carbon-panel rounded-xl px-4">
                      {libraryScope === 'private' ? (
                        <>
                          <Lock className="w-12 h-12 text-sky-400/50 mb-3" />
                          <h3 className="text-lg font-display font-bold uppercase text-zinc-200 mb-1">
                            {tr('Tvoja privatna knjižnica je prazna', 'Your private library is empty')}
                          </h3>
                          <p className="text-zinc-500 font-mono text-xs max-w-md leading-relaxed">
                            {tr(
                              'Uvezi vlastite .ZWO / .ERG datoteke ili kreiraj trening putem Generatora — svi tvoji treninzi bit će vidljivi isključivo tebi.',
                              'Import your own .ZWO / .ERG files or build one with the Generator — all your workouts stay visible only to you.'
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <Database className="w-12 h-12 text-zinc-700 mb-3" />
                          <h3 className="text-lg font-display font-bold uppercase text-zinc-300 mb-1">
                            {tr('Knjižnica je prazna', 'Library is empty')}
                          </h3>
                          <p className="text-zinc-500 font-mono text-xs">
                            {tr('Uvezi .ZWO ili .ERG datoteke putem gumba u zaglavlju.', 'Import .ZWO or .ERG files using the button in the header.')}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              
              {/* ZAGLAVLJE LISTE S KONTROLAMA */}
              <div className="carbon-panel rounded-xl p-3.5 px-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-volt-400">
                      {activeFolder ? <FolderOpen className="w-5 h-5" /> : (activeCollection ? <Sparkles className="w-5 h-5" /> : (isCompactPrivateView && !searchQuery.trim() ? <Lock className="w-5 h-5 text-sky-400" /> : <Search className="w-5 h-5" />))}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-display font-bold uppercase tracking-wide text-zinc-100">
                          {activeFolder 
                            ? tCat(activeFolder) 
                            : (activeCollection 
                                ? (() => {
                                    const col = SMART_COLLECTIONS.find(c => c.id === activeCollection);
                                    return col ? tr(col.titleHr, col.titleEn) : tr('Kolekcija', 'Collection');
                                  })()
                                : (searchQuery.trim()
                                    ? tr('Pretraga: "{q}"', 'Search: "{q}"', { q: searchQuery })
                                    : (libraryScope === 'private' ? tr('Moji Privatni Treninzi', 'My Private Workouts') : tr('Svi Treninzi', 'All Workouts'))))}
                        </h3>
                        {activeFolder && (
                          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getCategoryMeta(activeFolder).badge}`}>
                            {getCategoryMeta(activeFolder).zone}
                          </span>
                        )}
                        {activeCollection && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-volt-400/20 text-volt-300 border border-volt-400/30">
                            {tr('KOLEKCIJA', 'COLLECTION')}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono telemetry-num font-bold text-zinc-500 uppercase tracking-widest mt-0.5">
                        {displayWorkouts.length} {displayWorkouts.length === 1 ? tr('trening prikazan', 'workout shown') : tr('treninga prikazano', 'workouts shown')}
                        {durationFilter !== 'all' ? (() => {
                          const activeChip = DURATION_CHIPS.find(c => c.id === durationFilter);
                          return activeChip ? ` (filter: ${tr(activeChip.labelHr, activeChip.labelEn)})` : '';
                        })() : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
                    <div className="flex gap-1.5">
                      <select 
                        value={sortBy} 
                        onChange={(e) => setSortBy(e.target.value)}
                        className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-1.5 text-xs font-mono font-bold outline-none focus:border-volt-400"
                      >
                        <option value="name">{tr('Naziv', 'Name')}</option>
                        <option value="difficulty">{tr('Težina (LVL)', 'Difficulty (LVL)')}</option>
                        <option value="duration">{tr('Trajanje', 'Duration')}</option>
                        <option value="tss">{tr('TSS Load', 'TSS Load')}</option>
                        <option value="np">NP (W)</option>
                      </select>

                      <button 
                        onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} 
                        className="p-1.5 px-2.5 flex items-center justify-center bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 hover:text-volt-400 hover:border-zinc-700 transition"
                        title={tr('Promijeni smjer sortiranja', 'Toggle sort direction')}
                      >
                        {sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {(!isCompactPrivateView || activeFolder || activeCollection || searchQuery.trim() || durationFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFolder(null);
                          setActiveCollection(null);
                          setSearchQuery('');
                          setDurationFilter('all');
                        }}
                        className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-volt-400 hover:border-volt-400/40 transition-all font-mono font-bold text-xs uppercase tracking-wider"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> {tr('Sve Mape', 'All Folders')}
                      </button>
                    )}
                  </div>
                </div>

                {/* VREMENSKI FILTERI (DURATION CHIPS) */}
                <div className="pt-2.5 border-t border-zinc-800/80 flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-wider flex items-center gap-1 shrink-0 mr-1">
                    <Timer className="w-3 h-3 text-volt-400" /> {tr('Trajanje:', 'Duration:')}
                  </span>
                  {DURATION_CHIPS.map(chip => {
                    const count = activeDurationCounts[chip.id] || 0;
                    const isActive = durationFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setDurationFilter(chip.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-volt-400 text-zinc-950 font-bold shadow-volt-glow/20'
                            : 'bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100'
                        }`}
                      >
                        <span>{tr(chip.labelHr, chip.labelEn)}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-zinc-950/20 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {/* KARTICE TRENINGA */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayWorkouts.length === 0 ? (
                  <div className="col-span-full py-16 text-center text-zinc-500 font-mono text-xs carbon-panel rounded-xl flex flex-col items-center gap-2">
                    <Database className="w-8 h-8 text-zinc-700" />
                    <span>{tr('Nema treninga koji odgovaraju odabranim kriterijima.', 'No workouts match the selected criteria.')}</span>
                    <button
                      onClick={() => {
                        setDurationFilter('all');
                        setSearchQuery('');
                      }}
                      className="mt-2 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-volt-400 hover:border-volt-400/50 text-xs font-bold font-mono uppercase"
                    >
                      {tr('Poništi filtere', 'Reset filters')}
                    </button>
                  </div>
                ) : (
                  displayWorkouts.map((workout) => {
                    const catMeta = getCategoryMeta(workout.category);
                    const metrics = getCachedWorkoutMetrics(workout);
                    const isPriv = isPrivateWorkout(workout);
                    const canEdit = canManageWorkout(workout, userId, isAdmin);
                    const isTogglingVis = togglingVisibilityId === workout.id;
                    return (
                      <div
                        key={workout.id}
                        onClick={() => setSelectedDetailWorkout(workout)}
                        className="carbon-panel rounded-xl p-4 hover:border-volt-400/50 transition-all group/card flex flex-col h-full relative overflow-hidden cursor-pointer"
                      >
                        <div className={`absolute top-0 left-0 right-0 h-[2px] ${catMeta.topBar}`} />
                        <div className="flex justify-between items-start gap-2 mb-2 relative z-10 w-full">
                          {editingWorkoutId === workout.id && canEdit ? (
                            <div className="flex flex-col gap-2 w-full p-2 rounded-lg bg-zinc-950 border border-volt-400/40">
                              <input 
                                type="text" 
                                value={editTitle} 
                                onChange={e => setEditTitle(e.target.value)}
                                onKeyDown={e => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') handleUpdateWorkout();
                                }}
                                onClick={e => e.stopPropagation()}
                                className="bg-zinc-900 border border-zinc-800 text-white rounded text-sm font-bold w-full outline-none px-2 py-1 focus:border-volt-400"
                                autoFocus 
                              />
                              <div className="flex gap-1.5">
                                <select
                                  value={editCategory}
                                  onChange={e => setEditCategory(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="bg-zinc-900 border border-zinc-800 text-white rounded text-xs font-bold flex-1 outline-none px-2 py-1 focus:border-volt-400"
                                >
                                  {categoryOrder.map(c => <option key={c} value={c}>{tCat(c)}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleUpdateWorkout(); }}
                                  title={tr('Spremi', 'Save')}
                                  className="text-volt-400 hover:text-volt-300 shrink-0 p-1.5 bg-zinc-900 border border-zinc-800 rounded"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setEditingWorkoutId(null); }}
                                  title={tr('Odustani', 'Cancel')}
                                  className="text-rose-400 hover:text-rose-300 shrink-0 p-1.5 bg-zinc-900 border border-zinc-800 rounded"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  {!activeFolder && workout.category && (
                                    <span className={`inline-block text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${catMeta.badge}`}>
                                      {tCat(normalizeCategory(workout.category))}
                                    </span>
                                  )}
                                  {isPriv && (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300">
                                      <Lock className="w-2.5 h-2.5" /> {workout.isLocalOnly ? tr('Lokalno', 'Local') : tr('Moj', 'Mine')}
                                    </span>
                                  )}
                                  {isClassicWorkout(workout) && (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 text-amber-300">
                                      <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> {tr('Klasik', 'Classic')}
                                    </span>
                                  )}
                                </div>
                                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 group-hover/card:text-volt-400 transition-colors leading-snug line-clamp-2">
                                  {workout.title}
                                </h3>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {isAdmin && !workout.isLocalOnly && (
                                  <button
                                    type="button"
                                    disabled={isTogglingVis}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleTogglePublicStatus(workout);
                                    }}
                                    className={`flex items-center justify-center w-7 h-7 rounded-md bg-zinc-950 border border-zinc-800 md:opacity-0 md:group-hover/card:opacity-100 transition-all disabled:opacity-50 ${
                                      isPriv
                                        ? 'text-zinc-500 hover:text-volt-400 hover:border-volt-400/40'
                                        : 'text-zinc-500 hover:text-amber-400 hover:border-amber-400/40'
                                    }`}
                                    title={isPriv
                                      ? tr('Admin: Objavi u Javni Katalog', 'Admin: Publish to Public Catalog')
                                      : tr('Admin: Prebaci u Moje (privatno)', 'Admin: Move to My Workouts (Private)')}
                                  >
                                    {isTogglingVis ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : isPriv ? (
                                      <Globe className="w-3 h-3" />
                                    ) : (
                                      <Lock className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                                {canEdit && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditTitle(workout.title);
                                        setEditCategory(workout.category || 'Ostalo');
                                        setEditingWorkoutId(workout.id);
                                      }}
                                      className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-sky-400 hover:border-sky-500/40 md:opacity-0 md:group-hover/card:opacity-100 transition-all"
                                      title={tr('Uredi trening', 'Edit workout')}
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteWorkout(workout); }}
                                      className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-rose-400 hover:border-rose-500/40 md:opacity-0 md:group-hover/card:opacity-100 transition-all"
                                      title={tr('Obriši', 'Delete')}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                                <div className="flex items-center justify-center px-2 h-7 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-mono telemetry-num font-bold text-volt-400 shrink-0" title={tr('Faktor težine', 'Difficulty score')}>
                                  {typeof workout.difficulty_score === 'number' ? Number(workout.difficulty_score).toFixed(1).replace(/\.0$/, '') : workout.difficulty_score}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        
                        {workout.description && (
                          <p className="text-zinc-500 text-xs mb-3 leading-relaxed flex-1 line-clamp-2">
                            {tDesc(workout.title, workout.description)}
                          </p>
                        )}

                        {/* MALI PREVIEW GRAF */}
                        <div className="h-14 w-full flex items-end mb-3.5 rounded-lg overflow-hidden bg-zinc-950 bg-telemetry-grid border border-zinc-800/90 px-0.5 pt-1 relative mt-auto">
                          <div className="absolute left-0 right-0 bottom-[66.6%] border-t border-dashed border-volt-400/25 pointer-events-none z-10" />
                          {workout.steps && workout.steps.length > 0 ? (
                            workout.steps.map((wStep, i) => {
                              const widthP = (wStep.duration / workout.duration_seconds) * 100;
                              const heightP = Math.min(Math.max((wStep.power / 150) * 100, 14), 100);
                              const watts = Math.round((wStep.power / 100) * ftp);
                              const isRange = wStep.powerMin && wStep.powerMax && wStep.powerMin !== wStep.powerMax;
                              const minW = isRange ? Math.round((wStep.powerMin / 100) * ftp) : watts;
                              const maxW = isRange ? Math.round((wStep.powerMax / 100) * ftp) : watts;
                              const targetStr = isRange ? `${minW}-${maxW}W (${wStep.powerMin}-${wStep.powerMax}%)` : `${watts}W (${wStep.power}%)`;
                              const mins = Math.round(wStep.duration / 60 * 10) / 10;
                              const zBg = getZoneColorForTrainer(wStep.power);
                              return (
                                <div 
                                  key={i} 
                                  title={`${tStep(wStep.name) || tr('Segment', 'Segment')}: ${wStep.duration >= 60 ? mins + ' min' : wStep.duration + ' sec'} @ ${targetStr}`}
                                  style={{ width: `${widthP}%`, height: `${heightP}%` }} 
                                  className="relative overflow-hidden min-w-[2px] border-r border-zinc-950/60"
                                >
                                  <div className={`absolute inset-0 ${zBg} opacity-65 group-hover/card:opacity-80 transition-opacity`} />
                                  <div className={`absolute top-0 left-0 right-0 h-[2px] ${zBg} brightness-125`} />
                                </div>
                              );
                            })
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] font-mono uppercase font-bold">
                              {tr('Nema Podataka', 'No Data')}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 gap-2 w-full font-mono telemetry-num">
                          <div className="flex gap-1.5 items-center flex-wrap flex-1 min-w-0 text-[10px]">
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-200 font-bold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-zinc-500" /> {formatTime(workout.duration_seconds)}
                            </span>
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-300 font-bold" title={tr('Prosječna snaga: {avg}W', 'Average power: {avg}W', { avg: metrics.avg })}>
                              NP {metrics.np}W · IF {metrics.if_factor}
                            </span>
                            <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-volt-400 font-bold">
                              TSS {metrics.tss}
                            </span>
                          </div>
                          
                          <button 
                            onClick={(e) => { e.stopPropagation(); onSelectWorkout(workout); }}
                            className="flex outline-none shrink-0 items-center justify-center gap-1 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono font-bold px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all shadow-volt-glow"
                          >
                            <Play className="w-3 h-3" fill="currentColor" /> {tr('VOZI', 'RIDE')}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL DETALJA TRENINGA I ZAKAZIVANJE */}
      {selectedDetailWorkout && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setSelectedDetailWorkout(null)}>
          <div className="carbon-panel rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 md:p-6 border-b border-zinc-800 bg-zinc-950 shrink-0">
              <div>
                <p className="text-[10px] font-mono font-bold text-volt-400 uppercase tracking-[0.2em]">
                  {tCat(selectedDetailWorkout.category)} · LVL {selectedDetailWorkout.difficulty_score}
                </p>
                <h2 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wide text-zinc-100 pr-4 mt-0.5">
                  {selectedDetailWorkout.title}
                </h2>
              </div>
              <button
                onClick={() => setSelectedDetailWorkout(null)}
                aria-label={tr('Zatvori', 'Close')}
                className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>
            
            <div className="p-5 md:p-6 overflow-y-auto max-h-[75vh] custom-scrollbar">
              {selectedDetailWorkout.description && (
                <p className="text-sm text-zinc-300 mb-5 leading-relaxed border-l-2 border-volt-400 pl-4">
                  {tDesc(selectedDetailWorkout.title, selectedDetailWorkout.description)}
                </p>
              )}
              
              {/* GRAFIKA U DETALJIMA */}
              {(() => {
                const maxPwr = Math.max(...(selectedDetailWorkout.steps?.map(s => s.power) || [100]));
                const scaleMax = Math.max(120, maxPwr + 10);
                const ftpLinePercent = (100 / scaleMax) * 100;
                
                return (
                  <div className="h-40 w-full flex items-end mb-6 rounded-xl overflow-hidden bg-zinc-950 bg-telemetry-grid border border-zinc-800 relative px-0.5 pt-2">
                    <div className="absolute left-0 right-0 h-0 border-t border-dashed border-volt-400/45 z-20 pointer-events-none" style={{ bottom: `${ftpLinePercent}%` }}>
                      <span className="absolute right-2 bottom-1 text-[10px] font-mono font-bold text-volt-400 bg-zinc-950/90 px-1.5 py-0.5 rounded">FTP {ftp}W</span>
                    </div>
                    {selectedDetailWorkout.steps?.map((wStep, i) => {
                      const widthP = (wStep.duration / selectedDetailWorkout.duration_seconds) * 100;
                      const heightP = Math.min(Math.max((wStep.power / scaleMax) * 100, 5), 100);
                      const watts = Math.round((wStep.power / 100) * ftp);
                      const isRange = wStep.powerMin && wStep.powerMax && wStep.powerMin !== wStep.powerMax;
                      const minW = isRange ? Math.round((wStep.powerMin / 100) * ftp) : watts;
                      const maxW = isRange ? Math.round((wStep.powerMax / 100) * ftp) : watts;
                      const targetStr = isRange ? `${minW}-${maxW}W (${wStep.powerMin}-${wStep.powerMax}%)` : `${watts}W (${wStep.power}%)`;
                      const mins = Math.round(wStep.duration / 60 * 10) / 10;
                      const zBg = getZoneColorForTrainer(wStep.power);
                      return (
                        <div
                          key={i}
                          title={`${tStep(wStep.name) || tr('Segment', 'Segment')}: ${wStep.duration >= 60 ? mins + ' min' : wStep.duration + ' sec'} @ ${targetStr}`}
                          style={{ width: `${widthP}%`, height: `${heightP}%` }}
                          className="relative overflow-hidden cursor-crosshair min-w-[2px] border-r border-zinc-950/70"
                        >
                          <div className={`absolute inset-0 ${zBg} opacity-75 hover:opacity-95 transition-opacity`} />
                          <div className={`absolute top-0 left-0 right-0 h-[2px] ${zBg} brightness-125`} />
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* METRIKE */}
              {(() => {
                const m = getCachedWorkoutMetrics(selectedDetailWorkout);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">{tr('Trajanje', 'Duration')}</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-zinc-100">{Math.round(selectedDetailWorkout.duration_seconds / 60)} <span className="text-xs font-mono text-zinc-500">min</span></p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">{tr('TSS Load', 'TSS Load')}</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-volt-400">{m.tss}</p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">{tr('Normalized Pwr', 'Normalized Pwr')}</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-zinc-100">{m.np} <span className="text-xs font-mono text-zinc-500">W</span></p>
                    </div>
                    <div className="bg-zinc-950 p-3.5 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-widest mb-1">{tr('Intensity (IF)', 'Intensity (IF)')}</p>
                      <p className="text-2xl font-display font-bold telemetry-num text-sky-400">{m.if_factor}</p>
                    </div>
                  </div>
                );
              })()}

              {/* ZAKAZIVANJE I POKRETANJE */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 relative overflow-hidden">
                <h3 className="flex items-center gap-2 text-xs font-mono font-bold text-volt-400 uppercase tracking-[0.18em] mb-4">
                  <CalendarPlus className="w-4 h-4" /> {tr('Planiraj u Kalendar ili Pokreni Odmah', 'Schedule to Calendar or Ride Now')}
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    type="date" 
                    value={scheduleDate} 
                    onChange={(e) => setScheduleDate(e.target.value)} 
                    onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                    className="sm:w-48 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2.5 font-mono text-xs font-bold outline-none focus:border-volt-400 cursor-pointer"
                  />
                  <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
                    <button 
                      onClick={handleScheduleWorkout}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all border ${
                        scheduleSuccess
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border-zinc-700 hover:border-volt-400/50'
                      }`}
                    >
                      {scheduleSuccess ? <CheckSquare className="w-4 h-4"/> : <CalendarDays className="w-4 h-4 text-volt-400" />}
                      {scheduleSuccess ? tr('Dodano u Kalendar!', 'Added to Calendar!') : tr('Spremi u Kalendar', 'Add to Calendar')}
                    </button>

                    <button
                      onClick={() => {
                        const target = selectedDetailWorkout;
                        setSelectedDetailWorkout(null);
                        onSelectWorkout(target);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow transition-all"
                    >
                      <Play className="w-4 h-4" fill="currentColor" /> {tr('Vozi u Trenažeru', 'Ride in Trainer')}
                    </button>
                  </div>
                </div>

                {selectedDetailWorkout.isLocalGenerated ? (
                  <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleSaveAiToLibrary(false)}
                      disabled={isSavingAi}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all bg-zinc-900 border border-zinc-800 text-sky-300 hover:border-sky-400/50 disabled:opacity-50"
                    >
                      {isSavingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      {isSavingAi ? tr('Spremanje...', 'Saving...') : tr('Spremi u Moje Treninge', 'Save to My Workouts')}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleSaveAiToLibrary(true)}
                        disabled={isSavingAi}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all bg-amber-500/10 border border-amber-400/35 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {isSavingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                        {tr('Admin: Objavi Javno', 'Admin: Publish Publicly')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
                    {!isPrivateWorkout(selectedDetailWorkout) && (
                      <button
                        type="button"
                        onClick={() => handleCopyToPrivate(selectedDetailWorkout)}
                        disabled={isSavingAi}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-sky-300 hover:border-sky-500/40 disabled:opacity-50"
                      >
                        {isSavingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                        {tr('Kopiraj u Moje Treninge', 'Copy to My Workouts')}
                      </button>
                    )}
                    {isAdmin && !selectedDetailWorkout.isLocalOnly && (
                      <button
                        type="button"
                        onClick={() => handleTogglePublicStatus(selectedDetailWorkout)}
                        disabled={togglingVisibilityId === selectedDetailWorkout.id}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider font-bold transition-all bg-amber-500/10 border border-amber-400/35 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {togglingVisibilityId === selectedDetailWorkout.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isPrivateWorkout(selectedDetailWorkout) ? (
                          <Globe className="w-3.5 h-3.5" />
                        ) : (
                          <Lock className="w-3.5 h-3.5" />
                        )}
                        {isPrivateWorkout(selectedDetailWorkout)
                          ? tr('Admin: Objavi u Javni Katalog', 'Admin: Publish to Public Catalog')
                          : tr('Admin: Prebaci u Moje (Privatno)', 'Admin: Move to My Workouts (Private)')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showGeneratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setShowGeneratorModal(false)}>
          <div className="carbon-panel rounded-2xl p-6 md:p-7 max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-volt-400">
              {tr('ALGORITAMSKI GENERATOR', 'ALGORITHMIC GENERATOR')}
            </span>
            <h3 className="text-xl font-display font-bold uppercase tracking-wide text-zinc-100 mb-5 flex items-center gap-2.5 mt-0.5">
              <Sparkles className="text-volt-400 w-5 h-5" /> {tr('Brzi Generator Treninga', 'Quick Workout Generator')}
            </h3>
            
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  {tr('Zona / Tip Treninga', 'Zone / Workout Type')}
                </label>
                <select value={genType} onChange={e => setGenType(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-100 outline-none focus:border-volt-400 font-bold">
                  {['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni'].map(t => <option key={t} value={t}>{tCat(t)}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  {tr('Trajanje (min)', 'Duration (min)')}
                </label>
                <div className="grid grid-cols-5 gap-1.5 font-mono telemetry-num">
                  {[30, 45, 60, 90, 120].map(d => (
                    <button key={d} onClick={() => setGenDuration(d)} className={`py-2 rounded-lg text-xs font-bold transition-all border ${genDuration === d ? 'bg-volt-400 text-zinc-950 border-volt-400 shadow-volt-glow' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest mb-2 flex justify-between">
                  <span>{tr('Faktor Težine', 'Difficulty Level')}</span>
                  <span className={genDifficulty > 3 ? 'text-rose-400' : genDifficulty < 3 ? 'text-sky-400' : 'text-volt-400'}>
                    {genDifficulty === 1
                      ? tr('Vrlo lagano', 'Very Easy')
                      : genDifficulty === 2
                      ? tr('Lagano', 'Easy')
                      : genDifficulty === 3
                      ? tr('Srednje', 'Moderate')
                      : genDifficulty === 4
                      ? tr('Teško', 'Hard')
                      : tr('Ekstremno', 'Extreme')}
                  </span>
                </label>
                <input 
                  type="range" 
                  min="1" max="5" 
                  value={genDifficulty} 
                  onChange={e => setGenDifficulty(parseInt(e.target.value))}
                  className="w-full accent-lime-400 h-2 bg-zinc-950 rounded-lg appearance-none cursor-pointer border border-zinc-800" 
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-600 font-bold px-1 mt-1">
                  <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                </div>
              </div>
            </div>

            <div className="mt-7 flex gap-2.5">
              <button onClick={() => setShowGeneratorModal(false)} className="flex-1 py-2.5 bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 text-zinc-300 font-mono text-xs uppercase tracking-wider font-bold rounded-lg transition-colors">
                {tr('Odustani', 'Cancel')}
              </button>
              <button onClick={handleGenerate} className="flex-1 py-2.5 bg-volt-400 hover:bg-volt-300 text-zinc-950 font-mono text-xs uppercase tracking-wider font-bold rounded-lg transition-all shadow-volt-glow">
                {tr('Generiraj', 'Generate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

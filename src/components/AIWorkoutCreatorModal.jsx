import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, Sparkles, Upload, Loader2, Play, CalendarPlus, Database,
  Check, AlertCircle, Image as ImageIcon, Zap, Edit3, Trash2,
  Clock, Activity, RefreshCw, ZoomIn
} from 'lucide-react';
import { recreateWorkoutWithAi } from '../services/geminiService';
import { processFileForAi, formatFileSize } from '../services/aiFilesStorage';
import { parseIntervalsCode, categorizeWorkout, calculateCategoryDifficulty } from '../utils/workoutParser';
import { buildErgVibeWorkoutObject } from './ai/AIMarkdown';
import { supabase } from '../services/supabaseClient';

function getZoneBarColor(powerPct) {
  if (powerPct < 56) return '#71717a'; // Z1 Siva
  if (powerPct < 76) return '#0284c7'; // Z2 Plava
  if (powerPct < 91) return '#10b981'; // Z3 Zelena
  if (powerPct < 106) return '#f59e0b'; // Z4 Žuta
  if (powerPct < 121) return '#f43f5e'; // Z5 Crvena/Narančasta
  return '#a855f7'; // Z6+ Ljubičasta
}

export default function AIWorkoutCreatorModal({
  isOpen,
  onClose,
  athleteProfile,
  onAddWorkoutToCalendar,
  onStartWorkoutInTrainer,
  userId
}) {
  const ftp = Number(athleteProfile?.ftp) || 270;

  const [attachedImage, setAttachedImage] = useState(null); // { dataUrl, dataBase64, type, size, name }
  const [descriptionInput, setDescriptionInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [analysisText, setAnalysisText] = useState('');

  // Generirani podaci treninga
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('VO2max');
  const [code, setCode] = useState('');
  const [targetTss, setTargetTss] = useState(76);
  const [targetDuration, setTargetDuration] = useState(60);

  // Statusi spremanja
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [scheduleSuccess, setScheduleSuccess] = useState(false);
  const [librarySuccess, setLibrarySuccess] = useState(false);
  const [isSavingLibrary, setIsSavingLibrary] = useState(false);
  const [showImageZoom, setShowImageZoom] = useState(false);

  const fileInputRef = useRef(null);

  // Podrška za lijepljenje slike (Ctrl+V) bilo gdje unutar modala
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (blob) {
            try {
              setIsProcessing(true);
              setErrorMessage(null);
              const processed = await processFileForAi(blob);
              setAttachedImage(processed);
            } catch (err) {
              setErrorMessage(err.message || 'Neuspjelo lijepljenje slike.');
            } finally {
              setIsProcessing(false);
            }
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isOpen]);

  // Resetiraj stanje pri zatvaranju
  useEffect(() => {
    if (!isOpen) {
      setAttachedImage(null);
      setDescriptionInput('');
      setErrorMessage(null);
      setAnalysisText('');
      setTitle('');
      setCode('');
      setScheduleSuccess(false);
      setLibrarySuccess(false);
    }
  }, [isOpen]);

  // Parsiraj trenutni Intervals.icu kod u realnom vremenu
  const parsedStats = useMemo(() => {
    if (!code) return null;
    return parseIntervalsCode(code, ftp);
  }, [code, ftp]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      setErrorMessage(null);
      const processed = await processFileForAi(file);
      setAttachedImage(processed);
    } catch (err) {
      setErrorMessage(err.message || 'Greška pri odabiru datoteke.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeconstruct = async () => {
    if (!attachedImage && !descriptionInput.trim()) {
      setErrorMessage('Priložite sliku treninga ili upišite opis strukture.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setAnalysisText('');

    try {
      const aiResponse = await recreateWorkoutWithAi({
        imageBase64: attachedImage?.dataBase64 || null,
        mimeType: attachedImage?.type || 'image/jpeg',
        description: descriptionInput,
        athleteProfile
      });

      // Izdvoji ```workout ... ``` blok iz odgovora
      const match = aiResponse.match(/```(?:workout|ergvibe-workout)\s*([\s\S]*?)```/i);
      const rawBlock = match ? match[1].trim() : aiResponse;

      // Izdvoji analitički uvod prije bloka
      const introText = match && match.index > 0 ? aiResponse.slice(0, match.index).trim() : '';
      setAnalysisText(introText);

      // Parsiraj naslov, kategoriju, TSS i korake iz koda
      let extractedTitle = 'AI Rekreirani Trening';
      let extractedCategory = 'VO2max';
      let extractedDuration = 60;
      let extractedTss = 75;
      const stepLines = [];

      const lines = rawBlock.split(/\r?\n/);
      let inSteps = false;

      lines.forEach(l => {
        const t = l.trim();
        if (/^TITLE:/i.test(t)) {
          extractedTitle = t.replace(/^TITLE:\s*/i, '').trim();
        } else if (/^CATEGORY:/i.test(t)) {
          extractedCategory = t.replace(/^CATEGORY:\s*/i, '').trim();
        } else if (/^DURATION:/i.test(t)) {
          extractedDuration = parseInt(t.replace(/^DURATION:\s*/i, '').replace(/m(in)?/i, ''), 10) || 60;
        } else if (/^TSS:/i.test(t)) {
          extractedTss = parseInt(t.replace(/^TSS:\s*/i, ''), 10) || 75;
        } else if (/^STEPS:/i.test(t)) {
          inSteps = true;
        } else if (inSteps) {
          stepLines.push(l);
        } else if (t.startsWith('-') || /^\d+\s*x/i.test(t) || t === 'Zagrijavanje' || t === 'Glavni dio' || t === 'Hlađenje' || t.startsWith('Set')) {
          stepLines.push(l);
        }
      });

      const cleanCode = stepLines.join('\n').trim();

      setTitle(extractedTitle);
      setCategory(extractedCategory);
      setTargetDuration(extractedDuration);
      setTargetTss(extractedTss);
      setCode(cleanCode || rawBlock);
    } catch (err) {
      setErrorMessage(err.message || 'Greška pri AI rekreaciji treninga.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Dodavanje u kalendar
  const handleAddToCalendar = async () => {
    if (!code || !onAddWorkoutToCalendar) return;

    try {
      const built = buildErgVibeWorkoutObject({
        title: title.trim() || 'AI Trening',
        category,
        intervalsCode: code,
        durationMinutes: targetDuration,
        estimatedTss: targetTss,
        date: scheduleDate,
        ftp
      });

      await onAddWorkoutToCalendar(built);
      setScheduleSuccess(true);
      setTimeout(() => setScheduleSuccess(false), 2500);
    } catch (err) {
      setErrorMessage(err.message || 'Greška pri dodavanju u kalendar.');
    }
  };

  // Pokretanje direktno u trenažeru
  const handleStartInTrainer = () => {
    if (!code || !onStartWorkoutInTrainer) return;

    const built = buildErgVibeWorkoutObject({
      title: title.trim() || 'AI Trening',
      category,
      intervalsCode: code,
      durationMinutes: targetDuration,
      estimatedTss: targetTss,
      date: scheduleDate,
      ftp
    });

    onStartWorkoutInTrainer(built);
    onClose();
  };

  // Spremanje u lokalnu / Supabase knjižnicu treninga
  const handleSaveToLibrary = async () => {
    if (!code) return;
    setIsSavingLibrary(true);

    try {
      const built = buildErgVibeWorkoutObject({
        title: title.trim() || 'AI Trening',
        category,
        intervalsCode: code,
        durationMinutes: targetDuration,
        estimatedTss: targetTss,
        ftp
      });

      const categoryResolved = category || categorizeWorkout(built.steps) || 'Custom';
      const difficulty = calculateCategoryDifficulty(built.steps, categoryResolved);

      const payload = {
        title: title.trim() || 'AI Trening',
        description: code,
        duration_seconds: built.duration_seconds || 3600,
        category: categoryResolved,
        difficulty_score: difficulty,
        steps: built.steps,
        created_at: new Date().toISOString()
      };

      if (userId && userId !== 'guest') {
        const { error } = await supabase.from('workouts').insert([{ ...payload, user_id: userId }]);
        if (error) throw error;
      } else {
        const existing = JSON.parse(localStorage.getItem('ergvibe_local_library_workouts') || '[]');
        const newRecord = { ...payload, id: `local_lib_${Date.now()}` };
        localStorage.setItem('ergvibe_local_library_workouts', JSON.stringify([newRecord, ...existing]));
      }

      setLibrarySuccess(true);
      setTimeout(() => setLibrarySuccess(false), 2500);
    } catch (err) {
      setErrorMessage(err.message || 'Greška pri spremanju u knjižnicu.');
    } finally {
      setIsSavingLibrary(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-zinc-950/85 backdrop-blur-md animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
        
        {/* MODAL HEADER */}
        <div className="px-5 py-3.5 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-volt-400/10 border border-volt-400/30 text-volt-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold uppercase tracking-wider text-zinc-100 flex items-center gap-2">
                AI Workout Creator · Iz Slike ili Opisa
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-volt-400/20 text-volt-300 border border-volt-400/30">
                  FLAGSHIP
                </span>
              </h2>
              <p className="text-xs text-zinc-400 hidden sm:block">
                Pretvara snimku zaslona (TrainerRoad, Zwift, Garmin, TP) ili opis u 100% precizan, izvediv trenažni workout.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL CONTENT GRID */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 custom-scrollbar">
          
          {/* LIJEVA KOLONA: UNOS SLIKE I SMJERNICA */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            
            {/* DROPZONE ZA SLIKU */}
            <div className="carbon-panel rounded-xl p-4 border border-zinc-800/80 flex flex-col gap-3">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between">
                <span>1. Snimka zaslona treninga</span>
                <span className="text-[10px] text-zinc-500 font-normal">Podržano: Ctrl+V / JPG / PNG</span>
              </span>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
              />

              {!attachedImage ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-700/80 hover:border-volt-400/50 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-950/80 group min-h-[140px]"
                >
                  <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 group-hover:text-volt-400 group-hover:border-volt-400/40 transition-all mb-2">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-semibold text-zinc-200">
                    Kliknite za odabir ili zalijepite (<kbd className="font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-700 text-volt-300">Ctrl+V</kbd>)
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Zwift, TrainerRoad grafikon, TrainingPeaks ili foto s mobitela
                  </p>
                </div>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950 p-2 flex flex-col gap-2 group">
                  <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black/60 flex items-center justify-center">
                    <img
                      src={attachedImage.dataUrl}
                      alt={attachedImage.name}
                      className="max-h-full max-w-full object-contain cursor-pointer"
                      onClick={() => setShowImageZoom(true)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowImageZoom(true)}
                      className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-zinc-950/80 text-zinc-300 hover:text-volt-400 transition-colors"
                      title="Povećaj sliku"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ImageIcon className="w-3.5 h-3.5 text-volt-400 shrink-0" />
                      <span className="text-xs font-medium text-zinc-200 truncate">{attachedImage.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500">({formatFileSize(attachedImage.size)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachedImage(null)}
                      className="p-1 text-zinc-500 hover:text-rose-400 rounded transition-colors"
                      title="Ukloni sliku"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* OPIS ILI UPUTA */}
            <div className="carbon-panel rounded-xl p-4 border border-zinc-800/80 flex flex-col gap-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                2. Dodatni opis ili specifikacija (Opcionalno)
              </span>
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="Npr. 'TrainerRoad Anticosti, 3 seta po 5 intervala, 76 TSS' ili ostavite prazno za automatsko očitavanje..."
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-volt-400 outline-none resize-none"
              />

              {/* Brzi primjeri / čipovi */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDescriptionInput('TrainerRoad Anticosti, 3 seta po 5 intervala VO2max, 76 TSS, 60 min.')}
                  className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] text-zinc-300 hover:text-volt-300 transition-colors"
                >
                  ⚡ TR Anticosti (3x5)
                </button>
                <button
                  type="button"
                  onClick={() => setDescriptionInput('Carson Sweet Spot, 6x 5-7 min @ 88-94% FTP s 2 min odmora, 60 min.')}
                  className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] text-zinc-300 hover:text-volt-300 transition-colors"
                >
                  💛 Carson (6x SweetSpot)
                </button>
                <button
                  type="button"
                  onClick={() => setDescriptionInput(`Prilagodi točno mom FTP-u od ${ftp} W i zadrži točno trajanje sa slike.`)}
                  className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] text-zinc-300 hover:text-volt-300 transition-colors"
                >
                  🎯 FTP {ftp}W kalibracija
                </button>
              </div>
            </div>

            {/* CTA GUMB ZA ANALIZU */}
            <button
              type="button"
              onClick={handleDeconstruct}
              disabled={isProcessing || (!attachedImage && !descriptionInput.trim())}
              className="w-full py-3.5 rounded-xl bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 transition-all shadow-volt-glow cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                  <span>AI dekonstruira grafikon & broji intervale...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Dekonstruiraj i generiraj workout</span>
                </>
              )}
            </button>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* DESNA KOLONA: INTERAKTIVNI PREGLED I UREĐIVAČ */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            
            {code ? (
              <div className="carbon-panel rounded-xl p-4 md:p-5 border border-zinc-800/80 flex flex-col gap-4 animate-in fade-in">
                
                {/* ZAGLAVLJE REZULTATA */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold block mb-1">
                      Naziv Treninga
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm font-bold text-zinc-100 focus:border-volt-400 outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold block mb-1">
                        Kategorija
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-volt-400 focus:border-volt-400 outline-none uppercase"
                      >
                        <option value="VO2max">VO2max</option>
                        <option value="SweetSpot">SweetSpot</option>
                        <option value="Threshold">Threshold</option>
                        <option value="Endurance">Endurance</option>
                        <option value="Anaerobic">Anaerobic</option>
                        <option value="Recovery">Recovery</option>
                      </select>
                    </div>

                    <div className="text-right">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold block mb-1">
                        Metrike
                      </span>
                      <div className="flex items-center gap-2 font-mono text-xs font-bold text-zinc-200">
                        <span className="flex items-center gap-1 text-volt-300">
                          <Clock className="w-3.5 h-3.5" />
                          {parsedStats?.duration ? Math.round(parsedStats.duration / 60) : targetDuration} min
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="flex items-center gap-1 text-sky-400">
                          <Activity className="w-3.5 h-3.5" />
                          {parsedStats?.tss || targetTss} TSS
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* VIZUALNI STUPČASTI GRAFIKON */}
                {parsedStats && parsedStats.allSteps?.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                      Vizualni Profil Interval Snage (% FTP)
                    </span>
                    <div className="h-28 bg-zinc-950/90 rounded-lg border border-zinc-800 p-2 flex items-end gap-[1px] overflow-hidden">
                      {parsedStats.allSteps.map((st, idx) => {
                        const totalDurSec = parsedStats.duration || 3600;
                        const widthPct = Math.max(0.6, ((st.duration || 60) / totalDurSec) * 100);
                        const heightPct = Math.min(100, Math.max(12, ((st.power || 50) / 150) * 100));
                        const color = getZoneBarColor(st.power || 50);

                        return (
                          <div
                            key={idx}
                            style={{
                              width: `${widthPct}%`,
                              height: `${heightPct}%`,
                              backgroundColor: color
                            }}
                            className="rounded-t-sm transition-all hover:opacity-80"
                            title={`${st.text || 'Korak'}: ${Math.round((st.duration || 60) / 60)}m @ ${st.power}% FTP`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* INTERAKTIVNI EDITOR INTERVALS.ICU KODA */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold flex items-center gap-1">
                      <Edit3 className="w-3.5 h-3.5 text-volt-400" /> Koraci Treninga (Uredi minute ili ponavljanja)
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">Promjene se odmah iscrtavaju na grafikonu</span>
                  </div>
                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    rows={8}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-xs text-zinc-100 focus:border-volt-400 outline-none leading-relaxed custom-scrollbar"
                  />
                </div>

                {/* AKCIJSKI GUMBI */}
                <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-zinc-200 focus:border-volt-400 outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddToCalendar}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-xs font-bold text-zinc-100 flex items-center gap-1.5 transition-colors"
                    >
                      {scheduleSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <CalendarPlus className="w-3.5 h-3.5 text-volt-400" />}
                      <span>{scheduleSuccess ? 'Zabilježeno!' : 'Dodaj u kalendar'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveToLibrary}
                      disabled={isSavingLibrary}
                      className="px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-xs font-bold text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 transition-colors"
                    >
                      {librarySuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Database className="w-3.5 h-3.5 text-sky-400" />}
                      <span>{librarySuccess ? 'Spremljeno!' : 'U knjižnicu'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStartInTrainer}
                      className="px-4 py-2 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs flex items-center gap-1.5 transition-all shadow-volt-glow cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Pokreni u trenažeru</span>
                    </button>
                  </div>
                </div>

              </div>
            ) : (
              <div className="carbon-panel rounded-xl p-8 border border-zinc-800/80 flex flex-col items-center justify-center text-center my-auto min-h-[300px]">
                <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-600 mb-3">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-200 mb-1">
                  Studio Čeka Vaš Trening
                </h3>
                <p className="text-xs text-zinc-500 max-w-md leading-relaxed">
                  Priložite snimku zaslona s lijeve strane (ili zalijepite pomoću <span className="font-mono text-zinc-400">Ctrl+V</span>). AI će precizno očitati naziv, zone, trajanje i broj intervala te ih pretvoriti u interaktivni profil.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* LIGHTBOX MODAL ZA ZOOM SLIKE */}
      {showImageZoom && attachedImage && (
        <div
          onClick={() => setShowImageZoom(false)}
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img
            src={attachedImage.dataUrl}
            alt="Povećana slika"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Bot, Send, Loader2, CalendarPlus, Trash2, BookOpen,
  History, ClipboardList, MessageSquare, Upload, Plus, Check,
  AlertCircle, Zap, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Shield
} from 'lucide-react';
import {
  chatWithAICoach,
  generateStructuredTrainingPlan,
  getGeminiConfigStatus
} from '../services/geminiService';
import {
  BUILT_IN_KNOWLEDGE_MODULES,
  getDisabledModuleIds,
  toggleBuiltInModule,
  getCustomKnowledgeSources,
  addCustomKnowledgeSource,
  removeCustomKnowledgeSource
} from '../services/aiKnowledgeBase';
import {
  getHistoricalDashboardStats,
  importIntervalsCsvText,
  getHistoryOptions,
  setIncludeCoachArchive
} from '../services/historyService';
import AIMarkdown, { AIWorkoutCard, buildErgVibeWorkoutObject } from './ai/AIMarkdown';

const STORAGE_KEY_CHAT = 'ergvibe_ai_coach_chat_v1';
const STORAGE_KEY_PLAN = 'ergvibe_ai_saved_plan_v1';

const QUICK_PROMPTS = [
  'Analiziraj moja zadnja 2 tjedna treninga, trenutni CTL/TSB i reci mi u kakvom sam stanju.',
  'Usporedi moju Z2 aerobnu efikasnost (EF) i decoupling u 2026. s prethodnim sezonama (2019.–2025.).',
  'Predloži mi optimalan strukturirani trening za danas na trenažeru (60 min) s obzirom na zadnje vožnje.',
  'Kako mogu podići FTP s trenutne razine prema mom rekordu od 291W uz 4 treninga tjedno?'
];

function addDaysIso(baseDateIso, daysToAdd) {
  const [y, m, d] = baseDateIso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + daysToAdd);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default function AICoachTab({
  profile,
  workouts = [],
  wellnessData = {},
  userId = null,
  onAddWorkoutToCalendar,
  onStartWorkoutInTrainer
}) {
  const [subTab, setSubTab] = useState('chat'); // 'chat' | 'planner' | 'knowledge'
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [includeCoachArchive, setIncludeCoachArchiveState] = useState(() => getHistoryOptions(userId).includeBaseHistory);

  // --- CHAT STATE ---
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_CHAT) || '[]');
    } catch {
      return [];
    }
  });
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState(null);
  const chatEndRef = useRef(null);

  // --- PLANNER STATE ---
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [planGoal, setPlanGoal] = useState('Podizanje FTP-a i Sweet Spot izdržljivosti');
  const [planWeeks, setPlanWeeks] = useState(2);
  const [planWorkoutsPerWeek, setPlanWorkoutsPerWeek] = useState(4);
  const [planHours, setPlanHours] = useState(profile?.hoursPerWeek || 6);
  const [planMethodology, setPlanMethodology] = useState('Polarizirani / Piramidalni (80/20)');
  const [planStartDate, setPlanStartDate] = useState(tomorrowIso);
  const [planNotes, setPlanNotes] = useState('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [generatedPlan, setGeneratedPlan] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_PLAN) || 'null');
    } catch {
      return null;
    }
  });
  const [allPlanAdded, setAllPlanAdded] = useState(false);

  // --- KNOWLEDGE & HISTORY STATE ---
  const [histStats, setHistStats] = useState(null);
  const [disabledModules, setDisabledModules] = useState(() => getDisabledModuleIds());
  const [customSources, setCustomSources] = useState(() => getCustomKnowledgeSources());
  const [expandedModuleId, setExpandedModuleId] = useState(null);
  const [newSourceTitle, setNewSourceTitle] = useState('');
  const [newSourceAuthor, setNewSourceAuthor] = useState('');
  const [newSourceContent, setNewSourceContent] = useState('');
  const [showAddSourceForm, setShowAddSourceForm] = useState(false);
  const [csvImportStatus, setCsvImportStatus] = useState(null);
  const csvInputRef = useRef(null);
  const txtSourceInputRef = useRef(null);

  const geminiStatus = getGeminiConfigStatus();
  const ftp = Number(profile?.ftp) || 270;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(messages.slice(-30)));
    } catch {
      // ignore quota warning
    }
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSendingChat]);

  useEffect(() => {
    let active = true;
    getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive }).then(st => {
      if (active) setHistStats(st);
    });
    return () => { active = false; };
  }, [workouts, userId, includeCoachArchive]);

  const handleToggleCoachArchive = (checked) => {
    setIncludeCoachArchive(checked, userId);
    setIncludeCoachArchiveState(checked);
  };

  const sendMessage = async (textOverride) => {
    const content = (textOverride ?? chatInput).trim();
    if (!content || isSendingChat) return;

    setChatError(null);
    const nextMessages = [...messages, { role: 'user', text: content }];
    setMessages(nextMessages);
    if (!textOverride) setChatInput('');
    setIsSendingChat(true);

    try {
      const reply = await chatWithAICoach({
        messages: nextMessages,
        athleteProfile: profile,
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });
      setMessages([...nextMessages, { role: 'model', text: reply }]);
    } catch (err) {
      setChatError(err.message || 'Greška u komunikaciji s Gemini AI.');
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleClearChat = () => {
    if (messages.length > 0 && !window.confirm('Očistiti trenutni razgovor s AI Trenerom?')) return;
    setMessages([]);
    setChatError(null);
    localStorage.removeItem(STORAGE_KEY_CHAT);
  };

  const handleGeneratePlan = async (e) => {
    if (e) e.preventDefault();
    setIsGeneratingPlan(true);
    setPlanError(null);
    setAllPlanAdded(false);

    try {
      const plan = await generateStructuredTrainingPlan({
        goal: planGoal,
        weeks: Number(planWeeks),
        workoutsPerWeek: Number(planWorkoutsPerWeek),
        hoursPerWeek: Number(planHours),
        methodology: planMethodology,
        startDate: planStartDate,
        notes: planNotes,
        athleteProfile: profile,
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });
      const planWithMeta = { ...plan, startDate: planStartDate, generatedAt: new Date().toISOString() };
      setGeneratedPlan(planWithMeta);
      localStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(planWithMeta));
    } catch (err) {
      setPlanError(err.message || 'Greška pri generiranju trening plana.');
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleAddEntirePlanToCalendar = async () => {
    if (!generatedPlan?.weeks || !onAddWorkoutToCalendar) return;
    const baseStart = generatedPlan.startDate || planStartDate;

    for (const wk of generatedPlan.weeks) {
      for (const w of wk.workouts || []) {
        const targetDate = addDaysIso(baseStart, Number(w.dayOffset || 0));
        const built = buildErgVibeWorkoutObject({
          title: w.title,
          category: w.category,
          intervalsCode: w.intervalsCode,
          steps: w.steps,
          durationMinutes: w.durationMinutes,
          estimatedTss: w.estimatedTss,
          date: targetDate,
          ftp
        });
        await onAddWorkoutToCalendar(built);
      }
    }
    setAllPlanAdded(true);
    setTimeout(() => setAllPlanAdded(false), 4000);
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importIntervalsCsvText(text, userId);
      const updatedStats = await getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive });
      setHistStats(updatedStats);
      setCsvImportStatus({
        type: 'success',
        msg: `Uspješno obrađeno! Dodano ${res.addedCount} novih treninga (ukupno u bazi: ${res.totalCount}).`
      });
    } catch (err) {
      setCsvImportStatus({ type: 'error', msg: err.message });
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const handleTxtFileLoad = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!newSourceTitle) {
        setNewSourceTitle(file.name.replace(/\.[^.]+$/, ''));
      }
      setNewSourceContent(prev => (prev ? prev + '\n\n' + text : text));
    } catch (err) {
      alert('Greška pri čitanju datoteke: ' + err.message);
    } finally {
      if (txtSourceInputRef.current) txtSourceInputRef.current.value = '';
    }
  };

  const handleSaveCustomSource = (e) => {
    e.preventDefault();
    try {
      const updated = addCustomKnowledgeSource({
        title: newSourceTitle,
        author: newSourceAuthor,
        content: newSourceContent
      });
      setCustomSources(updated);
      setNewSourceTitle('');
      setNewSourceAuthor('');
      setNewSourceContent('');
      setShowAddSourceForm(false);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 animate-in fade-in pb-8">
      {/* GORNJI HEADER + SUB-NAVIGATION */}
      <div className="bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-4 md:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-500 text-zinc-950 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.3)] shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg md:text-xl font-black text-zinc-100 tracking-tight">ErgVibe AI Trener</h2>
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                geminiStatus.configured
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
              }`}>
                {geminiStatus.configured ? '● Gemini Spojen' : '○ Ključ nedostaje'}
              </span>
              {histStats && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  {histStats.totalWorkouts} treninga u memoriji
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Osobni biciklistički fiziolog s uvidom u tvoju bazu (2019.–2026.), Coggan/Friel/Seiler literaturu i live kalendar
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-zinc-950/80 p-1 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => setSubTab('chat')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                subTab === 'chat'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> AI Konzultacije
            </button>
            <button
              type="button"
              onClick={() => setSubTab('planner')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                subTab === 'planner'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" /> Planer Treninga
            </button>
            <button
              type="button"
              onClick={() => setSubTab('knowledge')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                subTab === 'knowledge'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Baza Znanja & Povijest
            </button>
          </div>

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title="Odaberi Gemini model"
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-bold text-zinc-300 focus:border-cyan-500 outline-none"
          >
            <option value="gemini-3.8-flash">⚡ Gemini Flash (Ekonomičan & Brzi)</option>
            {geminiStatus.source === 'custom' ? (
              <option value="gemini-3.1-pro-preview">🧠 Gemini Pro (Dubinska analiza - tvoj ključ)</option>
            ) : (
              <option value="gemini-3.8-flash" disabled className="text-zinc-600">
                🔒 Gemini Pro (Dostupan uz vlastiti ključ u tabu Veze)
              </option>
            )}
          </select>
        </div>
      </div>

      {/* =====================================================================
          1. SUB-TAB: AI KONZULTACIJE (CHAT)
         ===================================================================== */}
      {subTab === 'chat' && (
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl flex flex-col min-h-[560px] max-h-[75vh] overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800/80 bg-zinc-950/40 flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-400">
              Pitaj bilo što o svojim treninzima, zonama, napretku ili zatraži gotov trening za trenažer
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClearChat}
                className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Očisti chat
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar">
            {messages.length === 0 && !isSendingChat && (
              <div className="h-full flex flex-col items-center justify-center py-8 text-center max-w-2xl mx-auto">
                <div className="p-4 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-4">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-black text-zinc-100 mb-1">
                  Spreman za analizu, {profile?.username || 'Vozač'}!
                </h3>
                <p className="text-xs md:text-sm text-zinc-400 mb-6">
                  Učitao sam tvoje povijesne treninge od 2019. do danas, trenutni FTP ({ftp} W) i kalendar. Odaberi jedno od brzih pitanja ili upiši vlastiti upit:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                  {QUICK_PROMPTS.map((qp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessage(qp)}
                      className="p-3.5 rounded-xl bg-zinc-950/70 hover:bg-zinc-800/80 border border-zinc-800 hover:border-cyan-500/40 text-xs text-zinc-300 hover:text-zinc-100 font-medium transition-all flex items-start gap-2.5 group"
                    >
                      <Zap className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <span>{qp}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-2xl p-4 ${
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-500/20 to-emerald-500/15 border border-cyan-500/30 text-zinc-100'
                      : 'bg-zinc-950/80 border border-zinc-800/90 text-zinc-200 w-full'
                  }`}
                >
                  {m.role === 'model' ? (
                    <AIMarkdown
                      text={m.text}
                      ftp={ftp}
                      onAddWorkoutToCalendar={onAddWorkoutToCalendar}
                      onStartWorkoutInTrainer={onStartWorkoutInTrainer}
                    />
                  ) : (
                    <p className="text-sm font-medium whitespace-pre-wrap">{m.text}</p>
                  )}
                </div>
              </div>
            ))}

            {isSendingChat && (
              <div className="flex justify-start">
                <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3 text-xs font-bold text-cyan-300">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  AI Trener analizira podatke i priprema odgovor...
                </div>
              </div>
            )}

            {chatError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{chatError}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="p-3 md:p-4 bg-zinc-950/80 border-t border-zinc-800/80 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isSendingChat}
              placeholder="Npr. 'Usporedi moj jučerašnji trening s prošlim mjesecom' ili 'Složi mi Sweet Spot od 75 min'..."
              className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-500 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSendingChat || !chatInput.trim()}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-40 text-zinc-950 font-black text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(34,211,238,0.25)] shrink-0"
            >
              {isSendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="hidden sm:inline">Pošalji</span>
            </button>
          </form>
        </div>
      )}

      {/* =====================================================================
          2. SUB-TAB: GENERATOR TRENING PLANA
         ===================================================================== */}
      {subTab === 'planner' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lijeva kolona: Postavke plana */}
          <form
            onSubmit={handleGeneratePlan}
            className="lg:col-span-5 bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-5 md:p-6 space-y-4 shadow-xl"
          >
            <div className="border-b border-zinc-800 pb-3">
              <h3 className="text-base font-black text-zinc-100 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-cyan-400" /> Generator Strukturiranog Plana
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                AI kreira plan prema tvom FTP-u ({ftp} W), trenutnom CTL/TSB zamoru i 8-godišnjoj povijesti
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-zinc-400 mb-1.5">
                Glavni cilj ciklusa
              </label>
              <input
                type="text"
                value={planGoal}
                onChange={(e) => setPlanGoal(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs md:text-sm text-zinc-100 focus:border-cyan-500 outline-none"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  'Podizanje FTP-a i praga',
                  'Z2 Aerobna baza i izdržljivost',
                  'VO2 Max probijanje platoa',
                  'Održavanje uz manji umor'
                ].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPlanGoal(preset)}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                  Trajanje
                </label>
                <select
                  value={planWeeks}
                  onChange={(e) => setPlanWeeks(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-500"
                >
                  <option value={1}>1 tjedan</option>
                  <option value={2}>2 tjedna</option>
                  <option value={3}>3 tjedna</option>
                  <option value={4}>4 tjedna (Mezo)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                  Treninga / tj.
                </label>
                <select
                  value={planWorkoutsPerWeek}
                  onChange={(e) => setPlanWorkoutsPerWeek(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-500"
                >
                  {[2, 3, 4, 5, 6].map(n => (
                    <option key={n} value={n}>{n}x tjedno</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                  Sati / tjedno
                </label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  step={0.5}
                  value={planHours}
                  onChange={(e) => setPlanHours(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                  Trenerska metodologija
                </label>
                <select
                  value={planMethodology}
                  onChange={(e) => setPlanMethodology(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-500"
                >
                  <option value="Polarizirani 80/20 (Seiler)">Polarizirani 80/20 (Seiler)</option>
                  <option value="Piramidalni / Sweet Spot">Piramidalni / Sweet Spot</option>
                  <option value="Joe Friel Periodizacija">Joe Friel Periodizacija</option>
                  <option value="Coggan Threshold Fokus">Coggan Threshold Fokus</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                  Početni datum plana
                </label>
                <input
                  type="date"
                  value={planStartDate}
                  onChange={(e) => setPlanStartDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
                Posebne želje ili raspored dana (opcionalno)
              </label>
              <textarea
                rows={3}
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                placeholder="Npr. Utorkom i četvrtkom max 60 min na trenažeru, vikendom duža Z2 vožnja do 2h..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            {planError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {planError}
              </div>
            )}

            <button
              type="submit"
              disabled={isGeneratingPlan}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-50 text-zinc-950 font-black text-sm flex items-center justify-center gap-2 shadow-[0_4px_15px_rgba(34,211,238,0.25)] transition-all"
            >
              {isGeneratingPlan ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Slažem personalizirani plan...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Generiraj AI Trening Plan
                </>
              )}
            </button>
          </form>

          {/* Desna kolona: Prikaz generiranog plana */}
          <div className="lg:col-span-7 space-y-4">
            {isGeneratingPlan && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                <p className="text-sm font-bold text-zinc-200">
                  Kreiram strukturirane treninge s intervalima u % FTP-a...
                </p>
                <p className="text-xs text-zinc-500">
                  Ovo obično traje 5–12 sekundi ovisno o broju tjedana.
                </p>
              </div>
            )}

            {!isGeneratingPlan && !generatedPlan && (
              <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-10 text-center">
                <ClipboardList className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-zinc-300">Još nema generiranog plana</h4>
                <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                  Odaberi cilj i broj sati s lijeve strane. Svaki generirani trening moći ćeš jednim klikom dodati izravno u ErgVibe i Intervals.icu kalendar!
                </p>
              </div>
            )}

            {!isGeneratingPlan && generatedPlan && (
              <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-5 md:p-6 space-y-5 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-zinc-800 pb-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      AI Strukturirani Plan
                    </span>
                    <h3 className="text-lg md:text-xl font-black text-zinc-100 mt-2">
                      {generatedPlan.planTitle || 'Personalizirani Plan'}
                    </h3>
                    <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{generatedPlan.summary}</p>
                    {generatedPlan.physiologicalRationale && (
                      <p className="text-xs text-zinc-400 mt-2 bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3">
                        <strong className="text-cyan-400">Fiziološko obrazloženje: </strong>
                        {generatedPlan.physiologicalRationale}
                      </p>
                    )}
                  </div>

                  {onAddWorkoutToCalendar && (
                    <button
                      type="button"
                      onClick={handleAddEntirePlanToCalendar}
                      className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs transition-all border ${
                        allPlanAdded
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 border-cyan-400/30 shadow-[0_0_15px_rgba(34,211,238,0.25)]'
                      }`}
                    >
                      {allPlanAdded ? <Check className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
                      {allPlanAdded ? 'Cijeli plan je u Kalendaru!' : 'Upiši cijeli plan u Kalendar'}
                    </button>
                  )}
                </div>

                {(generatedPlan.weeks || []).map((wk, wIdx) => (
                  <div key={wIdx} className="space-y-2">
                    <div className="flex items-center justify-between bg-zinc-950/70 px-4 py-2.5 rounded-xl border border-zinc-800">
                      <div>
                        <span className="text-xs font-black uppercase tracking-wider text-cyan-400">
                          Tjedan {wk.weekNumber || wIdx + 1}
                        </span>
                        {wk.theme && <span className="text-xs font-bold text-zinc-300 ml-2">— {wk.theme}</span>}
                      </div>
                      {wk.targetTss && (
                        <span className="text-xs font-bold text-orange-400">Cilj: ~{wk.targetTss} TSS</span>
                      )}
                    </div>

                    {(wk.workouts || []).map((wo, idx) => {
                      const calcDate = addDaysIso(
                        generatedPlan.startDate || planStartDate,
                        Number(wo.dayOffset || 0)
                      );
                      return (
                        <AIWorkoutCard
                          key={idx}
                          structuredWorkout={{
                            title: `${wo.dayName ? wo.dayName + ': ' : ''}${wo.title}`,
                            category: wo.category,
                            intervalsCode: wo.intervalsCode,
                            steps: wo.steps,
                            durationMinutes: wo.durationMinutes,
                            estimatedTss: wo.estimatedTss,
                            coachNote: wo.coachNote || wo.description,
                            date: calcDate
                          }}
                          ftp={ftp}
                          onAddToCalendar={onAddWorkoutToCalendar}
                          onStartInTrainer={onStartWorkoutInTrainer}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          3. SUB-TAB: BAZA ZNANJA & 8-GODIŠNJA POVIJEST
         ===================================================================== */}
      {subTab === 'knowledge' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lijeva strana: 8-godišnja baza treninga */}
          <div className="lg:col-span-7 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-5 md:p-6 space-y-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-black text-zinc-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" /> Povijesna Baza Treninga (2019. – danas)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Automatski spojena CSV arhiva i svi novi treninzi iz ErgVibea i Intervals.icu
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all"
                >
                  <Upload className="w-3.5 h-3.5" /> Nadopuni CSV
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                />
              </div>
            </div>

            {csvImportStatus && (
              <div className={`p-3 rounded-xl text-xs font-bold border ${
                csvImportStatus.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {csvImportStatus.msg}
              </div>
            )}

            {/* Prekidač za trenersku referentnu arhivu */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-zinc-950/70 rounded-xl border border-zinc-800">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-zinc-200">Trenerska referentna arhiva (1.896 vožnji)</p>
                  <p className="text-[11px] text-zinc-400">
                    {includeCoachArchive
                      ? 'Uključena višegodišnja baza (2019.–2026.) kao referentni model za AI analizu i usporedbe.'
                      : 'Isključeno — AI analizira i planira isključivo prema vašem profilu i osobnim treninzima.'}
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={includeCoachArchive}
                  onChange={(e) => handleToggleCoachArchive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            {histStats && histStats.totalWorkouts > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-[10px] font-black uppercase text-zinc-500">Ukupno vožnji</span>
                    <p className="text-2xl font-black text-zinc-100 mt-0.5">{histStats.totalWorkouts}</p>
                  </div>
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-[10px] font-black uppercase text-zinc-500">Ukupni TSS</span>
                    <p className="text-2xl font-black text-orange-400 mt-0.5">{histStats.totalTss.toLocaleString('hr-HR')}</p>
                  </div>
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-[10px] font-black uppercase text-zinc-500">Rekordni FTP</span>
                    <p className="text-2xl font-black text-cyan-400 mt-0.5">{histStats.peakFtp} W</p>
                  </div>
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-[10px] font-black uppercase text-zinc-500">Z2 Prosj. EF</span>
                    <p className="text-2xl font-black text-emerald-400 mt-0.5">{histStats.benchmarks.z2AvgEfAllTime ?? '-'}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                      <tr>
                        <th className="px-3.5 py-2.5 font-black">Sezona</th>
                        <th className="px-3.5 py-2.5 font-black">Treninzi</th>
                        <th className="px-3.5 py-2.5 font-black">Sati</th>
                        <th className="px-3.5 py-2.5 font-black">Load (TSS)</th>
                        <th className="px-3.5 py-2.5 font-black">FTP raspon</th>
                        <th className="px-3.5 py-2.5 font-black">Z2 EF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {histStats.yearlyStats.slice().reverse().map(yr => (
                        <tr key={yr.year} className="hover:bg-zinc-900/40">
                          <td className="px-3.5 py-2.5 font-black text-zinc-100">{yr.year}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.count}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.hours} h</td>
                          <td className="px-3.5 py-2.5 font-bold text-orange-400">{yr.tss}</td>
                          <td className="px-3.5 py-2.5 text-cyan-300 font-semibold">
                            {yr.minFtp ? `${yr.minFtp}–${yr.maxFtp} W` : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-emerald-400 font-bold">{yr.avgZ2Ef ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-6 bg-zinc-950/40 rounded-xl border border-zinc-800/80 text-center space-y-2">
                <History className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-zinc-200">Nema učitanih povijesnih treninga za ovaj profil</h4>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  AI vaše treninge i planove korigira prema vašem zadanom FTP-u, težini, raspoloživom vremenu i odrađenim vožnjama na trenažeru.
                  Možete učitati svoj Intervals.icu CSV izvoz klikom na "Nadopuni CSV" iznad, ili uključiti trenersku referentnu arhivu.
                </p>
              </div>
            )}
          </div>

          {/* Desna strana: Trenerska literatura i vlastiti izvori */}
          <div className="lg:col-span-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-5 md:p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-black text-zinc-100 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" /> Baza Znanja (Literatura)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Izvori na kojima Gemini temelji analizu i periodizaciju
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSourceForm(v => !v)}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Dodaj izvor
              </button>
            </div>

            {showAddSourceForm && (
              <form onSubmit={handleSaveCustomSource} className="bg-zinc-950/90 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                    Novi izvor znanja (Knjiga / Sažetak / Protokol)
                  </span>
                  <button
                    type="button"
                    onClick={() => txtSourceInputRef.current?.click()}
                    className="text-[11px] font-bold text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Učitaj .TXT / .MD
                  </button>
                  <input
                    ref={txtSourceInputRef}
                    type="file"
                    accept=".txt,.md"
                    onChange={handleTxtFileLoad}
                    className="hidden"
                  />
                </div>
                <input
                  type="text"
                  required
                  value={newSourceTitle}
                  onChange={(e) => setNewSourceTitle(e.target.value)}
                  placeholder="Naslov knjige ili poglavlja (npr. Fast After 50 - Joe Friel)"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  value={newSourceAuthor}
                  onChange={(e) => setNewSourceAuthor(e.target.value)}
                  placeholder="Autor (opcionalno)"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
                <textarea
                  rows={5}
                  required
                  value={newSourceContent}
                  onChange={(e) => setNewSourceContent(e.target.value)}
                  placeholder="Zalijepi ključne principe, bilješke ili sažetak knjige koje želiš da AI Trener uvijek uzima u obzir..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500 resize-y"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddSourceForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-zinc-200"
                  >
                    Odustani
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs"
                  >
                    Spremi u Bazu Znanja
                  </button>
                </div>
              </form>
            )}

            {/* Ugrađeni moduli */}
            <div className="space-y-2.5">
              {BUILT_IN_KNOWLEDGE_MODULES.map(mod => {
                const isEnabled = !disabledModules.includes(mod.id);
                const isExpanded = expandedModuleId === mod.id;
                return (
                  <div
                    key={mod.id}
                    className={`rounded-xl border p-3.5 transition-all ${
                      isEnabled
                        ? 'bg-zinc-950/70 border-zinc-800'
                        : 'bg-zinc-950/30 border-zinc-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">
                          {mod.category}
                        </span>
                        <h4 className="text-xs md:text-sm font-bold text-zinc-100">{mod.title}</h4>
                        <p className="text-[11px] text-zinc-500 font-medium">{mod.author}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDisabledModules(toggleBuiltInModule(mod.id))}
                        className="text-cyan-400 hover:text-cyan-300 shrink-0"
                        title={isEnabled ? 'Isključi modul' : 'Uključi modul'}
                      >
                        {isEnabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6 text-zinc-600" />}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5">{mod.summary}</p>
                    <button
                      type="button"
                      onClick={() => setExpandedModuleId(isExpanded ? null : mod.id)}
                      className="mt-2 text-[11px] font-bold text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {isExpanded ? 'Sakrij sažetak pravila' : 'Prikaži ugrađena pravila'}
                    </button>
                    {isExpanded && (
                      <pre className="mt-2 p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto custom-scrollbar">
                        {mod.content}
                      </pre>
                    )}
                  </div>
                );
              })}

              {/* Korisnički dodani izvori */}
              {customSources.map(src => (
                <div key={src.id} className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400">
                        Vlastiti izvor
                      </span>
                      <h4 className="text-xs md:text-sm font-bold text-zinc-100">{src.title}</h4>
                      <p className="text-[11px] text-zinc-500">{src.author}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomSources(removeCustomKnowledgeSource(src.id))}
                      className="text-zinc-500 hover:text-rose-400 transition-colors p-1"
                      title="Ukloni izvor"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1.5 line-clamp-3">{src.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

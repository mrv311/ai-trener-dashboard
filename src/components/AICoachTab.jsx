import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Bot, Send, Loader2, CalendarPlus, Trash2, BookOpen,
  History, ClipboardList, MessageSquare, Upload, Plus, Check,
  AlertCircle, Zap, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Shield,
  FileText, ExternalLink, Video, Paperclip, X, Image as ImageIcon, Download, Eye,
  Activity
} from 'lucide-react';
import {
  chatWithAICoach,
  generateStructuredTrainingPlan,
  getGeminiConfigStatus,
  analyzeYouTubeVideoForKnowledgeBase
} from '../services/geminiService';
import {
  processFileForAi,
  saveAttachmentToLocalDB,
  getAttachmentFromLocalDB,
  clearAllAttachmentsFromLocalDB,
  formatFileSize
} from '../services/aiFilesStorage';
import {
  parsePdfFile,
  parseEpubFile,
  parseTextFile
} from '../services/documentParser';
import {
  BUILT_IN_KNOWLEDGE_MODULES,
  getDisabledModuleIds,
  toggleBuiltInModule,
  getCustomKnowledgeSources,
  addCustomKnowledgeSource,
  removeCustomKnowledgeSource,
  clearAllCustomKnowledgeSources
} from '../services/aiKnowledgeBase';
import {
  getHistoricalDashboardStats,
  importIntervalsCsvText,
  getHistoryOptions,
  setIncludeCoachArchive,
  getExtraImportedHistory,
  clearExtraImportedHistory
} from '../services/historyService';
import AIMarkdown, { AIWorkoutCard, buildErgVibeWorkoutObject } from './ai/AIMarkdown';

const STORAGE_KEY_CHAT = 'ergvibe_ai_coach_chat_v1';
const STORAGE_KEY_PLAN = 'ergvibe_ai_saved_plan_v1';

function YoutubeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" {...props}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

const QUICK_PROMPTS = [
  'Analiziraj moja zadnja 2 tjedna treninga, trenutni fitness (CTL) i formu (TSB).',
  'Analiziraj moju Z2 aerobnu efikasnost (EF) i aerobni decoupling (drift pulsa) na treninzima.',
  'Predloži mi optimalan strukturirani trening za danas na trenažeru (60 min) s obzirom na zadnje vožnje.',
  'Kako mogu optimalno strukturirati tjedan s 4 treninga za stabilan napredak i podizanje FTP-a?'
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
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [selectedPreviewAttachment, setSelectedPreviewAttachment] = useState(null);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const isFirstChatRender = useRef(true);

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
  const [extraCsvCount, setExtraCsvCount] = useState(() => getExtraImportedHistory(userId).length);
  const [expandedModuleId, setExpandedModuleId] = useState(null);
  const [newSourceTitle, setNewSourceTitle] = useState('');
  const [newSourceAuthor, setNewSourceAuthor] = useState('');
  const [newSourceCategory, setNewSourceCategory] = useState('Vlastita literatura');
  const [newSourceContent, setNewSourceContent] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [showAddSourceForm, setShowAddSourceForm] = useState(false);
  const [sourceImportMode, setSourceImportMode] = useState('upload'); // 'upload' | 'youtube' | 'manual'
  const [isProcessingSource, setIsProcessingSource] = useState(false);
  const [sourceProcessingStatus, setSourceProcessingStatus] = useState('');
  const [sourceProcessError, setSourceProcessError] = useState(null);
  const [youtubeInputUrl, setYoutubeInputUrl] = useState('');
  const [csvImportStatus, setCsvImportStatus] = useState(null);
  const csvInputRef = useRef(null);
  const docFileInputRef = useRef(null);

  useEffect(() => {
    setExtraCsvCount(getExtraImportedHistory(userId).length);
  }, [userId]);

  const geminiStatus = getGeminiConfigStatus();
  const ftp = Number(profile?.ftp) || 270;

  useEffect(() => {
    try {
      // Spremamo samo zadnjih 30 poruka i uklanjamo teške base64 stringove iz localStorage-a
      const lightweightMessages = messages.slice(-30).map(m => {
        if (!Array.isArray(m?.attachments) || m.attachments.length === 0) return m;
        return {
          ...m,
          attachments: m.attachments.map(({ id, name, type, size }) => ({ id, name, type, size }))
        };
      });
      localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(lightweightMessages));
    } catch {
      // ignore quota warning
    }
  }, [messages]);

  useEffect(() => {
    // Spriječi neželjeno scrollanje na učitavanju komponente koje bi gurnulo cijeli prozor prema dolje
    if (isFirstChatRender.current) {
      isFirstChatRender.current = false;
      return;
    }
    // Skrolaj samo unutrašnji spremnik chat poruka, bez pomicanja glavne stranice
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isSendingChat, chatError]);

  // Drži zaslon mobitela uključenim dok se čeka odgovor AI poslužitelja kako mobilni OS ne bi prekinuo vezu
  useEffect(() => {
    if (!isSendingChat && !isGeneratingPlan && !isProcessingSource) return;
    if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return;
    let sentinel = null;
    let cancelled = false;
    navigator.wakeLock.request('screen').then(lock => {
      if (cancelled) {
        lock.release().catch(() => {});
      } else {
        sentinel = lock;
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
      sentinel?.release?.().catch(() => {});
    };
  }, [isSendingChat, isGeneratingPlan, isProcessingSource]);

  useEffect(() => {
    let active = true;
    getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive }).then(st => {
      if (active) setHistStats(st);
    });
    return () => { active = false; };
  }, [workouts, userId, includeCoachArchive]);

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploadingFile(true);
    setChatError(null);

    try {
      const processed = [];
      for (const f of files) {
        const att = await processFileForAi(f);
        await saveAttachmentToLocalDB(att);
        processed.push({
          id: att.id,
          name: att.name,
          type: att.type,
          size: att.size,
          dataUrl: att.dataUrl,
          dataBase64: att.dataBase64
        });
      }
      setPendingAttachments(prev => [...prev, ...processed]);
    } catch (err) {
      setChatError(err.message || 'Greška pri čitanju datoteke.');
    } finally {
      setIsUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter(it => it.kind === 'file');
    if (fileItems.length === 0) return;

    setIsUploadingFile(true);
    setChatError(null);
    try {
      const processed = [];
      for (const it of fileItems) {
        const f = it.getAsFile();
        if (f) {
          const att = await processFileForAi(f);
          await saveAttachmentToLocalDB(att);
          processed.push({
            id: att.id,
            name: att.name || 'snimka_zaslona.png',
            type: att.type,
            size: att.size,
            dataUrl: att.dataUrl,
            dataBase64: att.dataBase64
          });
        }
      }
      setPendingAttachments(prev => [...prev, ...processed]);
    } catch (err) {
      setChatError(err.message || 'Greška pri lijepljenju datoteke.');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const removePendingAttachment = (id) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  };

  const sendMessage = async (textOverride) => {
    const content = (textOverride ?? chatInput).trim();
    if ((!content && pendingAttachments.length === 0) || isSendingChat) return;

    setChatError(null);
    const currentAttachments = [...pendingAttachments];
    setPendingAttachments([]);

    // Za trajno stanje i localStorage: čuvamo samo lagane metapodatke privitka
    const cleanAttachments = currentAttachments.map(({ id, name, type, size, dataUrl }) => ({
      id,
      name,
      type,
      size,
      dataUrl: type.startsWith('image/') ? dataUrl : undefined
    }));

    const prevMessages = [...messages];
    const nextUserMessage = {
      role: 'user',
      text: content,
      ...(cleanAttachments.length > 0 ? { attachments: cleanAttachments } : {})
    };
    const nextMessages = [...prevMessages, nextUserMessage];
    setMessages(nextMessages);
    if (!textOverride) setChatInput('');
    setIsSendingChat(true);

    // Za Gemini API: proslijedi poruke uključujući base64 podatke privitaka
    const messagesForGemini = [
      ...prevMessages,
      {
        role: 'user',
        text: content,
        attachments: currentAttachments
      }
    ];

    try {
      const reply = await chatWithAICoach({
        messages: messagesForGemini,
        athleteProfile: profile,
        liveWorkouts: workouts,
        wellnessData,
        model: selectedModel,
        userId
      });
      setMessages([...nextMessages, { role: 'model', text: reply }]);
    } catch (err) {
      setChatError(err.message || 'Greška u komunikaciji s Gemini AI.');
      setMessages(prevMessages);
      setPendingAttachments(currentAttachments);
      if (!textOverride) setChatInput(content);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleClearChat = async () => {
    if (messages.length > 0 && !window.confirm('Očistiti trenutni razgovor i sve priložene datoteke s AI Trenerom?')) return;
    setMessages([]);
    setPendingAttachments([]);
    setChatError(null);
    localStorage.removeItem(STORAGE_KEY_CHAT);
    try {
      await clearAllAttachmentsFromLocalDB();
    } catch (e) {
      console.warn('Greška pri čišćenju IndexedDB:', e);
    }
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
      setExtraCsvCount(res.totalExtraCount);
      const updatedStats = await getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive });
      setHistStats(updatedStats);
      setCsvImportStatus({
        type: 'success',
        msg: `Uspješno obrađeno! Dodano ${res.addedCount} novih treninga (ukupno u CSV bazi: ${res.totalExtraCount}).`
      });
    } catch (err) {
      setCsvImportStatus({ type: 'error', msg: err.message });
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const handleClearCsv = async () => {
    const count = getExtraImportedHistory(userId).length;
    if (count === 0) return;
    const confirmed = window.confirm(
      `Jeste li sigurni da želite ukloniti sve uvezene CSV treninge (${count} aktivnosti)?\n\nNakon brisanja ostat će samo vaše redovne vožnje zabilježene kroz aplikaciju ili ugrađenu bazu.`
    );
    if (!confirmed) return;

    clearExtraImportedHistory(userId);
    setExtraCsvCount(0);
    const updatedStats = await getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive });
    setHistStats(updatedStats);
    setCsvImportStatus({
      type: 'info',
      msg: `Uvezeni CSV podaci (${count} aktivnosti) su uspješno uklonjeni iz lokalne memorije.`
    });
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const handleDeleteCustomSource = (id, title) => {
    const confirmed = window.confirm(`Jeste li sigurni da želite ukloniti izvor "${title || 'Nepoznat'}" iz Baze Znanja?`);
    if (!confirmed) return;
    const updated = removeCustomKnowledgeSource(id);
    setCustomSources(updated);
  };

  const handleClearAllCustomSources = () => {
    if (!customSources.length) return;
    const confirmed = window.confirm(
      `Jeste li sigurni da želite obrisati sve vlastite dodane izvore (${customSources.length} izvora/knjiga)? Ova radnja je nepovratna.`
    );
    if (!confirmed) return;
    const updated = clearAllCustomKnowledgeSources();
    setCustomSources(updated);
  };

  const handleCancelAddSource = () => {
    setShowAddSourceForm(false);
    setSourceProcessError(null);
    setNewSourceTitle('');
    setNewSourceAuthor('');
    setNewSourceCategory('Vlastita literatura');
    setNewSourceContent('');
    setNewSourceUrl('');
    setYoutubeInputUrl('');
    if (docFileInputRef.current) docFileInputRef.current.value = '';
  };

  const handleDocumentFileLoad = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingSource(true);
    setSourceProcessError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'pdf') {
        setSourceProcessingStatus('Čitam PDF dokument i izvlačim tekst...');
        const res = await parsePdfFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'PDF literatura');
        setNewSourceContent(res.content || '');
      } else if (ext === 'epub') {
        setSourceProcessingStatus('Otvaram EPUB e-knjigu i pripremam poglavlja...');
        const res = await parseEpubFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'EPUB knjiga');
        setNewSourceContent(res.content || '');
      } else {
        setSourceProcessingStatus('Učitavam tekstualni dokument...');
        const res = await parseTextFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'Tekstualni dokument');
        setNewSourceContent(res.content || '');
      }
      setSourceImportMode('manual');
    } catch (err) {
      console.error('[AICoachTab] Greška pri parsiranju dokumenta:', err);
      setSourceProcessError('Greška pri čitanju datoteke: ' + (err.message || 'Nepoznata greška'));
    } finally {
      setIsProcessingSource(false);
      setSourceProcessingStatus('');
      if (docFileInputRef.current) docFileInputRef.current.value = '';
    }
  };

  const handleAnalyzeYouTube = async (e) => {
    if (e) e.preventDefault();
    if (!youtubeInputUrl.trim() || isProcessingSource) return;

    setIsProcessingSource(true);
    setSourceProcessError(null);
    setSourceProcessingStatus('Gemini AI gleda videozapis i priprema stručni trenerski sažetak...');

    try {
      const res = await analyzeYouTubeVideoForKnowledgeBase(youtubeInputUrl);
      setNewSourceTitle(res.title || 'YouTube predavanje');
      setNewSourceAuthor(res.author || 'YouTube');
      setNewSourceCategory(res.category || 'YouTube predavanje / podcast');
      setNewSourceUrl(res.sourceUrl || youtubeInputUrl);
      setNewSourceContent(res.content || '');
      setSourceImportMode('manual');
    } catch (err) {
      console.error('[AICoachTab] Greška pri analizi YouTube videa:', err);
      setSourceProcessError(
        'Gemini nije uspio automatski analizirati video: ' + (err.message || '') +
        '. Možete otvoriti video, kopirati transkript s YouTubea i zalijepiti ga u polje sadržaja.'
      );
    } finally {
      setIsProcessingSource(false);
      setSourceProcessingStatus('');
    }
  };

  const handleSaveCustomSource = (e) => {
    e.preventDefault();
    try {
      const updated = addCustomKnowledgeSource({
        title: newSourceTitle,
        author: newSourceAuthor,
        category: newSourceCategory,
        content: newSourceContent,
        sourceUrl: newSourceUrl
      });
      setCustomSources(updated);
      setNewSourceTitle('');
      setNewSourceAuthor('');
      setNewSourceCategory('Vlastita literatura');
      setNewSourceContent('');
      setNewSourceUrl('');
      setYoutubeInputUrl('');
      setShowAddSourceForm(false);
      setSourceProcessError(null);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 short:md:gap-3 animate-in fade-in pb-8 short:md:pb-3">
      {/* GORNJI HEADER + SUB-NAVIGATION */}
      <div className="carbon-panel rounded-xl p-4 md:p-5 short:p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-4 short:gap-2.5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-volt-400/15 border border-volt-400/40 text-volt-400 flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg md:text-xl font-display font-bold uppercase tracking-wide text-zinc-100">ErgVibe AI Trener</h2>
              <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border flex items-center gap-1.5 ${
                geminiStatus.configured
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${geminiStatus.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {geminiStatus.configured ? 'GEMINI ONLINE' : 'KLJUČ NEDOSTAJE'}
              </span>
              <span className="font-mono telemetry-num text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-950 text-volt-400 border border-zinc-800">
                FTP {ftp}W{Number(profile?.weight) > 0 ? ` · ${(ftp / Number(profile.weight)).toFixed(2)} W/kg` : ''}
              </span>
              {histStats && (
                <span className="font-mono telemetry-num text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
                  {histStats.totalWorkouts} VOŽNJI U MEMORIJI
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Osobni biciklistički fiziolog s uvidom u vaše odrađene treninge, trenersku literaturu i kalendar
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
            <button
              type="button"
              onClick={() => setSubTab('chat')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
                subTab === 'chat'
                  ? 'bg-volt-400 text-zinc-950 shadow-volt-glow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Konzultacije
            </button>
            <button
              type="button"
              onClick={() => setSubTab('planner')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
                subTab === 'planner'
                  ? 'bg-volt-400 text-zinc-950 shadow-volt-glow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" /> Planer
            </button>
            <button
              type="button"
              onClick={() => setSubTab('knowledge')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
                subTab === 'knowledge'
                  ? 'bg-volt-400 text-zinc-950 shadow-volt-glow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Baza & Povijest
            </button>
          </div>

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title="Odaberi Gemini model"
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono text-xs font-bold text-zinc-300 focus:border-volt-400 outline-none"
          >
            <option value="gemini-3.8-flash">GEMINI FLASH · BRZI</option>
            {geminiStatus.source === 'custom' ? (
              <option value="gemini-3.1-pro-preview">GEMINI PRO · DUBINSKA ANALIZA</option>
            ) : (
              <option value="gemini-3.8-flash" disabled className="text-zinc-600">
                GEMINI PRO (Vlastiti ključ u tabu Veze)
              </option>
            )}
          </select>
        </div>
      </div>

      {/* =====================================================================
          1. SUB-TAB: AI KONZULTACIJE (CHAT)
         ===================================================================== */}
      {subTab === 'chat' && (
        <div className="carbon-panel rounded-xl flex flex-col h-[calc(100dvh-250px)] md:h-[calc(100dvh-195px)] short:md:h-[calc(100dvh-145px)] min-h-[400px] max-h-[780px] overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-zinc-400">
              TELEMETRIJSKA KONZOLA · PITAJ O TRENINZIMA, ZONAMA ILI ZATRAŽI INTERVALNI TRENING
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

          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4 custom-scrollbar">
            {messages.length === 0 && !isSendingChat && (
              <div className="my-auto flex flex-col items-center py-4 md:py-8 text-center max-w-2xl mx-auto w-full">
                <div className="p-4 rounded-xl bg-volt-400/10 border border-volt-400/30 text-volt-400 mb-4">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-display font-bold uppercase tracking-wide text-zinc-100 mb-1">
                  Spreman za analizu, {profile?.username || 'Vozač'}
                </h3>
                <p className="text-xs md:text-sm text-zinc-400 mb-6">
                  Učitao sam vaše dostupne treninge, trenutni FTP (<span className="font-mono font-bold text-volt-400">{ftp} W</span>) i kalendar. Možete zalijepiti sliku bilo kojeg treninga (<span className="font-mono text-volt-300">Ctrl+V</span> / spajalica) za automatsku konverziju u trenažer, ili odabrati brza pitanja:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                  {QUICK_PROMPTS.map((qp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessage(qp)}
                      className="p-3.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/40 text-xs text-zinc-300 hover:text-zinc-100 font-medium transition-all flex items-start gap-2.5 group"
                    >
                      <Zap className="w-4 h-4 text-volt-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
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
                  className={`max-w-3xl rounded-xl p-4 ${
                    m.role === 'user'
                      ? 'bg-volt-400/12 border border-volt-400/35 text-zinc-100'
                      : 'bg-zinc-950 border border-zinc-800/90 text-zinc-200 w-full'
                  }`}
                >
                  {/* Priložene datoteke (slike ili PDF) */}
                  {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {m.attachments.map((att) => (
                        <ChatAttachmentItem
                          key={att.id}
                          attachment={att}
                          onPreview={(fullAtt) => setSelectedPreviewAttachment(fullAtt)}
                        />
                      ))}
                    </div>
                  )}

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
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-3 text-xs font-mono font-bold text-volt-300">
                  <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
                  AI TRENER ANALIZIRA TELEMETRIJU I PRIPREMA ODGOVOR...
                </div>
              </div>
            )}

            {chatError && (
              <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{chatError}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* TRAKA S PRIPREMLJENIM PRIVITCIMA (PENDING) */}
          {pendingAttachments.length > 0 && (
            <div className="px-4 py-2.5 bg-zinc-950/95 border-t border-zinc-800/80 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mr-1 flex items-center gap-1.5 font-bold">
                  <Paperclip className="w-3.5 h-3.5 text-volt-400" /> Priloženo ({pendingAttachments.length}):
                </span>
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 animate-in fade-in group"
                  >
                    {att.type.startsWith('image/') ? (
                      <img src={att.dataUrl} alt={att.name} className="w-6 h-6 object-cover rounded" />
                    ) : (
                      <FileText className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="font-medium truncate max-w-[140px] text-[11px]">{att.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">({formatFileSize(att.size)})</span>
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(att.id)}
                      className="p-1 text-zinc-500 hover:text-rose-400 rounded transition-colors"
                      title="Ukloni privitak"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Brze trenerske naredbe za priloženu sliku/dokument */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-900">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                  Brza akcija:
                </span>
                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => sendMessage('Rekreiraj ovaj trening s priložene slike u točan strukturirani ErgVibe workout za moj trenažer (korak po korak s watima i postocima).')}
                  className="px-2.5 py-1 rounded-md bg-volt-400/10 hover:bg-volt-400/20 border border-volt-400/30 text-volt-300 hover:text-volt-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  title="AI će dekonstruirati grafikon sa slike u izvedivi trenažni workout"
                >
                  <Zap className="w-3 h-3 text-volt-400" /> Pretvori sliku u workout
                </button>
                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => sendMessage('Detaljno analiziraj ovaj priloženi fiziološki nalaz (laktati, VO2max ili puls) u kontekstu mog profila i ažuriraj moje trenažne zone.')}
                  className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  <Activity className="w-3 h-3 text-sky-400" /> Analiziraj fiziološki nalaz
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="p-3 md:p-4 bg-zinc-950/90 border-t border-zinc-800/80 flex items-center gap-2.5"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendingChat || isUploadingFile}
              className="p-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-volt-400/40 text-zinc-400 hover:text-volt-400 transition-all shrink-0 flex items-center justify-center cursor-pointer disabled:opacity-40"
              title="Priloži sliku ili PDF (Zwift/Garmin/TR grafikon, laktati, spiroergometrija...)"
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onPaste={handlePaste}
              disabled={isSendingChat}
              placeholder={pendingAttachments.length > 0 ? "Opiši upute ili klikni 'Pretvori sliku u workout' iznad..." : "Postavi pitanje ili priloži sliku/PDF (možeš zalijepiti sliku i s Ctrl+V)..."}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-volt-400 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSendingChat || (!chatInput.trim() && pendingAttachments.length === 0)}
              className="px-5 py-3 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm flex items-center gap-2 transition-all shadow-volt-glow shrink-0"
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
            className="lg:col-span-5 carbon-panel rounded-xl p-5 md:p-6 space-y-4"
          >
            <div className="border-b border-zinc-800 pb-3">
              <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-volt-400" /> Generator Strukturiranog Plana
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                AI kreira plan prema tvom FTP-u (<span className="font-mono font-bold text-volt-400">{ftp} W</span>), trenutnom zamoru i zabilježenim treninzima
              </p>
            </div>

            <div>
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                Glavni cilj ciklusa
              </label>
              <input
                type="text"
                value={planGoal}
                onChange={(e) => setPlanGoal(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs md:text-sm text-zinc-100 focus:border-volt-400 outline-none"
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
                    className="text-[10px] font-bold px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-volt-300 border border-zinc-800 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Trajanje
                </label>
                <select
                  value={planWeeks}
                  onChange={(e) => setPlanWeeks(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-volt-400"
                >
                  <option value={1}>1 tjedan</option>
                  <option value={2}>2 tjedna</option>
                  <option value={3}>3 tjedna</option>
                  <option value={4}>4 tjedna (Mezo)</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Treninga / tj.
                </label>
                <select
                  value={planWorkoutsPerWeek}
                  onChange={(e) => setPlanWorkoutsPerWeek(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-volt-400"
                >
                  {[2, 3, 4, 5, 6].map(n => (
                    <option key={n} value={n}>{n}x tjedno</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Sati / tjedno
                </label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  step={0.5}
                  value={planHours}
                  onChange={(e) => setPlanHours(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 font-mono telemetry-num text-xs font-bold text-zinc-200 outline-none focus:border-volt-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Trenerska metodologija
                </label>
                <select
                  value={planMethodology}
                  onChange={(e) => setPlanMethodology(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-volt-400"
                >
                  <option value="Polarizirani 80/20 (Seiler)">Polarizirani 80/20 (Seiler)</option>
                  <option value="Piramidalni / Sweet Spot">Piramidalni / Sweet Spot</option>
                  <option value="Joe Friel Periodizacija">Joe Friel Periodizacija</option>
                  <option value="Coggan Threshold Fokus">Coggan Threshold Fokus</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Početni datum plana
                </label>
                <input
                  type="date"
                  value={planStartDate}
                  onChange={(e) => setPlanStartDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 font-mono text-xs font-bold text-zinc-200 outline-none focus:border-volt-400"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Posebne želje ili raspored dana (opcionalno)
              </label>
              <textarea
                rows={3}
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                placeholder="Npr. Utorkom i četvrtkom max 60 min na trenažeru, vikendom duža Z2 vožnja do 2h..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-volt-400 resize-none"
              />
            </div>

            {planError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {planError}
              </div>
            )}

            <button
              type="submit"
              disabled={isGeneratingPlan}
              className="w-full py-3 px-4 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-50 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 shadow-volt-glow transition-all"
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
              <div className="carbon-panel rounded-xl p-10 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="w-8 h-8 text-volt-400 animate-spin" />
                <p className="text-sm font-display font-bold uppercase tracking-wide text-zinc-200">
                  Kreiram strukturirane treninge s intervalima u % FTP-a...
                </p>
                <p className="text-xs text-zinc-500">
                  Ovo obično traje 5–12 sekundi ovisno o broju tjedana.
                </p>
              </div>
            )}

            {!isGeneratingPlan && !generatedPlan && (
              <div className="carbon-panel border-dashed rounded-xl p-10 text-center">
                <ClipboardList className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <h4 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-300">Još nema generiranog plana</h4>
                <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                  Odaberi cilj i broj sati s lijeve strane. Svaki generirani trening moći ćeš jednim klikom dodati izravno u ErgVibe i Intervals.icu kalendar!
                </p>
              </div>
            )}

            {!isGeneratingPlan && generatedPlan && (
              <div className="carbon-panel rounded-xl p-5 md:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-zinc-800 pb-4">
                  <div>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/30">
                      AI Strukturirani Plan
                    </span>
                    <h3 className="text-lg md:text-xl font-display font-bold uppercase tracking-wide text-zinc-100 mt-2">
                      {generatedPlan.planTitle || 'Personalizirani Plan'}
                    </h3>
                    <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{generatedPlan.summary}</p>
                    {generatedPlan.physiologicalRationale && (
                      <p className="text-xs text-zinc-400 mt-2 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                        <strong className="text-volt-400">Fiziološko obrazloženje: </strong>
                        {generatedPlan.physiologicalRationale}
                      </p>
                    )}
                  </div>

                  {onAddWorkoutToCalendar && (
                    <button
                      type="button"
                      onClick={handleAddEntirePlanToCalendar}
                      className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg font-display font-bold uppercase tracking-wider text-xs transition-all border ${
                        allPlanAdded
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-volt-400 hover:bg-volt-300 text-zinc-950 border-volt-400 shadow-volt-glow'
                      }`}
                    >
                      {allPlanAdded ? <Check className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
                      {allPlanAdded ? 'Cijeli plan je u Kalendaru!' : 'Upiši cijeli plan u Kalendar'}
                    </button>
                  )}
                </div>

                {(generatedPlan.weeks || []).map((wk, wIdx) => (
                  <div key={wIdx} className="space-y-2">
                    <div className="flex items-center justify-between bg-zinc-950 px-4 py-2.5 rounded-lg border border-zinc-800">
                      <div>
                        <span className="font-mono text-xs font-bold uppercase tracking-wider text-volt-400">
                          Tjedan {wk.weekNumber || wIdx + 1}
                        </span>
                        {(wk.theme || wk.focus) && <span className="text-xs font-bold text-zinc-300 ml-2">— {wk.theme || wk.focus}</span>}
                      </div>
                      {wk.targetTss && (
                        <span className="font-mono telemetry-num text-xs font-bold text-amber-400">Cilj: ~{wk.targetTss} TSS</span>
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
          3. SUB-TAB: BAZA ZNANJA & POVIJEST TRENINGA
         ===================================================================== */}
      {subTab === 'knowledge' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lijeva strana: Povijest treninga */}
          <div className="lg:col-span-7 carbon-panel rounded-xl p-5 md:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-volt-400" /> Povijest Treninga
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Pregled zabilježenih vožnji, opterećenja i uvezenih CSV treninga
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-volt-400 border border-volt-400/35 text-xs font-bold transition-all"
                >
                  <Upload className="w-3.5 h-3.5" /> Učitaj CSV
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                />

                {extraCsvCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearCsv}
                    title="Ukloni sve uvezene CSV treninge iz lokalne memorije"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Obriši CSV ({extraCsvCount})
                  </button>
                )}
              </div>
            </div>

            {csvImportStatus && (
              <div className={`p-3 rounded-lg text-xs font-bold border ${
                csvImportStatus.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : csvImportStatus.type === 'info'
                    ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {csvImportStatus.msg}
              </div>
            )}

            {histStats && histStats.totalWorkouts > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Ukupno vožnji</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-zinc-100 mt-0.5">{histStats.totalWorkouts}</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Ukupni TSS</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-amber-400 mt-0.5">{histStats.totalTss.toLocaleString('hr-HR')}</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Rekordni FTP</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-volt-400 mt-0.5">{histStats.peakFtp} W</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Z2 Prosj. EF</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-emerald-400 mt-0.5">{histStats.benchmarks.z2AvgEfAllTime ?? '-'}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
                  <table className="w-full text-left text-xs font-mono telemetry-num whitespace-nowrap">
                    <thead className="bg-zinc-900/90 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                      <tr>
                        <th className="px-3.5 py-2.5 font-bold">Sezona</th>
                        <th className="px-3.5 py-2.5 font-bold">Treninzi</th>
                        <th className="px-3.5 py-2.5 font-bold">Sati</th>
                        <th className="px-3.5 py-2.5 font-bold">Load (TSS)</th>
                        <th className="px-3.5 py-2.5 font-bold">FTP raspon</th>
                        <th className="px-3.5 py-2.5 font-bold">Z2 EF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {histStats.yearlyStats.slice().reverse().map(yr => (
                        <tr key={yr.year} className="hover:bg-zinc-900/50">
                          <td className="px-3.5 py-2.5 font-bold text-zinc-100">{yr.year}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.count}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.hours} h</td>
                          <td className="px-3.5 py-2.5 font-bold text-amber-400">{yr.tss}</td>
                          <td className="px-3.5 py-2.5 text-volt-400 font-semibold">
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
              <div className="p-6 bg-zinc-950 rounded-lg border border-zinc-800 text-center space-y-2">
                <History className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <h4 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-200">Nema učitanih povijesnih treninga za ovaj profil</h4>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  AI vaše treninge i planove korigira prema vašem zadanom FTP-u, težini, raspoloživom vremenu i odrađenim vožnjama na trenažeru.
                  Možete učitati svoj Intervals.icu CSV izvoz klikom na "Učitaj CSV" iznad ili bilježiti vožnje kroz trenažer.
                </p>
              </div>
            )}
          </div>

          {/* Desna strana: Trenerska literatura i vlastiti izvori */}
          <div className="lg:col-span-5 carbon-panel rounded-xl p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-volt-400" /> Baza Znanja (Literatura)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Izvori na kojima Gemini temelji analizu i periodizaciju
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {customSources.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllCustomSources}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all"
                    title="Obriši sve vlastite izvore"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Obriši sve ({customSources.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddSourceForm(v => !v)}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow"
                >
                  <Plus className="w-3.5 h-3.5" /> Dodaj izvor
                </button>
              </div>
            </div>

            {showAddSourceForm && (
              <div className="bg-zinc-950 border border-volt-400/30 rounded-xl p-4 md:p-5 space-y-4 animate-in fade-in">
                {/* Zaglavlje i odabir načina unosa */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-volt-400 uppercase tracking-wider block">
                      Novi izvor znanja za AI Trenera
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      Učitajte PDF, EPUB, YouTube video ili ručno unesite bilješke
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setSourceImportMode('upload')}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all ${
                        sourceImportMode === 'upload'
                          ? 'bg-volt-400 text-zinc-950'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" /> Datoteka
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceImportMode('youtube')}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all ${
                        sourceImportMode === 'youtube'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <YoutubeIcon className="w-3.5 h-3.5 text-rose-400" /> YouTube
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceImportMode('manual')}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all ${
                        sourceImportMode === 'manual'
                          ? 'bg-volt-400 text-zinc-950'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" /> Obrazac
                    </button>
                  </div>
                </div>

                {/* 1. UČITAVANJE DATOTEKE (.PDF, .EPUB, .MD, .TXT) */}
                {sourceImportMode === 'upload' && (
                  <div className="space-y-3">
                    <div
                      onClick={() => docFileInputRef.current?.click()}
                      className="border-2 border-dashed border-zinc-800 hover:border-volt-400/60 bg-zinc-900/50 hover:bg-zinc-900 rounded-xl p-6 text-center cursor-pointer transition-all group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-volt-400/10 border border-volt-400/25 text-volt-400 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
                        <Upload className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-zinc-100 mb-1">
                        Kliknite za odabir PDF, EPUB, TXT ili Markdown datoteke
                      </h4>
                      <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-3">
                        Aplikacija u pregledniku automatski čita stranice ili poglavlja i priprema tekst za bazu.
                      </p>
                      <div className="flex items-center justify-center gap-2 flex-wrap font-mono">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          .PDF
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                          .EPUB
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-volt-400/10 text-volt-400 border border-volt-400/25">
                          .MD
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                          .TXT
                        </span>
                      </div>
                    </div>
                    <input
                      ref={docFileInputRef}
                      type="file"
                      accept=".pdf,.epub,.txt,.md"
                      onChange={handleDocumentFileLoad}
                      className="hidden"
                    />
                  </div>
                )}

                {/* 2. YOUTUBE VIDEO IMPORT */}
                {sourceImportMode === 'youtube' && (
                  <form onSubmit={handleAnalyzeYouTube} className="space-y-3">
                    <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800 space-y-1">
                      <p className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-volt-400" /> Automatska AI analiza YouTube videa
                      </p>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Zalijepite poveznicu na biciklistički podcast, studiju ili predavanje (npr. Dylan Johnson, Empirical Cycling, TrainerRoad). 
                        Gemini će pogledati video i strukturirati ključne fiziološke koncepte, nalaze i trenažne protokole.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <YoutubeIcon className="w-4 h-4 text-rose-400 absolute left-3 top-3" />
                        <input
                          type="url"
                          required
                          value={youtubeInputUrl}
                          onChange={(e) => setYoutubeInputUrl(e.target.value)}
                          placeholder="https://www.youtube.com/watch?v=..."
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 outline-none focus:border-rose-500 transition-colors"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isProcessingSource || !youtubeInputUrl.trim()}
                        className="px-4 py-2 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-50 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-1.5 shrink-0 transition-all shadow-volt-glow"
                      >
                        {isProcessingSource ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Analiziraj video
                      </button>
                    </div>
                  </form>
                )}

                {/* Status obrade */}
                {isProcessingSource && (
                  <div className="p-4 rounded-lg bg-volt-400/10 border border-volt-400/30 flex items-center gap-3 text-xs font-mono font-bold text-volt-300">
                    <Loader2 className="w-4 h-4 animate-spin text-volt-400 shrink-0" />
                    <span>{sourceProcessingStatus || 'Obrada izvora u tijeku...'}</span>
                  </div>
                )}

                {/* Greška obrade */}
                {sourceProcessError && (
                  <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span className="flex-1">{sourceProcessError}</span>
                  </div>
                )}

                {/* Obrazac za pregled i spremanje */}
                <form onSubmit={handleSaveCustomSource} className="space-y-3 pt-2 border-t border-zinc-800">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        Naslov izvora / knjige / videa *
                      </label>
                      <input
                        type="text"
                        required
                        value={newSourceTitle}
                        onChange={(e) => setNewSourceTitle(e.target.value)}
                        placeholder="npr. Fast After 50 ili Z2 Mitochondria Study"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        Autor / Kanal / Izvor
                      </label>
                      <input
                        type="text"
                        value={newSourceAuthor}
                        onChange={(e) => setNewSourceAuthor(e.target.value)}
                        placeholder="npr. Joe Friel ili Dylan Johnson"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        Kategorija izvora
                      </label>
                      <select
                        value={newSourceCategory}
                        onChange={(e) => setNewSourceCategory(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      >
                        <option value="PDF literatura">PDF literatura</option>
                        <option value="EPUB knjiga">EPUB e-knjiga</option>
                        <option value="YouTube predavanje / podcast">YouTube predavanje / podcast</option>
                        <option value="Knjiga / poglavlje">Knjiga / poglavlje</option>
                        <option value="Trenažni protokol">Trenažni protokol</option>
                        <option value="Vlastita literatura">Vlastita literatura</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        Poveznica / URL (opcionalno)
                      </label>
                      <input
                        type="url"
                        value={newSourceUrl}
                        onChange={(e) => setNewSourceUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Sadržaj izvora i trenerska pravila *
                      </label>
                      <span className="text-[10px] text-zinc-500 font-mono telemetry-num">
                        {newSourceContent.length.toLocaleString('hr-HR')} / 55.000 znakova
                      </span>
                    </div>
                    <textarea
                      rows={6}
                      required
                      value={newSourceContent}
                      onChange={(e) => setNewSourceContent(e.target.value)}
                      placeholder="Zalijepite ključne principe, pravila, zone ili bilješke koje želite da AI Trener uvijek uvažava..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-volt-400 resize-y font-mono leading-relaxed"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-zinc-500">
                      Spremljeno u vašu privatnu bazu znanja (AI uzima u obzir pri analizi i planovima).
                    </span>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={handleCancelAddSource}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        Odustani
                      </button>
                      <button
                        type="submit"
                        disabled={isProcessingSource || !newSourceTitle.trim() || !newSourceContent.trim()}
                        className="px-4 py-1.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-50 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-volt-glow"
                      >
                        <Check className="w-3.5 h-3.5" /> Spremi u Bazu Znanja
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Korisnički dodani vlastiti izvori */}
            {customSources.length > 0 && (
              <div className="space-y-3 pb-3 border-b border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-volt-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-volt-400" /> Vlastita literatura i izvori ({customSources.length})
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Spremljeno u pregledniku
                  </span>
                </div>
                {customSources.map(src => {
                  const isExpanded = expandedModuleId === src.id;
                  return (
                    <div key={src.id} className="rounded-lg border border-volt-400/25 bg-zinc-950 p-3.5 space-y-2.5 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-volt-400 bg-volt-400/10 px-2 py-0.5 rounded border border-volt-400/25">
                              {src.category || 'Vlastiti izvor'}
                            </span>
                            {src.sourceUrl && (
                              <a
                                href={src.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-volt-400 hover:underline flex items-center gap-1 font-semibold"
                              >
                                <ExternalLink className="w-3 h-3" /> Poveznica
                              </a>
                            )}
                          </div>
                          <h4 className="text-xs md:text-sm font-bold text-zinc-100 mt-1 truncate">{src.title}</h4>
                          <p className="text-[11px] text-zinc-400">{src.author || 'Nepoznat autor'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomSource(src.id, src.title)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors shrink-0"
                          title="Ukloni ovaj izvor iz baze znanja"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Ukloni
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedModuleId(isExpanded ? null : src.id)}
                        className="text-[11px] font-bold text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isExpanded ? 'Sakrij sadržaj' : 'Prikaži sadržaj bilješke / sažetka'}
                      </button>
                      {isExpanded ? (
                        <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                          {src.content}
                        </pre>
                      ) : (
                        <p className="text-xs text-zinc-400 line-clamp-2">{src.content}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ugrađeni moduli */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-volt-400">
                  Ugrađeni trenerski moduli ({BUILT_IN_KNOWLEDGE_MODULES.length})
                </span>
                <span className="text-[10px] text-zinc-500">
                  Aktivni i predefinirani
                </span>
              </div>
              {BUILT_IN_KNOWLEDGE_MODULES.map(mod => {
                const isEnabled = !disabledModules.includes(mod.id);
                const isExpanded = expandedModuleId === mod.id;
                return (
                  <div
                    key={mod.id}
                    className={`rounded-lg border p-3.5 transition-all ${
                      isEnabled
                        ? 'bg-zinc-950 border-zinc-800'
                        : 'bg-zinc-950/30 border-zinc-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-volt-400">
                          {mod.category}
                        </span>
                        <h4 className="text-xs md:text-sm font-bold text-zinc-100">{mod.title}</h4>
                        <p className="text-[11px] text-zinc-500 font-medium">{mod.author}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDisabledModules(toggleBuiltInModule(mod.id))}
                        className="text-volt-400 hover:text-volt-300 shrink-0"
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
                      <pre className="mt-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto custom-scrollbar">
                        {mod.content}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ZA PREGLED PRIVITKA (SLIKA ILI PDF) */}
      {selectedPreviewAttachment && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in"
          onClick={() => setSelectedPreviewAttachment(null)}
        >
          <div
            className="w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 md:p-6 relative flex flex-col max-h-[92vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2 min-w-0">
                {selectedPreviewAttachment.type?.startsWith('image/') ? (
                  <ImageIcon className="w-4 h-4 text-volt-400 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span className="font-semibold text-sm text-zinc-100 truncate">
                  {selectedPreviewAttachment.name}
                </span>
                <span className="text-xs font-mono text-zinc-500">
                  ({formatFileSize(selectedPreviewAttachment.size)})
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedPreviewAttachment.dataUrl && (
                  <a
                    href={selectedPreviewAttachment.dataUrl}
                    download={selectedPreviewAttachment.name}
                    className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors text-xs flex items-center gap-1 px-2.5 font-medium"
                    title="Preuzmi datoteku"
                  >
                    <Download className="w-3.5 h-3.5" /> Preuzmi
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPreviewAttachment(null)}
                  className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 rounded-lg p-2 min-h-[300px]">
              {selectedPreviewAttachment.type?.startsWith('image/') ? (
                <img
                  src={selectedPreviewAttachment.dataUrl}
                  alt={selectedPreviewAttachment.name}
                  className="max-w-full max-h-[75vh] object-contain rounded"
                />
              ) : (
                <iframe
                  src={selectedPreviewAttachment.dataUrl}
                  title={selectedPreviewAttachment.name}
                  className="w-full h-[75vh] rounded border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Prikazuje minijaturu slike ili PDF karticu u chat oblačiću.
 * Ako slika nije u memoriji (npr. nakon ponovnog učitavanja),
 * automatski je povlači iz lokalnog IndexedDB-a.
 */
function ChatAttachmentItem({ attachment, onPreview }) {
  const [dataUrl, setDataUrl] = useState(attachment.dataUrl || null);
  const [loading, setLoading] = useState(!attachment.dataUrl);

  useEffect(() => {
    if (dataUrl || !attachment.id) return;
    let active = true;
    getAttachmentFromLocalDB(attachment.id)
      .then(item => {
        if (active && item?.dataUrl) {
          setDataUrl(item.dataUrl);
        }
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [attachment.id, dataUrl]);

  const isImage = attachment.type?.startsWith('image/');

  if (isImage) {
    return (
      <div
        onClick={() => onPreview && onPreview({ ...attachment, dataUrl })}
        className="group relative cursor-pointer rounded-lg overflow-hidden border border-zinc-800 hover:border-volt-400/60 transition-all bg-zinc-950 max-w-[200px]"
        title="Klikni za uvećanje slike"
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={attachment.name}
            className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
          />
        ) : loading ? (
          <div className="w-36 h-24 flex items-center justify-center bg-zinc-900 text-zinc-600">
            <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
          </div>
        ) : (
          <div className="w-36 h-24 flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 gap-1 p-2 text-center">
            <ImageIcon className="w-5 h-5 text-zinc-400" />
            <span className="text-[10px] truncate max-w-full">{attachment.name}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-volt-300 font-mono text-[10px] font-bold">
          <Eye className="w-3.5 h-3.5" /> Uvećaj
        </div>
      </div>
    );
  }

  // PDF prilog
  return (
    <div
      onClick={() => onPreview && onPreview({ ...attachment, dataUrl })}
      className="flex items-center gap-2.5 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-rose-500/50 cursor-pointer transition-all max-w-xs group"
      title="Klikni za pregled PDF dokumenta"
    >
      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 group-hover:scale-105 transition-transform">
        <FileText className="w-4 h-4" />
      </div>
      <div className="flex flex-col min-w-0 pr-2 text-left">
        <span className="text-xs font-semibold text-zinc-200 truncate group-hover:text-zinc-100 transition-colors">
          {attachment.name}
        </span>
        <span className="text-[10px] font-mono text-zinc-500">
          PDF · {formatFileSize(attachment.size)}
        </span>
      </div>
    </div>
  );
}

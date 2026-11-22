import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, Bot, Send, Loader2, Trash2, BookOpen,
  History, ClipboardList, MessageSquare, Upload, Plus, Check,
  AlertCircle, Zap, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Shield,
  FileText, ExternalLink, Video, Paperclip, X, Image as ImageIcon, Download, Eye,
  Activity, Bookmark, BookmarkPlus, Copy, PanelLeft, Lock
} from 'lucide-react';
import {
  chatWithAICoach,
  getGeminiConfigStatus,
  analyzeYouTubeVideoForKnowledgeBase
} from '../services/geminiService';
import {
  processFileForAi,
  saveAttachmentToLocalDB,
  getAttachmentFromLocalDB,
  formatFileSize
} from '../services/aiFilesStorage';
import {
  loadChatSessions,
  saveChatSession,
  deleteChatSession,
  createSessionId,
  generateSessionTitle,
  getActiveChatSessionId,
  setActiveChatSessionId,
  getChatDraft,
  setChatDraft,
  exportChatSessionAsMarkdown,
  getCoachNotes,
  addCoachNote,
  toggleCoachNote,
  deleteCoachNote
} from '../services/aiChatStorage';
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
import AIMarkdown from './ai/AIMarkdown';
import ChatSessionsSidebar from './ai/ChatSessionsSidebar';
import CoachNotesDrawer from './ai/CoachNotesDrawer';
import TrainingPlannerView from './planner/TrainingPlannerView';
import { useI18n } from '../i18n/I18nContext';

function buildNoteExcerpt(markdownText) {
  return String(markdownText || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 480);
}

function YoutubeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" {...props}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

const QUICK_PROMPTS_DATA = [
  {
    hr: 'Analiziraj moja zadnja 2 tjedna treninga, trenutni fitness (CTL) i formu (TSB).',
    en: 'Analyze my last 2 weeks of training, current Fitness (CTL), and Form (TSB).'
  },
  {
    hr: 'Analiziraj moju Z2 aerobnu efikasnost (EF) i aerobni decoupling (drift pulsa) na treninzima.',
    en: 'Analyze my Zone 2 aerobic Efficiency Factor (EF) and aerobic decoupling (cardiac drift) across rides.'
  },
  {
    hr: 'Predloži mi optimalan strukturirani trening za danas na trenažeru (60 min) s obzirom na zadnje vožnje.',
    en: 'Suggest an optimal 60-minute structured indoor trainer workout for today based on my recent rides.'
  },
  {
    hr: 'Kako mogu optimalno strukturirati tjedan s 4 treninga za stabilan napredak i podizanje FTP-a?',
    en: 'How should I structure a 4-ride training week for steady progression and raising my FTP?'
  }
];

const BUILT_IN_MODULE_EN = {
  coggan_allen: {
    category: 'Power Physiology & Metrics',
    summary: 'Power zones (Z1–Z7 + Sweet Spot), NP, IF, TSS, Efficiency Factor (EF), Variability Index (VI), Aerobic Decoupling (Pw:HR), and W\' balance.'
  },
  friel_periodization: {
    category: 'Periodization & Performance Management (PMC)',
    summary: 'Macro/meso/micro-cycles, load progression, CTL/ATL/TSB curve interpretation, recovery, and adaptation for experienced cyclists.'
  },
  seiler_polarized: {
    category: 'Intensity Distribution & Z2 Metabolism',
    summary: 'Polarized (80/20) vs. pyramidal model, LT1/VT1 threshold role, lactate oxidation (MCT1 transporters), and avoiding the "grey zone" trap.'
  }
};

export default function AICoachTab({
  profile,
  setProfile,
  workouts = [],
  wellnessData = {},
  userId = null,
  intervalsConnected = false,
  onAddWorkoutToCalendar,
  onCreatePlanBatch,
  onDeletePlanBlock,
  onDeletePlanBlocks,
  planRegistry = [],
  onStartWorkoutInTrainer,
  onNavigateToCalendar,
  plannerLaunchRequest = null,
  onConsumePlannerLaunchRequest,
  coachLaunchRequest = null,
  onConsumeCoachLaunchRequest,
  onAnalyzePlanInCoach,
  onBusyChange
}) {
  const { isEn, locale, tr } = useI18n();

  const translateSourceCategory = useCallback((cat) => {
    switch (cat) {
      case 'PDF literatura':
        return tr('PDF literatura', 'PDF Literature');
      case 'EPUB knjiga':
        return tr('EPUB e-knjiga', 'EPUB E-Book');
      case 'YouTube predavanje / podcast':
        return tr('YouTube predavanje / podcast', 'YouTube Lecture / Podcast');
      case 'Knjiga / poglavlje':
        return tr('Knjiga / poglavlje', 'Book / Chapter');
      case 'Trenažni protokol':
        return tr('Trenažni protokol', 'Training Protocol');
      case 'Vlastita literatura':
        return tr('Vlastita literatura', 'Personal Literature');
      case 'Tekstualni dokument':
        return tr('Tekstualni dokument', 'Text Document');
      default:
        return cat || tr('Vlastiti izvor', 'Custom Source');
    }
  }, [tr]);

  const [subTab, setSubTab] = useState(() => (
    coachLaunchRequest ? 'chat' : (plannerLaunchRequest ? 'planner' : 'chat')
  )); // 'chat' | 'planner' | 'knowledge'
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [includeCoachArchive, setIncludeCoachArchiveState] = useState(() => getHistoryOptions(userId).includeBaseHistory);

  // --- MULTI-SESSION CHAT & LOCAL NOTES STATE (100% lokalno u IndexedDB/localStorage) ---
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(true);
  const [showMobileSessionsDrawer, setShowMobileSessionsDrawer] = useState(false);
  const [chatInput, setChatInput] = useState(() => getChatDraft(userId));
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [sendingSessionId, setSendingSessionId] = useState(null);
  const [chatError, setChatError] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [selectedPreviewAttachment, setSelectedPreviewAttachment] = useState(null);
  const [copiedMsgId, setCopiedMsgId] = useState(null);

  // Lokalne Bilješke Trenera
  const [coachNotes, setCoachNotes] = useState(() => getCoachNotes(userId));
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [notePrefillText, setNotePrefillText] = useState('');

  const fileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const isFirstChatRender = useRef(true);
  const sessionsRef = useRef([]);
  const activeSessionIdRef = useRef(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );
  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);
  const activeNotesCount = useMemo(
    () => coachNotes.filter((n) => n.enabled !== false).length,
    [coachNotes]
  );

  // Učitaj lokalne razgovore, nacrt i bilješke po korisniku
  useEffect(() => {
    let active = true;
    setIsLoadingSessions(true);
    setChatInput(getChatDraft(userId));
    setCoachNotes(getCoachNotes(userId));

    loadChatSessions(userId)
      .then((loaded) => {
        if (!active) return;
        setSessions(loaded);
        sessionsRef.current = loaded;

        const savedActive = getActiveChatSessionId(userId);
        if (savedActive && loaded.some((s) => s.id === savedActive)) {
          setActiveSessionId(savedActive);
          activeSessionIdRef.current = savedActive;
        } else if (loaded.length > 0 && !coachLaunchRequest) {
          setActiveSessionId(loaded[0].id);
          activeSessionIdRef.current = loaded[0].id;
        } else {
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
        }
      })
      .catch((err) => {
        console.warn('[AICoachTab] Greška pri učitavanju razgovora:', err);
      })
      .finally(() => {
        if (active) setIsLoadingSessions(false);
      });

    return () => { active = false; };
  }, [userId]);

  // Spremanje nacrta poruke lokalno (da se ne izgubi kod zatvaranja Chromea)
  useEffect(() => {
    const t = setTimeout(() => {
      setChatDraft(userId, chatInput);
    }, 200);
    return () => clearTimeout(t);
  }, [chatInput, userId]);

  // --- PLANNER STATE ---
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  useEffect(() => {
    if (plannerLaunchRequest) {
      setSubTab('planner');
    }
  }, [plannerLaunchRequest]);

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
    if (onBusyChange) {
      onBusyChange(Boolean(isSendingChat || isGeneratingPlan || isProcessingSource));
    }
  }, [isSendingChat, isGeneratingPlan, isProcessingSource, onBusyChange]);

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
  }, [messages.length, activeSessionId, isSendingChat, chatError]);

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
      setChatError(err.message || tr('Greška pri čitanju datoteke.', 'Failed to read file.'));
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
            name: att.name || tr('snimka_zaslona.png', 'screenshot.png'),
            type: att.type,
            size: att.size,
            dataUrl: att.dataUrl,
            dataBase64: att.dataBase64
          });
        }
      }
      setPendingAttachments(prev => [...prev, ...processed]);
    } catch (err) {
      setChatError(err.message || tr('Greška pri lijepljenju datoteke.', 'Failed to paste file.'));
    } finally {
      setIsUploadingFile(false);
    }
  };

  const removePendingAttachment = (id) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  };

  const upsertSessionInState = useCallback((updatedSession) => {
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== updatedSession.id);
      const next = [updatedSession, ...rest].sort((a, b) =>
        String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''))
      );
      sessionsRef.current = next;
      return next;
    });
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setActiveChatSessionId(userId, null);
    setChatError(null);
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  }, [userId]);

  const handleSelectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    activeSessionIdRef.current = sessionId;
    setActiveChatSessionId(userId, sessionId);
    setChatError(null);
  }, [userId]);

  const handleRenameSession = useCallback(async (sessionId, newTitle) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    if (!target) return;
    const updated = {
      ...target,
      title: newTitle.trim() || target.title,
      isCustomTitle: true
    };
    upsertSessionInState(updated);
    await saveChatSession(updated);
  }, [upsertSessionInState]);

  const handleDeleteSession = useCallback(async (sessionObj) => {
    if (!sessionObj?.id) return;
    const confirmed = window.confirm(
      tr(
        'Obrisati razgovor "{title}" i njegove priložene datoteke s ovog uređaja?',
        'Delete conversation "{title}" and its attached files from this device?',
        { title: sessionObj.title || tr('Razgovor', 'Conversation') }
      )
    );
    if (!confirmed) return;

    await deleteChatSession(userId, sessionObj);
    const remaining = sessionsRef.current.filter((s) => s.id !== sessionObj.id);
    sessionsRef.current = remaining;
    setSessions(remaining);

    if (activeSessionIdRef.current === sessionObj.id) {
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveSessionId(nextId);
      activeSessionIdRef.current = nextId;
      setActiveChatSessionId(userId, nextId);
      setChatError(null);
    }
  }, [userId, tr]);

  const handleExportSession = useCallback((sessionObj) => {
    exportChatSessionAsMarkdown(sessionObj);
  }, []);

  const handleAddCoachNote = useCallback(({ text, category }) => {
    const updated = addCoachNote(userId, { text, category });
    setCoachNotes(updated);
  }, [userId]);

  const handleToggleCoachNote = useCallback((noteId) => {
    const updated = toggleCoachNote(userId, noteId);
    setCoachNotes(updated);
  }, [userId]);

  const handleDeleteCoachNote = useCallback((noteId) => {
    const updated = deleteCoachNote(userId, noteId);
    setCoachNotes(updated);
  }, [userId]);

  const handleCopyMessage = useCallback(async (msgId, text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId((cur) => (cur === msgId ? null : cur)), 1800);
    } catch {
      // ignore clipboard errors
    }
  }, []);

  const handleSaveMessageAsNote = useCallback((text) => {
    setNotePrefillText(buildNoteExcerpt(text));
    setShowNotesDrawer(true);
  }, []);

  const sendMessage = async (textOverride, options = {}) => {
    const content = (textOverride ?? chatInput).trim();
    if ((!content && pendingAttachments.length === 0) || isSendingChat) return;

    const forceNewSession = Boolean(options?.forceNewSession);
    setChatError(null);
    const currentAttachments = [...pendingAttachments];
    setPendingAttachments([]);

    // U lokalni IndexedDB razgovora spremamo lagane metapodatke privitka (slike ostaju u aiFilesStorage)
    const cleanAttachments = currentAttachments.map(({ id, name, type, size, dataUrl }) => ({
      id,
      name,
      type,
      size,
      dataUrl: type.startsWith('image/') ? dataUrl : undefined
    }));

    const nowIso = new Date().toISOString();
    const curActiveId = activeSessionIdRef.current;
    const existingSession = (!forceNewSession && curActiveId)
      ? sessionsRef.current.find((s) => s.id === curActiveId) || null
      : null;

    const prevMessages = existingSession ? [...existingSession.messages] : [];
    const nextUserMessage = {
      id: `msg_${Date.now().toString(36)}_u`,
      role: 'user',
      text: content,
      createdAt: nowIso,
      ...(cleanAttachments.length > 0 ? { attachments: cleanAttachments } : {})
    };
    const nextMessages = [...prevMessages, nextUserMessage];

    const isBrandNewSession = !existingSession;
    const targetSessionId = existingSession ? existingSession.id : createSessionId();
    const optimisticSession = existingSession
      ? {
          ...existingSession,
          updatedAt: nowIso,
          messages: nextMessages
        }
      : {
          id: targetSessionId,
          userId: userId || 'guest',
          title: content
            ? generateSessionTitle(content, cleanAttachments)
            : cleanAttachments.length > 0
              ? tr('Analiza: {name}', 'Analysis: {name}', { name: cleanAttachments[0]?.name || tr('datoteka', 'file') }).slice(0, 52)
              : tr('Novi razgovor', 'New Chat'),
          isCustomTitle: false,
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: nextMessages
        };

    upsertSessionInState(optimisticSession);
    setActiveSessionId(targetSessionId);
    activeSessionIdRef.current = targetSessionId;
    setActiveChatSessionId(userId, targetSessionId);
    saveChatSession(optimisticSession).catch(() => {});

    if (!textOverride) {
      setChatInput('');
      setChatDraft(userId, '');
    }
    setIsSendingChat(true);
    setSendingSessionId(targetSessionId);

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

      const replyIso = new Date().toISOString();
      const latestSession = sessionsRef.current.find((s) => s.id === targetSessionId) || optimisticSession;
      const completedSession = {
        ...latestSession,
        updatedAt: replyIso,
        messages: [
          ...nextMessages,
          {
            id: `msg_${Date.now().toString(36)}_m`,
            role: 'model',
            text: reply,
            createdAt: replyIso
          }
        ]
      };

      upsertSessionInState(completedSession);
      await saveChatSession(completedSession);
    } catch (err) {
      setChatError(err.message || tr('Greška u komunikaciji s Gemini AI.', 'Error communicating with Gemini AI.'));
      if (isBrandNewSession) {
        await deleteChatSession(userId, targetSessionId);
        const cleaned = sessionsRef.current.filter((s) => s.id !== targetSessionId);
        sessionsRef.current = cleaned;
        setSessions(cleaned);
        if (activeSessionIdRef.current === targetSessionId) {
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
          setActiveChatSessionId(userId, null);
        }
      } else if (existingSession) {
        upsertSessionInState(existingSession);
        saveChatSession(existingSession).catch(() => {});
      }
      setPendingAttachments(currentAttachments);
      if (!textOverride) setChatInput(content);
    } finally {
      setIsSendingChat(false);
      setSendingSessionId(null);
    }
  };

  const lastHandledCoachNonceRef = useRef(null);

  useEffect(() => {
    if (!coachLaunchRequest?.nonce || !coachLaunchRequest?.prompt) return;
    if (lastHandledCoachNonceRef.current === coachLaunchRequest.nonce) return;
    lastHandledCoachNonceRef.current = coachLaunchRequest.nonce;
    setSubTab('chat');
    onConsumeCoachLaunchRequest?.();
    sendMessage(coachLaunchRequest.prompt, { forceNewSession: true });
  }, [coachLaunchRequest]);

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
        msg: tr(
          'Uspješno obrađeno! Dodano {added} novih treninga (ukupno u CSV bazi: {total}).',
          'Successfully processed! Added {added} new workouts (total in CSV database: {total}).',
          { added: res.addedCount, total: res.totalExtraCount }
        )
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
      tr(
        'Jeste li sigurni da želite ukloniti sve uvezene CSV treninge ({count} aktivnosti)?\n\nNakon brisanja ostat će samo vaše redovne vožnje zabilježene kroz aplikaciju ili ugrađenu bazu.',
        'Are you sure you want to remove all imported CSV workouts ({count} activities)?\n\nOnly your regular app-recorded rides and built-in database will remain.',
        { count }
      )
    );
    if (!confirmed) return;

    clearExtraImportedHistory(userId);
    setExtraCsvCount(0);
    const updatedStats = await getHistoricalDashboardStats(workouts, { userId, includeBaseHistory: includeCoachArchive });
    setHistStats(updatedStats);
    setCsvImportStatus({
      type: 'info',
      msg: tr(
        'Uvezeni CSV podaci ({count} aktivnosti) su uspješno uklonjeni iz lokalne memorije.',
        'Imported CSV data ({count} activities) has been removed from local storage.',
        { count }
      )
    });
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const handleDeleteCustomSource = (id, title) => {
    const confirmed = window.confirm(
      tr(
        'Jeste li sigurni da želite ukloniti izvor "{title}" iz Baze Znanja?',
        'Are you sure you want to remove "{title}" from the Knowledge Base?',
        { title: title || tr('Nepoznat', 'Unknown') }
      )
    );
    if (!confirmed) return;
    const updated = removeCustomKnowledgeSource(id);
    setCustomSources(updated);
  };

  const handleClearAllCustomSources = () => {
    if (!customSources.length) return;
    const confirmed = window.confirm(
      tr(
        'Jeste li sigurni da želite obrisati sve vlastite dodane izvore ({count} izvora/knjiga)? Ova radnja je nepovratna.',
        'Are you sure you want to delete all custom sources ({count} sources/books)? This action cannot be undone.',
        { count: customSources.length }
      )
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
        setSourceProcessingStatus(tr('Čitam PDF dokument i izvlačim tekst...', 'Reading PDF document and extracting text...'));
        const res = await parsePdfFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'PDF literatura');
        setNewSourceContent(res.content || '');
      } else if (ext === 'epub') {
        setSourceProcessingStatus(tr('Otvaram EPUB e-knjigu i pripremam poglavlja...', 'Opening EPUB e-book and extracting chapters...'));
        const res = await parseEpubFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'EPUB knjiga');
        setNewSourceContent(res.content || '');
      } else {
        setSourceProcessingStatus(tr('Učitavam tekstualni dokument...', 'Loading text document...'));
        const res = await parseTextFile(file);
        setNewSourceTitle(res.title || file.name);
        setNewSourceAuthor(res.author || '');
        setNewSourceCategory(res.category || 'Tekstualni dokument');
        setNewSourceContent(res.content || '');
      }
      setSourceImportMode('manual');
    } catch (err) {
      console.error('[AICoachTab] Greška pri parsiranju dokumenta:', err);
      setSourceProcessError(
        tr('Greška pri čitanju datoteke: {msg}', 'Error reading file: {msg}', {
          msg: err.message || tr('Nepoznata greška', 'Unknown error')
        })
      );
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
    setSourceProcessingStatus(tr(
      'Gemini AI gleda videozapis i priprema stručni trenerski sažetak...',
      'Gemini AI is analyzing the video and preparing a coaching summary...'
    ));

    try {
      const res = await analyzeYouTubeVideoForKnowledgeBase(youtubeInputUrl);
      setNewSourceTitle(res.title || tr('YouTube predavanje', 'YouTube Lecture'));
      setNewSourceAuthor(res.author || 'YouTube');
      setNewSourceCategory(res.category || 'YouTube predavanje / podcast');
      setNewSourceUrl(res.sourceUrl || youtubeInputUrl);
      setNewSourceContent(res.content || '');
      setSourceImportMode('manual');
    } catch (err) {
      console.error('[AICoachTab] Greška pri analizi YouTube videa:', err);
      setSourceProcessError(
        tr(
          'Gemini nije uspio automatski analizirati video: {msg}. Možete otvoriti video, kopirati transkript s YouTubea i zalijepiti ga u polje sadržaja.',
          'Gemini could not automatically analyze the video: {msg}. You can open the video, copy the YouTube transcript, and paste it into the content field.',
          { msg: err.message || '' }
        )
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
    <div className="w-full max-w-7xl mx-auto flex-1 min-h-0 h-full flex flex-col gap-2.5 md:gap-3 short:md:gap-2 animate-in fade-in overflow-hidden px-1 md:px-2 pt-1 pb-1">
      {/* GORNJI HEADER + SUB-NAVIGATION */}
      <div className="carbon-panel rounded-xl p-3 md:px-4 md:py-3 short:p-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 short:gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-volt-400/15 border border-volt-400/40 text-volt-400 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg md:text-xl font-display font-bold uppercase tracking-wide text-zinc-100">
                {tr('ErgVibe AI Trener', 'ErgVibe AI Coach')}
              </h2>
              <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border flex items-center gap-1.5 ${
                geminiStatus.configured
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${geminiStatus.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {geminiStatus.configured ? 'GEMINI ONLINE' : tr('KLJUČ NEDOSTAJE', 'API KEY MISSING')}
              </span>
              <span className="font-mono telemetry-num text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-950 text-volt-400 border border-zinc-800">
                FTP {ftp}W{Number(profile?.weight) > 0 ? ` · ${(ftp / Number(profile.weight)).toFixed(2)} W/kg` : ''}
              </span>
              {histStats && (
                <span className="font-mono telemetry-num text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
                  {tr('{count} VOŽNJI U MEMORIJI', '{count} RIDES IN MEMORY', { count: histStats.totalWorkouts })}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {tr(
                'Osobni biciklistički fiziolog s uvidom u vaše odrađene treninge, trenersku literaturu i kalendar',
                'Personal cycling physiologist with insight into your completed rides, coaching literature, and calendar'
              )}
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
              <MessageSquare className="w-3.5 h-3.5" /> {tr('Konzultacije', 'Coach Chat')}
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
              <ClipboardList className="w-3.5 h-3.5" /> {tr('Planer', 'Planner')}
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
              <BookOpen className="w-3.5 h-3.5" /> {tr('Baza & Povijest', 'Knowledge & History')}
            </button>
          </div>

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title={tr('Odaberi Gemini model', 'Select Gemini model')}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono text-xs font-bold text-zinc-300 focus:border-volt-400 outline-none"
          >
            <option value="gemini-3.8-flash">{tr('GEMINI FLASH · BRZI', 'GEMINI FLASH · FAST')}</option>
            {geminiStatus.source === 'custom' ? (
              <option value="gemini-3.1-pro-preview">{tr('GEMINI PRO · DUBINSKA ANALIZA', 'GEMINI PRO · DEEP ANALYSIS')}</option>
            ) : (
              <option value="gemini-3.8-flash" disabled className="text-zinc-600">
                {tr('GEMINI PRO (Vlastiti ključ u tabu Veze)', 'GEMINI PRO (Custom key in Connections)')}
              </option>
            )}
          </select>
        </div>
      </div>

      {/* =====================================================================
          1. SUB-TAB: AI KONZULTACIJE (CHAT + POVIJEST + BILJEŠKE)
         ===================================================================== */}
      {subTab === 'chat' && (
        <div className="carbon-panel rounded-xl flex-1 min-h-0 flex overflow-hidden relative">
          {/* Desktop bočna traka: Povijest razgovora */}
          {showSessionsSidebar && (
            <div className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col min-h-0">
              <ChatSessionsSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                sendingSessionId={sendingSessionId}
                onSelectSession={handleSelectSession}
                onNewChat={handleNewChat}
                onRenameSession={handleRenameSession}
                onDeleteSession={handleDeleteSession}
                onExportSession={handleExportSession}
              />
            </div>
          )}

          {/* Mobilna / tablet ladica za povijest razgovora (portal na document.body iznad headera i donjeg menija) */}
          {showMobileSessionsDrawer && typeof document !== 'undefined' && createPortal(
            <div
              className="lg:hidden fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex animate-in fade-in"
              onClick={() => setShowMobileSessionsDrawer(false)}
            >
              <div
                className="w-[82vw] max-w-xs h-full shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <ChatSessionsSidebar
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  sendingSessionId={sendingSessionId}
                  onSelectSession={handleSelectSession}
                  onNewChat={handleNewChat}
                  onRenameSession={handleRenameSession}
                  onDeleteSession={handleDeleteSession}
                  onExportSession={handleExportSession}
                  onCloseMobile={() => setShowMobileSessionsDrawer(false)}
                />
              </div>
            </div>,
            document.body
          )}

          {/* Glavni chat prostor */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            {/* Gornja alatna traka chata */}
            <div className="px-3 md:px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {/* Desktop toggle bočne trake */}
                <button
                  type="button"
                  onClick={() => setShowSessionsSidebar((v) => !v)}
                  className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-mono font-bold transition-colors shrink-0 ${
                    showSessionsSidebar
                      ? 'bg-zinc-900 text-volt-400 border-volt-400/30'
                      : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800'
                  }`}
                  title={showSessionsSidebar ? tr('Sakrij povijest razgovora', 'Hide chat history') : tr('Prikaži povijest razgovora', 'Show chat history')}
                >
                  <PanelLeft className="w-3.5 h-3.5" />
                  <span>{sessions.length}</span>
                </button>

                {/* Mobilni gumb za ladicu povijesti */}
                <button
                  type="button"
                  onClick={() => setShowMobileSessionsDrawer(true)}
                  className="lg:hidden inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-[11px] font-mono font-bold shrink-0"
                  title={tr('Otvori povijest razgovora', 'Open chat history')}
                >
                  <History className="w-3.5 h-3.5 text-volt-400" />
                  <span>{tr('Povijest ({count})', 'History ({count})', { count: sessions.length })}</span>
                </button>

                <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-zinc-300 truncate">
                  {activeSession
                    ? (!activeSession.isCustomTitle && activeSession.title === 'Novi razgovor'
                        ? tr('Novi razgovor', 'New Chat')
                        : activeSession.title)
                    : tr('Novi razgovor', 'New Chat')}
                </span>

                <span
                  className="hidden xl:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0"
                  title={tr('Razgovori i nalazi ostaju isključivo lokalno na ovom uređaju', 'Conversations and lab results stay strictly local on this device')}
                >
                  <Lock className="w-2.5 h-2.5" /> {tr('Lokalno', 'Local')}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isSendingChat && sendingSessionId && sendingSessionId !== activeSessionId && (
                  <button
                    type="button"
                    onClick={() => handleSelectSession(sendingSessionId)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-volt-400/12 border border-volt-400/35 text-volt-300 font-mono text-[10px] font-bold"
                    title={tr('Vrati se na razgovor u kojem AI trenutno generira odgovor', 'Return to the conversation where AI is currently responding')}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" /> {tr('AI piše...', 'AI typing...')}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowNotesDrawer(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono font-bold transition-colors ${
                    activeNotesCount > 0
                      ? 'bg-volt-400/12 text-volt-300 border-volt-400/35 hover:bg-volt-400/20'
                      : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800'
                  }`}
                  title={tr('Trajne lokalne bilješke koje AI automatski zna u svakom razgovoru', 'Persistent local notes that AI automatically remembers in every conversation')}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tr('Bilješke', 'Notes')}</span>
                  {activeNotesCount > 0 && (
                    <span className="px-1 rounded bg-volt-400/20 text-volt-300 text-[10px]">
                      {activeNotesCount}
                    </span>
                  )}
                </button>

                {activeSession && (
                  <>
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-volt-400 border border-zinc-800 text-[11px] font-mono font-bold transition-colors"
                      title={tr('Započni novi čisti razgovor (stari ostaje sačuvan)', 'Start a fresh conversation (previous one stays saved)')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">{tr('Novi', 'New')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportSession(activeSession)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-100 border border-zinc-800 text-[11px] font-mono font-bold transition-colors"
                      title={tr('Izvezi ovaj razgovor kao Markdown (.md)', 'Export this conversation as Markdown (.md)')}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">.md</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteSession(activeSession)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 border border-zinc-800 hover:border-rose-500/30 text-[11px] font-mono font-bold transition-colors"
                      title={tr('Obriši samo ovaj razgovor i njegove priloge', 'Delete this conversation and its attachments')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              ref={chatContainerRef}
              className={`flex-1 min-h-0 ${messages.length === 0 && !(isSendingChat && sendingSessionId === activeSessionId) ? 'overflow-y-auto p-3 md:p-4' : 'overflow-y-auto p-4 md:p-5'} flex flex-col gap-3 custom-scrollbar`}
            >
              {isLoadingSessions ? (
                <div className="my-auto flex items-center justify-center gap-2 text-xs font-mono text-zinc-500">
                  <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
                  {tr('Učitavanje lokalne povijesti razgovora...', 'Loading local conversation history...')}
                </div>
              ) : messages.length === 0 && !(isSendingChat && sendingSessionId === activeSessionId) && (
                <div className="my-auto flex flex-col items-center justify-center py-1 text-center max-w-2xl mx-auto w-full">
                  <div className="p-2.5 rounded-xl bg-volt-400/10 border border-volt-400/30 text-volt-400 mb-2">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-base md:text-lg font-display font-bold uppercase tracking-wide text-zinc-100 mb-1">
                    {tr('Spreman za analizu, {name}', 'Ready to analyze, {name}', {
                      name: profile?.username || tr('Vozač', 'Rider')
                    })}
                  </h3>
                  <p className="text-xs text-zinc-400 mb-3 max-w-xl leading-relaxed">
                    {tr('Učitao sam vaše dostupne treninge, trenutni FTP (', 'I have loaded your available rides, current FTP (')}
                    <span className="font-mono font-bold text-volt-400">{ftp} W</span>
                    {tr(') i kalendar', ') and calendar')}
                    {activeNotesCount > 0 && (
                      <>
                        {tr(' uz ', ' along with ')}
                        <button type="button" onClick={() => setShowNotesDrawer(true)} className="font-mono font-bold text-volt-400 hover:underline">
                          {isEn
                            ? `${activeNotesCount} coach ${activeNotesCount === 1 ? 'note' : 'notes'}`
                            : `${activeNotesCount} ${activeNotesCount === 1 ? 'bilješku' : 'bilješke'} trenera`}
                        </button>
                      </>
                    )}
                    {tr('. Svi razgovori i nalazi ostaju ', '. All conversations and lab results stay ')}
                    <strong className="text-zinc-200">{tr('100% lokalno na ovom uređaju', '100% local on this device')}</strong>.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
                    {QUICK_PROMPTS_DATA.map((qpObj, idx) => {
                      const qp = tr(qpObj.hr, qpObj.en);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => sendMessage(qp)}
                          className="p-2.5 md:p-3 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/40 text-xs text-zinc-300 hover:text-zinc-100 font-medium transition-all flex items-start gap-2 group"
                        >
                          <Zap className="w-3.5 h-3.5 text-volt-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                          <span>{qp}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {messages.map((m, idx) => {
                const msgKey = m.id || `${activeSessionId || 'new'}_${idx}`;
                return (
                  <div
                    key={msgKey}
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
                        <>
                          <AIMarkdown
                            text={m.text}
                            ftp={ftp}
                            onAddWorkoutToCalendar={onAddWorkoutToCalendar}
                            onStartWorkoutInTrainer={onStartWorkoutInTrainer}
                          />
                          <div className="mt-3 pt-2 border-t border-zinc-800/70 flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msgKey, m.text)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
                              title={tr('Kopiraj odgovor', 'Copy response')}
                            >
                              {copiedMsgId === msgKey ? (
                                <><Check className="w-3 h-3 text-emerald-400" /> <span className="text-emerald-400">{tr('Kopirano', 'Copied')}</span></>
                              ) : (
                                <><Copy className="w-3 h-3" /> {tr('Kopiraj', 'Copy')}</>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveMessageAsNote(m.text)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 hover:text-volt-300 hover:bg-volt-400/10 transition-colors"
                              title={tr('Spremi ključni zaključak u trajne lokalne bilješke trenera', 'Save key takeaway to persistent local coach notes')}
                            >
                              <BookmarkPlus className="w-3 h-3" /> {tr('Zapamti u bilješke', 'Save to Notes')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm font-medium whitespace-pre-wrap">{m.text}</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {isSendingChat && sendingSessionId === activeSessionId && (
                <div className="flex justify-start">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-3 text-xs font-mono font-bold text-volt-300">
                    <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
                    {tr('AI TRENER ANALIZIRA TELEMETRIJU I PRIPREMA ODGOVOR...', 'AI COACH IS ANALYZING TELEMETRY AND PREPARING A RESPONSE...')}
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
                  <Paperclip className="w-3.5 h-3.5 text-volt-400" /> {tr('Priloženo ({count}):', 'Attached ({count}):', { count: pendingAttachments.length })}
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
                      title={tr('Ukloni privitak', 'Remove attachment')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Brze trenerske naredbe za priloženu sliku/dokument */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-900">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                  {tr('Brza akcija:', 'Quick action:')}
                </span>
                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => sendMessage(tr(
                    'Rekreiraj ovaj trening s priložene slike u točan strukturirani ErgVibe workout za moj trenažer (korak po korak s watima i postocima).',
                    'Recreate this workout from the attached image as an exact structured ErgVibe workout for my smart trainer (step-by-step with watts and % FTP).'
                  ))}
                  className="px-2.5 py-1 rounded-md bg-volt-400/10 hover:bg-volt-400/20 border border-volt-400/30 text-volt-300 hover:text-volt-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  title={tr('AI će dekonstruirati grafikon sa slike u izvedivi trenažni workout', 'AI will reverse-engineer the chart from the image into a rideable trainer workout')}
                >
                  <Zap className="w-3 h-3 text-volt-400" /> {tr('Pretvori sliku u workout', 'Convert Image to Workout')}
                </button>
                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => sendMessage(tr(
                    'Detaljno analiziraj ovaj priloženi fiziološki nalaz (laktati, VO2max ili puls) u kontekstu mog profila i ažuriraj moje trenažne zone.',
                    'Analyze this attached physiological report (lactate, VO2max, or heart rate) in detail in the context of my profile and recommend updated training zones.'
                  ))}
                  className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  <Activity className="w-3 h-3 text-sky-400" /> {tr('Analiziraj fiziološki nalaz', 'Analyze Physiological Report')}
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="p-2.5 md:p-3 bg-zinc-950/90 border-t border-zinc-800/80 flex items-center gap-2.5 shrink-0"
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
              className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-volt-400/40 text-zinc-400 hover:text-volt-400 transition-all shrink-0 flex items-center justify-center cursor-pointer disabled:opacity-40"
              title={tr(
                'Priloži sliku ili PDF (Zwift/Garmin/TR grafikon, laktati, spiroergometrija...)',
                'Attach an image or PDF (Zwift/Garmin/TR chart, lactate test, VO2max lab report...)'
              )}
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onPaste={handlePaste}
              disabled={isSendingChat}
              placeholder={
                pendingAttachments.length > 0
                  ? tr("Opiši upute ili klikni 'Pretvori sliku u workout' iznad...", "Add instructions or click 'Convert Image to Workout' above...")
                  : tr('Postavi pitanje ili priloži sliku/PDF (možeš zalijepiti sliku i s Ctrl+V)...', 'Ask a question or attach an image/PDF (you can also paste images with Ctrl+V)...')
              }
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-volt-400 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSendingChat || (!chatInput.trim() && pendingAttachments.length === 0)}
              className="px-5 py-2.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm flex items-center gap-2 transition-all shadow-volt-glow shrink-0"
            >
              {isSendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="hidden sm:inline">{tr('Pošalji', 'Send')}</span>
            </button>
          </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. SUB-TAB: GENERATOR TRENING PLANA
         ===================================================================== */}
      {subTab === 'planner' && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 pb-4">
          <TrainingPlannerView
            profile={profile}
            setProfile={setProfile}
            workouts={workouts}
            wellnessData={wellnessData}
            userId={userId}
            intervalsConnected={intervalsConnected}
            selectedModel={selectedModel}
            initialPrefill={plannerLaunchRequest?.prefill || null}
            forceOpenWizard={Boolean(plannerLaunchRequest?.openWizard)}
            plannerLaunchRequest={plannerLaunchRequest}
            onClearPrefill={onConsumePlannerLaunchRequest}
            onAddWorkoutToCalendar={onAddWorkoutToCalendar}
            onCreatePlanBatch={onCreatePlanBatch}
            onDeletePlanBlock={onDeletePlanBlock}
            onDeletePlanBlocks={onDeletePlanBlocks}
            planRegistry={planRegistry}
            onStartWorkoutInTrainer={onStartWorkoutInTrainer}
            onNavigateToCalendar={onNavigateToCalendar}
            onAnalyzePlanInCoach={onAnalyzePlanInCoach}
            onGeneratingChange={setIsGeneratingPlan}
          />
        </div>
      )}

      {/* =====================================================================
          3. SUB-TAB: BAZA ZNANJA & POVIJEST TRENINGA
         ===================================================================== */}
      {subTab === 'knowledge' && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 pb-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lijeva strana: Povijest treninga */}
          <div className="lg:col-span-7 carbon-panel rounded-xl p-5 md:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-volt-400" /> {tr('Povijest Treninga', 'Training History')}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {tr('Pregled zabilježenih vožnji, opterećenja i uvezenih CSV treninga', 'Overview of recorded rides, training load, and imported CSV workouts')}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-volt-400 border border-volt-400/35 text-xs font-bold transition-all"
                >
                  <Upload className="w-3.5 h-3.5" /> {tr('Učitaj CSV', 'Upload CSV')}
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
                    title={tr('Ukloni sve uvezene CSV treninge iz lokalne memorije', 'Remove all imported CSV workouts from local storage')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" /> {tr('Obriši CSV ({count})', 'Clear CSV ({count})', { count: extraCsvCount })}
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
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">{tr('Ukupno vožnji', 'Total Rides')}</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-zinc-100 mt-0.5">{histStats.totalWorkouts}</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">{tr('Ukupni TSS', 'Total TSS')}</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-amber-400 mt-0.5">{histStats.totalTss.toLocaleString(locale)}</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">{tr('Rekordni FTP', 'Peak FTP')}</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-volt-400 mt-0.5">{histStats.peakFtp} W</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">{tr('Z2 Prosj. EF', 'Z2 Avg EF')}</span>
                    <p className="text-2xl font-display font-bold telemetry-num text-emerald-400 mt-0.5">{histStats.benchmarks.z2AvgEfAllTime ?? '-'}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
                  <table className="w-full text-left text-xs font-mono telemetry-num whitespace-nowrap">
                    <thead className="bg-zinc-900/90 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                      <tr>
                        <th className="px-3.5 py-2.5 font-bold">{tr('Sezona', 'Season')}</th>
                        <th className="px-3.5 py-2.5 font-bold">{tr('Treninzi', 'Rides')}</th>
                        <th className="px-3.5 py-2.5 font-bold">{tr('Sati', 'Hours')}</th>
                        <th className="px-3.5 py-2.5 font-bold">Load (TSS)</th>
                        <th className="px-3.5 py-2.5 font-bold">{tr('Uspon', 'Elevation')}</th>
                        <th className="px-3.5 py-2.5 font-bold">{tr('FTP raspon', 'FTP Range')}</th>
                        <th className="px-3.5 py-2.5 font-bold">Peak CTL</th>
                        <th className="px-3.5 py-2.5 font-bold">Z2 EF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {histStats.yearlyStats.slice().reverse().map(yr => (
                        <tr key={yr.year} className="hover:bg-zinc-900/50">
                          <td className="px-3.5 py-2.5 font-bold text-zinc-100">{yr.year}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.count}</td>
                          <td className="px-3.5 py-2.5 text-zinc-300">{yr.hours} h</td>
                          <td className="px-3.5 py-2.5 font-bold text-amber-400">{yr.tss.toLocaleString(locale)}</td>
                          <td className="px-3.5 py-2.5 text-sky-300">
                            {yr.climb > 0 ? `+${yr.climb.toLocaleString(locale)} m` : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-volt-400 font-semibold">
                            {yr.minFtp ? `${yr.minFtp}–${yr.maxFtp} W` : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-zinc-200 font-semibold">{yr.peakCtl ?? '-'}</td>
                          <td className="px-3.5 py-2.5 text-emerald-400 font-bold">{yr.avgZ2Ef ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {histStats.records && (
                  <div className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-volt-400" /> {tr('Osobni rekordi iz CSV baze', 'Personal Records from CSV History')}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {histStats.minDate} – {histStats.maxDate}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {histStats.records.longestRide && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Najduža vožnja', 'Longest Ride')}</span>
                          <span className="font-mono font-bold text-zinc-100">{(histStats.records.longestRide.durMin / 60).toFixed(1)} h</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.longestRide.name}>
                            {histStats.records.longestRide.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.highestTss && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Najveći TSS', 'Highest TSS')}</span>
                          <span className="font-mono font-bold text-amber-400">{histStats.records.highestTss.tss} TSS</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.highestTss.name}>
                            {histStats.records.highestTss.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.biggestClimb && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Najveći uspon', 'Biggest Climb')}</span>
                          <span className="font-mono font-bold text-sky-300">+{histStats.records.biggestClimb.climb.toLocaleString(locale)} m</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.biggestClimb.name}>
                            {histStats.records.biggestClimb.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.peakCtl && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Vršni Fitness (CTL)', 'Peak Fitness (CTL)')}</span>
                          <span className="font-mono font-bold text-emerald-400">{histStats.records.peakCtl.ctl}</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5">
                            {(histStats.records.peakCtl.date || '').slice(0, 10)}
                          </span>
                        </div>
                      )}
                      {histStats.records.highestNp45 && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Najviši NP (≥45m)', 'Highest NP (≥45m)')}</span>
                          <span className="font-mono font-bold text-volt-400">{histStats.records.highestNp45.np} W</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.highestNp45.name}>
                            {histStats.records.highestNp45.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.peakPmax && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">{tr('Vršni Sprint (pMax)', 'Peak Sprint (pMax)')}</span>
                          <span className="font-mono font-bold text-rose-300">{histStats.records.peakPmax.pMax} W</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.peakPmax.name}>
                            {histStats.records.peakPmax.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-volt-400/5 border border-volt-400/20 text-[11px] text-zinc-300">
                  <Sparkles className="w-4 h-4 text-volt-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <span className="font-bold text-volt-400">{tr('Dubinsko čitanje CSV-a aktivno:', 'Deep CSV Reading Active:')}</span>{' '}
                    {isEn ? (
                      <>
                        AI automatically receives your last 40 workouts (with elevation, cadence, RHR, HRRc, and W&gt;FTP), 12-month and 10-week summaries, and personal records. When you ask about a specific month, season, route, or zone (e.g., <em>&ldquo;May 2025&rdquo;</em>, <em>&ldquo;last 3 months&rdquo;</em>, <em>&ldquo;Alpe d&apos;Huez&rdquo;</em>), it locally searches all <strong>{histStats.totalWorkouts}</strong> rides and sends exact records.
                      </>
                    ) : (
                      <>
                        AI automatski dobiva zadnjih 40 treninga (s usponom, kadencom, RHR, HRRc i W&gt;FTP), mjesečni (12 mj.) i tjedni (10 tj.) pregled te osobne rekorde. Kada pitaš za konkretan mjesec, sezonu, rutu ili zonu (npr. <em>„svibanj 2025.“</em>, <em>„zadnja 3 mjeseca“</em>, <em>„Učka“</em>), lokalno pretražuje svih <strong>{histStats.totalWorkouts}</strong> vožnji i šalje točne zapise.
                      </>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <div className="p-6 bg-zinc-950 rounded-lg border border-zinc-800 text-center space-y-2">
                <History className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <h4 className="text-sm font-display font-bold uppercase tracking-wide text-zinc-200">
                  {tr('Nema učitanih povijesnih treninga za ovaj profil', 'No historical workouts loaded for this profile')}
                </h4>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  {tr(
                    'AI vaše treninge i planove korigira prema vašem zadanom FTP-u, težini, raspoloživom vremenu i odrađenim vožnjama na trenažeru. Možete učitati svoj Intervals.icu CSV izvoz klikom na "Učitaj CSV" iznad ili bilježiti vožnje kroz trenažer.',
                    'AI tailors your workouts and plans based on your FTP, weight, available hours, and completed trainer rides. You can import your Intervals.icu CSV export by clicking "Upload CSV" above or record rides in the trainer.'
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Desna strana: Trenerska literatura i vlastiti izvori */}
          <div className="lg:col-span-5 carbon-panel rounded-xl p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-volt-400" /> {tr('Baza Znanja (Literatura)', 'Knowledge Base (Literature)')}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {tr('Izvori na kojima Gemini temelji analizu i periodizaciju', 'Sources Gemini relies on for analysis and periodization')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {customSources.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllCustomSources}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all"
                    title={tr('Obriši sve vlastite izvore', 'Delete all custom sources')}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" /> {tr('Obriši sve ({count})', 'Delete all ({count})', { count: customSources.length })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddSourceForm(v => !v)}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow"
                >
                  <Plus className="w-3.5 h-3.5" /> {tr('Dodaj izvor', 'Add Source')}
                </button>
              </div>
            </div>

            {showAddSourceForm && (
              <div className="bg-zinc-950 border border-volt-400/30 rounded-xl p-4 md:p-5 space-y-4 animate-in fade-in">
                {/* Zaglavlje i odabir načina unosa */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-volt-400 uppercase tracking-wider block">
                      {tr('Novi izvor znanja za AI Trenera', 'New Knowledge Source for AI Coach')}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {tr('Učitajte PDF, EPUB, YouTube video ili ručno unesite bilješke', 'Upload PDF, EPUB, YouTube video, or enter notes manually')}
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
                      <Upload className="w-3.5 h-3.5" /> {tr('Datoteka', 'File')}
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
                      <FileText className="w-3.5 h-3.5" /> {tr('Obrazac', 'Manual')}
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
                        {tr('Kliknite za odabir PDF, EPUB, TXT ili Markdown datoteke', 'Click to select a PDF, EPUB, TXT, or Markdown file')}
                      </h4>
                      <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-3">
                        {tr('Aplikacija u pregledniku automatski čita stranice ili poglavlja i priprema tekst za bazu.', 'The app extracts pages or chapters locally in your browser and prepares text for the knowledge base.')}
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
                        <Sparkles className="w-3.5 h-3.5 text-volt-400" /> {tr('Automatska AI analiza YouTube videa', 'Automatic AI YouTube Video Analysis')}
                      </p>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        {tr(
                          'Zalijepite poveznicu na biciklistički podcast, studiju ili predavanje (npr. Dylan Johnson, Empirical Cycling, TrainerRoad). Gemini će pogledati video i strukturirati ključne fiziološke koncepte, nalaze i trenažne protokole.',
                          'Paste a link to a cycling podcast, study, or lecture (e.g., Dylan Johnson, Empirical Cycling, TrainerRoad). Gemini will analyze the video and structure key physiological concepts, findings, and training protocols.'
                        )}
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
                        {tr('Analiziraj video', 'Analyze Video')}
                      </button>
                    </div>
                  </form>
                )}

                {/* Status obrade */}
                {isProcessingSource && (
                  <div className="p-4 rounded-lg bg-volt-400/10 border border-volt-400/30 flex items-center gap-3 text-xs font-mono font-bold text-volt-300">
                    <Loader2 className="w-4 h-4 animate-spin text-volt-400 shrink-0" />
                    <span>{sourceProcessingStatus || tr('Obrada izvora u tijeku...', 'Processing source...')}</span>
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
                        {tr('Naslov izvora / knjige / videa *', 'Source / Book / Video Title *')}
                      </label>
                      <input
                        type="text"
                        required
                        value={newSourceTitle}
                        onChange={(e) => setNewSourceTitle(e.target.value)}
                        placeholder={tr('npr. Fast After 50 ili Z2 Mitochondria Study', 'e.g., Fast After 50 or Z2 Mitochondria Study')}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        {tr('Autor / Kanal / Izvor', 'Author / Channel / Source')}
                      </label>
                      <input
                        type="text"
                        value={newSourceAuthor}
                        onChange={(e) => setNewSourceAuthor(e.target.value)}
                        placeholder={tr('npr. Joe Friel ili Dylan Johnson', 'e.g., Joe Friel or Dylan Johnson')}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        {tr('Kategorija izvora', 'Source Category')}
                      </label>
                      <select
                        value={newSourceCategory}
                        onChange={(e) => setNewSourceCategory(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-volt-400"
                      >
                        <option value="PDF literatura">{tr('PDF literatura', 'PDF Literature')}</option>
                        <option value="EPUB knjiga">{tr('EPUB e-knjiga', 'EPUB E-Book')}</option>
                        <option value="YouTube predavanje / podcast">{tr('YouTube predavanje / podcast', 'YouTube Lecture / Podcast')}</option>
                        <option value="Knjiga / poglavlje">{tr('Knjiga / poglavlje', 'Book / Chapter')}</option>
                        <option value="Trenažni protokol">{tr('Trenažni protokol', 'Training Protocol')}</option>
                        <option value="Vlastita literatura">{tr('Vlastita literatura', 'Personal Literature')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                        {tr('Poveznica / URL (opcionalno)', 'Link / URL (optional)')}
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
                        {tr('Sadržaj izvora i trenerska pravila *', 'Source Content & Coaching Rules *')}
                      </label>
                      <span className="text-[10px] text-zinc-500 font-mono telemetry-num">
                        {tr('{count} / 55.000 znakova', '{count} / 55,000 chars', {
                          count: newSourceContent.length.toLocaleString(locale)
                        })}
                      </span>
                    </div>
                    <textarea
                      rows={6}
                      required
                      value={newSourceContent}
                      onChange={(e) => setNewSourceContent(e.target.value)}
                      placeholder={tr(
                        'Zalijepite ključne principe, pravila, zone ili bilješke koje želite da AI Trener uvijek uvažava...',
                        'Paste key principles, rules, zones, or notes you want AI Coach to always consider...'
                      )}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-volt-400 resize-y font-mono leading-relaxed"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-zinc-500">
                      {tr(
                        'Spremljeno u vašu privatnu bazu znanja (AI uzima u obzir pri analizi i planovima).',
                        'Saved to your private knowledge base (used by AI during analysis and planning).'
                      )}
                    </span>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={handleCancelAddSource}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        {tr('Odustani', 'Cancel')}
                      </button>
                      <button
                        type="submit"
                        disabled={isProcessingSource || !newSourceTitle.trim() || !newSourceContent.trim()}
                        className="px-4 py-1.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-50 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-volt-glow"
                      >
                        <Check className="w-3.5 h-3.5" /> {tr('Spremi u Bazu Znanja', 'Save to Knowledge Base')}
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
                    <Sparkles className="w-3.5 h-3.5 text-volt-400" /> {tr('Vlastita literatura i izvori ({count})', 'Personal Literature & Sources ({count})', { count: customSources.length })}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {tr('Spremljeno u pregledniku', 'Saved in browser')}
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
                              {translateSourceCategory(src.category)}
                            </span>
                            {src.sourceUrl && (
                              <a
                                href={src.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-volt-400 hover:underline flex items-center gap-1 font-semibold"
                              >
                                <ExternalLink className="w-3 h-3" /> {tr('Poveznica', 'Link')}
                              </a>
                            )}
                          </div>
                          <h4 className="text-xs md:text-sm font-bold text-zinc-100 mt-1 truncate">{src.title}</h4>
                          <p className="text-[11px] text-zinc-400">{src.author || tr('Nepoznat autor', 'Unknown author')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomSource(src.id, src.title)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors shrink-0"
                          title={tr('Ukloni ovaj izvor iz baze znanja', 'Remove this source from the knowledge base')}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" /> {tr('Ukloni', 'Remove')}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedModuleId(isExpanded ? null : src.id)}
                        className="text-[11px] font-bold text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isExpanded ? tr('Sakrij sadržaj', 'Hide content') : tr('Prikaži sadržaj bilješke / sažetka', 'Show note / summary content')}
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
                  {tr('Ugrađeni trenerski moduli ({count})', 'Built-in Coaching Modules ({count})', { count: BUILT_IN_KNOWLEDGE_MODULES.length })}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {tr('Aktivni i predefinirani', 'Active & built-in')}
                </span>
              </div>
              {BUILT_IN_KNOWLEDGE_MODULES.map(mod => {
                const isEnabled = !disabledModules.includes(mod.id);
                const isExpanded = expandedModuleId === mod.id;
                const enMeta = BUILT_IN_MODULE_EN[mod.id];
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
                          {isEn && enMeta ? enMeta.category : mod.category}
                        </span>
                        <h4 className="text-xs md:text-sm font-bold text-zinc-100">{mod.title}</h4>
                        <p className="text-[11px] text-zinc-500 font-medium">{mod.author}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDisabledModules(toggleBuiltInModule(mod.id))}
                        className="text-volt-400 hover:text-volt-300 shrink-0"
                        title={isEnabled ? tr('Isključi modul', 'Disable module') : tr('Uključi modul', 'Enable module')}
                      >
                        {isEnabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6 text-zinc-600" />}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5">
                      {isEn && enMeta ? enMeta.summary : mod.summary}
                    </p>
                    <button
                      type="button"
                      onClick={() => setExpandedModuleId(isExpanded ? null : mod.id)}
                      className="mt-2 text-[11px] font-bold text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {isExpanded ? tr('Sakrij sažetak pravila', 'Hide rules summary') : tr('Prikaži ugrađena pravila', 'Show built-in rules')}
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
                    title={tr('Preuzmi datoteku', 'Download file')}
                  >
                    <Download className="w-3.5 h-3.5" /> {tr('Preuzmi', 'Download')}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPreviewAttachment(null)}
                  className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                  title={tr('Zatvori', 'Close')}
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

      {/* LOKALNE BILJEŠKE TRENERA (TRAJNA MEMORIJA NA UREĐAJU) */}
      <CoachNotesDrawer
        isOpen={showNotesDrawer}
        onClose={() => setShowNotesDrawer(false)}
        notes={coachNotes}
        prefillText={notePrefillText}
        onClearPrefill={() => setNotePrefillText('')}
        onAddNote={handleAddCoachNote}
        onToggleNote={handleToggleCoachNote}
        onDeleteNote={handleDeleteCoachNote}
      />
    </div>
  );
}

/**
 * Prikazuje minijaturu slike ili PDF karticu u chat oblačiću.
 * Ako slika nije u memoriji (npr. nakon ponovnog učitavanja),
 * automatski je povlači iz lokalnog IndexedDB-a.
 */
function ChatAttachmentItem({ attachment, onPreview }) {
  const { tr } = useI18n();
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
        title={tr('Klikni za uvećanje slike', 'Click to enlarge image')}
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
          <Eye className="w-3.5 h-3.5" /> {tr('Uvećaj', 'Zoom')}
        </div>
      </div>
    );
  }

  // PDF prilog
  return (
    <div
      onClick={() => onPreview && onPreview({ ...attachment, dataUrl })}
      className="flex items-center gap-2.5 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-rose-500/50 cursor-pointer transition-all max-w-xs group"
      title={tr('Klikni za pregled PDF dokumenta', 'Click to preview PDF document')}
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

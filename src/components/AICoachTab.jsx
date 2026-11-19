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

const QUICK_PROMPTS = [
  'Analiziraj moja zadnja 2 tjedna treninga, trenutni fitness (CTL) i formu (TSB).',
  'Analiziraj moju Z2 aerobnu efikasnost (EF) i aerobni decoupling (drift pulsa) na treninzima.',
  'Predloži mi optimalan strukturirani trening za danas na trenažeru (60 min) s obzirom na zadnje vožnje.',
  'Kako mogu optimalno strukturirati tjedan s 4 treninga za stabilan napredak i podizanje FTP-a?'
];

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
      `Obrisati razgovor "${sessionObj.title || 'Razgovor'}" i njegove priložene datoteke s ovog uređaja?`
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
  }, [userId]);

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
          title: generateSessionTitle(content, cleanAttachments),
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
      setChatError(err.message || 'Greška u komunikaciji s Gemini AI.');
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
    <div className="w-full max-w-7xl mx-auto flex-1 min-h-0 h-full flex flex-col gap-2.5 md:gap-3 short:md:gap-2 animate-in fade-in overflow-hidden px-1 md:px-2 pt-1 pb-1">
      {/* GORNJI HEADER + SUB-NAVIGATION */}
      <div className="carbon-panel rounded-xl p-3 md:px-4 md:py-3 short:p-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 short:gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-volt-400/15 border border-volt-400/40 text-volt-400 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
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
                  title={showSessionsSidebar ? 'Sakrij povijest razgovora' : 'Prikaži povijest razgovora'}
                >
                  <PanelLeft className="w-3.5 h-3.5" />
                  <span>{sessions.length}</span>
                </button>

                {/* Mobilni gumb za ladicu povijesti */}
                <button
                  type="button"
                  onClick={() => setShowMobileSessionsDrawer(true)}
                  className="lg:hidden inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-[11px] font-mono font-bold shrink-0"
                  title="Otvori povijest razgovora"
                >
                  <History className="w-3.5 h-3.5 text-volt-400" />
                  <span>Povijest ({sessions.length})</span>
                </button>

                <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-zinc-300 truncate">
                  {activeSession ? activeSession.title : 'Novi razgovor'}
                </span>

                <span
                  className="hidden xl:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0"
                  title="Razgovori i nalazi ostaju isključivo lokalno na ovom uređaju"
                >
                  <Lock className="w-2.5 h-2.5" /> Lokalno
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isSendingChat && sendingSessionId && sendingSessionId !== activeSessionId && (
                  <button
                    type="button"
                    onClick={() => handleSelectSession(sendingSessionId)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-volt-400/12 border border-volt-400/35 text-volt-300 font-mono text-[10px] font-bold"
                    title="Vrati se na razgovor u kojem AI trenutno generira odgovor"
                  >
                    <Loader2 className="w-3 h-3 animate-spin" /> AI piše...
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
                  title="Trajne lokalne bilješke koje AI automatski zna u svakom razgovoru"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bilješke</span>
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
                      title="Započni novi čisti razgovor (stari ostaje sačuvan)"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Novi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportSession(activeSession)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-100 border border-zinc-800 text-[11px] font-mono font-bold transition-colors"
                      title="Izvezi ovaj razgovor kao Markdown (.md)"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">.md</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteSession(activeSession)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 border border-zinc-800 hover:border-rose-500/30 text-[11px] font-mono font-bold transition-colors"
                      title="Obriši samo ovaj razgovor i njegove priloge"
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
                  Učitavanje lokalne povijesti razgovora...
                </div>
              ) : messages.length === 0 && !(isSendingChat && sendingSessionId === activeSessionId) && (
                <div className="my-auto flex flex-col items-center justify-center py-1 text-center max-w-2xl mx-auto w-full">
                  <div className="p-2.5 rounded-xl bg-volt-400/10 border border-volt-400/30 text-volt-400 mb-2">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-base md:text-lg font-display font-bold uppercase tracking-wide text-zinc-100 mb-1">
                    Spreman za analizu, {profile?.username || 'Vozač'}
                  </h3>
                  <p className="text-xs text-zinc-400 mb-3 max-w-xl leading-relaxed">
                    Učitao sam vaše dostupne treninge, trenutni FTP (<span className="font-mono font-bold text-volt-400">{ftp} W</span>) i kalendar
                    {activeNotesCount > 0 && (
                      <> uz <button type="button" onClick={() => setShowNotesDrawer(true)} className="font-mono font-bold text-volt-400 hover:underline">{activeNotesCount} {activeNotesCount === 1 ? 'bilješku' : 'bilješke'} trenera</button></>
                    )}. Svi razgovori i nalazi ostaju <strong className="text-zinc-200">100% lokalno na ovom uređaju</strong>.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
                    {QUICK_PROMPTS.map((qp, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => sendMessage(qp)}
                        className="p-2.5 md:p-3 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-volt-400/40 text-xs text-zinc-300 hover:text-zinc-100 font-medium transition-all flex items-start gap-2 group"
                      >
                        <Zap className="w-3.5 h-3.5 text-volt-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                        <span>{qp}</span>
                      </button>
                    ))}
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
                              title="Kopiraj odgovor"
                            >
                              {copiedMsgId === msgKey ? (
                                <><Check className="w-3 h-3 text-emerald-400" /> <span className="text-emerald-400">Kopirano</span></>
                              ) : (
                                <><Copy className="w-3 h-3" /> Kopiraj</>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveMessageAsNote(m.text)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 hover:text-volt-300 hover:bg-volt-400/10 transition-colors"
                              title="Spremi ključni zaključak u trajne lokalne bilješke trenera"
                            >
                              <BookmarkPlus className="w-3 h-3" /> Zapamti u bilješke
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
              title="Priloži sliku ili PDF (Zwift/Garmin/TR grafikon, laktati, spiroergometrija...)"
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
              placeholder={pendingAttachments.length > 0 ? "Opiši upute ili klikni 'Pretvori sliku u workout' iznad..." : "Postavi pitanje ili priloži sliku/PDF (možeš zalijepiti sliku i s Ctrl+V)..."}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-volt-400 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSendingChat || (!chatInput.trim() && pendingAttachments.length === 0)}
              className="px-5 py-2.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm flex items-center gap-2 transition-all shadow-volt-glow shrink-0"
            >
              {isSendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="hidden sm:inline">Pošalji</span>
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
                        <th className="px-3.5 py-2.5 font-bold">Uspon</th>
                        <th className="px-3.5 py-2.5 font-bold">FTP raspon</th>
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
                          <td className="px-3.5 py-2.5 font-bold text-amber-400">{yr.tss.toLocaleString('hr-HR')}</td>
                          <td className="px-3.5 py-2.5 text-sky-300">
                            {yr.climb > 0 ? `+${yr.climb.toLocaleString('hr-HR')} m` : '-'}
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
                        <Activity className="w-3.5 h-3.5 text-volt-400" /> Osobni rekordi iz CSV baze
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {histStats.minDate} – {histStats.maxDate}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {histStats.records.longestRide && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Najduža vožnja</span>
                          <span className="font-mono font-bold text-zinc-100">{(histStats.records.longestRide.durMin / 60).toFixed(1)} h</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.longestRide.name}>
                            {histStats.records.longestRide.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.highestTss && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Najveći TSS</span>
                          <span className="font-mono font-bold text-amber-400">{histStats.records.highestTss.tss} TSS</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.highestTss.name}>
                            {histStats.records.highestTss.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.biggestClimb && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Najveći uspon</span>
                          <span className="font-mono font-bold text-sky-300">+{histStats.records.biggestClimb.climb.toLocaleString('hr-HR')} m</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.biggestClimb.name}>
                            {histStats.records.biggestClimb.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.peakCtl && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Vršni Fitness (CTL)</span>
                          <span className="font-mono font-bold text-emerald-400">{histStats.records.peakCtl.ctl}</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5">
                            {(histStats.records.peakCtl.date || '').slice(0, 10)}
                          </span>
                        </div>
                      )}
                      {histStats.records.highestNp45 && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Najviši NP (≥45m)</span>
                          <span className="font-mono font-bold text-volt-400">{histStats.records.highestNp45.np} W</span>
                          <span className="block text-[10px] text-zinc-400 truncate mt-0.5" title={histStats.records.highestNp45.name}>
                            {histStats.records.highestNp45.name}
                          </span>
                        </div>
                      )}
                      {histStats.records.peakPmax && (
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-md p-2.5">
                          <span className="font-mono text-[10px] uppercase text-zinc-500 block">Vršni Sprint (pMax)</span>
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
                    <span className="font-bold text-volt-400">Dubinsko čitanje CSV-a aktivno:</span> AI automatski dobiva zadnjih 40 treninga (s usponom, kadencom, RHR, HRRc i W&gt;FTP), mjesečni (12 mj.) i tjedni (10 tj.) pregled te osobne rekorde. Kada pitaš za konkretan mjesec, sezonu, rutu ili zonu (npr. <em>„svibanj 2025.“</em>, <em>„zadnja 3 mjeseca“</em>, <em>„Učka“</em>), lokalno pretražuje svih <strong>{histStats.totalWorkouts}</strong> vožnji i šalje točne zapise.
                  </p>
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

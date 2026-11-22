/**
 * ErgVibe AI Chat & Coach Notes Local Storage Service
 *
 * 100% lokalna pohrana isključivo na uređaju korisnika (IndexedDB + localStorage fallback):
 * - Razgovori i zdravstveni/fiziološki nalazi NIKADA se ne šalju u Supabase bazu.
 * - Više zasebnih razgovora bez ograničenja od 30 poruka.
 * - Odvojeno po korisničkom računu (userId / guest).
 * - Automatska migracija starog pojedinačnog chata (ergvibe_ai_coach_chat_v1).
 * - Lokalne "Bilješke trenera" koje AI automatski zna u svakom novom razgovoru.
 */

import { deleteAttachmentFromLocalDB } from './aiFilesStorage';
import { tr, getLocale } from '../i18n/i18nCore.js';

const DB_NAME = 'ergvibe_ai_chat_db';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

const LEGACY_CHAT_KEY = 'ergvibe_ai_coach_chat_v1';
const LEGACY_MIGRATED_KEY = 'ergvibe_ai_chat_legacy_migrated_v1';
const LS_SESSIONS_FALLBACK_PREFIX = 'ergvibe_ai_chat_sessions_fallback_v1_';
const LS_ACTIVE_SESSION_PREFIX = 'ergvibe_ai_active_session_v1_';
const LS_DRAFT_PREFIX = 'ergvibe_ai_chat_draft_v1_';
const LS_COACH_NOTES_PREFIX = 'ergvibe_ai_coach_notes_v1_';

export const COACH_NOTE_CATEGORIES = [
  'Fiziologija & Zone',
  'Zdravlje & Ozljede',
  'Ciljevi & Raspored',
  'Općenito'
];

function normalizeUserKey(userId) {
  return String(userId || 'guest').trim() || 'guest';
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB nije podržan u ovom pregledniku.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        store.createIndex('by_user', 'userId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Greška pri otvaranju lokalne chat baze.'));
  });
}

function sanitizeMessageForStorage(msg, idx = 0) {
  const clean = {
    id: msg?.id || `msg_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    role: msg?.role === 'user' ? 'user' : 'model',
    text: String(msg?.text ?? msg?.content ?? ''),
    createdAt: msg?.createdAt || new Date().toISOString()
  };

  if (Array.isArray(msg?.attachments) && msg.attachments.length > 0) {
    clean.attachments = msg.attachments.map(({ id, name, type, size }) => ({
      id,
      name: name || 'privitak',
      type: type || 'application/octet-stream',
      size: Number(size) || 0
    }));
  }

  return clean;
}

function sanitizeSessionForStorage(session) {
  const nowIso = new Date().toISOString();
  const messages = Array.isArray(session?.messages)
    ? session.messages.map((m, idx) => sanitizeMessageForStorage(m, idx))
    : [];

  return {
    id: session?.id || createSessionId(),
    userId: normalizeUserKey(session?.userId),
    title: String(session?.title || tr('Novi razgovor', 'New Chat')).trim() || tr('Novi razgovor', 'New Chat'),
    isCustomTitle: Boolean(session?.isCustomTitle),
    createdAt: session?.createdAt || nowIso,
    updatedAt: session?.updatedAt || nowIso,
    messages
  };
}

export function createSessionId() {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Generira čitljiv kratki naslov razgovora iz prve poruke ili naziva privitka.
 */
export function generateSessionTitle(text = '', attachments = []) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[-•*#\s]+/, '')
    .trim();

  if (cleaned.length > 0) {
    return cleaned.length > 52 ? `${cleaned.slice(0, 51).trim()}…` : cleaned;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const firstName = attachments[0]?.name || tr('datoteka', 'file');
    const label = `${tr('Analiza', 'Analysis')}: ${firstName}`;
    return label.length > 52 ? `${label.slice(0, 51).trim()}…` : label;
  }

  return tr('Novi razgovor', 'New Chat');
}

function readFallbackSessions(userId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(`${LS_SESSIONS_FALLBACK_PREFIX}${normalizeUserKey(userId)}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFallbackSessions(userId, sessions) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    // U fallbacku držimo zadnjih 15 razgovora kao zaštitu ako IndexedDB nije dostupan
    const trimmed = sessions.slice(0, 15);
    window.localStorage.setItem(
      `${LS_SESSIONS_FALLBACK_PREFIX}${normalizeUserKey(userId)}`,
      JSON.stringify(trimmed)
    );
  } catch {
    // ignore quota error
  }
}

async function readIdbSessionsByUser(userId) {
  const key = normalizeUserKey(userId);
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const index = store.index('by_user');
      const req = index.getAll(key);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('Greška pri čitanju razgovora iz IndexedDB.'));
    });
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

async function putIdbSession(cleanSession) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.put(cleanSession);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Greška pri spremanju razgovora u IndexedDB.'));
    });
    return true;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

async function deleteIdbSession(sessionId) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.delete(sessionId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Greška pri brisanju razgovora iz IndexedDB.'));
    });
    return true;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function sortSessionsDesc(list) {
  return [...list].sort((a, b) =>
    String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''))
  );
}

/**
 * Jednokratno migrira postojeći stari chat iz localStorage (`ergvibe_ai_coach_chat_v1`)
 * u prvi strukturirani razgovor kako korisnici ne bi izgubili postojeću povijest.
 */
async function maybeMigrateLegacyChat(userId, existingSessions) {
  if (typeof window === 'undefined' || !window.localStorage) return existingSessions;
  try {
    if (window.localStorage.getItem(LEGACY_MIGRATED_KEY) === 'true') {
      return existingSessions;
    }
    const raw = window.localStorage.getItem(LEGACY_CHAT_KEY);
    if (!raw) {
      window.localStorage.setItem(LEGACY_MIGRATED_KEY, 'true');
      return existingSessions;
    }
    const legacyMessages = JSON.parse(raw);
    if (!Array.isArray(legacyMessages) || legacyMessages.length === 0) {
      window.localStorage.setItem(LEGACY_MIGRATED_KEY, 'true');
      return existingSessions;
    }

    const firstUser = legacyMessages.find((m) => m?.role === 'user');
    const title = firstUser
      ? generateSessionTitle(firstUser.text, firstUser.attachments)
      : 'Prethodni razgovor';

    const nowIso = new Date().toISOString();
    const migratedSession = sanitizeSessionForStorage({
      id: createSessionId(),
      userId,
      title,
      isCustomTitle: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: legacyMessages
    });

    await saveChatSession(migratedSession);
    window.localStorage.setItem(LEGACY_MIGRATED_KEY, 'true');
    // Uklanjamo stari ključ tek nakon uspješne migracije da se ne duplicira
    window.localStorage.removeItem(LEGACY_CHAT_KEY);

    return sortSessionsDesc([migratedSession, ...existingSessions]);
  } catch (err) {
    console.warn('[aiChatStorage] Migracija starog chata upozorenje:', err);
    return existingSessions;
  }
}

/**
 * Učitava sve spremljene razgovore za zadanog korisnika (najnoviji prvi).
 */
export async function loadChatSessions(userId) {
  let sessions = [];
  try {
    sessions = await readIdbSessionsByUser(userId);
  } catch (err) {
    console.warn('[aiChatStorage] IndexedDB nedostupan, koristim localStorage fallback:', err);
    sessions = readFallbackSessions(userId);
  }

  sessions = sortSessionsDesc(sessions);
  sessions = await maybeMigrateLegacyChat(userId, sessions);
  return sessions;
}

/**
 * Sprema (ili ažurira) jedan razgovor u lokalni IndexedDB.
 */
export async function saveChatSession(session) {
  const clean = sanitizeSessionForStorage(session);
  try {
    await putIdbSession(clean);
  } catch (err) {
    console.warn('[aiChatStorage] IndexedDB save fallback:', err);
    const prev = readFallbackSessions(clean.userId).filter((s) => s.id !== clean.id);
    writeFallbackSessions(clean.userId, sortSessionsDesc([clean, ...prev]));
  }
  return clean;
}

/**
 * Briše jedan razgovor i uklanja isključivo privitke (slike/PDF) koji pripadaju tom razgovoru.
 */
export async function deleteChatSession(userId, sessionObjOrId) {
  const sessionId = typeof sessionObjOrId === 'string' ? sessionObjOrId : sessionObjOrId?.id;
  if (!sessionId) return;

  const sessionObj = typeof sessionObjOrId === 'object' ? sessionObjOrId : null;
  const attachmentIds = [];
  if (sessionObj && Array.isArray(sessionObj.messages)) {
    sessionObj.messages.forEach((m) => {
      if (Array.isArray(m?.attachments)) {
        m.attachments.forEach((att) => {
          if (att?.id) attachmentIds.push(att.id);
        });
      }
    });
  }

  try {
    await deleteIdbSession(sessionId);
  } catch (err) {
    console.warn('[aiChatStorage] IndexedDB delete upozorenje:', err);
  }

  // Očisti i fallback ako postoji
  const prevFallback = readFallbackSessions(userId);
  if (prevFallback.length > 0) {
    writeFallbackSessions(userId, prevFallback.filter((s) => s.id !== sessionId));
  }

  // Očisti samo privitke izbrisane sesije iz IndexedDB-a
  for (const attId of attachmentIds) {
    try {
      await deleteAttachmentFromLocalDB(attId);
    } catch {
      // ignore
    }
  }
}

/**
 * Pamti ID zadnjeg otvorenog razgovora po korisniku.
 */
export function getActiveChatSessionId(userId) {
  try {
    return window.localStorage.getItem(`${LS_ACTIVE_SESSION_PREFIX}${normalizeUserKey(userId)}`) || null;
  } catch {
    return null;
  }
}

export function setActiveChatSessionId(userId, sessionId) {
  try {
    const key = `${LS_ACTIVE_SESSION_PREFIX}${normalizeUserKey(userId)}`;
    if (!sessionId) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, sessionId);
    }
  } catch {
    // ignore
  }
}

/**
 * Pamti nedovršeni tekst poruke (draft) po korisniku.
 */
export function getChatDraft(userId) {
  try {
    return window.localStorage.getItem(`${LS_DRAFT_PREFIX}${normalizeUserKey(userId)}`) || '';
  } catch {
    return '';
  }
}

export function setChatDraft(userId, text) {
  try {
    const key = `${LS_DRAFT_PREFIX}${normalizeUserKey(userId)}`;
    if (!text) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, text);
    }
  } catch {
    // ignore
  }
}

/**
 * Izvozi razgovor kao čitljivu Markdown (.md) datoteku.
 */
export function exportChatSessionAsMarkdown(session) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) return;

  const dateStr = (session.updatedAt || session.createdAt || new Date().toISOString()).slice(0, 10);
  const lines = [
    `# ${session.title || tr('ErgVibe AI Trener — Razgovor', 'ErgVibe AI Coach — Conversation')}`,
    '',
    `- **${tr('Datum', 'Date')}:** ${dateStr}`,
    `- **${tr('Broj poruka', 'Messages')}:** ${session.messages.length}`,
    `- **${tr('Izvor', 'Source')}:** ${tr('ErgVibe AI Trener (lokalni izvoz)', 'ErgVibe AI Coach (local export)')}`,
    '',
    '---',
    ''
  ];

  session.messages.forEach((m) => {
    const who = m.role === 'user' ? tr('Vozač', 'Rider') : tr('ErgVibe AI Trener', 'ErgVibe AI Coach');
    const ts = m.createdAt
      ? ` _(${new Date(m.createdAt).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})_`
      : '';
    lines.push(`## ${who}${ts}`);
    lines.push('');

    if (Array.isArray(m.attachments) && m.attachments.length > 0) {
      const names = m.attachments.map((a) => `\`${a.name || tr('prilog', 'attachment')}\``).join(', ');
      lines.push(`> ${tr('Prilozi', 'Attachments')}: ${names}`);
      lines.push('');
    }

    if (m.text) {
      lines.push(m.text);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeSlug = String(session.title || 'razgovor')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'razgovor';
  a.href = url;
  a.download = `ergvibe_ai_${safeSlug}_${dateStr}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ============================================================================
// LOKALNE BILJEŠKE TRENERA (Trajna memorija između razgovora, 100% lokalno)
// ============================================================================

function getNotesKey(userId) {
  return `${LS_COACH_NOTES_PREFIX}${normalizeUserKey(userId)}`;
}

export function getCoachNotes(userId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(getNotesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCoachNotesList(userId, notes) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(getNotesKey(userId), JSON.stringify(notes));
  } catch {
    // ignore
  }
}

export function addCoachNote(userId, { text, category = 'Fiziologija & Zone' }) {
  const cleaned = String(text || '').trim();
  if (!cleaned) throw new Error(tr('Tekst bilješke ne može biti prazan.', 'Note text cannot be empty.'));

  const existing = getCoachNotes(userId);
  const note = {
    id: `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text: cleaned.slice(0, 600),
    category: COACH_NOTE_CATEGORIES.includes(category) ? category : 'Općenito',
    enabled: true,
    createdAt: new Date().toISOString()
  };

  const updated = [note, ...existing].slice(0, 40);
  saveCoachNotesList(userId, updated);
  return updated;
}

export function toggleCoachNote(userId, noteId) {
  const existing = getCoachNotes(userId);
  const updated = existing.map((n) => (n.id === noteId ? { ...n, enabled: !n.enabled } : n));
  saveCoachNotesList(userId, updated);
  return updated;
}

export function deleteCoachNote(userId, noteId) {
  const existing = getCoachNotes(userId);
  const updated = existing.filter((n) => n.id !== noteId);
  saveCoachNotesList(userId, updated);
  return updated;
}

/**
 * Sastavlja aktivne lokalne bilješke trenera za sistemski prompt AI Trenera.
 */
export function compileCoachNotesPrompt(userId) {
  const activeNotes = getCoachNotes(userId).filter((n) => n && n.enabled !== false && n.text);
  if (activeNotes.length === 0) return '';

  const lines = activeNotes.slice(0, 25).map((n) => {
    const dateTag = n.createdAt ? n.createdAt.slice(0, 10) : '';
    return `- [${n.category}${dateTag ? ` · ${dateTag}` : ''}] ${n.text}`;
  });

  return `## TRAJNE BILJEŠKE TRENERA (OSOBNA MEMORIJA SPORTAŠA — OBAVEZNO UVAŽITI)\n${lines.join('\n')}`;
}

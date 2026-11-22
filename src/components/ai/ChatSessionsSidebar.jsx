import React, { useState } from 'react';
import {
  Plus, MessageSquare, Pencil, Trash2, Download, Check, X, Lock, Search
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

function formatSessionDate(isoStr, locale, tr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isYesterday) return tr('jučer', 'yesterday');

  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

function pluralMessages(count, isEn) {
  const n = Number(count) || 0;
  if (isEn) {
    return n === 1 ? '1 message' : `${n} messages`;
  }
  if (n === 1) return '1 poruka';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${n} poruke`;
  }
  return `${n} poruka`;
}

export default function ChatSessionsSidebar({
  sessions = [],
  activeSessionId = null,
  sendingSessionId = null,
  onSelectSession,
  onNewChat,
  onRenameSession,
  onDeleteSession,
  onExportSession,
  onCloseMobile
}) {
  const { isEn, locale, tr } = useI18n();
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) => {
        const q = searchQuery.trim().toLowerCase();
        if (String(s.title || '').toLowerCase().includes(q)) return true;
        return Array.isArray(s.messages) && s.messages.some((m) => String(m.text || '').toLowerCase().includes(q));
      })
    : sessions;

  const startEditing = (session, e) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditingTitle(session.title || '');
  };

  const commitEditing = (sessionId, e) => {
    if (e) e.stopPropagation();
    const trimmed = editingTitle.trim();
    if (trimmed) {
      onRenameSession(sessionId, trimmed);
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const cancelEditing = (e) => {
    if (e) e.stopPropagation();
    setEditingId(null);
    setEditingTitle('');
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950/95 border-r border-zinc-800/90">
      {/* Top: Novi razgovor */}
      <div className="p-2.5 border-b border-zinc-800/80 flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            if (onCloseMobile) onCloseMobile();
          }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow/50 active:scale-[0.99]"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{tr('Novi razgovor', 'New Chat')}</span>
        </button>

        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800 lg:hidden shrink-0"
            title={tr('Zatvori povijest', 'Close history')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Brza pretraga kad se nakupi >= 4 razgovora */}
      {sessions.length >= 4 && (
        <div className="px-2.5 pt-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr('Pretraži razgovore...', 'Search conversations...')}
              className="w-full bg-zinc-900/90 border border-zinc-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-volt-400/60 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Lista razgovora */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {filteredSessions.length === 0 ? (
          <div className="text-center py-8 px-3">
            <MessageSquare className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-medium">
              {searchQuery
                ? tr('Nema podudaranja.', 'No matches found.')
                : tr('Još nema spremljenih razgovora.', 'No saved conversations yet.')}
            </p>
            {!searchQuery && (
              <p className="text-[10px] text-zinc-600 mt-1">
                {tr('Svaki novi razgovor automatski se sprema lokalno.', 'Every new conversation is automatically saved locally.')}
              </p>
            )}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = editingId === session.id;
            const isSendingHere = sendingSessionId === session.id;
            const msgCount = Array.isArray(session.messages) ? session.messages.length : 0;
            const displayTitle =
              !session.isCustomTitle && session.title === 'Novi razgovor'
                ? tr('Novi razgovor', 'New Chat')
                : session.title || tr('Razgovor', 'Conversation');

            return (
              <div
                key={session.id}
                onClick={() => {
                  if (isEditing) return;
                  onSelectSession(session.id);
                  if (onCloseMobile) onCloseMobile();
                }}
                className={`group rounded-lg px-2.5 py-2 border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-volt-400/12 border-volt-400/35 text-zinc-100'
                    : 'bg-zinc-900/40 hover:bg-zinc-900 border-transparent hover:border-zinc-800 text-zinc-300'
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEditing(session.id, e);
                        if (e.key === 'Escape') cancelEditing(e);
                      }}
                      className="flex-1 min-w-0 bg-zinc-950 border border-volt-400/60 rounded px-2 py-1 text-xs text-zinc-100 outline-none"
                    />
                    <button
                      type="button"
                      onClick={(e) => commitEditing(session.id, e)}
                      className="p-1 rounded bg-volt-400 text-zinc-950 hover:bg-volt-300 shrink-0"
                      title={tr('Spremi naziv', 'Save title')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="p-1 rounded bg-zinc-800 text-zinc-300 hover:text-white shrink-0"
                      title={tr('Odustani', 'Cancel')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isSendingHere && (
                          <span className="w-1.5 h-1.5 rounded-full bg-volt-400 animate-ping shrink-0" />
                        )}
                        <span className={`text-xs font-semibold truncate ${isActive ? 'text-volt-300' : 'text-zinc-200'}`}>
                          {displayTitle}
                        </span>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={(e) => startEditing(session, e)}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                          title={tr('Preimenuj razgovor', 'Rename conversation')}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportSession(session);
                          }}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-volt-400 transition-colors"
                          title={tr('Izvezi kao Markdown (.md)', 'Export as Markdown (.md)')}
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(session);
                          }}
                          className="p-1 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 transition-colors"
                          title={tr('Obriši razgovor', 'Delete conversation')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-1 font-mono text-[10px] text-zinc-500">
                      <span>{pluralMessages(msgCount, isEn)}</span>
                      <span>{formatSessionDate(session.updatedAt || session.createdAt, locale, tr)}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Privacy footer */}
      <div className="px-3 py-2 border-t border-zinc-800/80 bg-zinc-950 text-[10px] font-mono text-zinc-500 flex items-center gap-1.5 shrink-0">
        <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
        <span
          className="truncate"
          title={tr(
            'Svi razgovori i prilozi ostaju isključivo lokalno na ovom uređaju i nikad se ne spremaju na server.',
            'All conversations and attachments stay strictly local on this device and are never saved to a server.'
          )}
        >
          {tr('100% lokalno na ovom uređaju', '100% local on this device')}
        </span>
      </div>
    </div>
  );
}

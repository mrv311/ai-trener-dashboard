import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark, Plus, Trash2, X, Lock, ToggleLeft, ToggleRight, Sparkles
} from 'lucide-react';
import { COACH_NOTE_CATEGORIES } from '../../services/aiChatStorage';

export default function CoachNotesDrawer({
  isOpen,
  onClose,
  notes = [],
  prefillText = '',
  onClearPrefill,
  onAddNote,
  onToggleNote,
  onDeleteNote
}) {
  const [noteText, setNoteText] = useState('');
  const [category, setCategory] = useState(COACH_NOTE_CATEGORIES[0]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && prefillText) {
      setNoteText(prefillText);
      setError(null);
      if (onClearPrefill) onClearPrefill();
    }
  }, [isOpen, prefillText, onClearPrefill]);

  if (!isOpen) return null;

  const activeCount = notes.filter((n) => n.enabled !== false).length;

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = noteText.trim();
    if (!cleaned) {
      setError('Upiši kratku bilješku (npr. laktatni pragovi, ozljeda, ograničenje vremena).');
      return;
    }
    try {
      onAddNote({ text: cleaned, category });
      setNoteText('');
      setError(null);
    } catch (err) {
      setError(err.message || 'Greška pri spremanju bilješke.');
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[125] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="carbon-panel border-volt-400/35 rounded-2xl p-4 md:p-6 max-w-xl w-full max-h-[88dvh] shadow-2xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-volt-400/15 border border-volt-400/35 text-volt-400 shrink-0">
              <Bookmark className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-lg md:text-xl uppercase tracking-wide text-zinc-100">
                  Bilješke Trenera
                </h3>
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-volt-400/15 text-volt-300 border border-volt-400/30">
                  {activeCount} AKTIVNO
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Trajna memorija koju AI Trener automatski zna u svakom novom razgovoru, analizi i planu.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800 transition-colors shrink-0"
            title="Zatvori"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Privacy napomena */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/25 text-[11px] text-emerald-300 shrink-0">
          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            Bilješke se čuvaju <strong>100% lokalno na ovom uređaju</strong> (ne šalju se u Supabase bazu).
          </span>
        </div>

        {/* Forma za dodavanje nove bilješke */}
        <form onSubmit={handleSubmit} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Nova trajna bilješka
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1 text-[11px] font-mono font-bold text-zinc-300 focus:border-volt-400 outline-none"
            >
              {COACH_NOTE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <textarea
            rows={3}
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
              if (error) setError(null);
            }}
            maxLength={600}
            placeholder="Npr. Laktatni test 11/2026: LT1 195 W / 142 bpm, LT2 272 W / 168 bpm. Osjetljivo lijevo koljeno ispod 75 rpm..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs md:text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-volt-400 outline-none resize-none"
          />

          {error && (
            <p className="text-xs text-rose-400 font-medium">{error}</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-zinc-500">
              {noteText.length}/600 znakova
            </span>
            <button
              type="submit"
              disabled={!noteText.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold uppercase tracking-wider text-xs transition-all"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Spremi bilješku</span>
            </button>
          </div>
        </form>

        {/* Lista spremljenih bilješki */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2 pr-0.5">
          {notes.length === 0 ? (
            <div className="text-center py-8 px-4 bg-zinc-950/60 border border-dashed border-zinc-800 rounded-xl">
              <Sparkles className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs font-semibold text-zinc-400">Još nemaš spremljenih bilješki trenera.</p>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
                Dodaj ključne nalaze (LT1/LT2, krvna slika, ozljede) ili klikni <strong>&quot;Zapamti u bilješke&quot;</strong> ispod bilo kojeg AI odgovora.
              </p>
            </div>
          ) : (
            notes.map((note) => {
              const enabled = note.enabled !== false;
              return (
                <div
                  key={note.id}
                  className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                    enabled
                      ? 'bg-zinc-950 border-zinc-800 text-zinc-200'
                      : 'bg-zinc-950/40 border-zinc-900 text-zinc-500 opacity-65'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-volt-300">
                        {note.category || 'Općenito'}
                      </span>
                      {note.createdAt && (
                        <span className="font-mono text-[10px] text-zinc-500">
                          {new Date(note.createdAt).toLocaleDateString('hr-HR')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs md:text-sm whitespace-pre-wrap leading-relaxed">
                      {note.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleNote(note.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        enabled
                          ? 'text-volt-400 hover:bg-volt-400/10'
                          : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900'
                      }`}
                      title={enabled ? 'Aktivno u AI kontekstu (klikni za pauzu)' : 'Pauzirano (klikni za aktivaciju)'}
                    >
                      {enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note.id)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Obriši bilješku"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

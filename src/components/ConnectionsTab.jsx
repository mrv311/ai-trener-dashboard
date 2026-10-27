import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Link as LinkIcon, Unlink, HardDriveDownload, ShieldCheck, Check, Eye, EyeOff } from 'lucide-react';

export default function ConnectionsTab({ connectionStatus, connectionError, intervalsId, setId, intervalsKey, setKey, onSave, onDisconnect, userId }) {
  const [draftId, setDraftId] = useState(() => String(intervalsId ?? ''));
  const [draftKey, setDraftKey] = useState(() => String(intervalsKey ?? ''));
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setDraftId(String(intervalsId ?? ''));
  }, [intervalsId]);

  useEffect(() => {
    setDraftKey(String(intervalsKey ?? ''));
  }, [intervalsKey]);

  const isConfigured = Boolean(String(intervalsId ?? '').trim() && String(intervalsKey ?? '').trim());

  const saveSettings = (e) => {
    if (e) e.preventDefault();
    const cleanId = String(draftId ?? '').trim();
    const cleanKey = String(draftKey ?? '').trim();

    const unchanged = cleanId === String(intervalsId ?? '').trim() && cleanKey === String(intervalsKey ?? '').trim();
    setId(cleanId);
    setKey(cleanKey);

    if (unchanged && onSave) {
      onSave();
    }
  };

  const handleDisconnect = () => {
    setDraftId('');
    setDraftKey('');
    setId('');
    setKey('');
    if (onDisconnect) {
      onDisconnect();
    }
  };

  return (
    <div className="max-w-5xl mx-auto bg-zinc-900/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-800/80 animate-in fade-in flex flex-col p-6 md:p-8 mb-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="mb-8 border-b border-zinc-800/80 pb-6 relative z-10">
        <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center gap-2.5 tracking-tight">
          Način rada i vanjske veze
        </h2>
        <p className="text-zinc-400 text-sm mt-2 leading-relaxed max-w-2xl">
          ErgVibe radi potpuno samostalno bez obaveznih vanjskih računa. Povezivanje s platformom Intervals.icu je opcionalno.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 relative z-10 items-start">

        {/* 1. Samostalni način rada & .FIT Izvoz */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <HardDriveDownload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-100 text-base">Samostalan način rada</h3>
                <span className="text-[11px] text-zinc-500">Direktan izvoz treninga</span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Uvijek aktivan
            </span>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Svaki odrađeni trening automatski se sprema u memoriju aplikacije. Po završetku vožnje u tabu <strong className="text-zinc-200">Trenažer</strong> jednim klikom preuzimaš industrijski standardnu <strong className="text-cyan-400">.FIT datoteku</strong> kompatibilnu s:
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-zinc-300">
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> Garmin Connect
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> Strava
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> TrainingPeaks
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> Bilo koji analizator
            </div>
          </div>
        </div>

        {/* 2. Intervals.icu sinkronizacija */}
        <form onSubmit={saveSettings} className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
                <LinkIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-100 text-base">Intervals.icu</h3>
                <span className="text-[11px] text-zinc-500">Automatski kalendar i upload</span>
              </div>
            </div>

            {connectionStatus === 'connected' && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Povezano
              </span>
            )}
            {connectionStatus === 'connecting' && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                <Clock className="w-3 h-3 animate-spin" /> Spajanje...
              </span>
            )}
            {connectionStatus === 'error' && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1" title={connectionError}>
                <XCircle className="w-3 h-3" /> Greška
              </span>
            )}
            {connectionStatus === 'idle' && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700">
                Nije spojeno
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Ako želiš automatsko povlačenje treninga iz svog Intervals.icu kalendara i automatski upload po završetku vožnje, unesi svoje pristupne podatke:
          </p>

          <div className="space-y-3 mt-1">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-zinc-400 mb-1.5">
                Korisnički ID (Athlete ID)
              </label>
              <input
                type="text"
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder="npr. i12345 ili brojčani ID"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3.5 py-2.5 text-zinc-100 font-mono text-xs focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all placeholder:text-zinc-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-zinc-400 mb-1.5">
                API Ključ (Settings &gt; Developer &gt; API Keys)
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="Unesi svoj privatni API ključ"
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3.5 py-2.5 pr-10 text-zinc-100 font-mono text-xs focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all placeholder:text-zinc-600"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title={showKey ? 'Sakrij ključ' : 'Prikaži ključ'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {connectionError && (
              <p className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 font-medium">
                {connectionError}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={!String(draftId ?? '').trim() || !String(draftKey ?? '').trim()}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 py-3 px-4 rounded-xl font-bold shadow-[0_4px_15px_rgba(34,211,238,0.25)] transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 border border-cyan-400/30"
              >
                <LinkIcon className="w-4 h-4" /> Spremi i Poveži
              </button>

              {(isConfigured || String(draftId ?? '').trim() || String(draftKey ?? '').trim()) && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-zinc-800/80 hover:bg-red-500/15 text-zinc-300 hover:text-red-400 border border-zinc-700 hover:border-red-500/30 transition-all flex items-center justify-center gap-2 shrink-0"
                >
                  <Unlink className="w-4 h-4" /> Odspoji
                </button>
              )}
            </div>
          </div>
        </form>

      </div>
    </div>
  );
}

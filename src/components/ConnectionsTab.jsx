import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Link as LinkIcon, Unlink, HardDriveDownload, ShieldCheck, Check, Eye, EyeOff, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { getGeminiConfigStatus, setCustomGeminiApiKey } from '../services/geminiService';
import { startIntervalsOAuth } from '../services/intervalsOAuth';

export default function ConnectionsTab({ connectionStatus, connectionError, intervalsId, setId, intervalsKey, setKey, onSave, onDisconnect, userId, athleteInfo }) {
  const [draftId, setDraftId] = useState(() => String(intervalsId ?? ''));
  const [draftKey, setDraftKey] = useState(() => String(intervalsKey ?? ''));
  const [showKey, setShowKey] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState(() => getGeminiConfigStatus());
  const [customGeminiDraft, setCustomGeminiDraft] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  useEffect(() => {
    setDraftId(String(intervalsId ?? ''));
  }, [intervalsId]);

  useEffect(() => {
    setDraftKey(String(intervalsKey ?? ''));
  }, [intervalsKey]);

  const isConfigured = Boolean(String(intervalsId ?? '').trim() && String(intervalsKey ?? '').trim());
  const isOAuth = String(intervalsKey ?? '').toLowerCase().startsWith('bearer ');

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
    <div className="max-w-5xl mx-auto carbon-panel rounded-xl animate-in fade-in flex flex-col p-6 md:p-8 mb-8 relative overflow-hidden">

      <div className="mb-8 border-b border-zinc-800/80 pb-6 relative z-10">
        <h2 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wide text-zinc-100 flex items-center gap-2.5">
          Način rada i vanjske veze
        </h2>
        <p className="text-zinc-400 text-sm mt-2 leading-relaxed max-w-2xl">
          ErgVibe radi potpuno samostalno bez obaveznih vanjskih računa. Povezivanje s platformom Intervals.icu je opcionalno.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10 items-start">

        {/* 1. Samostalni način rada & .FIT Izvoz */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-volt-400/10 border border-volt-400/25 text-volt-400">
                <HardDriveDownload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-base">Samostalan način rada</h3>
                <span className="text-[11px] text-zinc-500">Direktan izvoz treninga</span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1 shrink-0">
              <ShieldCheck className="w-3 h-3" /> UVIJEK AKTIVAN
            </span>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Svaki odrađeni trening automatski se sprema u memoriju aplikacije. Po završetku vožnje u tabu <strong className="text-zinc-200">Trenažer</strong> jednim klikom preuzimaš industrijski standardnu <strong className="text-volt-400 font-mono">.FIT datoteku</strong> kompatibilnu s:
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-zinc-300">
            <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-volt-400 shrink-0" /> Garmin Connect
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-volt-400 shrink-0" /> Strava
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-volt-400 shrink-0" /> TrainingPeaks
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-volt-400 shrink-0" /> Bilo koji analizator
            </div>
          </div>
        </div>

        {/* 2. Intervals.icu sinkronizacija */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400">
                <LinkIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-base">Intervals.icu</h3>
                <span className="text-[11px] text-zinc-500">Automatski kalendar i upload vožnji</span>
              </div>
            </div>

            {connectionStatus === 'connected' && (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1 shrink-0">
                <CheckCircle className="w-3 h-3" /> POVEZANO
              </span>
            )}
            {connectionStatus === 'connecting' && (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/25 flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3 animate-spin" /> SPAJANJE...
              </span>
            )}
            {connectionStatus === 'error' && (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/25 flex items-center gap-1 shrink-0" title={connectionError}>
                <XCircle className="w-3 h-3" /> GREŠKA
              </span>
            )}
            {connectionStatus === 'idle' && (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-zinc-900 text-zinc-400 border border-zinc-800 shrink-0">
                NIJE SPOJENO
              </span>
            )}
          </div>

          {/* Ako je račun povezan */}
          {isConfigured ? (
            <div className="flex flex-col gap-3">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-lg p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">
                    Povezani sportaš: <strong className="text-zinc-100">{athleteInfo?.name || intervalsId}</strong>
                  </span>
                  <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {isOAuth ? 'OAuth 2.0 (Sigurno)' : 'Ručni API ključ'}
                  </span>
                </div>
                {intervalsId && intervalsId !== '0' && (
                  <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
                    <div>Athlete ID: <span className="text-zinc-300">{intervalsId}</span></div>
                    {athleteInfo?.ftp && (
                      <div className="text-zinc-400">
                        FTP: <strong className="text-volt-400">{athleteInfo.ftp}W</strong>
                        {athleteInfo.weight && <span className="ml-2 text-zinc-300">({athleteInfo.weight} kg)</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex-1 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider bg-zinc-900 hover:bg-rose-500/15 text-zinc-300 hover:text-rose-400 border border-zinc-800 hover:border-rose-500/30 transition-all flex items-center justify-center gap-2"
                >
                  <Unlink className="w-4 h-4" /> Odspoji Intervals.icu
                </button>
                {!isOAuth && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsRedirecting(true);
                      startIntervalsOAuth();
                    }}
                    disabled={isRedirecting}
                    className="px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow transition-all flex items-center justify-center gap-2"
                  >
                    <LinkIcon className="w-4 h-4" /> Prebaci na 1-klik OAuth
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Ako NIJE povezano */
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Poveži svoj Intervals.icu račun za automatsko povlačenje treninga u kalendar i automatski upload po završetku svake vožnje:
              </p>

              {/* GLAVNI GUMB: 1-KLIK OAUTH */}
              <button
                type="button"
                onClick={() => {
                  setIsRedirecting(true);
                  startIntervalsOAuth();
                }}
                disabled={isRedirecting}
                className="w-full bg-volt-400 hover:bg-volt-300 disabled:opacity-50 text-zinc-950 py-3.5 px-4 rounded-xl font-display font-bold shadow-volt-glow transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2.5 group cursor-pointer"
              >
                {isRedirecting ? (
                  <Clock className="w-4 h-4 animate-spin text-zinc-950" />
                ) : (
                  <LinkIcon className="w-4 h-4 group-hover:scale-110 transition-transform" />
                )}
                <span>{isRedirecting ? 'Preusmjeravanje...' : 'Poveži s Intervals.icu (1-klik)'}</span>
              </button>

              <p className="text-[11px] text-zinc-500 text-center -mt-2 font-mono">
                ✓ Službena autorizacija · Nema ručnog prepisivanja ključeva
              </p>

              {/* PREKIDAČ ZA RUČNI UNOS */}
              <div className="border-t border-zinc-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => setShowManualForm(!showManualForm)}
                  className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-between w-full"
                >
                  <span>Ili se poveži ručno putem API ključa (napredno)</span>
                  {showManualForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showManualForm && (
                  <form onSubmit={saveSettings} className="space-y-3 mt-3 animate-in fade-in duration-200">
                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                        Korisnički ID (Athlete ID)
                      </label>
                      <input
                        type="text"
                        value={draftId}
                        onChange={(e) => setDraftId(e.target.value)}
                        placeholder="npr. i12345 ili brojčani ID"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-zinc-100 font-mono text-xs focus:border-volt-400 focus:outline-none transition-all placeholder:text-zinc-600"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                        API Ključ (Settings &gt; Developer &gt; API Keys)
                      </label>
                      <div className="relative">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={draftKey}
                          onChange={(e) => setDraftKey(e.target.value)}
                          placeholder="Unesi svoj privatni API ključ"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 pr-10 text-zinc-100 font-mono text-xs focus:border-volt-400 focus:outline-none transition-all placeholder:text-zinc-600"
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

                    <button
                      type="submit"
                      disabled={!String(draftId ?? '').trim() || !String(draftKey ?? '').trim()}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 py-2.5 px-4 rounded-lg font-mono font-bold transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Spremi ručni ključ
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {connectionError && (
            <p className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 font-medium mt-1">
              {connectionError}
            </p>
          )}
        </div>

        {/* 3. Google Gemini AI Trener integracija */}
        <div className="lg:col-span-2 bg-zinc-950 border border-volt-400/25 rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-volt-400/10 border border-volt-400/30 text-volt-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold uppercase tracking-wide text-zinc-100 text-base">Google Gemini AI Trener</h3>
                <span className="text-[11px] text-zinc-500">Post-workout analiza, povijest treninga i generator planova</span>
              </div>
            </div>

            {geminiStatus.configured ? (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {geminiStatus.source === 'custom' ? 'AKTIVAN · VLASTITI KLJUČ' : 'AKTIVAN · SIGURNI VERCEL PROXY'}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/25">
                KLJUČ NIJE UNESEN
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Aplikacija koristi sigurni backend proxy (<code className="text-volt-300 font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">/api/gemini</code>). Tvoj Gemini API ključ je pohranjen na poslužitelju kao tajna (<code className="text-zinc-300 font-mono">GEMINI_API_KEY</code>) i <strong className="text-zinc-200">fizički se ne šalje u preglednik</strong>, čime je 100% zaštićen od kopiranja. Za dubinske analize s Pro modelom ovdje se može postaviti i vlastiti ključ:
          </p>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={customGeminiDraft}
                onChange={(e) => setCustomGeminiDraft(e.target.value)}
                placeholder={geminiStatus.source === 'custom' ? 'Unesi Gemini API ključ (AIzaSy...)' : 'Koristi se sigurni Vercel proxy (opcionalna zamjena za Pro model)'}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5 pr-10 text-zinc-100 font-mono text-xs focus:border-volt-400 focus:outline-none transition-all placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={!customGeminiDraft.trim()}
              onClick={() => {
                setCustomGeminiApiKey(customGeminiDraft);
                setCustomGeminiDraft('');
                setGeminiStatus(getGeminiConfigStatus());
              }}
              className="px-5 py-2.5 rounded-lg bg-volt-400 hover:bg-volt-300 disabled:opacity-40 text-zinc-950 font-display font-bold text-xs uppercase tracking-wider transition-all shrink-0 shadow-volt-glow"
            >
              Spremi ključ
            </button>
            {geminiStatus.source === 'custom' && (
              <button
                type="button"
                onClick={() => {
                  setCustomGeminiApiKey('');
                  setGeminiStatus(getGeminiConfigStatus());
                }}
                className="px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-rose-500/15 text-zinc-300 hover:text-rose-400 border border-zinc-800 text-xs font-bold transition-all shrink-0"
              >
                Vrati na .env
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

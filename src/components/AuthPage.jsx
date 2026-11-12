import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Mail, Lock, Loader2, AlertCircle, CheckCircle2, Bluetooth, Cpu, Sparkles, Download, ArrowRight, Link as LinkIcon, X } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { startIntervalsOAuth } from '../services/intervalsOAuth';

export default function AuthPage({ onGuestLogin, authNotice, onClearNotice }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isIntervalsLoading, setIsIntervalsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
          }
        });
        if (error) throw error;

        if (data?.user?.identities?.length === 0) {
          setErrorMsg('Korisnik s ovom email adresom već postoji. Pokušajte se prijaviti.');
          setIsLogin(true);
        } else if (data?.session) {
          setSuccessMsg('Račun uspješno kreiran! Prijavljivanje...');
        } else {
          setSuccessMsg(`Potvrdni email je poslan na ${email.trim()}. Otvorite poveznicu u primljenom mailu za aktivaciju računa.`);
        }
      }
    } catch (error) {
      setErrorMsg(error.message || 'Došlo je do pogreške prilikom autentifikacije.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 bg-telemetry-grid text-zinc-200 flex items-center justify-center p-4 md:p-8 selection:bg-volt-400 selection:text-zinc-950">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in">

        {/* Lijeva telemetrijska showcase sekcija (Desktop & Tablet) */}
        <div className="lg:col-span-7 p-7 md:p-10 bg-zinc-950/70 bg-carbon-weave border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-volt-400 via-volt-500/50 to-transparent" />

          <div>
            <div className="flex items-center gap-3.5 mb-8">
              <BrandLogo size={48} spinning />
              <div>
                <div className="font-display font-bold text-2xl tracking-wider uppercase text-zinc-100 leading-none">
                  ERG<span className="text-volt-400">VIBE</span>
                </div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500 mt-1">
                  Indoor Cycling Telemetry · FTMS Cockpit
                </div>
              </div>
            </div>

            <h1 className="font-display font-bold text-3xl md:text-4xl uppercase tracking-wide text-zinc-100 leading-[1.12] max-w-lg">
              Precizna kontrola watta. <span className="text-volt-400">Bez suvišne magle.</span>
            </h1>
            <p className="text-zinc-400 text-sm md:text-base mt-3.5 max-w-md leading-relaxed">
              Izravno BLE upravljanje pametnim trenažerom, Power Match PID korekcija pedala, virtualni mjenjač u 24 brzine i AI fiziološka analitika.
            </p>

            {/* Tehničke kartice mogućnosti */}
            <div className="grid grid-cols-2 gap-2.5 mt-7">
              <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-start gap-2.5">
                <Bluetooth className="w-4 h-4 text-volt-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-200">FTMS ERG &amp; 24G SIM</div>
                  <div className="text-[11px] text-zinc-500">Direto, Kickr, Neo + Zwift Click</div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-start gap-2.5">
                <Cpu className="w-4 h-4 text-volt-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-200">Power Match PID</div>
                  <div className="text-[11px] text-zinc-500">Automatski lock na vanjski PM</div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-volt-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-200">AI Fiziolog</div>
                  <div className="text-[11px] text-zinc-500">Coggan EF, Pw:HR &amp; planovi</div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-start gap-2.5">
                <Download className="w-4 h-4 text-volt-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-200">Nativni .FIT + ICU</div>
                  <div className="text-[11px] text-zinc-500">Garmin, Strava &amp; Intervals.icu</div>
                </div>
              </div>
            </div>
          </div>

          {/* Mini vizualni prikaz Coggan zona na dnu */}
          <div className="mt-8 pt-5 border-t border-zinc-800/80 hidden sm:block">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
              <span>Coggan Power Zones</span>
              <span className="text-volt-400">Z1 · Z2 · Z3 · SS · Z4 · Z5 · Z6</span>
            </div>
            <div className="h-7 flex items-end gap-1">
              <div className="flex-1 h-[32%] bg-zinc-600/40 border-t-2 border-zinc-400" />
              <div className="flex-1 h-[50%] bg-sky-500/25 border-t-2 border-sky-400" />
              <div className="flex-1 h-[64%] bg-emerald-500/25 border-t-2 border-emerald-400" />
              <div className="flex-[1.5] h-[80%] bg-volt-400/25 border-t-2 border-volt-400" />
              <div className="flex-1 h-[45%] bg-sky-500/25 border-t-2 border-sky-400" />
              <div className="flex-[1.5] h-[94%] bg-amber-500/25 border-t-2 border-amber-400" />
              <div className="flex-1 h-[100%] bg-rose-500/25 border-t-2 border-rose-500" />
              <div className="flex-1 h-[35%] bg-zinc-600/40 border-t-2 border-zinc-400" />
            </div>
          </div>
        </div>

        {/* Desna kolona: Prijava / Registracija */}
        <div className="lg:col-span-5 p-7 md:p-10 flex flex-col justify-center bg-zinc-900">
          <div className="mb-6">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-volt-400/10 text-volt-400 border border-volt-400/25">
              {isLogin ? 'Autentifikacija' : 'Novi Vozač'}
            </span>
            <h2 className="font-display font-bold text-2xl uppercase tracking-wide text-zinc-100 mt-2">
              {isLogin ? 'Prijava u Cockpit' : 'Kreiraj ErgVibe Račun'}
            </h2>
            <p className="text-zinc-400 text-xs mt-1">
              {isLogin
                ? 'Sinkroniziraj profil, FTP i povijest treninga u oblaku.'
                : 'Besplatna registracija za trajnu pohranu vožnji na svim uređajima.'}
            </p>
          </div>

          {/* Obavijest o autentifikaciji ako postoji (npr. Intervals OAuth povratak ili greška) */}
          {authNotice && (
            <div className={`mb-4 text-xs font-semibold p-3 rounded-lg flex items-start gap-2.5 ${
              authNotice.type === 'error'
                ? 'bg-rose-500/10 border border-rose-500/25 text-rose-400'
                : authNotice.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                : 'bg-volt-400/10 border border-volt-400/25 text-volt-400'
            }`}>
              {authNotice.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : authNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
              )}
              <div className="flex-1 min-w-0">
                <p>{authNotice.text}</p>
              </div>
              {onClearNotice && (
                <button type="button" onClick={onClearNotice} className="text-zinc-500 hover:text-zinc-200 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Službena 1-klik prijava putem Intervals.icu */}
          <button
            type="button"
            onClick={() => {
              setIsIntervalsLoading(true);
              startIntervalsOAuth();
            }}
            disabled={isIntervalsLoading}
            className="w-full mb-4 bg-zinc-950 hover:bg-zinc-800 text-volt-400 border border-volt-400/40 hover:border-volt-400 py-3.5 px-4 rounded-xl font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow flex items-center justify-center gap-2.5 group cursor-pointer disabled:opacity-50"
          >
            {isIntervalsLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-volt-400" />
            ) : (
              <LinkIcon className="w-4 h-4 text-volt-400 group-hover:scale-110 transition-transform" />
            )}
            <span>{isIntervalsLoading ? 'Preusmjeravanje...' : 'Prijavi se putem Intervals.icu'}</span>
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="h-px bg-zinc-800 flex-1" />
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">ili klasičnim računom</span>
            <div className="h-px bg-zinc-800 flex-1" />
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                Email adresa
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vozac@primjer.hr"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-sm text-zinc-100 font-medium focus:border-volt-400 focus:outline-none transition-colors placeholder:text-zinc-600"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                Lozinka
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-sm text-zinc-100 font-medium focus:border-volt-400 focus:outline-none transition-colors placeholder:text-zinc-600"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-semibold p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{errorMsg}</p>
              </div>
            )}

            {successMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold p-3 rounded-lg flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{successMsg}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider py-3 rounded-lg shadow-volt-glow transition-all flex justify-center items-center gap-2 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>{isLogin ? 'Prijavi se' : 'Registriraj se'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center space-y-3">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-xs font-semibold text-zinc-400 hover:text-volt-400 transition-colors block w-full"
            >
              {isLogin ? 'Nemaš račun? Kreiraj ga ovdje.' : 'Već imaš račun? Prijavi se ovdje.'}
            </button>

            {onGuestLogin && (
              <>
                <div className="flex items-center gap-2 justify-center py-1">
                  <div className="h-px bg-zinc-800 flex-1" />
                  <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">ili bez prijave</span>
                  <div className="h-px bg-zinc-800 flex-1" />
                </div>
                <button
                  type="button"
                  onClick={onGuestLogin}
                  className="text-xs font-display font-bold uppercase tracking-wider text-zinc-200 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg py-2.5 px-4 w-full transition-all shadow-hardware"
                >
                  Nastavi odmah kao Gost
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Mail, Lock, Loader2, AlertCircle, CheckCircle2, X, Link as LinkIcon } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { startIntervalsOAuth } from '../services/intervalsOAuth';

export default function AuthModal({ isOpen, onClose, currentUserId, onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isIntervalsLoading, setIsIntervalsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        if (currentUserId === 'guest' && data?.user?.id) {
          await migrateGuestData(data.user.id);
        }

        if (onAuthSuccess) onAuthSuccess(data?.session);
        onClose();
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
          if (currentUserId === 'guest' && data.user.id) {
            await migrateGuestData(data.user.id);
          }
          if (onAuthSuccess) onAuthSuccess(data.session);
          onClose();
        } else {
          setSuccessMsg(`Potvrdni email poslan je na ${email.trim()}. Otvorite poveznicu u primljenom mailu za dovršetak.`);
        }
      }
    } catch (error) {
      setErrorMsg(error.message || 'Došlo je do pogreške prilikom autentifikacije.');
    } finally {
      setLoading(false);
    }
  };

  const migrateGuestData = async (newUserId) => {
    try {
      const guestProfile = JSON.parse(localStorage.getItem('ai_trener_profile_guest') || '{}');
      if (guestProfile && Object.keys(guestProfile).length > 0) {
        await supabase.from('profiles').upsert({
          user_id: newUserId,
          ...guestProfile
        });
      }

      const guestActivities = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities_guest') || '[]');
      if (guestActivities.length > 0) {
        const recordsToInsert = guestActivities.map(act => {
          const { id, ...rest } = act;
          return {
            ...rest,
            user_id: newUserId
          };
        });
        await supabase.from('completed_activities').insert(recordsToInsert);
      }
    } catch (err) {
      console.warn('Upozorenje pri migraciji gost podataka:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 animate-in fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6 md:p-7 relative animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-volt-400" />
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-100 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3.5 mb-5">
          <BrandLogo size={42} />
          <div>
            <h2 className="font-display font-bold text-xl uppercase tracking-wide text-zinc-100">ErgVibe Oblak</h2>
            <p className="text-zinc-400 text-xs mt-0.5">
              {isLogin ? 'Prijava za sinkronizaciju s oblakom' : 'Kreiraj račun i spremaj vožnje u oblak'}
            </p>
          </div>
        </div>

        {currentUserId === 'guest' && (
          <div className="mb-5 p-3 rounded-lg bg-volt-400/10 border border-volt-400/25 text-xs text-zinc-200 leading-relaxed">
            <strong className="text-volt-400 font-mono uppercase mr-1">Auto-Sync:</strong>
            Tvoj dosadašnji profil i odvoženi treninzi kao Gost automatski će se prenijeti na račun.
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
          className="w-full mb-4 bg-zinc-950 hover:bg-zinc-800 text-volt-400 border border-volt-400/40 hover:border-volt-400 py-3 px-4 rounded-xl font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow flex items-center justify-center gap-2.5 group cursor-pointer disabled:opacity-50"
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
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">ili emailom</span>
          <div className="h-px bg-zinc-800 flex-1" />
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Email adresa</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tvoj@email.com"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-zinc-100 font-medium focus:border-volt-400 focus:outline-none transition-colors text-sm placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Lozinka</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-zinc-100 font-medium focus:border-volt-400 focus:outline-none transition-colors text-sm placeholder:text-zinc-600"
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
            className="w-full bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold py-2.5 rounded-lg shadow-volt-glow transition-all flex justify-center items-center gap-2 mt-2 text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isLogin ? 'Prijavi se' : 'Registriraj se')}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => { setIsLogin(!isLogin); setErrorMsg(''); setSuccessMsg(''); }}
            className="text-xs font-semibold text-zinc-400 hover:text-volt-400 transition-colors"
          >
            {isLogin ? 'Nemaš račun? Registriraj se besplatno.' : 'Već imaš račun? Prijavi se ovdje.'}
          </button>
        </div>
      </div>
    </div>
  );
}

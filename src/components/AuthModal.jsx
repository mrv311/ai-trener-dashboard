import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Activity, Mail, Lock, Loader2, AlertCircle, CheckCircle2, X, Cloud, ArrowRight } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, currentUserId, onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
        
        // Prijenos lokalnih podataka ako je korisnik bio gost
        if (currentUserId === 'guest' && data?.user?.id) {
          await migrateGuestData(data.user.id);
        }

        if (onAuthSuccess) onAuthSuccess(data?.session);
        onClose();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        if (data?.user?.identities?.length === 0) {
          setErrorMsg('Korisnik s ovom email adresom već postoji.');
        } else if (data?.session) {
          // Ako Supabase ne zahtijeva email potvrdu, korisnik je odmah ulogiran
          if (currentUserId === 'guest' && data.user.id) {
            await migrateGuestData(data.user.id);
          }
          if (onAuthSuccess) onAuthSuccess(data.session);
          onClose();
        } else {
          setSuccessMsg('Registracija uspješna! Provjerite email za potvrdu i prijavite se.');
          setIsLogin(true);
        }
      }
    } catch (error) {
      setErrorMsg(error.message || 'Došlo je do pogreške prilikom autentifikacije.');
    } finally {
      setLoading(false);
    }
  };

  // Prijenos lokalnih gost podataka (treninga i profila) u Supabase račun
  const migrateGuestData = async (newUserId) => {
    try {
      // 1. Prijenos profila
      const guestProfile = JSON.parse(localStorage.getItem('ai_trener_profile_guest') || '{}');
      if (guestProfile && Object.keys(guestProfile).length > 0) {
        await supabase.from('profiles').upsert({
          user_id: newUserId,
          ...guestProfile
        });
      }

      // 2. Prijenos odrađenih aktivnosti
      const guestActivities = JSON.parse(localStorage.getItem('ai_trener_local_completed_activities_guest') || '[]');
      if (guestActivities.length > 0) {
        const recordsToInsert = guestActivities.map(act => {
          const { id, ...rest } = act; // ignoriraj lokalni string ID
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-6 md:p-8 relative animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.3)] mb-3">
            <Cloud className="w-7 h-7 text-zinc-950" />
          </div>
          <h2 className="text-2xl font-black text-zinc-100 tracking-tight">ErgVibe Račun</h2>
          <p className="text-zinc-400 font-medium text-xs md:text-sm mt-1">
            {isLogin ? 'Prijavi se za sinkronizaciju s oblakom' : 'Kreiraj račun i spremaj vožnje u oblak'}
          </p>
        </div>

        {currentUserId === 'guest' && (
          <div className="mb-5 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 leading-relaxed">
            💡 Tvoj dosadašnji profil i odvoženi treninzi kao Gost automatski će se prenijeti na tvoj račun!
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Email adresa</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tvoj@email.com"
                className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-zinc-100 font-bold focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all text-sm placeholder:text-zinc-600 placeholder:font-normal"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Lozinka</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-zinc-100 font-bold focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all text-sm placeholder:text-zinc-600"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold p-3 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold p-3 rounded-xl flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{successMsg}</p>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 font-black py-3 rounded-xl shadow-[0_4px_15px_rgba(34,211,238,0.25)] transition-all flex justify-center items-center gap-2 mt-2 text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isLogin ? 'Prijavi se' : 'Registriraj se')}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button 
            type="button"
            onClick={() => { setIsLogin(!isLogin); setErrorMsg(''); setSuccessMsg(''); }}
            className="text-xs font-bold text-zinc-400 hover:text-cyan-400 transition-colors"
          >
            {isLogin ? 'Nemaš račun? Registriraj se besplatno.' : 'Već imaš račun? Prijavi se ovdje.'}
          </button>
        </div>
      </div>
    </div>
  );
}

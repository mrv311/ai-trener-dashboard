import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Activity, Mail, Lock, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function AuthPage({ onGuestLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        
        if (data?.user?.identities?.length === 0) {
          setErrorMsg('Korisnik s ovom email adresom već postoji.');
        } else {
          setSuccessMsg('Registracija uspješna! Provjerite email za potvrdu (ako je uključeno), ili se jednostavno prijavite.');
          // Automatski prebaci na login
          setIsLogin(true);
        }
      }
    } catch (error) {
      setErrorMsg(error.message || 'Došlo je do pogreške prilikom autentifikacije.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 selection:bg-cyan-500/30">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/15 via-zinc-950 to-zinc-950 pointer-events-none"></div>
      
      <div className="w-full max-w-md bg-zinc-900/70 backdrop-blur-xl border border-zinc-800/80 rounded-3xl shadow-2xl p-8 relative z-10 animate-in fade-in slide-in-from-bottom-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.3)] mb-4">
            <Activity className="w-8 h-8 text-zinc-950" />
          </div>
          <h1 className="text-3xl font-black text-zinc-100 tracking-tight">ErgVibe</h1>
          <p className="text-zinc-400 font-medium text-sm mt-1">
            {isLogin ? 'Prijavi se za nastavak' : 'Kreiraj novi račun'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Email adresa</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tvoj@email.com"
                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-zinc-100 font-bold focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all placeholder:text-zinc-600 placeholder:font-normal"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Lozinka</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-zinc-100 font-bold focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none transition-all placeholder:text-zinc-600"
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
            className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 font-bold py-3.5 rounded-xl shadow-[0_4px_15px_rgba(34,211,238,0.25)] transition-all flex justify-center items-center gap-2 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isLogin ? 'Prijavi se' : 'Registriraj se')}
          </button>
        </form>

        <div className="mt-6 text-center space-y-3">
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm font-medium text-zinc-400 hover:text-cyan-400 transition-colors block w-full"
          >
            {isLogin ? 'Nemaš račun? Registriraj se ovdje.' : 'Već imaš račun? Prijavi se ovdje.'}
          </button>
          
          {onGuestLogin && (
            <>
              <div className="flex items-center gap-2 justify-center my-2">
                <div className="h-px bg-zinc-800 flex-1"></div>
                <span className="text-xs text-zinc-600 font-bold uppercase tracking-widest">ili</span>
                <div className="h-px bg-zinc-800 flex-1"></div>
              </div>
              <button 
                onClick={onGuestLogin}
                className="text-sm font-bold text-zinc-300 hover:text-white bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 rounded-xl py-2.5 px-4 w-full transition-all"
              >
                Nastavi kao Gost
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

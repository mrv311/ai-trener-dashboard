import React, { useState } from 'react';
import { 
  Zap, Activity, CheckCircle2, ArrowRight, ArrowLeft, 
  Monitor, Database, Download, Sparkles, X, User, Scale 
} from 'lucide-react';

export default function OnboardingModal({ isOpen, onClose, initialProfile, onSaveProfile, onComplete }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState(initialProfile?.username || 'Odvažni Vozač');
  const [ftp, setFtp] = useState(initialProfile?.ftp || 200);
  const [weight, setWeight] = useState(initialProfile?.weight || 75);

  if (!isOpen) return null;

  const numFtp = Number(ftp) || 200;
  const numWeight = Number(weight) || 75;
  const wKg = (numFtp / (numWeight > 0 ? numWeight : 1)).toFixed(2);

  const handleFinish = () => {
    if (onSaveProfile) {
      onSaveProfile({
        ...(initialProfile || {}),
        username: username.trim() || 'Odvažni Vozač',
        ftp: numFtp,
        weight: numWeight,
        lastFtpUpdate: new Date().toISOString()
      });
    }
    if (onComplete) onComplete();
    if (onClose) onClose();
  };

  const handleSkip = () => {
    if (onComplete) onComplete();
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in" onClick={handleSkip}>
      <div 
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-6 md:p-8 relative animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Pozadinski glow */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 shrink-0 relative z-10">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-black">
              {step}/2
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              {step === 1 ? 'Korak 1: Tvoj profil & FTP' : 'Korak 2: Brzi vodič'}
            </span>
          </div>
          <button 
            onClick={handleSkip}
            className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Preskoči vodič
          </button>
        </div>

        {/* Sadržaj ovisno o koraku */}
        <div className="flex-1 overflow-y-auto py-5 relative z-10 hide-scrollbar space-y-5">
          {step === 1 ? (
            <>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight">
                    Dobrodošli u ErgVibe!
                  </h2>
                </div>
                <p className="text-zinc-400 text-xs md:text-sm">
                  Kako bi trenažer precizno prilagodio otpor u ERG načinu rada, unesi svoje osnovne parametre.
                </p>
              </div>

              {/* Informacijski box zašto je FTP važan */}
              <div className="bg-gradient-to-r from-cyan-950/40 to-zinc-900/80 border border-cyan-500/30 rounded-2xl p-4 text-xs space-y-1.5 shadow-[0_0_15px_rgba(34,211,238,0.05)]">
                <div className="flex items-center gap-2 font-black text-cyan-300 uppercase tracking-wider text-[11px]">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  Zašto je FTP ključan broj?
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  <strong className="text-white">FTP (Functional Threshold Power)</strong> je tvoja maksimalna prosječna snaga koju možeš održavati 1 sat. Svi treninzi u ErgVibe-u (npr. Z2 65%, SweetSpot 90%, VO2Max 115%) i otpor pametnog trenažera automatski se računaju kao postotak ovog broja.
                </p>
                <p className="text-zinc-400 text-[11px]">
                  Ako još ne znaš točan broj, unesi procjenu (npr. 180W – 220W). Uvijek ga možeš promijeniti ili napraviti Ramp Test u tabu Trenažer.
                </p>
              </div>

              {/* Unos parametara */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-cyan-400" /> Ime vozača
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="npr. Marko"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 font-bold text-sm focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-orange-400" /> FTP (Watti)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="600"
                    value={ftp}
                    onChange={(e) => setFtp(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-cyan-400 font-black text-sm focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-emerald-400" /> Težina (kg)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="30"
                    max="200"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 font-bold text-sm focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Omjer W/kg i brzi pregled zona */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-medium">Omjer snage i mase:</span>
                  <span className="font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md">
                    {wKg} W/kg
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-2">
                    Tvoje kalkulirane zone snage (Target za Trenažer):
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center text-[10px]">
                    <div className="bg-zinc-900 border border-zinc-800 p-1.5 rounded-lg">
                      <div className="text-zinc-500 font-bold">Z1 Rec</div>
                      <div className="font-black text-zinc-300">&lt; {Math.round(numFtp * 0.55)}W</div>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 p-1.5 rounded-lg">
                      <div className="text-blue-400 font-bold">Z2 End</div>
                      <div className="font-black text-blue-300">{Math.round(numFtp * 0.56)}-{Math.round(numFtp * 0.75)}W</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-1.5 rounded-lg">
                      <div className="text-emerald-400 font-bold">Z3 Tempo</div>
                      <div className="font-black text-emerald-300">{Math.round(numFtp * 0.76)}-{Math.round(numFtp * 0.90)}W</div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/20 p-1.5 rounded-lg">
                      <div className="text-yellow-400 font-bold">Z4 Thresh</div>
                      <div className="font-black text-yellow-300">{Math.round(numFtp * 0.91)}-{Math.round(numFtp * 1.05)}W</div>
                    </div>
                    <div className="bg-orange-500/10 border border-orange-500/20 p-1.5 rounded-lg">
                      <div className="text-orange-400 font-bold">Z5 VO2</div>
                      <div className="font-black text-orange-300">{Math.round(numFtp * 1.06)}-{Math.round(numFtp * 1.20)}W</div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/20 p-1.5 rounded-lg">
                      <div className="text-red-400 font-bold">Z6 Anaer</div>
                      <div className="font-black text-red-300">&gt; {Math.round(numFtp * 1.21)}W</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight mb-1">
                  Kako voziti s ErgVibe-om? ⚡
                </h2>
                <p className="text-zinc-400 text-xs md:text-sm">
                  Tri ključna koraka za vrhunski trenažerski doživljaj:
                </p>
              </div>

              <div className="space-y-3">
                {/* Korak 1 */}
                <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">1. Odaberi trening u Knjižnici ili Kalendaru</h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Pregledaj gotovu bazu strukturiranih treninga (izdržljivost, SweetSpot, VO2Max, Ramp test) ili kreiraj svoj. Klikni <strong className="text-zinc-200">Pokreni u Trenažeru</strong> za početak.
                    </p>
                  </div>
                </div>

                {/* Korak 2 */}
                <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 shrink-0">
                    <Monitor className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">2. Spoji pametni trenažer preko Bluetootha</h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      U tabu <strong className="text-zinc-200">Trenažer</strong> jednim klikom poveži svoj smart trainer i senzor pulsa. U automatskom <strong className="text-orange-400">ERG načinu</strong> trenažer sam održava zadane watte bez obzira na tvoju kadencu.
                    </p>
                  </div>
                </div>

                {/* Korak 3 */}
                <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">3. Završi i preuzmi .FIT datoteku</h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Po završetku vožnje preuzmi standardnu <strong className="text-emerald-400">.FIT datoteku</strong> kompatibilnu s Garmin Connectom i Stravom. Ako želiš, u tabu Veze možeš povezati i Intervals.icu za automatsku sinkronizaciju.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer navigacija */}
        <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between shrink-0 relative z-10">
          {step === 1 ? (
            <div></div>
          ) : (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-xs font-bold transition-all"
            >
              <ArrowLeft className="w-4 h-4" /> Natrag
            </button>
          )}

          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-zinc-950 px-6 py-2.5 rounded-xl font-black text-xs transition-all shadow-[0_0_15px_rgba(34,211,238,0.25)] ml-auto"
            >
              Nastavi na Vodič <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-zinc-950 px-6 py-2.5 rounded-xl font-black text-xs transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] ml-auto"
            >
              <CheckCircle2 className="w-4 h-4" /> Spremi i kreni na trening
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

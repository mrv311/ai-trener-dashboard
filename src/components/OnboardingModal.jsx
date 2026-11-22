import React, { useState, useEffect, useRef } from 'react';
import {
  Zap, CheckCircle2, ArrowRight, ArrowLeft,
  Monitor, Database, Download, User, Scale
} from 'lucide-react';
import BrandLogo from './BrandLogo';
import { useI18n } from '../i18n/I18nContext';

const GENERIC_USERNAMES = ['Gost Vozač', 'Guest Rider', 'Gost', 'Korisnik', 'Odvažni Vozač', 'Vozač'];

const getEditableUsername = (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed && !GENERIC_USERNAMES.includes(trimmed) ? trimmed : '';
};

export default function OnboardingModal({ isOpen, onClose, initialProfile, onSaveProfile, onComplete }) {
  const { tr } = useI18n();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState(() => getEditableUsername(initialProfile?.username));
  const [ftp, setFtp] = useState(initialProfile?.ftp || 200);
  const [weight, setWeight] = useState(initialProfile?.weight || 75);

  const wasOpenRef = useRef(false);
  const editedFieldsRef = useRef({ username: false, ftp: false, weight: false });

  // Resetiraj korak i inicijaliziraj polja kad se modal otvori
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep(1);
      editedFieldsRef.current = { username: false, ftp: false, weight: false };
      setUsername(getEditableUsername(initialProfile?.username));
      setFtp(initialProfile?.ftp || 200);
      setWeight(initialProfile?.weight || 75);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialProfile]);

  // Ažuriraj samo neuređena polja ako podaci sportaša pristignu s Intervals.icu ili iz baze
  useEffect(() => {
    if (!isOpen) return;
    const incomingName = getEditableUsername(initialProfile?.username);
    if (!editedFieldsRef.current.username && incomingName) {
      setUsername(incomingName);
    }
    if (!editedFieldsRef.current.ftp && initialProfile?.ftp && initialProfile.ftp !== 200) {
      setFtp(initialProfile.ftp);
    }
    if (!editedFieldsRef.current.weight && initialProfile?.weight && initialProfile.weight !== 75 && initialProfile.weight !== 75.9) {
      setWeight(initialProfile.weight);
    }
  }, [isOpen, initialProfile]);

  if (!isOpen) return null;

  const numFtp = Number(ftp) || 200;
  const numWeight = Number(weight) || 75;
  const wKg = (numFtp / (numWeight > 0 ? numWeight : 1)).toFixed(2);

  const handleFinish = () => {
    if (onSaveProfile) {
      const trimmedName = username.trim();
      onSaveProfile({
        ...(initialProfile || {}),
        username: trimmedName || initialProfile?.username || 'Gost Vozač',
        ftp: numFtp,
        weight: numWeight,
        ...(editedFieldsRef.current.ftp ? { isManualFtp: true } : {}),
        ...(editedFieldsRef.current.weight ? { isManualWeight: true } : {}),
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
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
    >
      <div
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6 md:p-7 relative animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-volt-400" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 shrink-0 relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center px-2 py-0.5 rounded bg-volt-400/15 border border-volt-400/30 text-volt-400 font-mono text-xs font-bold">
              0{step}/02
            </span>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
              {step === 1
                ? tr('Kalibracija vozača & FTP', 'Rider Calibration & FTP')
                : tr('Kratki vodič kroz Cockpit', 'Quick Cockpit Tour')}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="text-zinc-500 hover:text-zinc-200 text-xs font-semibold px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
          >
            {tr('Preskoči', 'Skip')}
          </button>
        </div>

        {/* Sadržaj ovisno o koraku */}
        <div className="flex-1 overflow-y-auto py-5 relative z-10 hide-scrollbar space-y-5">
          {step === 1 ? (
            <>
              <div className="flex items-center gap-3.5">
                <BrandLogo size={42} />
                <div>
                  <h2 id="onboarding-modal-title" className="font-display font-bold text-2xl uppercase tracking-wide text-zinc-100">
                    {tr('Dobrodošli u ErgVibe', 'Welcome to ErgVibe')}
                  </h2>
                  <p className="text-zinc-400 text-xs md:text-sm">
                    {tr(
                      'Unesi osnovne fiziološke parametre za točan izračun ERG otpora i zona snage.',
                      'Enter your baseline metrics for accurate ERG targets and Coggan power zones.'
                    )}
                  </p>
                </div>
              </div>

              {/* Informacijski box zašto je FTP važan */}
              <div className="bg-zinc-950 border border-zinc-800 border-l-2 border-l-volt-400 rounded-lg p-4 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-mono font-bold text-volt-400 uppercase tracking-wider text-[11px]">
                  <Zap className="w-3.5 h-3.5" />
                  {tr('Zašto je FTP ključan broj?', 'Why does FTP matter?')}
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  <strong className="text-white">FTP (Functional Threshold Power)</strong>{' '}
                  {tr(
                    'je maksimalna prosječna snaga koju možeš držati ~1 sat. Svi intervali u ErgVibeu (npr. Z2 65%, Sweet Spot 90%, VO2Max 115%) i otpor trenažera skaliraju se prema ovom broju.',
                    'is the highest average power you can sustain for ~1 hour. Every workout interval in ErgVibe (Z2 65%, Sweet Spot 90%, VO2 Max 115%) and ERG resistance scales from this value.'
                  )}
                </p>
                <p className="text-zinc-500 text-[11px]">
                  {tr(
                    'Ako još ne znaš točan broj, ostavi procjenu (180–220 W) ili kasnije odvozi Ramp Test u Knjižnici.',
                    "Not sure yet? Keep an estimate (180–220 W) or run a Ramp Test from the Workout Library later."
                  )}
                </p>
              </div>

              {/* Unos parametara */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="onboarding-rider-name" className="block font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-volt-400" /> {tr('Ime vozača', 'Rider Name')}
                  </label>
                  <input
                    id="onboarding-rider-name"
                    name="riderName"
                    type="text"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => {
                      editedFieldsRef.current.username = true;
                      setUsername(e.target.value);
                    }}
                    placeholder={tr('npr. Marko', 'e.g. Alex')}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-zinc-100 font-semibold text-sm focus:border-volt-400 focus:outline-none placeholder:text-zinc-600"
                  />
                </div>

                <div>
                  <label htmlFor="onboarding-rider-ftp" className="block font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-volt-400" /> FTP (W)
                  </label>
                  <input
                    id="onboarding-rider-ftp"
                    name="riderFtp"
                    type="number"
                    min="50"
                    max="600"
                    value={ftp}
                    onChange={(e) => {
                      editedFieldsRef.current.ftp = true;
                      setFtp(e.target.value);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-volt-400 font-mono font-bold text-sm telemetry-num focus:border-volt-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="onboarding-rider-weight" className="block font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-emerald-400" /> {tr('Težina (kg)', 'Weight (kg)')}
                  </label>
                  <input
                    id="onboarding-rider-weight"
                    name="riderWeight"
                    type="number"
                    step="0.1"
                    min="30"
                    max="200"
                    value={weight}
                    onChange={(e) => {
                      editedFieldsRef.current.weight = true;
                      setWeight(e.target.value);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-zinc-100 font-mono font-bold text-sm telemetry-num focus:border-volt-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Omjer W/kg i brzi pregled zona */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-medium">{tr('Specifična snaga (W/kg):', 'Power-to-weight (W/kg):')}</span>
                  <span className="font-mono font-bold text-volt-400 bg-volt-400/10 border border-volt-400/25 px-2.5 py-0.5 rounded telemetry-num">
                    {wKg} W/kg
                  </span>
                </div>

                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-2">
                    {tr('Kalkulirane zone snage:', 'Calculated power zones:')}
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center font-mono text-[10px] telemetry-num">
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-zinc-500 p-1.5 rounded">
                      <div className="text-zinc-400 font-bold">Z1 Rec</div>
                      <div className="font-bold text-zinc-200">&lt;{Math.round(numFtp * 0.55)}W</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-sky-400 p-1.5 rounded">
                      <div className="text-sky-400 font-bold">Z2 End</div>
                      <div className="font-bold text-zinc-200">{Math.round(numFtp * 0.56)}–{Math.round(numFtp * 0.75)}W</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-emerald-400 p-1.5 rounded">
                      <div className="text-emerald-400 font-bold">Z3 Tmp</div>
                      <div className="font-bold text-zinc-200">{Math.round(numFtp * 0.76)}–{Math.round(numFtp * 0.90)}W</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-amber-400 p-1.5 rounded">
                      <div className="text-amber-400 font-bold">Z4 Thr</div>
                      <div className="font-bold text-zinc-200">{Math.round(numFtp * 0.91)}–{Math.round(numFtp * 1.05)}W</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-rose-500 p-1.5 rounded">
                      <div className="text-rose-400 font-bold">Z5 VO2</div>
                      <div className="font-bold text-zinc-200">{Math.round(numFtp * 1.06)}–{Math.round(numFtp * 1.20)}W</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 border-t-2 border-t-purple-500 p-1.5 rounded">
                      <div className="text-purple-400 font-bold">Z6 Ana</div>
                      <div className="font-bold text-zinc-200">&gt;{Math.round(numFtp * 1.21)}W</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 id="onboarding-modal-title" className="font-display font-bold text-2xl uppercase tracking-wide text-zinc-100 mb-1">
                  {tr('Tri koraka do treninga', 'Three Steps to Your Ride')}
                </h2>
                <p className="text-zinc-400 text-xs md:text-sm">
                  {tr('Brzi pregled radnog tijeka u ErgVibe sustavu:', 'Quick overview of the ErgVibe workflow:')}
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-lg bg-volt-400/10 border border-volt-400/25 text-volt-400 shrink-0">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">
                      {tr(
                        '1. Odaberi trening iz Knjižnice, Kalendara ili AI Trenera',
                        '1. Pick a workout from Library, Calendar, or AI Coach'
                      )}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {tr(
                        'Učitaj .ZWO/.ERG datoteku, odaberi gotovi strukturirani trening iz baze ili zatraži plan od AI Fiziologa.',
                        'Import a .ZWO/.ERG file, choose from 250+ structured catalog workouts, or generate a periodized plan with the AI Physiologist.'
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-400 shrink-0">
                    <Monitor className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">
                      {tr(
                        '2. Spoji FTMS trenažer, PowerMeter i Zwift Click',
                        '2. Pair your FTMS trainer, Power Meter & Zwift Click'
                      )}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {tr(
                        'U tabu Trenažer poveži senzore preko Web Bluetootha. Uključi ERG za automatsko zaključavanje watta ili RES za virtualno mijenjanje 24 brzine.',
                        'Connect BLE sensors inside the Trainer cockpit. Use ERG mode for automatic target watt control or RES mode for 24-speed virtual shifting.'
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex items-start gap-3.5">
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">
                      {tr(
                        '3. Preuzmi nativni .FIT ili sinkroniziraj s Intervals.icu',
                        '3. Export native .FIT or auto-sync with Intervals.icu'
                      )}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {tr(
                        'Svaka vožnja se automatski čuva u Kalendaru uz AI analizu i izvoz .FIT datoteke spremne za Garmin Connect i Stravu.',
                        'Every ride is saved to your Calendar with post-ride AI analysis and native .FIT export ready for Garmin Connect, Strava, and Intervals.icu.'
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer navigacija */}
        <div className="pt-4 border-t border-zinc-800 flex items-center justify-between shrink-0 relative z-10">
          {step === 1 ? (
            <div />
          ) : (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 text-xs font-semibold transition-all"
            >
              <ArrowLeft className="w-4 h-4" /> {tr('Natrag', 'Back')}
            </button>
          )}

          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-2 bg-volt-400 hover:bg-volt-300 text-zinc-950 px-5 py-2.5 rounded-lg font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow ml-auto"
            >
              {tr('Dalje', 'Next')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="flex items-center gap-2 bg-volt-400 hover:bg-volt-300 text-zinc-950 px-5 py-2.5 rounded-lg font-display font-bold uppercase tracking-wider text-xs transition-all shadow-volt-glow ml-auto"
            >
              <CheckCircle2 className="w-4 h-4" /> {tr('Spremi i otvori Cockpit', 'Save & Open Cockpit')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

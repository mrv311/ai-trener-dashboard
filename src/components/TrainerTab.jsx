import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Bluetooth, BluetoothConnected, Heart, Zap, Play, Pause, Square, FastForward, Plus, Minus, Settings2, Award, UploadCloud, CheckCircle2, Activity } from 'lucide-react';
import TrainerModals from './trainer/TrainerModals';
import TrainerGraph, { getZoneColorForTrainer } from './trainer/TrainerGraph';

const playBeep = (freq = 800, duration = 0.2) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("AudioContext nije dostupan", e);
  }
};

// --- POWER MATCH PID KONTROLER ---
// Prati razliku između željene snage i stvarne snage s powermetra,
// te korigira naredbu trenažeru kako bi se postigla točna snaga.
class PowerMatchPID {
  constructor() {
    this.kP = 1.5;   // Proporcionalni faktor
    this.kI = 0.05;  // Integralni faktor (sprječava trajnu grešku)
    this.kD = 0.3;   // Derivativni faktor (prigušuje oscilacije)
    this.integral = 0;
    this.prevError = 0;
    this.lastTime = null;
    this.maxIntegral = 50; // Anti-windup
  }

  reset() {
    this.integral = 0;
    this.prevError = 0;
    this.lastTime = null;
  }

  // Vraća korigirani target koji šaljemo trenažeru
  compute(targetPower, measuredPower) {
    const now = Date.now();
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 2.0) : 1.0;
    this.lastTime = now;

    const error = targetPower - measuredPower;

    this.integral = Math.max(-this.maxIntegral, Math.min(this.maxIntegral, this.integral + error * dt));

    const derivative = dt > 0 ? (error - this.prevError) / dt : 0;
    this.prevError = error;

    const correction = this.kP * error + this.kI * this.integral + this.kD * derivative;

    // Vraćamo korigirani target (trenažer će dobiti višu/nižu snagu da kompenzira)
    return Math.round(targetPower + correction);
  }
}

const pidController = new PowerMatchPID();

export default function TrainerTab({ profile, workoutFromCalendar }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [currentHR, setCurrentHR] = useState(0);
  const [currentPower, setCurrentPower] = useState(0);       // Snaga s trenažera
  const [pmPower, setPmPower] = useState(0);                 // Snaga s powermetra
  const [currentCadence, setCurrentCadence] = useState(0);
  const [isHrConnected, setIsHrConnected] = useState(false);
  const [isPowerConnected, setIsPowerConnected] = useState(false);   // Trenažer
  const [isPmConnected, setIsPmConnected] = useState(false);         // Powermetar
  const [powerMatchEnabled, setPowerMatchEnabled] = useState(false); // Power Match toggle

  const [controlMode, setControlMode] = useState('ERG');
  const [ergIntensity, setErgIntensity] = useState(100);
  const [resistanceLevel, setResistanceLevel] = useState(30);
  const [ftmsControlChar, setFtmsControlChar] = useState(null);

  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [isFinished, setIsFinished] = useState(false);
  const [showStopPrompt, setShowStopPrompt] = useState(false);
  const [summaryStats, setSummaryStats] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const crankDataRef = useRef({ revs: -1, time: -1 });
  const pmCrankDataRef = useRef({ revs: -1, time: -1 }); // Zasebna referenca za PM kadencu

  const [workoutRecipe, setWorkoutRecipe] = useState([
    { name: 'Zagrijavanje', duration: 10 * 60, power: 50 },
    { name: 'Z2 Aerobna Baza', duration: 5 * 60, power: 65 },
    { name: 'SweetSpot 1', duration: 15 * 60, power: 90 },
    { name: 'Oporavak', duration: 3 * 60, power: 50 },
    { name: 'SweetSpot 2', duration: 15 * 60, power: 90 },
    { name: 'Hlađenje', duration: 7 * 60, power: 45 },
  ]);

  // PARSIRANJE TRENINGA S KALENDARA
  useEffect(() => {
    if (workoutFromCalendar && workoutFromCalendar.workout_doc && workoutFromCalendar.workout_doc.steps) {
      const extractSteps = (stepsArray) => {
        let flatSteps = [];
        stepsArray.forEach(step => {
          if (step.steps && Array.isArray(step.steps)) {
            const loops = step.reps || step.count || 1;
            for (let i = 0; i < loops; i++) {
              flatSteps = flatSteps.concat(extractSteps(step.steps));
            }
          } else {
            let pwr = 50;
            if (step.power) {
              if (step.power.value) pwr = step.power.value;
              else if (step.power.start && step.power.end) pwr = (step.power.start + step.power.end) / 2;
            }
            flatSteps.push({
              name: step.text || (pwr > 80 ? 'Radni Interval' : 'Odmor'),
              duration: step.duration || 60,
              power: pwr
            });
          }
        });
        return flatSteps;
      };

      const parsedRecipe = extractSteps(workoutFromCalendar.workout_doc.steps);
      if (parsedRecipe.length > 0) {
        setWorkoutRecipe(parsedRecipe);
        setElapsedTime(0);
        setWorkoutHistory([]);
        setIsFinished(false);
        setShowStopPrompt(false);
        setIsPlaying(false);
      }
    }
  }, [workoutFromCalendar]);

  const totalDuration = useMemo(() => workoutRecipe.reduce((acc, step) => acc + step.duration, 0), [workoutRecipe]);

  // GLAVNI TIMER
  useEffect(() => {
    let interval;
    if (isPlaying && elapsedTime < totalDuration) {
      interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, elapsedTime, totalDuration]);

  // BILJEŽENJE POVIJESTI I KRAJA
  useEffect(() => {
    if (isPlaying && elapsedTime > 0 && elapsedTime < totalDuration) {
      // U povijesti bilježi snagu s powermetra ako je aktivan Power Match, inače s trenažera
      const recordedPower = (powerMatchEnabled && isPmConnected) ? pmPower : (isPowerConnected ? currentPower : 0);
      setWorkoutHistory(prev => [...prev, {
        time: elapsedTime,
        power: recordedPower,
        hr: isHrConnected ? currentHR : 0,
        cadence: (isPmConnected ? currentCadence : (isPowerConnected ? currentCadence : 0))
      }]);
    } else if (isPlaying && elapsedTime >= totalDuration) {
      handleFinishWorkout();
    }
  }, [elapsedTime]);

  // PEDAL TO START
  useEffect(() => {
    const anyPower = (isPmConnected ? pmPower : 0) || (isPowerConnected ? currentPower : 0);
    if (!isPlaying && !isFinished && !showStopPrompt && anyPower > 10) {
      setIsPlaying(true);
    }
  }, [currentPower, pmPower, isPlaying, isFinished, showStopPrompt, isPowerConnected, isPmConnected]);

  // Reset PID kad se mijenja target ili Power Match status
  useEffect(() => {
    pidController.reset();
  }, [powerMatchEnabled]);

  let currentStepIndex = 0;
  let timeAccumulated = 0;
  let stepElapsed = 0;

  for (let i = 0; i < workoutRecipe.length; i++) {
    if (elapsedTime >= timeAccumulated && elapsedTime < timeAccumulated + workoutRecipe[i].duration) {
      currentStepIndex = i;
      stepElapsed = elapsedTime - timeAccumulated;
      break;
    }
    timeAccumulated += workoutRecipe[i].duration;
  }

  if (elapsedTime >= totalDuration) {
    currentStepIndex = workoutRecipe.length - 1;
    stepElapsed = workoutRecipe[workoutRecipe.length - 1].duration;
  }

  const currentStep = workoutRecipe[currentStepIndex];
  const stepRemaining = currentStep.duration - stepElapsed;
  const progressPercent = (elapsedTime / totalDuration) * 100;

  // BILJEŽENJE KRAJA INTERVALA I ZVUKOVI
  useEffect(() => {
    if (isPlaying && stepRemaining <= 3 && stepRemaining > 0 && currentStepIndex < workoutRecipe.length - 1) {
      playBeep(800, 0.2); 
    }
  }, [elapsedTime, isPlaying]);

  const baseTargetPower = Math.round((currentStep.power / 100) * profile.ftp);
  const activeTargetPower = Math.round(baseTargetPower * (ergIntensity / 100));

  // Snaga koja se prikazuje: powermetar ima prednost kad je spojen
  const displayPower = (isPmConnected ? pmPower : (isPowerConnected ? currentPower : 0));
  const displayHR = isHrConnected ? currentHR : 0;
  const displayCadence = currentCadence;

  const getPowerColor = () => {
    if (!isPlaying && displayPower === 0) return "text-stone-300";
    const diff = Math.abs(displayPower - activeTargetPower);
    if (diff <= 10) return "text-emerald-500";
    if (diff <= 25) return "text-amber-500";
    return "text-rose-500";
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Zajednička funkcija za parsiranje Cycling Power Measurement karakteristike
  const parseCyclingPowerData = (view, crankRef, setPowerFn, setCadenceFn) => {
    const flags = view.getUint16(0, true);
    setPowerFn(view.getInt16(2, true));

    if ((flags & 0x20) !== 0) {
      let offset = 4;
      if ((flags & 0x01) !== 0) offset += 1;
      if ((flags & 0x04) !== 0) offset += 2;
      if ((flags & 0x10) !== 0) offset += 6;

      if (view.byteLength >= offset + 4) {
        const crankRevs = view.getUint16(offset, true);
        const crankTime = view.getUint16(offset + 2, true);

        if (crankRef.current.time !== -1) {
          let timeDiff = crankTime - crankRef.current.time;
          let revDiff = crankRevs - crankRef.current.revs;
          if (timeDiff < 0) timeDiff += 65536;
          if (revDiff < 0) revDiff += 65536;
          if (timeDiff > 0) {
            const rpm = Math.round((revDiff / (timeDiff / 1024)) * 60);
            if (rpm >= 0 && rpm < 200) setCadenceFn(rpm);
          }
        }
        crankRef.current = { revs: crankRevs, time: crankTime };
      }
    }
  };

  // BLUETOOTH: Spajanje na HR pojasić
  const connectHR = async () => {
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const char = await service.getCharacteristic('heart_rate_measurement');
      await char.startNotifications();
      setIsHrConnected(true);
      char.addEventListener('characteristicvaluechanged', (e) => {
        const val = e.target.value;
        const flags = val.getUint8(0);
        setCurrentHR(flags & 0x1 ? val.getUint16(1, true) : val.getUint8(1));
      });
    } catch (err) { if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na pulsmetar: " + err.message); }
  };

  // BLUETOOTH: Spajanje na trenažer (FTMS + Cycling Power)
  const connectTrainer = async () => {
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }],
        optionalServices: ['00001826-0000-1000-8000-00805f9b34fb']
      });
      const server = await device.gatt.connect();
      const powerService = await server.getPrimaryService('cycling_power');
      const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
      await powerChar.startNotifications();
      setIsPowerConnected(true);

      powerChar.addEventListener('characteristicvaluechanged', (e) => {
        parseCyclingPowerData(e.target.value, crankDataRef, setCurrentPower, setCurrentCadence);
      });

      try {
        const ftmsService = await server.getPrimaryService('00001826-0000-1000-8000-00805f9b34fb');
        const controlPoint = await ftmsService.getCharacteristic('00002ad9-0000-1000-8000-00805f9b34fb');
        setFtmsControlChar(controlPoint);
        await controlPoint.startNotifications();
        await controlPoint.writeValue(new Uint8Array([0x00]));
        console.log("FTMS kontrola preuzeta.");
      } catch (ftmsErr) {
        console.warn("FTMS greška:", ftmsErr);
      }
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na trenažer: " + err.message);
    }
  };

  // BLUETOOTH: Spajanje na vanjski powermetar (Power Match izvor)
  const connectPowerMeter = async () => {
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }]
        // Nema optionalServices jer nam ne treba FTMS kontrola za powermetar
      });
      const server = await device.gatt.connect();
      const powerService = await server.getPrimaryService('cycling_power');
      const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
      await powerChar.startNotifications();
      setIsPmConnected(true);
      // Kad se powermetar spoji, automatski aktiviramo Power Match
      setPowerMatchEnabled(true);
      pidController.reset();
      console.log("Powermetar spojen, Power Match aktiviran.");

      powerChar.addEventListener('characteristicvaluechanged', (e) => {
        // Koristimo zasebni ref i setPmPower za kadencu (kadenca s PM je točnija)
        parseCyclingPowerData(e.target.value, pmCrankDataRef, setPmPower, setCurrentCadence);
      });
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na powermetar: " + err.message);
    }
  };

  // ERG KOMANDA: S Power Match korekcijom ili bez
  useEffect(() => {
    const sendErgCommand = async () => {
      if (!ftmsControlChar || controlMode !== 'ERG') return;
      try {
        let commandPower = activeTargetPower;

        // Power Match: PID korigira target koji šaljemo trenažeru
        // na osnovu razlike između željene i izmjerene snage (s PM)
        if (powerMatchEnabled && isPmConnected && pmPower > 0) {
          commandPower = pidController.compute(activeTargetPower, pmPower);
          // Sigurnosni klamper: ne šaljemo više od 150% FTP ni manje od 30W
          commandPower = Math.max(30, Math.min(Math.round(profile.ftp * 1.5), commandPower));
        }

        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05);
        view.setInt16(1, commandPower, true);
        await ftmsControlChar.writeValue(buffer);
      } catch (e) { console.error("Greška pri slanju ERG komande", e); }
    };
    sendErgCommand();
  }, [activeTargetPower, controlMode, ftmsControlChar, pmPower, powerMatchEnabled, isPmConnected]);

  // RES KOMANDA
  useEffect(() => {
    const sendResCommand = async () => {
      if (ftmsControlChar && controlMode === 'RES') {
        try {
          await ftmsControlChar.writeValue(new Uint8Array([0x04, resistanceLevel]));
        } catch (e) { console.error("Greška pri slanju RES komande", e); }
      }
    };
    sendResCommand();
  }, [resistanceLevel, controlMode, ftmsControlChar]);

  const toggleMode = () => setControlMode(prev => prev === 'ERG' ? 'RES' : 'ERG');
  const increaseErg = () => setErgIntensity(prev => prev + 2);
  const decreaseErg = () => setErgIntensity(prev => Math.max(50, prev - 2));
  const increaseRes = () => setResistanceLevel(prev => Math.min(100, prev + 1));
  const decreaseRes = () => setResistanceLevel(prev => Math.max(0, prev - 1));

  const handleStopClick = () => {
    if (elapsedTime > 0) { setIsPlaying(false); setShowStopPrompt(true); }
  };

  const confirmStop = () => { setShowStopPrompt(false); handleFinishWorkout(); };
  const cancelStop = () => setShowStopPrompt(false);

  const handleFinishWorkout = () => {
    setIsPlaying(false);
    setIsFinished(true);
    const pwrData = workoutHistory.filter(h => h.power > 0);
    const hrData = workoutHistory.filter(h => h.hr > 0);
    const cadData = workoutHistory.filter(h => h.cadence > 0);
    setSummaryStats({
      avgPower: pwrData.length ? Math.round(pwrData.reduce((a, b) => a + b.power, 0) / pwrData.length) : 0,
      avgHr: hrData.length ? Math.round(hrData.reduce((a, b) => a + b.hr, 0) / hrData.length) : 0,
      avgCadence: cadData.length ? Math.round(cadData.reduce((a, b) => a + b.cadence, 0) / cadData.length) : 0,
      totalDur: elapsedTime
    });
  };

  const handleSkip = () => {
    let accumulatedToNext = 0;
    for (let i = 0; i <= currentStepIndex; i++) accumulatedToNext += workoutRecipe[i].duration;
    if (currentStepIndex < workoutRecipe.length - 1) setElapsedTime(accumulatedToNext);
    else { setElapsedTime(totalDuration); handleFinishWorkout(); }
  };

  const handleExtend = () => {
    setWorkoutRecipe(prev => {
      const newRecipe = [...prev];
      newRecipe[currentStepIndex] = { ...newRecipe[currentStepIndex], duration: newRecipe[currentStepIndex].duration + 300 };
      return newRecipe;
    });
  };

  // KEYBOARD SHORTCUTS
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showStopPrompt || isFinished) return; // ignoriraj ako je modal otvoren

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (controlMode === 'ERG') setErgIntensity(p => p + 3);
        else setResistanceLevel(p => Math.min(100, p + 3));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (controlMode === 'ERG') setErgIntensity(p => Math.max(50, p - 3));
        else setResistanceLevel(p => Math.max(0, p - 3));
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showStopPrompt, isFinished, controlMode, handleSkip]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col h-[calc(100vh-8rem)] gap-6 animate-in fade-in relative">

      <TrainerModals 
        showStopPrompt={showStopPrompt}
        isFinished={isFinished}
        confirmStop={confirmStop}
        cancelStop={cancelStop}
        summaryStats={summaryStats}
        workoutFromCalendar={workoutFromCalendar}
        isPmConnected={isPmConnected}
        uploadStatus={uploadStatus}
        setUploadStatus={setUploadStatus}
        handleReset={() => { setIsFinished(false); setUploadStatus(null); setElapsedTime(0); setWorkoutHistory([]); }}
      />

      {/* GORNJA TRAKA: Bluetooth gumbi */}
      <div className="flex gap-4 flex-wrap">
        <button
          onClick={connectTrainer}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-colors border shadow-sm ${isPowerConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200'}`}
        >
          {isPowerConnected ? <BluetoothConnected className="w-5 h-5" /> : <Bluetooth className="w-5 h-5" />}
          {isPowerConnected ? 'Trenažer Spojen' : 'Spoji Trenažer'}
        </button>

        {/* NOVO: Gumb za powermetar */}
        <button
          onClick={connectPowerMeter}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-colors border shadow-sm ${isPmConnected ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-violet-50 hover:bg-violet-100 text-violet-600 border-violet-200'}`}
        >
          {isPmConnected ? <BluetoothConnected className="w-5 h-5" /> : <Activity className="w-5 h-5" />}
          {isPmConnected ? 'PowerMeter Spojen' : 'Spoji PowerMeter'}
        </button>

        <button
          onClick={connectHR}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-colors border shadow-sm ${isHrConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'}`}
        >
          {isHrConnected ? <BluetoothConnected className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
          {isHrConnected ? 'Pulsmetar Spojen' : 'Spoji Pulsmetar'}
        </button>

        {/* NOVO: Power Match toggle - vidljiv samo kad je PM spojen */}
        {isPmConnected && (
          <button
            onClick={() => { setPowerMatchEnabled(prev => !prev); pidController.reset(); }}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all border shadow-sm ${powerMatchEnabled ? 'bg-violet-600 text-white border-violet-700 shadow-violet-200' : 'bg-white text-violet-600 border-violet-300 hover:bg-violet-50'}`}
          >
            <Activity className="w-5 h-5" />
            Power Match {powerMatchEnabled ? 'ON' : 'OFF'}
          </button>
        )}

        <div className="ml-auto flex items-center px-5 py-3 bg-white rounded-xl border border-stone-200 shadow-sm text-stone-500 font-medium text-sm">
          Trening za danas: <span className="text-stone-800 font-bold ml-2 uppercase">
            {workoutFromCalendar ? workoutFromCalendar.title : "Slobodna Vožnja"}
          </span>
        </div>
      </div>

      {/* GLAVNI GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-stone-200 p-8 flex flex-col justify-center items-center relative overflow-hidden">
          <div className={`absolute top-0 w-full h-2 ${getZoneColorForTrainer(currentStep.power)} transition-colors duration-500`}></div>
          <div className="absolute top-6 left-6 flex items-center gap-3">
            <span className="text-stone-400 font-black uppercase tracking-widest text-sm">
              {(powerMatchEnabled && isPmConnected) ? 'PM Snaga' : 'Trenutna Snaga'}
            </span>
            {/* NOVO: PowerMatch badge */}
            {powerMatchEnabled && isPmConnected && (
              <span className="bg-violet-100 text-violet-700 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border border-violet-200">
                Power Match Active
              </span>
            )}
          </div>

          <div className="absolute top-6 right-6 flex items-center gap-2 bg-stone-50 p-1.5 rounded-xl border border-stone-200">
            <button onClick={toggleMode} className="flex items-center gap-2 px-4 py-2 bg-white shadow-sm border border-stone-200 rounded-lg text-xs font-bold text-stone-700 uppercase tracking-wider hover:bg-stone-50 transition-colors">
              <Settings2 className="w-3.5 h-3.5" /> {controlMode} Mode
            </button>
            <div className="w-px h-6 bg-stone-200 mx-1"></div>
            {controlMode === 'ERG' ? (
              <div className="flex items-center gap-1">
                <button onClick={decreaseErg} className="p-1.5 hover:bg-stone-200 rounded-md text-stone-600 transition-colors"><Minus className="w-4 h-4" /></button>
                <span className="w-12 text-center font-bold text-stone-800 text-sm">{ergIntensity}%</span>
                <button onClick={increaseErg} className="p-1.5 hover:bg-stone-200 rounded-md text-stone-600 transition-colors"><Plus className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button onClick={decreaseRes} className="p-1.5 hover:bg-stone-200 rounded-md text-stone-600 transition-colors"><Minus className="w-4 h-4" /></button>
                <span className="w-12 text-center font-bold text-stone-800 text-sm">Lvl {resistanceLevel}</span>
                <button onClick={increaseRes} className="p-1.5 hover:bg-stone-200 rounded-md text-stone-600 transition-colors"><Plus className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          <div className="flex items-baseline gap-4 mt-10">
            <div className={`text-[160px] font-black leading-none tracking-tighter transition-colors ${controlMode === 'RES' && isPlaying ? 'text-indigo-600' : getPowerColor()}`}>
              {displayPower}
            </div>
            <span className="text-3xl font-bold text-stone-300 pb-6">W</span>
          </div>

          {/* NOVO: Prikaz snage trenažera kad je Power Match aktivan */}
          {powerMatchEnabled && isPmConnected && isPowerConnected && (
            <div className="text-sm font-bold text-stone-400 mb-1">
              Trenažer: <span className="text-stone-600">{currentPower} W</span>
              <span className="mx-2 text-stone-300">·</span>
              Razlika: <span className={Math.abs(pmPower - currentPower) > 15 ? 'text-amber-500' : 'text-emerald-500'}>
                {pmPower - currentPower > 0 ? '+' : ''}{pmPower - currentPower} W
              </span>
            </div>
          )}

          <div className="text-2xl font-bold text-stone-500 mt-2 bg-stone-50 px-6 py-2.5 rounded-2xl border border-stone-200">
            {controlMode === 'ERG' ? (
              <>Cilj: <span className="text-stone-800">{activeTargetPower} W</span>
                {powerMatchEnabled && isPmConnected && (
                  <span className="text-violet-500 ml-3 text-base font-black">⟳ PM Locked</span>
                )}
              </>
            ) : (
              <>Slobodna vožnja <span className="text-indigo-600 ml-2">(Otpor {resistanceLevel}%)</span></>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex-1 flex flex-col justify-center items-center relative">
            <span className="absolute top-5 left-5 text-rose-400 font-black uppercase tracking-widest text-xs flex items-center gap-2"><Heart className="w-4 h-4" /> Puls</span>
            <div className="flex items-baseline gap-2">
              <div className={`text-[70px] font-black leading-none ${isHrConnected ? 'text-stone-800' : 'text-stone-300'}`}>{displayHR}</div>
              <span className="text-lg font-bold text-stone-300 pb-2">bpm</span>
            </div>
          </div>
          <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex-1 flex flex-col justify-center items-center relative">
            <span className="absolute top-5 left-5 text-orange-400 font-black uppercase tracking-widest text-xs flex items-center gap-2"><Zap className="w-4 h-4" /> Kadenca</span>
            <div className="flex items-baseline gap-2">
              <div className={`text-[70px] font-black leading-none ${(isPmConnected || isPowerConnected) ? 'text-stone-800' : 'text-stone-300'}`}>{displayCadence}</div>
              <span className="text-lg font-bold text-stone-300 pb-2">rpm</span>
            </div>
          </div>
        </div>
      </div>

      {/* DONJI PANEL: Trening grafikon i kontrole */}
      <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col flex-1 min-h-[300px]">
        <div className="flex items-end justify-between px-2 mb-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-stone-100 rounded-full p-1 border border-stone-200">
              <button onClick={handleStopClick} className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:bg-stone-200 text-stone-600" title="Prekini trening"><Square className="w-5 h-5" fill="currentColor" /></button>
              <button onClick={() => setIsPlaying(!isPlaying)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors shadow-sm shrink-0 ${isPlaying ? 'bg-stone-800 hover:bg-stone-700' : 'bg-orange-600 hover:bg-orange-500'}`}>
                {isPlaying ? <Pause className="w-6 h-6 text-white" fill="currentColor" /> : <Play className="w-6 h-6 ml-1 text-white" fill="currentColor" />}
              </button>
              <button onClick={handleSkip} className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:bg-stone-200 text-stone-600" title="Preskoči na idući interval"><FastForward className="w-5 h-5" fill="currentColor" /></button>
            </div>
            <div className="ml-4">
              <div className="text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Trenutni Interval</div>
              <div className="text-2xl font-bold text-stone-800 flex items-center gap-3">
                {currentStep.name} <span className="text-stone-400 font-medium text-lg">@ {currentStep.power}% FTP</span>
                <button onClick={handleExtend} className="ml-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"><Plus className="w-3 h-3" /> 5 Min</button>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-black text-stone-400 uppercase tracking-widest mb-1.5">Preostalo u intervalu</div>
            <div className={`text-5xl font-black font-mono tracking-tight ${isPlaying ? 'text-orange-600' : 'text-stone-400'}`}>{formatTime(stepRemaining)}</div>
          </div>
        </div>

        <TrainerGraph 
          workoutRecipe={workoutRecipe}
          workoutHistory={workoutHistory}
          totalDuration={totalDuration}
          progressPercent={progressPercent}
          profile={profile}
        />

        <div className="flex justify-between items-center px-4 py-2 bg-stone-100 rounded-b-xl border-x border-b border-stone-200">
          <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
            Proteklo: <span className="text-stone-800 text-sm ml-1">{formatTime(elapsedTime)}</span>
          </div>
          <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
            Do kraja: <span className="text-stone-800 text-sm ml-1">{formatTime(totalDuration - elapsedTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

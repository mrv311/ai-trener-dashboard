import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Bluetooth, BluetoothConnected, Heart, Zap, Play, Pause, Square, FastForward, Plus, Minus, Settings2, Award, UploadCloud, CheckCircle2, Activity } from 'lucide-react';
import TrainerModals from './trainer/TrainerModals';
import TrainerGraph from './trainer/TrainerGraph';
import { getZoneColorForTrainer } from '../utils/workoutUtils';

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

  compute(targetPower, measuredPower) {
    const now = Date.now();
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 2.0) : 1.0;
    this.lastTime = now;

    const error = targetPower - measuredPower;

    this.integral = Math.max(-this.maxIntegral, Math.min(this.maxIntegral, this.integral + error * dt));

    const derivative = dt > 0 ? (error - this.prevError) / dt : 0;
    this.prevError = error;

    const correction = this.kP * error + this.kI * this.integral + this.kD * derivative;

    return Math.round(targetPower + correction);
  }
}

const pidController = new PowerMatchPID();

export default function TrainerTab({ profile, workoutFromCalendar, onClose }) {
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
  const pmCrankDataRef = useRef({ revs: -1, time: -1 }); 

  const [workoutRecipe, setWorkoutRecipe] = useState([
    { name: 'Zagrijavanje', duration: 10 * 60, power: 50 },
    { name: 'Z2 Aerobna Baza', duration: 5 * 60, power: 65 },
    { name: 'SweetSpot 1', duration: 15 * 60, power: 90 },
    { name: 'Oporavak', duration: 3 * 60, power: 50 },
    { name: 'SweetSpot 2', duration: 15 * 60, power: 90 },
    { name: 'Hlađenje', duration: 7 * 60, power: 45 },
  ]);

  useEffect(() => {
    if (!workoutFromCalendar) return;

    let parsedRecipe = [];

    if (workoutFromCalendar.workout_doc && workoutFromCalendar.workout_doc.steps) {
      // Intervals API format
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
      parsedRecipe = extractSteps(workoutFromCalendar.workout_doc.steps);
    } else if (workoutFromCalendar.steps && Array.isArray(workoutFromCalendar.steps)) {
      // Supabase / Library format
      parsedRecipe = workoutFromCalendar.steps;
    }

    if (parsedRecipe.length > 0) {
      setWorkoutRecipe(parsedRecipe);
      setElapsedTime(0);
      setWorkoutHistory([]);
      setIsFinished(false);
      setShowStopPrompt(false);
      setIsPlaying(false);
    }
  }, [workoutFromCalendar]);

  const totalDuration = useMemo(() => workoutRecipe.reduce((acc, step) => acc + step.duration, 0), [workoutRecipe]);

  useEffect(() => {
    let interval;
    if (isPlaying && elapsedTime < totalDuration) {
      interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, elapsedTime, totalDuration]);

  useEffect(() => {
    if (isPlaying && elapsedTime > 0 && elapsedTime < totalDuration) {
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

  useEffect(() => {
    const anyPower = (isPmConnected ? pmPower : 0) || (isPowerConnected ? currentPower : 0);
    if (!isPlaying && !isFinished && !showStopPrompt && anyPower > 10) {
      setIsPlaying(true);
    }
  }, [currentPower, pmPower, isPlaying, isFinished, showStopPrompt, isPowerConnected, isPmConnected]);

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

  useEffect(() => {
    if (isPlaying && stepRemaining <= 3 && stepRemaining > 0 && currentStepIndex < workoutRecipe.length - 1) {
      playBeep(800, 0.2); 
    }
  }, [elapsedTime, isPlaying]);

  const baseTargetPower = Math.round((currentStep.power / 100) * profile.ftp);
  const activeTargetPower = Math.round(baseTargetPower * (ergIntensity / 100));

  const displayPower = (isPmConnected ? pmPower : (isPowerConnected ? currentPower : 0));
  const displayHR = isHrConnected ? currentHR : 0;
  const displayCadence = currentCadence;

  const getPowerColor = () => {
    if (!isPlaying && displayPower === 0) return "text-zinc-500";
    const diff = Math.abs(displayPower - activeTargetPower);
    if (diff <= 10) return "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]";
    if (diff <= 25) return "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]";
    return "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]";
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

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

  const connectPowerMeter = async () => {
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }]
      });
      const server = await device.gatt.connect();
      const powerService = await server.getPrimaryService('cycling_power');
      const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
      await powerChar.startNotifications();
      setIsPmConnected(true);
      setPowerMatchEnabled(true);
      pidController.reset();
      console.log("Powermetar spojen, Power Match aktiviran.");

      powerChar.addEventListener('characteristicvaluechanged', (e) => {
        parseCyclingPowerData(e.target.value, pmCrankDataRef, setPmPower, setCurrentCadence);
      });
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na powermetar: " + err.message);
    }
  };

  useEffect(() => {
    const sendErgCommand = async () => {
      if (!ftmsControlChar || controlMode !== 'ERG') return;
      try {
        let commandPower = activeTargetPower;

        if (powerMatchEnabled && isPmConnected && pmPower > 0) {
          commandPower = pidController.compute(activeTargetPower, pmPower);
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
    
    // Provjera prava na upis razine (preko 85% dovršenosti)
    if (elapsedTime / totalDuration >= 0.85 && workoutFromCalendar && workoutFromCalendar.difficulty_score) {
      try {
        const existingHistory = JSON.parse(localStorage.getItem('ai_trener_completed_workouts') || '[]');
        const newRecord = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          title: workoutFromCalendar.title || 'Nepoznat trening',
          category: workoutFromCalendar.category || 'Endurance',
          difficulty_score: workoutFromCalendar.difficulty_score || 1.0,
          duration_seconds: elapsedTime
        };
        localStorage.setItem('ai_trener_completed_workouts', JSON.stringify([...existingHistory, newRecord]));
        console.log("Napredak zabilježen!", newRecord);
      } catch(e) {
        console.error("Greška pri spremanju napretka", e);
      }
    }

    setSummaryStats({
      avgPower: pwrData.length ? Math.round(pwrData.reduce((a, b) => a + b.power, 0) / pwrData.length) : 0,
      avgHr: hrData.length ? Math.round(hrData.reduce((a, b) => a + b.hr, 0) / hrData.length) : 0,
      avgCadence: cadData.length ? Math.round(cadData.reduce((a, b) => a + b.cadence, 0) / cadData.length) : 0,
      totalDur: elapsedTime,
      isLevelUpEligible: elapsedTime / totalDuration >= 0.85
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showStopPrompt || isFinished) return; 

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
    <div className="max-w-6xl mx-auto flex flex-col min-h-[calc(100vh-8rem)] gap-4 md:gap-6 animate-in fade-in relative pb-20 md:pb-0">

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
      <div className="flex gap-2.5 md:gap-4 flex-wrap overflow-x-auto pb-1 md:pb-0 shrink-0">
        <button
          onClick={connectTrainer}
          className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2.5 md:py-3 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-base shrink-0 ${isPowerConnected ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-900/50 hover:bg-zinc-800 text-sky-400 border-zinc-800/80'}`}
        >
          {isPowerConnected ? <BluetoothConnected className="w-4 h-4 md:w-5 md:h-5" /> : <Bluetooth className="w-4 h-4 md:w-5 md:h-5" />}
          {isPowerConnected ? 'Trenažer Spojen' : 'Spoji Trenažer'}
        </button>

        <button
          onClick={connectPowerMeter}
          className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2.5 md:py-3 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-base shrink-0 ${isPmConnected ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-zinc-900/50 hover:bg-zinc-800 text-violet-400 border-zinc-800/80'}`}
        >
          {isPmConnected ? <BluetoothConnected className="w-4 h-4 md:w-5 md:h-5" /> : <Activity className="w-4 h-4 md:w-5 md:h-5" />}
          {isPmConnected ? 'PowerMeter Spojen' : 'Spoji PowerMeter'}
        </button>

        <button
          onClick={connectHR}
          className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2.5 md:py-3 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-base shrink-0 ${isHrConnected ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-900/50 hover:bg-zinc-800 text-rose-500 border-zinc-800/80'}`}
        >
          {isHrConnected ? <BluetoothConnected className="w-4 h-4 md:w-5 md:h-5" /> : <Heart className="w-4 h-4 md:w-5 md:h-5" />}
          {isHrConnected ? 'Pulsmetar Spojen' : 'Spoji Pulsmetar'}
        </button>

        {isPmConnected && (
          <button
            onClick={() => { setPowerMatchEnabled(prev => !prev); pidController.reset(); }}
            className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2.5 md:py-3 rounded-xl font-bold transition-all border shadow-sm text-xs md:text-base shrink-0 ${powerMatchEnabled ? 'bg-violet-600 text-white border-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.3)]' : 'bg-zinc-900/50 text-violet-500 border-zinc-800 hover:bg-zinc-800'}`}
          >
            <Activity className="w-4 h-4 md:w-5 md:h-5" />
            P.Match {powerMatchEnabled ? 'ON' : 'OFF'}
          </button>
        )}

        <div className="ml-auto flex items-center justify-between md:justify-end w-full md:w-auto bg-zinc-900/40 backdrop-blur-md rounded-xl border border-zinc-800/80 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 md:py-3 text-zinc-500 font-medium text-xs md:text-sm truncate">
            Trening: <span className="text-zinc-100 font-bold ml-2 uppercase">{workoutFromCalendar ? workoutFromCalendar.title : "Slobodna Vožnja"}</span>
          </div>
          {onClose && (
            <button 
              onClick={onClose} 
              className="px-4 py-2.5 md:py-3 bg-zinc-800 hover:bg-zinc-700 hover:text-white transition-colors text-zinc-400 font-bold border-l border-zinc-700/50 flex items-center gap-2"
            >
              <X className="w-4 h-4 md:w-5 md:h-5" /> <span className="hidden md:inline">Zatvori</span>
            </button>
          )}
        </div>
      </div>

      {/* GLAVNI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-6 shrink-0">
        <div className="md:col-span-2 lg:col-span-2 bg-zinc-900/40 backdrop-blur-xl rounded-3xl shadow-xl border border-zinc-800/80 p-4 md:p-8 flex flex-col justify-center items-center relative overflow-hidden">
          <div className={`absolute top-0 w-full h-2 ${getZoneColorForTrainer(currentStep.power)} transition-colors duration-500 shadow-[0_0_10px_rgba(255,255,255,0.2)]`}></div>
          <div className="absolute top-6 left-6 flex items-center gap-3">
            <span className="text-zinc-500 font-black uppercase tracking-widest text-sm">
              {(powerMatchEnabled && isPmConnected) ? 'PM Snaga' : 'Trenutna Snaga'}
            </span>
            {powerMatchEnabled && isPmConnected && (
              <span className="bg-violet-500/10 text-violet-400 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border border-violet-500/20">
                Power Match Active
              </span>
            )}
          </div>

          <div className="absolute top-4 md:top-6 right-4 md:right-6 flex items-center gap-1 md:gap-2 bg-zinc-950/50 p-1 md:p-1.5 rounded-xl border border-zinc-800">
            <button onClick={toggleMode} className="flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 bg-zinc-800 shadow-sm border border-zinc-700 rounded-lg text-[10px] md:text-xs font-bold text-zinc-300 uppercase tracking-wider hover:bg-zinc-700 hover:text-white transition-colors">
              <Settings2 className="w-3 h-3 md:w-3.5 md:h-3.5" /> <span className="hidden sm:inline">{controlMode} Mode</span><span className="sm:hidden">{controlMode}</span>
            </button>
            <div className="w-px h-6 bg-zinc-800 mx-1"></div>
            {controlMode === 'ERG' ? (
              <div className="flex items-center gap-1">
                <button onClick={decreaseErg} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 transition-colors"><Minus className="w-4 h-4" /></button>
                <span className="w-12 text-center font-bold text-zinc-100 text-sm">{ergIntensity}%</span>
                <button onClick={increaseErg} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 transition-colors"><Plus className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button onClick={decreaseRes} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 transition-colors"><Minus className="w-4 h-4" /></button>
                <span className="w-12 text-center font-bold text-zinc-100 text-sm">Lvl {resistanceLevel}</span>
                <button onClick={increaseRes} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 transition-colors"><Plus className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          <div className="flex items-baseline gap-2 md:gap-4 mt-8 md:mt-10">
            <div className={`text-[64px] md:text-[140px] font-black leading-none tracking-tighter transition-colors ${controlMode === 'RES' && isPlaying ? 'text-indigo-400 drop-shadow-[0_0_10px_rgba(129,140,248,0.5)]' : getPowerColor()}`}>
              {displayPower}
            </div>
            <span className="text-xl md:text-3xl font-bold text-zinc-600 pb-2 md:pb-6">W</span>
          </div>

          {powerMatchEnabled && isPmConnected && isPowerConnected && (
            <div className="text-sm font-bold text-zinc-500 mb-1">
              Trenažer: <span className="text-zinc-300">{currentPower} W</span>
              <span className="mx-2 text-zinc-700">·</span>
              Razlika: <span className={Math.abs(pmPower - currentPower) > 15 ? 'text-amber-400' : 'text-emerald-400'}>
                {pmPower - currentPower > 0 ? '+' : ''}{pmPower - currentPower} W
              </span>
            </div>
          )}

          <div className="text-xl md:text-2xl font-bold text-zinc-400 mt-2 bg-zinc-950/40 px-4 md:px-6 py-2 md:py-2.5 rounded-2xl border border-zinc-800/60 text-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]">
            {controlMode === 'ERG' ? (
              <>Cilj: <span className="text-zinc-100">{activeTargetPower} W</span>
                {powerMatchEnabled && isPmConnected && (
                  <span className="text-violet-400 ml-2 md:ml-3 text-sm md:text-base font-black drop-shadow-[0_0_5px_rgba(167,139,250,0.5)]">⟳ PM Locked</span>
                )}
              </>
            ) : (
              <>Slobodno <span className="text-indigo-400 ml-1 md:ml-2">(Otpor {resistanceLevel}%)</span></>
            )}
          </div>
        </div>

        <div className="flex sm:flex-col md:flex-row lg:flex-col gap-2 sm:gap-4 md:gap-6">
          <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-3 md:p-6 flex-1 flex flex-col justify-center items-center relative group hover:border-rose-500/30 transition-colors">
            <span className="absolute top-3 left-3 md:top-5 md:left-5 text-rose-500/80 font-black uppercase tracking-widest text-[9px] md:text-xs flex items-center gap-1"><Heart className="w-3 h-3 md:w-4 md:h-4 group-hover:text-rose-500 transition-colors" /> <span className="hidden xl:inline">Puls</span></span>
            <div className="flex items-baseline gap-1 md:gap-2 mt-3 md:mt-0">
              <div className={`text-[36px] md:text-[70px] font-black leading-none ${isHrConnected ? 'text-zinc-100 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)]' : 'text-zinc-700'}`}>{displayHR}</div>
              <span className="text-xs md:text-lg font-bold text-zinc-600 pb-1 md:pb-2">bpm</span>
            </div>
          </div>
          <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-3 md:p-6 flex-1 flex flex-col justify-center items-center relative group hover:border-orange-500/30 transition-colors">
            <span className="absolute top-3 left-3 md:top-5 md:left-5 text-orange-500/80 font-black uppercase tracking-widest text-[9px] md:text-xs flex items-center gap-1"><Zap className="w-3 h-3 md:w-4 md:h-4 group-hover:text-orange-500 transition-colors" /> <span className="hidden xl:inline">Kadenca</span></span>
            <div className="flex items-baseline gap-1 md:gap-2 mt-3 md:mt-0">
              <div className={`text-[36px] md:text-[70px] font-black leading-none ${(isPmConnected || isPowerConnected) ? 'text-zinc-100 drop-shadow-[0_0_8px_rgba(249,115,22,0.3)]' : 'text-zinc-700'}`}>{displayCadence}</div>
              <span className="text-xs md:text-lg font-bold text-zinc-600 pb-1 md:pb-2">rpm</span>
            </div>
          </div>
        </div>
      </div>

      {/* DONJI PANEL: Trening grafikon i kontrole */}
      <div className="bg-zinc-900/40 backdrop-blur-xl rounded-3xl shadow-xl border border-zinc-800/80 p-3 md:p-6 flex flex-col min-h-[300px] md:min-h-[300px] md:flex-1">
        <div className="flex flex-col md:flex-row md:items-end justify-between px-1 md:px-2 mb-2 md:mb-4 gap-3 md:gap-0">
          <div className="flex flex-col sm:flex-row items-center sm:items-start md:items-center gap-3 md:gap-4">
            <div className="flex items-center bg-zinc-950/50 rounded-full p-1 border border-zinc-800 mx-auto sm:mx-0">
              <button onClick={handleStopClick} className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-colors hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Prekini trening"><Square className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" /></button>
              <button onClick={() => setIsPlaying(!isPlaying)} className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center transition-all shadow-lg shrink-0 ${isPlaying ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white' : 'bg-orange-500 hover:bg-orange-400 text-white shadow-orange-500/30'}`}>
                {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" /> : <Play className="w-5 h-5 md:w-6 md:h-6 ml-1" fill="currentColor" />}
              </button>
              <button onClick={handleSkip} className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-colors hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Preskoči na idući interval"><FastForward className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" /></button>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-[10px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-0.5 md:mb-1.5">Trenutni Interval</div>
              <div className="text-base md:text-2xl font-bold text-zinc-100 flex flex-wrap items-center justify-center sm:justify-start gap-1 md:gap-3">
                {currentStep.name} <span className="text-zinc-500 font-medium text-xs md:text-lg">@ {Math.round(currentStep.power * (ergIntensity / 100))}% FTP</span>
                <button onClick={handleExtend} className="md:ml-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-[9px] md:text-[10px] uppercase tracking-wider font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-lg transition-colors flex items-center gap-1 shrink-0"><Plus className="w-3 h-3" /> 5 Min</button>
              </div>
            </div>
          </div>
          <div className="text-center md:text-right border-t border-zinc-800/50 md:border-t-0 pt-2 md:pt-0">
            <div className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-0.5 md:mb-1.5">Preostalo u intervalu</div>
            <div className={`text-3xl md:text-5xl font-black font-mono tracking-tight ${isPlaying ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(249,115,22,0.5)]' : 'text-zinc-600'}`}>{formatTime(stepRemaining)}</div>
          </div>
        </div>

        <TrainerGraph 
          workoutRecipe={workoutRecipe}
          workoutHistory={workoutHistory}
          totalDuration={totalDuration}
          progressPercent={progressPercent}
          profile={profile}
          ergIntensity={ergIntensity}
        />

        <div className="flex justify-between items-center px-4 py-2 bg-zinc-950/50 rounded-b-xl border-x border-b border-zinc-800/80">
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-600">
            Proteklo: <span className="text-zinc-300 text-sm ml-1">{formatTime(elapsedTime)}</span>
          </div>
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-600">
            Do kraja: <span className="text-zinc-300 text-sm ml-1">{formatTime(totalDuration - elapsedTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

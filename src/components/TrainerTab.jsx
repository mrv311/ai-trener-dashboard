import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Bluetooth, BluetoothConnected, Heart, Zap, Play, Pause, Square, FastForward, Plus, Minus, Settings2, Award, UploadCloud, CheckCircle2, Activity, X } from 'lucide-react';
import TrainerModals from './trainer/TrainerModals';
import TrainerGraph from './trainer/TrainerGraph';
import { getZoneColorForTrainer, calculateCogganMetrics, calculateEF, calculateVI, calculateAerobicDecoupling } from '../utils/performanceMetrics';
import { exportToTCX, exportToFIT, buildFitUint8Array } from '../utils/exportUtils';
import { calculateDistanceStream } from '../utils/virtualDistance';
import { parseIntervalsCode } from '../utils/workoutParser';
import { uploadActivityToIntervals } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';

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
    this.kP = 0.5;   // Proporcionalni faktor
    this.kI = 0.1;  // Integralni faktor (sprječava trajnu grešku)
    this.kD = 0.0;   // Derivativni faktor (prigušuje oscilacije)
    this.integral = 0;
    this.prevError = 0;
    this.lastTime = null;
    this.maxIntegral = 30; // Anti-windup
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

    // Sigurnosni limit korekcije (±45W) sprječava divljanje otpora kod naglog pada kadence ili jednostranog PM-a
    const rawCorrection = this.kP * error + this.kI * this.integral + this.kD * derivative;
    const clampedCorrection = Math.max(-45, Math.min(45, rawCorrection));

    return Math.round(targetPower + clampedCorrection);
  }
}

const pidController = new PowerMatchPID();
const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';
const FTMS_INDOOR_BIKE_DATA_UUID = '00002ad2-0000-1000-8000-00805f9b34fb';
const FTMS_CONTROL_POINT_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';
const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function TrainerTab({ profile, userId, workoutFromCalendar, onClose, intervalsId, intervalsKey, workouts = [], wellnessData = {}, onAddWorkoutToCalendar }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(null);

  const [currentHR, setCurrentHR] = useState(0);
  const [currentPower, setCurrentPower] = useState(0);       // Snaga s trenažera
  const [pmPower, setPmPower] = useState(0);                 // Sirova snaga s powermetra
  const [pmDoublePower, setPmDoublePower] = useState(() => {
    try {
      return localStorage.getItem('ergvibe_pm_double_watts') === 'true';
    } catch {
      return false;
    }
  });
  const [halfPowerDetected, setHalfPowerDetected] = useState(false);
  const [currentCadence, setCurrentCadence] = useState(0);
  const [isHrConnected, setIsHrConnected] = useState(false);
  const [isPowerConnected, setIsPowerConnected] = useState(false);   // Trenažer
  const [isPmConnected, setIsPmConnected] = useState(false);         // Powermetar
  const [trainerDeviceName, setTrainerDeviceName] = useState('');
  const [pmDeviceName, setPmDeviceName] = useState('');
  const [powerMatchEnabled, setPowerMatchEnabled] = useState(false); // Power Match toggle

  const [controlMode, setControlMode] = useState('ERG');
  const [ergIntensity, setErgIntensity] = useState(100);
  const [resistanceLevel, setResistanceLevel] = useState(30);
  const [ftmsControlChar, setFtmsControlChar] = useState(null);
  const [ftmsStatus, setFtmsStatus] = useState('idle'); // 'idle' | 'connecting' | 'ready' | 'unsupported' | 'error'

  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [isFinished, setIsFinished] = useState(false);
  const [showStopPrompt, setShowStopPrompt] = useState(false);
  const [summaryStats, setSummaryStats] = useState(null);
  const [intervalsUploadStatus, setIntervalsUploadStatus] = useState(null); // null | 'uploading' | 'uploaded' | 'error'
  const [intervalsUploadError, setIntervalsUploadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'saved_local' | 'error'

  const crankDataRef = useRef({ revs: -1, time: -1 });
  const pmCrankDataRef = useRef({ revs: -1, time: -1 });
  const lastCadenceUpdateTimeRef = useRef(0);
  const hrDeviceRef = useRef(null);
  const trainerDeviceRef = useRef(null);
  const pmDeviceRef = useRef(null);
  const isPmConnectedRef = useRef(false);
  const ftmsWriteQueueRef = useRef(Promise.resolve());
  const displayRollingRef = useRef([]);
  const pmLiveBufferRef = useRef([]);
  const halfPowerCounterRef = useRef(0);
  const loadedWorkoutKeyRef = useRef(null);

  useEffect(() => {
    isPmConnectedRef.current = isPmConnected;
  }, [isPmConnected]);

  const togglePmDoublePower = useCallback(() => {
    setPmDoublePower(prev => {
      const next = !prev;
      try {
        localStorage.setItem('ergvibe_pm_double_watts', String(next));
      } catch {
        // ignore storage error
      }
      if (next) setHalfPowerDetected(false);
      displayRollingRef.current = [];
      pmLiveBufferRef.current = [];
      pidController.reset();
      return next;
    });
  }, []);

  const effectivePmPower = useMemo(
    () => (pmDoublePower ? pmPower * 2 : pmPower),
    [pmPower, pmDoublePower]
  );

  const historyRef = useRef([]);
  useEffect(() => { historyRef.current = workoutHistory; }, [workoutHistory]);

  useEffect(() => {
    if (isPlaying && !sessionStartTime) {
      setSessionStartTime(new Date().toISOString());
    }
  }, [isPlaying, sessionStartTime]);

  // --- Centralizirana funkcija za odspajanje svih BLE senzora ---
  const disconnectAllSensors = useCallback(() => {
    try {
      if (hrDeviceRef.current && hrDeviceRef.current.gatt?.connected) {
        hrDeviceRef.current.gatt.disconnect();
      }
    } catch (e) { console.warn('HR disconnect error:', e); }
    hrDeviceRef.current = null;
    setIsHrConnected(false);
    setCurrentHR(0);

    try {
      if (trainerDeviceRef.current && trainerDeviceRef.current.gatt?.connected) {
        trainerDeviceRef.current.gatt.disconnect();
      }
    } catch (e) { console.warn('Trainer disconnect error:', e); }
    trainerDeviceRef.current = null;
    setIsPowerConnected(false);
    setTrainerDeviceName('');
    setCurrentPower(0);
    setFtmsControlChar(null);
    setFtmsStatus('idle');

    try {
      if (pmDeviceRef.current && pmDeviceRef.current.gatt?.connected) {
        pmDeviceRef.current.gatt.disconnect();
      }
    } catch (e) { console.warn('PM disconnect error:', e); }
    pmDeviceRef.current = null;
    isPmConnectedRef.current = false;
    setIsPmConnected(false);
    setPmDeviceName('');
    setPmPower(0);
    setHalfPowerDetected(false);
    halfPowerCounterRef.current = 0;
    setPowerMatchEnabled(false);
    pidController.reset();

    setCurrentCadence(0);
    crankDataRef.current = { revs: -1, time: -1 };
    pmCrankDataRef.current = { revs: -1, time: -1 };
    displayRollingRef.current = [];
    pmLiveBufferRef.current = [];
  }, []);

  // Čišćenje BLE konekcija pri unmount-u komponente
  useEffect(() => {
    return () => {
      disconnectAllSensors();
    };
  }, [disconnectAllSensors]);

  const [liveMetrics, setLiveMetrics] = useState({ np: 0, ifFactor: "0.00", tss: 0, workKj: 0 });

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const pwrArray = historyRef.current.map(h => h.power);
      if (pwrArray.length > 0) {
        const metrics = calculateCogganMetrics(pwrArray, profile?.ftp || 200);
        setLiveMetrics(metrics);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying, profile]);

  const [workoutRecipe, setWorkoutRecipe] = useState([
    { name: 'Zagrijavanje', duration: 10 * 60, power: 50 },
    { name: 'Z2 Aerobna Baza', duration: 5 * 60, power: 65 },
    { name: 'SweetSpot 1', duration: 15 * 60, power: 90 },
    { name: 'Oporavak', duration: 3 * 60, power: 50 },
    { name: 'SweetSpot 2', duration: 15 * 60, power: 90 },
    { name: 'Hlađenje', duration: 7 * 60, power: 45 },
  ]);

  useEffect(() => {
    if (!workoutFromCalendar) {
      loadedWorkoutKeyRef.current = null;
      return;
    }

    const currentFtp = Number(profile?.ftp) || 200;
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
            if (typeof step.power === 'number') {
              pwr = step.power;
            } else if (step.power) {
              let rawVal = null;
              if (step.power.value != null) rawVal = step.power.value;
              else if (step.power.start != null && step.power.end != null) rawVal = (step.power.start + step.power.end) / 2;
              if (rawVal != null) {
                const units = String(step.power.units || '').toLowerCase();
                pwr = units === 'w' ? Math.round((rawVal / currentFtp) * 100) : rawVal;
              }
            }
            flatSteps.push({
              name: step.name || step.text || (pwr > 80 ? 'Radni Interval' : 'Odmor'),
              duration: step.duration || 60,
              power: Math.round(pwr)
            });
          }
        });
        return flatSteps;
      };
      parsedRecipe = extractSteps(workoutFromCalendar.workout_doc.steps);
    } else if (workoutFromCalendar.steps && Array.isArray(workoutFromCalendar.steps)) {
      // Supabase / Library format
      parsedRecipe = workoutFromCalendar.steps.map(s => ({
        ...s,
        name: s.name || s.text || 'Interval'
      }));
    } else if (typeof workoutFromCalendar.workout_doc === 'string' && workoutFromCalendar.workout_doc.trim()) {
      const parsed = parseIntervalsCode(workoutFromCalendar.workout_doc, currentFtp);
      if (parsed?.allSteps?.length > 0) {
        parsedRecipe = parsed.allSteps.map(s => ({ ...s, name: s.name || s.text || 'Interval' }));
      }
    } else if (typeof workoutFromCalendar.steps === 'string' && workoutFromCalendar.steps.trim()) {
      const parsed = parseIntervalsCode(workoutFromCalendar.steps, currentFtp);
      if (parsed?.allSteps?.length > 0) {
        parsedRecipe = parsed.allSteps.map(s => ({ ...s, name: s.name || s.text || 'Interval' }));
      }
    }

    if (parsedRecipe.length > 0) {
      setWorkoutRecipe(parsedRecipe);
      // Resetiraj tijek treninga samo ako je odabran novi trening (ne ako se asinkrono učitao FTP)
      const workoutIdentity = `${workoutFromCalendar.id || ''}_${workoutFromCalendar.title || ''}_${parsedRecipe.length}`;
      if (loadedWorkoutKeyRef.current !== workoutIdentity) {
        loadedWorkoutKeyRef.current = workoutIdentity;
        setElapsedTime(0);
        setSessionStartTime(null);
        setWorkoutHistory([]);
        setIsFinished(false);
        setShowStopPrompt(false);
        setIntervalsUploadStatus(null);
        setIntervalsUploadError(null);
        setSaveStatus(null);
        setIsPlaying(false);
      }
    }
  }, [workoutFromCalendar, profile?.ftp]);

  const totalDuration = useMemo(() => workoutRecipe.reduce((acc, step) => acc + step.duration, 0), [workoutRecipe]);

  const usePmAsPrimary = isPmConnected && (powerMatchEnabled || !isPowerConnected);

  const stateRef = useRef({
    powerMatchEnabled, usePmAsPrimary, isPmConnected, isPowerConnected, isHrConnected,
    effectivePmPower, currentPower, currentHR, currentCadence
  });

  useEffect(() => {
    stateRef.current = {
      powerMatchEnabled, usePmAsPrimary, isPmConnected, isPowerConnected, isHrConnected,
      effectivePmPower, currentPower, currentHR, currentCadence
    };
  }, [powerMatchEnabled, usePmAsPrimary, isPmConnected, isPowerConnected, isHrConnected, effectivePmPower, currentPower, currentHR, currentCadence]);

  const lastUpdateRef = useRef(Date.now());
  const workerRef = useRef(null);
  const wakeLockRef = useRef(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake Lock was released');
        });
        console.log('Wake Lock is active');
      }
    } catch (err) {
      console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current !== null) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock released manually');
      } catch (err) {
        console.warn(`Error releasing Wake Lock: ${err.message}`);
      }
    }
  }, []);

  useEffect(() => {
    if (isPlaying && !isFinished) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isPlaying, isFinished, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying && !isFinished) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isPlaying, isFinished, requestWakeLock, releaseWakeLock]);

  // --- Zatvaranje treninga: reset svih lokalnih stateova + poziv onClose propa ---
  const handleCloseWorkout = useCallback(() => {
    // Zaustavi worker/timer
    if (workerRef.current) workerRef.current.postMessage('stop');

    // Odspoji sve senzore
    disconnectAllSensors();

    // Reset svih lokalnih stanja trenažera
    setIsPlaying(false);
    setElapsedTime(0);
    setSessionStartTime(null);
    setWorkoutHistory([]);
    setIsFinished(false);
    setShowStopPrompt(false);
    setSummaryStats(null);
    setIntervalsUploadStatus(null);
    setIntervalsUploadError(null);
    setSaveStatus(null);
    setErgIntensity(100);
    setResistanceLevel(30);
    setControlMode('ERG');
    setLiveMetrics({ np: 0, ifFactor: "0.00", tss: 0, workKj: 0 });

    // Pozovi parent callback za navigaciju
    if (onClose) onClose();
  }, [disconnectAllSensors, onClose]);

  // Inicijalizacija Web Workera za precizno mjerenje vremena (zaobilazi pozadinsko usporavanje taba)
  useEffect(() => {
    const workerCode = `
      let intervalId = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!intervalId) intervalId = setInterval(() => self.postMessage('tick'), 1000);
        } else if (e.data === 'stop') {
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    workerRef.current = new Worker(workerUrl);

    return () => {
      workerRef.current.terminate();
      URL.revokeObjectURL(workerUrl);
    };
  }, []);

  useEffect(() => {
    if (isPlaying && elapsedTime < totalDuration) {
      lastUpdateRef.current = Date.now();

      workerRef.current.onmessage = () => {
        const now = Date.now();
        const deltaSecs = Math.floor((now - lastUpdateRef.current) / 1000);

        if (deltaSecs > 0) {
          lastUpdateRef.current += deltaSecs * 1000;

          setElapsedTime(prev => {
            const newElapsed = prev + deltaSecs;

            const s = stateRef.current;
            const recordedPower = s.usePmAsPrimary ? s.effectivePmPower : (s.isPowerConnected ? s.currentPower : 0);
            const hr = s.isHrConnected ? s.currentHR : 0;
            const cad = (s.isPmConnected || s.isPowerConnected) ? s.currentCadence : 0;

            if (prev < totalDuration) {
              setWorkoutHistory(hist => {
                const newHist = [...hist];
                if (hist.length === 0 && prev === 0) {
                  newHist.push({ time: 0, power: recordedPower, hr, cadence: cad });
                }
                for (let i = 0; i < deltaSecs; i++) {
                  if (prev + i + 1 <= totalDuration) {
                    newHist.push({ time: prev + i + 1, power: recordedPower, hr, cadence: cad });
                  }
                }
                return newHist;
              });
            }

            return newElapsed > totalDuration ? totalDuration : newElapsed;
          });
        }
      };

      workerRef.current.postMessage('start');
    } else if (workerRef.current) {
      workerRef.current.postMessage('stop');
    }

    return () => {
      if (workerRef.current) workerRef.current.postMessage('stop');
    };
  }, [isPlaying, totalDuration]);

  useEffect(() => {
    if (isPlaying && elapsedTime >= totalDuration) {
      handleFinishWorkout();
    }
  }, [elapsedTime, isPlaying, totalDuration]);

  useEffect(() => {
    const anyPower = (isPmConnected ? effectivePmPower : 0) || (isPowerConnected ? currentPower : 0);
    // Ne pokreći automatski ako je trening završen ili modal otvoren ili ako je već bilo podataka (stari trening)
    if (!isPlaying && !isFinished && !showStopPrompt && !summaryStats && anyPower > 15) {
      setIsPlaying(true);
    }
  }, [currentPower, effectivePmPower, isPlaying, isFinished, showStopPrompt, summaryStats, isPowerConnected, isPmConnected]);

  // Automatsko nuliranje kadence nakon prestanka okretanja pedala (>3.5s bez impulsa)
  // i detekcija jednostranog PowerMetra koji šalje ~50% snage (npr. Assioma UNO bez uključenog BLE ×2)
  useEffect(() => {
    if (!isPowerConnected && !isPmConnected) return;
    const watchdog = setInterval(() => {
      if (lastCadenceUpdateTimeRef.current > 0 && Date.now() - lastCadenceUpdateTimeRef.current > 3500) {
        setCurrentCadence(0);
      }
      const trW = stateRef.current.currentPower;
      const rawPmW = pmPower;
      if (isPowerConnected && isPmConnected && !pmDoublePower && trW >= 75 && rawPmW >= 20) {
        const ratio = rawPmW / trW;
        if (ratio >= 0.36 && ratio <= 0.62) {
          halfPowerCounterRef.current += 1;
          if (halfPowerCounterRef.current >= 4) {
            setHalfPowerDetected(true);
          }
        } else if (ratio > 0.75) {
          halfPowerCounterRef.current = 0;
          setHalfPowerDetected(false);
        }
      }
    }, 1000);
    return () => clearInterval(watchdog);
  }, [isPowerConnected, isPmConnected, pmDoublePower, pmPower]);

  useEffect(() => {
    pidController.reset();
    displayRollingRef.current = [];
  }, [powerMatchEnabled, usePmAsPrimary, pmDoublePower]);

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

  const hasValidFtp = profile && profile.ftp && profile.ftp > 0;
  const ftpValue = hasValidFtp ? profile.ftp : 200;
  const baseTargetPower = Math.round((currentStep.power / 100) * ftpValue);
  const activeTargetPower = Math.round(baseTargetPower * (ergIntensity / 100));

  // Konzistentan 3-sekundni zaglađeni prikaz isključivo s aktivnog izvora snage (nikada ne miješa Trenažer i PM)
  const displayPower = useMemo(() => {
    const rawActive = usePmAsPrimary
      ? effectivePmPower
      : (isPowerConnected ? currentPower : 0);

    if (rawActive <= 0) {
      displayRollingRef.current = [];
      return 0;
    }

    const buf = displayRollingRef.current;
    buf.push(rawActive);
    if (buf.length > 3) buf.shift();
    const sum = buf.reduce((acc, v) => acc + v, 0);
    return Math.round(sum / buf.length);
  }, [usePmAsPrimary, effectivePmPower, currentPower, isPowerConnected]);

  const displayHR = isHrConnected ? currentHR : 0;
  const displayCadence = currentCadence;

  const getPowerColor = () => {
    if (!isPlaying && displayPower === 0) return "text-zinc-500";
    const diff = Math.abs(displayPower - activeTargetPower);
    if (diff <= 10) return "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]";
    if (diff <= 25) return "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]";
    return "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]";
  };

  const getZoneTextColor = (pwr) => {
    if (pwr < 55) return 'text-gray-400 drop-shadow-[0_0_8px_rgba(156,163,175,0.5)]';
    if (pwr < 76) return 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]';
    if (pwr < 88) return 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]';
    if (pwr < 95) return 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]';
    if (pwr < 106) return 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]';
    if (pwr < 121) return 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]';
    return 'text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.5)]';
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Serijalizirani red čekanja za FTMS GATT upise — sprječava "GATT operation already in progress" kolizije!
  const enqueueFtmsWrite = useCallback((char, data) => {
    if (!char) return Promise.resolve(false);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const nextOp = ftmsWriteQueueRef.current
      .then(async () => {
        if (!trainerDeviceRef.current?.gatt?.connected) return false;
        if (typeof char.writeValueWithResponse === 'function') {
          await char.writeValueWithResponse(bytes);
        } else {
          await char.writeValue(bytes);
        }
        return true;
      })
      .catch((err) => {
        console.warn('[FTMS] GATT write upozorenje:', err);
        return false;
      });
    ftmsWriteQueueRef.current = nextOp;
    return nextOp;
  }, []);

  const parseCyclingPowerData = (view, crankRef, onPower, onCadence) => {
    if (!view || view.byteLength < 4) return;
    const flags = view.getUint16(0, true);
    const watts = Math.max(0, view.getInt16(2, true));
    onPower(watts);

    if ((flags & 0x20) !== 0 && onCadence) {
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
          if (timeDiff > 0 && revDiff > 0) {
            const rpm = Math.round((revDiff / (timeDiff / 1024)) * 60);
            if (rpm > 0 && rpm < 200) {
              lastCadenceUpdateTimeRef.current = Date.now();
              onCadence(rpm);
            }
          }
        }
        crankRef.current = { revs: crankRevs, time: crankTime };
      }
    }
  };

  // FTMS Indoor Bike Data (0x2AD2) parser — služi kao fallback za snagu/kadencu i održava FTMS sesiju aktivnom
  const parseIndoorBikeData = (view, useForPower, useForCadence) => {
    if (!view || view.byteLength < 2) return;
    const flags = view.getUint16(0, true);
    let offset = 2;

    // Bit 0 (More Data): 0 = Instantaneous Speed je prisutan (2 bajta)
    if ((flags & 0x0001) === 0) offset += 2;
    // Bit 1: Average Speed (2 bajta)
    if ((flags & 0x0002) !== 0) offset += 2;
    // Bit 2: Instantaneous Cadence (uint16, 0.5 rpm rezolucija)
    if ((flags & 0x0004) !== 0) {
      if (useForCadence && view.byteLength >= offset + 2 && !isPmConnectedRef.current) {
        const rpm = Math.round(view.getUint16(offset, true) * 0.5);
        if (rpm > 0 && rpm < 200) {
          lastCadenceUpdateTimeRef.current = Date.now();
          setCurrentCadence(rpm);
        } else if (rpm === 0) {
          setCurrentCadence(0);
        }
      }
      offset += 2;
    }
    // Bit 3: Average Cadence (2 bajta)
    if ((flags & 0x0008) !== 0) offset += 2;
    // Bit 4: Total Distance (uint24 = 3 bajta)
    if ((flags & 0x0010) !== 0) offset += 3;
    // Bit 5: Resistance Level (sint16 = 2 bajta)
    if ((flags & 0x0020) !== 0) offset += 2;
    // Bit 6: Instantaneous Power (sint16 = 2 bajta)
    if ((flags & 0x0040) !== 0 && useForPower && view.byteLength >= offset + 2) {
      const watts = Math.max(0, view.getInt16(offset, true));
      setCurrentPower(watts);
    }
  };

  // setup helperi za BLE uređaje
  const setupHRDevice = async (device) => {
    hrDeviceRef.current = device;
    device.addEventListener('gattserverdisconnected', () => {
      if (hrDeviceRef.current === device) {
        setIsHrConnected(false);
        setCurrentHR(0);
      }
    });
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
  };

  const setupTrainerDevice = async (device) => {
    trainerDeviceRef.current = device;
    setTrainerDeviceName(device.name || 'Trenažer');
    setFtmsStatus('connecting');
    crankDataRef.current = { revs: -1, time: -1 };

    device.addEventListener('gattserverdisconnected', () => {
      if (trainerDeviceRef.current === device) {
        setIsPowerConnected(false);
        setCurrentPower(0);
        setFtmsControlChar(null);
        setFtmsStatus('idle');
        if (!isPmConnectedRef.current) setCurrentCadence(0);
      }
    });

    const server = await device.gatt.connect();
    let hasCpsPower = false;
    let hasCpsCadence = false;

    // 1. Pokušaj spojiti Cycling Power Service (0x1818) za čitanje snage trenažera
    try {
      const powerService = await server.getPrimaryService('cycling_power');
      const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
      await powerChar.startNotifications();
      hasCpsPower = true;

      powerChar.addEventListener('characteristicvaluechanged', (e) => {
        const view = e.target.value;
        if (view && view.byteLength >= 2 && (view.getUint16(0, true) & 0x20) !== 0) {
          hasCpsCadence = true;
        }
        parseCyclingPowerData(
          view,
          crankDataRef,
          setCurrentPower,
          // Ako je spojen vanjski PowerMeter (npr. Assioma), kadencu čitamo isključivo s pedala!
          (rpm) => {
            if (!isPmConnectedRef.current) setCurrentCadence(rpm);
          }
        );
      });
    } catch (cpsErr) {
      console.info('[Trainer] Cycling Power servis nije dostupan, koristim FTMS Indoor Bike Data:', cpsErr);
    }

    // 2. Spoji FTMS servis (0x1826) STROGO SEKVENCIJALNO bez GATT kolizija:
    //    Indoor Bike Data (0x2AD2) -> Control Point (0x2AD9) -> Request Control (0x00) -> Start/Resume (0x07)
    try {
      const ftmsService = await server.getPrimaryService(FTMS_SERVICE_UUID);

      try {
        const ibdChar = await ftmsService.getCharacteristic(FTMS_INDOOR_BIKE_DATA_UUID);
        await ibdChar.startNotifications();
        ibdChar.addEventListener('characteristicvaluechanged', (e) => {
          parseIndoorBikeData(e.target.value, !hasCpsPower, !hasCpsCadence);
        });
      } catch (ibdErr) {
        console.info('[FTMS] Indoor Bike Data nije dostupan:', ibdErr);
      }

      const controlPoint = await ftmsService.getCharacteristic(FTMS_CONTROL_POINT_UUID);
      await controlPoint.startNotifications();

      controlPoint.addEventListener('characteristicvaluechanged', (e) => {
        const v = e.target.value;
        if (v && v.byteLength >= 3 && v.getUint8(0) === 0x80) {
          const reqOp = v.getUint8(1);
          const result = v.getUint8(2);
          // 0x04 = Control Not Permitted -> trenažer je izgubio kontrolnu sesiju, automatski preuzmi natrag!
          if (result === 0x04 && reqOp !== 0x00) {
            console.warn('[FTMS] Trenažer traži ponovno preuzimanje kontrole (0x04). Šaljem 0x00 -> 0x07...');
            enqueueFtmsWrite(controlPoint, new Uint8Array([0x00]));
            enqueueFtmsWrite(controlPoint, new Uint8Array([0x07]));
          }
        }
      });

      // Prvo zatraži kontrolu (0x00) i pokreni FTMS sesiju (0x07) PRIJE postavljanja React statea!
      await enqueueFtmsWrite(controlPoint, new Uint8Array([0x00]));
      await sleepMs(150);
      await enqueueFtmsWrite(controlPoint, new Uint8Array([0x07]));
      await sleepMs(150);

      setIsPowerConnected(true);
      setFtmsStatus('ready');
      setFtmsControlChar(controlPoint);
      console.log('[FTMS] Kontrola (0x00) i Start (0x07) uspješno preuzeti.');
    } catch (ftmsErr) {
      console.warn('[FTMS] Kontrola otpora nije dostupna na ovom uređaju:', ftmsErr);
      if (hasCpsPower) {
        setIsPowerConnected(true);
        setFtmsStatus('unsupported');
      } else {
        setFtmsStatus('error');
        throw new Error('Odabrani uređaj ne podržava ni FTMS ni Cycling Power.');
      }
    }
  };

  const setupPmDevice = async (device) => {
    pmDeviceRef.current = device;
    setPmDeviceName(device.name || 'PowerMeter');
    pmCrankDataRef.current = { revs: -1, time: -1 };
    pmLiveBufferRef.current = [];
    halfPowerCounterRef.current = 0;
    setHalfPowerDetected(false);

    device.addEventListener('gattserverdisconnected', () => {
      if (pmDeviceRef.current === device) {
        isPmConnectedRef.current = false;
        setIsPmConnected(false);
        setPmPower(0);
        setHalfPowerDetected(false);
        setPowerMatchEnabled(false);
        pidController.reset();
      }
    });

    const server = await device.gatt.connect();
    const powerService = await server.getPrimaryService('cycling_power');
    const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
    await powerChar.startNotifications();
    isPmConnectedRef.current = true;
    setIsPmConnected(true);
    setPowerMatchEnabled(true);
    pidController.reset();
    console.log('[BLE] Powermetar spojen, Power Match aktiviran.');

    powerChar.addEventListener('characteristicvaluechanged', (e) => {
      parseCyclingPowerData(
        e.target.value,
        pmCrankDataRef,
        (rawWatts) => {
          setPmPower(rawWatts);
          const buf = pmLiveBufferRef.current;
          buf.push(rawWatts);
          if (buf.length > 3) buf.shift();
        },
        setCurrentCadence
      );
    });
  };


  const connectHR = async () => {
    if (isHrConnected) {
      if (hrDeviceRef.current && hrDeviceRef.current.gatt.connected) {
        hrDeviceRef.current.gatt.disconnect();
      }
      setIsHrConnected(false);
      setCurrentHR(0);
      hrDeviceRef.current = null;
      return;
    }
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      await setupHRDevice(device);
    } catch (err) { if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na pulsmetar: " + err.message); }
  };

  const connectTrainer = async () => {
    if (isPowerConnected) {
      if (trainerDeviceRef.current && trainerDeviceRef.current.gatt.connected) {
        trainerDeviceRef.current.gatt.disconnect();
      }
      setIsPowerConnected(false);
      setTrainerDeviceName('');
      setCurrentPower(0);
      setCurrentCadence(prevCadence => isPmConnected ? prevCadence : 0);
      trainerDeviceRef.current = null;
      setFtmsControlChar(null);
      setFtmsStatus('idle');
      return;
    }
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [FTMS_SERVICE_UUID] },
          { services: ['cycling_power'] }
        ],
        optionalServices: ['cycling_power', FTMS_SERVICE_UUID]
      });
      await setupTrainerDevice(device);
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na trenažer: " + err.message);
    }
  };

  const connectPowerMeter = async () => {
    if (isPmConnected) {
      if (pmDeviceRef.current && pmDeviceRef.current.gatt.connected) {
        pmDeviceRef.current.gatt.disconnect();
      }
      isPmConnectedRef.current = false;
      setIsPmConnected(false);
      setPmDeviceName('');
      setPmPower(0);
      setHalfPowerDetected(false);
      halfPowerCounterRef.current = 0;
      setPowerMatchEnabled(false);
      pidController.reset();
      pmDeviceRef.current = null;
      pmLiveBufferRef.current = [];
      return;
    }
    try {
      if (!navigator.bluetooth) { alert("Tvoj preglednik ne podržava Web Bluetooth."); return; }
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }]
      });
      await setupPmDevice(device);
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na powermetar: " + err.message);
    }
  };

  const ergParamsRef = useRef({
    activeTargetPower,
    controlMode,
    ftmsControlChar,
    powerMatchEnabled,
    isPmConnected,
    pmDoublePower,
    halfPowerDetected,
    currentCadence,
    ftp: profile?.ftp || 250
  });

  useEffect(() => {
    ergParamsRef.current = {
      activeTargetPower,
      controlMode,
      ftmsControlChar,
      powerMatchEnabled,
      isPmConnected,
      pmDoublePower,
      halfPowerDetected,
      currentCadence,
      ftp: profile?.ftp || 250
    };
  }, [activeTargetPower, controlMode, ftmsControlChar, powerMatchEnabled, isPmConnected, pmDoublePower, halfPowerDetected, currentCadence, profile?.ftp]);

  const dispatchErgTarget = useCallback((resetPid = false) => {
    const p = ergParamsRef.current;
    if (!p.ftmsControlChar || p.controlMode !== 'ERG') return;

    if (resetPid) {
      pidController.reset();
    }

    let commandPower = p.activeTargetPower;
    const isHalfPowerBlocked = p.halfPowerDetected && !p.pmDoublePower;

    if (p.powerMatchEnabled && p.isPmConnected && !isHalfPowerBlocked) {
      const rawBuf = pmLiveBufferRef.current;
      const mult = p.pmDoublePower ? 2 : 1;
      const scaledAvg = rawBuf.length > 0
        ? Math.round((rawBuf.reduce((a, b) => a + b, 0) / rawBuf.length) * mult)
        : 0;

      // Korigiraj otpor samo dok vozač aktivno okreće pedale (>=45 rpm i >=35 W) kako kratko usporavanje ne bi zabilo otpor
      if (scaledAvg >= 35 && p.currentCadence >= 45) {
        commandPower = pidController.compute(p.activeTargetPower, scaledAvg);
      }
      const maxTrainerW = Math.round((p.ftp || 250) * 1.5);
      commandPower = Math.max(30, Math.min(maxTrainerW, commandPower));
    }

    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint8(0, 0x05);
    view.setInt16(1, commandPower, true);
    enqueueFtmsWrite(p.ftmsControlChar, new Uint8Array(buffer));
  }, [enqueueFtmsWrite]);

  // Trenutno slanje nove ERG snage čim se promijeni interval, intenzitet, mod (RES->ERG), P.Match ON/OFF ili ×2 prekidač!
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'ERG') return;
    dispatchErgTarget(true);
  }, [activeTargetPower, controlMode, ftmsControlChar, powerMatchEnabled, pmDoublePower, halfPowerDetected, dispatchErgTarget]);

  // Periodičko osvježavanje ERG cilja (svake 2s uz Power Match, inače svake 4s za stabilan FTMS lock)
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'ERG') return;
    const intervalMs = (powerMatchEnabled && isPmConnected) ? 2000 : 4000;
    const timer = setInterval(() => {
      dispatchErgTarget(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [ftmsControlChar, controlMode, powerMatchEnabled, isPmConnected, dispatchErgTarget]);

  useEffect(() => {
    if (ftmsControlChar && controlMode === 'RES') {
      enqueueFtmsWrite(ftmsControlChar, new Uint8Array([0x04, resistanceLevel]));
    }
  }, [resistanceLevel, controlMode, ftmsControlChar, enqueueFtmsWrite]);

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
        const existingHistory = JSON.parse(localStorage.getItem(`ai_trener_completed_workouts_${userId || 'guest'}`) || '[]');
        const newRecord = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          title: workoutFromCalendar.title || 'Nepoznat trening',
          category: workoutFromCalendar.category || 'Endurance',
          difficulty_score: workoutFromCalendar.difficulty_score || 1.0,
          duration_seconds: elapsedTime
        };
        localStorage.setItem(`ai_trener_completed_workouts_${userId || 'guest'}`, JSON.stringify([...existingHistory, newRecord]));
        console.log("Napredak zabilježen!", newRecord);
      } catch (e) {
        console.error("Greška pri spremanju napretka", e);
      }
    }

    const finalMetrics = calculateCogganMetrics(workoutHistory.map(h => h.power), profile?.ftp || 200);
    setLiveMetrics(finalMetrics);

    // Izračun virtualne udaljenosti
    const mass = profile?.weight || 75;
    console.log('[TrainerTab] workoutHistory duljina:', workoutHistory.length);
    const distResult = calculateDistanceStream(workoutHistory, mass);
    console.log('[TrainerTab] distResult.stream duljina:', distResult.stream.length);
    console.log('[TrainerTab] Prvi stream element:', distResult.stream[0]);
    const distanceKm = Math.round((distResult.totalDistanceM / 1000) * 10) / 10;
    const avgSpeedKmh = distResult.avgSpeedKmh;

    const avgPower = pwrData.length ? Math.round(pwrData.reduce((a, b) => a + b.power, 0) / pwrData.length) : 0;
    const avgHr = hrData.length ? Math.round(hrData.reduce((a, b) => a + b.hr, 0) / hrData.length) : 0;
    const avgCadence = cadData.length ? Math.round(cadData.reduce((a, b) => a + b.cadence, 0) / cadData.length) : 0;
    const maxPower = pwrData.length ? Math.max(...pwrData.map(x => x.power)) : 0;
    const ef = calculateEF(finalMetrics.np, avgHr);
    const vi = calculateVI(finalMetrics.np, avgPower);
    const decouplingInfo = calculateAerobicDecoupling(workoutHistory, profile?.ftp || 200);

    setSummaryStats({
      avgPower,
      maxPower,
      avgHr,
      avgCadence,
      totalDur: elapsedTime,
      isLevelUpEligible: elapsedTime / totalDuration >= 0.85,
      np: finalMetrics.np,
      ifFactor: finalMetrics.ifFactor,
      tss: finalMetrics.tss,
      workKj: finalMetrics.workKj,
      ef,
      vi,
      decoupling: decouplingInfo?.decoupling ?? null,
      efFirst: decouplingInfo?.efFirst ?? null,
      efSecond: decouplingInfo?.efSecond ?? null,
      distanceKm,
      avgSpeedKmh
    });

    // --- AUTO SAVE u ErgVibe (localStorage + Supabase za prijavljene korisnike) ---
    let startedAt;
    if (sessionStartTime) {
      startedAt = new Date(sessionStartTime);
    } else {
      startedAt = new Date();
      startedAt.setSeconds(startedAt.getSeconds() - elapsedTime);
    }

    const workoutTitle = workoutFromCalendar ? workoutFromCalendar.title : 'Slobodna Vožnja';
    let workoutSource = 'free_ride';
    if (workoutFromCalendar) {
      workoutSource = workoutFromCalendar.workout_doc ? 'calendar' : 'library';
    }

    setSaveStatus('saving');

    // Eksplicitno pretvori stream u JSON format
    const streamDataToSave = distResult.stream.length > 0 ? distResult.stream : null;

    const activityPayload = {
      started_at: startedAt.toISOString(),
      title: workoutTitle,
      workout_source: workoutSource,
      duration_seconds: elapsedTime,
      avg_power: avgPower,
      avg_hr: avgHr,
      avg_cadence: avgCadence,
      np: finalMetrics.np,
      tss: finalMetrics.tss,
      if_factor: parseFloat(finalMetrics.ifFactor),
      work_kj: finalMetrics.workKj,
      distance_m: distResult.totalDistanceM,
      avg_speed_kmh: avgSpeedKmh,
      ftp_used: profile?.ftp || 200,
      weight_kg: mass,
      stream_data: streamDataToSave
    };

    // 1. Spremi u localStorage (primarno za Gosta + offline backup za prijavljene)
    let localSavedOk = false;
    try {
      const localActivities = JSON.parse(localStorage.getItem(`ai_trener_local_completed_activities_${userId || 'guest'}`) || '[]');
      const localId = 'local_act_' + Date.now();
      const localActivity = {
        id: localId,
        ...activityPayload,
        workout_doc: workoutFromCalendar?.steps || workoutFromCalendar?.workout_doc || null
      };

      // Ograniči na zadnjih 50 aktivnosti da ne napunimo localStorage
      const updatedLocal = [localActivity, ...localActivities].slice(0, 50);
      localStorage.setItem(`ai_trener_local_completed_activities_${userId || 'guest'}`, JSON.stringify(updatedLocal));
      localSavedOk = true;
    } catch (e) {
      console.warn('Nije uspjelo spremanje u localStorage backup', e);
    }

    // 2. Ako je Gost, odmah označi kao spremljeno i osvježi Kalendar
    if (!userId || userId === 'guest') {
      setSaveStatus(localSavedOk ? 'saved' : 'error');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('supabase-activity-saved'));
      }, 300);
    } else {
      // Prijavljeni korisnik: spremi i u Supabase (uz user_id)
      supabase.from('completed_activities').insert({ ...activityPayload, user_id: userId }).then(({ error: saveErr }) => {
        if (saveErr) {
          console.error('Greška pri spremanju u Supabase:', saveErr);
          setSaveStatus(localSavedOk ? 'saved_local' : 'error');
        } else {
          setSaveStatus('saved');
        }
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('supabase-activity-saved'));
        }, 300);
      });
    }

    // 3. Opcionalni automatski .FIT upload na Intervals.icu (samo ako je korisnik povezao Intervals.icu)
    if (intervalsId && intervalsKey && workoutHistory.length > 0) {
      setIntervalsUploadStatus('uploading');
      setIntervalsUploadError(null);
      try {
        const built = buildFitUint8Array(workoutHistory, startedAt.toISOString(), mass);
        if (built && built.uint8) {
          uploadActivityToIntervals(intervalsId, intervalsKey, built.uint8, workoutTitle)
            .then(() => {
              setIntervalsUploadStatus('uploaded');
            })
            .catch((upErr) => {
              console.error('[TrainerTab] Intervals.icu upload error:', upErr);
              setIntervalsUploadStatus('error');
              setIntervalsUploadError(upErr.message || 'Greška pri slanju na Intervals.icu');
            });
        } else {
          setIntervalsUploadStatus('error');
          setIntervalsUploadError('Nema podataka za .FIT datoteku.');
        }
      } catch (upErr) {
        setIntervalsUploadStatus('error');
        setIntervalsUploadError(upErr.message);
      }
    }
  };

  const handleRetryIntervalsUpload = useCallback(async () => {
    if (!intervalsId || !intervalsKey || workoutHistory.length === 0) return;
    setIntervalsUploadStatus('uploading');
    setIntervalsUploadError(null);
    try {
      const mass = profile?.weight || 75;
      const workoutTitle = workoutFromCalendar ? workoutFromCalendar.title : 'Slobodna Vožnja';
      const built = buildFitUint8Array(workoutHistory, sessionStartTime, mass);
      if (!built || !built.uint8) throw new Error('Nema podataka za .FIT datoteku.');
      await uploadActivityToIntervals(intervalsId, intervalsKey, built.uint8, workoutTitle);
      setIntervalsUploadStatus('uploaded');
    } catch (err) {
      setIntervalsUploadStatus('error');
      setIntervalsUploadError(err.message || 'Greška pri slanju na Intervals.icu');
    }
  }, [intervalsId, intervalsKey, workoutHistory, profile?.weight, workoutFromCalendar, sessionStartTime]);

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
      // Allow default behavior inside text inputs or textareas
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }

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
    <div className="w-full max-w-[1800px] mx-auto flex flex-col flex-1 gap-1 md:gap-2 xl:gap-4 animate-in fade-in relative px-1 md:px-2 min-h-0">

      <TrainerModals
        showStopPrompt={showStopPrompt}
        isFinished={isFinished}
        confirmStop={confirmStop}
        cancelStop={cancelStop}
        summaryStats={summaryStats}
        workoutFromCalendar={workoutFromCalendar}
        isPmConnected={isPmConnected}
        saveStatus={saveStatus}
        isIntervalsConfigured={Boolean(intervalsId && intervalsKey)}
        intervalsUploadStatus={intervalsUploadStatus}
        intervalsUploadError={intervalsUploadError}
        onRetryIntervalsUpload={handleRetryIntervalsUpload}
        handleReset={handleCloseWorkout}
        handleExportTcx={() => exportToTCX(workoutHistory, workoutFromCalendar?.title || 'Slobodna_voznja', sessionStartTime, profile?.weight || 75)}
        handleExportFit={() => exportToFIT(workoutHistory, workoutFromCalendar?.title || 'Slobodna_voznja', sessionStartTime, profile?.weight || 75)}
        athleteProfile={profile}
        liveWorkouts={workouts}
        wellnessData={wellnessData}
        onAddWorkoutToCalendar={onAddWorkoutToCalendar}
      />

      {/* GORNJA TRAKA: Bluetooth gumbi */}
      <div className="flex gap-1.5 md:gap-3 flex-wrap overflow-x-auto pb-0 md:pb-0 shrink-0">
        <button
          onClick={connectTrainer}
          title={trainerDeviceName ? `Spojen: ${trainerDeviceName}` : 'Spoji pametni trenažer (FTMS / Cycling Power)'}
          className={`flex items-center gap-1 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2.5 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-sm shrink-0 ${
            isPowerConnected
              ? (ftmsStatus === 'ready'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30')
              : 'bg-zinc-900/50 hover:bg-zinc-800 text-sky-400 border-zinc-800/80'
          }`}
        >
          {isPowerConnected ? <BluetoothConnected className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Bluetooth className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          {isPowerConnected
            ? `${trainerDeviceName || 'Trenažer'} ${ftmsStatus === 'ready' ? '(ERG)' : '(Bez ERG)'}`
            : 'Spoji Trenažer'}
        </button>

        <button
          onClick={connectPowerMeter}
          title={pmDeviceName ? `Spojen: ${pmDeviceName}` : 'Spoji vanjski PowerMeter (npr. Favero Assioma)'}
          className={`flex items-center gap-1 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2.5 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-sm shrink-0 ${isPmConnected ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-zinc-900/50 hover:bg-zinc-800 text-violet-400 border-zinc-800/80'}`}
        >
          {isPmConnected ? <BluetoothConnected className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Activity className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          {isPmConnected ? (pmDeviceName || 'PowerMeter Spojen') : 'Spoji PowerMeter'}
        </button>

        <button
          onClick={connectHR}
          className={`flex items-center gap-1 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2.5 rounded-xl font-bold transition-colors border shadow-sm text-xs md:text-sm shrink-0 ${isHrConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-900/50 hover:bg-zinc-800 text-rose-500 border-zinc-800/80'}`}
        >
          {isHrConnected ? <BluetoothConnected className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Heart className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          {isHrConnected ? 'Pulsmetar Spojen' : 'Spoji Pulsmetar'}
        </button>

        {isPmConnected && (
          <>
            <button
              onClick={() => { setPowerMatchEnabled(prev => !prev); pidController.reset(); }}
              title="Uskladi otpor trenažera prema očitanju PowerMetra"
              className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-1.5 md:py-2.5 rounded-xl font-bold transition-all border shadow-sm text-xs md:text-sm shrink-0 ${powerMatchEnabled ? 'bg-violet-600 text-white border-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.3)]' : 'bg-zinc-900/50 text-violet-400 border-zinc-800 hover:bg-zinc-800'}`}
            >
              <Activity className="w-3.5 h-3.5 md:w-4 md:h-4" />
              P.Match {powerMatchEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={togglePmDoublePower}
              title="Udvostruči snagu jednostrane pedale (npr. Assioma UNO kada u Favero aplikaciji nije uključen Unified Channel L). Isključi ako Favero aplikacija već udvostručuje snagu!"
              className={`flex items-center gap-1 px-2.5 md:px-3.5 py-1.5 md:py-2.5 rounded-xl font-black transition-all border shadow-sm text-xs md:text-sm shrink-0 ${
                pmDoublePower
                  ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.35)]'
                  : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              ×2 Uno {pmDoublePower ? 'ON' : 'OFF'}
            </button>
          </>
        )}

        <div className="ml-auto flex items-center justify-end bg-zinc-900/40 backdrop-blur-md rounded-xl border border-zinc-800/80 shadow-sm overflow-hidden shrink-0">
          <div className="px-3 py-1.5 md:px-4 md:py-2.5 text-zinc-500 font-medium text-xs md:text-sm truncate max-w-[140px] sm:max-w-none">
            <span className="hidden sm:inline">Trening: </span><span className="text-zinc-100 font-bold uppercase">{workoutFromCalendar ? workoutFromCalendar.title : "Slobodna Vožnja"}</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 md:px-4 md:py-2.5 bg-zinc-800 hover:bg-zinc-700 hover:text-white transition-colors text-zinc-400 font-bold border-l border-zinc-700/50 flex items-center gap-2"
            >
              <X className="w-4 h-4 md:w-5 md:h-5" /> <span className="hidden md:inline">Zatvori</span>
            </button>
          )}
        </div>
      </div>

      {/* DIJAGNOSTIČKE OBAVIJESTI ZA BLE / FTMS / ASSIOMA UNO */}
      {isPowerConnected && ftmsStatus === 'unsupported' && (
        <div className="bg-amber-950/50 border border-amber-500/40 text-amber-200 rounded-xl px-3 py-2 text-xs font-semibold flex items-center justify-between gap-2 shrink-0">
          <span>
            ⚠️ Spojeni uređaj ({trainerDeviceName}) ne nudi FTMS kontrolu otpora (ERG neće mijenjati otpor). Provjeri jesi li slučajno odabrao pedale umjesto Direta ili drži li druga aplikacija (Zwift / MyETraining / Garmin) aktivnu vezu s trenažerom.
          </span>
        </div>
      )}

      {halfPowerDetected && !pmDoublePower && isPmConnected && isPowerConnected && (
        <div className="bg-amber-950/60 border border-amber-500/50 text-amber-200 rounded-xl px-3 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span>
            ⚠️ PowerMeter ({pmPower} W) šalje ~50% snage trenažera ({currentPower} W) — jednostrana pedala (Assioma UNO) bez BLE ×2! Power Match korekcija je automatski pauzirana kako ne bi udvostručila otpor.
          </span>
          <button
            onClick={togglePmDoublePower}
            className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs shrink-0 transition-colors"
          >
            Uključi ×2 Uno odmah
          </button>
        </div>
      )}

      {/* GLAVNI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 shrink-[2] min-h-0" style={{minHeight: 0}}>
        <div className="md:col-span-2 lg:col-span-2 bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-2 md:p-4 flex flex-col relative overflow-hidden min-h-0">
          <div className={`absolute top-0 left-0 w-full h-2 ${getZoneColorForTrainer(currentStep.power)} transition-colors duration-500 shadow-[0_0_10px_rgba(255,255,255,0.2)]`}></div>
          
          <div className="flex justify-between items-start w-full z-10 shrink-0">
            <div className="flex items-center gap-2 mt-1 md:mt-0 flex-wrap">
              <span className="text-zinc-500 font-black uppercase tracking-widest text-[9px] md:text-xs">
                {usePmAsPrimary ? `PM Snaga${pmDoublePower ? ' (×2)' : ''}` : (isPowerConnected ? 'Snaga Trenažera' : 'Trenutna Snaga')}
              </span>
              {powerMatchEnabled && isPmConnected && !(halfPowerDetected && !pmDoublePower) && (
                <span className="bg-violet-500/10 text-violet-400 text-[8px] md:text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-violet-500/20">
                  Power Match Active
                </span>
              )}
              {!powerMatchEnabled && isPmConnected && isPowerConnected && (
                <span className="bg-sky-500/10 text-sky-400 text-[8px] md:text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-sky-500/20">
                  Izvor: Trenažer (P.Match OFF)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-2 bg-zinc-950/50 p-1 md:p-2 rounded-2xl border border-zinc-800 shadow-lg">
              <button onClick={toggleMode} className="flex items-center gap-1 md:gap-1.5 px-2 py-1 md:px-4 md:py-2 bg-zinc-800 shadow-sm border border-zinc-700 rounded-xl text-[9px] md:text-xs font-bold text-zinc-300 uppercase tracking-wider hover:bg-zinc-700 hover:text-white transition-colors active:scale-95">
                <Settings2 className="w-3 h-3 md:w-4 md:h-4" /> <span className="hidden sm:inline">{controlMode} Mode</span><span className="sm:hidden">{controlMode}</span>
              </button>
              <div className="w-px h-5 md:h-8 bg-zinc-800 mx-0.5 md:mx-1"></div>
              {controlMode === 'ERG' ? (
                <div className="flex items-center gap-0.5 md:gap-2">
                  <button onClick={decreaseErg} className="p-1.5 md:p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-100 transition-all active:scale-95 active:bg-zinc-700"><Minus className="w-4 h-4 md:w-5 md:h-5" /></button>
                  <span className="w-10 md:w-16 text-center font-black text-zinc-100 text-sm md:text-lg">{ergIntensity}%</span>
                  <button onClick={increaseErg} className="p-1.5 md:p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-100 transition-all active:scale-95 active:bg-zinc-700"><Plus className="w-4 h-4 md:w-5 md:h-5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 md:gap-2">
                  <button onClick={decreaseRes} className="p-1.5 md:p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-100 transition-all active:scale-95 active:bg-zinc-700"><Minus className="w-4 h-4 md:w-5 md:h-5" /></button>
                  <span className="w-10 md:w-16 text-center font-black text-zinc-100 text-sm md:text-lg">Lvl {resistanceLevel}</span>
                  <button onClick={increaseRes} className="p-1.5 md:p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-100 transition-all active:scale-95 active:bg-zinc-700"><Plus className="w-4 h-4 md:w-5 md:h-5" /></button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col flex-1 items-center justify-center min-h-0 w-full z-10 py-2">
            <div className="flex items-baseline gap-1 md:gap-2 shrink-1 min-h-0">
              <div className={`text-[clamp(40px,8vh,120px)] md:text-[clamp(60px,12vh,150px)] font-black leading-none tracking-tighter transition-colors ${controlMode === 'RES' && isPlaying ? 'text-indigo-400 drop-shadow-[0_0_10px_rgba(129,140,248,0.5)]' : getPowerColor()}`}>
                {displayPower}
              </div>
              <span className="text-lg md:text-2xl lg:text-3xl font-bold text-zinc-600 pb-1 md:pb-2">W</span>
            </div>

            {isPmConnected && isPowerConnected && (
              <div className="text-xs font-bold text-zinc-500 mb-0.5 flex items-center gap-1.5 flex-wrap justify-center">
                <span>Trenažer: <span className="text-zinc-300">{currentPower} W</span></span>
                <span className="text-zinc-700">·</span>
                <span>Pedale{pmDoublePower ? ' (×2)' : ''}: <span className="text-violet-300">{effectivePmPower} W</span></span>
                <span className="text-zinc-700">·</span>
                <span>
                  Razlika:{' '}
                  <span className={Math.abs(effectivePmPower - currentPower) > 15 ? 'text-amber-400' : 'text-emerald-400'}>
                    {effectivePmPower - currentPower > 0 ? '+' : ''}{effectivePmPower - currentPower} W
                  </span>
                </span>
              </div>
            )}

            <div className="text-sm md:text-lg lg:text-xl font-bold text-zinc-400 mt-1 md:mt-2 bg-zinc-950/40 px-3 md:px-5 py-1 md:py-1.5 rounded-xl border border-zinc-800/60 text-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]">
              {controlMode === 'ERG' ? (
                !hasValidFtp ? (
                  <span className="text-rose-500 font-bold text-sm md:text-base flex items-center justify-center gap-2">
                    ⚠️ <span className="hidden sm:inline">Upozorenje: Nije unesen FTP! Koristi se zadanih 200W.</span><span className="sm:hidden">Unesi FTP!</span>
                  </span>
                ) : (
                  <div className="flex flex-col items-center justify-center leading-tight">
                    <div>
                      Cilj: <span className="text-zinc-100">{activeTargetPower} W</span>
                      {powerMatchEnabled && isPmConnected && !(halfPowerDetected && !pmDoublePower) && (
                        <span className="text-violet-400 ml-1 md:ml-2 text-xs md:text-sm font-black drop-shadow-[0_0_5px_rgba(167,139,250,0.5)]">⟳ PM</span>
                      )}
                    </div>
                    {currentStepIndex < workoutRecipe.length - 1 && (
                      <div className="text-xs md:text-sm lg:text-base text-zinc-500 font-medium">
                        (sljedeći: <span className="text-zinc-400">{Math.round((workoutRecipe[currentStepIndex + 1].power / 100) * ftpValue * (ergIntensity / 100))} W</span>)
                      </div>
                    )}
                  </div>
                )
              ) : (
                <>Slobodno <span className="text-indigo-400 ml-1 md:ml-2">(Otpor {resistanceLevel}%)</span></>
              )}
            </div>
          </div>
        </div>

        <div className="flex sm:flex-col md:flex-row lg:flex-col gap-2 md:gap-3 shrink-1 min-h-0">
          <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-2 flex-1 flex flex-col justify-center items-center relative group hover:border-rose-500/30 transition-colors min-h-0">
            <span className="absolute top-2 left-2 md:top-3 md:left-3 text-rose-500/80 font-black uppercase tracking-widest text-[8px] md:text-[10px] flex items-center gap-1"><Heart className="w-3 h-3 group-hover:text-rose-500 transition-colors" /> <span className="hidden xl:inline">Puls</span></span>
            <div className="flex items-baseline gap-1 mt-1 md:mt-0 shrink-1 min-h-0">
              <div className={`text-[clamp(30px,6vh,70px)] md:text-[clamp(40px,8vh,90px)] font-black leading-none ${isHrConnected ? 'text-zinc-100 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)]' : 'text-zinc-700'}`}>{displayHR}</div>
              <span className="text-[10px] md:text-sm font-bold text-zinc-600 pb-0.5">bpm</span>
            </div>
          </div>
          <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-2 flex-1 flex flex-col justify-center items-center relative group hover:border-orange-500/30 transition-colors min-h-0">
            <span className="absolute top-2 left-2 md:top-3 md:left-3 text-orange-500/80 font-black uppercase tracking-widest text-[8px] md:text-[10px] flex items-center gap-1"><Zap className="w-3 h-3 group-hover:text-orange-500 transition-colors" /> <span className="hidden xl:inline">Kadenca</span></span>
            <div className="flex items-baseline gap-1 mt-1 md:mt-0 shrink-1 min-h-0">
              <div className={`text-[clamp(30px,6vh,70px)] md:text-[clamp(40px,8vh,90px)] font-black leading-none ${(isPmConnected || isPowerConnected) ? 'text-zinc-100 drop-shadow-[0_0_8px_rgba(34,211,238,0.3)]' : 'text-zinc-700'}`}>{displayCadence}</div>
              <span className="text-[10px] md:text-sm font-bold text-zinc-600 pb-0.5">rpm</span>
            </div>
          </div>
        </div>
      </div>

      {/* SESSION PROGRESS BAR */}
      <div className="bg-zinc-900/40 backdrop-blur-xl rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] border border-zinc-800/80 px-2 md:px-4 py-1.5 md:py-2.5 flex items-center justify-between overflow-x-auto shrink-0 hide-scrollbar gap-2 md:col-span-3">
        <div className={`flex items-center gap-4 md:gap-8 mx-auto ${getZoneTextColor(currentStep.power)} font-mono tabular-nums text-[11px] sm:text-xs md:text-sm lg:text-base font-black uppercase tracking-widest`}>
          <div className="flex items-center gap-1"><span className="text-zinc-500 font-bold opacity-70 drop-shadow-none">NP</span> <span>{liveMetrics.np}W</span></div>
          <div className="flex items-center gap-1"><span className="text-zinc-500 font-bold opacity-70 drop-shadow-none">IF</span> <span>{liveMetrics.ifFactor}</span></div>
          <div className="flex items-center gap-1"><span className="text-zinc-500 font-bold opacity-70 drop-shadow-none">TSS</span> <span>{liveMetrics.tss}</span></div>
          <div className="flex items-center gap-1"><span className="text-zinc-500 font-bold opacity-70 drop-shadow-none">Work</span> <span>{liveMetrics.workKj}kJ</span></div>
        </div>
      </div>

      {/* DONJI PANEL: Trening grafikon i kontrole */}
      <div className="bg-zinc-900/40 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-xl border border-zinc-800/80 p-2 md:p-3 flex flex-col flex-1 min-h-0 mb-1">
        <div className="flex flex-col md:flex-row md:items-end justify-between px-1 mb-1 md:mb-2 gap-1 md:gap-0 shrink-0">
          <div className="flex flex-col sm:flex-row items-center sm:items-start md:items-center gap-1.5 md:gap-2">
            <div className="flex items-center bg-zinc-950/50 rounded-full p-0.5 border border-zinc-800 mx-auto sm:mx-0">
              <button onClick={handleStopClick} className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-colors hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Prekini trening"><Square className="w-3 h-3 md:w-4 md:h-4" fill="currentColor" /></button>
              <button onClick={() => setIsPlaying(!isPlaying)} className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all shadow-lg shrink-0 ${isPlaying ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white' : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-cyan-500/30'}`}>
                {isPlaying ? <Pause className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" /> : <Play className="w-4 h-4 md:w-5 md:h-5 ml-0.5" fill="currentColor" />}
              </button>
              <button onClick={handleSkip} className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-colors hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Preskoči na idući interval"><FastForward className="w-3 h-3 md:w-4 md:h-4" fill="currentColor" /></button>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-[8px] md:text-[9px] lg:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Trenutni Interval</div>
              <div className="text-sm md:text-lg lg:text-xl xl:text-2xl font-bold text-zinc-100 flex flex-wrap items-center justify-center sm:justify-start gap-1 md:gap-2 leading-none">
                {currentStep.name} <span className="text-zinc-500 font-medium text-[9px] md:text-xs lg:text-sm">@ {Math.round(currentStep.power * (ergIntensity / 100))}% FTP</span>
                <button onClick={handleExtend} className="md:ml-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-[7px] md:text-[8px] lg:text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md transition-colors flex items-center gap-0.5 shrink-0"><Plus className="w-2.5 h-2.5" /> 5 Min</button>
              </div>
            </div>
          </div>
          <div className="text-center md:text-right border-t border-zinc-800/50 md:border-t-0 pt-0.5 md:pt-0 shrink-0">
            <div className="text-[8px] md:text-[9px] lg:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Preostalo u intervalu</div>
            <div className={`text-xl md:text-3xl lg:text-4xl xl:text-5xl font-black font-mono tracking-tight leading-none ${isPlaying ? 'text-orange-500 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]' : 'text-zinc-600'}`}>{formatTime(stepRemaining)}</div>
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

        <div className="flex justify-between items-center px-2 md:px-4 py-1.5 md:py-2 bg-zinc-950/50 rounded-b-xl md:rounded-b-2xl border-x border-b border-zinc-800/80 shrink-0">
          <div className="text-[10px] md:text-sm lg:text-base font-black uppercase tracking-widest text-zinc-500 flex flex-col md:flex-row items-start md:items-baseline">
            <span>UKUPNO PROTEKLO VRIJEME:</span> <span className="text-zinc-300 text-sm md:text-xl lg:text-2xl mt-0.5 md:mt-0 md:ml-2 font-mono tracking-tight">{formatTime(elapsedTime)}</span>
          </div>
          <div className="text-[10px] md:text-sm lg:text-base font-black uppercase tracking-widest text-zinc-500 flex flex-col md:flex-row items-end md:items-baseline text-right md:text-left">
            <span>DO KRAJA TRENINGA:</span> <span className="text-zinc-300 text-sm md:text-xl lg:text-2xl mt-0.5 md:mt-0 md:ml-2 font-mono tracking-tight">{formatTime(totalDuration - elapsedTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

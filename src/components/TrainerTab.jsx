import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Bluetooth, BluetoothConnected, Heart, Zap, Play, Pause, Square, FastForward, Plus, Minus, Settings2, Award, UploadCloud, CheckCircle2, Activity, X, Gamepad2, ArrowUpDown, RotateCcw, Battery, Maximize2, Minimize2, Loader2, AlertCircle, FileText, Copy, Trash2, Search } from 'lucide-react';
import TrainerModals from './trainer/TrainerModals';
import TrainerGraph from './trainer/TrainerGraph';
import { getZoneColorForTrainer, calculateCogganMetrics, calculateEF, calculateVI, calculateAerobicDecoupling } from '../utils/performanceMetrics';
import { exportToTCX, exportToFIT, buildFitUint8Array } from '../utils/exportUtils';
import { calculateDistanceStream } from '../utils/virtualDistance';
import { parseIntervalsCode } from '../utils/workoutParser';
import { uploadActivityToIntervals } from '../services/intervalsApi';
import { supabase } from '../services/supabaseClient';
import {
  logBleEvent,
  getBleLogs,
  clearBleLogs,
  subscribeBleLogs,
  getSessionBleLogs,
  formatBleLogsAsText
} from '../utils/bleDiagnosticLogger';
import {
  ZwiftClickController,
  VIRTUAL_GEAR_MIN,
  VIRTUAL_GEAR_MAX,
  VIRTUAL_GEAR_DEFAULT,
  gearToResistancePercent,
  gearToSimulatedGrade
} from '../services/zwiftClickService';

let sharedAudioCtx = null;
const getAudioCtx = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
};

const playBeep = (freq = 800, duration = 0.2) => {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("AudioContext nije dostupan", e);
  }
};

// Kratki elektronički Di2 / AXS zvuk promjene brzine
const playShiftSound = (direction = 'up') => {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    const startFreq = direction === 'up' ? 1050 : 950;
    const endFreq = direction === 'up' ? 1480 : 660;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + 0.045);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.055);

    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch {
    // ignore audio errors
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
const FTMS_SUPPORTED_RESISTANCE_RANGE_UUID = '00002ad6-0000-1000-8000-00805f9b34fb';
const FTMS_CONTROL_POINT_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';

// Cycling Power (0x1818) + Favero Assioma 128-bitni servis (Microchip/ISSC transparent UART u primarnom ADV_IND paketu)
const CYCLING_POWER_SERVICE_UUID = '00001818-0000-1000-8000-00805f9b34fb';
const CYCLING_POWER_MEASUREMENT_UUID = '00002a63-0000-1000-8000-00805f9b34fb';
const FAVERO_PROPRIETARY_SERVICE_UUID = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

const PM_OPTIONAL_SERVICES = [
  'cycling_power',
  CYCLING_POWER_SERVICE_UUID,
  FAVERO_PROPRIETARY_SERVICE_UUID,
  'battery_service',
  BATTERY_SERVICE_UUID,
  'device_information'
];

// Multi-filter lista za PowerMetre: hvata uređaje i kad Windows BLE propusti SCAN_RSP s 0x1818 dok drži trenažer/HR/Click aktivnima
const PM_DEVICE_FILTERS = [
  { services: ['cycling_power'] },
  { services: [CYCLING_POWER_SERVICE_UUID] },
  { services: [FAVERO_PROPRIETARY_SERVICE_UUID] },
  { namePrefix: 'ASSIOMA' },
  { namePrefix: 'Assioma' },
  { namePrefix: 'FAVERO' },
  { namePrefix: 'Favero' },
  { namePrefix: 'Stages' },
  { namePrefix: '4iiii' },
  { namePrefix: 'Garmin' },
  { namePrefix: 'Rally' },
  { namePrefix: 'Vector' },
  { namePrefix: 'QUARQ' },
  { namePrefix: 'Magene' },
  { namePrefix: 'Rotor' }
];

const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isBrowserFullscreenActive = () =>
  typeof document !== 'undefined' && Boolean(document.fullscreenElement || document.webkitFullscreenElement);

const isUserCancelledBle = (err) => {
  if (!err) return false;
  const msg = String(err.message || '');
  return err.name === 'NotFoundError' && /cancel|canceled|cancelled|dismiss|abort/i.test(msg);
};

const formatBleErrorMessage = (err, deviceLabel) => {
  if (isUserCancelledBle(err)) return null;
  const msg = String(err?.message || err || 'Nepoznata greška');
  if (/adapter not available|globally disabled|not supported/i.test(msg)) {
    return `Bluetooth nije dostupan ili je isključen (${deviceLabel}). Provjeri je li Bluetooth uključen u Windows postavkama.`;
  }
  if (/gesture|activation/i.test(msg)) {
    return `Preglednik traži izravan klik na gumb za otvaranje Bluetooth popisa (${deviceLabel}). Klikni ponovno.`;
  }
  if (/already in progress/i.test(msg)) {
    return `Bluetooth traženje je već u tijeku u pregledniku. Pričekaj trenutak ili osvježi stranicu (F5).`;
  }
  if (/ne emitira Cycling Power/i.test(msg)) {
    return msg;
  }
  if (/gatt|connection attempt failed|disconnected/i.test(msg)) {
    if (deviceLabel === 'PowerMeter') {
      return 'Spajanje na PowerMeter (Assioma) nije uspjelo. Provjeri: (1) zavrti pedale 2 kruga, (2) ugasi Bluetooth na mobitelu / zatvori Favero aplikaciju i Garmin, (3) ukloni Assioma iz Windows Bluetooth postavki ako je tamo uparena.';
    }
    return `Spajanje na ${deviceLabel} nije uspjelo. Provjeri je li uređaj budan i da nije već spojen na mobitel, Garmin ili Zwift.`;
  }
  return `Nije uspjelo spajanje na ${deviceLabel}: ${msg}`;
};

export default function TrainerTab({ profile, userId, workoutFromCalendar, onClose, intervalsId, intervalsKey, workouts = [], wellnessData = {}, onAddWorkoutToCalendar, onPlayingChange, onFullscreenChange }) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (onPlayingChange) onPlayingChange(isPlaying);
  }, [isPlaying, onPlayingChange]);
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
  const [pmBatteryLevel, setPmBatteryLevel] = useState(null);
  const [powerMatchEnabled, setPowerMatchEnabled] = useState(false); // Power Match toggle

  const [controlMode, setControlMode] = useState('ERG');
  const [ergIntensity, setErgIntensity] = useState(100);
  const [virtualGear, setVirtualGear] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('ergvibe_virtual_gear') || '', 10);
      if (Number.isFinite(saved) && saved >= VIRTUAL_GEAR_MIN && saved <= VIRTUAL_GEAR_MAX) {
        return saved;
      }
    } catch {
      // ignore
    }
    return VIRTUAL_GEAR_DEFAULT;
  });
  const [resPhysicsMode, setResPhysicsMode] = useState(() => {
    try {
      return localStorage.getItem('ergvibe_res_physics_mode') === 'SIM' ? 'SIM' : 'RES';
    } catch {
      return 'RES';
    }
  });
  const resistanceLevel = useMemo(() => gearToResistancePercent(virtualGear), [virtualGear]);
  const simulatedGrade = useMemo(() => gearToSimulatedGrade(virtualGear), [virtualGear]);
  const [ftmsControlChar, setFtmsControlChar] = useState(null);
  const [ftmsStatus, setFtmsStatus] = useState('idle'); // 'idle' | 'connecting' | 'ready' | 'unsupported' | 'error'

  // Zwift Click (Virtual Shifting & ERG daljinski upravljač)
  const zwiftClickRef = useRef(null);
  if (!zwiftClickRef.current) {
    zwiftClickRef.current = new ZwiftClickController();
  }
  const [zwiftClickState, setZwiftClickState] = useState(() => zwiftClickRef.current.getSnapshot());
  const [showClickSettings, setShowClickSettings] = useState(false);
  const [shiftToast, setShiftToast] = useState(null);
  const shiftToastTimerRef = useRef(null);
  const resHoldTimerRef = useRef(null);
  const resHoldIntervalRef = useRef(null);
  const ergHoldTimerRef = useRef(null);
  const ergLongPressFiredRef = useRef(false);

  // BLE spajanje i siguran prijelaz iz punog zaslona (sprječava Chromium ChooserBubbleUi deadlock u Fullscreenu)
  const [bleConnectingType, setBleConnectingType] = useState(null); // 'trainer' | 'pm' | 'hr' | 'click' | null
  const bleConnectingRef = useRef(null);
  const [bleErrorBanner, setBleErrorBanner] = useState(null);
  const [fullscreenBleModal, setFullscreenBleModal] = useState(null); // { target: 'trainer'|'pm'|'hr'|'click', lastConnectedLabel: string|null }
  const [fsSettling, setFsSettling] = useState(false);
  const exitingFsForBleRef = useRef(false);
  const [showBleLogModal, setShowBleLogModal] = useState(false);
  const [bleLogs, setBleLogs] = useState(() => getBleLogs());
  const [bleLogCopied, setBleLogCopied] = useState(false);

  useEffect(() => {
    return subscribeBleLogs((updated) => {
      setBleLogs([...updated]);
    });
  }, []);

  const showHudToast = useCallback((text, subtext = '', tone = 'indigo') => {
    if (shiftToastTimerRef.current) clearTimeout(shiftToastTimerRef.current);
    setShiftToast({ text, subtext, tone, id: Date.now() });
    shiftToastTimerRef.current = setTimeout(() => {
      setShiftToast(null);
    }, 1800);
  }, []);

  const openFullscreenBleHandoff = useCallback((sensorKey) => {
    exitingFsForBleRef.current = true;
    setFsSettling(true);
    setBleErrorBanner(null);
    setFullscreenBleModal({ target: sensorKey, lastConnectedLabel: null });

    const exitPromise = document.exitFullscreen
      ? document.exitFullscreen()
      : document.webkitExitFullscreen
      ? document.webkitExitFullscreen()
      : Promise.resolve();

    Promise.resolve(exitPromise)
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          setFsSettling(false);
          exitingFsForBleRef.current = false;
        }, 220);
      });
  }, []);

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
  const pmIntentionalDisconnectRef = useRef(false);
  const pmReconnectingRef = useRef(false);
  const pmDisconnectCleanupRef = useRef(null);
  const pmCharCleanupRef = useRef(null);
  const ftmsWriteQueueRef = useRef(Promise.resolve());
  const ftmsResRangeRef = useRef({ rawMin: 0, rawMax: 100, rawInc: 1, hasRangeChar: false });
  const ftmsResFormatRef = useRef('uint8'); // 'uint8' | 'sint16'
  const resFormatFlippedRef = useRef(false);
  const dispatchResTargetRef = useRef(null);
  const dispatchErgTargetRef = useRef(null);
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

    pmIntentionalDisconnectRef.current = true;
    pmReconnectingRef.current = false;
    try {
      if (pmCharCleanupRef.current) {
        pmCharCleanupRef.current();
        pmCharCleanupRef.current = null;
      }
      if (pmDisconnectCleanupRef.current) {
        pmDisconnectCleanupRef.current();
        pmDisconnectCleanupRef.current = null;
      }
      if (pmDeviceRef.current && pmDeviceRef.current.gatt?.connected) {
        pmDeviceRef.current.gatt.disconnect();
      }
    } catch (e) { console.warn('PM disconnect error:', e); }
    pmDeviceRef.current = null;
    isPmConnectedRef.current = false;
    setIsPmConnected(false);
    setPmDeviceName('');
    setPmBatteryLevel(null);
    setPmPower(0);
    setHalfPowerDetected(false);
    halfPowerCounterRef.current = 0;
    setPowerMatchEnabled(false);
    pidController.reset();

    try {
      if (zwiftClickRef.current) {
        zwiftClickRef.current.disconnect();
      }
    } catch (e) { console.warn('Zwift Click disconnect error:', e); }
    if (resHoldTimerRef.current) clearTimeout(resHoldTimerRef.current);
    if (resHoldIntervalRef.current) clearInterval(resHoldIntervalRef.current);
    if (ergHoldTimerRef.current) clearTimeout(ergHoldTimerRef.current);
    if (shiftToastTimerRef.current) clearTimeout(shiftToastTimerRef.current);

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
    setVirtualGear(VIRTUAL_GEAR_DEFAULT);
    setControlMode('ERG');
    setLiveMetrics({ np: 0, ifFactor: "0.00", tss: 0, workKj: 0 });
    setFullscreenBleModal(null);
    setBleErrorBanner(null);
    exitingFsForBleRef.current = false;
    if (isBrowserFullscreenActive() && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

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
    if (!isPlaying && displayPower === 0) return "text-zinc-600";
    const diff = Math.abs(displayPower - activeTargetPower);
    if (diff <= 8) return "text-volt-400 drop-shadow-[0_0_18px_rgba(var(--accent-400),0.32)]";
    if (diff <= 22) return "text-amber-400 drop-shadow-[0_0_14px_rgba(251,191,36,0.28)]";
    return "text-rose-500 drop-shadow-[0_0_14px_rgba(244,63,94,0.32)]";
  };

  const getZoneTextColor = (pwr) => {
    if (pwr < 55) return 'text-zinc-400';
    if (pwr < 76) return 'text-sky-400';
    if (pwr < 88) return 'text-emerald-400';
    if (pwr < 95) return 'text-volt-400';
    if (pwr < 106) return 'text-amber-400';
    if (pwr < 121) return 'text-rose-400';
    return 'text-purple-400';
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
    const devLabel = device?.name || 'Pulsmetar';
    hrDeviceRef.current = device;
    device.addEventListener('gattserverdisconnected', () => {
      if (hrDeviceRef.current === device) {
        setIsHrConnected(false);
        setCurrentHR(0);
        logBleEvent('warn', 'HR', 'Pulsmetar odspojen', devLabel);
      }
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const char = await service.getCharacteristic('heart_rate_measurement');
    await char.startNotifications();
    setIsHrConnected(true);
    logBleEvent('ok', 'HR', 'Pulsmetar spojen (0x180D)', devLabel);
    char.addEventListener('characteristicvaluechanged', (e) => {
      const val = e.target.value;
      const flags = val.getUint8(0);
      setCurrentHR(flags & 0x1 ? val.getUint16(1, true) : val.getUint8(1));
    });
  };

  const setupTrainerDevice = async (device) => {
    const devLabel = device?.name || 'Trenažer';
    trainerDeviceRef.current = device;
    setTrainerDeviceName(devLabel);
    setFtmsStatus('connecting');
    crankDataRef.current = { revs: -1, time: -1 };

    device.addEventListener('gattserverdisconnected', () => {
      if (trainerDeviceRef.current === device) {
        setIsPowerConnected(false);
        setCurrentPower(0);
        setFtmsControlChar(null);
        setFtmsStatus('idle');
        if (!isPmConnectedRef.current) setCurrentCadence(0);
        logBleEvent('warn', 'TRAINER', 'Trenažer odspojen (gattserverdisconnected)', devLabel);
      }
    });

    logBleEvent('info', 'TRAINER', 'GATT spajanje na trenažer', devLabel);
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

      // Očitaj stvarni hardverski raspon kočnice (0x2AD6 Supported Resistance Level Range) za precizne virtualne brzine
      ftmsResRangeRef.current = { rawMin: 0, rawMax: 100, rawInc: 1, hasRangeChar: false };
      ftmsResFormatRef.current = 'uint8';
      resFormatFlippedRef.current = false;
      try {
        const rangeChar = await ftmsService.getCharacteristic(FTMS_SUPPORTED_RESISTANCE_RANGE_UUID);
        const rangeVal = await rangeChar.readValue();
        if (rangeVal && rangeVal.byteLength >= 6) {
          const rawMin = rangeVal.getInt16(0, true);
          const rawMax = rangeVal.getInt16(2, true);
          const rawInc = rangeVal.getUint16(4, true) || 1;
          if (rawMax > rawMin) {
            ftmsResRangeRef.current = { rawMin, rawMax, rawInc, hasRangeChar: true };
            ftmsResFormatRef.current = rawMax > 255 ? 'sint16' : 'uint8';
            console.log('[FTMS] Podržani raspon otpora (0x2AD6):', {
              rawMin,
              rawMax,
              rawInc,
              initialFormat: ftmsResFormatRef.current
            });
          }
        }
      } catch (rangeErr) {
        console.info('[FTMS] 0x2AD6 Supported Resistance Range nije dostupan (koristim 0-100):', rangeErr);
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
            setTimeout(() => {
              if (dispatchErgTargetRef.current) dispatchErgTargetRef.current(false);
              if (dispatchResTargetRef.current) dispatchResTargetRef.current();
            }, 250);
          } else if (reqOp === 0x04 && result === 0x03) {
            // Invalid Parameter za Set Target Resistance (razlika uint8 vs sint16 među FTMS firmwareima)
            if (!resFormatFlippedRef.current) {
              resFormatFlippedRef.current = true;
              ftmsResFormatRef.current = ftmsResFormatRef.current === 'uint8' ? 'sint16' : 'uint8';
              console.warn(`[FTMS] 0x04 otpor vratio 0x03; prebacujem format na ${ftmsResFormatRef.current} i ponavljam...`);
              if (dispatchResTargetRef.current) dispatchResTargetRef.current();
            } else {
              console.warn('[FTMS] 0x04 odbijen u oba formata; automatski prebacujem na 0x11 SIM nagib.');
              setResPhysicsMode('SIM');
            }
          } else if (reqOp === 0x04 && result === 0x02) {
            console.warn('[FTMS] 0x04 nije podržan na ovom trenažeru; automatski prebacujem na 0x11 SIM nagib.');
            setResPhysicsMode('SIM');
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
      logBleEvent('ok', 'TRAINER', 'FTMS kontrola (0x00) i Start (0x07) uspješno preuzeti', devLabel);
    } catch (ftmsErr) {
      logBleEvent('warn', 'TRAINER', 'FTMS kontrola otpora nije dostupna', ftmsErr);
      if (hasCpsPower) {
        setIsPowerConnected(true);
        setFtmsStatus('unsupported');
      } else {
        setFtmsStatus('error');
        throw new Error('Odabrani uređaj ne podržava ni FTMS ni Cycling Power.');
      }
    }
  };

  const connectPmGattAndSubscribe = async (device, maxAttempts = 3) => {
    const devLabel = device?.name || device?.id || 'PowerMeter';
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logBleEvent('info', 'PM', `GATT spajanje (${attempt}/${maxAttempts})`, devLabel);
        if (attempt > 1) {
          try {
            if (device.gatt?.connected) device.gatt.disconnect();
          } catch {
            // ignore
          }
          await sleepMs(400 * attempt);
        }

        const server = await device.gatt.connect();
        // Stabilizacijska pauza za Windows WinRT BLE GATT cache (posebno dok su trenažer/HR/Click već spojeni)
        await sleepMs(350);

        let powerService = null;
        try {
          powerService = await server.getPrimaryService('cycling_power');
        } catch (svcErr1) {
          logBleEvent('warn', 'PM', 'Alias cycling_power nije odmah pronađen, tražim puni 0x1818 UUID', svcErr1);
          try {
            powerService = await server.getPrimaryService(CYCLING_POWER_SERVICE_UUID);
          } catch (svcErr2) {
            if (attempt >= 2 && /No Services matching|NotFoundError/i.test(`${svcErr2?.name} ${svcErr2?.message}`)) {
              throw new Error(
                `Odabrani uređaj (${devLabel}) ne emitira Cycling Power servis (0x1818). Provjeri jesi li odabrao Assioma pedalu i da Favero aplikacija na mobitelu nije spojena na nju.`
              );
            }
            throw svcErr2;
          }
        }

        let powerChar = null;
        try {
          powerChar = await powerService.getCharacteristic('cycling_power_measurement');
        } catch {
          powerChar = await powerService.getCharacteristic(CYCLING_POWER_MEASUREMENT_UUID);
        }

        await sleepMs(120);
        await powerChar.startNotifications();

        if (pmCharCleanupRef.current) {
          try { pmCharCleanupRef.current(); } catch { /* ignore */ }
          pmCharCleanupRef.current = null;
        }

        const onPmValueChanged = (e) => {
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
        };
        powerChar.addEventListener('characteristicvaluechanged', onPmValueChanged);
        pmCharCleanupRef.current = () => {
          try { powerChar.removeEventListener('characteristicvaluechanged', onPmValueChanged); } catch { /* ignore */ }
        };

        // Sekvencijalno čitanje razine baterije pedale (0x180F -> 0x2A19) bez paralelnih GATT sudara
        try {
          let battSvc = null;
          try {
            battSvc = await server.getPrimaryService('battery_service');
          } catch {
            battSvc = await server.getPrimaryService(BATTERY_SERVICE_UUID);
          }
          let battChar = null;
          try {
            battChar = await battSvc.getCharacteristic('battery_level');
          } catch {
            battChar = await battSvc.getCharacteristic(BATTERY_LEVEL_UUID);
          }
          const battVal = await battChar.readValue();
          if (battVal && battVal.byteLength >= 1) {
            const pct = battVal.getUint8(0);
            if (pct >= 0 && pct <= 100) {
              setPmBatteryLevel(pct);
              logBleEvent('info', 'PM', `Baterija pedale: ${pct}%`, devLabel);
            }
          }
        } catch {
          // Baterija nije obvezna — ignoriraj ako nije dostupna
        }

        return true;
      } catch (err) {
        lastError = err;
        logBleEvent('warn', 'PM', `GATT pokušaj ${attempt}/${maxAttempts} neuspješan`, err);
      }
    }

    throw lastError || new Error('GATT spajanje na PowerMeter nije uspjelo.');
  };

  const setupPmDevice = async (device) => {
    const devLabel = device?.name || 'PowerMeter';
    pmIntentionalDisconnectRef.current = false;
    pmReconnectingRef.current = false;

    if (pmDisconnectCleanupRef.current) {
      try { pmDisconnectCleanupRef.current(); } catch { /* ignore */ }
      pmDisconnectCleanupRef.current = null;
    }

    pmDeviceRef.current = device;
    setPmDeviceName(devLabel);
    setPmBatteryLevel(null);
    pmCrankDataRef.current = { revs: -1, time: -1 };
    pmLiveBufferRef.current = [];
    halfPowerCounterRef.current = 0;
    setHalfPowerDetected(false);

    const onPmDisconnected = async () => {
      if (pmDeviceRef.current !== device) return;
      isPmConnectedRef.current = false;
      setIsPmConnected(false);
      setPmPower(0);
      setHalfPowerDetected(false);
      pidController.reset();

      if (pmIntentionalDisconnectRef.current) {
        logBleEvent('info', 'PM', 'PowerMeter ručno odspojen', devLabel);
        return;
      }

      logBleEvent('warn', 'PM', 'Prekid BLE veze s pedalom — pokrećem auto-reconnect', devLabel);
      if (pmReconnectingRef.current) return;
      pmReconnectingRef.current = true;

      try {
        for (let r = 1; r <= 4; r++) {
          await sleepMs(1500);
          if (pmIntentionalDisconnectRef.current || pmDeviceRef.current !== device) return;
          try {
            await connectPmGattAndSubscribe(device, 1);
            isPmConnectedRef.current = true;
            setIsPmConnected(true);
            pidController.reset();
            logBleEvent('ok', 'PM', `Auto-reconnect uspio (pokušaj ${r}/4)`, devLabel);
            showHudToast('PowerMeter ponovno spojen!', devLabel, 'emerald');
            return;
          } catch (reErr) {
            logBleEvent('warn', 'PM', `Auto-reconnect ${r}/4 nije uspio`, reErr);
          }
        }
        logBleEvent('error', 'PM', 'Auto-reconnect odustao nakon 4 pokušaja', devLabel);
        showHudToast('PowerMeter odspojen', 'Klikni PowerMeter za ponovno spajanje', 'amber');
      } finally {
        pmReconnectingRef.current = false;
      }
    };

    device.addEventListener('gattserverdisconnected', onPmDisconnected);
    pmDisconnectCleanupRef.current = () => {
      try { device.removeEventListener('gattserverdisconnected', onPmDisconnected); } catch { /* ignore */ }
    };

    try {
      await connectPmGattAndSubscribe(device, 3);
      isPmConnectedRef.current = true;
      setIsPmConnected(true);
      setPowerMatchEnabled(true);
      pidController.reset();
      logBleEvent('ok', 'PM', 'PowerMeter uspješno spojen (0x1818 Cycling Power + Power Match ON)', devLabel);
    } catch (err) {
      pmIntentionalDisconnectRef.current = true;
      if (pmDisconnectCleanupRef.current) {
        pmDisconnectCleanupRef.current();
        pmDisconnectCleanupRef.current = null;
      }
      pmDeviceRef.current = null;
      isPmConnectedRef.current = false;
      setIsPmConnected(false);
      setPmDeviceName('');
      setPmBatteryLevel(null);
      logBleEvent('error', 'PM', 'Inicijalno spajanje PowerMetra nije uspjelo', err);
      throw err;
    }
  };


  const connectHRDirect = async () => {
    if (bleConnectingRef.current) {
      showHudToast('Bluetooth zauzet', 'Pričekaj završetak trenutnog traženja', 'amber');
      return;
    }
    if (!navigator.bluetooth) {
      logBleEvent('error', 'HR', 'Web Bluetooth nije podržan u pregledniku');
      setBleErrorBanner('Tvoj preglednik ne podržava Web Bluetooth (koristi Google Chrome ili Microsoft Edge).');
      return;
    }
    try {
      const reqPromise = navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      bleConnectingRef.current = 'hr';
      setBleConnectingType('hr');
      setBleErrorBanner(null);
      logBleEvent('info', 'HR', 'Otvoren Bluetooth izbornik (filter: heart_rate)');

      const device = await reqPromise;
      logBleEvent('info', 'HR', 'Korisnik odabrao uređaj', device.name || device.id || 'bez imena');
      await setupHRDevice(device);
      showHudToast('Pulsmetar spojen!', device.name || 'Heart Rate', 'emerald');
      setFullscreenBleModal(prev => (prev ? { ...prev, lastConnectedLabel: device.name || 'Pulsmetar' } : null));
    } catch (err) {
      if (isUserCancelledBle(err)) {
        logBleEvent('info', 'HR', 'Korisnik zatvorio Bluetooth izbornik bez odabira');
      } else {
        logBleEvent('error', 'HR', 'Greška pri spajanju pulsmetra', err);
      }
      const msg = formatBleErrorMessage(err, 'Pulsmetar');
      if (msg) setBleErrorBanner(msg);
    } finally {
      bleConnectingRef.current = null;
      setBleConnectingType(null);
    }
  };

  const connectHR = () => {
    if (isHrConnected) {
      if (hrDeviceRef.current && hrDeviceRef.current.gatt?.connected) {
        hrDeviceRef.current.gatt.disconnect();
      }
      setIsHrConnected(false);
      setCurrentHR(0);
      hrDeviceRef.current = null;
      return;
    }
    if (isBrowserFullscreenActive()) {
      openFullscreenBleHandoff('hr');
      return;
    }
    connectHRDirect();
  };

  const connectTrainerDirect = async () => {
    if (bleConnectingRef.current) {
      showHudToast('Bluetooth zauzet', 'Pričekaj završetak trenutnog traženja', 'amber');
      return;
    }
    if (!navigator.bluetooth) {
      logBleEvent('error', 'TRAINER', 'Web Bluetooth nije podržan u pregledniku');
      setBleErrorBanner('Tvoj preglednik ne podržava Web Bluetooth (koristi Google Chrome ili Microsoft Edge).');
      return;
    }
    try {
      const reqPromise = navigator.bluetooth.requestDevice({
        filters: [
          { services: [FTMS_SERVICE_UUID] },
          { services: ['cycling_power'] }
        ],
        optionalServices: ['cycling_power', CYCLING_POWER_SERVICE_UUID, FTMS_SERVICE_UUID]
      });
      bleConnectingRef.current = 'trainer';
      setBleConnectingType('trainer');
      setBleErrorBanner(null);
      logBleEvent('info', 'TRAINER', 'Otvoren Bluetooth izbornik (FTMS + Cycling Power)');

      const device = await reqPromise;
      logBleEvent('info', 'TRAINER', 'Korisnik odabrao trenažer', device.name || device.id || 'bez imena');
      await setupTrainerDevice(device);
      showHudToast('Trenažer spojen!', device.name || 'FTMS Trenažer', 'emerald');
      setFullscreenBleModal(prev => (prev ? { ...prev, lastConnectedLabel: device.name || 'FTMS Trenažer' } : null));
    } catch (err) {
      setFtmsStatus('idle');
      if (isUserCancelledBle(err)) {
        logBleEvent('info', 'TRAINER', 'Korisnik zatvorio Bluetooth izbornik bez odabira');
      } else {
        logBleEvent('error', 'TRAINER', 'Greška pri spajanju trenažera', err);
      }
      const msg = formatBleErrorMessage(err, 'FTMS Trenažer');
      if (msg) setBleErrorBanner(msg);
    } finally {
      bleConnectingRef.current = null;
      setBleConnectingType(null);
    }
  };

  const connectTrainer = () => {
    if (isPowerConnected) {
      if (trainerDeviceRef.current && trainerDeviceRef.current.gatt?.connected) {
        trainerDeviceRef.current.gatt.disconnect();
      }
      setIsPowerConnected(false);
      setTrainerDeviceName('');
      setCurrentPower(0);
      setCurrentCadence(prevCadence => (isPmConnected ? prevCadence : 0));
      trainerDeviceRef.current = null;
      setFtmsControlChar(null);
      setFtmsStatus('idle');
      return;
    }
    if (isBrowserFullscreenActive()) {
      openFullscreenBleHandoff('trainer');
      return;
    }
    connectTrainerDirect();
  };

  const connectPowerMeterDirect = async (acceptAll = false) => {
    if (bleConnectingRef.current) {
      showHudToast('Bluetooth zauzet', 'Pričekaj završetak trenutnog traženja', 'amber');
      return;
    }
    if (!navigator.bluetooth) {
      logBleEvent('error', 'PM', 'Web Bluetooth nije podržan u pregledniku');
      setBleErrorBanner('Tvoj preglednik ne podržava Web Bluetooth (koristi Google Chrome ili Microsoft Edge).');
      return;
    }
    try {
      // VAŽNO: requestDevice MORA biti prvi poziv unutar klika radi očuvanja Chrome User Activation geste!
      const reqOptions = acceptAll === true
        ? { acceptAllDevices: true, optionalServices: PM_OPTIONAL_SERVICES }
        : { filters: PM_DEVICE_FILTERS, optionalServices: PM_OPTIONAL_SERVICES };

      const reqPromise = navigator.bluetooth.requestDevice(reqOptions);
      bleConnectingRef.current = 'pm';
      setBleConnectingType('pm');
      setBleErrorBanner(null);
      logBleEvent(
        'info',
        'PM',
        acceptAll === true
          ? 'Otvoren Bluetooth izbornik (SVI BLE UREĐAJI - Assioma Fallback)'
          : 'Otvoren Bluetooth izbornik (0x1818 + Favero UUID + Assioma/PM prefiksi)',
        `Aktivni senzori: Trenažer=${isPowerConnected ? 'DA' : 'NE'}, HR=${isHrConnected ? 'DA' : 'NE'}, Click=${zwiftClickState.connected ? 'DA' : 'NE'}`
      );

      const device = await reqPromise;
      logBleEvent('info', 'PM', 'Korisnik odabrao PowerMeter u izborniku', `${device.name || '(bez imena)'} [id=${device.id || '?'}]`);
      await setupPmDevice(device);
      showHudToast('PowerMeter spojen!', device.name || 'PowerMeter', 'emerald');
      setFullscreenBleModal(prev => (prev ? { ...prev, lastConnectedLabel: device.name || 'PowerMeter' } : null));
    } catch (err) {
      if (isUserCancelledBle(err)) {
        logBleEvent(
          'warn',
          'PM',
          acceptAll === true
            ? 'Izbornik (Svi BLE uređaji) zatvoren bez odabira — pedala možda spava ili je spojena na mobitel/Windows'
            : 'Izbornik zatvoren bez odabira — probaj gumb "Svi BLE uređaji (Assioma)" ili provjeri je li pedala spojena na mobitel'
        );
      } else {
        logBleEvent('error', 'PM', 'Greška pri spajanju PowerMetra', err);
      }
      const msg = formatBleErrorMessage(err, 'PowerMeter');
      if (msg) setBleErrorBanner(msg);
    } finally {
      bleConnectingRef.current = null;
      setBleConnectingType(null);
    }
  };

  const connectPowerMeter = () => {
    if (isPmConnected) {
      pmIntentionalDisconnectRef.current = true;
      pmReconnectingRef.current = false;
      if (pmCharCleanupRef.current) {
        try { pmCharCleanupRef.current(); } catch { /* ignore */ }
        pmCharCleanupRef.current = null;
      }
      if (pmDisconnectCleanupRef.current) {
        try { pmDisconnectCleanupRef.current(); } catch { /* ignore */ }
        pmDisconnectCleanupRef.current = null;
      }
      if (pmDeviceRef.current && pmDeviceRef.current.gatt?.connected) {
        pmDeviceRef.current.gatt.disconnect();
      }
      logBleEvent('info', 'PM', 'Korisnik ručno odspojio PowerMeter', pmDeviceName || 'PowerMeter');
      isPmConnectedRef.current = false;
      setIsPmConnected(false);
      setPmDeviceName('');
      setPmBatteryLevel(null);
      setPmPower(0);
      setHalfPowerDetected(false);
      halfPowerCounterRef.current = 0;
      setPowerMatchEnabled(false);
      pidController.reset();
      pmDeviceRef.current = null;
      pmLiveBufferRef.current = [];
      return;
    }
    if (isBrowserFullscreenActive()) {
      openFullscreenBleHandoff('pm');
      return;
    }
    connectPowerMeterDirect(false);
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

  useEffect(() => {
    dispatchErgTargetRef.current = dispatchErgTarget;
  }, [dispatchErgTarget]);

  // Trenutno slanje nove ERG snage čim se promijeni interval, intenzitet, mod (RES->ERG), P.Match ON/OFF ili ×2 prekidač!
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'ERG') return;
    dispatchErgTarget(true);
  }, [activeTargetPower, controlMode, ftmsControlChar, powerMatchEnabled, pmDoublePower, halfPowerDetected, dispatchErgTarget]);

  // Periodičko osvježavanje ERG cilja (svake 2s uz Power Match, inače svake 4s za stabilan FTMS lock)
  // Pauzira se dok traje BLE spajanje / GATT otkrivanje servisa na drugom senzoru kako Windows BLE adapter ne bi imao koliziju paketa!
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'ERG') return;
    const intervalMs = (powerMatchEnabled && isPmConnected) ? 2000 : 4000;
    const timer = setInterval(() => {
      if (bleConnectingRef.current || pmReconnectingRef.current) return;
      dispatchErgTarget(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [ftmsControlChar, controlMode, powerMatchEnabled, isPmConnected, dispatchErgTarget]);

  // --- VIRTUAL SHIFTING & RESISTANCE / SIM FTMS SLANJE ---
  const resParamsRef = useRef({
    ftmsControlChar,
    controlMode,
    virtualGear,
    resistanceLevel,
    simulatedGrade,
    resPhysicsMode
  });

  useEffect(() => {
    resParamsRef.current = {
      ftmsControlChar,
      controlMode,
      virtualGear,
      resistanceLevel,
      simulatedGrade,
      resPhysicsMode
    };
  }, [ftmsControlChar, controlMode, virtualGear, resistanceLevel, simulatedGrade, resPhysicsMode]);

  const dispatchResTarget = useCallback(() => {
    const p = resParamsRef.current;
    if (!p.ftmsControlChar || p.controlMode !== 'RES') return;

    if (p.resPhysicsMode === 'SIM') {
      // FTMS 0x11: Set Indoor Bike Simulation Parameters (Wind=0, Grade=0.01% units, Crr=0.0040, Cw=0.51)
      const buf = new ArrayBuffer(7);
      const view = new DataView(buf);
      view.setUint8(0, 0x11);
      view.setInt16(1, 0, true); // wind speed 0 m/s
      view.setInt16(3, Math.round(p.simulatedGrade * 100), true); // grade u 0.01% koracima
      view.setUint8(5, 40); // Crr = 0.0040
      view.setUint8(6, 51); // Cw = 0.51 kg/m
      enqueueFtmsWrite(p.ftmsControlChar, new Uint8Array(buf));
      return;
    }

    // FTMS 0x04: Set Target Resistance Level (skalirano na hardverski 0x2AD6 raspon trenažera, npr. Elite Direto)
    const range = ftmsResRangeRef.current;
    const pct = p.resistanceLevel; // 5..97%
    let rawTarget = pct;

    if (range.hasRangeChar && range.rawMax > range.rawMin) {
      const inc = range.rawInc || 1;
      const mapped = range.rawMin + (pct / 100) * (range.rawMax - range.rawMin);
      rawTarget = Math.round(mapped / inc) * inc;
      rawTarget = Math.max(range.rawMin, Math.min(range.rawMax, rawTarget));
    } else if (ftmsResFormatRef.current === 'sint16') {
      rawTarget = Math.round(pct * 10);
    }

    if (ftmsResFormatRef.current === 'sint16') {
      const buf = new ArrayBuffer(3);
      const view = new DataView(buf);
      view.setUint8(0, 0x04);
      view.setInt16(1, rawTarget, true);
      enqueueFtmsWrite(p.ftmsControlChar, new Uint8Array(buf));
    } else {
      // uint8 format: ako je rawMax > 255 a format je prisilno uint8, skaliraj sa 0.1 na 0..100
      const byteVal = rawTarget > 255 ? Math.round(rawTarget / 10) : rawTarget;
      const clampedByte = Math.max(0, Math.min(255, Math.round(byteVal)));
      enqueueFtmsWrite(p.ftmsControlChar, new Uint8Array([0x04, clampedByte]));
    }
  }, [enqueueFtmsWrite]);

  useEffect(() => {
    dispatchResTargetRef.current = dispatchResTarget;
  }, [dispatchResTarget]);

  // Trenutno slanje nove brzine / otpora u RES modu
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'RES') return;
    dispatchResTarget();
  }, [virtualGear, resistanceLevel, simulatedGrade, resPhysicsMode, controlMode, ftmsControlChar, dispatchResTarget]);

  // Lagano osvježavanje otpora u RES modu svake 5s kako kočnica ne bi zaspala u pauzi pedaliranja
  useEffect(() => {
    if (!ftmsControlChar || controlMode !== 'RES') return;
    const timer = setInterval(() => {
      if (bleConnectingRef.current || pmReconnectingRef.current) return;
      dispatchResTarget();
    }, 5000);
    return () => clearInterval(timer);
  }, [ftmsControlChar, controlMode, dispatchResTarget]);

  const shiftVirtualGear = useCallback((delta, source = '') => {
    setVirtualGear(prev => {
      const next = Math.max(VIRTUAL_GEAR_MIN, Math.min(VIRTUAL_GEAR_MAX, prev + delta));
      if (next !== prev) {
        playShiftSound(delta > 0 ? 'up' : 'down');
        try {
          localStorage.setItem('ergvibe_virtual_gear', String(next));
        } catch {
          // ignore
        }
      }
      const nextPct = gearToResistancePercent(next);
      const nextGrade = gearToSimulatedGrade(next);
      const modeDetail = resParamsRef.current.resPhysicsMode === 'SIM'
        ? `Nagib ${nextGrade > 0 ? '+' : ''}${nextGrade.toFixed(1)}%`
        : `Otpor ${nextPct}%`;
      showHudToast(
        `Brzina ${next} / ${VIRTUAL_GEAR_MAX}`,
        `${source ? `${source} · ` : ''}${modeDetail}`,
        'indigo'
      );
      return next;
    });
  }, [showHudToast]);

  const toggleResPhysicsMode = useCallback(() => {
    setResPhysicsMode(prev => {
      const next = prev === 'RES' ? 'SIM' : 'RES';
      try {
        localStorage.setItem('ergvibe_res_physics_mode', next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const connectZwiftClickDirect = async () => {
    const controller = zwiftClickRef.current;
    if (!controller) return;
    if (bleConnectingRef.current) {
      showHudToast('Bluetooth zauzet', 'Pričekaj završetak trenutnog traženja', 'amber');
      return;
    }
    if (!navigator.bluetooth) {
      setBleErrorBanner('Tvoj preglednik ne podržava Web Bluetooth (koristi Google Chrome ili Microsoft Edge).');
      return;
    }
    try {
      const connectPromise = controller.requestAndConnect();
      bleConnectingRef.current = 'click';
      setBleConnectingType('click');
      setBleErrorBanner(null);
      logBleEvent('info', 'CLICK', 'Otvoren Bluetooth izbornik za Zwift Click');

      const snap = await connectPromise;
      logBleEvent('ok', 'CLICK', 'Zwift Click spojen', snap?.deviceName || 'Zwift Click');
      showHudToast('Zwift Click spojen!', 'Spremno za virtualne brzine i ERG kontrolu', 'emerald');
      setFullscreenBleModal(prev => (prev ? { ...prev, lastConnectedLabel: snap?.deviceName || 'Zwift Click' } : null));
    } catch (err) {
      if (isUserCancelledBle(err)) {
        logBleEvent('info', 'CLICK', 'Korisnik zatvorio Zwift Click izbornik bez odabira');
      } else {
        logBleEvent('error', 'CLICK', 'Greška pri spajanju Zwift Clicka', err);
      }
      const msg = formatBleErrorMessage(err, 'Zwift Click');
      if (msg) setBleErrorBanner(msg);
    } finally {
      bleConnectingRef.current = null;
      setBleConnectingType(null);
    }
  };

  const connectZwiftClick = () => {
    const controller = zwiftClickRef.current;
    if (!controller) return;
    if (controller.connected) {
      controller.disconnect();
      setShowClickSettings(false);
      return;
    }
    if (isBrowserFullscreenActive()) {
      openFullscreenBleHandoff('click');
      return;
    }
    connectZwiftClickDirect();
  };

  const triggerDirectBleByKey = (sensorKey) => {
    if (sensorKey === 'trainer') connectTrainerDirect();
    else if (sensorKey === 'pm') connectPowerMeterDirect(false);
    else if (sensorKey === 'pm_all') connectPowerMeterDirect(true);
    else if (sensorKey === 'hr') connectHRDirect();
    else if (sensorKey === 'click') connectZwiftClickDirect();
  };

  const toggleMode = () => setControlMode(prev => prev === 'ERG' ? 'RES' : 'ERG');
  const increaseErg = () => setErgIntensity(prev => prev + 2);
  const decreaseErg = () => setErgIntensity(prev => Math.max(50, prev - 2));
  const increaseRes = () => shiftVirtualGear(1);
  const decreaseRes = () => shiftVirtualGear(-1);

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

    // Eksplicitno pretvori stream u JSON format (+ priloži BLE dijagnostički log sesije u prvi zapis za sinkronizaciju s garažnog PC-a u Supabase)
    const sessionBleLog = getSessionBleLogs(startedAt.toISOString(), 80);
    const streamDataToSave = distResult.stream.length > 0
      ? distResult.stream.map((pt, idx) => (idx === 0 && sessionBleLog.length > 0 ? { ...pt, ble_log: sessionBleLog } : pt))
      : null;

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

  // --- ZWIFT CLICK POVEZIVANJE AKCIJA (RES 24 brzine + ERG kontrola) ---
  const clickActionRef = useRef({
    controlMode,
    showStopPrompt,
    isFinished,
    handleSkip,
    shiftVirtualGear,
    showHudToast
  });

  useEffect(() => {
    clickActionRef.current = {
      controlMode,
      showStopPrompt,
      isFinished,
      handleSkip,
      shiftVirtualGear,
      showHudToast
    };
  }, [controlMode, showStopPrompt, isFinished, handleSkip, shiftVirtualGear, showHudToast]);

  useEffect(() => {
    const controller = zwiftClickRef.current;
    if (!controller) return;

    const clearHoldTimers = () => {
      if (resHoldTimerRef.current) clearTimeout(resHoldTimerRef.current);
      if (resHoldIntervalRef.current) clearInterval(resHoldIntervalRef.current);
      if (ergHoldTimerRef.current) clearTimeout(ergHoldTimerRef.current);
      resHoldTimerRef.current = null;
      resHoldIntervalRef.current = null;
      ergHoldTimerRef.current = null;
    };

    controller.onStateChange = (snap) => {
      setZwiftClickState(snap);
    };

    controller.onButtonDown = (dir) => {
      const ctx = clickActionRef.current;
      if (ctx.showStopPrompt || ctx.isFinished) return;

      clearHoldTimers();

      if (ctx.controlMode === 'RES') {
        const delta = dir === 'up' ? 1 : -1;
        ctx.shiftVirtualGear(delta, 'Zwift Click');
        // Di2 / AXS Multi-Shift pri držanju tipke (>450ms, svake 220ms)
        resHoldTimerRef.current = setTimeout(() => {
          resHoldIntervalRef.current = setInterval(() => {
            clickActionRef.current.shiftVirtualGear(delta, 'Multi-Shift');
          }, 220);
        }, 450);
      } else {
        // ERG mod: dugi pritisak (850ms) = Preskoči interval (+) ili Play/Pause (-)
        ergLongPressFiredRef.current = false;
        ergHoldTimerRef.current = setTimeout(() => {
          ergLongPressFiredRef.current = true;
          const liveCtx = clickActionRef.current;
          if (dir === 'up') {
            playBeep(950, 0.12);
            setTimeout(() => playBeep(1280, 0.16), 130);
            liveCtx.handleSkip();
            liveCtx.showHudToast('Sljedeći interval', 'Zwift Click (dugi +)', 'emerald');
          } else {
            playBeep(720, 0.18);
            setIsPlaying(prev => {
              const next = !prev;
              liveCtx.showHudToast(
                next ? 'Trening pokrenut' : 'Trening pauziran',
                'Zwift Click (dugi -)',
                next ? 'emerald' : 'amber'
              );
              return next;
            });
          }
        }, 850);
      }
    };

    controller.onButtonUp = (dir) => {
      const ctx = clickActionRef.current;
      const wasLongPress = ergLongPressFiredRef.current;
      clearHoldTimers();

      if (ctx.showStopPrompt || ctx.isFinished) return;

      if (ctx.controlMode === 'ERG' && !wasLongPress) {
        if (dir === 'up') {
          playShiftSound('up');
          setErgIntensity(prev => {
            const next = prev + 2;
            ctx.showHudToast(`ERG Intenzitet: ${next}%`, 'Zwift Click (+2%)', 'cyan');
            return next;
          });
        } else {
          playShiftSound('down');
          setErgIntensity(prev => {
            const next = Math.max(50, prev - 2);
            ctx.showHudToast(`ERG Intenzitet: ${next}%`, 'Zwift Click (-2%)', 'cyan');
            return next;
          });
        }
      }
    };

    return () => {
      clearHoldTimers();
    };
  }, []);

  const [isBrowserFs, setIsBrowserFs] = useState(() => isBrowserFullscreenActive());
  const [isCockpitMode, setIsCockpitMode] = useState(false);
  const isFullscreen = isBrowserFs || isCockpitMode;

  useEffect(() => {
    if (onFullscreenChange) onFullscreenChange(isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

  useEffect(() => {
    const onFsChange = () => {
      const active = isBrowserFullscreenActive();
      setIsBrowserFs(active);
      if (!active && !exitingFsForBleRef.current) {
        setIsCockpitMode(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const enterBrowserFullscreen = useCallback(async () => {
    setIsCockpitMode(true);
    try {
      const root = document.documentElement;
      if (!isBrowserFullscreenActive()) {
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
          await root.webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('[Fullscreen] Browser fullscreen odbijen, aktivan Cockpit fokus prikaz:', err);
      showHudToast('Cockpit fokus aktivan', 'Za skrivanje trake preglednika pritisni F11', 'amber');
    }
  }, [showHudToast]);

  const exitAllFullscreen = useCallback(async () => {
    exitingFsForBleRef.current = false;
    setIsCockpitMode(false);
    try {
      if (isBrowserFullscreenActive()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('[Fullscreen] Greška pri izlasku iz punog zaslona:', err);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isBrowserFullscreenActive() || isCockpitMode) {
      exitAllFullscreen();
    } else {
      enterBrowserFullscreen();
    }
  }, [isCockpitMode, enterBrowserFullscreen, exitAllFullscreen]);

  const returnToFullscreenFromModal = () => {
    setFullscreenBleModal(null);
    setBleErrorBanner(null);
    enterBrowserFullscreen();
  };

  const closeFullscreenBleModal = () => {
    setFullscreenBleModal(null);
    setIsCockpitMode(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow default behavior inside text inputs or textareas
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }

      if (fullscreenBleModal) {
        if (e.code === 'Escape') {
          e.preventDefault();
          setFullscreenBleModal(null);
          setIsCockpitMode(false);
        }
        return;
      }

      if (showBleLogModal) {
        if (e.code === 'Escape') {
          e.preventDefault();
          setShowBleLogModal(false);
        }
        return;
      }

      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (showStopPrompt || isFinished) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.code === 'ArrowUp' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        if (controlMode === 'ERG') {
          playShiftSound('up');
          setErgIntensity(p => p + 2);
        } else {
          shiftVirtualGear(1, 'Tipkovnica');
        }
      } else if (e.code === 'ArrowDown' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        if (controlMode === 'ERG') {
          playShiftSound('down');
          setErgIntensity(p => Math.max(50, p - 2));
        } else {
          shiftVirtualGear(-1, 'Tipkovnica');
        }
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        setControlMode(prev => prev === 'ERG' ? 'RES' : 'ERG');
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenBleModal, showBleLogModal, showStopPrompt, isFinished, controlMode, handleSkip, shiftVirtualGear, toggleFullscreen]);

  const hasRecentBleError = useMemo(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return bleLogs.some(l => l.level === 'error' && new Date(l.ts).getTime() >= cutoff);
  }, [bleLogs]);

  const handleCopyBleLogs = async () => {
    try {
      await navigator.clipboard.writeText(formatBleLogsAsText(bleLogs));
      setBleLogCopied(true);
      setTimeout(() => setBleLogCopied(false), 2000);
    } catch {
      showHudToast('Kopiranje nije uspjelo', 'Označi tekst ručno', 'amber');
    }
  };

  const openBleDiagnosticModal = () => {
    if (isBrowserFullscreenActive()) {
      try {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch {
        // ignore
      }
    }
    setShowBleLogModal(true);
  };

  const sensorMetaMap = {
    trainer: { label: 'FTMS Trenažer', connected: isPowerConnected, detail: trainerDeviceName || 'Trenažer' },
    pm: { label: 'PowerMeter', connected: isPmConnected, detail: pmDeviceName || 'PowerMeter' },
    hr: { label: 'Pulsmetar', connected: isHrConnected, detail: 'Pulsmetar' },
    click: { label: 'Zwift Click', connected: zwiftClickState.connected, detail: zwiftClickState.deviceName || 'Zwift Click' }
  };

  return (
    <div className="w-full max-w-[1800px] mx-auto flex flex-col flex-1 md:h-full gap-1.5 md:gap-2 xl:gap-2.5 short:gap-1.5 vshort:gap-1 animate-in fade-in relative px-1 md:px-2 min-h-0">

      {/* MODAL ZA SIGURNO BLUETOOTH UPARIVANJE IZ PUNOG ZASLONA (izbjegava Chromium ChooserBubbleUi bug) */}
      {fullscreenBleModal && (
        <div className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-150">
          <div className="carbon-panel border-volt-400/40 rounded-2xl p-5 md:p-6 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-volt-400/15 border border-volt-400/35 text-volt-400 shrink-0">
                  <Bluetooth className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-volt-400">
                    BLUETOOTH UPARIVANJE
                  </div>
                  <h3 className="font-display font-bold text-lg md:text-xl uppercase tracking-wide text-zinc-100">
                    {sensorMetaMap[fullscreenBleModal.target]?.label || 'Senzor'}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={closeFullscreenBleModal}
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800"
                title="Zatvori"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">
              Chrome i Edge sigurnosno ne dopuštaju otvaranje Bluetooth popisa dok je skrivena traka preglednika.
              Spoji željene senzore ispod i vrati se u <strong className="text-zinc-200">TV Puni zaslon</strong> jednim klikom.
            </p>

            {bleErrorBanner && (
              <div className="bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-xl px-3 py-2 text-xs font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{bleErrorBanner}</span>
              </div>
            )}

            {/* Brzi odabir svih 4 senzora na jednom mjestu prije povratka u Fullscreen */}
            <div className="grid grid-cols-2 gap-2">
              {(['trainer', 'pm', 'hr', 'click']).map((sKey) => {
                const info = sensorMetaMap[sKey];
                const isBusy = bleConnectingType === sKey;
                const isSelected = fullscreenBleModal.target === sKey;
                return (
                  <button
                    key={sKey}
                    type="button"
                    disabled={fsSettling || Boolean(bleConnectingType)}
                    onClick={() => {
                      if (!info.connected) {
                        triggerDirectBleByKey(sKey);
                      }
                      setFullscreenBleModal(prev => (prev ? { ...prev, target: sKey } : null));
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-left disabled:opacity-50 ${
                      info.connected
                        ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/35'
                        : isSelected
                        ? 'bg-volt-400/15 text-volt-300 border-volt-400/50 hover:bg-volt-400/25'
                        : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-200 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <span className="truncate">{info.connected ? info.detail : info.label}</span>
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-volt-400 shrink-0" />
                    ) : info.connected ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="font-mono text-[10px] uppercase text-volt-400 shrink-0">Traži</span>
                    )}
                  </button>
                );
              })}
            </div>

            {fullscreenBleModal.target === 'pm' && !isPmConnected && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-violet-950/30 border border-violet-500/30 rounded-xl px-3 py-2">
                <span className="text-[11px] text-zinc-300">
                  Assioma se ne prikazuje na popisu?
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={fsSettling || Boolean(bleConnectingType)}
                    onClick={() => triggerDirectBleByKey('pm_all')}
                    className="px-2.5 py-1 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-400/40 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Svi BLE uređaji (Assioma)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFullscreenBleModal(null);
                      setShowBleLogModal(true);
                    }}
                    className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    BLE Log
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              {!sensorMetaMap[fullscreenBleModal.target]?.connected ? (
                <button
                  type="button"
                  autoFocus
                  disabled={fsSettling || Boolean(bleConnectingType)}
                  onClick={() => triggerDirectBleByKey(fullscreenBleModal.target)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-volt-400 hover:bg-volt-300 disabled:opacity-60 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm transition-all shadow-volt-glow"
                >
                  {fsSettling || bleConnectingType ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{fsSettling ? 'Priprema...' : 'Spajanje...'}</span>
                    </>
                  ) : (
                    <>
                      <Bluetooth className="w-4 h-4" />
                      <span>Otvori Bluetooth popis ({sensorMetaMap[fullscreenBleModal.target]?.label})</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  autoFocus
                  onClick={returnToFullscreenFromModal}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-volt-400 hover:bg-volt-300 text-zinc-950 font-display font-bold uppercase tracking-wider text-sm transition-all shadow-volt-glow"
                >
                  <Maximize2 className="w-4 h-4" />
                  <span>Vrati u TV Puni zaslon</span>
                </button>
              )}

              {!sensorMetaMap[fullscreenBleModal.target]?.connected && (
                <button
                  type="button"
                  onClick={returnToFullscreenFromModal}
                  className="py-3 px-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border border-zinc-800 font-mono text-xs font-bold uppercase tracking-wider transition-colors shrink-0"
                >
                  Natrag u Fullscreen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BLE DIJAGNOSTIKA, LOGOVI I FAVERO ASSIOMA FALLBACK */}
      {showBleLogModal && (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-150">
          <div className="carbon-panel border-violet-400/40 rounded-2xl p-4 md:p-5 max-w-2xl w-full max-h-[90vh] shadow-2xl flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-300 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                    WEB BLUETOOTH CRNA KUTIJA
                  </div>
                  <h3 className="font-display font-bold text-base md:text-lg uppercase tracking-wide text-zinc-100">
                    BLE Dijagnostika &amp; Assioma Spajanje
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBleLogModal(false)}
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800"
                title="Zatvori (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Brze radnje: Svi BLE uređaji (Assioma Fallback) + Kopiraj + Očisti */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!isPmConnected && (
                <button
                  type="button"
                  disabled={Boolean(bleConnectingType)}
                  onClick={() => {
                    connectPowerMeterDirect(true);
                    setShowBleLogModal(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider transition-all"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Traži sve BLE uređaje (Assioma Fallback)</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyBleLogs}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <Copy className="w-3.5 h-3.5 text-volt-400" />
                <span>{bleLogCopied ? 'Kopirano!' : 'Kopiraj Log'}</span>
              </button>
              <button
                type="button"
                onClick={() => clearBleLogs()}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-rose-300 border border-zinc-800 font-mono text-xs font-bold uppercase tracking-wider transition-colors ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Očisti</span>
              </button>
            </div>

            {/* Kratki podsjetnik za Favero Assioma UNO / Windows u garaži */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-300 space-y-1.5 shrink-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                3 najčešća uzroka kad se Assioma UNO ne spaja na PC:
              </div>
              <p className="leading-relaxed">
                <strong className="text-zinc-100">1. Mobitel / Favero App / Garmin:</strong> Assioma UNO standardno prima samo <strong className="text-amber-300">1 aktivnu BLE vezu</strong>. Ako je ostala spojena na Favero aplikaciju na mobitelu ili Garmin, pedala prestaje emitirati BLE prema PC-u — privremeno isključi Bluetooth na mobitelu.
              </p>
              <p className="leading-relaxed">
                <strong className="text-zinc-100">2. Windows Bluetooth postavke:</strong> Pedala <strong className="text-rose-300">ne smije</strong> biti uparena izravno u <em>Windows Settings &rarr; Bluetooth &amp; devices</em> (ako tamo piše <em>Paired/Connected</em>, klikni <em>Remove device</em> i spajaj isključivo u Chromeu).
              </p>
              <p className="leading-relaxed">
                <strong className="text-zinc-100">3. Buđenje pedala:</strong> Zavrti kurblu 2 kruga da bljesnu narančaste LED diode neposredno prije klika na spajanje.
              </p>
            </div>

            {/* Live lista događaja (najnoviji na vrhu) */}
            <div className="flex-1 min-h-[160px] max-h-[280px] overflow-y-auto bg-black/70 border border-zinc-800 rounded-xl p-2.5 font-mono text-[11px] space-y-1">
              {bleLogs.length === 0 ? (
                <div className="text-zinc-500 py-8 text-center">
                  Još nema zabilježenih BLE događaja na ovom računalu.
                </div>
              ) : (
                [...bleLogs].reverse().map((entry, idx) => {
                  const tone =
                    entry.level === 'error'
                      ? 'text-rose-300 border-rose-500/30 bg-rose-950/25'
                      : entry.level === 'warn'
                      ? 'text-amber-300 border-amber-500/25 bg-amber-950/20'
                      : entry.level === 'ok'
                      ? 'text-emerald-300 border-emerald-500/25 bg-emerald-950/20'
                      : 'text-zinc-300 border-zinc-800/80 bg-zinc-900/40';
                  return (
                    <div key={`${entry.ts}-${idx}`} className={`px-2 py-1 rounded border ${tone} break-words`}>
                      <span className="text-zinc-500 mr-1.5">{entry.timeLocal || entry.ts}</span>
                      <span className="font-bold mr-1.5">[{entry.sensor}]</span>
                      <span>{entry.event}</span>
                      {entry.detail && <span className="text-zinc-400"> — {entry.detail}</span>}
                    </div>
                  );
                })
              )}
            </div>

            <div className="text-[10px] font-mono text-zinc-500 flex items-center justify-between shrink-0">
              <span>Ukupno zapisa: {bleLogs.length} (automatski se sinkronizira u Supabase uz spremljeni trening)</span>
            </div>
          </div>
        </div>
      )}

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

      {/* GORNJA TRAKA: Hardware Sensor Dock */}
      <div className="carbon-panel rounded-xl p-1.5 md:p-2 short:p-1 flex gap-1.5 md:gap-2 short:gap-1.5 flex-wrap md:flex-nowrap overflow-x-auto hide-scrollbar items-center shrink-0">
        <button
          type="button"
          onClick={connectTrainer}
          title={trainerDeviceName ? `Spojen: ${trainerDeviceName}` : 'Spoji pametni trenažer (FTMS / Cycling Power)'}
          className={`flex items-center gap-2 px-2.5 md:px-3 short:px-2.5 py-1.5 md:py-2 short:py-1 rounded-lg font-bold transition-all border text-xs shrink-0 ${
            isPowerConnected
              ? (ftmsStatus === 'ready'
                  ? 'bg-volt-400/10 text-volt-400 border-volt-400/35'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/35')
              : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            isPowerConnected
              ? (ftmsStatus === 'ready' ? 'bg-volt-400 shadow-[0_0_8px_rgba(var(--accent-400),0.9)]' : 'bg-amber-400')
              : 'bg-zinc-600'
          }`} />
          {bleConnectingType === 'trainer' ? (
            <Loader2 className="w-3.5 h-3.5 text-volt-400 animate-spin shrink-0" />
          ) : isPowerConnected ? (
            <BluetoothConnected className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Bluetooth className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          )}
          <span className="tracking-tight whitespace-nowrap">
            {bleConnectingType === 'trainer'
              ? 'Spajam trenažer...'
              : isPowerConnected
              ? `${trainerDeviceName || 'Trenažer'} ${ftmsStatus === 'ready' ? '· ERG' : '· NO-ERG'}`
              : 'FTMS Trenažer'}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={connectPowerMeter}
            title={pmDeviceName ? `Spojen: ${pmDeviceName}` : 'Spoji vanjski PowerMeter (npr. Favero Assioma)'}
            className={`flex items-center gap-2 px-2.5 md:px-3 short:px-2.5 py-1.5 md:py-2 short:py-1 rounded-lg font-bold transition-all border text-xs shrink-0 ${
              isPmConnected
                ? 'bg-violet-500/12 text-violet-300 border-violet-500/35'
                : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${isPmConnected ? 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]' : 'bg-zinc-600'}`} />
            {bleConnectingType === 'pm' ? (
              <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
            ) : (
              <Activity className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            )}
            <span className="tracking-tight whitespace-nowrap">
              {bleConnectingType === 'pm' ? 'Spajam PM...' : isPmConnected ? (pmDeviceName || 'PowerMeter') : 'PowerMeter'}
            </span>
            {isPmConnected && pmBatteryLevel != null && (
              <span className="text-[10px] font-mono telemetry-num text-violet-200 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-400/30 flex items-center gap-0.5">
                <Battery className="w-3 h-3" /> {pmBatteryLevel}%
              </span>
            )}
          </button>

          {isPmConnected && (
            <>
              <button
                type="button"
                onClick={() => { setPowerMatchEnabled(prev => !prev); pidController.reset(); }}
                title="Uskladi otpor trenažera prema očitanju PowerMetra"
                className={`px-2 py-1.5 md:py-2 short:py-1 rounded-lg font-mono font-bold transition-all border text-[11px] shrink-0 ${
                  powerMatchEnabled
                    ? 'bg-violet-500 text-zinc-950 border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                    : 'bg-zinc-950 text-violet-300 border-zinc-800 hover:bg-zinc-900'
                }`}
              >
                P.MATCH {powerMatchEnabled ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={togglePmDoublePower}
                title="Udvostruči snagu jednostrane pedale (npr. Assioma UNO kada u Favero aplikaciji nije uključen Unified Channel L). Isključi ako Favero aplikacija već udvostručuje snagu!"
                className={`px-2 py-1.5 md:py-2 short:py-1 rounded-lg font-mono font-bold transition-all border text-[11px] shrink-0 ${
                  pmDoublePower
                    ? 'bg-amber-400 text-zinc-950 border-amber-300'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                ×2 UNO {pmDoublePower ? 'ON' : 'OFF'}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={connectHR}
          className={`flex items-center gap-2 px-2.5 md:px-3 short:px-2.5 py-1.5 md:py-2 short:py-1 rounded-lg font-bold transition-all border text-xs shrink-0 ${
            isHrConnected
              ? 'bg-rose-500/12 text-rose-300 border-rose-500/35'
              : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${isHrConnected ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]' : 'bg-zinc-600'}`} />
          {bleConnectingType === 'hr' ? (
            <Loader2 className="w-3.5 h-3.5 text-rose-400 animate-spin shrink-0" />
          ) : (
            <Heart className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          )}
          <span className="tracking-tight whitespace-nowrap">{bleConnectingType === 'hr' ? 'Spajam HR...' : 'Pulsmetar'}</span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={connectZwiftClick}
            title={
              zwiftClickState.connected
                ? `Spojen: ${zwiftClickState.deviceName} (klikni za odspajanje)`
                : 'Probudi Zwift Click pritiskom na tipku (plava LED pulsira) i klikni za spajanje'
            }
            className={`flex items-center gap-2 px-2.5 md:px-3 short:px-2.5 py-1.5 md:py-2 short:py-1 rounded-lg font-bold transition-all border text-xs shrink-0 ${
              zwiftClickState.connected
                ? 'bg-sky-500/12 text-sky-300 border-sky-500/35'
                : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${zwiftClickState.connected ? 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]' : 'bg-zinc-600'}`} />
            {bleConnectingType === 'click' ? (
              <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
            ) : (
              <Gamepad2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )}
            <span className="tracking-tight whitespace-nowrap">
              {bleConnectingType === 'click'
                ? 'Spajam Click...'
                : zwiftClickState.connected
                ? (zwiftClickState.deviceName || 'Zwift Click')
                : 'Zwift Click'}
            </span>
            {zwiftClickState.connected && zwiftClickState.batteryLevel != null && (
              <span className="text-[10px] font-mono telemetry-num text-volt-300 bg-volt-400/10 px-1.5 py-0.5 rounded border border-volt-400/25 flex items-center gap-0.5">
                <Battery className="w-3 h-3" /> {zwiftClickState.batteryLevel}%
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowClickSettings(v => !v)}
            title="Postavke virtualnog mjenjača i kalibracija Zwift Click tipki"
            className={`p-1.5 md:p-2 short:p-1.5 rounded-lg border text-xs font-bold transition-colors shrink-0 ${
              showClickSettings
                ? 'bg-volt-400 text-zinc-950 border-volt-400'
                : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={openBleDiagnosticModal}
            title="BLE Dijagnostika, povijest grešaka i rezervno traženje Assioma pedala"
            className={`flex items-center gap-1.5 px-2 py-1.5 md:py-2 short:py-1 rounded-lg border font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
              hasRecentBleError
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25'
                : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-violet-300 border-zinc-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">BLE Log</span>
            {hasRecentBleError && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Izađi iz punog zaslona (tipka F ili Esc)' : 'Puni zaslon za TV / garažu (tipka F)'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 md:py-2 short:py-1 rounded-lg border font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
              isFullscreen
                ? 'bg-volt-400/15 text-volt-400 border-volt-400/40'
                : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-volt-400 border-zinc-800'
            }`}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline">{isFullscreen ? 'Izlaz' : 'TV Puni zaslon'}</span>
          </button>

          <div className="flex items-center bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden shrink-0">
            <div className="px-2.5 md:px-3 py-1.5 md:py-2 short:py-1 text-zinc-500 font-mono text-[11px] md:text-xs truncate max-w-[135px] lg:max-w-[220px]">
              <span className="hidden lg:inline text-zinc-600">SESIJA // </span>
              <span className="text-zinc-100 font-sans font-bold uppercase tracking-tight">
                {workoutFromCalendar ? workoutFromCalendar.title : "Slobodna Vožnja"}
              </span>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={() => {
                  exitAllFullscreen();
                  onClose();
                }}
                className="px-2.5 md:px-3 py-1.5 md:py-2 short:py-1 bg-zinc-900 hover:bg-zinc-800 hover:text-white transition-colors text-zinc-400 font-bold text-xs border-l border-zinc-800 flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5 md:w-4 md:h-4" /> <span className="hidden lg:inline">Zatvori</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* OBAVIJEST O BLUETOOTH GREŠCI (bez window.alert koji gasi Fullscreen i blokira dretvu) */}
      {bleErrorBanner && !fullscreenBleModal && (
        <div className="bg-rose-950/60 border border-rose-500/45 text-rose-200 rounded-xl px-3 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 shrink-0 animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{bleErrorBanner}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isPmConnected && (
              <button
                type="button"
                disabled={Boolean(bleConnectingType)}
                onClick={() => {
                  if (isBrowserFullscreenActive()) {
                    openFullscreenBleHandoff('pm');
                  } else {
                    connectPowerMeterDirect(true);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-violet-500/25 hover:bg-violet-500/35 text-violet-200 border border-violet-400/40 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors"
              >
                Svi BLE uređaji (Assioma)
              </button>
            )}
            <button
              type="button"
              onClick={openBleDiagnosticModal}
              className="px-2 py-1 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              BLE Log
            </button>
            <button
              type="button"
              onClick={() => setBleErrorBanner(null)}
              className="p-1 rounded hover:bg-rose-500/20 text-rose-300 shrink-0"
              title="Sakrij obavijest"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ZWIFT CLICK POSTAVKE, DIJAGNOSTIKA I KALIBRACIJA TIPKI */}
      {showClickSettings && (
        <div className="carbon-panel border-volt-400/35 rounded-xl p-3 md:p-4 space-y-2.5 shrink-0 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Gamepad2 className="w-4 h-4 text-volt-400 shrink-0" />
              <span className="text-xs md:text-sm font-display font-bold uppercase tracking-wider text-zinc-100">
                Virtualni Mjenjač · Zwift Click / Play / Ride
              </span>
              {zwiftClickState.connected ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-volt-400/15 text-volt-300 border border-volt-400/30">
                  SPOJEN · KLIKOVA: {zwiftClickState.clickCount}
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  Nije spojen — pritisni tipku na Clicku (plava LED pulsira) i klikni &quot;Zwift Click&quot;
                </span>
              )}
              {zwiftClickState.connected && zwiftClickState.lastPacketHex && (
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                  BLE: {zwiftClickState.lastPacketHex}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => zwiftClickRef.current?.toggleSwapButtons()}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors ${
                  zwiftClickState.swapButtons
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border-zinc-800'
                }`}
                title="Zamijeni ulogu gornje i donje tipke ako je Zwift Click montiran naopako na volanu"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {zwiftClickState.swapButtons ? 'Tipke: Obrnuto (-/+)' : 'Tipke: Standard (+/-)'}
              </button>

              <button
                type="button"
                onClick={toggleResPhysicsMode}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-mono font-bold transition-colors ${
                  resPhysicsMode === 'SIM'
                    ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                    : 'bg-volt-400/15 text-volt-300 border-volt-400/35'
                }`}
                title="Odaberi šalje li virtualni mjenjač u RES modu linearni otpor kočnice (FTMS 0x04) ili simulirani nagib ceste (FTMS 0x11)"
              >
                {resPhysicsMode === 'RES' ? 'RES: Kočnica (0x04)' : 'RES: Nagib SIM (0x11)'}
              </button>

              {zwiftClickState.connected && zwiftClickState.calibrationStep === 'idle' && (
                <button
                  type="button"
                  onClick={() => zwiftClickRef.current?.startCalibration()}
                  className="px-2.5 py-1 rounded-lg bg-volt-400/15 hover:bg-volt-400/25 text-volt-300 border border-volt-400/35 text-xs font-bold transition-colors"
                  title="Ručno nauči + i - tipku ako tvoj firmware koristi nestandardni kod"
                >
                  Kalibriraj +/-
                </button>
              )}

              {zwiftClickState.hasCustomMap && zwiftClickState.calibrationStep === 'idle' && (
                <button
                  type="button"
                  onClick={() => zwiftClickRef.current?.clearCustomMap()}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-900 text-zinc-400 border border-zinc-800 text-xs font-bold"
                  title="Vrati na tvorničko dekodiranje protokola"
                >
                  <RotateCcw className="w-3 h-3" /> Reset mape
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowClickSettings(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                title="Sakrij postavke"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {zwiftClickState.calibrationStep !== 'idle' && (
            <div className="flex items-center justify-between gap-2 bg-volt-400/10 border border-volt-400/40 rounded-lg px-3 py-2 text-xs font-bold text-volt-300">
              <span>
                {zwiftClickState.calibrationStep === 'wait_plus' && '1/2 — Pritisni na Zwift Clicku tipku koju želiš za VIŠU brzinu (+)...'}
                {zwiftClickState.calibrationStep === 'wait_release' && 'Odlično! Pusti tipku...'}
                {zwiftClickState.calibrationStep === 'wait_minus' && '2/2 — Sada pritisni tipku koju želiš za NIŽU brzinu (-)...'}
              </span>
              <button
                type="button"
                onClick={() => zwiftClickRef.current?.cancelCalibration()}
                className="px-2.5 py-1 rounded bg-zinc-950 text-zinc-300 border border-zinc-800 text-xs"
              >
                Odustani
              </button>
            </div>
          )}

          <div className="text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
            <span>
              <strong className="text-sky-300">RES mod (Slobodna vožnja):</strong> kratki <code className="font-mono text-zinc-200">+/-</code> = brzine 1–24, držanje = brzi Multi-Shift.
            </span>
            <span>
              <strong className="text-volt-300">ERG mod (Trening):</strong> kratki <code className="font-mono text-zinc-200">+/-</code> = ±2% intenzitet · dugi <code className="font-mono text-zinc-200">+</code> = preskoči interval · dugi <code className="font-mono text-zinc-200">-</code> = Start/Pauza.
            </span>
          </div>
        </div>
      )}

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

      {/* GLAVNI TELEMETRIJSKI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 md:short:grid-cols-3 lg:grid-cols-3 gap-2 md:gap-3 short:gap-1.5 flex-[1.15] min-h-0" style={{ minHeight: 0 }}>
        <div className="md:col-span-2 md:short:col-span-2 lg:col-span-2 carbon-panel bg-telemetry-grid rounded-xl p-2.5 md:p-4 short:p-2.5 vshort:p-2 flex flex-col relative overflow-hidden min-h-0">
          <div className={`absolute top-0 left-0 w-full h-[3px] ${getZoneColorForTrainer(currentStep.power)} transition-colors duration-500`} />

          {/* PLUTAJUĆI HUD ZA PROMJENU VIRTUALNE BRZINE / ZWIFT CLICK */}
          {shiftToast && (
            <div
              key={shiftToast.id}
              className={`absolute top-10 md:top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-4 py-1.5 rounded-lg border shadow-2xl flex items-center gap-2 font-mono animate-in fade-in zoom-in-95 ${
                shiftToast.tone === 'emerald'
                  ? 'bg-zinc-950/95 border-volt-400/60 text-volt-300'
                  : shiftToast.tone === 'amber'
                  ? 'bg-zinc-950/95 border-amber-400/60 text-amber-200'
                  : shiftToast.tone === 'cyan'
                  ? 'bg-zinc-950/95 border-sky-400/60 text-sky-200'
                  : 'bg-zinc-950/95 border-volt-400/50 text-zinc-100'
              }`}
            >
              <span className="text-sm md:text-base font-bold tracking-tight">{shiftToast.text}</span>
              {shiftToast.subtext && (
                <span className="text-[11px] md:text-xs font-medium opacity-80 border-l border-zinc-700 pl-2">
                  {shiftToast.subtext}
                </span>
              )}
            </div>
          )}

          <div className="flex justify-between items-start w-full z-10 shrink-0 gap-2">
            <div className="flex items-center gap-1.5 md:gap-2 mt-0.5 flex-wrap">
              <span className="text-zinc-400 font-mono font-bold uppercase tracking-[0.18em] text-[10px] md:text-xs short:text-[10px]">
                {usePmAsPrimary ? `PM SNAGA${pmDoublePower ? ' (×2)' : ''}` : (isPowerConnected ? 'SNAGA TRENAŽERA' : 'SNAGA // WATTS')}
              </span>
              {powerMatchEnabled && isPmConnected && !(halfPowerDetected && !pmDoublePower) && (
                <span className="bg-violet-500/15 text-violet-300 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/30">
                  PID MATCH
                </span>
              )}
              {!powerMatchEnabled && isPmConnected && isPowerConnected && (
                <span className="bg-sky-500/10 text-sky-300 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-500/25">
                  TRENAŽER RAW
                </span>
              )}
              {zwiftClickState.connected && (
                <span className="bg-volt-400/10 text-volt-300 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-volt-400/25">
                  CLICK READY
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-1.5 bg-zinc-950 p-1 short:p-0.5 rounded-lg border border-zinc-800 shrink-0">
              <button
                onClick={toggleMode}
                title="Prebaci između ERG i RES (Virtual Shifting) moda (tipka M)"
                className={`flex items-center gap-1 px-2.5 py-1 md:px-3 md:py-1.5 short:px-2 short:py-0.5 rounded-md text-[10px] md:text-xs font-mono font-bold uppercase tracking-wider transition-all active:scale-95 ${
                  controlMode === 'ERG'
                    ? 'bg-volt-400/15 text-volt-300 border border-volt-400/35'
                    : 'bg-sky-500/15 text-sky-300 border border-sky-500/35'
                }`}
              >
                <Settings2 className="w-3 h-3 md:w-3.5 md:h-3.5" />
                <span>{controlMode}</span>
              </button>
              <div className="w-px h-5 md:h-6 short:h-4 bg-zinc-800 mx-0.5" />
              {controlMode === 'ERG' ? (
                <div className="flex items-center gap-0.5 md:gap-1">
                  <button onClick={decreaseErg} className="p-1 md:p-1.5 short:p-1 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition-colors active:scale-95">
                    <Minus className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  </button>
                  <span className="w-11 md:w-14 short:w-11 text-center font-mono font-bold telemetry-num text-zinc-100 text-xs md:text-sm short:text-xs">{ergIntensity}%</span>
                  <button onClick={increaseErg} className="p-1 md:p-1.5 short:p-1 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition-colors active:scale-95">
                    <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 md:gap-1">
                  <button onClick={decreaseRes} title="Niža brzina (-)" className="p-1 md:p-1.5 short:p-1 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition-colors active:scale-95">
                    <Minus className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  </button>
                  <div className="min-w-[60px] md:min-w-[78px] short:min-w-[64px] text-center leading-none">
                    <div className="font-mono font-bold telemetry-num text-sky-300 text-xs md:text-sm short:text-xs">G{virtualGear}/{VIRTUAL_GEAR_MAX}</div>
                    <div className="text-[9px] font-mono telemetry-num text-zinc-500 mt-0.5 vshort:hidden">
                      {resPhysicsMode === 'SIM' ? `${simulatedGrade > 0 ? '+' : ''}${simulatedGrade.toFixed(1)}%` : `${resistanceLevel}%`}
                    </div>
                  </div>
                  <button onClick={increaseRes} title="Viša brzina (+)" className="p-1 md:p-1.5 short:p-1 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition-colors active:scale-95">
                    <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col flex-1 items-center justify-center min-h-0 w-full z-10 py-1 short:py-0.5">
            <div className="flex items-baseline gap-2 md:gap-3 shrink-1 min-h-0">
              <div className={`text-[clamp(48px,11.5vh,152px)] short:text-[clamp(42px,9.8vh,98px)] vshort:text-[clamp(36px,8.6vh,72px)] font-display font-bold telemetry-num leading-[0.9] tracking-tight transition-colors ${controlMode === 'RES' && isPlaying ? 'text-sky-400 drop-shadow-[0_0_16px_rgba(56,189,248,0.35)]' : getPowerColor()}`}>
                {displayPower}
              </div>
              <div className="flex flex-col items-start pb-1">
                <span className="text-lg md:text-2xl lg:text-3xl short:text-xl font-mono font-bold text-zinc-500 leading-none">W</span>
                {profile?.weight > 0 && (
                  <span className="text-[10px] md:text-xs short:text-[10px] font-mono telemetry-num text-zinc-400 mt-1 bg-zinc-950/90 px-1.5 py-0.5 rounded border border-zinc-800">
                    {(displayPower / profile.weight).toFixed(2)} W/kg
                  </span>
                )}
              </div>
            </div>

            {isPmConnected && isPowerConnected && (
              <div className="text-[11px] short:text-[10px] font-mono telemetry-num text-zinc-400 mb-0.5 flex items-center gap-2 flex-wrap justify-center">
                <span>TRENAŽER: <strong className="text-zinc-200">{currentPower}W</strong></span>
                <span className="text-zinc-700">|</span>
                <span>PEDALE{pmDoublePower ? '(×2)' : ''}: <strong className="text-violet-300">{effectivePmPower}W</strong></span>
                <span className="text-zinc-700">|</span>
                <span>
                  Δ{' '}
                  <strong className={Math.abs(effectivePmPower - currentPower) > 15 ? 'text-amber-400' : 'text-volt-400'}>
                    {effectivePmPower - currentPower > 0 ? '+' : ''}{effectivePmPower - currentPower}W
                  </strong>
                </span>
              </div>
            )}

            <div className="w-full max-w-lg mt-1 md:mt-2 short:mt-1 bg-zinc-950/90 px-3.5 md:px-5 short:px-3 py-2 md:py-2.5 short:py-1.5 vshort:py-1 rounded-lg border border-zinc-800 shrink-0">
              {controlMode === 'ERG' ? (
                !hasValidFtp ? (
                  <span className="text-rose-400 font-mono font-bold text-xs md:text-sm flex items-center justify-center gap-2">
                    ⚠️ <span className="hidden sm:inline">Nije unesen FTP — koristi se zadanih 200 W.</span><span className="sm:hidden">Unesi FTP!</span>
                  </span>
                ) : (() => {
                  const powerDelta = displayPower - activeTargetPower;
                  const absDelta = Math.abs(powerDelta);
                  const clampedDelta = Math.max(-35, Math.min(35, powerDelta));
                  const needlePct = (isPlaying || displayPower > 0) ? ((clampedDelta + 35) / 70) * 100 : 50;
                  const nextWatts = currentStepIndex < workoutRecipe.length - 1
                    ? Math.round((workoutRecipe[currentStepIndex + 1].power / 100) * ftpValue * (ergIntensity / 100))
                    : null;

                  return (
                    <div className="flex flex-col gap-1.5 short:gap-1">
                      <div className="flex items-center justify-between gap-2 text-xs md:text-sm short:text-xs font-mono telemetry-num">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-500 text-[10px] md:text-xs short:text-[10px] uppercase">CILJ</span>
                          <span className="text-zinc-100 font-bold text-sm md:text-base short:text-sm">{activeTargetPower} W</span>
                          {powerMatchEnabled && isPmConnected && !(halfPowerDetected && !pmDoublePower) && (
                            <span className="text-violet-400 text-[10px] font-bold">⟳PM</span>
                          )}
                        </div>

                        <span className={`text-[10px] md:text-xs short:text-[10px] font-bold px-2 py-0.5 rounded border ${
                          !isPlaying && displayPower === 0
                            ? 'text-zinc-500 border-zinc-800 bg-zinc-900'
                            : absDelta <= 8
                            ? 'text-volt-400 border-volt-400/35 bg-volt-400/10'
                            : absDelta <= 22
                            ? 'text-amber-300 border-amber-500/35 bg-amber-500/10'
                            : 'text-rose-400 border-rose-500/35 bg-rose-500/10'
                        }`}>
                          {!isPlaying && displayPower === 0
                            ? 'READY'
                            : absDelta <= 8
                            ? `LOCKED (${powerDelta > 0 ? '+' : ''}${powerDelta}W)`
                            : `Δ ${powerDelta > 0 ? '+' : ''}${powerDelta}W`}
                        </span>

                        <div className="flex items-center gap-1 text-right">
                          <span className="text-zinc-500 text-[10px] md:text-xs short:text-[10px] uppercase">SLJEDEĆI</span>
                          <span className="text-zinc-300 font-bold text-xs md:text-sm short:text-xs">
                            {nextWatts !== null ? `${nextWatts} W` : 'KRAJ'}
                          </span>
                        </div>
                      </div>

                      {/* Horizontalni Target Lock indikator (±35 W raspon) */}
                      <div className="relative h-2 short:h-1.5 w-full rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
                        <div className="absolute inset-y-0 left-[38.5%] right-[38.5%] bg-volt-400/15 border-x border-volt-400/30" />
                        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-500/70 -translate-x-1/2" />
                        <div
                          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 short:w-2.5 short:h-2.5 rounded-full transition-all duration-300 ${
                            !isPlaying && displayPower === 0
                              ? 'bg-zinc-600'
                              : absDelta <= 8
                              ? 'bg-volt-400 shadow-[0_0_10px_rgba(var(--accent-400),0.9)]'
                              : absDelta <= 22
                              ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                              : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                          }`}
                          style={{ left: `${needlePct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center gap-1.5 short:gap-1 py-0.5">
                  <div className="flex items-center gap-2.5 flex-wrap justify-center leading-tight font-mono telemetry-num">
                    <span className="text-zinc-200 font-bold text-xs md:text-sm short:text-xs">
                      BRZINA <span className="text-volt-400 text-sm md:text-base short:text-sm">{virtualGear}</span>
                      <span className="text-zinc-500 text-xs">/{VIRTUAL_GEAR_MAX}</span>
                    </span>
                    <span className="text-zinc-700">|</span>
                    <span className="text-sky-300 text-xs md:text-sm short:text-xs font-bold">
                      {resPhysicsMode === 'SIM'
                        ? `NAGIB ${simulatedGrade > 0 ? '+' : ''}${simulatedGrade.toFixed(1)}%`
                        : `OTPOR ${resistanceLevel}%`}
                    </span>
                    <button
                      type="button"
                      onClick={toggleResPhysicsMode}
                      title="Prebaci način otpora između linearne kočnice (0x04) i simulacije nagiba (0x11)"
                      className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
                    >
                      {resPhysicsMode === 'SIM' ? 'SIM 0x11' : 'RES 0x04'}
                    </button>
                  </div>
                  <div className="flex items-center gap-0.5 w-full justify-center" aria-hidden="true">
                    {Array.from({ length: VIRTUAL_GEAR_MAX }, (_, idx) => {
                      const g = idx + 1;
                      const active = g <= virtualGear;
                      const isCurrent = g === virtualGear;
                      return (
                        <span
                          key={g}
                          className={`h-1.5 short:h-1 rounded-sm transition-all ${
                            isCurrent
                              ? 'w-3 bg-volt-400 shadow-[0_0_8px_rgba(var(--accent-400),0.85)]'
                              : active
                              ? 'w-1.5 bg-sky-400/70'
                              : 'w-1 bg-zinc-800'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex sm:flex-col md:flex-row md:short:flex-col lg:flex-col gap-2 md:gap-3 short:gap-1.5 shrink-1 min-h-0">
          <div className="carbon-panel rounded-xl p-2.5 md:p-3.5 short:p-2 vshort:py-1.5 vshort:px-2.5 flex-1 flex flex-col justify-between relative group hover:border-rose-500/40 transition-colors min-h-0">
            <div className="flex items-center justify-between w-full">
              <span className="text-rose-400 font-mono font-bold uppercase tracking-[0.16em] text-[10px] flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-rose-500" /> PULS
              </span>
              {isHrConnected && profile?.maxHr > 0 && displayHR > 0 && (
                <span className="text-[10px] font-mono telemetry-num text-rose-300 bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 rounded">
                  {Math.round((displayHR / profile.maxHr) * 100)}% MAX
                </span>
              )}
            </div>
            <div className="flex items-baseline justify-center gap-1.5 my-auto shrink-1 min-h-0">
              <div className={`text-[clamp(34px,7.5vh,90px)] short:text-[clamp(28px,6.2vh,60px)] vshort:text-[clamp(26px,5.5vh,48px)] font-display font-bold telemetry-num leading-none ${isHrConnected ? 'text-zinc-100' : 'text-zinc-700'}`}>
                {displayHR}
              </div>
              <span className="text-xs md:text-sm short:text-xs font-mono font-bold text-zinc-500 pb-0.5">BPM</span>
            </div>
          </div>

          <div className="carbon-panel rounded-xl p-2.5 md:p-3.5 short:p-2 vshort:py-1.5 vshort:px-2.5 flex-1 flex flex-col justify-between relative group hover:border-volt-400/40 transition-colors min-h-0">
            <div className="flex items-center justify-between w-full">
              <span className="text-volt-400 font-mono font-bold uppercase tracking-[0.16em] text-[10px] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-volt-400" /> KADENCA
              </span>
              {(isPmConnected || isPowerConnected) && displayCadence > 0 && (
                <span className="text-[10px] font-mono telemetry-num text-zinc-400 bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 rounded">
                  {displayCadence >= 85 && displayCadence <= 98 ? 'OPTIMAL' : displayCadence < 85 ? 'GRIND' : 'SPIN'}
                </span>
              )}
            </div>
            <div className="flex items-baseline justify-center gap-1.5 my-auto shrink-1 min-h-0">
              <div className={`text-[clamp(34px,7.5vh,90px)] short:text-[clamp(28px,6.2vh,60px)] vshort:text-[clamp(26px,5.5vh,48px)] font-display font-bold telemetry-num leading-none ${(isPmConnected || isPowerConnected) ? 'text-zinc-100' : 'text-zinc-700'}`}>
                {displayCadence}
              </div>
              <span className="text-xs md:text-sm short:text-xs font-mono font-bold text-zinc-500 pb-0.5">RPM</span>
            </div>
          </div>
        </div>
      </div>

      {/* COGGAN TELEMETRIJSKA TRAKA */}
      <div className="carbon-panel rounded-xl px-2 md:px-4 py-1.5 md:py-2 short:py-1 shrink-0 overflow-x-auto hide-scrollbar">
        <div className={`grid grid-cols-4 divide-x divide-zinc-800/90 min-w-[300px] text-center font-mono telemetry-num ${getZoneTextColor(currentStep.power)}`}>
          <div className="px-2 flex flex-col sm:flex-row items-center justify-center sm:gap-2">
            <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">NP</span>
            <span className="text-xs md:text-base short:text-sm font-bold">{liveMetrics.np} W</span>
          </div>
          <div className="px-2 flex flex-col sm:flex-row items-center justify-center sm:gap-2">
            <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">IF</span>
            <span className="text-xs md:text-base short:text-sm font-bold">{liveMetrics.ifFactor}</span>
          </div>
          <div className="px-2 flex flex-col sm:flex-row items-center justify-center sm:gap-2">
            <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">TSS</span>
            <span className="text-xs md:text-base short:text-sm font-bold">{liveMetrics.tss}</span>
          </div>
          <div className="px-2 flex flex-col sm:flex-row items-center justify-center sm:gap-2">
            <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">WORK</span>
            <span className="text-xs md:text-base short:text-sm font-bold">{liveMetrics.workKj} kJ</span>
          </div>
        </div>
      </div>

      {/* DONJI PANEL: Trening grafikon i transport kontrole */}
      <div className="carbon-panel rounded-xl p-2 md:p-3 short:p-2 vshort:p-1.5 flex flex-col flex-1 min-h-[155px] short:min-h-[138px] vshort:min-h-[124px]">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-1 mb-1.5 md:mb-2 short:mb-1 gap-1.5 md:gap-2 shrink-0">
          <div className="flex flex-col sm:flex-row items-center sm:items-start md:items-center gap-2 md:gap-3 short:gap-2">
            <div className="flex items-center bg-zinc-950 rounded-xl p-1 short:p-0.5 border border-zinc-800 mx-auto sm:mx-0 gap-1">
              <button
                onClick={handleStopClick}
                className="w-8 h-8 md:w-10 md:h-10 short:w-8 short:h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-rose-500/15 text-zinc-400 hover:text-rose-400"
                title="Prekini trening"
              >
                <Square className="w-3.5 h-3.5 md:w-4 md:h-4 short:w-3.5 short:h-3.5" fill="currentColor" />
              </button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`w-10 h-10 md:w-12 md:h-11 short:w-10 short:h-8 rounded-lg flex items-center justify-center transition-all shrink-0 ${
                  isPlaying
                    ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-volt-400'
                    : 'bg-volt-400 hover:bg-volt-300 text-zinc-950 shadow-volt-glow'
                }`}
                title="Pokreni / Pauziraj (Space)"
              >
                {isPlaying ? <Pause className="w-4 h-4 md:w-5 md:h-5 short:w-4 short:h-4" fill="currentColor" /> : <Play className="w-4 h-4 md:w-5 md:h-5 short:w-4 short:h-4 ml-0.5" fill="currentColor" />}
              </button>
              <button
                onClick={handleSkip}
                className="w-8 h-8 md:w-10 md:h-10 short:w-8 short:h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                title="Preskoči na idući interval (S)"
              >
                <FastForward className="w-3.5 h-3.5 md:w-4 md:h-4 short:w-3.5 short:h-3.5" fill="currentColor" />
              </button>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-[9px] md:text-[10px] short:text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-[0.18em] mb-0.5 short:mb-0">
                AKTIVNI BLOK · {currentStepIndex + 1}/{workoutRecipe.length}
              </div>
              <div className="text-sm md:text-lg lg:text-xl short:text-base font-display font-bold text-zinc-100 flex flex-wrap items-center justify-center sm:justify-start gap-1.5 md:gap-2 leading-none">
                <span className="uppercase tracking-wide">{currentStep.name}</span>
                <span className="text-volt-400 font-mono text-xs md:text-sm short:text-xs font-bold">
                  @{Math.round(currentStep.power * (ergIntensity / 100))}% FTP
                </span>
                <button
                  onClick={handleExtend}
                  className="bg-zinc-950 text-zinc-300 hover:text-volt-300 hover:border-volt-400/40 border border-zinc-800 text-[9px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 shrink-0"
                >
                  <Plus className="w-2.5 h-2.5" /> 5m
                </button>
              </div>
            </div>
          </div>
          <div className="text-center md:text-right border-t border-zinc-800/60 md:border-t-0 pt-1 md:pt-0 shrink-0 flex md:flex-col items-center md:items-end justify-between md:justify-end gap-2 md:gap-0">
            <div className="text-[9px] md:text-[10px] short:text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-[0.18em] md:mb-0.5 short:mb-0">PREOSTALO U BLOKU</div>
            <div className={`text-xl md:text-3xl lg:text-4xl short:text-2xl vshort:text-xl font-display font-bold telemetry-num tracking-tight leading-none ${isPlaying ? 'text-volt-400 drop-shadow-[0_0_12px_rgba(var(--accent-400),0.3)]' : 'text-zinc-500'}`}>
              {formatTime(stepRemaining)}
            </div>
          </div>
        </div>

        <TrainerGraph
          workoutRecipe={workoutRecipe}
          workoutHistory={workoutHistory}
          totalDuration={totalDuration}
          progressPercent={progressPercent}
          profile={profile}
          ergIntensity={ergIntensity}
          currentStepIndex={currentStepIndex}
        />

        <div className="flex justify-between items-center px-3 md:px-4 py-1.5 md:py-2 short:py-1 bg-zinc-950 rounded-b-lg border-x border-b border-zinc-800 shrink-0">
          <div className="text-[10px] md:text-xs short:text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 flex items-baseline gap-2">
            <span>PROTEKLO:</span>
            <span className="text-zinc-100 text-sm md:text-lg lg:text-xl short:text-base font-display font-bold telemetry-num tracking-tight leading-none">{formatTime(elapsedTime)}</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-mono telemetry-num text-[10px] text-zinc-500">
            <span>NAPREDAK</span>
            <span className="text-zinc-300 font-bold">{Math.min(100, Math.round(progressPercent))}%</span>
          </div>

          <div className="text-[10px] md:text-xs short:text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 flex items-baseline gap-2 text-right">
            <span>PREOSTALO UKUPNO:</span>
            <span className="text-volt-400 text-sm md:text-lg lg:text-xl short:text-base font-display font-bold telemetry-num tracking-tight leading-none">{formatTime(Math.max(0, totalDuration - elapsedTime))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

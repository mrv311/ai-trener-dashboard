import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Bluetooth, BluetoothConnected, Heart, Zap, Play, Pause, Square, FastForward, Plus, Minus, Settings2 } from 'lucide-react';

const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-sky-300';       
  if (percentFTP < 75) return 'bg-sky-400';       
  if (percentFTP < 90) return 'bg-emerald-400';   
  if (percentFTP < 105) return 'bg-amber-400';    
  if (percentFTP < 120) return 'bg-rose-500';     
  return 'bg-purple-600';                         
};

export default function TrainerTab({ profile, workoutFromCalendar }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); 
  
  const [currentHR, setCurrentHR] = useState(0);
  const [currentPower, setCurrentPower] = useState(0);
  const [currentCadence, setCurrentCadence] = useState(0);
  const [isHrConnected, setIsHrConnected] = useState(false);
  const [isPowerConnected, setIsPowerConnected] = useState(false);

  const [controlMode, setControlMode] = useState('ERG'); 
  const [ergIntensity, setErgIntensity] = useState(100); 
  const [resistanceLevel, setResistanceLevel] = useState(30); 
  const [ftmsControlChar, setFtmsControlChar] = useState(null); 

  // Referenca za računanje kadence (čuva prijašnje stanje)
  const crankDataRef = useRef({ revs: -1, time: -1 });

  const [workoutRecipe, setWorkoutRecipe] = useState([
    { name: 'Zagrijavanje', duration: 10 * 60, power: 50 },
    { name: 'Z2 Aerobna Baza', duration: 5 * 60, power: 65 },
    { name: 'SweetSpot 1', duration: 15 * 60, power: 90 },
    { name: 'Oporavak', duration: 3 * 60, power: 50 },
    { name: 'SweetSpot 2', duration: 15 * 60, power: 90 },
    { name: 'Hlađenje', duration: 7 * 60, power: 45 },
  ]);

  useEffect(() => {
    if (workoutFromCalendar && workoutFromCalendar.workout_doc && workoutFromCalendar.workout_doc.steps) {
      const extractSteps = (stepsArray) => {
        let flatSteps = [];
        stepsArray.forEach(step => {
          if (step.steps && Array.isArray(step.steps)) {
             const loops = step.reps || step.count || 1;
             for(let i=0; i<loops; i++) {
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
         setIsPlaying(false);
      }
    }
  }, [workoutFromCalendar]);

  const totalDuration = useMemo(() => workoutRecipe.reduce((acc, step) => acc + step.duration, 0), [workoutRecipe]);

  useEffect(() => {
    let interval;
    if (isPlaying && elapsedTime < totalDuration) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    if (elapsedTime >= totalDuration) setIsPlaying(false);
    return () => clearInterval(interval);
  }, [isPlaying, elapsedTime, totalDuration]);

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
  
  const baseTargetPower = Math.round((currentStep.power / 100) * profile.ftp);
  const activeTargetPower = Math.round(baseTargetPower * (ergIntensity / 100));

  const displayPower = isPowerConnected ? currentPower : 0;
  const displayHR = isHrConnected ? currentHR : 0;
  const displayCadence = isPowerConnected ? currentCadence : 0;

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
        const rate16Bits = flags & 0x1;
        setCurrentHR(rate16Bits ? val.getUint16(1, true) : val.getUint8(1));
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
        const view = e.target.value;
        const flags = view.getUint16(0, true);

        // Očitavanje snage
        setCurrentPower(view.getInt16(2, true));

        // Matematika za kadencu (Bit 5 provjera)
        if ((flags & 0x20) !== 0) {
          let offset = 4;
          if ((flags & 0x01) !== 0) offset += 1; 
          if ((flags & 0x04) !== 0) offset += 2; 
          if ((flags & 0x10) !== 0) offset += 6; 

          if (view.byteLength >= offset + 4) {
            const crankRevs = view.getUint16(offset, true);
            const crankTime = view.getUint16(offset + 2, true);

            if (crankDataRef.current.time !== -1) {
              let timeDiff = crankTime - crankDataRef.current.time;
              let revDiff = crankRevs - crankDataRef.current.revs;

              if (timeDiff < 0) timeDiff += 65536;
              if (revDiff < 0) revDiff += 65536;

              if (timeDiff > 0) {
                const rpm = Math.round((revDiff / (timeDiff / 1024)) * 60);
                if (rpm >= 0 && rpm < 200) setCurrentCadence(rpm); // Filter čudnih vrijednosti
              }
            }
            crankDataRef.current = { revs: crankRevs, time: crankTime };
          }
        }
      });

      try {
        const ftmsService = await server.getPrimaryService('00001826-0000-1000-8000-00805f9b34fb');
        const controlPoint = await ftmsService.getCharacteristic('00002ad9-0000-1000-8000-00805f9b34fb');
        setFtmsControlChar(controlPoint);
        
        // KLJUČNA ISPRAVKA: Trenažer prvo mora dobiti dozvolu za slanje odgovora (Indications)
        await controlPoint.startNotifications();
        
        // Tek tada možemo zatražiti kontrolu (Opcode 0x00)
        await controlPoint.writeValue(new Uint8Array([0x00]));
        console.log("FTMS kontrola preuzeta.");
      } catch (ftmsErr) {
        console.warn("FTMS greška:", ftmsErr);
      }
    } catch (err) {
      if (err.name !== 'NotFoundError') alert("Nije uspjelo spajanje na trenažer: " + err.message);
    }
  };

  useEffect(() => {
    const sendErgCommand = async () => {
      if (ftmsControlChar && controlMode === 'ERG') {
        try {
          const buffer = new ArrayBuffer(3);
          const view = new DataView(buffer);
          view.setUint8(0, 0x05); // Naredba za Target Power
          view.setInt16(1, activeTargetPower, true);
          await ftmsControlChar.writeValue(buffer);
        } catch (e) { console.error("Greška pri slanju ERG komande", e); }
      }
    };
    sendErgCommand();
  }, [activeTargetPower, controlMode, ftmsControlChar]);

  useEffect(() => {
    const sendResCommand = async () => {
      if (ftmsControlChar && controlMode === 'RES') {
        try {
          await ftmsControlChar.writeValue(new Uint8Array([0x04, resistanceLevel])); // Naredba za Target Resistance
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

  const handleStop = () => { setIsPlaying(false); setElapsedTime(0); };
  const handleSkip = () => {
    let accumulatedToNext = 0;
    for (let i = 0; i <= currentStepIndex; i++) { accumulatedToNext += workoutRecipe[i].duration; }
    if (currentStepIndex < workoutRecipe.length - 1) { setElapsedTime(accumulatedToNext); } 
    else { setElapsedTime(totalDuration); setIsPlaying(false); }
  };
  const handleExtend = () => {
    setWorkoutRecipe(prev => {
      const newRecipe = [...prev];
      newRecipe[currentStepIndex] = { ...newRecipe[currentStepIndex], duration: newRecipe[currentStepIndex].duration + 300 };
      return newRecipe;
    });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col h-[calc(100vh-8rem)] gap-6 animate-in fade-in">
      <div className="flex gap-4">
        <button 
          onClick={connectTrainer}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-colors border shadow-sm ${isPowerConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200'}`}
        >
          {isPowerConnected ? <BluetoothConnected className="w-5 h-5"/> : <Bluetooth className="w-5 h-5"/>}
          {isPowerConnected ? 'Snaga Spojena' : 'Spoji Trenažer'}
        </button>
        <button 
          onClick={connectHR}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-colors border shadow-sm ${isHrConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'}`}
        >
          {isHrConnected ? <BluetoothConnected className="w-5 h-5"/> : <Bluetooth className="w-5 h-5"/>}
          {isHrConnected ? 'Pulsmetar Spojen' : 'Spoji Pulsmetar'}
        </button>
        <div className="ml-auto flex items-center px-5 py-3 bg-white rounded-xl border border-stone-200 shadow-sm text-stone-500 font-medium text-sm">
          Trening za danas: <span className="text-stone-800 font-bold ml-2 uppercase">
            {workoutFromCalendar ? workoutFromCalendar.title : "Slobodna Vožnja"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-stone-200 p-8 flex flex-col justify-center items-center relative overflow-hidden">
          <div className={`absolute top-0 w-full h-2 ${getZoneColorForTrainer(currentStep.power)} transition-colors duration-500`}></div>
          
          <div className="absolute top-6 left-6 flex items-center gap-3">
             <span className="text-stone-400 font-black uppercase tracking-widest text-sm">Trenutna Snaga</span>
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
          
          <div className="text-2xl font-bold text-stone-500 mt-2 bg-stone-50 px-6 py-2.5 rounded-2xl border border-stone-200">
            {controlMode === 'ERG' ? (
              <>Cilj: <span className="text-stone-800">{activeTargetPower} W</span></>
            ) : (
              <>Slobodna vožnja <span className="text-indigo-600 ml-2">(Otpor {resistanceLevel}%)</span></>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex-1 flex flex-col justify-center items-center relative">
            <span className="absolute top-5 left-5 text-rose-400 font-black uppercase tracking-widest text-xs flex items-center gap-2"><Heart className="w-4 h-4"/> Puls</span>
            <div className="flex items-baseline gap-2">
              <div className={`text-[70px] font-black leading-none ${isHrConnected ? 'text-stone-800' : 'text-stone-300'}`}>{displayHR}</div>
              <span className="text-lg font-bold text-stone-300 pb-2">bpm</span>
            </div>
          </div>
          <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex-1 flex flex-col justify-center items-center relative">
            <span className="absolute top-5 left-5 text-orange-400 font-black uppercase tracking-widest text-xs flex items-center gap-2"><Zap className="w-4 h-4"/> Kadenca</span>
            <div className="flex items-baseline gap-2">
              <div className={`text-[70px] font-black leading-none ${isPowerConnected ? 'text-stone-800' : 'text-stone-300'}`}>{displayCadence}</div>
              <span className="text-lg font-bold text-stone-300 pb-2">rpm</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col gap-6 flex-1 min-h-[260px]">
        <div className="flex items-end justify-between px-2">
           <div className="flex items-center gap-4">
              <div className="flex items-center bg-stone-100 rounded-full p-1 border border-stone-200">
                <button onClick={handleStop} className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:bg-stone-200 text-stone-600" title="Zaustavi i resetiraj"><Square className="w-5 h-5" fill="currentColor" /></button>
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

        <div className="relative flex-1 w-full bg-stone-50 rounded-xl flex items-end overflow-hidden border border-stone-200">
          {workoutRecipe.map((step, i) => {
            const widthPercent = (step.duration / totalDuration) * 100;
            const heightPercent = Math.min(Math.max((step.power / 150) * 100, 15), 100); 
            const isActive = i === currentStepIndex;
            return <div key={i} style={{ width: `${widthPercent}%`, height: `${heightPercent}%` }} className={`${getZoneColorForTrainer(step.power)} border-r border-white/20 transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-50'}`} />;
          })}
          <div className="absolute top-0 bottom-0 w-0.5 bg-stone-800 shadow-[0_0_8px_rgba(0,0,0,0.5)] z-10 transition-all duration-1000 ease-linear" style={{ left: `${progressPercent}%` }}>
            <div className="absolute -top-1.5 -left-[5px] w-3 h-3 bg-stone-800 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
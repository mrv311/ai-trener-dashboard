// Očekivani izlaz: { title, description, duration_seconds, difficulty_score, steps: [{ name, duration, power }] }

export async function parseWorkoutFile(fileText, fileName) {
  const isZwo = fileName.toLowerCase().endsWith('.zwo');
  const isErg = fileName.toLowerCase().endsWith('.erg');
  
  let parsedWorkout;
  
  if (isZwo) parsedWorkout = parseZWO(fileText);
  else if (isErg) parsedWorkout = parseERG(fileText);
  else throw new Error('Nepodržan format datoteke. Učitajte .ZWO ili .ERG datoteku.');
  
  if (fileName) {
    parsedWorkout.title = fileName.replace(/\.[^/.]+$/, "");
  }
  
  return parsedWorkout;
}

function categorizeWorkout(steps) {
  const scores = { recovery: 0, endurance: 0, tempo: 0, sweetspot: 0, threshold: 0, vo2max: 0, anaerobic: 0 };
  
  steps.forEach(s => {
    const p = s.power;
    const dur = s.duration;
    const intensity = p / 100;
    const tss = (dur / 3600) * (intensity * intensity) * 100;

    if (p < 55) scores.recovery += tss * 0.1; 
    else if (p < 76) scores.endurance += tss * 0.5; 
    else if (p < 88) scores.tempo += tss * 1.5; 
    else if (p < 95) scores.sweetspot += tss * 2.0; 
    else if (p < 106) scores.threshold += tss * 3.0; 
    // FIX: Podignuto sa 121 na 131. VO2 Max treninzi često idu do 125-130% na kraćim intervalima.
    else if (p < 131) scores.vo2max += tss * 4.0;
    else scores.anaerobic += tss * 5.0; 
  });

  let maxScore = 0;
  let dominantCategory = 'recovery';

  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      dominantCategory = cat;
    }
  }

  const map = {
    recovery: 'Oporavak',
    endurance: 'Endurance',
    tempo: 'Tempo',
    sweetspot: 'Sweet Spot',
    threshold: 'Threshold',
    vo2max: 'VO2 Max',
    anaerobic: 'Anaerobni'
  };
  
  return map[dominantCategory];
}

function getZoneRange(category) {
   switch(category) {
      case 'Oporavak': return [0, 55];
      case 'Endurance': return [55, 76];
      case 'Tempo': return [76, 88];
      case 'Sweet Spot': return [88, 95];
      case 'Threshold': return [95, 106];
      // FIX: Sinhronizirano s novom granicom.
      case 'VO2 Max': return [106, 131];
      case 'Anaerobni': return [131, 999];
      default: return [0, 100];
   }
}

function calculateCategoryDifficulty(steps, category) {
  const [minPow, maxPow] = getZoneRange(category);
  
  let tizSeconds = 0;
  let maxIntervalSeconds = 0;
  let currentInterval = 0;
  let totalTSS = 0;
  let zoneTSS = 0;

  steps.forEach(step => {
    let intensity = step.power / 100;
    let stepTss = (step.duration / 3600) * (intensity * intensity) * 100;
    totalTSS += stepTss;

    if (step.power >= minPow && step.power < maxPow) {
       tizSeconds += step.duration;
       currentInterval += step.duration;
       zoneTSS += stepTss;
    } else {
       if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;
       currentInterval = 0;
    }
  });
  
  if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;

  let tizMinutes = tizSeconds / 60;
  let maxIntervalMins = maxIntervalSeconds / 60;
  
  const baseTssPerMin = {
    'Oporavak': 0.1,
    'Endurance': 0.50,
    'Tempo': 0.96,
    'Sweet Spot': 1.29,
    'Threshold': 1.50,
    'VO2 Max': 1.87,
    'Anaerobni': 2.44
  };
  
  let normalizedTizMins = zoneTSS / (baseTssPerMin[category] || 1.0);
  
  // Oslabljeni blendFactor kako bi čisto vrijeme u zoni imalo veći utjecaj, 
  // sprječavajući nerealno napuhavanje TSS-a u mikro-intervalima.
  let blendFactor = 0.4; 
  if (category === 'Anaerobni') blendFactor = 0.6;      
  else if (category === 'VO2 Max') blendFactor = 0.5;
  else if (category === 'Oporavak' || category === 'Endurance') blendFactor = 0.1; 
  
  let effectiveMins = tizMinutes * (1 - blendFactor) + normalizedTizMins * blendFactor;

  let score = 1.0;

  switch (category) {
    case 'Oporavak':
      score = 1.0; 
      break;
    case 'Endurance':
      score = 1.0 + (effectiveMins / 60) * 1.5;
      break;
    case 'Tempo':
      score = 1.0 + (effectiveMins / 45) * 1.8;
      break;
    case 'Sweet Spot':
      score = 1.0 + (effectiveMins / 35) * 2.0; 
      if (maxIntervalMins > 20) score += (maxIntervalMins - 20) * 0.04; 
      break;
    case 'Threshold':
      score = 1.0 + (effectiveMins / 25) * 2.5;
      if (maxIntervalMins > 10) score += (maxIntervalMins - 10) * 0.08;
      break;
    case 'VO2 Max':
      // Kontrolirano linearno skaliranje: ~20 efektivnih minuta daje 5.5, ~30 daje 7.6.
      score = 1.0 + (effectiveMins / 4.5);
      // Ograničen bonus: Dodaje bodove za teške intervale (preko 2.5 min), 
      // ali capped na maksimalno 5 minuta kako bi spriječili bugove u parsiranju.
      if (maxIntervalMins > 2.5) {
         let overMins = Math.min(maxIntervalMins - 2.5, 5.0); 
         score += overMins * 0.4;
      }
      break;
    case 'Anaerobni':
      score = 1.0 + (effectiveMins / 3.0);
      if (maxIntervalMins > 1.0) {
         let overMins = Math.min(maxIntervalMins - 1.0, 3.0);
         score += overMins * 0.5;
      }
      break;
    default:
      score = (totalTSS / 60) * 4.0; 
      break;
  }

  // Blaga baza umora
  score += (totalTSS * 0.005);
  
  let workoutDurationSecs = steps.reduce((sum, s) => sum + s.duration, 0);
  let IF = workoutDurationSecs > 0 ? Math.sqrt(totalTSS / ((workoutDurationSecs / 3600) * 100)) : 0;
  
  // IF Bonus se sada striktno ignorira za VO2 Max i Anaerobne treninge 
  // jer te kategorije već same po sebi imaju ekstreman IF.
  if (IF > 0.85 && category !== 'VO2 Max' && category !== 'Anaerobni') {
      score += (IF - 0.85) * 2.5;
  }

  return parseFloat(Math.max(1.0, score).toFixed(1));
}

function parseZWO(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  
  const getTag = (tag) => {
    const el = xml.getElementsByTagName(tag)[0];
    return el ? el.textContent : '';
  };
  
  const title = getTag('name') || 'Uvezeni ZWO Trening';
  const description = getTag('description') || '';
  
  const steps = [];
  const workoutNodes = xml.getElementsByTagName('workout')[0]?.children;
  
  if (!workoutNodes) throw new Error('ZWO datoteka ne sadrži <workout> sekciju.');

  const getAttr = (node, ...names) => {
    for (let name of names) {
      if (node.hasAttribute(name)) return node.getAttribute(name);
      if (node.hasAttribute(name.toLowerCase())) return node.getAttribute(name.toLowerCase());
      if (node.hasAttribute(name.toUpperCase())) return node.getAttribute(name.toUpperCase());
    }
    return null;
  };

  for (let i = 0; i < workoutNodes.length; i++) {
    const node = workoutNodes[i];
    const typeStr = node.tagName || '';
    const type = typeStr.toLowerCase();
    
    if (type === 'warmup' || type === 'cooldown' || type === 'ramp') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      const powerLowAttr = getAttr(node, 'PowerLow', 'powerlow');
      const powerHighAttr = getAttr(node, 'PowerHigh', 'powerhigh');
      
      let powerLow = powerLowAttr ? parseFloat(powerLowAttr) * 100 : 50;
      let powerHigh = powerHighAttr ? parseFloat(powerHighAttr) * 100 : 50;
      
      steps.push({
        name: type === 'warmup' ? 'Zagrijavanje' : (type === 'cooldown' ? 'Hlađenje' : 'Rampa'),
        duration: duration || 0,
        power: Math.round((powerLow + powerHigh) / 2)
      });
    } else if (type === 'steadystate') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      const powerAttr = getAttr(node, 'Power', 'power');
      const power = powerAttr ? parseFloat(powerAttr) * 100 : 65;
      steps.push({
        name: 'Interval',
        duration: duration || 0,
        power: Math.round(power)
      });
    } else if (type === 'intervalst') {
      const repeat = parseInt(getAttr(node, 'Repeat', 'repeat')) || 1;
      const onDur = parseInt(getAttr(node, 'OnDuration', 'onduration'));
      const offDur = parseInt(getAttr(node, 'OffDuration', 'offduration'));
      const onPowAttr = getAttr(node, 'OnPower', 'onpower', 'PowerOn');
      const offPowAttr = getAttr(node, 'OffPower', 'offpower', 'PowerOff');
      
      const onPow = onPowAttr ? parseFloat(onPowAttr) * 100 : 100;
      const offPow = offPowAttr ? parseFloat(offPowAttr) * 100 : 50;
      
      for (let r = 0; r < repeat; r++) {
        if (onDur) steps.push({ name: `On (${r+1}/${repeat})`, duration: onDur, power: Math.round(onPow) });
        if (offDur) steps.push({ name: `Off`, duration: offDur, power: Math.round(offPow) });
      }
    } else if (type === 'freeride') {
      const duration = parseInt(getAttr(node, 'Duration', 'duration'));
      steps.push({
        name: 'Slobodna Vožnja',
        duration: duration || 0,
        power: 55
      });
    }
  }

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
  const category = categorizeWorkout(steps);
  const diffScore = calculateCategoryDifficulty(steps, category);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    category,
    steps
  };
}

function parseERG(ergText) {
  const lines = ergText.split('\n');
  let title = 'Uvezeni ERG Trening';
  let description = '';
  let inData = false;
  let dataLines = [];
  let ftpParams = 250;

  for (let line of lines) {
    const cl = line.trim();
    if (cl.startsWith('DESCRIPTION=')) description = cl.replace('DESCRIPTION=', '').trim();
    if (cl.startsWith('FILE NAME=') || cl.startsWith('FILENAME=')) title = cl.replace(/FILE NAME=|FILENAME=/g, '').trim();
    if (/^FTP\s*=/i.test(cl)) ftpParams = parseFloat(cl.replace(/^FTP\s*=/i, '')) || 250;
    
    if (cl === '[COURSE DATA]') {
      inData = true;
      continue;
    }
    if (cl === '[END COURSE DATA]') {
      inData = false;
      continue;
    }
    if (inData && cl) {
      dataLines.push(cl);
    }
  }

  if (dataLines.length === 0) throw new Error('ERG datoteka ne sadrži [COURSE DATA] sekciju.');

  const points = dataLines.map(l => {
    const parts = l.split(/\s+/).map(Number);
    return { min: parts[0], val: parts[1] };
  });

  const steps = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i+1];
    
    if (end.min > start.min) { 
      const durationSec = Math.round((end.min - start.min) * 60);
      let power = start.val;
      
      // Pokušaj pretvoriti Watte u FTP% ako su vrijednosti očito Watti
      // Većina ERG fajlova koristi čiste watte koji se baziraju na zadani FTP. 
      if (ftpParams && power > 0) {
        power = (power / ftpParams) * 100;
      }
      
      steps.push({
        name: 'ERG Interval',
        duration: durationSec,
        power: Math.round(power)
      });
    }
  }

  // Grupiranje uzastopnih koraka s istom snagom za čišći UI
  const mergedSteps = [];
  steps.forEach(s => {
    if (mergedSteps.length > 0 && mergedSteps[mergedSteps.length-1].power === s.power) {
      mergedSteps[mergedSteps.length-1].duration += s.duration;
    } else {
      mergedSteps.push(s);
    }
  });

  const totalDuration = mergedSteps.reduce((sum, s) => sum + s.duration, 0);
  const category = categorizeWorkout(mergedSteps);
  const diffScore = calculateCategoryDifficulty(mergedSteps, category);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    category,
    steps: mergedSteps
  };
}

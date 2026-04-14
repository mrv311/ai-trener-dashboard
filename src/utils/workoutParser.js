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

    if (p < 55) scores.recovery += tss * 0.1; // Jako sniženo bodovanje (zagrijavanje)
    else if (p < 76) scores.endurance += tss * 0.5; // Lagano sniženo
    else if (p < 88) scores.tempo += tss * 1.5; 
    else if (p < 95) scores.sweetspot += tss * 2.0; // Sweet Spot je često dominantan cilj
    else if (p < 106) scores.threshold += tss * 3.0; // Visok intenzitet vuče klasifikaciju
    else if (p < 121) scores.vo2max += tss * 4.0;
    else scores.anaerobic += tss * 5.0; // Sprint/Anaerobni jako brzo preuzimaju klasifikaciju
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
      case 'VO2 Max': return [106, 121];
      case 'Anaerobni': return [121, 999];
      default: return [0, 100];
   }
}

function calculateWorkoutMetrics(steps) {
  const secPower = [];
  steps.forEach(s => {
    for (let i = 0; i < s.duration; i++) {
      secPower.push(s.power);
    }
  });

  const totalSecs = secPower.length;
  if (totalSecs === 0) return { np: 0, tss: 0, workingIf: 0, trueTotalTss: 0 };

  let startIdx = 0;
  while (startIdx < totalSecs && secPower[startIdx] < 55) {
     startIdx++;
  }
  let endIdx = totalSecs - 1;
  while (endIdx > startIdx && secPower[endIdx] < 55) {
     endIdx--;
  }

  if (startIdx >= endIdx) {
     startIdx = 0;
     endIdx = totalSecs - 1;
  }
  
  const getNP = (arr) => {
    if (arr.length === 0) return 0;
    const windowPower = [];
    let windowSum = 0;
    
    for (let i = 0; i < arr.length; i++) {
       windowSum += arr[i];
       if (i >= 30) {
           windowSum -= arr[i - 30];
       }
       let count = Math.min(i + 1, 30);
       let avg30 = windowSum / count;
       windowPower.push(Math.pow(avg30, 4));
    }
    
    let sumVal = windowPower.reduce((a, b) => a + b, 0);
    let avgPwr4 = sumVal / windowPower.length;
    return Math.pow(avgPwr4, 0.25);
  };

  const trueNP = getNP(secPower);
  const workingNP = getNP(secPower.slice(startIdx, endIdx + 1));

  const trueTotalTss = (totalSecs / 3600) * Math.pow(trueNP / 100, 2) * 100;
  
  return { 
     np: trueNP, 
     tss: trueTotalTss, 
     workingIf: workingNP / 100
  };
}

function calculateCategoryDifficulty(steps, category) {
  const [minPow, maxPow] = getZoneRange(category);
  const metrics = calculateWorkoutMetrics(steps);
  let totalTSS = metrics.tss;
  
  let tizSeconds = 0;
  let maxIntervalSeconds = 0;
  let currentInterval = 0;
  
  // Novi prag za Over-Under: toleriramo rad iznad baze radne zone
  let continuousWorkThreshold = minPow;
  if (category === 'Threshold') continuousWorkThreshold = 85; 
  else if (category === 'VO2 Max' || category === 'Anaerobni') continuousWorkThreshold = 95;
  else if (category === 'Sweet Spot') continuousWorkThreshold = 76;
  
  let zoneTSS = 0; 
  
  let workSteps = 0;
  let restSteps = 0;
  let totalWorkDur = 0;
  let totalRestDur = 0;

  steps.forEach(step => {
    let intensity = step.power / 100;
    let stepTss = (step.duration / 3600) * (intensity * intensity) * 100; 

    if (step.power >= continuousWorkThreshold) {
       currentInterval += step.duration;
       // Ako je unutar rastegnute "korisne" zone za odabranu kategoriju
       if (step.power <= (maxPow === 999 ? 999 : maxPow + 15)) {
           tizSeconds += step.duration;
           zoneTSS += stepTss; 
       }
    } else {
       if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;
       currentInterval = 0;
    }

    // Statistika za Work-To-Rest multiplikator
    if (category === 'VO2 Max' || category === 'Anaerobni') {
        if (step.power >= 106) {
           workSteps++;
           totalWorkDur += step.duration;
        } else if (step.power <= 75 && workSteps > 0) { 
           restSteps++;
           totalRestDur += step.duration;
        }
    }
  });

  if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;

  let tizMinutes = tizSeconds / 60;
  let maxIntervalMins = maxIntervalSeconds / 60;
  
  // Prilagodba: Umjesto čistog vremena u zoni (koje nagrađuje niži intenzitet), 
  // računamo "efektivne minute" balansirajući vrijeme sakupljeno i intenzitet (TSS) unutar zone.
  const baseTssPerMin = {
    'Oporavak': 0.1,
    'Endurance': 0.50, // na 55%
    'Tempo': 0.96,     // na 76%
    'Sweet Spot': 1.29,// na 88%
    'Threshold': 1.50, // na 95%
    'VO2 Max': 1.87,   // na 106%
    'Anaerobni': 2.44  // na 121%
  };
  
  let normalizedTizMins = zoneTSS / (baseTssPerMin[category] || 1.0);
  
  let blendFactor = 0.5; // Zadani omjer vremena i intenziteta
  if (category === 'Anaerobni') blendFactor = 0.8;      // U Anaerobnoj zoni (121-999%) intenzitet je ključan
  else if (category === 'VO2 Max') blendFactor = 0.6;
  else if (category === 'Oporavak' || category === 'Endurance') blendFactor = 0.2; // U Z2 dominira čisto vrijeme
  
  let effectiveMins = tizMinutes * (1 - blendFactor) + normalizedTizMins * blendFactor;

  let score = 1.0;
  // Temeljni sustav bodovanja po Zonama temeljen na efektivnom vremenu (effectiveMins)
  switch (category) {
    case 'Oporavak':
      score = 1.0; 
      break;
    case 'Endurance':
      score = 1.0 + (effectiveMins / 70) * 1.8;
      break;
    case 'Tempo':
      score = 1.0 + (effectiveMins / 55) * 2.2;
      break;
    case 'Sweet Spot':
      score = 1.0 + (effectiveMins / 45) * 3.0; 
      // Bonus za duge neprekinute intervale
      if (maxIntervalMins > 20) score += (maxIntervalMins - 20) * 0.05; 
      break;
    case 'Threshold':
      score = 1.0 + (effectiveMins / 35) * 3.8;
      if (maxIntervalMins > 10) score += (maxIntervalMins - 10) * 0.1;
      break;
    case 'VO2 Max':
      score = 1.0 + (effectiveMins / 18) * 4.2;
      if (maxIntervalMins >= 2) score += (maxIntervalMins - 2) * 0.1; 
      break;
    case 'Anaerobni':
      score = 1.0 + Math.pow(effectiveMins / 15, 0.75) * 4.5;
      break;
    default:
      score = (totalTSS / 60) * 4.0; 
      break;
  }

  // Work-to-Rest Bonus za vrlo oštre intervale
  if ((category === 'VO2 Max' || category === 'Anaerobni') && workSteps > 0 && restSteps > 0) {
      let avgWork = totalWorkDur / workSteps;
      let avgRest = totalRestDur / restSteps;
      if (avgRest > 0) {
         let ratio = avgWork / avgRest;
         // Strog i jako ograničen bonus kako se ne bi 'lijepio' na već golemi base score
         if (ratio >= 1.0) {
            score += Math.min(ratio * 0.4, 1.2); // Čvrsta kapa na 1.2
         } else if (ratio > 0.5) {
            score += 0.3; 
         }
      }
  }

  // Utjecaj ukupnog umora i volumena
  score += (totalTSS * 0.006);
  
  // Bonus za radni intenzitet izbrušen u granice normale
  if (metrics.workingIf > 0.85) {
     score += (metrics.workingIf - 0.85) * 5.0; 
  }

  if (score < 1.0) score = 1.0;
  // Ne postoji umjetni cap na 10.0 prema zahtjevu korisnika!
  
  return parseFloat(score.toFixed(1));
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

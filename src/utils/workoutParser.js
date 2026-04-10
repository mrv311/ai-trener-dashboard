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

function calculateCategoryDifficulty(steps, category) {
  // 1. Interne granice zona (VO2 Max mora ići do 130 zbog ekstremnih mikro-intervala)
  const ranges = {
    'Oporavak': [0, 55],
    'Endurance': [55, 76],
    'Tempo': [76, 88],
    'Sweet Spot': [88, 95],
    'Threshold': [95, 106],
    'VO2 Max': [106, 130], 
    'Anaerobni': [130, 999]
  };

  const [minPow, maxPow] = ranges[category] || [0, 100];

  let zoneTSS = 0;
  let totalTSS = 0;

  // 2. Optimizirana petlja: Izbjegavamo .reduce i .forEach za brzinu izvođenja na backendu
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const intensity = step.power / 100;
    
    // TSS formula: kvadriranje intenziteta uzrokuje ekstremni rast na VO2/Anaerobic
    const stepTss = (step.duration / 3600) * (intensity * intensity) * 100;

    totalTSS += stepTss;

    if (step.power >= minPow && step.power < maxPow) {
       zoneTSS += stepTss;
    }
  }

  // 3. Bazni djelitelji: Koliko ZoneTSS-a treba za 1.0 bod?
  const zoneFactors = {
    'Oporavak': 45.0,
    'Endurance': 30.0,
    'Tempo': 22.0,
    'Sweet Spot': 18.0,
    'Threshold': 14.0,
    'VO2 Max': 9.5,   // Rekalibrirano za teške intervale
    'Anaerobni': 5.5
  };

  const factor = zoneFactors[category] || 15.0;

  // 4. Izračun sirove ocjene
  let rawScore = 1.0 + (zoneTSS / factor);

  // Dodatak za ukupni umor (vrlo mali utjecaj, čisto da duži treninzi budu mrvicu teži)
  rawScore += (totalTSS * 0.0015);

  // 5. Asimptotska kompresija (DAMPENER) - Ključ za rješavanje 13.6 problema
  // Do ocjene 8.0 rast je normalan. Iznad 8.0, krivulja se lomi i raste znatno sporije.
  let finalScore = rawScore;
  if (rawScore > 8.0) {
    // Primjenjujemo potenciju < 1 kako bismo "zgužvali" ekstremne vrijednosti
    finalScore = 8.0 + Math.pow(rawScore - 8.0, 0.65);
  }

  // Osiguravamo da je minimalna ocjena 1.0
  return parseFloat(Math.max(1.0, finalScore).toFixed(1));
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

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

function calculateCategoryDifficulty(steps, category) {
  const [minPow, maxPow] = getZoneRange(category);

  let maxIntervalSeconds = 0;
  let currentInterval = 0;
  let totalTSS = 0;
  let zoneTSS = 0;

  steps.forEach(step => {
    let intensity = step.power / 100;
    let stepTss = (step.duration / 3600) * (intensity * intensity) * 100;
    totalTSS += stepTss;

    if (step.power >= minPow && step.power < maxPow) {
      currentInterval += step.duration;
      zoneTSS += stepTss;
    } else {
      if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;
      currentInterval = 0;
    }
  });

  if (currentInterval > maxIntervalSeconds) maxIntervalSeconds = currentInterval;

  let maxIntervalMins = maxIntervalSeconds / 60;

  // FIX 1: Stroži djelitelji. Ovi brojevi sada mapiraju maksimalni realni TSS u zoni na ocjenu 10.
  const divisors = {
    'Oporavak': 40.0,
    'Endurance': 28.0,
    'Tempo': 22.0,
    'Sweet Spot': 17.5,
    'Threshold': 15.0,
    'VO2 Max': 10.5,      // Podignuto sa 8.0 (znatno smanjuje inflaciju kod Shortoffa)
    'Anaerobni': 6.5
  };

  let divisor = divisors[category] || 15;
  let score = 1.0 + (zoneTSS / divisor);

  // FIX 2: Oslabljeni bonusi da ne probijaju ljestvicu
  switch (category) {
    case 'Sweet Spot':
      if (maxIntervalMins > 20) score += (maxIntervalMins - 20) * 0.04;
      break;
    case 'Threshold':
      if (maxIntervalMins > 10) score += (maxIntervalMins - 10) * 0.05;
      break;
    case 'VO2 Max':
      if (maxIntervalMins > 2.5) {
        let over = Math.min(maxIntervalMins - 2.5, 4.0);
        score += over * 0.15;
      }
      break;
    case 'Anaerobni':
      if (maxIntervalMins > 1.0) {
        let over = Math.min(maxIntervalMins - 1.0, 2.0);
        score += over * 0.2;
      }
      break;
  }

  // Blagi utjecaj ukupnog volumena i umora
  score += (totalTSS * 0.002);

  // FIX 3: Logaritamski "Soft Cap". 
  // Umjesto umjetnog rezanja na 10.0, svaka ocjena iznad 10 raste jako usporeno.
  // Ono što je prije bilo 13.6, sada će biti prigušeno ispod 11.
  if (score > 10.0) {
    score = 10.0 + (score - 10.0) * 0.25;
  }

  return parseFloat(Math.max(1.0, score).toFixed(1));
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
        if (onDur) steps.push({ name: `On (${r + 1}/${repeat})`, duration: onDur, power: Math.round(onPow) });
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
    const end = points[i + 1];

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
    if (mergedSteps.length > 0 && mergedSteps[mergedSteps.length - 1].power === s.power) {
      mergedSteps[mergedSteps.length - 1].duration += s.duration;
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

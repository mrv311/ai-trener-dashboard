import { calculateCogganMetrics, expandStepsToSeconds } from './performanceMetrics';



// Očekivani izlaz: { title, description, duration_seconds, difficulty_score, steps: [{ name, duration, power }] }



export const extractIntensityData = (workoutDoc) => {

  if (!workoutDoc) return [];

 

  // 1. Ako je to niz objekata (naš lokalni "steps" format tipa [{duration: 600, power: 50}, ...])

  if (Array.isArray(workoutDoc)) {

    const arr = [];

    workoutDoc.forEach(step => {

      // Želimo stvoriti array vrijednosti proporcijonalan trajanju (npr. svaki element = x minuta)

      // Ovdje za jednostavnost, ako je duration u sekundama, napravit ćemo array elemenata za svaku minutu.

      const mins = Math.max(1, Math.round((step.duration || 60) / 60));

      for(let i = 0; i < mins; i++) {

        arr.push(step.power || 50);

      }

    });

    return arr;

  }

 

  // 2. Ako je string koda

  if (typeof workoutDoc === 'string') {

    const { allSteps } = parseIntervalsCode(workoutDoc);

    const arr = [];

    allSteps.forEach(step => {

       const mins = Math.max(1, Math.round((step.duration || 60) / 60));

       for(let i = 0; i < mins; i++) {

         arr.push(step.power || 50);

       }

    });

    return arr;

  }

 

  // 3. Ako je originalni intervals_icu JSON format: { steps: [{...}] }

  if (workoutDoc.steps && Array.isArray(workoutDoc.steps)) {

    // Ako nema već pripremljene flattenane verzije, prebacujemo u string pa parsiramo opet radi lakoće

    try {

      const codeStr = stepsToTextLines(workoutDoc.steps).join('\n');

      const { allSteps } = parseIntervalsCode(codeStr);

      const arr = [];

      allSteps.forEach(step => {

         const mins = Math.max(1, Math.round((step.duration || 60) / 60));

         for(let i = 0; i < mins; i++) {

           arr.push(step.power || 50);

         }

      });

      return arr;

    } catch(e) {

      return [];

    }

  }

 

  return [];

};



function stepsToTextLines(steps, indent = '') {

  const lines = [];

  if (!steps || !Array.isArray(steps)) return lines;



  steps.forEach(step => {

    // Grupni korak (ima pod-steps i/ili reps)

    if (step.steps && Array.isArray(step.steps)) {

      const reps = step.reps || step.count || 1;

      // Ako ima tekst/naziv, to je naziv sekcije

      if (step.text) {

        lines.push(`${indent}${step.text}`);

      }

      if (reps > 1) {

        lines.push(`${indent}${reps}x`);

      }

      const subLines = stepsToTextLines(step.steps, indent);

      lines.push(...subLines);

    } else {

      // Pojedinačni korak

      const formatDuration = (secs) => {

        if (!secs || secs <= 0) return '0m';

        const h = Math.floor(secs / 3600);

        const m = Math.floor((secs % 3600) / 60);

        const s = Math.round(secs % 60);

        let parts = [];

        if (h > 0) parts.push(`${h}h`);

        if (m > 0) parts.push(`${m}m`);

        if (s > 0 && h === 0) parts.push(`${s}s`);

        return parts.join('') || '0m';

      };

      const formatPower = (power) => {

        if (!power) return '50%';

        if (typeof power === 'number') return `${Math.round(power)}%`;

        if (power.value != null) return `${Math.round(power.value)}%`;

        if (power.start != null && power.end != null) {

          return `${Math.round(power.start)}-${Math.round(power.end)}%`;

        }

        return '50%';

      };

     

      const dur = formatDuration(step.duration || 0);

      const pwr = formatPower(step.power);

      const text = step.text ? ` ${step.text}` : '';

      lines.push(`${indent}- ${dur} ${pwr}${text}`);

    }

  });



  return lines;

}



export const parseIntervalsCode = (code, ftp = 200) => {

  if (!code) return { duration: 0, tss: 0, np: 0, blocks: [], allSteps: [], zones: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 } };

 

  let blocks = [];

  let currentBlock = { name: 'Main', steps: [] };

  let allSteps = [];

  let totalDurMins = 0;

 

  let tempMultiplier = 1;



  const lines = code.split('\n');

  lines.forEach(line => {

    let cleanLine = line.trim();

    if (!cleanLine) return;



    // Detekcija strelice ili crtice kao korak

    const isStep = cleanLine.startsWith('-') || /^\d+[hms]/.test(cleanLine);

    // Detekcija multiplikatora (npr 4x)

    const xMatch = cleanLine.match(/^(\d+)x/i);



    if (xMatch && !cleanLine.includes('%')) {

      tempMultiplier = parseInt(xMatch[1]);

      return;

    }



    if (!isStep && !xMatch) {

      if (currentBlock.steps.length > 0) blocks.push(currentBlock);

      currentBlock = { name: cleanLine, steps: [] };

      return;

    }



    // Parsiranje koraka

    let mins = 0;

    const hMatch = cleanLine.match(/(\d+)\s*h/i);

    const mMatch = cleanLine.match(/(\d+)\s*m/i);

    const sMatch = cleanLine.match(/(\d+)\s*s/i);



    if (hMatch) mins += parseInt(hMatch[1]) * 60;

    if (mMatch) mins += parseInt(mMatch[1]);

    if (sMatch) mins += parseInt(sMatch[1]) / 60;



    let powerMin = 0, powerMax = 0, powerAvg = 0;

    // Trazimo range npr 50-70%

    const pRangeMatch = cleanLine.match(/(\d+)-(\d+)%/);

    // Trazimo single npr 100%

    const pMatch = cleanLine.match(/(\d+)%\s*(?:FTP)?/i);



    if (pRangeMatch) {

      powerMin = parseInt(pRangeMatch[1]);

      powerMax = parseInt(pRangeMatch[2]);

      powerAvg = Math.round((powerMin + powerMax) / 2);

    } else if (pMatch) {

      powerMin = parseInt(pMatch[1]);

      powerMax = powerMin;

      powerAvg = powerMin;

    }



    if (mins > 0) {

      const stepObj = {

        text: cleanLine,

        duration: mins * 60,

        powerMin: powerMin > 0 ? powerMin : 50,

        powerMax: powerMax > 0 ? powerMax : 50,

        power: powerAvg > 0 ? powerAvg : 50

      };



      for(let i = 0; i < tempMultiplier; i++) {

        currentBlock.steps.push({...stepObj});

        allSteps.push({...stepObj});

        totalDurMins += mins;

      }

      tempMultiplier = 1; // reset after applying

    }

  });



  if (currentBlock.steps.length > 0 || blocks.length === 0) {

     blocks.push(currentBlock);

  }



  // Računanje NP i TSS

  const powerArray = expandStepsToSeconds(allSteps, ftp);

  const metrics = calculateCogganMetrics(powerArray, ftp);



  // Izračun zona (Zone 1 - Zone 7/SS)

  const zoneStats = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, ss: 0 };

  let secArray = expandStepsToSeconds(allSteps, 100); // in percent

  secArray.forEach(p => {

    if (p < 55) zoneStats.z1++;

    else if (p < 76) zoneStats.z2++;

    else if (p < 88) zoneStats.z3++;

    else if (p < 95) zoneStats.ss++; // Sweet Spot

    else if (p < 106) zoneStats.z4++;

    else if (p < 121) zoneStats.z5++;

    else zoneStats.z6++;

  });



  return {

    duration: totalDurMins * 60,

    tss: metrics.tss,

    np: metrics.np,

    workKj: metrics.workKj,

    ifFactor: metrics.ifFactor,

    avgPower: metrics.avgPower,

    variability: metrics.avgPower > 0 ? (metrics.np / metrics.avgPower).toFixed(2) : 1,

    blocks,

    allSteps,

    zones: zoneStats

  };

};



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

  // FTP postavljen na 100 jer steps.power obično sadržava % FTP-a

  const powerArray = expandStepsToSeconds(steps, 100);

  const metrics = calculateCogganMetrics(powerArray, 100);



  const totalSecs = powerArray.length;

  if (totalSecs === 0) return { np: 0, tss: 0, workingIf: 0, trueTotalTss: 0 };



  let startIdx = 0;

  while (startIdx < totalSecs && powerArray[startIdx] < 55) {

     startIdx++;

  }

  let endIdx = totalSecs - 1;

  while (endIdx > startIdx && powerArray[endIdx] < 55) {

     endIdx--;

  }



  if (startIdx >= endIdx) {

     startIdx = 0;

     endIdx = totalSecs - 1;

  }

 

  const workingMetrics = calculateCogganMetrics(powerArray.slice(startIdx, endIdx + 1), 100);



  return {

     np: metrics.np,

     tss: metrics.tss,

     workingIf: parseFloat(workingMetrics.ifFactor)

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

      score = 1.0 + (effectiveMins / 75) * 1.8;

      break;

    case 'Tempo':

      score = 1.0 + (effectiveMins / 60) * 2.2;

      break;

    case 'Sweet Spot':

      score = 1.0 + (effectiveMins / 50) * 2.8;

      // Bonus za duge neprekinute intervale

      if (maxIntervalMins > 20) score += (maxIntervalMins - 20) * 0.05;

      break;

    case 'Threshold':

      score = 1.0 + (effectiveMins / 40) * 3.4;

      if (maxIntervalMins > 10) score += (maxIntervalMins - 10) * 0.08;

      break;

    case 'VO2 Max':

      score = 1.0 + (effectiveMins / 22) * 3.6;

      if (maxIntervalMins >= 2) score += (maxIntervalMins - 2) * 0.08;

      break;

    case 'Anaerobni':

      score = 1.0 + Math.pow(effectiveMins / 18, 0.7) * 3.8;

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
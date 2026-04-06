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

function calculateCategoryDifficulty(steps, category) {
  let totalTSS = 0;
  let totalDuration = 0;
  
  steps.forEach(step => {
    let intensity = step.power / 100;
    let tss = (step.duration / 3600) * (intensity * intensity) * 100;
    totalTSS += tss;
    totalDuration += step.duration;
  });

  let hours = totalDuration / 3600;
  
  const expectedTSSForLevel5 = {
    'Oporavak': 30,
    'Endurance': 50,
    'Tempo': 65,
    'Sweet Spot': 75,
    'Threshold': 85,
    'VO2 Max': 95,
    'Anaerobni': 100
  };
  
  let referenceTSS = expectedTSSForLevel5[category] || 60;
  let score = (totalTSS / referenceTSS) * 5.0;
  
  // Bonus za dugotrajnost
  if (hours > 1.5) {
     score += (hours - 1.5) * 1.5;
  }
  
  if (score < 1.0) score = 1.0;
  if (score > 10.0) score = 10.0;
  
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

  for (let i = 0; i < workoutNodes.length; i++) {
    const node = workoutNodes[i];
    const type = node.tagName;
    
    if (type === 'Warmup' || type === 'Cooldown') {
      const duration = parseInt(node.getAttribute('Duration'));
      const powerLow = parseFloat(node.getAttribute('PowerLow')) * 100;
      const powerHigh = parseFloat(node.getAttribute('PowerHigh')) * 100;
      steps.push({
        name: type === 'Warmup' ? 'Zagrijavanje' : 'Hlađenje',
        duration: duration,
        power: Math.round((powerLow + powerHigh) / 2) // Aproksimacija rampe prosjekom
      });
    } else if (type === 'SteadyState') {
      const duration = parseInt(node.getAttribute('Duration'));
      const power = parseFloat(node.getAttribute('Power')) * 100;
      steps.push({
        name: 'Interval',
        duration: duration,
        power: Math.round(power)
      });
    } else if (type === 'IntervalsT') {
      const repeat = parseInt(node.getAttribute('Repeat'));
      const onDur = parseInt(node.getAttribute('OnDuration'));
      const offDur = parseInt(node.getAttribute('OffDuration'));
      const onPow = parseFloat(node.getAttribute('OnPower')) * 100;
      const offPow = parseFloat(node.getAttribute('OffPower')) * 100;
      
      for (let r = 0; r < repeat; r++) {
        steps.push({ name: `On (${r+1}/${repeat})`, duration: onDur, power: Math.round(onPow) });
        steps.push({ name: `Off`, duration: offDur, power: Math.round(offPow) });
      }
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
    if (cl.startsWith('FILENAME=')) title = cl.replace('FILENAME=', '').trim();
    if (cl.startsWith('FTP=')) ftpParams = parseFloat(cl.replace('FTP=', '')) || 250;
    
    if (cl === '[COURSE DATA]') {
      inData = true;
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
    
    // ERG file obično ima blokove definirane sa dvije točke na istom vremenu npr 10.00 100\n 10.00 200, preskačemo takve jumpove bez vremena.
    if (end.min > start.min) { 
      const durationSec = Math.round((end.min - start.min) * 60);
      const isPercent = start.val < 1000 && ftpParams; // Cesto ERG stavi Watte, a ne FTP%. Ovo aproksimira % = (Watt / FTP) * 100
      let power = start.val;
      
      // Pokušaj pretvoriti Watte u FTP% ako su vrijednosti očito Watti
      if (power > 300 || start.val === end.val && start.val > 250) {
        power = (power / ftpParams) * 100;
      } else if (ftpParams && power > 0) {
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

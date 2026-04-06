// Očekivani izlaz: { title, description, duration_seconds, difficulty_score, steps: [{ name, duration, power }] }

export async function parseWorkoutFile(fileText, fileName) {
  const isZwo = fileName.toLowerCase().endsWith('.zwo');
  const isErg = fileName.toLowerCase().endsWith('.erg');
  
  if (isZwo) return parseZWO(fileText);
  if (isErg) return parseERG(fileText);
  
  throw new Error('Nepodržan format datoteke. Učitajte .ZWO ili .ERG datoteku.');
}

function calculateDifficulty(steps) {
  let totalTSS = 0;
  let totalDuration = 0;
  
  steps.forEach(step => {
    // TSS izračun: (sec x NP x IF) / (FTP x 3600) x 100
    // Pojednostavljeno za FTP bazirano: power je postotak FTP-a (npr 65 = 0.65)
    let intensity = step.power / 100;
    let tss = (step.duration / 3600) * (intensity * intensity) * 100;
    totalTSS += tss;
    totalDuration += step.duration;
  });

  // Skaliranje TSS-a za 1-10 difficulty score
  // Npr, tipičan 1h trening sa 65 TSS bi bio ocjena 5-6
  let IF = Math.sqrt(totalTSS / ((totalDuration/3600) * 100)) || 0;
  
  let score = IF * 10; 
  if (score < 1) score = 1;
  if (score > 10) score = 10;
  
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
  const diffScore = calculateDifficulty(steps);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    author: getTag('author') || 'Unknown',
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
  const diffScore = calculateDifficulty(mergedSteps);

  return {
    title,
    description,
    duration_seconds: totalDuration,
    difficulty_score: diffScore,
    author: 'ERG Uvoz',
    steps: mergedSteps
  };
}

import { parseWorkoutDoc, categorizeWorkout, calculateCategoryDifficulty } from './workoutParser';

export const generateLocalWorkout = (type, durationMins, difficulty = 3) => {
  // difficulty scale 1 to 5 (3 is normal)
  const categoryMap = {
    'Oporavak': 'Recovery',
    'Endurance': 'Endurance',
    'Tempo': 'Tempo',
    'Sweet Spot': 'Sweet Spot',
    'Threshold': 'Threshold',
    'VO2 Max': 'VO2 Max',
    'Anaerobni': 'Anaerobic',
  };

  const workoutType = categoryMap[type] || 'Endurance';
  let lines = [];
  
  // Basic math
  const warmupMins = durationMins <= 45 ? 10 : 15;
  const cooldownMins = durationMins <= 45 ? 5 : 10;
  const mainMins = durationMins - warmupMins - cooldownMins;

  // --- 1. WARMUP (3-part) ---
  lines.push("Zagrijavanje");
  
  const w1 = Math.floor(warmupMins / 3);
  const w2 = Math.floor(warmupMins / 3);
  let w3 = warmupMins - w1 - w2;
  
  const needsPrimers = (type === 'VO2 Max' || type === 'Anaerobni');

  lines.push(`- ${w1}m 40%`);
  lines.push(`- ${w2}m 50%`);
  
  if (needsPrimers && w3 >= 4) {
    // Odvojimo dio za primerse (2 min)
    lines.push(`- ${w3 - 2}m 60%`);
    lines.push("Priprema (Primers)");
    lines.push("- 30s 110%");
    lines.push("- 30s 50%");
    lines.push("- 30s 115%");
    lines.push("- 30s 50%");
  } else {
    lines.push(`- ${w3}m 60%`);
  }
  lines.push("");

  // --- 2. MAIN BLOCK ---
  lines.push("Glavni dio");
  
  if (mainMins <= 0) {
    lines.push(`- ${durationMins}m 50-60%`);
  } else {
    // Ovisnost o faktoru težine (1-5)
    // Diff offset: -2, -1, 0, 1, 2
    const diffOffset = difficulty - 3;
    
    switch (type) {
      case 'Oporavak': {
        const pct = 50 + (diffOffset * 2); // 46% to 54%
        lines.push(`- ${mainMins}m ${pct}%`);
        break;
      }
      
      case 'Endurance': {
        const pct = 65 + (diffOffset * 3); // 59% to 71%
        lines.push(`- ${mainMins}m ${pct}%`);
        break;
      }
        
      case 'Tempo': {
        const tempoBlock = Math.floor(mainMins / 2.5); 
        const tempoRest = Math.max(1, Math.floor(tempoBlock / 4) - diffOffset); // Manji odmor na većoj težini
        const tempoCount = Math.floor(mainMins / (tempoBlock + tempoRest));
        const leftoverTempo = mainMins - (tempoCount * (tempoBlock + tempoRest));
        const targetPct = 82 + (diffOffset * 2); // 78% to 86%
        
        if (tempoCount > 0) {
          for(let i=0; i<tempoCount; i++) {
             lines.push(`- ${tempoBlock}m ${targetPct}%`);
             lines.push(`- ${tempoRest}m 50%`);
          }
        } else {
          lines.push(`- ${mainMins}m ${targetPct}%`);
        }
        if (leftoverTempo > 0) lines.push(`- ${leftoverTempo}m 65%`);
        break;
      }

      case 'Sweet Spot': {
        const ssBlock = Math.min(20, Math.floor(mainMins / 2.5));
        const ssRest = Math.max(2, 5 - diffOffset); // 7m do 3m
        const ssCount = Math.floor(mainMins / (ssBlock + ssRest));
        const leftoverSS = mainMins - (ssCount * (ssBlock + ssRest));
        const targetPct = 90 + diffOffset; // 88% to 92%

        if (ssCount > 0) {
          for(let i=0; i<ssCount; i++) {
             lines.push(`- ${ssBlock}m ${targetPct}%`);
             lines.push(`- ${ssRest}m 50%`);
          }
        } else {
           lines.push(`- ${mainMins}m ${targetPct}%`);
        }
        if (leftoverSS > 0) lines.push(`- ${leftoverSS}m 65%`);
        break;
      }

      case 'Threshold': {
        const thBlock = Math.min(15, Math.floor(mainMins / 2.5)) + diffOffset; // Duži interval na većoj težini
        const thRest = Math.max(2, Math.floor(thBlock / 2) - diffOffset); // Kraći odmor na većoj težini
        const thCount = Math.floor(mainMins / (thBlock + thRest));
        const leftoverTh = mainMins - (thCount * (thBlock + thRest));
        const targetPct = 98 + (diffOffset * 2); // 94% to 102%

        if (thCount > 0) {
          for(let i=0; i<thCount; i++) {
             lines.push(`- ${thBlock}m ${targetPct}%`);
             lines.push(`- ${thRest}m 50%`);
          }
        } else {
           lines.push(`- ${mainMins}m ${targetPct}%`);
        }
        if (leftoverTh > 0) lines.push(`- ${leftoverTh}m 65%`);
        break;
      }

      case 'VO2 Max': {
        // VO2 Max blocks 2-4 mins
        const vo2Block = 3 + (diffOffset > 0 ? 1 : 0); // 3m ili 4m
        const vo2Rest = 3 - (diffOffset > 0 ? 1 : (diffOffset < 0 ? -1 : 0)); // Kraći odmor na teže
        const vo2Count = Math.floor(mainMins / (vo2Block + vo2Rest));
        const leftoverVo2 = mainMins - (vo2Count * (vo2Block + vo2Rest));
        const targetPct = 112 + (diffOffset * 3); // 106% to 118%

        if (vo2Count > 0) {
          for(let i=0; i<vo2Count; i++) {
             lines.push(`- ${vo2Block}m ${targetPct}%`);
             lines.push(`- ${vo2Rest}m 50%`);
          }
        } else {
          lines.push(`- ${mainMins}m 65%`);
        }
        if (leftoverVo2 > 0) lines.push(`- ${leftoverVo2}m 65%`);
        break;
      }

      case 'Anaerobni': {
        // Anaerobic blocks 1-2 mins
        const anBlock = 1;
        const anRest = Math.max(1, 2 - diffOffset); // 1-3m odmor
        const targetPct = 130 + (diffOffset * 5); // 120% to 140%
        
        const anSet = 5; // 5 reps per set
        const setTime = anSet * (anBlock + anRest);
        const setCount = Math.floor(mainMins / setTime);
        const leftoverAn = mainMins - (setCount * setTime);

        if (setCount > 0) {
          for(let s=0; s<setCount; s++) {
            lines.push(`Serija ${s+1}`);
            for(let i=0; i<anSet; i++) {
               lines.push(`- ${anBlock}m ${targetPct}%`);
               lines.push(`- ${anRest}m 50%`);
            }
            // Ekstra odmor između serija ako ima više serija
            if (s < setCount - 1) {
                lines.push(`- 5m 50%`);
            }
          }
        } else {
          const miniCount = Math.floor(mainMins / (anBlock + anRest));
          if (miniCount > 0) {
            for(let i=0; i<miniCount; i++) {
               lines.push(`- ${anBlock}m ${targetPct}%`);
               lines.push(`- ${anRest}m 50%`);
            }
          } else {
            lines.push(`- ${mainMins}m 65%`);
          }
        }
        if (leftoverAn > 0) {
          lines.push(`- ${leftoverAn}m 65%`);
        }
        break;
      }

      default:
        lines.push(`- ${mainMins}m 65-75%`);
    }
  }

  lines.push("");
  // --- 3. COOLDOWN ---
  lines.push("Hlađenje");
  lines.push(`- ${cooldownMins}m 50-40%`);

  const code = lines.join('\n');
  const parsed = parseWorkoutDoc(code);
  const diffScore = calculateCategoryDifficulty(parsed.allSteps, type);
  
  return {
    id: `local-ai-${Date.now()}`,
    title: `AI: ${durationMins}m ${type} (T${difficulty})`,
    description: `Automatski generiran trening: ${durationMins}m ${type}, Težina ${difficulty}/5.\n\n${code}`,
    category: type,
    isLocalGenerated: true,
    steps: parsed.allSteps,
    duration_seconds: parsed.duration,
    difficulty_score: diffScore
  };
};

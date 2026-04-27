/**
 * Coggan Performance Metrics Engine
 * Optimizirani "Sliding Window" O(1) izračun metrika u realnom vremenu
 * Isti kod koristi se i za parsanje usklađeno s Intervals.icu standardima.
 */

/**
 * Vraća Tailwind CSS klasu za boju zone ovisno o postotku FTP-a
 * @param {number} percentFTP - Postotak FTP-a (0-200+)
 * @returns {string} - Tailwind CSS klasa
 */
export const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-zinc-500';
  if (percentFTP < 75) return 'bg-sky-500';
  if (percentFTP < 90) return 'bg-emerald-500';
  if (percentFTP < 105) return 'bg-amber-500';
  if (percentFTP < 120) return 'bg-rose-500';
  return 'bg-purple-500';
};

/**
 * Računa detaljne Coggan metrike iz apsolutnog polja wata
 * @param {number[]} powerArray - Niz wata sekundu-po-sekundu 
 * @param {number} ftp - Korisnikov FTP (ili default)
 * @returns {Object} { np, avgPower, tss, ifFactor, workKj }
 */
export function calculateCogganMetrics(powerArray, ftp) {
  if (!powerArray || powerArray.length === 0) {
    return { np: 0, avgPower: 0, tss: 0, ifFactor: "0.00", workKj: 0 };
  }
  
  const validFtp = ftp && ftp > 0 ? ftp : 200; // Osiguranje od / 0
  let totalWorkJ = 0;
  
  let sumPwr4 = 0;
  let currentWindowSum = 0;
  
  // Inicijaliziraj prvi 30-sekundni prozor
  const windowSize = 30;
  for (let i = 0; i < Math.min(windowSize, powerArray.length); i++) {
    const p = powerArray[i] || 0;
    totalWorkJ += p;
    currentWindowSum += p;
  }
  
  // Ako imamo manje od 30 sekundi, koristimo što imamo
  if (powerArray.length < windowSize) {
    const avg = currentWindowSum / powerArray.length;
    sumPwr4 = Math.pow(avg, 4) * powerArray.length;
  } else {
    // Dodaj prvi puni prozor
    const avg30 = currentWindowSum / windowSize;
    sumPwr4 += Math.pow(avg30, 4);
    
    // Sliding window za ostatak - O(1) po iteraciji
    for (let i = windowSize; i < powerArray.length; i++) {
      const p = powerArray[i] || 0;
      totalWorkJ += p;
      
      // Pomakni prozor: dodaj novi, oduzmi stari
      currentWindowSum += p;
      currentWindowSum -= (powerArray[i - windowSize] || 0);
      
      const avg30 = currentWindowSum / windowSize;
      sumPwr4 += Math.pow(avg30, 4);
    }
  }
  
  // Zaštita od dijeljenja s nulom
  let avgPower = powerArray.length > 0 ? Math.round(totalWorkJ / powerArray.length) : 0;
  let np = powerArray.length > 0 ? Math.round(Math.pow(sumPwr4 / powerArray.length, 0.25)) : 0;
  
  // Zaštita od dijeljenja s nulom i Infinity
  let IF = (validFtp > 0 && np > 0) ? (np / validFtp) : 0;
  let tss = powerArray.length > 0 ? (powerArray.length / 3600) * (IF * IF) * 100 : 0;
  let workKj = totalWorkJ / 1000;
  
  return {
    np,
    avgPower,
    tss: Math.round(tss),
    ifFactor: IF.toFixed(2),
    workKj: Math.round(workKj)
  };
}

/**
 * Pomoćna metoda za predikcijski izračun TSS-a unaprijed iz sažetih koraka (Parser)
 * @param {Array} steps - Niz objekata { power: broj (često % FTP-a), duration: sekunde }
 * @param {number} ftp - FTP koji će se primijeniti (ako power predstavlja postotak)
 * @returns {number[]} powerArray - Rastegnuti sekundu-po-sekundu array wata
 */
export function expandStepsToSeconds(steps, ftp) {
  const result = [];
  const validFtp = ftp && ftp > 0 ? ftp : 200;

  steps.forEach(step => {
    let watts = step.power;
    // Pretpostavka za ZWO i ERG datoteke: power se često izražava u % FTP tako da: 65 = 65% FTP.
    // Ako je step.power <= 500 nismo sigurni, ali obično je postotak u Parseru.
    if (step.power <= 300 && step.power >= 0) { // Ako iznosi 0-300 posto. Već smo u workOutParseru stavili % kod ERG
      watts = (step.power / 100) * validFtp;
    }

    for (let i = 0; i < step.duration; i++) {
       result.push(watts);
    }
  });

  return result;
}

/**
 * Računa Efficiency Factor (EF)
 * Odnos Normalized Power i prosječnog pulsa. Što veći, to je aerobna efikasnost bolja.
 */
export function calculateEF(np, avgHr) {
  if (!np || !avgHr || avgHr <= 0) return 0;
  return Number((np / avgHr).toFixed(2));
}

/**
 * Računa Variability Index (VI)
 * Odnos Normalized Power i prosječne snage. Prikazuje koliko je vožnja bila 'glatka' (ideally ~1.0 za TT, >1.2 za kriterij).
 */
export function calculateVI(np, avgPower) {
  if (!np || !avgPower || avgPower <= 0) return 0;
  return Number((np / avgPower).toFixed(2));
}

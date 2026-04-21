/**
 * Coggan Performance Metrics Engine
 * Optimizirani "Sliding Window" O(1) izračun metrika u realnom vremenu
 * Isti kod koristi se i za parsanje usklađeno s Intervals.icu standardima.
 */

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
  
  // O(N) prolazak uz O(1) operacije Sliding prozora
  for (let i = 0; i < powerArray.length; i++) {
    const p = powerArray[i] || 0;
    totalWorkJ += p; // 1W = 1 Joul per second
    
    currentWindowSum += p;
    // Oduzimanje vrijednosti koja izlazi iz 30-sekundnog prozora
    if (i >= 30) {
      currentWindowSum -= (powerArray[i - 30] || 0);
    }
    
    let windowSize = Math.min(i + 1, 30);
    let avg30 = currentWindowSum / windowSize;
    
    sumPwr4 += Math.pow(avg30, 4);
  }
  
  let avgPower = Math.round(totalWorkJ / powerArray.length);
  // Izvlačenje četvrtog korijena za NP
  let np = powerArray.length > 0 ? Math.round(Math.pow(sumPwr4 / powerArray.length, 0.25)) : 0;
  
  let IF = np / validFtp;
  // TSS formula = (hr * IF^2 * 100)
  let tss = (powerArray.length / 3600) * (IF * IF) * 100;
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

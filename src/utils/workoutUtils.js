/**
 * workoutUtils.js
 * Sadrži logiku za vizualizaciju zona i kompleksne matematičke izračune performansi.
 */

export const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-zinc-500';   // Z1 - Oporavak
  if (percentFTP < 75) return 'bg-sky-500';    // Z2 - Izdržljivost
  if (percentFTP < 90) return 'bg-emerald-500';// Z3 - Tempo
  if (percentFTP < 105) return 'bg-amber-500'; // Z4 - Prag (Prag)
  if (percentFTP < 120) return 'bg-rose-500';  // Z5 - VO2Max
  return 'bg-purple-500';                      // Z6+ - Anaerobni kapacitet
};

/**
 * Izračunava NP, IF i TSS na temelju povijesti snage i FTP-a.
 * NP (Normalized Power) koristi 30s pomični prosjek podignut na 4. potenciju.
 */
export const calculateAdvancedStats = (history, ftp) => {
  if (!history || history.length < 30 || !ftp || ftp <= 0) {
    // Ako je trening kraći od 30s, NP nije relevantan, vraćamo bazični prosjek
    const avgPower = history.length > 0
      ? Math.round(history.reduce((acc, h) => acc + h.power, 0) / history.length)
      : 0;
    return { np: avgPower, intensityFactor: 0, tss: 0 };
  }

  const powers = history.map(h => h.power);
  const durationSeconds = powers.length;

  // 1. Izračun 30s rolling average-a
  let rollingAverages = [];
  for (let i = 29; i < powers.length; i++) {
    const window = powers.slice(i - 29, i + 1);
    const avg = window.reduce((sum, p) => sum + p, 0) / 30;
    rollingAverages.push(avg);
  }

  // 2. Izračun NP (Normalized Power)
  // Formula: 4. korijen prosjeka 4. potencije 30s prosjeka
  const fourthPowerSum = rollingAverages.reduce((acc, avg) => acc + Math.pow(avg, 4), 0);
  const avgFourthPower = fourthPowerSum / rollingAverages.length;
  const np = Math.round(Math.pow(avgFourthPower, 0.25));

  // 3. Izračun IF (Intensity Factor)
  // IF = NP / FTP
  const intensityFactor = parseFloat((np / ftp).toFixed(2));

  // 4. Izračun TSS (Training Stress Score)
  // Formula: $$TSS = \frac{t \cdot NP \cdot IF}{FTP \cdot 3600} \cdot 100$$
  const tss = Math.round(((durationSeconds * np * intensityFactor) / (ftp * 3600)) * 100);

  return { np, intensityFactor, tss };
};
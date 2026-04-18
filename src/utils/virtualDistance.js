/**
 * Fizikalni model za izračun virtualne brzine i udaljenosti iz snage.
 * 
 * Temelji se na jednadžbi ravnoteže snaga za ravnu cestu:
 *   P = Crr * m * g * v  +  0.5 * CdA * ρ * v³
 * 
 * Rješavamo kubnu jednadžbu za v (brzinu) Newton-Raphsonovom metodom.
 */

// Fizikalne konstante
const CRR = 0.005;      // Koeficijent otpora kotrljanja (glatki asfalt)
const CDA = 0.32;       // Aerodinamički koeficijent [m²] (hoods pozicija)
const RHO = 1.225;      // Gustoća zraka [kg/m³] (razina mora, 15°C)
const G   = 9.81;       // Gravitacijska konstanta [m/s²]

/**
 * Računa brzinu (m/s) za zadanu snagu i masu pomoću Newton-Raphsonove metode.
 * 
 * Jednadžba: f(v) = 0.5 * CdA * ρ * v³ + Crr * m * g * v - P = 0
 * Derivacija: f'(v) = 1.5 * CdA * ρ * v² + Crr * m * g
 * 
 * @param {number} powerWatts - Snaga u watima
 * @param {number} massKg - Ukupna masa (biciklist + bicikl) u kg
 * @returns {number} Brzina u m/s
 */
export function speedFromPower(powerWatts, massKg) {
  if (powerWatts <= 0) return 0;

  const totalMass = massKg + 8; // +8 kg za bicikl
  const a = 0.5 * CDA * RHO;
  const b = CRR * totalMass * G;

  // Inicijalna procjena: v ≈ (P / (Crr*m*g))^0.5 (zanemaruje aero)
  let v = Math.sqrt(powerWatts / Math.max(b, 1));

  // Newton-Raphson iteracija (5 iteracija je dovoljno za konvergenciju)
  for (let i = 0; i < 8; i++) {
    const f  = a * v * v * v + b * v - powerWatts;
    const fp = 3 * a * v * v + b;
    if (fp === 0) break;
    v = v - f / fp;
    if (v < 0) v = 0;
  }

  return Math.max(0, v);
}

/**
 * Pretvara brzinu m/s u km/h.
 * @param {number} speedMs - Brzina u m/s
 * @returns {number} Brzina u km/h
 */
export function msToKmh(speedMs) {
  return speedMs * 3.6;
}

/**
 * Iz 1Hz workout streama računa distance i speed za svaku sekundu.
 * Vraća obogaćeni stream i ukupne statistike.
 * 
 * @param {Array} workoutHistory - Array objekata {time, power, hr, cadence}
 * @param {number} massKg - Masa korisnika u kg
 * @returns {{stream: Array, totalDistanceM: number, avgSpeedKmh: number}}
 */
export function calculateDistanceStream(workoutHistory, massKg) {
  if (!workoutHistory || workoutHistory.length === 0) {
    return { stream: [], totalDistanceM: 0, avgSpeedKmh: 0 };
  }

  let cumulativeDistanceM = 0;
  let totalSpeedSum = 0;
  let validSpeedCount = 0;

  const stream = workoutHistory.map((point) => {
    const speedMs = speedFromPower(point.power || 0, massKg);
    cumulativeDistanceM += speedMs; // 1 sekunda × brzina = prijeđeni put
    const speedKmh = msToKmh(speedMs);

    if (point.power > 0) {
      totalSpeedSum += speedKmh;
      validSpeedCount++;
    }

    return {
      t: point.time,
      p: point.power || 0,
      hr: point.hr || 0,
      cad: point.cadence || 0,
      spd: Math.round(speedKmh * 10) / 10,
      dist: Math.round(cumulativeDistanceM * 10) / 10
    };
  });

  return {
    stream,
    totalDistanceM: Math.round(cumulativeDistanceM * 10) / 10,
    avgSpeedKmh: validSpeedCount > 0
      ? Math.round((totalSpeedSum / validSpeedCount) * 10) / 10
      : 0
  };
}

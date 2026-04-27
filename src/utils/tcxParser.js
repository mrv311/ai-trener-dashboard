/**
 * TCX Parser - Parsira TCX datoteke i izvlači stream podatke
 */

/**
 * Parsira TCX datoteku i vraća stream podatke
 * @param {string} tcxText - TCX XML sadržaj
 * @returns {Object} - { stream: Array, metadata: Object }
 */
export function parseTCX(tcxText) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(tcxText, 'text/xml');
    
    // Provjeri ima li parsing grešaka
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Nevažeća TCX datoteka');
    }
    
    // Dohvati sve Trackpoint elemente
    const trackpoints = xmlDoc.querySelectorAll('Trackpoint');
    
    if (trackpoints.length === 0) {
      throw new Error('Nema podataka u TCX datoteci');
    }
    
    const stream = [];
    let startTime = null;
    let totalDistance = 0;
    
    trackpoints.forEach((tp, index) => {
      // Vrijeme
      const timeEl = tp.querySelector('Time');
      if (!timeEl) return;
      
      const timestamp = new Date(timeEl.textContent);
      if (!startTime) startTime = timestamp;
      
      const elapsedSeconds = Math.round((timestamp - startTime) / 1000);
      
      // Snaga (Watts)
      const powerEl = tp.querySelector('Watts');
      const power = powerEl ? parseInt(powerEl.textContent) : 0;
      
      // Puls (HeartRateBpm)
      const hrEl = tp.querySelector('HeartRateBpm Value');
      const hr = hrEl ? parseInt(hrEl.textContent) : 0;
      
      // Kadenca (Cadence)
      const cadEl = tp.querySelector('Cadence');
      const cadence = cadEl ? parseInt(cadEl.textContent) : 0;
      
      // Brzina (Speed) - u m/s, pretvaramo u km/h
      const speedEl = tp.querySelector('Speed');
      const speedMs = speedEl ? parseFloat(speedEl.textContent) : 0;
      const speedKmh = Math.round(speedMs * 3.6 * 10) / 10;
      
      // Udaljenost (DistanceMeters)
      const distEl = tp.querySelector('DistanceMeters');
      const distance = distEl ? parseFloat(distEl.textContent) : totalDistance;
      totalDistance = distance;
      
      stream.push({
        t: elapsedSeconds,
        p: power,
        hr: hr,
        cad: cadence,
        spd: speedKmh,
        dist: Math.round(distance * 10) / 10
      });
    });
    
    // Metadata
    const activityEl = xmlDoc.querySelector('Activity');
    const sportAttr = activityEl ? activityEl.getAttribute('Sport') : 'Biking';
    
    const lapEl = xmlDoc.querySelector('Lap');
    const totalTimeEl = lapEl ? lapEl.querySelector('TotalTimeSeconds') : null;
    const totalTime = totalTimeEl ? parseFloat(totalTimeEl.textContent) : stream.length;
    
    const distanceEl = lapEl ? lapEl.querySelector('DistanceMeters') : null;
    const totalDistanceM = distanceEl ? parseFloat(distanceEl.textContent) : totalDistance;
    
    const avgHrEl = lapEl ? lapEl.querySelector('AverageHeartRateBpm Value') : null;
    const avgHr = avgHrEl ? parseInt(avgHrEl.textContent) : 0;
    
    const maxHrEl = lapEl ? lapEl.querySelector('MaximumHeartRateBpm Value') : null;
    const maxHr = maxHrEl ? parseInt(maxHrEl.textContent) : 0;
    
    const caloriesEl = lapEl ? lapEl.querySelector('Calories') : null;
    const calories = caloriesEl ? parseInt(caloriesEl.textContent) : 0;
    
    // Izračunaj prosječnu snagu iz streama
    const powerData = stream.filter(s => s.p > 0);
    const avgPower = powerData.length > 0 
      ? Math.round(powerData.reduce((sum, s) => sum + s.p, 0) / powerData.length)
      : 0;
    
    const maxPower = powerData.length > 0
      ? Math.max(...powerData.map(s => s.p))
      : 0;
    
    return {
      stream,
      metadata: {
        sport: sportAttr,
        duration_seconds: Math.round(totalTime),
        distance_m: totalDistanceM,
        avg_hr: avgHr,
        max_hr: maxHr,
        avg_power: avgPower,
        max_power: maxPower,
        calories: calories,
        trackpoints: stream.length
      }
    };
  } catch (error) {
    console.error('TCX parsing error:', error);
    throw new Error(`Greška pri parsiranju TCX datoteke: ${error.message}`);
  }
}

/**
 * Parsira FIT datoteku (placeholder - zahtijeva FIT SDK)
 * Za sada vraća grešku, može se implementirati kasnije
 */
export function parseFIT(fitBuffer) {
  throw new Error('FIT parsing još nije implementiran. Molimo koristite TCX format.');
}

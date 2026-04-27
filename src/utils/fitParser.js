/**
 * FIT File Parser Utility
 * Parsira .FIT datoteke (Garmin, Wahoo, itd.) i pretvara ih u format kompatibilan s aplikacijom
 */

import FitParser from 'fit-file-parser';

/**
 * Parsira FIT datoteku i vraća strukturirane podatke
 * @param {File} file - FIT datoteka iz input elementa
 * @returns {Promise<Object>} - Objekt s metrikama i stream podacima
 */
export const parseFitFile = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Nema datoteke za parsiranje'));
      return;
    }

    // Provjeri ekstenziju
    if (!file.name.toLowerCase().endsWith('.fit')) {
      reject(new Error('Datoteka mora biti .FIT format'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const fitParser = new FitParser({
          force: true,
          speedUnit: 'km/h',
          lengthUnit: 'km',
          temperatureUnit: 'celsius',
          elapsedRecordField: true,
          mode: 'both' // Vraća i liste i laps
        });

        fitParser.parse(arrayBuffer, (error, data) => {
          if (error) {
            console.error('[FIT Parser] Greška:', error);
            reject(new Error('Greška pri parsiranju FIT datoteke: ' + error.message));
            return;
          }

          console.log('[FIT Parser] Uspješno parsirano:', data);

          // Izvuci session podatke (summary)
          const session = data.sessions?.[0] || {};
          const activity = data.activity || {};
          
          // Izvuci record podatke (stream)
          const records = data.records || [];

          // Izračunaj metrike iz session-a
          const startTime = session.start_time || activity.timestamp || new Date();
          const totalTime = session.total_elapsed_time || session.total_timer_time || 0;
          const avgPower = Math.round(session.avg_power || session.normalized_power || 0);
          const maxPower = Math.round(session.max_power || 0);
          const avgHr = Math.round(session.avg_heart_rate || 0);
          const maxHr = Math.round(session.max_heart_rate || 0);
          const avgCadence = Math.round(session.avg_cadence || 0);
          const totalDistance = session.total_distance || 0; // u metrima
          const totalWork = session.total_work ? Math.round(session.total_work / 1000) : 0; // kJ
          const normalizedPower = Math.round(session.normalized_power || 0);
          const intensityFactor = session.intensity_factor || 0;
          const trainingStressScore = Math.round(session.training_stress_score || 0);

          // Pretvori records u stream format
          const streamData = records.map((record, index) => {
            return {
              t: record.timestamp ? Math.floor((new Date(record.timestamp) - new Date(startTime)) / 1000) : index,
              p: Math.round(record.power || 0),
              hr: Math.round(record.heart_rate || 0),
              cad: Math.round(record.cadence || 0),
              spd: record.speed ? parseFloat((record.speed * 3.6).toFixed(2)) : 0, // m/s -> km/h
              dist: record.distance ? Math.round(record.distance) : 0, // metri
              alt: record.altitude ? Math.round(record.altitude) : null,
              temp: record.temperature || null
            };
          });

          // Ako nema NP u session-u, izračunaj ga iz streamova
          let calculatedNP = normalizedPower;
          if (!calculatedNP && streamData.length > 0) {
            calculatedNP = calculateNormalizedPower(streamData);
          }

          // Ako nema TSS, pokušaj izračunati (potreban FTP)
          let calculatedTSS = trainingStressScore;

          const result = {
            // Metrike
            started_at: startTime,
            duration_seconds: Math.round(totalTime),
            avg_power: avgPower,
            max_power: maxPower,
            np: calculatedNP,
            avg_hr: avgHr,
            max_hr: maxHr,
            avg_cadence: avgCadence,
            distance_m: Math.round(totalDistance),
            work_kj: totalWork,
            if_factor: intensityFactor ? parseFloat(intensityFactor.toFixed(2)) : null,
            tss: calculatedTSS,
            avg_speed_kmh: totalDistance && totalTime ? parseFloat(((totalDistance / totalTime) * 3.6).toFixed(2)) : null,
            
            // Stream podaci
            stream_data: streamData,
            
            // Metadata
            sport: session.sport || activity.sport || 'cycling',
            sub_sport: session.sub_sport || activity.sub_sport || null,
            device_manufacturer: data.file_id?.manufacturer || 'unknown',
            device_product: data.file_id?.product || null,
            
            // Raw data za debug
            _raw_session: session,
            _raw_activity: activity
          };

          console.log('[FIT Parser] Rezultat:', {
            duration_seconds: result.duration_seconds,
            duration_minutes: Math.round(result.duration_seconds / 60),
            avg_power: result.avg_power,
            np: result.np,
            stream_length: result.stream_data.length,
            totalTime_from_session: totalTime
          });

          resolve(result);
        });
      } catch (err) {
        console.error('[FIT Parser] Catch error:', err);
        reject(new Error('Greška pri čitanju datoteke: ' + err.message));
      }
    };

    reader.onerror = () => {
      reject(new Error('Greška pri čitanju datoteke'));
    };

    reader.readAsArrayBuffer(file);
  });
};

/**
 * Izračunava Normalized Power iz stream podataka
 * @param {Array} streamData - Array objekata s { t, p, hr, cad, spd }
 * @returns {number} - Normalized Power (NP)
 */
const calculateNormalizedPower = (streamData) => {
  const powerValues = streamData.filter(p => p.p > 0).map(p => p.p);
  
  if (powerValues.length === 0) return 0;

  // NP formula: 4th root of average of 4th power of 30s rolling average
  const rollingAvg = [];
  const windowSize = 30; // 30 sekundi

  for (let i = 0; i < powerValues.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = powerValues.slice(start, i + 1);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    rollingAvg.push(avg);
  }

  const fourthPowers = rollingAvg.map(p => Math.pow(p, 4));
  const avgFourthPower = fourthPowers.reduce((a, b) => a + b, 0) / fourthPowers.length;
  
  return Math.round(Math.pow(avgFourthPower, 0.25));
};

/**
 * Izračunava TSS (Training Stress Score) ako nije dostupan u FIT datoteci
 * @param {number} np - Normalized Power
 * @param {number} durationSeconds - Trajanje u sekundama
 * @param {number} ftp - Functional Threshold Power
 * @returns {number} - TSS
 */
export const calculateTSS = (np, durationSeconds, ftp) => {
  if (!np || !durationSeconds || !ftp || ftp === 0) return 0;
  
  const durationHours = durationSeconds / 3600;
  const intensityFactor = np / ftp;
  const tss = (durationHours * np * intensityFactor) / (ftp * 0.01);
  
  return Math.round(tss);
};

/**
 * Validira FIT datoteku prije parsiranja
 * @param {File} file - Datoteka za validaciju
 * @returns {Object} - { valid: boolean, error: string }
 */
export const validateFitFile = (file) => {
  if (!file) {
    return { valid: false, error: 'Nema datoteke' };
  }

  if (!file.name.toLowerCase().endsWith('.fit')) {
    return { valid: false, error: 'Datoteka mora biti .FIT format' };
  }

  // Provjeri veličinu (max 50MB)
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return { valid: false, error: 'Datoteka je prevelika (max 50MB)' };
  }

  if (file.size === 0) {
    return { valid: false, error: 'Datoteka je prazna' };
  }

  return { valid: true };
};

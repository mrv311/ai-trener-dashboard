import FitParser from 'fit-file-parser';
import { calculateCogganMetrics } from './performanceMetrics';

/**
 * Parsira .fit datoteku u standardizirani stream_data format
 * @param {ArrayBuffer} buffer - Binarni sadržaj FIT datoteke
 * @returns {Promise<Object>} { stream_data, title, duration, startedAt, summary }
 */
export async function parseFIT(buffer) {
  return new Promise((resolve, reject) => {
    const fitParser = new FitParser({
      forceSetMessageName: false,
      lengthUnit: 'm', // Keep distance in meters
      lengthUnitOption: 'm',
      temperatureUnit: 'celsius',
      speedUnit: 'km/h',
      forceSetUnit: false,
      elapsedRecordField: true,
      mode: 'list',
    });

    fitParser.parse(buffer, (error, data) => {
      if (error) {
        reject(new Error("Greška pri parsiranju FIT datoteke: " + error.message));
        return;
      }

      try {
        let stream_data = [];
        let startedAt = new Date();
        
        if (data.activity && data.activity.timestamp) {
          startedAt = new Date(data.activity.timestamp);
        } else if (data.session && data.session.length > 0 && data.session[0].start_time) {
          startedAt = new Date(data.session[0].start_time);
        }

        if (!data.records || data.records.length === 0) {
           reject(new Error("FIT datoteka ne sadrži zapise o aktivnosti (prazan stream)."));
           return;
        }

        // Osiguraj start time iz prvog recorda ako nedostaje
        if (!startedAt && data.records.length > 0 && data.records[0].timestamp) {
           startedAt = new Date(data.records[0].timestamp);
        }

        const startTimestamp = startedAt.getTime();

        data.records.forEach((record) => {
          if (!record.timestamp) return;
          const pointTimeMs = new Date(record.timestamp).getTime();
          const t = Math.round((pointTimeMs - startTimestamp) / 1000);
          
          if (t >= 0) {
            stream_data.push({
              t: t,
              p: record.power || 0,
              hr: record.heart_rate || 0,
              cad: record.cadence || 0,
              dist: record.distance ? record.distance : 0,
              spd: record.speed ? record.speed : 0
            });
          }
        });

        // Ensure sorted by time
        stream_data.sort((a, b) => a.t - b.t);
        
        const title = "Učitani Trening (FIT)";
        
        // Attempt to extract sport
        let sport = 'other';
        if (data.sport && data.sport.length > 0) {
           sport = String(data.sport[0].sport || 'other').toLowerCase();
        } else if (data.session && data.session.length > 0) {
           sport = String(data.session[0].sport || 'other').toLowerCase();
        } else if (data.activity && data.activity.sessions && data.activity.sessions.length > 0) {
           sport = String(data.activity.sessions[0].sport || 'other').toLowerCase();
        }
        if (sport === 'biking' || sport === 'mountain_biking' || sport === 'gravel_cycling' || sport === 'e_biking' || sport === 'cycling') {
           sport = 'cycling';
        }

        resolve({
          title,
          startedAt,
          sport,
          stream_data
        });
      } catch (err) {
        reject(new Error("Neispravan format FIT datoteke."));
      }
    });
  });
}

/**
 * Parsira .tcx datoteku (XML string) u standardizirani stream_data format
 * @param {string} xmlString - Sadržaj TCX datoteke
 * @returns {Object} { stream_data, title, duration, startedAt, summary }
 */
export function parseTCX(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  
  if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Greška pri parsiranju XML/TCX datoteke.");
  }

  const activities = xmlDoc.getElementsByTagName("Activity");
  if (activities.length === 0) {
    throw new Error("TCX datoteka ne sadrži aktivnost.");
  }

  const activity = activities[0];
  const idNode = activity.getElementsByTagName("Id")[0];
  let startedAt = idNode ? new Date(idNode.textContent) : new Date();
  
  const notesNode = activity.getElementsByTagName("Notes")[0];
  const title = notesNode ? notesNode.textContent : "Učitani Trening (TCX)";

  const sportAttr = activity.getAttribute("Sport");
  let sport = 'other';
  if (sportAttr) {
    const sl = sportAttr.toLowerCase();
    if (sl === 'biking' || sl === 'cycling') sport = 'cycling';
    else if (sl === 'running') sport = 'running';
    else sport = sl;
  }

  const trackpoints = xmlDoc.getElementsByTagName("Trackpoint");
  if (trackpoints.length === 0) {
    throw new Error("TCX datoteka ne sadrži zapisane točke (trackpoints).");
  }

  const startTimestamp = startedAt.getTime();
  const stream_data = [];

  for (let i = 0; i < trackpoints.length; i++) {
    const tp = trackpoints[i];
    
    const timeNode = tp.getElementsByTagName("Time")[0];
    if (!timeNode) continue;
    
    const pointTimeMs = new Date(timeNode.textContent).getTime();
    const t = Math.round((pointTimeMs - startTimestamp) / 1000);
    
    if (t < 0) continue; // Skip points before start somehow

    const hrNode = tp.getElementsByTagName("HeartRateBpm")[0];
    const hr = hrNode ? parseFloat(hrNode.getElementsByTagName("Value")[0]?.textContent || 0) : 0;

    const cadNode = tp.getElementsByTagName("Cadence")[0];
    const cad = cadNode ? parseFloat(cadNode.textContent || 0) : 0;

    const distNode = tp.getElementsByTagName("DistanceMeters")[0];
    const dist = distNode ? parseFloat(distNode.textContent || 0) : 0;

    // Extend metrics (Power, Speed) in TPX
    let p = 0;
    let spd = 0;
    
    const tpxNode = tp.getElementsByTagName("TPX")[0]; // Assuming garmin extension
    if (tpxNode) {
      const wattsNode = tpxNode.getElementsByTagName("Watts")[0];
      if (wattsNode) p = parseFloat(wattsNode.textContent || 0);

      const speedNode = tpxNode.getElementsByTagName("Speed")[0];
      if (speedNode) spd = parseFloat(speedNode.textContent || 0) * 3.6; // convert m/s to km/h
    }

    stream_data.push({
      t,
      p,
      hr,
      cad,
      dist,
      spd
    });
  }

  // Ensure sorted by time
  stream_data.sort((a, b) => a.t - b.t);

  return {
    title,
    startedAt,
    sport,
    stream_data
  };
}

/**
 * Obogaćuje parsiranu aktivnost sa računatim metrikama za bazu
 */
export function processActivityStream(parsedActivity, userFtp = 200, userMass = 75) {
  const { stream_data, title, startedAt, sport } = parsedActivity;
  
  if (!stream_data || stream_data.length === 0) {
    throw new Error("Aktivnost nema dovoljno podataka za analizu.");
  }

  const duration_seconds = stream_data[stream_data.length - 1].t;
  
  // Array format za Coggan funkcije
  const powerArray = stream_data.map(d => d.p || 0);
  
  // Averages
  const pwrData = stream_data.filter(d => d.p > 0);
  const hrData = stream_data.filter(d => d.hr > 0);
  const cadData = stream_data.filter(d => d.cad > 0);

  const avgPower = pwrData.length ? Math.round(pwrData.reduce((a, b) => a + b.p, 0) / pwrData.length) : 0;
  const avgHr = hrData.length ? Math.round(hrData.reduce((a, b) => a + b.hr, 0) / hrData.length) : 0;
  const avgCadence = cadData.length ? Math.round(cadData.reduce((a, b) => a + b.cad, 0) / cadData.length) : 0;
  const distance_m = stream_data[stream_data.length - 1].dist || 0;
  
  // Speed is often unreliable average, so total distance / time is better if distance exists
  let avgSpeedKmh = 0;
  if (distance_m > 0 && duration_seconds > 0) {
    avgSpeedKmh = (distance_m / 1000) / (duration_seconds / 3600);
  } else {
    const spdData = stream_data.filter(d => d.spd > 0);
    avgSpeedKmh = spdData.length ? spdData.reduce((a, b) => a + b.spd, 0) / spdData.length : 0;
  }

  const finalMetrics = calculateCogganMetrics(powerArray, userFtp);

  let tss = finalMetrics.tss;
  if (tss === 0 && avgHr > 0) {
    // Procjena hrTSS (Heart Rate TSS) ako nema mjerača snage
    // Koristimo pretpostavljeni LTHR od 165 ako nije poznat
    const lthr = 165;
    const intensity = avgHr / lthr;
    tss = Math.round((duration_seconds / 3600) * (intensity * intensity * intensity) * 100); 
    // Joe Friel hrTSS approximation (intensity^3 can be used or similar, we'll use a standard scaling)
    tss = Math.round((duration_seconds / 3600) * Math.pow(intensity, 2) * 100);
  }

  const workoutSource = sport ? `external_upload_${sport}` : 'external_upload';

  return {
    started_at: startedAt.toISOString(),
    title: title,
    workout_source: workoutSource,
    duration_seconds: duration_seconds,
    avg_power: avgPower,
    avg_hr: avgHr,
    avg_cadence: avgCadence,
    np: finalMetrics.np,
    tss: tss,
    if_factor: parseFloat(finalMetrics.ifFactor),
    work_kj: finalMetrics.workKj,
    distance_m: distance_m,
    avg_speed_kmh: Math.round(avgSpeedKmh * 10) / 10,
    ftp_used: userFtp,
    weight_kg: userMass,
    stream_data: stream_data
  };
}

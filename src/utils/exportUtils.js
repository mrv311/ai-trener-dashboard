/**
* Generira trackpoint XML iz jednog podatkovnog punkta.
* Podržava i stari format (workoutHistory) i novi JSONB format (stream_data).
*/
import { FitWriter } from '@markw65/fit-file-writer';
import { calculateDistanceStream } from './virtualDistance.js';

const buildTrackpoint = (pointTime, power, hr, cadence, distanceM, speedKmh) => {
  let tp = `
        <Trackpoint>
          <Time>${pointTime.toISOString()}</Time>`;

  if (distanceM != null && distanceM > 0) {
    tp += `
          <DistanceMeters>${Math.round(distanceM * 10) / 10}</DistanceMeters>`;
  }

  if (hr > 0) {
    tp += `
          <HeartRateBpm>
            <Value>${Math.round(hr)}</Value>
          </HeartRateBpm>`;
  }

  if (cadence > 0) {
    tp += `
          <Cadence>${Math.round(cadence)}</Cadence>`;
  }

  if (power > 0 || (speedKmh != null && speedKmh > 0)) {
    tp += `
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">`;

    if (speedKmh != null && speedKmh > 0) {
      tp += `
              <Speed>${(speedKmh / 3.6).toFixed(3)}</Speed>`;
    }

    if (power > 0) {
      tp += `
              <Watts>${Math.round(power)}</Watts>`;
    }

    tp += `
            </TPX>
          </Extensions>`;
  }

  tp += `
        </Trackpoint>`;
  return tp;
};

/**
 * Wrapa trackpoints u puni TCX XML dokument.
 */
const wrapTCX = (trackpoints, startTime, durationSecs, workoutName) => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
  xmlns:ns5="http://www.garmin.com/xmlschemas/ActivityGoals/v1"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns:ns2="http://www.garmin.com/xmlschemas/UserProfile/v2"
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTime.toISOString()}</Id>
      <Lap StartTime="${startTime.toISOString()}">
        <TotalTimeSeconds>${durationSecs}</TotalTimeSeconds>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpoints}
        </Track>
      </Lap>
      <Notes>${workoutName}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
};

/**
 * Pokreće preuzimanje TCX datoteke u pregledniku.
 */
const downloadTCX = (tcxString, workoutName, startTime) => {
  const blob = new Blob([tcxString], { type: 'application/vnd.garmin.tcx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileNameDate = startTime.toISOString().split('T')[0];
  const safeName = workoutName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.download = `trening_${safeName}_${fileNameDate}.tcx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
};

/**
 * Exportira trening iz živog workoutHistory arraya (koristi se u TrainerTab).
 * Originalna funkcionalnost — sada koristi zajedničke helper-e.
 */
export const exportToTCX = (workoutHistory, workoutName = "Trening", sessionStartTime = null, userMassKg = 75) => {
  if (!workoutHistory || workoutHistory.length === 0) return null;

  const durationSecs = workoutHistory[workoutHistory.length - 1].time;

  let startTime;
  if (sessionStartTime) {
    startTime = new Date(sessionStartTime);
  } else {
    startTime = new Date();
    startTime.setSeconds(startTime.getSeconds() - durationSecs);
  }

  // Generiraj stream s brzinom i udaljenosti
  const distResult = calculateDistanceStream(workoutHistory, userMassKg || 75);
  const enrichedStream = distResult.stream;

  let trackpoints = '';
  enrichedStream.forEach((point) => {
    const pointTime = new Date(startTime.getTime() + point.t * 1000);
    trackpoints += buildTrackpoint(pointTime, point.p, point.hr, point.cad, point.dist, point.spd);
  });

  const tcxString = wrapTCX(trackpoints, startTime, durationSecs, workoutName);
  downloadTCX(tcxString, workoutName, startTime);
};

/**
 * Exportira trening iz JSONB stream_data (koristi se u HistoryTab za prošle treninge).
 * Stream format: [{t, p, hr, cad, spd, dist}]
 * 
 * @param {Array} streamData - JSONB stream podatci iz Supabase
 * @param {string} title - Naziv treninga
 * @param {string} startedAtISO - ISO string vremena početka treninga
 */
export const exportTCXFromStream = (streamData, title = "Trening", startedAtISO) => {
  if (!streamData || streamData.length === 0) return null;

  const startTime = new Date(startedAtISO);
  const durationSecs = streamData[streamData.length - 1].t;

  let trackpoints = '';
  streamData.forEach((point) => {
    const pointTime = new Date(startTime.getTime() + point.t * 1000);
    trackpoints += buildTrackpoint(pointTime, point.p, point.hr, point.cad, point.dist, point.spd);
  });

  const tcxString = wrapTCX(trackpoints, startTime, durationSecs, title);
  downloadTCX(tcxString, title, startTime);
};

/**
 * Pomoćna funkcija za kreiranje binarnih FIT formata (kompatibilno s Garmin Connect, Strava, Intervals.icu, Wahoo)
 */
const generateFitData = (samples, startTime) => {
  const fw = new FitWriter();
  const fitStart = fw.time(startTime);

  const durationSecs = samples.length > 0
    ? (samples[samples.length - 1].t !== undefined ? samples[samples.length - 1].t : samples[samples.length - 1].time) || 0
    : 0;
  const endTime = new Date(startTime.getTime() + durationSecs * 1000);
  const fitEnd = fw.time(endTime);

  fw.writeMessage("file_id", {
    type: "activity",
    manufacturer: "development",
    product: 1,
    serial_number: 0x45524756, // "ERGV"
    time_created: fitStart
  }, null, true);

  fw.writeMessage("event", {
    timestamp: fitStart,
    event: "timer",
    event_type: "start"
  });

  let sumPower = 0; let countPower = 0; let maxPower = 0;
  let sumHr = 0; let countHr = 0; let maxHr = 0;
  let sumCad = 0; let countCad = 0; let maxCad = 0;
  let maxSpeedMs = 0;
  let totalDistance = 0;

  samples.forEach((sample, idx) => {
    const t = sample.t !== undefined ? sample.t : sample.time;
    const p = sample.p !== undefined ? sample.p : sample.power;
    const hr = sample.hr;
    const cad = sample.cad !== undefined ? sample.cad : sample.cadence;
    const dist = sample.dist !== undefined ? sample.dist : null;
    const spdKmh = sample.spd !== undefined ? sample.spd : null;

    const pTime = new Date(startTime.getTime() + t * 1000);
    const record = { timestamp: fw.time(pTime) };

    if (dist != null && dist >= 0) {
      record.distance = dist;
      if (dist > totalDistance) totalDistance = dist;
    }
    if (spdKmh != null && spdKmh >= 0) {
      const spdMs = spdKmh / 3.6; // Pretvaranje km/h u m/s za FIT
      record.speed = spdMs;
      if (spdMs > maxSpeedMs) maxSpeedMs = spdMs;
    }
    if (hr > 0) {
      const roundedHr = Math.round(hr);
      record.heart_rate = roundedHr;
      sumHr += roundedHr;
      countHr++;
      if (roundedHr > maxHr) maxHr = roundedHr;
    }
    if (cad > 0) {
      const roundedCad = Math.round(cad);
      record.cadence = roundedCad;
      sumCad += roundedCad;
      countCad++;
      if (roundedCad > maxCad) maxCad = roundedCad;
    }
    if (p != null && p >= 0) {
      const roundedP = Math.round(p);
      record.power = roundedP;
      if (roundedP > 0) {
        sumPower += roundedP;
        countPower++;
        if (roundedP > maxPower) maxPower = roundedP;
      }
    }

    fw.writeMessage("record", record, null, idx === samples.length - 1);
  });

  fw.writeMessage("event", {
    timestamp: fitEnd,
    event: "timer",
    event_type: "stop_all"
  }, null, true);

  const avgPower = countPower > 0 ? Math.round(sumPower / countPower) : 0;
  const avgHr = countHr > 0 ? Math.round(sumHr / countHr) : 0;
  const avgCad = countCad > 0 ? Math.round(sumCad / countCad) : 0;
  const avgSpeedMs = durationSecs > 0 && totalDistance > 0 ? totalDistance / durationSecs : 0;
  const totalWorkJ = Math.round(sumPower); // 1 uzorak u sekundi = J

  const summaryBase = {
    timestamp: fitEnd,
    start_time: fitStart,
    total_elapsed_time: durationSecs,
    total_timer_time: durationSecs,
    total_distance: totalDistance,
    sport: "cycling",
    sub_sport: "indoor_cycling",
    event: "lap",
    event_type: "stop"
  };

  if (avgPower > 0) {
    summaryBase.avg_power = avgPower;
    summaryBase.max_power = maxPower;
    summaryBase.total_work = totalWorkJ;
    summaryBase.total_calories = Math.round(totalWorkJ / 1000);
  }
  if (avgHr > 0) {
    summaryBase.avg_heart_rate = avgHr;
    summaryBase.max_heart_rate = maxHr;
  }
  if (avgCad > 0) {
    summaryBase.avg_cadence = avgCad;
    summaryBase.max_cadence = maxCad;
  }
  if (avgSpeedMs > 0) {
    summaryBase.avg_speed = avgSpeedMs;
    summaryBase.max_speed = maxSpeedMs;
  }

  fw.writeMessage("lap", summaryBase, null, true);

  fw.writeMessage("session", {
    ...summaryBase,
    first_lap_index: 0,
    num_laps: 1,
    trigger: "activity_end"
  }, null, true);

  fw.writeMessage("activity", {
    timestamp: fitEnd,
    total_timer_time: durationSecs,
    num_sessions: 1,
    type: "manual",
    event: "activity",
    event_type: "stop",
    local_timestamp: fitEnd - endTime.getTimezoneOffset() * 60
  }, null, true);

  const myFitData = fw.finish();
  return new Uint8Array(myFitData.buffer, myFitData.byteOffset, myFitData.byteLength);
};

/**
 * Generira binarni FIT Uint8Array iz živog workoutHistory niza (za upload ili preuzimanje).
 */
export const buildFitUint8Array = (workoutHistory, sessionStartTime = null, userMassKg = 75) => {
  if (!workoutHistory || workoutHistory.length === 0) return null;
  const durationSecs = workoutHistory[workoutHistory.length - 1].time;

  let startTime;
  if (sessionStartTime) {
    startTime = new Date(sessionStartTime);
  } else {
    startTime = new Date();
    startTime.setSeconds(startTime.getSeconds() - durationSecs);
  }

  const distResult = calculateDistanceStream(workoutHistory, userMassKg || 75);
  const enrichedStream = distResult.stream;

  return {
    uint8: generateFitData(enrichedStream, startTime),
    startTime
  };
};

/**
 * Preuzima generirani FIT format
 */
const downloadFIT = (uint8, workoutName, startTime) => {
  const blob = new Blob([uint8], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileNameDate = startTime.toISOString().split('T')[0];
  const safeName = workoutName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.download = `trening_${safeName}_${fileNameDate}.fit`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
};

export const exportToFIT = (workoutHistory, workoutName = "Trening", sessionStartTime = null, userMassKg = 75) => {
  const built = buildFitUint8Array(workoutHistory, sessionStartTime, userMassKg);
  if (!built) return null;
  downloadFIT(built.uint8, workoutName, built.startTime);
};

export const exportFITFromStream = (streamData, title = "Trening", startedAtISO) => {
  if (!streamData || streamData.length === 0) return null;
  const startTime = startedAtISO ? new Date(startedAtISO) : new Date();
  const safeStart = isNaN(startTime.getTime()) ? new Date() : startTime;
  const fitArray = generateFitData(streamData, safeStart);
  downloadFIT(fitArray, title, safeStart);
};

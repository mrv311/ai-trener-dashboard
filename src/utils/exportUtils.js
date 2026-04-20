/**
 * Generira trackpoint XML iz jednog podatkovnog punkta.
 * Podržava i stari format (workoutHistory) i novi JSONB format (stream_data).
 */
import { FitWriter } from '@markw65/fit-file-writer';
const buildTrackpoint = (pointTime, power, hr, cadence, distanceM) => {
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

  if (power > 0) {
    tp += `
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <Watts>${Math.round(power)}</Watts>
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
export const exportToTCX = (workoutHistory, workoutName = "Trening") => {
  if (!workoutHistory || workoutHistory.length === 0) return null;

  const startTime = new Date();
  const durationSecs = workoutHistory[workoutHistory.length - 1].time;
  startTime.setSeconds(startTime.getSeconds() - durationSecs);

  let trackpoints = '';
  workoutHistory.forEach((point) => {
    const pointTime = new Date(startTime.getTime() + point.time * 1000);
    trackpoints += buildTrackpoint(pointTime, point.power, point.hr, point.cadence, null);
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
    trackpoints += buildTrackpoint(pointTime, point.p, point.hr, point.cad, point.dist);
  });

  const tcxString = wrapTCX(trackpoints, startTime, durationSecs, title);
  downloadTCX(tcxString, title, startTime);
};

/**
 * Pomoćna funkcija za kreiranje binarnih FIT formata
 */
const generateFitData = (samples, startTime) => {
  const fw = new FitWriter();
  const fitStart = fw.time(startTime);
  
  fw.writeMessage("file_id", {
    type: "activity",
    manufacturer: "development",
    time_created: fitStart
  }, null, true);

  const durationSecs = samples.length > 0 ? (samples[samples.length - 1].t !== undefined ? samples[samples.length - 1].t : samples[samples.length - 1].time) : 0;
  
  fw.writeMessage("session", {
    start_time: fitStart,
    total_elapsed_time: durationSecs,
    total_timer_time: durationSecs,
  }, null, true);
  
  samples.forEach((sample) => {
    const t = sample.t !== undefined ? sample.t : sample.time;
    const p = sample.p !== undefined ? sample.p : sample.power;
    const hr = sample.hr !== undefined ? sample.hr : sample.hr;
    const cad = sample.cad !== undefined ? sample.cad : sample.cadence;
    const dist = sample.dist !== undefined ? sample.dist : null;
    const spdKmh = sample.spd !== undefined ? sample.spd : null;
    
    const pTime = new Date(startTime.getTime() + t * 1000);
    const record = { timestamp: fw.time(pTime) };
    
    if (dist != null && dist > 0) record.distance = dist;
    if (spdKmh != null && spdKmh > 0) record.speed = spdKmh / 3.6; // Pretvaranje km/h u m/s za FIT
    if (hr > 0) record.heart_rate = Math.round(hr);
    if (cad > 0) record.cadence = Math.round(cad);
    if (p > 0) record.power = Math.round(p);
    
    fw.writeMessage("record", record);
  });
  
  const myFitData = fw.finish();
  return new Uint8Array(myFitData.buffer, myFitData.byteOffset, myFitData.byteLength);
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

export const exportToFIT = (workoutHistory, workoutName = "Trening") => {
  if (!workoutHistory || workoutHistory.length === 0) return null;
  const startTime = new Date();
  const durationSecs = workoutHistory[workoutHistory.length - 1].time;
  startTime.setSeconds(startTime.getSeconds() - durationSecs);
  
  const fitArray = generateFitData(workoutHistory, startTime);
  downloadFIT(fitArray, workoutName, startTime);
};

export const exportFITFromStream = (streamData, title = "Trening", startedAtISO) => {
  if (!streamData || streamData.length === 0) return null;
  const startTime = new Date(startedAtISO);
  const fitArray = generateFitData(streamData, startTime);
  downloadFIT(fitArray, title, startTime);
};

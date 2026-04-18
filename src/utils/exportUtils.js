/**
 * Generira trackpoint XML iz jednog podatkovnog punkta.
 * Podržava i stari format (workoutHistory) i novi JSONB format (stream_data).
 */
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

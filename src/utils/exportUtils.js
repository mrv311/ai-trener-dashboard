export const exportToTCX = (workoutHistory, workoutName = "Trening") => {
  if (!workoutHistory || workoutHistory.length === 0) return null;

  const startTime = new Date();
  
  // Pretpostavljamo da povijest sadrži 1 sekundu po unosu i počinje od nule.
  // Za preciznije rezultate možemo oduzeti total duration da dobijemo pravo vrijeme početka (ako spremamo vrijeme).
  // Ovdje jednostavno počinjemo od "sada" minus trajanje treninga
  const durationSecs = workoutHistory[workoutHistory.length - 1].time;
  startTime.setSeconds(startTime.getSeconds() - durationSecs);

  let trackpoints = '';

  workoutHistory.forEach((point) => {
    // point = { time: s, power: w, hr: bpm, cadence: rpm }
    const pointTime = new Date(startTime.getTime() + point.time * 1000);
    
    let tp = `
        <Trackpoint>
          <Time>${pointTime.toISOString()}</Time>`;
          
    if (point.hr > 0) {
      tp += `
          <HeartRateBpm>
            <Value>${Math.round(point.hr)}</Value>
          </HeartRateBpm>`;
    }
    
    if (point.cadence > 0) {
      tp += `
          <Cadence>${Math.round(point.cadence)}</Cadence>`;
    }

    // Ekstenzije za snagu (Power)
    if (point.power > 0) {
      tp += `
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <Watts>${Math.round(point.power)}</Watts>
            </TPX>
          </Extensions>`;
    }
    
    tp += `
        </Trackpoint>`;
        
    trackpoints += tp;
  });

  const tcxString = `<?xml version="1.0" encoding="UTF-8"?>
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

  // Stvoriti Blob i blob URL
  const blob = new Blob([tcxString], { type: 'application/vnd.garmin.tcx+xml' });
  const url = URL.createObjectURL(blob);

  // Automatsko pokretanje preuzimanja
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

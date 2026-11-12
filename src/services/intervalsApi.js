const FETCH_PAST_MONTHS = 36;
const FETCH_FUTURE_MONTHS = 3;

const getAuthHeaders = (apiKey) => {
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey.toLowerCase().startsWith('bearer ')) {
    return { 
      'Authorization': cleanKey, 
      'Accept': 'application/json' 
    };
  }
  if (cleanKey.toLowerCase().startsWith('oauth:')) {
    return { 
      'Authorization': `Bearer ${cleanKey.slice(6).trim()}`, 
      'Accept': 'application/json' 
    };
  }
  const authString = btoa(`API_KEY:${cleanKey}`);
  return { 
    'Authorization': `Basic ${authString}`, 
    'Accept': 'application/json' 
  };
};

const getDateRange = () => {
  const todayObj = new Date();
  const pastDate = new Date(); 
  pastDate.setMonth(todayObj.getMonth() - FETCH_PAST_MONTHS);
  
  const futureDate = new Date(); 
  futureDate.setMonth(todayObj.getMonth() + FETCH_FUTURE_MONTHS);

  const oldest = pastDate.toISOString().split('T')[0];
  const newest = futureDate.toISOString().split('T')[0];
  return { oldest, newest };
};

/**
 * Pomaže izvući točne biciklističke parametre (FTP, težinu, max HR, LTHR, zone)
 * iz Intervals.icu odgovora /api/v1/athlete/{id}.
 * Intervals.icu sprema biciklističke postavke unutar niza sportSettings (za tipove 'Ride', 'VirtualRide').
 */
export const extractIntervalsAthleteMetrics = (athlete) => {
  if (!athlete) return null;

  let cyclingSettings = null;
  if (Array.isArray(athlete.sportSettings)) {
    // 1. Traži sportSettings koji eksplicitno sadrže 'Ride' ili 'VirtualRide'
    cyclingSettings = athlete.sportSettings.find(s => 
      (Array.isArray(s.types) && (s.types.includes('Ride') || s.types.includes('VirtualRide'))) ||
      s.id === 'Ride' || s.id === 'VirtualRide'
    );
    // 2. Traži bilo koji s definiranim ftp
    if (!cyclingSettings) {
      cyclingSettings = athlete.sportSettings.find(s => s.ftp && Number(s.ftp) > 0);
    }
    // 3. Ako još uvijek nema, uzmi prvi
    if (!cyclingSettings && athlete.sportSettings.length > 0) {
      cyclingSettings = athlete.sportSettings[0];
    }
  }

  // Provjeri cyclingSettings, pa root polja na athlete objektu
  const rawFtp = cyclingSettings?.ftp ?? athlete.icu_ftp ?? athlete.ftp ?? cyclingSettings?.eftp;
  const ftp = Number(rawFtp);

  const rawWeight = athlete.weight ?? athlete.icu_weight ?? cyclingSettings?.weight;
  const weight = Number(rawWeight);

  const rawMaxHr = cyclingSettings?.max_hr ?? athlete.icu_max_hr ?? athlete.max_hr;
  const maxHr = Number(rawMaxHr);

  const rawLthr = cyclingSettings?.lthr ?? athlete.icu_threshold_hr ?? athlete.lthr;
  const thresholdHr = Number(rawLthr);

  const firstName = athlete.firstname || (athlete.name ? athlete.name.trim().split(' ')[0] : '');

  return {
    name: athlete.name || '',
    firstName: firstName || 'Vozač',
    ftp: (!isNaN(ftp) && ftp > 0) ? ftp : null,
    weight: (!isNaN(weight) && weight > 0) ? weight : null,
    maxHr: (!isNaN(maxHr) && maxHr > 0) ? maxHr : null,
    thresholdHr: (!isNaN(thresholdHr) && thresholdHr > 0) ? thresholdHr : null,
    powerZones: cyclingSettings?.power_zones || null,
    hrZones: cyclingSettings?.hr_zones || null,
    sportSettings: cyclingSettings
  };
};

export const enrichAthleteObject = (athlete) => {
  if (!athlete) return athlete;
  const metrics = extractIntervalsAthleteMetrics(athlete);
  if (metrics) {
    if (metrics.ftp) {
      athlete.ftp = metrics.ftp;
      athlete.icu_ftp = metrics.ftp;
    }
    if (metrics.weight) {
      athlete.weight = metrics.weight;
      athlete.icu_weight = metrics.weight;
    }
    if (metrics.maxHr) {
      athlete.max_hr = metrics.maxHr;
      athlete.icu_max_hr = metrics.maxHr;
    }
    if (metrics.thresholdHr) {
      athlete.lthr = metrics.thresholdHr;
      athlete.icu_threshold_hr = metrics.thresholdHr;
    }
    athlete._metrics = metrics;
  }
  return athlete;
};

/**
 * Dohvaća profil sportaša s Intervals.icu (ime, FTP, težina, zone pulsa).
 * GET /api/v1/athlete/{id}
 */
export const fetchAthleteProfile = async (intervalsId, intervalsKey) => {
  const cleanId = String(intervalsId || '').trim();
  if (!cleanId || !intervalsKey) return null;
  const headers = getAuthHeaders(intervalsKey);
  try {
    const res = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}`, { headers });
    if (!res.ok) return null;
    const raw = await res.json();

    // Ako nema sportSettings ili FTP-a, pokušaj dohvatiti specifične biciklističke postavke
    if (raw && !extractIntervalsAthleteMetrics(raw)?.ftp) {
      try {
        const sportRes = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/sport-settings/Ride`, { headers });
        if (sportRes.ok) {
          const rideSettings = await sportRes.json();
          if (rideSettings) {
            raw.sportSettings = Array.isArray(raw.sportSettings) ? [...raw.sportSettings, rideSettings] : [rideSettings];
          }
        }
      } catch (e) {}
    }

    return enrichAthleteObject(raw);
  } catch (err) {
    console.warn('[intervalsApi] fetchAthleteProfile greška:', err);
    return null;
  }
};

export const fetchIntervalsData = async (intervalsId, intervalsKey, options = {}) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = getAuthHeaders(intervalsKey);
  
  let oldest = options.oldest;
  let newest = options.newest;
  
  if (!oldest || !newest) {
    const range = getDateRange();
    oldest = oldest || range.oldest;
    newest = newest || range.newest;
  }

  const actUrl = `https://intervals.icu/api/v1/athlete/${cleanId}/activities?oldest=${oldest}&newest=${newest}`;
  const evUrl = `https://intervals.icu/api/v1/athlete/${cleanId}/events?oldest=${oldest}&newest=${newest}&resolve=true`;
  const wellUrl = `https://intervals.icu/api/v1/athlete/${cleanId}/wellness?oldest=${oldest}&newest=${newest}`;
  const athUrl = `https://intervals.icu/api/v1/athlete/${cleanId}`;

  const actRes = await fetch(actUrl, { headers });
  
  if (actRes.status === 401) throw new Error("API ključ ili ID su neispravni.");
  if (actRes.status === 429) throw new Error("Previše zahtjeva prema serveru. Pričekaj malo.");
  if (!actRes.ok) throw new Error("Greška pri spajanju na server.");

  const [evRes, wellRes, athRes] = await Promise.all([
    fetch(evUrl, { headers }),
    fetch(wellUrl, { headers }),
    fetch(athUrl, { headers }).catch(e => {
      console.warn('[intervalsApi] Neuspjelo dohvaćanje sportaša:', e);
      return { ok: false };
    })
  ]);

  const activities = await actRes.json();
  const events = evRes.ok ? await evRes.json() : [];
  const wellness = wellRes.ok ? await wellRes.json() : [];
  let athlete = (athRes && athRes.ok) ? await athRes.json() : null;

  // Ako athlete nema prepoznat FTP iz sportSettings, pokušaj dohvatiti specifični Ride sportSettings
  if (athlete && !extractIntervalsAthleteMetrics(athlete)?.ftp) {
    try {
      const sportRes = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/sport-settings/Ride`, { headers });
      if (sportRes.ok) {
        const rideSettings = await sportRes.json();
        if (rideSettings) {
          athlete.sportSettings = Array.isArray(athlete.sportSettings) ? [...athlete.sportSettings, rideSettings] : [rideSettings];
        }
      }
    } catch (e) {
      console.warn('[intervalsApi] Neuspjelo dohvaćanje sport-settings/Ride:', e);
    }
  }

  if (athlete) {
    athlete = enrichAthleteObject(athlete);
  }

  return { activities, events, wellness, athlete };
};

/**
 * Ažurira datum eventa na Intervals.icu (za D&D reschedule).
 * PUT /api/v1/athlete/{id}/events/{eventId}
 */
export const updateEventDate = async (intervalsId, intervalsKey, eventId, newDate) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = {
    ...getAuthHeaders(intervalsKey),
    'Content-Type': 'application/json'
  };

  const url = `https://intervals.icu/api/v1/athlete/${cleanId}/events/${eventId}`;
  
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      start_date_local: `${newDate}T08:00:00`
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri premještanju treninga: ${res.status} ${errText}`);
  }

  return res.json();
};

/**
 * Kreira novi event na Intervals.icu
 */
export const createEvent = async (intervalsId, intervalsKey, payload) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = {
    ...getAuthHeaders(intervalsKey),
    'Content-Type': 'application/json'
  };

  const url = `https://intervals.icu/api/v1/athlete/${cleanId}/events`;
  
  let cleanPayload = { ...payload };
  if (cleanPayload.workout_doc) {
    if (!cleanPayload.description && typeof cleanPayload.workout_doc === 'string') {
      cleanPayload.description = cleanPayload.workout_doc;
    }
    delete cleanPayload.workout_doc;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(cleanPayload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri kreiranju treninga: ${res.status} ${errText}`);
  }

  return res.json();
};

/**
 * Briše event na Intervals.icu
 */
export const deleteEvent = async (intervalsId, intervalsKey, eventId) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = getAuthHeaders(intervalsKey);
  const url = `https://intervals.icu/api/v1/athlete/${cleanId}/events/${eventId}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri brisanju treninga: ${res.status} ${errText}`);
  }
  return res.json().catch(() => ({}));
};

/**
 * Ažurira detalje (tekst) eventa na Intervals.icu.
 */
export const updateEventDetails = async (intervalsId, intervalsKey, eventId, payload) => {
  const cleanId = String(intervalsId || '').trim();
  const url = `https://intervals.icu/api/v1/athlete/${cleanId}/events/${eventId}`;

  // 1. Sigurno spajanje headera
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  headers.append('Accept', 'application/json');

  const auth = getAuthHeaders(intervalsKey);
  if (auth instanceof Headers) {
    auth.forEach((value, key) => headers.append(key, value));
  } else if (auth && typeof auth === 'object') {
    Object.keys(auth).forEach(key => headers.append(key, auth[key]));
  }

  if (!payload) throw new Error("Interna greška: Nema podataka.");
  
  // 2. Priprema podataka
  let cleanPayload = typeof payload === 'string' ? JSON.parse(payload) : { ...payload };
  
  // === KLJUČNI FIX ZA INTERVALS.ICU API ===
  // API ruši parser ako 'workout_doc' dođe kao string. 
  // Tekst s intervalima API isključivo očekuje unutar 'description' polja.
  if (cleanPayload.workout_doc) {
    // Prebaci tekstualne intervale u description (ako description već ne postoji)
    if (!cleanPayload.description && typeof cleanPayload.workout_doc === 'string') {
      cleanPayload.description = cleanPayload.workout_doc;
    }
    // OBAVEZNO obrisati workout_doc prije slanja, API ga sam generira na svojoj strani!
    delete cleanPayload.workout_doc;
  }
  // =========================================

  const bodyData = JSON.stringify(cleanPayload);

  // 3. Slanje zahtjeva
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers,
    body: bodyData
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri ažuriranju treninga (Status ${res.status}): ${errText}`);
  }

  return res.json();
};

/**
 * Dohvaća originalnu FIT datoteku za određenu aktivnost i pokreće preuzimanje.
 */
export const downloadActivityFitFile = async (intervalsId, intervalsKey, activityId) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = getAuthHeaders(intervalsKey);
  const url = `https://intervals.icu/api/v1/activity/${activityId}/file`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      throw new Error(`Datoteka nije dostupna za preuzimanje. Ovo se često događa prenesenim treninzima sa Strave zbog njihovih pravila privatnosti (Status ${res.status}).`);
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri preuzimanju datoteke: ${res.status} ${errText}`);
  }

  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `activity-${activityId}.fit`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
};

/**
 * Dohvaća sirove streamove (wats, hr, velocity) za aktivnost.
 */
export const getActivityStreams = async (intervalsId, intervalsKey, activityId) => {
  const cleanId = String(intervalsId || '').trim();
  const headers = getAuthHeaders(intervalsKey);
  const url = `https://intervals.icu/api/v1/activity/${activityId}/streams.json?types=watts,heartrate,velocity_smooth,cadence`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri dohvaćanju streamova (Status ${res.status}): ${errText}`);
  }

  return res.json();
};

/**
 * Ažurira naziv aktivnosti na Intervals.icu.
 * PUT /api/v1/activity/{activityId}
 */
export const updateActivityName = async (intervalsId, intervalsKey, activityId, newName) => {
  const headers = {
    ...getAuthHeaders(intervalsKey),
    'Content-Type': 'application/json'
  };
  const url = `https://intervals.icu/api/v1/activity/${activityId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: newName })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri preimenovanju aktivnosti (${res.status}): ${errText}`);
  }

  return res.json();
};

/**
 * Šalje odrađenu aktivnost (.FIT binarni niz) direktno na Intervals.icu.
 * POST /api/v1/athlete/{id}/activities (multipart/form-data)
 */
export const uploadActivityToIntervals = async (intervalsId, intervalsKey, fitUint8Array, workoutName = 'ErgVibe Trening', description = '') => {
  const cleanId = String(intervalsId || '').trim();
  const cleanKey = String(intervalsKey || '').trim();
  if (!cleanId || !cleanKey) {
    throw new Error('Intervals.icu ID ili API ključ nisu postavljeni.');
  }
  if (!fitUint8Array || fitUint8Array.byteLength === 0) {
    throw new Error('Nema podataka treninga za slanje.');
  }

  const authHeaders = getAuthHeaders(cleanKey);
  const params = new URLSearchParams();
  if (workoutName) params.set('name', workoutName);
  if (description) params.set('description', description);

  const url = `https://intervals.icu/api/v1/athlete/${cleanId}/activities?${params.toString()}`;

  const formData = new FormData();
  const safeName = (workoutName || 'ergvibe_trening').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const blob = new Blob([fitUint8Array], { type: 'application/octet-stream' });
  formData.append('file', blob, `${safeName}.fit`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders
    },
    body: formData
  });

  if (res.status === 401) throw new Error('Intervals.icu API ključ ili ID su neispravni.');
  if (res.status === 429) throw new Error('Previše zahtjeva prema Intervals.icu serveru.');
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri slanju na Intervals.icu (${res.status}): ${errText}`);
  }

  return res.json().catch(() => ({}));
};

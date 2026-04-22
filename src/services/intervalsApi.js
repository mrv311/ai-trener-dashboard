const FETCH_PAST_MONTHS = 12;
const FETCH_FUTURE_MONTHS = 3;

const getAuthHeaders = (apiKey) => {
  const cleanKey = String(apiKey || '').trim();
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
  const evUrl = `https://intervals.icu/api/v1/athlete/${cleanId}/events?oldest=${oldest}&newest=${newest}`;
  const wellUrl = `https://intervals.icu/api/v1/athlete/${cleanId}/wellness?oldest=${oldest}&newest=${newest}`;

  const actRes = await fetch(actUrl, { headers });
  
  if (actRes.status === 401) throw new Error("API ključ ili ID su neispravni.");
  if (actRes.status === 429) throw new Error("Previše zahtjeva prema serveru. Pričekaj malo.");
  if (!actRes.ok) throw new Error("Greška pri spajanju na server.");

  const [evRes, wellRes] = await Promise.all([
    fetch(evUrl, { headers }),
    fetch(wellUrl, { headers })
  ]);

  const activities = await actRes.json();
  const events = evRes.ok ? await evRes.json() : [];
  const wellness = wellRes.ok ? await wellRes.json() : [];

  return { activities, events, wellness };
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
  
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Greška pri kreiranju treninga: ${res.status} ${errText}`);
  }

  return res.json();
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

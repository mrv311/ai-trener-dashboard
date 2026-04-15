const FETCH_PAST_MONTHS = 12;
const FETCH_FUTURE_MONTHS = 3;

const getAuthHeaders = (apiKey) => {
  const cleanKey = apiKey.trim();
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

export const fetchIntervalsData = async (intervalsId, intervalsKey) => {
  const cleanId = intervalsId.trim();
  const headers = getAuthHeaders(intervalsKey);
  const { oldest, newest } = getDateRange();

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
  const cleanId = intervalsId.trim();
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

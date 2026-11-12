/**
 * ErgVibe Gemini AI Coaching Service
 * Povezuje Google Gemini (Flash / Pro) putem sigurnog backend proxyja (/api/gemini)
 * s poviješću treninga sportaša, fiziološkom literaturom i live metrikama.
 */

import { compileKnowledgeBasePrompt } from './aiKnowledgeBase';
import { buildAthleteContextPrompt, findExactHistoricalRecord } from './historyService';
import { getAttachmentFromLocalDB } from './aiFilesStorage';

const STORAGE_KEY_CUSTOM_API_KEY = 'ergvibe_custom_gemini_key';
const STORAGE_KEY_ANALYSES_CACHE = 'ergvibe_ai_workout_analyses_v1';

export function getResolvedGeminiApiKey() {
  try {
    const custom = localStorage.getItem(STORAGE_KEY_CUSTOM_API_KEY)?.trim();
    if (custom) return custom;
  } catch {
    // ignore storage access error
  }
  const envKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (envKey && envKey !== 'your-gemini-api-key') return envKey;
  return '';
}

export function getGeminiConfigStatus() {
  try {
    const custom = localStorage.getItem(STORAGE_KEY_CUSTOM_API_KEY)?.trim();
    if (custom) return { configured: true, source: 'custom' };
  } catch {
    // ignore storage access error
  }
  const envKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (envKey && envKey !== 'your-gemini-api-key') {
    return { configured: true, source: 'env' };
  }
  // Sigurni poslužiteljski proxy na Vercelu (/api/gemini)
  return { configured: true, source: 'proxy' };
}

export function setCustomGeminiApiKey(key) {
  const clean = String(key || '').trim();
  if (!clean) {
    localStorage.removeItem(STORAGE_KEY_CUSTOM_API_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY_CUSTOM_API_KEY, clean);
  }
}

/**
 * Generira stabilan ključ za cache analize pojedine aktivnosti.
 */
export function buildActivityCacheKey(activity) {
  if (!activity) return 'unknown';
  const idPart = activity.actId || activity.supabaseId || activity.id || '';
  const datePart = (activity.started_at || activity.date || '').slice(0, 10);
  const titlePart = (activity.title || activity.name || '').trim().toLowerCase();
  return `${idPart}_${datePart}_${titlePart}`;
}

export function getCachedWorkoutAnalysis(cacheKey) {
  if (!cacheKey) return null;
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY_ANALYSES_CACHE) || '{}');
    return store[cacheKey] || null;
  } catch {
    return null;
  }
}

export function saveCachedWorkoutAnalysis(cacheKey, payload) {
  if (!cacheKey) return;
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY_ANALYSES_CACHE) || '{}');
    store[cacheKey] = {
      ...payload,
      updatedAt: new Date().toISOString()
    };
    // Zadrži zadnjih 60 analiza kako ne bismo preopteretili localStorage
    const entries = Object.entries(store).sort(
      (a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || ''))
    );
    const trimmed = Object.fromEntries(entries.slice(0, 60));
    localStorage.setItem(STORAGE_KEY_ANALYSES_CACHE, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[geminiService] Cache spremanje upozorenje:', e);
  }
}

/**
 * Poziv prema Google Gemini AI-ju.
 * Primarno koristi sigurni backend proxy (/api/gemini) kako se ključ nikada ne bi izložio pregledniku.
 */
async function callGeminiApi({
  systemInstruction,
  contents,
  model = 'gemini-3.8-flash',
  temperature = 0.4,
  responseMimeType = null
}) {
  const customKey = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CUSTOM_API_KEY)?.trim() || null;
    } catch {
      return null;
    }
  })();

  // 1. PRIMARNO: Poziv preko sigurnog Vercel / lokalnog poslužiteljskog proxyja (/api/gemini)
  const proxyPayload = JSON.stringify({
    systemInstruction,
    contents,
    model,
    temperature,
    responseMimeType,
    customApiKey: customKey || undefined
  });

  let proxyRouteMissing = false;
  let lastNetworkError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 58000);
    try {
      const proxyRes = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: proxyPayload,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data?.text) return data.text;
        throw new Error('AI poslužitelj nije vratio tekstualni odgovor. Pokušaj ponovno.');
      }

      if (proxyRes.status === 404) {
        proxyRouteMissing = true;
        break;
      }

      // Kod prolazne poslužiteljske greške (502/503/504) pokušaj još jednom
      if ([502, 503, 504].includes(proxyRes.status) && attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      const errJson = await proxyRes.json().catch(() => ({}));
      const serverErr = new Error(errJson?.error || `AI poslužiteljska greška (HTTP ${proxyRes.status})`);
      serverErr.isExplicitServerError = true;
      throw serverErr;
    } catch (proxyErr) {
      clearTimeout(timeoutId);
      if (proxyErr?.isExplicitServerError) {
        throw proxyErr;
      }
      lastNetworkError = proxyErr;
      const msg = String(proxyErr?.message || '');
      const isAbort = proxyErr?.name === 'AbortError' || msg.toLowerCase().includes('aborted');
      const isTransientFetch =
        msg.includes('Failed to fetch') ||
        msg.includes('Load failed') ||
        msg.includes('NetworkError') ||
        msg.toLowerCase().includes('network');

      if (!isAbort && isTransientFetch && attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      if (!isAbort && !isTransientFetch) {
        throw proxyErr;
      }
      break;
    }
  }

  // 2. FALLBACK: Direktni poziv samo ako postoji lokalni/vlastiti ključ (npr. vite preview ili vlastiti ključ u tabu Veze)
  const fallbackKey = customKey || import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!fallbackKey || fallbackKey === 'your-gemini-api-key') {
    if (lastNetworkError && !proxyRouteMissing) {
      const msg = String(lastNetworkError?.message || '');
      if (lastNetworkError?.name === 'AbortError' || msg.toLowerCase().includes('aborted')) {
        throw new Error('AI poslužitelj je predugo obrađivao zahtjev (timeout). Pokušaj ponovno s kraćim upitom.');
      }
      throw new Error('Prekid mrežne veze prema AI poslužitelju. Provjeri mobilni internet / VPN i drži zaslon uključenim dok AI priprema odgovor, pa pokušaj ponovno.');
    }
    throw new Error('Gemini AI poslužitelj nije konfiguriran (GEMINI_API_KEY). Postavi varijablu u Vercel Environment Variables ili unesi privremeni ključ u tabu Veze.');
  }

  let effectiveModel = model || 'gemini-3.8-flash';
  if (!customKey && String(effectiveModel).toLowerCase().includes('pro')) {
    effectiveModel = 'gemini-3.8-flash';
  }

  const isProModel = String(effectiveModel).toLowerCase().includes('pro');
  const buildBody = (includeThinking = true) => {
    const generationConfig = {
      temperature,
      maxOutputTokens: 16384,
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(includeThinking ? { thinkingConfig: { thinkingBudget: isProModel ? 2048 : 512 } } : {})
    };
    return {
      ...(systemInstruction
        ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
        : {}),
      contents,
      generationConfig
    };
  };

  const executeForModel = async (targetModel, includeThinking = true) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(fallbackKey)}`;
    const resFetch = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(includeThinking))
    });
    if (resFetch.status === 400 && includeThinking) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(false))
      });
    }
    return resFetch;
  };

  const candidateModels = isProModel
    ? [...new Set([effectiveModel, 'gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-3.8-flash'])]
    : [...new Set([effectiveModel, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'])];

  let response = null;
  for (const candidate of candidateModels) {
    response = await executeForModel(candidate);
    if (response.status !== 404) break;
  }

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) errDetail = errJson.error.message;
    } catch {}
    throw new Error(`Gemini API greška: ${errDetail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter(p => !p.thought)
    ?.map(p => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini nije vratio tekstualni odgovor. Pokušaj ponovno.');
  }

  return text;
}

/**
 * Detaljna post-workout AI analiza odrađenog treninga.
 */
export async function analyzeWorkoutWithGemini({
  activity,
  metrics = {},
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  userNote = '',
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: activity,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt();

  const exactHistory = await findExactHistoricalRecord(activity, { userId });

  const durationMin = Math.round((activity.moving_time || activity.elapsed_time || (activity.duration ? activity.duration * 60 : 0)) / 60);
  const avgWatts = Math.round(activity.avg_power || metrics.avgPower || 0);
  const npWatts = Math.round(activity.icu_weighted_avg_watts || metrics.np || 0);
  const hrAvg = Math.round(activity.avg_hr || metrics.avgHr || 0);
  const hrMax = Math.round(activity.max_hr || metrics.maxHr || 0);
  const tss = Math.round(activity.icu_training_load || metrics.tss || 0);
  const ifFactor = (activity.icu_intensity ? Number(activity.icu_intensity) : Number(metrics.if_factor || 0)).toFixed(2);
  const decoupling = metrics.aerobicDecoupling !== null && metrics.aerobicDecoupling !== undefined
    ? `${metrics.aerobicDecoupling}%`
    : (activity.icu_pw_hr ? `${Number(activity.icu_pw_hr).toFixed(1)}%` : 'N/A');
  const efVal = metrics.ef ? Number(metrics.ef).toFixed(2) : (activity.icu_efficiency_factor ? Number(activity.icu_efficiency_factor).toFixed(2) : 'N/A');
  const viVal = metrics.vi ? Number(metrics.vi).toFixed(2) : (activity.icu_variability_index ? Number(activity.icu_variability_index).toFixed(2) : 'N/A');
  const wKgVal = athleteProfile?.weight && avgWatts > 0 ? (avgWatts / athleteProfile.weight).toFixed(2) : 'N/A';

  const userPrompt = `Analiziraj odrađeni biciklistički trening sportaša:

### DETALJI TRENINGA:
- **Naziv:** ${activity.name || activity.title || 'Trening'}
- **Datum:** ${(activity.started_at || activity.date || '').slice(0, 10)}
- **Trajanje:** ${durationMin} min
- **Prosječna snaga (Avg Power):** ${avgWatts} W (${wKgVal} W/kg)
- **Normalizirana snaga (NP):** ${npWatts} W
- **Intenzitet (IF):** ${ifFactor}
- **Training Stress Score (TSS):** ${tss}
- **Prosječni puls (Avg HR):** ${hrAvg} bpm | Max puls: ${hrMax} bpm
- **Aerobic Decoupling (Pw:HR):** ${decoupling}
- **Efficiency Factor (EF = NP / Avg HR):** ${efVal}
- **Variability Index (VI = NP / Avg Power):** ${viVal}
- **Izvor aktivnosti:** ${activity.workout_source || (activity.isSupabase ? 'ErgVibe Baza' : 'Intervals.icu')}
${userNote ? `- **Subjektivna bilješka vozača:** "${userNote}"` : ''}

${exactHistory ? `### USPOREDBA S POVIJEŠĆU SPORTAŠA ZA OVAJ TRENING:
- Pronađen je raniji zapis ovog treninga u povijesti sportaša:
- Povijesni datum: ${exactHistory.date} | Naziv: ${exactHistory.title}
- Povijesni NP: ${exactHistory.np}W | Povijesni EF: ${exactHistory.ef} | Decoupling: ${exactHistory.decoupling}% | TSS: ${exactHistory.tss}
- Usporedi trenutni napor s povijesnim i istakni trend napretka.` : ''}

Napiši analizu u strukturiranom, stručnom formatu prema zadanim trenerskim uputama.`;

  return callGeminiApi({
    systemInstruction: `${athleteContextPrompt}\n\n${knowledgeBasePrompt}`,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    model,
    temperature: 0.35
  });
}

/**
 * Dodatna potpitanja (Q&A) unutar modala pojedinog treninga.
 */
export async function askWorkoutFollowUp({
  activity,
  initialAnalysis,
  qaHistory = [],
  question,
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: activity,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt();

  const systemInstruction = `Ti si ErgVibe AI biciklistički trener. Odgovaraš na dodatno pitanje vozača vezano uz upravo analizirani trening "${activity?.title || activity?.name || 'Trening'}" (${(activity?.started_at || activity?.date || '').slice(0, 10)}).
Budi konkretan, jasan i osloni se na podatke sportaša i bazu znanja. Odgovaraj na hrvatskom jeziku.

${athleteContextPrompt}

${knowledgeBasePrompt}`;

  const contents = [
    { role: 'user', parts: [{ text: 'Analiziraj moj trening.' }] },
    { role: 'model', parts: [{ text: initialAnalysis || 'Analiza spremna.' }] }
  ];

  qaHistory.forEach(msg => {
    const msgText = String(msg?.text ?? msg?.content ?? '').trim();
    if (!msgText) return;
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msgText }]
    });
  });

  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    throw new Error('Pitanje ne može biti prazno.');
  }
  contents.push({ role: 'user', parts: [{ text: cleanQuestion }] });

  return callGeminiApi({
    systemInstruction,
    contents,
    model,
    temperature: 0.4
  });
}

/**
 * Interaktivni chat s AI Trenerom.
 */
export async function chatWithAICoach({
  messages = null,
  chatHistory = [],
  userMessage = '',
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt();

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}

### SPECIFIČNA UPUTA ZA CHAT I GENERIRANJE ERGVIBE TRENINGA:
1. Odgovaraj kao vrhunski biciklistički trener i fiziolog. Budi jasan, precizan i motivirajuć.
2. Ako sportaš zatraži novi trening ili ti predložiš trening za danas/trenažer, na kraju odgovora OBAVEZNO uključi strukturirani blok u formatu:
\`\`\`workout
TITLE: Naziv Treninga
CATEGORY: SweetSpot | Endurance | Threshold | VO2max | Anaerobic | Recovery
DURATION: 60
TSS: 65
STEPS:
Zagrijavanje
- 10m 55%
Glavni dio
3x
- 8m 90%
- 4m 50%
Hlađenje
- 10m 50%
\`\`\`
3. FORMAT KORAKA, TRAJANJA I SETOVA:
   - Za trajanje s minutama i sekundama koristi standardni format: \`- 1m20s 125%\` ili \`- 80s 125%\` (nikada nemoj gubiti minute).
   - Ako rekreiraš trening sa slike ili opisa (npr. TrainerRoad, Zwift), prebroji točan broj intervala u svakom setu i zadrži točno zadano trajanje (npr. 60 min) i TSS (npr. 76 TSS). Balansiraj korak Hlađenje tako da ukupno vrijeme točno odgovara trajanju treninga.
ili u JSON formatu:
\`\`\`ergvibe-workout
{
  "title": "Naziv Treninga",
  "description": "Kratki opis cilja i fiziološkog podražaja",
  "category": "SweetSpot | Endurance | Threshold | VO2max | Anaerobic | Recovery",
  "durationMinutes": 60,
  "steps": [
    { "name": "Zagrijavanje", "duration": 600, "power": 55 },
    { "name": "Z2 Rampa", "duration": 300, "power": 68 },
    { "name": "Sweet Spot Interval", "duration": 600, "power": 90 },
    { "name": "Oporavak", "duration": 300, "power": 50 }
  ]
}
\`\`\`
VAŽNO: DURATION i durationMinutes su U MINUTAMA (npr. 60 ili 75, NIKAKO u sekundama poput 3600). U steps nizu, pojedinačni "duration" je u sekundama, a "power" je u % FTP.

### 🚴‍♂️ PROTOKOL ZA REKREIRANJE I DEKONSTRUKCIJU TRENINGA SA SLIKA (VISUAL WORKOUT REVERSE-ENGINEERING):
Kada sportaš učita sliku ili snimku zaslona biciklističkog treninga (Zwift, TrainerRoad, TrainingPeaks, Intervals.icu, Garmin Connect, Rouvy, Wahoo SYSTM, fotografiju trenažnog plana s papira ili grafikon snage), TVOJ PRIORITETNI ZADATAK JE:
DEKONSTRUIRATI TU SLIKU U 100% IDENTIČAN I PRECIZAN ERGVIBE KOD KOJI SE JEDNIM KLIKOM MOŽE POKRENUTI NA TRENAŽERU ILI DODATI U KALENDAR!

Slijedi ove rigorozne korake i trenerska pravila:

1. ZAGLAVLJE I OSNOVNI PARAMETRI (Zlatni izvor istine):
   - **Naziv treninga (TITLE):** Pronađi točan naziv na vrhu ili u opisu (npr. "The Gorby", "Carson -2", "4x10min FTP", "Sweet Spot 3x15"). Ako naziva nema na slici, osmisli točan i prepoznatljiv naziv prema zoni i strukturi (npr. "VO2max 5x3min @ 115%").
   - **Ukupno trajanje (DURATION):** Pažljivo pročitaj ukupno trajanje s grafike (npr. "1:00:00", "45:00", "1h 15m").
     ⚠️ KRITIČNO: Zbroj minuta svih tvojih koraka (Zagrijavanje + Serije ponavljanja + Odmori + Hlađenje) MORA BITI TOČNO JEDNAK tom ukupnom trajanju! Nikada nemoj isporučiti trening od 42 min ako na vrhu piše 60 min.
   - **TSS i IF:** Ako su navedeni TSS i Intensity Factor na slici, prepiši ih. Ako nisu, procijeni ih na temelju trajanja i zone.

2. PRIORITET TEKSTUALNIH I TABLIČNIH PODATAKA NAD PIKSELIMA:
   - Ako slika sadrži tekstualni sažetak, legendu koraka ili tablicu (npr. "5 x 3 min @ 110-120% FTP with 3 min rest" ili "Warmup 10:00 ramp from 100W to 200W"), UVIJEK koristi te točne brojke! Tekst je neprikosnovena istina.
   - Ako su na slici izraženi wati (W) umjesto postotaka, usporedi ih s FTP-om vozača (iz konteksta sportaša iznad) i pretvori u točan % FTP-a (npr. 250W pri FTP 277W = 90% FTP) ili zapiši postotak i wate.

3. DEKODIRANJE GRAFIČKIH STUPACA, BOJA I KOSINA (KADA NEMA TEKSTA):
   - Standardne boje biciklističkih trenažnih aplikacija (Zwift, TrainerRoad, Intervals, Garmin):
     * Siva / Tamno siva = Z1 Oporavak / Spin (< 55% FTP)
     * Plava = Z2 Izdržljivost / Aerobna baza (56% - 75% FTP, tipično 65-70%)
     * Zelena = Z3 Tempo (76% - 90% FTP, tipično 80-85%)
     * Svijetlo zelena / Žuto-zelena = Sweet Spot (88% - 94% FTP, tipično 90%)
     * Žuta = Z4 Prag / FTP (95% - 105% FTP, tipično 100%)
     * Narančasta = Z5 VO2max (106% - 120% FTP, tipično 110-115%)
     * Crvena = Z6 Anaerobni kapacitet (121% - 150% FTP, tipično 125-130%)
     * Ljubičasta / Svijetlo crvena = Z7 Neuromuskularni sprint (> 150% FTP)
   - Rampe (kosi stupci):
     * Kosi stupac koji raste (čest u zagrijavanju) mora se zapisati kao raspon: npr. \`- 10m 50-75%\` ili \`- 5m 60-80%\`.
     * Kosi stupac koji pada (hlađenje): npr. \`- 5m 70-50%\` ili jednostavno \`- 5m 50%\`.
   - Kadenca (RPM): Ako na slici postoje oznake za kadencu (npr. "High Cadence 100 RPM" ili "Low Cadence 70 RPM"), obavezno je dodaj na kraj linije koraka (npr. \`- 4m 95% 95rpm\`).

4. GRUPIRANJE U PONAVLJAJUĆE SERIJE (Nx SINTAKSA):
   - Prepoznaj ritam ponavljanja! Ako vidiš npr. 5 jednakih radnih blokova i odmore između njih, nemoj ih pisati razvučeno jedan po jedan ako su identični, već ih zapiši pomoću \`Nx\` oznake:
     Glavni dio
     5x
     - 3m 115%
     - 3m 50%
   - Ako intervali unutar serije NISU jednaki (npr. piramida: 1m, 2m, 3m, 2m, 1m ili opadajući watt-koraci), zapiši ih pojedinačno red po red bez Nx multiplikatora.

5. MATEMATIČKA PROVJERA PRIJE ISPISA (TEMPORAL INTEGRITY CHECK):
   - Izračunaj trajanje korak po korak:
     * Zagrijavanje: 10 min
     * Serija 4x (5m rad + 5m odmor) = 4 x 10 min = 40 min
     * Hlađenje: 10 min
     * UKUPNO = 10 + 40 + 10 = 60 min.
   - Ako ti fali vremena do ukupnog trajanja prikazanog na slici, provjeri jesi li previdio pripremni korak u zagrijavanju (npr. 3 brza skoka kadence / openers od po 30s) ili završno hlađenje!

6. OBAVEZNA STRUKTURA ODGOVORA KOD REKREIRANJA SLIKE (KORAK-PO-KORAK ANALIZA):
   Prije ispisa samog programskog koda, UVIJEK najprije napiši kratku, preciznu sekciju opažanja:
   ### 🔍 VIZUALNA ANALIZA SLIKE:
   - **Izvor / platforma:** (npr. TrainerRoad, Zwift, TrainingPeaks, Garmin, crtež/tablica)
   - **Prepoznati naziv treninga:** (npr. Carson, The Wringer ili točan naziv s ekrana)
   - **Ukupno trajanje s grafike:** (npr. 60 min ili 45 min)
   - **Broj radnih intervala:** (točan prebrojani broj stupaca rada, npr. 5 ili 6)
   - **Zona i intenzitet rada:** (npr. žuta Z4 / Sweet Spot, ~90% FTP = 249 W)
   - **Trajanje radnog intervala i odmora:** (npr. rad 6 min na 90%, odmor 2 min na 50%)
   - **Zagrijavanje i hlađenje:** (npr. 10 min rampa 50-75%, hlađenje 2 min na 50%)
   - **Matematička provjera zbroja:** 10m + 6x(6m+2m) + 2m = 60m (mora se podudarati s trajanjem na slici!)

   TEK NAKON OVE ANALIZE, ispiši gotov kod:
\`\`\`workout
TITLE: Točan Naziv Treninga
CATEGORY: SweetSpot | VO2max | Threshold | Endurance | Anaerobic | Recovery
DURATION: 60
TSS: 65
STEPS:
Zagrijavanje
- 10m 50-75%
Glavni dio
4x
- 8m 95%
- 4m 50%
Hlađenje
- 6m 50%
\`\`\`
   - Nakon koda, daj sportašu 3 konkretna trenerska savjeta:
     1. Točne wate za radne intervale prema njegovom trenutnom FTP-u (npr. "Na tvom FTP-u od X W, radni interval od Y% iznosi Z W, a odmor je W W").
     2. Savjet za kadencu i biomehaniku (npr. stabilnih 90-95 rpm, miran gornji dio tijela).
     3. Način izvedbe na pametnom trenažeru (ERG mode preporuka, hlađenje i hidracija).

7. 🔄 PROTOKOL ZA KORISNIČKE ISPRAVKE (FOLLOW-UP PORUKE):
   Ako sportaš u nastavku razgovora pošalje ispravak (npr. "krivo je, nije 4x nego 5x", "odmor je 2 min a ne 4 min", "intenzitet je Sweet Spot a ne VO2max", "ukupno trajanje je 45 min a ne 60 min"):
   - Prihvati sportaševu ispravku kao APSOLUTNI FAKT.
   - Ne mijenjaj one dijelove treninga koji su bili točni, već izmijeni TOČNO one stavke koje je sportaš naveo.
   - Ponovno proračunaj trajanje i OBAVEZNO ispiši NOVI, ažurirani \`\`\`workout\`\`\` blok s unesenim ispravkama tako da ga korisnik može odmah spremiti!

### SPECIFIČNA UPUTA ZA ANALIZU FIZIOLOŠKIH NALAZA (LAKTIČKI TEST, SPIROERGOMETRIJA, KRVNA SLIKA):
Ako poruka sadrži priloženu sliku ili PDF laboratorijskog nalaza spiroergometrije, laktatnog testa, krvne slike ili tablice koraka opterećenja:
1. Pažljivo očitaj sve tablične i grafičke vrijednosti: watte po koraku, puls (HR), laktate (mmol/L), VO2max, ventilaciju ili kadencu.
2. Precizno identificiraj fiziološke točke:
   - **LT1 / Aerobni prag**: točka prvog skoka laktata iznad bazalnih vrijednosti (obično oko 1.5 - 2.0 mmol/L ili prvi ventilacijski lom VT1).
   - **LT2 / MLSS / Anaerobni prag (FTP)**: točka ubrzane akumulacije laktata (oko 4.0 mmol/L ili oštar skok krivulje).
3. Usporedi nalaz s trenutnim profilom sportaša u ErgVibe-u (FTP, težina, zone) i jasno preporuči:
   - Ažurirani FTP ili pragove pulsa ako se razlikuju od trenutnih.
   - U kojem rasponu watta voziti Zone 2 (izdržljivost) ispod LT1, a u kojem Sweet Spot / Threshold oko LT2.`;

  const rawList = Array.isArray(messages) && messages.length > 0
    ? messages
    : [
        ...(Array.isArray(chatHistory) ? chatHistory : []),
        ...(String(userMessage || '').trim() ? [{ role: 'user', text: String(userMessage).trim() }] : [])
      ];

  // 1. Pripremi asinkrono sve partove uključujući multimodalne privitke (slike i PDF-ove)
  const normalizedTurns = [];
  for (const m of rawList) {
    const txt = String(m?.text ?? m?.content ?? '').trim();
    const parts = [];

    // Dodaj tekstualni dio ako postoji
    if (txt) {
      parts.push({ text: txt });
    }

    // Dodaj multimodalne privitke (slike ili PDF)
    if (Array.isArray(m?.attachments) && m.attachments.length > 0) {
      for (const att of m.attachments) {
        let base64 = att?.dataBase64;
        let mime = att?.type;

        // Ako base64 nije u memoriji, povuci ga iz lokalnog IndexedDB-a
        if (!base64 && att?.id) {
          try {
            const dbItem = await getAttachmentFromLocalDB(att.id);
            if (dbItem?.dataBase64) {
              base64 = dbItem.dataBase64;
              mime = dbItem.type || mime;
            }
          } catch (e) {
            console.warn('[chatWithAICoach] Neuspjelo dohvaćanje privitka iz IndexedDB-a:', att.id, e);
          }
        }

        if (base64 && mime) {
          parts.push({
            inlineData: {
              mimeType: mime,
              data: base64
            }
          });
        }
      }
    }

    // Ako korisnik nije upisao tekst nego samo priložio sliku/PDF, postavi pametni upit
    if (parts.length > 0 && !txt && m?.role === 'user') {
      parts.unshift({
        text: 'Molim te detaljno analiziraj ovu priloženu sliku/dokument u kontekstu mog profila, trenutnog FTP-a i biciklističkog treninga. Ako slika prikazuje profil ili plan biciklističkog treninga (Zwift, TrainerRoad, TrainingPeaks, Intervals.icu, Garmin ekran, trenažni grafikon ili tablicu intervala), DEKONSTRUIRAJ ga i REKREIRAJ u točan ErgVibe ```workout``` blok za trenažer poštujući protokol vizualne dekonstrukcije.'
      });
    }

    if (parts.length > 0) {
      normalizedTurns.push({
        role: m?.role === 'user' ? 'user' : 'model',
        parts
      });
    }
  }

  // Osiguraj da razgovor počinje s 'user' ulogom i spaja uzastopne poruke iste uloge
  while (normalizedTurns.length > 0 && normalizedTurns[0].role !== 'user') {
    normalizedTurns.shift();
  }

  const formattedContents = [];
  for (const turn of normalizedTurns) {
    const prev = formattedContents[formattedContents.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts.push(...turn.parts);
    } else {
      formattedContents.push(turn);
    }
  }

  if (formattedContents.length === 0) {
    throw new Error('Poruka za AI Trenera je prazna. Upiši pitanje ili priloži dokument i pokušaj ponovno.');
  }

  const hasMultimodal = formattedContents.some(turn =>
    Array.isArray(turn.parts) && turn.parts.some(p => p.inlineData)
  );

  return callGeminiApi({
    systemInstruction,
    contents: formattedContents,
    model,
    temperature: hasMultimodal ? 0.2 : 0.35
  });
}

/**
 * Specijalizirana funkcija za AI Workout Creator modal.
 * Fokusirana isključivo na dekonstrukciju slike treninga (TrainerRoad, Zwift, Garmin itd.)
 * ili tekstualnog opisa u 100% točan ErgVibe kod bez ometanja općenitim chat kontekstom.
 */
export async function recreateWorkoutWithAi({
  imageBase64 = null,
  mimeType = 'image/jpeg',
  description = '',
  targetDuration = null,
  targetTss = null,
  athleteProfile = null,
  model = 'gemini-3.8-flash'
}) {
  const ftp = Number(athleteProfile?.ftp) || 270;
  const weight = Number(athleteProfile?.weight) || 74;

  const systemInstruction = `Ti si specijalizirani ErgVibe AI Vision Workout Deconstructor i vrhunski biciklistički trener.
Tvoj ISKLJUČIVI zadatak je pretvoriti priloženu snimku zaslona biciklističkog treninga (TrainerRoad, Zwift, TrainingPeaks, Garmin, Intervals.icu, crtež ili tablicu) ili tekstualni opis u točan, strukturirani trenažni workout.

Profil sportaša:
- Trenutni FTP: ${ftp} W | Težina: ${weight} kg

ZLATNA PRAVILA ZA APSOLUTNU PRECIZNOST:
1. AKO NA SLICI ILI U OPISU PIŠU TSS, TRAJANJE ILI NAZIV TRENINGA:
   - ZABRANJENO JE PROIZVOLJNO MIJENJATI TSS! Ako na slici ili u opisu piše npr. "TSS: 76", izlaz MORA imati točno "TSS: 76".
   - Ako je vidljiv naziv treninga (npr. TrainerRoad kataloga: "Anticosti", "Carson", "The Gorby", "Mary Austin", "Baxter", "Erie", "Spanish Needle", ili Zwift treninga), OBAVEZNO uskladi strukturu intervala s točnim poznatim katalogom tog treninga!
   - Primjer: TrainerRoad "Anticosti" ima točno 3 seta po 5 intervala (ukupno 15 intervala rada na 120-125% FTP) u trajanju od 60 min i 76 TSS!
2. BROJANJE USKIH INTERVALA U SETOVIMA:
   - Na trenažnim grafovima intervali u setu su uski šiljci. Pažljivo prebroji svaki šiljak u svakom setu! Ako vidiš 3 seta, prebroji točno koliko šiljaka je u svakom setu (npr. točno 5 intervala po setu, a ne 4).
3. KORISNIČKE UPUTE I OPIS IMAJU APSOLUTNI PRIORITET:
   - Ako korisnik u opisu napiše specifikaciju (npr. "3 seta po 5 intervala", "76 TSS", "60 min", "odmori 2 min"), to je ZAKON i mora biti točno tako ugrađeno.
4. FORMAT KOMPOZITNOG TRAJANJA (MINUTE I SEKUNDE):
   - Za intervale koji imaju minute i sekunde, piši standardni format: \`- 1m20s 125%\` ili \`- 80s 125%\`, \`- 1m05s 121%\`, \`- 1m10s 122%\`, \`- 1m15s 123%\`.
   - Nikada nemoj ispuštati minute!
5. BALANSIRANJE UKUPNOG TRAJANJA:
   - Ukupno trajanje svih koraka (Zagrijavanje + Setovi + Oporavci + Hlađenje) mora točno odgovarati ciljanom trajanju treninga (npr. 60 minuta). Zadnji korak (Hlađenje) prilagodi tako da ukupna suma sekundi bude točno na ciljanoj minuti.
6. TOČAN FORMAT KODA:
Na početku daj 2-3 rečenice analize onoga što si prepoznao (naziv, trajanje, setove, TSS), a zatim OBAVEZNO ispiši strukturirani blok:
\`\`\`workout
TITLE: Naziv Treninga
CATEGORY: VO2max | SweetSpot | Threshold | Endurance | Anaerobic | Recovery
DURATION: trajanje u minutama
TSS: točan broj
STEPS:
Zagrijavanje
- 10m 50-75%

Set 1
- 1m 120%
- 2m 40%
- 1m05s 121%
- 2m 40%
- 1m10s 122%
- 2m 40%
- 1m15s 123%
- 2m 40%
- 1m20s 125%

Oporavak
- 3m 40%

Set 2
- 1m 120%
- 2m 40%
- 1m05s 121%
- 2m 40%
- 1m10s 122%
- 2m 40%
- 1m15s 123%
- 2m 40%
- 1m20s 125%

Oporavak
- 3m 40%

Set 3
- 1m 120%
- 2m 40%
- 1m05s 121%
- 2m 40%
- 1m10s 122%
- 2m 40%
- 1m15s 123%
- 2m 40%
- 1m20s 125%

Hlađenje
- 2m 40%
\`\`\`
`;

  const parts = [];

  let promptText = description?.trim()
    ? `Rekreiraj ovaj trening sa slike poštujući ove korisničke upute i specifikacije:\n${description.trim()}`
    : 'Pažljivo analiziraj priloženu sliku treninga, očitaj točan naziv, trajanje, TSS i točan broj intervala u svakom setu te ga rekreiraj u strukturirani ErgVibe workout.';

  if (targetDuration) {
    promptText += `\nCILJANO TRAJANJE: ${targetDuration} minuta (ukupni zbroj Zagrijavanja, Setova, Oporavaka i Hlađenja MORA iznositi točno ${targetDuration} min).`;
  }
  if (targetTss) {
    promptText += `\nCILJANI TSS: ${targetTss} TSS (potrebno postići točno ${targetTss} TSS).`;
  }

  parts.push({ text: promptText });

  if (imageBase64 && mimeType) {
    parts.push({
      inlineData: {
        mimeType,
        data: imageBase64
      }
    });
  }

  return callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts }],
    model,
    temperature: 0.1
  });
}

/**
 * Interaktivna dorada postojećeg workouta prema uputama sportaša ili trenera.
 * Omogućuje iterativno usavršavanje (npr. dodaj stepenasto zagrijavanje, promijeni odmore, dodaj set).
 */
export async function refineWorkoutWithAi({
  currentCode,
  userInstruction,
  title = '',
  category = 'VO2max',
  targetDuration = 60,
  targetTss = null,
  imageBase64 = null,
  mimeType = 'image/jpeg',
  athleteProfile = null,
  model = 'gemini-3.8-flash'
}) {
  const ftp = Number(athleteProfile?.ftp) || 270;
  const weight = Number(athleteProfile?.weight) || 74;

  const systemInstruction = `Ti si specijalizirani ErgVibe AI Workout Editor i vrhunski biciklistički trener.
Tvoj zadatak je modificirati i poboljšati POSTOJEĆI Intervals.icu workout prema točnim uputama biciklista.

Profil sportaša:
- Trenutni FTP: ${ftp} W | Težina: ${weight} kg

PRAVILA ZA INTERAKTIVNU DORADU:
1. ZADRŽI STRUKTURU KOJU KORISNIK NIJE TRAŽIO DA SE MIJENJA:
   - Ako korisnik zatraži npr. "dodaj stepenasto zagrijavanje", promijeni SAMO Zagrijavanje (npr. dodaj stepenasti ramp ili piramidu), a zadrži postojeće radne setove i odmore!
   - Ako korisnik zatraži "skrati odmore na 90s", promijeni samo odmore između intervala.
   - Ako zatraži "dodaj još jedan set", repliciraj radni set uz odgovarajući odmor.
2. TOČAN FORMAT KORAKA (Intervals.icu):
   - Zagrijavanje: npr. \`- 10m ramp 50-75%\` ili stepenasto: \`- 3m 50%\`, \`- 3m 60%\`, \`- 4m 70%\`.
   - Radni intervali: \`- 1m 120%\`, \`- 1m20s 125%\`, \`- 80s 125%\` itd.
   - Odmori / Oporavci: \`- 2m 40%\` ili \`- 90s 40%\`.
   - Hlađenje: \`- 5m 40%\` (uskladi da ukupno vrijeme odgovara ciljanom trajanju).
3. IZLAZNI FORMAT:
Napiši 1 kratku rečenicu objašnjenja što si prilagodio, a zatim OBAVEZNO ispiši:
\`\`\`workout
TITLE: ${title || 'Trening'}
CATEGORY: ${category || 'VO2max'}
DURATION: ${targetDuration || 60}
TSS: ${targetTss || 75}
STEPS:
[Ovdje idu svi ažurirani koraci treninga u Intervals.icu formatu]
\`\`\`
`;

  const parts = [];

  let promptText = `Ovo je trenutni workout:\n\`\`\`intervals\n${currentCode}\n\`\`\`\n\n`;
  promptText += `KORISNIČKA UPUTA ZA DORADU:\n"${userInstruction.trim()}"\n\n`;
  promptText += `Primijeni traženu izmjenu na ovaj workout i vrati ažurirani \`\`\`workout ... \`\`\` blok.`;

  if (targetDuration) {
    promptText += `\nCiljano ukupno trajanje ostaje: ${targetDuration} minuta.`;
  }

  parts.push({ text: promptText });

  if (imageBase64 && mimeType) {
    parts.push({
      inlineData: {
        mimeType,
        data: imageBase64
      }
    });
  }

  return callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts }],
    model,
    temperature: 0.1
  });
}

/**
 * Automatsko generiranje cjelovitog periodiziranog trenažnog plana.
 */
export async function generateStructuredTrainingPlan({
  goal,
  weeks = 2,
  workoutsPerWeek = 4,
  hoursPerWeek = 6,
  methodology,
  startDate,
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  notes = '',
  userNotes = '',
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const resolvedNotes = String(userNotes || notes || '').trim();
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt();

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}

### ZADATAK GENERATORA TRENAŽNOG PLANA:
Generiraj detaljan, periodizirani trenažni plan od ${weeks} tjedna (${workoutsPerWeek} treninga tjedno, ukupno ~${hoursPerWeek} sati tjedno) počevši od datuma ${startDate}.
Metodologija: ${methodology}.
Glavni cilj sportaša: "${goal}".
${resolvedNotes ? `Dodatne želje vozača: "${resolvedNotes}"` : ''}

VAŽNO: Odgovor MORA biti ISKLJUČIVO valjani JSON objekt (bez ikakvog uvodnog ili zaključnog teksta, bez markdown backtick oznaka \`\`\`json).
Format JSON-a:
{
  "planTitle": "Naziv plana",
  "summary": "Stručni pregled mezociklusa, ciljeva i raspodjele intenziteta",
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "Fokus tjedna",
      "targetHours": 6.5,
      "targetTss": 380,
      "workouts": [
        {
          "dayOffset": 0,
          "dayName": "Ponedjeljak",
          "title": "Naziv treninga",
          "category": "SweetSpot | Endurance | Threshold | VO2max | Recovery",
          "durationMinutes": 60,
          "estimatedTss": 65,
          "description": "Fiziološki cilj i uputa",
          "intervalsCode": "- 10m 55% Zagrijavanje\\n3x\\n- 8m 90% Sweet Spot\\n- 4m 50% Oporavak\\n- 10m 45% Hlađenje",
          "steps": [
            { "name": "Zagrijavanje", "duration": 600, "power": 55 },
            { "name": "Interval 1", "duration": 480, "power": 90 },
            { "name": "Pauza", "duration": 240, "power": 50 }
          ]
        }
      ]
    }
  ]
}
Napomena za jedinice: 'durationMinutes' je OBAVEZNO cijeli broj minuta (npr. 60 ili 90, NIKAKO sekunde). U steps nizu 'duration' je u sekundama, a 'power' u postotku FTP-a (% FTP).`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: `Generiraj JSON trenažni plan za cilj: ${goal}` }] }],
    model,
    temperature: 0.3,
    responseMimeType: 'application/json'
  });

  try {
    const cleanJson = rawJsonText.replace(/```json\s*|```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('[geminiService] JSON parse error:', err, rawJsonText);
    throw new Error('AI nije vratio valjani JSON format plana. Pokušaj ponovno.');
  }
}

/**
 * Analizira javni YouTube video i pretvara ga u strukturirani trenerski sažetak za bazu znanja.
 * Koristi Google Gemini multimodalno razumijevanje videa.
 */
export async function analyzeYouTubeVideoForKnowledgeBase(youtubeUrl) {
  const cleanUrl = String(youtubeUrl || '').trim();
  const match = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([\w-]{11})/);
  if (!match) {
    throw new Error('Nevažeća YouTube poveznica. Unesi ispravan URL (npr. https://www.youtube.com/watch?v=...)');
  }
  const videoId = match[1];
  const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const promptText = `Analiziraj ovaj YouTube video s biciklističkom, fiziološkom ili sportskom tematikom. 
Tvoj zadatak je izvući i strukturirati znanje iz videa za potrebe baze znanja osobnog biciklističkog AI trenera.

Formatiraj odgovor točno u ovom formatu (obavezno sačuvaj ključne oznake):
TITLE: [Naslov teme ili točan naslov videa]
AUTHOR: [Ime kanala, govornika ili autora predavanja]
CATEGORY: YouTube predavanje / podcast
SUMMARY: [Sažetak u 2-3 rečenice o tome što video obrađuje i koji je ključni zaključak za biciklista]
CONTENT:
### 1. KLJUČNI ZNANSTVENI I FIZIOLOŠKI KONCEPTI
(Glavni nalazi studija, mehanizmi adaptacije, mitohondriji, laktat, zona 2, VO2max itd.)

### 2. TRENERSKE PREPORUKE I PROTOKOLI
(Konkretne preporuke iz videa: intenziteti u % FTP/pulsa, intervali, omjeri rada i odmora, prehrana/ugljikohidrati, regeneracija)

### 3. PRAKTIČNI SAVJETI ZA PRIMJENU
(Kako biciklist rekreativac ili natjecatelj ovo može primijeniti u svom tjednom planu)`;

  const contents = [
    {
      role: 'user',
      parts: [
        {
          fileData: {
            mimeType: 'video/mp4',
            fileUri: standardUrl
          }
        },
        {
          text: promptText
        }
      ]
    }
  ];

  const rawText = await callGeminiApi({
    contents,
    model: 'gemini-3.8-flash',
    temperature: 0.3
  });

  let title = `YouTube: ${videoId}`;
  let author = 'YouTube';
  let category = 'YouTube predavanje / podcast';
  let summary = '';
  let content = rawText;

  const titleMatch = rawText.match(/^TITLE:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();

  const authorMatch = rawText.match(/^AUTHOR:\s*(.+)$/m);
  if (authorMatch) author = authorMatch[1].trim();

  const categoryMatch = rawText.match(/^CATEGORY:\s*(.+)$/m);
  if (categoryMatch) category = categoryMatch[1].trim();

  const summaryMatch = rawText.match(/^SUMMARY:\s*(.+)$/m);
  if (summaryMatch) summary = summaryMatch[1].trim();

  const contentIdx = rawText.indexOf('CONTENT:');
  if (contentIdx !== -1) {
    content = rawText.slice(contentIdx + 'CONTENT:'.length).trim();
  }

  return {
    title,
    author,
    category,
    summary,
    content: (summary ? `> **Sažetak:** ${summary}\n\n` : '') + content,
    videoId,
    sourceUrl: standardUrl
  };
}

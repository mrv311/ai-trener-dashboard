/**
 * ErgVibe Gemini AI Coaching Service
 * Povezuje Google Gemini (Flash / Pro) putem sigurnog backend proxyja (/api/gemini)
 * s poviješću treninga sportaša, fiziološkom literaturom i live metrikama.
 */

import { compileKnowledgeBasePrompt } from './aiKnowledgeBase';
import { buildAthleteContextPrompt, findExactHistoricalRecord } from './historyService';

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
  try {
    const proxyRes = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction,
        contents,
        model,
        temperature,
        responseMimeType,
        customApiKey: customKey || undefined
      })
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data?.text) return data.text;
    } else if (proxyRes.status !== 404) {
      const errJson = await proxyRes.json().catch(() => ({}));
      throw new Error(errJson?.error || `AI poslužiteljska greška (HTTP ${proxyRes.status})`);
    }
  } catch (proxyErr) {
    // Ako je proxy vratio eksplicitnu grešku, proslijedi je korisniku
    if (proxyErr.message && !proxyErr.message.includes('Failed to fetch') && !proxyErr.message.includes('404')) {
      throw proxyErr;
    }
  }

  // 2. FALLBACK: Direktni poziv samo ako proxy nije dostupan i postoji lokalni ključ
  const fallbackKey = customKey || import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!fallbackKey || fallbackKey === 'your-gemini-api-key') {
    throw new Error('Gemini AI poslužitelj nije konfiguriran (GEMINI_API_KEY). Postavi varijablu u Vercel Environment Variables ili unesi privremeni ključ u tabu Veze.');
  }

  let effectiveModel = model;
  if (!customKey && String(effectiveModel).toLowerCase().includes('pro')) {
    effectiveModel = 'gemini-2.5-flash';
  }

  const generationConfig = {
    temperature,
    maxOutputTokens: 16384
  };
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }

  const body = {
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    contents,
    generationConfig
  };

  const executeForModel = async (targetModel) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(fallbackKey)}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  };

  let response = await executeForModel(effectiveModel);

  if (response.status === 404) {
    const fallbackModel = String(effectiveModel).toLowerCase().includes('pro') ? 'gemini-pro-latest' : 'gemini-2.5-flash';
    if (effectiveModel !== fallbackModel) {
      response = await executeForModel(fallbackModel);
    }
    if (response.status === 404) {
      response = await executeForModel('gemini-1.5-flash');
    }
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
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    });
  });

  contents.push({ role: 'user', parts: [{ text: question }] });

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
  chatHistory = [],
  userMessage,
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
VAŽNO: DURATION i durationMinutes su U MINUTAMA (npr. 60 ili 75, NIKAKO u sekundama poput 3600). U steps nizu, pojedinačni "duration" je u sekundama, a "power" je u % FTP.`;

  const formattedContents = chatHistory.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));

  formattedContents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  return callGeminiApi({
    systemInstruction,
    contents: formattedContents,
    model,
    temperature: 0.4
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
  userNotes = '',
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

### ZADATAK GENERATORA TRENAŽNOG PLANA:
Generiraj detaljan, periodizirani trenažni plan od ${weeks} tjedna (${workoutsPerWeek} treninga tjedno, ukupno ~${hoursPerWeek} sati tjedno) počevši od datuma ${startDate}.
Metodologija: ${methodology}.
Glavni cilj sportaša: "${goal}".
${userNotes ? `Dodatne želje vozača: "${userNotes}"` : ''}

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

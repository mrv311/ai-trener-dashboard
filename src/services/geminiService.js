/**
 * ErgVibe Gemini AI Coaching Service
 * Povezuje Google Gemini (Flash / Pro) putem sigurnog backend proxyja (/api/gemini)
 * s poviješću treninga sportaša, fiziološkom literaturom i live metrikama.
 */

import { compileKnowledgeBasePrompt } from './aiKnowledgeBase';
import { buildAthleteContextPrompt, findExactHistoricalRecord } from './historyService';
import { getAttachmentFromLocalDB } from './aiFilesStorage';
import { supabase } from './supabaseClient';
import {
  WEEKDAY_DEFS,
  addDaysIso,
  getMondayOfWeekIso,
  summarizeWeeklySchedule,
  isRestDayWorkout
} from '../utils/plannerUtils';
import {
  parseIntervalsCode,
  stepsToIntervalsCode,
  normalizeIntervalsWorkoutText
} from '../utils/workoutParser';
import { isCyclingType, isStrengthType, isNonCyclingEvent } from '../utils/sportTypes';
import { getCurrentLanguage, tr } from '../i18n/i18nCore.js';

const STORAGE_KEY_CUSTOM_API_KEY = 'ergvibe_custom_gemini_key';
const STORAGE_KEY_ANALYSES_CACHE = 'ergvibe_ai_workout_analyses_v1';

const EN_WEEKDAY_NAMES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
};

function buildLanguageInstruction(isEn) {
  if (isEn) {
    return `### MANDATORY OUTPUT LANGUAGE RULE (ENGLISH):
- Even if some athlete context, historical data labels, or reference knowledge base sections above are written in Croatian, you MUST write your ENTIRE response in crisp, natural, professional **English**!
- All prose, headings, explanations, coaching tips, workout titles, descriptions, interval step names, plan phase names, week focuses, key session labels, and coach notes MUST be in English.
- Keep exact JSON schema keys, canonical \`dayKey\` values (\`mon\`, \`tue\`, \`wed\`, \`thu\`, \`fri\`, \`sat\`, \`sun\`), \`phaseType\` values (\`base | build | peak | taper | race\`), \`type\` values (\`ride | strength\`), and structured block markers (\`TITLE:\`, \`AUTHOR:\`, \`CATEGORY:\`, \`SUMMARY:\`, \`CONTENT:\`, \`DURATION:\`, \`TSS:\`, \`STEPS:\`) unchanged.`;
  }
  return `### OBAVEZNO PRAVILO JEZIKA ODGOVORA (HRVATSKI):
- Piši cijeli odgovor na jasnom, stručnom i prirodnom **hrvatskom jeziku** (sve naslove, objašnjenja, savjete, nazive treninga/faza i bilješke).`;
}

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

function getAnalysesCacheStorageKey(userId) {
  const safeUser = String(userId || 'guest').trim() || 'guest';
  return `${STORAGE_KEY_ANALYSES_CACHE}_${safeUser}`;
}

export function getCachedWorkoutAnalysis(cacheKey, userId = null) {
  if (!cacheKey) return null;
  try {
    const scopedStore = JSON.parse(localStorage.getItem(getAnalysesCacheStorageKey(userId)) || '{}');
    if (scopedStore[cacheKey]) return scopedStore[cacheKey];
    // Kompatibilnost sa starijim globalnim cache ključem
    const legacyStore = JSON.parse(localStorage.getItem(STORAGE_KEY_ANALYSES_CACHE) || '{}');
    return legacyStore[cacheKey] || null;
  } catch {
    return null;
  }
}

export function saveCachedWorkoutAnalysis(cacheKey, payload, userId = null) {
  if (!cacheKey) return;
  try {
    const key = getAnalysesCacheStorageKey(userId);
    const store = JSON.parse(localStorage.getItem(key) || '{}');
    store[cacheKey] = {
      ...payload,
      updatedAt: new Date().toISOString()
    };
    // Zadrži zadnjih 60 analiza po korisniku kako ne bismo preopteretili localStorage
    const entries = Object.entries(store).sort(
      (a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || ''))
    );
    const trimmed = Object.fromEntries(entries.slice(0, 60));
    localStorage.setItem(key, JSON.stringify(trimmed));
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

  let authHeader = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (accessToken) {
      authHeader = `Bearer ${accessToken}`;
    }
  } catch {
    // nastavi kao gost bez Authorization zaglavlja
  }

  let proxyRouteMissing = false;
  let lastNetworkError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 58000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (authHeader) {
        headers.Authorization = authHeader;
      }
      const proxyRes = await fetch('/api/gemini', {
        method: 'POST',
        headers,
        body: proxyPayload,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data?.text) return data.text;
        throw new Error(tr('AI poslužitelj nije vratio tekstualni odgovor. Pokušaj ponovno.', 'AI server did not return a text response. Please try again.'));
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
      const serverErr = new Error(
        errJson?.error || tr('AI poslužiteljska greška (HTTP {status})', 'AI server error (HTTP {status})', { status: proxyRes.status })
      );
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
        throw new Error(tr(
          'AI poslužitelj je predugo obrađivao zahtjev (timeout). Pokušaj ponovno s kraćim upitom.',
          'AI server request timed out. Please try again with a shorter prompt.'
        ));
      }
      throw new Error(tr(
        'Prekid mrežne veze prema AI poslužitelju. Provjeri mobilni internet / VPN i drži zaslon uključenim dok AI priprema odgovor, pa pokušaj ponovno.',
        'Network connection to the AI server was interrupted. Check your connection/VPN, keep your screen awake while AI responds, and try again.'
      ));
    }
    throw new Error(tr(
      'Gemini AI poslužitelj nije konfiguriran (GEMINI_API_KEY). Postavi varijablu u Vercel Environment Variables ili unesi privremeni ključ u tabu Veze.',
      'Gemini AI server is not configured (GEMINI_API_KEY). Set it in Vercel Environment Variables or enter a temporary API key in the Connections tab.'
    ));
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
    throw new Error(tr('Gemini API greška: {detail}', 'Gemini API error: {detail}', { detail: errDetail }));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter(p => !p.thought)
    ?.map(p => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(tr('Gemini nije vratio tekstualni odgovor. Pokušaj ponovno.', 'Gemini did not return a text response. Please try again.'));
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
  const isEn = getCurrentLanguage() === 'en';
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: activity,
    userQuery: userNote,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

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

  const userPrompt = isEn
    ? `Analyze the athlete's completed cycling workout:

### WORKOUT DETAILS:
- **Title:** ${activity.name || activity.title || 'Workout'}
- **Date:** ${(activity.started_at || activity.date || '').slice(0, 10)}
- **Duration:** ${durationMin} min
- **Average Power:** ${avgWatts} W (${wKgVal} W/kg)
- **Normalized Power (NP):** ${npWatts} W
- **Intensity Factor (IF):** ${ifFactor}
- **Training Stress Score (TSS):** ${tss}
- **Average Heart Rate (Avg HR):** ${hrAvg} bpm | Max HR: ${hrMax} bpm
- **Aerobic Decoupling (Pw:HR):** ${decoupling}
- **Efficiency Factor (EF = NP / Avg HR):** ${efVal}
- **Variability Index (VI = NP / Avg Power):** ${viVal}
- **Activity Source:** ${activity.workout_source || (activity.isSupabase ? 'ErgVibe Database' : 'Intervals.icu')}
${userNote ? `- **Rider Subjective Note:** "${userNote}"` : ''}

${exactHistory ? `### ENRICHED DATA FROM HISTORICAL / CSV DATABASE FOR THIS ACTIVITY:
- Date: ${(exactHistory.date || '').slice(0, 10)} | Title: ${exactHistory.name || exactHistory.title || 'Workout'}
- NP: ${exactHistory.np ?? '-'}W | EF: ${exactHistory.ef ?? '-'} | Decoupling: ${exactHistory.dec ?? exactHistory.decoupling ?? '-'}% | TSS: ${exactHistory.tss ?? '-'}${exactHistory.climb ? ` | Elevation: +${exactHistory.climb}m` : ''}${exactHistory.cad ? ` | Cadence: ${exactHistory.cad}rpm` : ''}${exactHistory.rhr ? ` | RHR: ${exactHistory.rhr}bpm` : ''}${exactHistory.hrr ? ` | HRRc: ${exactHistory.hrr}bpm` : ''}${exactHistory.wFtpKj ? ` | W>FTP: ${exactHistory.wFtpKj}kJ` : ''}${exactHistory.ctl != null ? ` | CTL: ${exactHistory.ctl} / TSB: ${exactHistory.tsb ?? '-'}` : ''}
- Incorporate these additional physiological metrics into the analysis.` : ''}

Write the analysis in a structured, expert coaching format in English following the coaching guidelines.`
    : `Analiziraj odrađeni biciklistički trening sportaša:

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

${exactHistory ? `### OBOGAĆENI PODACI IZ POVIJESNE / CSV BAZE ZA OVU AKTIVNOST:
- Datum: ${(exactHistory.date || '').slice(0, 10)} | Naziv: ${exactHistory.name || exactHistory.title || 'Trening'}
- NP: ${exactHistory.np ?? '-'}W | EF: ${exactHistory.ef ?? '-'} | Decoupling: ${exactHistory.dec ?? exactHistory.decoupling ?? '-'}% | TSS: ${exactHistory.tss ?? '-'}${exactHistory.climb ? ` | Uspon: +${exactHistory.climb}m` : ''}${exactHistory.cad ? ` | Kadenca: ${exactHistory.cad}rpm` : ''}${exactHistory.rhr ? ` | RHR: ${exactHistory.rhr}bpm` : ''}${exactHistory.hrr ? ` | HRRc: ${exactHistory.hrr}bpm` : ''}${exactHistory.wFtpKj ? ` | W>FTP: ${exactHistory.wFtpKj}kJ` : ''}${exactHistory.ctl != null ? ` | CTL: ${exactHistory.ctl} / TSB: ${exactHistory.tsb ?? '-'}` : ''}
- Uključi ove dodatne fiziološke metrike u analizu.` : ''}

Napiši analizu u strukturiranom, stručnom formatu prema zadanim trenerskim uputama.`;

  return callGeminiApi({
    systemInstruction: `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${buildLanguageInstruction(isEn)}`,
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
  const isEn = getCurrentLanguage() === 'en';
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    throw new Error(tr('Pitanje ne može biti prazno.', 'Question cannot be empty.'));
  }

  const prevUserFollowUp = [...(Array.isArray(qaHistory) ? qaHistory : [])]
    .reverse()
    .find(m => m?.role === 'user');

  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: activity,
    userQuery: cleanQuestion,
    contextQuery: String(prevUserFollowUp?.text ?? prevUserFollowUp?.content ?? '').trim(),
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const systemInstruction = isEn
    ? `You are the ErgVibe AI Cycling Coach. You are answering a rider's follow-up question regarding the just-analyzed workout "${activity?.title || activity?.name || 'Workout'}" (${(activity?.started_at || activity?.date || '').slice(0, 10)}).
Be specific, clear, and ground your answer in the athlete's telemetry data and coaching knowledge base. Respond in natural, professional English.

${athleteContextPrompt}

${knowledgeBasePrompt}

${buildLanguageInstruction(true)}`
    : `Ti si ErgVibe AI biciklistički trener. Odgovaraš na dodatno pitanje vozača vezano uz upravo analizirani trening "${activity?.title || activity?.name || 'Trening'}" (${(activity?.started_at || activity?.date || '').slice(0, 10)}).
Budi konkretan, jasan i osloni se na podatke sportaša i bazu znanja. Odgovaraj na hrvatskom jeziku.

${athleteContextPrompt}

${knowledgeBasePrompt}

${buildLanguageInstruction(false)}`;

  const contents = [
    { role: 'user', parts: [{ text: isEn ? 'Analyze my workout.' : 'Analiziraj moj trening.' }] },
    { role: 'model', parts: [{ text: initialAnalysis || (isEn ? 'Analysis ready.' : 'Analiza spremna.') }] }
  ];

  qaHistory.forEach(msg => {
    const msgText = String(msg?.text ?? msg?.content ?? '').trim();
    if (!msgText) return;
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msgText }]
    });
  });

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
  const isEn = getCurrentLanguage() === 'en';
  const fullRawList = Array.isArray(messages) && messages.length > 0
    ? messages
    : [
        ...(Array.isArray(chatHistory) ? chatHistory : []),
        ...(String(userMessage || '').trim() ? [{ role: 'user', text: String(userMessage).trim() }] : [])
      ];

  // Izvuci zadnje (i pretposljednje) korisničko pitanje za Razinu 2 (pametni mini-RAG nad cijelim CSV-om)
  const userTurnTexts = fullRawList
    .filter(m => m?.role === 'user')
    .map(m => String(m?.text ?? m?.content ?? '').trim())
    .filter(Boolean);
  const latestUserQuery = userTurnTexts[userTurnTexts.length - 1] || String(userMessage || '').trim();
  const previousUserQuery = userTurnTexts.length >= 2 ? userTurnTexts[userTurnTexts.length - 2] : '';

  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userQuery: latestUserQuery,
    contextQuery: previousUserQuery,
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const chatGuide = isEn
    ? `### SPECIFIC INSTRUCTIONS FOR CHAT & GENERATING ERGVIBE WORKOUTS:
1. Respond as a world-class cycling coach and exercise physiologist. Be clear, precise, data-driven, and motivating.
2. Whenever the athlete requests a workout or you prescribe a session for today / the smart trainer, ALWAYS include a structured block at the end of your response in this exact format:
\`\`\`workout
TITLE: Workout Title
CATEGORY: SweetSpot | Endurance | Threshold | VO2max | Anaerobic | Recovery
DURATION: 60
TSS: 65
STEPS:
Warmup
- 10m 55%
Main Set
3x
- 8m 90%
- 4m 50%
Cooldown
- 10m 50%
\`\`\`
3. STEP, DURATION, AND SET FORMATTING:
   - For durations with minutes and seconds, use standard format: \`- 1m20s 125%\` or \`- 80s 125%\` (never drop the minutes).
   - When recreating a workout from an image or description (e.g., TrainerRoad, Zwift), count the exact number of work intervals in every set and preserve the exact stated total duration (e.g., 60 min) and TSS (e.g., 76 TSS). Adjust the Cooldown duration so the sum of steps matches total duration exactly.
Or in JSON format:
\`\`\`ergvibe-workout
{
  "title": "Workout Title",
  "description": "Short summary of physiological target and stimulus",
  "category": "SweetSpot | Endurance | Threshold | VO2max | Anaerobic | Recovery",
  "durationMinutes": 60,
  "steps": [
    { "name": "Warmup", "duration": 600, "power": 55 },
    { "name": "Z2 Ramp", "duration": 300, "power": 68 },
    { "name": "Sweet Spot Interval", "duration": 600, "power": 90 },
    { "name": "Recovery", "duration": 300, "power": 50 }
  ]
}
\`\`\`
IMPORTANT: DURATION and durationMinutes MUST be IN MINUTES (e.g., 60 or 75, NEVER seconds like 3600). Inside the steps array, each step's "duration" is in seconds and "power" is in % FTP.

### 🚴‍♂️ VISUAL WORKOUT REVERSE-ENGINEERING PROTOCOL:
When the athlete uploads an image or screenshot of a cycling workout (Zwift, TrainerRoad, TrainingPeaks, Intervals.icu, Garmin Connect, Rouvy, Wahoo SYSTM, a paper training plan, or a power chart), YOUR TOP PRIORITY IS:
DECONSTRUCT THAT IMAGE INTO 100% IDENTICAL, ACCURATE ERGVIBE CODE THAT CAN BE LAUNCHED IN ONE CLICK ON THE SMART TRAINER OR ADDED TO THE CALENDAR!

Follow these strict steps and coaching rules:

1. HEADER & CORE PARAMETERS (Source of Truth):
   - **Workout Title (TITLE):** Extract the exact title at the top or caption (e.g., "The Gorby", "Carson -2", "4x10min FTP", "Sweet Spot 3x15"). If no title appears, create a clear, recognizable title matching the zone and structure (e.g., "VO2max 5x3min @ 115%").
   - **Total Duration (DURATION):** Carefully read the total duration shown on the graphic (e.g., "1:00:00", "45:00", "1h 15m").
     ⚠️ CRITICAL: The sum of minutes of all your steps (Warmup + Repeat Sets + Rests + Cooldown) MUST EQUAL that exact total duration! Never output a 42 min workout if the graphic says 60 min.
   - **TSS & IF:** If TSS and Intensity Factor are shown on the image, copy them verbatim. Otherwise estimate them from duration and zone.

2. PRIORITY OF TEXT & TABLES OVER PIXELS:
   - If the image contains a text summary, step legend, or table (e.g., "5 x 3 min @ 110-120% FTP with 3 min rest" or "Warmup 10:00 ramp from 100W to 200W"), ALWAYS use those exact numbers! Explicit text is ground truth.
   - If watts (W) are shown instead of percentages, compare against the rider's FTP (from the athlete context above) and convert to exact % FTP (e.g., 250W at 277W FTP = 90% FTP).

3. DECODING GRAPHICAL BARS, COLORS, AND RAMPS (WHEN NO TEXT IS PRESENT):
   - Standard cycling app zone colors (Zwift, TrainerRoad, Intervals, Garmin):
     * Grey / Dark Grey = Z1 Recovery / Spin (< 55% FTP)
     * Blue = Z2 Endurance / Aerobic Base (56% - 75% FTP, typically 65-70%)
     * Green = Z3 Tempo (76% - 90% FTP, typically 80-85%)
     * Light Green / Yellow-Green = Sweet Spot (88% - 94% FTP, typically 90%)
     * Yellow = Z4 Threshold / FTP (95% - 105% FTP, typically 100%)
     * Orange = Z5 VO2max (106% - 120% FTP, typically 110-115%)
     * Red = Z6 Anaerobic Capacity (121% - 150% FTP, typically 125-130%)
     * Purple / Bright Red = Z7 Neuromuscular Sprint (> 150% FTP)
   - Ramps (sloped blocks):
     * Rising ramp (common in warmups): write as a range, e.g., \`- 10m 50-75%\` or \`- 5m 60-80%\`.
     * Falling ramp (cooldown): e.g., \`- 5m 70-50%\` or \`- 5m 50%\`.
   - Cadence (RPM): If cadence cues appear (e.g., "High Cadence 100 RPM" or "Low Cadence 70 RPM"), append them at the end of the step line (e.g., \`- 4m 95% 95rpm\`).

4. GROUPING REPEATING SETS (Nx SYNTAX):
   - Recognize repeating blocks! If you see e.g. 5 identical work intervals with equal recovery, write them cleanly using \`Nx\` notation:
     Main Set
     5x
     - 3m 115%
     - 3m 50%
   - If intervals within a set are NOT equal (e.g., pyramid 1m, 2m, 3m, 2m, 1m or descending power steps), list them line by line without an Nx multiplier.

5. TEMPORAL INTEGRITY CHECK BEFORE OUTPUTTING:
   - Sum the duration step by step:
     * Warmup: 10 min
     * Set 4x (5m work + 5m rest) = 4 x 10 min = 40 min
     * Cooldown: 10 min
     * TOTAL = 10 + 40 + 10 = 60 min.
   - If you are missing time compared to the graphic, check for warmup openers (e.g., 3x30s cadence drills) or a final cooldown block!

6. REQUIRED OUTPUT STRUCTURE FOR IMAGE REVERSE-ENGINEERING:
   Before writing the workout block, ALWAYS write a concise visual breakdown first:
   ### 🔍 VISUAL IMAGE ANALYSIS:
   - **Source / Platform:** (e.g., TrainerRoad, Zwift, TrainingPeaks, Garmin, chart/table)
   - **Detected Workout Title:** (e.g., Carson, The Wringer, or exact title on screen)
   - **Total Duration on Graphic:** (e.g., 60 min or 45 min)
   - **Number of Work Intervals:** (exact counted bars, e.g., 5 or 6)
   - **Zone & Work Intensity:** (e.g., yellow Z4 / Sweet Spot, ~90% FTP = 249 W)
   - **Work & Recovery Duration:** (e.g., 6 min @ 90%, 2 min @ 50%)
   - **Warmup & Cooldown:** (e.g., 10 min ramp 50-75%, 2 min cooldown @ 50%)
   - **Duration Math Check:** 10m + 6x(6m+2m) + 2m = 60m (must match the image!)

   ONLY AFTER THIS BREAKDOWN, output the ready-to-ride block:
\`\`\`workout
TITLE: Exact Workout Title
CATEGORY: Sweet Spot | VO2 Max | Threshold | Endurance | Anaerobic | Tempo | Recovery | Testing
DURATION: 60
TSS: 65
STEPS:
Warmup
- 10m 50-75%
Main Set
4x
- 8m 95%
- 4m 50%
Cooldown
- 6m 50%
\`\`\`
   - After the code block, provide 3 concrete coaching tips:
     1. Exact watt targets for work and rest intervals based on the athlete's current FTP.
     2. Cadence and biomechanics cue (e.g., steady 90–95 rpm, relaxed upper body).
     3. Smart trainer execution tip (ERG mode guidance, cooling fan, fueling/hydration).

7. 🔄 FOLLOW-UP CORRECTION PROTOCOL:
   If the rider replies with a correction (e.g., "actually it's 5x not 4x", "rest is 2 min not 4 min", "it's Sweet Spot not VO2max", "total time is 45 min not 60 min"):
   - Treat the rider's correction as ABSOLUTE FACT.
   - Keep all accurate parts unchanged and modify ONLY what the rider specified.
   - Re-verify total duration and ALWAYS output a NEW updated \`\`\`workout\`\`\` block so the rider can save or launch it immediately!

### SPECIFIC INSTRUCTIONS FOR PHYSIOLOGICAL LAB REPORTS (LACTATE TEST, VO2MAX / CPET, BLOOD WORK):
If a message includes an attached image or PDF of a spiroergometry / VO2max test, lactate step test, blood panel, or graded exercise table:
1. Carefully extract all tabular and plotted values: watts per stage, heart rate (HR), lactate (mmol/L), VO2max, ventilation, or cadence.
2. Accurately identify key physiological landmarks:
   - **LT1 / Aerobic Threshold:** first sustained lactate rise above baseline (typically ~1.5–2.0 mmol/L or VT1).
   - **LT2 / MLSS / Anaerobic Threshold (FTP):** point of rapid lactate accumulation (~4.0 mmol/L or sharp inflection point).
3. Compare findings with the rider's current ErgVibe profile (FTP, weight, zones) and clearly recommend:
   - Updated FTP or HR thresholds if they differ from current settings.
   - Exact wattage ranges for Zone 2 endurance below LT1 and Sweet Spot / Threshold around LT2.`
    : `### SPECIFIČNA UPUTA ZA CHAT I GENERIRANJE ERGVIBE TRENINGA:
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
CATEGORY: Sweet Spot | VO2 Max | Threshold | Endurance | Anaerobni | Tempo | Oporavak | Testiranje
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

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${chatGuide}\n\n${buildLanguageInstruction(isEn)}`;

  // Pametni klizni prozor: cijeli razgovor se čuva lokalno u IndexedDB, a prema AI šaljemo zadnjih 20 poruka
  // kako odgovori ostali brzi i stabilni. Teške slike/PDF-ove prilažemo kao inlineData samo za zadnja 4 turna.
  const MAX_CONTEXT_MESSAGES = 20;
  const MAX_MULTIMODAL_RECENT_TURNS = 4;
  const rawList = fullRawList.length > MAX_CONTEXT_MESSAGES
    ? fullRawList.slice(-MAX_CONTEXT_MESSAGES)
    : fullRawList;

  // 1. Pripremi asinkrono sve partove uključujući multimodalne privitke (slike i PDF-ove)
  const normalizedTurns = [];
  for (let i = 0; i < rawList.length; i++) {
    const m = rawList[i];
    const isRecentForAttachments = i >= rawList.length - MAX_MULTIMODAL_RECENT_TURNS;
    const txt = String(m?.text ?? m?.content ?? '').trim();
    const parts = [];

    // Dodaj tekstualni dio ako postoji
    if (txt) {
      parts.push({ text: txt });
    }

    // Dodaj multimodalne privitke (slike ili PDF)
    if (Array.isArray(m?.attachments) && m.attachments.length > 0) {
      if (isRecentForAttachments) {
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
          } else if (att?.name) {
            parts.push({ text: tr('[Priložena datoteka: {name}]', '[Attached file: {name}]', { name: att.name }) });
          }
        }
      } else {
        const names = m.attachments.map(a => a?.name || tr('datoteka', 'file')).join(', ');
        parts.push({ text: tr('[Ranije priložene datoteke u ovoj poruci: {names}]', '[Previously attached files in this message: {names}]', { names }) });
      }
    }

    // Ako korisnik nije upisao tekst nego samo priložio sliku/PDF, postavi pametni upit
    if (parts.length > 0 && !txt && m?.role === 'user') {
      parts.unshift({
        text: isEn
          ? 'Please analyze this attached image/document in detail in the context of my athlete profile, current FTP, and cycling training. If the image shows a cycling workout profile or plan (Zwift, TrainerRoad, TrainingPeaks, Intervals.icu, Garmin screen, workout chart, or interval table), DECONSTRUCT and RECREATE it as an exact ErgVibe ```workout``` block for the smart trainer following the visual reverse-engineering protocol.'
          : 'Molim te detaljno analiziraj ovu priloženu sliku/dokument u kontekstu mog profila, trenutnog FTP-a i biciklističkog treninga. Ako slika prikazuje profil ili plan biciklističkog treninga (Zwift, TrainerRoad, TrainingPeaks, Intervals.icu, Garmin ekran, trenažni grafikon ili tablicu intervala), DEKONSTRUIRAJ ga i REKREIRAJ u točan ErgVibe ```workout``` blok za trenažer poštujući protokol vizualne dekonstrukcije.'
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
    throw new Error(tr(
      'Poruka za AI Trenera je prazna. Upiši pitanje ili priloži dokument i pokušaj ponovno.',
      'Message for AI Coach is empty. Type a question or attach a file and try again.'
    ));
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
  const isEn = getCurrentLanguage() === 'en';
  const resolvedNotes = String(userNotes || notes || '').trim();
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userQuery: [goal, resolvedNotes].filter(Boolean).join(' '),
    userId
  });

  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const planPrompt = isEn
    ? `### TRAINING PLAN GENERATOR TASK:
Generate a detailed, periodized training plan of ${weeks} weeks (${workoutsPerWeek} workouts/week, ~${hoursPerWeek} hours/week total) starting on ${startDate}.
Methodology: ${methodology}.
Athlete's main goal: "${goal}".
${resolvedNotes ? `Additional rider preferences: "${resolvedNotes}"` : ''}

IMPORTANT: Your response MUST be EXCLUSIVELY a valid JSON object (no intro/outro text, no markdown backticks \`\`\`json).
JSON schema:
{
  "planTitle": "Plan Title",
  "summary": "Expert overview of the mesocycle, goals, and intensity distribution",
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "Week focus",
      "targetHours": 6.5,
      "targetTss": 380,
      "workouts": [
        {
          "dayOffset": 0,
          "dayName": "Monday",
          "title": "Workout title",
          "category": "SweetSpot | Endurance | Threshold | VO2max | Recovery",
          "durationMinutes": 60,
          "estimatedTss": 65,
          "description": "Physiological goal and execution guidance",
          "intervalsCode": "- 10m 55% Warmup\\n3x\\n- 8m 90% Sweet Spot\\n- 4m 50% Recovery\\n- 10m 45% Cooldown",
          "steps": [
            { "name": "Warmup", "duration": 600, "power": 55 },
            { "name": "Interval 1", "duration": 480, "power": 90 },
            { "name": "Recovery", "duration": 240, "power": 50 }
          ]
        }
      ]
    }
  ]
}
Unit rules: 'durationMinutes' MUST be an integer in MINUTES (e.g., 60 or 90, NEVER seconds). Inside steps, 'duration' is in seconds and 'power' is in % FTP.`
    : `### ZADATAK GENERATORA TRENAŽNOG PLANA:
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

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${planPrompt}\n\n${buildLanguageInstruction(isEn)}`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: isEn ? `Generate a JSON training plan in English for goal: ${goal}` : `Generiraj JSON trenažni plan za cilj: ${goal}` }] }],
    model,
    temperature: 0.3,
    responseMimeType: 'application/json'
  });

  try {
    const cleanJson = rawJsonText.replace(/```json\s*|```/g, '').trim();
    const parsedPlan = JSON.parse(cleanJson);
    if (Array.isArray(parsedPlan?.weeks)) {
      parsedPlan.weeks = parsedPlan.weeks.map(wk => ({
        ...wk,
        workouts: Array.isArray(wk?.workouts)
          ? wk.workouts.filter(wo => !isRestDayWorkout(wo))
          : []
      }));
    }
    return parsedPlan;
  } catch (err) {
    console.error('[geminiService] JSON parse error:', err, rawJsonText);
    throw new Error(tr('AI nije vratio valjani JSON format plana. Pokušaj ponovno.', 'AI did not return a valid JSON training plan. Please try again.'));
  }
}

/**
 * Korak 1 dvofaznog planera: Generira cjelokupni makrociklus (faze i tjedne sažetke)
 * do datuma ciljnog eventa ili za zadani broj fitness tjedana.
 */
/**
 * Sigurno validira, popravlja i ograničava trajanje jednog generiranog treninga iz AI plana
 * kako greška u Intervals.icu sintaksi (npr. nezatvoren Nx blok) nikad ne bi napuhala trajanje.
 */
function sanitizePlannedWorkout(wo, dayMaxMinutes, ftp = 200) {
  const dayLimit = Math.max(30, Number(dayMaxMinutes) || 60);
  const maxAllowed = Math.max(dayLimit + 15, Math.round(dayLimit * 1.15));

  const isNonCycling = Boolean(
    isStrengthType(wo?.type) ||
    isStrengthType(wo?.category) ||
    (wo?.type && !isCyclingType(wo.type)) ||
    isNonCyclingEvent({ ...wo, name: wo?.title, description: wo?.intervalsCode || wo?.description })
  );

  if (isNonCycling) {
    const durMins = Math.max(15, Math.min(dayLimit, Math.round(Number(wo?.durationMinutes) || 45)));
    const estTss = Math.max(0, Math.round(Number(wo?.estimatedTss) || Math.round(durMins * 0.65)));
    const notes = String(wo?.descriptionText || wo?.coachNote || wo?.description || '').trim();
    return {
      durationMinutes: durMins,
      estimatedTss: estTss,
      intervalsCode: '',
      steps: [],
      type: wo?.type || 'strength',
      descriptionText: notes
    };
  }

  const tryParseCode = (codeStr) => {
    if (!codeStr || typeof codeStr !== 'string') return null;
    const expanded = normalizeIntervalsWorkoutText(codeStr);
    const parsed = parseIntervalsCode(expanded, ftp);
    if (!parsed || !parsed.duration || parsed.duration <= 0) return null;
    return {
      parsed,
      mins: Math.round(parsed.duration / 60),
      rawMatchesExpanded: Math.round((parseIntervalsCode(codeStr, ftp)?.duration || 0) / 60) === Math.round(parsed.duration / 60)
    };
  };

  let chosen = tryParseCode(wo?.intervalsCode);

  // Ako je intervalsCode neispravan ili znatno premašuje limit dana, provjeri niz `steps`
  if ((!chosen || chosen.mins > maxAllowed) && Array.isArray(wo?.steps) && wo.steps.length > 0) {
    const codeFromSteps = stepsToIntervalsCode(wo.steps);
    const fromSteps = tryParseCode(codeFromSteps);
    if (fromSteps && (!chosen || (fromSteps.mins <= maxAllowed && chosen.mins > maxAllowed))) {
      chosen = { ...fromSteps, cleanCode: codeFromSteps, rawMatchesExpanded: true };
    }
  }

  // Ako trajanje i dalje premašuje dozvoljeni limit dana, skrati višak koraka/ponavljanja čuvajući zagrijavanje i hlađenje
  if (chosen && chosen.mins > maxAllowed && chosen.parsed.allSteps.length > 0) {
    const targetSec = dayLimit * 60;
    const steps = [...chosen.parsed.allSteps];
    const warmup = steps.length >= 3 ? steps[0] : null;
    const lastStep = steps.length >= 3 ? steps[steps.length - 1] : null;
    const hasCooldown = Boolean(lastStep && (lastStep.power || 0) <= 62 && steps.length >= 3);
    const cooldown = hasCooldown ? { ...lastStep, duration: Math.min(lastStep.duration || 300, 600) } : null;

    const coreStart = warmup ? 1 : 0;
    const coreEnd = cooldown ? steps.length - 1 : steps.length;
    const middle = steps.slice(coreStart, coreEnd);

    const fixedSec = (warmup?.duration || 0) + (cooldown?.duration || 0);
    const availableMiddleSec = Math.max(600, targetSec - fixedSec);
    const keptMiddle = [];
    let middleAcc = 0;

    for (const st of middle) {
      if (middleAcc + (st.duration || 0) <= availableMiddleSec) {
        keptMiddle.push(st);
        middleAcc += (st.duration || 0);
      } else if (keptMiddle.length === 0 && (st.duration || 0) > availableMiddleSec) {
        keptMiddle.push({ ...st, duration: availableMiddleSec });
        middleAcc = availableMiddleSec;
        break;
      } else {
        break;
      }
    }

    const rebuiltSteps = [
      ...(warmup ? [warmup] : []),
      ...keptMiddle,
      ...(cooldown ? [cooldown] : [])
    ];
    const rebuiltCode = stepsToIntervalsCode(rebuiltSteps);
    const rebuiltParsed = tryParseCode(rebuiltCode);
    if (rebuiltParsed) {
      chosen = { ...rebuiltParsed, cleanCode: rebuiltCode, rawMatchesExpanded: true };
    }
  }

  // Krajnji sigurnosni fallback ako AI nije vratio valjane korake
  if (!chosen) {
    const isEn = getCurrentLanguage() === 'en';
    const fallbackMins = Math.max(30, Math.min(dayLimit, Number(wo?.durationMinutes) || dayLimit));
    const cat = String(wo?.category || 'Endurance').toLowerCase();
    let fallbackCode = '';
    if (cat.includes('vo2')) {
      const workReps = fallbackMins >= 60 ? 5 : 4;
      const warmupMin = 12;
      const cdMin = Math.max(6, fallbackMins - warmupMin - workReps * 6);
      fallbackCode = isEn
        ? `- ${warmupMin}m 55-70% Warmup\n\n${workReps}x\n- 3m 115% VO2 Max\n- 3m 50% Recovery\n\n- ${cdMin}m 50% Cooldown`
        : `- ${warmupMin}m 55-70% Zagrijavanje\n\n${workReps}x\n- 3m 115% VO2 Max\n- 3m 50% Oporavak\n\n- ${cdMin}m 50% Hlađenje`;
    } else if (cat.includes('threshold') || cat.includes('prag')) {
      const warmupMin = 12;
      const cdMin = Math.max(6, fallbackMins - warmupMin - 24);
      fallbackCode = isEn
        ? `- ${warmupMin}m 55-70% Warmup\n\n2x\n- 10m 98% Threshold (FTP)\n- 4m 50% Recovery\n\n- ${cdMin}m 50% Cooldown`
        : `- ${warmupMin}m 55-70% Zagrijavanje\n\n2x\n- 10m 98% Prag (FTP)\n- 4m 50% Oporavak\n\n- ${cdMin}m 50% Hlađenje`;
    } else {
      const mainMin = Math.max(20, fallbackMins - 15);
      fallbackCode = isEn
        ? `- 10m 55% Warmup\n- ${mainMin}m 65% Z2 Aerobic Base\n- 5m 50% Cooldown`
        : `- 10m 55% Zagrijavanje\n- ${mainMin}m 65% Z2 Aerobna baza\n- 5m 50% Hlađenje`;
    }
    chosen = { ...tryParseCode(fallbackCode), cleanCode: fallbackCode, rawMatchesExpanded: true };
  }

  const finalCode = (chosen.cleanCode || (chosen.rawMatchesExpanded ? String(wo.intervalsCode || '').trim() : stepsToIntervalsCode(chosen.parsed.allSteps)));

  return {
    durationMinutes: Math.max(20, chosen.mins),
    estimatedTss: Math.max(10, Math.round(chosen.parsed.tss || Number(wo?.estimatedTss) || 50)),
    intervalsCode: finalCode,
    steps: chosen.parsed.allSteps
  };
}

export async function generateMacrocycleBlueprint({
  goalMode = 'fitness',
  goalTitle = '',
  eventDate = null,
  eventType = '',
  eventPriority = 'RACE_A',
  eventDistanceKm = '',
  eventElevationM = '',
  totalWeeks = 8,
  startDate,
  weeklySchedule,
  methodology = 'auto',
  prioritizeCustomSources = false,
  experience = '',
  riderType = '',
  weakness = '',
  notes = '',
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const isEn = getCurrentLanguage() === 'en';
  const resolvedGoalTitle = String(goalTitle || '').trim() || tr('Podizanje FTP-a', 'Increase FTP');
  const safeWeeks = Math.max(1, Math.min(40, Number(totalWeeks) || 4));
  const baseMondayIso = getMondayOfWeekIso(startDate || new Date().toISOString().slice(0, 10));
  const scheduleSummary = summarizeWeeklySchedule(weeklySchedule);

  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userQuery: [resolvedGoalTitle, eventType, weakness, notes].filter(Boolean).join(' '),
    userId
  });
  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const eventLines = goalMode === 'event'
    ? (isEn
      ? [
          `- Plan Mode: TARGET EVENT / RACE PREPARATION`,
          `- Event Title: ${resolvedGoalTitle}`,
          `- Event Date: ${eventDate} (Priority: ${eventPriority})`,
          eventType ? `- Event Type: ${eventType}` : null,
          eventDistanceKm ? `- Distance: ${eventDistanceKm} km` : null,
          eventElevationM ? `- Elevation Gain: ${eventElevationM} m` : null
        ].filter(Boolean).join('\n')
      : [
          `- Način plana: PRIPREMA ZA EVENT / UTRKU`,
          `- Naziv eventa: ${resolvedGoalTitle}`,
          `- Datum eventa: ${eventDate} (Prioritet: ${eventPriority})`,
          eventType ? `- Tip eventa: ${eventType}` : null,
          eventDistanceKm ? `- Udaljenost: ${eventDistanceKm} km` : null,
          eventElevationM ? `- Visinska razlika: ${eventElevationM} m` : null
        ].filter(Boolean).join('\n'))
    : (isEn
      ? [
          `- Plan Mode: GENERAL FITNESS & PROGRESSION`,
          `- Primary Goal: ${resolvedGoalTitle}`
        ].join('\n')
      : [
          `- Način plana: OPĆI FITNESS I NAPREDAK`,
          `- Glavni cilj: ${resolvedGoalTitle}`
        ].join('\n'));

  const isVo2BlockIntent = String(methodology).toLowerCase().includes('vo2') || (goalMode === 'fitness' && String(resolvedGoalTitle).toLowerCase().includes('vo2'));
  const methodologyInstruction = isEn
    ? [
        methodology && methodology !== 'auto'
          ? `The athlete EXPLICITLY selected methodology: "${methodology}". Strictly follow this methodology.`
          : `Select and recommend the optimal coaching methodology (e.g., Polarized 80/20, Pyramidal / Sweet Spot, VO2 Max Focus, or Coggan Threshold) based on the goal, experience, and weekly hours.`,
        isVo2BlockIntent && safeWeeks <= 8
          ? `SINCE THE ATHLETE WANTS A VO2 MAX BLOCK (${safeWeeks} wks): DO NOT spend the first 3 weeks only on easy Base! Start targeted VO2max development right away (build/peak progression with 1–2 classic VO2max sessions/week + Z2 rides in between, plus a recovery week every 3rd or 4th week).`
          : null,
        prioritizeCustomSources
          ? `IMPORTANT SOURCE PRIORITY: The athlete requested basing this plan PRIMARILY on their custom literature in the "DODATNA KORISNIČKA LITERATURA I BILJEŠKE" section above (if present). Briefly explain in your rationale how those sources were applied.`
          : null
      ].filter(Boolean).join('\n')
    : [
        methodology && methodology !== 'auto'
          ? `Sportaš je IZRIČITO odabrao metodologiju: "${methodology}". Strogo se drži te metodologije.`
          : `Odaberi i preporuči optimalnu trenersku metodologiju (npr. Polarizirani 80/20, Piramidalni / Sweet Spot, VO2 Max Fokus ili Coggan Threshold) s obzirom na cilj, iskustvo i raspoložive sate sportaša.`,
        isVo2BlockIntent && safeWeeks <= 8
          ? `BUDUĆI DA SPORTAŠ ŽELI VO2 MAX BLOK (${safeWeeks} tj.): NEMOJ prve 3 tjedne trošiti samo na laganu Bazu! Odmah kreni u ciljani VO2max razvoj (build/peak progresija s 1-2 klasična VO2max treninga tjedno + Z2 vožnje između, uz tjedan rasterećenja svaki 3. ili 4. tjedan).`
          : null,
        prioritizeCustomSources
          ? `VAŽAN PRIORITET IZVORA: Sportaš je označio da ovaj plan PRIMARNO temeljiš na njegovim vlastitim dodanim izvorima iz sekcije "DODATNA KORISNIČKA LITERATURA I BILJEŠKE" (ako postoje u bazi znanja iznad). U obrazloženju kratko navedi kako si primijenio te izvore.`
          : null
      ].filter(Boolean).join('\n');

  const macroPrompt = isEn
    ? `### MACROCYCLE ARCHITECT TASK:
Build a complete long-term periodization plan (MACROCYCLE) lasting exactly ${safeWeeks} weeks starting on Monday ${baseMondayIso}.
In this step DO NOT generate detailed workout intervals — focus on phases, training load (TSS) progression, recovery weeks (every 3rd or 4th week if >= 4 weeks), and an appropriate taper if targeting an event.

ATHLETE QUESTIONNAIRE PARAMETERS:
${eventLines}
- Plan duration: ${safeWeeks} weeks
- Available days/week: ${scheduleSummary.workoutsPerWeek}x/week (~${scheduleSummary.hoursPerWeek} h/week)
${experience ? `- Experience: ${experience} yrs` : ''}
${riderType ? `- Rider profile: ${riderType}` : ''}
${weakness ? `- Focus / Weakness to improve: ${weakness}` : ''}
${notes ? `- Additional notes: ${notes}` : ''}

ATHLETE WEEKLY SCHEDULE:
${scheduleSummary.promptText}

${methodologyInstruction}

IMPORTANT: Return EXCLUSIVELY a valid JSON object with no markdown backticks:
{
  "planTitle": "Short motivating cycle title",
  "recommendedMethodology": "Selected methodology",
  "methodologyReason": "Concise explanation (1-2 sentences) of why this methodology fits the rider and goal",
  "summary": "Summary of the full macrocycle and expected adaptations",
  "physiologicalRationale": "Physiological rationale for periodization given current CTL/TSB and goal",
  "phases": [
    {
      "name": "Base 1 — Aerobic Foundation",
      "phaseType": "base | build | peak | taper | race",
      "weekFrom": 1,
      "weekTo": 4,
      "focus": "Short description of phase focus",
      "weeklyHours": 6.0
    }
  ],
  "weeks": [
    {
      "weekNumber": 1,
      "phaseType": "base | build | peak | taper | race",
      "phaseLabel": "Base 1",
      "focus": "Specific weekly focus",
      "targetHours": 6.0,
      "targetTss": 320,
      "keySessions": ["Sweet Spot 3x10m", "Long Z2 Ride"],
      "isRecoveryWeek": false
    }
  ]
}
The "weeks" array MUST contain exactly ${safeWeeks} elements (weekNumber from 1 to ${safeWeeks}).`
    : `### ZADATAK ARHITEKTA MAKROCIKLUSA:
Izradi cjelokupni dugoročni plan periodizacije (MAKROCIKLUS) u trajanju od točno ${safeWeeks} tjedana počevši od tjedna koji započinje u ponedjeljak ${baseMondayIso}.
U ovoj fazi NE generiraj detaljne intervale pojedinačnih treninga — fokus je na fazama, progresiji opterećenja (TSS), tjednom oporavku (svaki 3. ili 4. tjedan rasterećenja ako ima >= 4 tjedna) i pravilnom taperu ako postoji event.

PARAMETRI UPITNIKA SPORTAŠA:
${eventLines}
- Trajanje plana: ${safeWeeks} tjedana
- Dostupno dana tjedno: ${scheduleSummary.workoutsPerWeek}x tjedno (~${scheduleSummary.hoursPerWeek} h/tjedno)
${experience ? `- Iskustvo: ${experience} god.` : ''}
${riderType ? `- Profil vozača: ${riderType}` : ''}
${weakness ? `- Fokus / Slabost za poboljšati: ${weakness}` : ''}
${notes ? `- Dodatne napomene: ${notes}` : ''}

RASPORED DANA SPORTAŠA:
${scheduleSummary.promptText}

${methodologyInstruction}

VAŽNO: Vrati ISKLJUČIVO valjani JSON objekt bez markdown backtick oznaka:
{
  "planTitle": "Kratki motivirajući naziv ciklusa",
  "recommendedMethodology": "Odabrana metodologija",
  "methodologyReason": "Kratko objašnjenje (1-2 rečenice) zašto ova metodologija odgovara sportašu i cilju",
  "summary": "Sažetak cijelog plana i očekivanog napretka",
  "physiologicalRationale": "Fiziološko obrazloženje periodizacije u kontekstu trenutnog CTL/TSB i cilja",
  "phases": [
    {
      "name": "Baza 1 — Aerobna izgradnja",
      "phaseType": "base | build | peak | taper | race",
      "weekFrom": 1,
      "weekTo": 4,
      "focus": "Kratki opis fokusa faze",
      "weeklyHours": 6.0
    }
  ],
  "weeks": [
    {
      "weekNumber": 1,
      "phaseType": "base | build | peak | taper | race",
      "phaseLabel": "Baza 1",
      "focus": "Konkretan fokus ovog tjedna",
      "targetHours": 6.0,
      "targetTss": 320,
      "keySessions": ["Sweet Spot 3x10m", "Duga Z2 vožnja"],
      "isRecoveryWeek": false
    }
  ]
}
Niz "weeks" MORA sadržavati točno ${safeWeeks} elemenata (weekNumber od 1 do ${safeWeeks}).`;

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${macroPrompt}\n\n${buildLanguageInstruction(isEn)}`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: isEn ? `Create a macrocycle (${safeWeeks} weeks) in English for goal: ${resolvedGoalTitle}` : `Kreiraj makrociklus (${safeWeeks} tjedana) za cilj: ${resolvedGoalTitle}` }] }],
    model,
    temperature: 0.25,
    responseMimeType: 'application/json'
  });

  let parsed;
  try {
    const cleanJson = rawJsonText.replace(/```json\s*|```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('[geminiService] Macrocycle JSON parse error:', err, rawJsonText);
    throw new Error(tr('AI nije vratio valjani JSON makrociklusa. Pokušaj ponovno.', 'AI did not return a valid macrocycle JSON. Please try again.'));
  }

  const rawWeeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];
  const normalizedWeeks = [];
  for (let w = 1; w <= safeWeeks; w++) {
    const found = rawWeeks.find(item => Number(item?.weekNumber) === w) || rawWeeks[w - 1] || {};
    const wkStart = addDaysIso(baseMondayIso, (w - 1) * 7);
    const wkEnd = addDaysIso(wkStart, 6);
    normalizedWeeks.push({
      weekNumber: w,
      startDate: wkStart,
      endDate: wkEnd,
      phaseType: found.phaseType || (w === safeWeeks && goalMode === 'event' ? 'race' : 'base'),
      phaseLabel: found.phaseLabel || tr('Tjedan {w}', 'Week {w}', { w }),
      focus: found.focus || tr('Kontinuirani razvoj kondicije', 'Progressive fitness development'),
      targetHours: Number(found.targetHours) > 0 ? Number(found.targetHours) : scheduleSummary.hoursPerWeek,
      targetTss: Number(found.targetTss) > 0 ? Math.round(Number(found.targetTss)) : Math.round(scheduleSummary.hoursPerWeek * 55),
      keySessions: Array.isArray(found.keySessions) ? found.keySessions.slice(0, 4) : [],
      isRecoveryWeek: Boolean(found.isRecoveryWeek)
    });
  }

  return {
    planId: `plan_${Date.now()}`,
    goalMode,
    goalTitle: resolvedGoalTitle,
    eventDate: goalMode === 'event' ? eventDate : null,
    eventType: goalMode === 'event' ? eventType : '',
    eventPriority: goalMode === 'event' ? eventPriority : null,
    startDate: startDate || baseMondayIso,
    baseMondayIso,
    totalWeeks: safeWeeks,
    planTitle: parsed?.planTitle || tr('{goal} ({weeks} tj.)', '{goal} ({weeks} wks)', { goal: resolvedGoalTitle, weeks: safeWeeks }),
    recommendedMethodology: parsed?.recommendedMethodology || (methodology !== 'auto' ? methodology : tr('Piramidalni / Polarizirani', 'Pyramidal / Polarized')),
    methodologyReason: parsed?.methodologyReason || '',
    summary: parsed?.summary || '',
    physiologicalRationale: parsed?.physiologicalRationale || '',
    phases: Array.isArray(parsed?.phases) ? parsed.phases : [],
    weeks: normalizedWeeks,
    generatedAt: new Date().toISOString()
  };
}

function getPlannerWorkoutProtocolsGuide(isEn) {
  if (isEn) {
    return `### CANONICAL CYCLING WORKOUT PROTOCOLS (USE REALISTIC, EXECUTABLE STRUCTURES):
- **VO2 Max (classic intervals, Z5 108–122% FTP):**
  * 5x3m @ 112–118% FTP (3m rest @ 50% FTP) -> ideal for a 55–65 min day
  * 4x4m @ 110–115% FTP (4m rest @ 50% FTP) -> ideal for a 60–65 min day
  * 5x4m @ 108–114% FTP (3m30s rest @ 50% FTP) -> for a 70–80 min day
  * Rønnestad micro-intervals: 2 sets x 8–10x (30s @ 120% / 15s @ 50%) with 5m @ 55% rest between sets
  * 4x5m @ 106–112% FTP -> for an 80–90 min day
- **Sweet Spot (88–94% FTP):** 3x10m, 3x12m, 2x20m (4–5m rest @ 50–55%).
- **Threshold (95–103% FTP):** 3x10m, 4x8m, 2x20m (4–5m rest @ 50%).
- **Over-Under (ONLY in Threshold/Build phases when appropriate — NEVER in a pure VO2max block!):**
  * Realistic smart trainer structure: 3 sets of 6–9 min (e.g., repeating 2m @ 93–95% + 1m @ 103–105% FTP with 4–5m @ 50% rest between sets).
  * NEVER invent impossible Over-Unders above 108% or continuous blocks >12 min without rest.
- **Endurance / Z2 (58–72% FTP):** steady aerobic block after warmup and before cooldown, WITHOUT pointless Z4/Z5 spikes during an easy ride.
- **Recovery:** 30–50m continuous at 45–55% FTP.

### STRICT RULES FOR \`intervalsCode\` (INTERVALS.ICU SYNTAX):
1. Every \`Nx\` repeat block MUST have a **BLANK LINE (\\n\\n) BEFORE AND AFTER IT**, otherwise the parser will multiply the Cooldown by N!
2. NEVER nest \`Nx\` inside \`Mx\`. If a workout has 2 sets of micro-intervals, write Set 1 (\`8x\`), blank line, \`- 5m 55% Set Recovery\`, blank line, Set 2 (\`8x\`), blank line, \`- 10m 50% Cooldown\`.
3. Example of a VALID VO2max workout (~55 min):
"- 12m 55-70% Warmup\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Recovery\\n\\n- 13m 50% Cooldown"
4. Leave the \`steps\` array empty \`[]\` or consistent with \`intervalsCode\` — the primary source of truth for the parser is valid \`intervalsCode\` with blank lines around \`Nx\`!`;
  }

  return `### KANONSKI BICIKLISTIČKI TRENING PROTOKOLI (KORISTI REALNE, IZVEDIVE STRUKTURE):
- **VO2 Max (klasični intervali, Z5 108–122% FTP):**
  * 5x3m @ 112–118% FTP (odmor 3m @ 50% FTP) -> idealno za 55-65 min dan
  * 4x4m @ 110–115% FTP (odmor 4m @ 50% FTP) -> idealno za 60-65 min dan
  * 5x4m @ 108–114% FTP (odmor 3m30s @ 50% FTP) -> za 70-80 min dan
  * Rønnestad mikro-intervali: 2 seta x 8-10x (30s @ 120% / 15s @ 50%) s 5m @ 55% odmora između setova
  * 4x5m @ 106–112% FTP -> za 80-90 min dan
- **Sweet Spot (88–94% FTP):** 3x10m, 3x12m, 2x20m (odmor 4-5m @ 50-55%).
- **Threshold / Prag (95–103% FTP):** 3x10m, 4x8m, 2x20m (odmor 4-5m @ 50%).
- **Over-Under (SAMO u Threshold/Build fazi kad ima smisla — NIKAD u čistom VO2max bloku!):**
  * Realne i izvedive brojke za pametni trenažer: 3 seta po 6–9 min (npr. ponovljenih 2m @ 93-95% + 1m @ 103-105% FTP uz 4-5m @ 50% odmora između setova).
  * ZABRANJENO izmišljati neizvedive Over-Undere iznad 108% ili duge neprekidne blokove od >12 min bez pauze.
- **Endurance / Z2 (58–72% FTP):** stabilan aerobni blok nakon zagrijavanja i prije hlađenja, BEZ besmislenih skokova u Z4/Z5 usred laganog treninga.
- **Recovery / Oporavak:** 30–50m kontinuirano u 45–55% FTP.

### STROGA PRAVILA ZA \`intervalsCode\` (INTERVALS.ICU SINTAKSA):
1. Svaki \`Nx\` blok ponavljanja MORA imati **PRAZAN RED (\\n\\n) PRIJE I POSLIJE SEBE**, inače će parser pomnožiti i Hlađenje puta N!
2. NIKADA ne stavljaj ugniježđeni \`Nx\` unutar \`Mx\`. Ako trening ima 2 seta mikro-intervala, napiši Set 1 (\`8x\`), prazan red, \`- 5m 55% Odmor između setova\`, prazan red, Set 2 (\`8x\`), prazan red, \`- 10m 50% Hlađenje\`.
3. Primjer ISPRAVNOG VO2max treninga (~55 min):
"- 12m 55-70% Zagrijavanje\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Oporavak\\n\\n- 13m 50% Hlađenje"
4. \`steps\` niz ostavi prazan \`[]\` ili usklađen s \`intervalsCode\` — primarni izvor istine za parser je valjani \`intervalsCode\` s praznim redovima oko \`Nx\`!`;
}

/**
 * Korak 2 dvofaznog planera: Generira detaljne strukturirane treninge za jedan blok (2–4 tjedna)
 * strogo poštujući korisnikove odabrane dane u tjednu i maksimalno trajanje po danu.
 */
export async function generatePlanBlockWorkouts({
  blueprint,
  weekFrom = 1,
  weekTo = 4,
  weeklySchedule,
  minWorkoutDate = null,
  prioritizeCustomSources = false,
  notes = '',
  blockFeedback = '',
  previousBlockData = null,
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const isEn = getCurrentLanguage() === 'en';
  if (!blueprint || !Array.isArray(blueprint.weeks)) {
    throw new Error(tr('Nedostaje makrociklus za generiranje bloka treninga.', 'Macrocycle blueprint is missing for generating a workout block.'));
  }

  const targetWeeks = blueprint.weeks.filter(
    w => w.weekNumber >= weekFrom && w.weekNumber <= weekTo
  );
  if (targetWeeks.length === 0) {
    throw new Error(tr('Odabrani blok nema definiranih tjedana u makrociklusu.', 'Selected block has no weeks defined in the macrocycle.'));
  }

  const scheduleSummary = summarizeWeeklySchedule(weeklySchedule);
  if (scheduleSummary.activeDays.length === 0) {
    throw new Error(tr('Moraš odabrati barem jedan trening dan u tjednu.', 'You must select at least one training day per week.'));
  }

  const ftp = Number(athleteProfile?.ftp) || 200;
  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    userQuery: [blueprint?.goalTitle, notes, blockFeedback].filter(Boolean).join(' '),
    userId
  });
  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const weeksBrief = targetWeeks.map(w =>
    isEn
      ? `- Week ${w.weekNumber} (${w.startDate} to ${w.endDate}) | Phase: ${w.phaseLabel} (${w.phaseType}) | Focus: ${w.focus} | Target: ~${w.targetHours}h, ~${w.targetTss} TSS${w.isRecoveryWeek ? ' [RECOVERY WEEK]' : ''}${w.keySessions?.length ? ` | Key sessions: ${w.keySessions.join(', ')}` : ''}`
      : `- Tjedan ${w.weekNumber} (${w.startDate} do ${w.endDate}) | Faza: ${w.phaseLabel} (${w.phaseType}) | Fokus: ${w.focus} | Cilj: ~${w.targetHours}h, ~${w.targetTss} TSS${w.isRecoveryWeek ? ' [TJEDAN OPORAVKA]' : ''}${w.keySessions?.length ? ` | Ključni treninzi: ${w.keySessions.join(', ')}` : ''}`
  ).join('\n');

  const eventConstraint = blueprint.goalMode === 'event' && blueprint.eventDate
    ? (isEn
      ? `IMPORTANT FOR TARGET EVENT: Target event "${blueprint.goalTitle}" is on ${blueprint.eventDate}. If this date falls in this block, DO NOT generate a workout on ${blueprint.eventDate} (that is race day!), and optionally schedule a short "Openers" ride (30–40 min with 2–3 short activation efforts) the day before. Also do not generate workouts after ${blueprint.eventDate}.`
      : `VAŽNO ZA EVENT: Ciljni event "${blueprint.goalTitle}" je dana ${blueprint.eventDate}. Ako taj datum pada u ovaj blok, na sam dan ${blueprint.eventDate} NE generiraj trening (tamo stoji utrka!), a dan prije eventualno kratki "Openers" trening (30-40 min s 2-3 kratka aktivacijska skoka). Također ne generiraj treninge nakon ${blueprint.eventDate}.`)
    : '';

  const minDateConstraint = minWorkoutDate
    ? (isEn
      ? `The athlete starts on ${minWorkoutDate} — for Week 1 only generate active days on or after ${minWorkoutDate}.`
      : `Početni datum od kojeg sportaš kreće je ${minWorkoutDate} — za Tjedan 1 generiraj samo aktivne dane na ili nakon ${minWorkoutDate}.`)
    : '';

  const allowedDayKeys = scheduleSummary.activeDays.map(d => d.key);

  const feedbackSection = blockFeedback && String(blockFeedback).trim()
    ? (isEn
      ? [
          '\n### ATHLETE FEEDBACK FOR THIS BLOCK (MUST APPLY):',
          `The athlete reviewed the current proposal and requested: "${String(blockFeedback).trim()}"`,
          previousBlockData?.weeks?.length
            ? `Current workouts shown to the athlete in this block:\n${previousBlockData.weeks.map(w =>
                `Week ${w.weekNumber}: ${(w.workouts || []).map(x => `${x.dayName}(${x.dayKey}): "${x.title}" [${x.category}, ${x.durationMinutes}m]`).join('; ')}`
              ).join('\n')}`
            : null,
          'Apply the athlete’s feedback directly to the block workouts (e.g., replace specific rides, adjust intensity or duration), keeping other days logically structured.'
        ].filter(Boolean).join('\n')
      : [
          '\n### KOREKCIJA SPORTAŠA ZA OVAJ BLOK (OBAVEZNO UVAŽI):',
          `Sportaš je pregledao trenutni prijedlog i poslao komentar: "${String(blockFeedback).trim()}"`,
          previousBlockData?.weeks?.length
            ? `Trenutni treninzi u bloku koji su prikazani sportašu:\n${previousBlockData.weeks.map(w =>
                `Tjedan ${w.weekNumber}: ${(w.workouts || []).map(x => `${x.dayName}(${x.dayKey}): "${x.title}" [${x.category}, ${x.durationMinutes}m]`).join('; ')}`
              ).join('\n')}`
            : null,
          'Primijeni sportašev komentar izravno na treninge u bloku (npr. zamijeni sporne treninge, prilagodi intenzitet ili trajanje), a ostale dane zadrži smisleno posložene.'
        ].filter(Boolean).join('\n'))
    : '';

  const blockPrompt = isEn
    ? `### WORKOUT BLOCK GENERATOR TASK:
Generate detailed, structured cycling workouts for BLOCK (Weeks ${weekFrom}–${weekTo}) from the macrocycle "${blueprint.planTitle}".
Methodology: ${blueprint.recommendedMethodology || 'Pyramidal / Polarized'}.
${prioritizeCustomSources ? 'SOURCE PRIORITY: Primarily apply protocols and principles from the athlete’s custom literature section ("DODATNA KORISNIČKA LITERATURA I BILJEŠKE") above.' : ''}
${notes ? `Additional athlete notes: "${notes}"` : ''}
${feedbackSection}

WEEKS IN THIS BLOCK:
${weeksBrief}

STRICT WEEKLY SCHEDULE & MAX DURATION PER DAY (OBEY EXACTLY):
${scheduleSummary.promptText}
Allowed day keys ("dayKey") are EXCLUSIVELY: ${allowedDayKeys.join(', ')}.
NEVER include a "Rest Day" or "Full Rest" entry in the "workouts" array! Rest days must be omitted from "workouts" (even if a day is marked available, omit it if you prescribe complete rest).
The total duration of EVERY workout (warmup + ALL interval repeats + cooldown) MUST NOT exceed that day's maximum duration!
${eventConstraint}
${minDateConstraint}

${getPlannerWorkoutProtocolsGuide(true)}

IMPORTANT: Your response MUST be EXCLUSIVELY a valid JSON object without markdown backticks:
{
  "blockSummary": "Short summary of this block (2 sentences)",
  "weeks": [
    {
      "weekNumber": ${weekFrom},
      "theme": "Week focus",
      "targetTss": 320,
      "workouts": [
        {
          "dayKey": "tue",
          "dayName": "Tuesday",
          "title": "VO2 Max 5x3m",
          "category": "VO2max | SweetSpot | Endurance | Tempo | Threshold | Recovery | Anaerobic",
          "durationMinutes": 55,
          "estimatedTss": 64,
          "coachNote": "Physiological target and execution tip",
          "intervalsCode": "- 12m 55-70% Warmup\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Recovery\\n\\n- 13m 50% Cooldown"
        }
      ]
    }
  ]
}
Unit rules: 'durationMinutes' is an integer in MINUTES (e.g., 55, NEVER seconds), and the sum of all steps in 'intervalsCode' MUST match 'durationMinutes' and be <= max minutes for that day.`
    : `### ZADATAK GENERATORA BLOKA TRENINGA:
Generiraj detaljne, strukturirane biciklističke treninge za BLOK (Tjedni ${weekFrom}–${weekTo}) iz postojećeg makrociklusa "${blueprint.planTitle}".
Metodologija: ${blueprint.recommendedMethodology || 'Piramidalni / Polarizirani'}.
${prioritizeCustomSources ? 'PRIORITET IZVORA: Koristi primarno protokole i principe iz sportaševe DODATNE KORISNIČKE LITERATURE I BILJEŠKI iz baze znanja iznad.' : ''}
${notes ? `Dodatne napomene sportaša: "${notes}"` : ''}
${feedbackSection}

TJEDNI U OVOM BLOKU:
${weeksBrief}

STROGI RASPORED DANA I MAKSIMALOG TRAJANJA (POŠTUJ TOČNO):
${scheduleSummary.promptText}
Dozvoljeni ključevi dana ("dayKey") su ISKLJUČIVO: ${allowedDayKeys.join(', ')}.
NIKADA ne generiraj stavku za "Potpuni odmor", "Dan odmora" ili "Rest day" u nizu "workouts"! Dani odmora ne smiju biti u nizu "workouts" (čak i ako je dan označen kao dostupan, ako za taj dan predviđaš potpuni odmor bez vožnje, izostavi ga iz "workouts").
Ukupno trajanje SVAKOG treninga (zagrijavanje + SVA ponavljanja intervala + hlađenje) NE SMIJE premašiti max trajanje tog dana!
${eventConstraint}
${minDateConstraint}

${getPlannerWorkoutProtocolsGuide(false)}

VAŽNO: Odgovor MORA biti ISKLJUČIVO valjani JSON objekt bez markdown backtick oznaka:
{
  "blockSummary": "Kratki opis ovog bloka (2 rečenice)",
  "weeks": [
    {
      "weekNumber": ${weekFrom},
      "theme": "Fokus tjedna",
      "targetTss": 320,
      "workouts": [
        {
          "dayKey": "tue",
          "dayName": "Utorak",
          "title": "VO2 Max 5x3m",
          "category": "VO2max | SweetSpot | Endurance | Tempo | Threshold | Recovery | Anaerobic",
          "durationMinutes": 55,
          "estimatedTss": 64,
          "coachNote": "Fiziološki cilj i savjet za izvedbu",
          "intervalsCode": "- 12m 55-70% Zagrijavanje\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Oporavak\\n\\n- 13m 50% Hlađenje"
        }
      ]
    }
  ]
}
Pravila za jedinice: 'durationMinutes' je cijeli broj MINUTA (npr. 55, NIKAKO u sekundama), i zbroj svih koraka u 'intervalsCode' MORA odgovarati 'durationMinutes' te biti <= max minuta za taj dan.`;

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${blockPrompt}\n\n${buildLanguageInstruction(isEn)}`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{
      role: 'user',
      parts: [{
        text: isEn
          ? `Generate detailed workouts in English for Weeks ${weekFrom}–${weekTo} of plan "${blueprint.planTitle}".`
          : `Generiraj detaljne treninge za Tjedne ${weekFrom}–${weekTo} plana "${blueprint.planTitle}".`
      }]
    }],
    model,
    temperature: 0.25,
    responseMimeType: 'application/json'
  });

  let parsed;
  try {
    const cleanJson = rawJsonText.replace(/```json\s*|```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('[geminiService] Block workouts JSON parse error:', err, rawJsonText);
    throw new Error(tr('AI nije vratio valjani JSON format za blok treninga. Pokušaj ponovno.', 'AI did not return a valid JSON format for the workout block. Please try again.'));
  }

  const dayMap = Object.fromEntries(WEEKDAY_DEFS.map(d => [d.key, d]));
  const rawWeeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];

  const normalizedWeeks = targetWeeks.map((metaWk, idx) => {
    const aiWk = rawWeeks.find(w => Number(w?.weekNumber) === metaWk.weekNumber) || rawWeeks[idx] || {};
    const aiWorkouts = Array.isArray(aiWk.workouts) ? aiWk.workouts : [];

    const normalizedWorkouts = [];
    const usedDates = new Set();

    aiWorkouts.forEach((wo) => {
      let dayKey = String(wo?.dayKey || '').toLowerCase().trim();
      if (!dayMap[dayKey] && wo?.dayName) {
        const lowerName = String(wo.dayName).toLowerCase();
        const matched = WEEKDAY_DEFS.find(
          d =>
            lowerName.startsWith(d.key) ||
            lowerName.startsWith(d.short.toLowerCase()) ||
            lowerName.includes(d.name.toLowerCase().slice(0, 3))
        );
        if (matched) dayKey = matched.key;
      }

      const dayDef = dayMap[dayKey];
      if (!dayDef) return;
      if (!weeklySchedule?.[dayKey]?.enabled) return;
      if (isRestDayWorkout(wo) || (wo?.durationMinutes != null && Number(wo.durationMinutes) <= 0 && !String(wo?.intervalsCode || '').trim())) return;

      const exactDate = addDaysIso(metaWk.startDate, dayDef.index);
      if (minWorkoutDate && exactDate < minWorkoutDate) return;
      if (blueprint.goalMode === 'event' && blueprint.eventDate && exactDate >= blueprint.eventDate) return;
      if (usedDates.has(exactDate)) return;
      usedDates.add(exactDate);

      const sanitized = sanitizePlannedWorkout(wo, weeklySchedule[dayKey].minutes, ftp);

      normalizedWorkouts.push({
        dayKey,
        dayName: isEn ? (EN_WEEKDAY_NAMES[dayKey] || dayDef.name) : dayDef.name,
        date: exactDate,
        title: wo.title || tr('AI Trening', 'AI Workout'),
        category: sanitized.type && !isCyclingType(sanitized.type) ? 'OTHER' : (wo.category || 'Endurance'),
        type: sanitized.type || 'ride',
        durationMinutes: sanitized.durationMinutes,
        estimatedTss: sanitized.estimatedTss,
        descriptionText: sanitized.descriptionText || '',
        coachNote: wo.coachNote || wo.description || '',
        intervalsCode: sanitized.intervalsCode,
        steps: sanitized.steps
      });
    });

    normalizedWorkouts.sort((a, b) => a.date.localeCompare(b.date));

    return {
      weekNumber: metaWk.weekNumber,
      startDate: metaWk.startDate,
      endDate: metaWk.endDate,
      phaseType: metaWk.phaseType,
      phaseLabel: metaWk.phaseLabel,
      theme: aiWk.theme || metaWk.focus,
      targetTss: Number(aiWk.targetTss) || metaWk.targetTss,
      isRecoveryWeek: metaWk.isRecoveryWeek,
      workouts: normalizedWorkouts
    };
  });

  return {
    blockKey: `${weekFrom}-${weekTo}`,
    weekFrom,
    weekTo,
    blockSummary: parsed?.blockSummary || '',
    weeks: normalizedWeeks,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Brza revizija pojedinačnog treninga u bloku na temelju komentara sportaša
 * (npr. zamjena neizvedivog over-undera s klasičnim VO2max ili lakšim Z2 treningom).
 */
export async function reviseSinglePlanWorkout({
  blueprint,
  weekMeta,
  workout,
  feedback,
  dayMaxMinutes = 60,
  athleteProfile,
  wellnessData = {},
  model = 'gemini-3.8-flash',
  userId = null
}) {
  const isEn = getCurrentLanguage() === 'en';
  const cleanFeedback = String(feedback || '').trim();
  if (!cleanFeedback) {
    throw new Error(tr('Upiši komentar ili uputu za izmjenu treninga.', 'Enter feedback or instructions to revise the workout.'));
  }

  const ftp = Number(athleteProfile?.ftp) || 200;
  const dayLimit = Math.max(30, Number(dayMaxMinutes) || Number(workout?.durationMinutes) || 60);

  const athleteContextPrompt = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts: [],
    wellnessData,
    userQuery: [workout?.title, cleanFeedback].filter(Boolean).join(' '),
    userId
  });
  const knowledgeBasePrompt = compileKnowledgeBasePrompt({ userId });

  const revisePrompt = isEn
    ? `### TASK: REVISE A SINGLE WORKOUT PER ATHLETE FEEDBACK
The athlete has feedback or a specific change request for a workout within plan "${blueprint?.planTitle || 'Training Plan'}" (${blueprint?.recommendedMethodology || 'Pyramidal / Polarized'}).
- Week ${weekMeta?.weekNumber || 1} (${weekMeta?.phaseLabel || ''}) | Week focus: ${weekMeta?.focus || weekMeta?.theme || '-'}
- Day: ${workout?.dayName || ''} (${workout?.date || ''}) | MAX ALLOWED DURATION FOR THIS DAY: ${dayLimit} min

CURRENT WORKOUT TO REVISE:
- Title: ${workout?.title || ''}
- Category: ${workout?.category || ''}
- Duration: ${workout?.durationMinutes || dayLimit} min | TSS: ${workout?.estimatedTss || '-'}
- Current intervalsCode:
${workout?.intervalsCode || ''}

ATHLETE FEEDBACK / REQUEST:
"${cleanFeedback}"

Revise and replace THIS workout so it fully honors the athlete's feedback, is realistic and physiologically executable on a smart trainer, and stays within max ${dayLimit} minutes.
If the athlete explicitly requests strength / gym training (off the bike), set "type": "strength", "category": "OTHER", "intervalsCode": "", and write the exercise plan in "descriptionText".

${getPlannerWorkoutProtocolsGuide(true)}

IMPORTANT: Return EXCLUSIVELY a single valid JSON object without markdown backticks:
{
  "title": "New clear workout title",
  "type": "ride | strength",
  "category": "VO2max | SweetSpot | Endurance | Tempo | Threshold | Recovery | Anaerobic | OTHER",
  "durationMinutes": ${dayLimit},
  "estimatedTss": 65,
  "descriptionText": "Optional exercise notes for strength training (empty for cycling)",
  "coachNote": "Short explanation of what was changed and why",
  "intervalsCode": "- 12m 55-70% Warmup\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Recovery\\n\\n- 13m 50% Cooldown"
}`
    : `### ZADATAK: IZMJENA JEDNOG TRENINGA PO KOMENTARU SPORTAŠA
Sportaš ima prigovor ili poseban zahtjev za trening u okviru plana "${blueprint?.planTitle || 'Trening Plan'}" (${blueprint?.recommendedMethodology || 'Piramidalni / Polarizirani'}).
- Tjedan ${weekMeta?.weekNumber || 1} (${weekMeta?.phaseLabel || ''}) | Fokus tjedna: ${weekMeta?.focus || weekMeta?.theme || '-'}
- Dan: ${workout?.dayName || ''} (${workout?.date || ''}) | MAX DOZVOLJENO TRAJANJE DANA: ${dayLimit} min

TRENUTNI TRENING KOJI SPORTAŠ ŽELI POPRAVITI:
- Naziv: ${workout?.title || ''}
- Kategorija: ${workout?.category || ''}
- Trajanje: ${workout?.durationMinutes || dayLimit} min | TSS: ${workout?.estimatedTss || '-'}
- Trenutni intervalsCode:
${workout?.intervalsCode || ''}

KOMENTAR / ZAHTJEV SPORTAŠA:
"${cleanFeedback}"

Popravi i zamijeni OVAJ trening tako da u potpunosti poštuje komentar sportaša, bude realan i fiziološki izvediv na trenažeru te unutar max ${dayLimit} minuta.
Ako sportaš izričito traži trening snage / teretanu (izvan trenažera), postavi "type": "strength", "category": "OTHER", "intervalsCode": "" i upiši raspored vježbi u "descriptionText".

${getPlannerWorkoutProtocolsGuide(false)}

VAŽNO: Vrati ISKLJUČIVO jedan valjani JSON objekt bez markdown backtick oznaka:
{
  "title": "Novi jasan naziv treninga",
  "type": "ride | strength",
  "category": "VO2max | SweetSpot | Endurance | Tempo | Threshold | Recovery | Anaerobic | OTHER",
  "durationMinutes": ${dayLimit},
  "estimatedTss": 65,
  "descriptionText": "Opcionalni podsjetnik vježbi za trening snage (prazno za bicikl)",
  "coachNote": "Kratko objašnjenje što je izmijenjeno i zašto",
  "intervalsCode": "- 12m 55-70% Zagrijavanje\\n\\n5x\\n- 3m 115% VO2 Max\\n- 3m 50% Oporavak\\n\\n- 13m 50% Hlađenje"
}`;

  const systemInstruction = `${athleteContextPrompt}\n\n${knowledgeBasePrompt}\n\n${revisePrompt}\n\n${buildLanguageInstruction(isEn)}`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{
      role: 'user',
      parts: [{
        text: isEn
          ? `Revise workout "${workout?.title}" in English per feedback: "${cleanFeedback}"`
          : `Izmijeni trening "${workout?.title}" prema komentaru: "${cleanFeedback}"`
      }]
    }],
    model,
    temperature: 0.25,
    responseMimeType: 'application/json'
  });

  let parsed;
  try {
    const cleanJson = rawJsonText.replace(/```json\s*|```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('[geminiService] Single workout revision JSON parse error:', err, rawJsonText);
    throw new Error(tr('AI nije vratio valjani JSON za izmijenjeni trening. Pokušaj ponovno.', 'AI did not return a valid JSON for the revised workout. Please try again.'));
  }

  const sanitized = sanitizePlannedWorkout(parsed, dayLimit, ftp);

  return {
    ...workout,
    title: parsed?.title || workout?.title || tr('Prilagođeni trening', 'Custom Workout'),
    type: sanitized.type || 'ride',
    category: sanitized.type && !isCyclingType(sanitized.type) ? 'OTHER' : (parsed?.category || workout?.category || 'Endurance'),
    durationMinutes: sanitized.durationMinutes,
    estimatedTss: sanitized.estimatedTss,
    descriptionText: sanitized.descriptionText || '',
    coachNote: parsed?.coachNote || workout?.coachNote || '',
    intervalsCode: sanitized.intervalsCode,
    steps: sanitized.steps
  };
}

/**
 * Analizira javni YouTube video i pretvara ga u strukturirani trenerski sažetak za bazu znanja.
 * Koristi Google Gemini multimodalno razumijevanje videa.
 */
export async function analyzeYouTubeVideoForKnowledgeBase(youtubeUrl) {
  const isEn = getCurrentLanguage() === 'en';
  const cleanUrl = String(youtubeUrl || '').trim();
  const match = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([\w-]{11})/);
  if (!match) {
    throw new Error(tr(
      'Nevažeća YouTube poveznica. Unesi ispravan URL (npr. https://www.youtube.com/watch?v=...)',
      'Invalid YouTube link. Enter a valid URL (e.g., https://www.youtube.com/watch?v=...)'
    ));
  }
  const videoId = match[1];
  const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const promptText = isEn
    ? `Analyze this cycling, exercise physiology, or endurance sports YouTube video.
Your task is to extract and structure the knowledge from the video for a personal cycling AI coach knowledge base.
Write the title, summary, and entire content in crisp, natural English.

Format your response EXACTLY in this structure (keep the uppercase prefix markers intact):
TITLE: [Topic title or exact video title]
AUTHOR: [Channel name, speaker, or lecture author]
CATEGORY: YouTube predavanje / podcast
SUMMARY: [2-3 sentence summary of what the video covers and the main takeaway for a cyclist]
CONTENT:
### 1. KEY SCIENTIFIC & PHYSIOLOGICAL CONCEPTS
(Main study findings, adaptation mechanisms, mitochondria, lactate, Zone 2, VO2max, etc.)

### 2. COACHING RECOMMENDATIONS & PROTOCOLS
(Concrete prescriptions from the video: intensities in % FTP / HR, intervals, work-to-rest ratios, fueling/carbs, recovery)

### 3. PRACTICAL APPLICATION
(How an amateur or competitive cyclist can apply this in their weekly training plan)`
    : `Analiziraj ovaj YouTube video s biciklističkom, fiziološkom ili sportskom tematikom. 
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
    content: (summary ? `> **${tr('Sažetak', 'Summary')}:** ${summary}\n\n` : '') + content,
    videoId,
    sourceUrl: standardUrl
  };
}

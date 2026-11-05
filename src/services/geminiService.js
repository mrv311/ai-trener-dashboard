/**
 * ErgVibe Gemini AI Coaching Service
 * Povezuje Google Gemini (2.5 Flash / Pro) s 8-godišnjom bazom treninga, fiziološkom literaturom i live metrikama.
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
  return { configured: false, source: 'none' };
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
 * Niskorazinski poziv prema Google Gemini v1beta REST API-ju.
 */
async function callGeminiApi({
  systemInstruction,
  contents,
  model = 'gemini-3.8-flash',
  temperature = 0.4,
  responseMimeType = null
}) {
  const apiKey = getResolvedGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API ključ nije pronađen. Provjeri VITE_GEMINI_API_KEY u .env datoteci ili postavke u tabu Veze.');
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  };

  let response = await executeForModel(model);

  // Automatski fallback na latest alias ako specifična verzija ikada postane nedostupna
  if (response.status === 404) {
    const fallbackModel = model.includes('pro') ? 'gemini-pro-latest' : 'gemini-flash-latest';
    if (model !== fallbackModel) {
      response = await executeForModel(fallbackModel);
    }
  }

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) errDetail = errJson.error.message;
    } catch {
      // ignore non-JSON body
    }
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
  model = 'gemini-3.8-flash'
}) {
  const ftp = Number(metrics.ftp || athleteProfile?.ftp || 270);
  const exactHist = await findExactHistoricalRecord(activity);

  const np = Number(metrics.np || activity?.np || exactHist?.np || 0);
  const avgPower = Number(metrics.avgPower || activity?.average_power || exactHist?.avgPwr || 0);
  const maxPower = Number(metrics.maxPower || activity?.max_power || exactHist?.pMax || 0);
  const avgHr = Number(metrics.avgHr || activity?.average_heartrate || exactHist?.avgHr || 0);
  const maxHr = Number(metrics.maxHr || exactHist?.maxHr || 0);
  const cadence = Number(metrics.avgCadence || exactHist?.cad || 0);
  const durMin = Number(metrics.durationMin || activity?.duration || exactHist?.durMin || 0);
  const plannedDurMin = Number(metrics.plannedDurationMin || activity?.plannedDuration || 0);
  const tss = Number(metrics.tss ?? activity?.tss ?? exactHist?.tss ?? 0);
  const plannedTss = Number(metrics.plannedTss || activity?.plannedTss || 0);
  const ef = Number(metrics.ef || (np && avgHr ? (np / avgHr).toFixed(2) : exactHist?.ef || 0));
  const vi = Number(metrics.vi || (np && avgPower ? (np / avgPower).toFixed(2) : exactHist?.vi || 0));
  const decoupling = metrics.decoupling != null
    ? metrics.decoupling
    : (exactHist?.dec != null ? exactHist.dec : null);
  const ifPct = np && ftp ? Number(((np / ftp) * 100).toFixed(1)) : (exactHist?.ifPct || null);
  const workKj = metrics.workKj || exactHist?.wFtpKj ? metrics.workKj : null;
  const workAboveFtpKj = exactHist?.wFtpKj ?? null;
  const hrr = exactHist?.hrr ?? null;
  const rhr = exactHist?.rhr ?? null;

  const targetForMatching = {
    id: activity?.actId || activity?.id,
    title: activity?.title || activity?.name || 'Trening',
    date: activity?.started_at || activity?.date || new Date().toISOString().slice(0, 10),
    np,
    avgPwr: avgPower,
    ifPct,
    durMin,
    ftp
  };

  const athleteContext = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: targetForMatching
  });

  const knowledgePrompt = compileKnowledgeBasePrompt({ includeWorkoutSyntax: true });

  const systemInstruction = `Ti si vrhunski biciklistički trener i fiziolog sporta (ErgVibe AI Trener).
Komuniciraš isključivo na hrvatskom jeziku — stručno, konkretno, poticajno i bez generičkih fraza.
Uvijek navodiš točne brojke iz treninga i uspoređuješ ih s višegodišnjom poviješću ovog sportaša (2019.–2026.) te znanstvenom literaturom iz baze znanja.

${knowledgePrompt}`;

  const workoutSummaryLines = [
    `## PODACI O UPRAVO ANALIZIRANOM TRENINGU`,
    `- Naziv treninga: "${targetForMatching.title}"`,
    `- Datum: ${targetForMatching.date.slice(0, 10)}`,
    `- Kategorija / Zona fokusa: ${activity?.category || 'Biciklizam'}`,
    `- Trajanje: ${durMin} min${plannedDurMin ? ` (Planirano: ${plannedDurMin} min)` : ''}`,
    `- Normalized Power (NP): ${np || '-'} W | Prosječna snaga: ${avgPower || '-'} W | Max snaga: ${maxPower || '-'} W`,
    `- FTP u trenutku treninga: ${ftp} W | Intenzitet (IF): ${ifPct ? `${ifPct}% (${(ifPct / 100).toFixed(2)})` : '-'}`,
    `- Opterećenje (TSS / Load): ${tss}${plannedTss ? ` (Planirano: ${plannedTss} TSS)` : ''}`,
    `- Puls: Prosjek ${avgHr || '-'} bpm${maxHr ? ` | Max ${maxHr} bpm` : ''}${rhr ? ` | Jutarnji puls (RHR): ${rhr} bpm` : ''}${hrr ? ` | Oporavak pulsa u 1 min (HRRc): ${hrr} bpm` : ''}`,
    `- Kadenca: ${cadence ? `${cadence} rpm` : 'Nije zabilježena'}`,
    `- Efficiency Factor (EF = NP/HR): ${ef || '-'}`,
    `- Variability Index (VI = NP/AvgP): ${vi || '-'}`,
    `- Aerobic Decoupling (Pw:HR drift): ${decoupling != null ? `${decoupling}%` : 'Nije dostupno'}${metrics.efFirst && metrics.efSecond ? ` (EF 1. pol: ${metrics.efFirst} → EF 2. pol: ${metrics.efSecond})` : ''}`,
    workKj ? `- Ukupan mehanički rad: ${workKj} kJ` : null,
    workAboveFtpKj != null ? `- Rad iznad FTP-a (Work >FTP): ${workAboveFtpKj} kJ` : null,
    userNote?.trim() ? `- Subjektivni komentar vozača / napomena: "${userNote.trim()}"` : null
  ].filter(Boolean).join('\n');

  const userPrompt = `${athleteContext}

${workoutSummaryLines}

Napravi detaljnu, ali preglednu trenersku analizu ovog treninga strukturiranu kroz sljedeće cjeline:
1. **🎯 Izvedba i fiziološki cilj treninga** — Je li trening ispunio svoju namjenu, kakva je kvaliteta odrađenog posla (disciplina snage, VI, realizacija plana)?
2. **🔬 Fiziološka dubinska analiza (EF, Decoupling, Puls)** — Protumači Efficiency Factor (${ef || '-'}) i Aerobic Decoupling (${decoupling != null ? decoupling + '%' : 'N/A'}) u kontekstu vrste treninga (pazi na razliku između kontinuirane Z2/SST vožnje i eksplozivnih intervala!).
3. **📈 Usporedba s tvojom 8-godišnjom poviješću** — Usporedi ove brojke s konkretnim ranijim sličnim treninzima iz tablice povijesnih usporedbi i osobnim benchmarkovima ovog vozača. Vidi li se napredak, stabilnost ili zamor?
4. **🔋 Kontekst forme (CTL/ATL/TSB) i oporavak** — Kako ovaj TSS utječe na trenutni blok, koliki je zamor i na što paziti u prehrani/hidrataciji/odmoru danas.
5. **🚀 Preporuka za idući trening (idućih 24–48h)** — Što konkretno voziti sutra/prekosutra s obzirom na nedavne treninge i kalendar. Ako je prikladno, uključi jedan gotov \`\`\`workout blok koji vozač može jednim klikom spremiti u kalendar ili pokrenuti na trenažeru.`;

  return callGeminiApi({
    systemInstruction,
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
  model = 'gemini-3.8-flash'
}) {
  const athleteContext = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData,
    targetActivity: {
      id: activity?.actId || activity?.id,
      title: activity?.title || activity?.name,
      date: activity?.started_at || activity?.date,
      ftp: athleteProfile?.ftp || 270
    }
  });
  const knowledgePrompt = compileKnowledgeBasePrompt({ includeWorkoutSyntax: true });

  const systemInstruction = `Ti si ErgVibe AI biciklistički trener. Odgovaraš na dodatno pitanje vozača vezano uz upravo analizirani trening "${activity?.title || 'Trening'}" (${(activity?.date || '').slice(0, 10)}).
Budi konkretan, jasan i osloni se na podatke sportaša i bazu znanja. Odgovaraj na hrvatskom jeziku.

${knowledgePrompt}

${athleteContext}`;

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
 * Konverzacijski AI Trener u glavnom "AI Trener" tabu.
 */
export async function chatWithAICoach({
  messages = [],
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash'
}) {
  const athleteContext = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData
  });
  const knowledgePrompt = compileKnowledgeBasePrompt({ includeWorkoutSyntax: true });

  const systemInstruction = `Ti si ErgVibe AI Trener — osobni biciklistički trener i fiziolog ovog sportaša s potpunim uvidom u njegovih ~1.900 treninga od 2019. do danas, trenutni kalendar i stanje kondicije (CTL/ATL/TSB).
Odgovaraš isključivo na hrvatskom jeziku, jasno, strukturirano (koristi markdown naslove, podebljanja i liste) i utemeljeno u sportskoj znanosti i konkretnim brojkama vozača.
Kad god korisnik zatraži konkretan trening ili prijedlog vožnje za trenažer, uključi strukturirani \`\`\`workout blok kako bi ga mogao jednim klikom dodati u ErgVibe kalendar ili pokrenuti na trenažeru.

${knowledgePrompt}

${athleteContext}`;

  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));

  return callGeminiApi({
    systemInstruction,
    contents,
    model,
    temperature: 0.45
  });
}

/**
 * Generator strukturiranog kratkoročnog ili višednevnog/višetjednog trening plana (JSON output).
 */
export async function generateStructuredTrainingPlan({
  goal = 'Podizanje FTP-a i aerobne efikasnosti',
  weeks = 2,
  workoutsPerWeek = 4,
  hoursPerWeek = 6,
  methodology = 'Polarizirani / Piramidalni (80/20)',
  startDate,
  notes = '',
  athleteProfile,
  liveWorkouts = [],
  wellnessData = {},
  model = 'gemini-3.8-flash'
}) {
  const athleteContext = await buildAthleteContextPrompt({
    athleteProfile,
    liveWorkouts,
    wellnessData
  });
  const knowledgePrompt = compileKnowledgeBasePrompt({ includeWorkoutSyntax: false });

  const effectiveStart = startDate || new Date().toISOString().slice(0, 10);

  const systemInstruction = `Ti si vrhunski biciklistički trener koji kreira precizne strukturirane planove treninga za pametni trenažer i cestu.
Moraš vratiti ISKLJUČIVO ispravan JSON objekt prema traženoj shemi, na hrvatskom jeziku.

${knowledgePrompt}

${athleteContext}`;

  const prompt = `Kreiraj personalizirani strukturirani biciklistički trening plan za ovog vozača:
- Glavni cilj plana: ${goal}
- Trajanje plana: ${weeks} ${weeks === 1 ? 'tjedan' : 'tjedna'} (početak od datuma: ${effectiveStart})
- Broj treninga tjedno: ${workoutsPerWeek} treninga
- Raspoloživo vrijeme: ~${hoursPerWeek} sati tjedno
- Odabrana metodologija: ${methodology}
${notes ? `- Posebne napomene vozača: ${notes}` : ''}

Prilagodi tjedni TSS i intenzitet trenutnom CTL-u i TSB-u vozača te njegovom FTP-u (${athleteProfile?.ftp || 270} W).
Svaki trening MORA imati polje "intervalsCode" s valjanim Intervals.icu / ErgVibe tekstualnim koracima u postotku FTP-a!
Primjer valjanog "intervalsCode" stringa (koristi \\n za nove redove):
"Zagrijavanje\\n- 10m 55%\\nGlavni dio\\n3x\\n- 10m 90%\\n- 4m 55%\\nHlađenje\\n- 8m 50%"

Vrati JSON točno ove strukture:
{
  "planTitle": "Naziv plana",
  "summary": "Kratki sažetak strategije plana (2-3 rečenice)",
  "physiologicalRationale": "Zašto ovakva raspodjela zona odgovara trenutnom CTL/TSB stanju i povijesti ovog vozača",
  "recommendedWeeklyHours": ${hoursPerWeek},
  "weeks": [
    {
      "weekNumber": 1,
      "theme": "Tema tjedna (npr. Akumulacija aerobne baze i Sweet Spot)",
      "targetTss": 260,
      "workouts": [
        {
          "dayOffset": 0,
          "dayName": "Utorak",
          "title": "Naziv treninga",
          "category": "Endurance | Tempo | Sweet Spot | Threshold | VO2 Max | Recovery",
          "durationMin": 60,
          "estimatedTss": 52,
          "coachNote": "Kratka uputa za izvedbu (kadenca, disanje, cilj)",
          "intervalsCode": "Zagrijavanje\\n- 10m 55%\\nGlavni dio\\n- 42m 68%\\nHlađenje\\n- 8m 50%"
        }
      ]
    }
  ]
}
Napomena za "dayOffset": 0 označava prvi dan plana (${effectiveStart}), 1 je sljedeći dan, itd. Unutar tjedna rasporedi treninge s pametnim razmakom za oporavak (dayOffset od 0 do ${(weeks * 7) - 1}).`;

  const rawJsonText = await callGeminiApi({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    model,
    temperature: 0.35,
    responseMimeType: 'application/json'
  });

  try {
    const cleaned = rawJsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[geminiService] JSON parse error:', err, rawJsonText);
    throw new Error('AI je generirao neispravan format plana. Pokušaj ponovno.');
  }
}

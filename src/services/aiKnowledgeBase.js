/**
 * ErgVibe AI Cycling Knowledge Base
 * Ugrađena znanstvena i trenerska literatura + podrška za vlastite izvore korisnika (knjige, bilješke, protokoli).
 */

const STORAGE_KEY_CUSTOM_SOURCES = 'ergvibe_ai_custom_knowledge_v1';
const STORAGE_KEY_DISABLED_MODULES = 'ergvibe_ai_disabled_modules_v1';

export const BUILT_IN_KNOWLEDGE_MODULES = [
  {
    id: 'coggan_allen',
    title: 'Training and Racing with a Power Meter',
    author: 'Dr. Andrew Coggan & Hunter Allen',
    category: 'Fiziologija snage & Metrike',
    summary: 'Zone snage (Z1–Z7 + Sweet Spot), NP, IF, TSS, Efficiency Factor (EF), Variability Index (VI), Aerobic Decoupling (Pw:HR) i W\' balans.',
    content: `### COGGAN & ALLEN — ANALITIKA SNAGE I FIZIOLOŠKE ADAPTACIJE
1. **Coggan Zone Snage (% FTP):**
   - **Z1 Active Recovery (<55% FTP):** Cirkulacija i oporavak bez novog glikolitičkog ili živčanog zamora.
   - **Z2 Endurance (56–75% FTP):** Temeljna aerobna zona. Potiče mitohondrijsku biogenezu, gustoću kapilara, oksidaciju masti i pretvorbu vlakana tipa IIx u IIa.
   - **Z3 Tempo (76–90% FTP) & Sweet Spot (84–97% FTP):** Visoki aerobni podražaj i mišićna izdržljivost uz umjereno nakupljanje laktata. Odličan omjer podražaja i vremena za vozače s 5–9 sati tjedno, ali zahtijeva oprez zbog akumulacije umora ako zamijeni pravu Z2 vožnju.
   - **Z4 Lactate Threshold (91–105% FTP):** Podizanje metaboličkog praga (MLSS/FTP) i sposobnosti čišćenja laktata. Klasični intervali: 2x20m, 3x12m, 4x10m.
   - **Z5 VO2 Max (106–120% FTP):** Maksimalni udarni volumen srca i centralni aerobni kapacitet. Tipični intervali: 4–6x 3–5 min ili mikro-intervali (30/15s, 40/20s).
   - **Z6 Anaerobic Capacity (121–150% FTP) & Z7 Neuromuscular (>150% FTP):** Trošenje W' (anaerobnog radnog kapaciteta iznad FTP-a), tolerancija na acidozu i regrutacija brzih motornih jedinica.

2. **Ključni Analitički Indikatori:**
   - **Efficiency Factor (EF = NP / Avg HR):** Mjera aerobne ekonomičnosti. Rast EF-a pri istom intenzitetu (posebno u Z2 i Sweet Spotu) kroz tjedne i sezone dokazuje stvarni napredak aerobnog pogona. Na EF kratkoročno utječu temperatura, hidratacija, kofein i umor.
   - **Aerobic Decoupling (Pw:HR %):** Usporedba omjera snage i pulsa u prvoj i drugoj polovici treninga.
     * **< 3%:** Vrhunska aerobna stabilnost i izdržljivost (durability).
     * **3% – 5%:** Dobro usklađena aerobna baza za to trajanje.
     * **> 5% u kontinuiranoj Z2/Z3 vožnji:** Kardijalni drift — znak nedovoljne izdržljivosti za to trajanje, dehidracije, pregrijavanja (često na trenažeru bez jakog ventilatora) ili pražnjenja glikogena.
     * **VAŽNA IZNIMKA:** Kod intervalnih treninga visokog intenziteta (VO2max, anaerobni intervali, npr. Mills, Spencer, 30/30s) s naglim promjenama snage i visokim VI (>1.15), decoupling >8–15% je fiziološki normalan zbog sporije kinetike pulsa u pauzama i EPOC-a — to NIJE znak loše aerobne baze!
   - **Variability Index (VI = NP / Avg Power):**
     * **1.00 – 1.03:** Izuzetno ravnomjeran napor (ERG Z2 vožnja ili kronometar).
     * **1.04 – 1.12:** Umjereno varijabilan trening (Sweet Spot intervali ili valovita cesta).
     * **> 1.15:** Stohastički/eksplozivni trening (VO2max intervali, kriterij, brdsko-planinski teren).
   - **Work > FTP (kJ):** Ukupan rad iznad praga; pokazuje koliki je anaerobni stres (W' pražnjenje) trening izazvao.`
  },
  {
    id: 'friel_periodization',
    title: 'The Cyclist\'s Training Bible',
    author: 'Joe Friel',
    category: 'Periodizacija & Upravljanje formom (PMC)',
    summary: 'Makro/mezo/mikro-ciklusi, progresija opterećenja, tumačenje CTL/ATL/TSB krivulje, oporavak i adaptacija iskusnih biciklista.',
    content: `### JOE FRIEL — PERIODIZACIJA, SUPERKOMPENZACIJA I UPRAVLJANJE OPTEREĆENJEM
1. **Performance Management Chart (PMC) — CTL, ATL i TSB:**
   - **Fitness (CTL — Chronic Training Load):** Eksponencijalni prosjek zadnjih 42 dana (TSS/dan). Odražava koliko opterećenja sportaš kronično podnosi. Siguran tjedni porast (Ramp Rate) iznosi **+3 do +6 CTL bodova tjedno**. Brži rast (>7–8/tjedan) drastično povećava rizik od pretreniranosti i bolesti.
   - **Fatigue (ATL — Acute Training Load):** Kratkoročni umor (7-dnevni prosjek).
   - **Form (TSB = CTL - ATL):** Ravnoteža stresa i svježine:
     * **TSB +15 do +25:** Visoka svježina / prijelazni period; predugo zadržavanje vodi u pad kondicije (detraining).
     * **TSB +5 do +15:** Optimalna natjecateljska forma (Peak / Race spremnost, idealno za FTP test ili ključnu utrku).
     * **TSB -10 do +5:** Funkcionalna zona održavanja i redovnog treniranja.
     * **TSB -10 do -25:** Produktivno funkcionalno preopterećenje (Overload blok) — ovdje nastaje poticaj za rast forme, ali zahtijeva planirani tjedan oporavka (svaki 3. ili 4. tjedan).
     * **TSB ispod -25 do -30:** Crvena zona visokog rizika (non-functional overreaching) — obvezan odmor ili Z1/Z2 redukcija!

2. **Principi Periodizacije i Oporavka:**
   - **Superkompenzacija se događa u odmoru, ne tijekom intervala.** Dva ili tri teška intervalna dana zaredom bez aerobnog/oporavljajućeg dana tupo troše autonomni živčani sustav.
   - **Autonomni markeri:** Jutarnji puls u mirovanju (Resting HR povišen za >5–7 bpm iznad uobičajenog) ili pad brzine oporavka pulsa (HRRc < 20 bpm u 1 min) ukazuju na neoporavljen simpatički sustav.
   - **Struktura Mezociklusa:** Tipično 3 tjedna progresivnog opterećenja + 1 tjedan rasterećenja (Recovery tjedan s 50–65% uobičajenog TSS-a uz zadržavanje kratkih dionica intenziteta radi tonusa).`
  },
  {
    id: 'seiler_polarized',
    title: 'Polarized 80/20 & Pyramidal Endurance Training',
    author: 'Dr. Stephen Seiler & Iñigo San Millán',
    category: 'Distribucija intenziteta & Z2 metabolizam',
    summary: 'Polarizirani (80/20) naspram piramidalnog modela, uloga LT1/VT1 praga, oksidacija laktata (MCT1 transporteri) i zamka "sive zone".',
    content: `### SEILER & SAN MILLÁN — DISTRIBUCIJA INTENZITETA I METABOLIČKA FLEKSIBILNOST
1. **Tri Fiziološke Zone i Disciplina Intenziteta:**
   - **Ispod LT1 / VT1 (~55–75% FTP, Z1–Z2):** Nizak stres na autonomni živčani sustav, minimalno lučenje kortizola/kateholamina, maksimalna stimulacija mitohondrija i MCT1 transportera za čišćenje laktata u sporim mišićnim vlaknima.
   - **Između LT1 i LT2 (76–98% FTP, Tempo / Sweet Spot):** Korisna specifična izdržljivost u piramidalnom modelu i kod vozača s ograničenim vremenom (<7h/tjedno), no izaziva znatno veći autonomni umor od Z2.
   - **Iznad LT2 (>100% FTP, Threshold / VO2max):** Snažan centralni i periferni signal adaptacije; optimalno 1 do 2 kvalitetne sesije tjedno (rijetko više od 3).

2. **Pravilo "Neka lagani dani budu zaista lagani, a teški zaista teški":**
   - Najčešća pogreška rekreativnih i natjecateljskih biciklista je vožnja Z2 treninga prejakim tempom (IF > 0.75–0.78), čime se generira umor koji ruši kvalitetu ključnih intervala na idućem teškom treningu.
   - Za vozača koji trenira 5–8 sati tjedno (3–5 treninga tjedno), idealna kombinacija je **Piramidalni ili Polarizirani pristup**: 2 ključna intervalna treninga (npr. 1x VO2max ili Threshold + 1x Sweet Spot/Threshold) + 2–3 čiste Z2 Endurance vožnje s niskim decouplingom (<5%).`
  }
];

export const ERGVIBE_WORKOUT_FORMAT_GUIDE = `### FORMAT ZA STRUKTURIRANE TRENINGE U ERGVIBE / INTERVALS.ICU
Kada korisniku predlažeš konkretan strukturirani trening za trenažer, u tekst uključi \`\`\`workout blok točno u ovom formatu:
\`\`\`workout
TITLE: Naziv treninga
CATEGORY: Endurance | Tempo | Sweet Spot | Threshold | VO2 Max | Recovery
DURATION: ukupno minuta (broj, npr. 60 - NIKAKO u sekundama poput 3600)
TSS: procijenjeni TSS (broj, npr. 55)
STEPS:
Zagrijavanje
- 10m 55%
Glavni dio
3x
- 8m 90%
- 4m 55%
Hlađenje
- 8m 50%
\`\`\`
Pravila za STEPS linije:
- Koristi isključivo postotak FTP-a (npr. \`- 15m 65%\`, \`- 3m 112%\`, \`- 30s 125%\`).
- Za ponavljanja napiši \`Nx\` u posebnom retku iznad intervala i odmora (npr. \`4x\` pa ispod \`- 4m 108%\` i \`- 4m 50%\`).`;

export function getDisabledModuleIds() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_DISABLED_MODULES) || '[]');
  } catch {
    return [];
  }
}

export function toggleBuiltInModule(moduleId) {
  const disabled = getDisabledModuleIds();
  const next = disabled.includes(moduleId)
    ? disabled.filter(id => id !== moduleId)
    : [...disabled, moduleId];
  try {
    localStorage.setItem(STORAGE_KEY_DISABLED_MODULES, JSON.stringify(next));
  } catch {
    // ignore storage error
  }
  return next;
}

export function getCustomKnowledgeSources() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_SOURCES) || '[]');
  } catch {
    return [];
  }
}

export function addCustomKnowledgeSource({ title, author = '', category = 'Vlastita literatura', content, sourceUrl = '' }) {
  if (!title?.trim() || !content?.trim()) {
    throw new Error('Naziv i sadržaj izvora su obavezni.');
  }
  const existing = getCustomKnowledgeSources();
  const newItem = {
    id: `custom_${Date.now()}`,
    title: title.trim(),
    author: author.trim() || 'Osobna bilješka / Knjiga',
    category: category.trim() || 'Vlastita literatura',
    content: content.trim().slice(0, 60000), // sigurnosni limit za localStorage (~60k znakova po izvoru)
    sourceUrl: (sourceUrl || '').trim(),
    createdAt: new Date().toISOString()
  };
  const updated = [newItem, ...existing];
  localStorage.setItem(STORAGE_KEY_CUSTOM_SOURCES, JSON.stringify(updated));
  return updated;
}

export function removeCustomKnowledgeSource(id) {
  const existing = getCustomKnowledgeSources();
  const updated = existing.filter(item => item.id !== id);
  localStorage.setItem(STORAGE_KEY_CUSTOM_SOURCES, JSON.stringify(updated));
  return updated;
}

/**
 * Sastavlja aktivnu bazu znanja za Gemini sistemski prompt.
 */
export function compileKnowledgeBasePrompt({ includeWorkoutSyntax = false } = {}) {
  const disabled = getDisabledModuleIds();
  const activeBuiltIn = BUILT_IN_KNOWLEDGE_MODULES.filter(m => !disabled.includes(m.id));
  const customSources = getCustomKnowledgeSources();

  const sections = [];

  if (activeBuiltIn.length > 0) {
    sections.push('## ZNANSTVENA I TRENERSKA BAZA ZNANJA');
    activeBuiltIn.forEach(mod => {
      sections.push(mod.content);
    });
  }

  if (customSources.length > 0) {
    sections.push('## DODATNA KORISNIČKA LITERATURA I BILJEŠKE');
    customSources.forEach(src => {
      sections.push(`### ${src.title} (${src.author})\n${src.content}`);
    });
  }

  if (includeWorkoutSyntax) {
    sections.push(ERGVIBE_WORKOUT_FORMAT_GUIDE);
  }

  return sections.join('\n\n');
}

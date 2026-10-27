#!/usr/bin/env node
/**
 * Uvoz lokalne baze treninga (.zwo / .xml / .erg) u Supabase tablicu `workouts`.
 *
 * Korištenje:
 *   npm run import:workouts                     -> DRY RUN (detaljan pregled i CSV bez upisa u bazu)
 *   npm run import:workouts:commit              -> STVARNI UPIS u Supabase
 *   node scripts/import-local-workouts.mjs --rollback <putanja-do-committed.json> -> SIGURNI UNDO
 *
 * Značajke:
 *  1. Pametno prepoznavanje duplikata po fiziološkom sadržaju (fingerprint trajanja i snage po sekundama):
 *     - ZWO i ERG verzije istog treninga se ne dupliciraju.
 *     - Kada postoji više datoteka istog treninga, bira se najljepši, opisni naziv (npr. "Carson" umjesto "Week 10.5 - Day 5").
 *     - Različiti treninzi s istim generičkim nazivom disambiguiraju se po trajanju (npr. "Crisscross 3x10 (70 min)") i mapi plana.
 *  2. Točna klasifikacija po prevladavajućoj zoni:
 *     - Koristi istu provjerenu logiku iz src/utils/workoutParser.js (Oporavak, Endurance, Tempo, Sweet Spot, Threshold, VO2 Max, Anaerobni).
 *     - Prava detekcija FTP testova (Testiranje) uz eliminaciju lažnih uzbuna iz "testing week" ili "openers".
 *     - Podrška za Zwift Zone="1..7", ramp stepenice i ftptest atribute.
 *  3. Sigurnost:
 *     - Sprema CSV izvještaj i JSON s ID-evima za jednostavan rollback ako ikad zatreba.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { runnerImport } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PATH = 'C:\\Users\\dmalbasa\\OneDrive - Ministarstvo zaštite okoliša i zelene tranzicije\\P R I V A T N O\\B I K E\\E R G';

// CLI argumenti
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const rollbackIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;
const pathIdx = args.indexOf('--path');
const ROOT = pathIdx >= 0 ? args[pathIdx + 1] : DEFAULT_PATH;
const BATCH_SIZE = 100;

// Supabase klijent
function loadEnv() {
  const env = {};
  for (const file of ['.env', '.env.local']) {
    const p = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.trim().startsWith('#')) {
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return env;
}

const env = loadEnv();
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  console.error('❌ Nedostaju VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY u .env datoteci.');
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

// Uvoz aplikacijske logike
const { module: parserModule } = await runnerImport(path.join(PROJECT_ROOT, 'src/utils/workoutParser.js'));
const { categorizeWorkout, calculateCategoryDifficulty } = parserModule;

// Mapiranje Zwift Zone atributa na % FTP
const ZONE_MAP = { 1: 50, 2: 65, 3: 82, 4: 98, 5: 113, 6: 135, 7: 160 };

// Pomoćne funkcije

function sanitize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\0/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

const round = (n) => Math.round(n);
const num = (v, def = null) => {
  if (v === null || v === undefined || v === '') return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(zwo|xml|erg)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function rampToSteps(name, duration, pLow, pHigh) {
  duration = round(duration);
  if (duration <= 0) return [];
  if (Math.abs(pHigh - pLow) < 2 || duration < 60) {
    return [{ name, duration, power: round((pLow + pHigh) / 2) }];
  }
  const n = Math.max(2, Math.min(20, round(duration / 60)));
  const steps = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const d = i === n - 1 ? duration - used : round(duration / n);
    used += d;
    const p = pLow + (pHigh - pLow) * ((i + 0.5) / n);
    steps.push({ name, duration: d, power: round(p) });
  }
  return steps;
}

function mergeSteps(steps) {
  const out = [];
  for (const s of steps) {
    if (!s || !(s.duration > 0)) continue;
    const last = out[out.length - 1];
    if (last && last.power === s.power && last.name === s.name) last.duration += s.duration;
    else out.push({ name: s.name, duration: s.duration, power: s.power });
  }
  return out;
}

const decodeXml = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
  .trim();

// ZWO / Zwift XML parser
function parseZwo(text) {
  const getTag = (tag) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? decodeXml(m[1]) : '';
  };
  const sport = getTag('sportType').toLowerCase();
  if (sport && !['bike', 'ride', 'cycling'].includes(sport)) return { skip: `sport: ${sport}` };

  const wm = text.match(/<workout>([\s\S]*?)<\/workout>/i);
  if (!wm) return { skip: 'nema <workout> sekcije' };

  const body = wm[1].replace(/<(textevent|TextEvent|TextNotification)\b[^>]*\/>/gi, '')
    .replace(/<(textevent|TextEvent|TextNotification)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const steps = [];
  let hasFtpTestTag = false;

  const re = /<(\w+)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    const attrs = {};
    for (const a of m[2].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2];
    const dur = num(attrs.duration, 0);
    const pct = (v, def) => { const n = num(v, null); return n === null ? def : n * 100; };
    const getZone = (attr, def) => {
      const z = parseInt(attrs[attr] || 0);
      return (z && ZONE_MAP[z]) ? ZONE_MAP[z] : def;
    };

    switch (tag) {
      case 'warmup': {
        const pl = attrs.powerlow ? pct(attrs.powerlow) : (attrs.power ? pct(attrs.power) : getZone('zone', 45));
        const ph = attrs.powerhigh ? pct(attrs.powerhigh) : (attrs.power ? pct(attrs.power) : getZone('zone', 70));
        steps.push(...rampToSteps('Zagrijavanje', dur, pl, ph));
        break;
      }
      case 'cooldown': {
        const pl = attrs.powerlow ? pct(attrs.powerlow) : (attrs.power ? pct(attrs.power) : getZone('zone', 65));
        const ph = attrs.powerhigh ? pct(attrs.powerhigh) : (attrs.power ? pct(attrs.power) : getZone('zone', 45));
        steps.push(...rampToSteps('Hlađenje', dur, pl, ph));
        break;
      }
      case 'ramp': {
        const pl = attrs.powerlow ? pct(attrs.powerlow) : (attrs.power ? pct(attrs.power) : getZone('zone', 50));
        const ph = attrs.powerhigh ? pct(attrs.powerhigh) : (attrs.power ? pct(attrs.power) : getZone('zone', 80));
        steps.push(...rampToSteps('Rampa', dur, pl, ph));
        break;
      }
      case 'steadystate':
      case 'solidstate': {
        let p = pct(attrs.power, null);
        if (p === null) {
          if (attrs.powerlow || attrs.powerhigh) p = (pct(attrs.powerlow, 60) + pct(attrs.powerhigh, 60)) / 2;
          else p = getZone('zone', 65);
        }
        steps.push({ name: p < 55 ? 'Oporavak' : 'Interval', duration: round(dur), power: round(p) });
        break;
      }
      case 'intervalst': {
        const reps = Math.max(1, round(num(attrs.repeat, 1)));
        const onDur = round(num(attrs.onduration, 0));
        const offDur = round(num(attrs.offduration, 0));
        let onP = pct(attrs.onpower ?? attrs.poweron, null);
        if (onP === null) {
          if (attrs.poweronlow || attrs.poweronhigh) onP = (pct(attrs.poweronlow, 100) + pct(attrs.poweronhigh, 100)) / 2;
          else onP = getZone('poweronzone', 100);
        }
        let offP = pct(attrs.offpower ?? attrs.poweroff, null);
        if (offP === null) {
          if (attrs.powerofflow || attrs.poweroffhigh) offP = (pct(attrs.powerofflow, 50) + pct(attrs.poweroffhigh, 50)) / 2;
          else offP = getZone('poweroffzone', 50);
        }
        for (let r = 0; r < reps; r++) {
          if (onDur) steps.push({ name: `On (${r + 1}/${reps})`, duration: onDur, power: round(onP) });
          if (offDur) steps.push({ name: 'Off', duration: offDur, power: round(offP) });
        }
        break;
      }
      case 'freeride': {
        const isFtpTest = (attrs.ftptest === '1' || (attrs.flatroad === '1' && dur >= 1200));
        if (isFtpTest) hasFtpTestTag = true;
        steps.push({
          name: isFtpTest ? 'FTP Test' : 'Slobodna vožnja',
          duration: round(dur),
          power: isFtpTest ? 100 : round(pct(attrs.power, 55) || 55)
        });
        break;
      }
      case 'maxeffort':
        steps.push({ name: 'Maksimalni napor', duration: round(dur), power: 150 });
        break;
      default:
        break;
    }
  }

  return {
    title: getTag('name'),
    description: getTag('description'),
    author: getTag('author'),
    hasFtpTestTag,
    steps
  };
}

// ERG parser
function parseErg(text) {
  const lines = text.split(/\r?\n/);
  let title = '', ftp = null, inData = false, inHeader = false, unitsPercent = false;
  const descLines = [];
  const points = [];

  for (const raw of lines) {
    const cl = raw.trim();
    if (/^\[COURSE HEADER\]/i.test(cl)) { inHeader = true; continue; }
    if (/^\[END COURSE HEADER\]/i.test(cl)) { inHeader = false; continue; }
    if (/^\[COURSE DATA\]/i.test(cl)) { inData = true; continue; }
    if (/^\[END COURSE DATA\]/i.test(cl)) { inData = false; continue; }

    if (inHeader) {
      let mm;
      if ((mm = cl.match(/^DESCRIPTION\s*=\s*(.*)$/i))) { descLines.push(mm[1]); continue; }
      if ((mm = cl.match(/^FILE\s*NAME\s*=\s*(.*)$/i))) { title = mm[1].replace(/\.erg$/i, '').trim(); continue; }
      if ((mm = cl.match(/^FTP\s*=\s*([\d.]+)/i))) { ftp = parseFloat(mm[1]); continue; }
      if (/^MINUTES\s+PERCENT/i.test(cl)) { unitsPercent = true; continue; }
      if (/^(VERSION|UNITS)\s*=|^MINUTES\s+WATTS/i.test(cl)) continue;
      if (cl && descLines.length) descLines.push(cl);
      continue;
    }
    if (inData && cl) {
      const parts = cl.split(/\s+/).map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        points.push({ min: parts[0], val: parts[1] });
      }
    }
  }
  const description = descLines.join(' ').replace(/\s+/g, ' ').trim();

  if (points.length < 2) return { skip: 'ERG bez [COURSE DATA]' };
  if (!unitsPercent && !ftp) return { skip: 'ERG u wattima bez FTP vrijednosti' };

  const toPct = (v) => (unitsPercent ? v : (v / ftp) * 100);
  const steps = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dur = (b.min - a.min) * 60;
    if (dur <= 0.5) continue;
    const pA = toPct(a.val), pB = toPct(b.val);
    const avg = (pA + pB) / 2;
    const isRamp = Math.abs(pB - pA) >= 2;
    const name = isRamp
      ? (i === 0 ? 'Zagrijavanje' : (i >= points.length - 2 ? 'Hlađenje' : 'Rampa'))
      : (avg < 55 ? 'Oporavak' : 'Interval');
    steps.push(...rampToSteps(name, dur, pA, pB));
  }

  return { title, description: sanitize(description), steps };
}

// Precizna detekcija pravih FTP testova (isključuje "testing week", "openers", "tune up")
const TEST_STRICT_RE = /\b(ftp[\s_-]*test|ramp[\s_-]*test|field[\s_-]*test|critical[\s_-]*power[\s_-]*test|crit[\s_-]*power[\s_-]*test|elite[\s_-]*rider[\s_-]*test|20[\s_-]*min(ute)?[\s_-]*(ftp[\s_-]*)?test|2[\s_-]*x[\s_-]*(8|12|20)[\s_-]*min(ute)?[\s_-]*test|step[\s_-]*test|map[\s_-]*test)\b/i;
const NOT_TEST_RE = /\b(opener|openers|pre[\s_-]*test|tune[\s_-]*up|tuneup|warmup|day[\s_-]*before)\b/i;

function isTestWorkout(title, filename, hasFtpTestTag) {
  if (hasFtpTestTag) return true;
  const nameOnly = title.split(/[–—-]/)[0].trim();
  const fileBase = path.basename(filename).replace(/\.[^.]+$/, '');
  const testCandidate = `${nameOnly} ${fileBase}`;
  if (NOT_TEST_RE.test(testCandidate)) return false;
  return TEST_STRICT_RE.test(testCandidate);
}

// Otisak (fingerprint) za detekciju identičnog fiziološkog sadržaja
function fingerprint(steps) {
  const norm = [];
  for (const s of steps) {
    const p = Math.round((s.power || 0) / 3);
    const d = s.duration || 0;
    const last = norm[norm.length - 1];
    if (last && last.p === p) last.d += d;
    else norm.push({ p, d });
  }
  return norm.filter(n => n.d >= 5).map(n => `${Math.round(n.d / 10)}:${n.p}`).join('|');
}

const normTitle = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Čišćenje i ocjenjivanje kvalitete naziva treninga
const GENERIC_TITLE_RE = /^(week|wk|w\d|day|dan|tjedan|workout|trening|session|ride)\b|^[\d\s._-]+$/i;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[_\s-]+/i;

function cleanTitle(raw) {
  return (raw || '')
    .replace(DATE_PREFIX_RE, '')
    .replace(/[_\s]+/g, ' ')
    .replace(/\s*\(copy\)/gi, '')
    .replace(/\s*\(\d+\)$/g, '')
    .trim();
}

function scoreTitleQuality(title, ext) {
  let score = 10;
  if (ext === '.zwo') score += 5;
  if (GENERIC_TITLE_RE.test(title)) score -= 15;
  if (/^week\s*\d/i.test(title)) score -= 8;
  if (DATE_PREFIX_RE.test(title)) score -= 5;
  if (title.length >= 6 && title.length <= 40) score += 5;
  return score;
}

function getPlanFolderName(relPath) {
  const parts = relPath.split(/[/\\]/);
  // Tražimo smislenu mapu plana unazad (preskačemo zwo, erg, xml, week1..)
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i].trim();
    if (!/^(zwo|erg|xml|bike|ride|week\s*\d+|day\s*\d+)$/i.test(seg) && seg.length > 2) {
      return seg.replace(/_/g, ' ');
    }
  }
  return parts.length > 1 ? parts[0].replace(/_/g, ' ') : '';
}

// Dohvat postojećih treninga iz baze uz paginaciju (izbjegava Supabase 1000-row limit)
async function fetchAllExisting() {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('workouts').select('id,title,steps,duration_seconds').range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ROLLBACK funkcionalnost
async function handleRollback(rollbackPath) {
  const resolved = path.resolve(process.cwd(), rollbackPath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ Rollback datoteka ne postoji: ${resolved}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const ids = manifest.ids || [];
  if (!ids.length) {
    console.log('ℹ️ Nema zabilježenih ID-eva za rollback u datoteci.');
    return;
  }
  console.log(`\n⏪ Pokrećem rollback ${ids.length} unesenih treninga iz baze...`);
  const CHUNK = 100;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from('workouts').delete().in('id', batch);
    if (error) {
      console.error(`Greška pri brisanju paketa: ${error.message}`);
    } else {
      deleted += batch.length;
      process.stdout.write(`   Obrisano ${deleted}/${ids.length}\r`);
    }
  }
  console.log(`\n✅ Rollback završen. Ukupno obrisano ${deleted} zapisa.`);
}

// GLAVNI TOK
async function main() {
  if (ROLLBACK_FILE) {
    await handleRollback(ROLLBACK_FILE);
    return;
  }

  console.log('===========================================================');
  console.log('  UVOZ LOKALNE BAZE TRENINGA U KNJIŽNICU (WORKOUTS)');
  console.log('===========================================================');
  console.log(`📂 Mapa izvora: ${ROOT}`);
  console.log(COMMIT ? '💾 Način rada: COMMIT (STVARNI UPIS U SUPABASE)\n' : '🧪 Način rada: DRY RUN (simulacija bez upisa, dodaj --commit za upis)\n');

  if (!fs.existsSync(ROOT)) {
    console.error(`❌ Mapa izvora ne postoji: ${ROOT}`);
    process.exit(1);
  }

  const allFiles = walk(ROOT);
  console.log(`🔎 Ukupno pronađeno datoteka: ${allFiles.length}`);

  console.log('🌐 Dohvaćam postojeće treninge iz baze...');
  const existingWorkouts = await fetchAllExisting();
  console.log(`   U bazi je trenutno: ${existingWorkouts.length} treninga`);

  const existingFp = new Map();
  const existingTitles = new Set();
  for (const w of existingWorkouts) {
    const steps = Array.isArray(w.steps) ? w.steps : [];
    const fp = fingerprint(steps.map(s => ({ power: s.power, duration: s.duration })));
    if (fp) existingFp.set(fp, w.title);
    existingTitles.add(normTitle(w.title));
  }

  // PASS 1: Parsiranje svih datoteka i priprema kandidata
  console.log('\n⏳ Parsiram i analiziram sve datoteke...');
  const parsedCandidates = [];
  const reportRows = [];
  let parsedCount = 0;

  for (const file of allFiles) {
    parsedCount++;
    if (parsedCount % 300 === 0) process.stdout.write(`   ...obrađeno ${parsedCount}/${allFiles.length}\r`);
    const rel = path.relative(ROOT, file);
    const ext = path.extname(file).toLowerCase();
    const row = { file: rel, status: '', reason: '', title: '', category: '', difficulty: '', duration_min: '', steps: 0 };

    let parsed;
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      parsed = ext === '.erg' ? parseErg(text) : parseZwo(text);
    } catch (err) {
      Object.assign(row, { status: 'GREŠKA', reason: err.message });
      reportRows.push(row);
      continue;
    }

    if (parsed.skip) {
      Object.assign(row, { status: 'PRESKOČENO', reason: parsed.skip });
      reportRows.push(row);
      continue;
    }

    const steps = mergeSteps(parsed.steps);
    const totalDur = steps.reduce((s, x) => s + x.duration, 0);
    if (steps.length === 0 || totalDur < 300) {
      Object.assign(row, { status: 'PRESKOČENO', reason: 'Prazan trening ili kraći od 5 min' });
      reportRows.push(row);
      continue;
    }

    const baseName = cleanTitle(path.basename(file).replace(/\.[^.]+$/, ''));
    const metaTitle = cleanTitle(parsed.title);
    const titleCandidate = metaTitle || baseName;
    const planFolder = getPlanFolderName(rel);

    const fp = fingerprint(steps);
    const zoneCategory = categorizeWorkout(steps);
    const isTest = isTestWorkout(titleCandidate, file, parsed.hasFtpTestTag);
    const category = isTest ? 'Testiranje' : zoneCategory;
    const difficulty = calculateCategoryDifficulty(steps, category);

    parsedCandidates.push({
      file,
      rel,
      ext,
      titleCandidate,
      baseName,
      planFolder,
      steps,
      totalDur,
      fp,
      category,
      difficulty,
      description: parsed.description || '',
      author: parsed.author || '',
      qualityScore: scoreTitleQuality(titleCandidate, ext),
      row
    });
  }

  console.log(`\n✅ Uspješno parsirano validnih treninga: ${parsedCandidates.length}`);

  // PASS 2: Pametno grupiranje po sadržaju (fingerprint) i odabir najboljeg naziva
  const fpGroups = new Map();
  for (const c of parsedCandidates) {
    if (!fpGroups.has(c.fp)) fpGroups.set(c.fp, []);
    fpGroups.get(c.fp).push(c);
  }

  const toInsert = [];
  const usedTitlesInImport = new Map(); // normTitle -> durationMin

  for (const [fp, group] of fpGroups.entries()) {
    // 1. Provjera postoji li već u bazi
    if (existingFp.has(fp)) {
      const matchTitle = existingFp.get(fp);
      for (const item of group) {
        Object.assign(item.row, {
          status: 'DUPLIKAT',
          reason: `Već u bazi: "${matchTitle}"`,
          title: item.titleCandidate,
          category: item.category,
          difficulty: item.difficulty,
          duration_min: Math.round(item.totalDur / 60),
          steps: item.steps.length
        });
        reportRows.push(item.row);
      }
      continue;
    }

    // 2. Izaberi najboljeg predstavnika unutar grupe duplikata
    group.sort((a, b) => b.qualityScore - a.qualityScore || a.titleCandidate.length - b.titleCandidate.length);
    const winner = group[0];

    // Ostali u grupi bilježe se kao duplikati pobjednika
    for (let k = 1; k < group.length; k++) {
      const dup = group[k];
      Object.assign(dup.row, {
        status: 'DUPLIKAT',
        reason: `Isti sadržaj kao: "${winner.titleCandidate}" (${winner.rel})`,
        title: dup.titleCandidate,
        category: dup.category,
        difficulty: dup.difficulty,
        duration_min: Math.round(dup.totalDur / 60),
        steps: dup.steps.length
      });
      reportRows.push(dup.row);
    }

    // 3. Formatiranje finalnog naziva za pobjednika
    let finalTitle = winner.titleCandidate;
    if (finalTitle.length < 5 || GENERIC_TITLE_RE.test(finalTitle)) {
      finalTitle = winner.planFolder ? `${finalTitle} – ${winner.planFolder}` : finalTitle;
    }

    const durMin = Math.round(winner.totalDur / 60);
    const norm = normTitle(finalTitle);

    // Ako već postoji trening s istim nazivom, ali drugačijim sadržajem
    if (existingTitles.has(norm) || usedTitlesInImport.has(norm)) {
      const prevDur = usedTitlesInImport.get(norm);
      if (prevDur && Math.abs(prevDur - durMin) >= 5) {
        finalTitle = `${finalTitle} (${durMin} min)`;
      } else if (winner.planFolder) {
        finalTitle = `${finalTitle} (${winner.planFolder})`;
      } else {
        let n = 2;
        let candidate = `${finalTitle} ${n}`;
        while (existingTitles.has(normTitle(candidate)) || usedTitlesInImport.has(normTitle(candidate))) {
          n++;
          candidate = `${finalTitle} ${n}`;
        }
        finalTitle = candidate;
      }
    }

    usedTitlesInImport.set(normTitle(finalTitle), durMin);

    // Izrada opisa s izvorom
    const sourceFolder = path.dirname(winner.rel);
    const sourceNote = `Izvor: ${sourceFolder === '.' ? 'Lokalna baza' : sourceFolder}${winner.author ? ` · Autor: ${winner.author}` : ''}`;
    const description = [winner.description, sourceNote].filter(Boolean).join('\n\n').slice(0, 4000);

    Object.assign(winner.row, {
      status: 'NOVI',
      title: sanitize(finalTitle),
      category: winner.category,
      difficulty: winner.difficulty,
      duration_min: durMin,
      steps: winner.steps.map(st => ({ ...st, name: sanitize(st.name || "") })).length,
      reason: group.length > 1 ? `Izabrano iz ${group.length} varijanti (ZWO/ERG)` : ''
    });
    reportRows.push(winner.row);

    toInsert.push({
      title: finalTitle,
      description,
      duration_seconds: winner.totalDur,
      difficulty_score: winner.difficulty,
      category: winner.category,
      steps: winner.steps
    });
  }

  // SAŽETAK
  const countStatus = (s) => reportRows.filter(r => r.status === s).length;
  console.log('\n=================== SAŽETAK ===================');
  console.log(`Novih za uvoz:        ${toInsert.length}`);
  console.log(`Duplikata:            ${countStatus('DUPLIKAT')}`);
  console.log(`Preskočeno:           ${countStatus('PRESKOČENO')}`);
  console.log(`Greške:               ${countStatus('GREŠKA')}`);

  const byCat = {};
  toInsert.forEach(w => { byCat[w.category] = (byCat[w.category] || 0) + 1; });
  console.log('\nRaspodjela novih treninga po zonama:');
  const catOrder = ['Oporavak', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobni', 'Testiranje'];
  for (const c of catOrder) {
    if (byCat[c]) {
      console.log(`  ${c.padEnd(14)} ${String(byCat[c]).padStart(5)} treninga`);
    }
  }

  // Spremanje CSV izvještaja
  const reportDir = path.join(__dirname, 'import-reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const cols = ['status', 'title', 'category', 'difficulty', 'duration_min', 'steps', 'reason', 'file'];
  const csv = '\uFEFF' + [cols.join(';'), ...reportRows.map(r => cols.map(c => csvEscape(r[c])).join(';'))].join('\n');
  const csvPath = path.join(reportDir, `import-${COMMIT ? 'commit' : 'dryrun'}-${stamp}.csv`);
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`\n📄 Detaljan CSV izvještaj spremljen u:\n   ${csvPath}`);

  if (!COMMIT) {
    console.log('\n💡 Ovo je bio DRY RUN. Ništa nije zapisano u bazu.');
    console.log('   Za stvarni upis pokreni:');
    console.log('   npm run import:workouts:commit\n');
    return;
  }

  // STVARNI UPIS U BAZU S PRAĆENJEM ID-eva ZA ROLLBACK
  console.log(`\n💾 Započinjem upis ${toInsert.length} treninga u bazu (paketi po ${BATCH_SIZE})...`);
  const committedIds = [];
  let insertedCount = 0;
  const failed = [];

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from('workouts').insert(batch).select('id');
    if (!error && data) {
      data.forEach(r => committedIds.push(r.id));
      insertedCount += batch.length;
      process.stdout.write(`   Spremljeno: ${insertedCount}/${toInsert.length}\r`);
    } else {
      // Ako cijeli paket faila, ubacujemo jedan po jedan
      for (const w of batch) {
        const { data: d1, error: e1 } = await supabase.from('workouts').insert([w]).select('id');
        if (!e1 && d1?.[0]) {
          committedIds.push(d1[0].id);
          insertedCount++;
        } else {
          failed.push({ title: w.title, error: e1?.message || error?.message });
        }
      }
    }
  }

  console.log(`\n\n🎉 USPJEŠNO UPISANO: ${insertedCount} novih treninga u Supabase!`);
  if (failed.length) {
    console.log(`⚠️ Nije uspjelo: ${failed.length}`);
  }

  // Zapis manifesta za Rollback
  const manifestPath = path.join(reportDir, `import-committed-${stamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalInserted: committedIds.length,
    ids: committedIds,
    failed
  }, null, 2), 'utf8');
  console.log(`🛡️ Sigurnosni manifest spremljen u:\n   ${manifestPath}`);
  console.log('   Ako ikad poželiš povući ovaj uvoz, pokreni:');
  console.log(`   node scripts/import-local-workouts.mjs --rollback "${manifestPath}"\n`);
}

main().catch(err => {
  console.error('\n❌ Neočekivana greška:', err);
  process.exit(1);
});

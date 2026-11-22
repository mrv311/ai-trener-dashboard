#!/usr/bin/env node
/* global process */
/**
 * Generator i validator 100% originalnog ErgVibe Javnog Kataloga (~250 treninga)
 * bez ikakvih zaštićenih naziva ili kopiranih opisa trećih strana.
 *
 * Korištenje:
 *   node scripts/build-public-catalog.mjs
 *     -> Validira sve treninge kroz 1-Hz motor iz workoutParser.js i ispisuje statistiku
 *     -> Generira spremnu SQL skriptu: scripts/import-reports/public_catalog_migration.sql
 *
 *   node scripts/build-public-catalog.mjs --owner-uuid <DINOV-INTERVALS-UUID>
 *     -> U SQL skriptu odmah ubacuje tvoj UUID za prebacivanje postojećih ~1.500 treninga u privatne
 *
 *   node scripts/build-public-catalog.mjs --owner-intervals-id <INTERVALS-ID>
 *     -> U SQL skriptu ubacuje automatsko prepoznavanje tvog Supabase računa po Intervals.icu ID-ju
 *
 *   node scripts/build-public-catalog.mjs --commit --owner-uuid <UUID>
 *     -> Izvršava izravno u Supabaseu (zahtijeva SUPABASE_SERVICE_ROLE_KEY u .env / env)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  calculateCategoryDifficulty,
  categorizeWorkout,
  normalizeCategory
} from '../src/utils/workoutParser.js';
import {
  calculateCogganMetrics,
  expandStepsToSeconds
} from '../src/utils/performanceMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(__dirname, 'import-reports');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const ownerIdx = args.indexOf('--owner-uuid');
const OWNER_UUID = ownerIdx >= 0 ? String(args[ownerIdx + 1] || '').trim() : '';
const icuIdx = args.indexOf('--owner-intervals-id');
const OWNER_INTERVALS_ID = icuIdx >= 0 ? String(args[icuIdx + 1] || '').trim() : '';

// --- POMOĆNI GRADITELJI KORAKA ---

const step = (name, mins, power) => ({
  name,
  duration: Math.round(mins * 60),
  power: Math.round(power)
});

const stepSec = (name, secs, power) => ({
  name,
  duration: Math.round(secs),
  power: Math.round(power)
});

function warmup(mins = 10, startPct = 50, endPct = 72) {
  const count = Math.max(2, Math.min(5, Math.round(mins / 2)));
  const perStep = Math.round((mins * 60) / count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const pct = startPct + ((endPct - startPct) * i) / Math.max(1, count - 1);
    out.push({ name: 'Zagrijavanje', duration: perStep, power: Math.round(pct) });
  }
  return out;
}

function warmupWithOpeners(mins = 12) {
  const base = Math.max(4, mins - 4);
  return [
    ...warmup(base, 50, 68),
    stepSec('Aktivacija', 30, 95),
    stepSec('Lagano', 60, 55),
    stepSec('Aktivacija', 30, 108),
    stepSec('Priprema', 120, 58)
  ];
}

function cooldown(mins = 8, startPct = 62, endPct = 46) {
  const count = Math.max(2, Math.min(4, Math.round(mins / 2)));
  const perStep = Math.round((mins * 60) / count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const pct = startPct + ((endPct - startPct) * i) / Math.max(1, count - 1);
    out.push({ name: 'Hlađenje', duration: perStep, power: Math.round(pct) });
  }
  return out;
}

function repeatIntervals(reps, workMin, workPct, restMin, restPct, workLabel = 'Interval', restLabel = 'Oporavak', trailingRest = false) {
  const out = [];
  for (let i = 0; i < reps; i++) {
    out.push(step(workLabel, workMin, workPct));
    if (restMin > 0 && (i < reps - 1 || trailingRest)) {
      out.push(step(restLabel, restMin, restPct));
    }
  }
  return out;
}

function repeatMicroBlock(sets, repsPerSet, onSec, onPct, offSec, offPct, setRestMin, setRestPct = 52, onLabel = 'VO2 On', offLabel = 'Off') {
  const out = [];
  for (let s = 0; s < sets; s++) {
    for (let r = 0; r < repsPerSet; r++) {
      out.push(stepSec(onLabel, onSec, onPct));
      if (offSec > 0 && r < repsPerSet - 1) {
        out.push(stepSec(offLabel, offSec, offPct));
      }
    }
    if (s < sets - 1 && setRestMin > 0) {
      out.push(step('Oporavak između setova', setRestMin, setRestPct));
    }
  }
  return out;
}

function overUnderBlocks(sets, cyclesPerSet, underMin, underPct, overMin, overPct, restMin, restPct = 54) {
  const out = [];
  for (let s = 0; s < sets; s++) {
    for (let c = 0; c < cyclesPerSet; c++) {
      out.push(step(`Under ${underPct}%`, underMin, underPct));
      out.push(step(`Over ${overPct}%`, overMin, overPct));
    }
    if (s < sets - 1 && restMin > 0) {
      out.push(step('Z1 Oporavak', restMin, restPct));
    }
  }
  return out;
}

function steadyWithBursts(blocks, blockMin, basePct, burstEveryMin, burstSec, burstPct, restMin = 4, baseLabel = 'Baza', burstLabel = 'Ubrzanje') {
  const out = [];
  for (let b = 0; b < blocks; b++) {
    const segCount = Math.max(1, Math.floor(blockMin / burstEveryMin));
    const baseSec = Math.max(30, Math.round(burstEveryMin * 60 - burstSec));
    for (let k = 0; k < segCount; k++) {
      out.push(stepSec(baseLabel, baseSec, basePct));
      out.push(stepSec(burstLabel, burstSec, burstPct));
    }
    if (b < blocks - 1 && restMin > 0) {
      out.push(step('Oporavak', restMin, 55));
    }
  }
  return out;
}

// --- IZGRADNJA 250+ ORIGINALNIH ERGVIBE TRENINGA ---

function buildAllCatalogWorkouts() {
  const list = [];
  const add = (title, category, description, steps) => {
    list.push({ title: title.trim(), category, description: description.trim(), steps });
  };

  // =========================================================================
  // 1. OPORAVAK (Z1 · 20 treninga)
  // =========================================================================
  const recoverySpecs = [
    ['Easy Spin 25', 25, 48, 'Lagano 25-minutno razvrtavanje u Z1 zoni (48% FTP) za cirkulaciju bez zamora.'],
    ['Easy Spin 30', 30, 50, 'Kratki aktivni oporavak od 30 min na 50% FTP-a uz visoku kadencu (90+ rpm).'],
    ['Recovery Flush 35', 35, 52, 'Lagana 35-minutna vožnja za izbacivanje umora nakon teškog bloka.'],
    ['Active Recovery 40', 40, 50, '40 minuta mirnog okretanja u donjoj Z1 zoni bez ikakvog mišićnog stresa.'],
    ['Active Recovery 45', 45, 52, 'Standardni 45-minutni oporavak na 52% FTP-a za poticanje regeneracije.'],
    ['Coffee Spin 45', 45, 48, 'Vrlo lagano 45-minutno razvrtavanje (48% FTP) za dan nakon utrke ili teškog praga.'],
    ['Recovery Steady 50', 50, 53, '50 minuta ujednačenog oporavka u gornjoj Z1 zoni uz fokus na mekani okret.'],
    ['Active Recovery 60', 60, 52, 'Sat vremena čistog Z1 oporavka za održavanje navike okretanja bez umora.'],
    ['Light Flush 60', 60, 49, 'Ultra-lagani sat na 49% FTP-a kada su noge teške — čista cirkulacija.'],
    ['Recovery Cruise 75', 75, 52, 'Duže lagano razvrtavanje (75 min @ 52% FTP) za dan oporavka u većem volumenu.'],
  ];
  for (const [title, totalMin, pct, desc] of recoverySpecs) {
    add(title, 'Oporavak', desc, [
      ...warmup(5, 42, pct),
      step('Z1 Oporavak', totalMin - 10, pct),
      ...cooldown(5, pct, 42)
    ]);
  }

  // Recovery s laganim kadencnim vježbama / valovima / openerima
  add('Cadence Spin-Ups 30', 'Oporavak',
    '30 min lagane Z1 vožnje s 4×30s podizanja kadence (105–115 rpm) za neuromišićnu koordinaciju.',
    [...warmup(6, 45, 52), ...repeatIntervals(4, 0.5, 62, 4.5, 48, 'Visoka kadenca', 'Z1 Oporavak', false), ...cooldown(6, 50, 42)]);
  add('Cadence Spin-Ups 45', 'Oporavak',
    '45 min aktivnog oporavka uz 6×30s laganih ubrzanja kadence za gladak okret pedala.',
    [...warmup(8, 45, 52), ...repeatIntervals(6, 0.5, 64, 4.5, 48, 'Visoka kadenca', 'Z1 Oporavak', false), ...cooldown(9, 50, 42)]);
  add('Single-Leg Drills 40', 'Oporavak',
    '40 min tehnike pedaliranja: 6×1 min rada jednom nogom u laganom otporu za simetriju potiska.',
    [...warmup(8, 44, 52), ...repeatIntervals(6, 1, 56, 3.5, 46, 'Tehnika jednom nogom', 'Lagano obje noge', false), ...cooldown(8, 48, 42)]);
  add('Recovery Waves 45', 'Oporavak',
    '45 min laganih valova između 46% i 56% FTP-a za razbijanje monotonije na trenažeru.',
    [...warmup(6, 44, 50), ...repeatIntervals(5, 4, 56, 3, 46, 'Gornji Z1', 'Donji Z1', false), ...cooldown(7, 50, 42)]);
  add('Recovery Waves 60', 'Oporavak',
    '60 min nježnih izmjena 48% i 56% FTP-a — održava fokus bez ulaska u Z2 opterećenje.',
    [...warmup(8, 44, 50), ...repeatIntervals(6, 4, 56, 3.5, 48, 'Gornji Z1', 'Donji Z1', false), ...cooldown(10, 50, 42)]);
  add('Pre-Ride Wakeup 30', 'Oporavak',
    'Kratka 30-minutna aktivacija nogu s 3×30s kratkim podizanjem na tempo/prag za dan prije utrke.',
    [...warmup(8, 45, 54), ...repeatIntervals(3, 0.5, 92, 4.5, 48, 'Lagani opener', 'Z1 Oporavak', false), ...cooldown(9, 50, 42)]);
  add('Race-Eve Openers 40', 'Oporavak',
    '40 min lagane vožnje uz 4×20s kratkih aktivacija (110% FTP) — budi noge bez pražnjenja glikogena.',
    [...warmup(10, 45, 55), ...repeatIntervals(4, 1 / 3, 110, 4.5, 48, 'Kratki opener', 'Z1 Oporavak', false), ...cooldown(10, 50, 42)]);
  add('Post-Race Flush 35', 'Oporavak',
    '35 min izrazito laganog hlađenja i izmjene 45–52% FTP-a za brži oporavak nakon utrke.',
    [...warmup(5, 42, 48), ...repeatIntervals(4, 3, 52, 3, 45, 'Lagani okret', 'Ultra lagano', false), ...cooldown(9, 46, 40)]);
  add('Morning Mobility Spin 30', 'Oporavak',
    'Jutarnje 30-minutno razgibavanje na trenažeru s postupnim dizanjem do 55% FTP-a.',
    [step('Lagani početak', 6, 44), step('Z1 Ritam', 10, 50), step('Gornji Z1', 8, 55), step('Hlađenje', 6, 44)]);
  add('Easy Taper Spin 50', 'Oporavak',
    '50 min smirene vožnje u taper tjednu uz 3 kratka 30s ubrzanja za održavanje tonusa.',
    [...warmup(10, 45, 52), step('Z1 Baza', 10, 52), ...repeatIntervals(3, 0.5, 95, 4.5, 48, 'Tonus aktivacija', 'Z1 Oporavak', false), step('Lagano', 8, 50), ...cooldown(9, 50, 42)]);

  // =========================================================================
  // 2. ENDURANCE (Z2 · 36 treninga)
  // =========================================================================
  const steadyZ2 = [
    ['Aerobic Base 45 (65%)', 45, 65, '45 min mirne aerobne baze (65% FTP) za izgradnju mitohondrija i kapilarizacije.'],
    ['Aerobic Base 45 (70%)', 45, 70, '45 min čvršće Z2 vožnje (70% FTP) idealne za radni dan s malo vremena.'],
    ['Endurance Steady 60 (65%)', 60, 65, 'Sat vremena ugodne donje Z2 zone (65% FTP) s niskim srčanim driftom.'],
    ['Endurance Steady 60 (70%)', 60, 70, 'Klasični 60-minutni Z2 trening na 70% FTP-a — temelj polariziranog modela.'],
    ['Endurance High-Z2 60 (74%)', 60, 74, '60 min na gornjoj granici izdržljivosti (74% FTP) za snažan aerobni podražaj.'],
    ['Aerobic Base 75 (68%)', 75, 68, '75 min kontinuirane Z2 vožnje (68% FTP) za razvoj metaboličke efikasnosti.'],
    ['Aerobic Base 75 (73%)', 75, 73, '75 min čvrste Z2 baze (73% FTP) za povećanje izdržljivosti bez ulaska u tempo.'],
    ['Endurance Classic 90 (68%)', 90, 68, '90 min prave aerobne baze (68% FTP) — odličan trening za praćenje Pw:HR decouplinga.'],
    ['Endurance Strong 90 (73%)', 90, 73, '90 min u gornjoj Z2 zoni (73% FTP) za ozbiljnu zimsku i proljetnu bazu.'],
    ['Long Base 105 (68%)', 105, 68, '105 min neprekinute Z2 vožnje na 68% FTP-a za izdržljivost na dugim rutama.'],
    ['Gran Fondo Base 120 (68%)', 120, 68, 'Dvosatna aerobna baza (68% FTP) — simulira dugi maratonski ritam uz niski zamor.'],
    ['Gran Fondo Strong 120 (72%)', 120, 72, '120 min stabilnog Z2 tempa (72% FTP) za razvoj oksidacije masti i izdržljivosti.'],
    ['Endurance Epic 150 (68%)', 150, 68, '2.5 sata čiste Z2 baze (68% FTP) za pripremu dugih Gran Fondo događaja.'],
    ['Endurance Marathon 180 (67%)', 180, 67, '3 sata maratonske aerobne baze (67% FTP) za maksimalnu izdržljivost i prehranu na biciklu.'],
  ];
  for (const [title, totalMin, pct, desc] of steadyZ2) {
    const wu = totalMin >= 90 ? 10 : 8;
    const cd = totalMin >= 90 ? 10 : 7;
    add(title, 'Endurance', desc, [
      ...warmup(wu, 50, pct),
      step(`Z2 Baza (${pct}%)`, totalMin - wu - cd, pct),
      ...cooldown(cd, pct - 4, 48)
    ]);
  }

  // Progresivni i valoviti Z2 treninzi
  const waveZ2 = [
    ['Endurance Waves 60', 60, 4, 6, 74, 4, 62, '60 min valovite Z2 vožnje (6m @ 74% / 4m @ 62%) za dinamičniju aerobnu bazu.'],
    ['Endurance Waves 75', 75, 5, 6, 75, 5, 63, '75 min izmjena gornjeg i donjeg Z2 (6m @ 75% / 5m @ 63%) protiv monotonije trenažera.'],
    ['Endurance Waves 90', 90, 6, 7, 74, 5, 63, '90 min strukturiranih Z2 valova (7m @ 74% / 5m @ 63%) s odličnom aerobnom gustoćom.'],
    ['Endurance Waves 120', 120, 8, 8, 74, 5, 62, 'Dvosatni Z2 valovi (8m @ 74% / 5m @ 62%) koji simuliraju blago valovitu cestu.'],
    ['FatMax Cruise 60', 60, 3, 12, 71, 3, 60, '60 min u FatMax zoni (3×12m @ 71% FTP) za maksimiziranje potrošnje masti.'],
    ['FatMax Cruise 90', 90, 4, 15, 71, 3, 60, '90 min u FatMax zoni (4×15m @ 71% FTP) za dugotrajnu štednju glikogena.'],
    ['Aerobic Ladder 60', 60, 3, 10, 72, 4, 62, '60 min strukturiranih Z2 blokova (3×10m @ 72%) s kratkim rasterećenjima.'],
    ['Aerobic Ladder 90', 90, 4, 14, 73, 4, 62, '90 min Z2 blokova (4×14m @ 73% FTP) za postupno podizanje aerobne izdržljivosti.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of waveZ2) {
    const core = reps * wMin + (reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.55);
    const cd = rem - wu;
    add(title, 'Endurance', desc, [
      ...warmup(wu, 50, 64),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, 'Gornji Z2', 'Donji Z2', false),
      ...cooldown(cd, 62, 48)
    ]);
  }

  // Z2 s ubrzanjima (Cadence / Neuromuscular bursts / Low-cadence torque)
  add('Endurance + Sprints 60', 'Endurance',
    '60 min Z2 baze (68% FTP) sa 6×15s kratkih ubrzanja na 120% FTP za aktivaciju brzih vlakana.',
    [...warmup(8, 50, 65), ...steadyWithBursts(2, 22, 68, 7, 15, 120, 3, 'Z2 Baza', '15s Ubrzanje'), ...cooldown(7, 62, 48)]);
  add('Endurance + Sprints 75', 'Endurance',
    '75 min aerobne baze (68% FTP) uz kratke 15s neuromišićne sprinteve svakih 8 minuta.',
    [...warmup(10, 50, 65), ...steadyWithBursts(2, 28, 68, 7, 15, 125, 4, 'Z2 Baza', '15s Sprint'), ...cooldown(7, 62, 48)]);
  add('Endurance + Sprints 90', 'Endurance',
    '90 min Z2 izdržljivosti s periodičnim 15s eksplozivnim ubrzanjima za očuvanje oštrine.',
    [...warmup(10, 50, 65), ...steadyWithBursts(3, 24, 68, 8, 15, 125, 3, 'Z2 Baza', '15s Sprint'), ...cooldown(8, 62, 48)]);
  add('Endurance + Torque 60', 'Endurance',
    '60 min Z2 baze s 4×4 min niskokadencnog (60–65 rpm) opterećenja na 75% FTP za mišićnu snagu.',
    [...warmup(10, 50, 64), ...repeatIntervals(4, 4, 75, 6, 64, 'Niska kadenca 65rpm', 'Z2 Baza', false), ...cooldown(10, 62, 48)]);
  add('Endurance + Torque 75', 'Endurance',
    '75 min izdržljivosti s 5×5 min brdskog okretanja (60–65 rpm @ 76% FTP) unutar Z2 vožnje.',
    [...warmup(10, 50, 64), ...repeatIntervals(5, 5, 76, 6, 65, 'Niska kadenca 65rpm', 'Z2 Baza', false), ...cooldown(10, 62, 48)]);
  add('Endurance + Torque 90', 'Endurance',
    '90 min Z2 baze s 6×5 min niskokadencnog penjanja (60 rpm @ 76% FTP) za snagu na dugim usponima.',
    [...warmup(10, 50, 64), ...repeatIntervals(6, 5, 76, 7, 65, 'Snaga 60rpm', 'Z2 Baza', false), ...cooldown(10, 62, 48)]);
  add('Progressive Z2 Build 60', 'Endurance',
    '60 min postupnog rasta kroz cijelu Z2 zonu (60% -> 66% -> 71% -> 75% FTP).',
    [...warmup(8, 48, 58), step('Z2 · 62%', 12, 62), step('Z2 · 67%', 12, 67), step('Z2 · 71%', 12, 71), step('Z2 · 75%', 10, 75), ...cooldown(6, 60, 48)]);
  add('Progressive Z2 Build 90', 'Endurance',
    '90 min progresivne baze od 62% do 75% FTP-a za uvježbavanje snažnog završetka duge vožnje.',
    [...warmup(10, 48, 58), step('Z2 · 62%', 18, 62), step('Z2 · 67%', 18, 67), step('Z2 · 71%', 18, 71), step('Z2 · 75%', 18, 75), ...cooldown(8, 62, 48)]);
  add('Endurance Tempo Touch 75', 'Endurance',
    '75 min Z2 vožnje s 3×6 min blagog ulaska u donji tempo (78% FTP) za simulaciju hupsera.',
    [...warmup(10, 50, 64), ...repeatIntervals(3, 6, 78, 12, 66, 'Blagi hupser', 'Z2 Baza', false), ...cooldown(11, 64, 48)]);
  add('Endurance Tempo Touch 90', 'Endurance',
    '90 min Z2 izdržljivosti uz 4×6 min blagih tempo dionica (79% FTP) bez ulaska u umor.',
    [...warmup(10, 50, 64), ...repeatIntervals(4, 6, 79, 12, 66, 'Blagi hupser', 'Z2 Baza', false), ...cooldown(10, 64, 48)]);
  add('Endurance Tempo Touch 120', 'Endurance',
    '120 min Gran Fondo baze s 4×8 min kontroliranih tempo brdašaca (79% FTP).',
    [...warmup(10, 50, 64), ...repeatIntervals(4, 8, 79, 18, 66, 'Tempo brdašce', 'Z2 Baza', false), ...cooldown(12, 64, 48)]);
  add('Aerobic Rhythm 45', 'Endurance',
    'Brzih 45 min dinamične Z2 baze (63% / 73% izmjene) kad trebaš čisti aerobni volumen.',
    [...warmup(6, 48, 60), ...repeatIntervals(4, 5, 73, 3, 63, 'Gornji Z2', 'Donji Z2', false), ...cooldown(7, 60, 46)]);
  add('Endurance Cadence Focus 60', 'Endurance',
    '60 min Z2 baze (69% FTP) s izmjenama kadence 85 rpm i 98 rpm za ekonomičnost pedaliranja.',
    [...warmup(8, 48, 62), ...repeatIntervals(5, 4, 71, 4, 67, 'Kadenca 98rpm', 'Kadenca 85rpm', false), ...cooldown(8, 62, 46)]);
  add('Endurance Fast-Finish 75', 'Endurance',
    '75 min stabilne Z2 baze (67% FTP) s posljednjih 12 min na čvrstih 76% FTP na umornim nogama.',
    [...warmup(8, 50, 64), step('Z2 Baza', 47, 67), step('Završnica 76%', 12, 76), ...cooldown(8, 62, 48)]);

  // =========================================================================
  // 3. TEMPO (Z3 · 32 treninga)
  // =========================================================================
  const tempoBlocks = [
    ['Tempo Starter 45 (3×8m)', 45, 3, 8, 80, 3, 58, 'Uvodni 45-minutni tempo (3×8m @ 80% FTP) za razvoj mišićne izdržljivosti.'],
    ['Tempo Foundation 45 (2×12m)', 45, 2, 12, 82, 4, 58, 'Kratki 45-minutni blok (2×12m @ 82% FTP) — odličan omjer rada i vremena.'],
    ['Tempo Steady 45 (1×28m)', 45, 1, 28, 81, 0, 58, '28 minuta kontinuiranog tempa (81% FTP) za čvrst aerobni ritam.'],
    ['Tempo Classic 60 (3×12m)', 60, 3, 12, 82, 3, 58, '3×12 min @ 82% FTP — klasičan Z3 tempo s kratkim pauzama od 3 minute.'],
    ['Tempo Classic 60 (2×18m)', 60, 2, 18, 83, 5, 58, '2×18 min @ 83% FTP za dugotrajni pritisak na pedale bez laktatnog skoka.'],
    ['Tempo Steady 60 (1×40m)', 60, 1, 40, 80, 0, 58, '40 minuta neprekinutog Z3 tempa (80% FTP) — savršeno za ravničarsku vožnju.'],
    ['Tempo High 60 (3×12m @ 85%)', 60, 3, 12, 85, 4, 58, '3×12 min u gornjem tempu (85% FTP) — most prema Sweet Spot zoni.'],
    ['Tempo Endurance 75 (3×16m)', 75, 3, 16, 82, 4, 58, '75 min s 3×16 min @ 82% FTP za jačanje izdržljivosti na brzim grupnim vožnjama.'],
    ['Tempo Endurance 75 (2×25m)', 75, 2, 25, 82, 6, 58, '2×25 min stabilnog tempa (82% FTP) za razvoj otpornosti mišića na umor.'],
    ['Tempo Steady 75 (1×55m)', 75, 1, 55, 81, 0, 58, '55 minuta kontinuiranog Z3 tempa (81% FTP) za maratonsku postojanost.'],
    ['Tempo High 75 (3×15m @ 85%)', 75, 3, 15, 85, 5, 58, '3×15 min gornjeg tempa (85% FTP) — visok aerobni stres uz nizak zamor.'],
    ['Tempo Long 90 (3×20m)', 90, 3, 20, 82, 5, 58, 'Klasičnih 3×20 min @ 82% FTP (60 min u Z3) za pravu Gran Fondo izdržljivost.'],
    ['Tempo Long 90 (2×30m)', 90, 2, 30, 82, 8, 58, '2×30 min kontinuiranog tempa (82% FTP) — mentalna i mišićna čvrstoća.'],
    ['Tempo High 90 (3×20m @ 85%)', 90, 3, 20, 85, 5, 58, '3×20 min na gornjem rubu Z3 (85% FTP) — snažna priprema za duge uspone.'],
    ['Tempo Steady 90 (1×70m)', 90, 1, 70, 80, 0, 58, '70 minuta bez prekida na 80% FTP-a — čisti dizel za ravnice i blage uspone.'],
    ['Tempo Marathon 105 (4×18m)', 105, 4, 18, 82, 4, 58, '4×18 min @ 82% FTP (72 min tempa) za visoku tjednu aerobnu bazu.'],
    ['Tempo Marathon 120 (3×25m)', 120, 3, 25, 82, 8, 60, 'Dvosatni tempo blok (3×25m @ 82% FTP) idealan za pripremu maratona.'],
    ['Tempo Epic 120 (2×40m)', 120, 2, 40, 81, 10, 62, '2×40 min @ 81% FTP — ozbiljan maratonski blok za vrhunsku aerobnu izdržljivost.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of tempoBlocks) {
    const core = reps * wMin + Math.max(0, reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.55);
    const cd = rem - wu;
    add(title, 'Tempo', desc, [
      ...warmup(wu, 50, 70),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, `Tempo ${wPct}%`, 'Z1/Z2 Oporavak', false),
      ...cooldown(cd, 64, 48)
    ]);
  }

  // Tempo varijacije (Criss-Cross, Bursts, Torque, Pyramid, Rolling Hills)
  add('Tempo Criss-Cross 60', 'Tempo',
    '60 min bez stajanja: izmjene 4m @ 84% i 3m @ 72% FTP — simulira dinamičan ritam grupe.',
    [...warmup(8, 50, 68), ...repeatIntervals(6, 4, 84, 3, 72, 'Tempo 84%', 'Z2 72%', false), ...cooldown(10, 62, 48)]);
  add('Tempo Criss-Cross 75', 'Tempo',
    '75 min dinamičnih izmjena 5m @ 85% i 3m @ 72% FTP bez potpunog odmora.',
    [...warmup(10, 50, 68), ...repeatIntervals(7, 5, 85, 3, 72, 'Tempo 85%', 'Z2 72%', false), ...cooldown(9, 62, 48)]);
  add('Tempo Criss-Cross 90', 'Tempo',
    '90 min ritmičnih izmjena 6m @ 85% i 4m @ 72% FTP za stabilnu snagu u promjenjivom ritmu.',
    [...warmup(10, 50, 68), ...repeatIntervals(7, 6, 85, 4, 72, 'Tempo 85%', 'Z2 72%', false), ...cooldown(10, 62, 48)]);
  add('Tempo + Bursts 60', 'Tempo',
    '2×18 min @ 81% FTP uz 15s ubrzanja na 115% svake 4 minute — simulira ubrzanja iz zavoja.',
    [...warmup(10, 50, 68), ...steadyWithBursts(2, 16, 81, 4, 15, 115, 6, 'Tempo 81%', '15s Skok'), ...cooldown(10, 62, 48)]);
  add('Tempo + Bursts 75', 'Tempo',
    '3×16 min @ 82% FTP uz redovite 15s napade na 118% FTP za održavanje brzine u pelotonu.',
    [...warmup(10, 50, 68), ...steadyWithBursts(3, 16, 82, 4, 15, 118, 4, 'Tempo 82%', '15s Skok'), ...cooldown(9, 62, 48)]);
  add('Tempo + Bursts 90', 'Tempo',
    '3×20 min @ 82% FTP uz 20s skokove na 115% svakih 5 minuta za utrčnu izdržljivost.',
    [...warmup(10, 50, 68), ...steadyWithBursts(3, 20, 82, 5, 20, 115, 5, 'Tempo 82%', '20s Skok'), ...cooldown(10, 62, 48)]);
  add('Tempo Torque Climb 60', 'Tempo',
    '4×10 min @ 83% FTP uz nisku kadencu (60–65 rpm) — gradi specifičnu snagu za strme uspone.',
    [...warmup(8, 50, 68), ...repeatIntervals(4, 10, 83, 3, 58, 'Uspon 60-65rpm', 'Oporavak', false), ...cooldown(6, 62, 48)]);
  add('Tempo Torque Climb 75', 'Tempo',
    '4×12 min @ 84% FTP s niskom kadencom (60–65 rpm) za čvrst potisak na brdima.',
    [...warmup(10, 50, 68), ...repeatIntervals(4, 12, 84, 4, 58, 'Uspon 60-65rpm', 'Oporavak', false), ...cooldown(9, 62, 48)]);
  add('Tempo Torque Climb 90', 'Tempo',
    '5×12 min @ 84% FTP s niskom kadencom — napredni trening snage za duge planinske uspone.',
    [...warmup(10, 50, 68), ...repeatIntervals(5, 12, 84, 4, 58, 'Uspon 60-65rpm', 'Oporavak', false), ...cooldown(8, 62, 48)]);
  add('Tempo Pyramid 60', 'Tempo',
    'Piramida tempa: 6m / 10m / 14m / 10m @ 80–85% FTP s kratkim 2-minutnim pauzama.',
    [...warmup(8, 50, 68), step('Tempo 80%', 6, 80), step('Oporavak', 2, 58), step('Tempo 83%', 10, 83), step('Oporavak', 2, 58), step('Tempo 85%', 14, 85), step('Oporavak', 2, 58), step('Tempo 82%', 10, 82), ...cooldown(6, 62, 48)]);
  add('Tempo Pyramid 75', 'Tempo',
    '75-minutna piramida: 8m / 12m / 16m / 12m @ 81–86% FTP za progresivni aerobni rad.',
    [...warmup(9, 50, 68), step('Tempo 81%', 8, 81), step('Oporavak', 3, 58), step('Tempo 84%', 12, 84), step('Oporavak', 3, 58), step('Tempo 86%', 16, 86), step('Oporavak', 3, 58), step('Tempo 82%', 12, 82), ...cooldown(9, 62, 48)]);
  add('Rolling Hills Tempo 60', 'Tempo',
    'Simulacija valovitog terena: 4 kruga izmjene 5m @ 76% + 4m @ 86% + 2m @ 62% FTP.',
    [...warmup(8, 50, 66), ...Array.from({ length: 4 }, () => [step('Valjak 76%', 5, 76), step('Brdo 86%', 4, 86), step('Spust 62%', 2, 62)]).flat(), ...cooldown(8, 60, 48)]);
  add('Rolling Hills Tempo 90', 'Tempo',
    '90 min simulacije valovite utrke: 6 krugova izmjena 5m @ 75% + 5m @ 86% + 2m @ 60% FTP.',
    [...warmup(10, 50, 66), ...Array.from({ length: 6 }, () => [step('Valjak 75%', 5, 75), step('Brdo 86%', 5, 86), step('Spust 60%', 2, 60)]).flat(), ...cooldown(8, 60, 48)]);
  add('Tempo + Z2 Finisher 90', 'Tempo',
    '2×20 min @ 84% FTP nakon čega slijedi 25 min čiste Z2 vožnje na umornim nogama.',
    [...warmup(10, 50, 68), step('Tempo 84%', 20, 84), step('Oporavak', 5, 58), step('Tempo 84%', 20, 84), step('Z2 Završnica', 27, 70), ...cooldown(8, 62, 48)]);

  // =========================================================================
  // 4. SWEET SPOT (SS 88–94% · 44 treninga)
  // =========================================================================
  const ssClassic = [
    ['Sweet Spot Intro 45 (3×8m)', 45, 3, 8, 88, 3, 55, 'Uvodni 45-minutni Sweet Spot (3×8m @ 88% FTP) — maksimalan učinak u kratkom vremenu.'],
    ['Sweet Spot Quick 45 (2×12m)', 45, 2, 12, 90, 4, 55, 'Brzih 2×12 min @ 90% FTP — idealno kad imaš samo 45 minuta na trenažeru.'],
    ['Sweet Spot Quick 45 (3×9m @ 91%)', 45, 3, 9, 91, 2.5, 55, 'Kratki, gusto složeni 3×9 min @ 91% FTP za zaposlene vozače.'],
    ['Sweet Spot Foundation 60 (4×8m)', 60, 4, 8, 89, 3, 55, '4×8 min @ 89% FTP — odličan početak Sweet Spot progresije (32 min rada).'],
    ['Sweet Spot Classic 60 (3×10m)', 60, 3, 10, 90, 4, 55, 'Klasičnih 3×10 min @ 90% FTP — zlatni standard za izgradnju FTP-a bez pretjeranog umora.'],
    ['Sweet Spot Classic 60 (3×12m)', 60, 3, 12, 90, 3, 55, '3×12 min @ 90% FTP (36 min rada) — jedan od najučinkovitijih 60-minutnih treninga.'],
    ['Sweet Spot Classic 60 (2×15m)', 60, 2, 15, 91, 5, 55, '2×15 min @ 91% FTP za produžavanje vremena u gornjoj aerobnoj zoni.'],
    ['Sweet Spot High 60 (3×12m @ 93%)', 60, 3, 12, 93, 4, 55, '3×12 min u gornjem Sweet Spotu (93% FTP) — tik ispod praga.'],
    ['Sweet Spot Classic 60 (2×20m @ 89%)', 60, 2, 20, 89, 5, 55, '40 minuta Sweet Spota unutar jednog sata (2×20m @ 89% FTP).'],
    ['Sweet Spot Continuous 60 (1×35m)', 60, 1, 35, 89, 0, 55, '35 minuta kontinuiranog Sweet Spota (89% FTP) bez prekida — čista izdržljivost snage.'],
    ['Sweet Spot 75 (4×10m)', 75, 4, 10, 90, 4, 55, '4×10 min @ 90% FTP (40 min Sweet Spota) s udobnim oporavkom između blokova.'],
    ['Sweet Spot Classic 75 (3×15m)', 75, 3, 15, 90, 4, 55, 'Legendarni 3×15 min @ 90% FTP (45 min rada) — kamen temeljac baze i praga.'],
    ['Sweet Spot High 75 (3×15m @ 93%)', 75, 3, 15, 93, 5, 55, 'Napredni 3×15 min na 93% FTP-a za probijanje platoa izdržljivosti.'],
    ['Sweet Spot Classic 75 (2×20m @ 91%)', 75, 2, 20, 91, 6, 55, '2×20 min @ 91% FTP — duži blokovi za podizanje vremena do iscrpljenosti (TTE).'],
    ['Sweet Spot Build 75 (4×12m)', 75, 4, 12, 90, 3, 55, '4×12 min @ 90% FTP (48 min rada) s kratkim 3-minutnim pauzama.'],
    ['Sweet Spot Steady 75 (1×45m)', 75, 1, 45, 89, 0, 55, '45 minuta neprekinutog Sweet Spota (89% FTP) — simulira dugi alpski uspon.'],
    ['Sweet Spot Pro 90 (4×15m)', 90, 4, 15, 90, 4, 55, '60 minuta čistog Sweet Spota u 4×15 min blokovima @ 90% FTP.'],
    ['Sweet Spot Classic 90 (3×20m)', 90, 3, 20, 90, 5, 55, 'Kultnih 3×20 min @ 90% FTP — vrhunski trening za Gran Fondo i brdsku snagu.'],
    ['Sweet Spot High 90 (3×20m @ 92%)', 90, 3, 20, 92, 5, 55, '3×20 min na 92% FTP-a — ozbiljan volumen tik ispod laktatnog praga.'],
    ['Sweet Spot Extended 90 (2×25m)', 90, 2, 25, 91, 6, 55, '2×25 min @ 91% FTP — razvija sposobnost dugotrajnog držanja visokog ritma.'],
    ['Sweet Spot Extended 90 (2×30m)', 90, 2, 30, 89, 8, 55, '2×30 min @ 89% FTP (60 min rada) za mentalnu čvrstoću na dugim usponima.'],
    ['Sweet Spot Continuous 90 (1×60m)', 90, 1, 60, 89, 0, 55, 'Punih 60 minuta bez stajanja na 89% FTP-a — test izdržljivosti za napredne vozače.'],
    ['Sweet Spot Marathon 105 (4×18m)', 105, 4, 18, 90, 4, 55, '72 minute Sweet Spota (4×18m @ 90% FTP) — elitna aerobna gustoća.'],
    ['Sweet Spot Marathon 105 (3×25m)', 105, 3, 25, 89, 6, 55, '3×25 min @ 89% FTP (75 min rada) za dugotrajnu snagu na 150+ km rutama.'],
    ['Sweet Spot Epic 120 (4×20m)', 120, 4, 20, 89, 5, 58, '80 minuta Sweet Spota (4×20m @ 89% FTP) — vrhunac zimskog i build volumena.'],
    ['Sweet Spot Epic 120 (3×30m @ 88%)', 120, 3, 30, 88, 6, 58, '90 minuta rada u 3×30 min @ 88% FTP — priprema za najteže maratone.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of ssClassic) {
    const core = reps * wMin + Math.max(0, reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.55);
    const cd = rem - wu;
    add(title, 'Sweet Spot', desc, [
      ...warmup(wu, 50, 74),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, `Sweet Spot ${wPct}%`, 'Z1 Oporavak', false),
      ...cooldown(cd, 64, 48)
    ]);
  }

  // Sweet Spot varijacije (Bursts, Criss-Cross, Pyramids, Over-Tempo, Torque, +Z2 Finisher)
  add('Sweet Spot + Bursts 60 (3×12m)', 'Sweet Spot',
    '3×12 min @ 89% FTP s 15s ubrzanjima na 120% svake 3 minute — dinamičan Sweet Spot.',
    [...warmup(9, 50, 74), ...steadyWithBursts(3, 12, 89, 3, 15, 120, 4, 'Sweet Spot 89%', '15s Skok'), ...cooldown(7, 62, 48)]);
  add('Sweet Spot + Bursts 75 (3×15m)', 'Sweet Spot',
    '3×15 min @ 89% FTP s 20s skokovima na 118% svakih 5 minuta za utrčnu spremnost.',
    [...warmup(10, 50, 74), ...steadyWithBursts(3, 15, 89, 5, 20, 118, 5, 'Sweet Spot 89%', '20s Skok'), ...cooldown(10, 62, 48)]);
  add('Sweet Spot + Bursts 90 (3×20m)', 'Sweet Spot',
    '3×20 min @ 88% FTP uz 20s napade na 120% svakih 5 minuta — brutalna priprema za grupne vožnje.',
    [...warmup(10, 50, 74), ...steadyWithBursts(3, 20, 88, 5, 20, 120, 5, 'Sweet Spot 88%', '20s Napad'), ...cooldown(10, 62, 48)]);
  add('Sweet Spot Criss-Cross 60', 'Sweet Spot',
    '3×12 min izmjena 2m @ 93% i 2m @ 82% FTP bez pada u Z1 — uči tijelo čistiti laktat pod opterećenjem.',
    [...warmup(10, 50, 74), ...overUnderBlocks(3, 3, 2, 82, 2, 93, 4, 55), ...cooldown(6, 62, 48)]);
  add('Sweet Spot Criss-Cross 75', 'Sweet Spot',
    '3×16 min naizmjeničnih 2m @ 82% i 2m @ 94% FTP za snažan aerobni klirens.',
    [...warmup(10, 50, 74), ...overUnderBlocks(3, 4, 2, 82, 2, 94, 5, 55), ...cooldown(7, 62, 48)]);
  add('Sweet Spot Criss-Cross 90', 'Sweet Spot',
    '3×20 min neprekidnih izmjena 3m @ 83% i 2m @ 94% FTP — vrhunski Gran Fondo trening.',
    [...warmup(10, 50, 74), ...overUnderBlocks(3, 4, 3, 83, 2, 94, 5, 55), ...cooldown(10, 62, 48)]);
  add('Sweet Spot Pyramid 60', 'Sweet Spot',
    'Piramida 6m / 10m / 12m / 10m @ 88–93% FTP s kratkim 2.5 min pauzama.',
    [...warmup(8, 50, 74), step('SS 88%', 6, 88), step('Oporavak', 2.5, 55), step('SS 90%', 10, 90), step('Oporavak', 2.5, 55), step('SS 93%', 12, 93), step('Oporavak', 2.5, 55), step('SS 90%', 10, 90), ...cooldown(6.5, 62, 48)]);
  add('Sweet Spot Pyramid 75', 'Sweet Spot',
    'Piramida 8m / 12m / 16m / 12m @ 88–93% FTP (48 min rada) za postupno podizanje intenziteta.',
    [...warmup(9, 50, 74), step('SS 88%', 8, 88), step('Oporavak', 3, 55), step('SS 91%', 12, 91), step('Oporavak', 3, 55), step('SS 93%', 16, 93), step('Oporavak', 3, 55), step('SS 90%', 12, 90), ...cooldown(9, 62, 48)]);
  add('Sweet Spot Pyramid 90', 'Sweet Spot',
    'Velika piramida 10m / 15m / 20m / 15m @ 88–93% FTP (60 min rada).',
    [...warmup(10, 50, 74), step('SS 88%', 10, 88), step('Oporavak', 4, 55), step('SS 91%', 15, 91), step('Oporavak', 4, 55), step('SS 93%', 20, 93), step('Oporavak', 4, 55), step('SS 90%', 15, 90), ...cooldown(8, 62, 48)]);
  add('Sweet Spot Climb 60 (Torque)', 'Sweet Spot',
    '3×12 min @ 89% FTP uz nisku kadencu (65–70 rpm) za snagu na dugačkim usponima.',
    [...warmup(10, 50, 72), ...repeatIntervals(3, 12, 89, 4, 55, 'Brdski SS 65-70rpm', 'Oporavak', false), ...cooldown(6, 62, 48)]);
  add('Sweet Spot Climb 75 (Torque)', 'Sweet Spot',
    '3×15 min @ 90% FTP na nižoj kadenci (65–70 rpm) za ekonomičnost penjanja.',
    [...warmup(10, 50, 72), ...repeatIntervals(3, 15, 90, 5, 55, 'Brdski SS 65-70rpm', 'Oporavak', false), ...cooldown(10, 62, 48)]);
  add('Sweet Spot Step-Up 60', 'Sweet Spot',
    '3×12 min progresivnog bloka: svake 4 minute diže se 88% -> 91% -> 94% FTP.',
    [...warmup(9, 50, 72), ...Array.from({ length: 3 }, (_, i) => [step('SS 88%', 4, 88), step('SS 91%', 4, 91), step('SS 94%', 4, 94), ...(i < 2 ? [step('Oporavak', 4, 55)] : [])]).flat(), ...cooldown(7, 62, 48)]);
  add('Sweet Spot Step-Up 75', 'Sweet Spot',
    '3×15 min progresije unutar svakog bloka: 5m @ 88% -> 5m @ 91% -> 5m @ 94% FTP.',
    [...warmup(10, 50, 72), ...Array.from({ length: 3 }, (_, i) => [step('SS 88%', 5, 88), step('SS 91%', 5, 91), step('SS 94%', 5, 94), ...(i < 2 ? [step('Oporavak', 5, 55)] : [])]).flat(), ...cooldown(10, 62, 48)]);
  add('Sweet Spot + Z2 Base 90', 'Sweet Spot',
    '2×18 min @ 90% FTP + 30 min čiste Z2 vožnje na 70% FTP za spajanje snage i volumena.',
    [...warmup(10, 50, 72), step('SS 90%', 18, 90), step('Oporavak', 5, 55), step('SS 90%', 18, 90), step('Z2 Volumen', 31, 70), ...cooldown(8, 62, 48)]);
  add('Sweet Spot + Z2 Base 120', 'Sweet Spot',
    '3×15 min @ 90% FTP + 45 min Z2 izdržljivosti — idealan vikend trenažer trening.',
    [...warmup(10, 50, 72), ...repeatIntervals(3, 15, 90, 4, 55, 'Sweet Spot 90%', 'Oporavak', false), step('Z2 Volumen', 49, 70), ...cooldown(8, 62, 48)]);
  add('Sweet Spot Hard-Start 60', 'Sweet Spot',
    '3×12 min: prvih 90s na 108% FTP za brzo podizanje VO2, zatim 10.5 min na 90% FTP.',
    [...warmupWithOpeners(10), ...Array.from({ length: 3 }, (_, i) => [step('Brzi start 108%', 1.5, 108), step('Sweet Spot 90%', 10.5, 90), ...(i < 2 ? [step('Oporavak', 4, 55)] : [])]).flat(), ...cooldown(6, 62, 48)]);
  add('Sweet Spot Hard-Start 75', 'Sweet Spot',
    '3×15 min: 2 min na 106% FTP pa 13 min na 90% FTP — simulira ulazak u brdo s jakom grupom.',
    [...warmupWithOpeners(12), ...Array.from({ length: 3 }, (_, i) => [step('Brzi start 106%', 2, 106), step('Sweet Spot 90%', 13, 90), ...(i < 2 ? [step('Oporavak', 5, 55)] : [])]).flat(), ...cooldown(8, 62, 48)]);
  add('Sweet Spot Fast-Start 45', 'Sweet Spot',
    '2×14 min @ 91% FTP s kratkom 3-minutnom pauzom — maksimalni Sweet Spot u 45 minuta.',
    [...warmup(8, 50, 74), step('Sweet Spot 91%', 14, 91), step('Oporavak', 3, 55), step('Sweet Spot 91%', 14, 91), ...cooldown(6, 62, 48)]);

  // =========================================================================
  // 5. THRESHOLD (Z4 95–105% · 44 treninga)
  // =========================================================================
  const threshClassic = [
    ['Threshold Quick 45 (3×6m)', 45, 3, 6, 98, 3, 54, 'Brzi 45-minutni prag (3×6m @ 98% FTP) za održavanje FTP-a radnim danom.'],
    ['Threshold Quick 45 (3×8m @ 96%)', 45, 3, 8, 96, 3, 54, '3×8 min na 96% FTP-a — efikasan prag unutar 45 minuta.'],
    ['Threshold Quick 45 (2×10m @ 100%)', 45, 2, 10, 100, 4, 54, '2×10 min točno na 100% FTP-a za kratki, fokusirani trening praga.'],
    ['Threshold Intro 60 (4×6m @ 100%)', 60, 4, 6, 100, 3, 54, '4×6 min na 100% FTP-a — pristupačan uvod u rad na laktatnom pragu.'],
    ['Threshold Classic 60 (4×8m @ 98%)', 60, 4, 8, 98, 3, 54, '4×8 min @ 98% FTP (32 min praga) — provjeren recept za stabilan rast FTP-a.'],
    ['Threshold Classic 60 (3×10m @ 98%)', 60, 3, 10, 98, 4, 54, '3×10 min @ 98% FTP — temeljni 60-minutni trening praga.'],
    ['Threshold Classic 60 (3×10m @ 102%)', 60, 3, 10, 102, 5, 54, '3×10 min blago iznad praga (102% FTP) za pomicanje gornje granice FTP-a.'],
    ['Threshold Classic 60 (3×12m @ 97%)', 60, 3, 12, 97, 3, 54, '3×12 min @ 97% FTP (36 min rada) — visoka gustoća bez pucanja.'],
    ['Threshold Classic 60 (2×15m @ 99%)', 60, 2, 15, 99, 6, 54, '2×15 min na 99% FTP-a za produžavanje kontinuiranog držanja praga.'],
    ['Threshold Steady 60 (1×30m @ 97%)', 60, 1, 30, 97, 0, 54, '30 minuta kontinuirano na 97% FTP-a — simulacija brdskog kronometra.'],
    ['Threshold Classic 75 (4×10m @ 98%)', 75, 4, 10, 98, 4, 54, '4×10 min @ 98% FTP (40 min praga) za čvrstu nadogradnju FTP izdržljivosti.'],
    ['Threshold Classic 75 (3×12m @ 100%)', 75, 3, 12, 100, 5, 54, '3×12 min točno na 100% FTP-a s punim 5-minutnim oporavkom.'],
    ['Threshold Classic 75 (3×15m @ 97%)', 75, 3, 15, 97, 5, 54, '3×15 min @ 97% FTP (45 min rada) — zlatni trening za duge uspone.'],
    ['Threshold Classic 75 (2×20m @ 98%)', 75, 2, 20, 98, 8, 54, 'Kultni 2×20 min @ 98% FTP — najpoznatiji i najučinkovitiji trening za FTP u biciklizmu.'],
    ['Threshold Classic 75 (2×20m @ 100%)', 75, 2, 20, 100, 10, 54, 'Pravi 2×20 min na 100% FTP-a — ozbiljan test i poticaj za podizanje praga.'],
    ['Threshold Supra 75 (4×8m @ 104%)', 75, 4, 8, 104, 5, 54, '4×8 min suprathreshold (104% FTP) — gura laktatni prag prema gore.'],
    ['Threshold Pro 90 (3×15m @ 100%)', 90, 3, 15, 100, 6, 54, '3×15 min na punih 100% FTP-a (45 min rada) za napredne natjecatelje.'],
    ['Threshold Pro 90 (2×25m @ 97%)', 90, 2, 25, 97, 8, 54, '2×25 min @ 97% FTP (50 min praga) za maksimalni TTE (Time to Exhaustion).'],
    ['Threshold Pro 90 (3×20m @ 96%)', 90, 3, 20, 96, 6, 54, '3×20 min na 96% FTP-a (60 min praga) — vrhunac FTP bloka.'],
    ['Threshold TT 90 (1×40m @ 98%)', 90, 1, 40, 98, 0, 54, '40 minuta bez prekida na 98% FTP-a — čista kronometarska simulacija.'],
    ['Threshold Cruise 60 (5×6m @ 101%)', 60, 5, 6, 101, 2.5, 54, '5×6 min @ 101% FTP s kratkim 2.5 min pauzama za brzu toleranciju laktata.'],
    ['Threshold Cruise 75 (5×8m @ 99%)', 75, 5, 8, 99, 3, 54, '5×8 min @ 99% FTP (40 min praga) s kratkim odmorima za visoki aerobni ritam.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of threshClassic) {
    const core = reps * wMin + Math.max(0, reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.55);
    const cd = rem - wu;
    add(title, 'Threshold', desc, [
      ...warmupWithOpeners(Math.max(8, wu)),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, `Prag ${wPct}%`, 'Z1 Oporavak', false),
      ...cooldown(Math.max(5, cd), 62, 48)
    ]);
  }

  // Over-Unders (14 varijanti — srce Threshold treninga!)
  const ouSpecs = [
    ['Over-Under Quick 45 (2×9m · 95/105%)', 45, 2, 3, 2, 95, 1, 105, 5, 'Kratki 45-minutni Over-Under: 2×9 min izmjena 2m @ 95% i 1m @ 105% FTP.'],
    ['Over-Under Intro 60 (3×9m · 95/105%)', 60, 3, 3, 2, 95, 1, 105, 5, 'Uvodni Over-Under (3×9 min: 2m @ 95% / 1m @ 105%) za učenje klirensa laktata.'],
    ['Over-Under Classic 60 (3×12m · 95/105%)', 60, 3, 4, 2, 95, 1, 105, 4, 'Kultni 3×12 min Over-Under (2m @ 95% / 1m @ 105% FTP) — najbolji trening za klirens laktata.'],
    ['Over-Under Classic 60 (3×12m · 94/106%)', 60, 3, 3, 3, 94, 1, 106, 4, '3×12 min: 3m na 94% i 1m na 106% FTP — naglašen rad na čišćenju laktata.'],
    ['Over-Under Deep 60 (3×12m · 92/108%)', 60, 3, 3, 2, 92, 2, 108, 4, 'Agresivni Over-Under (2m @ 92% / 2m @ 108%) za visoku toleranciju promjena ritma.'],
    ['Over-Under Steep 60 (3×10m · 90/110%)', 60, 3, 5, 1, 90, 1, 110, 5, 'Brze 1m/1m izmjene 90% i 110% FTP — simulira strme valovite uspone i napade.'],
    ['Over-Under Classic 75 (3×15m · 95/105%)', 75, 3, 5, 2, 95, 1, 105, 5, '3×15 min (45 min ukupno) klasičnog Over-Undera 95/105% FTP.'],
    ['Over-Under Classic 75 (4×12m · 95/105%)', 75, 4, 4, 2, 95, 1, 105, 4, '4×12 min (48 min ukupno) Over-Undera za snažan napredak praga.'],
    ['Over-Under Long 75 (2×20m · 94/104%)', 75, 2, 5, 3, 94, 1, 104, 8, '2×20 min dugih Over-Under blokova (3m @ 94% / 1m @ 104% FTP).'],
    ['Over-Under Heavy 75 (3×12m · 95/108%)', 75, 3, 3, 2, 95, 2, 108, 6, 'Teški Over-Under s 2-minutnim skokovima na 108% i oporavkom na 95% FTP.'],
    ['Over-Under Pro 90 (4×15m · 95/105%)', 90, 4, 5, 2, 95, 1, 105, 5, '60 minuta čistog Over-Undera (4×15m @ 95/105%) za natjecateljsku formu.'],
    ['Over-Under Pro 90 (3×18m · 94/105%)', 90, 3, 3, 4, 94, 2, 105, 6, '3×18 min dugih 4m/2m izmjena 94% i 105% FTP — simulira borbu na dugim usponima.'],
    ['Over-Under Marathon 90 (2×24m · 93/105%)', 90, 2, 4, 4, 93, 2, 105, 10, '2×24 min maratonskog Over-Undera za iznimnu otpornost na dugim usponima.'],
    ['Over-Under Surge 60 (3×12m · 95/112%)', 60, 3, 4, 2.5, 95, 0.5, 112, 4, '3×12 min na 95% FTP uz 30s napade na 112% svakih 3 minute — utrčna dinamika.'],
  ];
  for (const [title, totalMin, sets, cycles, uMin, uPct, oMin, oPct, restMin, desc] of ouSpecs) {
    const core = sets * cycles * (uMin + oMin) + (sets - 1) * restMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.55);
    const cd = rem - wu;
    add(title, 'Threshold', desc, [
      ...warmupWithOpeners(Math.max(8, wu)),
      ...overUnderBlocks(sets, cycles, uMin, uPct, oMin, oPct, restMin, 54),
      ...cooldown(Math.max(5, cd), 62, 48)
    ]);
  }

  // Dodatne Threshold varijacije (Hard-Start, Pyramid, +Z2 Finisher, Race Openers)
  add('Threshold Hard-Start 60 (3×10m)', 'Threshold',
    '3×10 min: 90s na 115% FTP za brzi ulazak u visoku potrošnju kisika + 8.5 min na 97% FTP.',
    [...warmupWithOpeners(12), ...Array.from({ length: 3 }, (_, i) => [step('Hard Start 115%', 1.5, 115), step('Prag 97%', 8.5, 97), ...(i < 2 ? [step('Oporavak', 5, 54)] : [])]).flat(), ...cooldown(8, 62, 48)]);
  add('Threshold Hard-Start 75 (3×12m)', 'Threshold',
    '3×12 min: 2 min @ 114% pa 10 min @ 97% FTP — uči te držati prag odmah nakon napada.',
    [...warmupWithOpeners(12), ...Array.from({ length: 3 }, (_, i) => [step('Hard Start 114%', 2, 114), step('Prag 97%', 10, 97), ...(i < 2 ? [step('Oporavak', 6, 54)] : [])]).flat(), ...cooldown(9, 62, 48)]);
  add('Threshold Pyramid 60', 'Threshold',
    'Piramida praga: 5m / 8m / 10m / 8m @ 97–102% FTP s 3-minutnim oporavkom.',
    [...warmupWithOpeners(10), step('Prag 98%', 5, 98), step('Oporavak', 3, 54), step('Prag 100%', 8, 100), step('Oporavak', 3, 54), step('Prag 102%', 10, 102), step('Oporavak', 3, 54), step('Prag 98%', 8, 98), ...cooldown(10, 62, 48)]);
  add('Threshold Pyramid 75', 'Threshold',
    'Piramida 6m / 10m / 14m / 10m @ 97–101% FTP (40 min praga) za progresivno opterećenje.',
    [...warmupWithOpeners(12), step('Prag 98%', 6, 98), step('Oporavak', 4, 54), step('Prag 100%', 10, 100), step('Oporavak', 4, 54), step('Prag 101%', 14, 101), step('Oporavak', 4, 54), step('Prag 97%', 10, 97), ...cooldown(11, 62, 48)]);
  add('Threshold + Z2 Finisher 90', 'Threshold',
    '2×15 min @ 99% FTP + 35 min Z2 vožnje na 70% FTP za spajanje praga i izdržljivosti.',
    [...warmupWithOpeners(12), step('Prag 99%', 15, 99), step('Oporavak', 5, 54), step('Prag 99%', 15, 99), step('Z2 Završnica', 35, 70), ...cooldown(8, 62, 48)]);
  add('Threshold + Z2 Finisher 105', 'Threshold',
    '2×20 min @ 98% FTP + 40 min Z2 baze na umornim nogama — vrhunska Gran Fondo priprema.',
    [...warmupWithOpeners(12), step('Prag 98%', 20, 98), step('Oporavak', 6, 54), step('Prag 98%', 20, 98), step('Z2 Završnica', 39, 70), ...cooldown(8, 62, 48)]);
  add('Threshold Step-Up 60 (3×12m)', 'Threshold',
    '3×12 min s rastućom snagom: 4m @ 94% -> 4m @ 98% -> 4m @ 103% FTP.',
    [...warmupWithOpeners(10), ...Array.from({ length: 3 }, (_, i) => [step('94% FTP', 4, 94), step('98% FTP', 4, 98), step('103% FTP', 4, 103), ...(i < 2 ? [step('Oporavak', 4, 54)] : [])]).flat(), ...cooldown(6, 62, 48)]);
  add('Threshold Step-Up 75 (3×15m)', 'Threshold',
    '3×15 min negativnog splita: 5m @ 94% -> 5m @ 98% -> 5m @ 103% FTP.',
    [...warmupWithOpeners(12), ...Array.from({ length: 3 }, (_, i) => [step('94% FTP', 5, 94), step('98% FTP', 5, 98), step('103% FTP', 5, 103), ...(i < 2 ? [step('Oporavak', 5, 54)] : [])]).flat(), ...cooldown(8, 62, 48)]);

  // =========================================================================
  // 6. VO2 MAX (Z5 106–120% · 40 treninga)
  // =========================================================================
  const vo2Classic = [
    ['VO2 Max Quick 45 (5×2m @ 116%)', 45, 5, 2, 116, 2, 52, 'Kratki i oštri 5×2 min @ 116% FTP — idealan 45-minutni VO2 poticaj.'],
    ['VO2 Max Quick 45 (4×3m @ 114%)', 45, 4, 3, 114, 3, 52, '4×3 min @ 114% FTP unutar 45 minuta za brzo dizanje maksimalnog primitka kisika.'],
    ['VO2 Max Intro 60 (6×2m @ 118%)', 60, 6, 2, 118, 2.5, 52, '6×2 min na 118% FTP-a — odličan ulazak u VO2 Max blok.'],
    ['VO2 Max Classic 60 (5×3m @ 115%)', 60, 5, 3, 115, 3, 52, 'Klasičnih 5×3 min @ 115% FTP s 1:1 omjerom rada i oporavka.'],
    ['VO2 Max Classic 60 (6×3m @ 114%)', 60, 6, 3, 114, 3, 52, '6×3 min @ 114% FTP (18 min u Z5) — snažan aerobni strop.'],
    ['VO2 Max Classic 60 (4×4m @ 112%)', 60, 4, 4, 112, 4, 52, 'Norveški klasik 4×4 min @ 112% FTP — znanstveno potvrđen protokol za VO2 Max.'],
    ['VO2 Max Classic 60 (5×4m @ 112%)', 60, 5, 4, 112, 4, 52, 'Kultnih 5×4 min @ 112% FTP (20 min rada u Z5) — standard ozbiljnog VO2 treninga.'],
    ['VO2 Max Heavy 60 (5×4m @ 116%)', 60, 5, 4, 116, 4, 52, 'Napredni 5×4 min na 116% FTP-a — maksimalni stimulans za srčani minutni volumen.'],
    ['VO2 Max Classic 60 (4×5m @ 110%)', 60, 4, 5, 110, 4, 52, '4×5 min @ 110% FTP — dugi intervali za maksimalno vrijeme iznad 90% VO2 Maxa.'],
    ['VO2 Max Classic 60 (3×6m @ 108%)', 60, 3, 6, 108, 5, 52, '3×6 min na 108% FTP-a — gura aerobni strop i prag zajedno.'],
    ['VO2 Max Seiler 75 (4×8m @ 107%)', 75, 4, 8, 107, 4, 52, 'Seilerov 4×8 min @ 107% FTP — jedan od najučinkovitijih intervala u literaturi.'],
    ['VO2 Max Pro 75 (6×4m @ 113%)', 75, 6, 4, 113, 4, 52, '6×4 min @ 113% FTP (24 min u Z5) za probijanje fitness platoa.'],
    ['VO2 Max Pro 75 (5×5m @ 110%)', 75, 5, 5, 110, 5, 52, '5×5 min @ 110% FTP (25 min rada) — elitni VO2 Max blok.'],
    ['VO2 Max Pro 75 (7×3m @ 116%)', 75, 7, 3, 116, 3, 52, '7×3 min na 116% FTP-a — visok volumen snažnih 3-minutnih napada.'],
    ['VO2 Max Classic 75 (4×6m @ 108%)', 75, 4, 6, 108, 5, 52, '4×6 min @ 108% FTP (24 min rada) za izdržljivost na dugim strmim brdima.'],
    ['VO2 Max Sharp 60 (8×2m @ 118%)', 60, 8, 2, 118, 2, 52, '8×2 min @ 118% FTP — brzi ritam i visoki vrhovi kisika.'],
    ['VO2 Max Sharp 75 (10×2m @ 117%)', 75, 10, 2, 117, 2.5, 52, '10×2 min @ 117% FTP (20 min rada) — visoka intenzivnost uz svježinu.'],
    ['VO2 Max Short 45 (6×90s @ 120%)', 45, 6, 1.5, 120, 2, 52, '6×90 sekundi na 120% FTP-a — kratak i eksplozivan VO2 trening.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of vo2Classic) {
    const core = reps * wMin + Math.max(0, reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.58);
    const cd = rem - wu;
    add(title, 'VO2 Max', desc, [
      ...warmupWithOpeners(Math.max(8, wu)),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, `VO2 ${wPct}%`, 'Z1 Oporavak', false),
      ...cooldown(Math.max(5, cd), 60, 46)
    ]);
  }

  // Micro-intervals: Rønnestad 30/15s, 40/20s, Billat 30/30s (12 treninga)
  const microVo2 = [
    ['Rønnestad 30/15s Quick 45 (2×10)', 45, 2, 10, 30, 120, 15, 55, 5, 'Kratki Rønnestad protokol: 2 seta × 10×(30s @ 120% / 15s @ 55%) unutar 45 min.'],
    ['Rønnestad 30/15s Classic 60 (3×10)', 60, 3, 10, 30, 120, 15, 55, 5, '3 seta × 10×(30s @ 120% / 15s @ 55%) — drži potrošnju kisika na vrhu uz niži osjećaj boli.'],
    ['Rønnestad 30/15s Pro 60 (3×13)', 60, 3, 13, 30, 120, 15, 55, 4, 'Originalni Rønnestad 3×13×(30s/15s @ 120% FTP) — dokazani prvak za rast VO2 Maxa i FTP-a.'],
    ['Rønnestad 30/15s Heavy 75 (4×12)', 75, 4, 12, 30, 120, 15, 55, 5, '4 seta × 12×(30s/15s @ 120%) — napredni blok za natjecateljsku formu.'],
    ['Micro-VO2 40/20s Quick 45 (2×8)', 45, 2, 8, 40, 118, 20, 55, 5, 'Brzih 2×8×(40s @ 118% / 20s @ 55%) u 45 minuta.'],
    ['Micro-VO2 40/20s Classic 60 (3×8)', 60, 3, 8, 40, 118, 20, 55, 5, '3×8×(40s @ 118% / 20s @ 55%) — izvrstan za dinamiku kriterija i kratkih brda.'],
    ['Micro-VO2 40/20s Pro 60 (3×10)', 60, 3, 10, 40, 118, 20, 55, 5, '3×10×(40s @ 118% / 20s @ 55%) — punih 20 minuta na 118% FTP-a.'],
    ['Micro-VO2 40/20s Epic 75 (4×10)', 75, 4, 10, 40, 116, 20, 55, 5, '4×10×(40s @ 116% / 20s @ 55%) za vrhunsku aerobnu snagu.'],
    ['Billat 30/30s Quick 45 (2×10)', 45, 2, 10, 30, 120, 30, 55, 5, 'Billat 30/30s u 2 seta po 10 ponavljanja — pristupačan VO2 ulaz.'],
    ['Billat 30/30s Classic 60 (3×10)', 60, 3, 10, 30, 120, 30, 55, 5, 'Klasični Billat 3×10×(30s @ 120% / 30s @ 55%) za dug boravak blizu VO2 Maxa.'],
    ['Billat 30/30s Pro 75 (3×14)', 75, 3, 14, 30, 120, 30, 55, 6, '3×14×(30s @ 120% / 30s @ 55%) — visok ukupni VO2 volumen.'],
    ['Micro-VO2 20/10s 60 (4×10)', 60, 4, 10, 20, 122, 10, 55, 6, '4 seta brzih 20/10s mikropulsacija na 122% FTP za maksimalnu brzinu kisika.'],
  ];
  for (const [title, totalMin, sets, reps, onSec, onPct, offSec, offPct, setRestMin, desc] of microVo2) {
    const coreSec = sets * (reps * onSec + (reps - 1) * offSec) + (sets - 1) * setRestMin * 60;
    const remMin = Math.max(10, Math.round(totalMin - coreSec / 60));
    const wu = Math.round(remMin * 0.58);
    const cd = remMin - wu;
    add(title, 'VO2 Max', desc, [
      ...warmupWithOpeners(Math.max(8, wu)),
      ...repeatMicroBlock(sets, reps, onSec, onPct, offSec, offPct, setRestMin, 52),
      ...cooldown(Math.max(5, cd), 60, 46)
    ]);
  }

  // Hard-Start VO2max, Decreasing Pyramids & VO2 + Z2/SS Combos (10 treninga)
  add('VO2 Hard-Start 60 (4×4m)', 'VO2 Max',
    '4×4 min: 30s na 130% za nagli skok VO2 pa 3.5 min na 110% FTP — maksimizira vrijeme na vrhu kisika.',
    [...warmupWithOpeners(12), ...Array.from({ length: 4 }, (_, i) => [stepSec('Hard Start 130%', 30, 130), stepSec('VO2 110%', 210, 110), ...(i < 3 ? [step('Oporavak', 4, 52)] : [])]).flat(), ...cooldown(10, 60, 46)]);
  add('VO2 Hard-Start 60 (5×3.5m)', 'VO2 Max',
    '5×3.5 min: 45s @ 128% + 2m45s @ 112% FTP — brzo otvara aerobni kapacitet.',
    [...warmupWithOpeners(12), ...Array.from({ length: 5 }, (_, i) => [stepSec('Hard Start 128%', 45, 128), stepSec('VO2 112%', 165, 112), ...(i < 4 ? [step('Oporavak', 3.5, 52)] : [])]).flat(), ...cooldown(10, 60, 46)]);
  add('VO2 Hard-Start 75 (5×4m)', 'VO2 Max',
    '5×4 min s 45s ulazom na 128% pa 3m15s na 110% FTP — napredni protokol za natjecatelje.',
    [...warmupWithOpeners(12), ...Array.from({ length: 5 }, (_, i) => [stepSec('Hard Start 128%', 45, 128), stepSec('VO2 110%', 195, 110), ...(i < 4 ? [step('Oporavak', 4.5, 52)] : [])]).flat(), ...cooldown(11, 60, 46)]);
  add('VO2 Countdown 60 (5-4-3-2-1m)', 'VO2 Max',
    'Opadajući VO2 blok: 5m @ 109%, 4m @ 112%, 3m @ 115%, 2m @ 118%, 1m @ 125% — psihološki sjajan trening.',
    [...warmupWithOpeners(12), step('VO2 5m', 5, 109), step('Oporavak', 4, 52), step('VO2 4m', 4, 112), step('Oporavak', 4, 52), step('VO2 3m', 3, 115), step('Oporavak', 3, 52), step('VO2 2m', 2, 118), step('Oporavak', 2, 52), step('VO2 1m', 1, 125), ...cooldown(10, 60, 46)]);
  add('VO2 Double Countdown 75', 'VO2 Max',
    '2 kruga opadajuće piramide: 4m @ 112% / 3m @ 115% / 2m @ 118% / 1m @ 124% (20 min rada).',
    [...warmupWithOpeners(12), ...Array.from({ length: 2 }, (_, i) => [step('VO2 4m', 4, 112), step('Oporavak', 3, 52), step('VO2 3m', 3, 115), step('Oporavak', 3, 52), step('VO2 2m', 2, 118), step('Oporavak', 2, 52), step('VO2 1m', 1, 124), ...(i === 0 ? [step('Set Oporavak', 6, 52)] : [])]).flat(), ...cooldown(11, 60, 46)]);
  add('VO2 Pyramid 60 (2-3-4-3-2m)', 'VO2 Max',
    'Piramida VO2: 2m / 3m / 4m / 3m / 2m @ 112–118% FTP s uravnoteženim oporavkom.',
    [...warmupWithOpeners(12), step('VO2 2m', 2, 118), step('Oporavak', 2, 52), step('VO2 3m', 3, 115), step('Oporavak', 3, 52), step('VO2 4m', 4, 112), step('Oporavak', 4, 52), step('VO2 3m', 3, 115), step('Oporavak', 3, 52), step('VO2 2m', 2, 118), ...cooldown(10, 60, 46)]);
  add('VO2 + Z2 Endurance 75', 'VO2 Max',
    '4×3 min @ 115% FTP na svježim nogama + 30 min čiste Z2 baze za dvostruki aerobni efekt.',
    [...warmupWithOpeners(10), ...repeatIntervals(4, 3, 115, 3, 52, 'VO2 115%', 'Oporavak', false), step('Z2 Baza', 32, 70), ...cooldown(8, 60, 46)]);
  add('VO2 + Z2 Endurance 90', 'VO2 Max',
    '5×3 min @ 115% FTP nakon čega slijedi 40 min Z2 izdržljivosti (polarizirani klasik).',
    [...warmupWithOpeners(12), ...repeatIntervals(5, 3, 115, 3, 52, 'VO2 115%', 'Oporavak', false), step('Z2 Baza', 40, 70), ...cooldown(8, 60, 46)]);
  add('VO2 + Sweet Spot Combo 75', 'VO2 Max',
    '4×3 min @ 114% FTP + 2×12 min @ 89% FTP — uči te držati visoki tempo nakon teških napada.',
    [...warmupWithOpeners(10), ...repeatIntervals(4, 3, 114, 3, 52, 'VO2 114%', 'Oporavak', false), step('Oporavak', 4, 52), step('Sweet Spot 89%', 12, 89), step('Oporavak', 4, 54), step('Sweet Spot 89%', 12, 89), ...cooldown(8, 60, 46)]);
  add('VO2 Hill Attacks 60', 'VO2 Max',
    '6×2.5 min progresivnih brdskih napada (90s @ 112% -> 60s @ 122% FTP) s 3 min oporavka.',
    [...warmupWithOpeners(12), ...Array.from({ length: 6 }, (_, i) => [stepSec('Uspon 112%', 90, 112), stepSec('Vrh 122%', 60, 122), ...(i < 5 ? [step('Spust', 3, 52)] : [])]).flat(), ...cooldown(10, 60, 46)]);

  // =========================================================================
  // 7. ANAEROBNI (Z6 121–180% · 26 treninga)
  // =========================================================================
  const anaClassic = [
    ['Anaerobic Quick 45 (6×1m @ 130%)', 45, 6, 1, 130, 2.5, 50, '6×1 min na 130% FTP-a — kratak i žestok trening anaerobnog kapaciteta.'],
    ['Anaerobic Classic 60 (8×1m @ 130%)', 60, 8, 1, 130, 3, 50, '8×1 min @ 130% FTP s 3 min punog oporavka za rast W-prime kapaciteta.'],
    ['Anaerobic Classic 60 (10×1m @ 128%)', 60, 10, 1, 128, 2.5, 50, '10×1 min @ 128% FTP — iznimna tolerancija visokog laktata i ponovljivih napada.'],
    ['Anaerobic Power 60 (8×1m @ 138%)', 60, 8, 1, 138, 3.5, 50, '8×1 min na visokih 138% FTP-a za snažne kratke uspone i bijegove.'],
    ['Anaerobic Classic 60 (6×90s @ 126%)', 60, 6, 1.5, 126, 3.5, 50, '6×90 sekundi @ 126% FTP — idealno za puncheur napade na brdima od 1–2 min.'],
    ['Anaerobic Heavy 75 (8×90s @ 128%)', 75, 8, 1.5, 128, 4, 50, '8×90 sekundi na 128% FTP-a za vrhunski anaerobni kapacitet.'],
    ['Anaerobic Long 60 (5×2m @ 124%)', 60, 5, 2, 124, 4, 50, '5×2 min @ 124% FTP — na granici VO2 i Z6 za odlučujuće utrčne poteze.'],
    ['Anaerobic Repeats 45 (8×45s @ 140%)', 45, 8, 0.75, 140, 2.25, 50, '8×45s na 140% FTP-a u 45 minuta — oštra anaerobna snaga.'],
    ['Anaerobic Repeats 60 (10×45s @ 140%)', 60, 10, 0.75, 140, 2.5, 50, '10×45s @ 140% FTP za eksplozivna ubrzanja i zatvaranje rupa u grupi.'],
    ['Anaerobic Punch 60 (12×30s @ 150%)', 60, 12, 0.5, 150, 2.5, 50, '12×30 sekundi na 150% FTP-a — čista anaerobna snaga i ubrzanje.'],
    ['Anaerobic Punch 45 (10×30s @ 150%)', 45, 10, 0.5, 150, 2, 50, '10×30 sekundi na 150% FTP-a za brzi 45-minutni sprint/anaerobni podražaj.'],
    ['Anaerobic Sprints 45 (8×20s @ 165%)', 45, 8, 1 / 3, 165, 2.5, 50, '8×20s maksimalnih ubrzanja (165% FTP) uz potpun oporavak.'],
    ['Anaerobic Sprints 60 (10×20s @ 165%)', 60, 10, 1 / 3, 165, 3, 50, '10×20s na 165% FTP-a za razvoj vršne snage i brzog odgovora na napade.'],
    ['Neuromuscular Sprints 45 (8×15s @ 180%)', 45, 8, 0.25, 180, 2.5, 50, '8×15s sprinteva (180% FTP) za maksimalnu neuromišićnu regrutaciju.'],
    ['Neuromuscular Sprints 60 (12×15s @ 175%)', 60, 12, 0.25, 175, 2.75, 50, '12×15s eksplozivnih sprinteva s punim oporavkom između svakog pokušaja.'],
    ['Anaerobic Endurance 75 (12×1m @ 130%)', 75, 12, 1, 130, 3, 50, '12×1 min @ 130% FTP — ekstremno visok volumen anaerobnih intervala.'],
  ];
  for (const [title, totalMin, reps, wMin, wPct, rMin, rPct, desc] of anaClassic) {
    const core = reps * wMin + Math.max(0, reps - 1) * rMin;
    const rem = Math.max(10, totalMin - core);
    const wu = Math.round(rem * 0.58);
    const cd = rem - wu;
    add(title, 'Anaerobni', desc, [
      ...warmupWithOpeners(Math.max(8, wu)),
      ...repeatIntervals(reps, wMin, wPct, rMin, rPct, `Z6 ${wPct}%`, 'Z1 Oporavak', false),
      ...cooldown(Math.max(5, cd), 58, 45)
    ]);
  }

  // Tabata, Criterium & Breakaway simulacije (10 treninga)
  add('Tabata Classic 45 (2×8×20/10s)', 'Anaerobni',
    '2 seta pravog Tabata protokola: 8×(20s @ 145% / 10s @ 50%) s 8 min oporavka.',
    [...warmupWithOpeners(12), ...repeatMicroBlock(2, 8, 20, 145, 10, 50, 8, 50, 'Tabata 145%', 'Off'), ...cooldown(10, 56, 45)]);
  add('Tabata Pro 60 (3×8×20/10s)', 'Anaerobni',
    '3 seta klasične Tabate (20s @ 145% / 10s @ 50%) — brutalno podizanje anaerobne i VO2 snage.',
    [...warmupWithOpeners(12), ...repeatMicroBlock(3, 8, 20, 145, 10, 50, 8, 50, 'Tabata 145%', 'Off'), ...cooldown(10, 56, 45)]);
  add('Criterium Surges 60 (3×8×15/45s)', 'Anaerobni',
    'Simulacija kriterija: 3 seta × 8×(15s izlaz iz zavoja @ 160% / 45s u grupi @ 75% FTP).',
    [...warmupWithOpeners(12), ...repeatMicroBlock(3, 8, 15, 160, 45, 75, 5, 52, 'Zavoj 160%', 'Grupa 75%'), ...cooldown(9, 58, 45)]);
  add('Criterium Surges 75 (4×8×15/45s)', 'Anaerobni',
    '4 seta kriterijskih krugova (15s @ 160% / 45s @ 78% FTP) za ponovljivu utrčnu eksplozivnost.',
    [...warmupWithOpeners(12), ...repeatMicroBlock(4, 8, 15, 160, 45, 78, 5, 52, 'Zavoj 160%', 'Grupa 78%'), ...cooldown(10, 58, 45)]);
  add('Breakaway Simulator 60 (4×3m)', 'Anaerobni',
    '4× bijeg: 30s napad na 155% + 2m30s držanje tempa na 105% FTP — klasični scenarij odlaska u bijeg.',
    [...warmupWithOpeners(12), ...Array.from({ length: 4 }, (_, i) => [stepSec('Napad 155%', 30, 155), stepSec('Bijeg 105%', 150, 105), ...(i < 3 ? [step('Oporavak', 5, 52)] : [])]).flat(), ...cooldown(10, 58, 45)]);
  add('Breakaway Simulator 75 (5×3m)', 'Anaerobni',
    '5 ponavljanja bijega (30s @ 155% -> 2m30s @ 106% FTP) uz 5 min oporavka.',
    [...warmupWithOpeners(12), ...Array.from({ length: 5 }, (_, i) => [stepSec('Napad 155%', 30, 155), stepSec('Bijeg 106%', 150, 106), ...(i < 4 ? [step('Oporavak', 5, 52)] : [])]).flat(), ...cooldown(10, 58, 45)]);
  add('Anaerobic Micro 45 (2×8×30/30s @ 135%)', 'Anaerobni',
    '2 seta × 8×(30s @ 135% / 30s @ 50%) — snažan anaerobni ritam u 45 minuta.',
    [...warmupWithOpeners(11), ...repeatMicroBlock(2, 8, 30, 135, 30, 50, 6, 50, 'Z6 135%', 'Off'), ...cooldown(10, 56, 45)]);
  add('Anaerobic Micro 60 (3×8×30/30s @ 135%)', 'Anaerobni',
    '3 seta × 8×(30s @ 135% / 30s @ 50%) — razvija brzu obnovu između napada.',
    [...warmupWithOpeners(12), ...repeatMicroBlock(3, 8, 30, 135, 30, 50, 6, 50, 'Z6 135%', 'Off'), ...cooldown(10, 56, 45)]);
  add('Standing Start Sprints 50 (8×15s)', 'Anaerobni',
    '8×15s starteva iz niske brzine/kadence (170% FTP) s 3 min oporavka za sirovu snagu potiska.',
    [...warmupWithOpeners(12), ...repeatIntervals(8, 0.25, 170, 3, 50, 'Start iz mjesta 170%', 'Oporavak', false), ...cooldown(10, 56, 45)]);
  add('Sprint-to-Threshold 60 (4×5m)', 'Anaerobni',
    '4 bloka: 20s sprint @ 165% + 4m40s čvrsti prag @ 98% FTP — simulira sprint na brdo pa držanje ritma.',
    [...warmupWithOpeners(12), ...Array.from({ length: 4 }, (_, i) => [stepSec('Sprint 165%', 20, 165), stepSec('Prag 98%', 280, 98), ...(i < 3 ? [step('Oporavak', 5, 52)] : [])]).flat(), ...cooldown(10, 58, 45)]);

  // =========================================================================
  // 8. TESTIRANJE (Ramp & FTP Tests · 10 treninga)
  // =========================================================================
  // 1. Standard Ramp Test (5m warmup + 1m steps from 46% +6% per min up to 172% + 5m cooldown)
  const rampSteps = [step('Zagrijavanje', 5, 50)];
  for (let pct = 46; pct <= 172; pct += 6) {
    rampSteps.push(step(`Rampa ${pct}%`, 1, pct));
  }
  rampSteps.push(...cooldown(5, 52, 42));
  add('Ramp Test (Standard FTP)', 'Testiranje',
    'Standardni progresivni Ramp Test (+6% FTP svaku minutu do otkaza). Procjena FTP-a = 75% najbolje 1-minutne prosječne snage.',
    rampSteps);

  // 2. Classic 20-Minute FTP Test (Hunter Allen / Coggan)
  add('20-Min FTP Test (Standard Protocol)', 'Testiranje',
    'Klasični 20-minutni FTP protokol: zagrijavanje, 3×1m brze kadence, 5m maksimalnog pražnjenja (112%), 10m oporavka i 20m maksimalnog kronometra (FTP = 95% prosjeka).',
    [
      ...warmup(10, 50, 68),
      step('Kadenca 100rpm', 1, 95), step('Lagano', 1, 55),
      step('Kadenca 105rpm', 1, 98), step('Lagano', 1, 55),
      step('Kadenca 110rpm', 1, 100), step('Priprema', 3, 55),
      step('5m Pražnjenje', 5, 112),
      step('Oporavak prije testa', 10, 54),
      step('20m FTP Test (Max Steady)', 20, 105),
      ...cooldown(8, 56, 44)
    ]);

  // 3. 2x8-Minute FTP Test
  add('2×8-Min FTP Test', 'Testiranje',
    'Alternativni FTP test: 2×8 min maksimalnog ravnomjernog napora s 10 min oporavka (FTP ≈ 90% prosjeka oba bloka).',
    [
      ...warmupWithOpeners(12),
      step('8m Test Blok 1', 8, 108),
      step('Oporavak', 10, 52),
      step('8m Test Blok 2', 8, 108),
      ...cooldown(8, 56, 44)
    ]);

  // 4. 5-Minute MAP / VO2 Max Test
  add('5-Min MAP / VO2 Max Test', 'Testiranje',
    'Test maksimalne aerobne snage (MAP): 5 minuta najvišeg održivog napora nakon kvalitetnog zagrijavanja.',
    [
      ...warmupWithOpeners(15),
      step('5m MAP Test (Max)', 5, 120),
      ...cooldown(10, 56, 44)
    ]);

  // 5. 3-Minute Critical Power / W-Prime Test
  add('3-Min Critical Power (CP) Test', 'Testiranje',
    '3-minutni all-out test za procjenu kritične snage (CP) i anaerobne rezerve (W-prime).',
    [
      ...warmupWithOpeners(15),
      step('3m All-Out Test', 3, 132),
      ...cooldown(10, 54, 44)
    ]);

  // 6. 1-Minute Anaerobic Test
  add('1-Min Anaerobic Capacity Test', 'Testiranje',
    'Test 1-minutne maksimalne anaerobne snage s 15 min pripremnog zagrijavanja.',
    [
      ...warmupWithOpeners(15),
      step('1m Max Test', 1, 165),
      ...cooldown(10, 52, 42)
    ]);

  // 7. 12-Minute Aerobic Threshold / TTE Check
  add('12-Min Threshold Check', 'Testiranje',
    'Kratka 12-minutna provjera praga i pulsa na pragu (LTHR) u sredini trening bloka.',
    [
      ...warmupWithOpeners(12),
      step('12m Prag Test', 12, 104),
      ...cooldown(8, 56, 44)
    ]);

  // 8. Full Power Profile Test (15s · 1m · 5m)
  add('Power Profile Test (15s · 1m · 5m)', 'Testiranje',
    'Kompletan profil snage u jednoj sesiji: 15s sprint, 1 min anaerobno i 5 min VO2 Max s punim oporavkom.',
    [
      ...warmupWithOpeners(12),
      stepSec('15s Max Sprint', 15, 190),
      step('Puni oporavak', 6, 50),
      step('1m Max Test', 1, 160),
      step('Puni oporavak', 10, 50),
      step('5m Max Test', 5, 118),
      ...cooldown(10, 54, 44)
    ]);

  // 9. Sub-Max Step Calibration (LT1 / LT2)
  const subMaxSteps = [step('Zagrijavanje', 8, 50)];
  for (const pct of [60, 68, 76, 84, 92, 100]) {
    subMaxSteps.push(step(`Step ${pct}% FTP`, 5, pct));
  }
  subMaxSteps.push(...cooldown(7, 56, 44));
  add('Sub-Max Step Test (LT1 / LT2)', 'Testiranje',
    'Stepenasti test (6×5 min od 60% do 100% FTP) za praćenje odnosa snage i pulsa (EF / LT1 / LTHR).',
    subMaxSteps);

  // 10. Pre-Test Openers 35m
  add('Pre-Test Openers 35', 'Testiranje',
    '35-minutna aktivacija dan uoči FTP ili Ramp testa: 3×1 min na pragu i 3×15s sprinta.',
    [
      ...warmup(10, 48, 60),
      ...repeatIntervals(3, 1, 98, 2, 52, 'Opener prag', 'Lagano', false),
      step('Lagano', 3, 52),
      ...repeatIntervals(3, 0.25, 130, 1.75, 50, '15s Aktivacija', 'Lagano', false),
      ...cooldown(8, 52, 42)
    ]);

  return list;
}

function sqlQuote(str) {
  return `'${String(str ?? '').replace(/'/g, "''")}'`;
}

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

async function main() {
  const rawList = buildAllCatalogWorkouts();

  // Validacija: jedinstveni nazivi, bez zaštićenih pojmova, točna 1-Hz težina i kategorija
  const FORBIDDEN_RE = /trainerroad|zwift|fascat|sufferfest|trainsharp|wahoo|cts\\/i;
  const seenTitles = new Set();
  const seenFingerprints = new Set();
  const validated = [];

  for (const w of rawList) {
    const titleKey = w.title.toLowerCase();
    if (seenTitles.has(titleKey)) {
      throw new Error(`Dupli naslov u katalogu: "${w.title}"`);
    }
    seenTitles.add(titleKey);

    if (FORBIDDEN_RE.test(`${w.title} ${w.description}`)) {
      throw new Error(`Pronađen zabranjeni brend u treningu: "${w.title}"`);
    }

    const durSec = w.steps.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
    const category = normalizeCategory(w.category);
    const difficulty = calculateCategoryDifficulty(w.steps, category);
    const powerArr = expandStepsToSeconds(w.steps, 250);
    const metrics = calculateCogganMetrics(powerArr, 250);

    // Fingerprint provjera da nijedan trening nije identičan drugom
    const fp = w.steps.map((s) => `${s.duration}@${s.power}`).join('|');
    if (seenFingerprints.has(fp)) {
      throw new Error(`Dupli fiziološki profil za: "${w.title}"`);
    }
    seenFingerprints.add(fp);

    validated.push({
      title: w.title,
      description: w.description,
      category,
      duration_seconds: durSec,
      difficulty_score: difficulty,
      steps: w.steps,
      _tss: metrics.tss,
      _if: metrics.ifFactor,
      _autoCat: categorizeWorkout(w.steps)
    });
  }

  // Statistika
  const byCat = {};
  const byDur = { '<45m': 0, '45-60m': 0, '61-75m': 0, '76-90m': 0, '90m+': 0 };
  for (const w of validated) {
    byCat[w.category] = (byCat[w.category] || 0) + 1;
    const mins = Math.round(w.duration_seconds / 60);
    if (mins < 45) byDur['<45m']++;
    else if (mins <= 60) byDur['45-60m']++;
    else if (mins <= 75) byDur['61-75m']++;
    else if (mins <= 90) byDur['76-90m']++;
    else byDur['90m+']++;
  }

  console.log('\n================ ERGVIBE JAVNI KATALOG ================');
  console.log(`Ukupno validiranih 100% originalnih treninga: ${validated.length}`);
  console.log('\nPo fiziološkim zonama:');
  for (const [c, n] of Object.entries(byCat)) {
    const scores = validated.filter((w) => w.category === c).map((w) => w.difficulty_score);
    const minS = Math.min(...scores).toFixed(1);
    const maxS = Math.max(...scores).toFixed(1);
    console.log(`  ${c.padEnd(14)} ${String(n).padStart(3)} treninga   (LVL ${minS} – ${maxS})`);
  }
  console.log('\nPo trajanju:');
  for (const [d, n] of Object.entries(byDur)) {
    console.log(`  ${d.padEnd(10)} ${String(n).padStart(3)} treninga`);
  }

  // Generiraj spremnu SQL migracijsku datoteku
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const sqlPath = path.join(REPORT_DIR, 'public_catalog_migration.sql');
  const uuidPlaceholder = OWNER_UUID || 'ZAMIJENI_SA_SVOJIM_INTERVALS_UUID';

  const insertRowsSql = validated
    .map(
      (w) =>
        `  (${sqlQuote(w.title)}, ${sqlQuote(w.description)}, ${sqlQuote(w.category)}, ${w.duration_seconds}, ${w.difficulty_score}, ${sqlQuote(JSON.stringify(w.steps))}::jsonb, NULL)`
    )
    .join(',\n');

  let headerInstructions;
  let step1Sql;

  if (OWNER_INTERVALS_ID) {
    const cleanId = OWNER_INTERVALS_ID.toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidateEmails = new Set([`intervals_${cleanId}@auth.ergvibe.app`]);
    if (!cleanId.startsWith('i')) {
      candidateEmails.add(`intervals_i${cleanId}@auth.ergvibe.app`);
    }
    // Čest slučaj: korisnik pročita vodeće slovo 'i' kao broj '1' (npr. 'i1234567' -> '11234567')
    if (cleanId.startsWith('1') && cleanId.length >= 6) {
      candidateEmails.add(`intervals_i${cleanId.slice(1)}@auth.ergvibe.app`);
    }
    const emailListSql = Array.from(candidateEmails).map(sqlQuote).join(',\n    ');

    headerInstructions = `-- UPUTA:
-- 1. Skripta je 100% SPREMNA — ništa ne trebaš ručno mijenjati!
--    Automatski pronalazi tvoj Supabase račun za Intervals.icu ID (${OWNER_INTERVALS_ID}),
--    potvrđuje mu Admin ulogu, prebacuje svih ~1.500 postojećih treninga u tvoje privatne ("Moji Treninzi")
--    i ubacuje ${validated.length} potpuno novih, čistih javnih ErgVibe treninga.
-- 2. Kopiraj cijelu ovu datoteku (Ctrl+A -> Ctrl+C) i pokreni u Supabase -> SQL Editor -> New Query -> Run.
-- 3. Sve se izvršava unutar jedne transakcije (BEGIN / COMMIT) — ili prođe 100% ili se ništa ne mijenja!`;

    step1Sql = `-- KORAK 1: Pronađi tvoj Intervals.icu račun u auth.users, potvrdi Admin ulogu i prebaci
-- svih ~1.500 postojećih treninga u tvoju privatnu knjižnicu ("Moji Treninzi")
DO $$
DECLARE
  v_owner_id uuid;
  v_owner_email text;
  v_match_count int;
  v_moved_count int;
BEGIN
  -- Zaštita od slučajnog dvostrukog pokretanja migracije
  IF EXISTS (
    SELECT 1 FROM public.workouts
    WHERE user_id IS NULL AND title = 'Rønnestad 30/15s Pro 60 (3×13)'
  ) THEN
    RAISE EXCEPTION 'Migracija javnog kataloga je već izvršena! Prekidam kako se ne bi stvorili duplikati.';
  END IF;

  SELECT COUNT(*) INTO v_match_count
  FROM auth.users
  WHERE LOWER(email) IN (
    ${emailListSql}
  );

  IF v_match_count = 0 THEN
    RAISE EXCEPTION 'Nije pronađen Intervals.icu račun za ID ${cleanId}. Provjeri točan email upitom: SELECT id, email FROM auth.users WHERE email LIKE ''intervals_%%'';';
  ELSIF v_match_count > 1 THEN
    RAISE EXCEPTION 'Pronađeno više (%) podudarajućih računa — koristi izravni --owner-uuid!', v_match_count;
  END IF;

  SELECT id, email INTO v_owner_id, v_owner_email
  FROM auth.users
  WHERE LOWER(email) IN (
    ${emailListSql}
  )
  LIMIT 1;

  -- Osiguraj da tvoj Intervals.icu račun ima Admin ulogu (postojeći email admin ostaje nedirnut)
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  WHERE id = v_owner_id;

  -- Svi dosadašnji javni treninzi (~1.500) ostaju 100% netaknuti, prelaze u "Moji Treninzi"
  UPDATE public.workouts
  SET user_id = v_owner_id
  WHERE user_id IS NULL;

  GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  RAISE NOTICE 'Pronađen račun: % (UUID: %). Prebačeno % treninga u Moji Treninzi + potvrđena Admin uloga.', v_owner_email, v_owner_id, v_moved_count;
END $$;`;
  } else {
    headerInstructions = `-- UPUTA:
-- 1. Ako već nisi, zamijeni '${uuidPlaceholder}' svojim pravim UUID-jem iz auth.users
--    (tvoj Intervals.icu račun: intervals_iXXXXXX@auth.ergvibe.app).
-- 2. Kopiraj i pokreni cijelu skriptu u Supabase -> SQL Editor -> New Query.
-- 3. Sve se izvršava unutar jedne transakcije (BEGIN / COMMIT) — ili prođe 100% ili se ništa ne mijenja!`;

    step1Sql = `-- KORAK 1: Svi dosadašnji javni treninzi (~1.500) ostaju 100% netaknuti,
-- samo prelaze u tvoju privatnu knjižnicu ("Moji Treninzi"), nevidljivi drugima!
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workouts
    WHERE user_id IS NULL AND title = 'Rønnestad 30/15s Pro 60 (3×13)'
  ) THEN
    RAISE EXCEPTION 'Migracija javnog kataloga je već izvršena! Prekidam kako se ne bi stvorili duplikati.';
  END IF;
END $$;

UPDATE public.workouts
SET user_id = '${uuidPlaceholder}'::uuid
WHERE user_id IS NULL;`;
  }

  const sqlContent = `-- =============================================================================
-- ErgVibe: Prebacivanje postojećih ~1.500 treninga u tvoje privatne (Moji Treninzi)
--          + Uvoz ${validated.length} potpuno originalnih javnih ErgVibe treninga
-- =============================================================================
${headerInstructions}
-- =============================================================================

BEGIN;

${step1Sql}

-- KORAK 2: Uvoz ${validated.length} čistih, 100% originalnih ErgVibe javnih treninga (user_id = NULL)
INSERT INTO public.workouts (title, description, category, duration_seconds, difficulty_score, steps, user_id)
VALUES
${insertRowsSql};

COMMIT;

-- PROVJERA NAKON IZVRŠAVANJA:
SELECT
  CASE WHEN user_id IS NULL THEN 'JAVNI KATALOG' ELSE 'MOJI PRIVATNI' END AS baza,
  COUNT(*) AS broj_treninga
FROM public.workouts
GROUP BY 1;
`;

  fs.writeFileSync(sqlPath, sqlContent, 'utf8');
  console.log(`\n✓ Generirana SQL migracija: ${sqlPath}`);
  console.log(`  Veličina: ${(Buffer.byteLength(sqlContent, 'utf8') / 1024).toFixed(1)} KB`);

  if (COMMIT) {
    if (!OWNER_UUID) {
      console.error('\n❌ Za --commit moraš navesti --owner-uuid <DINOV-UUID>.');
      process.exit(1);
    }
    const env = { ...loadEnv(), ...process.env };
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.error('\n❌ Za --commit nedostaje SUPABASE_SERVICE_ROLE_KEY u okruženju. Umjesto toga pokreni generirani SQL u Supabase SQL Editoru.');
      process.exit(1);
    }

    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
    console.log(`\n[Commit] Prebacujem postojeće javne treninge na user_id=${OWNER_UUID}...`);
    const { error: updErr } = await sb
      .from('workouts')
      .update({ user_id: OWNER_UUID })
      .is('user_id', null);
    if (updErr) throw updErr;

    console.log(`[Commit] Ubacujem ${validated.length} čistih javnih treninga u batch-evima...`);
    const BATCH = 50;
    for (let i = 0; i < validated.length; i += BATCH) {
      const slice = validated.slice(i, i + BATCH).map((w) => ({
        title: w.title,
        description: w.description,
        category: w.category,
        duration_seconds: w.duration_seconds,
        difficulty_score: w.difficulty_score,
        steps: w.steps,
        user_id: null
      }));
      const { error: insErr } = await sb.from('workouts').insert(slice);
      if (insErr) throw insErr;
    }
    console.log('✅ Uspješno izvršeno u Supabaseu!');
  }
}

main().catch((err) => {
  console.error('❌ Greška:', err);
  process.exit(1);
});

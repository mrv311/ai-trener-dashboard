#!/usr/bin/env node
/* global process */
/**
 * Sigurna rekalkulacija faktora težine (`difficulty_score`) za sve postojeće treninge
 * u Supabase tablici `workouts` koristeći aktualnu logiku iz `src/utils/workoutParser.js`.
 *
 * Korištenje:
 *   npm run recalc:difficulty                                -> DRY RUN (pregled promjena bez upisa)
 *   npm run recalc:difficulty:commit                         -> STVARNI UPIS u Supabase (čuva rollback JSON)
 *   node scripts/recalculate-difficulty.mjs --recategorize   -> DRY RUN uz ponovnu kategorizaciju (čuva 'Testiranje')
 *   node scripts/recalculate-difficulty.mjs --rollback <json> -> SIGURNI UNDO prethodnog upisa
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(__dirname, 'import-reports');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const RECATEGORIZE = args.includes('--recategorize');
const rollbackIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;
const CONCURRENCY = 15;

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

async function fetchAllWorkouts() {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,title,category,difficulty_score,duration_seconds,steps')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  let done = 0;
  const errors = [];
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      try {
        await worker(current);
      } catch (err) {
        errors.push({ item: current, err });
      }
      done++;
      if (done % 50 === 0 || done === items.length) {
        process.stdout.write(`   Obrađeno ${done}/${items.length}\r`);
      }
    }
  });
  await Promise.all(runners);
  return errors;
}

async function handleRollback(rollbackPath) {
  const resolved = path.resolve(process.cwd(), rollbackPath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ Rollback datoteka ne postoji: ${resolved}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const entries = manifest.entries || [];
  if (!entries.length) {
    console.log('ℹ️ Nema zapisa za rollback.');
    return;
  }
  console.log(`\n⏪ Vraćam prijašnje ocjene za ${entries.length} treninga...`);
  const errors = await runPool(entries, CONCURRENCY, async (entry) => {
    const payload = { difficulty_score: entry.oldScore };
    if (entry.oldCategory !== undefined) payload.category = entry.oldCategory;
    const { error } = await supabase.from('workouts').update(payload).eq('id', entry.id);
    if (error) throw error;
  });
  console.log(`\n✅ Rollback završen. Uspješno: ${entries.length - errors.length}, greške: ${errors.length}`);
}

function statsLine(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return 'n=0';
  const q = (p) => nums[Math.min(nums.length - 1, Math.floor(nums.length * p))];
  return `min:${String(q(0)).padStart(4)} p25:${String(q(0.25)).padStart(4)} med:${String(q(0.5)).padStart(4)} p75:${String(q(0.75)).padStart(4)} p95:${String(q(0.95)).padStart(4)} max:${String(q(1)).padStart(5)}`;
}

async function main() {
  if (ROLLBACK_FILE) {
    await handleRollback(ROLLBACK_FILE);
    return;
  }

  console.log('==============================================================');
  console.log('  REKALKULACIJA FAKTORA TEŽINE TRENINGA U SUPABASE KNJIŽNICI');
  console.log('==============================================================');
  console.log(COMMIT
    ? '💾 Način rada: COMMIT (STVARNI UPIS U SUPABASE)'
    : '🧪 Način rada: DRY RUN (bez upisa — dodaj --commit za spremanje)');
  if (RECATEGORIZE) {
    console.log('🏷️  Uključeno: --recategorize (ponovna kategorizacija zona, čuva Testiranje)');
  }

  const all = await fetchAllWorkouts();
  console.log(`\n🌐 Dohvaćeno treninga iz baze: ${all.length}`);

  const updates = [];
  const byCatOld = {};
  const byCatNew = {};
  let skippedNoSteps = 0;

  for (const w of all) {
    if (!Array.isArray(w.steps) || w.steps.length === 0) {
      skippedNoSteps++;
      continue;
    }
    const oldCat = normalizeCategory(w.category);
    let nextCat = oldCat;
    if (RECATEGORIZE && oldCat !== 'Testiranje') {
      nextCat = normalizeCategory(categorizeWorkout(w.steps));
    }

    const oldScore = typeof w.difficulty_score === 'number' ? Number(w.difficulty_score) : null;
    const newScore = calculateCategoryDifficulty(w.steps, nextCat);

    if (!byCatOld[oldCat]) byCatOld[oldCat] = [];
    if (!byCatNew[nextCat]) byCatNew[nextCat] = [];
    if (oldScore != null) byCatOld[oldCat].push(oldScore);
    byCatNew[nextCat].push(newScore);

    const scoreChanged = oldScore === null || Math.abs(oldScore - newScore) >= 0.05;
    const catChanged = nextCat !== (w.category || '');
    if (scoreChanged || (RECATEGORIZE && catChanged)) {
      updates.push({
        id: w.id,
        title: w.title || 'Bez naziva',
        oldCategory: w.category,
        newCategory: nextCat,
        catChanged: RECATEGORIZE && catChanged,
        oldScore,
        newScore,
        delta: oldScore != null ? Number((newScore - oldScore).toFixed(1)) : 0
      });
    }
  }

  console.log(`\n📊 Raspodjela po kategorijama (STARA -> NOVA):`);
  const cats = Array.from(new Set([...Object.keys(byCatOld), ...Object.keys(byCatNew)])).sort();
  for (const c of cats) {
    const nOld = (byCatOld[c] || []).length;
    const nNew = (byCatNew[c] || []).length;
    console.log(`  ${c.padEnd(12)} (n=${String(nNew).padStart(4)})`);
    console.log(`    STARI: ${statsLine(byCatOld[c] || [])}${nOld !== nNew ? ` (bilo n=${nOld})` : ''}`);
    console.log(`    NOVI:  ${statsLine(byCatNew[c] || [])}`);
  }

  console.log(`\n📝 Za ažuriranje: ${updates.length} / ${all.length} treninga (preskočeno bez koraka: ${skippedNoSteps})`);

  const byAbsDelta = [...updates].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log('\n🔍 Top 12 najvećih pomaka:');
  for (const u of byAbsDelta.slice(0, 12)) {
    const sign = u.delta >= 0 ? '+' : '';
    const catTag = u.catChanged ? `${u.oldCategory} -> ${u.newCategory}` : u.newCategory;
    console.log(
      `  ${u.title.slice(0, 38).padEnd(39)} | ${catTag.padEnd(14)} | ${String(u.oldScore).padStart(4)} -> ${String(u.newScore).padStart(4)} (${sign}${u.delta})`
    );
  }

  if (!COMMIT) {
    console.log('\n✅ DRY RUN završen. Za stvarni upis pokreni: npm run recalc:difficulty:commit');
    return;
  }

  if (updates.length === 0) {
    console.log('\n✅ Svi treninzi već imaju ažurne ocjene.');
    return;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(REPORT_DIR, `recalc_backup_${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      recategorize: RECATEGORIZE,
      entries: updates.map(u => ({
        id: u.id,
        title: u.title,
        oldScore: u.oldScore,
        newScore: u.newScore,
        ...(u.catChanged ? { oldCategory: u.oldCategory, newCategory: u.newCategory } : {})
      }))
    }, null, 2)
  );
  console.log(`\n💾 Backup za rollback spremljen u: ${path.relative(PROJECT_ROOT, backupPath)}`);
  console.log(`⏳ Ažuriram ${updates.length} treninga u Supabaseu...`);

  const errors = await runPool(updates, CONCURRENCY, async (u) => {
    const payload = { difficulty_score: u.newScore };
    if (u.catChanged) payload.category = u.newCategory;
    const { error } = await supabase.from('workouts').update(payload).eq('id', u.id);
    if (error) throw error;
  });

  console.log(`\n✅ Gotovo! Ažurirano: ${updates.length - errors.length}, greške: ${errors.length}`);
  if (errors.length > 0) {
    console.error('Prvih 5 grešaka:', errors.slice(0, 5).map(e => `${e.item.title}: ${e.err.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Neočekivana greška:', err);
  process.exit(1);
});

/**
 * Parses src/data/historical_workouts.csv (Intervals.icu export)
 * into compact, rounded src/data/historical_workouts.json for fast frontend & AI Coach usage.
 */
const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'data', 'historical_workouts.csv');
const outPath = path.join(__dirname, '..', 'src', 'data', 'historical_workouts.json');

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur.replace(/^"|"$/g, '').trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.replace(/^"|"$/g, '').trim());
  return result;
}

const num = (v, decimals = 0) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (decimals === 0) return Math.round(n);
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
};

const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.replace(/^"|"$/g, '').trim());

const records = [];
for (let i = 1; i < lines.length; i++) {
  const vals = parseCSVLine(lines[i]);
  const raw = {};
  headers.forEach((h, idx) => {
    raw[h] = vals[idx] !== undefined ? vals[idx] : '';
  });

  if (!raw.Date) continue;

  let elapsedSec = num(raw['Elapsed time'], 0);
  // Protect against corrupted GPS/timer outliers (> 24 hours)
  if (elapsedSec !== null && (elapsedSec < 0 || elapsedSec > 86400)) {
    elapsedSec = null;
  }

  const workAboveFtpJ = num(raw['Work >FTP'], 0);

  const rec = {
    id: raw.id || `hist_${i}`,
    type: raw.Type || 'Ride',
    date: raw.Date, // e.g. "2026-11-04T19:48:41"
    name: raw.Name || 'Trening',
    durMin: elapsedSec ? Math.round(elapsedSec / 60) : null,
    avgPwr: num(raw['Avg Power'], 0),
    np: num(raw['Norm Power'], 0),
    ifPct: num(raw.Intensity, 1),
    tss: num(raw.Load, 0),
    ftp: num(raw.FTP, 0),
    wt: num(raw.Weight, 1),
    avgHr: num(raw['Avg HR'], 0),
    maxHr: num(raw['Max HR'], 0),
    rhr: num(raw['Resting HR'], 0),
    hrr: num(raw.HRRc, 0),
    cad: num(raw.Cadence, 0),
    ef: num(raw.Efficiency, 2),
    dec: num(raw.Decoupling, 1),
    vi: num(raw.Variability, 2),
    ctl: num(raw.Fitness, 1),
    tsb: num(raw.Form, 0),
    climb: num(raw.Climbing, 0),
    pMax: num(raw['Activity pMax'] || raw.Pmax, 0),
    eCP: num(raw['Activity eCP'], 0),
    wFtpKj: workAboveFtpJ !== null ? Math.round((workAboveFtpJ / 1000) * 10) / 10 : null
  };

  // Strip null fields to keep JSON ultra-compact
  const compact = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== null && v !== '') compact[k] = v;
  }
  records.push(compact);
}

// Sort descending by date (newest first)
records.sort((a, b) => String(b.date).localeCompare(String(a.date)));

fs.writeFileSync(outPath, JSON.stringify(records));
const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Built ${records.length} workouts -> ${outPath} (${sizeKb} KB)`);

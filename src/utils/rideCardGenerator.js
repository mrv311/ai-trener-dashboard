import { UI_THEMES } from './themeConfig';

export const RIDE_CARD_WIDTH = 1200;
export const RIDE_CARD_HEIGHT = 900;

/**
 * Vraća hex boju trenutno aktivne ErgVibe UI teme s <html data-theme="...">.
 */
export function getActiveThemeAccentHex() {
  if (typeof document !== 'undefined') {
    const themeId = document.documentElement.getAttribute('data-theme') || 'volt';
    const match = UI_THEMES.find((t) => t.id === themeId);
    if (match?.swatch) return match.swatch;
  }
  return '#a3e635';
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || '#a3e635').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) || 163;
  const g = parseInt(full.slice(2, 4), 16) || 230;
  const b = parseInt(full.slice(4, 6), 16) || 53;
  return `rgba(${r},${g},${b},${alpha})`;
}

function getZoneStyle(pctOfFtp) {
  if (pctOfFtp < 0.56) return { fill: 'rgba(113,113,122,0.34)', top: '#a1a1aa' }; // Z1
  if (pctOfFtp < 0.76) return { fill: 'rgba(56,189,248,0.28)', top: '#38bdf8' }; // Z2
  if (pctOfFtp < 0.91) return { fill: 'rgba(52,211,153,0.30)', top: '#34d399' }; // Z3
  if (pctOfFtp < 1.05) return { fill: 'rgba(245,158,11,0.34)', top: '#f59e0b' }; // Z4
  if (pctOfFtp < 1.21) return { fill: 'rgba(244,63,94,0.36)', top: '#fb7185' }; // Z5
  return { fill: 'rgba(168,85,247,0.38)', top: '#c084fc' }; // Z6+
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBrandLogo(ctx, cx, cy, size, accentHex) {
  const s = size / 100;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-50, -50);

  // Outer 12-segment flywheel ring
  ctx.save();
  ctx.translate(50, 50);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.strokeStyle = '#636875';
  ctx.lineWidth = 4.6;
  ctx.setLineDash([19.8, 3.24]);
  ctx.stroke();
  ctx.restore();

  // Inner technical guide ring
  ctx.beginPath();
  ctx.arc(50, 50, 37.2, 0, Math.PI * 2);
  ctx.strokeStyle = '#464a56';
  ctx.lineWidth = 2.1;
  ctx.setLineDash([]);
  ctx.stroke();

  // Mid gears
  ctx.save();
  ctx.translate(50, 50);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, 30.8, 0, Math.PI * 2);
  ctx.strokeStyle = '#9ea3b0';
  ctx.lineWidth = 4.8;
  ctx.setLineDash([12.9, 3.22]);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 23.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#d0d4de';
  ctx.lineWidth = 4.8;
  ctx.setLineDash([9.2, 3.1]);
  ctx.stroke();
  ctx.restore();

  // Signature accent teeth quadrant
  ctx.beginPath();
  ctx.arc(50, 50, 30.8, -0.96, -0.14);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 5.8;
  ctx.setLineDash([12.5, 3.1]);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(50, 50, 23.5, -0.96, -0.14);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 5.8;
  ctx.setLineDash([9.2, 2.9]);
  ctx.stroke();

  // Hub bearing
  ctx.save();
  ctx.translate(50, 50);
  ctx.rotate((-42 * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.strokeStyle = '#f4f5f8';
  ctx.lineWidth = 4.8;
  ctx.setLineDash([41.8, 5.3]);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function formatDurationClock(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateLabel(rawDate, cardLang) {
  try {
    const dt = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(dt.getTime())) return String(rawDate || '');
    return dt
      .toLocaleDateString(cardLang === 'hr' ? 'hr-HR' : 'en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
      .toUpperCase();
  } catch {
    return String(rawDate || '');
  }
}

function normalizeTargetSteps(rawSteps, ftp) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return [];
  const safeFtp = Number(ftp) > 0 ? Number(ftp) : 200;
  const out = [];

  for (const s of rawSteps) {
    const dur = Math.max(0, Number(s?.duration || 0));
    if (dur <= 0) continue;

    // Step power može biti u postocima FTP-a (npr. 85 ili 0.85) ili objektu
    let pStart = Number(s?.powerMin ?? s?.powerStart ?? s?.power ?? 0);
    let pEnd = Number(s?.powerMax ?? s?.powerEnd ?? s?.power ?? pStart);

    if (typeof s?.power === 'object' && s.power !== null) {
      const startVal = Number(s.power.start ?? s.power.value ?? 0);
      const endVal = Number(s.power.end ?? startVal);
      if (s.power.units === 'w' || s.power.units === 'W') {
        pStart = (startVal / safeFtp) * 100;
        pEnd = (endVal / safeFtp) * 100;
      } else {
        pStart = startVal;
        pEnd = endVal;
      }
    }

    // Normaliziraj u decimalni omjer FTP-a (npr. 0.85 za 85%)
    const startPct = pStart > 4 ? pStart / 100 : pStart;
    const endPct = pEnd > 4 ? pEnd / 100 : pEnd;
    const avgPct = (startPct + endPct) / 2;

    if (avgPct > 0) {
      out.push({
        dur,
        startPct: Math.max(0.2, startPct),
        endPct: Math.max(0.2, endPct),
        avgPct: Math.max(0.2, avgPct),
        isRamp: Boolean(s?.ramp) && Math.abs(endPct - startPct) >= 0.03
      });
    }
  }
  return out;
}

function normalizeTelemetryStream(rawStream) {
  if (!Array.isArray(rawStream) || rawStream.length === 0) return [];
  const pts = [];
  for (let i = 0; i < rawStream.length; i++) {
    const p = rawStream[i];
    if (!p || typeof p !== 'object') continue;
    const t = Number(p.time ?? p.t ?? i);
    const power = Math.max(0, Number(p.power ?? p.watts ?? p.p ?? 0) || 0);
    const hr = Math.max(0, Number(p.hr ?? p.heartrate ?? 0) || 0);
    pts.push({ t: Number.isFinite(t) ? t : i, power, hr });
  }
  return pts;
}

/**
 * Downsampla i blago zaglađuje stream u ~180 točaka tako da graf izgleda oštro i čitko na mobitelu.
 */
function smoothAndDownsample(points, targetBuckets = 180) {
  if (points.length <= 2) return points;
  const maxT = points[points.length - 1].t;
  const minT = points[0].t;
  const span = Math.max(1, maxT - minT);

  if (points.length <= targetBuckets) {
    return points.map((pt, idx) => {
      const prev = points[Math.max(0, idx - 1)];
      const next = points[Math.min(points.length - 1, idx + 1)];
      const hrSamples = [prev.hr, pt.hr, next.hr].filter((v) => v > 0);
      return {
        t: pt.t - minT,
        power: (prev.power + pt.power * 2 + next.power) / 4,
        hr: hrSamples.length ? hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length : 0
      };
    });
  }

  const bucketCount = targetBuckets;
  const buckets = Array.from({ length: bucketCount }, () => ({ pSum: 0, pCnt: 0, hrSum: 0, hrCnt: 0 }));

  for (const pt of points) {
    const norm = Math.max(0, Math.min(0.9999, (pt.t - minT) / span));
    const bIdx = Math.floor(norm * bucketCount);
    buckets[bIdx].pSum += pt.power;
    buckets[bIdx].pCnt += 1;
    if (pt.hr > 35) {
      buckets[bIdx].hrSum += pt.hr;
      buckets[bIdx].hrCnt += 1;
    }
  }

  const res = [];
  let lastPower = 0;
  let lastHr = 0;
  for (let i = 0; i < bucketCount; i++) {
    const b = buckets[i];
    const p = b.pCnt > 0 ? b.pSum / b.pCnt : lastPower;
    const hr = b.hrCnt > 0 ? b.hrSum / b.hrCnt : lastHr;
    if (b.pCnt > 0) lastPower = p;
    if (b.hrCnt > 0) lastHr = hr;
    res.push({
      t: ((i + 0.5) / bucketCount) * span,
      power: p,
      hr
    });
  }
  return res;
}

function fitTextTruncate(ctx, text, maxWidth) {
  const str = String(text || '').trim();
  if (!str) return '';
  if (ctx.measureText(str).width <= maxWidth) return str;
  let out = str;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trim()}…`;
}

/**
 * Crta ErgVibe Strava Ride Card (1200x900) na zadani HTML5 Canvas.
 */
export function renderRideCardToCanvas(canvas, payload = {}, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = RIDE_CARD_WIDTH;
  const H = RIDE_CARD_HEIGHT;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const accent = options.accentHex || getActiveThemeAccentHex();
  const cardLang = options.lang === 'hr' ? 'hr' : 'en';
  const showHr = options.showHr !== false;
  const showEfficiency = options.showEfficiency !== false;
  const isHr = cardLang === 'hr';

  const ftp = Math.max(50, Number(payload.ftp) || 200);
  const weight = Number(payload.weight) > 25 ? Number(payload.weight) : null;
  const wkg = weight ? (ftp / weight).toFixed(2) : null;

  const title = String(payload.title || (isHr ? 'Slobodna Vožnja' : 'Free Ride')).trim();
  const category = String(payload.category || '').trim();
  const dateLabel = formatDateLabel(payload.date, cardLang);
  const modeBadge = String(payload.modeBadge || 'INDOOR · SMART FTMS').toUpperCase();

  const durationSeconds = Math.max(0, Number(payload.durationSeconds) || 0);
  const avgPower = Math.round(Number(payload.avgPower) || 0);
  const np = Math.round(Number(payload.np) || avgPower || 0);
  const avgHr = Math.round(Number(payload.avgHr) || 0);
  const maxHr = Math.round(Number(payload.maxHr) || 0);
  const avgCadence = Math.round(Number(payload.avgCadence) || 0);
  const tss = Math.round(Number(payload.tss) || 0);
  const ifVal = payload.ifFactor
    ? Number(payload.ifFactor).toFixed(2)
    : np > 0
      ? (np / ftp).toFixed(2)
      : '0.00';
  const workKj = Math.round(
    Number(payload.workKj) || (avgPower > 0 && durationSeconds > 0 ? (avgPower * durationSeconds) / 1000 : 0)
  );
  const distanceKm = Number(payload.distanceKm) > 0 ? Number(payload.distanceKm).toFixed(1) : null;
  const avgSpeedKmh = Number(payload.avgSpeedKmh) > 0 ? Number(payload.avgSpeedKmh).toFixed(1) : null;
  const ef = payload.ef ? Number(payload.ef).toFixed(2) : np > 0 && avgHr > 0 ? (np / avgHr).toFixed(2) : null;
  const decoupling =
    payload.decoupling !== null && payload.decoupling !== undefined && Number.isFinite(Number(payload.decoupling))
      ? Number(payload.decoupling).toFixed(1)
      : null;

  const steps = normalizeTargetSteps(payload.steps, ftp);
  const rawStream = normalizeTelemetryStream(payload.stream);
  const stream = smoothAndDownsample(rawStream, 180);
  const hasPowerStream = stream.some((pt) => pt.power > 0);
  const hasHrStream = showHr && stream.some((pt) => pt.hr > 35);
  const hasSteps = steps.length > 0;

  // 1. Carbon dark background + telemetry grid
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Subtle top-right radial accent glow
  const glow = ctx.createRadialGradient(W * 0.84, H * 0.14, 10, W * 0.84, H * 0.14, 520);
  glow.addColorStop(0, hexToRgba(accent, 0.16));
  glow.addColorStop(1, 'rgba(9,9,11,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Top accent bar
  const stripe = ctx.createLinearGradient(0, 0, W, 0);
  stripe.addColorStop(0, accent);
  stripe.addColorStop(0.65, hexToRgba(accent, 0.45));
  stripe.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, W, 6);

  // 2. Header: BrandLogo + ERGVIBE + mode badge
  drawBrandLogo(ctx, 82, 74, 56, accent);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '700 34px "Chakra Petch", system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#f4f4f5';
  ctx.fillText('ERG', 124, 67);
  const ergWidth = ctx.measureText('ERG').width;
  ctx.fillStyle = accent;
  ctx.fillText('VIBE', 124 + ergWidth, 67);

  ctx.font = '600 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = '#71717a';
  ctx.fillText('INDOOR CYCLING TELEMETRY · SMART FTMS', 125, 93);

  ctx.font = '700 14px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  const badgeW = Math.min(430, ctx.measureText(modeBadge).width + 36);
  drawRoundedRect(ctx, W - 54 - badgeW, 52, badgeW, 36, 999);
  ctx.fillStyle = hexToRgba(accent, 0.12);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(accent, 0.36);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.fillText(fitTextTruncate(ctx, modeBadge, badgeW - 24), W - 54 - badgeW / 2, 71);
  ctx.textAlign = 'left';

  // 3. Title & subtitle metadata
  ctx.font = '700 48px "Chakra Petch", system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#fafafa';
  ctx.fillText(fitTextTruncate(ctx, title.toUpperCase(), W - 108), 54, 166);

  const metaParts = [
    category ? category.toUpperCase() : null,
    dateLabel,
    `FTP ${ftp} W`,
    wkg ? `${wkg} W/KG` : null
  ].filter(Boolean);
  ctx.font = '600 18px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(fitTextTruncate(ctx, metaParts.join('  ·  '), W - 108), 56, 210);

  // 4. Main Telemetry Graph Container
  const gx = 54;
  const gy = 248;
  const gw = W - 108;
  const gh = 372;

  drawRoundedRect(ctx, gx, gy, gw, gh, 22);
  ctx.fillStyle = 'rgba(24,24,27,0.9)';
  ctx.fill();
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 2;
  ctx.stroke();

  const px = gx + 32;
  const py = gy + 42;
  const pw = gw - 64;
  const ph = gh - 82;

  const totalStepsDur = steps.reduce((s, b) => s + b.dur, 0);
  const streamSpan = stream.length > 1 ? Math.max(1, stream[stream.length - 1].t - stream[0].t) : 0;
  const plotDuration = Math.max(totalStepsDur, streamSpan, durationSeconds, 60);

  // Odredi Y-skalu u postocima FTP-a
  let maxPct = 1.25;
  if (hasSteps) {
    for (const s of steps) {
      maxPct = Math.max(maxPct, s.startPct * 1.12, s.endPct * 1.12);
    }
  }
  if (hasPowerStream) {
    const sortedP = stream.map((pt) => pt.power).sort((a, b) => a - b);
    const p98 = sortedP[Math.floor(sortedP.length * 0.98)] || 0;
    const pPeak = sortedP[sortedP.length - 1] || 0;
    const visualMaxW = Math.min(pPeak, Math.max(p98 * 1.15, ftp * 1.25));
    maxPct = Math.max(maxPct, (visualMaxW / ftp) * 1.08);
  }
  maxPct = Math.min(2.2, Math.max(1.2, maxPct));

  // Horizontalne linije vodilice (50%, 75%, 100% FTP)
  [0.5, 0.75, 1.0].forEach((lvl) => {
    if (lvl > maxPct) return;
    const y = py + ph - (lvl / maxPct) * ph;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px + pw, y);
    if (lvl === 1.0) {
      ctx.strokeStyle = hexToRgba(accent, 0.55);
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.8;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    ctx.restore();

    ctx.font = '700 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = lvl === 1.0 ? accent : '#52525b';
    ctx.fillText(lvl === 1.0 ? `FTP ${ftp}W` : `${Math.round(lvl * ftp)}W`, px + 4, y - 10);
  });

  if (hasSteps) {
    // Crta strukturirane intervalne blokove (podržava ravne i rampe)
    let cursor = 0;
    const stepsScaleDur = Math.max(totalStepsDur, streamSpan > totalStepsDur ? streamSpan : totalStepsDur);
    for (const b of steps) {
      const x1 = px + (cursor / stepsScaleDur) * pw;
      const x2 = px + ((cursor + b.dur) / stepsScaleDur) * pw;
      const bwBlock = Math.max(1.5, x2 - x1 - (steps.length > 60 ? 0.5 : 2));
      const y1 = py + ph - Math.min(1, b.startPct / maxPct) * ph;
      const y2 = py + ph - Math.min(1, b.endPct / maxPct) * ph;
      const z = getZoneStyle(b.avgPct);

      ctx.beginPath();
      ctx.moveTo(x1, py + ph);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + bwBlock, y2);
      ctx.lineTo(x1 + bwBlock, py + ph);
      ctx.closePath();
      ctx.fillStyle = z.fill;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + bwBlock, y2);
      ctx.strokeStyle = z.top;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      cursor += b.dur;
    }
  } else if (hasPowerStream) {
    // Za slobodne / vanjske vožnje bez intervalnog recepta: stupci/površina obojani po Coggan zonama
    const barW = Math.max(2, pw / stream.length);
    for (let i = 0; i < stream.length; i++) {
      const pt = stream[i];
      const pct = pt.power / ftp;
      const clampedH = Math.min(1, pct / maxPct) * ph;
      const bx = px + (i / stream.length) * pw;
      const by = py + ph - clampedH;
      const z = getZoneStyle(pct);
      ctx.fillStyle = z.fill;
      ctx.fillRect(bx, by, barW + 0.6, clampedH);
    }
  } else {
    // Fallback kad aktivnost uopće nema stream ni korake (npr. ručni unos)
    const fallbackPct = np > 0 ? np / ftp : 0.72;
    const z = getZoneStyle(fallbackPct);
    const barH = Math.min(0.85, fallbackPct / maxPct) * ph;
    drawRoundedRect(ctx, px, py + ph - barH, pw, barH, 12);
    ctx.fillStyle = z.fill;
    ctx.fill();
    ctx.strokeStyle = z.top;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '700 18px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = '#a1a1aa';
    ctx.textAlign = 'center';
    ctx.fillText(
      isHr
        ? `PROSJEČNI INTENZITET: ${Math.round(fallbackPct * 100)}% FTP (${np || avgPower} W)`
        : `AVERAGE INTENSITY: ${Math.round(fallbackPct * 100)}% FTP (${np || avgPower} W)`,
      px + pw / 2,
      py + ph - barH / 2
    );
    ctx.textAlign = 'left';
  }

  // Crta stvarnu krivulju snage
  if (hasPowerStream) {
    const streamDuration = Math.max(1, stream[stream.length - 1].t);
    const xDenom = hasSteps ? Math.max(totalStepsDur, streamDuration) : streamDuration;
    ctx.save();
    ctx.beginPath();
    stream.forEach((pt, idx) => {
      const sx = px + Math.min(1, pt.t / xDenom) * pw;
      const sy = py + ph - Math.min(1, pt.power / ftp / maxPct) * ph;
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.32)';
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.restore();
  }

  // Crta krivulju pulsa (HR)
  if (hasHrStream) {
    const validHrs = stream.map((p) => p.hr).filter((v) => v > 35);
    const minHrVal = Math.max(45, Math.min(...validHrs) - 12);
    const maxHrVal = Math.max(minHrVal + 35, Math.max(...validHrs) + 8);
    const streamDuration = Math.max(1, stream[stream.length - 1].t);
    const xDenom = hasSteps ? Math.max(totalStepsDur, streamDuration) : streamDuration;

    ctx.save();
    ctx.beginPath();
    let started = false;
    stream.forEach((pt) => {
      if (pt.hr <= 35) return;
      const sx = px + Math.min(1, pt.t / xDenom) * pw;
      const norm = Math.max(0.06, Math.min(0.95, (pt.hr - minHrVal) / (maxHrVal - minHrVal)));
      const sy = py + ph - norm * ph;
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    });
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.8;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(251,113,133,0.35)';
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.restore();
  }

  // Legenda grafa (gore desno)
  ctx.font = '700 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'right';
  let legendX = gx + gw - 34;
  if (hasHrStream) {
    ctx.fillStyle = '#fb7185';
    const hrTxt = isHr ? '● PULS (bpm)' : '● HR (bpm)';
    ctx.fillText(hrTxt, legendX, gy + 24);
    legendX -= ctx.measureText(hrTxt).width + 20;
  }
  if (hasPowerStream) {
    ctx.fillStyle = '#f4f4f5';
    const pwrTxt = isHr ? '● SNAGA (W)' : '● POWER (W)';
    ctx.fillText(pwrTxt, legendX, gy + 24);
    legendX -= ctx.measureText(pwrTxt).width + 20;
  }
  if (hasSteps) {
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(isHr ? '■ CILJNE ZONE' : '■ TARGET ZONES', legendX, gy + 24);
  }
  ctx.textAlign = 'left';

  // Donja vremenska os
  const totalMins = Math.max(1, Math.round(plotDuration / 60));
  const stepMin = totalMins <= 30 ? 5 : totalMins <= 75 ? 15 : totalMins <= 150 ? 30 : 60;
  ctx.font = '600 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = '#71717a';
  for (let m = 0; m <= totalMins; m += stepMin) {
    const mx = px + Math.min(1, (m * 60) / plotDuration) * pw;
    if (mx > px + pw - 24 && m !== totalMins) continue;
    ctx.fillText(`${m}m`, mx, gy + gh - 16);
  }

  // 5. Donji red metrika (5 telemetrijskih kartica)
  const durationSub =
    distanceKm && avgSpeedKmh
      ? `${distanceKm} km · ${avgSpeedKmh} km/h`
      : distanceKm
        ? `${distanceKm} km`
        : isHr
          ? 'Strukturirani rad'
          : 'Structured session';

  const powerSub = avgCadence > 0 ? `Avg ${avgPower} W · ${avgCadence} rpm` : `Avg ${avgPower} W`;

  const ifSub =
    showEfficiency && ef
      ? `EF ${ef}`
      : `${Math.round(Number(ifVal) * 100)}% FTP`;

  const tssSub = workKj > 0 ? `${workKj} kJ` : isHr ? 'Opterećenje' : 'Training load';

  const hrValue = avgHr > 0 ? `${avgHr} bpm` : avgCadence > 0 ? `${avgCadence} rpm` : '—';
  const hrLabel = avgHr > 0 ? (isHr ? 'PROSJEČNI PULS' : 'HEART RATE') : isHr ? 'KADENCA' : 'CADENCE';
  const hrSub =
    avgHr > 0
      ? [
          maxHr > avgHr ? `Max ${maxHr}` : null,
          showEfficiency && decoupling !== null ? `Dec ${decoupling}%` : null
        ]
          .filter(Boolean)
          .join(' · ') || (isHr ? 'Aerobni odaziv' : 'Aerobic response')
      : isHr
        ? 'Prosječni okretaji'
        : 'Average cadence';

  const tiles = [
    {
      label: isHr ? 'TRAJANJE' : 'DURATION',
      value: durationSeconds > 0 ? formatDurationClock(durationSeconds) : '—',
      sub: durationSub,
      highlight: false
    },
    {
      label: 'NORM POWER',
      value: np > 0 ? `${np} W` : '—',
      sub: powerSub,
      highlight: false
    },
    {
      label: isHr ? 'INTENZITET' : 'INTENSITY',
      value: `${ifVal} IF`,
      sub: ifSub,
      highlight: false
    },
    {
      label: isHr ? 'OPTEREĆENJE' : 'TRAINING LOAD',
      value: tss > 0 ? `${tss} TSS` : '—',
      sub: tssSub,
      highlight: true
    },
    {
      label: hrLabel,
      value: hrValue,
      sub: hrSub,
      highlight: false
    }
  ];

  const ty = 648;
  const th = 148;
  const gap = 16;
  const tw = (gw - gap * (tiles.length - 1)) / tiles.length;

  tiles.forEach((tile, idx) => {
    const tx = gx + idx * (tw + gap);
    drawRoundedRect(ctx, tx, ty, tw, th, 18);
    ctx.fillStyle = tile.highlight ? hexToRgba(accent, 0.1) : '#121216';
    ctx.fill();
    ctx.strokeStyle = tile.highlight ? hexToRgba(accent, 0.45) : '#27272a';
    ctx.lineWidth = tile.highlight ? 2 : 1.5;
    ctx.stroke();

    if (tile.highlight) {
      ctx.fillStyle = accent;
      ctx.fillRect(tx + 20, ty, tw - 40, 3);
    }

    ctx.font = '700 12px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = tile.highlight ? accent : '#71717a';
    ctx.fillText(tile.label, tx + 18, ty + 33);

    ctx.font = '700 34px "Chakra Petch", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = tile.highlight ? accent : '#fafafa';
    ctx.fillText(fitTextTruncate(ctx, tile.value, tw - 32), tx + 18, ty + 81);

    ctx.font = '600 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(fitTextTruncate(ctx, tile.sub, tw - 32), tx + 18, ty + 119);
  });

  // 6. Footer & watermark
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx, 824);
  ctx.lineTo(W - gx, 824);
  ctx.stroke();

  ctx.font = '600 14px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = '#71717a';
  ctx.fillText('FREE BROWSER SMART TRAINER · BUILT FOR INTERVALS.ICU', gx, 859);

  const urlText = 'ergvibe.vercel.app';
  ctx.font = '700 16px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
  const uw = ctx.measureText(urlText).width + 32;
  drawRoundedRect(ctx, W - gx - uw, 839, uw, 38, 10);
  ctx.fillStyle = '#18181b';
  ctx.fill();
  ctx.strokeStyle = hexToRgba(accent, 0.45);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.fillText(urlText, W - gx - uw / 2, 859);
  ctx.textAlign = 'left';
}

export function buildRideCardFilename(title, rawDate) {
  const safeTitle = String(title || 'Workout')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'Workout';
  const dateIso = (() => {
    try {
      const dt = rawDate ? new Date(rawDate) : new Date();
      if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    } catch {
      // ignore
    }
    return new Date().toISOString().slice(0, 10);
  })();
  return `ErgVibe_${safeTitle}_${dateIso}.png`;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error('Canvas is unavailable.'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export failed.'));
    }, 'image/png');
  });
}

export async function downloadRideCardPng(canvas, filename) {
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'ErgVibe_Ride_Card.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function copyRideCardToClipboard(canvas) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof window?.ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is not supported in this browser.');
  }
  const blob = await canvasToPngBlob(canvas);
  await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
}

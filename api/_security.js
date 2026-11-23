/**
 * Zajednički sigurnosni helperi za Vercel Serverless funkcije (/api/*):
 * - Stroga CORS / Origin provjera (sprječava zlouporabu s tuđih domena)
 * - Verifikacija Supabase JWT tokena putem Supabase Auth API-ja
 * - In-memory klizni rate-limiter za zaštitu poslužiteljskog Gemini API ključa
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://ergvibe.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5199'
];

const VERCEL_PREVIEW_RE = /^https:\/\/ergvibe(?:-[a-z0-9-]+)?\.vercel\.app$/i;

function getExtraAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function isOriginAllowed(origin) {
  if (!origin) return true; // Same-origin ili server-side pozivi bez Origin zaglavlja
  const clean = String(origin).trim().replace(/\/+$/, '');
  if (DEFAULT_ALLOWED_ORIGINS.includes(clean)) return true;
  if (VERCEL_PREVIEW_RE.test(clean)) return true;

  if (process.env.VERCEL_URL) {
    const vercelOrigin = `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    if (clean === vercelOrigin) return true;
  }

  return getExtraAllowedOrigins().includes(clean);
}

/**
 * Primjenjuje stroga CORS zaglavlja. Vraća true ako je origin dopušten, inače false.
 */
export function applyStrictCors(req, res, methods = 'POST, OPTIONS') {
  const origin = req.headers?.origin || '';
  const allowed = isOriginAllowed(origin);

  res.setHeader('Vary', 'Origin');
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return allowed;
}

export function getClientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  const realIp = req.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, anonKey, serviceRoleKey };
}

/**
 * Verificira Supabase JWT iz Authorization zaglavlja.
 * Vraća { id, email, isAdmin } ako je token valjan, inače null.
 */
export async function verifySupabaseUser(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 20) return null;

  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;

  try {
    const resp = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email || '',
      isAdmin: user.app_metadata?.role === 'admin'
    };
  } catch {
    return null;
  }
}

// In-memory klizni prozor za rate-limit po Vercel instanci
const rateBuckets = new Map();

function pruneExpiredBuckets(nowMs, maxWindowMs) {
  if (rateBuckets.size < 500) return;
  for (const [k, timestamps] of rateBuckets.entries()) {
    const fresh = timestamps.filter((t) => nowMs - t < maxWindowMs);
    if (fresh.length === 0) rateBuckets.delete(k);
    else rateBuckets.set(k, fresh);
  }
}

/**
 * Provjerava i bilježi rate-limit u kliznom prozoru.
 * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
 */
export function checkRateLimit(bucketKey, limit, windowMs) {
  const now = Date.now();
  pruneExpiredBuckets(now, windowMs);

  const prev = rateBuckets.get(bucketKey) || [];
  const fresh = prev.filter((t) => now - t < windowMs);

  if (fresh.length >= limit) {
    const oldest = fresh[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateBuckets.set(bucketKey, fresh);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  fresh.push(now);
  rateBuckets.set(bucketKey, fresh);
  return {
    allowed: true,
    remaining: Math.max(0, limit - fresh.length),
    retryAfterSec: 0
  };
}

const REGIONAL_HR_PREFIXES = ['hr', 'bs', 'sr', 'sl', 'cnr'];

/**
 * Određuje jezik odgovora za API poruke grešaka ('hr' ili 'en', zadano 'en').
 */
export function resolveRequestLang(req) {
  const rawBodyLang = String(req?.body?.lang || '').trim().toLowerCase();
  if (rawBodyLang === 'hr' || rawBodyLang.startsWith('hr-')) return 'hr';
  if (rawBodyLang === 'en' || rawBodyLang.startsWith('en-')) return 'en';

  const acceptLang = String(req?.headers?.['accept-language'] || '').trim().toLowerCase();
  if (acceptLang) {
    const primary = acceptLang.split(',')[0].split(';')[0].trim();
    if (REGIONAL_HR_PREFIXES.some((p) => primary === p || primary.startsWith(`${p}-`))) {
      return 'hr';
    }
  }
  return 'en';
}

export function apiTr(req, hr, en) {
  return resolveRequestLang(req) === 'hr' ? hr : en;
}

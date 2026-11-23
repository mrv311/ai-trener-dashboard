/**
 * Vercel Serverless Function: Sigurna prijava putem Intervals.icu OAuth tokena
 *
 * Sigurnosni tok:
 * 1. Prima live Intervals.icu OAuth `access_token` s klijenta.
 * 2. Izravno ga verificira na `https://intervals.icu/api/v1/athlete/0` (nitko ne može lažirati tuđi ID!).
 * 3. Na serveru izvodi kriptografski HMAC-SHA256 lozinku (tajna je isključivo na serveru).
 * 4. Kreira ili migrira Supabase korisnika (`intervals_<id>@auth.ergvibe.app`) putem Service Role API-ja,
 *    briše eventualni stari `intervals_key` iz `user_metadata` i vraća valjanu Supabase sesiju.
 */

import crypto from 'node:crypto';
import { apiTr, applyStrictCors, checkRateLimit, getClientIp, getSupabaseConfig } from './_security.js';

export const config = {
  maxDuration: 30
};

function deriveServerPassword(cleanAthleteId, secret) {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`ergvibe:intervals:v2:${cleanAthleteId}`)
    .digest('base64url')
    .slice(0, 42);
  return `Ev2!${digest}Aa9#`;
}

async function signInWithSupabasePassword(supabaseUrl, anonKey, email, password) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

function buildAdminHeaders(serviceRoleKey, withJson = false) {
  const headers = { apikey: serviceRoleKey };
  // Novi Supabase `sb_secret_...` ključevi nisu JWT i šalju se samo u `apikey` zaglavlju;
  // legacy `service_role` JWT ključevi (`eyJ...`) zahtijevaju i `Authorization: Bearer`.
  if (!String(serviceRoleKey || '').startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }
  if (withJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function findSupabaseUserByEmail(supabaseUrl, serviceRoleKey, email) {
  const target = email.toLowerCase();
  // Pretraži stranice admin liste (za manje/srednje projekte) s filterom kad je podržan
  for (let page = 1; page <= 20; page++) {
    const resp = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`,
      {
        method: 'GET',
        headers: buildAdminHeaders(serviceRoleKey, false)
      }
    );
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => ({}));
    const users = Array.isArray(body?.users) ? body.users : [];
    const match = users.find((u) => String(u.email || '').toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) break;
  }
  return null;
}

export default async function handler(req, res) {
  const originOk = applyStrictCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(originOk ? 200 : 403).end();
  }

  if (!originOk) {
    return res.status(403).json({
      error: apiTr(req, 'Zabranjen pristup s neovlaštene domene.', 'Access forbidden from unauthorized origin.')
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: apiTr(req, 'Dozvoljena je samo POST metoda.', 'Method not allowed. Use POST.')
    });
  }

  // Osnovni anti-abuse rate limit po IP adresi (15 prijava u 15 min)
  const ip = getClientIp(req);
  const rl = checkRateLimit(`icu_auth:${ip}`, 15, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      error: apiTr(
        req,
        'Previše pokušaja prijave. Pokušaj ponovno za nekoliko minuta.',
        'Too many sign-in attempts. Please try again in a few minutes.'
      )
    });
  }

  const { url: supabaseUrl, anonKey, serviceRoleKey } = getSupabaseConfig();
  const hmacSecret = String(process.env.INTERVALS_AUTH_SECRET || serviceRoleKey || '').trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !hmacSecret) {
    return res.status(503).json({
      error: apiTr(
        req,
        'Sigurna Intervals.icu prijava zahtijeva SUPABASE_SERVICE_ROLE_KEY na Vercel poslužitelju.',
        'Secure Intervals.icu sign-in is temporarily unavailable (server auth configuration missing).'
      )
    });
  }

  try {
    const rawToken = String(req.body?.access_token || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (!rawToken || rawToken.length < 10) {
      return res.status(400).json({
        error: apiTr(req, 'Nedostaje valjani Intervals.icu OAuth token.', 'Missing valid Intervals.icu OAuth token.')
      });
    }

    // 1. Kriptografski dokaz identiteta: verificiraj token izravno na Intervals.icu API-ju!
    const icuRes = await fetch('https://intervals.icu/api/v1/athlete/0', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: 'application/json'
      }
    });

    if (!icuRes.ok) {
      return res.status(401).json({
        error: apiTr(
          req,
          'Intervals.icu token nije valjan ili je istekao. Pokušaj se prijaviti ponovno.',
          'Intervals.icu token is invalid or expired. Please sign in again.'
        )
      });
    }

    const athlete = await icuRes.json().catch(() => null);
    const verifiedAthleteId = String(athlete?.id || '').trim();
    const verifiedAthleteName = String(
      athlete?.name || [athlete?.firstname, athlete?.lastname].filter(Boolean).join(' ') || ''
    ).trim();

    if (!verifiedAthleteId) {
      return res.status(401).json({
        error: apiTr(req, 'Intervals.icu nije vratio ID sportaša.', 'Intervals.icu did not return an athlete ID.')
      });
    }

    const cleanAthleteId = verifiedAthleteId.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanAthleteId) {
      return res.status(400).json({
        error: apiTr(req, 'Neispravan format Intervals.icu ID-ja.', 'Invalid Intervals.icu athlete ID format.')
      });
    }

    const intervalsEmail = `intervals_${cleanAthleteId}@auth.ergvibe.app`;
    const strongPassword = deriveServerPassword(cleanAthleteId, hmacSecret);

    // 2. Pokušaj izravne prijave s jakom server-side lozinkom
    let signInRes = await signInWithSupabasePassword(supabaseUrl, anonKey, intervalsEmail, strongPassword);

    if (!signInRes.ok) {
      // Korisnik ili još ne postoji, ili ima staru (legacy) lozinku -> riješi preko Admin API-ja
      const existingUser = await findSupabaseUserByEmail(supabaseUrl, serviceRoleKey, intervalsEmail);

      if (existingUser?.id) {
        // Migriraj postojeći račun na jaku server-side lozinku i očisti eventualni spremljeni intervals_key!
        const nextMeta = { ...(existingUser.user_metadata || {}) };
        delete nextMeta.intervals_key;
        nextMeta.intervals_id = verifiedAthleteId;
        if (verifiedAthleteName) nextMeta.intervals_athlete_name = verifiedAthleteName;

        const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existingUser.id}`, {
          method: 'PUT',
          headers: buildAdminHeaders(serviceRoleKey, true),
          body: JSON.stringify({
            password: strongPassword,
            email_confirm: true,
            user_metadata: nextMeta
          })
        });

        if (!updateRes.ok) {
          const errBody = await updateRes.json().catch(() => ({}));
          throw new Error(
            errBody?.msg ||
              errBody?.message ||
              apiTr(req, 'Migracija korisničkog računa nije uspjela.', 'User account migration failed.')
          );
        }
      } else {
        // Kreiraj novi potvrđeni račun (nikada ne spremamo tajni intervals_key u Supabase metadata!)
        const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: buildAdminHeaders(serviceRoleKey, true),
          body: JSON.stringify({
            email: intervalsEmail,
            password: strongPassword,
            email_confirm: true,
            user_metadata: {
              intervals_id: verifiedAthleteId,
              intervals_athlete_name: verifiedAthleteName,
              username: verifiedAthleteName || apiTr(req, 'Vozač', 'Rider')
            }
          })
        });

        if (!createRes.ok) {
          const errBody = await createRes.json().catch(() => ({}));
          throw new Error(
            errBody?.msg ||
              errBody?.message ||
              apiTr(req, 'Kreiranje korisničkog računa nije uspjelo.', 'Failed to create user account.')
          );
        }
      }

      signInRes = await signInWithSupabasePassword(supabaseUrl, anonKey, intervalsEmail, strongPassword);
    }

    if (!signInRes.ok || !signInRes.data?.access_token || !signInRes.data?.refresh_token) {
      throw new Error(
        signInRes.data?.error_description ||
          signInRes.data?.msg ||
          apiTr(req, 'Nije moguće izdati Supabase sesiju.', 'Unable to issue session.')
      );
    }

    // Ako već ulogirani korisnik još ima stari intervals_key u user_metadata, očisti ga u pozadini
    if (signInRes.data?.user?.id && signInRes.data?.user?.user_metadata?.intervals_key) {
      const cleanedMeta = { ...signInRes.data.user.user_metadata };
      delete cleanedMeta.intervals_key;
      fetch(`${supabaseUrl}/auth/v1/admin/users/${signInRes.data.user.id}`, {
        method: 'PUT',
        headers: buildAdminHeaders(serviceRoleKey, true),
        body: JSON.stringify({ user_metadata: cleanedMeta })
      }).catch(() => {});
    }

    return res.status(200).json({
      session: {
        access_token: signInRes.data.access_token,
        refresh_token: signInRes.data.refresh_token
      },
      athleteId: verifiedAthleteId,
      athleteName: verifiedAthleteName
    });
  } catch (err) {
    console.error('[api/intervals-auth] Greška:', err);
    return res.status(500).json({
      error:
        err?.message ||
        apiTr(
          req,
          'Interna greška pri sigurnoj prijavi putem Intervals.icu.',
          'Internal error during secure Intervals.icu sign-in.'
        )
    });
  }
}

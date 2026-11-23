/**
 * Vercel Serverless Function: Sigurni Backend Proxy za Google Gemini AI
 *
 * - Ključ se čuva isključivo na serveru (process.env.GEMINI_API_KEY)
 * - Strogi CORS (samo ovlaštene domene)
 * - Klizni rate-limit za server ključ (gosti vs. prijavljeni korisnici vs. admin)
 * - Korisnici s vlastitim Gemini ključem (BYOK) nemaju ograničenje server kvote
 */

import {
  apiTr,
  applyStrictCors,
  checkRateLimit,
  getClientIp,
  verifySupabaseUser
} from './_security.js';

export const config = {
  maxDuration: 60
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_SERVER_PAYLOAD_BYTES = 1_500_000; // ~1.5 MB zaštita od spam payloadova na server ključu

export default async function handler(req, res) {
  const originOk = applyStrictCors(req, res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(originOk ? 200 : 403).end();
  }

  if (!originOk) {
    return res.status(403).json({
      error: apiTr(req, 'Zabranjen pristup s neovlaštene domene.', 'Access forbidden from unauthorized origin.')
    });
  }

  if (req.method === 'GET') {
    const serverKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    return res.status(200).json({
      ok: true,
      configured: Boolean(serverKey && String(serverKey).trim())
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: apiTr(req, 'Dozvoljena je samo POST metoda.', 'Method not allowed. Use POST.')
    });
  }

  try {
    const {
      systemInstruction,
      contents,
      model = 'gemini-3.8-flash',
      temperature = 0.4,
      responseMimeType = null,
      thinkingBudget = null,
      customApiKey = null
    } = req.body || {};

    // 1. Ključ: prioritet ima korisnikov privatni ključ (BYOK u tabu API Veze),
    // inače sigurni tajni ključ s Vercel servera (GEMINI_API_KEY)
    const serverKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const cleanCustomKey = typeof customApiKey === 'string' ? customApiKey.trim() : '';
    const isUsingCustomKey = Boolean(cleanCustomKey && cleanCustomKey !== String(serverKey || '').trim());
    const resolvedKey = isUsingCustomKey ? cleanCustomKey : String(serverKey || '').trim();

    if (!resolvedKey) {
      return res.status(500).json({
        error: apiTr(
          req,
          'Gemini API ključ nije konfiguriran na poslužitelju (GEMINI_API_KEY). Provjeri Vercel Environment Variables.',
          'Server Gemini API key is not configured. Enter your own Gemini API key in the Connections tab.'
        )
      });
    }

    // 2. Rate-limiting i zaštita troškova
    const clientIp = getClientIp(req);

    if (isUsingCustomKey) {
      // BYOK: samo osnovna anti-flood zaštita (60 zahtjeva/min po IP-u)
      const byokLimit = checkRateLimit(`gemini:byok:${clientIp}`, 60, 60 * 1000);
      if (!byokLimit.allowed) {
        res.setHeader('Retry-After', String(byokLimit.retryAfterSec));
        return res.status(429).json({
          error: apiTr(
            req,
            'Previše zahtjeva u kratkom roku. Pričekaj par sekundi i pokušaj ponovno.',
            'Too many requests in a short time. Please wait a few seconds and try again.'
          )
        });
      }
    } else {
      // Server ključ: provjeri veličinu payloada + autentifikaciju + hourly/daily kvote
      const approxBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
      if (approxBytes > MAX_SERVER_PAYLOAD_BYTES) {
        return res.status(413).json({
          error: apiTr(
            req,
            'Zahtjev je prevelik za dijeljeni AI poslužitelj. Smanji privitke ili unesi vlastiti Gemini API ključ u tabu API Veze.',
            'Request payload is too large for the shared AI server. Reduce attachments or add your own Gemini API key in the Connections tab.'
          )
        });
      }

      const authUser = await verifySupabaseUser(req);
      const isAdmin = Boolean(authUser?.isAdmin);

      if (!isAdmin) {
        const subjectKey = authUser?.id ? `user:${authUser.id}` : `guest:${clientIp}`;
        const hourlyCap = authUser?.id ? 30 : 6;
        const dailyCap = authUser?.id ? 80 : 18;

        const hourCheck = checkRateLimit(`gemini:h:${subjectKey}`, hourlyCap, HOUR_MS);
        const dayCheck = hourCheck.allowed
          ? checkRateLimit(`gemini:d:${subjectKey}`, dailyCap, DAY_MS)
          : hourCheck;

        if (!hourCheck.allowed || !dayCheck.allowed) {
          const retryAfter = !hourCheck.allowed ? hourCheck.retryAfterSec : dayCheck.retryAfterSec;
          res.setHeader('Retry-After', String(retryAfter));
          return res.status(429).json({
            error: authUser?.id
              ? apiTr(
                  req,
                  'Dosegnuto je privremeno ograničenje besplatnog AI poslužitelja. Pričekaj malo ili u tabu API Veze unesi vlastiti besplatni Google Gemini API ključ za neograničen rad.',
                  'Temporary free AI server rate limit reached. Please wait a bit or add your own free Google Gemini API key in the Connections tab for unlimited use.'
                )
              : apiTr(
                  req,
                  'Gosti imaju ograničen broj besplatnih AI upita po satu. Prijavi se besplatno ili unesi vlastiti Gemini API ključ u tabu API Veze.',
                  'Guests have a limited number of free AI requests per hour. Sign in for higher limits or add your own free Gemini API key in the Connections tab.'
                )
          });
        }
      }
    }

    // 3. ZAŠTITA OD NEŽELJENIH TROŠKOVA:
    // Na server ključu UVIJEK forsiraj Flash model; Pro model samo uz vlastiti (BYOK) ključ.
    let targetModel = model || 'gemini-3.8-flash';
    if (!isUsingCustomKey && String(targetModel).toLowerCase().includes('pro')) {
      targetModel = 'gemini-3.8-flash';
    }

    const isProModel = String(targetModel).toLowerCase().includes('pro');
    const resolvedThinkingBudget = Number.isFinite(Number(thinkingBudget)) && thinkingBudget !== null
      ? Number(thinkingBudget)
      : (isProModel ? 2048 : 512);

    // 4. Priprema tijela za Google Gemini v1beta REST API
    const buildGoogleBody = (includeThinking = true) => ({
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents: Array.isArray(contents) ? contents : [],
      generationConfig: {
        temperature: Number(temperature) || 0.4,
        maxOutputTokens: 16384,
        ...(responseMimeType ? { responseMimeType } : {}),
        ...(includeThinking ? { thinkingConfig: { thinkingBudget: resolvedThinkingBudget } } : {})
      }
    });

    // 5. Poziv prema Googleu s automatskim fallbackom ako verzija modela vrati 404
    const execute = async (m, includeThinking = true) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(resolvedKey)}`;
      const resFetch = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGoogleBody(includeThinking))
      });
      if (resFetch.status === 400 && includeThinking) {
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGoogleBody(false))
        });
      }
      return resFetch;
    };

    const candidateModels = isProModel
      ? [...new Set([targetModel, 'gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-3.8-flash'])]
      : [...new Set([targetModel, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'])];

    let googleRes = null;
    for (const candidate of candidateModels) {
      googleRes = await execute(candidate);
      if (googleRes.status !== 404) break;
    }

    if (!googleRes.ok) {
      let errDetail = `Google HTTP ${googleRes.status}`;
      try {
        const errJson = await googleRes.json();
        if (errJson?.error?.message) errDetail = errJson.error.message;
      } catch {}
      // Nikada ne vraćaj 404 klijentu kako klijent ne bi pomislio da /api/gemini ruta ne postoji
      const outStatus = googleRes.status === 404 ? 502 : googleRes.status;
      return res.status(outStatus).json({ error: errDetail });
    }

    const data = await googleRes.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(500).json({
        error: apiTr(req, 'Gemini nije vratio tekstualni odgovor.', 'Gemini did not return a text response.')
      });
    }

    return res.status(200).json({ text, raw: data });
  } catch (err) {
    console.error('[api/gemini] Poslužiteljska greška:', err);
    return res.status(500).json({
      error: err.message || apiTr(req, 'Interna poslužiteljska greška.', 'Internal server error.')
    });
  }
}

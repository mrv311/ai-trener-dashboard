/**
 * Vercel Serverless Function: Sigurni Proxy za Intervals.icu OAuth Token Exchange
 */

import { apiTr, applyStrictCors } from './_security.js';

export const config = {
  maxDuration: 30
};

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

  try {
    const { code, code_verifier, redirect_uri, client_id } = req.body || {};

    if (!code || !code_verifier || !redirect_uri) {
      return res.status(400).json({
        error: apiTr(
          req,
          'Nedostaju obavezni parametri: code, code_verifier ili redirect_uri.',
          'Missing required OAuth parameters: code, code_verifier, or redirect_uri.'
        )
      });
    }

    const bodyParams = new URLSearchParams({
      client_id: String(client_id || '1787'),
      code: String(code),
      code_verifier: String(code_verifier),
      grant_type: 'authorization_code',
      redirect_uri: String(redirect_uri)
    });

    const response = await fetch('https://intervals.icu/api/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyParams.toString()
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error ||
          data.message ||
          apiTr(req, `Intervals API greška: HTTP ${response.status}`, `Intervals.icu API error: HTTP ${response.status}`),
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[intervals-token proxy] Greška:', err);
    return res.status(500).json({
      error: err.message || apiTr(req, 'Interna greška poslužitelja.', 'Internal server error.')
    });
  }
}

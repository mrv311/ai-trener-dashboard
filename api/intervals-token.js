/**
 * Vercel Serverless Function: Sigurni Proxy za Intervals.icu OAuth Token Exchange
 */

export const config = {
  maxDuration: 30
};

export default async function handler(req, res) {
  // CORS podrška za sve preglednike
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Dozvoljena je samo POST metoda.' });
  }

  try {
    const { code, code_verifier, redirect_uri, client_id } = req.body || {};

    if (!code || !code_verifier || !redirect_uri) {
      return res.status(400).json({ error: 'Nedostaju obavezni parametri: code, code_verifier ili redirect_uri.' });
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
        error: data.error || data.message || `Intervals API greška: HTTP ${response.status}`,
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[intervals-token proxy] Greška:', err);
    return res.status(500).json({ error: err.message || 'Interna greška poslužitelja.' });
  }
}

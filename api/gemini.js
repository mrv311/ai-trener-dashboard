/**
 * Vercel Serverless Function: Sigurni Backend Proxy za Google Gemini AI
 * 
 * Ključ se čuva na serveru (process.env.GEMINI_API_KEY) i NIKADA se ne šalje u preglednik korisnika.
 * To sprječava krađu ključa i zlouporabu izvan aplikacije.
 */

export default async function handler(req, res) {
  // CORS podrška
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Dozvoljena je samo POST metoda.' });
  }

  try {
    const {
      systemInstruction,
      contents,
      model = 'gemini-2.5-flash',
      temperature = 0.4,
      responseMimeType = null,
      customApiKey = null
    } = req.body || {};

    // 1. Ključ: prioritet ima korisnikov privatni ključ (ako ga je unio u tabu Veze),
    // inače sigurni tajni ključ s Vercel servera (GEMINI_API_KEY)
    const serverKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const resolvedKey = String(customApiKey || serverKey || '').trim();

    if (!resolvedKey) {
      return res.status(500).json({
        error: 'Gemini API ključ nije konfiguriran na poslužitelju (GEMINI_API_KEY). Provjeri Vercel Environment Variables.'
      });
    }

    // 2. ZAŠTITA OD NEŽELJENIH TROŠKOVA:
    // Ako se koristi server ključ (za frendove i goste), UVIJEK forsiraj Flash model!
    // Pro model je dopušten isključivo ako je korisnik poslao svoj privatni ključ.
    const isServerKey = !customApiKey || customApiKey.trim() === serverKey;
    let targetModel = model;
    if (isServerKey && String(targetModel).toLowerCase().includes('pro')) {
      targetModel = 'gemini-2.5-flash';
    }

    // 3. Priprema tijela za Google Gemini v1beta REST API
    const body = {
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents: Array.isArray(contents) ? contents : [],
      generationConfig: {
        temperature: Number(temperature) || 0.4,
        maxOutputTokens: 16384,
        ...(responseMimeType ? { responseMimeType } : {})
      }
    };

    // 4. Poziv prema Googleu s automatskim fallbackom ako verzija modela vrati 404
    const execute = async (m) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(resolvedKey)}`;
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    };

    let googleRes = await execute(targetModel);

    // Fallback ako specifični model vrati 404
    if (googleRes.status === 404) {
      const fallback = targetModel.toLowerCase().includes('pro') ? 'gemini-pro-latest' : 'gemini-2.5-flash';
      if (targetModel !== fallback) {
        googleRes = await execute(fallback);
      }
      if (googleRes.status === 404) {
        googleRes = await execute('gemini-1.5-flash');
      }
    }

    if (!googleRes.ok) {
      let errDetail = `Google HTTP ${googleRes.status}`;
      try {
        const errJson = await googleRes.json();
        if (errJson?.error?.message) errDetail = errJson.error.message;
      } catch {}
      return res.status(googleRes.status).json({ error: errDetail });
    }

    const data = await googleRes.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.filter(p => !p.thought)
      ?.map(p => p.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(500).json({ error: 'Gemini nije vratio tekstualni odgovor.' });
    }

    return res.status(200).json({ text, raw: data });
  } catch (err) {
    console.error('[api/gemini] Poslužiteljska greška:', err);
    return res.status(500).json({ error: err.message || 'Interna poslužiteljska greška.' });
  }
}

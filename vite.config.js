import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      {
        name: 'local-gemini-proxy',
        configureServer(server) {
          server.middlewares.use('/api/intervals-token', async (req, res, next) => {
            if (req.method === 'POST') {
              let bodyStr = '';
              req.on('data', chunk => { bodyStr += chunk; });
              req.on('end', async () => {
                try {
                  const payload = JSON.parse(bodyStr || '{}');
                  const bodyParams = new URLSearchParams({
                    client_id: String(payload.client_id || '1787'),
                    code: String(payload.code || ''),
                    code_verifier: String(payload.code_verifier || ''),
                    grant_type: 'authorization_code',
                    redirect_uri: String(payload.redirect_uri || '')
                  });
                  const resp = await fetch('https://intervals.icu/api/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: bodyParams.toString()
                  });
                  const data = await resp.json().catch(() => ({}));
                  res.statusCode = resp.status;
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify(data));
                } catch (e) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ error: e.message }));
                }
              });
              return;
            }
            next();
          });

          server.middlewares.use('/api/gemini', async (req, res, next) => {
            if (req.method === 'GET') {
              const serverKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({
                ok: true,
                configured: Boolean(serverKey && String(serverKey).trim())
              }));
            }
            if (req.method === 'POST') {
              let bodyStr = '';
              req.on('data', chunk => { bodyStr += chunk; });
              req.on('end', async () => {
                try {
                  const payload = JSON.parse(bodyStr || '{}');
                  const apiKey = payload.customApiKey || env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;

                  if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({
                      error: 'GEMINI_API_KEY ili VITE_GEMINI_API_KEY nije postavljen u lokalnom .env'
                    }));
                  }

                  let targetModel = payload.model || 'gemini-3.8-flash';
                  if (!payload.customApiKey && targetModel.toLowerCase().includes('pro')) {
                    targetModel = 'gemini-3.8-flash';
                  }

                  const isProModel = targetModel.toLowerCase().includes('pro');
                  const resolvedThinkingBudget = Number.isFinite(Number(payload.thinkingBudget)) && payload.thinkingBudget !== null
                    ? Number(payload.thinkingBudget)
                    : (isProModel ? 2048 : 512);

                  const buildGoogleBody = (includeThinking = true) => ({
                    ...(payload.systemInstruction ? { systemInstruction: { parts: [{ text: payload.systemInstruction }] } } : {}),
                    contents: payload.contents || [],
                    generationConfig: {
                      temperature: payload.temperature || 0.4,
                      maxOutputTokens: 16384,
                      ...(payload.responseMimeType ? { responseMimeType: payload.responseMimeType } : {}),
                      ...(includeThinking ? { thinkingConfig: { thinkingBudget: resolvedThinkingBudget } } : {})
                    }
                  });

                  const execute = async (m, includeThinking = true) => {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
                    const r = await fetch(url, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(buildGoogleBody(includeThinking))
                    });
                    if (r.status === 400 && includeThinking) {
                      return fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildGoogleBody(false))
                      });
                    }
                    return r;
                  };

                  const candidateModels = isProModel
                    ? [...new Set([targetModel, 'gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-3.8-flash'])]
                    : [...new Set([targetModel, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'])];

                  let gRes = null;
                  for (const candidate of candidateModels) {
                    gRes = await execute(candidate);
                    if (gRes.status !== 404) break;
                  }

                  if (!gRes.ok) {
                    const errData = await gRes.json().catch(() => ({}));
                    res.statusCode = gRes.status === 404 ? 502 : gRes.status;
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({ error: errData?.error?.message || `Google HTTP ${gRes.status}` }));
                  }

                  const data = await gRes.json();
                  const text = data?.candidates?.[0]?.content?.parts
                    ?.filter(p => !p.thought)
                    ?.map(p => p.text || '')
                    .join('')
                    .trim();

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ text, raw: data }));
                } catch (e) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: e.message }));
                }
              });
            } else {
              next();
            }
          });
        }
      }
    ],
  };
});

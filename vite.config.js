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
          server.middlewares.use('/api/gemini', async (req, res, next) => {
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

                  let targetModel = payload.model || 'gemini-2.5-flash';
                  if (!payload.customApiKey && targetModel.toLowerCase().includes('pro')) {
                    targetModel = 'gemini-2.5-flash';
                  }

                  const googleBody = {
                    ...(payload.systemInstruction ? { systemInstruction: { parts: [{ text: payload.systemInstruction }] } } : {}),
                    contents: payload.contents || [],
                    generationConfig: {
                      temperature: payload.temperature || 0.4,
                      maxOutputTokens: 16384,
                      ...(payload.responseMimeType ? { responseMimeType: payload.responseMimeType } : {})
                    }
                  };

                  const execute = async (m) => {
                    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(googleBody)
                    });
                  };

                  let gRes = await execute(targetModel);
                  if (gRes.status === 404) {
                    gRes = await execute('gemini-2.5-flash');
                  }
                  if (gRes.status === 404) {
                    gRes = await execute('gemini-1.5-flash');
                  }

                  if (!gRes.ok) {
                    const errData = await gRes.json().catch(() => ({}));
                    res.statusCode = gRes.status;
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

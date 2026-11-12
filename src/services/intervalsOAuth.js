/**
 * Intervals.icu OAuth 2.0 PKCE Service za ErgVibe
 * 
 * Implementira autorizaciju javnog klijenta (Public Client) s PKCE S256 zaštitom.
 * Nije potreban niti dopušten Client Secret u pregledniku.
 */

export const INTERVALS_OAUTH_CLIENT_ID = '1787';

export const INTERVALS_OAUTH_SCOPES = [
  'ACTIVITY:READ',
  'ACTIVITY:WRITE',
  'WELLNESS:READ',
  'CALENDAR:READ',
  'CALENDAR:WRITE',
  'SETTINGS:READ'
].join(',');

/**
 * Generira siguran kriptografski verifier (43-128 znakova)
 */
function generateCodeVerifier(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, byte => chars[byte % chars.length]).join('');
}

/**
 * Generira SHA-256 base64url challenge iz verifiera
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Određuje točan Redirect URI na temelju trenutne domene
 */
export function getRedirectUri() {
  if (typeof window === 'undefined') return 'https://ergvibe.vercel.app/';
  const origin = window.location.origin;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return 'http://localhost:5173/';
  }
  return 'https://ergvibe.vercel.app/';
}

/**
 * Pokreće Intervals.icu OAuth autorizaciju (preusmjerava korisnika na Intervals)
 */
export async function startIntervalsOAuth() {
  const verifier = generateCodeVerifier(64);
  const challenge = await generateCodeChallenge(verifier);
  const state = 'ergvibe_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  const redirectUri = getRedirectUri();

  // Spremi u sessionStorage za sigurnu provjeru po povratku
  window.sessionStorage.setItem('ergvibe_intervals_oauth_verifier', verifier);
  window.sessionStorage.setItem('ergvibe_intervals_oauth_state', state);
  window.sessionStorage.setItem('ergvibe_intervals_oauth_redirect_uri', redirectUri);

  const authUrl = new URL('https://intervals.icu/oauth/authorize');
  authUrl.searchParams.set('client_id', INTERVALS_OAUTH_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', INTERVALS_OAUTH_SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  window.location.href = authUrl.toString();
}

/**
 * Obrađuje povratni kod (exchange code za access_token)
 */
export async function handleIntervalsOAuthCallback(code, state) {
  const savedState = window.sessionStorage.getItem('ergvibe_intervals_oauth_state');
  const verifier = window.sessionStorage.getItem('ergvibe_intervals_oauth_verifier');
  const redirectUri = window.sessionStorage.getItem('ergvibe_intervals_oauth_redirect_uri') || getRedirectUri();

  // Očisti privremene tokene iz sesije
  window.sessionStorage.removeItem('ergvibe_intervals_oauth_state');
  window.sessionStorage.removeItem('ergvibe_intervals_oauth_verifier');
  window.sessionStorage.removeItem('ergvibe_intervals_oauth_redirect_uri');

  if (savedState && state && savedState !== state) {
    throw new Error('Sigurnosna provjera nije uspjela (neispravan OAuth state). Pokušajte ponovno.');
  }

  if (!verifier) {
    throw new Error('Nedostaje OAuth verifier. Pokrenite postupak povezivanja ponovno.');
  }

  const payload = {
    client_id: INTERVALS_OAUTH_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  };

  // Pokušaj 1: preko lokalnog / Vercel proxyja
  try {
    const proxyRes = await fetch('/api/intervals-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      return formatTokenResponse(data);
    }
  } catch (proxyErr) {
    console.warn('[Intervals OAuth] Proxy greška, pokušavam izravni poziv:', proxyErr);
  }

  // Pokušaj 2: Izravni poziv prema Intervals.icu ako proxy nije dostupan
  const directBody = new URLSearchParams({
    client_id: INTERVALS_OAUTH_CLIENT_ID,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const directRes = await fetch('https://intervals.icu/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: directBody.toString()
  });

  if (!directRes.ok) {
    const errData = await directRes.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || `Greška pri preuzimanju tokena (HTTP ${directRes.status})`);
  }

  const directData = await directRes.json();
  return formatTokenResponse(directData);
}

function formatTokenResponse(data) {
  if (!data?.access_token) {
    throw new Error('Poslužitelj nije vratio valjani access token.');
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    // Sprema se s prefiksom Bearer za transparentno prepoznavanje u API pozivima
    authKey: `Bearer ${data.access_token}`,
    athlete: data.athlete || null,
    athleteId: data.athlete?.id || '0',
    athleteName: data.athlete?.name || ''
  };
}

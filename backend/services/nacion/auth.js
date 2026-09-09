const axios = require('axios');
const { createHash } = require('crypto');
const { nacionTransportOptions } = require('./transport');

const tokenCache = new Map();
const inflight = new Map();
const EXPIRY_MARGIN_MS = 30000;

function buildBasicAuthHeader(user, password) {
  const token = Buffer.from(`${String(user || '')}:${String(password || '')}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function buildNacionLoginRequest({ user, password } = {}) {
  const username = String(user || '').trim();
  const secret = String(password || '').trim();
  if (!username || !secret) {
    throw new Error('Nacion auth requiere usuario y password');
  }

  return {
    url: '/login',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: { username, password: secret },
  };
}

function parseJwtExp(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const raw = Buffer.from(padded, 'base64').toString('utf8');
    const json = JSON.parse(raw);
    return Number(json?.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function parseNacionLoginResponse(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const accessToken = String(
    body.access_token ||
    body.accessToken ||
    body.token ||
    ''
  ).trim();
  const refreshToken = String(
    body.refresh_token ||
    body.refreshToken ||
    ''
  ).trim();
  const tokenType = String(body.token_type || body.tokenType || 'Bearer').trim() || 'Bearer';
  const expiresIn = Number(body.expires_in || body.expiresIn || 0);
  const refreshExpiresIn = Number(body.refresh_expires_in || body.refreshExpiresIn || 0);
  const ok = accessToken !== '';
  const expiresAt = parseJwtExp(accessToken) || (expiresIn > 0 ? Date.now() + (expiresIn * 1000) : 0);
  const refreshExpiresAt = parseJwtExp(refreshToken) || (refreshExpiresIn > 0 ? Date.now() + (refreshExpiresIn * 1000) : 0);

  return {
    ok,
    accessToken,
    refreshToken,
    tokenType,
    expiresIn,
    refreshExpiresIn,
    expiresAt,
    refreshExpiresAt,
    // Keep provider's date for diagnostics. Do not parse its ambiguous local
    // timezone with Date.parse; JWT exp is an absolute timestamp.
    expirationDate: String(body.expiration_date || ''),
    roles: body.roles || {},
  };
}

function resolveAuthConfig(cfg = {}) {
  if (cfg?.parametros_extras?.skeleton_only) {
    throw new Error('Nacion esta en modo skeleton_only; autenticacion operativa deshabilitada');
  }

  const authUrl = String(cfg.auth_url || '').trim();
  const user = String(cfg.auth_user || cfg.usuario || '').trim();
  const password = String(cfg.auth_password || cfg.password || '').trim();
  if (!authUrl || !user || !password) {
    throw new Error('Nacion requiere auth_url, auth_user y auth_password configurados');
  }

  const base = authUrl.replace(/\/+$/, '').replace(/\/(?:login|renew)$/i, '');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Nacion auth requiere HTTPS sin credenciales en URL');
  }
  const key = createHash('sha256').update(JSON.stringify([base, user, password, cfg.ca_file || process.env.NACION_CA_FILE || ''])).digest('hex');
  return { base, user, password, key };
}

async function requestToken(cfg, base, method, body) {
  let resp;
  try {
    resp = await axios.post(`${base}/${method}`, body, {
      ...nacionTransportOptions(cfg),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  } catch (cause) {
    // Axios errors contain the credential-bearing request. Never propagate it.
    const error = new Error(`Nacion ${method}: error de transporte`);
    error.code = cause.code || 'NACION_AUTH_TRANSPORT';
    throw error;
  }
  const parsed = parseNacionLoginResponse(resp.data);
  if (!(resp.status >= 200 && resp.status < 300) || !parsed.ok) {
    // Do not echo arbitrary provider messages, which may contain credentials.
    const error = new Error(`Nacion ${method} fallo (HTTP ${resp.status})`);
    error.http_status = resp.status;
    error.code = 'NACION_AUTH_REJECTED';
    throw error;
  }
  return parsed;
}

async function fetchNacionToken(cfg = {}) {
  const { base, user, password, key } = resolveAuthConfig(cfg);
  const previous = tokenCache.get(key);
  if (previous?.expiresAt > Date.now() + EXPIRY_MARGIN_MS) return previous;
  if (inflight.has(key)) return inflight.get(key);

  const pending = (async () => {
    let token;
    if (previous?.refreshToken && previous.refreshExpiresAt > Date.now() + EXPIRY_MARGIN_MS) {
      try {
        token = await requestToken(cfg, base, 'renew', { refresh_token: previous.refreshToken });
      } catch (error) {
        // Only rejected refresh credentials justify falling back to login.
        // Timeouts, rate limits and server errors must not cause a login storm.
        if (![400, 401, 403].includes(error.http_status)) throw error;
      }
    }
    if (!token) {
      token = await requestToken(cfg, base, 'login', buildNacionLoginRequest({ user, password }).body);
    }
    // Unknown JWT expiry is usable for this call only, never guessed as 5 min.
    tokenCache.set(key, token);
    return token;
  })();
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

function clearNacionTokenCache() {
  tokenCache.clear();
}

module.exports = {
  buildBasicAuthHeader,
  buildNacionLoginRequest,
  fetchNacionToken,
  parseJwtExp,
  parseNacionLoginResponse,
  clearNacionTokenCache,
};

const axios = require('axios');
const { getMercantilAndinaHttpsAgent } = require('./tls');

const tokenCache = new Map();

function trimText(value) {
  return String(value || '').trim();
}

function getSubscriptionKey(cfg = {}) {
  return trimText(cfg.subscription_key || cfg.subscriptionKey || cfg.api_key || cfg.apiKey);
}

function getAuthUrl(cfg = {}) {
  return trimText(cfg.auth_url || cfg.token_url || cfg.login_url).replace(/\/+$/, '/');
}

function parseToken(payload) {
  if (typeof payload === 'string') {
    const raw = trimText(payload);
    if (!raw) return '';
    try {
      return parseToken(JSON.parse(raw));
    } catch {
      return raw.replace(/^Bearer\s+/i, '');
    }
  }
  if (!payload || typeof payload !== 'object') return '';
  return trimText(
    payload.access_token ||
    payload.token ||
    payload.jwt ||
    payload.id_token ||
    payload?.data?.access_token ||
    payload?.data?.token ||
    payload?.resultado?.access_token ||
    payload?.resultado?.token
  ).replace(/^Bearer\s+/i, '');
}

function parseJwtExpiryMs(token) {
  const parts = trimText(token).split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function resolveTokenExpiresAt(payload, accessToken, cfg = {}, nowMs = Date.now()) {
  const explicit = Number(
    payload?.expires_in ?? payload?.expiresIn ?? payload?.data?.expires_in ?? payload?.data?.expiresIn
  );
  if (Number.isFinite(explicit) && explicit > 0) return nowMs + explicit * 1000;

  const absolute = payload?.expires_at ?? payload?.expiresAt ?? payload?.data?.expires_at ?? payload?.data?.expiresAt;
  if (absolute != null && absolute !== '') {
    const numeric = Number(absolute);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(String(absolute));
    if (Number.isFinite(parsed)) return parsed;
  }

  const jwtExpiry = parseJwtExpiryMs(accessToken);
  if (jwtExpiry) return jwtExpiry;

  const configuredTtl = Number(cfg?.parametros_extras?.token_ttl_ms || 55 * 60 * 1000);
  return nowMs + (Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 55 * 60 * 1000);
}

function isTokenUsable(tokenData, cfg = {}, nowMs = Date.now()) {
  if (!tokenData?.accessToken) return false;
  const skew = Number(cfg?.parametros_extras?.token_refresh_skew_ms || 60 * 1000);
  const safetyMs = Number.isFinite(skew) && skew >= 0 ? skew : 60 * 1000;
  return !Number.isFinite(tokenData.expiresAt) || tokenData.expiresAt - safetyMs > nowMs;
}

function buildAuthHeaders(cfg = {}) {
  const user = trimText(cfg.usuario || cfg.user || cfg.username);
  const pass = trimText(cfg.password || cfg.pass);
  const subscriptionKey = getSubscriptionKey(cfg);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (subscriptionKey) headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;
  if (cfg.basic_auth === true && (user || pass)) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return headers;
}

function buildAuthBody(cfg = {}) {
  const user = trimText(cfg.usuario || cfg.user || cfg.username);
  const pass = trimText(cfg.password || cfg.pass);
  const clientId = trimText(cfg.client_id || cfg.clientId || cfg?.parametros_extras?.client_id || 'api-clientes-login');
  const grantType = trimText(cfg.grant_type || cfg.grantType || cfg?.parametros_extras?.grant_type || 'password');
  const body = new URLSearchParams();
  if (clientId) body.set('client_id', clientId);
  body.set('username', user);
  body.set('password', pass);
  if (grantType) body.set('grant_type', grantType);
  return body.toString();
}

function cacheKey(cfg = {}) {
  return [
    getAuthUrl(cfg),
    trimText(cfg.usuario || cfg.user || cfg.username),
    getSubscriptionKey(cfg),
  ].join('|');
}

async function fetchMercantilAndinaToken(cfg = {}, { forceRefresh = false } = {}) {
  const configured = trimText(cfg.access_token || cfg.bearer_token).replace(/^Bearer\s+/i, '');
  const hasLoginCredentials = Boolean(trimText(cfg.usuario || cfg.user || cfg.username) && trimText(cfg.password || cfg.pass));
  if (configured && !(forceRefresh && hasLoginCredentials)) {
    return { accessToken: configured, raw: { source: 'config' }, expiresAt: Number.POSITIVE_INFINITY };
  }

  const authUrl = getAuthUrl(cfg);
  const subscriptionKey = getSubscriptionKey(cfg);
  const user = trimText(cfg.usuario || cfg.user || cfg.username);
  const pass = trimText(cfg.password || cfg.pass);
  if (!authUrl) throw new Error('Mercantil Andina requiere auth_url configurado');
  if (!subscriptionKey) throw new Error('Mercantil Andina requiere subscription_key configurado');
  if (!user || !pass) throw new Error('Mercantil Andina requiere usuario y password para login');

  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (!forceRefresh && isTokenUsable(cached, cfg)) return cached;
  if (forceRefresh || cached) tokenCache.delete(key);

  const timeout = Number(cfg?.parametros_extras?.auth_timeout_ms || cfg?.parametros_extras?.request_timeout_ms || 30000);
  const resp = await axios.post(authUrl, buildAuthBody(cfg), {
    headers: buildAuthHeaders(cfg),
    httpsAgent: getMercantilAndinaHttpsAgent(),
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 30000,
    validateStatus: () => true,
  });

  const accessToken = parseToken(resp.data);
  if (!(resp.status >= 200 && resp.status < 300) || !accessToken) {
    const err = new Error(`Mercantil Andina login fallo con HTTP ${resp.status}`);
    err.status = resp.status;
    err.responseData = resp.data;
    throw err;
  }

  const tokenData = {
    accessToken,
    raw: resp.data,
    acquiredAt: Date.now(),
    expiresAt: resolveTokenExpiresAt(resp.data, accessToken, cfg),
  };
  tokenCache.set(key, tokenData);
  return tokenData;
}

function clearMercantilAndinaTokenCache(cfg = null) {
  if (cfg) tokenCache.delete(cacheKey(cfg));
  else tokenCache.clear();
}

module.exports = {
  buildAuthHeaders,
  buildAuthBody,
  clearMercantilAndinaTokenCache,
  fetchMercantilAndinaToken,
  getAuthUrl,
  getSubscriptionKey,
  isTokenUsable,
  parseToken,
  parseJwtExpiryMs,
  resolveTokenExpiresAt,
};

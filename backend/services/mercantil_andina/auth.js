const axios = require('axios');

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

async function fetchMercantilAndinaToken(cfg = {}) {
  const configured = trimText(cfg.access_token || cfg.bearer_token).replace(/^Bearer\s+/i, '');
  if (configured) return { accessToken: configured, raw: { source: 'config' } };

  const authUrl = getAuthUrl(cfg);
  const subscriptionKey = getSubscriptionKey(cfg);
  const user = trimText(cfg.usuario || cfg.user || cfg.username);
  const pass = trimText(cfg.password || cfg.pass);
  if (!authUrl) throw new Error('Mercantil Andina requiere auth_url configurado');
  if (!subscriptionKey) throw new Error('Mercantil Andina requiere subscription_key configurado');
  if (!user || !pass) throw new Error('Mercantil Andina requiere usuario y password para login');

  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (cached?.accessToken) return cached;

  const timeout = Number(cfg?.parametros_extras?.auth_timeout_ms || cfg?.parametros_extras?.request_timeout_ms || 30000);
  const resp = await axios.post(authUrl, buildAuthBody(cfg), {
    headers: buildAuthHeaders(cfg),
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

  const tokenData = { accessToken, raw: resp.data };
  tokenCache.set(key, tokenData);
  return tokenData;
}

function clearMercantilAndinaTokenCache() {
  tokenCache.clear();
}

module.exports = {
  buildAuthHeaders,
  buildAuthBody,
  clearMercantilAndinaTokenCache,
  fetchMercantilAndinaToken,
  getAuthUrl,
  getSubscriptionKey,
  parseToken,
};

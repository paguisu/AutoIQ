const axios = require('axios');
const {
  buildProvinciaResponseError,
  runProvinciaRequest,
} = require('./http');

const tokenCache = new Map();
const tokenPromiseCache = new Map();

function trimText(value) {
  return String(value || '').trim();
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

function buildProvinciaTokenRequest({
  clientId = 'ps2',
  clientSecret = '',
  username = '',
  password = '',
  grantType = 'password',
} = {}) {
  const normalizedUser = trimText(username);
  const normalizedPassword = trimText(password);
  const normalizedClientId = trimText(clientId) || 'ps2';
  const normalizedClientSecret = trimText(clientSecret);
  const normalizedGrantType = trimText(grantType) || 'password';

  if (!normalizedUser || !normalizedPassword) {
    throw new Error('Provincia auth requiere usuario y password');
  }
  if (!normalizedClientSecret) {
    throw new Error('Provincia auth requiere client_secret');
  }

  return {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: {
      client_id: normalizedClientId,
      client_secret: normalizedClientSecret,
      username: normalizedUser,
      password: normalizedPassword,
      grant_type: normalizedGrantType,
    },
  };
}

function parseProvinciaTokenResponse(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const accessToken = trimText(body.access_token || body.accessToken || body.token);
  const refreshToken = trimText(body.refresh_token || body.refreshToken);
  const tokenType = trimText(body.token_type || body.tokenType || 'Bearer') || 'Bearer';
  const expiresIn = Number(body.expires_in || body.expiresIn || 0);
  const refreshExpiresIn = Number(body.refresh_expires_in || body.refreshExpiresIn || 0);
  const ok = accessToken !== '';
  const expiresAt = parseJwtExp(accessToken) || (expiresIn > 0 ? Date.now() + (expiresIn * 1000) : 0);
  const refreshExpiresAt = refreshExpiresIn > 0 ? Date.now() + (refreshExpiresIn * 1000) : 0;

  return {
    ok,
    accessToken,
    refreshToken,
    tokenType,
    expiresIn,
    refreshExpiresIn,
    expiresAt,
    refreshExpiresAt,
    raw: body,
  };
}

function getProvinciaTokenCacheKey(cfg = {}) {
  return JSON.stringify({
    auth_url: trimText(cfg.auth_url),
    client_id: trimText(cfg.client_id || 'ps2'),
    usuario: trimText(cfg.usuario),
  });
}

async function fetchProvinciaToken(cfg = {}) {
  const cacheKey = getProvinciaTokenCacheKey(cfg);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached;
  if (tokenPromiseCache.has(cacheKey)) return tokenPromiseCache.get(cacheKey);

  const promise = (async () => {
    const authUrl = trimText(cfg.auth_url);
    if (!authUrl) throw new Error('Provincia requiere auth_url configurado');

    const request = buildProvinciaTokenRequest({
      clientId: cfg.client_id || 'ps2',
      clientSecret: cfg.client_secret,
      username: cfg.usuario,
      password: cfg.password,
      grantType: cfg.grant_type || 'password',
    });

    const parsed = await runProvinciaRequest({
      cfg,
      prefix: 'auth',
      defaultTimeoutMs: 45000,
      defaultRetries: 2,
      defaultRetryDelayMs: 1500,
      executor: async ({ timeoutMs }) => {
        const resp = await axios.post(authUrl, new URLSearchParams(request.body).toString(), {
          headers: request.headers,
          timeout: timeoutMs,
          validateStatus: () => true,
        });

        const token = parseProvinciaTokenResponse(resp.data);
        if (!(resp.status >= 200 && resp.status < 300) || !token.ok) {
          const reason = trimText(
            token?.raw?.error_description ||
            token?.raw?.error ||
            token?.raw?.message ||
            `HTTP ${resp.status}`
          );
          throw buildProvinciaResponseError(`Provincia auth fallo: ${reason}`, resp);
        }

        return token;
      },
    });

    tokenCache.set(cacheKey, parsed);
    return parsed;
  })().finally(() => {
    tokenPromiseCache.delete(cacheKey);
  });

  tokenPromiseCache.set(cacheKey, promise);
  return promise;
}

function __resetProvinciaAuthStateForTests() {
  tokenCache.clear();
  tokenPromiseCache.clear();
}

function clearProvinciaTokenCache(cfg = {}) {
  if (!cfg || Object.keys(cfg).length === 0) {
    __resetProvinciaAuthStateForTests();
    return;
  }
  const cacheKey = getProvinciaTokenCacheKey(cfg);
  tokenCache.delete(cacheKey);
  tokenPromiseCache.delete(cacheKey);
}

module.exports = {
  __resetProvinciaAuthStateForTests,
  buildProvinciaTokenRequest,
  clearProvinciaTokenCache,
  fetchProvinciaToken,
  parseJwtExp,
  parseProvinciaTokenResponse,
};

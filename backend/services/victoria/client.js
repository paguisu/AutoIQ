const axios = require('axios');

const tokenCache = new Map();

function trimText(value) {
  return String(value || '').trim();
}

function getBaseUrl(cfg = {}) {
  return trimText(cfg.base_url).replace(/\/+$/, '');
}

function getAuthUrl(cfg = {}) {
  const explicit = trimText(cfg.auth_url);
  if (explicit) return explicit;
  return `${getBaseUrl(cfg)}/login`;
}

function getCacheKey(cfg = {}) {
  return JSON.stringify({
    base_url: getBaseUrl(cfg),
    auth_url: getAuthUrl(cfg),
    usuario: trimText(cfg.usuario),
  });
}

function decodeJwtExpiration(token = '') {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function loginVictoria(cfg = {}) {
  const cacheKey = getCacheKey(cfg);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached;

  const authUrl = getAuthUrl(cfg);
  const username = trimText(cfg.usuario);
  const password = trimText(cfg.password);
  if (!authUrl || !username || !password) {
    throw new Error('Victoria requiere base_url, usuario y password configurados');
  }

  const resp = await axios.post(
    authUrl,
    { username, password },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
      validateStatus: () => true,
    }
  );

  if (!(resp.status >= 200 && resp.status < 300)) {
    const message =
      typeof resp.data === 'object' && resp.data
        ? trimText(resp.data.message || resp.data.error || resp.data.debugMessage)
        : '';
    throw new Error(message ? `Victoria auth HTTP ${resp.status}: ${message}` : `Victoria auth HTTP ${resp.status}`);
  }

  const token = trimText(resp?.data?.token);
  if (!token) throw new Error('Victoria auth sin token');

  const tokenData = {
    accessToken: token,
    tokenType: 'Bearer',
    expiresAt: decodeJwtExpiration(token) || (Date.now() + (15 * 60 * 1000)),
    raw: resp.data,
  };
  tokenCache.set(cacheKey, tokenData);
  return tokenData;
}

function buildVictoriaAuthHeaders(accessToken = '') {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function victoriaGet(cfg, path, params) {
  const tokenData = await loginVictoria(cfg);
  const resp = await axios.get(`${getBaseUrl(cfg)}${path}`, {
    params,
    headers: buildVictoriaAuthHeaders(tokenData.accessToken),
    timeout: 25000,
    validateStatus: () => true,
  });
  return { resp, tokenData };
}

async function victoriaPost(cfg, path, payload, params) {
  const tokenData = await loginVictoria(cfg);
  const resp = await axios.post(`${getBaseUrl(cfg)}${path}`, payload, {
    params,
    headers: {
      ...buildVictoriaAuthHeaders(tokenData.accessToken),
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  return { resp, tokenData };
}

module.exports = {
  getBaseUrl,
  getAuthUrl,
  loginVictoria,
  victoriaGet,
  victoriaPost,
};

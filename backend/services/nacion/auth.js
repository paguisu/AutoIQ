const axios = require('axios');

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
      Authorization: buildBasicAuthHeader(username, secret),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: {},
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

async function fetchNacionToken(cfg = {}) {
  if (cfg?.parametros_extras?.skeleton_only) {
    throw new Error('Nacion esta en modo skeleton_only; falta confirmar credenciales y contrato del token');
  }

  const authUrl = String(cfg.auth_url || '').trim();
  const user = String(cfg.auth_user || cfg.usuario || '').trim();
  const password = String(cfg.auth_password || cfg.password || '').trim();
  if (!authUrl || !user || !password) {
    throw new Error('Nacion requiere auth_url, auth_user y auth_password configurados');
  }

  const request = buildNacionLoginRequest({ user, password });
  const base = authUrl.replace(/\/+$/, '');
  const resp = await axios.post(`${base}${request.url}`, request.body, {
    headers: request.headers,
    timeout: 20000,
    validateStatus: () => true,
  });

  const parsed = parseNacionLoginResponse(resp.data);
  if (!(resp.status >= 200 && resp.status < 300) || !parsed.ok) {
    const reason = parsed?.raw?.message || parsed?.raw?.error_description || parsed?.raw?.error || `HTTP ${resp.status}`;
    throw new Error(`Nacion login fallo: ${reason}`);
  }

  return parsed;
}

module.exports = {
  buildBasicAuthHeader,
  buildNacionLoginRequest,
  fetchNacionToken,
  parseJwtExp,
  parseNacionLoginResponse,
};

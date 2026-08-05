const axios = require('axios');
const {
  buildRivadaviaAuthHeaders,
  buildRivadaviaTokenRequest,
  getRivadaviaTokenUrl,
} = require('./auth');

const tokenCache = new Map();

function getCacheKey(cfg = {}) {
  return JSON.stringify({
    auth_url: cfg?.auth_url || '',
    usuario: cfg?.usuario || '',
    client_id: cfg?.client_id || '',
  });
}

async function getRivadaviaToken(cfg = {}) {
  const cacheKey = getCacheKey(cfg);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached;

  const tokenUrl = getRivadaviaTokenUrl(cfg);
  const body = buildRivadaviaTokenRequest(cfg);
  if (!tokenUrl || !body) throw new Error('Rivadavia requiere auth_url y credenciales OAuth configuradas');

  const resp = await axios.post(tokenUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (!(resp.status >= 200 && resp.status < 300)) {
    const message =
      typeof resp.data === 'object' && resp.data
        ? String(resp.data.error_description || resp.data.error || resp.data.message || '')
        : '';
    throw new Error(message ? `Rivadavia auth HTTP ${resp.status}: ${message}` : `Rivadavia auth HTTP ${resp.status}`);
  }

  const accessToken = String(resp?.data?.access_token || '').trim();
  if (!accessToken) throw new Error('Rivadavia auth sin access_token');

  const tokenData = {
    accessToken,
    tokenType: String(resp?.data?.token_type || 'Bearer').trim() || 'Bearer',
    expiresAt: Date.now() + (Number(resp?.data?.expires_in || 0) * 1000),
    raw: resp.data,
  };
  tokenCache.set(cacheKey, tokenData);
  return tokenData;
}

async function rivadaviaGet(cfg, path, params = {}) {
  const tokenData = await getRivadaviaToken(cfg);
  const baseUrl = String(cfg?.base_url || '').replace(/\/+$/, '');
  const resp = await axios.get(`${baseUrl}${path}`, {
    params,
    headers: buildRivadaviaAuthHeaders(tokenData.accessToken),
    timeout: 20000,
    validateStatus: () => true,
  });
  return { resp, tokenData };
}

async function rivadaviaPost(cfg, path, payload) {
  const tokenData = await getRivadaviaToken(cfg);
  const baseUrl = String(cfg?.base_url || '').replace(/\/+$/, '');
  const resp = await axios.post(`${baseUrl}${path}`, payload, {
    headers: {
      ...buildRivadaviaAuthHeaders(tokenData.accessToken),
      'Content-Type': 'application/json',
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  return { resp, tokenData };
}

async function rivadaviaSoapPost(cfg, envelope) {
  const url = String(
    cfg?.parametros_extras?.soap_legacy_url ||
    cfg?.soap_legacy_url ||
    'https://www.sistemas.segurosrivadavia.com/wsRivadavia/wsEmisionPoliza.php'
  ).trim();
  const resp = await axios.post(url, envelope, {
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: '"urn:emision_poliza/solicitudCotizacion"',
    },
    timeout: Number(cfg?.parametros_extras?.soap_timeout_ms || 45000),
    validateStatus: () => true,
  });
  return { resp, tokenData: { tokenType: 'SOAP' }, url };
}

module.exports = {
  getRivadaviaToken,
  rivadaviaGet,
  rivadaviaPost,
  rivadaviaSoapPost,
};

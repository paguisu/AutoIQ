const axios = require('axios');
const {
  buildExpertaAuthHeaders,
  getExpertaLoginPayload,
  getExpertaLoginUrl,
} = require('./auth');

async function loginExperta(cfg = {}, axiosOptions = {}) {
  const loginPayload = getExpertaLoginPayload(cfg);
  const loginUrl = getExpertaLoginUrl(cfg);
  if (!loginPayload.user || !loginPayload.password) {
    throw new Error('Experta requiere user y password configurados');
  }

  const resp = await axios.post(loginUrl, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
    validateStatus: () => true,
    ...axiosOptions,
  });

  if (!(resp.status >= 200 && resp.status < 300)) {
    const message =
      typeof resp.data === 'object' && resp.data
        ? String(resp.data.message || resp.data.error || '')
        : '';
    throw new Error(message ? `Login Experta HTTP ${resp.status}: ${message}` : `Login Experta HTTP ${resp.status}`);
  }

  const token = String(resp?.data?.jwt || '').trim();
  if (!token) throw new Error('Login Experta sin jwt en respuesta');

  return {
    jwt: token,
    refreshjwt: String(resp?.data?.refreshjwt || '').trim(),
    raw: resp.data,
  };
}

async function postExpertaQuote(url, payload, token, cfg = {}, axiosOptions = {}) {
  const makeRequest = (authorizationToken) => axios.post(url, payload, {
    headers: buildExpertaAuthHeaders(authorizationToken, cfg),
    timeout: 25000,
    validateStatus: () => true,
    ...axiosOptions,
  });

  let resp = await makeRequest(token);

  // Some deployments expect "Bearer <jwt>" while others accept the raw token.
  if (resp.status === 401 && !String(cfg?.auth_scheme || cfg?.parametros_extras?.auth_scheme || '').trim()) {
    resp = await makeRequest(`Bearer ${String(token || '').trim()}`);
  }

  return resp;
}

module.exports = {
  loginExperta,
  postExpertaQuote,
};

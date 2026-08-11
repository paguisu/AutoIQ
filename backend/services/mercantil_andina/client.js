const axios = require('axios');
const {
  fetchMercantilAndinaToken,
  getSubscriptionKey,
} = require('./auth');
const { getMercantilAndinaHttpsAgent } = require('./tls');

function trimText(value) {
  return String(value || '').trim();
}

function getBaseUrl(cfg = {}) {
  return trimText(cfg.base_url).replace(/\/+$/, '');
}

function getQuotePath(cfg = {}) {
  return trimText(cfg.soap_path || '/cotizaciones/v2/auto') || '/cotizaciones/v2/auto';
}

function getQuoteUrl(cfg = {}) {
  return `${getBaseUrl(cfg)}${getQuotePath(cfg)}`;
}

function buildHeaders(cfg = {}, tokenData = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const subscriptionKey = getSubscriptionKey(cfg);
  if (subscriptionKey) {
    headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;
    headers['ocp-apim-subscription-key'] = subscriptionKey;
  }

  const bearerToken = trimText(tokenData.accessToken || cfg.access_token || cfg.bearer_token);
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return headers;
}

async function mercantilAndinaPostQuote(cfg = {}, payload = {}) {
  if (!getBaseUrl(cfg)) throw new Error('Mercantil Andina requiere base_url configurado');
  if (!getQuotePath(cfg)) throw new Error('Mercantil Andina requiere soap_path configurado');
  if (!getSubscriptionKey(cfg)) throw new Error('Mercantil Andina requiere subscription_key configurado');

  const timeout = Number(cfg?.parametros_extras?.request_timeout_ms || 30000);
  const requestQuote = (currentToken) => axios.post(getQuoteUrl(cfg), payload, {
    headers: buildHeaders(cfg, currentToken),
    httpsAgent: getMercantilAndinaHttpsAgent(),
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 30000,
    validateStatus: () => true,
  });

  let tokenData = await fetchMercantilAndinaToken(cfg);
  let resp = await requestQuote(tokenData);
  const tokenInvalid = resp.status === 401 || /tokeninvalido|token inv[aá]lido/i.test(JSON.stringify(resp.data || ''));
  if (tokenInvalid) {
    tokenData = await fetchMercantilAndinaToken(cfg, { forceRefresh: true });
    resp = await requestQuote(tokenData);
  }

  return { resp, tokenData };
}

module.exports = {
  buildHeaders,
  getBaseUrl,
  getQuotePath,
  getQuoteUrl,
  getSubscriptionKey,
  mercantilAndinaPostQuote,
};

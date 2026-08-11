const axios = require('axios');
const { clearProvinciaTokenCache, fetchProvinciaToken } = require('./auth');
const {
  buildProvinciaResponseError,
  runProvinciaRequest,
} = require('./http');

function trimText(value) {
  return String(value || '').trim();
}

function getBaseUrl(cfg = {}) {
  return trimText(cfg.base_url).replace(/\/+$/, '');
}

function getQuotePath(cfg = {}) {
  return trimText(cfg.soap_path || '/PS-COTIZACION/2.2/cotizar') || '/PS-COTIZACION/2.2/cotizar';
}

function getQuoteUrl(cfg = {}) {
  return `${getBaseUrl(cfg)}${getQuotePath(cfg)}`;
}

function getApiKey(cfg = {}) {
  return trimText(cfg.api_key || cfg.apikey || cfg.apiKey);
}

async function provinciaPostQuote(cfg = {}, payload = {}) {
  const apiKey = getApiKey(cfg);
  if (!apiKey) throw new Error('Provincia requiere api_key configurado');

  let tokenData = null;
  const postWithFreshToken = async (timeoutMs) => {
    tokenData = await fetchProvinciaToken(cfg);
    return axios.post(getQuoteUrl(cfg), payload, {
      params: { apikey: apiKey },
      headers: {
        Authorization: `${tokenData.tokenType || 'Bearer'} ${tokenData.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
        'x-apikey': apiKey,
        apikey: apiKey,
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    });
  };

  const resp = await runProvinciaRequest({
    cfg,
    prefix: 'quote',
    defaultTimeoutMs: 45000,
    defaultRetries: 1,
    defaultRetryDelayMs: 1500,
    executor: async ({ timeoutMs }) => {
      let quoteResp = await postWithFreshToken(timeoutMs);
      if (quoteResp.status === 401 || quoteResp.status === 403) {
        clearProvinciaTokenCache(cfg);
        quoteResp = await postWithFreshToken(timeoutMs);
      }

      if (quoteResp.status === 429 || quoteResp.status >= 500) {
        throw buildProvinciaResponseError(`Provincia cotizar fallo: HTTP ${quoteResp.status}`, quoteResp);
      }

      return quoteResp;
    },
  });

  return { resp, tokenData };
}

module.exports = {
  getApiKey,
  getBaseUrl,
  getQuotePath,
  getQuoteUrl,
  provinciaPostQuote,
};

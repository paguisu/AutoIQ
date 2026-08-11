function resolveExpertaApiKey(cfg = {}) {
  return String(cfg?.api_key || cfg?.hashid || '').trim();
}

function buildExpertaAuthorization(token, cfg = {}) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const configured = String(cfg?.auth_scheme || cfg?.parametros_extras?.auth_scheme || '').trim();
  if (configured) return `${configured} ${raw}`.trim();
  return raw;
}

function buildExpertaAuthHeaders(token, cfg = {}) {
  const authorization = buildExpertaAuthorization(token, cfg);
  const apiKey = resolveExpertaApiKey(cfg);
  const headers = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (apiKey) headers['api-key'] = apiKey;
  return headers;
}

function getExpertaLoginPayload(cfg = {}) {
  return {
    user: String(cfg?.usuario || '').trim(),
    password: String(cfg?.password || '').trim(),
  };
}

function getExpertaLoginUrl(cfg = {}) {
  const base = String(cfg?.base_url || '').replace(/\/+$/, '');
  return `${base}/login`;
}

module.exports = {
  buildExpertaAuthHeaders,
  getExpertaLoginPayload,
  getExpertaLoginUrl,
  resolveExpertaApiKey,
};

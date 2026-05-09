function getRivadaviaTokenUrl(cfg = {}) {
  return String(cfg?.auth_url || '').trim();
}

function buildRivadaviaTokenRequest(cfg = {}) {
  const params = new URLSearchParams();
  params.set('grant_type', String(cfg?.grant_type || 'password').trim() || 'password');
  params.set('username', String(cfg?.usuario || '').trim());
  params.set('password', String(cfg?.password || '').trim());
  params.set('client_id', String(cfg?.client_id || '').trim());
  params.set('client_secret', String(cfg?.client_secret || '').trim());
  return params.toString();
}

function buildRivadaviaAuthHeaders(token) {
  return {
    Authorization: `Bearer ${String(token || '').trim()}`,
  };
}

module.exports = {
  buildRivadaviaAuthHeaders,
  buildRivadaviaTokenRequest,
  getRivadaviaTokenUrl,
};

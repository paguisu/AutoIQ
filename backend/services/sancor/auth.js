const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });
const tokenCache = new Map();

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildGetTokenEnvelope({ user, password, system = 'PolicyIssuance', connection = 'Ceibo' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:req="http://gruposancorseguros.com/ents/SOI/SecuritySvc/GetToken/request">
  <soapenv:Body>
    <req:getToken>
      <Credentials>
        <User>${escapeXml(user)}</User>
        <Password>${escapeXml(password)}</Password>
        <System>${escapeXml(system)}</System>
        <Connection>${escapeXml(connection)}</Connection>
      </Credentials>
    </req:getToken>
  </soapenv:Body>
</soapenv:Envelope>`.trim();
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

function parseGetTokenResponse(xml) {
  const parsed = parser.parse(String(xml || ''));
  const envelope = parsed?.Envelope;
  const header = envelope?.Header?.responseHeader || {};
  const body = envelope?.Body?.getTokenResponse || {};
  const result = body?.Result || {};
  const token = body?.Token || {};
  const ok =
    String(header?.responseStatus?.statusCode || '').trim().toUpperCase() === 'SUCCESS' &&
    String(result?.ErrorCode || '').trim() === 'SOA-GSS-0000' &&
    String(result?.ErrorMsg || '').trim().toUpperCase() === 'SUCCESS' &&
    String(token?.AccessToken || '').trim() !== '';

  return {
    ok,
    errorCode: String(result?.ErrorCode || '').trim(),
    errorMsg: String(result?.ErrorMsg || '').trim(),
    accessToken: String(token?.AccessToken || '').trim(),
    idToken: String(token?.IdToken || '').trim(),
    tokenType: String(token?.TokenType || '').trim() || 'Bearer',
    responseStatus: String(header?.responseStatus?.statusCode || '').trim(),
  };
}

async function fetchSancorToken(cfg = {}) {
  const envelope = buildGetTokenEnvelope({
    user: cfg.usuario,
    password: cfg.password,
    system: cfg.system || 'PolicyIssuance',
    connection: cfg.connection || 'Ceibo',
  });

  const resp = await axios.post(cfg.auth_url, envelope, {
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: '"http://gruposancorseguros.com/ents/SOI/SecuritySvc/GetToken"',
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  const parsed = parseGetTokenResponse(resp.data);
  if (!(resp.status >= 200 && resp.status < 300) || !parsed.ok) {
    const reason = parsed.errorMsg || `HTTP ${resp.status}`;
    throw new Error(`Sancor GetToken falló: ${reason}`);
  }

  const expMs = parseJwtExp(parsed.idToken);
  return {
    ...parsed,
    expiresAt: expMs || (Date.now() + 10 * 60 * 1000),
    raw: String(resp.data || ''),
  };
}

async function getSancorToken(cfg = {}) {
  const cacheKey = JSON.stringify({
    auth_url: cfg.auth_url,
    usuario: cfg.usuario,
    system: cfg.system || 'PolicyIssuance',
    connection: cfg.connection || 'Ceibo',
  });
  const current = tokenCache.get(cacheKey);
  if (current && current.expiresAt > (Date.now() + 60 * 1000)) {
    return current;
  }
  const fresh = await fetchSancorToken(cfg);
  tokenCache.set(cacheKey, fresh);
  return fresh;
}

module.exports = {
  buildGetTokenEnvelope,
  fetchSancorToken,
  getSancorToken,
  parseGetTokenResponse,
};

const crypto = require('crypto');

const seenNonces = new Map();
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function bodyDigest(body) {
  const serialized = body == null || Object.keys(body).length === 0 ? '' : JSON.stringify(body);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function canonicalRequest(req, timestamp, nonce) {
  return [
    String(req.method || '').toUpperCase(),
    req.originalUrl || req.url || '/',
    String(timestamp),
    String(nonce),
    bodyDigest(req.body),
  ].join('\n');
}

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function purgeExpiredNonces(now) {
  for (const [nonce, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function requireSeguros911Service(req, res, next) {
  const secret = String(process.env.SEGUROS911_SERVICE_SECRET || '').trim();
  if (!secret) {
    return res.status(503).json({ error: 'Integración Seguros911 no configurada', code: 'SERVICE_AUTH_NOT_CONFIGURED' });
  }

  const timestamp = Number(req.get('x-autoiq-timestamp'));
  const nonce = String(req.get('x-autoiq-nonce') || '');
  const signature = String(req.get('x-autoiq-signature') || '');
  const now = Date.now();
  purgeExpiredNonces(now);

  if (!timestamp || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS || !nonce || !signature) {
    return res.status(401).json({ error: 'Firma de servicio inválida o vencida', code: 'INVALID_SERVICE_SIGNATURE' });
  }
  if (seenNonces.has(nonce)) {
    return res.status(401).json({ error: 'Solicitud de servicio repetida', code: 'REPLAYED_SERVICE_REQUEST' });
  }

  const expected = crypto.createHmac('sha256', secret)
    .update(canonicalRequest(req, timestamp, nonce))
    .digest('hex');
  if (!secureEquals(signature, expected)) {
    return res.status(401).json({ error: 'Firma de servicio inválida', code: 'INVALID_SERVICE_SIGNATURE' });
  }

  seenNonces.set(nonce, now + MAX_CLOCK_SKEW_MS);
  req.serviceActor = {
    source_system: 'seguros911',
    user_id: String(req.get('x-autoiq-actor-id') || ''),
    display_name: decodeURIComponent(String(req.get('x-autoiq-actor-name') || 'Seguros911')),
    role: String(req.get('x-autoiq-actor-role') || '').toLowerCase(),
  };
  next();
}

module.exports = { canonicalRequest, requireSeguros911Service };

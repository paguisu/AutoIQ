const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { bodyDigest, canonicalRequest, requireSeguros911Service, __test } = require('../middleware/service_auth');

function signature(secret, method, url, timestamp, nonce, body) {
  const fake = { method, originalUrl: url, body: body || {} };
  return crypto.createHmac('sha256', secret).update(canonicalRequest(fake, timestamp, nonce)).digest('hex');
}

describe('Seguros911 HMAC contract', () => {
  const secret = 'sanitized-test-secret';
  let previous;
  let app;
  beforeEach(() => {
    previous = process.env.SEGUROS911_SERVICE_SECRET;
    process.env.SEGUROS911_SERVICE_SECRET = secret;
    __test.seenNonces.clear();
    app = express();
    app.use(express.json());
    app.all('/private', requireSeguros911Service, (req, res) => res.json({ ok: true }));
  });
  afterEach(() => { if (previous === undefined) delete process.env.SEGUROS911_SERVICE_SECRET; else process.env.SEGUROS911_SERVICE_SECRET = previous; });

  test('hash de body vacío y POST JSON son deterministas', () => {
    expect(bodyDigest({})).toBe(crypto.createHash('sha256').update('').digest('hex'));
    expect(bodyDigest({ gnc: '1', suma_gnc: 800000 })).toHaveLength(64);
  });

  test('acepta firma válida y rechaza firma inválida', async () => {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const valid = signature(secret, 'GET', '/private', timestamp, nonce);
    expect((await request(app).get('/private').set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', nonce).set('x-autoiq-signature', valid)).status).toBe(200);
    expect((await request(app).get('/private').set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', crypto.randomUUID()).set('x-autoiq-signature', '00')).body.code).toBe('INVALID_SERVICE_SIGNATURE');
  });

  test('rechaza replay y reloj fuera de tolerancia', async () => {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const valid = signature(secret, 'GET', '/private', timestamp, nonce);
    await request(app).get('/private').set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', nonce).set('x-autoiq-signature', valid);
    expect((await request(app).get('/private').set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', nonce).set('x-autoiq-signature', valid)).body.code).toBe('REPLAYED_SERVICE_REQUEST');
    const stale = String(Date.now() - 10 * 60 * 1000);
    const staleNonce = crypto.randomUUID();
    expect((await request(app).get('/private').set('x-autoiq-timestamp', stale).set('x-autoiq-nonce', staleNonce).set('x-autoiq-signature', signature(secret, 'GET', '/private', stale, staleNonce))).status).toBe(401);
  });
});


const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { bodyDigest, canonicalRequest, captureServiceBody, requireSeguros911Service, __test } = require('../middleware/service_auth');

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
    app.use(express.json({ verify: captureServiceBody }));
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

  test.each(['{}', '{ "gnc": 1, "suma_gnc": 800000 }', '{"nombre":"José","valor":1.00}'])('acepta bytes exactos del cliente: %s', async (body) => {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const url = '/private?company=atm&context=seguros911';
    // Independent sender: never invoke the server canonicalizer to sign.
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    const signed = crypto.createHmac('sha256', secret)
      .update(['POST', url, timestamp, nonce, digest].join('\n')).digest('hex');
    const response = await request(app).post(url).type('json').send(body)
      .set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', nonce).set('x-autoiq-signature', signed);
    expect(response.status).toBe(200);
  });

  test('rechaza un cuerpo cambiado aunque represente el mismo JSON', async () => {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const digest = crypto.createHash('sha256').update('{}').digest('hex');
    const signed = crypto.createHmac('sha256', secret)
      .update(['POST', '/private', timestamp, nonce, digest].join('\n')).digest('hex');
    const response = await request(app).post('/private').type('json').send('{ }')
      .set('x-autoiq-timestamp', timestamp).set('x-autoiq-nonce', nonce).set('x-autoiq-signature', signed);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_SERVICE_SIGNATURE');
  });
});

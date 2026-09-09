const {
  buildBasicAuthHeader,
  buildNacionLoginRequest,
  parseNacionLoginResponse,
  fetchNacionToken,
  clearNacionTokenCache,
} = require('../services/nacion/auth');
const nock = require('nock');

const base = 'https://nacion-auth.test';
const cfg = { auth_url: `${base}/token/auth`, auth_user: 'usuario-demo', auth_password: 'secreto-demo' };
const jwt = (expiresAt) => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt / 1000) })).toString('base64url')}.signature`;
const response = (now) => ({
  access_token: jwt(now + 300000),
  refresh_token: jwt(now + 1800000),
  expiration_date: '09/09/2026 12:00:00',
  roles: { servcomercial: ['quote'] },
});

beforeEach(() => { clearNacionTokenCache(); nock.disableNetConnect(); });
afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); jest.restoreAllMocks(); });

describe('Nacion auth', () => {
  test('arma JSON username/password, reservando Basic para acceso al WSDL', () => {
    const request = buildNacionLoginRequest({ user: 'usuario-demo', password: 'secreto-demo' });

    expect(buildBasicAuthHeader('usuario-demo', 'secreto-demo')).toBe('Basic dXN1YXJpby1kZW1vOnNlY3JldG8tZGVtbw==');
    expect(request).toMatchObject({
      url: '/login',
      body: { username: 'usuario-demo', password: 'secreto-demo' },
    });
    expect(request.headers.Authorization).toBeUndefined();
  });

  test('parsea una respuesta JWT de login', () => {
    const out = parseNacionLoginResponse({
      access_token: 'header.eyJleHAiOjE5MDAwMDAwMDB9.sig',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 300,
      refresh_expires_in: 1800,
    });

    expect(out).toMatchObject({
      ok: true,
      accessToken: 'header.eyJleHAiOjE5MDAwMDAwMDB9.sig',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 300,
      refreshExpiresIn: 1800,
    });
    expect(out.expiresAt).toBe(1900000000000);
  });

  test('login realista: fecha/roles, cache y solicitudes simultáneas comparten un token', async () => {
    const payload = response(Date.now());
    const scope = nock(base).post('/token/auth/login', { username: cfg.auth_user, password: cfg.auth_password })
      .delay(10).reply(200, payload);
    const [a, b] = await Promise.all([fetchNacionToken(cfg), fetchNacionToken(cfg)]);
    expect(a.accessToken).toBe(payload.access_token);
    expect(a).toEqual(b);
    expect(await fetchNacionToken(cfg)).toEqual(a);
    expect(a.expirationDate).toBe(payload.expiration_date);
    expect(a.roles).toEqual(payload.roles);
    expect(a.raw).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  test('acepta URL completa de login sin duplicar /login', async () => {
    const scope = nock(base).post('/token/auth/login').reply(200, response(Date.now()));
    await fetchNacionToken({ ...cfg, auth_url: `${cfg.auth_url}/login` });
    expect(scope.isDone()).toBe(true);
  });

  test('renueva antes de vencer y conserva el nuevo refresh token', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const first = response(now), second = response(now + 280000), third = response(now + 560000);
    const scope = nock(base)
      .post('/token/auth/login').reply(200, first)
      .post('/token/auth/renew', { refresh_token: first.refresh_token }).reply(200, second)
      .post('/token/auth/renew', { refresh_token: second.refresh_token }).reply(200, third);
    await fetchNacionToken(cfg);
    clock.mockReturnValue(now + 280000);
    expect((await fetchNacionToken(cfg)).accessToken).toBe(second.access_token);
    clock.mockReturnValue(now + 560000);
    expect((await fetchNacionToken(cfg)).accessToken).toBe(third.access_token);
    expect(scope.isDone()).toBe(true);
  });

  test('refresh rechazado provoca un login; HTTP 500 no provoca login adicional', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const scope = nock(base)
      .post('/token/auth/login').reply(200, response(now))
      .post('/token/auth/renew').reply(401, { message: 'Invalid refresh token' })
      .post('/token/auth/login').reply(200, response(now + 280000))
      .post('/token/auth/renew').reply(500, {});
    await fetchNacionToken(cfg);
    clock.mockReturnValue(now + 280000);
    await fetchNacionToken(cfg);
    clock.mockReturnValue(now + 560000);
    await expect(fetchNacionToken(cfg)).rejects.toMatchObject({ http_status: 500 });
    expect(scope.isDone()).toBe(true);
  });

  test('separa cache por usuario y credencial', async () => {
    const scope = nock(base).post('/token/auth/login').times(3).reply(200, () => response(Date.now()));
    await fetchNacionToken(cfg);
    await fetchNacionToken({ ...cfg, auth_user: 'otro' });
    await fetchNacionToken({ ...cfg, auth_password: 'rotada' });
    expect(scope.isDone()).toBe(true);
  });

  test('no confunde expiration_date sin zona con una expiración JWT válida', async () => {
    const payload = { access_token: 'opaque', refresh_token: 'opaque-refresh', expiration_date: '09/09/2026 12:00:00' };
    const scope = nock(base).post('/token/auth/login').twice().reply(200, payload);
    expect((await fetchNacionToken(cfg)).expiresAt).toBe(0);
    await fetchNacionToken(cfg);
    expect(scope.isDone()).toBe(true);
  });

  test('no filtra secretos de errores HTTP ni redirige credenciales', async () => {
    const scope = nock(base).post('/token/auth/login').reply(302, { message: cfg.auth_password }, { Location: 'https://other.test' });
    await expect(fetchNacionToken(cfg)).rejects.toThrow('HTTP 302');
    expect(scope.isDone()).toBe(true);
    jest.spyOn(require('axios'), 'post').mockRejectedValueOnce(Object.assign(new Error(cfg.auth_password), {
      code: 'ETIMEDOUT', config: { data: { password: cfg.auth_password } },
    }));
    try { await fetchNacionToken(cfg); throw new Error('expected rejection'); }
    catch (e) {
      expect(e.code).toBe('ETIMEDOUT');
      expect(JSON.stringify(e)).not.toContain(cfg.auth_password);
      expect(e.message).not.toContain(cfg.auth_password);
      expect(e.config).toBeUndefined();
    }
  });

  test('no llama a la red cuando está bloqueado o la URL no es HTTPS', async () => {
    await expect(fetchNacionToken({ ...cfg, parametros_extras: { skeleton_only: true } })).rejects.toThrow('skeleton_only');
    await expect(fetchNacionToken({ ...cfg, auth_url: 'http://nacion-auth.test' })).rejects.toThrow('HTTPS');
  });
});

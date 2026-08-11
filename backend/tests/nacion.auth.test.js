const {
  buildBasicAuthHeader,
  buildNacionLoginRequest,
  parseNacionLoginResponse,
} = require('../services/nacion/auth');

describe('Nacion auth', () => {
  test('arma el header basic auth y el request de login', () => {
    const request = buildNacionLoginRequest({ user: 'usuario-demo', password: 'secreto-demo' });

    expect(buildBasicAuthHeader('usuario-demo', 'secreto-demo')).toBe('Basic dXN1YXJpby1kZW1vOnNlY3JldG8tZGVtbw==');
    expect(request).toMatchObject({
      url: '/login',
      body: {},
    });
    expect(request.headers.Authorization).toBe('Basic dXN1YXJpby1kZW1vOnNlY3JldG8tZGVtbw==');
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
});

jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');
const {
  __resetProvinciaAuthStateForTests,
  buildProvinciaTokenRequest,
  fetchProvinciaToken,
  parseProvinciaTokenResponse,
} = require('../services/provincia/auth');

describe('Provincia auth', () => {
  beforeEach(() => {
    axios.post.mockReset();
    __resetProvinciaAuthStateForTests();
  });

  test('arma el request x-www-form-urlencoded del token', () => {
    const request = buildProvinciaTokenRequest({
      clientId: 'ps2',
      clientSecret: 'secret-demo',
      username: 'usuario-demo',
      password: 'clave-demo',
    });

    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(request.body).toMatchObject({
      client_id: 'ps2',
      client_secret: 'secret-demo',
      username: 'usuario-demo',
      password: 'clave-demo',
      grant_type: 'password',
    });
  });

  test('parsea una respuesta de token bearer', () => {
    const out = parseProvinciaTokenResponse({
      access_token: 'header.eyJleHAiOjE5MDAwMDAwMDB9.sig',
      refresh_token: 'refresh-demo',
      token_type: 'Bearer',
      expires_in: 900,
      refresh_expires_in: 1800,
    });

    expect(out).toMatchObject({
      ok: true,
      accessToken: 'header.eyJleHAiOjE5MDAwMDAwMDB9.sig',
      refreshToken: 'refresh-demo',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshExpiresIn: 1800,
    });
    expect(out.expiresAt).toBe(1900000000000);
  });

  test('reintenta el token cuando Provincia demora y luego responde', async () => {
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 20000ms exceeded'), {
        code: 'ECONNABORTED',
      }))
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'header.eyJleHAiOjE5MDAwMDAwMDB9.sig',
          refresh_token: 'refresh-demo',
          token_type: 'Bearer',
          expires_in: 900,
          refresh_expires_in: 1800,
        },
      });

    const out = await fetchProvinciaToken({
      auth_url: 'https://auth.example.com/token',
      client_id: 'ps2',
      client_secret: 'secret-demo',
      usuario: 'usuario-demo',
      password: 'clave-demo',
      grant_type: 'password',
      parametros_extras: {
        auth_timeout_ms: 50,
        auth_retries: 1,
        auth_retry_delay_ms: 0,
      },
    });

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      ok: true,
      tokenType: 'Bearer',
    });
  });
});

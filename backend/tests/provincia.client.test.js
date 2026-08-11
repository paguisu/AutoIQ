jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');
const { __resetProvinciaAuthStateForTests } = require('../services/provincia/auth');
const { provinciaPostQuote } = require('../services/provincia/client');

describe('Provincia client', () => {
  beforeEach(() => {
    axios.post.mockReset();
    __resetProvinciaAuthStateForTests();
  });

  test('refresca token y reintenta cotizacion cuando Provincia responde 401', async () => {
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'header.eyJleHAiOjE5MDAwMDAwMDB9.old',
          token_type: 'Bearer',
          expires_in: 900,
        },
      })
      .mockResolvedValueOnce({
        status: 401,
        data: '<html><h1>401 Authorization Required</h1></html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'header.eyJleHAiOjE5MDAwMDAwMDB9.new',
          token_type: 'Bearer',
          expires_in: 900,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { numeroCotizacion: '123', planes: [] },
      });

    const { resp, tokenData } = await provinciaPostQuote({
      base_url: 'https://provincia.example.com',
      soap_path: '/cotizar',
      auth_url: 'https://provincia.example.com/token',
      api_key: 'api-key',
      client_id: 'ps2',
      client_secret: 'secret',
      usuario: 'user',
      password: 'pass',
      parametros_extras: {
        quote_retries: 0,
      },
    }, { test: true });

    expect(resp.status).toBe(200);
    expect(tokenData.accessToken).toBe('header.eyJleHAiOjE5MDAwMDAwMDB9.new');
    expect(axios.post).toHaveBeenCalledTimes(4);
    expect(axios.post.mock.calls[1][2].headers.Authorization).toContain('.old');
    expect(axios.post.mock.calls[3][2].headers.Authorization).toContain('.new');
  });
});

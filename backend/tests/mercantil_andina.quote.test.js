const nock = require('nock');
const {
  buildMercantilAndinaPayload,
  parseMercantilAndinaQuoteResponse,
  resolveLocality,
  resolvePaymentType,
} = require('../services/mercantil_andina/quote');
const {
  buildHeaders,
  getQuoteUrl,
  mercantilAndinaPostQuote,
} = require('../services/mercantil_andina/client');
const {
  buildAuthHeaders,
  buildAuthBody,
  clearMercantilAndinaTokenCache,
  isTokenUsable,
  parseToken,
  parseJwtExpiryMs,
  resolveTokenExpiresAt,
} = require('../services/mercantil_andina/auth');

describe('Mercantil Andina quote adapter', () => {
  const cfg = {
    base_url: 'https://api.example.test',
    soap_path: '/cotizaciones/v2/auto',
    auth_url: 'https://auth.example.test/credenciales/v2/',
    usuario: 'MPLICTST',
    password: 'az12sx34',
    client_id: 'api-clientes-login',
    grant_type: 'password',
    subscription_key: 'secret-key',
    producer_code: '98082',
    comision: '20',
    bonificacion: '20',
    descuento_comercial: '20',
    clausula_ajuste: '0',
    parametros_extras: {
      canal_default: '78',
      uso_default: '1',
      forma_pago_default: 'D',
      periodo_default: '1',
      cuotas_default: '1',
      iva_default: '5',
      desglose_default: true,
      ajuste_suma_default: '0',
      rastreo_default: '0',
      anio_0km: '9999',
    },
  };

  afterEach(() => {
    nock.cleanAll();
    clearMercantilAndinaTokenCache();
  });

  test('arma payload con defaults comerciales discriminados', () => {
    const { payload, requestMeta } = buildMercantilAndinaPayload({
      fila: {
        infoautocod: '170578',
        anio: '2012',
        CP: '7163',
        localidad: 'GENERAL MADARIAGA',
        provincia: 'BUENOS AIRES',
        uso: 'Particular',
      },
      cabecera: {
        medio_pago: 'Debito automatico',
      },
      cfg,
      usoDicc: { particular: '1' },
    });

    expect(payload).toMatchObject({
      canal: 78,
      localidad: {
        id: 14401,
        codigo_postal: 7163,
      },
      vehiculo: {
        infoauto: 170578,
        anio: 2012,
        uso: 1,
        gnc: false,
        rastreo: 0,
      },
      comision: 20,
      bonificacion: 20,
      periodo: 1,
      cuotas: 1,
      pago: {
        tipo_pago: 'D',
      },
      ajuste_suma: 0,
      iva: 5,
      desglose: true,
      productor: {
        id: 98082,
      },
    });
    expect(requestMeta).toMatchObject({
      localidadId: 14401,
      localidadSource: 'diccionario_cp_localidad',
      comision: 20,
      bonificacion: 20,
      canal: 78,
      tipoPago: 'D',
    });
  });

  test('permite enviar comision y bonificacion con valores distintos', () => {
    const { payload, requestMeta } = buildMercantilAndinaPayload({
      fila: {
        infoautocod: '320534',
        anio: '2009',
        CP: '1834',
        localidad: 'TEMPERLEY',
        mercantil_andina_comision: '18',
        mercantil_andina_bonificacion: '12',
      },
      cabecera: {},
      cfg,
    });

    expect(payload.comision).toBe(18);
    expect(payload.bonificacion).toBe(12);
    expect(requestMeta).toMatchObject({
      comision: 18,
      bonificacion: 12,
    });
  });

  test('envia anio 9999 para cero kilometro', () => {
    const { payload } = buildMercantilAndinaPayload({
      fila: {
        infoautocod: '130217',
        anio: '2026',
        cerokm: '1',
        CP: '8307',
        localidad: 'CATRIEL',
      },
      cabecera: {},
      cfg,
    });

    expect(payload.vehiculo.anio).toBe(9999);
  });

  test('resuelve localidad explicita cuando no existe catalogo local suficiente', () => {
    expect(resolveLocality({
      fila: {
        CP: '5000',
        mercantil_andina_localidad_id: '12345',
      },
    })).toMatchObject({
      id: 12345,
      codigo_postal: 5000,
      source: 'explicit',
    });
  });

  test('permite cotizar solo con codigo postal si no hay localidad en catalogo', () => {
    const { payload, requestMeta } = buildMercantilAndinaPayload({
      fila: {
        infoautocod: '170578',
        anio: '2012',
        CP: '7600',
        localidad: 'MAR DEL PLATA',
      },
      cabecera: {},
      cfg,
    });

    expect(payload.localidad).toEqual({ codigo_postal: 7600 });
    expect(requestMeta).toMatchObject({
      localidadId: null,
      localidadCp: 7600,
      localidadSource: 'codigo_postal',
    });
  });

  test('mapea forma de pago por cabecera', () => {
    expect(resolvePaymentType({ cabecera: { medio_pago: 'CBU' }, cfg })).toBe('D');
    expect(resolvePaymentType({ cabecera: { medio_pago: 'Convenio' }, cfg })).toBe('C');
    expect(resolvePaymentType({ cabecera: { medio_pago: 'Tarjeta de credito' }, cfg })).toBe('C');
  });

  test('parsea respuesta exitosa de Mercantil Andina', () => {
    const out = parseMercantilAndinaQuoteResponse({
      id: 596772307,
      localidad: { id: 14401, codigo_postal: 7163 },
      vehiculo: { infoauto: 170578, anio: 2012, valor: 9735000, uso: 1, gnc: false, rastreo: 0 },
      suma_asegurada: 9735000,
      iva: 5,
      ajuste_suma: 0,
      periodo: 1,
      cuotas: 1,
      comision: 20,
      bonificacion: 20,
      productor: { id: 98082 },
      resultado: [
        {
          numero: 0,
          producto: 'A',
          texto: 'A - RESPONSABILIDAD CIVIL LIMITADA',
          titulo: 'A',
          descripcion: 'A - RESPONSABILIDAD CIVIL LIMITADA',
          costo: 27455.92,
          cantidad_cuotas: 1,
          desglose: {
            total: {
              prima: 14750.21,
              iva: 4638.57,
              premio: 27455.92,
              recargo_financiero: 0,
              otros_impuestos: 220.88,
            },
            cuotas: [{ premio: 27455.92, cuota: 1 }],
          },
          franquicia: 0,
          codigo_producto: 800,
          inspeccion: { opciones: [{ id: null, descripcion: null }] },
        },
        {
          numero: 5,
          producto: 'M BASICA',
          descripcion: 'M BASICA - RCL, INC Y ROBO TOT Y PAR, ACC.TOT',
          costo: 45000.57,
          cantidad_cuotas: 1,
          desglose: { total: { prima: 26619.99, iva: 7602.67, premio: 45000.57 } },
          franquicia: 0,
          codigo_producto: 977,
        },
      ],
      fecha_cotizacion: '2026-06-22T00:00Z',
      pago: { tipo_pago: 'D' },
    });

    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('596772307');
    expect(out.suma_asegurada).toBe('9735000');
    expect(out.coberturas).toHaveLength(2);
    expect(out.coberturas[0]).toMatchObject({
      codigoDeCobertura: 'A',
      codigoDeProducto: '800',
      importePrima: '14750.21',
      importePremio: '27455.92',
      importeIVA: '4638.57',
      porcentajeComisionPAS: '20',
      bonificacion: '20',
    });
  });

  test('parsea error funcional sin coberturas', () => {
    const out = parseMercantilAndinaQuoteResponse({
      fecha: '2020-07-27T03:10:35Z',
      errores: [{
        codigo_error: 'GEN020',
        mensaje_error: 'El inicio de vigencia de la poliza no puede ser anterior al dia de hoy.',
      }],
      resultado: [],
    });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('El inicio de vigencia de la poliza no puede ser anterior al dia de hoy.');
    expect(out.coberturas).toEqual([]);
  });

  test('arma URL y headers del cliente', () => {
    expect(getQuoteUrl(cfg)).toBe('https://api.example.test/cotizaciones/v2/auto');
    const headers = buildHeaders(cfg, { accessToken: 'token-123' });
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
    expect(headers.Authorization).toBe('Bearer token-123');
  });

  test('arma headers y body de login segun contrato de Mercantil Andina', () => {
    const headers = buildAuthHeaders(cfg);
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
    expect(headers.Authorization).toBeUndefined();
    expect(buildAuthBody(cfg)).toBe('client_id=api-clientes-login&username=MPLICTST&password=az12sx34&grant_type=password');
    expect(parseToken({ access_token: 'Bearer abc.def' })).toBe('abc.def');
  });

  test('calcula vencimiento del token y aplica margen de renovacion preventiva', () => {
    const now = Date.parse('2026-08-09T12:00:00Z');
    const expiresAt = resolveTokenExpiresAt({ expires_in: 3600 }, 'opaque-token', cfg, now);
    expect(expiresAt).toBe(now + 3600 * 1000);
    expect(isTokenUsable({ accessToken: 'opaque-token', expiresAt }, cfg, now + 3500 * 1000)).toBe(true);
    expect(isTokenUsable({ accessToken: 'opaque-token', expiresAt }, cfg, now + 3541 * 1000)).toBe(false);

    const jwtPayload = Buffer.from(JSON.stringify({ exp: 1800000000 })).toString('base64url');
    expect(parseJwtExpiryMs(`header.${jwtPayload}.signature`)).toBe(1800000000 * 1000);
  });

  test('hace login y cotiza con Bearer token', async () => {
    nock('https://auth.example.test', {
      reqheaders: {
        'ocp-apim-subscription-key': 'secret-key',
      },
    })
      .post('/credenciales/v2/', 'client_id=api-clientes-login&username=MPLICTST&password=az12sx34&grant_type=password')
      .reply(200, { access_token: 'jwt-test' });

    nock('https://api.example.test', {
      reqheaders: {
        authorization: 'Bearer jwt-test',
        'ocp-apim-subscription-key': 'secret-key',
      },
    })
      .post('/cotizaciones/v2/auto', { canal: 78 })
      .reply(201, { id: 123, resultado: [] });

    const { resp, tokenData } = await mercantilAndinaPostQuote(cfg, { canal: 78 });
    expect(tokenData.accessToken).toBe('jwt-test');
    expect(resp.status).toBe(201);
  });

  test('renueva token y reintenta una vez cuando la cotizacion responde 401', async () => {
    nock('https://auth.example.test')
      .post('/credenciales/v2/')
      .reply(200, { access_token: 'jwt-vencido', expires_in: 3600 })
      .post('/credenciales/v2/')
      .reply(200, { access_token: 'jwt-renovado', expires_in: 3600 });

    nock('https://api.example.test', { reqheaders: { authorization: 'Bearer jwt-vencido' } })
      .post('/cotizaciones/v2/auto', { canal: 78 })
      .reply(401, { error: 'No disponible - TokenInvalido' });
    nock('https://api.example.test', { reqheaders: { authorization: 'Bearer jwt-renovado' } })
      .post('/cotizaciones/v2/auto', { canal: 78 })
      .reply(201, { id: 456, resultado: [] });

    const { resp, tokenData } = await mercantilAndinaPostQuote(cfg, { canal: 78 });
    expect(resp.status).toBe(201);
    expect(tokenData.accessToken).toBe('jwt-renovado');
    expect(nock.isDone()).toBe(true);
  });
});

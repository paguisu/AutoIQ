const {
  buildSmgEnvelope,
  buildSmgSumLookupEnvelope,
  parseSmgSumLookupResponse,
  parseSmgQuoteResponse,
  redactSmgEnvelope,
  resolveSmgProvinceCode,
  resolveSmgPostalCode,
  resolveSmgUseCode,
} = require('../services/smg/quote');

describe('SMG quote adapter', () => {
  test('arma el request SOAP de Cotizar_Autos_fp con campos base', () => {
    const { envelope, requestMeta } = buildSmgEnvelope({
      fila: {
        infoautocod: '450420',
        anio: '2023',
        CP: '1650',
        provincia: 'Buenos Aires',
        suma: '25190000',
        cerokm: '1',
      },
      cabecera: {
        uso: 'Particular',
        gnc: '0',
      },
      cfg: {
        soap_method: 'Cotizar_Autos_fp',
        password: 'secret-test',
        codAgt: '12345',
        cod_tipo_poliza: '1',
        parametros_extras: {
          periodo_facturacion_default: '6',
          cantidad_cuotas_default: '1',
          asistencia_mecanica_default: '1',
        },
      },
      mapeos: { uso_codigo: '1' },
    });

    expect(requestMeta).toMatchObject({
      method: 'Cotizar_Autos_fp',
      nCodAutoInfoAuto: '450420',
      nAnio: '2023',
      nCodPostal: '1650',
      nCodProvincia: '2',
      nSumaAsegurada: '25190000',
      nCodUsoVeh: '1',
      n0km: '-1',
      cod_agente: '12345',
      cod_tipo_poliza: '1',
      passwordConfigurada: true,
    });
    expect(envelope).toContain('<Cotizar_Autos_fp xmlns="http://tempuri.org/">');
    expect(envelope).toContain('<nCodAutoInfoAuto>450420</nCodAutoInfoAuto>');
    expect(envelope).toContain('<password>secret-test</password>');
    expect(redactSmgEnvelope(envelope)).toContain('<password>[redacted]</password>');
  });

  test('arma Cotizar_Autos sin requerir password', () => {
    const { envelope, requestMeta } = buildSmgEnvelope({
      fila: { infoautocod: '450420', anio: '2023', CP: '1650' },
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0' },
      cfg: {
        soap_method: 'Cotizar_Autos',
        codAgt: '6645',
        cod_tipo_poliza: '1',
        parametros_extras: {
          asistencia_mecanica_default: '-1',
          cod_pto_venta_default: '1',
        },
      },
      mapeos: { uso_codigo: '1' },
    });

    expect(requestMeta).toMatchObject({
      method: 'Cotizar_Autos',
      cod_agente: '6645',
      AsistMecanica: '-1',
      codPtoVenta: '1',
      passwordConfigurada: false,
    });
    expect(envelope).toContain('<Cotizar_Autos xmlns="http://tempuri.org/">');
    expect(envelope).not.toContain('<password>');
  });

  test('usa el codigo de localizador configurado cuando rastreo esta activo', () => {
    const { envelope, requestMeta } = buildSmgEnvelope({
      fila: { infoautocod: '450420', anio: '2023', CP: '1650' },
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0', rastreo: '1' },
      cfg: {
        soap_method: 'Cotizar_Autos',
        codAgt: '6645',
        cod_tipo_poliza: '1',
        parametros_extras: {
          cod_localizador_con_default: '2',
          cod_localizador_sin_default: '0',
        },
      },
      mapeos: { uso_codigo: '1' },
    });

    expect(requestMeta.nCodLocalizador).toBe('2');
    expect(envelope).toContain('<nCodLocalizador>2</nCodLocalizador>');
  });

  test('traduce rastreo sin especificar y proveedor canonico a codigos SMG', () => {
    const base = {
      fila: { infoautocod: '450420', anio: '2023', CP: '1650' },
      cfg: { soap_method: 'Cotizar_Autos', codAgt: '6645', cod_tipo_poliza: '1' },
      mapeos: { uso_codigo: '1' },
    };

    const sinEspecificar = buildSmgEnvelope({
      ...base,
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0', rastreo: '1' },
    });
    expect(sinEspecificar.requestMeta.nCodLocalizador).toBe('2');
    expect(sinEspecificar.requestMeta.rastreoSistemaEfectivo).toBe('lojack');

    const ituran = buildSmgEnvelope({
      ...base,
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0', rastreo: '1', rastreo_sistema: 'Ituran' },
    });
    expect(ituran.requestMeta.nCodLocalizador).toBe('6');
    expect(ituran.envelope).toContain('<nCodLocalizador>6</nCodLocalizador>');
  });

  test('prioriza la suma asegurada resuelta por SMG en el request final', () => {
    const { envelope, requestMeta } = buildSmgEnvelope({
      fila: { infoautocod: '300279', anio: '2025', CP: '1718', suma: '35700000' },
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0' },
      cfg: {
        soap_method: 'Cotizar_Autos',
        codAgt: '6645',
        cod_tipo_poliza: '1',
      },
      mapeos: { uso_codigo: '1' },
      sumaAseguradaOverride: '37170000',
    });

    expect(requestMeta).toMatchObject({
      nSumaAsegurada: '37170000',
      sumaAseguradaFuente: 'smg_lookup',
    });
    expect(envelope).toContain('<nSumaAsegurada>37170000</nSumaAsegurada>');
  });

  test('resuelve uso y provincia desde textos del sistema', () => {
    expect(resolveSmgUseCode({ fila: { uso: 'Comercial' } })).toBe('6');
    expect(resolveSmgUseCode({ fila: { uso: 'Particular' } })).toBe('1');
    expect(resolveSmgProvinceCode({ provincia: 'Tierra del Fuego' }, {}, {})).toBe('23');
    expect(resolveSmgProvinceCode({ Provincia: 'CABA' }, {}, {})).toBe('1');
  });

  test('aplica alias de codigo postal para Frigorifico CAP en SMG', () => {
    const postal = resolveSmgPostalCode({
      CP: '9421',
      Localidad: 'FRIGORIFICO CAP',
      Provincia: 'Tierra del Fuego',
    });

    expect(postal).toMatchObject({
      cp: '9420',
      originalCp: '9421',
      aliasApplied: true,
    });

    const { envelope, requestMeta } = buildSmgEnvelope({
      fila: {
        infoautocod: '120618',
        anio: '2025',
        CP: '9421',
        Localidad: 'FRIGORIFICO CAP',
        Provincia: 'Tierra del Fuego',
      },
      cabecera: { uso: 'Particular', cerokm: '0', gnc: '0' },
      cfg: { soap_method: 'Cotizar_Autos', codAgt: '6645', cod_tipo_poliza: '1' },
      mapeos: { uso_codigo: '1' },
      sumaAseguradaOverride: '30135000',
    });

    expect(requestMeta).toMatchObject({
      nCodPostal: '9420',
      codPostalOriginal: '9421',
      codPostalAliasAplicado: true,
      codPostalAliasFuente: 'smg_ws_no_reconoce_9421',
    });
    expect(envelope).toContain('<nCodPostal>9420</nCodPostal>');
  });

  test('arma y parsea el lookup de suma asegurada de SMG', () => {
    const { envelope, requestMeta } = buildSmgSumLookupEnvelope({
      fila: { infoautocod: '300279', anio: '2025' },
    });

    expect(requestMeta).toMatchObject({ codInfoAuto: '300279', Ano: '2025' });
    expect(envelope).toContain('<obtenerSAModeloAno xmlns="http://tempuri.org/">');
    expect(envelope).toContain('<codInfoAuto>300279</codInfoAuto>');

    const parsed = parseSmgSumLookupResponse(`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <obtenerSAModeloAnoResponse xmlns="http://tempuri.org/">
      <obtenerSAModeloAnoResult>37170000</obtenerSAModeloAnoResult>
    </obtenerSAModeloAnoResponse>
  </soap:Body>
</soap:Envelope>`);

    expect(parsed).toMatchObject({
      ok: true,
      sumaAsegurada: '37170000',
    });
  });

  test('parsea una respuesta exitosa de SMG', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Cotizar_Autos_fpResponse xmlns="http://tempuri.org/">
      <Cotizar_Autos_fpResult>
        <ResultadoLista>
          <Cotizacion>
            <IdCotizacion>98765</IdCotizacion>
            <CodCobertura>254</CodCobertura>
            <DescCobertura>TC3 C/A</DescCobertura>
            <Prima>1000.5</Prima>
            <Premio>1200.75</Premio>
            <Cuota>1200.75</Cuota>
            <UrlCotizacion>http://example.test/cotizacion.pdf</UrlCotizacion>
          </Cotizacion>
        </ResultadoLista>
        <ErrorResultado></ErrorResultado>
      </Cotizar_Autos_fpResult>
    </Cotizar_Autos_fpResponse>
  </soap:Body>
</soap:Envelope>`;

    const out = parseSmgQuoteResponse(xml, 'Cotizar_Autos_fp');
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('98765');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      idCotizacion: '98765',
      codigoDeCobertura: '254',
      descripcionDeCobertura: 'TC3 C/A',
      importePrima: '1000.5',
      importePremio: '1200.75',
      importeCuota: '1200.75',
    });
  });

  test('parsea ErrorResultado como fallo', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Cotizar_Autos_fpResponse xmlns="http://tempuri.org/">
      <Cotizar_Autos_fpResult>
        <ResultadoLista />
        <ErrorResultado>Datos invalidos</ErrorResultado>
      </Cotizar_Autos_fpResult>
    </Cotizar_Autos_fpResponse>
  </soap:Body>
</soap:Envelope>`;

    const out = parseSmgQuoteResponse(xml, 'Cotizar_Autos_fp');
    expect(out.ok).toBe(false);
    expect(out.error).toBe('Datos invalidos');
    expect(out.coberturas).toEqual([]);
  });
});

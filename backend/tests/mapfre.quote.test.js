const {
  buildMapfreEnvelope,
  isMapfrePostalMatchSafe,
  parseMapfreResponse,
  resolveMapfreCodPostal,
  resolveMapfrePostalMatch,
} = require('../services/mapfre/quote');

describe('Mapfre quote adapter', () => {
  const postalCatalog = [
    {
      codigo_postal: '1650',
      codigo_mapfre: '1650000',
      descripcion: 'MIGUELETE (PARADA FCGM)',
      codigo_provincia: '1',
      provincia: 'BUENOS AIRES',
    },
    {
      codigo_postal: '1650',
      codigo_mapfre: '1650001',
      descripcion: 'SAN MARTIN',
      codigo_provincia: '1',
      provincia: 'BUENOS AIRES',
    },
    {
      codigo_postal: '9410',
      codigo_mapfre: '9410000',
      descripcion: 'HOSTERIA PETREL',
      codigo_provincia: '24',
      provincia: 'TIERRA DEL FUEGO',
    },
    {
      codigo_postal: '9410',
      codigo_mapfre: '9410012',
      descripcion: 'USHUAIA',
      codigo_provincia: '24',
      provincia: 'TIERRA DEL FUEGO',
    },
    {
      codigo_postal: '4234',
      codigo_mapfre: '4234004',
      descripcion: 'SAN MARTIN (TAPSO-D ANCASTI)',
      codigo_provincia: '2',
      provincia: 'CATAMARCA',
    },
    {
      codigo_postal: '3514',
      codigo_mapfre: '3514000',
      descripcion: 'FONTANA',
      codigo_provincia: '16',
      provincia: 'CHACO',
    },
  ];

  test('traduce codPostal usando el catalogo oficial de Mapfre', () => {
    expect(
      resolveMapfreCodPostal(
        { CP: '1650', localidad: 'SAN MARTIN', provincia: 'Buenos Aires' },
        {},
        { postalCatalog }
      )
    ).toBe('1650001');

    expect(
      resolveMapfrePostalMatch(
        { CP: '9410', localidad: 'Ushuaua', provincia: 'Tierra del Fuego' },
        {},
        { postalCatalog }
      )
    ).toMatchObject({
      codigo_mapfre: '9410012',
      codigo_provincia: '24',
      descripcion: 'USHUAIA',
      matchType: 'fuzzy',
    });

    expect(
      resolveMapfreCodPostal(
        { codigo_postal: '3514', localidad: 'FONTANA', provincia: 'CHACO' },
        {},
        { postalCatalog }
      )
    ).toBe('3514000');
  });

  test('rechaza matches ambiguos por contiene para Mapfre', () => {
    const match = resolveMapfrePostalMatch(
      { CP: '1650', localidad: 'GENERAL SAN MARTIN', provincia: 'Buenos Aires' },
      {},
      { postalCatalog }
    );

    expect(match?.matchType).toBe('contiene');
    expect(isMapfrePostalMatchSafe(match)).toBe(false);
  });

  test('acepta aliases explicitos de domicilio para Mapfre', () => {
    const match = resolveMapfrePostalMatch(
      { CP: '4234', localidad: 'SAN MARTIN', provincia: 'Catamarca' },
      {},
      {
        postalCatalog,
        postalAliases: [
          {
            codigo_postal: '4234',
            provincia: 'Catamarca',
            localidad: 'SAN MARTIN',
            codigo_mapfre: '4234004',
          },
        ],
      }
    );

    expect(match).toMatchObject({
      codigo_mapfre: '4234004',
      codigo_provincia: '2',
      descripcion: 'SAN MARTIN (TAPSO-D ANCASTI)',
      matchType: 'alias',
    });
    expect(isMapfrePostalMatchSafe(match)).toBe(true);
  });

  test('permite equivalencia comercial de CP 1014 al codigo 1005', () => {
    expect(resolveMapfrePostalMatch(
      { CP: '1014', localidad: 'CAPITAL FEDERAL', provincia: 'Capital Federal' },
      {},
      { postalCatalog: [], postalAliases: [{
        codigo_postal: '1014', localidad: 'CAPITAL FEDERAL', provincia: 'Capital Federal', codigo_mapfre: '1005',
      }] }
    )).toMatchObject({ codigo_mapfre: '1005', matchType: 'alias' });
  });

  test('arma el request SOAP con datos principales de Mapfre', async () => {
    const { envelope, requestMeta } = await buildMapfreEnvelope({
      fila: {
        infoautocod: '450420',
        anio: '2023',
        CP: '1650',
        localidad: 'SAN MARTIN',
        provincia: 'Buenos Aires',
        suma: '25190000',
      },
      cabecera: {
        fec_nac: '19840311',
        sexo: 'M',
        medio_pago: 'Tarjeta de crédito',
        tipopersona: 'F',
        iva: 'CF',
        gnc: '0',
        rastreo: '0',
        cerokm: '0',
      },
      hoyFmt: '12032026',
      cfg: {
        codAgt: '21062',
        claveAcceso: '21NOVEC0',
        claveProcedencia: '',
        tipoFacturacion: 'M',
        parametros_extras: {
          moneda: '1',
          cobertura_default: '0',
          cod_prov_default: '0',
          porcentaje_ajuste_default: '',
        },
      },
      mapeos: { uso_codigo: '1' },
      postalCatalog,
    });

    expect(requestMeta).toMatchObject({
      codInfoauto: '450420',
      anio: '2023',
      codPostal: '1650001',
      valorVeh: '25190000.00',
      usoVehiculo: '1',
      tipoMedioPago: 'TC',
      codProv: '1',
      codPostalMatch: 'exacto',
      codPostalLocalidad: 'SAN MARTIN',
      codPostalProvincia: 'BUENOS AIRES',
    });
    expect(envelope).toContain('<cotizarRequest xmlns="http://ws.mapfre.com.ar/SuscripcionAutos">');
    expect(envelope).toContain('<codInfoauto>450420</codInfoauto>');
    expect(envelope).toContain('<codPostal>1650001</codPostal>');
    expect(envelope).toContain('<codProv>1</codProv>');
    expect(envelope).toContain('<tipoMedioPago>TC</tipoMedioPago>');
    expect(envelope).toContain('<codAgt>21062</codAgt>');
  });

  test('envia valorGNC como entero para Mapfre', async () => {
    const { envelope, requestMeta } = await buildMapfreEnvelope({
      fila: {
        infoautocod: '450420',
        anio: '2023',
        CP: '1650',
        localidad: 'SAN MARTIN',
        provincia: 'Buenos Aires',
        suma: '25190000',
      },
      cabecera: {
        fec_nac: '19840311',
        sexo: 'M',
        medio_pago: 'Tarjeta de crédito',
        tipopersona: 'F',
        iva: 'CF',
        gnc: '1',
        suma_gnc: '300000',
        rastreo: '0',
      },
      hoyFmt: '12032026',
      cfg: {
        codAgt: '21062',
        claveAcceso: '21NOVEC0',
        claveProcedencia: '',
        tipoFacturacion: 'M',
        parametros_extras: {
          moneda: '1',
          cobertura_default: '0',
          cod_prov_default: '0',
          porcentaje_ajuste_default: '',
        },
      },
      mapeos: { uso_codigo: '1' },
      postalCatalog,
    });

    expect(requestMeta.conGNC).toBe('1');
    expect(envelope).toContain('<valorGNC>300000</valorGNC>');
    expect(envelope).not.toContain('<valorGNC>300000.00</valorGNC>');
  });

  test('parsea una respuesta exitosa de Mapfre con varias coberturas', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns1:cotizarResponse xmlns:ns1="http://ws.mapfre.com.ar/SuscripcionAutos">
      <ns1:errores>
        <ns1:error>
          <ns1:codigo>0</ns1:codigo>
          <ns1:descripcion xsi:nil="1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
        </ns1:error>
      </ns1:errores>
      <ns1:productoresCotizacionResultado>
        <ns1:productorCotizacionResultado>
          <ns1:codAgt>21062</ns1:codAgt>
          <ns1:numPropuesta>36546960</ns1:numPropuesta>
          <ns1:error>
            <ns1:codigo>0</ns1:codigo>
            <ns1:descripcion></ns1:descripcion>
          </ns1:error>
          <ns1:cotizacionesResultado>
            <ns1:CotizacionResultado>
              <ns1:numCotizacion>W200220552</ns1:numCotizacion>
              <ns1:cobertura>31</ns1:cobertura>
              <ns1:nombreProducto>POLIZA BASICA</ns1:nombreProducto>
              <ns1:codigoModalidad>3101</ns1:codigoModalidad>
              <ns1:montoPremio>72428.7</ns1:montoPremio>
              <ns1:sumaAsegurada>25190000</ns1:sumaAsegurada>
              <ns1:sumaGNC>0</ns1:sumaGNC>
              <ns1:codError>0</ns1:codError>
            </ns1:CotizacionResultado>
            <ns1:CotizacionResultado>
              <ns1:numCotizacion>W200220554</ns1:numCotizacion>
              <ns1:cobertura>14</ns1:cobertura>
              <ns1:nombreProducto>ACTIVA</ns1:nombreProducto>
              <ns1:codigoModalidad>1402</ns1:codigoModalidad>
              <ns1:montoPremio>88122.62</ns1:montoPremio>
              <ns1:sumaAsegurada>25190000</ns1:sumaAsegurada>
              <ns1:sumaGNC>0</ns1:sumaGNC>
              <ns1:codError>0</ns1:codError>
            </ns1:CotizacionResultado>
          </ns1:cotizacionesResultado>
        </ns1:productorCotizacionResultado>
      </ns1:productoresCotizacionResultado>
    </ns1:cotizarResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = parseMapfreResponse(xml);
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('36546960');
    expect(out.suma_asegurada).toBe('25190000');
    expect(out.coberturas).toHaveLength(2);
    expect(out.coberturas[0]).toMatchObject({
      numCotizacion: 'W200220552',
      codigoModalidad: '3101',
      nombreProducto: 'POLIZA BASICA',
    });
  });
});

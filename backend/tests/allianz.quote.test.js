const {
  buildAllianzEnvelope,
  parseAllianzQuoteResponse,
  resolveAllianzPayment,
  resolveAllianzPostalCode,
  buildAdditionalXml,
} = require('../services/allianz/quote');

describe('Allianz quote adapter', () => {
  test('resuelve forma de pago Allianz desde la cabecera', () => {
    expect(resolveAllianzPayment({
      cabecera: { medio_pago: 'Tarjeta de crédito' },
      cfg: { parametros_extras: { tipo_poliza_default: 'M', cantidad_cuotas_default: '1' } },
    })).toMatchObject({ medioDePago: 'T', tipoDePoliza: 'M', cantidadDeCuotas: '1' });

    expect(resolveAllianzPayment({
      cabecera: { medio_pago: 'Efectivo' },
      cfg: { parametros_extras: { tipo_poliza_default: 'S', cantidad_cuotas_default: '1' } },
    })).toMatchObject({ medioDePago: 'E', tipoDePoliza: 'S', cantidadDeCuotas: '1' });
  });

  test('arma el request SOAP de Allianz con header y condiciones de contratacion', async () => {
    const { envelope, requestMeta } = await buildAllianzEnvelope({
      fila: {
        infoautocod: '18461',
        anio: '2012',
        CP: '1005',
        cerokm: '1',
      },
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        fec_nac: '19850705',
        sexo: 'M',
        nrodoc: '11444777',
        tipodoc: 'DNI',
        rastreo: '1',
        iva: 'CF',
        uso: 'Particular',
      },
      cfg: {
        usuario: 'demo-user',
        password: 'demo-pass',
        application: 'AutoIQ',
        sender_username: 'sender@example.com',
        producer_code: 'M22054',
        country: 'ARG',
        target: 'Allianz',
        descuento_comercial: '-20',
        clausula_ajuste: '20',
        parametros_extras: {
          tipo_poliza_default: 'M',
          medio_pago_default: 'T',
          cantidad_cuotas_default: '1',
          codigo_condicion_iva_default: '1',
          codigo_condicion_iibb_default: '1',
          tipo_documento_default: 'D',
          codigo_provincia_default: '0',
          valor_vehiculo_default: '0',
        },
      },
      usoDicc: { particular: '1', comercial: '2' },
      mapeos: { uso_codigo: '1' },
      today: new Date('2026-03-17T12:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      codigoMarcaModelo: '18461',
      anioFabricacion: '2012',
      valorVehiculo: '0',
      codigoDeUso: '1',
      tipoDePoliza: 'M',
      medioDePago: 'T',
      cantidadDeCuotas: '1',
      codigoPostal: '1005',
      codigoProvincia: '0',
      codigoDeProductor: 'M22054',
      clausulaDeAjuste: '20',
    });
    expect(envelope).toContain('<user>demo-user</user>');
    expect(envelope).toContain('<pwd>demo-pass</pwd>');
    expect(envelope).toContain('<ebm:userName>sender@example.com</ebm:userName>');
    expect(envelope).toContain('<ebm:Application>AutoIQ</ebm:Application>');
    expect(envelope).toContain('<cot:codigoDeProductor>M22054</cot:codigoDeProductor>');
    expect(envelope).toContain('<cot:codigoMarcaModelo>18461</cot:codigoMarcaModelo>');
    expect(envelope).toContain('<cot:es0Km>true</cot:es0Km>');
    expect(envelope).toContain('<con:tipoDePoliza>M</con:tipoDePoliza>');
    expect(envelope).toContain('<con:medioDePago>T</con:medioDePago>');
    expect(envelope).toContain('<cot:codigoPostal>1005</cot:codigoPostal>');
    expect(envelope).toContain('<cot:codigoEsquema>001</cot:codigoEsquema>');
  });

  test('permite armar variantes con y sin adicional de granizo', async () => {
    const base = {
      fila: {
        infoautocod: '18461',
        anio: '2012',
        CP: '1005',
      },
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        fec_nac: '19850705',
        sexo: 'M',
      },
      cfg: {
        usuario: 'demo-user',
        password: 'demo-pass',
        application: 'AutoIQ',
        sender_username: 'sender@example.com',
        producer_code: 'M22054',
        parametros_extras: {
          tipo_poliza_default: 'M',
          medio_pago_default: 'T',
          cantidad_cuotas_default: '1',
          codigo_condicion_iva_default: '1',
          codigo_condicion_iibb_default: '1',
          tipo_documento_default: 'D',
          codigo_provincia_default: '0',
          valor_vehiculo_default: '0',
        },
      },
      today: new Date('2026-03-17T12:00:00Z'),
    };

    const withoutGranizo = await buildAllianzEnvelope({
      ...base,
      additional: { sendEmptyList: true },
    });
    const withGranizo = await buildAllianzEnvelope({
      ...base,
      additional: { codigoDeAdicional: '001', descripcion: 'Granizo' },
    });

    expect(withoutGranizo.envelope).toContain('<cot:ListaAdicionales/>');
    expect(withoutGranizo.requestMeta).toMatchObject({
      listaAdicionales: 'vacia',
      adicionalCodigo: '',
    });
    expect(withGranizo.envelope).toContain('<cot:codigoDeAdicional>001</cot:codigoDeAdicional>');
    expect(withGranizo.requestMeta).toMatchObject({
      listaAdicionales: 'con_adicional',
      adicionalCodigo: '001',
      adicionalDescripcion: 'Granizo',
    });
    expect(buildAdditionalXml({ codigoDeAdicional: '001' })).toContain('<cot:codigoDeAdicional>001</cot:codigoDeAdicional>');
  });

  test('usa esquema 002 para recargos en Allianz', async () => {
    const { envelope } = await buildAllianzEnvelope({
      fila: {
        infoautocod: '18461',
        anio: '2012',
        CP: '1005',
      },
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        fec_nac: '19850705',
        sexo: 'M',
        nrodoc: '11444777',
        tipodoc: 'DNI',
      },
      cfg: {
        usuario: 'demo-user',
        password: 'demo-pass',
        application: 'AutoIQ',
        sender_username: 'sender@example.com',
        producer_code: 'M22054',
        descuento_comercial: '15',
        parametros_extras: {
          tipo_poliza_default: 'M',
          medio_pago_default: 'T',
          cantidad_cuotas_default: '1',
          codigo_condicion_iva_default: '1',
          codigo_condicion_iibb_default: '1',
          tipo_documento_default: 'D',
          codigo_provincia_default: '0',
          valor_vehiculo_default: '0',
        },
      },
      today: new Date('2026-03-17T12:00:00Z'),
    });

    expect(envelope).toContain('<cot:codigoEsquema>002</cot:codigoEsquema>');
  });

  test('aplica alias de codigo postal para San Martin Catamarca cuando Allianz no acepta el original', async () => {
    expect(resolveAllianzPostalCode({
      fila: {
        CP: '4234',
        Localidad: 'SAN MARTIN',
        Provincia: 'Catamarca',
      },
      postalAliases: [
        {
          inputCodPostal: '4234',
          inputLocalidad: 'San Martin',
          inputProvincia: 'Catamarca',
          codPostal: '4235',
          reason: 'Alias de Allianz',
        },
      ],
    })).toMatchObject({
      codigoPostal: '4235',
      originalCodigoPostal: '4234',
      aliasApplied: true,
      aliasReason: 'Alias de Allianz',
    });

    const { envelope, requestMeta } = await buildAllianzEnvelope({
      fila: {
        infoautocod: '120618',
        anio: '2025',
        CP: '4234',
        Localidad: 'SAN MARTIN',
        Provincia: 'Catamarca',
      },
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        fec_nac: '19860413',
        sexo: 'M',
        tipodoc: 'DNI',
        iva: 'CF',
      },
      cfg: {
        usuario: 'demo-user',
        password: 'demo-pass',
        application: 'AutoIQ',
        sender_username: 'sender@example.com',
        producer_code: 'M22054',
        parametros_extras: {
          tipo_poliza_default: 'M',
          medio_pago_default: 'T',
          cantidad_cuotas_default: '1',
          codigo_condicion_iva_default: '1',
          codigo_condicion_iibb_default: '1',
          tipo_documento_default: 'D',
          codigo_provincia_default: '0',
          valor_vehiculo_default: '0',
        },
      },
      postalAliases: [
        {
          inputCodPostal: '4234',
          inputLocalidad: 'San Martin',
          inputProvincia: 'Catamarca',
          codPostal: '4235',
          reason: 'Alias de Allianz',
        },
      ],
      today: new Date('2026-04-14T12:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      codigoPostal: '4235',
      codigoPostalOriginal: '4234',
      codigoPostalAliasApplied: true,
      codigoPostalAliasReason: 'Alias de Allianz',
    });
    expect(envelope).toContain('<cot:codigoPostal>4235</cot:codigoPostal>');
  });

  test('parsea una respuesta exitosa de Allianz', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <cot:CalcularCotizacionFullVehiculoResponseEBM xmlns:cot="http://xmlns.allianz.com.ar/Core/EBM/Vehiculo/CotizacionVehiculo">
      <ebm:ReturnCode xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM">0</ebm:ReturnCode>
      <ebm:ReturnMessage xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM"/>
      <ebm:ErrorCode xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM"/>
      <cot:DataArea>
        <cot:CalcularCotizacionFullVehiculoResponse>
          <cot:numeroDeCotizacion>141676</cot:numeroDeCotizacion>
          <cot:ListaCotizacionFull>
            <cot1:CotizacionFull xmlns:cot1="http://xmlns.allianz.com.ar/Core/EBO/Allianz/CotizacionFullVehiculo">
              <cot1:codigoDeCobertura>36</cot1:codigoDeCobertura>
              <cot1:descripcionDeCobertura>RESPONSABILIDAD CIVIL</cot1:descripcionDeCobertura>
              <cot1:codigoDeProducto>52</cot1:codigoDeProducto>
              <cot1:descripcionDeProducto>BASICA</cot1:descripcionDeProducto>
              <cot1:prima>
                <prim:importePrima xmlns:prim="http://xmlns.allianz.com.ar/Core/EBO/Allianz/Prima">146.75</prim:importePrima>
              </cot1:prima>
              <cot1:premio>
                <prem:importePremio xmlns:prem="http://xmlns.allianz.com.ar/Core/EBO/Allianz/Premio">180.8</prem:importePremio>
              </cot1:premio>
              <cot1:impuestos>
                <imp:importeIVA xmlns:imp="http://xmlns.allianz.com.ar/Core/EBO/Allianz/Impuesto">30.82</imp:importeIVA>
              </cot1:impuestos>
              <cot1:sumaAsegurada>154700</cot1:sumaAsegurada>
              <cot1:requiereInspeccion>false</cot1:requiereInspeccion>
              <cot1:ListaFranquicias>
                <cot1:Franquicia>
                  <cot1:codigoTipoFranquicia>F</cot1:codigoTipoFranquicia>
                  <cot1:valorFranquicia>4000</cot1:valorFranquicia>
                </cot1:Franquicia>
              </cot1:ListaFranquicias>
            </cot1:CotizacionFull>
          </cot:ListaCotizacionFull>
        </cot:CalcularCotizacionFullVehiculoResponse>
      </cot:DataArea>
    </cot:CalcularCotizacionFullVehiculoResponseEBM>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = parseAllianzQuoteResponse(xml);
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('141676');
    expect(out.suma_asegurada).toBe('154700');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      codigoDeCobertura: '36',
      descripcionDeCobertura: 'RESPONSABILIDAD CIVIL',
      importePrima: '146.75',
      importePremio: '180.8',
      requiereInspeccion: 'false',
    });
  });
});

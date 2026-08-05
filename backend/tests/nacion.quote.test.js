const {
  buildNacionEnvelope,
  parseNacionQuoteResponse,
} = require('../services/nacion/quote');

describe('Nacion quote adapter', () => {
  test('arma un draft SOAP con campos base de cotizacion', () => {
    const { envelope, requestMeta } = buildNacionEnvelope({
      fila: {
        infoautocod: '450420',
        anio: '2023',
        CP: '1650',
        suma: '25190000',
        combustible: 'Nafta',
      },
      cabecera: {
        nrodoc: '30111222333',
        tipodoc: 'CUIT',
        iva: 'RI',
        medio_pago: 'Tarjeta de crédito',
        uso: 'Particular',
      },
      cfg: {
        cotizador_id: 'COT-TEST',
        usuario_aplicacion: 'APP-TEST',
      },
      mapeos: { uso_codigo: '1' },
      today: new Date('2026-03-20T10:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      cotizadorId: 'COT-TEST',
      usuarioAplicacion: 'APP-TEST',
      tipoDocumento: '80',
      codigoPostal: '1650',
      codInfoauto: '450420',
      anio: '2023',
      categoriaIva: '1',
      formaPago: '2',
      usoVehiculo: '1',
      tipoCombustible: '3',
      sumaAsegurada: '25190000.00',
    });
    expect(envelope).toContain('<SER_CotizadorEnviarCoberturas>');
    expect(envelope).toContain('<COTIZADOR_ID>COT-TEST</COTIZADOR_ID>');
    expect(envelope).toContain('<USUARIO_APLICACION>APP-TEST</USUARIO_APLICACION>');
    expect(envelope).toContain('<CODIGO_INFOAUTO>450420</CODIGO_INFOAUTO>');
  });

  test('parsea una respuesta basica con coberturas y mensajes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <SER_CotizadorEnviarCoberturasRespuesta>
      <RESPUESTA_PROCESO>
        <SALIDA>9</SALIDA>
        <NUMERO_PRESUPUESTO>123456</NUMERO_PRESUPUESTO>
        <LISTA_COBERTURAS>
          <COBERTURA>
            <CODIGO>14</CODIGO>
            <DESCRIPCION>Terceros Completo</DESCRIPCION>
            <PLAN>PLAN A</PLAN>
            <PREMIO>88122.62</PREMIO>
            <SUMA_ASEGURADA>25190000</SUMA_ASEGURADA>
          </COBERTURA>
        </LISTA_COBERTURAS>
      </RESPUESTA_PROCESO>
    </SER_CotizadorEnviarCoberturasRespuesta>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = parseNacionQuoteResponse(xml);
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('123456');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      codigo: '14',
      descripcion: 'Terceros Completo',
      plan: 'PLAN A',
      premio: '88122.62',
      sumaAsegurada: '25190000.00',
    });
  });
});

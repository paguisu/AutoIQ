const {
  buildSoapEnvelope,
  formatByPattern,
  xmlToJson,
} = require('../services/atm/client');

describe('ATM SOAP client', () => {
  test('formatea fechas en los formatos admitidos por ATM', () => {
    const date = new Date(2026, 7, 11);

    expect(formatByPattern(date, 'ddMMyyyy')).toBe('11082026');
    expect(formatByPattern(date, 'yyyyMMdd')).toBe('20260811');
    expect(formatByPattern(date, 'dd/MM/yyyy')).toBe('11/08/2026');
    expect(formatByPattern(date, 'yyyy-MM-dd')).toBe('2026-08-11');
  });

  test('construye un sobre SOAP valido con el contenido recibido', () => {
    const xml = buildSoapEnvelope('<AUTOS_Cotizar_PHP><doc_in>dato</doc_in></AUTOS_Cotizar_PHP>');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<SOAP-ENV:Envelope');
    expect(xml).toContain('<SOAP-ENV:Body>');
    expect(xml).toContain('<AUTOS_Cotizar_PHP>');
  });

  test('interpreta una respuesta SOAP exitosa siguiendo la ruta indicada', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
        <SOAP-ENV:Body>
          <AUTOS_Cotizar_PHPResponse>
            <AUTOS_Cotizar_PHPResult>respuesta</AUTOS_Cotizar_PHPResult>
          </AUTOS_Cotizar_PHPResponse>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>`;

    const result = await xmlToJson(xml, ['AUTOS_Cotizar_PHPResponse', 'AUTOS_Cotizar_PHPResult']);

    expect(result).toEqual({ ok: true, data: 'respuesta' });
  });

  test('identifica un SOAP Fault como error', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
        <SOAP-ENV:Body>
          <SOAP-ENV:Fault>
            <faultcode>SOAP-ENV:Client</faultcode>
            <faultstring>Solicitud invalida</faultstring>
          </SOAP-ENV:Fault>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>`;

    const result = await xmlToJson(xml);

    expect(result).toEqual({ ok: false, fault: 'Fault/Solicitud invalida' });
  });
});

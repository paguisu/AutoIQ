const {
  buildSancorEnvelope,
  normalizeSancorInfoautoCode,
  parseSancorQuoteResponse,
  resolveSancorLocalidad,
} = require('../services/sancor/quote');

describe('Sancor quote adapter', () => {
  const localityCatalog = [
    { codPostal: '1653', codLocalidad: '418', localidad: 'VILLA BALLESTER', codProvincia: '1', provincia: 'Buenos Aires', _loc: 'VILLA BALLESTER', _prov: 'BUENOS AIRES' },
    { codPostal: '1429', codLocalidad: '30001', localidad: 'CIUDAD AUTONOMA BUENOS AIRES', codProvincia: '2', provincia: 'Capital Federal', _loc: 'CIUDAD AUTONOMA BUENOS AIRES', _prov: 'CAPITAL FEDERAL' },
    { codPostal: '1631', codLocalidad: '69', localidad: 'MARTINEZ', codProvincia: '1', provincia: 'Buenos Aires', _loc: 'MARTINEZ', _prov: 'BUENOS AIRES' },
  ];

  test('resuelve localidad Sancor por cp y localidad', () => {
    expect(
      resolveSancorLocalidad(
        { CP: '1653', localidad: 'Villa Ballester', provincia: 'Buenos Aires' },
        {},
        { localityCatalog }
      )
    ).toMatchObject({
      codLocalidad: '418',
      codProvincia: '1',
      matchType: 'cp_unico',
    });
  });

  test('arma el request SOAP de Sancor con la localidad catalogada', () => {
    const { envelope, requestMeta } = buildSancorEnvelope({
      fila: {
        infoautocod: '0180454',
        anio: '2008',
        CP: '1653',
        localidad: 'Villa Ballester',
        provincia: 'Buenos Aires',
      },
      cabecera: {
        iva: 'CF',
        gnc: '0',
        cerokm: '0',
      },
      cfg: {
        producer_code: '234095',
        supervisor_code: '151557',
        parametros_extras: {
          product_id: '24',
          use_particular: '2',
          iva_condition_id_default: '4',
          discount_customizations: [
            { discountNumber: '1', rate: '99' },
          ],
          scoring_options: [
            { typeId: '3', selectedOptionId: '1' },
          ],
        },
      },
      localityCatalog,
      today: new Date('2026-03-13T12:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      codInfoauto: '0180454',
      anio: '2008',
      codPostal: '1653',
      codLocalidad: '418',
      useId: '2',
      ivaConditionId: '4',
      capital: '0.00',
    });
    expect(envelope).toContain('<b:Id>418</b:Id>');
    expect(envelope).toContain('<b:ZipCode>1653</b:ZipCode>');
    expect(envelope).toContain('<d:Code>0180454</d:Code>');
    expect(envelope).toContain('<d:Capital>0.00</d:Capital>');
    expect(envelope).toContain('<c:Code>234095</c:Code>');
    expect(envelope).toContain('<c:Supervisor>151557</c:Supervisor>');
  });

  test('normaliza codigo infoauto de Sancor a 7 digitos', () => {
    expect(normalizeSancorInfoautoCode('60533')).toBe('0060533');
    expect(normalizeSancorInfoautoCode(120537)).toBe('0120537');
    expect(normalizeSancorInfoautoCode('0180454')).toBe('0180454');
  });

  test('parsea una respuesta exitosa con planes de Sancor', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <nspm:NewVehicle_Rs xmlns:nspm="http://GrupoSancorSeguros/xsd/service/PriceSvcMsg">
      <nspm:Plans>
        <nspm:Plan>
          <PremiumMonthly>99706.00</PremiumMonthly>
          <Premium>1196466.17</Premium>
          <ShortDescr>Auto Max 3</ShortDescr>
          <LongDescr>Auto Max 3 (RC/IP/IT/RT/RP c/Asistencia)</LongDescr>
          <Module>14</Module>
          <Success>true</Success>
          <VehicleValuation>20100000</VehicleValuation>
          <PricingId>346342547</PricingId>
        </nspm:Plan>
      </nspm:Plans>
      <nspm:Price>
        <QuotationId>394774119</QuotationId>
        <RelationQuotationId>39357008</RelationQuotationId>
      </nspm:Price>
      <nspm:Result>
        <ErrorCode>SOA-GSS-0000</ErrorCode>
        <ErrorMsg>Success</ErrorMsg>
      </nspm:Result>
    </nspm:NewVehicle_Rs>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = parseSancorQuoteResponse(xml);
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('394774119');
    expect(out.suma_asegurada).toBe('20100000');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      module: '14',
      shortDescr: 'Auto Max 3',
      premiumMonthly: '99706',
      vehicleValuation: '20100000',
    });
  });
});

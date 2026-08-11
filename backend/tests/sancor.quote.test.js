const {
  buildSancorEnvelope,
  normalizeSancorInfoautoCode,
  parseSancorQuoteResponse,
  resolveSancorLocalidad,
  summarizeSancorPlanResults,
} = require('../services/sancor/quote');

describe('Sancor quote adapter', () => {
  const localityCatalog = [
    { codPostal: '1653', codLocalidad: '418', localidad: 'VILLA BALLESTER', codProvincia: '1', provincia: 'Buenos Aires', _loc: 'VILLA BALLESTER', _prov: 'BUENOS AIRES' },
    { codPostal: '1429', codLocalidad: '30001', localidad: 'CIUDAD AUTONOMA BUENOS AIRES', codProvincia: '2', provincia: 'Capital Federal', _loc: 'CIUDAD AUTONOMA BUENOS AIRES', _prov: 'CAPITAL FEDERAL' },
    { codPostal: '1631', codLocalidad: '69', localidad: 'MARTINEZ', codProvincia: '1', provincia: 'Buenos Aires', _loc: 'MARTINEZ', _prov: 'BUENOS AIRES' },
    { codPostal: '9420', codLocalidad: '17727', localidad: 'Frigorifico Cap-rio Grande', codProvincia: '23', provincia: 'Tierra del Fuego', _loc: 'FRIGORIFICO CAP RIO GRANDE', _prov: 'TIERRA DEL FUEGO' },
    { codPostal: '8400', codLocalidad: '16802', localidad: 'Bariloche', codProvincia: '23', provincia: 'Rio Negro', _loc: 'BARILOCHE', _prov: 'RIO NEGRO' },
    { codPostal: '8400', codLocalidad: '16815', localidad: 'San Carlos de Bariloche', codProvincia: '23', provincia: 'Rio Negro', _loc: 'SAN CARLOS DE BARILOCHE', _prov: 'RIO NEGRO' },
  ];
  const localityAliases = [
    {
      inputCodPostal: '9421',
      inputLocalidad: 'FRIGORIFICO CAP',
      inputProvincia: 'Tierra del Fuego',
      codPostal: '9420',
      codLocalidad: '17727',
      localidad: 'Frigorifico Cap-rio Grande',
      codProvincia: '23',
      provincia: 'Tierra del Fuego',
    },
    {
      inputCodPostal: '8400',
      inputLocalidad: 'BARILOCHE',
      inputProvincia: 'Rio Negro',
      codPostal: '8400',
      codLocalidad: '16815',
      localidad: 'San Carlos de Bariloche',
      codProvincia: '23',
      provincia: 'Rio Negro',
    },
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

  test('resuelve alias de localidad Sancor cuando el CP de entrada no existe en catalogo', () => {
    expect(
      resolveSancorLocalidad(
        { CP: '9421', localidad: 'Frigorifico Cap', provincia: 'Tierra del Fuego' },
        {},
        { localityCatalog, localityAliases }
      )
    ).toMatchObject({
      codPostal: '9420',
      codLocalidad: '17727',
      codProvincia: '23',
      matchType: 'alias',
    });
  });

  test('prioriza alias aprobado de Bariloche sobre match exacto rechazado por Sancor', () => {
    expect(
      resolveSancorLocalidad(
        { CP: '8400', localidad: 'Bariloche', provincia: 'Rio Negro' },
        {},
        { localityCatalog, localityAliases }
      )
    ).toMatchObject({
      codPostal: '8400',
      codLocalidad: '16815',
      localidad: 'San Carlos de Bariloche',
      codProvincia: '23',
      matchType: 'alias',
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

  test('arma el request SOAP de Sancor usando alias de localidad y conserva el CP original en metadata', () => {
    const { envelope, requestMeta } = buildSancorEnvelope({
      fila: {
        infoautocod: '0120618',
        anio: '2023',
        CP: '9421',
        localidad: 'Frigorifico Cap',
        provincia: 'Tierra del Fuego',
      },
      cabecera: {
        iva: 'CF',
        gnc: '0',
        cerokm: '0',
      },
      cfg: {
        producer_code: '234095',
        supervisor_code: '151557',
      },
      localityCatalog,
      localityAliases,
      today: new Date('2026-04-13T12:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      codPostalOriginal: '9421',
      codPostal: '9420',
      codLocalidad: '17727',
      localidadMatchType: 'alias',
    });
    expect(envelope).toContain('<b:Id>17727</b:Id>');
    expect(envelope).toContain('<b:ZipCode>9420</b:ZipCode>');
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

  test('resume resultados de Sancor en prima y premio mensuales consistentes', () => {
    const summary = summarizeSancorPlanResults([
      { Detail: 'Prima', DetailType: 'Cobertura', PurePremiumMonthly: 1000, PurePremium: 12000 },
      { Detail: 'Prima', DetailType: 'RecargosComerciales', PurePremiumMonthly: 200, PurePremium: 2400 },
      { Detail: 'IvaGeneral', DetailType: 'Impuesto', PurePremiumMonthly: 252, PurePremium: 3024 },
      { Detail: 'TasasImpuestos', DetailType: 'Impuesto', PurePremiumMonthly: 48, PurePremium: 576 },
    ]);

    expect(summary).toMatchObject({
      primaMonthlyText: '1200',
      totalMonthlyText: '1500',
      ivaMonthlyText: '252',
      impuestosMonthlyText: '300',
      primaAnnualText: '14400',
      totalAnnualText: '18000',
    });
  });

  test('prioriza PrimaTotal y separa mensual/vigencia sin perder premium anual original', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <nspm:NewVehicle_Rs xmlns:nspm="http://GrupoSancorSeguros/xsd/service/PriceSvcMsg">
      <nspm:Plans>
        <nspm:Plan>
          <PremiumMonthly>1500.00</PremiumMonthly>
          <Premium>18000.00</Premium>
          <ShortDescr>Auto Todo Riesgo 4%</ShortDescr>
          <LongDescr>Auto Todo Riesgo 4% (c/deduc.)</LongDescr>
          <Module>24</Module>
          <Success>true</Success>
          <VehicleValuation>20100000</VehicleValuation>
          <PricingId>346342547</PricingId>
          <PrimaTotal>
            <PurePremiumMonthlyTotal>1190.00</PurePremiumMonthlyTotal>
            <PurePremiumTotal>14280.00</PurePremiumTotal>
          </PrimaTotal>
          <TaxBases>
            <TaxBase>
              <IvaMonthly>1140.38</IvaMonthly>
              <Iva>13684.56</Iva>
            </TaxBase>
          </TaxBases>
          <Results>
            <Result>
              <Detail>Prima</Detail>
              <DetailType>Cobertura</DetailType>
              <PurePremiumMonthly>1000.00</PurePremiumMonthly>
              <PurePremium>12000.00</PurePremium>
            </Result>
            <Result>
              <Detail>Prima</Detail>
              <DetailType>RecargosComerciales</DetailType>
              <PurePremiumMonthly>200.00</PurePremiumMonthly>
              <PurePremium>2400.00</PurePremium>
            </Result>
            <Result>
              <Detail>IvaGeneral</Detail>
              <DetailType>Impuesto</DetailType>
              <PurePremiumMonthly>252.00</PurePremiumMonthly>
              <PurePremium>3024.00</PurePremium>
            </Result>
            <Result>
              <Detail>TasasImpuestos</Detail>
              <DetailType>Impuesto</DetailType>
              <PurePremiumMonthly>48.00</PurePremiumMonthly>
              <PurePremium>576.00</PurePremium>
            </Result>
          </Results>
        </nspm:Plan>
      </nspm:Plans>
      <nspm:Price>
        <QuotationId>394774119</QuotationId>
      </nspm:Price>
      <nspm:Result>
        <ErrorCode>SOA-GSS-0000</ErrorCode>
        <ErrorMsg>Success</ErrorMsg>
      </nspm:Result>
    </nspm:NewVehicle_Rs>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = parseSancorQuoteResponse(xml);
    expect(out.coberturas[0]).toMatchObject({
      prima: '1190',
      premio: '1500',
      importePrima: '1190',
      importePremio: '1500',
      importeIVA: '252',
      purePremiumMonthlyTotal: '1190',
      purePremiumTotal: '14280',
      primaAnnual: '14280',
      premioAnnual: '18000',
      ivaTaxBaseMonthly: '1140.38',
      ivaTaxBase: '13684.56',
      ivaMonthly: '252',
      ivaAnnual: '3024',
      impuestosMonthly: '300',
      impuestosAnnual: '3600',
      premium: '18000',
    });
  });

  test('parsea SOAP Fault de negocio como error no retryable', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>BusinessError - The request could not be processed by due to invalid parameters: Vehicle Code is not valid</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

    const out = parseSancorQuoteResponse(xml);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Vehicle Code is not valid');
    expect(out.technical_error).toBe(false);
    expect(out.retryable).toBe(false);
    expect(out.pending).toBe(false);
  });
});

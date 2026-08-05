const {
  buildRivadaviaSoapPayload,
  buildRivadaviaSoapEnvelope,
  mapRivadaviaSoapProvincia,
  parseRivadaviaSoapQuoteResponse,
  resolveRivadaviaCoeficients,
  resolveRivadaviaAlarmaSatelital,
} = require('../services/rivadavia/quote');

describe('Rivadavia quote adapter', () => {
  test('mapea rastreo de cabecera a alarmaSatelital configurable', () => {
    expect(resolveRivadaviaAlarmaSatelital({ rastreo: '0' }, {})).toBe('SIN_ALARMA');
    expect(resolveRivadaviaAlarmaSatelital(
      { rastreo: '1' },
      { parametros_extras: { alarma_satelital_con_default: 'CON_ALARMA' } }
    )).toBe('CON_ALARMA');
  });

  test('resuelve coeficientes RC y casco con default 0.9', () => {
    expect(resolveRivadaviaCoeficients({ cfg: {} })).toEqual({
      coefRC: '0.9',
      coefCasco: '0.9',
    });
    expect(resolveRivadaviaCoeficients({
      cabecera: { coeficiente_rc: '0.8', coeficiente_casco: '0.8' },
      cfg: { ajuste_rc: '0.9', ajuste_casco: '0.9' },
    })).toEqual({
      coefRC: '0.8',
      coefCasco: '0.8',
    });
  });

  test('arma envelope SOAP con CoefRC y CoefCasco', () => {
    const xml = buildRivadaviaSoapEnvelope({
      NroProductor: '7791',
      Clave: 'TDJX1754',
      Matricula: '0',
      TipoDocumento: '0',
      NroDocumento: '0',
      CUIL: '0',
      CUIT: '0',
      Poliza: '0',
      CodInfoAuto: '460569',
      CodVehiculo: '1',
      ModeloAnio: '2012',
      SumaAsegurada: '11400000',
      Ajuste: '30',
      PoseeGNC: '1',
      SumaAseguradaAccesorios: '0',
      SumaAseguradaEquipaje: '0',
      Asientos: '0',
      AlarmaSatelital: '0',
      Subrogado: '0',
      Vinculada01: '0',
      Vinculada02: '0',
      Vinculada03: '0',
      Vinculada04: '0',
      Vinculada05: '0',
      FechaNacimiento: '31/07/1994',
      CoefRC: '0.9',
      CoefCasco: '0.9',
      CondicionIVA: '1',
      CondicionIB: '1',
      PersonaJuridica: 'N',
      VigDesde: '20260731',
      VigHasta: '20270731',
      FormaPago: '3',
      CantCuotas: '3',
      Facturacion: '5',
      CodigoProvincia: '1',
      CodigoPostal: '1708',
      PorcBonif: '0',
      AniosSinSiniestros: '0',
    });

    expect(xml).toContain('<CoefRC xsi:type="xsd:string">0.9</CoefRC>');
    expect(xml).toContain('<CoefCasco xsi:type="xsd:string">0.9</CoefCasco>');
    expect(xml).toContain('<tns:solicitudCotizacion');
  });

  test('mapea provincia SOAP segun codigos legados de Rivadavia', async () => {
    expect(mapRivadaviaSoapProvincia({ provincia: 'Capital Federal' })).toBe('2');
    expect(mapRivadaviaSoapProvincia({ provincia: 'CABA' })).toBe('2');
    expect(mapRivadaviaSoapProvincia({ provincia: 'Buenos Aires' })).toBe('1');
    expect(mapRivadaviaSoapProvincia({ CP: '1650', Localidad: 'SAN MARTIN', Provincia: 'Capital Federal' })).toBe('1');
    expect(mapRivadaviaSoapProvincia({ CP: '1406', Localidad: 'CAPITAL FEDERAL', Provincia: 'Buenos Aires' })).toBe('2');
    expect(mapRivadaviaSoapProvincia({ CP: '1183', Localidad: 'CAPITAL FEDERAL', Provincia: 'Capital Federal' })).toBe('2');
    expect(mapRivadaviaSoapProvincia({ CP: '1708', Localidad: 'MORON', Provincia: 'Buenos Aires' })).toBe('1');

    const built = await buildRivadaviaSoapPayload({
      fila: {
        infoautocod: '60450',
        anio: '2019',
        CP: '1406',
        provincia: 'Capital Federal',
        codigo_vehiculo: '1',
        suma: '30000000',
      },
      cabecera: {
        fec_nac: '19860804',
        gnc: '1',
        suma_gnc: '300000',
      },
      cfg: {
        producer_code: '7791',
        producer_password: 'TDJX1754',
        parametros_extras: {},
      },
      today: new Date('2026-08-04T12:00:00-03:00'),
      overrideTipoVehiculo: '1',
      overrideTipoUso: '1',
    });

    expect(built.payload.CodigoPostal).toBe('1406');
    expect(built.payload.CodigoProvincia).toBe('2');
    expect(built.payload.PoseeGNC).toBe('2');
    expect(built.payload.SumaAseguradaAccesorios).toBe('300000');
  });

  test('corrige provincia SOAP por CP/localidad cuando el archivo trae provincia inconsistente', async () => {
    const built = await buildRivadaviaSoapPayload({
      fila: {
        infoautocod: '170862',
        anio: '2025',
        CP: '1650',
        Localidad: 'SAN MARTIN',
        Provincia: 'Capital Federal',
        codigo_vehiculo: '1',
        suma: '30000000',
      },
      cabecera: {
        fec_nac: '19860804',
        gnc: '1',
        suma_gnc: '1000000',
      },
      cfg: {
        producer_code: '7791',
        producer_password: 'TDJX1754',
        parametros_extras: {},
      },
      today: new Date('2026-08-04T12:00:00-03:00'),
      overrideTipoVehiculo: '1',
      overrideTipoUso: '1',
    });

    expect(built.payload.CodigoPostal).toBe('1650');
    expect(built.payload.CodigoProvincia).toBe('1');
    expect(built.requestMeta.codigoProvinciaSoapSource).toBe('postal_localidad');
    expect(built.requestMeta.codigoProvinciaSoapConflict).toBe(true);
  });

  test('parsea respuesta SOAP de Rivadavia', () => {
    const parsed = parseRivadaviaSoapQuoteResponse(`
      <SOAP-ENV:Envelope>
        <SOAP-ENV:Body>
          <return>
            <Coberturas>
              <item>
                <NroPresupuesto xsi:type="xsd:long">77910000257962001</NroPresupuesto>
                <Plan xsi:type="xsd:string">A</Plan>
                <PremioTotal xsi:type="xsd:string">0000194305,43</PremioTotal>
                <Contado xsi:type="xsd:string">0000064768,49</Contado>
                <CuotaMensual xsi:type="xsd:string">0000064768,47</CuotaMensual>
              </item>
            </Coberturas>
          </return>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>
    `, {}, { coefRC: '0.9', coefCasco: '0.9' });

    expect(parsed.ok).toBe(true);
    expect(parsed.operacion).toBe('77910000257962001');
    expect(parsed.coberturas[0]).toMatchObject({
      codigoDeCobertura: 'A',
      importePremio: '194305.43',
      importeCuota: '64768.47',
    });
    expect(parsed.used).toMatchObject({ coefRC: '0.9', coefCasco: '0.9' });
  });
});

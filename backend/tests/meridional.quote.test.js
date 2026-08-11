const {
  buildMeridionalPayload,
  parseMeridionalQuoteResponse,
  resolveMeridionalLocalidad,
} = require('../services/meridional/quote');

describe('Meridional locality resolver', () => {
  test('prioriza la equivalencia comercial de CP 1014 sobre el catalogo', () => {
    expect(resolveMeridionalLocalidad(
      { CP: '1014', provincia: 'Capital Federal', localidad: 'CAPITAL FEDERAL' },
      {},
      {
        localityCatalog: [{ idLocalidad: '22835', descripcion: 'RETIRO', idProvincia: '1', provincia: 'CAPITAL FEDERAL', codPostales: ['1014'] }],
        localityAliases: [{ inputCodPostal: '1014', inputLocalidad: 'CAPITAL FEDERAL', inputProvincia: 'Capital Federal', codPostal: '1005', idLocalidad: '22814', descripcion: 'CAPITAL FEDERAL', idProvincia: '1', provincia: 'CAPITAL FEDERAL' }],
      }
    )).toMatchObject({ codPostal: '1005', idLocalidad: '22814', matchType: 'alias' });
  });

  test('separa importes de vigencia e importes mensuales', () => {
    const parsed = parseMeridionalQuoteResponse({ Items: [{ Coberturas: [{
      CodCobertura: '01', Descripcion: 'RC', CanCuotas: 4, Cuota: 51410.14,
      PrimaTotal: 154677.44, PremioTotal: 205640.57,
    }] }] });
    expect(parsed.coberturas[0]).toMatchObject({
      importePrima: '154677.44', importePremio: '205640.57', importeCuota: '51410.14',
      primaMensual: '38669.36', premioMensual: '51410.14',
    });
  });

  test('aplica fallback deterministico para CP ambiguo de CABA con localidad generica', () => {
    const localityCatalog = [
      {
        idLocalidad: '22849',
        descripcion: 'BARRACAS',
        idProvincia: '1',
        provincia: 'CAPITAL FEDERAL',
        codPostales: ['1107'],
      },
      {
        idLocalidad: '22845',
        descripcion: 'LA BOCA',
        idProvincia: '1',
        provincia: 'CAPITAL FEDERAL',
        codPostales: ['1107'],
      },
    ];

    expect(resolveMeridionalLocalidad(
      { CP: '1107', provincia: 'CABA', localidad: 'CAPITAL FEDERAL' },
      {},
      { localityCatalog }
    )).toMatchObject({
      idLocalidad: '22849',
      descripcion: 'BARRACAS',
      provincia: 'CAPITAL FEDERAL',
      codPostal: '1107',
      matchType: 'cp_ambiguo_caba_fallback',
    });
  });

  test('mantiene resolucion unica para Cordoba CP 5000', () => {
    const localityCatalog = [
      {
        idLocalidad: '5742',
        descripcion: 'CORDOBA',
        idProvincia: '5',
        provincia: 'CORDOBA',
        codPostales: ['5000'],
      },
    ];

    expect(resolveMeridionalLocalidad(
      { CP: '5000', provincia: 'Cordoba', localidad: 'CORDOBA' },
      {},
      { localityCatalog }
    )).toMatchObject({
      idLocalidad: '5742',
      descripcion: 'CORDOBA',
      codPostal: '5000',
      matchType: 'cp_unico',
    });
  });

  test('resuelve alias aprobado de Adrogue como Almirante Brown', () => {
    const localityCatalog = [
      {
        idLocalidad: '3253',
        descripcion: 'ALMIRANTE BROWN',
        idProvincia: '2',
        provincia: 'BUENOS AIRES',
        codPostales: ['1846'],
      },
      {
        idLocalidad: '8194',
        descripcion: 'JOSE MARMOL',
        idProvincia: '2',
        provincia: 'BUENOS AIRES',
        codPostales: ['1846'],
      },
    ];
    const localityAliases = [
      {
        inputCodPostal: '1846',
        inputLocalidad: 'ADROGUE',
        inputProvincia: 'Buenos Aires',
        codPostal: '1846',
        idLocalidad: '3253',
        descripcion: 'ALMIRANTE BROWN',
        idProvincia: '2',
        provincia: 'BUENOS AIRES',
      },
    ];

    expect(resolveMeridionalLocalidad(
      { CP: '1846', provincia: 'Buenos Aires', localidad: 'Adrogué' },
      {},
      { localityCatalog, localityAliases }
    )).toMatchObject({
      idLocalidad: '3253',
      descripcion: 'ALMIRANTE BROWN',
      idProvincia: '2',
      codPostal: '1846',
      matchType: 'alias',
    });
  });

  test('no usa el nombre interno de cabecera como nombre del asegurado', () => {
    const localityCatalog = [
      {
        idLocalidad: '22817',
        descripcion: 'CABALLITO',
        idProvincia: '1',
        provincia: 'CAPITAL FEDERAL',
        codPostales: ['1406'],
      },
    ];

    const { payload } = buildMeridionalPayload({
      fila: {
        infoautocod: '60450',
        anio: '2019',
        CP: '1406',
        provincia: 'Capital Federal',
        localidad: 'CAPITAL FEDERAL',
      },
      cabecera: {
        nombre: 'Prueba 1 Grilla',
        apellido: '',
        nombre_aseg: '',
        fec_nac: '19860804',
        gnc: '1',
        suma_gnc: '300000',
      },
      cfg: {
        producer_code: '08410',
        parametros_extras: {},
      },
      localityCatalog,
    });

    expect(payload.Asegurado.ApellidoRazonSocial).toBe('AUTOIQ');
    expect(payload.Asegurado.Nombre).toBe('ASEGURADO');
    expect(payload.Asegurado.ApellidoRazonSocial).not.toMatch(/\d/);
    expect(payload.Asegurado.Nombre).not.toMatch(/\d/);
    expect(payload.Vehiculos[0].Accesorios).toEqual([
      { IdAccesorio: 13, SumaAseguradaAccesorio: 300000 },
    ]);
    expect(payload.UNeg.IdUNeg).toBe(88);
  });
});

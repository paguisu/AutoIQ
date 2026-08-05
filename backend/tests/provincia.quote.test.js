const {
  buildProvinciaPayload,
  parseProvinciaQuoteResponse,
  resolveProvinciaBonifAdicional,
  resolveProvinciaModelAlias,
  resolveProvinciaRamoSelection,
} = require('../services/provincia/quote');

describe('Provincia quote adapter', () => {
  const cfg = {
    parametros_extras: {
      dni_default: '88955598',
      canal_default: 'PAS',
      email_default: 'cotizaciones@autoiq.local',
      celular_default: '1100000000',
      ramos: {
        '4': {
          producto_default: '04100',
          vigencia: 'E',
          vigencia_tecnica: 'A',
          medio_de_pago: '2',
          origen_de_pago: 'VISO',
          plan_de_pago: '1',
          tipo_default: '1',
          uso_default: '1',
          genero_default: 'M',
          clausula_ajuste: '10',
          bonif_adicional: '1',
          limite_rc: '1',
          limite_mercosur: '4',
          robo_contenido: 'S',
          cob_adic_comerciales: 'N',
          monto_accesorios: '0',
        },
        '16': {
          producto_default: '16005',
          vigencia: 'A',
          vigencia_tecnica: '',
          medio_de_pago: '3',
          origen_de_pago: 'PDIR',
          plan_de_pago: '161',
          promociones: ['AS01'],
          asegura_titular_conyugue: 'N',
        },
      },
    },
  };

  function buildCatalogClient({
    brands = [],
    years = [],
    modelRowsByKey = {},
  } = {}) {
    return {
      fetchProvinciaBrands: jest.fn().mockResolvedValue(brands),
      fetchProvinciaYears: jest.fn().mockResolvedValue(years),
      fetchProvinciaModels: jest.fn().mockImplementation(async (_cfg, { ramo, producto, marca, anio, es0km }) => {
        const key = [ramo, producto, marca, anio, es0km].join('|');
        return modelRowsByKey[key] || [];
      }),
    };
  }

  test('selecciona ramo y producto por config default', () => {
    expect(resolveProvinciaRamoSelection({ cfg })).toMatchObject({
      ramo: '4',
      producto: '04100',
    });
  });

  test('resuelve bonificacion adicional comercial para automotores', () => {
    expect(resolveProvinciaBonifAdicional({
      fila: { descuento_comercial: '22%' },
      cfg,
      ramoCfg: cfg.parametros_extras.ramos['4'],
    })).toBe('22');

    expect(resolveProvinciaBonifAdicional({
      cfg,
      ramoCfg: cfg.parametros_extras.ramos['4'],
    })).toBe('1');
  });

  test('arma payload de automotores usando InfoAuto y defaults', async () => {
    const catalogClient = buildCatalogClient({
      brands: [
        { codigo: 'TOY', descripcion: 'TOYOTA' },
      ],
      years: [{ codigo: '2018', descripcion: '2018' }],
      modelRowsByKey: {
        '4|04100|TOY|2018|N': [
          { codigo: '045307', descripcion: 'ETIOS 1.5 5 PTAS XLS 4AT L/18' },
        ],
      },
    });

    const { payload, requestMeta } = await buildProvinciaPayload({
      fila: {
        infoautocod: '045307',
        anio: '2018',
        CP: '1414',
        marca: 'Toyota',
        modelo: 'ETIOS 1.5 5 PTAS XLS 4AT L/18',
        valorVehiculo: '19470000',
        uso: 'Particular',
      },
      cabecera: {
        provincia: 'Capital Federal',
        medio_pago: 'Tarjeta de crédito',
        iva: 'CF',
        tipodoc: 'CUIT',
        nrodoc: '30111222333',
        sexo: 'M',
        gnc: '1',
        suma_gnc: '300000',
      },
      cfg,
      usoDicc: { particular: '1', comercial: '42' },
      catalogClient,
    });

    expect(requestMeta).toMatchObject({
      ramo: '4',
      producto: '04100',
      marca: 'TOY',
      marcaSource: 'catalog_description_exact',
      modelo: '045307',
      modeloSource: 'catalog_code_exact',
      anio: '2018',
      codigoPostal: '1414',
      medioDePago: '2',
      origenDePago: 'VISO',
      bonifAdicional: '1',
    });

    expect(payload).toMatchObject({
      ramoProducto: {
        ramo: '4',
        producto: '04100',
      },
      datosGenerales: {
        provincia: '1',
        tipoPersona: 'F',
        medioDePago: '2',
        origenDePago: 'VISO',
        condicionIva: 'CF',
      },
      bien: {
        '40020_marca': 'TOY',
        '40021_modelo': '045307',
        '900008_codPostal': '1414',
        '40220_ValorDelVehiculo': '19470000',
        '40088_bonifAdicional': '1',
        montoAccesorios: '300000',
      },
    });
  });

  test('resuelve el modelo contra el catalogo oficial de Provincia cuando el codigo difiere de InfoAuto', async () => {
    const catalogClient = buildCatalogClient({
      brands: [
        { codigo: 'AUD', descripcion: 'AUDI' },
      ],
      years: [{ codigo: '2023', descripcion: '2023' }],
      modelRowsByKey: {
        '4|04100|AUD|2023|N': [
          { codigo: '006533', descripcion: 'A1 35T  SPORTBACK STRONIC ' },
        ],
      },
    });

    const { payload, requestMeta } = await buildProvinciaPayload({
      fila: {
        infoautocod: '60533',
        anio: '2023',
        CP: '1414',
        marca: 'AUDI',
        modelo: 'A1 35T SPORTBACK STRONIC',
        valorVehiculo: '25000000',
        uso: 'Particular',
      },
      cabecera: {
        provincia: 'Capital Federal',
        medio_pago: 'Tarjeta de crédito',
        iva: 'CF',
        tipodoc: 'CUIT',
        nrodoc: '30111222333',
        sexo: 'M',
      },
      cfg,
      usoDicc: { particular: '1' },
      catalogClient,
    });

    expect(payload.bien['40020_marca']).toBe('AUD');
    expect(payload.bien['40021_modelo']).toBe('006533');
    expect(requestMeta).toMatchObject({
      marca: 'AUD',
      marcaSource: 'catalog_description_exact',
      modelo: '006533',
      modeloDescripcion: 'A1 35T  SPORTBACK STRONIC',
      modeloSource: 'catalog_description_exact',
    });
  });

  test('usa alias explicito de modelo Provincia para sugerencias verificadas', async () => {
    expect(resolveProvinciaModelAlias({
      infoautoCode: '460921',
      anio: '2024',
      marcaCode: 'VWV',
      es0km: 'N',
    })).toMatchObject({
      provinciaModelCode: '046921',
    });

    const { requestMeta } = await buildProvinciaPayload({
      fila: {
        infoautocod: '460921',
        anio: '2024',
        CP: '1414',
        marca: 'VOLKSWAGEN',
        modelo: 'AMAROK 30TD 4X4 DC AT 258HP BLACK',
        valorVehiculo: '56000000',
        uso: 'Particular',
      },
      cabecera: {
        provincia: 'Capital Federal',
        medio_pago: 'Tarjeta de crédito',
        iva: 'CF',
        tipodoc: 'CUIT',
        nrodoc: '30111222333',
        sexo: 'M',
      },
      cfg,
      usoDicc: { particular: '1' },
      catalogClient: buildCatalogClient({
        brands: [{ codigo: 'VWV', descripcion: 'VOLKSWAGEN' }],
        years: [{ codigo: '2024', descripcion: '2024' }],
        modelRowsByKey: {
          '4|04100|VWV|2024|N': [
            { codigo: '046983', descripcion: 'AMAROK V6 30TD 4X4 DC AT BLACK L/24' },
          ],
        },
      }),
    });

    expect(requestMeta).toMatchObject({
      modelo: '046921',
      modeloSource: 'alias',
      modeloDescripcion: 'AMAROK V6 30TD 4X4 DC AT 258HP BLACK',
      modeloMatchSource: 'provincia_suggestion_verified',
    });
  });

  test('no cae a fallback_infoauto si el catalogo timeout y no hay cache seguro', async () => {
    await expect(buildProvinciaPayload({
      fila: {
        infoautocod: '120506',
        anio: '2022',
        CP: '1722',
        marca: 'CHEVROLET',
        modelo: 'CRUZE 1.4 4 PTAS LTZ  AT',
        valorVehiculo: '25200000',
        uso: 'Particular',
      },
      cabecera: {
        provincia: 'Buenos Aires',
        medio_pago: 'Tarjeta de crédito',
        iva: 'CF',
        tipodoc: 'CUIT',
        nrodoc: '30111222333',
        sexo: 'M',
      },
      cfg,
      usoDicc: { particular: '1' },
      catalogClient: {
        fetchProvinciaBrands: jest.fn().mockResolvedValue([
          { codigo: 'CHE', descripcion: 'CHEVROLET' },
        ]),
        fetchProvinciaModels: jest.fn().mockRejectedValue(
          Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })
        ),
      },
    })).rejects.toThrow('timeout of 30000ms exceeded');
  });

  test('arma payload de accidentes personales con promociones', async () => {
    const { payload, requestMeta } = await buildProvinciaPayload({
      fila: {
        provincia_ramo_codigo: '16',
        fecha_nacimiento: '31/12/1991',
      },
      cabecera: {
        provincia: 'Capital Federal',
        medio_pago: 'CBU',
        iva: 'CF',
      },
      cfg,
    });

    expect(requestMeta).toMatchObject({
      ramo: '16',
      producto: '16005',
      medioDePago: '3',
      origenDePago: 'PDIR',
      fechaNacimiento: '31/12/1991',
      promociones: ['AS01'],
    });
    expect(payload).toMatchObject({
      ramoProducto: {
        ramo: '16',
        producto: '16005',
      },
      bien: {
        AseguraTitularConyugue: 'N',
        fechaNacimiento: '31/12/1991',
      },
      promociones: [{ promocion: 'AS01' }],
    });
  });

  test('parsea una respuesta exitosa de Provincia', () => {
    const out = parseProvinciaQuoteResponse({
      fechaCotizacion: '21/03/2025',
      numeroCotizacion: '95055516',
      bienesCotizados: [
        {
          bien: 'FORD S-MAX',
          sumaAsegurada: '14839000',
        },
      ],
      planes: [
        {
          plan: '22',
          descripcion: 'TERCEROS COMPLETOS FULL',
          descripcionAdicional: '',
          promocionesPorPlan: [
            {
              codigoPromocion: 'PSTOTAL',
              descripcion: 'Provincia total',
              premio: '146442',
              vigencia: 'MENSUAL REF.ANUAL',
              primaComisionable: '115896.1',
              comision: '',
            },
          ],
        },
      ],
    });

    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('95055516');
    expect(out.suma_asegurada).toBe('14839000');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      codigoDeCobertura: '22',
      descripcionDeCobertura: 'TERCEROS COMPLETOS FULL',
      codigoPromocion: 'PSTOTAL',
      importePrima: '115896.1',
      importePremio: '146442',
    });
  });

  test('parsea error funcional de Provincia', () => {
    const out = parseProvinciaQuoteResponse({
      code: 400,
      status: 'BAD_REQUEST',
      message: 'Formato incorrecto',
      description: 'El ramo es obligatorio',
    });

    expect(out.ok).toBe(false);
    expect(out.error).toContain('Formato incorrecto');
    expect(out.coberturas).toEqual([]);
  });
});

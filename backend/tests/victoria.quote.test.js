const {
  parseVictoriaQuoteResponse,
  resolveVictoriaTracking,
  resolveVictoriaUseId,
} = require('../services/victoria/quote');

describe('Victoria quote adapter', () => {
  test('resuelve uso desde diccionario y heuristicas', () => {
    expect(resolveVictoriaUseId({ fila: { uso: 'Particular' }, usoDicc: { particular: '1' } })).toBe(1);
    expect(resolveVictoriaUseId({ fila: { uso: 'Comercial' }, usoDicc: { comercial: '2' } })).toBe(2);
    expect(resolveVictoriaUseId({ fila: { uso: 'Taxi' }, usoDicc: {} })).toBe(2);
    expect(resolveVictoriaUseId({ fila: {}, usoDicc: {}, defaultId: 1 })).toBe(1);
  });

  test('mapea rastreo de cabecera a campos de Victoria', () => {
    expect(resolveVictoriaTracking({ cabecera: { rastreo: '1' } })).toMatchObject({
      poseeRastreo: true,
      sistemaRastreo: { id: 5, descripcion: 'LO JACK' },
      nuevoRastreo: false,
      rastreoSistema: 'sin_especificar',
      rastreoSistemaEfectivo: 'lojack',
      rastreoDefaultAplicado: true,
    });
    expect(resolveVictoriaTracking({
      cabecera: { rastreo: '1', rastreo_sistema: 'Ituran' },
      cfg: { parametros_extras: { sistema_rastreo_default_id: '2' } },
    })).toMatchObject({
      poseeRastreo: true,
      sistemaRastreo: { id: 2, descripcion: 'ITURAN' },
      rastreoSistema: 'ituran',
      rastreoSistemaEfectivo: 'ituran',
      rastreoDefaultAplicado: false,
    });
    expect(resolveVictoriaTracking({ cabecera: { rastreo: '0' } })).toMatchObject({
      poseeRastreo: false,
      sistemaRastreo: null,
      nuevoRastreo: false,
      rastreoSistema: 'sin_rastreo',
    });
  });

  test('parsea respuesta exitosa de Victoria', () => {
    const data = {
      vehiculo: {
        sumaAsegurada: 21210000,
        tipoVehiculo: { descripcion: 'AUTOMOVIL PARTICULAR' },
        marca: { descripcion: 'CHEVROLET' },
        modelo: { descripcion: 'CAMARO' },
        version: { id: 120503 },
        uso: { id: 1 },
        clausulaAjuste: { id: 1 },
        listaCoberturas: [
          {
            id: 1,
            numero: 1,
            nombre: 'Responsabilidad civil',
            calculos: {
              prima: 178260.27,
              premio: 227118.74,
              cuota: 227118.74,
              iva: 38744.87,
              iibb: 0,
              servicioSocial: 922.5,
              tasaSuper: 2951.99,
              franquicia: 0,
            },
          },
        ],
      },
    };

    const out = parseVictoriaQuoteResponse(data);
    expect(out.ok).toBe(true);
    expect(out.suma_asegurada).toBe('21210000');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      codigoDeCobertura: '1',
      descripcionDeCobertura: 'Responsabilidad civil',
      importePrima: '178260.27',
      importePremio: '227118.74',
      importeCuota: '227118.74',
      premiumMonthly: '227118.74',
      premium: '227118.74',
    });
  });

  test('expone cuota como premio mensual cuando Victoria devuelve premio de vigencia', () => {
    const out = parseVictoriaQuoteResponse({
      vehiculo: {
        sumaAsegurada: 1234567,
        listaCoberturas: [
          {
            numero: 1,
            nombre: 'Responsabilidad civil',
            calculos: {
              premio: 242460.12,
              cuota: 48906.18,
            },
          },
        ],
      },
    });

    expect(out.ok).toBe(true);
    expect(out.coberturas[0]).toMatchObject({
      importePremio: '242460.12',
      importeCuota: '48906.18',
      premiumMonthly: '48906.18',
      premium: '242460.12',
    });
  });

  test('parsea error funcional de Victoria', () => {
    const out = parseVictoriaQuoteResponse({
      status: 'BAD_REQUEST',
      message: 'Error al validar parametros de entrada',
      debugMessage: 'vehiculo.modelo.id',
    });

    expect(out.ok).toBe(false);
    expect(out.error).toContain('Error al validar parametros');
    expect(out.coberturas).toEqual([]);
  });
});

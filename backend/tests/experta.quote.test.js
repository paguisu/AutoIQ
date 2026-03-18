const {
  buildExpertaPayload,
  parseExpertaQuoteResponse,
  resolveExpertaPaymentKey,
} = require('../services/experta/quote');

describe('Experta quote adapter', () => {
  test('resuelve clave de precio segun medio de pago', () => {
    expect(resolveExpertaPaymentKey({ medio_pago: 'Tarjeta de crédito' })).toBe('debito');
    expect(resolveExpertaPaymentKey({ medio_pago: 'CBU' })).toBe('debito');
    expect(resolveExpertaPaymentKey({ medio_pago: 'Efectivo' })).toBe('efectivo');
  });

  test('arma payload de Experta con credenciales y defaults', async () => {
    const { payload, requestMeta } = await buildExpertaPayload({
      fila: { infoautocod: '460652', anio: '2011', CP: '1426' },
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        uso: 'Particular',
        iva: 'CF',
        cerokm: '0',
        rastreo: '0',
      },
      cfg: {
        producer_code: '3507',
        clausula_ajuste: '5',
        parametros_extras: {
          modalidad_default: 'EX0',
          iva_default: '5',
          gnc_default: 'N',
          marca_default: 'unespecified',
          modelo_default: 'unespecified',
          version_default: 'unespecified',
          con_recuperador_default: 'N',
        },
      },
      usoDicc: { particular: '1', comercial: '10' },
      today: new Date('2026-03-17T12:00:00Z'),
    });

    expect(requestMeta).toMatchObject({
      productor: '3507',
      modalidad: 'EX0',
      iva: '5',
      codigoPostal: '1426000',
      anio: '2011',
      codInfoAuto: '460652',
      gnc: 'N',
      uso: '1',
      porcentajeAjuste: '5',
    });
    expect(payload).toMatchObject({
      productor: '3507',
      modalidad: 'EX0',
      codigoPostal: '1426000',
      marca: 'unespecified',
      modelo: 'unespecified',
      version: 'unespecified',
    });
  });

  test('parsea respuesta exitosa de Experta', () => {
    const data = {
      nroPresupuesto: '98444955',
      valor: 9469500,
      modalidad: 'EX0',
      codigoPostal: '1426000',
      hashcia: '87b36cb6-d119-4063-84bb-d0e8f411739c',
      porcentajeAjuste: '5',
      planes: [
        {
          codigo: '642',
          debito: '125874.0',
          efectivo: '139859.0',
          descripcion: 'Terceros Completo XL + Granizo FULL(EXTRA LARGE)',
          planMostrar: 'T. Completo XL + Granizo FULL(EXTRA LARGE)',
          pack: 'FULL',
          prima: '100699.2',
          inspeccionable: 'S',
          franquicia: '0.0',
          franquiciarobo: '0.0',
          conRecuperador: 'N',
          duracion: 3,
          porcentaje_promocion: 20,
          coberturas: { ResponsabilidadCivil: 'SI' },
        },
      ],
    };

    const out = parseExpertaQuoteResponse(data, { selectedPriceKey: 'debito' });
    expect(out.ok).toBe(true);
    expect(out.operacion).toBe('98444955');
    expect(out.suma_asegurada).toBe('9469500');
    expect(out.coberturas).toHaveLength(1);
    expect(out.coberturas[0]).toMatchObject({
      codigoDeCobertura: '642',
      importePrima: '100699.2',
      importePremio: '125874.0',
      requiereInspeccion: 'true',
    });
  });
});

const procesoRouter = require('../routes/proceso');

const {
  EXCEL_CANONICAL_HEADERS,
  applyCommercialConditionsToQuoteInputs,
  buildCanonicalExcelRow,
  enrichExcelRowCanonicalFields,
} = procesoRouter.__test;

describe('proceso Excel visible de negocio', () => {
  test('conecta la grilla de Mercantil Andina con los nombres que consume su adapter', () => {
    const out = applyCommercialConditionsToQuoteInputs({
      slug: 'mercantil_andina',
      fila: {},
      cabecera: {},
      mapeos: {},
      Aseg: { parametros_extras: {} },
      resolved: {
        values: {
          refacturacion: { visible_value: 'Mensual', ws_code: '1', numeric_value: 1 },
          cuotas: { visible_value: '1', ws_code: '1', numeric_value: 1 },
          descuento_comercial: { visible_value: '15%', ws_code: '15', numeric_value: 15 },
          comision: { visible_value: '10%', ws_code: '10', numeric_value: 10 },
          clausula_ajuste: { visible_value: 'Sin ajuste', ws_code: '0', numeric_value: 0 },
        },
      },
    });

    expect(out.Aseg.bonificacion).toBe('15');
    expect(out.Aseg.comision).toBe('10');
    expect(out.Aseg.clausula_ajuste).toBe('0');
    expect(out.Aseg.parametros_extras.periodo_default).toBe('1');
    expect(out.Aseg.parametros_extras.cuotas_default).toBe('1');
  });

  test('mantiene un unico uso y solo importes mensuales', () => {
    expect(EXCEL_CANONICAL_HEADERS).toContain('Uso');
    expect(EXCEL_CANONICAL_HEADERS).toContain('Medio Pago Response');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Parametro Tipo Uso');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Vehiculo Uso');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Prima');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Prima Vigencia');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Premio');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Premio Vigencia');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('IVA');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('IVA Vigencia');
    expect(EXCEL_CANONICAL_HEADERS).not.toContain('Impuestos Vigencia');
  });

  test('normaliza condiciones comerciales, GNC y bonificacion devuelta', () => {
    const row = buildCanonicalExcelRow({
      proceso_id: 999999,
      aseguradora: 'mapfre',
      index: 0,
      ok: true,
      cab_tipo_uso: '1',
      veh_uso: 'Particular',
      cab_gnc: '1',
      cab_suma_gnc: '1000000',
      cot_sumaGNC: '1000000',
      cot_montoBonif: '1250.50',
      cot_sumaAsegurada: '20000000',
      cot_montoPrimaTotal: '100000',
      cot_montoPremio: '121000',
      cot_montoIVA: '21000',
    }, {
      commercial_conditions: {
        uso: { visible_value: 'Particular', applies: true },
        gnc: { visible_value: 'Con GNC', ws_code: '1', applies: true },
        clausula_ajuste: { visible_value: '30%', numeric_value: 30, applies: true },
        descuento_comercial: { visible_value: '-15%', numeric_value: 15, applies: true },
        descuento_seguro_nuevo: { visible_value: '25%', numeric_value: 25, applies: true },
        coeficiente_rc: { visible_value: '0.9', numeric_value: 0.9, applies: true },
        comision: { visible_value: 'EX0 (20/25%)', applies: true },
      },
    });

    expect(row.Uso).toBe('Particular');
    expect(row.GNC).toBe('Si');
    expect(row['Suma GNC Solicitada']).toBe(1000000);
    expect(row['Suma GNC Reconocida']).toBe(1000000);
    expect(row['Clausula de Ajuste Solicitada']).toBe('30%');
    expect(row['Clausula de Ajuste Efectiva']).toBe('30%');
    expect(row['Descuento Comercial Solicitado %']).toBe(15);
    expect(row['Descuento Seguro Nuevo %']).toBe(25);
    expect(row['Bonificacion Monetaria Devuelta']).toBe(1250.5);
    expect(row['Coeficiente RC']).toBe(0.9);
    expect(row['Comision Solicitada %']).toBe('');
  });

  test('usa los importes mensuales explicitos sin confundirlos con la vigencia', () => {
    const row = buildCanonicalExcelRow({
      proceso_id: 210, aseguradora: 'meridional', index: 0, ok: true,
      cot_primaMensual: '38669.36', cot_premioMensual: '51410.14',
      cot_importePrima: '154677.44', cot_importePremio: '205640.57', cot_importeCuota: '51410.14',
    });
    expect(row['Prima Mensual']).toBe(38669.36);
    expect(row['Premio Mensual']).toBe(51410.14);
    expect(row['Importe Cuota']).toBe(51410.14);
  });

  test('mensualiza ATM usando la cuota y divide la prima por cantidad de cuotas', () => {
    const enriched = enrichExcelRowCanonicalFields({
      aseguradora: 'atm',
      cot_prima: 190495,
      cot_premio: 281399.21,
      cot_cuotas: 3,
      cot_impcuotas: 93819.21,
    });
    const row = buildCanonicalExcelRow(enriched);
    expect(row['Importe Cuota']).toBe(93819.21);
    expect(row['Prima Mensual']).toBe(63498.33);
    expect(row['Premio Mensual']).toBe(93819.21);
  });

  test('no interpreta la duracion promocional de Experta como facturacion', () => {
    const enriched = enrichExcelRowCanonicalFields({
      aseguradora: 'experta',
      cot_importePrima: '239132.8',
      cot_importePremio: '298916',
      cot_duracion: '3',
    });
    const row = buildCanonicalExcelRow(enriched);
    expect(row['Periodo Facturacion']).toBe('Mensual');
    expect(row.Duracion).toBe(1);
    expect(row.Cuotas).toBe(1);
    expect(row['Importe Cuota']).toBe(298916);
    expect(row['Prima Mensual']).toBe(239132.8);
    expect(row['Premio Mensual']).toBe(298916);
  });

  test('completa prima mensual desde importePrima cuando la vigencia es mensual', () => {
    const enriched = enrichExcelRowCanonicalFields({
      aseguradora: 'allianz',
      cot_importePrima: '61498.62',
      cot_importePremio: '75704.8',
    });
    const row = buildCanonicalExcelRow(enriched);
    expect(row['Prima Mensual']).toBe(61498.62);
    expect(row['Premio Mensual']).toBe(75704.8);
  });
});

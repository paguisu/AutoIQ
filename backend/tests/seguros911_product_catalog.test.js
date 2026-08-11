const {
  buildDetectedRecord,
  buildDisplayDetails,
  buildDisplaySummary,
  decorateResumenWithCatalog,
  getSeguros911ProductCatalog,
  SUMMARY_FIELDS,
} = require('../utils/seguros911_product_catalog');

describe('Seguros911 product catalog', () => {
  it('detects structured coverage data and builds the expected summary/detail output', () => {
    const detected = buildDetectedRecord(1, '2026-04-30T00:00:00.000Z', 'experta', {
      codigoDeProducto: 'EXP-TR',
      codigo: 'COB-TR',
      descripcionDeProducto: 'Todo riesgo premium',
      descripcionDeCobertura: 'Todo riesgo con granizo',
      coberturas: JSON.stringify({
        ResponsabilidadCivil: 'S',
        RoboHurtoTotal: 'S',
        RoboHurtoParcial: 'S',
        IncendioTotal: 'S',
        IncendioParcial: 'S',
        AccidenteTotal: 'S',
        DanoParcialAccidente: 'S',
        Granizo: 'S',
        CristalesLaterales: 'S',
        LunetaParabrisa: 'S',
        ServiRemolque: 'S',
        Reposicion0Km: '12 meses',
        AjusteAutomaticoSuma: 'S',
        AutoSustituto: 'S',
      }),
      franquicia: '$ 120.000',
      sumaGranizo: '$ 900.000',
      conRecuperador: 'S',
    });

    expect(detected).toBeTruthy();
    expect(detected.detected_display_group_code).toBe('DF');
    expect(detected.detected_values.summary_flags.dxaccid_parcial_c_franquicia).toBe(true);
    expect(detected.detected_values.indicators.granizo).toBe(true);
    expect(detected.detected_values.indicators.cristales_laterales).toBe(true);
    expect(detected.detected_values.indicators.luneta_parabrisas).toBe(true);
    expect(detected.detected_values.indicators.asistencia_mecanica).toBe(true);
    expect(detected.detected_values.details.franquicia).toBe('$ 120.000');
    expect(detected.detected_values.details.granizo_suma).toBe('$ 900.000');
    expect(detected.detected_values.details.reposicion_0km).toBe('12 meses');

    const displayRecord = {
      summary_flags: detected.detected_values.summary_flags,
      indicators: detected.detected_values.indicators,
      details: detected.detected_values.details,
    };

    expect(buildDisplaySummary(displayRecord)).toBe(
      'RC | Robo T. | Robo P. | Incend T. | Incend P. | DxAccid T. | DxAccid P c/fcia'
    );

    expect(buildDisplayDetails(displayRecord)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'franquicia', label: 'Franquicia', value: '$ 120.000' }),
      expect.objectContaining({ key: 'granizo_suma', label: 'Granizo hasta', value: '$ 900.000' }),
      expect.objectContaining({ key: 'reposicion_0km', label: 'Reposicion 0km', value: '12 meses' }),
      expect.objectContaining({ key: 'rastreador', label: 'Con rastreador' }),
      expect.objectContaining({ key: 'auto_sustituto', label: 'Auto sustituto' }),
    ]));
  });

  it('hides the display summary until every summary flag is defined', () => {
    const partial = {
      summary_flags: Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, false])),
    };
    partial.summary_flags.rc = true;
    partial.summary_flags.robo_total = null;
    expect(buildDisplaySummary(partial)).toBe('');
  });

  it('infers responsabilidad civil variants as RC-only and turns the rest off', () => {
    const detected = buildDetectedRecord(1, '2026-05-04T00:00:00.000Z', 'atm', {
      codigoDeProducto: 'A1',
      codigo: 'A1',
      descripcionDeProducto: 'Responsabilidad Civl Sin Asistencia',
      descripcionDeCobertura: 'Responsabilidad Civl Sin Asistencia',
    });

    expect(detected.detected_display_group_code).toBe('A');
    expect(detected.detected_values.summary_flags).toMatchObject({
      rc: true,
      robo_total: false,
      robo_parcial: false,
      incendio_total: false,
      incendio_parcial: false,
      dxaccid_total: false,
      dxaccid_parcial_c_franquicia: false,
    });
  });

  it('infers total-without-partial products as totals-only and non-todo-riesgo', () => {
    const detected = buildDetectedRecord(1, '2026-05-04T00:00:00.000Z', 'atm', {
      codigoDeProducto: 'B1',
      codigo: 'B1',
      descripcionDeProducto: 'Robo e Incendio Total',
      descripcionDeCobertura: 'Robo e Incendio Total',
    });

    expect(detected.detected_display_group_code).toBe('B');
    expect(detected.detected_values.summary_flags).toMatchObject({
      rc: true,
      robo_total: true,
      robo_parcial: false,
      incendio_total: true,
      incendio_parcial: false,
      dxaccid_total: true,
      dxaccid_parcial_c_franquicia: false,
    });
  });

  it('decorates a Seguros911 resumen with the catalog visual metadata', () => {
    const catalog = getSeguros911ProductCatalog();
    const seed = catalog.items.find((item) => item.aseguradora && item.producto_codigo && item.cobertura_codigo && item.display_group_code);
    expect(seed).toBeTruthy();

    const resumen = {
      resultados: {
        [seed.aseguradora]: [
          {
            ok: true,
            coberturas: [
              {
                codigoDeProducto: seed.producto_codigo,
                codigo: seed.cobertura_codigo,
                descripcionDeProducto: seed.producto_descripcion,
                descripcionDeCobertura: seed.cobertura_descripcion,
              },
            ],
          },
        ],
      },
    };

    const decorated = decorateResumenWithCatalog(resumen);
    const visual = decorated.resultados[seed.aseguradora][0].coberturas[0].seguros911_visual;

    expect(visual).toBeTruthy();
    expect(visual.display_group.code).toBe(seed.display_group_code);
    expect(decorated.seguros911_catalog_summary.total).toBe(1);
  });

  it('reuses the legacy canonical catalog seed for Allianz D4 variable franchise products', () => {
    const detected = buildDetectedRecord(1, '2026-05-04T00:00:00.000Z', 'allianz', {
      codigoDeProducto: '87',
      codigo: '91',
      descripcionDeProducto: 'ALTA GAMA VIP',
      descripcionDeCobertura: 'D4 - RC. T.R. CON FCIA SOBRE VALOR ASEGURADO 2%',
    });

    expect(detected.detected_display_group_code).toBe('DV');
  });
});

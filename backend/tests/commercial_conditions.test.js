const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const {
  buildEffectivePayload,
  buildMatrix,
  loadStore,
  saveStore,
  saveValues,
  setInheritance,
  validateQuoteOverride,
  addQuoteOverride,
  resolveCommercialConditions,
} = require('../services/commercial_conditions');

function tmpDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-commercial-'));
}

describe('commercial conditions service', () => {
  test('initial store exposes Default Seguros911 values in the matrix', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    const matrix = buildMatrix(store, {});
    const discountRow = matrix.rows.find((row) => row.concept_code === 'descuento_comercial');
    const originRow = matrix.rows.find((row) => row.concept_code === 'origen_pago');
    const financialInstitutionRow = matrix.rows.find((row) => row.concept_code === 'institucion_financiera');
    const policyValidityRow = matrix.rows.find((row) => row.concept_code === 'vigencia_poliza');
    const rebillingRow = matrix.rows.find((row) => row.concept_code === 'refacturacion');
    const installmentsRow = matrix.rows.find((row) => row.concept_code === 'cuotas');
    const trackingRow = matrix.rows.find((row) => row.concept_code === 'rastreador_alarma');
    const satelliteProviderRow = matrix.rows.find((row) => row.concept_code === 'prestador_satelital');
    const useRow = matrix.rows.find((row) => row.concept_code === 'uso');
    const vehicleTypeRow = matrix.rows.find((row) => row.concept_code === 'tipo_vehiculo');
    const gncRow = matrix.rows.find((row) => row.concept_code === 'gnc');
    const adjustmentClauseRow = matrix.rows.find((row) => row.concept_code === 'clausula_ajuste');
    const variation32080Row = matrix.rows.find((row) => row.concept_code === 'variacion_32080');
    const coefficientRcRow = matrix.rows.find((row) => row.concept_code === 'coeficiente_rc');
    const coefficientCascoRow = matrix.rows.find((row) => row.concept_code === 'coeficiente_casco');
    const commissionRow = matrix.rows.find((row) => row.concept_code === 'comision');
    const garageRow = matrix.rows.find((row) => row.concept_code === 'garage_guardado');
    const assistanceRow = matrix.rows.find((row) => row.concept_code === 'asistencia');
    const commercialPlanRow = matrix.rows.find((row) => row.concept_code === 'plan_comercial');

    expect(matrix.profile.code).toBe('DEFAULT_SEGUROS911');
    expect(matrix.companies.some((company) => company.slug === 'mercantil_andina')).toBe(true);
    expect(discountRow.cells.mercantil_andina.value.visible_value).toBe('20%');
    expect(discountRow.cells.mercantil_andina.options.map((option) => option.visible_label)).toEqual([
      '0%',
      '5%',
      '10%',
      '15%',
      '20%',
    ]);
    expect(commissionRow.cells.mercantil_andina.options.map((option) => option.visible_label)).toEqual([
      '10%',
      '15%',
      '20%',
    ]);
    expect(adjustmentClauseRow.cells.mercantil_andina.options.map((option) => option.visible_label)).toEqual([
      'Sin ajuste',
    ]);
    expect(discountRow.cells.atm.value.visible_value).toBe('30%');
    expect(discountRow.cells.atm.options.map((option) => option.visible_label)).toEqual([
      '0%',
      '5%',
      '10%',
      '15%',
      '20%',
      '25%',
      '30%',
    ]);
    expect(discountRow.cells.allianz.value.visible_value).toBe('-15%');
    expect(discountRow.cells.allianz.options.map((option) => option.visible_label)).toEqual([
      '-15%',
      '-10%',
      '-5%',
      '0%',
      '5%',
      '10%',
      '15%',
    ]);
    expect(discountRow.cells.provincia.value.visible_value).toBe('1%');
    expect(discountRow.cells.provincia.options.map((option) => option.visible_label)).toEqual([
      '1%',
      '5%',
      '10%',
      '15%',
      '20%',
      '22%',
      '25%',
    ]);
    expect(discountRow.cells.provincia.mapping.ws_field).toBe('bien.40088_bonifAdicional');
    expect(discountRow.cells.smg.options.map((option) => option.visible_label)).toEqual([
      '-15%',
      '-10%',
      '-5%',
      '0%',
      '5%',
      '10%',
    ]);
    expect(discountRow.cells.victoria.value.visible_value).toBe('-10%');
    expect(discountRow.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      '-10%',
      '-5%',
      '0%',
      '5%',
      '10%',
    ]);
    expect(matrix.companies.some((company) => company.slug === 'meridional')).toBe(true);
    expect(matrix.companies.map((company) => company.label)).toEqual([
      'Allianz',
      'ATM',
      'Experta',
      'Mapfre',
      'Mercantil Andina',
      'Meridional',
      'Provincia',
      'Rivadavia',
      'Sancor',
      'SMG',
      'Victoria',
    ]);
    expect(originRow.cells.atm.applicable).toBe(false);
    expect(originRow.cells.provincia.applicable).toBe(true);
    expect(originRow.cells.provincia.value.visible_value).toBe('Visa otros bancos');
    expect(originRow.cells.provincia.options.map((option) => option.visible_label)).toEqual([
      'Visa otros bancos',
      'Débito directo Provincia',
      'Caja / efectivo',
    ]);
    expect(originRow.cells.victoria.applicable).toBe(false);
    for (const company of matrix.companies) {
      expect(financialInstitutionRow.cells[company.slug].applicable).toBe(false);
    }
    expect(trackingRow.cells.atm.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Con Rastreador/Alarma',
    ]);
    expect(trackingRow.cells.allianz.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Con Rastreador/Alarma',
    ]);
    expect(trackingRow.cells.experta.applicable).toBe(false);
    expect(trackingRow.cells.sancor.applicable).toBe(false);
    expect(trackingRow.cells.provincia.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Con Rastreador/Alarma',
    ]);
    expect(trackingRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Con Rastreador/Alarma',
    ]);
    expect(trackingRow.cells.smg.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Lo Jack',
      'Tracer',
      'Pointer',
      'Ituran',
      'Ubicar',
      'Lo Jack a cargo compañía',
      'Tracer a cargo compañía',
      'Micrograbado',
    ]);
    expect(trackingRow.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Tracer',
      'Ituran',
      'Datatrak',
      'Ubicar',
      'Lo Jack',
    ]);
    expect(trackingRow.cells.victoria.mapping.ws_field).toBe('vehicle.satellite_tracking/vehicle.sistem_tracking');
    expect(trackingRow.cells.meridional.options.map((option) => option.visible_label)).toEqual([
      'Sin Rastreador/Alarma',
      'Ubicar - A cargo del Cliente',
      'Ubicar - A cargo de la Compañía',
      'Pointer - A cargo del Cliente',
      'Pointer - A cargo de la Compañía',
      'Lo-Jack - A cargo del Cliente',
      'Lo-Jack - A cargo de la Compañía',
      'Ituran - A cargo del Cliente',
      'Ituran - A cargo de la Compañía',
    ]);
    for (const company of matrix.companies) {
      expect(satelliteProviderRow.cells[company.slug].applicable).toBe(false);
    }
    expect(policyValidityRow.cells.atm.options.map((option) => option.visible_label)).toEqual(['Anual']);
    expect(policyValidityRow.cells.provincia.options.map((option) => option.visible_label)).toEqual(['Anual']);
    expect(policyValidityRow.cells.allianz.options.map((option) => option.visible_label)).toEqual([
      'Mensual',
      'Semestral',
      'Anual',
      'Período',
    ]);
    expect(policyValidityRow.cells.sancor.options.map((option) => option.visible_label)).toEqual([
      'Anual',
      'Semestral',
      'Trimestral',
    ]);
    expect(policyValidityRow.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      'Mensual',
      'Cuatrimestral',
      'Trimestral',
    ]);
    expect(policyValidityRow.cells.rivadavia.applicable).toBe(false);
    expect(policyValidityRow.cells.meridional.applicable).toBe(false);
    expect(rebillingRow.cells.atm.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.atm.options.map((option) => option.visible_label)).toEqual(['12']);
    expect(rebillingRow.cells.allianz.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.allianz.options.map((option) => option.visible_label)).toEqual(['1']);
    expect(rebillingRow.cells.experta.applicable).toBe(false);
    expect(installmentsRow.cells.experta.applicable).toBe(false);
    expect(rebillingRow.cells.mapfre.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.mapfre.applicable).toBe(false);
    expect(rebillingRow.cells.provincia.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.provincia.options.map((option) => option.visible_label)).toEqual(['1 cuota']);
    expect(rebillingRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual(['Trimestral']);
    expect(installmentsRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual(['3']);
    expect(rebillingRow.cells.sancor.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.sancor.options.map((option) => option.visible_label)).toEqual(['Sin cuotas (mensual)']);
    expect(installmentsRow.cells.sancor.value.ws_code).toBe('0');
    expect(rebillingRow.cells.victoria.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.victoria.options.map((option) => option.visible_label)).toEqual(['Contado']);
    expect(rebillingRow.cells.meridional.options.map((option) => option.visible_label)).toEqual(['Mensual']);
    expect(installmentsRow.cells.meridional.options.map((option) => option.visible_label)).toEqual(['1']);
    expect(useRow.cells.allianz.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Comercial',
      'Local',
      'Rutero',
    ]);
    expect(useRow.cells.provincia.value.visible_value).toBe('Particular');
    expect(useRow.cells.provincia.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Particular exclusivamente',
      'Uso oficial',
      'Trabajo rural',
      'Trabajo no rural',
      'Comercial',
      'Uso comercial',
      'Comercial transporte de carga general',
      'Comercial transporte de carga peligrosa',
      'Alquiler sin chofer',
      'Auxilio mecánico',
      'Servicio especial pasajeros',
    ]);
    expect(useRow.cells.sancor.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Particular y/o comercial',
    ]);
    expect(useRow.cells.smg.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Comercial',
    ]);
    expect(useRow.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Comercial',
      'Transporte de bienes',
      'Trabajos rurales',
    ]);
    expect(useRow.cells.meridional.options.map((option) => option.visible_label)).toEqual([
      'Particular',
      'Comercial',
      'Carga peligrosa',
      'Carga peligrosa PK',
      'Comercial carga general',
      'Comercial carga peligrosa',
    ]);
    expect(vehicleTypeRow.cells.rivadavia.value.visible_value).toBe('Auto');
    expect(vehicleTypeRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual([
      'Auto',
      'Pick Up Clase A',
      'Pick Up Clase B',
    ]);
    expect(vehicleTypeRow.cells.smg.value.visible_value).toBe('Auto');
    expect(vehicleTypeRow.cells.smg.options.map((option) => option.visible_label)).toEqual([
      'Auto',
      'Moto',
    ]);
    expect(vehicleTypeRow.cells.sancor.applicable).toBe(false);
    expect(vehicleTypeRow.cells.provincia.applicable).toBe(false);
    expect(garageRow.cells.mapfre.value.visible_value).toBe('No');
    expect(garageRow.cells.mapfre.options.map((option) => option.visible_label)).toEqual(['Sí', 'No']);
    expect(garageRow.cells.mapfre.mapping.ws_field).toBe('guardaGGe');
    expect(garageRow.cells.sancor.value.visible_value).toBe('Sí');
    expect(garageRow.cells.sancor.options.map((option) => option.visible_label)).toEqual(['Sí', 'No']);
    expect(garageRow.cells.sancor.mapping.ws_field).toBe('ScoringOptions[typeId=3].SelectedOptionId');
    for (const company of ['allianz', 'atm', 'experta', 'meridional', 'provincia', 'rivadavia', 'smg', 'victoria']) {
      expect(garageRow.cells[company].applicable).toBe(false);
    }
    expect(assistanceRow.cells.smg.value.visible_value).toBe('Sí');
    expect(assistanceRow.cells.smg.options.map((option) => option.visible_label)).toEqual(['Sí', 'No']);
    expect(assistanceRow.cells.smg.mapping.ws_field).toBe('AsistMecanica');
    for (const company of ['allianz', 'atm', 'experta', 'mapfre', 'meridional', 'provincia', 'rivadavia', 'sancor', 'victoria']) {
      expect(assistanceRow.cells[company].applicable).toBe(false);
    }
    expect(commercialPlanRow.cells.smg.value.visible_value).toBe('Plan Normal');
    expect(commercialPlanRow.cells.smg.value.ws_code).toBe('1');
    expect(commercialPlanRow.cells.smg.mapping.ws_field).toBe('cod_tipo_poliza');
    expect(gncRow.ui_type).toBe('selector_plus_amount');
    for (const company of matrix.companies.map((item) => item.slug)) {
      expect(gncRow.cells[company].value.visible_value).toBe('Sin GNC');
      expect(gncRow.cells[company].value.numeric_value).toBe(0);
      expect(gncRow.cells[company].options.map((option) => option.visible_label)).toEqual([
        'Sin GNC',
        'Con GNC',
      ]);
    }
    expect(gncRow.cells.allianz.mapping.ws_field).toContain('ListaAccesorios');
    expect(gncRow.cells.provincia.mapping.ws_field).toBe('bien.montoAccesorios');
    expect(gncRow.cells.meridional.mapping.ws_field).toContain('Vehiculos.Accesorios');
    expect(adjustmentClauseRow.cells.allianz.value.visible_value).toBe('Sin ajuste');
    expect(adjustmentClauseRow.cells.atm.value.visible_value).toBe('20%');
    expect(adjustmentClauseRow.cells.experta.value.visible_value).toBe('5%');
    expect(adjustmentClauseRow.cells.mapfre.value.visible_value).toBe('Sin ajuste');
    expect(adjustmentClauseRow.cells.meridional.value.visible_value).toBe('Sin ajuste');
    expect(adjustmentClauseRow.cells.provincia.value.visible_value).toBe('Sin ajuste');
    expect(adjustmentClauseRow.cells.rivadavia.value.visible_value).toBe('30%');
    expect(adjustmentClauseRow.cells.smg.value.visible_value).toBe('Sin cláusula');
    expect(adjustmentClauseRow.cells.sancor.value.visible_value).toBe('Ninguna');
    expect(adjustmentClauseRow.cells.victoria.value.visible_value).toBe('10%');
    expect(adjustmentClauseRow.cells.smg.options.map((option) => option.visible_label)).toEqual([
      'Sin cláusula',
      '10%',
      '20%',
    ]);
    expect(adjustmentClauseRow.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      '0%',
      '10%',
      '20%',
      '30%',
    ]);
    expect(adjustmentClauseRow.cells.experta.options.map((option) => option.visible_label)).toEqual([
      '5%',
      '10%',
      '20%',
    ]);
    expect(adjustmentClauseRow.cells.meridional.options.map((option) => option.visible_label)).toEqual([
      'Sin ajuste',
      '20%',
      '30%',
      '40%',
      '50%',
    ]);
    expect(adjustmentClauseRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual([
      '10%',
      '20%',
      '30%',
      '40%',
      '50%',
    ]);
    expect(adjustmentClauseRow.cells.meridional.mapping.ws_field).toBe('IdClausulaAjuste');
    expect(variation32080Row.cells.victoria.value.visible_value).toBe('-10%');
    expect(variation32080Row.cells.victoria.options.map((option) => option.visible_label)).toEqual([
      '-15%',
      '-10%',
      '-5%',
      '0%',
      '5%',
      '10%',
    ]);
    expect(variation32080Row.cells.victoria.mapping.ws_code).toContain('16=0%');
    expect(coefficientRcRow.cells.rivadavia.value.visible_value).toBe('0.90');
    expect(coefficientCascoRow.cells.rivadavia.value.visible_value).toBe('0.90');
    expect(coefficientRcRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual(['1', '0.9', '0.8']);
    expect(coefficientCascoRow.cells.rivadavia.options.map((option) => option.visible_label)).toEqual(['1', '0.9', '0.8']);
    expect(coefficientRcRow.cells.rivadavia.mapping.ws_field).toBe('CoefRC');
    expect(coefficientCascoRow.cells.rivadavia.mapping.ws_field).toBe('CoefCasco');
    expect(commissionRow.cells.experta.value.visible_value).toBe('EX0 (20/25%)');
    expect(commissionRow.cells.experta.options.map((option) => option.visible_label)).toEqual(['EX0 (20/25%)']);
    expect(commissionRow.cells.experta.mapping.ws_field).toBe('modalidad');
    expect(commissionRow.cells.provincia.value.visible_value).toBe('15%');
    expect(commissionRow.cells.provincia.value.ws_code).toBe('15');
    expect(commissionRow.cells.provincia.options.map((option) => option.visible_label)).toEqual(['15%', '20%']);
    expect(commissionRow.cells.provincia.mapping.ws_field).toBe('datosAdicionales.porcentajeComision');
    expect(commissionRow.cells.meridional.value.visible_value).toBe('18%');
    expect(commissionRow.cells.meridional.mapping.ws_field).toBe('PorcComision');
    for (const company of ['allianz', 'atm', 'mapfre', 'rivadavia', 'sancor', 'smg', 'victoria']) {
      expect(commissionRow.cells[company].applicable).toBe(false);
    }
  });

  test('inheritance is per user and company, and inherited values are not directly editable', () => {
    const dataRoot = tmpDataRoot();
    let store = loadStore({ dataRoot });
    store.users.push({
      id: 'seller-1',
      source_system: 'seguros911',
      external_user_id: 'seller-1',
      display_name: 'Seller 1',
      role: 'vendedor',
      active: true,
    });

    expect(() => saveValues(store, {
      owner_type: 'user',
      owner_id: 'seller-1',
      changes: [{ company_slug: 'atm', concept_code: 'descuento_comercial', visible_value: '25%', numeric_value: 25 }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot })).toThrow(/hereda defaults/);

    store = setInheritance(store, {
      user_id: 'seller-1',
      company_slug: 'atm',
      inherits_default: false,
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot });
    store = saveValues(store, {
      owner_type: 'user',
      owner_id: 'seller-1',
      changes: [{ company_slug: 'atm', concept_code: 'descuento_comercial', visible_value: '25%', ws_code: '25', numeric_value: 25 }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot });

    const matrix = buildMatrix(store, { user_id: 'seller-1' });
    const discountRow = matrix.rows.find((row) => row.concept_code === 'descuento_comercial');

    expect(discountRow.cells.atm.inherited).toBe(false);
    expect(discountRow.cells.atm.value.visible_value).toBe('25%');
    expect(discountRow.cells.victoria.inherited).toBe(true);
    expect(discountRow.cells.victoria.value.visible_value).toBe('-10%');
  });

  test('quote overrides validate role and range, then win only for that quote', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    expect(validateQuoteOverride(store, {
      company_slug: 'victoria',
      concept_code: 'descuento_comercial',
      visible_value: '11%',
      numeric_value: 11,
      role: 'vendedor',
    }).allowed).toBe(false);

    const override = addQuoteOverride(store, {
      quote_id: 'q-1',
      user_id: 'seller-1',
      company_slug: 'victoria',
      concept_code: 'descuento_comercial',
      visible_value: '5%',
      ws_code: '5',
      numeric_value: 5,
      role: 'vendedor',
    }, { user_id: 'seller-1', role: 'vendedor' }, { dataRoot });

    expect(override.quote_id).toBe('q-1');
    expect(buildEffectivePayload(store, {
      quote_id: 'q-1',
      company_slug: 'victoria',
    }).values.descuento_comercial.visible_value).toBe('5%');
    expect(buildEffectivePayload(store, {
      quote_id: 'q-2',
      company_slug: 'victoria',
    }).values.descuento_comercial.visible_value).toBe('-10%');
  });

  test('activating inheritance over custom values requires confirmation and removes own values', () => {
    const dataRoot = tmpDataRoot();
    let store = loadStore({ dataRoot });
    store = setInheritance(store, {
      user_id: 'seller-1',
      company_slug: 'atm',
      inherits_default: false,
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot });
    store = saveValues(store, {
      owner_type: 'user',
      owner_id: 'seller-1',
      changes: [{ company_slug: 'atm', concept_code: 'descuento_comercial', visible_value: '20%', numeric_value: 20 }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot });

    expect(() => setInheritance(store, {
      user_id: 'seller-1',
      company_slug: 'atm',
      inherits_default: true,
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot })).toThrow(/Confirm/);

    store = setInheritance(store, {
      user_id: 'seller-1',
      company_slug: 'atm',
      inherits_default: true,
      confirm_overwrite: true,
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot });

    const matrix = buildMatrix(store, { user_id: 'seller-1' });
    const discountRow = matrix.rows.find((row) => row.concept_code === 'descuento_comercial');
    expect(discountRow.cells.atm.inherited).toBe(true);
    expect(discountRow.cells.atm.own_value).toBe(null);
    expect(discountRow.cells.atm.value.visible_value).toBe('30%');
  });

  test('store persists to dataRoot', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });
    store.users.push({ id: 'u-1', source_system: 'seguros911', external_user_id: 'u-1', display_name: 'U 1', role: 'vendedor', active: true });
    saveStore(store, { dataRoot });

    expect(loadStore({ dataRoot }).users.some((user) => user.id === 'u-1')).toBe(true);
  });

  test('rejects editing a non-applicable cell and free text for catalog-backed cells', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    expect(() => saveValues(store, {
      owner_type: 'profile',
      owner_id: 'default_seguros911',
      changes: [{ company_slug: 'atm', concept_code: 'origen_pago', visible_value: 'Visa' }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot })).toThrow(/no aplica/);

    expect(() => saveValues(store, {
      owner_type: 'profile',
      owner_id: 'default_seguros911',
      changes: [{ company_slug: 'atm', concept_code: 'rastreador_alarma', visible_value: 'con' }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot })).toThrow(/Valor no permitido/);

    expect(() => saveValues(store, {
      owner_type: 'profile',
      owner_id: 'default_seguros911',
      changes: [{ company_slug: 'provincia', concept_code: 'descuento_comercial', visible_value: '23%' }],
    }, { user_id: 'superadmin-local', role: 'superadmin' }, { dataRoot })).toThrow(/Valor no permitido/);
  });

  test('resolver applies AutoIQ cabecera over default commercial values', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    const resolved = resolveCommercialConditions(store, {
      context: 'autoiq',
      company_slug: 'provincia',
      cabecera: {
        medio_pago: 'Tarjeta de crédito',
        rastreo: 'si',
        gnc: 'si',
        uso: 'Comercial',
      },
    });

    expect(resolved.values.medio_pago.visible_value).toBe('Tarjeta de crédito');
    expect(resolved.values.rastreador_alarma.visible_value).toBe('Con Rastreador/Alarma');
    expect(resolved.values.gnc.visible_value).toBe('Con GNC');
    expect(resolved.values.uso.visible_value).toBe('Comercial');
    expect(resolved.values.uso.source).toBe('cabecera');
  });

  test('resolver maps internal cabecera codes to company commercial options', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    const allianz = resolveCommercialConditions(store, {
      context: 'autoiq',
      company_slug: 'allianz',
      cabecera: { medio_pago: 'TC', tipo_uso: '1' },
    });
    const sancor = resolveCommercialConditions(store, {
      context: 'autoiq',
      company_slug: 'sancor',
      cabecera: { tipo_uso: '1' },
    });

    expect(allianz.values.medio_pago.visible_value).toBe('Tarjeta de crédito');
    expect(allianz.values.medio_pago.ws_code).toBe('T');
    expect(allianz.values.uso.visible_value).toBe('Particular');
    expect(allianz.values.uso.ws_code).toBe('1');
    expect(sancor.values.uso.visible_value).toBe('Particular');
    expect(sancor.values.uso.ws_code).toBe('2');
    expect(allianz.diagnostics).toEqual([]);
    expect(sancor.diagnostics).toEqual([]);
  });

  test('resolver keeps Seguros911 defaults unless a quote override exists', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    const defaultResolved = resolveCommercialConditions(store, {
      context: 'seguros911',
      company_slug: 'victoria',
      quote_id: 'q-no-override',
      cabecera: { gnc: 'si', uso: 'Comercial' },
    });
    expect(defaultResolved.values.uso.visible_value).toBe('Particular');

    addQuoteOverride(store, {
      quote_id: 'q-override',
      user_id: 'seller-1',
      company_slug: 'victoria',
      concept_code: 'descuento_comercial',
      visible_value: '5%',
      role: 'vendedor',
    }, { user_id: 'seller-1', role: 'vendedor' }, { dataRoot });

    const overrideResolved = resolveCommercialConditions(store, {
      context: 'seguros911',
      company_slug: 'victoria',
      quote_id: 'q-override',
    });
    const otherQuoteResolved = resolveCommercialConditions(store, {
      context: 'seguros911',
      company_slug: 'victoria',
      quote_id: 'q-other',
    });

    expect(overrideResolved.values.descuento_comercial.visible_value).toBe('5%');
    expect(otherQuoteResolved.values.descuento_comercial.visible_value).toBe('-10%');
  });

  test('resolver reports unmatched cabecera values without applying a ws code', () => {
    const dataRoot = tmpDataRoot();
    const store = loadStore({ dataRoot });

    const resolved = resolveCommercialConditions(store, {
      context: 'autoiq',
      company_slug: 'provincia',
      cabecera: { uso: 'Uso inexistente' },
    });

    expect(resolved.values.uso.visible_value).toBe('Uso inexistente');
    expect(resolved.values.uso.ws_code).toBe(null);
    expect(resolved.values.uso.unmatched_option).toBe(true);
    expect(resolved.diagnostics.some((item) => item.concept_code === 'uso')).toBe(true);
  });
});

describe('commercial conditions API', () => {
  test('GET /commercial-conditions/matrix exposes active companies and rows', async () => {
    const res = await request(app).get('/commercial-conditions/matrix');

    expect(res.statusCode).toBe(200);
    expect(res.body.companies.some((company) => company.slug === 'victoria')).toBe(true);
    expect(res.body.companies.some((company) => company.slug === 'meridional')).toBe(true);
    expect(res.body.companies.some((company) => company.slug === 'mercantil_andina')).toBe(true);
    expect(res.body.rows.some((row) => row.concept_code === 'descuento_comercial')).toBe(true);
  });

  test('POST /commercial-conditions/quote-overrides/validate rejects out of range seller discount', async () => {
    const res = await request(app)
      .post('/commercial-conditions/quote-overrides/validate')
      .send({
        company_slug: 'victoria',
        concept_code: 'descuento_comercial',
        visible_value: '99%',
        numeric_value: 99,
        role: 'vendedor',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.allowed).toBe(false);
  });

  test('POST /commercial-conditions/export returns an xlsx payload for superadmin session', async () => {
    const res = await request(app)
      .post('/commercial-conditions/export')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .send({});

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(1000);
  });
});

const fs = require('fs');
const path = require('path');
const { isVehicleZeroKm } = require('../../utils/zero_km');
const { resolveCompanyTracking } = require('../../utils/rastreo');

let localitiesCache = null;

function pick(values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function parsePositiveInt(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  const out = Number.parseInt(digits, 10);
  return Number.isFinite(out) && out >= 0 ? out : null;
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const out = Number.parseFloat(normalized);
  return Number.isFinite(out) ? out : null;
}

function loadLocalities() {
  if (localitiesCache) return localitiesCache;
  const filePath = path.join(process.cwd(), 'data', 'mercantil_andina', 'diccionarios', 'localidades.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    localitiesCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    localitiesCache = [];
  }
  return localitiesCache;
}

function pickInfoautoCode(fila = {}) {
  return pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
}

function pickPostalCode(fila = {}, cabecera = {}) {
  return onlyDigits(pick([
    fila?.codigo_postal,
    fila?.codpostal,
    fila?.CP,
    fila?.cp,
    fila?.CodigoPostal,
    cabecera?.cp,
    cabecera?.CP,
    cabecera?.codigo_postal,
  ])).slice(0, 4);
}

function pickVehicleYear({ fila = {}, cfg = {} } = {}) {
  if (isVehicleZeroKm(fila)) {
    return parsePositiveInt(cfg?.parametros_extras?.anio_0km) || 9999;
  }
  return parsePositiveInt(pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano, fila?.veh_anio]));
}

function resolveUse({ fila = {}, cabecera = {}, cfg = {}, usoDicc = {} } = {}) {
  const explicit = pick([
    fila?.mercantil_andina_uso,
    fila?.mercantil_uso,
    cabecera?.mercantil_andina_uso,
    cabecera?.mercantil_uso,
  ]);
  const explicitNum = parsePositiveInt(explicit);
  if (explicitNum != null) return explicitNum;

  const raw = normalizeText(pick([
    fila?.uso,
    fila?.Uso,
    fila?.tipo_uso,
    cabecera?.uso,
    cabecera?.uso_default,
  ]));
  const mapped = parsePositiveInt(usoDicc[String(raw || '').toLowerCase()]);
  if (mapped != null) return mapped;
  if (raw.includes('PARTIC')) return 1;
  return parsePositiveInt(cfg?.parametros_extras?.uso_default) || 1;
}

function resolveBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const raw = normalizeText(value);
  if (['1', 'S', 'SI', 'TRUE', 'CON'].includes(raw)) return true;
  if (['0', 'N', 'NO', 'FALSE', 'SIN'].includes(raw)) return false;
  return fallback;
}

function resolveTracking({ cabecera = {}, cfg = {} } = {}) {
  const tracking = resolveCompanyTracking(cabecera, 'mercantil_andina', cfg);
  if (tracking.hasTracking) {
    const direct = parsePositiveInt(pick([
      cabecera?.mercantil_andina_rastreo,
      cabecera?.mercantil_rastreo,
      tracking.mappedValue,
    ]));
    return {
      rastreo: direct != null ? direct : 1,
      rastreoSistema: tracking.system,
      rastreoSistemaEfectivo: tracking.effectiveSystem,
      rastreoDefaultAplicado: tracking.defaultApplied,
    };
  }
  return {
    rastreo: parsePositiveInt(cfg?.parametros_extras?.rastreo_default) || 0,
    rastreoSistema: tracking.system,
    rastreoSistemaEfectivo: tracking.effectiveSystem,
    rastreoDefaultAplicado: tracking.defaultApplied,
  };
}

function resolveLocality({ fila = {}, cabecera = {} } = {}) {
  const explicitId = parsePositiveInt(pick([
    fila?.mercantil_andina_localidad_id,
    fila?.mercantil_localidad_id,
    fila?.localidad_id_mercantil,
    cabecera?.mercantil_andina_localidad_id,
    cabecera?.mercantil_localidad_id,
  ]));
  const cp = pickPostalCode(fila, cabecera);
  if (explicitId != null) {
    return {
      id: explicitId,
      codigo_postal: parsePositiveInt(cp),
      source: 'explicit',
    };
  }

  const localities = loadLocalities();
  const rawLocality = normalizeText(pick([
    fila?.localidad,
    fila?.Localidad,
    fila?.ciudad,
    cabecera?.localidad,
    cabecera?.ciudad,
  ]));
  const rawProvince = normalizeText(pick([
    fila?.provincia,
    fila?.Provincia,
    fila?.veh_provincia,
    cabecera?.provincia,
    cabecera?.Provincia,
  ]));

  const sameCp = localities.filter((item) => onlyDigits(item?.codigo_postal || item?.codigoPostal).slice(0, 4) === cp);
  let match = null;
  if (rawLocality) {
    match = sameCp.find((item) => normalizeText(item?.nombre).includes(rawLocality) || rawLocality.includes(normalizeText(item?.nombre))) || null;
  }
  if (!match && rawProvince) {
    match = sameCp.find((item) => normalizeText(item?.provincia) === rawProvince) || null;
  }
  if (!match && sameCp.length === 1) match = sameCp[0];

  if (!match) {
    const codigoPostal = parsePositiveInt(cp);
    if (codigoPostal == null) throw new Error('Mercantil Andina requiere codigo postal');
    return {
      id: null,
      codigo_postal: codigoPostal,
      nombre: rawLocality,
      provincia: rawProvince,
      source: 'codigo_postal',
    };
  }

  return {
    id: parsePositiveInt(match.id),
    codigo_postal: parsePositiveInt(match.codigo_postal || match.codigoPostal || cp),
    nombre: match.nombre || '',
    provincia: match.provincia || '',
    source: rawLocality ? 'diccionario_cp_localidad' : 'diccionario_cp',
  };
}

function resolvePaymentType({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const explicit = pick([
    fila?.mercantil_andina_tipo_pago,
    fila?.mercantil_tipo_pago,
    cabecera?.mercantil_andina_tipo_pago,
    cabecera?.mercantil_tipo_pago,
  ]);
  if (explicit) return explicit;

  const raw = normalizeText(pick([
    cabecera?.medio_pago,
    cabecera?.medioPago,
    cabecera?.forma_pago,
    fila?.medio_pago,
    fila?.medioPago,
  ]));
  if (raw.includes('DEBIT') || raw.includes('CBU')) return 'D';
  if (raw.includes('CONVENIO') || raw.includes('TARJ')) return 'C';
  return pick([cfg?.parametros_extras?.forma_pago_default, 'D']);
}

function resolveCommercialNumber({ names = [], fila = {}, cabecera = {}, cfg = {}, fallback = '20' } = {}) {
  for (const name of names) {
    const value = pick([fila?.[name], cabecera?.[name], cfg?.[name], cfg?.parametros_extras?.[`${name}_default`]]);
    const parsed = parseNumber(value);
    if (parsed != null) return parsed;
  }
  const parsedFallback = parseNumber(fallback);
  return parsedFallback != null ? parsedFallback : 0;
}

function buildMercantilAndinaPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  usoDicc = {},
} = {}) {
  const infoauto = parsePositiveInt(pickInfoautoCode(fila));
  if (infoauto == null) throw new Error('Mercantil Andina requiere codigo InfoAuto');

  const anio = pickVehicleYear({ fila, cfg });
  if (anio == null) throw new Error('Mercantil Andina requiere anio');

  const localidad = resolveLocality({ fila, cabecera });
  const uso = resolveUse({ fila, cabecera, cfg, usoDicc });
  const tracking = resolveTracking({ cabecera, cfg });
  const gnc = resolveBoolean(
    pick([fila?.gnc, fila?.GNC, cabecera?.gnc, cabecera?.GNC]),
    Boolean(cfg?.parametros_extras?.gnc_default)
  );
  const comision = resolveCommercialNumber({
    names: ['mercantil_andina_comision', 'mercantil_comision', 'comision'],
    fila,
    cabecera,
    cfg,
    fallback: cfg?.comision || '20',
  });
  const bonificacion = resolveCommercialNumber({
    names: ['mercantil_andina_bonificacion', 'mercantil_bonificacion', 'bonificacion', 'descuento_comercial'],
    fila,
    cabecera,
    cfg,
    fallback: cfg?.bonificacion || cfg?.descuento_comercial || '20',
  });
  const periodo = parsePositiveInt(pick([
    fila?.mercantil_andina_periodo,
    cabecera?.mercantil_andina_periodo,
    cfg?.parametros_extras?.periodo_default,
    '1',
  ])) || 1;
  const cuotas = parsePositiveInt(pick([
    fila?.mercantil_andina_cuotas,
    cabecera?.mercantil_andina_cuotas,
    cfg?.parametros_extras?.cuotas_default,
    '1',
  ])) || 1;
  const canal = parsePositiveInt(pick([
    fila?.mercantil_andina_canal,
    cabecera?.mercantil_andina_canal,
    cfg?.parametros_extras?.canal_default,
    '78',
  ])) || 78;
  const ajusteSuma = parsePositiveInt(pick([
    fila?.mercantil_andina_ajuste_suma,
    cabecera?.mercantil_andina_ajuste_suma,
    cfg?.clausula_ajuste,
    cfg?.parametros_extras?.ajuste_suma_default,
    '0',
  ])) || 0;
  const iva = parsePositiveInt(pick([
    fila?.mercantil_andina_iva,
    cabecera?.mercantil_andina_iva,
    cfg?.parametros_extras?.iva_default,
    '5',
  ])) || 5;
  const productorId = parsePositiveInt(pick([
    fila?.mercantil_andina_productor_id,
    cabecera?.mercantil_andina_productor_id,
    cfg?.producer_code,
  ]));
  if (productorId == null) throw new Error('Mercantil Andina requiere producer_code');

  const payload = {
    canal,
    localidad: {
      codigo_postal: localidad.codigo_postal,
    },
    vehiculo: {
      infoauto,
      anio,
      uso,
      gnc,
      rastreo: tracking.rastreo,
    },
    comision,
    bonificacion,
    periodo,
    cuotas,
    pago: {
      tipo_pago: resolvePaymentType({ fila, cabecera, cfg }),
    },
    ajuste_suma: ajusteSuma,
    iva,
    desglose: cfg?.parametros_extras?.desglose_default !== false,
    productor: {
      id: productorId,
    },
  };
  if (localidad.id != null) payload.localidad.id = localidad.id;

  return {
    payload,
    requestMeta: {
      localidadId: localidad.id,
      localidadCp: localidad.codigo_postal,
      localidadNombre: localidad.nombre || '',
      localidadProvincia: localidad.provincia || '',
      localidadSource: localidad.source,
      infoauto,
      anio,
      uso,
      gnc,
      rastreo: tracking.rastreo,
      rastreoSistema: tracking.rastreoSistema,
      rastreoSistemaEfectivo: tracking.rastreoSistemaEfectivo,
      rastreoDefaultAplicado: tracking.rastreoDefaultAplicado,
      comision,
      bonificacion,
      periodo,
      cuotas,
      canal,
      tipoPago: payload.pago.tipo_pago,
      ajusteSuma,
      iva,
      productorId,
    },
  };
}

function extractErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const errores = asArray(payload?.errores)
    .map((item) => pick([item?.mensaje_error, item?.mensaje, item?.message, item?.codigo_error, item?.codigo]))
    .filter(Boolean);
  if (errores.length) return errores.join(' | ');
  return pick([
    payload?.error,
    payload?.mensaje,
    payload?.message,
    payload?.advertencia?.descripcion,
    payload?.advertencia?.codigo,
    payload?.detalle,
  ]);
}

function mapCoverage(item = {}, response = {}) {
  const total = item?.desglose?.total || {};
  const firstInstallment = asArray(item?.desglose?.cuotas)[0] || {};
  return {
    codigoDeCobertura: pick([item?.producto, item?.titulo, item?.numero]),
    descripcionDeCobertura: pick([item?.texto, item?.descripcion, item?.titulo]),
    codigoDeProducto: pick([item?.codigo_producto, item?.producto, item?.numero]),
    descripcionDeProducto: pick([item?.descripcion, item?.texto, item?.titulo]),
    plan: pick([item?.titulo, item?.producto]),
    importePrima: pick([total?.prima, firstInstallment?.prima]),
    importePremio: pick([total?.premio, item?.costo, firstInstallment?.premio]),
    importeCuota: pick([firstInstallment?.premio, item?.costo, total?.premio]),
    importeIVA: pick([total?.iva, firstInstallment?.iva]),
    importeTotalImpuestos: pick([
      total?.otros_impuestos,
      firstInstallment?.otros_impuestos,
      total?.sellados,
      firstInstallment?.sellados,
    ]),
    importeRecargoFinanciero: pick([total?.recargo_financiero, firstInstallment?.recargo_financiero]),
    sumaAsegurada: pick([response?.suma_asegurada, response?.vehiculo?.valor]),
    franquicia: pick([item?.franquicia]),
    franquiciaRobo: '',
    requiereInspeccion: asArray(item?.inspeccion?.opciones).some((option) => option?.id != null) ? 'true' : 'false',
    conRecuperador: response?.vehiculo?.rastreo ? 'S' : 'N',
    valorComisionPAS: '',
    porcentajeComisionPAS: pick([response?.comision]),
    bonificacion: pick([response?.bonificacion]),
    cantidadCuotas: pick([item?.cantidad_cuotas, response?.cuotas]),
    formapago: response?.pago?.tipo_pago || '',
    formapago_descripcion: response?.pago?.tipo_pago === 'D' ? 'Debito automatico' : '',
    desglose: item?.desglose || null,
  };
}

function parseMercantilAndinaQuoteResponse(data) {
  const payload = typeof data === 'string'
    ? (() => {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      })()
    : data;

  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      error: 'Respuesta Mercantil Andina invalida',
      operacion: '0',
      coberturas: [],
      raw: data,
    };
  }

  const resultItems = asArray(payload?.resultado);
  const coberturas = resultItems
    .filter((item) => !String(item?.error || '').trim())
    .map((item) => mapCoverage(item, payload));
  const itemErrors = resultItems
    .map((item) => String(item?.error || '').trim())
    .filter(Boolean);
  const errorMessage = extractErrorMessage(payload) || itemErrors.join(' | ');

  return {
    ok: coberturas.length > 0,
    operacion: pick([payload?.id]) || '0',
    fechaCotizacion: pick([payload?.fecha_cotizacion]),
    suma_asegurada: pick([payload?.suma_asegurada, payload?.vehiculo?.valor]),
    coberturas,
    error: coberturas.length > 0 ? '' : (errorMessage || 'Mercantil Andina respondio sin coberturas'),
    raw: data,
    used: {
      localidadId: pick([payload?.localidad?.id]),
      localidadCp: pick([payload?.localidad?.codigo_postal]),
      infoauto: pick([payload?.vehiculo?.infoauto]),
      anio: pick([payload?.vehiculo?.anio]),
      uso: pick([payload?.vehiculo?.uso]),
      rastreo: pick([payload?.vehiculo?.rastreo]),
      gnc: pick([payload?.vehiculo?.gnc]),
      comision: pick([payload?.comision]),
      bonificacion: pick([payload?.bonificacion]),
      periodo: pick([payload?.periodo]),
      cuotas: pick([payload?.cuotas]),
      tipoPago: pick([payload?.pago?.tipo_pago]),
      ajusteSuma: pick([payload?.ajuste_suma]),
      iva: pick([payload?.iva]),
      productorId: pick([payload?.productor?.id]),
    },
  };
}

module.exports = {
  buildMercantilAndinaPayload,
  parseMercantilAndinaQuoteResponse,
  resolveLocality,
  resolvePaymentType,
  resolveUse,
};

const { rivadaviaGet } = require('./client');
const {
  getRivadaviaTipoVehiculoInferido,
  upsertRivadaviaTipoVehiculoInferido,
} = require('../../utils/inferencias');
const { resolveCompanyTracking } = require('../../utils/rastreo');

const RIVADAVIA_TIPO_VEHICULO_LABELS = {
  '1': 'Auto',
  '4': 'Jeeps hasta 4 Cilindros',
  '6': 'Pick Up Clase "A"',
  '7': 'Jeeps de mas de 4 Cilindros',
  '8': 'Pick Up Clase "B"',
  '18': 'Motocicleta',
};

function pick(values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function addYears(dateLike, years) {
  const dt = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
  if (Number.isNaN(dt.getTime())) return new Date();
  dt.setFullYear(dt.getFullYear() + years);
  return dt;
}

function formatIsoDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function getCodigoInfoAuto(fila = {}) {
  return (
    pick([
      fila?.infoautocod,
      fila?.tau_codia,
      fila?.codigo_infoauto,
      fila?.cod_infoauto,
      fila?.codigoInfoauto,
      fila?.CodigoInfoauto,
      fila?.InfoAutoCod,
      fila?.infoauto,
    ]).replace(/^0+/, '') || '0'
  );
}

function uniqueValues(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function getVehicleFamily(rawTipoVehiculo) {
  const raw = normalizeText(rawTipoVehiculo);
  if (!raw) return 'auto';
  if (raw.includes('MOTO') || raw.includes('SCOOTER')) return 'moto';
  if (raw.includes('PICK') || raw.includes('UTILIT') || raw.includes('FURG')) return 'pickup';
  if (raw.includes('JEEP')) return 'jeep';
  return 'auto';
}

function getTipoVehiculoCandidateCodes({ fila = {}, mapeos = {}, cfg = {}, learned = null }) {
  const direct = pick([mapeos?.tipo_vehiculo_codigo, fila?.tipo_vehiculo_codigo, fila?.tipoVehiculoCodigo]);
  const family = getVehicleFamily(pick([fila?.tipo_vehiculo, fila?.TipoVehiculo, fila?.tipoVehiculo]));
  const defaultsByFamily = {
    moto: ['18'],
    jeep: ['4', '7', '1'],
    pickup: ['6', '8', '1'],
    auto: ['1', '6', '8'],
  };
  return uniqueValues([
    learned?.tipoVehiculo,
    direct,
    ...defaultsByFamily[family],
    String(cfg?.parametros_extras?.tipo_vehiculo_default || '1'),
  ]);
}

async function buildRivadaviaAttemptPlan({ fila = {}, cabecera = {}, mapeos = {}, cfg = {} } = {}) {
  const codigoInfoAuto = getCodigoInfoAuto(fila);
  const learned = await getRivadaviaTipoVehiculoInferido(codigoInfoAuto);
  const tipoVehiculoCodes = getTipoVehiculoCandidateCodes({ fila, mapeos, cfg, learned });
  const tipoUso = resolveTipoUsoCode({ fila, cabecera, mapeos, cfg });

  return {
    codigoInfoAuto,
    learned,
    attempts: tipoVehiculoCodes.map((tipoVehiculo, index) => ({
      tipoVehiculo,
      tipoUso,
      source:
        learned && learned.tipoVehiculo === tipoVehiculo
          ? 'learned'
          : index === 0
            ? 'initial'
            : 'fallback',
      descripcionTipoVehiculo: RIVADAVIA_TIPO_VEHICULO_LABELS[tipoVehiculo] || '',
    })),
  };
}

function mapRivadaviaIva(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: 'CONSUMIDOR_FINAL',
    'CONSUMIDOR FINAL': 'CONSUMIDOR_FINAL',
    RI: 'RESPONSABLE_INSCRIPTO',
    'RESPONSABLE INSCRIPTO': 'RESPONSABLE_INSCRIPTO',
    EX: 'EXENTO',
    EXENTO: 'EXENTO',
    MT: 'MONOTRIBUTO',
    MONOTRIBUTO: 'MONOTRIBUTO',
  };
  return map[raw] || String(cfg?.parametros_extras?.condicion_iva_default || 'CONSUMIDOR_FINAL');
}

function mapRivadaviaFormaPago(cabecera = {}, cfg = {}) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
    cabecera?.medioPago ??
    cabecera?.forma_pago ??
    cabecera?.formaPago ??
    ''
  );
  const map = {
    COBRADOR: 'COBRADOR',
    EFECTIVO: 'COBRADOR',
  };
  return map[raw] || String(cfg?.parametros_extras?.forma_pago_default || 'COBRADOR');
}

function resolveRivadaviaAlarmaSatelital(cabecera = {}, cfg = {}) {
  const tracking = resolveCompanyTracking(cabecera, 'rivadavia', cfg);
  const noAlarm = String(
    cfg?.parametros_extras?.alarma_satelital_sin_default ||
    cfg?.parametros_extras?.alarma_satelital_default ||
    'SIN_ALARMA'
  );
  const withAlarm = pick([
    cabecera?.alarma_satelital_rivadavia,
    cabecera?.alarmaSatelitalRivadavia,
    cfg?.parametros_extras?.alarma_satelital_con_default,
  ]);

  if (tracking.hasTracking) return withAlarm || noAlarm;
  return noAlarm;
}

function mapRivadaviaProvincia(row = {}, cabecera = {}, cfg = {}) {
  const raw = normalizeText(pick([
    row?.provincia,
    row?.Provincia,
    row?.desc_provincia,
    row?.nom_prov,
    cabecera?.provincia,
  ]));
  const map = {
    'BUENOS AIRES': 'BUENOS_AIRES',
    CABA: 'CAPITAL_FEDERAL',
    'CAPITAL FEDERAL': 'CAPITAL_FEDERAL',
    CATAMARCA: 'CATAMARCA',
    CHACO: 'CHACO',
    CHUBUT: 'CHUBUT',
    CORDOBA: 'CORDOBA',
    CORRIENTES: 'CORRIENTES',
    'ENTRE RIOS': 'ENTRE_RIOS',
    FORMOSA: 'FORMOSA',
    JUJUY: 'JUJUY',
    'LA PAMPA': 'LA_PAMPA',
    'LA RIOJA': 'LA_RIOJA',
    MENDOZA: 'MENDOZA',
    MISIONES: 'MISIONES',
    NEUQUEN: 'NEUQUEN',
    'RIO NEGRO': 'RIO_NEGRO',
    SALTA: 'SALTA',
    'SAN JUAN': 'SAN_JUAN',
    'SAN LUIS': 'SAN_LUIS',
    'SANTA CRUZ': 'SANTA_CRUZ',
    'SANTA FE': 'SANTA_FE',
    'SANTIAGO DEL ESTERO': 'SANTIAGO_DEL_ESTERO',
    'TIERRA DEL FUEGO': 'TIERRA_DEL_FUEGO',
    TUCUMAN: 'TUCUMAN',
  };
  return map[raw] || String(cfg?.parametros_extras?.provincia_default || 'BUENOS_AIRES');
}

function resolveTipoVehiculoCode({ fila = {}, mapeos = {}, cfg = {}, overrideTipoVehiculo = '' }) {
  if (overrideTipoVehiculo) return String(overrideTipoVehiculo).trim();

  const direct = pick([mapeos?.tipo_vehiculo_codigo, fila?.tipo_vehiculo_codigo, fila?.tipoVehiculoCodigo]);
  if (direct) return String(direct);

  const raw = normalizeText(pick([fila?.tipo_vehiculo, fila?.TipoVehiculo, fila?.tipoVehiculo]));
  if (raw.includes('MOTO')) return '18';
  if (raw.includes('PICK') || raw.includes('UTILIT') || raw.includes('FURG')) return '6';
  if (raw.includes('JEEP')) return '4';
  return String(cfg?.parametros_extras?.tipo_vehiculo_default || '1');
}

function resolveTipoUsoCode({ fila = {}, cabecera = {}, mapeos = {}, cfg = {}, overrideTipoUso = '' }) {
  if (overrideTipoUso) return String(overrideTipoUso).trim();

  const direct = pick([mapeos?.uso_codigo, fila?.uso_codigo, fila?.usoCodigo]);
  if (direct) return String(direct);

  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (raw.includes('TAX')) return '2';
  if (raw.includes('REMI')) return '3';
  if (raw.includes('REPART') || raw.includes('MENSAJ')) return '15';
  if (raw.includes('COMER') || raw.includes('BIEN')) return '6';
  return String(cfg?.parametros_extras?.tipo_uso_default || '1');
}

async function resolveCodigoVehiculo({
  fila = {},
  cabecera = {},
  mapeos = {},
  cfg = {},
  overrideTipoVehiculo = '',
  overrideTipoUso = '',
} = {}) {
  const direct = pick([fila?.codigo_vehiculo, fila?.codigoVehiculo, mapeos?.codigoVehiculo]);
  if (direct) {
    return {
      codigoVehiculo: String(direct),
      tipoVehiculo: String(overrideTipoVehiculo || ''),
      tipoUso: String(overrideTipoUso || ''),
      descripcionTipoVehiculo: RIVADAVIA_TIPO_VEHICULO_LABELS[String(overrideTipoVehiculo || '').trim()] || '',
    };
  }

  const tipoVehiculo = resolveTipoVehiculoCode({ fila, mapeos, cfg, overrideTipoVehiculo });
  const tipoUso = resolveTipoUsoCode({ fila, cabecera, mapeos, cfg, overrideTipoUso });
  const nroProductor = String(cfg?.producer_code || '').trim();
  const { resp } = await rivadaviaGet(cfg, '/consulta/api/emision/v1/consulta/codigo_vehiculo', {
    nro_productor: nroProductor,
    tipo_vehiculo: tipoVehiculo,
    tipo_uso: tipoUso,
  });

  if (!(resp.status >= 200 && resp.status < 300)) {
    throw new Error(`Rivadavia codigo_vehiculo HTTP ${resp.status}`);
  }

  const first = Array.isArray(resp.data?.tarifasDto) ? resp.data.tarifasDto[0] : null;
  const codigoVehiculo = String(first?.codigoVehiculo || '').trim();
  if (!codigoVehiculo) throw new Error('Rivadavia requiere codigoVehiculo');

  return {
    codigoVehiculo,
    tipoVehiculo,
    tipoUso,
    descripcionVehiculo: String(first?.descripcion || ''),
    descripcionTipoVehiculo: RIVADAVIA_TIPO_VEHICULO_LABELS[tipoVehiculo] || '',
  };
}

async function resolveSumaAsegurada({ fila = {}, cfg = {} }) {
  const direct = pick([fila?.suma, fila?.suma_asegurada, fila?.valorVehiculo, fila?.valor_vehiculo]);
  if (direct) {
    const digits = direct.replace(/[^\d]/g, '');
    if (digits) return digits;
  }

  const codigoInfoAuto = getCodigoInfoAuto(fila);
  const modelo = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const nroProductor = String(cfg?.producer_code || '').trim();

  const { resp } = await rivadaviaGet(cfg, '/consulta/api/emision/v1/consulta/suma_asegurada', {
    nroProductor,
    codigoInfoAuto,
    modelo,
  });

  if (!(resp.status >= 200 && resp.status < 300)) {
    throw new Error(`Rivadavia suma_asegurada HTTP ${resp.status}`);
  }

  const suma = String(resp?.data?.suma || '').replace(/[^\d]/g, '');
  if (!suma) throw new Error('Rivadavia requiere sumaAsegurada');
  return suma;
}

async function fetchPlanesMap(cfg = {}, fechaVigencia) {
  const { resp } = await rivadaviaGet(cfg, '/consulta/api/emision/v1/consulta/planes', {
    fechaVigencia,
  });
  if (!(resp.status >= 200 && resp.status < 300) || !Array.isArray(resp.data)) return {};
  return Object.fromEntries(resp.data.map((item) => [String(item?.codigoPlan || '').trim(), String(item?.codigoPlanDescripcion || '').trim()]));
}

async function buildRivadaviaPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  mapeos = {},
  today = new Date(),
  overrideTipoVehiculo = '',
  overrideTipoUso = '',
  attemptSource = 'initial',
} = {}) {
  const codigoInfoAuto = getCodigoInfoAuto(fila);
  const modeloAnio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const codigoPostal = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, cabecera?.cp]).replace(/\D+/g, '').slice(0, 4);

  if (!codigoInfoAuto || codigoInfoAuto === '0') throw new Error('Rivadavia requiere codigoInfoAuto');
  if (!modeloAnio) throw new Error('Rivadavia requiere modeloAnio');
  if (!codigoPostal) throw new Error('Rivadavia requiere codigoPostal');

  const fechaVigenciaDesde = formatIsoDate(today);
  const fechaVigenciaHasta = formatIsoDate(addYears(today, 1));
  const {
    codigoVehiculo,
    tipoVehiculo,
    tipoUso,
    descripcionVehiculo,
    descripcionTipoVehiculo,
  } = await resolveCodigoVehiculo({
    fila,
    cabecera,
    mapeos,
    cfg,
    overrideTipoVehiculo,
    overrideTipoUso,
  });
  const sumaAsegurada = await resolveSumaAsegurada({ fila, cfg });
  const payload = {
    nroProductor: String(cfg?.producer_code || '').trim(),
    claveProductor: String(cfg?.producer_password || '').trim(),
    datoAsegurado: {
      fechaNacimiento: null,
      personaJuridica: false,
      formaPago: mapRivadaviaFormaPago(cabecera, cfg),
      condicionIVA: mapRivadaviaIva(cabecera, cfg),
      condicionIB: mapRivadaviaIva(cabecera, cfg),
    },
    datoVehiculo: {
      codigoInfoAuto: String(codigoInfoAuto),
      codigoVehiculo: String(codigoVehiculo),
      modeloAnio: String(modeloAnio),
      sumaAsegurada: String(sumaAsegurada),
      porcentajeAjuste: String(cfg?.parametros_extras?.porcentaje_ajuste_default || '30'),
    },
    datoPoliza: {
      nroPoliza: '0',
      fechaVigenciaDesde,
      fechaVigenciaHasta,
      cantidadCuotas: String(cfg?.parametros_extras?.cantidad_cuotas_default || '3'),
      tipoFacturacion: String(cfg?.parametros_extras?.tipo_facturacion_default || 'TRIMESTRAL'),
      provincia: mapRivadaviaProvincia(fila, cabecera, cfg),
      codigoPostal: String(codigoPostal),
      gnc: cabecera?.gnc === '1' ? 'POSEE_GNC' : String(cfg?.parametros_extras?.gnc_default || 'NO_POSEE_GNC'),
      sumaAseguradaAccesorios: '0',
      sumaAseguradaEquipaje: '0',
      alarmaSatelital: resolveRivadaviaAlarmaSatelital(cabecera, cfg),
    },
    polizasVinculadas: {
      accidentePasajeros: ' ',
      accidentePersonales: ' ',
      combinadoFamiliar: ' ',
      incendio: ' ',
      vidaIndividual: ' ',
    },
  };

  return {
    payload,
    requestMeta: {
      nroProductor: payload.nroProductor,
      codigoInfoAuto: payload.datoVehiculo.codigoInfoAuto,
      codigoVehiculo,
      descripcionVehiculo,
      tipoVehiculo,
      tipoUso,
      descripcionTipoVehiculo,
      attemptSource,
      modeloAnio: payload.datoVehiculo.modeloAnio,
      sumaAsegurada: payload.datoVehiculo.sumaAsegurada,
      fechaVigenciaDesde,
      fechaVigenciaHasta,
      provincia: payload.datoPoliza.provincia,
      codigoPostal: payload.datoPoliza.codigoPostal,
      formaPago: payload.datoAsegurado.formaPago,
      condicionIVA: payload.datoAsegurado.condicionIVA,
      alarmaSatelital: payload.datoPoliza.alarmaSatelital,
    },
  };
}

async function parseRivadaviaQuoteResponse(data, cfg = {}, requestMeta = {}) {
  const response = typeof data === 'string' ? JSON.parse(data) : data;
  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Respuesta Rivadavia invalida', coberturas: [], raw: data };
  }
  if (response.message && !Array.isArray(response.coberturas)) {
    return {
      ok: false,
      error: String(response.message),
      operacion: String(response.nroPresupuesto || '0'),
      coberturas: [],
      raw: data,
    };
  }

  const planDescriptions = await fetchPlanesMap(cfg, requestMeta.fechaVigenciaDesde || formatIsoDate(new Date()));
  const coberturas = Array.isArray(response.coberturas)
    ? response.coberturas.map((item) => {
        const planRaw = String(item?.plan || '').trim();
        const planCode = planRaw.split(/\s+/)[0] || planRaw;
        const description = planDescriptions[planCode] || planRaw;
        return {
          codigoDeCobertura: planCode,
          descripcionDeCobertura: description,
          codigoDeProducto: planCode,
          descripcionDeProducto: description,
          importePremio: String(item?.premioTotal ?? ''),
          importePremioContado: String(item?.contado ?? ''),
          importeCuota: String(item?.cuotaMensual ?? ''),
          plan: planRaw,
        };
      })
    : [];

  return {
    ok: coberturas.length > 0,
    operacion: String(response?.nroPresupuesto || ''),
    coberturas,
    raw: data,
    used: {
      fechaVigenciaDesde: requestMeta.fechaVigenciaDesde || '',
      tipoVehiculo: requestMeta.tipoVehiculo || '',
      tipoUso: requestMeta.tipoUso || '',
      codigoVehiculo: requestMeta.codigoVehiculo || '',
      sumaAsegurada: requestMeta.sumaAsegurada || '',
      descripcionTipoVehiculo: requestMeta.descripcionTipoVehiculo || '',
      attemptSource: requestMeta.attemptSource || '',
    },
  };
}

module.exports = {
  buildRivadaviaAttemptPlan,
  buildRivadaviaPayload,
  mapRivadaviaFormaPago,
  mapRivadaviaIva,
  mapRivadaviaProvincia,
  parseRivadaviaQuoteResponse,
  resolveRivadaviaAlarmaSatelital,
  resolveCodigoVehiculo,
  resolveSumaAsegurada,
  upsertRivadaviaTipoVehiculoInferido,
};

const fs = require('fs');
const path = require('path');
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

function formatSoapDate(value) {
  return formatIsoDate(value).replace(/-/g, '');
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeDecimalText(value, fallback = '0.9') {
  const raw = pick([value, fallback]).replace(',', '.');
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return String(raw).trim();
}

function onlyDigits(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

let postalCatalogCache = null;

function getPostalCatalog() {
  if (postalCatalogCache) return postalCatalogCache;
  try {
    const file = path.resolve(__dirname, '../../../data/experta/diccionarios/localidades.json');
    postalCatalogCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    postalCatalogCache = {};
  }
  return postalCatalogCache;
}

function mapPostalCatalogProvinciaToRivadaviaSoap(provinciaId) {
  const map = {
    '1': '2', // Capital Federal en Experta -> CodigoProvincia Rivadavia SOAP.
    '2': '1', // Buenos Aires en Experta -> CodigoProvincia Rivadavia SOAP.
  };
  return map[String(provinciaId || '').trim()] || '';
}

function resolveRivadaviaSoapProvincia(row = {}, cabecera = {}, cfg = {}) {
  const codigoPostal = onlyDigits(pick([
    row?.cp,
    row?.CP,
    row?.codigo_postal,
    row?.codigoPostal,
    cabecera?.cp,
    cabecera?.codigo_postal,
    cabecera?.codigoPostal,
  ]));
  const localidad = normalizeText(pick([
    row?.localidad,
    row?.Localidad,
    row?.desc_localidad,
    cabecera?.localidad,
  ]));
  const rawProvincia = normalizeText(pick([
    row?.provincia,
    row?.Provincia,
    row?.desc_provincia,
    row?.nom_prov,
    cabecera?.provincia,
  ]));
  const map = {
    'BUENOS AIRES': '1',
    CABA: '2',
    'CAPITAL FEDERAL': '2',
    CATAMARCA: '3',
    CORDOBA: '4',
    CORRIENTES: '5',
    CHACO: '6',
    CHUBUT: '7',
    'ENTRE RIOS': '8',
    FORMOSA: '9',
    JUJUY: '10',
    'LA PAMPA': '11',
    'LA RIOJA': '12',
    MENDOZA: '13',
    MISIONES: '14',
    NEUQUEN: '15',
    'RIO NEGRO': '16',
    SALTA: '17',
    'SAN JUAN': '18',
    'SAN LUIS': '19',
    'SANTA CRUZ': '20',
    'SANTA FE': '21',
    'SANTIAGO DEL ESTERO': '22',
    'TIERRA DEL FUEGO': '23',
    TUCUMAN: '24',
  };
  const rowCode = map[rawProvincia] || '';
  const rows = codigoPostal ? (getPostalCatalog()[codigoPostal] || []) : [];
  let catalogProvinceId = '';
  let catalogSource = '';

  if (rows.length) {
    const matched = localidad
      ? rows.find((item) => {
        const itemLocalidad = normalizeText(item?.localidad);
        return itemLocalidad === localidad || itemLocalidad.includes(localidad) || localidad.includes(itemLocalidad);
      })
      : null;
    if (matched?.provinciaId) {
      catalogProvinceId = String(matched.provinciaId);
      catalogSource = 'postal_localidad';
    } else {
      const provinceIds = [...new Set(rows.map((item) => String(item?.provinciaId || '').trim()).filter(Boolean))];
      if (provinceIds.length === 1) {
        catalogProvinceId = provinceIds[0];
        catalogSource = 'postal_unica';
      }
    }
  }

  const catalogCode = mapPostalCatalogProvinciaToRivadaviaSoap(catalogProvinceId);
  if (catalogCode) {
    return {
      codigoProvincia: catalogCode,
      source: catalogSource,
      rawProvincia,
      codigoPostal,
      localidad,
      catalogProvinceId,
      rowCode,
      conflict: Boolean(rowCode && rowCode !== catalogCode),
    };
  }

  const fallbackCode = String(cfg?.parametros_extras?.codigo_provincia_soap_default || '1');
  return {
    codigoProvincia: rowCode || fallbackCode,
    source: rowCode ? 'row' : 'fallback',
    rawProvincia,
    codigoPostal,
    localidad,
    catalogProvinceId: '',
    rowCode,
    conflict: false,
  };
}

function resolveRivadaviaGncAmount({ fila = {}, cabecera = {} } = {}) {
  return onlyDigits(pick([
    fila?.suma_gnc,
    fila?.sumaGnc,
    fila?.valor_gnc,
    fila?.valorGnc,
    cabecera?.suma_gnc,
    cabecera?.sumaGnc,
    cabecera?.valor_gnc,
    cabecera?.valorGnc,
  ]));
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

function mapRivadaviaSoapProvincia(row = {}, cabecera = {}, cfg = {}) {
  return resolveRivadaviaSoapProvincia(row, cabecera, cfg).codigoProvincia;
}

function resolveRivadaviaCoeficients({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const rc = normalizeDecimalText(pick([
    fila?.rivadavia_coef_rc,
    fila?.coeficiente_rc,
    fila?.coef_rc,
    cabecera?.rivadavia_coef_rc,
    cabecera?.coeficiente_rc,
    cabecera?.coef_rc,
    cfg?.ajuste_rc,
    cfg?.parametros_extras?.coef_rc_default,
  ]), '0.9');
  const casco = normalizeDecimalText(pick([
    fila?.rivadavia_coef_casco,
    fila?.coeficiente_casco,
    fila?.coef_casco,
    cabecera?.rivadavia_coef_casco,
    cabecera?.coeficiente_casco,
    cabecera?.coef_casco,
    cfg?.ajuste_casco,
    cfg?.parametros_extras?.coef_casco_default,
  ]), rc);
  return { coefRC: rc, coefCasco: casco };
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
  const gncAmount = cabecera?.gnc === '1' ? resolveRivadaviaGncAmount({ fila, cabecera }) : '';
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
      sumaAseguradaAccesorios: gncAmount || '0',
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

async function buildRivadaviaSoapPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  mapeos = {},
  today = new Date(),
  overrideTipoVehiculo = '',
  overrideTipoUso = '',
  attemptSource = 'initial',
} = {}) {
  const built = await buildRivadaviaPayload({
    fila,
    cabecera,
    cfg,
    mapeos,
    today,
    overrideTipoVehiculo,
    overrideTipoUso,
    attemptSource,
  });
  const jsonPayload = built.payload;
  const { coefRC, coefCasco } = resolveRivadaviaCoeficients({ fila, cabecera, cfg });
  const fechaNacimiento = pick([
    fila?.fecha_nacimiento,
    fila?.fechaNacimiento,
    fila?.fec_nac,
    cabecera?.fecha_nacimiento,
    cabecera?.fechaNacimiento,
    '0',
  ]);
  const condicionIva = pick([
    fila?.rivadavia_condicion_iva,
    cabecera?.rivadavia_condicion_iva,
    cfg?.parametros_extras?.condicion_iva_soap_default,
    '1',
  ]);
  const provinciaSoap = resolveRivadaviaSoapProvincia(fila, cabecera, cfg);
  const soapPayload = {
    NroProductor: jsonPayload.nroProductor,
    Clave: jsonPayload.claveProductor,
    Matricula: '0',
    TipoDocumento: '0',
    NroDocumento: '0',
    CUIL: '0',
    CUIT: '0',
    Poliza: '0',
    CodInfoAuto: jsonPayload.datoVehiculo.codigoInfoAuto,
    CodVehiculo: jsonPayload.datoVehiculo.codigoVehiculo,
    ModeloAnio: jsonPayload.datoVehiculo.modeloAnio,
    SumaAsegurada: jsonPayload.datoVehiculo.sumaAsegurada,
    Ajuste: jsonPayload.datoVehiculo.porcentajeAjuste,
    PoseeGNC: String(cabecera?.gnc) === '1' ? '2' : '1',
    SumaAseguradaAccesorios: jsonPayload.datoPoliza.sumaAseguradaAccesorios,
    SumaAseguradaEquipaje: jsonPayload.datoPoliza.sumaAseguradaEquipaje,
    Asientos: '0',
    AlarmaSatelital: jsonPayload.datoPoliza.alarmaSatelital === 'SIN_ALARMA' ? '0' : '1',
    Subrogado: '0',
    Vinculada01: '0',
    Vinculada02: '0',
    Vinculada03: '0',
    Vinculada04: '0',
    Vinculada05: '0',
    FechaNacimiento: fechaNacimiento,
    CoefRC: coefRC,
    CoefCasco: coefCasco,
    CondicionIVA: condicionIva,
    CondicionIB: pick([cfg?.parametros_extras?.condicion_ib_soap_default, '1']),
    PersonaJuridica: 'N',
    VigDesde: formatSoapDate(jsonPayload.datoPoliza.fechaVigenciaDesde),
    VigHasta: formatSoapDate(jsonPayload.datoPoliza.fechaVigenciaHasta),
    FormaPago: pick([cfg?.parametros_extras?.forma_pago_soap_default, '3']),
    CantCuotas: jsonPayload.datoPoliza.cantidadCuotas,
    Facturacion: pick([cfg?.parametros_extras?.facturacion_soap_default, '5']),
    CodigoProvincia: provinciaSoap.codigoProvincia,
    CodigoPostal: jsonPayload.datoPoliza.codigoPostal,
    PorcBonif: pick([cfg?.parametros_extras?.porc_bonif_default, '0']),
    AniosSinSiniestros: pick([cfg?.parametros_extras?.anios_sin_siniestros_default, '0']),
  };

  return {
    payload: soapPayload,
    envelope: buildRivadaviaSoapEnvelope(soapPayload),
    requestMeta: {
      ...built.requestMeta,
      soap: true,
      coefRC,
      coefCasco,
      codigoProvinciaSoap: soapPayload.CodigoProvincia,
      codigoProvinciaSoapSource: provinciaSoap.source,
      codigoProvinciaSoapConflict: provinciaSoap.conflict,
      codigoProvinciaSoapRowCode: provinciaSoap.rowCode,
      codigoProvinciaSoapRawProvincia: provinciaSoap.rawProvincia,
      codigoProvinciaSoapLocalidad: provinciaSoap.localidad,
      codigoProvinciaSoapPostalCatalogProvinceId: provinciaSoap.catalogProvinceId,
      formaPagoSoap: soapPayload.FormaPago,
      facturacionSoap: soapPayload.Facturacion,
    },
  };
}

function buildRivadaviaSoapEnvelope(payload = {}) {
  const tag = (name, type, value) => `        <${name} xsi:type="${type}">${xmlEscape(value)}</${name}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:tns="urn:emision_poliza">
  <SOAP-ENV:Body>
    <tns:solicitudCotizacion xmlns:tns="urn:emision_poliza">
      <Solicitud xsi:type="tns:Solicitud_cotizacion">
${[
    tag('NroProductor', 'xsd:long', payload.NroProductor),
    tag('Clave', 'xsd:string', payload.Clave),
    tag('Matricula', 'xsd:long', payload.Matricula),
    tag('TipoDocumento', 'xsd:int', payload.TipoDocumento),
    tag('NroDocumento', 'xsd:long', payload.NroDocumento),
    tag('CUIL', 'xsd:long', payload.CUIL),
    tag('CUIT', 'xsd:long', payload.CUIT),
    tag('Poliza', 'xsd:long', payload.Poliza),
    tag('CodInfoAuto', 'xsd:string', payload.CodInfoAuto),
    tag('CodVehiculo', 'xsd:int', payload.CodVehiculo),
    tag('ModeloAnio', 'xsd:int', payload.ModeloAnio),
    tag('SumaAsegurada', 'xsd:float', payload.SumaAsegurada),
    tag('Ajuste', 'xsd:int', payload.Ajuste),
    tag('PoseeGNC', 'xsd:int', payload.PoseeGNC),
    tag('SumaAseguradaAccesorios', 'xsd:long', payload.SumaAseguradaAccesorios),
    tag('SumaAseguradaEquipaje', 'xsd:long', payload.SumaAseguradaEquipaje),
    tag('Asientos', 'xsd:int', payload.Asientos),
    tag('AlarmaSatelital', 'xsd:int', payload.AlarmaSatelital),
    tag('Subrogado', 'xsd:int', payload.Subrogado),
    tag('Vinculada01', 'xsd:string', payload.Vinculada01),
    tag('Vinculada02', 'xsd:string', payload.Vinculada02),
    tag('Vinculada03', 'xsd:string', payload.Vinculada03),
    tag('Vinculada04', 'xsd:string', payload.Vinculada04),
    tag('Vinculada05', 'xsd:string', payload.Vinculada05),
    tag('FechaNacimiento', 'xsd:long', payload.FechaNacimiento),
    tag('CoefRC', 'xsd:string', payload.CoefRC),
    tag('CoefCasco', 'xsd:string', payload.CoefCasco),
    tag('CondicionIVA', 'xsd:int', payload.CondicionIVA),
    tag('CondicionIB', 'xsd:int', payload.CondicionIB),
    tag('PersonaJuridica', 'xsd:string', payload.PersonaJuridica),
    tag('VigDesde', 'xsd:long', payload.VigDesde),
    tag('VigHasta', 'xsd:long', payload.VigHasta),
    tag('FormaPago', 'xsd:int', payload.FormaPago),
    tag('CantCuotas', 'xsd:int', payload.CantCuotas),
    tag('Facturacion', 'xsd:int', payload.Facturacion),
    tag('CodigoProvincia', 'xsd:int', payload.CodigoProvincia),
    tag('CodigoPostal', 'xsd:int', payload.CodigoPostal),
    tag('PorcBonif', 'xsd:string', payload.PorcBonif),
    tag('AniosSinSiniestros', 'xsd:int', payload.AniosSinSiniestros),
  ].join('\n')}
      </Solicitud>
    </tns:solicitudCotizacion>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function parseSoapMoney(value) {
  const text = String(value || '').trim().replace(/^0+/, '').replace(',', '.');
  return text || '0';
}

function parseRivadaviaSoapQuoteResponse(data, _cfg = {}, requestMeta = {}) {
  const xml = String(data || '');
  const errors = [...xml.matchAll(/<item[^>]*xsi:type="xsd:string"[^>]*>([^<]+)<\/item>/g)].map((match) => match[1]);
  const coberturas = [...xml.matchAll(/<item[\s\S]*?<NroPresupuesto[^>]*>([^<]*)<\/NroPresupuesto>[\s\S]*?<Plan[^>]*>([^<]*)<\/Plan>[\s\S]*?<PremioTotal[^>]*>([^<]*)<\/PremioTotal>[\s\S]*?<Contado[^>]*>([^<]*)<\/Contado>[\s\S]*?<CuotaMensual[^>]*>([^<]*)<\/CuotaMensual>[\s\S]*?<\/item>/g)]
    .map((match) => ({
      codigoDeCobertura: String(match[2] || '').trim(),
      descripcionDeCobertura: String(match[2] || '').trim(),
      codigoDeProducto: String(match[2] || '').trim(),
      descripcionDeProducto: String(match[2] || '').trim(),
      importePremio: parseSoapMoney(match[3]),
      importePremioContado: parseSoapMoney(match[4]),
      importeCuota: parseSoapMoney(match[5]),
      plan: String(match[2] || '').trim(),
      nroPresupuesto: String(match[1] || '').trim(),
    }));
  const operacion = coberturas[0]?.nroPresupuesto || '';
  return {
    ok: coberturas.length > 0,
    operacion,
    coberturas,
    error: coberturas.length ? '' : (errors.join('; ') || 'Rivadavia SOAP respondio sin coberturas'),
    raw: data,
    used: {
      fechaVigenciaDesde: requestMeta.fechaVigenciaDesde || '',
      tipoVehiculo: requestMeta.tipoVehiculo || '',
      tipoUso: requestMeta.tipoUso || '',
      codigoVehiculo: requestMeta.codigoVehiculo || '',
      sumaAsegurada: requestMeta.sumaAsegurada || '',
      descripcionTipoVehiculo: requestMeta.descripcionTipoVehiculo || '',
      attemptSource: requestMeta.attemptSource || '',
      coefRC: requestMeta.coefRC || '',
      coefCasco: requestMeta.coefCasco || '',
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
  buildRivadaviaSoapEnvelope,
  buildRivadaviaSoapPayload,
  mapRivadaviaFormaPago,
  mapRivadaviaIva,
  mapRivadaviaProvincia,
  mapRivadaviaSoapProvincia,
  parseRivadaviaSoapQuoteResponse,
  parseRivadaviaQuoteResponse,
  resolveRivadaviaCoeficients,
  resolveRivadaviaAlarmaSatelital,
  resolveCodigoVehiculo,
  resolveSumaAsegurada,
  upsertRivadaviaTipoVehiculoInferido,
};

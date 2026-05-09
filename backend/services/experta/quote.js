const {
  resolveExpertaIva: resolveExpertaIvaFromCommons,
  resolveExpertaPostalCode: resolveExpertaPostalCodeFromCommons,
  resolveExpertaVehicleCatalog,
} = require('./commons');
const { resolveCompanyTracking } = require('../../utils/rastreo');

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
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function formatDdMmYyyy(input) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function resolveExpertaUso({ fila = {}, cabecera = {}, usoDicc = {} }) {
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (/^\d+$/.test(raw)) return raw;
  if (raw.includes('COMER')) return String(usoDicc.comercial || '10');
  if (raw.includes('TAX')) return String(usoDicc.taxi || usoDicc.comercial || '10');
  return String(usoDicc.particular || '1');
}

function resolveExpertaIvaFallback({ cabecera = {}, cfg = {} }) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: '5',
    'CONSUMIDOR FINAL': '5',
    RI: '1',
    'RESPONSABLE INSCRIPTO': '1',
    EX: '4',
    EXENTO: '4',
    MT: '6',
    MONOTRIBUTO: '6',
  };
  return map[raw] || String(cfg?.parametros_extras?.iva_default || '5');
}

function resolveExpertaPostalCodeFallback(fila = {}, cabecera = {}, cfg = {}) {
  const direct = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, cabecera?.cp]);
  if (/^\d{7}$/.test(direct)) return direct;
  if (/^\d{4}$/.test(direct)) return `${direct}000`;
  return String(cfg?.parametros_extras?.codigo_postal_default || '');
}

function resolveExpertaPaymentKey(cabecera = {}) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
    cabecera?.medioPago ??
    cabecera?.forma_pago ??
    cabecera?.formaPago ??
    ''
  );
  if (['EF', 'EFECTIVO', 'E', 'PAGO FACIL', 'RAPIPAGO'].includes(raw)) return 'efectivo';
  return 'debito';
}

function resolveExpertaConRecuperador(cabecera = {}, cfg = {}) {
  const tracking = resolveCompanyTracking(cabecera, 'experta', cfg);
  return String(tracking.mappedValue || cfg?.parametros_extras?.con_recuperador_default || 'N').trim() || 'N';
}

async function buildExpertaPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  usoDicc = {},
  today = new Date(),
  token = '',
} = {}) {
  let codInfoAuto = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const postal = token
    ? await resolveExpertaPostalCodeFromCommons({ fila, cabecera, cfg, token }).catch(() => ({ codigoPostal: resolveExpertaPostalCodeFallback(fila, cabecera, cfg), source: 'fallback' }))
    : { codigoPostal: resolveExpertaPostalCodeFallback(fila, cabecera, cfg), source: 'fallback' };
  const ivaResolved = token
    ? await resolveExpertaIvaFromCommons({ cabecera, cfg, token }).catch(() => ({ iva: resolveExpertaIvaFallback({ cabecera, cfg }), source: 'fallback' }))
    : { iva: resolveExpertaIvaFallback({ cabecera, cfg }), source: 'fallback' };
  const vehicleCatalog = await resolveExpertaVehicleCatalog({
    fila,
    cabecera,
    cfg,
    token,
    codInfoAuto,
    anio,
  }).catch(() => ({
    marca: pick([fila?.marca, cfg?.parametros_extras?.marca_default || 'unespecified']),
    modelo: pick([fila?.modelo, cfg?.parametros_extras?.modelo_default || 'unespecified']),
    version: pick([fila?.version, cfg?.parametros_extras?.version_default || 'unespecified']),
    codInfoAuto: String(codInfoAuto || ''),
    source: 'fallback',
  }));
  const codigoPostal = postal.codigoPostal;
  codInfoAuto = String(vehicleCatalog.codInfoAuto || codInfoAuto || '').trim();

  if (!codInfoAuto) throw new Error('Experta requiere codInfoAuto');
  if (!anio) throw new Error('Experta requiere anio');
  if (!codigoPostal) throw new Error('Experta requiere codigoPostal de 7 digitos');

  const hasGnc = cabecera?.gnc === '1' || normalizeText(fila?.gnc) === '501';
  const valorGnc = pick([fila?.valorGnc, fila?.valor_gnc, cabecera?.suma_gnc, cfg?.parametros_extras?.valor_gnc_default]);
  const payload = {
    apellido: pick([cabecera?.apellido, fila?.apellido]),
    email: pick([cabecera?.email, fila?.email]),
    nombres: pick([cabecera?.nombre, cabecera?.nombres, fila?.nombres]),
    productor: String(cfg?.producer_code || ''),
    modalidad: String(cfg?.parametros_extras?.modalidad_default || 'EX0'),
    fechaVigencia: formatDdMmYyyy(today),
    iva: ivaResolved.iva,
    codigoPostal,
    anio: String(anio),
    ceroKM: cabecera?.cerokm === '1' ? 'S' : 'N',
    codInfoAuto: String(codInfoAuto),
    gnc: hasGnc ? '501' : String(cfg?.parametros_extras?.gnc_default || 'N'),
    marca: pick([vehicleCatalog.marca, fila?.marca, cfg?.parametros_extras?.marca_default || 'unespecified']),
    modelo: pick([vehicleCatalog.modelo, fila?.modelo, cfg?.parametros_extras?.modelo_default || 'unespecified']),
    uso: resolveExpertaUso({ fila, cabecera, usoDicc }),
    version: pick([vehicleCatalog.version, fila?.version, cfg?.parametros_extras?.version_default || 'unespecified']),
    conRecuperador: resolveExpertaConRecuperador(cabecera, cfg),
  };

  const ajuste = pick([cfg?.clausula_ajuste, cfg?.parametros_extras?.porcentaje_ajuste_default]);
  if (ajuste) payload.porcentajeAjuste = ajuste;
  if (hasGnc && valorGnc) payload.valorGnc = String(valorGnc);

  return {
    payload,
    requestMeta: {
      productor: payload.productor,
      modalidad: payload.modalidad,
      fechaVigencia: payload.fechaVigencia,
      iva: payload.iva,
      codigoPostal: payload.codigoPostal,
      anio: payload.anio,
      codInfoAuto: payload.codInfoAuto,
      marca: payload.marca,
      modelo: payload.modelo,
      version: payload.version,
      gnc: payload.gnc,
      uso: payload.uso,
      conRecuperador: payload.conRecuperador,
      porcentajeAjuste: payload.porcentajeAjuste || '',
      cpSource: postal.source,
      ivaSource: ivaResolved.source,
      vehicleSource: vehicleCatalog.source,
    },
  };
}

function parseExpertaQuoteResponse(data, { selectedPriceKey = 'debito' } = {}) {
  const response = typeof data === 'string' ? JSON.parse(data) : data;
  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Respuesta Experta invalida', coberturas: [], raw: data };
  }
  if (response.error || response.message) {
    return {
      ok: false,
      error: String(response.error || response.message),
      coberturas: [],
      raw: data,
    };
  }

  const planes = asArray(response.planes).map((plan) => {
    const selected = String(plan?.[selectedPriceKey] ?? '');
    return {
      codigoDeCobertura: String(plan?.codigo ?? ''),
      descripcionDeCobertura: String(plan?.planMostrar || plan?.descripcion || ''),
      codigoDeProducto: String(plan?.pack ?? ''),
      descripcionDeProducto: String(plan?.descripcion || ''),
      importePrima: String(plan?.prima ?? ''),
      importePremio: selected,
      importePremioDebito: String(plan?.debito ?? ''),
      importePremioEfectivo: String(plan?.efectivo ?? ''),
      inspeccionable: String(plan?.inspeccionable ?? ''),
      franquicia: String(plan?.franquicia ?? ''),
      franquiciaRobo: String(plan?.franquiciarobo ?? ''),
      conRecuperador: String(plan?.conRecuperador ?? ''),
      duracion: String(plan?.duracion ?? ''),
      porcentajePromocion: String(plan?.porcentaje_promocion ?? ''),
      sumaAsegurada: String(response?.valor ?? ''),
      requiereInspeccion: String(plan?.inspeccionable ?? '').toUpperCase() === 'S' ? 'true' : 'false',
      coberturas: plan?.coberturas || {},
    };
  });

  return {
    ok: planes.length > 0,
    operacion: String(response?.nroPresupuesto || ''),
    suma_asegurada: String(response?.valor ?? ''),
    coberturas: planes,
    raw: data,
    used: {
      selectedPriceKey,
      modalidad: String(response?.modalidad || ''),
      porcentajeAjuste: String(response?.porcentajeAjuste || ''),
      codigoPostal: String(response?.codigoPostal || ''),
      hashcia: String(response?.hashcia || ''),
    },
  };
}

module.exports = {
  buildExpertaPayload,
  parseExpertaQuoteResponse,
  resolveExpertaIva: resolveExpertaIvaFallback,
  resolveExpertaPaymentKey,
  resolveExpertaPostalCode: resolveExpertaPostalCodeFallback,
  resolveExpertaConRecuperador,
  resolveExpertaUso,
};

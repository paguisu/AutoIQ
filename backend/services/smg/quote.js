const { XMLParser } = require('fast-xml-parser');
const { resolveCompanyTracking } = require('../../utils/rastreo');
const { isVehicleZeroKm } = require('../../utils/zero_km');

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });

const SMG_PROVINCE_CODES = {
  CABA: '1',
  'CAPITAL FEDERAL': '1',
  'CIUDAD AUTONOMA BUENOS AIRES': '1',
  'CIUDAD AUTONOMA DE BUENOS AIRES': '1',
  'BUENOS AIRES': '2',
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

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

function asText(value) {
  return value == null ? '' : String(value);
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

function normalizeInteger(value, fallback = '0') {
  const raw = String(value ?? '').trim();
  if (!raw) return String(fallback);
  if (/^-?\d+$/.test(raw)) return raw;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const num = Number.parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? String(Math.round(num)) : String(fallback);
}

function int32OrEmpty(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return '';
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num > 2147483647) return '';
  return raw;
}

function resolveSmgUseCode({ fila = {}, cabecera = {}, mapeos = {}, cfg = {} } = {}) {
  const mapped = String(mapeos?.uso_codigo || '').trim();
  if (mapped) return mapped;

  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (raw.includes('COMER') || raw.includes('TRAB') || raw.includes('TAX') || raw.includes('REMI')) return '6';
  return String(cfg?.parametros_extras?.uso_default || '1');
}

function resolveSmgProvinceCode(fila = {}, cabecera = {}, cfg = {}) {
  const direct = pick([
    fila?.cod_provincia_smg,
    fila?.codProvinciaSmg,
    fila?.codProvSmg,
    cabecera?.cod_provincia_smg,
  ]);
  if (/^\d+$/.test(direct)) return direct;

  const raw = normalizeText(pick([
    fila?.provincia,
    fila?.Provincia,
    fila?.nom_prov,
    fila?.desc_provincia,
    cabecera?.provincia,
  ]));
  return SMG_PROVINCE_CODES[raw] || String(cfg?.parametros_extras?.cod_provincia_default || '2');
}

function resolveSmgAdjustmentClause(cabecera = {}, cfg = {}) {
  const raw = normalizeText(pick([
    cabecera?.ajuste,
    cabecera?.clausula_ajuste,
    cfg?.clausula_ajuste,
    cfg?.parametros_extras?.clausula_ajuste_default,
  ]));
  if (!raw || raw === '0' || raw === 'S C' || raw === 'SC') {
    return String(cfg?.parametros_extras?.cod_clausula_ajuste_default || '1');
  }

  const numeric = Number(raw.replace('%', '').trim());
  if (Number.isFinite(numeric)) {
    if (numeric === 0) return '1';
    if (numeric % 10 === 0 && numeric >= 10 && numeric <= 90) return String((numeric / 10) + 1);
  }
  if (/^\d+$/.test(raw)) return raw;
  return String(cfg?.parametros_extras?.cod_clausula_ajuste_default || '1');
}

function resolveSmgCodAgente(cfg = {}) {
  const configured = pick([cfg?.cod_agente, cfg?.codAgt, cfg?.producer_code, cfg?.parametros_extras?.cod_agente_default]);
  if (configured) return String(configured);

  const userAsAgent = int32OrEmpty(cfg?.usuario);
  if (userAsAgent) return userAsAgent;

  return '0';
}

function resolveSmgVehicleType({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const direct = pick([fila?.sTipo_veh, fila?.smg_tipo_veh, fila?.tipo_vehiculo_smg, cabecera?.tipo_vehiculo_smg]);
  if (/^\d+$/.test(direct)) return direct;

  const raw = normalizeText(pick([fila?.tipo_vehiculo, fila?.TipoVehiculo, fila?.tipoVehiculo, cabecera?.tipo_vehiculo]));
  if (raw.includes('MOTO') || raw.includes('SCOOTER')) {
    return String(cfg?.parametros_extras?.tipo_vehiculo_moto || '2');
  }
  return String(cfg?.parametros_extras?.tipo_vehiculo_default || '1');
}

function boolFlag(value) {
  const raw = normalizeText(value);
  return raw === '1' || raw === 'SI' || raw === 'TRUE' || raw === 'S';
}

function resolveSmgInfoAuto(fila = {}) {
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

function resolveSmgAnio(fila = {}) {
  return pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
}

function buildSmgSumLookupEnvelope({ fila = {} } = {}) {
  const codInfoauto = resolveSmgInfoAuto(fila);
  const anio = resolveSmgAnio(fila);

  if (!codInfoauto) throw new Error('SMG requiere codigo InfoAuto');
  if (!anio) throw new Error('SMG requiere anio del vehiculo');

  const params = {
    codInfoAuto: normalizeInteger(codInfoauto, '0'),
    Ano: normalizeInteger(anio, '0'),
  };

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <obtenerSAModeloAno xmlns="http://tempuri.org/">
      <codInfoAuto>${escapeXml(params.codInfoAuto)}</codInfoAuto>
      <Ano>${escapeXml(params.Ano)}</Ano>
    </obtenerSAModeloAno>
  </soap:Body>
</soap:Envelope>`.trim();

  return {
    envelope,
    requestMeta: params,
  };
}

function parseSmgSumLookupResponse(xml) {
  const raw = String(xml || '');
  const parsed = parser.parse(raw);
  const body = parsed?.Envelope?.Body || {};
  const fault = body?.Fault;
  if (fault) {
    return {
      ok: false,
      error: asText(fault?.faultstring || fault?.Reason?.Text || 'SOAP Fault SMG'),
      sumaAsegurada: '0',
      raw,
    };
  }

  const value = normalizeInteger(body?.obtenerSAModeloAnoResponse?.obtenerSAModeloAnoResult, '0');
  if (/^\d+$/.test(value) && Number(value) > 0) {
    return {
      ok: true,
      sumaAsegurada: value,
      raw,
    };
  }

  return {
    ok: false,
    error: 'SMG no devolvio suma asegurada',
    sumaAsegurada: '0',
    raw,
  };
}

function buildSmgEnvelope({ fila = {}, cabecera = {}, cfg = {}, mapeos = {}, sumaAseguradaOverride } = {}) {
  const method = String(cfg?.soap_method || 'Cotizar_Autos_fp').trim() || 'Cotizar_Autos_fp';
  const codInfoauto = resolveSmgInfoAuto(fila);
  const anio = resolveSmgAnio(fila);
  const codigoPostal = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, cabecera?.cp]).replace(/\D+/g, '').slice(0, 4);

  if (!codInfoauto) throw new Error('SMG requiere codigo InfoAuto');
  if (!anio) throw new Error('SMG requiere anio del vehiculo');
  if (!codigoPostal) throw new Error('SMG requiere codigo postal');
  if (method === 'Cotizar_Autos_fp' && !String(cfg?.password || '').trim()) {
    throw new Error('SMG requiere password configurada');
  }
  const tracking = resolveCompanyTracking(cabecera, 'smg', cfg);
  const configuredLocalizadorCon = pick([cfg?.parametros_extras?.cod_localizador_con_default]);
  const localizadorCon = pick([
    cabecera?.cod_localizador_smg,
    tracking.defaultApplied ? configuredLocalizadorCon : tracking.mappedValue,
    tracking.defaultApplied ? tracking.mappedValue : configuredLocalizadorCon,
    cfg?.parametros_extras?.cod_localizador_default,
  ]);

  const params = {
    nCodCobertura: normalizeInteger(pick([fila?.smg_cod_cobertura, cfg?.parametros_extras?.cod_cobertura_default]), '0'),
    nCodMarca: normalizeInteger(pick([fila?.smg_cod_marca, fila?.cod_marca_smg, cfg?.parametros_extras?.cod_marca_default]), '0'),
    nCodModelo: normalizeInteger(pick([fila?.smg_cod_modelo, fila?.cod_modelo_smg, cfg?.parametros_extras?.cod_modelo_default]), '0'),
    nCodAutoInfoAuto: normalizeInteger(codInfoauto, '0'),
    nAnio: normalizeInteger(anio, '0'),
    nSumaAsegurada: normalizeInteger(pick([
      sumaAseguradaOverride,
      fila?.valorVehiculo,
      fila?.valor_vehiculo,
      fila?.valorVeh,
      fila?.valor_veh,
      fila?.suma,
      fila?.suma_asegurada,
      cfg?.parametros_extras?.suma_asegurada_default,
    ]), '0'),
    nCodClausulaAjuste: normalizeInteger(resolveSmgAdjustmentClause(cabecera, cfg), '1'),
    nCodUsoVeh: normalizeInteger(resolveSmgUseCode({ fila, cabecera, mapeos, cfg }), '1'),
    nCodPostal: normalizeInteger(codigoPostal, '0'),
    nCodProvincia: normalizeInteger(resolveSmgProvinceCode(fila, cabecera, cfg), '2'),
    n0km: isVehicleZeroKm(fila) ? '-1' : '0',
    nMontoGNC: cabecera?.gnc === '1' ? normalizeInteger(pick([cabecera?.suma_gnc, fila?.suma_gnc]), '0') : '0',
    nMontoAireAcond: normalizeInteger(pick([cabecera?.suma_aire_acond, fila?.suma_aire_acond]), '0'),
    nMontoLlantas: normalizeInteger(pick([cabecera?.suma_llantas, fila?.suma_llantas]), '0'),
    nMontoAntenaEspecial: normalizeInteger(pick([cabecera?.suma_antena_especial, fila?.suma_antena_especial]), '0'),
    nMontoOtrosAcc: normalizeInteger(pick([cabecera?.suma_otros_accesorios, fila?.suma_otros_accesorios, cabecera?.accesorios]), '0'),
    nCodLocalizador: normalizeInteger(
      tracking.hasTracking
        ? localizadorCon
        : pick([cfg?.parametros_extras?.cod_localizador_sin_default, tracking.mappedValue, cfg?.parametros_extras?.cod_localizador_default]),
      '0'
    ),
    nAjustePrima: normalizeInteger(pick([cabecera?.ajuste_prima, cfg?.descuento_comercial, cfg?.parametros_extras?.ajuste_prima_default]), '0'),
    nGranizo: boolFlag(cabecera?.granizo) ? '-1' : normalizeInteger(cfg?.parametros_extras?.granizo_default, '0'),
    nCodPeriodo: normalizeInteger(pick([cabecera?.periodo_facturacion_smg, cfg?.parametros_extras?.periodo_facturacion_default]), '6'),
    nCantCuotas: normalizeInteger(pick([cabecera?.cantidad_cuotas_smg, cfg?.parametros_extras?.cantidad_cuotas_default]), '1'),
    cod_agente: normalizeInteger(resolveSmgCodAgente(cfg), '0'),
    cod_tipo_poliza: normalizeInteger(pick([cfg?.cod_tipo_poliza, cfg?.parametros_extras?.cod_tipo_poliza_default]), '1'),
    AsistMecanica: normalizeInteger(pick([cfg?.parametros_extras?.asistencia_mecanica_default]), '-1'),
    cod_limite_rc: normalizeInteger(pick([cfg?.parametros_extras?.cod_limite_rc_default]), '0'),
    pje_buenrdo: normalizeInteger(pick([cfg?.parametros_extras?.pje_buenrdo_default]), '0'),
    sTipo_veh: normalizeInteger(resolveSmgVehicleType({ fila, cabecera, cfg }), '1'),
    codPtoVenta: normalizeInteger(pick([cfg?.cod_pto_venta, cfg?.parametros_extras?.cod_pto_venta_default]), '1'),
  };

  const tags = [
    'nCodCobertura',
    'nCodMarca',
    'nCodModelo',
    'nCodAutoInfoAuto',
    'nAnio',
    'nSumaAsegurada',
    'nCodClausulaAjuste',
    'nCodUsoVeh',
    'nCodPostal',
    'nCodProvincia',
    'n0km',
    'nMontoGNC',
    'nMontoAireAcond',
    'nMontoLlantas',
    'nMontoAntenaEspecial',
    'nMontoOtrosAcc',
    'nCodLocalizador',
    'nAjustePrima',
    'nGranizo',
    'nCodPeriodo',
    'nCantCuotas',
    'cod_agente',
    'cod_tipo_poliza',
    'AsistMecanica',
    'cod_limite_rc',
  ].map((name) => `      <${name}>${escapeXml(params[name])}</${name}>`);

  if (method === 'Cotizar_Autos_fp') {
    tags.push(`      <password>${escapeXml(cfg.password)}</password>`);
  }
  tags.push(`      <pje_buenrdo>${escapeXml(params.pje_buenrdo)}</pje_buenrdo>`);
  if (method === 'Cotizar_Autos_fp') {
    tags.push(`      <sTipo_veh>${escapeXml(params.sTipo_veh)}</sTipo_veh>`);
  }
  tags.push(`      <codPtoVenta>${escapeXml(params.codPtoVenta)}</codPtoVenta>`);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="http://tempuri.org/">
${tags.join('\n')}
    </${method}>
  </soap:Body>
</soap:Envelope>`.trim();

  return {
    envelope,
    requestMeta: {
      ...params,
      method,
      sumaAseguradaFuente: String(sumaAseguradaOverride ?? '').trim() ? 'smg_lookup' : 'input',
      passwordConfigurada: Boolean(String(cfg?.password || '').trim()),
      rastreoSistema: tracking.system,
      rastreoSistemaEfectivo: tracking.effectiveSystem,
      rastreoDefaultAplicado: tracking.defaultApplied,
    },
  };
}

function parseSmgQuoteResponse(xml, method = 'Cotizar_Autos_fp') {
  const raw = String(xml || '');
  const parsed = parser.parse(raw);
  const body = parsed?.Envelope?.Body || {};
  const fault = body?.Fault;
  if (fault) {
    return {
      ok: false,
      error: asText(fault?.faultstring || fault?.Reason?.Text || 'SOAP Fault SMG'),
      coberturas: [],
      raw,
    };
  }

  const response =
    body?.[`${method}Response`] ||
    body?.Cotizar_Autos_fpResponse ||
    body?.Cotizar_AutosResponse ||
    {};
  const result =
    response?.[`${method}Result`] ||
    response?.Cotizar_Autos_fpResult ||
    response?.Cotizar_AutosResult ||
    {};
  const errorResultado = asText(result?.ErrorResultado).trim();
  const rows = asArray(result?.ResultadoLista?.Cotizacion).map((item) => ({
    idCotizacion: asText(item?.IdCotizacion),
    codigoDeCobertura: asText(item?.CodCobertura),
    descripcionDeCobertura: asText(item?.DescCobertura),
    importePrima: asText(item?.Prima),
    importePremio: asText(item?.Premio),
    importeCuota: asText(item?.Cuota),
    urlCotizacion: asText(item?.UrlCotizacion),
  }));

  if (errorResultado) {
    return {
      ok: false,
      error: errorResultado,
      operacion: rows[0]?.idCotizacion || '0',
      coberturas: rows,
      raw,
    };
  }

  return {
    ok: rows.length > 0,
    operacion: rows[0]?.idCotizacion || '0',
    coberturas: rows,
    error: rows.length > 0 ? '' : 'SMG no devolvio cotizaciones',
    raw,
  };
}

function redactSmgEnvelope(envelope) {
  return String(envelope || '').replace(/<password>[\s\S]*?<\/password>/i, '<password>[redacted]</password>');
}

module.exports = {
  buildSmgEnvelope,
  buildSmgSumLookupEnvelope,
  parseSmgSumLookupResponse,
  parseSmgQuoteResponse,
  redactSmgEnvelope,
  resolveSmgAnio,
  resolveSmgInfoAuto,
  resolveSmgProvinceCode,
  resolveSmgUseCode,
};

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { resolveSumaAsegurada } = require('../../utils/atm_infoauto');

const MAPFRE_CP_PATH = path.join(__dirname, '..', '..', '..', 'data', 'mapfre', 'diccionarios', 'codigos_postales.json');
let postalCatalogCache = null;

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

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function getMapfrePostalCatalog(postalCatalog) {
  if (Array.isArray(postalCatalog)) {
    return postalCatalog.map((item) => ({
      ...item,
      _cp: String(item.codigo_postal || '').trim(),
      _mapfre: String(item.codigo_mapfre || '').trim(),
      _loc: normalizeText(item.descripcion || ''),
      _prov: normalizeText(item.provincia || ''),
    }));
  }
  if (postalCatalogCache) return postalCatalogCache;
  try {
    const raw = JSON.parse(fs.readFileSync(MAPFRE_CP_PATH, 'utf8'));
    postalCatalogCache = Array.isArray(raw)
      ? raw.map((item) => ({
          ...item,
          _cp: String(item.codigo_postal || '').trim(),
          _mapfre: String(item.codigo_mapfre || '').trim(),
          _loc: normalizeText(item.descripcion || ''),
          _prov: normalizeText(item.provincia || ''),
        }))
      : [];
  } catch {
    postalCatalogCache = [];
  }
  return postalCatalogCache;
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const curr = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function pickMapfrePostalEntry(candidates, localidadNorm) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return { ...candidates[0], matchType: 'cp_unico' };
  if (!localidadNorm) return null;

  const exact = candidates.find((item) => item._loc === localidadNorm);
  if (exact) return { ...exact, matchType: 'exacto' };

  const contains = candidates.find((item) => item._loc.includes(localidadNorm) || localidadNorm.includes(item._loc));
  if (contains) return { ...contains, matchType: 'contiene' };

  let best = null;
  let bestScore = 0;
  for (const item of candidates) {
    const maxLen = Math.max(localidadNorm.length, item._loc.length) || 1;
    const score = 1 - (levenshteinDistance(localidadNorm, item._loc) / maxLen);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.72) return { ...best, matchType: 'fuzzy' };
  return null;
}

function normalizeDate(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (/^\d{8}$/.test(digits)) {
    if (Number(digits.slice(0, 4)) > 1900) {
      return `${digits.slice(6, 8)}${digits.slice(4, 6)}${digits.slice(0, 4)}`;
    }
    return digits;
  }
  return '';
}

function toMoneyString(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num.toFixed(2) : '';
}

function resolveMapfreTipoMedioPago(cabecera = {}, cfg = {}) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
      cabecera?.medioPago ??
      cabecera?.forma_pago ??
      cabecera?.formaPago ??
      ''
  );

  if (['TC', 'TARJETA', 'TARJETA DE CREDITO', 'TARJETA DE CREDITO', 'CREDITO', '2', 'DEBITO_TARJETA', 'DEBITO EN TARJETA'].includes(raw)) {
    return 'TC';
  }
  if (['CBU', 'DC', 'DEBITO EN CUENTA', 'DEBITO CUENTA', '4'].includes(raw)) {
    return 'DC';
  }
  if (
    ['EFECTIVO', 'EFVO', 'AG', '1', 'PAGO FACIL', 'PAGO FACIL', 'RAPIPAGO', 'COBRO EXPRESS', 'OTRA'].includes(raw)
  ) {
    return 'AG';
  }

  return cfg?.parametros_extras?.tipo_medio_pago_default || 'TC';
}

function describeMapfreTipoMedioPago(code) {
  const raw = String(code || '').trim().toUpperCase();
  if (raw === 'TC') return 'Tarjeta de crédito';
  if (raw === 'DC') return 'CBU';
  if (raw === 'AG') return 'Efectivo';
  if (raw === 'PR') return 'Productor';
  return raw;
}

function resolveMapfreCondicionIva(cabecera = {}, cfg = {}) {
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
  return map[raw] || cfg?.parametros_extras?.condicion_iva_default || '5';
}

function resolveMapfreTipoPersona(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.tipopersona);
  if (raw === 'J') return 'J';
  return cfg?.parametros_extras?.tipo_persona_default || 'F';
}

function resolveMapfrePostalMatch(row = {}, cabecera = {}, options = {}) {
  const catalog = getMapfrePostalCatalog(options.postalCatalog);
  const raw = pick([
    row?.codigo_postal,
    row?.codpostal,
    row?.CP,
    row?.cp,
    row?.CodigoPostal,
    cabecera?.cp,
  ]);
  const digits = raw.replace(/\D+/g, '');
  const localidadNorm = normalizeText(
    pick([
      row?.localidad,
      row?.Localidad,
      row?.nom_localidad,
      row?.desc_localidad,
      row?.ciudad,
      row?.Ciudad,
      cabecera?.localidad,
    ])
  );
  const provinciaNorm = normalizeText(
    pick([
      row?.provincia,
      row?.Provincia,
      row?.nom_prov,
      row?.desc_provincia,
      cabecera?.provincia,
    ])
  );

  if (/^\d{7}$/.test(digits)) {
    const direct = catalog.find((item) => item._mapfre === digits);
    if (direct) return { ...direct, matchType: 'mapfre_directo' };
    return {
      codigo_mapfre: digits,
      codigo_provincia: '',
      descripcion: '',
      provincia: '',
      matchType: 'mapfre_directo',
    };
  }

  if (/^\d{4}$/.test(digits)) {
    const subCpRaw = pick([row?.sub_cp, row?.subcodpos, cabecera?.sub_cp, cabecera?.subcp]);
    const subCpDigits = subCpRaw.replace(/\D+/g, '');
    const withSub = subCpDigits ? `${digits}${subCpDigits.padStart(3, '0').slice(-3)}` : '';
    if (withSub) {
      const exactMapfre = catalog.find((item) => item._mapfre === withSub);
      if (exactMapfre) return { ...exactMapfre, matchType: 'sub_cp_exacto' };
    }

    let candidates = catalog.filter((item) => item._cp === digits);
    if (provinciaNorm) {
      const byProvince = candidates.filter((item) => item._prov === provinciaNorm);
      if (byProvince.length) candidates = byProvince;
    }

    const chosen = pickMapfrePostalEntry(candidates, localidadNorm);
    if (chosen) return chosen;

    if (withSub) {
      return {
        codigo_mapfre: withSub,
        codigo_provincia: '',
        descripcion: '',
        provincia: '',
        matchType: 'sub_cp_construido',
      };
    }
  }
  return null;
}

function resolveMapfreCodPostal(row = {}, cabecera = {}, options = {}) {
  return String(resolveMapfrePostalMatch(row, cabecera, options)?.codigo_mapfre || '').trim();
}

function resolveMapfreCodProv(row = {}, cabecera = {}, cfg = {}, options = {}) {
  const postalMatch = resolveMapfrePostalMatch(row, cabecera, options);
  const fromMatch = String(postalMatch?.codigo_provincia || '').replace(/\D+/g, '');
  if (fromMatch) return fromMatch;
  const raw = pick([row?.codProv, row?.cod_prov, row?.provincia_codigo, cabecera?.cod_prov, cabecera?.provincia]);
  const digits = raw.replace(/\D+/g, '');
  if (digits) return digits;
  return cfg?.parametros_extras?.cod_prov_default || '0';
}

function resolveMapfreUsoCodigo({ mapeos = {}, fila = {}, cabecera = {}, cfg = {} }) {
  const mapped = String(mapeos?.uso_codigo || '').trim();
  if (mapped) return mapped;

  const raw = normalizeText(fila?.uso || cabecera?.uso_default || cabecera?.uso || '');
  if (raw.includes('COMER')) return '7';
  if (raw.includes('TAXI')) return '7';
  if (raw.includes('PART')) return '1';
  return cfg?.parametros_extras?.uso_default || '1';
}

async function resolveMapfreValorVeh({ fila = {}, cabecera = {} }) {
  const direct = toMoneyString(
    pick([
      fila?.valorVeh,
      fila?.valor_veh,
      fila?.valorveh,
      fila?.suma,
      fila?.suma_asegurada,
      cabecera?.suma,
    ])
  );
  if (direct) return direct;

  const fallback = await resolveSumaAsegurada({ row: fila });
  const fallbackMoney = toMoneyString(fallback);
  return fallbackMoney || '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  if (value == null) return '';
  return String(value);
}

function buildOptionalTag(name, value) {
  if (value == null || String(value).trim() === '') return `    <${name}/>`;
  return `    <${name}>${escapeXml(value)}</${name}>`;
}

async function buildMapfreEnvelope({ fila = {}, cabecera = {}, hoyFmt, cfg = {}, mapeos = {}, postalCatalog } = {}) {
  const codInfoauto = pick([
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
  const postalMatch = resolveMapfrePostalMatch(fila, cabecera, { postalCatalog });
  const codPostal = String(postalMatch?.codigo_mapfre || '').trim();
  const valorVeh = await resolveMapfreValorVeh({ fila, cabecera });

  if (!codInfoauto) throw new Error('Mapfre requiere codInfoauto');
  if (!anio) throw new Error('Mapfre requiere año del vehículo');
  if (!codPostal) throw new Error('Mapfre requiere código postal');
  if (!valorVeh) throw new Error('Mapfre requiere valorVeh o suma asegurada resoluble');

  const fechaNac = normalizeDate(cabecera?.fec_nac);
  if (!fechaNac) throw new Error('Mapfre requiere fecha de nacimiento en cabecera (fec_nac)');

  const numDoc = String(cabecera?.nrodoc || '').replace(/\D+/g, '');
  const tipoDoc = String(cabecera?.tipodoc || '').trim();
  const tipoMedioPago = resolveMapfreTipoMedioPago(cabecera, cfg);
  const usoVehiculo = resolveMapfreUsoCodigo({ mapeos, fila, cabecera, cfg });
  const conGnc = cabecera?.gnc === '1' ? '1' : '0';
  const valorGnc = conGnc === '1' ? toMoneyString(cabecera?.suma_gnc || fila?.suma_gnc || 0) || '0' : '0';
  const conLocalizador = cabecera?.rastreo === '1' ? '1' : '0';
  const guardaGGe = String(cfg?.parametros_extras?.guarda_gge_default || '0');
  const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <cotizarRequest xmlns="http://ws.mapfre.com.ar/SuscripcionAutos">
      <inicioVigencia>${escapeXml(hoyFmt)}</inicioVigencia>
      <finVigencia/>
      <usoVehiculo>${escapeXml(usoVehiculo)}</usoVehiculo>
      <codInfoauto>${escapeXml(codInfoauto)}</codInfoauto>
      <anio>${escapeXml(anio)}</anio>
      <ceroKm>${cabecera?.cerokm === '1' ? '1' : '0'}</ceroKm>
      <valorVeh>${escapeXml(valorVeh)}</valorVeh>
      <conGNC>${conGnc}</conGNC>
      <valorGNC>${escapeXml(valorGnc)}</valorGNC>
      <conLocalizador>${conLocalizador}</conLocalizador>
      <guardaGGe>${escapeXml(guardaGGe)}</guardaGGe>
      <codPostal>${escapeXml(codPostal)}</codPostal>
      <codProv>${escapeXml(resolveMapfreCodProv(fila, cabecera, cfg, { postalCatalog }))}</codProv>
      <tipoPersona>${escapeXml(resolveMapfreTipoPersona(cabecera, cfg))}</tipoPersona>
${tipoDoc && numDoc ? `      <tipoDoc>${escapeXml(tipoDoc)}</tipoDoc>` : `      <tipoDoc xsi:nil="true"/>`}
${tipoDoc && numDoc ? `      <numDoc>${escapeXml(numDoc)}</numDoc>` : `      <numDoc xsi:nil="true"/>`}
      <condicionIva>${escapeXml(resolveMapfreCondicionIva(cabecera, cfg))}</condicionIva>
      <sexoAseg>${escapeXml((cabecera?.sexo || 'M').toString().trim() || 'M')}</sexoAseg>
      <fechNac>${escapeXml(fechaNac)}</fechNac>
      <moneda>${escapeXml(cfg?.parametros_extras?.moneda || '1')}</moneda>
      <tipoMedioPago>${escapeXml(tipoMedioPago)}</tipoMedioPago>
      <cobertura>${escapeXml(cfg?.parametros_extras?.cobertura_default || '0')}</cobertura>
${buildOptionalTag('porcentajeAjuste', cfg?.parametros_extras?.porcentaje_ajuste_default)}
      <productoresCotizacion>
        <productor>
          <credencial>
            <codAgt>${escapeXml(cfg?.codAgt || '')}</codAgt>
            <claveAcceso>${escapeXml(cfg?.claveAcceso || '')}</claveAcceso>
            <claveProcedencia>${escapeXml(cfg?.claveProcedencia || '')}</claveProcedencia>
          </credencial>
          <numPolizaGrupo xsi:nil="true"/>
          <numContrato xsi:nil="true"/>
          <tipoFacturacion>${escapeXml(cfg?.tipoFacturacion || 'M')}</tipoFacturacion>
        </productor>
      </productoresCotizacion>
    </cotizarRequest>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

  return {
    envelope: requestXml,
    requestMeta: {
      codInfoauto,
      anio,
      codPostal,
      valorVeh,
      usoVehiculo,
      tipoMedioPago,
      codProv: resolveMapfreCodProv(fila, cabecera, cfg, { postalCatalog }),
      codPostalMatch: postalMatch?.matchType || '',
      codPostalLocalidad: String(postalMatch?.descripcion || '').trim(),
      codPostalProvincia: String(postalMatch?.provincia || '').trim(),
      conGNC: conGnc,
      conLocalizador,
    },
  };
}

function parseMapfreResponse(rawResp) {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });
  const parsed = parser.parse(String(rawResp || ''));
  const body = parsed?.Envelope?.Body || parsed?.['soapenv:Envelope']?.['soapenv:Body'];
  const response = body?.cotizarResponse;
  if (!response) {
    return { ok: false, error: 'Respuesta Mapfre inválida', coberturas: [], raw: rawResp };
  }

  const rootErrors = asArray(response?.errores?.error);
  const rootError = rootErrors.find((err) => String(err?.codigo || '').trim() && String(err?.codigo || '').trim() !== '0');
  if (rootError) {
    return {
      ok: false,
      error: String(rootError?.descripcion || `Error Mapfre ${rootError?.codigo}`),
      coberturas: [],
      raw: rawResp,
    };
  }

  const productor = response?.productoresCotizacionResultado?.productorCotizacionResultado;
  if (!productor) {
    return { ok: false, error: 'Mapfre no devolvió productorCotizacionResultado', coberturas: [], raw: rawResp };
  }

  const prodError = productor?.error;
  if (prodError && String(prodError?.codigo || '0') !== '0') {
    return {
      ok: false,
      error: String(prodError?.descripcion || `Error Mapfre ${prodError?.codigo}`),
      coberturas: [],
      raw: rawResp,
    };
  }

  const coberturas = asArray(productor?.cotizacionesResultado?.CotizacionResultado).map((item) => ({
    numCotizacion: asText(item?.numCotizacion),
    cobertura: asText(item?.cobertura),
    nombreProducto: asText(item?.nombreProducto),
    codigoModalidad: asText(item?.codigoModalidad),
    nombreFranquicia: asText(item?.nombreFranquicia),
    montoPremio: asText(item?.montoPremio),
    montoPrimaTotal: asText(item?.montoPrimaTotal),
    montoPrimaComi: asText(item?.montoPrimaComi),
    importePrimaNoComi: asText(item?.importePrimaNoComi),
    montoFranquicia: asText(item?.montoFranquicia),
    montoPrimeraCuota: asText(item?.montoPrimeraCuota),
    montoRestoCuotas: asText(item?.montoRestoCuotas),
    cantidadCuotas: asText(item?.cantidadCuotas),
    montoBonif: asText(item?.montoBonif),
    montoIVA: asText(item?.montoIVA),
    inspeccionable: asText(item?.inspeccionable),
    periodoFact: asText(item?.periodoFact),
    sumaAsegurada: asText(item?.sumaAsegurada),
    sumaGNC: asText(item?.sumaGNC),
    codError: asText(item?.codError),
  }));

  const withError = coberturas.find((item) => String(item.codError || '0') !== '0');
  if (withError) {
    return {
      ok: false,
      error: `Mapfre devolvió codError=${withError.codError} para ${withError.numCotizacion || withError.codigoModalidad || 'una cobertura'}`,
      operacion: productor?.numPropuesta || '',
      coberturas,
      raw: rawResp,
    };
  }

  return {
    ok: true,
    operacion: asText(productor?.numPropuesta || coberturas[0]?.numCotizacion || ''),
    suma_asegurada: asText(coberturas[0]?.sumaAsegurada || ''),
    coberturas,
    raw: rawResp,
  };
}

module.exports = {
  buildMapfreEnvelope,
  describeMapfreTipoMedioPago,
  parseMapfreResponse,
  resolveMapfreCodPostal,
  resolveMapfrePostalMatch,
  resolveMapfreTipoMedioPago,
};

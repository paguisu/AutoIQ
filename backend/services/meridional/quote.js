const fs = require('fs');
const path = require('path');
const { isVehicleZeroKm } = require('../../utils/zero_km');

const LOCALIDADES_PATH = path.join(process.cwd(), 'data', 'meridional', 'diccionarios', 'localidades.json');
let localityCatalogCache = null;

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
  if (value == null) return '';
  if (typeof value === 'object') {
    return String(value['#text'] || value.text || value.Description || value.Message || '').trim();
  }
  return String(value);
}

function asNumberOrString(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const num = Number(raw.replace(',', '.'));
  return Number.isFinite(num) ? num : raw;
}

function onlyDigits(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function resolveMeridionalGncAccessories({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  if (String(cabecera?.gnc || fila?.gnc || '').trim() !== '1') return [];
  const amount = onlyDigits(pick([
    fila?.suma_gnc,
    fila?.sumaGnc,
    fila?.valor_gnc,
    fila?.valorGnc,
    cabecera?.suma_gnc,
    cabecera?.sumaGnc,
    cabecera?.valor_gnc,
    cabecera?.valorGnc,
  ]));
  if (!amount) return [];
  const extra = cfg?.parametros_extras || {};
  return [{
    IdAccesorio: asNumberOrString(extra.id_accesorio_gnc || extra.id_accesorio_gnc_default || '13'),
    SumaAseguradaAccesorio: asNumberOrString(amount),
  }];
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

function sanitizePersonName(value, fallback) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function loadMeridionalLocalityCatalog(customCatalog) {
  const source = Array.isArray(customCatalog)
    ? customCatalog
    : (() => {
        if (localityCatalogCache) return localityCatalogCache;
        const raw = JSON.parse(fs.readFileSync(LOCALIDADES_PATH, 'utf8'));
        localityCatalogCache = Array.isArray(raw) ? raw : [];
        return localityCatalogCache;
      })();

  return source.map((item) => ({
    ...item,
    idLocalidad: String(item.idLocalidad || '').trim(),
    idProvincia: String(item.idProvincia || '').trim(),
    descripcion: String(item.descripcion || '').trim(),
    provincia: String(item.provincia || '').trim(),
    codPostales: Array.isArray(item.codPostales)
      ? item.codPostales.map((cp) => String(cp || '').replace(/\D+/g, '').padStart(4, '0')).filter(Boolean)
      : [],
    _loc: normalizeText(item.descripcion || ''),
    _prov: normalizeText(item.provincia || ''),
  }));
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_v, i) => i);
  const curr = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function pickLocalityEntry(candidates, localidadNorm) {
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
  if (best && bestScore >= 0.82) return { ...best, matchType: 'fuzzy' };
  return null;
}

function isCabaProvince(value) {
  const norm = normalizeText(value);
  return norm === 'CAPITAL FEDERAL'
    || norm === 'CABA'
    || norm === 'CIUDAD AUTONOMA DE BUENOS AIRES'
    || norm === 'CIUDAD AUTONOMA BS AS'
    || norm === 'CAP FEDERAL';
}

function isGenericCabaLocality(value) {
  const norm = normalizeText(value);
  return !norm
    || norm === 'CAPITAL FEDERAL'
    || norm === 'CABA'
    || norm === 'CIUDAD AUTONOMA DE BUENOS AIRES'
    || norm === 'CIUDAD AUTONOMA BS AS'
    || norm === 'CAP FEDERAL';
}

function resolveMeridionalLocalidad(row = {}, cabecera = {}, options = {}) {
  const catalog = loadMeridionalLocalityCatalog(options.localityCatalog);
  const cp = pick([row?.codigo_postal, row?.codpostal, row?.CP, row?.cp, row?.CodigoPostal, cabecera?.cp])
    .replace(/\D+/g, '')
    .slice(0, 4);
  const localidadNorm = normalizeText(pick([
    row?.localidad,
    row?.Localidad,
    row?.ciudad,
    row?.Ciudad,
    cabecera?.localidad,
  ]));
  const provinciaNorm = normalizeText(pick([
    row?.provincia,
    row?.Provincia,
    cabecera?.provincia,
  ]));

  let candidates = cp ? catalog.filter((item) => item.codPostales.includes(cp)) : [];
  if (provinciaNorm) {
    const byProvince = candidates.filter((item) => (
      isCabaProvince(provinciaNorm)
        ? item._prov === 'CAPITAL FEDERAL'
        : item._prov === provinciaNorm
    ));
    if (byProvince.length) candidates = byProvince;
  }
  const chosen = pickLocalityEntry(candidates, localidadNorm);
  if (chosen) return { ...chosen, codPostal: cp };
  if (
    cp
    && candidates.length > 1
    && candidates.every((item) => item._prov === 'CAPITAL FEDERAL')
    && (!provinciaNorm || isCabaProvince(provinciaNorm))
    && isGenericCabaLocality(localidadNorm)
  ) {
    return { ...candidates[0], codPostal: cp, matchType: 'cp_ambiguo_caba_fallback' };
  }
  return null;
}

function resolveMeridionalUse({ fila = {}, cabecera = {}, cfg = {}, mapeos = {} }) {
  const mapped = String(mapeos?.uso_codigo || '').trim();
  if (mapped) return mapped;
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso, cabecera?.uso, cabecera?.uso_default]));
  const extra = cfg?.parametros_extras || {};
  if (raw.includes('PELIGRO')) return String(extra.id_uso_carga_peligrosa || '4');
  if (raw.includes('CARGA')) return String(extra.id_uso_comercial_carga_general || '28');
  if (raw.includes('COMER') || raw.includes('TAXI') || raw.includes('REMIS')) return String(extra.id_uso_comercial || '2');
  return String(extra.id_uso_particular || '1');
}

function resolveMeridionalGender(cabecera = {}) {
  const raw = normalizeText(cabecera?.sexo);
  if (raw === 'F' || raw.includes('FEM') || raw.includes('MUJ')) return 'F';
  return 'M';
}

function resolveMeridionalDocumentType(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.tipodoc);
  const map = {
    DNI: '96',
    CUIT: '80',
    CUIL: '99',
    LE: '89',
    LC: '90',
    PAS: '94',
    PASAPORTE: '94',
    CI: '0',
  };
  return map[raw] || String(cfg?.parametros_extras?.tipo_documento_default || '96');
}

function resolveMeridionalIva(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: '04',
    'CONSUMIDOR FINAL': '04',
    RI: '01',
    'RESPONSABLE INSCRIPTO': '01',
    EX: '06',
    EXENTO: '06',
    MT: '09',
    MONOTRIBUTO: '09',
    MONOTRIBUTISTA: '09',
  };
  return map[raw] || String(cfg?.parametros_extras?.condicion_iva_default || '04');
}

function resolveMeridionalEstadoCivil(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.est_civil || cabecera?.estado_civil);
  if (raw.includes('CASAD')) return '1';
  if (raw.includes('DIVOR') || raw.includes('SEPAR')) return '4';
  if (raw.includes('VIUD')) return '5';
  return String(cfg?.parametros_extras?.estado_civil_default || '2');
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, '');
  if (/^\d{8}$/.test(digits)) {
    if (Number(digits.slice(0, 4)) > 1900) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  return '';
}

function buildMeridionalPayload({ fila = {}, cabecera = {}, cfg = {}, mapeos = {}, localityCatalog } = {}) {
  const extra = cfg?.parametros_extras || {};
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
  const localidad = resolveMeridionalLocalidad(fila, cabecera, { localityCatalog });

  if (!codInfoauto) throw new Error('Meridional requiere código InfoAuto');
  if (!anio) throw new Error('Meridional requiere año del vehículo');
  if (!localidad?.idLocalidad || !localidad?.idProvincia) {
    throw new Error('Meridional requiere una localidad traducible por catálogo (CP, localidad y provincia)');
  }

  const fechaNacimiento = normalizeBirthDate(cabecera?.fec_nac);
  const codPostal = localidad.codPostal;
  const idMedioPago = String(extra.id_medio_pago_default || '2');
  const cantidadCuotas = String(extra.cantidad_cuotas_default || '4');
  const idPeriodo = String(extra.id_periodo_default || '4');
  const idClausulaAjuste = String(extra.id_clausula_ajuste_default || '5');
  const porcComision = String(cfg?.porcentaje_comision || extra.porcentaje_comision_default || '18');
  const codProductor = String(cfg?.producer_code || '');
  const codOrganizador = String(cfg?.organizer_code || cfg?.producer_code || '');
  const idUsoVehiculo = resolveMeridionalUse({ fila, cabecera, cfg, mapeos });
  const sumaAsegurada = pick([fila?.suma_asegurada, fila?.suma, fila?.valor_vehiculo, fila?.valorVehiculo]) || '0';
  const accesorios = resolveMeridionalGncAccessories({ fila, cabecera, cfg });
  const apellidoRazonSocial = sanitizePersonName(pick([
    cabecera?.apellido,
    cabecera?.razon_social,
    cabecera?.razonSocial,
    fila?.apellido,
    fila?.razon_social,
    fila?.razonSocial,
  ]), 'AUTOIQ');
  const nombreAsegurado = sanitizePersonName(pick([
    cabecera?.nombre_aseg,
    cabecera?.nombre_asegurado,
    cabecera?.nombres,
    fila?.nombre,
    fila?.nombres,
  ]), 'ASEGURADO');

  const payload = {
    CodProductor: codProductor,
    CodSubproductor: String(cfg?.cod_subproductor || ''),
    CodOrganizador: codOrganizador,
    PorcComision: asNumberOrString(porcComision),
    PorcComisionSubproductor: asNumberOrString(extra.porcentaje_comision_subproductor_default || '0'),
    PorcOrganizador: asNumberOrString(extra.porcentaje_organizador_default || '0'),
    Asegurado: {
      ApellidoRazonSocial: apellidoRazonSocial,
      Nombre: nombreAsegurado,
      TipoDocumento: resolveMeridionalDocumentType(cabecera, cfg),
      NroDocumento: String(cabecera?.nrodoc || cabecera?.documento || '').replace(/\D+/g, ''),
      CondicionIVA: resolveMeridionalIva(cabecera, cfg),
      CondicionIB: String(extra.condicion_iibb_default || '6'),
      FechaNacimiento: fechaNacimiento,
      Sexo: resolveMeridionalGender(cabecera),
      IdEstadoCivil: asNumberOrString(resolveMeridionalEstadoCivil(cabecera, cfg)),
      IdOcupacion: asNumberOrString(extra.id_ocupacion_default || '4'),
      EMail: String(cabecera?.email || cabecera?.mail || ''),
      IdTipoPersona: asNumberOrString(extra.id_tipo_persona_default || '1'),
      IdProvincia: asNumberOrString(localidad.idProvincia),
      IdLocalidad: asNumberOrString(localidad.idLocalidad),
      CodPostal: asNumberOrString(codPostal),
    },
    Tomador: {},
    TipoSeguro: String(extra.tipo_seguro_default || 'N'),
    IdClausulaAjuste: asNumberOrString(idClausulaAjuste),
    IdPeriodo: asNumberOrString(idPeriodo),
    IdTipoMovimiento: asNumberOrString(extra.id_tipo_movimiento_default || '1'),
    IdMedioPago: asNumberOrString(idMedioPago),
    CantidadCuotas: asNumberOrString(cantidadCuotas),
    UNeg: {
      IdUNeg: asNumberOrString(extra.id_uneg_default || '2'),
      Subproducto: String(extra.subproducto_default || '0201001'),
    },
    Vehiculos: [{
      CodInfoauto: asNumberOrString(codInfoauto),
      AnnoVehiculo: asNumberOrString(anio),
      Es0Km: isVehicleZeroKm(fila),
      SumaAsegurada: asNumberOrString(sumaAsegurada),
      IdUsoVehiculo: asNumberOrString(idUsoVehiculo),
      IdRastreador: asNumberOrString(extra.id_rastreador_default || '1'),
      Patente: String(fila?.patente || ''),
      Ubicacion: {
        IdProvincia: asNumberOrString(localidad.idProvincia),
        IdLocalidad: asNumberOrString(localidad.idLocalidad),
        CodPostal: asNumberOrString(codPostal),
        IdLocalidadRadicacion: 0,
        IdProvinciaRadicacion: 0,
        CodPostalRadicacion: 0,
      },
      Accesorios: accesorios,
    }],
  };

  return {
    payload,
    requestMeta: {
      codInfoauto,
      anio,
      codPostal,
      idLocalidad: localidad.idLocalidad,
      localidad: localidad.descripcion,
      idProvincia: localidad.idProvincia,
      provincia: localidad.provincia,
      localidadMatch: localidad.matchType,
      codProductor,
      codOrganizador,
      idMedioPago,
      medioPagoDescripcion: extra.medio_pago_descripcion_default || 'TARJETA DE CREDITO',
      cantidadCuotas,
      idPeriodo,
      idClausulaAjuste,
      clausulaAjuste: cfg?.clausula_ajuste || '50',
      porcentajeComision: porcComision,
      idRastreador: String(extra.id_rastreador_default || '1'),
      idUsoVehiculo,
      subproducto: String(extra.subproducto_default || '0201001'),
      tipoSeguro: String(extra.tipo_seguro_default || 'N'),
    },
  };
}

function parseMeridionalQuoteResponse(raw) {
  let response = raw;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/^\uFEFF/, '').trim();
    try {
      response = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'Respuesta Meridional JSON inválida', coberturas: [], raw };
    }
  }

  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Respuesta Meridional inválida', coberturas: [], raw };
  }

  const error = asText(response.desc || response.message || response.Message || response.Error || response.MensajeError);
  const code = asText(response.code || response.Code);
  if (error || (code && code !== '0')) {
    return {
      ok: false,
      error: error || `Meridional code=${code}`,
      operacion: asText(response.IdCotizacion || ''),
      coberturas: [],
      raw,
    };
  }

  const items = asArray(response.Items);
  const coberturas = [];
  for (const item of items) {
    for (const cobertura of asArray(item?.Coberturas)) {
      coberturas.push({
        codigoDeCobertura: asText(cobertura?.CodCobertura),
        descripcionDeCobertura: asText(cobertura?.Descripcion),
        descripcionDeProducto: asText(cobertura?.Detalle || cobertura?.DetalleCobertura),
        codigoDeProducto: asText(response.Subproducto),
        plan: asText(cobertura?.Descripcion),
        cantidadCuotas: asText(cobertura?.CanCuotas),
        importeCuota: asText(cobertura?.Cuota),
        importePrima: asText(cobertura?.PrimaTotal),
        importePremio: asText(cobertura?.PremioTotal),
        importeIVA: asText(cobertura?.IVA),
        importeTotalImpuestos: asText(cobertura?.OtrosImpuestos),
        importeRecargoFinanciero: asText(cobertura?.RecargoFinanciero),
        porcentajeRecargoFinanciero: asText(cobertura?.PorcRecargoFinanciero),
        sumaAsegurada: asText(cobertura?.SumaAseguradaVehiculo),
        sumaAseguradaAccesorios: asText(cobertura?.SumaAseguradaAccesorios),
        franquicia: asText(cobertura?.Franquicia),
        requiereInspeccion: asText(cobertura?.EsCoberturaExcepcion),
        valorComisionPAS: asText(cobertura?.ComisionProd),
        porcentajeComisionPAS: asText(cobertura?.PorcComision),
        porcentajeAjuste: asText(cobertura?.PorcentajeAjuste),
        idSubgrupo: asText(cobertura?.IdSubgrupo),
        montoRC: asText(cobertura?.MontoRC),
        primaRC: asText(cobertura?.PrimaRC),
        primaCasco: asText(cobertura?.PrimaCasco),
        primaAjuste: asText(cobertura?.PrimaAjuste),
        diasCubiertos: asText(cobertura?.DiasCubiertos),
        formapago: '',
        formapago_descripcion: '',
      });
    }
  }

  if (!coberturas.length) {
    return {
      ok: false,
      error: 'Meridional no devolvió coberturas',
      operacion: asText(response.IdCotizacion || response.Excepcion?.IdCotizacion || ''),
      coberturas: [],
      raw,
    };
  }

  return {
    ok: true,
    operacion: asText(response.IdCotizacion || response.Excepcion?.IdCotizacion || ''),
    suma_asegurada: asText(coberturas[0]?.sumaAsegurada),
    coberturas,
    raw,
  };
}

module.exports = {
  buildMeridionalPayload,
  loadMeridionalLocalityCatalog,
  parseMeridionalQuoteResponse,
  resolveMeridionalLocalidad,
  resolveMeridionalUse,
};

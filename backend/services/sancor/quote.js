const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const { isVehicleZeroKm } = require('../../utils/zero_km');

let localityCatalogCache = null;
let localityAliasCache = null;
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });
const LOCALIDADES_XLSX_PATH = path.join(process.cwd(), 'web_services', 'Sancor', 'Localidades.xlsx');
const LOCALIDAD_ALIASES_JSON_PATH = path.join(process.cwd(), 'data', 'sancor', 'diccionarios', 'localidad_aliases.json');

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

function normalizeSancorInfoautoCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return raw;
  return digits.padStart(7, '0');
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

function addYearsIso(dateLike, years) {
  const dt = new Date(dateLike instanceof Date ? dateLike : new Date(dateLike));
  dt.setFullYear(dt.getFullYear() + years);
  return dt.toISOString().slice(0, 19);
}

function formatDateTime(dateLike) {
  return new Date(dateLike instanceof Date ? dateLike : new Date(dateLike))
    .toISOString()
    .slice(0, 19);
}

function loadSancorLocalityCatalog(customCatalog) {
  if (Array.isArray(customCatalog)) return customCatalog;
  if (localityCatalogCache) return localityCatalogCache;
  const wb = xlsx.readFile(LOCALIDADES_XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  localityCatalogCache = rows.map((row) => ({
    codPostal: String(row.CodPostal || '').trim(),
    codLocalidad: String(row.CodSancorLocalidad || '').trim(),
    localidad: String(row.Localidad || '').trim(),
    codProvincia: String(row.CodProvincia || '').trim(),
    provincia: String(row.NombreProvincia || '').trim(),
    _loc: normalizeText(row.Localidad || ''),
    _prov: normalizeText(row.NombreProvincia || ''),
  }));
  return localityCatalogCache;
}

function loadSancorLocalityAliases(customAliases) {
  if (Array.isArray(customAliases)) return customAliases;
  if (localityAliasCache) return localityAliasCache;
  try {
    if (!fs.existsSync(LOCALIDAD_ALIASES_JSON_PATH)) {
      localityAliasCache = [];
      return localityAliasCache;
    }
    const raw = JSON.parse(fs.readFileSync(LOCALIDAD_ALIASES_JSON_PATH, 'utf8'));
    localityAliasCache = Array.isArray(raw)
      ? raw.map((item) => ({
          inputCodPostal: String(item?.inputCodPostal || '').trim(),
          inputLocalidad: String(item?.inputLocalidad || '').trim(),
          inputProvincia: String(item?.inputProvincia || '').trim(),
          codPostal: String(item?.codPostal || '').trim(),
          codLocalidad: String(item?.codLocalidad || '').trim(),
          localidad: String(item?.localidad || '').trim(),
          codProvincia: String(item?.codProvincia || '').trim(),
          provincia: String(item?.provincia || '').trim(),
          _inputCp: String(item?.inputCodPostal || '').trim(),
          _inputLoc: normalizeText(item?.inputLocalidad || ''),
          _inputProv: normalizeText(item?.inputProvincia || ''),
          _loc: normalizeText(item?.localidad || ''),
          _prov: normalizeText(item?.provincia || ''),
          matchType: 'alias',
        }))
      : [];
    return localityAliasCache;
  } catch {
    localityAliasCache = [];
    return localityAliasCache;
  }
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

function resolveSancorLocalidad(row = {}, cabecera = {}, options = {}) {
  const catalog = loadSancorLocalityCatalog(options.localityCatalog);
  const aliases = loadSancorLocalityAliases(options.localityAliases);
  const cp = pick([row?.codigo_postal, row?.codpostal, row?.CP, row?.cp, row?.CodigoPostal]).replace(/\D+/g, '').slice(0, 4);
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

  let candidates = cp ? catalog.filter((item) => item.codPostal === cp) : [];
  if (provinciaNorm) {
    const byProvince = candidates.filter((item) => item._prov === provinciaNorm);
    if (byProvince.length) candidates = byProvince;
  }
  const chosen = pickLocalityEntry(candidates, localidadNorm);
  if (chosen) return chosen;

  const alias = aliases.find((item) => {
    if (item._inputLoc && item._inputLoc !== localidadNorm) return false;
    if (item._inputProv && item._inputProv !== provinciaNorm) return false;
    if (item._inputCp && item._inputCp !== cp) return false;
    return true;
  });
  if (alias) {
    return {
      codPostal: alias.codPostal,
      codLocalidad: alias.codLocalidad,
      localidad: alias.localidad,
      codProvincia: alias.codProvincia,
      provincia: alias.provincia,
      _loc: alias._loc,
      _prov: alias._prov,
      matchType: alias.matchType || 'alias',
    };
  }
  return null;
}

function resolveSancorVehicleUse({ fila = {}, cabecera = {}, cfg = {}, mapeos = {} }) {
  const mapped = String(mapeos?.uso_codigo || '').trim();
  if (mapped) return mapped;
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (raw.includes('COMER')) return String(cfg?.parametros_extras?.use_comercial || '4');
  return String(cfg?.parametros_extras?.use_particular || '2');
}

function resolveSancorIvaCondition({ cabecera = {}, cfg = {} }) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: '4',
    'CONSUMIDOR FINAL': '4',
    RI: '1',
    'RESPONSABLE INSCRIPTO': '1',
    EX: '5',
    EXENTO: '5',
    MT: '7',
    MONOTRIBUTO: '7',
  };
  return map[raw] || String(cfg?.parametros_extras?.iva_condition_id_default || '4');
}

function buildDiscountsXml(cfg = {}) {
  const rows = Array.isArray(cfg?.parametros_extras?.discount_customizations)
    ? cfg.parametros_extras.discount_customizations
    : [];
  if (!rows.length) return '<a:DiscountCustomizations />';
  return [
    '<a:DiscountCustomizations>',
    ...rows.map((item) => [
      '  <a:DiscountCustomization>',
      `    <a:DiscountNumber>${escapeXml(item.discountNumber)}</a:DiscountNumber>`,
      `    <a:Rate>${escapeXml(item.rate)}</a:Rate>`,
      '  </a:DiscountCustomization>',
    ].join('\n')),
    '</a:DiscountCustomizations>',
  ].join('\n');
}

function buildScoringXml(cfg = {}) {
  const rows = Array.isArray(cfg?.parametros_extras?.scoring_options)
    ? cfg.parametros_extras.scoring_options
    : [];
  if (!rows.length) return '<a:ScoringOptions />';
  return [
    '<a:ScoringOptions>',
    ...rows.map((item) => [
      '  <a:ScoringOption>',
      `    <a:ScoringTypeId>${escapeXml(item.typeId)}</a:ScoringTypeId>`,
      `    <a:SelectedOptionId>${escapeXml(item.selectedOptionId)}</a:SelectedOptionId>`,
      '  </a:ScoringOption>',
    ].join('\n')),
    '</a:ScoringOptions>',
  ].join('\n');
}

function buildSancorEnvelope({
  fila = {},
  cabecera = {},
  cfg = {},
  mapeos = {},
  today = new Date(),
  localityCatalog,
  localityAliases,
} = {}) {
  const codInfoautoRaw = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
  const codInfoauto = normalizeSancorInfoautoCode(codInfoautoRaw);
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const localidad = resolveSancorLocalidad(fila, cabecera, { localityCatalog, localityAliases });
  const cpOriginal = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]).replace(/\D+/g, '').slice(0, 4);
  const cp = String(localidad?.codPostal || cpOriginal).trim();

  if (!codInfoauto) throw new Error('Sancor requiere código InfoAuto');
  if (!anio) throw new Error('Sancor requiere año del vehículo');
  if (!cp) throw new Error('Sancor requiere código postal');
  if (!localidad?.codLocalidad) throw new Error('Sancor requiere una localidad traducible por catálogo');

  const effectDate = formatDateTime(today);
  const expirationDate = addYearsIso(today, 1);
  const useId = resolveSancorVehicleUse({ fila, cabecera, cfg, mapeos });
  const ivaConditionId = resolveSancorIvaCondition({ cabecera, cfg });
  const capital = String(cfg?.parametros_extras?.value_capital_default || '0.00');

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
  xmlns:ns0="http://tempuri.org/">
  <SOAP-ENV:Body>
    <NewVehicle_Rq xmlns="http://GrupoSancorSeguros/xsd/service/PriceSvcMsg"
               xmlns:e="http://GrupoSancorSeguros/xsd/entity/ProductTypes"
               xmlns:d="http://GrupoSancorSeguros/xsd/entity/VehicleTypes"
               xmlns:c="http://GrupoSancorSeguros/xsd/entity/IntermediaryTypes"
               xmlns:b="http://GrupoSancorSeguros/xsd/entity/CommonTypes"
               xmlns:a="http://GrupoSancorSeguros/xsd/entity/PriceTypes">
      <Price>
        <a:City>
          <b:Id>${escapeXml(localidad.codLocalidad)}</b:Id>
        </a:City>
        <a:DocumentNumber>0</a:DocumentNumber>
        <a:Document>
          <b:Type>${escapeXml(cfg?.parametros_extras?.document_type_default || 'D')}</b:Type>
        </a:Document>
        <a:IsJuridicPerson>0</a:IsJuridicPerson>
        <a:CoverModuleCodes />
        <a:Currency>
          <b:Id>${escapeXml(cfg?.parametros_extras?.currency_id || '1')}</b:Id>
        </a:Currency>
        ${buildDiscountsXml(cfg)}
        <a:EffectDate>${escapeXml(effectDate)}</a:EffectDate>
        <a:ExpirationDate>${escapeXml(expirationDate)}</a:ExpirationDate>
        <a:InsuredGood>${escapeXml(cfg?.parametros_extras?.insured_good || '0')}</a:InsuredGood>
        <a:IvaCondition>
          <b:Id>${escapeXml(ivaConditionId)}</b:Id>
        </a:IvaCondition>
        <a:Intermediary>
          <c:Code>${escapeXml(cfg?.producer_code || '')}</c:Code>
          <c:Supervisor>${escapeXml(cfg?.supervisor_code || '')}</c:Supervisor>
        </a:Intermediary>
        <a:PeriodOfValidity>
          <b:Id>${escapeXml(cfg?.parametros_extras?.period_of_validity_id || '1')}</b:Id>
        </a:PeriodOfValidity>
        <a:Frequency>
          <b:Id>${escapeXml(cfg?.parametros_extras?.frequency_id || '5')}</b:Id>
        </a:Frequency>
        <a:Fee>
          <b:Id>${escapeXml(cfg?.parametros_extras?.fee_id || '0')}</b:Id>
        </a:Fee>
        <a:Product>
          <e:Id>${escapeXml(cfg?.parametros_extras?.product_id || '24')}</e:Id>
        </a:Product>
        <a:Zone>
          <b:ZipCode>${escapeXml(cp)}</b:ZipCode>
        </a:Zone>
        <a:Vehicle>
          <d:Code>${escapeXml(codInfoauto)}</d:Code>
          <d:Year>${escapeXml(anio)}</d:Year>
          <d:Value>
            <d:Capital>${escapeXml(capital)}</d:Capital>
          </d:Value>
          <d:Use>
            <b:Id>${escapeXml(useId)}</b:Id>
          </d:Use>
          <d:GNCInformation>
            <d:GNCValue>${cabecera?.gnc === '1' ? escapeXml(String(cabecera?.suma_gnc || '0')) : '0'}</d:GNCValue>
            <d:HasGNC>${cabecera?.gnc === '1' ? '1' : '0'}</d:HasGNC>
          </d:GNCInformation>
          <d:HasAuxiliaryTires>true</d:HasAuxiliaryTires>
          <d:IsOkm>${isVehicleZeroKm(fila) ? 'true' : 'false'}</d:IsOkm>
        </a:Vehicle>
        ${buildScoringXml(cfg)}
      </Price>
    </NewVehicle_Rq>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

  return {
    envelope,
    requestMeta: {
      codInfoauto,
      anio,
      codPostal: cp,
      codPostalOriginal: cpOriginal,
      codLocalidad: localidad.codLocalidad,
      localidad: localidad.localidad,
      provincia: localidad.provincia,
      codProvincia: localidad.codProvincia,
      localidadMatchType: localidad.matchType || '',
      useId,
      ivaConditionId,
      capital,
    },
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  return value == null ? '' : String(value);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');

  let normalized = compact;
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) {
      normalized = compact.replace(/,/g, '');
    } else {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    normalized = compact.replace(',', '.');
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatMoney(value, decimals = 2) {
  const num = toNumber(value);
  if (num == null) return '';
  return num
    .toFixed(decimals)
    .replace(/\.00$/, '')
    .replace(/(\.\d*?[1-9])0+$/, '$1');
}

function summarizeSancorPlanResults(results = []) {
  const items = asArray(results);
  let primaMonthly = 0;
  let primaAnnual = 0;
  let totalMonthly = 0;
  let totalAnnual = 0;
  let impuestosMonthly = 0;
  let impuestosAnnual = 0;
  let ivaMonthly = 0;
  let ivaAnnual = 0;
  let hasPrima = false;
  let hasTotal = false;
  let hasImpuestos = false;
  let hasIva = false;

  for (const item of items) {
    const detail = asText(item?.Detail);
    const detailType = asText(item?.DetailType);
    const description = asText(item?.Description);
    const monthly = toNumber(item?.PurePremiumMonthly);
    const annual = toNumber(item?.PurePremium);

    if (monthly != null) {
      totalMonthly += monthly;
      hasTotal = true;
    }
    if (annual != null) {
      totalAnnual += annual;
      hasTotal = true;
    }

    if (detail === 'Prima') {
      if (monthly != null) {
        primaMonthly += monthly;
        hasPrima = true;
      }
      if (annual != null) {
        primaAnnual += annual;
        hasPrima = true;
      }
    }

    if (detailType === 'Impuesto') {
      if (monthly != null) {
        impuestosMonthly += monthly;
        hasImpuestos = true;
      }
      if (annual != null) {
        impuestosAnnual += annual;
        hasImpuestos = true;
      }
    }

    if (/IVA/i.test(detail) || /IVA/i.test(description)) {
      if (monthly != null) {
        ivaMonthly += monthly;
        hasIva = true;
      }
      if (annual != null) {
        ivaAnnual += annual;
        hasIva = true;
      }
    }
  }

  return {
    hasPrima,
    hasTotal,
    hasImpuestos,
    hasIva,
    primaMonthly: hasPrima ? primaMonthly : null,
    primaAnnual: hasPrima ? primaAnnual : null,
    totalMonthly: hasTotal ? totalMonthly : null,
    totalAnnual: hasTotal ? totalAnnual : null,
    impuestosMonthly: hasImpuestos ? impuestosMonthly : null,
    impuestosAnnual: hasImpuestos ? impuestosAnnual : null,
    ivaMonthly: hasIva ? ivaMonthly : null,
    ivaAnnual: hasIva ? ivaAnnual : null,
    primaMonthlyText: hasPrima ? formatMoney(primaMonthly) : '',
    primaAnnualText: hasPrima ? formatMoney(primaAnnual) : '',
    totalMonthlyText: hasTotal ? formatMoney(totalMonthly) : '',
    totalAnnualText: hasTotal ? formatMoney(totalAnnual) : '',
    impuestosMonthlyText: hasImpuestos ? formatMoney(impuestosMonthly) : '',
    impuestosAnnualText: hasImpuestos ? formatMoney(impuestosAnnual) : '',
    ivaMonthlyText: hasIva ? formatMoney(ivaMonthly) : '',
    ivaAnnualText: hasIva ? formatMoney(ivaAnnual) : '',
  };
}

function parseSancorQuoteResponse(xml) {
  const raw = String(xml || '');
  const parsed = parser.parse(raw);
  const body = parsed?.Envelope?.Body || {};
  const fault = body?.Fault || {};
  const faultCode = asText(fault?.faultcode || fault?.Code?.Value);
  const faultString = asText(fault?.faultstring || fault?.Reason?.Text);
  if (faultCode || faultString) {
    const businessFault = /BUSINESSERROR/i.test(faultString) || /INVALID PARAMETERS/i.test(faultString);
    const message = String(faultString || faultCode || 'SOAP Fault Sancor')
      .replace(/^BusinessError\s*-\s*/i, '')
      .trim();
    return {
      ok: false,
      error: message,
      operacion: '0',
      coberturas: [],
      raw,
      technical_error: !businessFault,
      retryable: !businessFault,
      pending: !businessFault,
      faultcode: faultCode,
    };
  }
  const response = body?.NewVehicle_Rs || {};
  const result = response?.Result || {};
  const plans = asArray(response?.Plans?.Plan);
  const errorCode = asText(result?.ErrorCode);
  const errorMsg = asText(result?.ErrorMsg);

  if (errorCode && errorCode !== 'SOA-GSS-0000') {
    const businessFault = /^SOA-GSS-04/.test(errorCode) || /INVALID/i.test(errorMsg);
    return {
      ok: false,
      error: errorMsg || errorCode,
      coberturas: [],
      raw,
      technical_error: !businessFault,
      retryable: !businessFault,
      pending: !businessFault,
      faultcode: errorCode,
    };
  }

  const coberturas = plans.map((plan) => {
    const resultados = asArray(plan?.Results?.Result);
    const summary = summarizeSancorPlanResults(resultados);
    const primaTotal = plan?.PrimaTotal || {};
    const taxBases = [plan?.TaxBases, ...asArray(plan?.TaxBases?.TaxBase)];
    const premioMensual = pick([asText(plan?.PremiumMonthly), summary.totalMonthlyText]);
    const premioAnual = pick([asText(plan?.Premium), summary.totalAnnualText]);
    const primaMensual = pick([asText(primaTotal?.PurePremiumMonthlyTotal), summary.primaMonthlyText, premioMensual]);
    const primaAnual = pick([asText(primaTotal?.PurePremiumTotal), summary.primaAnnualText, premioAnual]);
    const ivaTaxBaseMonthly = pick(taxBases.map((item) => asText(item?.IvaMonthly)));
    const ivaTaxBase = pick(taxBases.map((item) => asText(item?.Iva)));

    return {
      module: asText(plan?.Module),
      shortDescr: asText(plan?.ShortDescr),
      longDescr: asText(plan?.LongDescr),
      premiumMonthly: asText(plan?.PremiumMonthly),
      premium: asText(plan?.Premium),
      prima: primaMensual,
      premio: premioMensual,
      importePrima: primaMensual,
      importePremio: premioMensual,
      importeIVA: summary.ivaMonthlyText,
      importeTotalImpuestos: summary.impuestosMonthlyText,
      purePremiumMonthlyTotal: asText(primaTotal?.PurePremiumMonthlyTotal),
      purePremiumTotal: asText(primaTotal?.PurePremiumTotal),
      ivaTaxBaseMonthly,
      ivaTaxBase,
      ivaMonthly: summary.ivaMonthlyText,
      ivaAnnual: summary.ivaAnnualText,
      impuestosMonthly: summary.impuestosMonthlyText,
      impuestosAnnual: summary.impuestosAnnualText,
      primaAnnual: primaAnual,
      premioAnnual: premioAnual,
      success: asText(plan?.Success),
      outStandard: asText(plan?.OutStandard),
      hasTrackingEquipment: asText(plan?.HasTrackingEquipment),
      vehicleValuation: asText(plan?.VehicleValuation),
      pricingId: asText(plan?.PricingId),
      pricingIdAPF: asText(plan?.PricingIdAPF),
      resultados,
    };
  });

  return {
    ok: true,
    operacion: asText(response?.Price?.QuotationId || response?.Price?.RelationQuotationId),
    quotationId: asText(response?.Price?.QuotationId),
    relationQuotationId: asText(response?.Price?.RelationQuotationId),
    suma_asegurada: asText(coberturas[0]?.vehicleValuation),
    coberturas,
    raw,
  };
}

module.exports = {
  buildSancorEnvelope,
  loadSancorLocalityCatalog,
  normalizeSancorInfoautoCode,
  parseSancorQuoteResponse,
  resolveSancorLocalidad,
  summarizeSancorPlanResults,
};

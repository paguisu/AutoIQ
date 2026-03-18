const path = require('path');
const xlsx = require('xlsx');
const { XMLParser } = require('fast-xml-parser');

let localityCatalogCache = null;
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });
const LOCALIDADES_XLSX_PATH = path.join(process.cwd(), 'web_services', 'Sancor', 'Localidades.xlsx');

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

function buildSancorEnvelope({ fila = {}, cabecera = {}, cfg = {}, mapeos = {}, today = new Date(), localityCatalog } = {}) {
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
  const localidad = resolveSancorLocalidad(fila, cabecera, { localityCatalog });
  const cp = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]).replace(/\D+/g, '').slice(0, 4);

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
          <d:IsOkm>${cabecera?.cerokm === '1' ? 'true' : 'false'}</d:IsOkm>
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
      codLocalidad: localidad.codLocalidad,
      localidad: localidad.localidad,
      provincia: localidad.provincia,
      codProvincia: localidad.codProvincia,
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

function parseSancorQuoteResponse(xml) {
  const parsed = parser.parse(String(xml || ''));
  const body = parsed?.Envelope?.Body || {};
  const response = body?.NewVehicle_Rs || {};
  const result = response?.Result || {};
  const plans = asArray(response?.Plans?.Plan);
  const errorCode = asText(result?.ErrorCode);
  const errorMsg = asText(result?.ErrorMsg);

  if (errorCode && errorCode !== 'SOA-GSS-0000') {
    return { ok: false, error: errorMsg || errorCode, coberturas: [], raw: xml };
  }

  const coberturas = plans.map((plan) => ({
    module: asText(plan?.Module),
    shortDescr: asText(plan?.ShortDescr),
    longDescr: asText(plan?.LongDescr),
    premiumMonthly: asText(plan?.PremiumMonthly),
    premium: asText(plan?.Premium),
    success: asText(plan?.Success),
    outStandard: asText(plan?.OutStandard),
    hasTrackingEquipment: asText(plan?.HasTrackingEquipment),
    vehicleValuation: asText(plan?.VehicleValuation),
    pricingId: asText(plan?.PricingId),
    pricingIdAPF: asText(plan?.PricingIdAPF),
    resultados: asArray(plan?.Results?.Result),
  }));

  return {
    ok: true,
    operacion: asText(response?.Price?.QuotationId || response?.Price?.RelationQuotationId),
    quotationId: asText(response?.Price?.QuotationId),
    relationQuotationId: asText(response?.Price?.RelationQuotationId),
    suma_asegurada: asText(coberturas[0]?.vehicleValuation),
    coberturas,
    raw: xml,
  };
}

module.exports = {
  buildSancorEnvelope,
  loadSancorLocalityCatalog,
  normalizeSancorInfoautoCode,
  parseSancorQuoteResponse,
  resolveSancorLocalidad,
};

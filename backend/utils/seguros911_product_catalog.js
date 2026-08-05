const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'data', 'diccionarios', 'seguros911_productos_coberturas.json');
const ACTIVITY_LOG_PATH = path.join(process.cwd(), 'data', 'system', 'seguros911_productos_activity.log.jsonl');
const PROCESOS_ROOT = path.join(process.cwd(), 'data', 'procesos');
const LEGACY_PRODUCT_CATALOG_CACHE_PATH = path.join(process.cwd(), 'data', 'admin', 'catalogo_productos_cache.json');

const DISPLAY_GROUP_CHOICES = [
  { code: 'A', description: 'RC' },
  { code: 'B1', description: 'Danos totales sin DxAccidente' },
  { code: 'B', description: 'Danos totales' },
  { code: 'C1', description: 'Terceros sin DxAccidente' },
  { code: 'C', description: 'Terceros simple' },
  { code: 'C+', description: 'Terceros completo basico' },
  { code: 'C++', description: 'Terceros completo full' },
  { code: 'C Premium', description: 'Terceros completo premium' },
  { code: 'DF', description: 'Todo riesgo con franquicia fija' },
  { code: 'DV', description: 'Todo riesgo con franquicia variable' },
  { code: 'G', description: 'Cobertura de Garage' },
];
const DISPLAY_GROUP_LABELS = Object.fromEntries(DISPLAY_GROUP_CHOICES.map((item) => [item.code, item.description]));
const DISPLAY_GROUP_ORDER = Object.fromEntries(DISPLAY_GROUP_CHOICES.map((item, idx) => [item.code, idx]));
const LEGACY_SIMPLIFIED_GROUP_CODES = new Set(['RC', 'TS', 'TC', 'TCP', 'TR']);

const SUMMARY_FIELDS = [
  'rc',
  'robo_total',
  'robo_parcial',
  'incendio_total',
  'incendio_parcial',
  'dxaccid_total',
  'dxaccid_parcial_c_franquicia',
];
const SUMMARY_FIELD_LABELS = {
  rc: 'RC',
  robo_total: 'Robo T.',
  robo_parcial: 'Robo P.',
  incendio_total: 'Incend T.',
  incendio_parcial: 'Incend P.',
  dxaccid_total: 'DxAccid T.',
  dxaccid_parcial_c_franquicia: 'DxAccid P c/fcia',
};

const INDICATOR_FIELDS = [
  'granizo',
  'cristales_laterales',
  'luneta_parabrisas',
  'asistencia_mecanica',
];
const INDICATOR_FIELD_LABELS = {
  granizo: 'Granizo',
  cristales_laterales: 'Cristales laterales',
  luneta_parabrisas: 'Luneta / Parabrisas',
  asistencia_mecanica: 'Asistencia mecanica',
};

const DETAIL_FIELDS = [
  'franquicia',
  'granizo_suma',
  'reposicion_0km',
  'ajuste_automatico',
  'rastreador',
  'auto_sustituto',
];

const EMPTY_SOURCE_MAP = () => ({
  display_group_code: '',
  summary_flags: Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, ''])),
  indicators: Object.fromEntries(INDICATOR_FIELDS.map((field) => [field, ''])),
  details: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, ''])),
});

const SOURCE_PRIORITY = {
  '': 0,
  inference: 1,
  response: 2,
  manual: 3,
};

const catalogCache = {
  signature: '',
  payload: null,
};
const legacyCatalogSeedCache = {
  signature: '',
  index: new Map(),
};

function ensureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

function readJson(absPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(absPath, value) {
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2), 'utf8');
}

function appendCatalogActivity(event = {}) {
  ensureDir(path.dirname(ACTIVITY_LOG_PATH));
  fs.appendFileSync(ACTIVITY_LOG_PATH, `${JSON.stringify({
    at: new Date().toISOString(),
    ...event,
  })}\n`, 'utf8');
}

function invalidateSeguros911CatalogCache() {
  catalogCache.signature = '';
  catalogCache.payload = null;
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDisplayGroupToken(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function normalizeDisplayGroupCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const exact = DISPLAY_GROUP_CHOICES.find((item) => item.code === raw);
  if (exact) return exact.code;
  const comparable = normalizeDisplayGroupToken(raw);
  const match = DISPLAY_GROUP_CHOICES.find((item) => normalizeDisplayGroupToken(item.code) === comparable);
  if (match) return match.code;
  if (LEGACY_SIMPLIFIED_GROUP_CODES.has(raw.toUpperCase())) return raw.toUpperCase();
  return '';
}

function normalizeGroupDefinitions(rawDefinitions = []) {
  const incoming = Array.isArray(rawDefinitions) ? rawDefinitions : [];
  const byCode = new Map(
    incoming
      .map((item) => ({
        code: normalizeDisplayGroupCode(item?.code),
        description: firstNonEmpty(item?.description),
      }))
      .filter((item) => item.code)
      .map((item) => [item.code, item.description])
  );
  return DISPLAY_GROUP_CHOICES.map((item) => ({
    code: item.code,
    description: String(byCode.get(item.code) || item.description || '').trim() || item.description,
  }));
}

function buildGroupLabelMap(groupDefinitions = []) {
  return Object.fromEntries(normalizeGroupDefinitions(groupDefinitions).map((item) => [item.code, item.description]));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string') {
      if (!value.trim()) continue;
      return value.trim();
    }
    return value;
  }
  return '';
}

function parseJsonMaybe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function flattenTexts(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenTexts(item, out));
    return out;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, next]) => {
      out.push(String(key));
      flattenTexts(next, out);
    });
    return out;
  }
  out.push(String(value));
  return out;
}

function flattenScalarTexts(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenScalarTexts(item, out));
    return out;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((next) => flattenScalarTexts(next, out));
    return out;
  }
  const text = String(value).trim();
  if (text) out.push(text);
  return out;
}

function hasCatalogRelevantResults(resumen = {}) {
  const resultados = resumen?.resultados;
  if (!resultados || typeof resultados !== 'object') return false;
  return Object.values(resultados).some((entries) => Array.isArray(entries) && entries.length > 0);
}

function listSeguros911ProcessDescriptors() {
  if (!fs.existsSync(PROCESOS_ROOT)) return [];
  const items = [];
  for (const entry of fs.readdirSync(PROCESOS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^proceso-\d+$/.test(entry.name)) continue;
    const processId = Number(entry.name.replace('proceso-', ''));
    const dir = path.join(PROCESOS_ROOT, entry.name);
    const metadataPath = path.join(dir, 'metadata.json');
    const resumenPath = path.join(dir, 'resumen.json');
    if (!fs.existsSync(metadataPath) || !fs.existsSync(resumenPath)) continue;
    const meta = readJson(metadataPath, null);
    const resumen = readJson(resumenPath, null);
    if (!meta || !hasCatalogRelevantResults(resumen)) continue;
    const resumenStat = fs.statSync(resumenPath);
    const metaStat = fs.statSync(metadataPath);
    items.push({
      processId,
      metadataPath,
      resumenPath,
      meta,
      mtimeMs: Math.max(metaStat.mtimeMs, resumenStat.mtimeMs),
    });
  }
  items.sort((a, b) => b.processId - a.processId);
  return items;
}

function buildProcessSignature(descriptors = []) {
  const legacyCatalogMtime = fs.existsSync(LEGACY_PRODUCT_CATALOG_CACHE_PATH)
    ? Math.round(fs.statSync(LEGACY_PRODUCT_CATALOG_CACHE_PATH).mtimeMs || 0)
    : 0;
  const processPart = descriptors
    .map((item) => `${item.processId}:${Math.round(item.mtimeMs || 0)}`)
    .join('|');
  return `${legacyCatalogMtime}::${processPart}`;
}

function createEmptyRecord(identity = {}) {
  return {
    key: identity.key || '',
    aseguradora: identity.aseguradora || '',
    producto_codigo: identity.producto_codigo || '',
    cobertura_codigo: identity.cobertura_codigo || '',
    producto_descripcion: identity.producto_descripcion || '',
    cobertura_descripcion: identity.cobertura_descripcion || '',
    display_group_code: '',
    display_group_description: '',
    summary_flags: Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, null])),
    indicators: Object.fromEntries(INDICATOR_FIELDS.map((field) => [field, null])),
    details: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, ''])),
    sources: EMPTY_SOURCE_MAP(),
    occurrences: 0,
    latest_process_id: '',
    latest_seen_at: '',
    pending_review: true,
    missing_fields: [],
    autoupdated: false,
    autoupdated_fields: [],
    updated_at: '',
    last_manual_update_at: '',
    last_manual_update_by: '',
    last_manual_update_by_name: '',
  };
}

function normalizeStoredRecord(record = {}) {
  const base = createEmptyRecord(record);
  base.key = record.key || base.key;
  base.aseguradora = record.aseguradora || base.aseguradora;
  base.producto_codigo = record.producto_codigo || base.producto_codigo;
  base.cobertura_codigo = record.cobertura_codigo || base.cobertura_codigo;
  base.producto_descripcion = record.producto_descripcion || base.producto_descripcion;
  base.cobertura_descripcion = record.cobertura_descripcion || base.cobertura_descripcion;
  base.display_group_code = resolveCanonicalGroupCode(record, record.display_group_code);
  base.display_group_description = record.display_group_description || '';
  base.summary_flags = { ...base.summary_flags, ...(record.summary_flags || {}) };
  base.indicators = { ...base.indicators, ...(record.indicators || {}) };
  base.details = { ...base.details, ...(record.details || {}) };
  base.sources = {
    display_group_code: String(record.sources?.display_group_code || ''),
    summary_flags: { ...base.sources.summary_flags, ...(record.sources?.summary_flags || {}) },
    indicators: { ...base.sources.indicators, ...(record.sources?.indicators || {}) },
    details: { ...base.sources.details, ...(record.sources?.details || {}) },
  };
  base.occurrences = Number(record.occurrences || base.occurrences || 0);
  base.latest_process_id = record.latest_process_id || base.latest_process_id;
  base.latest_seen_at = record.latest_seen_at || base.latest_seen_at;
  base.pending_review = Boolean(record.pending_review);
  base.missing_fields = Array.isArray(record.missing_fields) ? record.missing_fields : [];
  base.autoupdated = Boolean(record.autoupdated);
  base.autoupdated_fields = Array.isArray(record.autoupdated_fields) ? record.autoupdated_fields : [];
  base.updated_at = record.updated_at || base.updated_at;
  base.last_manual_update_at = record.last_manual_update_at || base.last_manual_update_at;
  base.last_manual_update_by = record.last_manual_update_by || base.last_manual_update_by;
  base.last_manual_update_by_name = record.last_manual_update_by_name || base.last_manual_update_by_name;
  return base;
}

function getLegacyCatalogSeedIndex() {
  const signature = fs.existsSync(LEGACY_PRODUCT_CATALOG_CACHE_PATH)
    ? String(Math.round(fs.statSync(LEGACY_PRODUCT_CATALOG_CACHE_PATH).mtimeMs || 0))
    : '0';
  if (legacyCatalogSeedCache.signature === signature && legacyCatalogSeedCache.index.size > 0) {
    return legacyCatalogSeedCache.index;
  }

  const raw = readJson(LEGACY_PRODUCT_CATALOG_CACHE_PATH, { items: [] }) || { items: [] };
  const nextIndex = new Map();
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const key = buildRecordKey(
      item.aseguradora,
      item.producto_codigo,
      item.cobertura_codigo,
      item.producto_descripcion,
      item.cobertura_descripcion
    );
    const code = normalizeDisplayGroupCode(item.grupo_codigo);
    if (!key || !code || nextIndex.has(key)) continue;
    nextIndex.set(key, {
      code,
      description: String(item.grupo_descripcion || DISPLAY_GROUP_LABELS[code] || '').trim() || DISPLAY_GROUP_LABELS[code] || '',
    });
  }

  legacyCatalogSeedCache.signature = signature;
  legacyCatalogSeedCache.index = nextIndex;
  return nextIndex;
}

function getLegacyCatalogSeed(identity = {}) {
  if (!identity || !identity.key) return null;
  const index = getLegacyCatalogSeedIndex();
  return index.get(identity.key) || null;
}

function getStore() {
  const raw = readJson(STORE_PATH, { updated_at: '', records: {}, group_definitions: DISPLAY_GROUP_CHOICES }) || {};
  return {
    updated_at: raw.updated_at || '',
    group_definitions: normalizeGroupDefinitions(raw.group_definitions),
    records: Object.fromEntries(
      Object.entries(raw.records || {}).map(([key, value]) => [key, normalizeStoredRecord({ ...value, key })])
    ),
  };
}

function writeStore(store) {
  const next = {
    updated_at: new Date().toISOString(),
    group_definitions: normalizeGroupDefinitions(store?.group_definitions),
    records: store?.records || {},
  };
  writeJson(STORE_PATH, next);
  return next;
}

function buildRecordKey(aseguradora, productoCodigo, coberturaCodigo, productoDescripcion, coberturaDescripcion) {
  const safeSlug = String(aseguradora || '').trim().toLowerCase();
  const productPart = String(productoCodigo || '').trim() || normalizeText(productoDescripcion).slice(0, 160);
  const coveragePart = String(coberturaCodigo || '').trim() || normalizeText(coberturaDescripcion).slice(0, 160);
  if (!safeSlug || !productPart || !coveragePart) return '';
  return `${safeSlug}|${productPart}|${coveragePart}`;
}

function resolveCanonicalGroupCode(record = {}, rawCode = '') {
  const normalized = normalizeDisplayGroupCode(rawCode);
  if (DISPLAY_GROUP_ORDER[normalized] !== undefined) return normalized;
  return inferDisplayGroupCode(
    {
      key: record.key || buildRecordKey(
        record.aseguradora,
        record.producto_codigo,
        record.cobertura_codigo,
        record.producto_descripcion,
        record.cobertura_descripcion
      ),
      aseguradora: record.aseguradora,
      producto_codigo: record.producto_codigo,
      cobertura_codigo: record.cobertura_codigo,
      producto_descripcion: record.producto_descripcion,
      cobertura_descripcion: record.cobertura_descripcion,
    },
    record.summary_flags || {},
    record.indicators || {},
    [record.producto_descripcion, record.cobertura_descripcion].filter(Boolean).join(' | ')
  );
}

function extractIdentity(aseguradora, cobertura = {}) {
  const coberturaCodigo = firstNonEmpty(
    cobertura.codigo,
    cobertura.codigoDeCobertura,
    cobertura.cobertura,
    cobertura.module
  );
  const coberturaDescripcion = firstNonEmpty(
    cobertura.descripcion,
    cobertura.descripcionDeCobertura,
    cobertura.shortDescr,
    cobertura.longDescr
  );
  const productoCodigo = firstNonEmpty(
    cobertura.codigoDeProducto,
    cobertura.codigoModalidad,
    cobertura.plan,
    cobertura.plan_cot,
    cobertura.module
  );
  const productoDescripcion = firstNonEmpty(
    cobertura.descripcionDeProducto,
    cobertura.nombreProducto,
    cobertura.longDescr,
    cobertura.shortDescr,
    cobertura.descripcionDeCobertura,
    cobertura.descripcion
  );
  const key = buildRecordKey(aseguradora, productoCodigo, coberturaCodigo, productoDescripcion, coberturaDescripcion);
  return {
    key,
    aseguradora: String(aseguradora || '').trim().toLowerCase(),
    producto_codigo: String(productoCodigo || '').trim(),
    cobertura_codigo: String(coberturaCodigo || '').trim(),
    producto_descripcion: String(productoDescripcion || '').trim(),
    cobertura_descripcion: String(coberturaDescripcion || '').trim(),
  };
}

function hasWord(text, pattern) {
  return pattern.test(text);
}

function toBooleanCandidate(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  if (text === 'N' || text === 'NO' || text === 'FALSE' || text === '0' || text === 'SIN' || text === 'NO APLICA') return false;
  if (text === 'S' || text === 'SI' || text === 'TRUE' || text === '1' || text === 'CON' || text === 'POSEE') return true;
  if (text.includes('SI') || text.includes('S/F') || text.includes('ILIMITADO') || /\d+\s*MESES?/.test(text)) return true;
  if (text.includes('NO') || text.includes('SIN ')) return false;
  return null;
}

function isMeaningfulDetail(value, { allowZero = false } = {}) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const normalized = normalizeText(text);
  if (['0', '0.0', '0.00', 'NO APLICA', 'N/A', 'GENERICA', 'NULL', 'FALSE'].includes(normalized) && !allowZero) return false;
  return true;
}

function normalizeDetailValue(field, value) {
  if (!isMeaningfulDetail(value, { allowZero: field === 'franquicia' })) return '';
  const text = String(value).trim();
  if (field === 'franquicia' && ['0', '0.0', '0.00'].includes(normalizeText(text))) return '';
  if (field === 'granizo_suma' && ['0', '0.0', '0.00'].includes(normalizeText(text))) return '';
  return text;
}

function setCandidate(targetValues, targetSources, field, value, source) {
  if (value == null || source == null) return;
  const hasValue = typeof value === 'boolean' || isMeaningfulDetail(value, { allowZero: field === 'franquicia' });
  if (!hasValue) return;
  const currentSource = String(targetSources[field] || '');
  if ((SOURCE_PRIORITY[source] || 0) < (SOURCE_PRIORITY[currentSource] || 0)) return;
  targetValues[field] = value;
  targetSources[field] = source;
}

function detectStructuredCoverageMap(cobertura) {
  const raw = cobertura?.coberturas;
  const parsed = parseJsonMaybe(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function detectResultDescriptions(cobertura) {
  const parsed = parseJsonMaybe(cobertura?.resultados);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => String(item?.Description || item?.description || '').trim())
    .filter(Boolean);
}

function buildCoverageTextContext(identity, cobertura) {
  const labelValues = [
    identity.producto_descripcion,
    identity.cobertura_descripcion,
    firstNonEmpty(cobertura?.plan, cobertura?.plan_cot, cobertura?.codigoModalidad, cobertura?.shortDescr, cobertura?.longDescr),
    cobertura?.descripcion,
    cobertura?.descripcionDeCobertura,
    cobertura?.descripcionDeProducto,
    cobertura?.nombreProducto,
    cobertura?.nombreFranquicia,
  ].filter(Boolean);

  const detailValues = [];
  const structuredMap = detectStructuredCoverageMap(cobertura);
  if (structuredMap) flattenScalarTexts(structuredMap, detailValues);
  detectResultDescriptions(cobertura).forEach((item) => detailValues.push(item));
  [cobertura?.conRecuperador, cobertura?.hasTrackingEquipment].forEach((item) => {
    const text = String(item == null ? '' : item).trim();
    if (text) detailValues.push(text);
  });

  return {
    labelText: normalizeText(labelValues.join(' | ')),
    detailText: normalizeText(detailValues.join(' | ')),
    fullText: normalizeText([...labelValues, ...detailValues].join(' | ')),
  };
}

function detectFlagsFromText(text, summaryFlags, summarySources, indicatorFlags, indicatorSources, detailValues, detailSources, options = {}) {
  if (!text) return;
  const allowAbbreviations = options.allowAbbreviations !== false;

  if (hasWord(text, /\bRESPONSABILIDAD\s+CIVI?L\b|\bRESP\.?\s*CIVI?L\b|\bR\.?\s*C\.?\b|\bRC\b/)) {
    setCandidate(summaryFlags, summarySources, 'rc', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bROBO\b.*\bTOTAL\b|\bHURTO\b.*\bTOTAL\b|\bROBO\/HURTO TOTAL\b|\bRT\b/ : /\bROBO\b.*\bTOTAL\b|\bHURTO\b.*\bTOTAL\b|\bROBO\/HURTO TOTAL\b/)) {
    setCandidate(summaryFlags, summarySources, 'robo_total', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bROBO\b.*\bPARCIAL\b|\bHURTO\b.*\bPARCIAL\b|\bROBO\/HURTO PARCIAL\b|\bRP\b|Y\/O PARCIAL/ : /\bROBO\b.*\bPARCIAL\b|\bHURTO\b.*\bPARCIAL\b|\bROBO\/HURTO PARCIAL\b|Y\/O PARCIAL/)) {
    setCandidate(summaryFlags, summarySources, 'robo_parcial', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bINCENDIO\b.*\bTOTAL\b|\bINCENDIO T\b|\bIT\b/ : /\bINCENDIO\b.*\bTOTAL\b|\bINCENDIO T\b/)) {
    setCandidate(summaryFlags, summarySources, 'incendio_total', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bINCENDIO\b.*\bPARCIAL\b|\bINCENDIO P\b|\bIP\b|Y\/O PARCIAL/ : /\bINCENDIO\b.*\bPARCIAL\b|\bINCENDIO P\b|Y\/O PARCIAL/)) {
    setCandidate(summaryFlags, summarySources, 'incendio_parcial', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bACCIDENTE\b.*\bTOTAL\b|\bDESTRUCCION TOTAL\b|\bDEST\.? TOTAL\b|\bAT\b|\bDANOS TOTALES\b/ : /\bACCIDENTE\b.*\bTOTAL\b|\bDESTRUCCION TOTAL\b|\bDEST\.? TOTAL\b|\bDANOS TOTALES\b/)) {
    setCandidate(summaryFlags, summarySources, 'dxaccid_total', true, 'response');
  }
  if (hasWord(text, allowAbbreviations ? /\bACCIDENTE\b.*\bPARCIAL\b|\bDANO PARCIAL ACCIDENTE\b|\bAP\b|\bTODO RIESGO\b/ : /\bACCIDENTE\b.*\bPARCIAL\b|\bDANO PARCIAL ACCIDENTE\b|\bTODO RIESGO\b/)) {
    setCandidate(summaryFlags, summarySources, 'dxaccid_parcial_c_franquicia', true, 'response');
  }

  if (hasWord(text, /\bSIN\s+GRANIZO\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'granizo', false, 'response');
  } else if (hasWord(text, /\bGRANIZO\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'granizo', true, 'response');
  }
  if (hasWord(text, /\bCRISTALES?\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'cristales_laterales', true, 'response');
  }
  if (hasWord(text, /\bLUNETA\b|\bPARABRISA\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'luneta_parabrisas', true, 'response');
  }
  if (hasWord(text, /\bSIN\s+ASISTENCIA(?:\s+MECANICA)?\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'asistencia_mecanica', false, 'response');
  } else if (hasWord(text, /\bASISTENCIA\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'asistencia_mecanica', true, 'response');
  }

  if (hasWord(text, /C\/RASTREADOR|CON RASTREADOR/)) {
    setCandidate(detailValues, detailSources, 'rastreador', 'Con rastreador', 'response');
  }
  if (hasWord(text, /S\/RASTREADOR|SIN RASTREADOR|NO POSEE RASTREADOR/)) {
    setCandidate(detailValues, detailSources, 'rastreador', 'Sin rastreador', 'response');
  }
  if (hasWord(text, /\bAUTO SUSTITUTO\b/)) {
    setCandidate(detailValues, detailSources, 'auto_sustituto', 'Auto sustituto', 'response');
  }
  if (hasWord(text, /\bAJUSTE AUTOMATICO\b/)) {
    setCandidate(detailValues, detailSources, 'ajuste_automatico', 'Ajuste automatico', 'response');
  }
  if (hasWord(text, /\bREPOSICION\b.*\b0\s*KM\b|\b0\s*KM\b/)) {
    setCandidate(detailValues, detailSources, 'reposicion_0km', 'Reposicion 0km', 'response');
  }
}

function applyProductDescriptionSummaryHeuristics(identity, text, summaryFlags, summarySources) {
  const productText = normalizeComparableText(identity?.producto_descripcion);
  const fullText = normalizeComparableText(text?.fullText);
  const setInference = (field, value) => {
    if (summaryFlags[field] == null) setCandidate(summaryFlags, summarySources, field, value, 'inference');
  };

  const isResponsabilidadCivilOnly = [
    /^RC$/,
    /^R C$/,
    /^RESP CIVI?L$/,
    /^RESPONSABILIDAD CIVI?L$/,
    /^A RESPONSABILIDAD CIVI?L$/,
    /^RESPONSABILIDAD CIVI?L SIN ASISTENCIA$/,
    /^RESPONSABILIDAD CIVI?L CON ASISTENCIA$/,
    /^A RESPONSABILIDAD CIVI?L SIN ASISTENCIA$/,
    /^A RESPONSABILIDAD CIVI?L CON ASISTENCIA$/,
  ].some((pattern) => pattern.test(productText));

  if (isResponsabilidadCivilOnly) {
    setInference('rc', true);
    ['robo_total', 'robo_parcial', 'incendio_total', 'incendio_parcial', 'dxaccid_total', 'dxaccid_parcial_c_franquicia']
      .forEach((field) => setInference(field, false));
    return;
  }

  if (productText.includes('TOTAL') && !productText.includes('PARCIAL')) {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('incendio_total', true);
    setInference('dxaccid_total', true);
    setInference('robo_parcial', false);
    setInference('incendio_parcial', false);
    setInference('dxaccid_parcial_c_franquicia', false);
  }

  if (!fullText.includes('TODO RIESGO')) {
    setInference('dxaccid_parcial_c_franquicia', false);
  }
}

function applyStructuredCoverageSignals(cobertura, summaryFlags, summarySources, indicatorFlags, indicatorSources, detailValues, detailSources) {
  const structuredMap = detectStructuredCoverageMap(cobertura);
  if (structuredMap) {
    setCandidate(summaryFlags, summarySources, 'rc', toBooleanCandidate(structuredMap.ResponsabilidadCivil), 'response');
    setCandidate(summaryFlags, summarySources, 'robo_total', toBooleanCandidate(structuredMap.RoboHurtoTotal), 'response');
    setCandidate(summaryFlags, summarySources, 'robo_parcial', toBooleanCandidate(structuredMap.RoboHurtoParcial), 'response');
    setCandidate(summaryFlags, summarySources, 'incendio_total', toBooleanCandidate(structuredMap.IncendioTotal), 'response');
    setCandidate(summaryFlags, summarySources, 'incendio_parcial', toBooleanCandidate(structuredMap.IncendioParcial), 'response');
    setCandidate(summaryFlags, summarySources, 'dxaccid_total', toBooleanCandidate(firstNonEmpty(structuredMap.DestruccionTotal, structuredMap.AccidenteTotal)), 'response');
    setCandidate(summaryFlags, summarySources, 'dxaccid_parcial_c_franquicia', toBooleanCandidate(firstNonEmpty(structuredMap.DanoParcialAccidente, structuredMap.OtrosDanosParciales)), 'response');

    setCandidate(indicatorFlags, indicatorSources, 'granizo', toBooleanCandidate(structuredMap.Granizo), 'response');
    setCandidate(indicatorFlags, indicatorSources, 'cristales_laterales', toBooleanCandidate(structuredMap.CristalesLaterales), 'response');
    setCandidate(indicatorFlags, indicatorSources, 'luneta_parabrisas', toBooleanCandidate(structuredMap.LunetaParabrisa), 'response');
    setCandidate(indicatorFlags, indicatorSources, 'asistencia_mecanica', toBooleanCandidate(structuredMap.ServiRemolque), 'response');

    const reposicion = normalizeDetailValue('reposicion_0km', structuredMap.Reposicion0Km);
    if (reposicion) setCandidate(detailValues, detailSources, 'reposicion_0km', reposicion, 'response');
    if (toBooleanCandidate(structuredMap.AjusteAutomaticoSuma) === true) {
      setCandidate(detailValues, detailSources, 'ajuste_automatico', 'Ajuste automatico', 'response');
    }
    if (toBooleanCandidate(structuredMap.AutoSustituto) === true) {
      setCandidate(detailValues, detailSources, 'auto_sustituto', 'Auto sustituto', 'response');
    }
  }

  const conRecuperador = toBooleanCandidate(firstNonEmpty(cobertura?.conRecuperador, cobertura?.hasTrackingEquipment));
  if (conRecuperador === true) {
    setCandidate(detailValues, detailSources, 'rastreador', 'Con rastreador', 'response');
  } else if (conRecuperador === false) {
    setCandidate(detailValues, detailSources, 'rastreador', 'Sin rastreador', 'response');
  }

  const franquicia = normalizeDetailValue('franquicia', firstNonEmpty(
    cobertura?.franquicia,
    cobertura?.montoFranquicia,
    cobertura?.calculos?.franquicia,
    Array.isArray(cobertura?.franquicias) ? cobertura.franquicias[0]?.valorFranquicia : '',
  ));
  if (franquicia) {
    setCandidate(detailValues, detailSources, 'franquicia', franquicia, 'response');
  }

  const granizoSuma = normalizeDetailValue('granizo_suma', firstNonEmpty(
    cobertura?.calculos?.sumaGranizo,
    cobertura?.sumaGranizo,
  ));
  if (granizoSuma) {
    setCandidate(detailValues, detailSources, 'granizo_suma', granizoSuma, 'response');
    setCandidate(indicatorFlags, indicatorSources, 'granizo', true, 'response');
  }

  if (normalizeDetailValue('ajuste_automatico', cobertura?.used?.clausulaAjuste)) {
    setCandidate(detailValues, detailSources, 'ajuste_automatico', 'Ajuste automatico', 'inference');
  }

  const resultDescriptions = detectResultDescriptions(cobertura);
  if (resultDescriptions.length > 0) {
    detectFlagsFromText(
      normalizeText(resultDescriptions.join(' | ')),
      summaryFlags,
      summarySources,
      indicatorFlags,
      indicatorSources,
      detailValues,
      detailSources,
      { allowAbbreviations: false }
    );
  }
}

function inferDisplayGroupCode(identity, summaryFlags, indicatorFlags, text) {
  const fullText = normalizeText(text);
  const hasPremium = hasWord(fullText, /\bPREMIUM\b/);
  const hasFullTier = hasWord(fullText, /\bFULL\b|\bBLACK\b|\bVIP\b|\bMAX\b|\bPLUS\b|\bEXTRA LARGE\b|\bXL\b/);
  const hasGarage = hasWord(fullText, /\bGARAGE\b/);
  const hasTodoRiesgo = hasWord(fullText, /\bTODO\s+RIESGO\b|\bT\s*R\b|\bT\.?\s*R\.?\b/);
  const hasVariableFranchise = hasWord(fullText, /\bFRANQUICIA\s+VARIABLE\b|\bFCIA\s+SOBRE\s+VALOR\s+ASEGURADO\b|\bFRANQUICIA\b.*%|\bFCIA\b.*%|\bVALOR\s+ASEGURADO\b.*%/);
  const hasFixedFranchise = hasWord(fullText, /\bFRANQUICIA\s+FIJA\b|\bFCIA\s+FIJA\b|\bCON\s+FCIA\b/);
  const seededGroup = getLegacyCatalogSeed(identity);
  if (seededGroup?.code) return seededGroup.code;
  if (hasGarage) return 'G';
  if (summaryFlags.dxaccid_parcial_c_franquicia === true || hasTodoRiesgo || hasVariableFranchise || hasFixedFranchise) {
    return hasVariableFranchise ? 'DV' : 'DF';
  }
  if (summaryFlags.robo_parcial === true || summaryFlags.incendio_parcial === true) {
    if (summaryFlags.dxaccid_total === false) return 'C1';
    if (hasPremium) return 'C Premium';
    if (indicatorFlags.granizo === true && (indicatorFlags.cristales_laterales === true || indicatorFlags.luneta_parabrisas === true || hasFullTier)) return 'C++';
    if (indicatorFlags.granizo === true) return 'C+';
    return 'C';
  }
  if (summaryFlags.robo_total === true || summaryFlags.incendio_total === true || summaryFlags.dxaccid_total === true) {
    return summaryFlags.dxaccid_total === true ? 'B' : 'B1';
  }
  if (summaryFlags.rc === true) return 'A';
  return '';
}

function fillSummaryByDisplayGroup(summaryFlags, summarySources, displayGroupCode) {
  const setInference = (field, value) => {
    if (summaryFlags[field] == null) setCandidate(summaryFlags, summarySources, field, value, 'inference');
  };
  if (!displayGroupCode) return;
  if (displayGroupCode === 'A' || displayGroupCode === 'G') {
    setInference('rc', true);
    ['robo_total', 'robo_parcial', 'incendio_total', 'incendio_parcial', 'dxaccid_total', 'dxaccid_parcial_c_franquicia']
      .forEach((field) => setInference(field, false));
    return;
  }
  if (displayGroupCode === 'B1') {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('incendio_total', true);
    setInference('dxaccid_total', false);
    setInference('robo_parcial', false);
    setInference('incendio_parcial', false);
    setInference('dxaccid_parcial_c_franquicia', false);
    return;
  }
  if (displayGroupCode === 'B') {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('incendio_total', true);
    setInference('dxaccid_total', true);
    setInference('robo_parcial', false);
    setInference('incendio_parcial', false);
    setInference('dxaccid_parcial_c_franquicia', false);
    return;
  }
  if (displayGroupCode === 'C1') {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('robo_parcial', true);
    setInference('incendio_total', true);
    setInference('incendio_parcial', true);
    setInference('dxaccid_total', false);
    setInference('dxaccid_parcial_c_franquicia', false);
    return;
  }
  if (displayGroupCode === 'C' || displayGroupCode === 'C+' || displayGroupCode === 'C++' || displayGroupCode === 'C Premium') {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('robo_parcial', true);
    setInference('incendio_total', true);
    setInference('incendio_parcial', true);
    setInference('dxaccid_total', true);
    setInference('dxaccid_parcial_c_franquicia', false);
    return;
  }
  if (displayGroupCode === 'DF' || displayGroupCode === 'DV') {
    setInference('rc', true);
    setInference('robo_total', true);
    setInference('robo_parcial', true);
    setInference('incendio_total', true);
    setInference('incendio_parcial', true);
    setInference('dxaccid_total', true);
    setInference('dxaccid_parcial_c_franquicia', true);
  }
}

function buildDetectedRecord(processId, seenAt, aseguradora, cobertura = {}) {
  const identity = extractIdentity(aseguradora, cobertura);
  if (!identity.key) return null;

  const summaryFlags = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, null]));
  const summarySources = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, '']));
  const indicatorFlags = Object.fromEntries(INDICATOR_FIELDS.map((field) => [field, null]));
  const indicatorSources = Object.fromEntries(INDICATOR_FIELDS.map((field) => [field, '']));
  const detailValues = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, '']));
  const detailSources = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, '']));

  const text = buildCoverageTextContext(identity, cobertura);

  applyStructuredCoverageSignals(cobertura, summaryFlags, summarySources, indicatorFlags, indicatorSources, detailValues, detailSources);
  detectFlagsFromText(text.labelText, summaryFlags, summarySources, indicatorFlags, indicatorSources, detailValues, detailSources, { allowAbbreviations: true });
  detectFlagsFromText(text.detailText, summaryFlags, summarySources, indicatorFlags, indicatorSources, detailValues, detailSources, { allowAbbreviations: false });
  applyProductDescriptionSummaryHeuristics(identity, text, summaryFlags, summarySources);

  if (summaryFlags.dxaccid_parcial_c_franquicia === true) {
    setCandidate(detailValues, detailSources, 'franquicia', normalizeDetailValue('franquicia', firstNonEmpty(
      cobertura?.franquicia,
      cobertura?.montoFranquicia,
      cobertura?.calculos?.franquicia,
      cobertura?.nombreFranquicia,
    )), detailSources.franquicia || 'inference');
  }

  if (indicatorFlags.asistencia_mecanica == null && hasWord(text.labelText, /\bSIN\s+ASISTENCIA(?:\s+MECANICA)?\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'asistencia_mecanica', false, 'response');
  }

  if (indicatorFlags.granizo == null && hasWord(text.labelText, /\bSIN\s+GRANIZO\b/)) {
    setCandidate(indicatorFlags, indicatorSources, 'granizo', false, 'response');
  }

  if (indicatorFlags.granizo == null && detailValues.granizo_suma) {
    setCandidate(indicatorFlags, indicatorSources, 'granizo', true, detailSources.granizo_suma || 'response');
  }

  const displayGroupCode = inferDisplayGroupCode(identity, summaryFlags, indicatorFlags, text.fullText);
  fillSummaryByDisplayGroup(summaryFlags, summarySources, displayGroupCode);

  if (summaryFlags.rc == null && displayGroupCode) {
    setCandidate(summaryFlags, summarySources, 'rc', true, 'inference');
  }

  return {
    key: identity.key,
    aseguradora: identity.aseguradora,
    producto_codigo: identity.producto_codigo,
    cobertura_codigo: identity.cobertura_codigo,
    producto_descripcion: identity.producto_descripcion,
    cobertura_descripcion: identity.cobertura_descripcion,
    detected_display_group_code: displayGroupCode,
    detected_display_group_description: DISPLAY_GROUP_LABELS[displayGroupCode] || '',
    detected_sources: {
      display_group_code: displayGroupCode ? 'inference' : '',
      summary_flags: summarySources,
      indicators: indicatorSources,
      details: detailSources,
    },
    detected_values: {
      summary_flags: summaryFlags,
      indicators: indicatorFlags,
      details: detailValues,
    },
    latest_process_id: processId,
    latest_seen_at: seenAt,
    occurrences: 1,
  };
}

function mergeDetectedCandidate(existingValue, existingSource, nextValue, nextSource) {
  if (nextValue == null || nextSource == null || nextSource === '') {
    return { value: existingValue, source: existingSource };
  }
  if ((SOURCE_PRIORITY[nextSource] || 0) < (SOURCE_PRIORITY[existingSource] || 0)) {
    return { value: existingValue, source: existingSource };
  }
  return { value: nextValue, source: nextSource };
}

function mergeDetectedRecords(base, next) {
  if (!base) return JSON.parse(JSON.stringify(next));
  const merged = { ...base };
  merged.occurrences = Number(base.occurrences || 0) + Number(next.occurrences || 0);
  if (Number(next.latest_process_id || 0) >= Number(base.latest_process_id || 0)) {
    merged.producto_descripcion = next.producto_descripcion || base.producto_descripcion;
    merged.cobertura_descripcion = next.cobertura_descripcion || base.cobertura_descripcion;
    merged.latest_process_id = next.latest_process_id;
    merged.latest_seen_at = next.latest_seen_at;
  }
  const groupCandidate = mergeDetectedCandidate(
    merged.detected_display_group_code,
    merged.detected_sources?.display_group_code || '',
    next.detected_display_group_code,
    next.detected_sources?.display_group_code || ''
  );
  merged.detected_display_group_code = groupCandidate.value || '';
  merged.detected_display_group_description = DISPLAY_GROUP_LABELS[groupCandidate.value] || '';
  merged.detected_sources = merged.detected_sources || EMPTY_SOURCE_MAP();
  merged.detected_sources.display_group_code = groupCandidate.source || '';

  for (const field of SUMMARY_FIELDS) {
    const current = mergeDetectedCandidate(
      merged.detected_values.summary_flags[field],
      merged.detected_sources.summary_flags[field],
      next.detected_values.summary_flags[field],
      next.detected_sources.summary_flags[field]
    );
    merged.detected_values.summary_flags[field] = current.value;
    merged.detected_sources.summary_flags[field] = current.source;
  }
  for (const field of INDICATOR_FIELDS) {
    const current = mergeDetectedCandidate(
      merged.detected_values.indicators[field],
      merged.detected_sources.indicators[field],
      next.detected_values.indicators[field],
      next.detected_sources.indicators[field]
    );
    merged.detected_values.indicators[field] = current.value;
    merged.detected_sources.indicators[field] = current.source;
  }
  for (const field of DETAIL_FIELDS) {
    const current = mergeDetectedCandidate(
      merged.detected_values.details[field],
      merged.detected_sources.details[field],
      next.detected_values.details[field],
      next.detected_sources.details[field]
    );
    merged.detected_values.details[field] = current.value;
    merged.detected_sources.details[field] = current.source;
  }
  return merged;
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function recomputeRecordStatus(record, groupDefinitions = DISPLAY_GROUP_CHOICES) {
  const groupLabels = buildGroupLabelMap(groupDefinitions);
  record.display_group_code = resolveCanonicalGroupCode(record, record.display_group_code);
  const missing = [];
  if (!record.display_group_code) missing.push('display_group_code');
  for (const field of SUMMARY_FIELDS) {
    if (record.summary_flags[field] == null) missing.push(`summary.${field}`);
  }
  for (const field of INDICATOR_FIELDS) {
    if (record.indicators[field] == null) missing.push(`indicator.${field}`);
  }
  record.display_group_description = groupLabels[record.display_group_code] || '';
  record.pending_review = missing.length > 0;
  record.missing_fields = missing;
  record.updated_at = new Date().toISOString();
  return record;
}

function mergeStoredWithDetected(existingRecord, detectedRecord, groupDefinitions = DISPLAY_GROUP_CHOICES) {
  const next = cloneRecord(existingRecord || createEmptyRecord(detectedRecord));
  const autoupdatedFields = [];
  const groupLabels = buildGroupLabelMap(groupDefinitions);

  next.aseguradora = detectedRecord.aseguradora || next.aseguradora;
  next.producto_codigo = detectedRecord.producto_codigo || next.producto_codigo;
  next.cobertura_codigo = detectedRecord.cobertura_codigo || next.cobertura_codigo;
  next.producto_descripcion = detectedRecord.producto_descripcion || next.producto_descripcion;
  next.cobertura_descripcion = detectedRecord.cobertura_descripcion || next.cobertura_descripcion;
  next.key = detectedRecord.key || next.key;
  next.occurrences = detectedRecord.occurrences || next.occurrences || 0;
  next.latest_process_id = detectedRecord.latest_process_id || next.latest_process_id || '';
  next.latest_seen_at = detectedRecord.latest_seen_at || next.latest_seen_at || '';

  const applyResolvedField = (target, sourceTarget, field, detectedValue, detectedSource) => {
    if (detectedValue == null || !detectedSource) return;
    const currentSource = String(sourceTarget[field] || '');
    const currentValue = target[field];
    if (detectedSource === 'response' || detectedSource === 'inference') {
      if (currentSource === 'manual' && currentValue !== detectedValue) {
        autoupdatedFields.push(field);
      }
      if (currentSource === 'response' && detectedSource === 'inference') {
        return;
      }
      target[field] = detectedValue;
      sourceTarget[field] = detectedSource;
      return;
    }
    if (currentSource === 'manual' || currentSource === 'response') return;
    target[field] = detectedValue;
    sourceTarget[field] = detectedSource;
  };

  if (detectedRecord.detected_display_group_code) {
    const currentSource = String(next.sources.display_group_code || '');
    const nextDetectedSource = String(detectedRecord.detected_sources.display_group_code || 'inference');
    if (currentSource === 'response' && nextDetectedSource === 'inference') {
      // Keep the stronger explicit classification already stored.
    } else {
      if (currentSource === 'manual' && next.display_group_code !== detectedRecord.detected_display_group_code) {
        autoupdatedFields.push('display_group_code');
      }
      if (currentSource !== 'manual' || next.display_group_code !== detectedRecord.detected_display_group_code) {
        next.display_group_code = resolveCanonicalGroupCode(next, detectedRecord.detected_display_group_code);
        next.sources.display_group_code = nextDetectedSource;
      }
    }
  }

  for (const field of SUMMARY_FIELDS) {
    applyResolvedField(
      next.summary_flags,
      next.sources.summary_flags,
      field,
      detectedRecord.detected_values.summary_flags[field],
      detectedRecord.detected_sources.summary_flags[field]
    );
  }
  for (const field of INDICATOR_FIELDS) {
    applyResolvedField(
      next.indicators,
      next.sources.indicators,
      field,
      detectedRecord.detected_values.indicators[field],
      detectedRecord.detected_sources.indicators[field]
    );
  }
  for (const field of DETAIL_FIELDS) {
    const detectedValue = normalizeDetailValue(field, detectedRecord.detected_values.details[field]);
    applyResolvedField(
      next.details,
      next.sources.details,
      field,
      detectedValue,
      detectedRecord.detected_sources.details[field]
    );
  }

  next.autoupdated_fields = Array.from(new Set([...(next.autoupdated_fields || []), ...autoupdatedFields]));
  next.autoupdated = next.autoupdated_fields.length > 0;
  next.display_group_description = groupLabels[next.display_group_code] || '';
  return recomputeRecordStatus(next, groupDefinitions);
}

function sortCatalogItems(items = []) {
  return [...items].sort((a, b) => {
    const byPending = Number(b.pending_review) - Number(a.pending_review);
    if (byPending !== 0) return byPending;
    const bySlug = String(a.aseguradora || '').localeCompare(String(b.aseguradora || ''), 'es');
    if (bySlug !== 0) return bySlug;
    const byGroup = (DISPLAY_GROUP_ORDER[a.display_group_code] ?? 99) - (DISPLAY_GROUP_ORDER[b.display_group_code] ?? 99);
    if (byGroup !== 0) return byGroup;
    const byProduct = String(a.producto_codigo || '').localeCompare(String(b.producto_codigo || ''), 'es');
    if (byProduct !== 0) return byProduct;
    const byCoverage = String(a.cobertura_codigo || '').localeCompare(String(b.cobertura_codigo || ''), 'es');
    if (byCoverage !== 0) return byCoverage;
    return String(a.producto_descripcion || a.cobertura_descripcion || '').localeCompare(
      String(b.producto_descripcion || b.cobertura_descripcion || ''),
      'es'
    );
  });
}

function buildDisplaySummary(record = {}) {
  const values = record.summary_flags || {};
  if (SUMMARY_FIELDS.some((field) => values[field] == null)) return '';
  const parts = SUMMARY_FIELDS.filter((field) => values[field] === true).map((field) => SUMMARY_FIELD_LABELS[field]);
  return parts.join(' | ');
}

function buildDisplayDetails(record = {}) {
  const out = [];
  const details = record.details || {};
  const indicators = record.indicators || {};

  const franquicia = normalizeDetailValue('franquicia', details.franquicia);
  if (franquicia) out.push({ key: 'franquicia', label: 'Franquicia', value: franquicia });

  const granizoSuma = normalizeDetailValue('granizo_suma', details.granizo_suma);
  if (granizoSuma && indicators.granizo === true) out.push({ key: 'granizo_suma', label: 'Granizo hasta', value: granizoSuma });

  const reposicion = normalizeDetailValue('reposicion_0km', details.reposicion_0km);
  if (reposicion) out.push({ key: 'reposicion_0km', label: 'Reposicion 0km', value: reposicion });

  const ajuste = normalizeDetailValue('ajuste_automatico', details.ajuste_automatico);
  if (ajuste) out.push({ key: 'ajuste_automatico', label: 'Ajuste automatico', value: '' });

  const rastreador = normalizeDetailValue('rastreador', details.rastreador);
  if (rastreador) out.push({ key: 'rastreador', label: rastreador, value: '' });

  const autoSustituto = normalizeDetailValue('auto_sustituto', details.auto_sustituto);
  if (autoSustituto) out.push({ key: 'auto_sustituto', label: 'Auto sustituto', value: '' });

  return out;
}

function buildCatalogStats(items = []) {
  return {
    total: items.length,
    pending: items.filter((item) => item.pending_review).length,
    autoupdated: items.filter((item) => item.autoupdated).length,
    by_slug: items.reduce((acc, item) => {
      const slug = item.aseguradora || 'desconocida';
      const bucket = acc[slug] || { total: 0, pending: 0, autoupdated: 0 };
      bucket.total += 1;
      if (item.pending_review) bucket.pending += 1;
      if (item.autoupdated) bucket.autoupdated += 1;
      acc[slug] = bucket;
      return acc;
    }, {}),
  };
}

function buildPayloadFromStore(store = {}) {
  const groupDefinitions = normalizeGroupDefinitions(store.group_definitions);
  const items = sortCatalogItems(
    Object.values(store.records || {}).map((record) => recomputeRecordStatus(cloneRecord(record), groupDefinitions))
  );
  return {
    items,
    index: new Map(items.map((item) => [item.key, item])),
    stats: buildCatalogStats(items),
    group_definitions: groupDefinitions,
  };
}

function buildCatalogPayload(force = false) {
  if (!force) {
    if (catalogCache.payload) {
      return catalogCache.payload;
    }
    return buildPayloadFromStore(getStore());
  }

  const descriptors = listSeguros911ProcessDescriptors();
  const signature = buildProcessSignature(descriptors);

  const detectedMap = new Map();
  for (const descriptor of descriptors) {
    const resumen = readJson(descriptor.resumenPath, null);
    const seenAt = String(resumen?.fecha || descriptor.meta?.fecha_fin || descriptor.meta?.fecha_creacion || '').trim();
    for (const [slug, entries] of Object.entries(resumen?.resultados || {})) {
      const arr = Array.isArray(entries) ? entries : [];
      for (const item of arr) {
        if (!item || item.ok !== true) continue;
        const coberturas = Array.isArray(item.coberturas) ? item.coberturas : [];
        for (const cobertura of coberturas) {
          const detected = buildDetectedRecord(descriptor.processId, seenAt, slug, cobertura);
          if (!detected) continue;
          const current = detectedMap.get(detected.key);
          detectedMap.set(detected.key, mergeDetectedRecords(current, detected));
        }
      }
    }
  }

  const store = getStore();
  const nextStore = {
    ...store,
    group_definitions: normalizeGroupDefinitions(store.group_definitions),
    records: { ...(store.records || {}) },
  };
  let changed = JSON.stringify(store.group_definitions || []) !== JSON.stringify(nextStore.group_definitions || []);

  for (const [key, detected] of detectedMap.entries()) {
    const existing = nextStore.records[key];
    const merged = mergeStoredWithDetected(existing, detected, nextStore.group_definitions);
    if (JSON.stringify(existing || null) !== JSON.stringify(merged)) {
      if (merged.autoupdated && merged.autoupdated_fields.length > 0) {
        appendCatalogActivity({
          actor_type: 'system',
          actor_id: 'catalog-rebuild',
          event: 'seguros911_product_autoupdated',
          key,
          details: {
            aseguradora: merged.aseguradora,
            producto_codigo: merged.producto_codigo,
            cobertura_codigo: merged.cobertura_codigo,
            autoupdated_fields: merged.autoupdated_fields,
          },
        });
      }
      nextStore.records[key] = merged;
      changed = true;
    }
  }

  for (const [key, record] of Object.entries(nextStore.records)) {
    if (detectedMap.has(key)) continue;
    const normalizedRecord = recomputeRecordStatus(cloneRecord(record), nextStore.group_definitions);
    if (JSON.stringify(record || null) !== JSON.stringify(normalizedRecord)) {
      changed = true;
    }
    nextStore.records[key] = normalizedRecord;
  }

  if (changed || !fs.existsSync(STORE_PATH)) {
    writeStore(nextStore);
  }

  const items = sortCatalogItems(Object.values(nextStore.records || {}));
  const stats = buildCatalogStats(items);
  const index = new Map(items.map((item) => [item.key, item]));
  const payload = { items, index, stats, group_definitions: nextStore.group_definitions };
  catalogCache.signature = signature;
  catalogCache.payload = payload;
  return payload;
}

function getSeguros911ProductCatalog(options = {}) {
  return buildCatalogPayload(Boolean(options.force));
}

function buildCatalogKeyFromInput(aseguradora, productoCodigo, coberturaCodigo, productoDescripcion = '', coberturaDescripcion = '') {
  return buildRecordKey(aseguradora, productoCodigo, coberturaCodigo, productoDescripcion, coberturaDescripcion);
}

function applyManualBooleanGroup(target, sourceTarget, nextValues = {}, fields = []) {
  for (const field of fields) {
    if (!(field in nextValues)) continue;
    const raw = nextValues[field];
    if (raw == null || raw === '') {
      target[field] = null;
      sourceTarget[field] = '';
      continue;
    }
    target[field] = raw === true || raw === 'true' || raw === 1 || raw === '1';
    sourceTarget[field] = 'manual';
  }
}

function updateSeguros911CatalogRecord(input = {}, actor = {}) {
  const catalog = getSeguros911ProductCatalog();
  const store = getStore();
  const slug = String(input.aseguradora || '').trim().toLowerCase();
  const key = buildCatalogKeyFromInput(
    slug,
    input.producto_codigo,
    input.cobertura_codigo,
    input.producto_descripcion,
    input.cobertura_descripcion
  );
  if (!key) {
    throw new Error('No se pudo resolver la clave del registro');
  }

  const baseRecord = cloneRecord(
    (store.records && store.records[key])
    || (catalog.index && catalog.index.get(key))
    || createEmptyRecord({
      key,
      aseguradora: slug,
      producto_codigo: input.producto_codigo,
      cobertura_codigo: input.cobertura_codigo,
      producto_descripcion: input.producto_descripcion,
      cobertura_descripcion: input.cobertura_descripcion,
    })
  );

  const before = cloneRecord(baseRecord);
  if (input.display_group_code !== undefined) {
    baseRecord.display_group_code = resolveCanonicalGroupCode(baseRecord, input.display_group_code);
    baseRecord.sources.display_group_code = baseRecord.display_group_code ? 'manual' : '';
  }
  if (input.summary_flags && typeof input.summary_flags === 'object') {
    applyManualBooleanGroup(baseRecord.summary_flags, baseRecord.sources.summary_flags, input.summary_flags, SUMMARY_FIELDS);
  }
  if (input.indicators && typeof input.indicators === 'object') {
    applyManualBooleanGroup(baseRecord.indicators, baseRecord.sources.indicators, input.indicators, INDICATOR_FIELDS);
  }

  baseRecord.autoupdated = false;
  baseRecord.autoupdated_fields = [];
  baseRecord.last_manual_update_at = new Date().toISOString();
  baseRecord.last_manual_update_by = String(actor?.id || '').trim();
  baseRecord.last_manual_update_by_name = String(actor?.name || '').trim();
  const after = recomputeRecordStatus(baseRecord, store.group_definitions);

  store.records = store.records || {};
  store.records[key] = after;
  writeStore(store);
  invalidateSeguros911CatalogCache();

  appendCatalogActivity({
    actor_type: 'user',
    actor_id: actor?.id || '',
    actor_name: actor?.name || '',
    event: 'seguros911_product_manual_update',
    key,
    before,
    after,
  });

  return after;
}

function updateSeguros911GroupDefinitions(definitions = [], actor = {}) {
  const store = getStore();
  const before = normalizeGroupDefinitions(store.group_definitions);
  const nextDefinitions = normalizeGroupDefinitions(definitions);
  store.group_definitions = nextDefinitions;
  store.records = Object.fromEntries(
    Object.entries(store.records || {}).map(([key, record]) => [key, recomputeRecordStatus(cloneRecord(record), nextDefinitions)])
  );
  writeStore(store);
  invalidateSeguros911CatalogCache();

  appendCatalogActivity({
    actor_type: 'user',
    actor_id: actor?.id || '',
    actor_name: actor?.name || '',
    event: 'seguros911_group_definitions_updated',
    before,
    after: nextDefinitions,
  });

  return nextDefinitions;
}

function summarizeProcessCatalog(resumen = {}, catalogIndex = null) {
  const index = catalogIndex || getSeguros911ProductCatalog().index;
  const keys = new Set();
  for (const [slug, entries] of Object.entries(resumen?.resultados || {})) {
    const arr = Array.isArray(entries) ? entries : [];
    for (const item of arr) {
      if (!item || item.ok !== true) continue;
      const coberturas = Array.isArray(item.coberturas) ? item.coberturas : [];
      for (const cobertura of coberturas) {
        const identity = extractIdentity(slug, cobertura);
        if (!identity.key || !index.has(identity.key)) continue;
        keys.add(identity.key);
      }
    }
  }
  const matched = [...keys].map((key) => index.get(key)).filter(Boolean);
  return {
    total: matched.length,
    pending: matched.filter((item) => item.pending_review).length,
    autoupdated: matched.filter((item) => item.autoupdated).length,
    needs_attention: matched.some((item) => item.pending_review || item.autoupdated),
  };
}

function decorateResumenWithCatalog(resumen = {}, options = {}) {
  const payload = getSeguros911ProductCatalog({ force: Boolean(options.forceCatalogRefresh) });
  const cloned = JSON.parse(JSON.stringify(resumen || {}));
  for (const [slug, entries] of Object.entries(cloned.resultados || {})) {
    const arr = Array.isArray(entries) ? entries : [];
    for (const item of arr) {
      if (!item || item.ok !== true) continue;
      const coberturas = Array.isArray(item.coberturas) ? item.coberturas : [];
      for (const cobertura of coberturas) {
        const identity = extractIdentity(slug, cobertura);
        const record = payload.index.get(identity.key);
        if (!record) continue;
        cobertura.seguros911_visual = {
          key: record.key,
          display_group: {
            code: record.display_group_code,
            description: record.display_group_description,
          },
          summary: buildDisplaySummary(record),
          indicators: Object.fromEntries(INDICATOR_FIELDS.map((field) => [field, record.indicators[field] === true])),
          details: buildDisplayDetails(record),
          pending_review: Boolean(record.pending_review),
          autoupdated: Boolean(record.autoupdated),
        };
      }
    }
  }
  cloned.seguros911_catalog_summary = summarizeProcessCatalog(cloned, payload.index);
  return cloned;
}

module.exports = {
  ACTIVITY_LOG_PATH,
  DETAIL_FIELDS,
  DISPLAY_GROUP_CHOICES,
  DISPLAY_GROUP_LABELS,
  DISPLAY_GROUP_ORDER,
  INDICATOR_FIELDS,
  INDICATOR_FIELD_LABELS,
  STORE_PATH,
  SUMMARY_FIELDS,
  SUMMARY_FIELD_LABELS,
  buildCatalogKeyFromInput,
  buildDetectedRecord,
  buildDisplayDetails,
  buildDisplaySummary,
  decorateResumenWithCatalog,
  getSeguros911ProductCatalog,
  invalidateSeguros911CatalogCache,
  normalizeText,
  summarizeProcessCatalog,
  updateSeguros911CatalogRecord,
  updateSeguros911GroupDefinitions,
};

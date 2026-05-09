const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(process.cwd(), 'data', 'diccionarios', 'rastreo_sistemas.json');

let catalogCache = null;

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadCatalog() {
  if (catalogCache) return catalogCache;
  catalogCache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return catalogCache;
}

function pick(values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function buildAliasIndex(catalog) {
  const index = new Map();
  for (const [key, entry] of Object.entries(catalog.sistemas || {})) {
    index.set(normalizeText(key), key);
    index.set(normalizeText(entry?.label), key);
    for (const alias of entry?.aliases || []) {
      index.set(normalizeText(alias), key);
    }
  }
  return index;
}

function canonicalTrackingSystem(value, catalog = loadCatalog()) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const index = buildAliasIndex(catalog);
  return index.get(raw) || raw.replace(/\s+/g, '_');
}

function resolveTrackingInput(cabecera = {}, catalog = loadCatalog()) {
  const explicitSystem = pick([
    cabecera?.rastreo_sistema,
    cabecera?.rastreoSistema,
    cabecera?.sistema_rastreo,
    cabecera?.sistemaRastreo,
    cabecera?.rastreador_sistema,
    cabecera?.rastreadorSistema,
  ]);
  const rawRastreo = pick([cabecera?.rastreo, cabecera?.rastreador]);
  const canonicalSystem = canonicalTrackingSystem(explicitSystem, catalog);
  const canonicalRastreo = canonicalTrackingSystem(rawRastreo, catalog);

  if (canonicalSystem === 'sin_rastreo') {
    return {
      hasTracking: false,
      system: 'sin_rastreo',
      source: 'rastreo_sistema',
    };
  }

  if (canonicalSystem) {
    return {
      hasTracking: true,
      system: canonicalSystem,
      source: 'rastreo_sistema',
    };
  }

  if (canonicalRastreo === 'sin_rastreo') {
    return {
      hasTracking: false,
      system: 'sin_rastreo',
      source: 'rastreo',
    };
  }

  if (canonicalRastreo && canonicalRastreo !== 'sin_rastreo') {
    return {
      hasTracking: true,
      system: catalog.default_sin_especificar || 'sin_especificar',
      source: 'rastreo',
    };
  }

  return {
    hasTracking: false,
    system: 'sin_rastreo',
    source: 'default',
  };
}

function resolveCompanyTracking(cabecera = {}, company, cfg = {}, catalog = loadCatalog()) {
  const input = resolveTrackingInput(cabecera, catalog);
  const companyCfg = catalog.companias?.[company] || {};
  const map = companyCfg.mapeo || {};
  const configuredDefault = pick([
    cfg?.parametros_extras?.rastreo_sistema_default,
    cfg?.parametros_extras?.rastreoSistemaDefault,
  ]);
  const defaultSystem = canonicalTrackingSystem(configuredDefault, catalog) ||
    companyCfg.default_sin_especificar ||
    catalog.default_sin_especificar ||
    'sin_especificar';
  const effectiveSystem = input.hasTracking && input.system === 'sin_especificar'
    ? defaultSystem
    : input.system;
  const mappedValue = Object.prototype.hasOwnProperty.call(map, effectiveSystem)
    ? map[effectiveSystem]
    : map['*'];

  return {
    ...input,
    company,
    effectiveSystem,
    mappedValue,
    defaultApplied: input.hasTracking && input.system === 'sin_especificar',
  };
}

module.exports = {
  canonicalTrackingSystem,
  loadCatalog,
  resolveCompanyTracking,
  resolveTrackingInput,
};

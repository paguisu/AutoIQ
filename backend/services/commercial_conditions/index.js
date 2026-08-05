const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { buildDefaultStore } = require('./defaults');

const ROLE_RANK = {
  vendedor: 10,
  usuario_generico: 10,
  supervisor: 20,
  superadmin: 30,
};

function defaultDataRoot() {
  return path.join(process.cwd(), 'data');
}

function commercialRoot(dataRoot = defaultDataRoot()) {
  return path.join(dataRoot, 'commercial_conditions');
}

function storePath(dataRoot = defaultDataRoot()) {
  return path.join(commercialRoot(dataRoot), 'store.json');
}

function auditPath(dataRoot = defaultDataRoot()) {
  return path.join(commercialRoot(dataRoot), 'audit.log.jsonl');
}

function ensureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

function readJson(absPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(absPath, value) {
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeCode(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeRole(role) {
  return normalizeCode(role || 'usuario_generico');
}

function normalizeBool(value) {
  if (value === true || value === false) return value;
  const text = normalizeCode(value);
  if (['true', '1', 'si', 'sí', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return false;
}

function pickFirst(values = []) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function roleRank(role) {
  return ROLE_RANK[normalizeRole(role)] || 0;
}

const CABECERA_CONCEPT_RESOLVERS = {
  medio_pago: (cabecera) => pickFirst([
    cabecera?.medio_pago,
    cabecera?.medioPago,
    cabecera?.forma_pago,
    cabecera?.formaPago,
  ]),
  rastreador_alarma: (cabecera) => {
    const system = pickFirst([
      cabecera?.rastreo_sistema,
      cabecera?.rastreoSistema,
      cabecera?.sistema_rastreo,
      cabecera?.sistemaRastreo,
      cabecera?.rastreador_sistema,
      cabecera?.rastreadorSistema,
    ]);
    if (system) return system;
    const raw = pickFirst([cabecera?.rastreo, cabecera?.rastreador]);
    if (raw === '') return '';
    return normalizeBool(raw) || ['1', 's', 'si', 'sí', 'true', 'con'].includes(normalizeCode(raw))
      ? 'Con Rastreador/Alarma'
      : 'Sin Rastreador/Alarma';
  },
  gnc: (cabecera) => {
    const raw = pickFirst([cabecera?.gnc, cabecera?.GNC]);
    if (raw === '') return '';
    return normalizeBool(raw) || String(raw).trim() === '1' ? 'Con GNC' : 'Sin GNC';
  },
  uso: (cabecera) => pickFirst([
    cabecera?.uso,
    cabecera?.uso_default,
    cabecera?.tipo_uso,
    cabecera?.tipoUso,
  ]),
};

const CABECERA_VALUE_ALIASES = {
  medio_pago: {
    tc: 'Tarjeta de crédito',
    tarjeta: 'Tarjeta de crédito',
    tarjeta_credito: 'Tarjeta de crédito',
    tarjeta_de_credito: 'Tarjeta de crédito',
    credito: 'Tarjeta de crédito',
    cbu: 'CBU / débito en cuenta',
    debito: 'CBU / débito en cuenta',
    debito_cuenta: 'CBU / débito en cuenta',
    debito_en_cuenta: 'CBU / débito en cuenta',
  },
  uso: {
    1: 'Particular',
    particular: 'Particular',
  },
};

function normalizeCabeceraAlias(conceptCode, rawValue) {
  const text = String(rawValue == null ? '' : rawValue).trim();
  if (!text) return text;
  const aliases = CABECERA_VALUE_ALIASES[normalizeCode(conceptCode)];
  if (!aliases) return text;
  return aliases[normalizeCode(text)] || text;
}

function normalizeSourceValue(store, companySlug, conceptCode, rawValue, source, extra = {}) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const text = String(rawValue).trim();
  const comparableText = source === 'cabecera' ? normalizeCabeceraAlias(conceptCode, text) : text;
  const options = getOptions(store, companySlug, conceptCode);
  const normalizedText = normalizeCode(comparableText);
  const selected = options.find((option) => (
    normalizeCode(option.visible_label) === normalizedText ||
    normalizeCode(option.ws_code) === normalizedText
  ));
  const fallbackValue = !selected
    ? getDefaultValue(store, companySlug, conceptCode)
    : null;
  const selectedFallback = fallbackValue && (
    normalizeCode(fallbackValue.visible_value) === normalizedText ||
    normalizeCode(fallbackValue.ws_code) === normalizedText
  )
    ? fallbackValue
    : null;
  const matched = selected || selectedFallback;
  if (matched) {
    return {
      owner_type: source,
      owner_id: source,
      company_slug: normalizeCode(companySlug),
      concept_code: normalizeCode(conceptCode),
      visible_value: matched.visible_label || matched.visible_value,
      ws_code: matched.ws_code ?? null,
      numeric_value: matched.numeric_value ?? null,
      source,
      raw_value: text,
      ...extra,
    };
  }
  return {
    owner_type: source,
    owner_id: source,
    company_slug: normalizeCode(companySlug),
    concept_code: normalizeCode(conceptCode),
    visible_value: comparableText,
    ws_code: null,
    numeric_value: parseNumeric(comparableText),
    source,
    raw_value: text,
    unmatched_option: options.length > 0,
    ...extra,
  };
}

function getCabeceraCommercialValue(store, companySlug, conceptCode, cabecera = {}) {
  const resolver = CABECERA_CONCEPT_RESOLVERS[normalizeCode(conceptCode)];
  if (!resolver) return null;
  const rawValue = resolver(cabecera);
  return normalizeSourceValue(store, companySlug, conceptCode, rawValue, 'cabecera');
}

function canRole(role, minRole) {
  if (!minRole) return true;
  return roleRank(role) >= roleRank(minRole);
}

function normalizeStore(raw) {
  const seed = buildDefaultStore();
  const store = raw && typeof raw === 'object' ? raw : seed;
  let companies = mergeByKey(seed.companies, store.companies, (item) => normalizeCode(item.slug || item.id));
  const concepts = mergeByKey(seed.concepts, store.concepts, (item) => normalizeCode(item.code || item.id));
  const profiles = mergeByKey(seed.profiles, store.profiles, (item) => normalizeCode(item.id || item.code));
  let values = mergeByKey(seed.values, store.values, (item) => [
    item.owner_type,
    item.owner_id,
    normalizeCode(item.company_slug),
    normalizeCode(item.concept_code),
  ].join(':'));
  let options = mergeByKey(seed.options || [], store.options || [], (item) => [
    normalizeCode(item.company_slug),
    normalizeCode(item.concept_code),
    String(item.visible_label ?? '').trim(),
    String(item.ws_code ?? '').trim(),
  ].join(':'));
  let overrideRules = mergeByKey(seed.override_rules, store.override_rules, (item) => [
    normalizeCode(item.company_slug),
    normalizeCode(item.concept_code),
  ].join(':'));
  let wsMappings = mergeByKey(seed.ws_mappings, store.ws_mappings, (item) => [
    normalizeCode(item.company_slug),
    normalizeCode(item.concept_code),
    normalizeCode(item.ws_field),
  ].join(':'));
  if (Number(store.version || 0) < 2) {
    values = migrateSeededConcept(values, seed.values, 'medio_pago');
    options = migrateSeededConcept(options, seed.options || [], 'medio_pago');
  }
  if (Number(store.version || 0) < 3) {
    values = migrateSeededConcept(values, seed.values, 'origen_pago');
    options = migrateSeededConcept(options, seed.options || [], 'origen_pago');
  }
  if (Number(store.version || 0) < 7) {
    values = migrateSeededConcept(values, seed.values, 'vigencia_poliza');
    options = migrateSeededConcept(options, seed.options || [], 'vigencia_poliza');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'vigencia_poliza');
  }
  if (Number(store.version || 0) < 8) {
    values = migrateSeededConcept(values, seed.values, 'rastreador_alarma');
    options = migrateSeededConcept(options, seed.options || [], 'rastreador_alarma');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'rastreador_alarma');
    values = migrateSeededConcept(values, seed.values, 'prestador_satelital');
    options = migrateSeededConcept(options, seed.options || [], 'prestador_satelital');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'prestador_satelital');
  }
  if (Number(store.version || 0) < 9) {
    values = migrateSeededConcept(values, seed.values, 'uso');
    options = migrateSeededConcept(options, seed.options || [], 'uso');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'uso');
  }
  if (Number(store.version || 0) < 10) {
    values = migrateSeededConcept(values, seed.values, 'refacturacion');
    options = migrateSeededConcept(options, seed.options || [], 'refacturacion');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'refacturacion');
    values = migrateSeededConcept(values, seed.values, 'cuotas');
    options = migrateSeededConcept(options, seed.options || [], 'cuotas');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'cuotas');
  }
  if (Number(store.version || 0) < 11) {
    companies = migrateSeededCompanies(companies, seed.companies);
    values = migrateSeededConcept(values, seed.values, 'rastreador_alarma');
    options = migrateSeededConcept(options, seed.options || [], 'rastreador_alarma');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'rastreador_alarma');
  }
  if (Number(store.version || 0) < 12) {
    values = migrateSeededConcept(values, seed.values, 'uso');
    options = migrateSeededConcept(options, seed.options || [], 'uso');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'uso');
    values = migrateSeededConcept(values, seed.values, 'tipo_vehiculo');
    options = migrateSeededConcept(options, seed.options || [], 'tipo_vehiculo');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'tipo_vehiculo');
  }
  if (Number(store.version || 0) < 13) {
    values = migrateSeededConcept(values, seed.values, 'tipo_vehiculo');
    options = migrateSeededConcept(options, seed.options || [], 'tipo_vehiculo');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'tipo_vehiculo');
  }
  if (Number(store.version || 0) < 14) {
    values = migrateSeededConcept(values, seed.values, 'gnc');
    options = migrateSeededConcept(options, seed.options || [], 'gnc');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'gnc');
  }
  if (Number(store.version || 0) < 15) {
    values = migrateSeededConcept(values, seed.values, 'gnc');
    options = migrateSeededConcept(options, seed.options || [], 'gnc');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'gnc');
  }
  if (Number(store.version || 0) < 16) {
    values = migrateSeededConcept(values, seed.values, 'clausula_ajuste');
    options = migrateSeededConcept(options, seed.options || [], 'clausula_ajuste');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'clausula_ajuste');
  }
  if (Number(store.version || 0) < 17) {
    values = migrateSeededConcept(values, seed.values, 'clausula_ajuste');
    options = migrateSeededConcept(options, seed.options || [], 'clausula_ajuste');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'clausula_ajuste');
  }
  if (Number(store.version || 0) < 18) {
    values = migrateSeededConcept(values, seed.values, 'clausula_ajuste');
    options = migrateSeededConcept(options, seed.options || [], 'clausula_ajuste');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'clausula_ajuste');
  }
  if (Number(store.version || 0) < 19) {
    values = migrateSeededConcept(values, seed.values, 'variacion_32080');
    options = migrateSeededConcept(options, seed.options || [], 'variacion_32080');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'variacion_32080');
  }
  if (Number(store.version || 0) < 20) {
    values = migrateSeededConceptPreservingUserValues(values, seed.values, 'descuento_comercial');
    options = migrateSeededConcept(options, seed.options || [], 'descuento_comercial');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'descuento_comercial');
  }
  if (Number(store.version || 0) < 21) {
    values = migrateSeededConcept(values, seed.values, 'coeficiente_rc');
    values = migrateSeededConcept(values, seed.values, 'coeficiente_casco');
    options = migrateSeededConcept(options, seed.options || [], 'coeficiente_rc');
    options = migrateSeededConcept(options, seed.options || [], 'coeficiente_casco');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'coeficiente_rc');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'coeficiente_casco');
  }
  if (Number(store.version || 0) < 22) {
    values = migrateSeededConcept(values, seed.values, 'comision');
    options = migrateSeededConcept(options, seed.options || [], 'comision');
    overrideRules = migrateSeededConcept(overrideRules, seed.override_rules || [], 'comision');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'comision');
  }
  if (Number(store.version || 0) < 23) {
    for (const concept of ['rastreador_alarma', 'prestador_satelital', 'garage_guardado', 'asistencia', 'plan_comercial']) {
      values = migrateSeededConcept(values, seed.values, concept);
      options = migrateSeededConcept(options, seed.options || [], concept);
      overrideRules = migrateSeededConcept(overrideRules, seed.override_rules || [], concept);
      wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], concept);
    }
  }
  if (Number(store.version || 0) < 24) {
    values = migrateSeededConcept(values, seed.values, 'rastreador_alarma');
    options = migrateSeededConcept(options, seed.options || [], 'rastreador_alarma');
    wsMappings = migrateSeededConcept(wsMappings, seed.ws_mappings || [], 'rastreador_alarma');
  }
  return {
    version: Math.max(Number(store.version || 0), Number(seed.version || 1)),
    updated_at: store.updated_at || new Date().toISOString(),
    companies,
    concepts,
    profiles,
    users: Array.isArray(store.users) ? store.users : seed.users,
    user_company_settings: Array.isArray(store.user_company_settings) ? store.user_company_settings : [],
    values,
    options,
    override_rules: overrideRules,
    ws_mappings: wsMappings,
    quote_overrides: Array.isArray(store.quote_overrides) ? store.quote_overrides : [],
  };
}

function migrateSeededConcept(currentItems, seedItems, conceptCode) {
  const normalizedConcept = normalizeCode(conceptCode);
  return [
    ...currentItems.filter((item) => normalizeCode(item.concept_code) !== normalizedConcept),
    ...seedItems.filter((item) => normalizeCode(item.concept_code) === normalizedConcept),
  ];
}

function migrateSeededConceptPreservingUserValues(currentItems, seedItems, conceptCode) {
  const normalizedConcept = normalizeCode(conceptCode);
  return [
    ...currentItems.filter((item) => (
      normalizeCode(item.concept_code) !== normalizedConcept ||
      item.owner_type === 'user'
    )),
    ...seedItems.filter((item) => normalizeCode(item.concept_code) === normalizedConcept),
  ];
}

function migrateSeededCompanies(currentItems, seedItems) {
  const bySlug = new Map((seedItems || []).map((item) => [normalizeCode(item.slug || item.id), item]));
  return (currentItems || []).map((item) => {
    const seeded = bySlug.get(normalizeCode(item.slug || item.id));
    return seeded ? { ...item, display_order: seeded.display_order } : item;
  });
}

function mergeByKey(seedItems = [], storedItems = [], keyFn) {
  const map = new Map();
  for (const item of seedItems) {
    if (item && typeof item === 'object') map.set(keyFn(item), item);
  }
  for (const item of Array.isArray(storedItems) ? storedItems : []) {
    if (item && typeof item === 'object') map.set(keyFn(item), item);
  }
  return Array.from(map.values());
}

function loadStore(options = {}) {
  const absPath = storePath(options.dataRoot);
  const existing = readJson(absPath, null);
  if (existing) {
    const normalized = normalizeStore(existing);
    if (Number(normalized.version || 0) > Number(existing.version || 0)) {
      writeJson(absPath, normalized);
    }
    return normalized;
  }
  const seeded = buildDefaultStore();
  writeJson(absPath, seeded);
  return seeded;
}

function saveStore(store, options = {}) {
  const next = normalizeStore({
    ...store,
    updated_at: new Date().toISOString(),
  });
  writeJson(storePath(options.dataRoot), next);
  return next;
}

function appendAudit(event, options = {}) {
  ensureDir(commercialRoot(options.dataRoot));
  const line = {
    at: new Date().toISOString(),
    event: String(event?.event || '').trim(),
    actor_user_id: String(event?.actor_user_id || '').trim(),
    actor_role: String(event?.actor_role || '').trim(),
    entity_type: String(event?.entity_type || '').trim(),
    entity_id: String(event?.entity_id || '').trim(),
    details: event?.details || {},
  };
  fs.appendFileSync(auditPath(options.dataRoot), `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}

function activeCompanies(store, includeInactive = false) {
  return [...store.companies]
    .filter((company) => includeInactive || company.active !== false)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function getConcept(store, conceptCode) {
  const code = normalizeCode(conceptCode);
  return store.concepts.find((concept) => concept.code === code || concept.id === code) || null;
}

function getCompany(store, companySlug) {
  const slug = normalizeCode(companySlug);
  return store.companies.find((company) => company.slug === slug || company.id === slug) || null;
}

function getProfile(store, profileCodeOrId = 'default_seguros911') {
  const code = normalizeCode(profileCodeOrId);
  return store.profiles.find((profile) => (
    normalizeCode(profile.id) === code ||
    normalizeCode(profile.code) === code
  )) || store.profiles[0] || null;
}

function getUser(store, userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  return store.users.find((user) => String(user.id) === id || String(user.external_user_id) === id) || null;
}

function getCompanySetting(store, userId, companySlug) {
  return store.user_company_settings.find((setting) => (
    String(setting.user_id) === String(userId) &&
    normalizeCode(setting.company_slug) === normalizeCode(companySlug)
  )) || null;
}

function isInherited(store, userId, companySlug) {
  const setting = getCompanySetting(store, userId, companySlug);
  return !setting || setting.inherits_default !== false;
}

function findValue(store, { ownerType, ownerId, companySlug, conceptCode }) {
  return store.values.find((value) => (
    value.owner_type === ownerType &&
    String(value.owner_id) === String(ownerId) &&
    normalizeCode(value.company_slug) === normalizeCode(companySlug) &&
    normalizeCode(value.concept_code) === normalizeCode(conceptCode)
  )) || null;
}

function getDefaultValue(store, companySlug, conceptCode, profileId = 'default_seguros911') {
  const profile = getProfile(store, profileId);
  return findValue(store, {
    ownerType: 'profile',
    ownerId: profile?.id || 'default_seguros911',
    companySlug,
    conceptCode,
  });
}

function getEffectiveCommercialValue(store, params = {}) {
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const conceptCode = normalizeCode(params.concept_code || params.conceptCode);
  const userId = params.user_id || params.userId;
  const profile = getProfile(store, params.profile_id || params.profileCode || 'default_seguros911');

  if (params.quote_id || params.quoteId) {
    const quoteId = String(params.quote_id || params.quoteId);
    const quoteOverride = [...store.quote_overrides].reverse().find((override) => (
      String(override.quote_id) === quoteId &&
      normalizeCode(override.company_slug) === companySlug &&
      normalizeCode(override.concept_code) === conceptCode
    ));
    if (quoteOverride) {
      return { ...quoteOverride, source: 'quote_override' };
    }
  }

  if (userId && !isInherited(store, userId, companySlug)) {
    const userValue = findValue(store, {
      ownerType: 'user',
      ownerId: userId,
      companySlug,
      conceptCode,
    });
    if (userValue) return { ...userValue, source: 'user' };
  }

  const profileValue = getDefaultValue(store, companySlug, conceptCode, profile?.id);
  return profileValue ? { ...profileValue, source: 'profile' } : null;
}

function buildMatrix(store, params = {}) {
  const includeInactive = normalizeBool(params.include_inactive || params.includeInactive);
  const companies = activeCompanies(store, includeInactive);
  const userId = params.user_id || params.userId || null;
  const profile = getProfile(store, params.profile_id || params.profileCode || 'default_seguros911');

  const rows = store.concepts
    .filter((concept) => concept.active !== false)
    .map((concept) => {
      const cells = {};
      for (const company of companies) {
        const inherited = userId ? isInherited(store, userId, company.slug) : true;
        const effective = getEffectiveCommercialValue(store, {
          user_id: userId,
          profile_id: profile?.id,
          company_slug: company.slug,
          concept_code: concept.code,
        });
        const ownValue = userId ? findValue(store, {
          ownerType: 'user',
          ownerId: userId,
          companySlug: company.slug,
          conceptCode: concept.code,
        }) : null;
        const defaultValue = getDefaultValue(store, company.slug, concept.code, profile?.id);
        const options = getOptions(store, company.slug, concept.code);
        const applicable = isApplicable(store, company.slug, concept.code);
        cells[company.slug] = {
          applicable,
          inherited,
          editable: applicable && (!!userId ? !inherited : true),
          value: effective || null,
          own_value: ownValue || null,
          default_value: defaultValue || null,
          override_rule: getOverrideRule(store, company.slug, concept.code),
          mapping: getWsMapping(store, company.slug, concept.code),
          options,
        };
      }
      return {
        concept_code: concept.code,
        label: concept.label,
        group: concept.group,
        ui_type: concept.ui_type,
        cells,
      };
    });

  return { profile, user_id: userId, companies, rows };
}

function getOverrideRule(store, companySlug, conceptCode) {
  return store.override_rules.find((rule) => (
    normalizeCode(rule.company_slug) === normalizeCode(companySlug) &&
    normalizeCode(rule.concept_code) === normalizeCode(conceptCode)
  )) || null;
}

function getWsMapping(store, companySlug, conceptCode) {
  return store.ws_mappings.find((mapping) => (
    normalizeCode(mapping.company_slug) === normalizeCode(companySlug) &&
    normalizeCode(mapping.concept_code) === normalizeCode(conceptCode)
  )) || null;
}

function getOptions(store, companySlug, conceptCode) {
  return (Array.isArray(store.options) ? store.options : [])
    .filter((option) => (
      option.active !== false &&
      normalizeCode(option.company_slug) === normalizeCode(companySlug) &&
      normalizeCode(option.concept_code) === normalizeCode(conceptCode)
    ));
}

function isApplicable(store, companySlug, conceptCode) {
  return Boolean(
    getDefaultValue(store, companySlug, conceptCode) ||
    getOverrideRule(store, companySlug, conceptCode) ||
    getWsMapping(store, companySlug, conceptCode) ||
    getOptions(store, companySlug, conceptCode).length
  );
}

function hasOwnValues(store, userId, companySlug) {
  return store.values.some((value) => (
    value.owner_type === 'user' &&
    String(value.owner_id) === String(userId) &&
    normalizeCode(value.company_slug) === normalizeCode(companySlug)
  ));
}

function setInheritance(store, params = {}, actor = {}, options = {}) {
  const userId = String(params.user_id || params.userId || '').trim();
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const inheritsDefault = normalizeBool(params.inherits_default ?? params.inheritsDefault);
  if (!userId) {
    const err = new Error('user_id requerido');
    err.statusCode = 400;
    throw err;
  }
  if (!getCompany(store, companySlug)) {
    const err = new Error('Compañía inválida');
    err.statusCode = 400;
    throw err;
  }
  if (inheritsDefault && hasOwnValues(store, userId, companySlug) && !normalizeBool(params.confirm_overwrite || params.confirmOverwrite)) {
    const err = new Error('La compañía tiene parámetros propios. Confirmá overwrite para activar herencia.');
    err.statusCode = 409;
    err.code = 'CONFIRM_OVERWRITE_REQUIRED';
    throw err;
  }

  store.user_company_settings = store.user_company_settings.filter((setting) => !(
    String(setting.user_id) === userId &&
    normalizeCode(setting.company_slug) === companySlug
  ));
  store.user_company_settings.push({
    user_id: userId,
    company_slug: companySlug,
    inherits_default: inheritsDefault,
    inherited_profile_id: 'default_seguros911',
    updated_by: actor.user_id || '',
    updated_at: new Date().toISOString(),
  });

  if (inheritsDefault) {
    store.values = store.values.filter((value) => !(
      value.owner_type === 'user' &&
      String(value.owner_id) === userId &&
      normalizeCode(value.company_slug) === companySlug
    ));
  }

  appendAudit({
    event: 'commercial_conditions.inheritance.updated',
    actor_user_id: actor.user_id,
    actor_role: actor.role,
    entity_type: 'user_company_setting',
    entity_id: `${userId}:${companySlug}`,
    details: { inherits_default: inheritsDefault },
  }, options);

  return store;
}

function parseNumeric(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace('%', '').replace(',', '.').trim();
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function validateRange(rule, numericValue) {
  if (!rule || numericValue == null) return;
  if (rule.min != null && numericValue < Number(rule.min)) {
    const err = new Error(`Valor menor al mínimo permitido (${rule.min})`);
    err.statusCode = 400;
    throw err;
  }
  if (rule.max != null && numericValue > Number(rule.max)) {
    const err = new Error(`Valor mayor al máximo permitido (${rule.max})`);
    err.statusCode = 400;
    throw err;
  }
}

function validateOption(store, change) {
  const options = getOptions(store, change.company_slug, change.concept_code);
  if (!options.length) return;
  const selected = options.find((option) => (
    String(option.visible_label) === String(change.visible_value) ||
    (change.ws_code != null && String(option.ws_code) === String(change.ws_code))
  ));
  if (!selected) {
    const err = new Error(`Valor no permitido para ${change.company_slug}/${change.concept_code}`);
    err.statusCode = 400;
    throw err;
  }
  change.visible_value = selected.visible_label;
  change.ws_code = selected.ws_code ?? null;
  change.numeric_value = selected.numeric_value ?? change.numeric_value;
}

function normalizeQuoteOverrideOption(store, change) {
  validateOption(store, change);
  return change;
}

function normalizeValueChange(change = {}) {
  const companySlug = normalizeCode(change.company_slug || change.companySlug);
  const conceptCode = normalizeCode(change.concept_code || change.conceptCode);
  return {
    company_slug: companySlug,
    concept_code: conceptCode,
    visible_value: String(change.visible_value ?? change.visibleValue ?? '').trim(),
    ws_code: change.ws_code ?? change.wsCode ?? null,
    numeric_value: change.numeric_value ?? change.numericValue ?? parseNumeric(change.visible_value ?? change.visibleValue),
  };
}

function saveValues(store, params = {}, actor = {}, options = {}) {
  const ownerType = normalizeCode(params.owner_type || params.ownerType || 'user');
  const ownerId = String(params.owner_id || params.ownerId || '').trim();
  const changes = Array.isArray(params.changes) ? params.changes : [];
  if (!['user', 'profile'].includes(ownerType)) {
    const err = new Error('owner_type inválido');
    err.statusCode = 400;
    throw err;
  }
  if (!ownerId) {
    const err = new Error('owner_id requerido');
    err.statusCode = 400;
    throw err;
  }

  const normalizedChanges = changes.map(normalizeValueChange);
  for (const change of normalizedChanges) {
    if (!getCompany(store, change.company_slug)) {
      const err = new Error(`Compañía inválida: ${change.company_slug}`);
      err.statusCode = 400;
      throw err;
    }
    if (!getConcept(store, change.concept_code)) {
      const err = new Error(`Concepto inválido: ${change.concept_code}`);
      err.statusCode = 400;
      throw err;
    }
    if (!isApplicable(store, change.company_slug, change.concept_code)) {
      const err = new Error(`El parámetro ${change.concept_code} no aplica para ${change.company_slug}`);
      err.statusCode = 400;
      throw err;
    }
    if (ownerType === 'user' && isInherited(store, ownerId, change.company_slug)) {
      const err = new Error(`No se puede editar ${change.company_slug}: la compañía hereda defaults`);
      err.statusCode = 409;
      throw err;
    }
    validateOption(store, change);
    validateRange(getOverrideRule(store, change.company_slug, change.concept_code), change.numeric_value);
  }

  for (const change of normalizedChanges) {
    store.values = store.values.filter((value) => !(
      value.owner_type === ownerType &&
      String(value.owner_id) === ownerId &&
      normalizeCode(value.company_slug) === change.company_slug &&
      normalizeCode(value.concept_code) === change.concept_code
    ));
    store.values.push({
      owner_type: ownerType,
      owner_id: ownerId,
      ...change,
      source: 'api',
      updated_by: actor.user_id || '',
      updated_at: new Date().toISOString(),
    });
  }

  appendAudit({
    event: 'commercial_conditions.values.saved',
    actor_user_id: actor.user_id,
    actor_role: actor.role,
    entity_type: ownerType,
    entity_id: ownerId,
    details: { changes: normalizedChanges },
  }, options);
  return store;
}

function validateQuoteOverride(store, params = {}, actor = {}) {
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const conceptCode = normalizeCode(params.concept_code || params.conceptCode);
  const role = normalizeRole(params.role || actor.role || 'vendedor');
  const numericValue = params.numeric_value ?? params.numericValue ?? parseNumeric(params.visible_value ?? params.visibleValue);
  const rule = getOverrideRule(store, companySlug, conceptCode);
  if (!rule || rule.allowed !== true) {
    return { allowed: false, reason: 'Override no permitido para la compañía/concepto', rule: rule || null };
  }
  if (!canRole(role, rule.min_role)) {
    return { allowed: false, reason: `Rol insuficiente. Requiere ${rule.min_role}`, rule };
  }
  try {
    const change = normalizeValueChange(params);
    normalizeQuoteOverrideOption(store, change);
    validateRange(rule, change.numeric_value ?? numericValue);
  } catch (err) {
    return { allowed: false, reason: err.message, rule };
  }
  return { allowed: true, reason: '', rule };
}

function addQuoteOverride(store, params = {}, actor = {}, options = {}) {
  const validation = validateQuoteOverride(store, params, actor);
  if (!validation.allowed) {
    const err = new Error(validation.reason);
    err.statusCode = 400;
    err.validation = validation;
    throw err;
  }
  const quoteId = String(params.quote_id || params.quoteId || '').trim();
  if (!quoteId) {
    const err = new Error('quote_id requerido');
    err.statusCode = 400;
    throw err;
  }
  const change = normalizeQuoteOverrideOption(store, normalizeValueChange(params));
  const override = {
    id: `${quoteId}:${change.company_slug}:${change.concept_code}:${Date.now()}`,
    quote_id: quoteId,
    source_system: params.source_system || params.sourceSystem || 'seguros911',
    ...change,
    requested_by_user_id: String(params.user_id || params.userId || actor.user_id || '').trim(),
    role_used: normalizeRole(params.role || actor.role || 'vendedor'),
    created_at: new Date().toISOString(),
  };
  store.quote_overrides.push(override);
  appendAudit({
    event: 'commercial_conditions.quote_override.created',
    actor_user_id: actor.user_id,
    actor_role: actor.role,
    entity_type: 'quote_override',
    entity_id: override.id,
    details: override,
  }, options);
  return override;
}

function buildEffectivePayload(store, params = {}) {
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const userId = params.user_id || params.userId || null;
  const quoteId = params.quote_id || params.quoteId || null;
  const values = {};
  for (const concept of store.concepts) {
    const resolved = getEffectiveCommercialValue(store, {
      user_id: userId,
      quote_id: quoteId,
      company_slug: companySlug,
      concept_code: concept.code,
    });
    if (resolved) values[concept.code] = resolved;
  }
  return {
    company_slug: companySlug,
    user_id: userId,
    quote_id: quoteId,
    values,
  };
}

function resolveCommercialConditions(store, params = {}) {
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const userId = params.user_id || params.userId || null;
  const quoteId = params.quote_id || params.quoteId || null;
  const profile = getProfile(store, params.profile_id || params.profileCode || 'default_seguros911');
  const cabecera = params.cabecera || {};
  const context = normalizeCode(params.context || params.source_system || params.sourceSystem || 'autoiq');
  const values = {};
  const diagnostics = [];

  for (const concept of store.concepts) {
    if (concept.active === false || !isApplicable(store, companySlug, concept.code)) continue;

    const effective = getEffectiveCommercialValue(store, {
      user_id: userId,
      quote_id: context === 'seguros911' ? quoteId : null,
      profile_id: profile?.id,
      company_slug: companySlug,
      concept_code: concept.code,
    });
    const cabeceraValue = context === 'autoiq'
      ? getCabeceraCommercialValue(store, companySlug, concept.code, cabecera)
      : null;
    const resolved = cabeceraValue || effective;
    if (!resolved) continue;

    const mapping = getWsMapping(store, companySlug, concept.code);
    const out = {
      concept_code: concept.code,
      concept_label: concept.label,
      visible_value: resolved.visible_value,
      ws_code: resolved.ws_code ?? null,
      numeric_value: resolved.numeric_value ?? null,
      source: resolved.source || 'profile',
      raw_value: resolved.raw_value ?? null,
      mapping: mapping ? {
        ws_field: mapping.ws_field,
        ws_code: mapping.ws_code,
        source: mapping.source,
      } : null,
      applies: true,
    };
    if (resolved.unmatched_option) {
      out.unmatched_option = true;
      diagnostics.push({
        concept_code: concept.code,
        level: 'warning',
        message: `Valor de cabecera sin opcion exacta para ${companySlug}/${concept.code}: ${resolved.raw_value}`,
      });
    }
    values[concept.code] = out;
  }

  return {
    company_slug: companySlug,
    user_id: userId,
    quote_id: quoteId,
    context,
    profile_id: profile?.id || null,
    values,
    diagnostics,
  };
}

function buildAllowedOverrides(store, params = {}) {
  const companySlug = normalizeCode(params.company_slug || params.companySlug);
  const role = normalizeRole(params.role || 'vendedor');
  return store.override_rules
    .filter((rule) => normalizeCode(rule.company_slug) === companySlug && rule.allowed === true)
    .map((rule) => {
      const concept = getConcept(store, rule.concept_code);
      return {
        ...rule,
        concept_label: concept?.label || rule.concept_code,
        allowed_for_role: canRole(role, rule.min_role),
        current_value: getEffectiveCommercialValue(store, {
          user_id: params.user_id || params.userId,
          company_slug: companySlug,
          concept_code: rule.concept_code,
        }),
      };
    });
}

function exportMatrixToWorkbook(store, params = {}) {
  const matrix = buildMatrix(store, params);
  const header = ['Grupo', 'Concepto', ...matrix.companies.map((company) => company.label)];
  const rows = [header];
  for (const row of matrix.rows) {
    rows.push([
      row.group,
      row.label,
      ...matrix.companies.map((company) => row.cells[company.slug]?.value?.visible_value || ''),
    ]);
  }
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), 'Condiciones');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  appendAudit,
  buildAllowedOverrides,
  buildEffectivePayload,
  buildMatrix,
  resolveCommercialConditions,
  exportMatrixToWorkbook,
  getEffectiveCommercialValue,
  getOverrideRule,
  loadStore,
  saveStore,
  saveValues,
  setInheritance,
  storePath,
  validateQuoteOverride,
  addQuoteOverride,
};

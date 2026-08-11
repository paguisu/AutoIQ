const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { fetchProvinciaToken } = require('./auth');
const { getApiKey, getBaseUrl } = require('./client');
const {
  buildProvinciaResponseError,
  runProvinciaRequest,
} = require('./http');

const catalogCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const DICTIONARY_TTL_DAYS = 180;
const DICTIONARY_TTL_MS = DICTIONARY_TTL_DAYS * 24 * 60 * 60 * 1000;
const persistentStoreCache = new Map();
const persistentWriteQueue = new Map();
const PERSISTENT_CACHE_FILES = {
  brand: 'brand_cache.json',
  model: 'model_cache.json',
};

function trimText(value) {
  return String(value || '').trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeProvinciaCatalogText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildModelComparableText(value) {
  return normalizeProvinciaCatalogText(value)
    .replace(/\bAUTOMATICA\b/g, ' AT ')
    .replace(/\bAUTOMATICO\b/g, ' AT ')
    .replace(/\bAUT\b/g, ' AT ')
    .replace(/\bMECANICA\b/g, ' MT ')
    .replace(/\bMANUAL\b/g, ' MT ')
    .replace(/\bS TRONIC\b/g, ' STRONIC ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripModelLineText(value) {
  return buildModelComparableText(value)
    .replace(/\bL\s+\d{2}\b/g, ' ')
    .replace(/\bLINEA\s+\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeComparableText(value) {
  const normalized = stripModelLineText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => trimText(value)).filter(Boolean))];
}

function dataPath(...segments) {
  return path.join(process.cwd(), 'data', ...segments);
}

function getProvinciaDictionaryDir() {
  return process.env.PROVINCIA_DICTIONARY_DIR
    ? path.resolve(process.env.PROVINCIA_DICTIONARY_DIR)
    : dataPath('provincia', 'diccionarios');
}

function getPersistentCachePath(kind) {
  const fileName = PERSISTENT_CACHE_FILES[kind];
  if (!fileName) throw new Error(`Provincia cache persistente desconocido: ${kind}`);
  return path.join(getProvinciaDictionaryDir(), fileName);
}

function defaultPersistentStore() {
  return {
    version: 1,
    ttl_days: DICTIONARY_TTL_DAYS,
    entries: {},
  };
}

function normalizePersistentStore(payload) {
  const entries = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.entries && typeof payload.entries === 'object'
    ? payload.entries
    : {};
  return {
    version: Number(payload?.version || 1),
    ttl_days: Number(payload?.ttl_days || DICTIONARY_TTL_DAYS),
    entries,
  };
}

async function loadPersistentStore(kind) {
  if (persistentStoreCache.has(kind)) return persistentStoreCache.get(kind);

  const filePath = getPersistentCachePath(kind);
  let store = defaultPersistentStore();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    store = normalizePersistentStore(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  persistentStoreCache.set(kind, store);
  return store;
}

async function savePersistentStore(kind, store) {
  persistentStoreCache.set(kind, store);
  const filePath = getPersistentCachePath(kind);
  const previous = persistentWriteQueue.get(kind) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    });
  persistentWriteQueue.set(kind, current);
  return current;
}

function buildBrandCacheKey({ ramo = '4', producto = '04100', brandText = '' } = {}) {
  const normalized = normalizeProvinciaCatalogText(brandText);
  return normalized ? [trimText(ramo), trimText(producto), normalized].join('|') : '';
}

function buildModelCacheKey({
  ramo = '4',
  producto = '04100',
  brandCode = '',
  anio = '',
  es0km = 'N',
  modelText = '',
} = {}) {
  const normalizedModel = buildModelComparableText(modelText);
  return normalizedModel
    ? [trimText(ramo), trimText(producto), trimText(brandCode), trimText(anio), trimText(es0km || 'N') || 'N', normalizedModel].join('|')
    : '';
}

function parseVerifiedAt(entry = {}) {
  const raw = trimText(entry?.last_verified_at || entry?.lastVerifiedAt);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPersistentEntryFresh(entry = {}) {
  const verifiedAt = parseVerifiedAt(entry);
  return verifiedAt > 0 && verifiedAt >= (Date.now() - DICTIONARY_TTL_MS);
}

function buildPersistentEntryPayload({ previous = null, payload = {} } = {}) {
  const now = new Date().toISOString();
  return {
    ...payload,
    first_verified_at: trimText(previous?.first_verified_at || previous?.firstVerifiedAt) || now,
    last_verified_at: now,
  };
}

function formatBrandCacheEntry(entry = {}, overrides = {}) {
  return {
    code: trimText(entry?.code),
    description: trimText(entry?.description),
    source: trimText(overrides.source || entry?.source || entry?.match_source || ''),
    matchSource: trimText(overrides.matchSource || entry?.match_source || ''),
    cacheState: trimText(overrides.cacheState || ''),
    firstVerifiedAt: trimText(entry?.first_verified_at || entry?.firstVerifiedAt),
    lastVerifiedAt: trimText(entry?.last_verified_at || entry?.lastVerifiedAt),
    warning: trimText(overrides.warning || ''),
  };
}

function formatModelCacheEntry(entry = {}, overrides = {}) {
  return {
    code: trimText(entry?.code),
    description: trimText(entry?.description),
    source: trimText(overrides.source || entry?.source || entry?.match_source || ''),
    matchSource: trimText(overrides.matchSource || entry?.match_source || ''),
    cacheState: trimText(overrides.cacheState || ''),
    firstVerifiedAt: trimText(entry?.first_verified_at || entry?.firstVerifiedAt),
    lastVerifiedAt: trimText(entry?.last_verified_at || entry?.lastVerifiedAt),
    warning: trimText(overrides.warning || ''),
  };
}

function buildCatalogRequestConfig(cfg = {}, tokenData = {}, timeoutMs = 30000) {
  const apiKey = getApiKey(cfg);
  if (!apiKey) throw new Error('Provincia catalogo requiere api_key configurado');

  return {
    params: { apikey: apiKey },
    headers: {
      Authorization: `${tokenData.tokenType || 'Bearer'} ${tokenData.accessToken}`,
      Accept: 'application/json',
      'x-api-key': apiKey,
      'x-apikey': apiKey,
      apikey: apiKey,
    },
    timeout: timeoutMs,
    validateStatus: () => true,
  };
}

function extractCatalogRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function buildCatalogErrorMessage(pathname, resp) {
  const body = resp?.data;
  const reason = trimText(
    body?.description ||
    body?.message ||
    body?.error ||
    body?.status ||
    `HTTP ${resp?.status || 0}`
  );
  return `Provincia catalogo ${pathname} fallo: ${reason}`;
}

async function provinciaCatalogGet(cfg = {}, pathname = '') {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) throw new Error('Provincia catalogo requiere base_url configurado');

  const cacheKey = `${baseUrl}|${pathname}`;
  const cached = catalogCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const rows = await runProvinciaRequest({
    cfg,
    prefix: 'catalog',
    defaultTimeoutMs: 45000,
    defaultRetries: 2,
    defaultRetryDelayMs: 1500,
    executor: async ({ timeoutMs }) => {
      const tokenData = await fetchProvinciaToken(cfg);
      const resp = await axios.get(
        `${baseUrl}${pathname}`,
        buildCatalogRequestConfig(cfg, tokenData, timeoutMs)
      );
      if (!(resp.status >= 200 && resp.status < 300)) {
        throw buildProvinciaResponseError(buildCatalogErrorMessage(pathname, resp), resp);
      }
      return extractCatalogRows(resp.data);
    },
  });

  catalogCache.set(cacheKey, {
    rows,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return rows;
}

async function fetchProvinciaYears(cfg = {}) {
  return provinciaCatalogGet(cfg, '/PS-COTIZACION/2.2/valores/anios');
}

async function fetchProvinciaBrands(cfg = {}, { ramo = '4', producto = '04100' } = {}) {
  return provinciaCatalogGet(cfg, `/PS-COTIZACION/2.2/valores/marcas/${encodeURIComponent(ramo)}/${encodeURIComponent(producto)}`);
}

async function fetchProvinciaModels(
  cfg = {},
  { ramo = '4', producto = '04100', marca = '', anio = '', es0km = 'N' } = {}
) {
  const normalizedBrand = trimText(marca);
  const normalizedYear = trimText(anio);
  const normalizedZeroKm = trimText(es0km || 'N') || 'N';
  if (!normalizedBrand) throw new Error('Provincia catalogo modelos requiere marca');
  if (!normalizedYear) throw new Error('Provincia catalogo modelos requiere anio');

  return provinciaCatalogGet(
    cfg,
    `/PS-COTIZACION/2.2/valores/modelo/${encodeURIComponent(ramo)}/${encodeURIComponent(producto)}/${encodeURIComponent(normalizedBrand)}/${encodeURIComponent(normalizedYear)}/${encodeURIComponent(normalizedZeroKm)}`
  );
}

async function resolveProvinciaBrand(
  cfg = {},
  {
    ramo = '4',
    producto = '04100',
    candidateTexts = [],
    candidateCodes = [],
    fetchBrands = fetchProvinciaBrands,
  } = {}
) {
  const store = await loadPersistentStore('brand');
  const keys = uniqueStrings(candidateTexts)
    .map((brandText) => buildBrandCacheKey({ ramo, producto, brandText }))
    .filter(Boolean);

  for (const key of keys) {
    const entry = store.entries[key];
    if (entry && isPersistentEntryFresh(entry)) {
      return formatBrandCacheEntry(entry, {
        source: 'dictionary_cache_fresh',
        cacheState: 'fresh',
      });
    }
  }

  const staleEntry = keys
    .map((key) => store.entries[key])
    .find((entry) => entry && trimText(entry?.code));

  try {
    const brands = await fetchBrands(cfg, { ramo, producto });
    const match = findProvinciaBrandCandidate({
      brands,
      candidateTexts,
      candidateCodes,
    });
    if (!match?.item?.codigo) return null;

    const payload = buildPersistentEntryPayload({
      previous: staleEntry,
      payload: {
        code: trimText(match.item.codigo),
        description: trimText(match.item.descripcion),
        match_source: trimText(match.source),
        ramo: trimText(ramo),
        producto: trimText(producto),
      },
    });

    for (const key of keys) {
      store.entries[key] = payload;
    }
    await savePersistentStore('brand', store).catch(() => {});

    return formatBrandCacheEntry(payload, {
      source: trimText(match.source),
      matchSource: trimText(match.source),
      cacheState: staleEntry ? 'revalidated' : 'miss',
    });
  } catch (error) {
    if (staleEntry) {
      return formatBrandCacheEntry(staleEntry, {
        source: 'dictionary_cache_stale_fallback',
        matchSource: trimText(staleEntry?.match_source),
        cacheState: 'stale_fallback',
        warning: error?.message || '',
      });
    }
    throw error;
  }
}

async function resolveProvinciaModel(
  cfg = {},
  {
    ramo = '4',
    producto = '04100',
    brandCode = '',
    anio = '',
    es0km = 'N',
    candidateTexts = [],
    candidateCodes = [],
    fetchModels = fetchProvinciaModels,
  } = {}
) {
  const store = await loadPersistentStore('model');
  const keys = uniqueStrings(candidateTexts)
    .map((modelText) => buildModelCacheKey({
      ramo,
      producto,
      brandCode,
      anio,
      es0km,
      modelText,
    }))
    .filter(Boolean);

  for (const key of keys) {
    const entry = store.entries[key];
    if (entry && isPersistentEntryFresh(entry)) {
      return formatModelCacheEntry(entry, {
        source: 'dictionary_cache_fresh',
        cacheState: 'fresh',
      });
    }
  }

  const staleEntry = keys
    .map((key) => store.entries[key])
    .find((entry) => entry && trimText(entry?.code));

  try {
    const models = await fetchModels(cfg, {
      ramo,
      producto,
      marca: brandCode,
      anio,
      es0km,
    });
    const match = findProvinciaModelCandidate({
      models,
      candidateTexts,
      candidateCodes,
    });
    if (!match?.item?.codigo) return match || null;

    const payload = buildPersistentEntryPayload({
      previous: staleEntry,
      payload: {
        code: trimText(match.item.codigo),
        description: trimText(match.item.descripcion),
        match_source: trimText(match.source),
        ramo: trimText(ramo),
        producto: trimText(producto),
        brand_code: trimText(brandCode),
        anio: trimText(anio),
        es0km: trimText(es0km || 'N') || 'N',
      },
    });

    for (const key of keys) {
      store.entries[key] = payload;
    }
    await savePersistentStore('model', store).catch(() => {});

    return formatModelCacheEntry(payload, {
      source: trimText(match.source),
      matchSource: trimText(match.source),
      cacheState: staleEntry ? 'revalidated' : 'miss',
    });
  } catch (error) {
    if (staleEntry) {
      return formatModelCacheEntry(staleEntry, {
        source: 'dictionary_cache_stale_fallback',
        matchSource: trimText(staleEntry?.match_source),
        cacheState: 'stale_fallback',
        warning: error?.message || '',
      });
    }
    throw error;
  }
}

function findProvinciaBrandCandidate({ brands = [], candidateTexts = [], candidateCodes = [] } = {}) {
  const items = Array.isArray(brands) ? brands : [];
  const byCode = new Map();
  const byDescription = new Map();

  for (const item of items) {
    const code = trimText(item?.codigo);
    const description = normalizeProvinciaCatalogText(item?.descripcion);
    if (code) byCode.set(code, item);
    if (description && !byDescription.has(description)) byDescription.set(description, item);
  }

  for (const rawCode of uniqueStrings(candidateCodes)) {
    if (byCode.has(rawCode)) {
      const item = byCode.get(rawCode);
      return {
        item,
        source: 'catalog_code_exact',
        score: 1000,
      };
    }
  }

  for (const rawText of uniqueStrings(candidateTexts)) {
    const normalized = normalizeProvinciaCatalogText(rawText);
    if (!normalized) continue;
    if (byDescription.has(normalized)) {
      return {
        item: byDescription.get(normalized),
        source: 'catalog_description_exact',
        score: 1000,
      };
    }
  }

  return null;
}

function buildModelCodeCandidates(candidateCodes = []) {
  const out = new Set();
  for (const raw of uniqueStrings(candidateCodes)) {
    const digits = onlyDigits(raw);
    if (!digits) continue;
    out.add(digits);
    if (digits.length < 6) out.add(digits.padStart(6, '0'));
  }
  return [...out];
}

function computeTokenOverlapScore(leftTokens = [], rightTokens = []) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function buildModelVariants(candidateTexts = []) {
  return uniqueStrings(candidateTexts)
    .map((text) => ({
      raw: text,
      normalized: buildModelComparableText(text),
      noLine: stripModelLineText(text),
      tokens: tokenizeComparableText(text),
    }))
    .filter((item) => item.normalized);
}

function scoreModelVariantAgainstItem(variant, itemDescription) {
  const itemNormalized = buildModelComparableText(itemDescription);
  const itemNoLine = stripModelLineText(itemDescription);
  const itemTokens = tokenizeComparableText(itemDescription);
  if (!itemNormalized) return { score: 0, reason: 'empty' };

  if (variant.normalized === itemNormalized) {
    return { score: 1000, reason: 'catalog_description_exact' };
  }
  if (variant.noLine && variant.noLine === itemNoLine) {
    return { score: 950, reason: 'catalog_description_no_line' };
  }

  const overlap = computeTokenOverlapScore(variant.tokens, itemTokens);
  let score = overlap * 100;
  if (variant.noLine && itemNoLine && (itemNoLine.includes(variant.noLine) || variant.noLine.includes(itemNoLine))) {
    score += 10;
  }
  if (variant.tokens[0] && itemTokens[0] && variant.tokens[0] === itemTokens[0]) {
    score += 5;
  }
  if (variant.tokens.length >= 3 && itemTokens.length >= 3) {
    const variantSignature = variant.tokens.slice(0, 3).join(' ');
    const itemSignature = itemTokens.slice(0, 3).join(' ');
    if (variantSignature === itemSignature) score += 10;
  }

  return {
    score,
    reason: overlap >= 0.75 ? 'catalog_description_scored' : 'low_similarity',
  };
}

function findProvinciaModelCandidate({ models = [], candidateTexts = [], candidateCodes = [] } = {}) {
  const items = Array.isArray(models) ? models : [];
  const normalizedCodeCandidates = buildModelCodeCandidates(candidateCodes);
  if (normalizedCodeCandidates.length) {
    const byCode = new Map(
      items
        .map((item) => [trimText(item?.codigo), item])
        .filter(([code]) => code)
    );
    for (const code of normalizedCodeCandidates) {
      if (byCode.has(code)) {
        return {
          item: byCode.get(code),
          source: 'catalog_code_exact',
          score: 1000,
        };
      }
    }
  }

  const variants = buildModelVariants(candidateTexts);
  if (!variants.length) return null;

  const scored = [];
  for (const item of items) {
    let bestForItem = null;
    for (const variant of variants) {
      const current = scoreModelVariantAgainstItem(variant, item?.descripcion);
      if (!bestForItem || current.score > bestForItem.score) {
        bestForItem = {
          ...current,
          variant,
          item,
        };
      }
    }
    if (bestForItem && bestForItem.score > 0) scored.push(bestForItem);
  }

  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  const second = scored[1];
  if (!best) return null;

  const clearlyBetter = !second || (best.score - second.score) >= 8;
  const goodEnough = best.score >= 88 || best.reason === 'catalog_description_exact' || best.reason === 'catalog_description_no_line';
  if (!goodEnough || !clearlyBetter) {
    return {
      item: null,
      source: 'ambiguous',
      score: best.score,
      suggestions: scored.slice(0, 5).map((entry) => ({
        codigo: trimText(entry.item?.codigo),
        descripcion: trimText(entry.item?.descripcion),
        score: Number(entry.score.toFixed(2)),
        reason: entry.reason,
      })),
    };
  }

  return {
    item: best.item,
    source: best.reason,
    score: best.score,
    suggestions: scored.slice(0, 5).map((entry) => ({
      codigo: trimText(entry.item?.codigo),
      descripcion: trimText(entry.item?.descripcion),
      score: Number(entry.score.toFixed(2)),
      reason: entry.reason,
    })),
  };
}

function __resetProvinciaCatalogStateForTests() {
  catalogCache.clear();
  persistentStoreCache.clear();
  persistentWriteQueue.clear();
}

module.exports = {
  __resetProvinciaCatalogStateForTests,
  buildModelComparableText,
  buildBrandCacheKey,
  buildModelCacheKey,
  fetchProvinciaBrands,
  fetchProvinciaModels,
  fetchProvinciaYears,
  findProvinciaBrandCandidate,
  findProvinciaModelCandidate,
  normalizeProvinciaCatalogText,
  resolveProvinciaBrand,
  resolveProvinciaModel,
  stripModelLineText,
};

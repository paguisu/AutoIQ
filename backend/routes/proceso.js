// backend/routes/proceso.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../config/db');
const { initPreprocesador } = require('../utils/preprocesado_helper');
const { resolveAtmVehicleKind } = require('../utils/atm_tipo_vehiculo');
const { resolveSumaAsegurada } = require('../utils/atm_infoauto');
const { resolveCompanyTracking } = require('../utils/rastreo');
const {
  applyZeroKmToVehicle,
  normalizeZeroKmFlag,
  pickZeroKmValue,
  resolveVehicleZeroKm,
} = require('../utils/zero_km');
const {
  buildMapfreEnvelope,
  describeMapfreTipoMedioPago,
  isMapfrePostalMatchSafe,
  parseMapfreResponse,
  resolveMapfreCodPostal,
  resolveMapfrePostalMatch,
} = require('../services/mapfre/quote');
const {
  getSancorToken,
} = require('../services/sancor/auth');
const {
  buildSancorEnvelope,
  parseSancorQuoteResponse,
  summarizeSancorPlanResults,
} = require('../services/sancor/quote');
const {
  buildAllianzEnvelope,
  parseAllianzQuoteResponse,
} = require('../services/allianz/quote');
const {
  buildExpertaPayload,
  parseExpertaQuoteResponse,
  resolveExpertaPaymentKey,
} = require('../services/experta/quote');
const {
  loginExperta,
  postExpertaQuote,
} = require('../services/experta/client');
const {
  fetchNacionToken,
} = require('../services/nacion/auth');
const {
  buildNacionEnvelope,
  parseNacionQuoteResponse,
} = require('../services/nacion/quote');
const {
  buildRivadaviaAttemptPlan,
  buildRivadaviaPayload,
  parseRivadaviaQuoteResponse,
  upsertRivadaviaTipoVehiculoInferido,
} = require('../services/rivadavia/quote');
const {
  rivadaviaPost,
} = require('../services/rivadavia/client');
const {
  buildSmgEnvelope,
  buildSmgSumLookupEnvelope,
  parseSmgSumLookupResponse,
  parseSmgQuoteResponse,
  redactSmgEnvelope,
} = require('../services/smg/quote');
const {
  buildVictoriaPayload,
  parseVictoriaQuoteResponse,
} = require('../services/victoria/quote');
const {
  victoriaPost,
} = require('../services/victoria/client');
const {
  buildProvinciaPayload,
  parseProvinciaQuoteResponse,
} = require('../services/provincia/quote');
const {
  provinciaPostQuote,
} = require('../services/provincia/client');
const {
  appendActivity,
  canViewSeguros911,
  getCurrentAccessContext,
  getHistorialOwner,
  getUserDisplayName,
  isOwnedByContext,
} = require('../utils/access_control');
const {
  decorateResumenWithCatalog,
  summarizeProcessCatalog,
} = require('../utils/seguros911_product_catalog');

const metadataWriteLocks = new Map();

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmt_ddmmAAAA(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getDate())}${pad2(dt.getMonth() + 1)}${dt.getFullYear()}`;
}

// ===== Testing data (tarjetas / CBU / DNI) =====
const TESTING_DIR = path.join(__dirname, '..', '..', 'data', 'testing');
const _testingCache = { tarjetas: null, cbus: null, dnis: null };

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getTestingTarjetas() {
  if (_testingCache.tarjetas) return _testingCache.tarjetas;
  const p = path.join(TESTING_DIR, 'tarjetas_credito.json');
  _testingCache.tarjetas = readJsonFileSafe(p) || { default: null, tarjetas: {} };
  return _testingCache.tarjetas;
}

function getTestingCbus() {
  if (_testingCache.cbus) return _testingCache.cbus;
  const p = path.join(TESTING_DIR, 'cbus.json');
  _testingCache.cbus = readJsonFileSafe(p) || { default: null, cbus: {} };
  return _testingCache.cbus;
}

function pick(a) {
  for (const v of a) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ===== formato de fecha configurable (ATM / otras) =====
function formatFecha(input, pattern) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return fmt_ddmmAAAA(new Date());
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  const yyyy = dt.getFullYear();
  const fmt = (pattern || '').trim();

  switch (fmt) {
    case 'yyyyMMdd':
      return `${yyyy}${mm}${dd}`;
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${yyyy}`;
    case 'yyyy-MM-dd':
      return `${yyyy}-${mm}-${dd}`;
    case 'ddMMyyyy':
    default:
      return `${dd}${mm}${yyyy}`;
  }
}

async function readJsonStrict(abs) {
  const raw = await fsp.readFile(abs, 'utf8');
  return JSON.parse(raw);
}
async function writeJson(abs, obj) {
  await fsp.writeFile(abs, JSON.stringify(obj, null, 2), 'utf8');
}

// ===== Cabeceras (JSON local ya usado por tu proyecto) =====
const cabStore = path.join(process.cwd(), 'data', 'cabeceras', 'cabeceras.json');
function getCabecera(id) {
  try {
    const j = JSON.parse(fs.readFileSync(cabStore, 'utf8'));
    return (j.items || []).find((x) => x.id === Number(id)) || null;
  } catch {
    return null;
  }
}

function sanitizeCabeceraOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedKeys = [
    'sexo',
    'fec_nac',
    'cerokm',
    'tipo_uso',
    'uso_default',
    'rastreo',
    'rastreo_sistema',
    'rastreoSistema',
    'sistema_rastreo',
    'sistemaRastreo',
    'rastreador_sistema',
    'rastreadorSistema',
    'gnc',
    'suma_gnc',
    'est_civil',
    'medio_pago',
  ];
  const sanitized = {};
  for (const key of allowedKeys) {
    if (value[key] === undefined || value[key] === null) continue;
    const next = String(value[key]).trim();
    if (!next) continue;
    sanitized[key] = next;
  }
  const zeroKmOverride = pickZeroKmValue(value);
  if (zeroKmOverride !== '') {
    sanitized.cerokm = normalizeZeroKmFlag(zeroKmOverride);
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

function mergeCabecera(baseCabecera, override) {
  const sanitizedOverride = sanitizeCabeceraOverride(override);
  if (!sanitizedOverride) return baseCabecera;
  return { ...(baseCabecera || {}), ...sanitizedOverride };
}

function getRequestContext(req) {
  return req.accessContext || getCurrentAccessContext();
}

function classifyProcessOrigin(meta = {}) {
  const archivo = path.basename(String(meta?.archivo || meta?.ruta || meta?.nombre_archivo || '')).trim().toLowerCase();
  const nombre = String(meta?.nombre || '').trim().toLowerCase();

  if (
    archivo.startsWith('cotizador-publico-')
    || nombre.startsWith('seguros911 publico')
    || nombre.includes('seguros911')
  ) {
    return 'seguros911';
  }

  if (
    archivo.startsWith('combinado-')
    || archivo.startsWith('taxativo-')
    || Number(meta?.historial_id)
  ) {
    return 'masivo';
  }

  return 'otro';
}

function filterCompanyItemsByContext(items, ctx) {
  if (ctx?.isSuperadmin) return items;
  const allowed = new Set(Array.isArray(ctx?.allowedCompanySlugs) ? ctx.allowedCompanySlugs : []);
  return items.filter((item) => allowed.has(String(item.slug || '').toLowerCase()));
}

// ===== Config y helpers por aseguradora (dinámico) =====
function asegPath(slug) {
  return path.join(process.cwd(), 'data', slug);
}

function listAvailableAseguradoras() {
  const dataRoot = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataRoot)) return [];

  return fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => fs.existsSync(path.join(dataRoot, slug, 'aseguradora.json')))
    .map((slug) => {
      const cfgPath = path.join(dataRoot, slug, 'aseguradora.json');
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return {
          slug,
          nombre_publico: cfg?.nombre_publico || slug.toUpperCase(),
          activo: cfg?.activo !== false,
        };
      } catch {
        return null;
      }
    })
    .filter((item) => item && item.activo)
    .sort((a, b) => a.nombre_publico.localeCompare(b.nombre_publico, 'es'));
}

function normalizeProcesoAseguradoras(input) {
  const rawList = Array.isArray(input)
    ? input
    : (input == null ? [] : [input]);
  const normalized = [];
  const seen = new Set();

  for (const value of rawList) {
    const slug = String(value || '').toLowerCase().trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    normalized.push(slug);
  }

  const executable = new Set(listAvailableAseguradoras().map((item) => String(item.slug || '').toLowerCase()));
  const aseguradoras = [];
  const ignoradas = [];

  for (const slug of normalized) {
    if (executable.has(slug)) {
      aseguradoras.push(slug);
    } else {
      ignoradas.push(slug);
    }
  }

  return { aseguradoras, ignoradas };
}

function readSmgCredentialsFile() {
  const credPath = path.join(process.cwd(), 'web_services', 'SMG', 'Credenciales.txt');
  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === 'usuario') out.usuario = value;
      if (key === 'pwd' || key === 'password' || key === 'pass') out.password = value;
    }
    return out;
  } catch {
    return {};
  }
}

function isInt32String(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return false;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num <= 2147483647;
}

async function loadAsegConfig(slug) {
  const cfgPath = path.join(asegPath(slug), 'aseguradora.json');
  const j = await readJsonStrict(cfgPath);
  // Centralización credenciales ATM: preferimos ENV y, si no, caemos al JSON.
  if (slug === 'atm') {
    j.usuario = process.env.ATM_USER || j.usuario;
    j.password = process.env.ATM_PASS || j.password;
    j.vendedor = process.env.ATM_VENDEDOR || j.vendedor;
    j.origen = process.env.ATM_ORIGEN || j.origen;
    j.plan = process.env.ATM_PLAN || j.plan;
    j.contacto_tecnico = process.env.ATM_CONTACTO_TECNICO || j.contacto_tecnico;
    j.contacto_comercial = process.env.ATM_CONTACTO_COMERCIAL || j.contacto_comercial;
  }
  if (slug === 'mapfre') {
    j.base_url = process.env.MAPFRE_BASE_URL || j.base_url;
    j.soap_path = process.env.MAPFRE_SOAP_PATH || j.soap_path;
    j.codAgt = process.env.MAPFRE_COD_AGT || j.codAgt;
    j.claveAcceso = process.env.MAPFRE_CLAVE_ACCESO || j.claveAcceso;
    j.claveProcedencia = process.env.MAPFRE_CLAVE_PROCEDENCIA || j.claveProcedencia;
    j.tipoFacturacion = process.env.MAPFRE_TIPO_FACTURACION || j.tipoFacturacion;
  }
  if (slug === 'sancor') {
    j.base_url = process.env.SANCOR_BASE_URL || j.base_url;
    j.soap_path = process.env.SANCOR_SOAP_PATH || j.soap_path;
    j.soap_method = process.env.SANCOR_SOAP_METHOD || j.soap_method;
    j.soap_action = process.env.SANCOR_SOAP_ACTION || j.soap_action;
    j.auth_url = process.env.SANCOR_AUTH_URL || j.auth_url;
    j.auth_method = process.env.SANCOR_AUTH_METHOD || j.auth_method;
    j.usuario = process.env.SANCOR_USER || j.usuario;
    j.password = process.env.SANCOR_PASS || j.password;
    j.system = process.env.SANCOR_SYSTEM || j.system;
    j.connection = process.env.SANCOR_CONNECTION || j.connection;
    j.quote_user = process.env.SANCOR_QUOTE_USER || j.quote_user || j.usuario;
    j.producer_code = process.env.SANCOR_PRODUCER_CODE || j.producer_code;
    j.supervisor_code = process.env.SANCOR_SUPERVISOR_CODE || j.supervisor_code;
  }
  if (slug === 'allianz') {
    j.base_url = process.env.ALLIANZ_BASE_URL || j.base_url;
    j.soap_path = process.env.ALLIANZ_SOAP_PATH || j.soap_path;
    j.soap_method = process.env.ALLIANZ_SOAP_METHOD || j.soap_method;
    j.soap_action = process.env.ALLIANZ_SOAP_ACTION || j.soap_action;
    j.usuario = process.env.ALLIANZ_USER || j.usuario;
    j.password = process.env.ALLIANZ_PASS || j.password;
    j.application = process.env.ALLIANZ_APPLICATION || j.application;
    j.producer_code = process.env.ALLIANZ_PRODUCER_CODE || j.producer_code;
  }
  if (slug === 'experta') {
    j.base_url = process.env.EXPERTA_BASE_URL || j.base_url;
    j.soap_path = process.env.EXPERTA_API_PATH || j.soap_path;
    j.usuario = process.env.EXPERTA_USER || j.usuario;
    j.password = process.env.EXPERTA_PASS || j.password;
    j.api_key = process.env.EXPERTA_API_KEY || j.api_key || j.hashid;
    j.hashid = process.env.EXPERTA_HASHID || j.hashid;
    j.producer_code = process.env.EXPERTA_PRODUCER_CODE || j.producer_code;
  }
  if (slug === 'nacion') {
    j.base_url = process.env.NACION_BASE_URL || j.base_url;
    j.soap_path = process.env.NACION_SOAP_PATH || j.soap_path;
    j.soap_method = process.env.NACION_SOAP_METHOD || j.soap_method;
    j.soap_action = process.env.NACION_SOAP_ACTION || j.soap_action;
    j.auth_url = process.env.NACION_AUTH_URL || j.auth_url;
    j.auth_method = process.env.NACION_AUTH_METHOD || j.auth_method;
    j.auth_user = process.env.NACION_AUTH_USER || j.auth_user;
    j.auth_password = process.env.NACION_AUTH_PASSWORD || j.auth_password;
    j.usuario_aplicacion = process.env.NACION_USUARIO_APLICACION || j.usuario_aplicacion;
    j.cotizador_id = process.env.NACION_COTIZADOR_ID || j.cotizador_id;
  }
  if (slug === 'rivadavia') {
    j.base_url = process.env.RIVADAVIA_BASE_URL || j.base_url;
    j.soap_path = process.env.RIVADAVIA_API_PATH || j.soap_path;
    j.auth_url = process.env.RIVADAVIA_AUTH_URL || j.auth_url;
    j.grant_type = process.env.RIVADAVIA_GRANT_TYPE || j.grant_type;
    j.usuario = process.env.RIVADAVIA_USER || j.usuario;
    j.password = process.env.RIVADAVIA_PASS || j.password;
    j.client_id = process.env.RIVADAVIA_CLIENT_ID || j.client_id;
    j.client_secret = process.env.RIVADAVIA_CLIENT_SECRET || j.client_secret;
    j.producer_code = process.env.RIVADAVIA_PRODUCER_CODE || j.producer_code;
    j.producer_password = process.env.RIVADAVIA_PRODUCER_PASS || j.producer_password;
  }
  if (slug === 'smg') {
    const fileCreds = readSmgCredentialsFile();
    j.base_url = process.env.SMG_BASE_URL || j.base_url;
    j.soap_path = process.env.SMG_SOAP_PATH || j.soap_path;
    j.soap_method = process.env.SMG_SOAP_METHOD || j.soap_method;
    j.soap_action = process.env.SMG_SOAP_ACTION || j.soap_action;
    j.usuario = process.env.SMG_USER || j.usuario || fileCreds.usuario;
    j.password = process.env.SMG_PASS || j.password || fileCreds.password;
    j.cod_agente = process.env.SMG_COD_AGENTE || j.cod_agente || (isInt32String(j.usuario) ? j.usuario : '');
    j.cod_tipo_poliza = process.env.SMG_COD_TIPO_POLIZA || j.cod_tipo_poliza;
    j.cod_pto_venta = process.env.SMG_COD_PTO_VENTA || j.cod_pto_venta;
    j.parametros_extras = {
      ...(j.parametros_extras || {}),
      asistencia_mecanica_default:
        process.env.SMG_ASISTENCIA_MECANICA || j?.parametros_extras?.asistencia_mecanica_default,
      cod_pto_venta_default:
        process.env.SMG_COD_PTO_VENTA || j?.parametros_extras?.cod_pto_venta_default,
    };
  }
  if (slug === 'victoria') {
    j.base_url = process.env.VICTORIA_BASE_URL || j.base_url;
    j.soap_path = process.env.VICTORIA_API_PATH || j.soap_path;
    j.auth_url = process.env.VICTORIA_AUTH_URL || j.auth_url;
    j.usuario = process.env.VICTORIA_USER || j.usuario;
    j.password = process.env.VICTORIA_PASS || j.password;
    j.producer_code = process.env.VICTORIA_PRODUCER_CODE || j.producer_code;
  }
  if (slug === 'provincia') {
    j.base_url = process.env.PROVINCIA_BASE_URL || j.base_url;
    j.soap_path = process.env.PROVINCIA_API_PATH || j.soap_path;
    j.auth_url = process.env.PROVINCIA_AUTH_URL || j.auth_url;
    j.grant_type = process.env.PROVINCIA_GRANT_TYPE || j.grant_type;
    j.client_id = process.env.PROVINCIA_CLIENT_ID || j.client_id;
    j.client_secret = process.env.PROVINCIA_CLIENT_SECRET || j.client_secret;
    j.api_key = process.env.PROVINCIA_API_KEY || j.api_key;
    j.usuario = process.env.PROVINCIA_USER || j.usuario;
    j.password = process.env.PROVINCIA_PASS || j.password;
  }
  if (!j.base_url || !j.soap_path) throw new Error(`Config ${slug}: faltan base_url o soap_path`);
  const method = j.soap_method || j.SOAP_METHOD || 'AUTOS_Cotizar_PHP';
  let url = `${j.base_url.replace(/\/+$/, '')}${j.soap_path}`;
  const formato =
    (j.parametros_extras && j.parametros_extras.formato_fecha_request) ||
    process.env.ATM_DATE_FMT ||
    'ddMMyyyy';
  return { cfg: j, SOAP_URL: url, SOAP_METHOD: method, fechaFmt: formato };
}

// ===== Fallbacks menores =====
function inferSeccionVehiculo(fila) {
  const join = Object.values(fila || {}).join(' ').toLowerCase();
  if (/\bmoto(s)?\b/.test(join)) return '1';
  return '3';
}

// ===== Diccionarios de USO =====
async function readUsoDicc(slug) {
  try {
    const p = path.join(asegPath(slug), 'diccionarios', 'uso.json');
    return await readJsonStrict(p);
  } catch {
    return {};
  }
}
function mapUsoTextoACodigo(value, DICC) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return raw;
  const key = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return DICC[key] || '';
}

let atmPostalCatalogPromise = null;

async function loadAtmPostalCatalog() {
  if (!atmPostalCatalogPromise) {
    const p = path.join(asegPath('atm'), 'diccionarios', 'localidades.json');
    atmPostalCatalogPromise = readJsonStrict(p)
      .then((rows) => Array.isArray(rows) ? rows : [])
      .catch(() => []);
  }
  return atmPostalCatalogPromise;
}

function normalizeComparableText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

const ATM_CP_FALLBACKS = {
  'TIERRA DEL FUEGO': ['9420', '9410'],
};

async function resolveAtmPostalCode(row = {}) {
  const cpRaw = pick([row?.codigo_postal, row?.codpostal, row?.CP, row?.cp, row?.CodigoPostal]);
  const cp = String(cpRaw || '').replace(/\D+/g, '').slice(0, 4);
  const provincia = normalizeComparableText(pick([row?.provincia, row?.Provincia]));
  const catalog = await loadAtmPostalCatalog();

  const byCp = cp ? catalog.filter((item) => String(item?.codpos || '').trim() === cp) : [];
  if (byCp.length > 0) {
    return { cp, source: 'exacto' };
  }

  const provinceRows = provincia
    ? catalog.filter((item) => normalizeComparableText(item?.provincia) === provincia)
    : [];

  for (const candidate of ATM_CP_FALLBACKS[provincia] || []) {
    if (provinceRows.some((item) => String(item?.codpos || '').trim() === candidate)) {
      return { cp: candidate, source: 'fallback_provincia', originalCp: cp || '' };
    }
  }

  if (provinceRows.length > 0 && cp) {
    const numericCp = Number(cp);
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const item of provinceRows) {
      const candidateCp = String(item?.codpos || '').trim();
      const candidateNum = Number(candidateCp);
      if (!Number.isFinite(candidateNum)) continue;
      const delta = Math.abs(candidateNum - numericCp);
      if (delta < bestDelta) {
        best = candidateCp;
        bestDelta = delta;
      }
    }
    if (best) {
      return { cp: best, source: 'fallback_cercano', originalCp: cp };
    }
  }

  return { cp, source: cp ? 'sin_validar' : 'faltante', originalCp: cp || '' };
}

function getCompanyQueueConfig(slug, aseg = {}) {
  const extra = aseg?.parametros_extras || {};
  if (slug === 'mapfre') {
    return {
      maxConcurrency: Number(extra.max_concurrency ?? 2) || 2,
      minIntervalMs: Number(extra.min_interval_ms ?? 800) || 800,
      retryDelayMs: Number(extra.retry_delay_ms ?? 4000) || 4000,
      maxDeferredRetries: Number(extra.max_deferred_retries ?? 1) || 1,
    };
  }
  if (slug === 'provincia') {
    return {
      maxConcurrency: Number(extra.max_concurrency ?? 1) || 1,
      minIntervalMs: Number(extra.min_interval_ms ?? 1200) || 1200,
      retryDelayMs: Number(extra.retry_delay_ms ?? 5000) || 5000,
      maxDeferredRetries: Number(extra.max_deferred_retries ?? 1) || 1,
    };
  }
  return {
    maxConcurrency: Number(extra.max_concurrency ?? 1) || 1,
    minIntervalMs: Number(extra.min_interval_ms ?? 1200) || 1200,
    retryDelayMs: Number(extra.retry_delay_ms ?? 0) || 0,
    maxDeferredRetries: Number(extra.max_deferred_retries ?? 0) || 0,
  };
}

function isRetryableMapfreError(result = {}) {
  const msg = String(result?.error || '').toUpperCase();
  return msg.includes('ORA-00001') || msg.includes('TIMEOUT') || msg.includes('ECONNRESET');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runThrottledTasks(tasks, worker, options = {}) {
  const maxConcurrency = Math.max(1, Number(options.maxConcurrency || 1));
  const minIntervalMs = Math.max(0, Number(options.minIntervalMs || 0));
  let cursor = 0;
  let active = 0;
  let lastStart = 0;
  let timer = null;

  return await new Promise((resolve) => {
    const pump = () => {
      if (cursor >= tasks.length && active === 0) {
        if (timer) clearTimeout(timer);
        resolve();
        return;
      }
      while (active < maxConcurrency && cursor < tasks.length) {
        const wait = Math.max(0, (lastStart + minIntervalMs) - Date.now());
        if (wait > 0) {
          if (!timer) {
            timer = setTimeout(() => {
              timer = null;
              pump();
            }, wait);
          }
          return;
        }
        const task = tasks[cursor++];
        active += 1;
        lastStart = Date.now();
        Promise.resolve(worker(task))
          .catch(() => {})
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };
    pump();
  });
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

function resolveRastreoCodigo(cabecera, Aseg) {
  const raw = normalizeText(cabecera?.rastreo);
  const hasSystem = Boolean(cabecera?.rastreo_sistema || cabecera?.rastreoSistema || cabecera?.sistema_rastreo || cabecera?.sistemaRastreo);
  if (raw && !hasSystem && !['1', 'S', 'SI', 'CON', 'POSEE', '0', 'SIN', 'NO POSEE', 'N'].includes(raw)) {
    return raw;
  }
  const tracking = resolveCompanyTracking(cabecera, 'atm', Aseg);
  const defaultCode = String(
    process.env.ATM_RASTREO_CODIGO_CON ||
      Aseg?.parametros_extras?.rastreo_codigo_con ||
      tracking.mappedValue ||
      'A'
  ).trim();

  if (tracking.hasTracking) return defaultCode;
  return 'N';
}

function resolveFormaPagoCodigo(cabecera) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
    cabecera?.medioPago ??
    cabecera?.forma_pago ??
    cabecera?.formaPago ??
    ''
  );

  if (['2', 'TC', 'TARJETA', 'TARJETA DE CREDITO', 'CREDITO'].includes(raw)) return '2';
  if (['4', 'CBU', 'DC', 'DEBITO EN CUENTA'].includes(raw)) return '4';

  // "Efectivo" en la UI agrupa el resto de medios no tarjeta/no CBU.
  if ([
    '1',
    '3',
    'EF',
    'EFVO',
    'EFECTIVO',
    'PF',
    'PAGO FACIL',
    'PAGO FÁCIL',
    'RAPIPAGO',
    'COBRO EXPRESS',
    'MERCADOPAGO',
    'MERCADO PAGO',
    'OTRA',
  ].includes(raw)) return '1';

  return '2';
}

function describeAtmFormaPago(codigo) {
  const raw = String(codigo || '').trim();
  if (raw === '2') return 'Tarjeta de crédito';
  if (raw === '4') return 'CBU';
  if (raw === '1' || raw === '3') return 'Efectivo';
  return raw;
}

function resolveSumaGnc(cabecera, gncFlag) {
  if (gncFlag !== '1') return '';
  const raw = String(cabecera?.suma_gnc ?? '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[.,\s]/g, '');
  return /^\d+$/.test(normalized) ? normalized : '';
}

// ===== Helpers Proceso (filesystem) =====
function procesosRoot() {
  return path.join(process.cwd(), 'data', 'procesos');
}
function procesoDir(id) {
  return path.join(procesosRoot(), `proceso-${id}`);
}
function metadataPath(id) {
  return path.join(procesoDir(id), 'metadata.json');
}
function resumenPath(id) {
  return path.join(procesoDir(id), 'resumen.json');
}

// ===== Export Excel por Proceso =====
function flattenForExcel(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}${k}` : k;
    if (v == null) {
      out[key] = '';
    } else if (typeof v === 'object') {
      // Evitar explotar columnas: guardar objeto completo como JSON
      out[key] = JSON.stringify(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function insertFieldBeforePrefix(obj, fieldName, fieldValue, prefix) {
  const out = {};
  let inserted = false;
  for (const [key, value] of Object.entries(obj || {})) {
    if (!inserted && String(key).startsWith(prefix)) {
      out[fieldName] = fieldValue ?? '';
      inserted = true;
    }
    out[key] = value;
  }
  if (!inserted) out[fieldName] = fieldValue ?? '';
  return out;
}

const EXCEL_BASE_HEADERS = [
  'proceso_id',
  'historial_id',
  'cabecera_id',
  'aseguradora',
  'index',
  'ok',
  'skipped',
  'operacion',
  'reason',
  'error',
  'veh_anio',
  'veh_marca',
  'veh_modelo',
  'veh_codigo_infoauto',
  'veh_suma',
  'veh_cerokm',
  'veh_uso',
  'veh_tipo_vehiculo',
  'veh_provincia',
  'veh_localidad',
  'veh_CP',
  'cab_id',
  'cab_nombre',
  'cab_tipopersona',
  'cab_iva',
  'cab_tipodoc',
  'cab_medio_pago',
  'cab_nrodoc',
  'cab_apellido',
  'cab_nombre_aseg',
  'cab_sexo',
  'cab_fec_nac',
  'cab_est_civil',
  'cab_provincia',
  'cab_localidad',
  'cab_calle',
  'cab_altura',
  'cab_cp',
  'cab_sub_cp',
  'cab_tel_part',
  'cab_tel_cel',
  'cab_mail',
  'cab_seccion',
  'cab_plan',
  'cab_contacto_tecnico',
  'cab_contacto_comercial',
  'cab_tipo_uso',
  'cab_rastreo',
  'cab_gnc',
  'cab_suma_gnc',
  'cab_alarma',
  'cab_ajuste',
  'cab_cerokm',
  'cab_suma',
  'cab_uso_default',
  'cab_accesorios',
  'cab_organization_id',
  'cab_created_by_user_id',
  'cab_created_by_name',
  'cab_created_at',
  'Suma Asegurada',
];

const EXCEL_CANONICAL_HEADERS = [
  'Proceso ID',
  'Historial ID',
  'Cabecera ID',
  'Aseguradora',
  'Fila',
  'Estado',
  'Fecha Cotizacion',
  'Hora Cotizacion',
  'Operacion/Cotizacion',
  'Cabecera',
  'Parametro Tipo Persona',
  'Parametro IVA',
  'Parametro Tipo Doc',
  'Medio Pago Request',
  'Medio Pago Response',
  'Parametro Sexo',
  'Parametro Fecha Nacimiento',
  'Edad Cotizada',
  'Parametro Estado Civil',
  'Parametro Tipo Uso',
  'Parametro Rastreo',
  'Parametro GNC',
  'Parametro Ajuste',
  'Vehiculo Anio',
  'Vehiculo Marca',
  'Vehiculo Modelo',
  'Vehiculo Codigo Infoauto',
  'Vehiculo Tipo',
  'Vehiculo Combustible',
  'Vehiculo Uso',
  'Vehiculo Provincia',
  'Vehiculo Localidad',
  'Vehiculo CP',
  'Grupo Cobertura Codigo',
  'Grupo Cobertura Descripcion',
  'Cobertura Codigo',
  'Cobertura Descripcion',
  'Producto Codigo',
  'Producto Descripcion',
  'Plan',
  'Periodo Facturacion',
  'Duracion',
  'Cuotas',
  'Importe Cuota',
  'Prima',
  'Prima Mensual',
  'Prima Vigencia',
  'Premio',
  'Premio Mensual',
  'Premio Vigencia',
  'Suma Asegurada',
  'IVA',
  'IVA Mensual',
  'IVA Vigencia',
  'Impuestos Mensuales',
  'Impuestos Vigencia',
  'Franquicia',
  'Franquicia Robo',
  'Recuperador',
  'Inspeccionable',
  'Comision',
  '% Comision',
  'Error',
  'Observacion',
];

const EXCEL_COT_HEADER_PREFERENCE = [
  'cot_codigo',
  'cot_codigoDeCobertura',
  'cot_descripcion',
  'cot_descripcionDeCobertura',
  'cot_codigoDeProducto',
  'cot_descripcionDeProducto',
  'cot_cobertura',
  'cot_nombreProducto',
  'cot_codigoModalidad',
  'cot_nombreFranquicia',
  'cot_formapago',
  'cot_formapago_descripcion',
  'cot_plan',
  'cot_plan_cot',
  'cot_cuotas',
  'cot_cantidadCuotas',
  'cot_impcuotas',
  'cot_importeCuota',
  'cot_prima',
  'cot_importePrima',
  'cot_importePrimaRC',
  'cot_importePrimaCasco',
  'cot_montoPrimaTotal',
  'cot_montoPrimaComi',
  'cot_importePrimaNoComi',
  'cot_premio',
  'cot_importePremio',
  'cot_importePremioContado',
  'cot_importePremioDebito',
  'cot_importePremioEfectivo',
  'cot_montoPremio',
  'cot_montoPrimeraCuota',
  'cot_montoRestoCuotas',
  'cot_comision',
  'cot_valorComisionPAS',
  'cot_porcentajeComisionPAS',
  'cot_porcentajeIVA',
  'cot_importeIVA',
  'cot_montoIVA',
  'cot_importeSellados',
  'cot_importeIngresosBrutos',
  'cot_importeTotalImpuestos',
  'cot_porcentajeRecargoFinanciero',
  'cot_importeRecargoFinanciero',
  'cot_ajuste',
  'cot_sumaAsegurada',
  'cot_montoFranquicia',
  'cot_franquicia',
  'cot_franquiciaRobo',
  'cot_franquicias',
  'cot_requiereInspeccion',
  'cot_inspeccionable',
  'cot_conRecuperador',
  'cot_hasTrackingEquipment',
  'cot_vehicleValuation',
  'cot_numCotizacion',
  'cot_solicitud_glm',
  'cot_pricingId',
  'cot_pricingIdAPF',
  'cot_module',
  'cot_shortDescr',
  'cot_longDescr',
  'cot_premiumMonthly',
  'cot_premium',
  'cot_success',
  'cot_outStandard',
  'cot_resultados',
  'cot_coberturas',
  'cot_duracion',
  'cot_periodoFact',
  'cot_porcentajePromocion',
  'cot_sumaGNC',
  'cot_montoBonif',
  'cot_codError',
];

function buildExcelHeaders(rows = []) {
  const discovered = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) discovered.add(key);
  }

  const headers = [];
  const pushIfPresent = (key) => {
    if (discovered.has(key) && !headers.includes(key)) headers.push(key);
  };

  EXCEL_BASE_HEADERS.forEach(pushIfPresent);

  const cotDiscovered = [...discovered].filter((key) => key.startsWith('cot_'));
  EXCEL_COT_HEADER_PREFERENCE.forEach(pushIfPresent);
  cotDiscovered
    .filter((key) => !headers.includes(key))
    .sort((a, b) => a.localeCompare(b))
    .forEach(pushIfPresent);

  [...discovered]
    .filter((key) => !headers.includes(key) && key !== 'used')
    .sort((a, b) => a.localeCompare(b))
    .forEach(pushIfPresent);

  pushIfPresent('used');
  return headers;
}

function buildSheetFromRows(rows = []) {
  const headers = buildExcelHeaders(rows);
  if (headers.length === 0) return xlsx.utils.aoa_to_sheet([]);
  return xlsx.utils.json_to_sheet(rows, { header: headers });
}

function buildCanonicalSheet(rows = []) {
  if (!rows.length) return xlsx.utils.aoa_to_sheet([EXCEL_CANONICAL_HEADERS]);
  return xlsx.utils.json_to_sheet(rows, { header: EXCEL_CANONICAL_HEADERS });
}

function applyCanonicalSheetFormats(ws, rows = []) {
  const headerIndex = new Map(EXCEL_CANONICAL_HEADERS.map((name, idx) => [name, idx]));
  const money2 = new Set([
    'Importe Cuota',
    'Prima',
    'Prima Mensual',
    'Prima Vigencia',
    'Premio',
    'Premio Mensual',
    'Premio Vigencia',
    'IVA',
    'IVA Mensual',
    'IVA Vigencia',
    'Impuestos Mensuales',
    'Impuestos Vigencia',
    'Comision',
  ]);
  const money0 = new Set(['Suma Asegurada', 'Franquicia', 'Franquicia Robo']);
  const decimals2 = new Set(['% Comision']);

  const colName = (n) => {
    let s = '';
    let x = n + 1;
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };

  rows.forEach((row, rowIndex) => {
    for (const [name, colIndex] of headerIndex.entries()) {
      const value = row?.[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const ref = `${colName(colIndex)}${rowIndex + 2}`;
      if (!ws[ref]) continue;
      if (money2.has(name)) ws[ref].z = '#,##0.00';
      else if (money0.has(name)) ws[ref].z = '#,##0';
      else if (decimals2.has(name)) ws[ref].z = '0.00';
    }
  });
}

function applyCanonicalSheetBackfills(ws, rows = []) {
  const headerIndex = new Map(EXCEL_CANONICAL_HEADERS.map((name, idx) => [name, idx]));
  const colName = (n) => {
    let s = '';
    let x = n + 1;
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  const setCell = (rowIndex, header, value) => {
    const colIndex = headerIndex.get(header);
    if (colIndex == null) return;
    const ref = `${colName(colIndex)}${rowIndex + 2}`;
    ws[ref] = { t: typeof value === 'number' ? 'n' : 's', v: value };
  };

  rows.forEach((row, rowIndex) => {
    const group = inferCoverageGroup(row);
    if (group.code) setCell(rowIndex, 'Grupo Cobertura Codigo', group.code);
    if (group.description) setCell(rowIndex, 'Grupo Cobertura Descripcion', group.description);
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.trim() === '') continue;
      return value;
    }
    return value;
  }
  return '';
}

function parseJsonArrayMaybe(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return null;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function deriveSancorExcelFinancials(row = {}) {
  const slug = String(row.aseguradora || '').trim().toLowerCase();
  if (slug !== 'sancor') return null;

  const resultados = parseJsonArrayMaybe(firstNonEmpty(row.cot_resultados, row.resultados));
  if (!Array.isArray(resultados) || resultados.length === 0) return null;

  const summary = summarizeSancorPlanResults(resultados);
  if (!summary.hasPrima && !summary.hasTotal && !summary.hasIva && !summary.hasImpuestos) return null;

  return {
    primaMensual: firstNonEmpty(
      row.cot_purePremiumMonthlyTotal,
      row.cot_primaMonthlyTotal,
      row.cot_prima,
      row.cot_importePrima,
      summary.primaMonthlyText
    ),
    primaVigencia: firstNonEmpty(
      row.cot_purePremiumTotal,
      row.cot_primaAnnual,
      summary.primaAnnualText
    ),
    premioMensual: firstNonEmpty(
      row.cot_premiumMonthly,
      row.cot_premio,
      row.cot_importePremio,
      summary.totalMonthlyText
    ),
    premioVigencia: firstNonEmpty(
      row.cot_premium,
      row.cot_premioAnnual,
      summary.totalAnnualText
    ),
    ivaMensual: firstNonEmpty(
      row.cot_ivaMonthly,
      row.cot_importeIVA,
      row.cot_montoIVA,
      summary.ivaMonthlyText
    ),
    ivaVigencia: firstNonEmpty(
      row.cot_ivaAnnual,
      summary.ivaAnnualText
    ),
    impuestosMensuales: firstNonEmpty(
      row.cot_impuestosMonthly,
      row.cot_importeTotalImpuestos,
      summary.impuestosMonthlyText
    ),
    impuestosVigencia: firstNonEmpty(
      row.cot_impuestosAnnual,
      summary.impuestosAnnualText
    ),
  };
}

function parseFlexibleDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const digits = raw.replace(/\D+/g, '');
  if (/^\d{8}$/.test(digits)) {
    const left = Number(digits.slice(0, 4));
    if (left >= 1900) {
      const dt = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00`);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    const dt = new Date(`${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const ddmmyyyy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (ddmmyyyy) {
    const dt = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

function inferEdadCotizada(fechaNacimiento, fechaCotizacion) {
  const birth = parseFlexibleDate(fechaNacimiento);
  const quote = parseFlexibleDate(fechaCotizacion) || new Date();
  if (!birth || Number.isNaN(quote.getTime())) return '';

  let age = quote.getFullYear() - birth.getFullYear();
  const monthDiff = quote.getMonth() - birth.getMonth();
  const beforeBirthday = monthDiff < 0 || (monthDiff === 0 && quote.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : '';
}

function formatQuoteDateParts(value) {
  const dt = parseFlexibleDate(value);
  if (!dt) return { fecha: '', hora: '' };
  return {
    fecha: `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`,
    hora: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`,
  };
}

function inferVehiculoCombustible(row = {}, usedMeta = {}) {
  const raw = firstNonEmpty(
    row.veh_combustible,
    row.veh_tipo_combustible,
    row.veh_fuel,
    row.veh_Combustible,
    row.veh_TipoCombustible,
    row.combustible,
    row.tipo_combustible,
    usedMeta.tipoCombustible,
    usedMeta.descripcionCombustible
  );
  if (!raw) return '';
  const normalized = normalizeText(raw);
  if (normalized.includes('ELECT')) return 'Electrico';
  if (normalized.includes('HIBRID')) return 'Hibrido';
  if (normalized.includes('GNC')) return 'GNC';
  if (normalized.includes('DIESEL') || normalized.includes('GASOIL')) return 'Diesel';
  if (normalized.includes('NAFTA')) return 'Nafta';
  return String(raw).trim();
}

function applyVehicleExcelAliases(row = {}) {
  const next = { ...row };
  const setAlias = (target, sourceKeys = []) => {
    const value = firstNonEmpty(next[target], ...sourceKeys.map((key) => next[key]));
    if (value !== '') next[target] = value;
  };

  setAlias('veh_anio', ['veh_Anio', 'veh_ANIO', 'veh_anofab', 'veh_ano']);
  setAlias('veh_marca', ['veh_Marca', 'veh_marca_vehiculo', 'veh_brand']);
  setAlias('veh_modelo', ['veh_Modelo', 'veh_modelo_vehiculo', 'veh_version']);
  setAlias('veh_codigo_infoauto', ['veh_infoautocod', 'veh_InfoAutoCod', 'veh_codigoInfoauto', 'veh_tau_codia', 'veh_cod_infoauto']);
  setAlias('veh_suma', ['veh_Suma', 'veh_suma_asegurada', 'veh_valorVehiculo', 'veh_valor_vehiculo']);
  setAlias('veh_cerokm', ['veh_0km', 'veh_cero_km', 'veh_ceroKm']);
  setAlias('veh_uso', ['veh_Uso']);
  setAlias('veh_tipo_vehiculo', ['veh_TipoVehiculo', 'veh_tipoVehiculo', 'veh_Tipo']);
  setAlias('veh_combustible', ['veh_Combustible', 'veh_tipo_combustible', 'veh_tipoCombustible', 'veh_fuel']);
  setAlias('veh_provincia', ['veh_Provincia', 'veh_desc_provincia', 'veh_nom_prov']);
  setAlias('veh_localidad', ['veh_Localidad', 'veh_ciudad', 'veh_Ciudad']);
  setAlias('veh_CP', ['veh_cp', 'veh_codigo_postal', 'veh_codpostal', 'veh_CodigoPostal']);

  return next;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value, decimals = 2) {
  const n = toNumber(value);
  if (n == null) return null;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

const COVERAGE_GROUP_LABELS = {
  A: 'Responsabilidad Civil',
  B: 'Danos Totales',
  B1: 'Danos Totales por Robo e Incendio (sin AT)',
  C: 'Terceros Completos',
  C1: 'Danos totales y parciales por Robo e Incendio (sin AT)',
  'C+': 'Terceros Completos con granizo',
  'C++': 'Terceros Completos con cristales y granizo',
  'C Premium': 'Terceros Completos Premium',
  DF: 'Todo Riesgo con franquicia fija',
  DV: 'Todo Riesgo con franquicia variable',
  G: 'Garage',
};

function coverageGroup(code = '') {
  const normalized = String(code || '').trim();
  return {
    code: normalized,
    description: COVERAGE_GROUP_LABELS[normalized] || '',
  };
}

const COVERAGE_GROUP_OVERRIDES_PATH = path.join(process.cwd(), 'data', 'diccionarios', 'grupos_cobertura_overrides.json');
const DEFAULT_COVERAGE_GROUP_OVERRIDES = {
  global: [
    {
      containsAny: ['B - DANOS TOTALES UNICAMENTE'],
      group: coverageGroup('B'),
    },
    {
      containsAny: ['B1 - PERDIDA TOTAL POR INCENDIO Y ROBO'],
      group: coverageGroup('B1'),
    },
    {
      containsAny: ['C1 - PERDIDA TOTAL Y PARC. POR INC. Y ROBO'],
      group: coverageGroup('C1'),
    },
    {
      containsAny: ['ROBO E INCENDIO TOTAL Y/O PARCIAL + ACCIDENTE TOTAL'],
      group: coverageGroup('C'),
    },
    {
      containsAny: ['TERCEROS COMPLETOS BLACK'],
      group: coverageGroup('C Premium'),
    },
    {
      containsAny: ['T. COMPLETO L C/RASTREADOR', 'T COMPLETO L C/RASTREADOR'],
      group: coverageGroup('C'),
    },
    {
      containsAny: ['T. COMPLETO L', 'T COMPLETO L'],
      group: coverageGroup('C'),
    },
    {
      containsAny: ['T. COMPLETO XL + GRANIZO FULL(EXTRA LARGE)', 'TERCEROS COMPLETO XL + GRANIZO FULL(EXTRA LARGE)'],
      group: coverageGroup('C Premium'),
    },
    {
      containsAny: ['T. COMPLETO XL + GRANIZO', 'TERCEROS COMPLETO XL + GRANIZO'],
      group: coverageGroup('C++'),
    },
    {
      containsAny: ['T. COMPLETO XL C/RASTREADOR', 'T COMPLETO XL C/RASTREADOR'],
      group: coverageGroup('C'),
    },
    {
      containsAny: ['T. COMPLETO XL', 'T COMPLETO XL'],
      group: coverageGroup('C'),
    },
    {
      containsAny: ['XL FRANQUICIA FIJA'],
      group: coverageGroup('DF'),
    },
  ],
  aseguradoras: {
    mapfre: [
      {
        productoCodigos: ['3101'],
        group: coverageGroup('A'),
      },
      {
        productoCodigos: ['1402'],
        group: coverageGroup('C'),
      },
      {
        productoCodigos: ['1408'],
        group: coverageGroup('C++'),
      },
      {
        productoCodigos: ['1409'],
        group: coverageGroup('C+'),
      },
      {
        productoCodigos: ['1410'],
        group: coverageGroup('C'),
      },
      {
        productoCodigos: ['1209'],
        group: coverageGroup('C Premium'),
      },
      {
        productoCodigos: ['4409'],
        containsAny: ['FRANQUICIA VARIABLE', 'TODO AUTO'],
        group: coverageGroup('DV'),
      },
    ],
    allianz: [
      {
        containsAny: ['D4 - RC. T.R. CON FCIA'],
        group: coverageGroup('DV'),
      },
    ],
    experta: [
      {
        containsAny: ['XL FRANQUICIA FIJA'],
        group: coverageGroup('DF'),
      },
      {
        containsAny: ['T. COMPLETO XL + GRANIZO FULL(EXTRA LARGE)', 'TERCEROS COMPLETO XL + GRANIZO FULL(EXTRA LARGE)'],
        group: coverageGroup('C Premium'),
      },
      {
        containsAny: ['T. COMPLETO XL + GRANIZO', 'TERCEROS COMPLETO XL + GRANIZO'],
        group: coverageGroup('C++'),
      },
      {
        containsAny: ['T. COMPLETO XL', 'TERCEROS COMPLETO XL'],
        group: coverageGroup('C'),
      },
      {
        containsAny: ['T. COMPLETO L', 'TERCEROS COMPLETO L'],
        group: coverageGroup('C'),
      },
    ],
    atm: [
      {
        containsAny: ['TERCEROS COMPLETOS PLUS'],
        group: coverageGroup('C'),
      },
      {
        containsAny: ['TERCEROS COMPLETOS PREMIUM'],
        group: coverageGroup('C++'),
      },
      {
        containsAny: ['TERCEROS COMPLETOS BLACK'],
        group: coverageGroup('C Premium'),
      },
    ],
    rivadavia: [
      {
        productoCodigos: ['C'],
        group: coverageGroup('C'),
      },
      {
        productoCodigos: ['D'],
        containsAny: ['S/FRANQUIC'],
        group: coverageGroup('DF'),
      },
    ],
    sancor: [
      {
        containsAny: ['AUTO MAX 6'],
        group: coverageGroup('C'),
      },
      {
        containsAny: ['AUTO PREMIUM MAX'],
        group: coverageGroup('C Premium'),
      },
    ],
    smg: [
      {
        containsAny: ['RC C/X', 'RC S/X'],
        group: coverageGroup('A'),
      },
      {
        containsAny: ['TS1'],
        group: coverageGroup('B1'),
      },
      {
        containsAny: ['TC3', 'TC4'],
        group: coverageGroup('C'),
      },
      {
        containsAny: ['TR F'],
        group: coverageGroup('DF'),
      },
      {
        containsAny: ['TR V'],
        group: coverageGroup('DV'),
      },
    ],
  },
};

let coverageGroupOverridesCache = {
  mtimeMs: -1,
  payload: DEFAULT_COVERAGE_GROUP_OVERRIDES,
};

function normalizeStringArray(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function getCoverageGroupOverrides() {
  try {
    const stat = fs.existsSync(COVERAGE_GROUP_OVERRIDES_PATH) ? fs.statSync(COVERAGE_GROUP_OVERRIDES_PATH) : null;
    const mtimeMs = stat ? stat.mtimeMs : -1;
    if (coverageGroupOverridesCache.mtimeMs === mtimeMs) {
      return coverageGroupOverridesCache.payload;
    }

    let payload = DEFAULT_COVERAGE_GROUP_OVERRIDES;
    if (stat) {
      payload = JSON.parse(fs.readFileSync(COVERAGE_GROUP_OVERRIDES_PATH, 'utf8'));
    }
    coverageGroupOverridesCache = { mtimeMs, payload };
    return payload;
  } catch {
    coverageGroupOverridesCache = { mtimeMs: -1, payload: DEFAULT_COVERAGE_GROUP_OVERRIDES };
    return DEFAULT_COVERAGE_GROUP_OVERRIDES;
  }
}

function buildCoverageGroupContext(row = {}) {
  const slug = normalizeText(firstNonEmpty(row.aseguradora, row.Aseguradora)).toLowerCase();
  const text = normalizeText([
    row['Cobertura Descripcion'],
    row['Producto Descripcion'],
    row['Cobertura Codigo'],
    row['Producto Codigo'],
    row.Plan,
    row.cot_coberturas,
    row.cot_resultados,
    row.cot_nombreFranquicia,
    row.cot_nombreProducto,
    row.cot_descripcion,
    row.cot_descripcionDeCobertura,
    row.cot_descripcionDeProducto,
    row.cot_shortDescr,
    row.cot_longDescr,
  ].filter(Boolean).join(' | '));

  const productCodes = new Set(normalizeStringArray([
    row['Producto Codigo'],
    row.cot_codigoModalidad,
    row.cot_codigoDeProducto,
    row.cot_plan,
    row.cot_plan_cot,
  ]));
  const coverageCodes = new Set(normalizeStringArray([
    row['Cobertura Codigo'],
    row.cot_codigo,
    row.cot_codigoDeCobertura,
    row.cot_cobertura,
  ]));

  return { slug, text, productCodes, coverageCodes };
}

function matchCoverageGroupRule(rule = {}, ctx) {
  const containsAny = normalizeStringArray(rule.containsAny);
  if (containsAny.length && !containsAny.some((token) => ctx.text.includes(token))) return false;

  const containsAll = normalizeStringArray(rule.containsAll);
  if (containsAll.length && !containsAll.every((token) => ctx.text.includes(token))) return false;

  const productCodes = normalizeStringArray(rule.productoCodigos);
  if (productCodes.length && !productCodes.some((code) => ctx.productCodes.has(code))) return false;

  const coverageCodes = normalizeStringArray(rule.coberturaCodigos);
  if (coverageCodes.length && !coverageCodes.some((code) => ctx.coverageCodes.has(code))) return false;

  return true;
}

function resolveCoverageGroupOverride(row = {}) {
  const config = getCoverageGroupOverrides();
  const ctx = buildCoverageGroupContext(row);
  const rules = [
    ...(Array.isArray(config.global) ? config.global : []),
    ...(Array.isArray(config.aseguradoras?.[ctx.slug]) ? config.aseguradoras[ctx.slug] : []),
  ];

  for (const rule of rules) {
    if (!rule?.group) continue;
    if (matchCoverageGroupRule(rule, ctx)) {
      return coverageGroup(rule.group.code || '');
    }
  }
  return null;
}

function inferCoverageGroup(row = {}) {
  const override = resolveCoverageGroupOverride(row);
  if (override?.code) return override;

  const ctx = buildCoverageGroupContext(row);
  const text = ctx.text;

  const has = (pattern) => pattern.test(text);
  const percentMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const hasPercent = Boolean(percentMatch);
  const hasGarage = has(/\bGARAGE\b/);
  const hasGranizo = has(/\bGRANIZO\b/);
  const hasCristales = has(/\bCRISTAL|LUNETA|PARABRISA/);
  const hasTercerosCompleto = has(/\bTERCEROS?\s+COMPLET/ ) || has(/\bT\.\s*COMPLETO/);
  const hasComboCompleta = has(/ROBO E INCENDIO TOTAL Y\/O PARCIAL\s*\+\s*ACCIDENTE TOTAL/);
  const hasTodoRiesgo = has(/\bTODO RIESGO\b/) || has(/\bDANO PARCIAL ACCIDENTE\b/) || has(/\bAP\b/);
  const hasIncTotal = has(/\bINCENDIO TOTAL\b/) || has(/\bIT\b/);
  const hasIncParcial = has(/\bINCENDIO PARCIAL\b/) || has(/\bIP\b/);
  const hasRobTotal = has(/\bROBO\b.*\bTOTAL\b/) || has(/\bHURTO\b.*\bTOTAL\b/) || has(/\bRT\b/);
  const hasRobParcial = has(/\bROBO\b.*\bPARCIAL\b/) || has(/\bHURTO\b.*\bPARCIAL\b/) || has(/\bRP\b/);
  const hasAccTotal = has(/\bACCIDENTE\b.*\bTOTAL\b/) || has(/\bDESTRUCCION TOTAL\b/) || has(/\bAT\b/);
  const hasAccParcial = has(/\bACCIDENTE\b.*\bPARCIAL\b/) || has(/\bDANO PARCIAL ACCIDENTE\b/) || has(/\bAP\b/);
  const hasRC = has(/\bRESPONSABILIDAD CIVIL\b/) || has(/\bR\.C\.\b/) || has(/\bRC\b/);
  const hasPremium = has(/\bPREMIUM\b/) || has(/\bMAS BENEFICIOS\b/) || has(/\bPLUS\b/) || has(/\bFULL\b/);
  const noFranchise = has(/\bS\/FRANQ|\bS\/FRANQUIC|\bSIN FRANQUIC/);
  const startsB1 = has(/(^|\W)B1(\W|$)/);
  const startsB = has(/(^|\W)B(\W|$)/);
  const startsC1 = has(/(^|\W)C1(\W|$)/);
  const startsC = has(/(^|\W)C(\W|$)/);

  if (hasGarage) return coverageGroup('G');
  if (startsB1) return coverageGroup('B1');
  if (startsB) return coverageGroup('B');
  if (startsC1) return coverageGroup('C1');
  if (hasTodoRiesgo) {
    return hasPercent || !noFranchise
      ? coverageGroup('DV')
      : coverageGroup('DF');
  }
  if (hasTercerosCompleto) {
    return coverageGroup('C');
  }
  if (hasComboCompleta) return coverageGroup('C');
  if (hasRC && !hasIncTotal && !hasIncParcial && !hasRobTotal && !hasRobParcial && !hasAccTotal && !hasAccParcial) {
    return coverageGroup('A');
  }
  if ((hasIncTotal || hasRobTotal) && !hasIncParcial && !hasRobParcial && !hasAccTotal && !hasAccParcial) {
    return coverageGroup('B1');
  }
  if ((hasIncTotal || hasRobTotal || hasAccTotal) && !hasIncParcial && !hasRobParcial && !hasAccParcial) {
    return coverageGroup('B');
  }
  if ((hasIncParcial || hasRobParcial) && !hasAccTotal && !hasAccParcial) {
    return coverageGroup('C1');
  }
  if ((hasIncParcial || hasRobParcial) && hasAccTotal && !hasAccParcial) {
    if (hasPremium) return coverageGroup('C Premium');
    if (hasGranizo && hasCristales) return coverageGroup('C++');
    if (hasGranizo) return coverageGroup('C+');
    return coverageGroup('C');
  }
  if (startsC) return coverageGroup('C');
  if (hasRobParcial || hasIncParcial) return coverageGroup('C1');
  if (hasPremium) return coverageGroup('C Premium');
  return { code: '', description: '' };
}

function parseRecuperador(row = {}) {
  const explicit = normalizeText(firstNonEmpty(row.cot_conRecuperador, row.cot_hasTrackingEquipment));
  if (explicit === 'S' || explicit === 'SI' || explicit === 'TRUE' || explicit === 'CON') return 'Con';
  if (explicit === 'N' || explicit === 'NO' || explicit === 'FALSE' || explicit === 'SIN') return 'Sin';
  const text = normalizeText([row['Cobertura Descripcion'], row['Producto Descripcion']].filter(Boolean).join(' | '));
  if (/C\/RASTREADOR|CON RASTREADOR/.test(text)) return 'Con';
  if (/S\/RASTREADOR|SIN RASTREADOR/.test(text)) return 'Sin';
  return 'S/D';
}

function parseInspeccionable(row = {}) {
  const explicit = normalizeText(firstNonEmpty(row.cot_inspeccionable, row.cot_requiereInspeccion, row.cot_outStandard));
  if (explicit === 'S' || explicit === 'SI' || explicit === 'TRUE') return 'Si';
  if (explicit === 'N' || explicit === 'NO' || explicit === 'FALSE') return 'No';
  return 'S/D';
}

function inferCuotas(row = {}, usedMeta = {}) {
  const current = toNumber(firstNonEmpty(row.Cuotas));
  if (current != null) return current;

  const usedCuotas = toNumber(firstNonEmpty(
    usedMeta.cantidadDeCuotas,
    usedMeta.cantidad_cuotas,
    usedMeta.cuotas
  ));
  if (usedCuotas != null) return usedCuotas;

  const refact = normalizeText(firstNonEmpty(row.cab_refacturacion, usedMeta.refacturacion));
  if (refact.includes('MENSUAL')) return 1;

  const vigencia = normalizeText(firstNonEmpty(row.cab_vigencia, usedMeta.vigencia, row.cot_periodoFact));
  if (vigencia === 'M' || vigencia.includes('MENSUAL')) return 1;
  if (vigencia === 'T' || vigencia.includes('TRIMESTRAL')) return 3;
  if (vigencia === 'S' || vigencia.includes('SEMESTRAL')) return 6;
  if (vigencia === 'A' || vigencia.includes('ANUAL')) return 12;

  const duracion = toNumber(firstNonEmpty(row.cot_duracion, usedMeta.duracion));
  if (duracion != null) return duracion;

  return null;
}

function inferPeriodoFacturacion(row = {}, cuotas = null) {
  const raw = normalizeText(firstNonEmpty(row.cot_periodoFact, row.cab_refacturacion));
  if (raw === 'M' || raw.includes('MENSUAL')) return 'Mensual';
  if (raw === 'T' || raw.includes('TRIMESTRAL')) return 'Trimestral';
  if (raw === 'S' || raw.includes('SEMESTRAL')) return 'Semestral';
  if (raw === 'A' || raw.includes('ANUAL')) return 'Anual';
  if (cuotas === 1) return 'Mensual';
  if (cuotas === 3) return 'Trimestral';
  if (cuotas === 6) return 'Semestral';
  if (cuotas === 12) return 'Anual';
  return '';
}

function inferDuracion(row = {}, cuotas = null) {
  const raw = firstNonEmpty(row.cot_duracion, row.cab_vigencia);
  if (raw !== '') return raw;
  if (cuotas === 1 || cuotas === 3 || cuotas === 6 || cuotas === 12) return cuotas;
  return '';
}

function inferFranquicia(row = {}, sumaAsegurada) {
  const explicit = firstNonEmpty(row.Franquicia);
  if (explicit !== '') {
    const txt = normalizeText(explicit);
    if (/S\/FRANQ|S\/FRANQUIC|SIN FRANQUIC/.test(txt)) return 0;
    const n = roundMoney(explicit, 0);
    if (n != null) return n;
  }

  const text = normalizeText([row['Cobertura Descripcion'], row['Producto Descripcion']].filter(Boolean).join(' | '));
  if (/S\/FRANQ|S\/FRANQUIC|SIN FRANQUIC/.test(text)) return 0;
  const pct = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const suma = toNumber(sumaAsegurada);
  if (pct && suma != null) {
    const value = (suma * Number(pct[1].replace(',', '.'))) / 100;
    return roundMoney(value, 0);
  }
  return '';
}

function enrichExcelRowCanonicalFields(row = {}) {
  const next = applyVehicleExcelAliases(row);
  const sancorFinancials = deriveSancorExcelFinancials(row);
  const isSancor = String(row.aseguradora || '').trim().toLowerCase() === 'sancor';
  const coberturaCodigo = firstNonEmpty(
    row.cot_codigo,
    row.cot_codigoDeCobertura,
    row.cot_cobertura
  );
  let coberturaDescripcion = firstNonEmpty(
    row.cot_descripcion,
    row.cot_descripcionDeCobertura,
    row.cot_shortDescr,
    row.cot_longDescr
  );
  if (
    coberturaDescripcion !== '' &&
    String(coberturaDescripcion).trim() === String(coberturaCodigo).trim() &&
    !firstNonEmpty(row.cot_descripcion, row.cot_descripcionDeCobertura, row.cot_shortDescr, row.cot_longDescr)
  ) {
    coberturaDescripcion = '';
  }
  next['Cobertura Codigo'] = coberturaCodigo;
  next['Cobertura Descripcion'] = coberturaDescripcion;
  next['Producto Codigo'] = firstNonEmpty(
    row.cot_codigoDeProducto,
    row.cot_codigoModalidad,
    row.cot_plan,
    row.cot_plan_cot
  );
  next['Producto Descripcion'] = firstNonEmpty(
    row.cot_descripcionDeProducto,
    row.cot_nombreProducto,
    row.cot_longDescr,
    row.cot_shortDescr,
    row.cot_descripcionDeCobertura,
    row.cot_descripcion
  );
  next.Plan = firstNonEmpty(
    row.cot_plan,
    row.cot_plan_cot,
    row.cot_codigoModalidad,
    row.cot_codigoDeProducto
  );
  next['Forma Pago'] = firstNonEmpty(row.cot_formapago);
  next['Forma Pago Descripcion'] = firstNonEmpty(row.cot_formapago_descripcion);
  next.Cuotas = firstNonEmpty(row.cot_cuotas, row.cot_cantidadCuotas);
  next['Importe Cuota'] = firstNonEmpty(row.cot_impcuotas, row.cot_importeCuota, row.cot_montoPrimeraCuota);
  next['Prima Mensual'] = firstNonEmpty(
    row['Prima Mensual'],
    row.cot_purePremiumMonthlyTotal,
    row.cot_primaMonthlyTotal,
    isSancor ? firstNonEmpty(row.cot_prima, row.cot_importePrima, sancorFinancials?.primaMensual) : ''
  );
  next['Prima Vigencia'] = firstNonEmpty(
    row['Prima Vigencia'],
    row.cot_purePremiumTotal,
    row.cot_primaAnnual,
    sancorFinancials?.primaVigencia
  );
  next.Prima = firstNonEmpty(
    next['Prima Mensual'],
    row.cot_prima,
    row.cot_importePrima,
    row.cot_montoPrimaTotal,
    row.cot_premiumMonthly
  );
  next['Premio Mensual'] = firstNonEmpty(
    row['Premio Mensual'],
    row.cot_premiumMonthly,
    isSancor ? firstNonEmpty(row.cot_premio, row.cot_importePremio, sancorFinancials?.premioMensual) : ''
  );
  next['Premio Vigencia'] = firstNonEmpty(
    row['Premio Vigencia'],
    row.cot_premium,
    row.cot_premioAnnual,
    sancorFinancials?.premioVigencia
  );
  next.Premio = firstNonEmpty(
    next['Premio Mensual'],
    row.cot_premio,
    row.cot_importePremio,
    row.cot_montoPremio,
    row.cot_premium
  );
  next['Premio Contado'] = firstNonEmpty(row.cot_importePremioContado);
  next['Premio Debito'] = firstNonEmpty(row.cot_importePremioDebito);
  next['Premio Efectivo'] = firstNonEmpty(row.cot_importePremioEfectivo);
  next['IVA Mensual'] = firstNonEmpty(
    row['IVA Mensual'],
    row.cot_ivaMonthly,
    row.cot_importeIVA,
    row.cot_montoIVA,
    sancorFinancials?.ivaMensual
  );
  next['IVA Vigencia'] = firstNonEmpty(
    row['IVA Vigencia'],
    row.cot_ivaAnnual,
    sancorFinancials?.ivaVigencia
  );
  next['Impuestos Mensuales'] = firstNonEmpty(
    row['Impuestos Mensuales'],
    row.cot_impuestosMonthly,
    row.cot_importeTotalImpuestos,
    sancorFinancials?.impuestosMensuales
  );
  next['Impuestos Vigencia'] = firstNonEmpty(
    row['Impuestos Vigencia'],
    row.cot_impuestosAnnual,
    sancorFinancials?.impuestosVigencia
  );
  next.IVA = firstNonEmpty(next['IVA Mensual'], row.cot_importeIVA, row.cot_montoIVA);
  next.Franquicia = firstNonEmpty(row.cot_franquicia, row.cot_montoFranquicia, row.cot_nombreFranquicia);
  next.Inspeccionable = firstNonEmpty(row.cot_inspeccionable, row.cot_requiereInspeccion, row.cot_outStandard);
  next['Operacion/Cotizacion'] = firstNonEmpty(row.cot_numCotizacion, row.operacion, row.cot_pricingId);
  return next;
}

function buildCanonicalExcelRow(row = {}, usedMeta = {}) {
  row = applyVehicleExcelAliases(row);
  const estado = row.skipped ? 'skipped' : (row.ok ? 'ok' : 'error');
  const coberturaDescripcion = firstNonEmpty(row['Cobertura Descripcion'], row['Producto Descripcion']);
  const productoDescripcion = firstNonEmpty(row['Producto Descripcion'], row['Cobertura Descripcion']);
  let grupo = inferCoverageGroup({
    ...row,
    'Cobertura Descripcion': coberturaDescripcion,
    'Producto Descripcion': productoDescripcion,
  });
  const textForGroup = normalizeText([coberturaDescripcion, productoDescripcion].filter(Boolean).join(' | '));
  if (textForGroup.includes('ROBO E INCENDIO TOTAL Y/O PARCIAL + ACCIDENTE TOTAL')) {
    grupo = coverageGroup('C');
  }
  if (textForGroup.includes('TERCEROS COMPLETOS') || textForGroup.includes('T. COMPLETO')) {
    grupo = coverageGroup('C');
  }
  const cuotas = inferCuotas(row, usedMeta);
  const periodoFacturacion = inferPeriodoFacturacion(row, cuotas);
  const duracion = inferDuracion(row, cuotas);
  const sumaAsegurada = roundMoney(firstNonEmpty(row.cot_sumaAsegurada, row['Suma Asegurada']), 0);
  const primaMensual = roundMoney(firstNonEmpty(row['Prima Mensual'], row.Prima), 2);
  const primaVigencia = roundMoney(row['Prima Vigencia'], 2);
  const premioMensual = roundMoney(firstNonEmpty(row['Premio Mensual'], row.Premio), 2);
  const premioVigencia = roundMoney(row['Premio Vigencia'], 2);
  const importeCuota = roundMoney(firstNonEmpty(row['Importe Cuota'], (premioMensual != null && cuotas ? premioMensual / cuotas : '')), 2);
  const ivaMensual = roundMoney(firstNonEmpty(row['IVA Mensual'], row.IVA), 2);
  const ivaVigencia = roundMoney(row['IVA Vigencia'], 2);
  const impuestosMensuales = roundMoney(row['Impuestos Mensuales'], 2);
  const impuestosVigencia = roundMoney(row['Impuestos Vigencia'], 2);
  const prima = primaMensual;
  const premio = premioMensual;
  const iva = ivaMensual;
  const franquicia = inferFranquicia(row, sumaAsegurada);
  const franquiciaRobo = (() => {
    const n = roundMoney(row.cot_franquiciaRobo, 0);
    return n == null ? '' : n;
  })();
  const comisionValor = roundMoney(firstNonEmpty(row.cot_comision, row.cot_valorComisionPAS), 2);
  const porcentajeComision = (() => {
    const explicit = toNumber(row.cot_porcentajeComisionPAS);
    if (explicit != null) return Math.round(explicit * 100) / 100;
    if (comisionValor != null && prima && prima !== 0) return Math.round((comisionValor / prima * 100) * 100) / 100;
    return '';
  })();
  const medioPagoRequest = firstNonEmpty(row.cab_medio_pago);
  const medioPagoResponse = firstNonEmpty(row['Forma Pago'], medioPagoRequest);
  const vehiculoTipo = firstNonEmpty(usedMeta.descripcionTipoVehiculo, row.veh_tipo_vehiculo);
  const quoteParts = formatQuoteDateParts(firstNonEmpty(row.finished_at, row.created_at));
  const edadCotizada = inferEdadCotizada(row.cab_fec_nac, firstNonEmpty(row.finished_at, row.created_at));
  const vehiculoCombustible = inferVehiculoCombustible(row, usedMeta);

  return {
    'Proceso ID': row.proceso_id ?? '',
    'Historial ID': row.historial_id ?? '',
    'Cabecera ID': row.cabecera_id ?? '',
    Aseguradora: row.aseguradora ?? '',
    Fila: row.index ?? '',
    Estado: estado,
    'Fecha Cotizacion': quoteParts.fecha,
    'Hora Cotizacion': quoteParts.hora,
    'Operacion/Cotizacion': firstNonEmpty(row['Operacion/Cotizacion'], row.operacion, row.cot_numCotizacion, row.cot_pricingId),
    Cabecera: row.cab_nombre ?? '',
    'Parametro Tipo Persona': row.cab_tipopersona ?? '',
    'Parametro IVA': row.cab_iva ?? '',
    'Parametro Tipo Doc': row.cab_tipodoc ?? '',
    'Medio Pago Request': medioPagoRequest,
    'Medio Pago Response': medioPagoResponse,
    'Parametro Sexo': row.cab_sexo ?? '',
    'Parametro Fecha Nacimiento': row.cab_fec_nac ?? '',
    'Edad Cotizada': edadCotizada,
    'Parametro Estado Civil': row.cab_est_civil ?? '',
    'Parametro Tipo Uso': row.cab_tipo_uso ?? '',
    'Parametro Rastreo': row.cab_rastreo ?? '',
    'Parametro GNC': row.cab_gnc ?? '',
    'Parametro Ajuste': row.cab_ajuste ?? '',
    'Vehiculo Anio': row.veh_anio ?? '',
    'Vehiculo Marca': row.veh_marca ?? '',
    'Vehiculo Modelo': row.veh_modelo ?? '',
    'Vehiculo Codigo Infoauto': row.veh_codigo_infoauto ?? '',
    'Vehiculo Tipo': vehiculoTipo,
    'Vehiculo Combustible': vehiculoCombustible,
    'Vehiculo Uso': row.veh_uso ?? '',
    'Vehiculo Provincia': row.veh_provincia ?? '',
    'Vehiculo Localidad': row.veh_localidad ?? '',
    'Vehiculo CP': row.veh_CP ?? '',
    'Grupo Cobertura Codigo': grupo.code,
    'Grupo Cobertura Descripcion': grupo.description,
    'Cobertura Codigo': firstNonEmpty(row['Cobertura Codigo']),
    'Cobertura Descripcion': coberturaDescripcion,
    'Producto Codigo': firstNonEmpty(row['Producto Codigo']),
    'Producto Descripcion': productoDescripcion,
    Plan: firstNonEmpty(row.Plan),
     'Periodo Facturacion': periodoFacturacion,
     Duracion: duracion,
     Cuotas: cuotas ?? '',
     'Importe Cuota': importeCuota ?? '',
     Prima: prima ?? '',
     'Prima Mensual': primaMensual ?? '',
     'Prima Vigencia': primaVigencia ?? '',
     Premio: premio ?? '',
     'Premio Mensual': premioMensual ?? '',
     'Premio Vigencia': premioVigencia ?? '',
     'Suma Asegurada': sumaAsegurada ?? '',
     IVA: iva ?? '',
     'IVA Mensual': ivaMensual ?? '',
     'IVA Vigencia': ivaVigencia ?? '',
     'Impuestos Mensuales': impuestosMensuales ?? '',
     'Impuestos Vigencia': impuestosVigencia ?? '',
     Franquicia: franquicia,
     'Franquicia Robo': franquiciaRobo,
     Recuperador: parseRecuperador(row),
     Inspeccionable: parseInspeccionable(row),
     Comision: comisionValor ?? '',
    '% Comision': porcentajeComision,
    Error: firstNonEmpty(row.error),
    Observacion: firstNonEmpty(row.reason),
  };
}

async function generarExcelProceso(procesoId) {
  const id = Number(procesoId);
  const meta = await loadMetadata(id);
  if (!meta) throw new Error('No existe el proceso');

  const rp = resumenPath(id);
  if (!fs.existsSync(rp)) throw new Error('El proceso no tiene resumen.json');
  const resumen = JSON.parse(fs.readFileSync(rp, 'utf8'));

  const cabecera = meta.cabecera_id ? getCabecera(meta.cabecera_id) : null;

  // Resolver archivo combinado desde metadata (fallback: DB historial)
  let relArchivo = meta.archivo || null;
  let absArchivo = null;
  if (relArchivo) {
    absArchivo = path.isAbsolute(relArchivo) ? relArchivo : path.join(process.cwd(), relArchivo);
  } else if (meta.historial_id) {
    const hist = await getHistorialItem(meta.historial_id);
    if (hist) {
      const resolved = resolveCombinedAbsPath(hist);
      relArchivo = resolved.relPath;
      absArchivo = resolved.absPath;
    }
  }
  if (!absArchivo || !fs.existsSync(absArchivo)) {
    throw new Error('No se encontró el archivo combinado para exportar');
  }

  const filas = await readFilasFromFile(absArchivo);

  const rowsCot = [];
  const rowsCotCanonical = [];
  const rowsSkip = [];
  const rowsErr = [];

  for (const slug of Object.keys(resumen.resultados || {})) {
    const arr = Array.isArray(resumen.resultados[slug]) ? resumen.resultados[slug] : [];
    for (const item of arr) {
      const idx = Number(item.index);
      const filaIn = filas[idx] || {};
      const base = {
        proceso_id: id,
        historial_id: meta.historial_id || resumen.historial_id || null,
        cabecera_id: meta.cabecera_id || resumen.cabecera_id || null,
        aseguradora: slug,
        index: idx,
        finished_at: item.finished_at || '',
        ok: item.ok === true,
        skipped: item.skipped === true,
        operacion: item.operacion || '',
        reason: item.reason || '',
        error: item.error || '',
      };

      const filaFlat = flattenForExcel(filaIn, 'veh_');
      const cabFlat = cabecera ? flattenForExcel(cabecera, 'cab_') : {};

      if (item.skipped) {
        const rawRow = enrichExcelRowCanonicalFields({ ...base, ...filaFlat, ...cabFlat, used: JSON.stringify(item.used || {}) });
        rowsSkip.push(rawRow);
        continue;
      }

      if (!item.ok) {
        const rawRow = enrichExcelRowCanonicalFields({ ...base, ...filaFlat, ...cabFlat, used: JSON.stringify(item.used || {}) });
        rowsErr.push(rawRow);
        continue;
      }

      // ok y no skipped: una fila por cobertura (si existe), sino una fila base
      const cobs = Array.isArray(item.coberturas) ? item.coberturas : [];
      const sumaAsegurada = await resolveSumaAsegurada({
        row: { ...filaIn, ...item.fila_preview },
        responseAmount: item.suma_asegurada,
      });
      if (cobs.length === 0) {
        const row = {
          ...base,
          ...filaFlat,
          ...cabFlat,
          used: JSON.stringify(item.used || {}),
        };
        const rawRow = enrichExcelRowCanonicalFields(insertFieldBeforePrefix(row, 'Suma Asegurada', sumaAsegurada, 'cot_'));
        rowsCot.push(rawRow);
        rowsCotCanonical.push(buildCanonicalExcelRow(rawRow, item.used || {}));
      } else {
        for (const cob of cobs) {
          const cobFlat = flattenForExcel(cob, 'cot_');
          const row = {
            ...base,
            ...filaFlat,
            ...cabFlat,
            ...cobFlat,
            used: JSON.stringify(item.used || {}),
          };
          const rawRow = enrichExcelRowCanonicalFields(insertFieldBeforePrefix(row, 'Suma Asegurada', sumaAsegurada, 'cot_'));
          rowsCot.push(rawRow);
          rowsCotCanonical.push(buildCanonicalExcelRow(rawRow, item.used || {}));
        }
      }
    }
  }

  const wb = xlsx.utils.book_new();
  const wsCot = buildCanonicalSheet(rowsCotCanonical);
  applyCanonicalSheetBackfills(wsCot, rowsCotCanonical);
  applyCanonicalSheetFormats(wsCot, rowsCotCanonical);
  xlsx.utils.book_append_sheet(wb, wsCot, 'Cotizaciones');

  const wsCotRaw = buildSheetFromRows(rowsCot);
  xlsx.utils.book_append_sheet(wb, wsCotRaw, 'Raw');

  const wsErr = buildSheetFromRows(rowsErr);
  xlsx.utils.book_append_sheet(wb, wsErr, 'Errores');

  const wsSkip = buildSheetFromRows(rowsSkip);
  xlsx.utils.book_append_sheet(wb, wsSkip, 'Skipped');

  const dlDir = path.join(procesoDir(id), 'descargas');
  ensureDir(dlDir);
  const outAbs = path.join(dlDir, `proceso-${id}-cotizaciones.xlsx`);
  xlsx.writeFile(wb, outAbs);
  const unresolvedCoverageGroups = rowsCotCanonical
    .map((row) => ({ row, inferred: inferCoverageGroup(row) }))
    .filter(({ row, inferred }) => !firstNonEmpty(row['Grupo Cobertura Codigo'], inferred.code))
    .slice(0, 50)
    .map(({ row }) => ({
      aseguradora: row.Aseguradora,
      fila: row.Fila,
      coberturaCodigo: row['Cobertura Codigo'],
      coberturaDescripcion: row['Cobertura Descripcion'],
      productoCodigo: row['Producto Codigo'],
      productoDescripcion: row['Producto Descripcion'],
      plan: row.Plan,
    }));
  safeWriteJson(path.join(procesoDir(id), 'excel_manifest.json'), {
    generated_at: new Date().toISOString(),
    sheets: wb.SheetNames,
    cotizaciones_headers: rowsCotCanonical.length ? Object.keys(rowsCotCanonical[0]) : [],
    cotizaciones_sample: rowsCotCanonical.slice(0, 8),
    unresolved_coverage_groups: unresolvedCoverageGroups,
    worksheet_preview: {
      A1: wsCot.A1?.v ?? null,
      B1: wsCot.B1?.v ?? null,
      C1: wsCot.C1?.v ?? null,
      D1: wsCot.D1?.v ?? null,
      E1: wsCot.E1?.v ?? null,
      F1: wsCot.F1?.v ?? null,
      G1: wsCot.G1?.v ?? null,
      H1: wsCot.H1?.v ?? null,
      I1: wsCot.I1?.v ?? null,
      J1: wsCot.J1?.v ?? null,
      K1: wsCot.K1?.v ?? null,
      L1: wsCot.L1?.v ?? null,
    },
    raw_headers: rowsCot.length ? Object.keys(rowsCot[0]) : [],
  });
  return outAbs;
}

async function loadMetadata(id) {
  const p = metadataPath(id);
  if (!fs.existsSync(p)) return null;
  return await readJsonStrict(p);
}
async function saveMetadata(id, patch) {
  ensureDir(procesoDir(id));
  const key = String(id);
  const prev = metadataWriteLocks.get(key) || Promise.resolve();
  const nextPromise = prev
    .catch(() => {})
    .then(async () => {
      const cur = (await loadMetadata(id)) || {};
      const next = { ...cur, ...patch };
      await writeJson(metadataPath(id), next);
      return next;
    });

  metadataWriteLocks.set(key, nextPromise);

  try {
    return await nextPromise;
  } finally {
    if (metadataWriteLocks.get(key) === nextPromise) {
      metadataWriteLocks.delete(key);
    }
  }
}

async function loadResumen(id) {
  const p = resumenPath(id);
  if (!fs.existsSync(p)) return null;
  return await readJsonStrict(p);
}

function isTechnicalFailure(result = {}) {
  if (!result || result.ok || result.skipped) return false;
  if (result.technical_error === true) return true;
  if (result.technical_error === false || result.retryable === false || result.pending === false) return false;

  const status = Number(result.http_status || result.status_code || 0);
  if (status === 429 || status >= 500) return true;

  const msg = normalizeText(result.error || result.reason || '');
  if (!msg) return false;

  const patterns = [
    'HTTP 429',
    'HTTP 500',
    'HTTP 502',
    'HTTP 503',
    'HTTP 504',
    'TIMEOUT',
    'TIMED OUT',
    'ECONNRESET',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'SOCKET HANG UP',
    'NETWORK ERROR',
    'SERVICE UNAVAILABLE',
    'BAD GATEWAY',
    'GATEWAY TIMEOUT',
    'TEMPORARILY UNAVAILABLE',
    'TOO MANY REQUESTS',
  ];

  return patterns.some((pattern) => msg.includes(pattern));
}

function annotateResultStatus(result = {}) {
  if (!result || result.ok || result.skipped) {
    return {
      ...(result || {}),
      pending: false,
      technical_error: false,
      retryable: false,
    };
  }

  const technical = isTechnicalFailure(result);
  return {
    ...result,
    pending: technical,
    technical_error: technical,
    retryable: technical,
  };
}

function buildTechnicalFailureResult(err, extra = {}) {
  const status = Number(err?.response?.status || err?.status || 0) || null;
  const detail = err?.response?.data;
  const msg = err?.message || String(err || 'Error técnico');
  const base = annotateResultStatus({
    ok: false,
    error: status ? `HTTP ${status} - ${msg}` : msg,
    operacion: '0',
    coberturas: [],
    raw: typeof detail === 'string' ? detail : '',
    http_status: status,
    ...extra,
  });
  return base;
}

function summarizeResultados(resultados = {}, aseguradoras = []) {
  const summary = {
    total: 0,
    ok: 0,
    err: 0,
    skipped: 0,
    pending: 0,
    pendingByCompany: {},
  };

  for (const slug of aseguradoras) {
    const arr = Array.isArray(resultados?.[slug]) ? resultados[slug] : [];
    let pendingCompany = 0;
    for (const item of arr) {
      if (!item) {
        summary.pending += 1;
        pendingCompany += 1;
        continue;
      }
      summary.total += 1;
      if (item.skipped) {
        summary.skipped += 1;
        continue;
      }
      if (item.ok) {
        summary.ok += 1;
        continue;
      }
      if (item.pending) {
        summary.pending += 1;
        pendingCompany += 1;
        continue;
      }
      summary.err += 1;
    }
    if (pendingCompany > 0) summary.pendingByCompany[slug] = pendingCompany;
  }

  return summary;
}

function collectPendingIndexes(resultados = {}, slug, tomar) {
  const arr = Array.isArray(resultados?.[slug]) ? resultados[slug] : [];
  const indexes = [];
  for (let i = 0; i < tomar; i++) {
    const item = arr[i];
    if (!item || item.pending === true) indexes.push(i);
  }
  return indexes;
}

function writeResumenArtifacts(id, resumen) {
  fs.writeFileSync(resumenPath(id), JSON.stringify(resumen, null, 2), 'utf8');

  const head = 'aseguradora,index,ok,pending,operacion,coberturas,error';
  const lines = [];
  for (const slug of Object.keys(resumen.resultados || {})) {
    const arr = Array.isArray(resumen.resultados[slug]) ? resumen.resultados[slug] : [];
    for (const r of arr) {
      if (!r) continue;
      lines.push(
        [
          slug,
          r.index,
          r.ok ? 1 : 0,
          r.pending ? 1 : 0,
          r.operacion ?? '',
          Array.isArray(r.coberturas) ? r.coberturas.length : 0,
          (r.error || '').replace(/[\r\n,]+/g, ' '),
        ].join(',')
      );
    }
  }
  fs.writeFileSync(path.join(procesoDir(id), 'resumen.csv'), [head, ...lines].join('\n'));
}

function buildProcesoResumenSnapshot({
  proceso_id,
  historial_id,
  relPath,
  tomar,
  cabecera_id,
  aseguradoras,
  resultadosPorAseg,
}) {
  return {
    id: proceso_id,
    historial_id,
    archivo: relPath.replace(/\\/g, '/'),
    fecha: new Date().toISOString(),
    limite: tomar,
    cabecera_id,
    aseguradoras,
    resultados: resultadosPorAseg,
  };
}

async function updateProcesoDbState(proceso_id, estado, counts) {
  try {
    const normalizedEstado = String(estado || '').trim().toLowerCase() === 'incompleto'
      ? 'con errores'
      : estado;
    await db.execute(
      `UPDATE procesos_cotizacion
       SET estado = ?, fecha_fin = NOW(),
           registros_procesados = ?, cotizaciones_exitosas = ?, cotizaciones_con_error = ?
       WHERE id = ?`,
      [normalizedEstado, counts.total, counts.ok, counts.err, proceso_id]
    );
  } catch (e) {
    console.warn('No se pudo actualizar procesos_cotizacion', e?.message || e);
  }
}

async function getHistorialItem(historial_id) {
  const [rows] = await db.execute(
    'SELECT id, nombre_archivo, ruta, ruta AS archivo, fecha, cantidad_registros FROM historial_combinaciones WHERE id = ? LIMIT 1',
    [Number(historial_id)]
  );
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

function resolveCombinedAbsPath(item) {
  const relPath =
    item.ruta && String(item.ruta).trim()
      ? String(item.ruta).trim()
      : path.join('data', 'combinados', item.nombre_archivo);
  const abs = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);
  return { relPath: relPath.replace(/\\/g, '/'), absPath: abs };
}

async function readFilasFromFile(absPath) {
  let filas = [];

  if (absPath.toLowerCase().endsWith('.csv')) {
    const csv = fs.readFileSync(absPath, 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const headers = (lines.shift() || '').split(',').map((s) => s.trim());
    for (const ln of lines) {
      const cols = ln.split(',');
      const obj = {};
      headers.forEach((h, i) => (obj[h] = cols[i] ?? ''));
      filas.push(obj);
    }
    return filas;
  }

  const wb = xlsx.readFile(absPath);

  // Elegir una hoja "con rango" y luego una con filas parseables
  const sheetNames = wb.SheetNames || [];
  let best = sheetNames[0];

  // 1) Preferir la hoja con más filas en el rango (!ref)
  let bestRows = -1;
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws && ws['!ref'];
    if (!ref) continue;
    const r = xlsx.utils.decode_range(ref);
    const rowsInRange = (r.e.r - r.s.r + 1);
    if (rowsInRange > bestRows) {
      bestRows = rowsInRange;
      best = name;
    }
  }

  // 2) Intentar parsear; si da 0, probar otras hojas
  const tryParse = (name) => xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });

  filas = tryParse(best) || [];
  if (filas.length === 0) {
    for (const name of sheetNames) {
      const tmp = tryParse(name) || [];
      if (tmp.length > 0) {
        filas = tmp;
        break;
      }
    }
  }

  return filas;
}

// ===== Instrumentación (evidencias por fila) =====
function evidenciasDir(proceso_id, slug, index) {
  return path.join(procesoDir(proceso_id), 'evidencias', String(slug), `fila-${String(index).padStart(4, '0')}`);
}
function safeWriteFile(absPath, content, encoding = 'utf8') {
  try {
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, content, encoding);
    return true;
  } catch {
    return false;
  }
}
function safeWriteJson(absPath, obj) {
  try {
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ===== Caller SOAP para una fila =====
async function cotizarFila({
  proceso_id,
  slug,
  index,
  fila,
  cabecera,
  hoy_fmt,
  mapeos,
  Aseg,
  SOAP_URL,
  SOAP_METHOD,
  usoDicc,
}) {
  const codiaRaw = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto
  ]);
  const codia = String(codiaRaw ?? '').trim();
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const cpRaw = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]);
  const cp = String(cpRaw ?? '').trim();
  const atmPostal = slug === 'atm' ? await resolveAtmPostalCode(fila) : null;

  const evDir = (proceso_id != null && slug != null && index != null)
    ? evidenciasDir(proceso_id, slug, index)
    : null;
  const evPrefix = String(slug || 'aseguradora');

  if (evDir) {
    safeWriteJson(path.join(evDir, 'fila_input.json'), { fila, mapeos, cabecera_id: cabecera?.id ?? null });
  }

  if (slug === 'mapfre') {
    const postalMatch = resolveMapfrePostalMatch(fila, cabecera);
    if (!resolveMapfreCodPostal(fila, cabecera)) {
      const out = { ok: false, error: 'Mapfre requiere un código postal traducible por catálogo (CP y, si aplica, localidad/provincia)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (!isMapfrePostalMatchSafe(postalMatch)) {
      const out = { ok: false, error: `Mapfre requiere un match de domicilio no ambiguo (actual: ${postalMatch?.matchType || 'sin_match'})`, operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
  } else {
    if (slug !== 'provincia' && !cp) {
      const out = { ok: false, error: 'Debe informar el código postal', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (slug !== 'provincia' && !/^\d{4}$/.test(cp)) {
      const out = { ok: false, error: 'Código postal inválido (debe ser numérico de 4 posiciones)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (slug === 'atm' && (!atmPostal?.cp || !/^\d{4}$/.test(String(atmPostal.cp)))) {
      const out = { ok: false, error: 'El código postal no es válido', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
  }
}

  let usoCodigo = '';
  if (mapeos && mapeos.uso_codigo) {
    usoCodigo = String(mapeos.uso_codigo);
  } else {
    const usoExcel = pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso]);
    if (usoExcel) usoCodigo = mapUsoTextoACodigo(usoExcel, usoDicc);
    if (!usoCodigo) {
      const maybe = (cabecera?.uso_default || cabecera?.uso || '').toString().trim();
      if (maybe) usoCodigo = mapUsoTextoACodigo(maybe, usoDicc);
    }
  }

  const seccion =
    (mapeos && mapeos.seccion && String(mapeos.seccion).trim()) ||
    (cabecera?.seccion && String(cabecera.seccion).trim()) ||
    inferSeccionVehiculo(fila) ||
    (Aseg.seccion_default && String(Aseg.seccion_default).trim()) ||
    '3';

  const atmVehicle = slug === 'atm' ? await resolveAtmVehicleKind(fila) : null;
  const seccionAtm = String(atmVehicle?.seccion || '').trim();

  // Bypass motos: por ahora NO se envían al WS de autos (AUTOS_Cotizar_PHP).
  // Se detecta por: catálogo ATM, seccion=1 o texto tipo_vehiculo.
  const tipoVehTxt = pick([fila?.tipo_vehiculo, fila?.TipoVehiculo, fila?.tipoVehiculo]);
  const tipoVehNorm = (tipoVehTxt || '').toString().toLowerCase();
  const esMoto =
    atmVehicle?.isMoto === true ||
    seccionAtm === '4' ||
    String(seccion) === '1' ||
    tipoVehNorm.includes('moto') ||
    tipoVehNorm.includes('scooter');

  if (slug === 'atm' && String(SOAP_METHOD) === 'AUTOS_Cotizar_PHP' && esMoto) {
    const outSkip = {
      ok: true,
      skipped: true,
      reason: 'Moto: se omite WS AUTOS_Cotizar_PHP',
      operacion: 'SKIP_MOTO',
      coberturas: [],
      raw: '',
      used: { seccion, cod_infoauto: codia, soap_method: SOAP_METHOD }
    };
    if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-skip.json`), outSkip);
    return outSkip;
  }

  if (slug === 'mapfre') {
    let envelope;
    let requestMeta;
    try {
      const built = await buildMapfreEnvelope({
        fila,
        cabecera,
        hoyFmt: hoy_fmt,
        cfg: Aseg,
        mapeos,
      });
      envelope = built.envelope;
      requestMeta = built.requestMeta;
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (evDir) {
      safeWriteFile(path.join(evDir, `${evPrefix}-soap_request.xml`), envelope);
      safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
        soap_url: SOAP_URL,
        soap_method: SOAP_METHOD,
        request: requestMeta,
      });
    }

    try {
      const resp = await axios.post(SOAP_URL, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: SOAP_METHOD },
        timeout: 20000,
        validateStatus: () => true,
      });

      const rawResp = resp.data;
      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-raw_response.xml`), String(rawResp || ''));
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (!(resp.status >= 200 && resp.status < 300)) {
        const out = { ok: false, error: `HTTP ${resp.status}`, coberturas: [], raw: rawResp };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      const parsed = parseMapfreResponse(rawResp);
      parsed.used = {
        ...(parsed.used || {}),
        tipoMedioPagoSolicitado: requestMeta.tipoMedioPago,
        tipoMedioPagoDescripcion: describeMapfreTipoMedioPago(requestMeta.tipoMedioPago),
      };
      if (Array.isArray(parsed.coberturas)) {
        parsed.coberturas = parsed.coberturas.map((cob) => ({
          ...cob,
          formapago: requestMeta.tipoMedioPago,
          formapago_descripcion: describeMapfreTipoMedioPago(requestMeta.tipoMedioPago),
        }));
      }
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }
      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'sancor') {
    let tokenData;
    let envelope;
    let requestMeta;

    try {
      tokenData = await getSancorToken(Aseg);
      const built = buildSancorEnvelope({
        fila,
        cabecera,
        cfg: Aseg,
        mapeos,
        today: new Date(),
      });
      envelope = built.envelope;
      requestMeta = built.requestMeta;
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (evDir) {
      safeWriteFile(path.join(evDir, `${evPrefix}-soap_request.xml`), envelope);
      safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
        soap_url: SOAP_URL,
        soap_method: SOAP_METHOD,
        soap_action: Aseg.soap_action || null,
        auth_url: Aseg.auth_url || null,
        request: requestMeta,
        tokenType: tokenData.tokenType,
      });
    }

    try {
      const resp = await axios.post(SOAP_URL, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          SOAPAction: `"${Aseg.soap_action || SOAP_METHOD}"`,
          User: Aseg.quote_user || Aseg.usuario,
          TokenType: tokenData.tokenType || 'Bearer',
          Token: tokenData.idToken || tokenData.accessToken,
        },
        timeout: 25000,
        validateStatus: () => true,
      });

      const rawResp = resp.data;
      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-raw_response.xml`), String(rawResp || ''));
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      const parsed = parseSancorQuoteResponse(rawResp);
      parsed.http_status = resp.status;

      if (!(resp.status >= 200 && resp.status < 300) && parsed.ok) {
        parsed.ok = false;
        parsed.error = `HTTP ${resp.status}`;
        parsed.coberturas = [];
        parsed.operacion = parsed.operacion || '0';
      }

      parsed.used = {
        ...(parsed.used || {}),
        tokenType: tokenData.tokenType,
        quoteUser: Aseg.quote_user || Aseg.usuario,
        codPostalOriginal: requestMeta.codPostalOriginal,
        codPostal: requestMeta.codPostal,
        codLocalidad: requestMeta.codLocalidad,
        localidad: requestMeta.localidad,
        provincia: requestMeta.provincia,
        codProvincia: requestMeta.codProvincia,
        localidadMatchType: requestMeta.localidadMatchType,
        useId: requestMeta.useId,
        vehicleCapital: requestMeta.capital,
      };

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }
      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'allianz') {
    if (!String(Aseg.usuario || '').trim() || !String(Aseg.password || '').trim()) {
      const out = { ok: false, error: 'Allianz requiere usuario y password WS configurados', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (!String(Aseg.application || '').trim()) {
      const out = { ok: false, error: 'Allianz requiere Application configurada en EBMHeader', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    const variants = [
      { key: 'sin_granizo', granizo: false, additional: { sendEmptyList: true } },
      { key: 'con_granizo', granizo: true, additional: { codigoDeAdicional: '001', descripcion: 'Granizo' } },
    ];
    const branchResults = [];

    const runAllianzVariant = async (variant) => {
      let envelope;
      let requestMeta;
      try {
        const built = await buildAllianzEnvelope({
          fila,
          cabecera,
          cfg: Aseg,
          mapeos,
          usoDicc,
          today: new Date(),
          additional: variant.additional,
        });
        envelope = built.envelope;
        requestMeta = built.requestMeta;
      } catch (e) {
        return {
          ok: false,
          error: e.message || String(e),
          operacion: '0',
          coberturas: [],
          raw: '',
          used: { variant: variant.key, granizo: variant.granizo },
        };
      }

      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-${variant.key}-soap_request.xml`), envelope);
        safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-config-usada.json`), {
          soap_url: SOAP_URL,
          soap_method: SOAP_METHOD,
          soap_action: Aseg.soap_action || SOAP_METHOD,
          request: requestMeta,
        });
      }

      try {
        const resp = await axios.post(SOAP_URL, envelope, {
          headers: {
            'Content-Type': 'text/xml; charset=UTF-8',
            SOAPAction: `"${Aseg.soap_action || SOAP_METHOD}"`,
          },
          timeout: 25000,
          validateStatus: () => true,
        });

        const rawResp = resp.data;
        if (evDir) {
          safeWriteFile(path.join(evDir, `${evPrefix}-${variant.key}-raw_response.xml`), String(rawResp || ''));
          safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
        }

        if (!(resp.status >= 200 && resp.status < 300)) {
          return {
            ok: false,
            error: `HTTP ${resp.status}`,
            coberturas: [],
            raw: rawResp,
            used: { variant: variant.key, granizo: variant.granizo, ...requestMeta },
          };
        }

        const parsed = parseAllianzQuoteResponse(rawResp);
        parsed.coberturas = Array.isArray(parsed.coberturas)
          ? parsed.coberturas.map((cobertura) => ({
              ...cobertura,
              granizo: variant.granizo,
              codigoDeAdicional: requestMeta.adicionalCodigo,
              descripcionAdicional: requestMeta.adicionalDescripcion,
              varianteCotizacion: variant.key,
            }))
          : [];
        parsed.used = {
          ...(parsed.used || {}),
          variant: variant.key,
          granizo: variant.granizo,
          tipoDePoliza: requestMeta.tipoDePoliza,
          medioDePago: requestMeta.medioDePago,
          cantidadDeCuotas: requestMeta.cantidadDeCuotas,
          codigoPostal: requestMeta.codigoPostal,
          codigoProvincia: requestMeta.codigoProvincia,
          codigoDeProductor: requestMeta.codigoDeProductor,
          clausulaDeAjuste: requestMeta.clausulaDeAjuste,
          adicionalCodigo: requestMeta.adicionalCodigo,
          adicionalDescripcion: requestMeta.adicionalDescripcion,
          listaAdicionales: requestMeta.listaAdicionales,
        };

        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-parsed.json`), {
            ok: parsed.ok,
            operacion: parsed.operacion || '',
            coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
          });
          if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
            safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-coberturas.json`), parsed.coberturas);
          }
          if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-error.json`), parsed);
        }
        return parsed;
      } catch (e) {
        const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-exception.json`), {
            message: e?.message || String(e),
            stack: e?.stack || null,
          });
          safeWriteJson(path.join(evDir, `${evPrefix}-${variant.key}-error.json`), out);
        }
        return {
          ...out,
          used: { variant: variant.key, granizo: variant.granizo, ...(requestMeta || {}) },
        };
      }
    };

    for (const variant of variants) {
      branchResults.push({ variant, result: await runAllianzVariant(variant) });
    }

    const successful = branchResults.filter((item) => item.result?.ok);
    if (!successful.length) {
      const error = branchResults.map((item) => `${item.variant.key}: ${item.result?.error || 'sin respuesta'}`).join(' | ');
      const out = { ok: false, error, operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    const combinedCoberturas = successful.flatMap((item) => item.result.coberturas || []);
    const operaciones = branchResults
      .map((item) => item.result?.operacion)
      .filter(Boolean);
    const parsed = {
      ok: true,
      operacion: operaciones.join('|'),
      suma_asegurada: combinedCoberturas[0]?.sumaAsegurada || '',
      coberturas: combinedCoberturas,
      raw: '',
      used: {
        variants: branchResults.map((item) => ({
          variant: item.variant.key,
          ok: Boolean(item.result?.ok),
          operacion: item.result?.operacion || '',
          error: item.result?.error || '',
          coberturas_len: Array.isArray(item.result?.coberturas) ? item.result.coberturas.length : 0,
          granizo: item.variant.granizo,
        })),
      },
    };

    if (evDir) {
      safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
        ok: parsed.ok,
        operacion: parsed.operacion || '',
        coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        variants: parsed.used.variants,
      });
      safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
      safeWriteJson(path.join(evDir, `${evPrefix}-result.json`), {
        aseguradora: slug,
        ok: parsed.ok,
        pending: false,
        operacion: parsed.operacion || '',
        coberturas_len: parsed.coberturas.length,
        error: null,
        used: parsed.used,
      });
    }
    return parsed;
  }

  if (slug === 'experta') {
    let payload;
    let requestMeta;
    let session;

    if (!String(Aseg.usuario || '').trim() || !String(Aseg.password || '').trim() || !String(Aseg.api_key || Aseg.hashid || '').trim()) {
      const out = { ok: false, error: 'Experta requiere user, password y api-key configurados', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    try {
      session = await loginExperta(Aseg);
    } catch (e) {
      const out = { ok: false, error: e.message || 'Login Experta fallido', operacion: '0', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-login-error.json`), out);
      }
      return out;
    }

    try {
      const built = await buildExpertaPayload({
        fila,
        cabecera,
        cfg: Aseg,
        usoDicc,
        today: new Date(),
        token: session.jwt,
      });
      payload = built.payload;
      requestMeta = built.requestMeta;
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (evDir) {
      safeWriteJson(path.join(evDir, `${evPrefix}-request.json`), payload);
      safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
        url: SOAP_URL,
        request: requestMeta,
        login_url: `${String(Aseg.base_url || '').replace(/\/+$/, '')}/login`,
        api_key_configurada: Boolean(String(Aseg.api_key || Aseg.hashid || '').trim()),
      });
    }

    try {
      const resp = await postExpertaQuote(SOAP_URL, payload, session.jwt, Aseg);

      const rawResp = resp.data;
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-raw_response.json`), rawResp);
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (!(resp.status >= 200 && resp.status < 300)) {
        const out = { ok: false, error: `HTTP ${resp.status}`, coberturas: [], raw: rawResp };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      if (typeof rawResp === 'string' && /^\s*<!doctype html/i.test(rawResp)) {
        const out = { ok: false, error: 'Experta respondio HTML; falta confirmar URL base del API', coberturas: [], raw: rawResp };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      const parsed = parseExpertaQuoteResponse(rawResp, {
        selectedPriceKey: resolveExpertaPaymentKey(cabecera),
      });
      parsed.used = {
        ...(parsed.used || {}),
        codigoPostal: requestMeta.codigoPostal,
        modalidad: requestMeta.modalidad,
        iva: requestMeta.iva,
        uso: requestMeta.uso,
        porcentajeAjuste: requestMeta.porcentajeAjuste,
        authMode: 'login+jwt+api-key',
      };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }
      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'smg') {
    let envelope;
    let requestMeta;
    let smgSumaAsegurada = '0';
    let smgSumaLookup = { ok: false, sumaAsegurada: '0', error: 'SMG suma lookup no ejecutado' };

    try {
      const sumLookup = buildSmgSumLookupEnvelope({ fila });
      if (evDir) safeWriteFile(path.join(evDir, `${evPrefix}-sa_request.xml`), sumLookup.envelope);

      try {
        const sumResp = await axios.post(SOAP_URL, sumLookup.envelope, {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: '"http://tempuri.org/obtenerSAModeloAno"',
          },
          timeout: 20000,
          validateStatus: () => true,
        });

        const rawSumResp = sumResp.data;
        if (evDir) {
          safeWriteFile(path.join(evDir, `${evPrefix}-sa_raw_response.xml`), String(rawSumResp || ''));
          safeWriteJson(path.join(evDir, `${evPrefix}-sa_http.json`), { status: sumResp.status, ok: sumResp.status >= 200 && sumResp.status < 300 });
        }

        if (sumResp.status >= 200 && sumResp.status < 300) {
          smgSumaLookup = parseSmgSumLookupResponse(rawSumResp);
        } else {
          smgSumaLookup = {
            ok: false,
            error: `HTTP ${sumResp.status}`,
            sumaAsegurada: '0',
            raw: rawSumResp,
          };
        }

        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}-sa_parsed.json`), {
            ok: smgSumaLookup.ok,
            error: smgSumaLookup.error || '',
            sumaAsegurada: smgSumaLookup.sumaAsegurada || '0',
          });
        }
      } catch (e) {
        smgSumaLookup = { ok: false, error: e.message || 'axios error', sumaAsegurada: '0', raw: '' };
        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}-sa_exception.json`), {
            message: e?.message || String(e),
            stack: e?.stack || null,
          });
          safeWriteJson(path.join(evDir, `${evPrefix}-sa_parsed.json`), {
            ok: false,
            error: smgSumaLookup.error,
            sumaAsegurada: '0',
          });
        }
      }

      if (smgSumaLookup.ok && /^\d+$/.test(String(smgSumaLookup.sumaAsegurada || '')) && Number(smgSumaLookup.sumaAsegurada) > 0) {
        smgSumaAsegurada = String(smgSumaLookup.sumaAsegurada);
      }

      const built = buildSmgEnvelope({
        fila,
        cabecera,
        cfg: Aseg,
        mapeos,
        sumaAseguradaOverride: smgSumaAsegurada,
      });
      envelope = built.envelope;
      requestMeta = {
        ...built.requestMeta,
        smgSumaAseguradaLookup: smgSumaLookup.sumaAsegurada || '0',
        smgSumaAseguradaLookupOk: Boolean(smgSumaLookup.ok),
      };
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (evDir) {
      safeWriteFile(path.join(evDir, `${evPrefix}-soap_request.xml`), redactSmgEnvelope(envelope));
      safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
        soap_url: SOAP_URL,
        soap_method: SOAP_METHOD,
        soap_action: Aseg.soap_action || `http://tempuri.org/${SOAP_METHOD}`,
        request: requestMeta,
      });
    }

    try {
      const resp = await axios.post(SOAP_URL, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${Aseg.soap_action || `http://tempuri.org/${SOAP_METHOD}`}"`,
        },
        timeout: 25000,
        validateStatus: () => true,
      });

      const rawResp = resp.data;
      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-raw_response.xml`), String(rawResp || ''));
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (!(resp.status >= 200 && resp.status < 300)) {
        const out = { ok: false, error: `HTTP ${resp.status}`, coberturas: [], raw: rawResp };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      const parsed = parseSmgQuoteResponse(rawResp, SOAP_METHOD);
      parsed.used = {
        ...(parsed.used || {}),
        codAgente: requestMeta.cod_agente,
        codTipoPoliza: requestMeta.cod_tipo_poliza,
        codPostal: requestMeta.nCodPostal,
        codProvincia: requestMeta.nCodProvincia,
        codUsoVeh: requestMeta.nCodUsoVeh,
        sumaAsegurada: requestMeta.nSumaAsegurada,
        sumaAseguradaFuente: requestMeta.sumaAseguradaFuente,
        sumaAseguradaLookup: requestMeta.smgSumaAseguradaLookup,
        sumaAseguradaLookupOk: requestMeta.smgSumaAseguradaLookupOk,
        periodoFacturacion: requestMeta.nCodPeriodo,
        cantidadCuotas: requestMeta.nCantCuotas,
        passwordConfigurada: requestMeta.passwordConfigurada,
      };

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }
      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'nacion') {
    let tokenData = null;
    let envelope;
    let requestMeta;

    try {
      const built = buildNacionEnvelope({
        fila,
        cabecera,
        cfg: Aseg,
        mapeos,
        today: new Date(),
      });
      envelope = built.envelope;
      requestMeta = built.requestMeta;
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (evDir) {
      safeWriteFile(path.join(evDir, `${evPrefix}-soap_request.xml`), envelope);
      safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
        soap_url: SOAP_URL,
        soap_method: SOAP_METHOD,
        soap_action: Aseg.soap_action || SOAP_METHOD,
        auth_url: Aseg.auth_url || null,
        request: requestMeta,
        skeleton_only: Aseg?.parametros_extras?.skeleton_only === true,
      });
    }

    if (Aseg?.parametros_extras?.skeleton_only === true) {
      const out = {
        ok: false,
        error: 'Nacion esta en modo skeleton_only: falta confirmar credenciales, contrato del token y request/response final del cotizador',
        operacion: '0',
        coberturas: [],
        raw: '',
      };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    if (
      !String(Aseg.auth_url || '').trim() ||
      !String(Aseg.auth_user || '').trim() ||
      !String(Aseg.auth_password || '').trim() ||
      !String(Aseg.usuario_aplicacion || '').trim() ||
      !String(Aseg.cotizador_id || '').trim()
    ) {
      const out = {
        ok: false,
        error: 'Nacion requiere auth_url, auth_user, auth_password, usuario_aplicacion y cotizador_id configurados',
        operacion: '0',
        coberturas: [],
        raw: '',
      };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    try {
      tokenData = await fetchNacionToken(Aseg);
      const resp = await axios.post(SOAP_URL, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          SOAPAction: `"${Aseg.soap_action || SOAP_METHOD}"`,
          Authorization: `${tokenData.tokenType || 'Bearer'} ${tokenData.accessToken}`,
          User: Aseg.usuario_aplicacion,
        },
        timeout: 25000,
        validateStatus: () => true,
      });

      const rawResp = resp.data;
      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-raw_response.xml`), String(rawResp || ''));
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (!(resp.status >= 200 && resp.status < 300)) {
        const out = { ok: false, error: `HTTP ${resp.status}`, coberturas: [], raw: rawResp };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      const parsed = parseNacionQuoteResponse(rawResp);
      parsed.used = {
        ...(parsed.used || {}),
        tokenType: tokenData.tokenType || 'Bearer',
        usuarioAplicacion: Aseg.usuario_aplicacion,
        cotizadorId: Aseg.cotizador_id,
        codigoPostal: requestMeta.codigoPostal,
        codInfoauto: requestMeta.codInfoauto,
        usoVehiculo: requestMeta.usoVehiculo,
        formaPago: requestMeta.formaPago,
      };

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }
      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'rivadavia') {
    if (
      !String(Aseg.auth_url || '').trim() ||
      !String(Aseg.usuario || '').trim() ||
      !String(Aseg.password || '').trim() ||
      !String(Aseg.client_id || '').trim() ||
      !String(Aseg.client_secret || '').trim() ||
      !String(Aseg.producer_code || '').trim() ||
      !String(Aseg.producer_password || '').trim()
    ) {
      const out = { ok: false, error: 'Rivadavia requiere OAuth y credenciales de productor configuradas', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    let attemptPlan;
    try {
      attemptPlan = await buildRivadaviaAttemptPlan({
        fila,
        cabecera,
        cfg: Aseg,
        mapeos,
      });
    } catch (e) {
      const out = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    let lastOut = { ok: false, error: 'Rivadavia sin intentos de cotizacion', operacion: '0', coberturas: [], raw: '' };

    for (let attemptIndex = 0; attemptIndex < attemptPlan.attempts.length; attemptIndex++) {
      const attempt = attemptPlan.attempts[attemptIndex];
      const suffix = attemptIndex === 0 ? '' : `-attempt-${attemptIndex + 1}`;
      let payload;
      let requestMeta;

      try {
        const built = await buildRivadaviaPayload({
          fila,
          cabecera,
          cfg: Aseg,
          mapeos,
          today: new Date(),
          overrideTipoVehiculo: attempt.tipoVehiculo,
          overrideTipoUso: attempt.tipoUso,
          attemptSource: attempt.source,
        });
        payload = built.payload;
        requestMeta = built.requestMeta;
      } catch (e) {
        lastOut = { ok: false, error: e.message || String(e), operacion: '0', coberturas: [], raw: '' };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-error.json`), lastOut);
        continue;
      }

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-request.json`), payload);
        safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-config-usada.json`), {
          url: SOAP_URL,
          auth_url: Aseg.auth_url,
          request: requestMeta,
          attempt,
          learned: attemptPlan.learned || null,
        });
      }

      try {
        const { resp, tokenData } = await rivadaviaPost(Aseg, Aseg.soap_path || '/solicitud/api/emision/v1/solicitud/cotizacion', payload);
        const rawResp = resp.data;
        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-raw_response.json`), rawResp);
          safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
        }

        if (!(resp.status >= 200 && resp.status < 300)) {
          const message = typeof rawResp === 'object' && rawResp ? String(rawResp.message || rawResp.error || '') : '';
          lastOut = { ok: false, error: message ? `HTTP ${resp.status}: ${message}` : `HTTP ${resp.status}`, coberturas: [], raw: rawResp };
          if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-error.json`), lastOut);
          continue;
        }

        const parsed = await parseRivadaviaQuoteResponse(rawResp, Aseg, requestMeta);
        parsed.used = {
          ...(parsed.used || {}),
          producerCode: requestMeta.nroProductor,
          codigoInfoAuto: requestMeta.codigoInfoAuto,
          modeloAnio: requestMeta.modeloAnio,
          tokenType: tokenData.tokenType,
          attemptNumber: attemptIndex + 1,
        };

        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-parsed.json`), {
            ok: parsed.ok,
            operacion: parsed.operacion || '',
            coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
            used: parsed.used,
          });
          if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
            safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-coberturas.json`), parsed.coberturas);
          }
          if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-error.json`), parsed);
        }

        if (parsed.ok) {
          await upsertRivadaviaTipoVehiculoInferido({
            codigoInfoAuto: requestMeta.codigoInfoAuto,
            tipoVehiculo: requestMeta.tipoVehiculo,
            descripcionVehiculo: requestMeta.descripcionVehiculo,
            descripcionTipoVehiculo: requestMeta.descripcionTipoVehiculo,
            source: attempt.source === 'learned' ? 'learned_revalidated' : 'quote_success',
          });
          return parsed;
        }

        lastOut = parsed;
      } catch (e) {
        lastOut = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-exception.json`), {
            message: e?.message || String(e),
            stack: e?.stack || null,
          });
          safeWriteJson(path.join(evDir, `${evPrefix}${suffix}-error.json`), lastOut);
        }
      }
    }

    if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), lastOut);
    return lastOut;
  }

  if (slug === 'victoria') {
    try {
      const { payload, requestMeta } = await buildVictoriaPayload({
        fila,
        cabecera,
        cfg: Aseg,
        usoDicc,
        today: new Date(),
      });

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-payload.json`), payload);
        safeWriteJson(path.join(evDir, `${evPrefix}-request_meta.json`), {
          base_url: Aseg.base_url,
          api_path: Aseg.soap_path || '/cea/cotizaciones/cotizarCoberturasEmisor',
          auth_url: Aseg.auth_url || '',
          producer_code: Aseg.producer_code || '',
          request: requestMeta,
        });
      }

      const { resp, tokenData } = await victoriaPost(
        Aseg,
        Aseg.soap_path || '/cea/cotizaciones/cotizarCoberturasEmisor',
        payload
      );
      const rawResp = resp.data;

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-raw_response.json`), rawResp);
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), {
          status: resp.status,
          ok: resp.status >= 200 && resp.status < 300,
        });
      }

      if (!(resp.status >= 200 && resp.status < 300)) {
        const message =
          typeof rawResp === 'object' && rawResp
            ? String(rawResp.message || rawResp.error || rawResp.debugMessage || '')
            : '';
        const out = {
          ok: false,
          error: message ? `HTTP ${resp.status}: ${message}` : `HTTP ${resp.status}`,
          coberturas: [],
          raw: rawResp,
        };
        if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
        return out;
      }

      const parsed = parseVictoriaQuoteResponse(rawResp);
      parsed.used = {
        ...(parsed.used || {}),
        ...requestMeta,
        tokenType: tokenData?.tokenType || 'Bearer',
      };

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
          used: parsed.used,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }

      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  if (slug === 'provincia') {
    try {
      const { payload, requestMeta } = await buildProvinciaPayload({
        fila,
        cabecera,
        cfg: Aseg,
        usoDicc,
      });

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-payload.json`), payload);
        safeWriteJson(path.join(evDir, `${evPrefix}-request_meta.json`), {
          url: SOAP_URL,
          auth_url: Aseg.auth_url || '',
          api_key_configurada: Boolean(String(Aseg.api_key || '').trim()),
          request: requestMeta,
        });
      }

      const { resp, tokenData } = await provinciaPostQuote(Aseg, payload);
      const rawResp = resp.data;

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-raw_response.json`), rawResp);
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), {
          status: resp.status,
          ok: resp.status >= 200 && resp.status < 300,
        });
      }

      const parsed = parseProvinciaQuoteResponse(rawResp);
      parsed.http_status = resp.status;
      parsed.used = {
        ...(parsed.used || {}),
        ...requestMeta,
        tokenType: tokenData?.tokenType || 'Bearer',
      };

      if (!(resp.status >= 200 && resp.status < 300) && parsed.ok) {
        parsed.ok = false;
        parsed.error = `HTTP ${resp.status}`;
        parsed.coberturas = [];
        parsed.operacion = parsed.operacion || '0';
      }
      if (!parsed.ok && !parsed.error && !(resp.status >= 200 && resp.status < 300)) {
        parsed.error = `HTTP ${resp.status}`;
      }

      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), {
          ok: parsed.ok,
          operacion: parsed.operacion || '',
          coberturas_len: Array.isArray(parsed.coberturas) ? parsed.coberturas.length : 0,
          used: parsed.used,
        });
        if (Array.isArray(parsed.coberturas) && parsed.coberturas.length) {
          safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), parsed.coberturas);
        }
        if (!parsed.ok) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), parsed);
      }

      return parsed;
    } catch (e) {
      const out = { ok: false, error: e.message || 'axios error', coberturas: [], raw: '' };
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
        safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      }
      return out;
    }
  }

  const cerokm = resolveVehicleZeroKm(fila) === '1' ? 'S' : 'N';
  const tipo_uso = ['1', '2'].includes(String(cabecera?.tipo_uso || ''))
    ? String(cabecera.tipo_uso)
    : '1';
  const ajuste = (cabecera?.ajuste || '').toString().trim();
  const rastreoCodigo = resolveRastreoCodigo(cabecera, Aseg);
  const alarma = cabecera?.alarma === '1' ? '1' : '0';
  const gnc = cabecera?.gnc === '1' ? '1' : '0';
  const sumaGnc = resolveSumaGnc(cabecera, gnc);

  let bienXML = `
    <cod_infoauto>${codia}</cod_infoauto>
    <anofab>${anio}</anofab>
    <codpostal>${slug === 'atm' ? atmPostal.cp : cp}</codpostal>
    <seccion>${seccion}</seccion>
  `.trim();

  if (usoCodigo) bienXML += `\n    <uso>${usoCodigo}</uso>`;
  if (ajuste) bienXML += `\n    <ajuste>${ajuste}</ajuste>`;
  bienXML += `\n    <alarma>${alarma}</alarma>`;
  if (rastreoCodigo) bienXML += `\n    <rastreo>${rastreoCodigo}</rastreo>`;
  bienXML += `\n    <cerokm>${cerokm}</cerokm>`;
  bienXML += `\n    <gnc>${gnc}</gnc>`;
  if (sumaGnc) bienXML += `\n    <suma_gnc>${sumaGnc}</suma_gnc>`;
  if (seccion === '4' && tipo_uso) bienXML += `\n    <tipo_uso>${tipo_uso}</tipo_uso>`;

  // ===== Forma de pago (ATM) =====
  const formaPago = resolveFormaPagoCodigo(cabecera);

  let formapagoXML = '';
  if (formaPago === '1') {
    formapagoXML = `\n  <formapago>\n    <forma>1</forma>\n  </formapago>`;
  } else if (formaPago === '4') {
    const cbusCfg = getTestingCbus();
    const cbuKey = String(cabecera?.cbu_id ?? cabecera?.cbu_key ?? cabecera?.cbu ?? cbusCfg.default ?? '').trim();
    const cbuObj = cbusCfg.cbus?.[cbuKey];
    const cbuNumero = String(cabecera?.cbu_numero ?? cbuObj?.numero ?? '').trim();

    if (!cbuNumero) {
      const out = { ok: false, error: 'Forma de pago CBU (forma=4) requiere cbu_numero (o cbu_id con data/testing/cbus.json)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (!/^\d{22}$/.test(cbuNumero)) {
      const out = { ok: false, error: 'CBU inválido (debe ser numérico de 22 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    formapagoXML =
      `\n  <formapago>` +
      `\n    <forma>4</forma>` +
      `\n    <cbu>\n      <numero>${cbuNumero}</numero>\n    </cbu>` +
      `\n  </formapago>`;
  } else {
    const tarjetasCfg = getTestingTarjetas();
    const tarjetaKey = String(cabecera?.tarjeta_id ?? cabecera?.tarjeta_key ?? cabecera?.tarjeta ?? tarjetasCfg.default ?? '').trim();
    const tObj = tarjetasCfg.tarjetas?.[tarjetaKey];

    const tNombre = String(cabecera?.tarjeta_nombre ?? tObj?.codigo_atm ?? '').trim();
    const tNumero = String(cabecera?.tarjeta_numero ?? tObj?.numero ?? '').trim();
    const tVcto = String(cabecera?.tarjeta_vcto ?? tObj?.vencimiento ?? '').trim(); // MMAAAA

    if (!tNombre || !tNumero || !tVcto) {
      const out = { ok: false, error: 'Forma de pago TARJETA (forma=2) requiere tarjeta_nombre(código ws_au_tarjeta), tarjeta_numero y tarjeta_vcto (MMAAAA) en cabecera o en data/testing/tarjetas_credito.json', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (!/^\d{13,19}$/.test(tNumero)) {
      const out = { ok: false, error: 'Número de tarjeta inválido (debe ser numérico 13-19 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }
    if (!/^\d{6}$/.test(tVcto)) {
      const out = { ok: false, error: 'Vencimiento de tarjeta inválido (formato MMAAAA, 6 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
      return out;
    }

    formapagoXML =
      `\n  <formapago>` +
      `\n    <forma>2</forma>` +
      `\n    <tarjeta>` +
      `\n      <nombre>${tNombre}</nombre>` +
      `\n      <numero>${tNumero}</numero>` +
      `\n      <vcto>${tVcto}</vcto>` +
      `\n    </tarjeta>` +
      `\n  </formapago>`;
  }

  const docIn = `
<auto>
  <usuario>
    <usa>${Aseg.usuario}</usa>
    <pass>${Aseg.password}</pass>
    <fecha>${hoy_fmt}</fecha>
    <vendedor>${Aseg.vendedor || ''}</vendedor>
    <origen>${Aseg.origen || 'WS'}</origen>
    ${Aseg.plan ? `<plan>${Aseg.plan}</plan>` : ''}
    ${Aseg.contacto_tecnico ? `<contacto_tecnico>${Aseg.contacto_tecnico}</contacto_tecnico>` : ''}
    ${Aseg.contacto_comercial ? `<contacto_comercial>${Aseg.contacto_comercial}</contacto_comercial>` : ''}
  </usuario>
  <asegurado>
    <persona>${cabecera.tipopersona || 'F'}</persona>
    <iva>${cabecera.iva || 'CF'}</iva>
  </asegurado>
  <bien>
    ${bienXML}
  </bien>${formapagoXML}
</auto>`.trim();

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <${SOAP_METHOD} xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${SOAP_METHOD}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

  if (evDir) {
    safeWriteFile(path.join(evDir, `${evPrefix}-doc_in.xml`), docIn);
    safeWriteFile(path.join(evDir, `${evPrefix}-soap_request.xml`), envelope);
    safeWriteJson(path.join(evDir, `${evPrefix}-config-usada.json`), {
      soap_url: SOAP_URL,
      soap_method: SOAP_METHOD,
      vendedor: Aseg?.vendedor ?? null,
      origen: Aseg?.origen ?? null,
      plan: Aseg?.plan ?? null,
      fecha_fmt: hoy_fmt,
    });
  }

  const actions = [`http://tempuri.org/${SOAP_METHOD}`, `${SOAP_METHOD}`, `urn:${SOAP_METHOD}`];
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  let lastErr = null;
  let rawResp = null;

  for (const sa of actions) {
    try {
      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-soapaction.txt`), sa);
      }

      const resp = await axios.post(SOAP_URL, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: sa },
        timeout: 20000,
        validateStatus: () => true,
      });
      rawResp = resp.data;

      if (evDir) {
        safeWriteFile(path.join(evDir, `${evPrefix}-raw_response.xml`), String(rawResp || ''));
        safeWriteJson(path.join(evDir, `${evPrefix}-http.json`), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (resp.status >= 200 && resp.status < 300) {
        const parsed = parser.parse(String(rawResp || ''));
        const body =
          parsed?.['SOAP-ENV:Envelope']?.['SOAP-ENV:Body'] || parsed?.Envelope?.Body;
        const result =
          body?.['ns1:' + SOAP_METHOD + 'Response']?.['ns1:' + SOAP_METHOD + 'Result'] ||
          body?.[SOAP_METHOD + 'Response']?.[SOAP_METHOD + 'Result'] ||
          body?.[`${SOAP_METHOD}Response`]?.[`${SOAP_METHOD}Result`];

        let payload = result;
        if (typeof payload === 'string') {
          try {
            payload = parser.parse(payload);
          } catch {}
        }

        const auto = payload?.auto || payload?.doc_out?.auto || payload?.AUTO || null;
        const operacion = auto?.operacion || auto?.Operacion || null;
        const coberturas = Array.isArray(auto?.cotizacion?.cobertura)
          ? auto.cotizacion.cobertura
          : auto?.cotizacion?.Cobertura
          ? [].concat(auto.cotizacion.Cobertura)
          : [];

        const rawStr = String(rawResp || '');
        const opRx = rawStr.match(/<operacion>\s*([^<]+)\s*<\/operacion>/i);
        const ssRx = rawStr.match(/<statusSuccess>\s*([^<]+)\s*<\/statusSuccess>/i);
        const msgRx = rawStr.match(/<msg>\s*([^<]+)\s*<\/msg>/i);

        const operacionFinal = (operacion ?? (opRx ? opRx[1].trim() : null));
        const statusSuccess =
          (auto?.statusSuccess ?? auto?.StatusSuccess ?? (ssRx ? ssRx[1].trim() : '')).toString().toUpperCase();
        const msg = (msgRx ? msgRx[1].trim() : '');

        const success = statusSuccess === 'TRUE';
        const sumaAsegurada = auto?.datos_cotiz?.suma ?? auto?.datos_cotiz?.Suma ?? auto?.Datos_Cotiz?.suma ?? null;

        const parsedOut = {
          ok: success,
          operacion: operacionFinal,
          statusSuccess,
          msg,
          suma_asegurada: sumaAsegurada,
          coberturas_len: Array.isArray(coberturas) ? coberturas.length : 0,
          used: { soapAction: sa }
        };

        if (evDir) {
          safeWriteJson(path.join(evDir, `${evPrefix}-parsed.json`), parsedOut);
          if (Array.isArray(coberturas) && coberturas.length) {
            safeWriteJson(path.join(evDir, `${evPrefix}-coberturas.json`), coberturas);
          }
        }

        if (!success) {
          const out = {
            ok: false,
            operacion: operacionFinal,
            coberturas: [],
            error: msg || 'statusSuccess=FALSE',
            used: { soapAction: sa },
            raw: rawResp,
          };
          if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
          return out;
        }

        return {
          ok: true,
          operacion: operacionFinal,
          suma_asegurada: sumaAsegurada,
          coberturas,
          used: {
            soapAction: sa,
            formaPagoSolicitada: formaPago,
            formaPagoDescripcion: describeAtmFormaPago(formaPago),
            cpOriginal: cp,
            cpEnviado: slug === 'atm' ? atmPostal?.cp || cp : cp,
            cpFallbackSource: slug === 'atm' ? atmPostal?.source || 'exacto' : null,
          },
          raw: rawResp,
        };
      }

      lastErr = `HTTP ${resp.status}`;
    } catch (e) {
      lastErr = e.message || 'axios error';
      if (evDir) {
        safeWriteJson(path.join(evDir, `${evPrefix}-exception.json`), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
      }
    }
  }

  const out = { ok: false, error: lastErr, raw: rawResp };
  if (evDir) safeWriteJson(path.join(evDir, `${evPrefix}-error.json`), out);
  return out;
}

async function ejecutarProceso({
  ctx,
  proceso_id,
  meta,
  historial_id,
  cabecera_id,
  cabecera,
  relPath,
  absPath,
  aseguradoras,
  limite,
  resumeOnlyPending = false,
}) {
  ensureDir(procesoDir(proceso_id));
  ensureDir(path.join(procesoDir(proceso_id), 'evidencias'));

  const normalizedAseguradoras = normalizeProcesoAseguradoras(aseguradoras);
  aseguradoras = normalizedAseguradoras.aseguradoras;
  const aseguradorasIgnoradas = normalizedAseguradoras.ignoradas;

  if (aseguradorasIgnoradas.length > 0) {
    await saveMetadata(proceso_id, {
      aseguradoras,
      aseguradoras_ignoradas: aseguradorasIgnoradas,
    });
  }

  if (aseguradoras.length === 0) {
    const error = 'No hay aseguradoras ejecutables para correr el proceso.';
    await saveMetadata(proceso_id, {
      estado: 'con errores',
      fecha_fin: new Date().toISOString(),
      aseguradoras: [],
      aseguradoras_ignoradas: aseguradorasIgnoradas,
      registros_total: 0,
      registros_filas: 0,
      registros_procesados: 0,
      cotizaciones_exitosas: 0,
      cotizaciones_con_error: 0,
      cotizaciones_skipped: 0,
      cotizaciones_pendientes: 0,
      aseguradoras_pendientes: [],
    });
    await updateProcesoDbState(proceso_id, 'con errores', { total: 0, ok: 0, err: 0 });
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error,
        aseguradoras_ignoradas: aseguradorasIgnoradas,
      },
    };
  }

  const filas = await readFilasFromFile(absPath);
  const procesoOrigen = classifyProcessOrigin({ ...(meta || {}), archivo: relPath });
  const zeroKmProceso = pickZeroKmValue(meta?.cabecera_override || {});
  if (!Array.isArray(filas) || filas.length === 0) {
    const resumenVacio = {
      id: proceso_id,
      historial_id,
      archivo: relPath.replace(/\\/g, '/'),
      fecha: new Date().toISOString(),
      limite: 0,
      cabecera_id,
      aseguradoras,
      resultados: Object.fromEntries(aseguradoras.map((s) => [s, []])),
      error: 'El archivo combinado no tiene filas parseables (0).',
    };

    writeResumenArtifacts(proceso_id, resumenVacio);

    await saveMetadata(proceso_id, {
      estado: 'con errores',
      fecha_fin: new Date().toISOString(),
      registros_total: 0,
      registros_procesados: 0,
      cotizaciones_exitosas: 0,
      cotizaciones_con_error: 0,
      cotizaciones_skipped: 0,
      cotizaciones_pendientes: 0,
      aseguradoras_pendientes: [],
    });

    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: 'El archivo combinado no tiene filas parseables (0). Revisá que el XLSX tenga datos.',
        archivo: absPath,
      },
    };
  }

  const tomar = Math.min(limite || filas.length, filas.length);
  const totalTasks = tomar * aseguradoras.length;
  const resumenAnterior = resumeOnlyPending ? (await loadResumen(proceso_id)) : null;
  const resultadosPorAseg = resumeOnlyPending
    ? { ...(resumenAnterior?.resultados || {}) }
    : {};

  for (const slug of aseguradoras) {
    const existing = Array.isArray(resultadosPorAseg[slug]) ? resultadosPorAseg[slug] : [];
    const next = new Array(tomar);
    for (let i = 0; i < tomar; i++) next[i] = existing[i];
    resultadosPorAseg[slug] = next;
  }

  safeWriteJson(path.join(procesoDir(proceso_id), 'run.json'), {
    proceso_id,
    historial_id,
    cabecera_id,
    archivo: relPath.replace(/\\/g, '/'),
    absPath,
    limite: tomar,
    filas_intentadas: tomar,
    tareas_totales: totalTasks,
    aseguradoras,
    resume_only_pending: resumeOnlyPending,
    started_at: new Date().toISOString(),
  });

  await saveMetadata(proceso_id, {
    registros_total: totalTasks,
    registros_filas: tomar,
    registros_procesados: summarizeResultados(resultadosPorAseg, aseguradoras).total,
  });

  writeResumenArtifacts(proceso_id, buildProcesoResumenSnapshot({
    proceso_id,
    historial_id,
    relPath,
    tomar,
    cabecera_id,
    aseguradoras,
    resultadosPorAseg,
  }));

  const buildFilaPreview = (filaBase = {}, filaPreparada = {}) => ({
    infoautocod: filaPreparada.infoautocod ?? filaPreparada.codigo_infoauto ?? filaBase.infoautocod ?? filaBase.codigo_infoauto ?? filaBase.tau_codia ?? '',
    anio: filaPreparada.anio || filaPreparada.anofab || filaBase.anio || filaBase.anofab || '',
    cp: filaPreparada.cp || filaPreparada.codigo_postal || filaPreparada.CP || filaBase.codigo_postal || filaBase.CP || filaBase.cp || '',
    uso_origen: filaBase.uso || filaBase.Uso || '',
  });

  const finalizeTaskResult = async (slug, task, resp) => {
    const normalized = annotateResultStatus({
      aseguradora: slug,
      index: task.index,
      fila_preview: task.filaPreview,
      mapeos: task.mapeos,
      finished_at: new Date().toISOString(),
      ...resp,
    });
    resultadosPorAseg[slug][task.index] = normalized;

    writeResumenArtifacts(proceso_id, buildProcesoResumenSnapshot({
      proceso_id,
      historial_id,
      relPath,
      tomar,
      cabecera_id,
      aseguradoras,
      resultadosPorAseg,
    }));

    safeWriteJson(path.join(evidenciasDir(proceso_id, slug, task.index), `${slug}-result.json`), {
      aseguradora: slug,
      ok: normalized.ok,
      pending: normalized.pending === true,
      operacion: normalized.operacion ?? null,
      coberturas_len: Array.isArray(normalized.coberturas) ? normalized.coberturas.length : 0,
      error: normalized.error || null,
      used: normalized.used || null,
    });

    const counts = summarizeResultados(resultadosPorAseg, aseguradoras);
    await saveMetadata(proceso_id, {
      registros_procesados: counts.total,
      cotizaciones_exitosas: counts.ok,
      cotizaciones_con_error: counts.err,
      cotizaciones_skipped: counts.skipped,
      cotizaciones_pendientes: counts.pending,
      aseguradoras_pendientes: Object.keys(counts.pendingByCompany),
    });
  };

  const processCompany = async (slug) => {
    const pendingIndexes = resumeOnlyPending ? collectPendingIndexes(resultadosPorAseg, slug, tomar) : null;
    if (resumeOnlyPending && pendingIndexes.length === 0) return;

    const { cfg: Aseg, SOAP_URL, SOAP_METHOD, fechaFmt } = await loadAsegConfig(slug);
    const hoy = formatFecha(new Date(), fechaFmt);
    const procesarFila = await initPreprocesador({ slug, cabecera_id });
    const usoDicc = await readUsoDicc(slug);
    const queueCfgRaw = getCompanyQueueConfig(slug, Aseg);
    const queueCfg = { ...queueCfgRaw, maxConcurrency: 1 };
    const tasks = [];
    const retryQueue = [];

    const indexes = resumeOnlyPending ? pendingIndexes : Array.from({ length: tomar }, (_v, i) => i);
    for (const i of indexes) {
      const fila = filas[i] || {};
      const { fila_preparada, mapeos } = await procesarFila(fila);
      let fila_final = { ...fila, ...fila_preparada };
      fila_final = procesoOrigen === 'seguros911'
        ? applyZeroKmToVehicle(fila_final, zeroKmProceso)
        : applyZeroKmToVehicle(fila_final, resolveVehicleZeroKm(fila_final));
      if ((fila_final.CP === '' || fila_final.CP == null) && (fila.CP != null && String(fila.CP).trim() !== '')) {
        fila_final.CP = fila.CP;
      }
      tasks.push({
        slug,
        index: i,
        attempt: 0,
        fila: fila_final,
        mapeos,
        filaPreview: buildFilaPreview(fila, fila_preparada),
        ctx: { Aseg, SOAP_URL, SOAP_METHOD, usoDicc, hoy_fmt: hoy },
      });
    }

    const worker = async (task) => {
      let resp;
      try {
        resp = await cotizarFila({
          proceso_id,
          slug,
          index: task.index,
          fila: task.fila,
          cabecera,
          hoy_fmt: task.ctx.hoy_fmt,
          mapeos: task.mapeos,
          Aseg: task.ctx.Aseg,
          SOAP_URL: task.ctx.SOAP_URL,
          SOAP_METHOD: task.ctx.SOAP_METHOD,
          usoDicc: task.ctx.usoDicc,
        });
      } catch (err) {
        resp = buildTechnicalFailureResult(err);
      }

      const normalizedResp = annotateResultStatus(resp);
      const shouldDeferredRetry = (
        (!normalizedResp.ok && normalizedResp.retryable === true) ||
        (slug === 'mapfre' && !normalizedResp.ok && isRetryableMapfreError(normalizedResp))
      ) && task.attempt < queueCfg.maxDeferredRetries;

      if (shouldDeferredRetry) {
        retryQueue.push({ ...task, attempt: task.attempt + 1 });
        safeWriteJson(path.join(evidenciasDir(proceso_id, slug, task.index), `${slug}-retry.json`), {
          scheduled: true,
          attempt: task.attempt + 1,
          reason: normalizedResp.error || 'retryable error',
        });
        return;
      }

      if (task.attempt > 0) {
        normalizedResp.used = {
          ...(normalizedResp.used || {}),
          deferredRetryAttempt: task.attempt,
        };
      }
      await finalizeTaskResult(slug, task, normalizedResp);
    };

    await runThrottledTasks(tasks, worker, queueCfg);
    if (retryQueue.length > 0) {
      await sleep(queueCfg.retryDelayMs);
      await runThrottledTasks(retryQueue, worker, queueCfg);
    }
  };

  const companyRuns = await Promise.allSettled(aseguradoras.map((slug) => processCompany(slug)));
  for (let idx = 0; idx < companyRuns.length; idx += 1) {
    const outcome = companyRuns[idx];
    if (outcome.status === 'fulfilled') continue;

    const slug = aseguradoras[idx];
    const failure = outcome.reason instanceof Error
      ? outcome.reason
      : new Error(String(outcome.reason || `Falló la inicialización de ${slug}`));

    console.error(`[proceso ${proceso_id}] fallo en ${slug}:`, failure);
    const arr = Array.isArray(resultadosPorAseg?.[slug]) ? resultadosPorAseg[slug] : [];
    for (let i = 0; i < tomar; i += 1) {
      if (arr[i]) continue;
      await finalizeTaskResult(slug, {
        index: i,
        filaPreview: buildFilaPreview(filas[i] || {}, {}),
        mapeos: {},
      }, buildTechnicalFailureResult(new Error(`Fallo ${slug}: ${failure.message || failure}`)));
    }
  }

  const resumen = buildProcesoResumenSnapshot({
    proceso_id,
    historial_id,
    relPath,
    tomar,
    cabecera_id,
    aseguradoras,
    resultadosPorAseg,
  });

  writeResumenArtifacts(proceso_id, resumen);

  const counts = summarizeResultados(resultadosPorAseg, aseguradoras);
  const estadoFinalMeta = counts.pending > 0 ? 'incompleto' : (counts.err > 0 ? 'con errores' : 'completado');

  await saveMetadata(proceso_id, {
    estado: estadoFinalMeta,
    fecha_fin: new Date().toISOString(),
    registros_total: totalTasks,
    registros_filas: tomar,
    registros_procesados: counts.total,
    cotizaciones_exitosas: counts.ok,
    cotizaciones_con_error: counts.err,
    cotizaciones_skipped: counts.skipped,
    cotizaciones_pendientes: counts.pending,
    aseguradoras_pendientes: Object.keys(counts.pendingByCompany),
    ultima_reanudacion: resumeOnlyPending ? new Date().toISOString() : (meta.ultima_reanudacion || null),
    reanudaciones: resumeOnlyPending ? Number(meta.reanudaciones || 0) + 1 : Number(meta.reanudaciones || 0),
  });

  await updateProcesoDbState(proceso_id, estadoFinalMeta, counts);

  safeWriteJson(path.join(procesoDir(proceso_id), 'run_end.json'), {
    proceso_id,
    finished_at: new Date().toISOString(),
    estado: estadoFinalMeta,
    total_filas_intentadas: tomar,
    total_tareas_intentadas: totalTasks,
    cotizaciones_exitosas: counts.ok,
    cotizaciones_con_error: counts.err,
    cotizaciones_skipped: counts.skipped,
    cotizaciones_pendientes: counts.pending,
    aseguradoras_pendientes: Object.keys(counts.pendingByCompany),
    resume_only_pending: resumeOnlyPending,
  });

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      proceso_id,
      historial_id,
      cabecera_id,
      aseguradoras,
      total_filas_intentadas: tomar,
      total_tareas_intentadas: totalTasks,
      total_tareas_pendientes: counts.pending,
      cotizaciones_exitosas: counts.ok,
      cotizaciones_con_error: counts.err,
      cotizaciones_skipped: counts.skipped,
      estado: estadoFinalMeta,
      aseguradoras_pendientes: Object.keys(counts.pendingByCompany),
      carpeta: `data/procesos/proceso-${proceso_id}/`,
      resumen,
    },
  };
}

// =============================================================================
// NUEVO: POST /proceso/crear
// =============================================================================
router.post('/crear', express.json(), async (req, res) => {
  try {
    const ctx = getRequestContext(req);
    const historial_id = Number(req.body?.historial_id);
    const cabecera_id = Number(req.body?.cabecera_id);
    const nombre = (req.body?.nombre || '').toString().trim();
    const cabeceraOverride = sanitizeCabeceraOverride(req.body?.cabecera_override);

    if (!historial_id) return res.status(400).json({ ok: false, error: 'Falta historial_id' });
    if (!cabecera_id) return res.status(400).json({ ok: false, error: 'Falta cabecera_id' });

    const cabecera = getCabecera(cabecera_id);
    if (!cabecera) return res.status(404).json({ ok: false, error: `Cabecera ${cabecera_id} no encontrada` });
    if (!isOwnedByContext(cabecera, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a esa cabecera' });
    }

    const hist = await getHistorialItem(historial_id);
    if (!hist) return res.status(404).json({ ok: false, error: `Historial ${historial_id} no encontrado` });
    const histOwner = getHistorialOwner(historial_id) || { organization_id: 'autoiq' };
    if (!isOwnedByContext(histOwner, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a ese archivo histórico' });
    }

    const { relPath, absPath } = resolveCombinedAbsPath(hist);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: `No existe el archivo combinado: ${absPath}` });
    }

    let aseguradoras = req.body?.aseguradoras;
    if (typeof aseguradoras === 'string') aseguradoras = [aseguradoras];
    if (!Array.isArray(aseguradoras) || aseguradoras.length === 0) aseguradoras = ['atm'];
    const aseguradorasNormalizadas = normalizeProcesoAseguradoras(aseguradoras);
    aseguradoras = aseguradorasNormalizadas.aseguradoras;
    if (aseguradoras.length === 0) {
      return res.status(400).json({
        ok: false,
        error: `No hay aseguradoras ejecutables en la selección (${aseguradorasNormalizadas.ignoradas.join(', ') || 'ninguna'})`,
      });
    }

    const limiteBody = Number(req.body?.limite);
    const limite = Number.isFinite(limiteBody) && limiteBody > 0
      ? Math.max(1, Math.min(limiteBody, 100))
      : null;
    const nombreCabecera = cabecera?.nombre || cabecera?.nombre_cabecera || cabecera?.nombre_publico || `Cabecera ${cabecera_id}`;
    const nombreProceso = nombre || `Proceso ${historial_id}`;
    let proceso_id = null;

    try {
      const [ins] = await db.execute(
        'INSERT INTO procesos_cotizacion (nombre, nombre_cabecera, estado) VALUES (?, ?, ?)',
        [nombreProceso, nombreCabecera, 'en curso']
      );
      proceso_id = ins.insertId;
    } catch (_primaryErr) {
      try {
        const [ins] = await db.execute(
          'INSERT INTO procesos_cotizacion (nombre, estado) VALUES (?, ?)',
          [nombreProceso, 'en curso']
        );
        proceso_id = ins.insertId;
      } catch (dbErr) {
        return res.status(500).json({ ok: false, error: `No se pudo crear el proceso: ${dbErr.message || dbErr}` });
      }
    }

    ensureDir(procesosRoot());
    ensureDir(procesoDir(proceso_id));

      const meta = {
      id: proceso_id,
      nombre: nombreProceso,
      estado: 'creado',
      historial_id,
      archivo: relPath,
      cabecera_id,
      aseguradoras,
      limite,
      fecha_creacion: new Date().toISOString(),
      fecha_inicio: null,
      fecha_fin: null,
        registros_total: Number(hist.cantidad_registros || 0) || null,
        registros_procesados: 0,
        cotizaciones_exitosas: 0,
        cotizaciones_con_error: 0,
        aseguradoras_ignoradas: aseguradorasNormalizadas.ignoradas,
        cabecera_override: cabeceraOverride,
        organization_id: ctx.currentOrganization?.id || 'autoiq',
        created_by_user_id: ctx.currentUser?.id || 'superadmin-local',
        created_by_name: getUserDisplayName(ctx.currentUser),
      };

      await writeJson(metadataPath(proceso_id), meta);
      appendActivity({
        event: 'proceso_created',
        entity_type: 'proceso',
        entity_id: String(proceso_id),
        details: {
          historial_id,
          cabecera_id,
        },
      });

    return res.status(200).json({ ok: true, proceso_id, metadata: meta });
  } catch (err) {
    console.error('Error en /proceso/crear', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// POST /proceso/ejecutar/:id
// =============================================================================
router.post('/ejecutar/:id', express.json(), async (req, res) => {
  try {
    const ctx = getRequestContext(req);
    const id = Number(req.params.id);
    const cabeceraOverrideBody = sanitizeCabeceraOverride(req.body?.cabecera_override);

    let meta = await loadMetadata(id);

    if (!meta) {
      // Si no existe metadata, interpretamos :id como HISTORIAL id y creamos un NUEVO proceso (DB + carpeta).
      const historial_id = id;

      const cabeceraIdCompat = Number(req.body?.cabecera_id);
      if (!cabeceraIdCompat) return res.status(400).json({ ok: false, error: 'Falta cabecera_id' });

      const cabeceraCompat = getCabecera(cabeceraIdCompat);
      if (!cabeceraCompat) return res.status(404).json({ ok: false, error: `Cabecera ${cabeceraIdCompat} no encontrada` });
      if (!isOwnedByContext(cabeceraCompat, ctx)) {
        return res.status(403).json({ ok: false, error: 'No tenés acceso a esa cabecera' });
      }

      const hist = await getHistorialItem(historial_id);
      if (!hist) return res.status(404).json({ ok: false, error: `No existe el histórico ${historial_id}` });
      const histOwner = getHistorialOwner(historial_id) || { organization_id: 'autoiq' };
      if (!isOwnedByContext(histOwner, ctx)) {
        return res.status(403).json({ ok: false, error: 'No tenés acceso a ese archivo histórico' });
      }

      const archivo = hist?.archivo;
      if (!archivo) return res.status(400).json({ ok: false, error: `Histórico ${historial_id} sin archivo asociado` });

      // Crear registro en DB para que aparezca en "Procesos en curso"
      let proceso_id = null;
      try {
        const nombreProceso = `ATM - UI (histórico ${historial_id})`;
        const nombreCabecera = cabeceraCompat?.nombre || cabeceraCompat?.nombre_cabecera || cabeceraCompat?.nombre_publico || `Cabecera ${cabeceraIdCompat}`;

        const [ins] = await db.execute(
          'INSERT INTO procesos_cotizacion (nombre, nombre_cabecera, estado, fecha_inicio) VALUES (?, ?, ?, NOW())',
          [nombreProceso, nombreCabecera, 'en curso']
        );
        proceso_id = ins.insertId;

        // Guardar nombre de cabecera si existe la columna (defensivo)
        try {
          await db.execute('UPDATE procesos_cotizacion SET nombre_cabecera = ? WHERE id = ?', [nombreCabecera, proceso_id]);
        } catch (_e) {
          // columna puede no existir; ignorar
        }
      } catch (e) {
        console.error('Error creando proceso en DB', e);
        return res.status(500).json({ ok: false, error: 'No se pudo crear el proceso en DB' });
      }

      const procesoFolder = path.join(process.cwd(), 'data', 'procesos', `proceso-${proceso_id}`);
      ensureDir(procesoFolder);
      const metaPath = path.join(procesoFolder, 'metadata.json');

      meta = {
        id: proceso_id,
        historial_id,
        archivo,
        fecha: new Date().toISOString(),
        limite: Number.isFinite(Number(req.body?.limite)) && Number(req.body?.limite) > 0
          ? Math.max(1, Math.min(Number(req.body?.limite), 100))
          : null,
        cabecera_id: cabeceraIdCompat,
        aseguradoras: req.body?.aseguradoras || req.body?.aseguradora || [],
        resultados: {},
        cabecera_override: cabeceraOverrideBody,
        organization_id: ctx.currentOrganization?.id || 'autoiq',
        created_by_user_id: ctx.currentUser?.id || 'superadmin-local',
        created_by_name: getUserDisplayName(ctx.currentUser),
      };

      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }

    const proceso_id = meta.id;
    const historial_id = Number(meta.historial_id);
    const cabecera_id = Number(meta.cabecera_id);

    const cabecera = getCabecera(cabecera_id);
    if (!cabecera) return res.status(404).json({ ok: false, error: `Cabecera ${cabecera_id} no encontrada` });
    if (!isOwnedByContext(cabecera, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a esa cabecera' });
    }
    const cabeceraOverride = cabeceraOverrideBody || sanitizeCabeceraOverride(meta.cabecera_override);
    const cabeceraEfectiva = mergeCabecera(cabecera, cabeceraOverride);

    const hist = await getHistorialItem(historial_id);
    if (!hist) return res.status(404).json({ ok: false, error: `Historial ${historial_id} no encontrado` });
    const histOwner = getHistorialOwner(historial_id) || { organization_id: 'autoiq' };
    if (!isOwnedByContext(histOwner, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a ese archivo histórico' });
    }

    const { relPath, absPath } = resolveCombinedAbsPath(hist);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: `No existe el archivo combinado: ${absPath}` });
    }

    let aseguradoras = req.body?.aseguradoras;
    if (typeof aseguradoras === 'string') aseguradoras = [aseguradoras];
    if (!Array.isArray(aseguradoras) || aseguradoras.length === 0) aseguradoras = meta.aseguradoras || ['atm'];
    const normalizedAseguradoras = normalizeProcesoAseguradoras(aseguradoras);
    aseguradoras = normalizedAseguradoras.aseguradoras;
    const requestedAseguradoras = [...aseguradoras, ...normalizedAseguradoras.ignoradas];
    if (!ctx.isSuperadmin) {
      const allowed = new Set(Array.isArray(ctx.allowedCompanySlugs) ? ctx.allowedCompanySlugs : []);
      aseguradoras = aseguradoras.filter((slug) => allowed.has(slug));
    }
    if (aseguradoras.length === 0) {
      return res.status(403).json({
        ok: false,
        error: `La organización actual no tiene aseguradoras habilitadas para ejecutar (${requestedAseguradoras.join(', ') || 'ninguna'})`,
      });
    }

    await saveMetadata(proceso_id, {
      estado: 'en curso',
      fecha_inicio: new Date().toISOString(),
      archivo: relPath,
      limite: null,
      aseguradoras,
      aseguradoras_ignoradas: normalizedAseguradoras.ignoradas,
      cabecera_override: cabeceraOverride,
      registros_procesados: 0,
      cotizaciones_exitosas: 0,
      cotizaciones_con_error: 0,
      organization_id: meta.organization_id || ctx.currentOrganization?.id || 'autoiq',
      created_by_user_id: meta.created_by_user_id || ctx.currentUser?.id || 'superadmin-local',
      created_by_name: meta.created_by_name || getUserDisplayName(ctx.currentUser),
    });
    appendActivity({
      event: 'proceso_started',
      entity_type: 'proceso',
      entity_id: String(proceso_id),
      details: {
        historial_id,
        cabecera_id,
        aseguradoras,
      },
    });
    const limiteBody = Number(req.body?.limite);
    const limite = Number.isFinite(limiteBody) && limiteBody > 0
      ? Math.max(1, Math.min(limiteBody, 100))
      : (Number.isFinite(Number(meta.limite)) && Number(meta.limite) > 0
          ? Math.max(1, Math.min(Number(meta.limite), 100))
          : null);

    await saveMetadata(proceso_id, { limite: limite || null });
    const outcome = await ejecutarProceso({
      ctx,
      proceso_id,
      meta: { ...meta, cabecera_override: cabeceraOverride },
      historial_id,
      cabecera_id,
      cabecera: cabeceraEfectiva,
      relPath,
      absPath,
      aseguradoras,
      limite,
      resumeOnlyPending: false,
    });

    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error('Error en /proceso/ejecutar/:id', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

router.post('/reanudar/:id', express.json(), async (req, res) => {
  try {
    const ctx = getRequestContext(req);
    const proceso_id = Number(req.params.id);
    const meta = await loadMetadata(proceso_id);
    if (!meta) return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    if (!isOwnedByContext(meta, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a este proceso' });
    }

    const resumen = await loadResumen(proceso_id);
    if (!resumen) {
      return res.status(400).json({ ok: false, error: 'El proceso no tiene resumen para reanudar' });
    }

    const cabecera_id = Number(meta.cabecera_id);
    const historial_id = Number(meta.historial_id);
    const cabecera = getCabecera(cabecera_id);
    if (!cabecera) return res.status(404).json({ ok: false, error: `Cabecera ${cabecera_id} no encontrada` });
    if (!isOwnedByContext(cabecera, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a esa cabecera' });
    }
    const cabeceraEfectiva = mergeCabecera(cabecera, meta.cabecera_override);

    const hist = await getHistorialItem(historial_id);
    if (!hist) return res.status(404).json({ ok: false, error: `Historial ${historial_id} no encontrado` });
    const histOwner = getHistorialOwner(historial_id) || { organization_id: 'autoiq' };
    if (!isOwnedByContext(histOwner, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a ese archivo histórico' });
    }

    const { relPath, absPath } = resolveCombinedAbsPath(hist);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: `No existe el archivo combinado: ${absPath}` });
    }

    let aseguradoras = req.body?.aseguradoras;
    if (typeof aseguradoras === 'string') aseguradoras = [aseguradoras];
    if (!Array.isArray(aseguradoras) || aseguradoras.length === 0) {
      aseguradoras = Array.isArray(meta.aseguradoras_pendientes) && meta.aseguradoras_pendientes.length
        ? meta.aseguradoras_pendientes
        : (meta.aseguradoras || []);
    }
    const normalizedAseguradoras = normalizeProcesoAseguradoras(aseguradoras);
    aseguradoras = normalizedAseguradoras.aseguradoras;
    if (!ctx.isSuperadmin) {
      const allowed = new Set(Array.isArray(ctx.allowedCompanySlugs) ? ctx.allowedCompanySlugs : []);
      aseguradoras = aseguradoras.filter((slug) => allowed.has(slug));
    }
    if (aseguradoras.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay aseguradoras pendientes para reanudar' });
    }

    const limite = Number.isFinite(Number(meta.limite)) && Number(meta.limite) > 0
      ? Math.max(1, Math.min(Number(meta.limite), 100))
      : null;

    await saveMetadata(proceso_id, {
      estado: 'en curso',
      fecha_inicio: meta.fecha_inicio || new Date().toISOString(),
      fecha_reanudacion_inicio: new Date().toISOString(),
      aseguradoras_ignoradas: normalizedAseguradoras.ignoradas,
    });
    appendActivity({
      event: 'proceso_resumed',
      entity_type: 'proceso',
      entity_id: String(proceso_id),
      details: {
        historial_id,
        cabecera_id,
        aseguradoras,
      },
    });

    const outcome = await ejecutarProceso({
      ctx,
      proceso_id,
      meta,
      historial_id,
      cabecera_id,
      cabecera: cabeceraEfectiva,
      relPath,
      absPath,
      aseguradoras,
      limite,
      resumeOnlyPending: true,
    });

    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error('Error en /proceso/reanudar/:id', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/listar
// =============================================================================
router.get('/listar', async (req, res) => {
  try {
    const ctx = getRequestContext(req);
    const base = procesosRoot();
    ensureDir(base);

    const items = [];
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (!/^proceso-\d+$/.test(ent.name)) continue;
      const id = Number(ent.name.split('-')[1]);

      const metaP = metadataPath(id);
      if (!fs.existsSync(metaP)) continue;

      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(metaP, 'utf8'));
      } catch {
        continue;
      }

      const proceso_origen = classifyProcessOrigin(meta);

      const item = {
        id: meta.id,
        nombre: meta.nombre || `Proceso ${meta.id}`,
        estado: meta.estado || '',
        fecha_creacion: meta.fecha_creacion || null,
        fecha_inicio: meta.fecha_inicio || null,
        fecha_fin: meta.fecha_fin || null,
        historial_id: meta.historial_id || null,
        archivo: meta.archivo || null,
        cabecera_id: meta.cabecera_id || null,
        aseguradoras: meta.aseguradoras || [],
        limite: meta.limite || null,
        registros_total: meta.registros_total ?? null,
        registros_filas: meta.registros_filas ?? null,
        registros_procesados: meta.registros_procesados ?? 0,
        cotizaciones_exitosas: meta.cotizaciones_exitosas ?? 0,
        cotizaciones_con_error: meta.cotizaciones_con_error ?? 0,
        cotizaciones_skipped: meta.cotizaciones_skipped ?? 0,
        cotizaciones_pendientes: meta.cotizaciones_pendientes ?? 0,
        aseguradoras_pendientes: meta.aseguradoras_pendientes || [],
        carpeta: `data/procesos/proceso-${meta.id}/`,
        organization_id: meta.organization_id || 'autoiq',
        created_by_user_id: meta.created_by_user_id || 'superadmin-local',
        created_by_name: meta.created_by_name || '',
        proceso_origen,
        es_proceso_webapp: proceso_origen === 'seguros911',
      };
      if (proceso_origen === 'seguros911' && !canViewSeguros911(ctx)) continue;
      if (proceso_origen === 'seguros911') {
        const resumen = await loadResumen(id);
        if (resumen) {
          const catalogSummary = summarizeProcessCatalog(resumen);
          item.seguros911_catalog_pending_count = catalogSummary.pending;
          item.seguros911_catalog_autoupdated_count = catalogSummary.autoupdated;
          item.seguros911_catalog_needs_attention = catalogSummary.needs_attention;
        }
      }
      if (isOwnedByContext(item, ctx)) items.push(item);
    }

// Orden: más recientes primero (fecha_inicio DESC). Fallback: id DESC.
items.sort((a, b) => {
  const ta = Date.parse(a?.fecha_inicio || '') || 0;
  const tb = Date.parse(b?.fecha_inicio || '') || 0;
  if (tb !== ta) return tb - ta;
  return (Number(b?.id) || 0) - (Number(a?.id) || 0);
});
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/aseguradoras-disponibles
// =============================================================================
router.get('/aseguradoras-disponibles', (_req, res) => {
  try {
    const ctx = getRequestContext(_req);
    const items = filterCompanyItemsByContext(listAvailableAseguradoras(), ctx);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('Error en /proceso/aseguradoras-disponibles', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/excel/:id
// Descarga Excel con: (vehículo + cabecera + cotizaciones) + hojas Errores/Skipped
// =============================================================================
router.get('/excel/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ctx = getRequestContext(req);
    const meta = await loadMetadata(id);
    if (!meta) {
      return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    }
    if (!isOwnedByContext(meta, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a este proceso' });
    }
    const dlDir = path.join(procesoDir(id), 'descargas');
    const outAbs = path.join(dlDir, `proceso-${id}-cotizaciones.xlsx`);

    await generarExcelProceso(id);

    if (!fs.existsSync(outAbs)) {
      return res.status(404).json({ ok: false, error: 'No se pudo generar el Excel' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    appendActivity({
      event: 'process_excel_downloaded',
      entity_type: 'proceso',
      entity_id: String(id),
      details: {},
    });
    return res.download(outAbs, `proceso-${id}-cotizaciones.xlsx`);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/estado/:id
// =============================================================================
router.get('/estado/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ctx = getRequestContext(req);
    const meta = await loadMetadata(id);
    if (!meta) return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    if (!isOwnedByContext(meta, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a este proceso' });
    }

    let resumen = null;
    const rp = resumenPath(id);
    if (fs.existsSync(rp)) {
      try {
        resumen = JSON.parse(fs.readFileSync(rp, 'utf8'));
      } catch {}
    }

    res.json({ ok: true, metadata: meta, resumen });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Compat: GET /proceso/:id
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ctx = getRequestContext(req);
    const meta = await loadMetadata(id);
    if (!meta) return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    if (!isOwnedByContext(meta, ctx)) {
      return res.status(403).json({ ok: false, error: 'No tenés acceso a este proceso' });
    }
    const rp = resumenPath(id);
    if (!fs.existsSync(rp)) return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
    const proceso_origen = classifyProcessOrigin(meta);
    res.json(proceso_origen === 'seguros911' ? decorateResumenWithCatalog(j) : j);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;

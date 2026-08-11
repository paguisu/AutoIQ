const express = require('express');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const {
  appendActivity,
  canManageSeguros911Catalog,
  canViewSeguros911,
  getAccessControl,
  getCurrentAccessContext,
  readRecentActivity,
  requireSuperadmin,
  saveAccessControl,
  setSession,
} = require('../utils/access_control');
const {
  DISPLAY_GROUP_CHOICES: SEGUROS911_DISPLAY_GROUP_CHOICES,
  INDICATOR_FIELDS: SEGUROS911_INDICATOR_FIELDS,
  SUMMARY_FIELDS: SEGUROS911_SUMMARY_FIELDS,
  getSeguros911ProductCatalog,
  updateSeguros911CatalogRecord,
  updateSeguros911GroupDefinitions,
} = require('../utils/seguros911_product_catalog');

const router = express.Router();

function projectPath(...parts) {
  return path.join(process.cwd(), ...parts);
}

function dataPath(...parts) {
  return projectPath('data', ...parts);
}

const COVERAGE_GROUP_OVERRIDES_PATH = dataPath('diccionarios', 'grupos_cobertura_overrides.json');
const PRODUCT_CATALOG_CACHE_PATH = dataPath('admin', 'catalogo_productos_cache.json');
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
const COVERAGE_GROUP_CHOICES = Object.entries(COVERAGE_GROUP_LABELS).map(([code, description]) => ({ code, description }));

async function ensureDir(absPath) {
  await fs.mkdir(absPath, { recursive: true });
}

async function readJson(absPath, fallback = null) {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(absPath, value) {
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function normalizeStringArray(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => normalizeText(value))
    .filter(Boolean);
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

function coverageGroup(code = '') {
  const normalized = String(code || '').trim();
  return {
    code: normalized,
    description: COVERAGE_GROUP_LABELS[normalized] || '',
  };
}

async function readCoverageGroupOverrides() {
  return (await readJson(COVERAGE_GROUP_OVERRIDES_PATH, null)) || { global: [], aseguradoras: {} };
}

async function writeCoverageGroupOverrides(payload) {
  await writeJson(COVERAGE_GROUP_OVERRIDES_PATH, payload);
}

function findProductCatalogFiles() {
  const root = dataPath('procesos');
  if (!fsSync.existsSync(root)) return [];
  const out = [];
  for (const entry of fsSync.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('proceso-')) continue;
    const idMatch = entry.name.match(/^proceso-(\d+)$/);
    const processId = idMatch ? Number(idMatch[1]) : null;
    const abs = path.join(root, entry.name, 'descargas', `${entry.name}-cotizaciones.xlsx`);
    if (!fsSync.existsSync(abs)) continue;
    const stat = fsSync.statSync(abs);
    out.push({ processId, abs, mtimeMs: stat.mtimeMs });
  }
  out.sort((a, b) => (b.processId || 0) - (a.processId || 0) || b.mtimeMs - a.mtimeMs);
  return out;
}

function getProductCatalogSignature(files = []) {
  const overridesMtime = fsSync.existsSync(COVERAGE_GROUP_OVERRIDES_PATH)
    ? fsSync.statSync(COVERAGE_GROUP_OVERRIDES_PATH).mtimeMs
    : 0;
  const filePart = files
    .map((file) => `${file.processId || 0}:${Math.round(file.mtimeMs || 0)}`)
    .join('|');
  return `${Math.round(overridesMtime)}::${filePart}`;
}

function parseWorkbookCatalogRows(absPath, processId) {
  try {
    const wb = xlsx.readFile(absPath);
    const ws = wb.Sheets.Cotizaciones;
    if (!ws) return [];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    return rows.map((row) => ({
      process_id: processId || row['Proceso ID'] || '',
      aseguradora: String(row.Aseguradora || '').trim().toLowerCase(),
      producto_codigo: String(row['Producto Codigo'] || '').trim(),
      producto_descripcion: String(row['Producto Descripcion'] || '').trim(),
      cobertura_codigo: String(row['Cobertura Codigo'] || '').trim(),
      cobertura_descripcion: String(row['Cobertura Descripcion'] || '').trim(),
      plan: String(row.Plan || '').trim(),
      grupo_codigo: String(row['Grupo Cobertura Codigo'] || '').trim(),
      grupo_descripcion: String(row['Grupo Cobertura Descripcion'] || '').trim(),
    })).filter((row) => row.aseguradora && (row.producto_codigo || row.producto_descripcion || row.cobertura_descripcion));
  } catch (err) {
    console.error('admin:catalogo:parseWorkbook', absPath, err.message || err);
    return [];
  }
}

function buildCatalogIdentity(row) {
  const productCode = normalizeText(row.producto_codigo);
  const productDesc = normalizeText(row.producto_descripcion);
  const coverageCode = normalizeText(row.cobertura_codigo);
  const coverageDesc = normalizeText(row.cobertura_descripcion);

  if (productCode && coverageCode && coverageCode !== productCode) {
    return {
      key: `codecov:${productCode}|${coverageCode}`,
      match_type: 'description',
      match_value: row.cobertura_descripcion || row.producto_descripcion || row.producto_codigo,
    };
  }
  if (productCode && coverageDesc && coverageDesc !== productDesc) {
    return {
      key: `codecov:${productCode}|${coverageCode || coverageDesc}`,
      match_type: 'description',
      match_value: row.cobertura_descripcion || row.producto_descripcion || row.producto_codigo,
    };
  }
  if (productCode) {
    return {
      key: `code:${productCode}`,
      match_type: 'product_code',
      match_value: row.producto_codigo,
    };
  }
  if (row.producto_descripcion) {
    return {
      key: `desc:${normalizeText(row.producto_descripcion)}`,
      match_type: 'description',
      match_value: row.producto_descripcion,
    };
  }
  return {
    key: `cov:${normalizeText(row.cobertura_descripcion)}`,
    match_type: 'description',
    match_value: row.cobertura_descripcion,
  };
}

function matchOverrideRule(rule = {}, item = {}) {
  const productCodes = normalizeStringArray(rule.productoCodigos);
  const text = normalizeText([item.producto_descripcion, item.cobertura_descripcion, item.plan].filter(Boolean).join(' | '));
  if (productCodes.length) {
    const code = normalizeText(item.producto_codigo);
    if (!productCodes.includes(code)) return false;
  }
  const containsAny = normalizeStringArray(rule.containsAny);
  if (containsAny.length && !containsAny.some((token) => text.includes(token))) return false;
  const containsAll = normalizeStringArray(rule.containsAll);
  if (containsAll.length && !containsAll.every((token) => text.includes(token))) return false;
  return productCodes.length > 0 || containsAny.length > 0 || containsAll.length > 0;
}

function findMatchingOverride(item, overrides) {
  const slug = item.aseguradora;
  const globalRules = Array.isArray(overrides.global) ? overrides.global : [];
  const companyRules = Array.isArray(overrides.aseguradoras?.[slug]) ? overrides.aseguradoras[slug] : [];
  for (const scope of [
    { name: 'aseguradora', rules: companyRules },
    { name: 'global', rules: globalRules },
  ]) {
    for (const rule of scope.rules) {
      if (matchOverrideRule(rule, item)) {
        return { scope: scope.name, rule };
      }
    }
  }
  return null;
}

async function buildCompanyProductCatalog() {
  const files = findProductCatalogFiles();
  const signature = getProductCatalogSignature(files);
  const cached = await readJson(PRODUCT_CATALOG_CACHE_PATH, null);
  if (cached && cached.signature === signature && Array.isArray(cached.items)) {
    return cached.items;
  }

  const overrides = await readCoverageGroupOverrides();
  const map = new Map();

  for (const file of files) {
    const rows = parseWorkbookCatalogRows(file.abs, file.processId);
    for (const row of rows) {
      const identity = buildCatalogIdentity(row);
      const key = `${row.aseguradora}|${identity.key}`;
      const existing = map.get(key);
      if (!existing) {
        const override = findMatchingOverride(row, overrides);
        const effectiveGroup = override?.rule?.group?.code
          ? coverageGroup(override.rule.group.code)
          : { code: row.grupo_codigo, description: row.grupo_descripcion };
        map.set(key, {
          aseguradora: row.aseguradora,
          producto_codigo: row.producto_codigo,
          producto_descripcion: row.producto_descripcion,
          cobertura_codigo: row.cobertura_codigo,
          cobertura_descripcion: row.cobertura_descripcion,
          plan_ejemplo: row.plan,
          grupo_codigo: effectiveGroup.code || '',
          grupo_descripcion: effectiveGroup.description || '',
          pending: !firstNonEmpty(effectiveGroup.code),
          occurrences: 1,
          latest_process_id: row.process_id || '',
          override_scope: override?.scope || '',
          match_type: identity.match_type,
          match_value: identity.match_value,
        });
        continue;
      }
      existing.occurrences += 1;
      const override = findMatchingOverride(row, overrides);
      const effectiveGroup = override?.rule?.group?.code
        ? coverageGroup(override.rule.group.code)
        : { code: row.grupo_codigo, description: row.grupo_descripcion };
      if ((!existing.grupo_codigo && effectiveGroup.code) || override?.rule?.group?.code) {
        existing.grupo_codigo = effectiveGroup.code || '';
        existing.grupo_descripcion = effectiveGroup.description || '';
        existing.pending = !firstNonEmpty(effectiveGroup.code);
        existing.override_scope = override?.scope || existing.override_scope || '';
      }
      if ((!existing.producto_descripcion && row.producto_descripcion) || (!existing.cobertura_descripcion && row.cobertura_descripcion)) {
        existing.producto_descripcion = existing.producto_descripcion || row.producto_descripcion;
        existing.cobertura_descripcion = existing.cobertura_descripcion || row.cobertura_descripcion;
      }
      if (!existing.latest_process_id && row.process_id) existing.latest_process_id = row.process_id;
    }
  }

  const items = [...map.values()].sort((a, b) => {
    const bySlug = a.aseguradora.localeCompare(b.aseguradora, 'es');
    if (bySlug !== 0) return bySlug;
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    const aCode = a.producto_codigo || '';
    const bCode = b.producto_codigo || '';
    const byCode = aCode.localeCompare(bCode, 'es');
    if (byCode !== 0) return byCode;
    return String(a.producto_descripcion || a.cobertura_descripcion || '').localeCompare(
      String(b.producto_descripcion || b.cobertura_descripcion || ''),
      'es'
    );
  });

  await writeJson(PRODUCT_CATALOG_CACHE_PATH, {
    generated_at: new Date().toISOString(),
    signature,
    process_count: files.length,
    items,
  });

  return items;
}

function getContext(req) {
  return req.accessContext || getCurrentAccessContext();
}

function ensureSuperadmin(req, res) {
  const ctx = getContext(req);
  if (!requireSuperadmin(ctx)) {
    res.status(403).json({ ok: false, error: 'Acceso restringido a superadministradores' });
    return null;
  }
  return ctx;
}

function ensureSeguros911CatalogManager(req, res) {
  const ctx = getContext(req);
  if (!canManageSeguros911Catalog(ctx)) {
    res.status(403).json({ ok: false, error: 'Acceso restringido a supervisor o superadministrador' });
    return null;
  }
  return ctx;
}

async function getCompanyConfigs() {
  const root = dataPath();
  const items = await fs.readdir(root, { withFileTypes: true });
  const configs = [];

  for (const item of items) {
    if (!item.isDirectory()) continue;
    const slug = item.name;
    const cfgPath = dataPath(slug, 'aseguradora.json');
    const cfg = await readJson(cfgPath, null);
    if (!cfg) continue;
    configs.push({ slug, config: cfg });
  }

  configs.sort((a, b) => {
    const an = String(a.config?.nombre_publico || a.slug).toLowerCase();
    const bn = String(b.config?.nombre_publico || b.slug).toLowerCase();
    return an.localeCompare(bn, 'es');
  });

  return configs;
}

router.get('/aseguradoras', async (_req, res) => {
  try {
    const ctx = ensureSuperadmin(_req, res);
    if (!ctx) return;
    const items = await getCompanyConfigs();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('admin:aseguradoras:list', err);
    res.status(500).json({ ok: false, error: 'No se pudieron listar las aseguradoras' });
  }
});

router.get('/aseguradoras/:slug', async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const { slug } = req.params;
    const cfg = await readJson(dataPath(slug, 'aseguradora.json'), null);
    if (!cfg) {
      return res.status(404).json({ ok: false, error: 'No existe la aseguradora solicitada' });
    }
    res.json({ ok: true, slug, config: cfg });
  } catch (err) {
    console.error('admin:aseguradoras:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer la configuración de la aseguradora' });
  }
});

router.put('/aseguradoras/:slug', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const { slug } = req.params;
    const current = await readJson(dataPath(slug, 'aseguradora.json'), null);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'No existe la aseguradora solicitada' });
    }

    const incoming = req.body?.config;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, error: 'Body inválido: se espera { config: {...} }' });
    }

    const next = {
      ...current,
      ...incoming,
      parametros_extras: {
        ...(current.parametros_extras || {}),
        ...((incoming.parametros_extras && typeof incoming.parametros_extras === 'object' && !Array.isArray(incoming.parametros_extras))
          ? incoming.parametros_extras
          : {}),
      },
    };
    next.updated_at = new Date().toISOString();
    next.slug = slug;

    await writeJson(dataPath(slug, 'aseguradora.json'), next);
    appendActivity({
      event: 'ws_company_updated',
      entity_type: 'aseguradora',
      entity_id: slug,
      details: { nombre_publico: next.nombre_publico || slug },
    });
    res.json({ ok: true, slug, config: next });
  } catch (err) {
    console.error('admin:aseguradoras:put', err);
    res.status(500).json({ ok: false, error: 'No se pudo guardar la configuración de la aseguradora' });
  }
});

router.get('/catalogo-productos', async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const slug = String(req.query?.slug || '').trim().toLowerCase();
    const items = await buildCompanyProductCatalog();
    const filtered = slug ? items.filter((item) => item.aseguradora === slug) : items;
    res.json({
      ok: true,
      items: filtered,
      groups: COVERAGE_GROUP_CHOICES,
      slugs: [...new Set(items.map((item) => item.aseguradora))],
    });
  } catch (err) {
    console.error('admin:catalogo-productos:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer el catálogo de productos' });
  }
});

router.put('/catalogo-productos/:slug', express.json({ limit: '512kb' }), async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(400).json({ ok: false, error: 'Falta la aseguradora' });

    const matchType = String(req.body?.match_type || '').trim();
    const matchValue = String(req.body?.match_value || '').trim();
    const groupCode = String(req.body?.group_code || '').trim();

    if (!['product_code', 'description'].includes(matchType)) {
      return res.status(400).json({ ok: false, error: 'match_type inválido' });
    }
    if (!matchValue) {
      return res.status(400).json({ ok: false, error: 'Falta match_value' });
    }
    if (!COVERAGE_GROUP_LABELS[groupCode]) {
      return res.status(400).json({ ok: false, error: 'group_code inválido' });
    }

    const overrides = await readCoverageGroupOverrides();
    if (!overrides.aseguradoras || typeof overrides.aseguradoras !== 'object') overrides.aseguradoras = {};
    const rules = Array.isArray(overrides.aseguradoras[slug]) ? overrides.aseguradoras[slug] : [];
    const normalizedValue = normalizeText(matchValue);

    const idx = rules.findIndex((rule) => {
      if (matchType === 'product_code') {
        return normalizeStringArray(rule.productoCodigos).includes(normalizedValue);
      }
      return normalizeStringArray(rule.containsAny).includes(normalizedValue);
    });

    const nextRule = matchType === 'product_code'
      ? { productoCodigos: [matchValue], group: coverageGroup(groupCode) }
      : { containsAny: [matchValue], group: coverageGroup(groupCode) };

    if (idx >= 0) rules[idx] = { ...rules[idx], ...nextRule, group: coverageGroup(groupCode) };
    else rules.push(nextRule);

    overrides.aseguradoras[slug] = rules;
    await writeCoverageGroupOverrides(overrides);
    try {
      await fs.unlink(PRODUCT_CATALOG_CACHE_PATH);
    } catch {}

    appendActivity({
      event: 'coverage_group_rule_updated',
      entity_type: 'catalogo_producto',
      entity_id: `${slug}:${matchType}:${matchValue}`,
      details: { slug, matchType, matchValue, groupCode },
    });

    res.json({ ok: true, slug, rule: nextRule });
  } catch (err) {
    console.error('admin:catalogo-productos:put', err);
    res.status(500).json({ ok: false, error: 'No se pudo guardar la regla del catálogo' });
  }
});

router.get('/session', (req, res) => {
  try {
    const ctx = getContext(req);
    const seguros911Catalog = canManageSeguros911Catalog(ctx) || canViewSeguros911(ctx)
      ? getSeguros911ProductCatalog()
      : null;
    const users = ctx.access.usuarios.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      apellido: item.apellido,
      email: item.email,
      organizacion_id: item.organizacion_id,
      role_id: item.role_id,
      activo: item.activo !== false,
    }));
    res.json({
      ok: true,
      session: ctx.session,
      current_user: ctx.currentUser,
      current_role: ctx.currentRole,
      current_organization: ctx.currentOrganization,
      visible_tabs: ctx.visibleTabs,
      allowed_company_slugs: ctx.allowedCompanySlugs,
      is_superadmin: ctx.isSuperadmin,
      is_supervisor: ctx.isSupervisor,
      can_view_seguros911: ctx.canViewSeguros911,
      can_manage_seguros911_catalog: ctx.canManageSeguros911Catalog,
      seguros911_catalog_pending_count: seguros911Catalog?.stats?.pending || 0,
      seguros911_catalog_autoupdated_count: seguros911Catalog?.stats?.autoupdated || 0,
      users,
    });
  } catch (err) {
    console.error('admin:session:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer la sesión simulada' });
  }
});

router.put('/session', express.json({ limit: '256kb' }), (req, res) => {
  try {
    const userId = String(req.body?.current_user_id || '').trim();
    const access = getAccessControl();
    const user = access.usuarios.find((item) => item.id === userId && item.activo !== false);
    if (!user) {
      return res.status(400).json({ ok: false, error: 'Usuario inválido para la sesión simulada' });
    }
    const session = setSession(userId);
    appendActivity({
      event: 'session_switched',
      entity_type: 'usuario',
      entity_id: userId,
      details: { simulated: true },
    });
    const ctx = getCurrentAccessContext();
    const seguros911Catalog = ctx.canManageSeguros911Catalog || ctx.canViewSeguros911
      ? getSeguros911ProductCatalog()
      : null;
    res.json({
      ok: true,
      session,
      current_user: ctx.currentUser,
      current_role: ctx.currentRole,
      current_organization: ctx.currentOrganization,
      visible_tabs: ctx.visibleTabs,
      allowed_company_slugs: ctx.allowedCompanySlugs,
      is_superadmin: ctx.isSuperadmin,
      is_supervisor: ctx.isSupervisor,
      can_view_seguros911: ctx.canViewSeguros911,
      can_manage_seguros911_catalog: ctx.canManageSeguros911Catalog,
      seguros911_catalog_pending_count: seguros911Catalog?.stats?.pending || 0,
      seguros911_catalog_autoupdated_count: seguros911Catalog?.stats?.autoupdated || 0,
      users: ctx.access.usuarios.map((item) => ({
        id: item.id,
        nombre: item.nombre,
        apellido: item.apellido,
        email: item.email,
        organizacion_id: item.organizacion_id,
        role_id: item.role_id,
        activo: item.activo !== false,
      })),
    });
  } catch (err) {
    console.error('admin:session:put', err);
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la sesión simulada' });
  }
});

router.get('/acceso', async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const data = getAccessControl();
    res.json({
      ok: true,
      data,
      current_user_id: ctx.currentUser?.id || '',
      recent_activity: readRecentActivity(100),
    });
  } catch (err) {
    console.error('admin:acceso:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer la configuración de acceso' });
  }
});

router.put('/acceso', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const payload = req.body?.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ ok: false, error: 'Body inválido: se espera { data: {...} }' });
    }
    const next = saveAccessControl(payload);
    appendActivity({
      event: 'access_control_updated',
      entity_type: 'sistema',
      entity_id: 'access_control',
      details: {
        organizaciones: next.organizaciones.length,
        roles: next.roles.length,
        usuarios: next.usuarios.length,
      },
    });
    res.json({ ok: true, data: next });
  } catch (err) {
    console.error('admin:acceso:put', err);
    res.status(500).json({ ok: false, error: 'No se pudo guardar la configuración de acceso' });
  }
});

router.get('/actividad', (req, res) => {
  try {
    const ctx = ensureSuperadmin(req, res);
    if (!ctx) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100) || 100));
    res.json({ ok: true, items: readRecentActivity(limit) });
  } catch (err) {
    console.error('admin:actividad:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer la actividad reciente' });
  }
});

router.get('/seguros911-productos', async (req, res) => {
  try {
    const ctx = ensureSeguros911CatalogManager(req, res);
    if (!ctx) return;
    const slug = String(req.query?.slug || '').trim().toLowerCase();
    const force = String(req.query?.refresh || '').trim() === '1';
    const payload = getSeguros911ProductCatalog({ force });
    const items = slug
      ? payload.items.filter((item) => item.aseguradora === slug)
      : payload.items;
    res.json({
      ok: true,
      items,
      slugs: [...new Set(payload.items.map((item) => item.aseguradora))],
      groups: payload.group_definitions || SEGUROS911_DISPLAY_GROUP_CHOICES,
      group_definitions: payload.group_definitions || SEGUROS911_DISPLAY_GROUP_CHOICES,
      summary_fields: SEGUROS911_SUMMARY_FIELDS,
      indicator_fields: SEGUROS911_INDICATOR_FIELDS,
      stats: payload.stats,
    });
  } catch (err) {
    console.error('admin:seguros911-productos:get', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer el catalogo de productos Seguros911' });
  }
});

router.put('/seguros911-productos/:slug', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const ctx = ensureSeguros911CatalogManager(req, res);
    if (!ctx) return;
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(400).json({ ok: false, error: 'Falta la aseguradora' });
    const productoCodigo = String(req.body?.producto_codigo || '').trim();
    const coberturaCodigo = String(req.body?.cobertura_codigo || '').trim();
    const productoDescripcion = String(req.body?.producto_descripcion || '').trim();
    const coberturaDescripcion = String(req.body?.cobertura_descripcion || '').trim();
    if (!productoCodigo && !productoDescripcion) {
      return res.status(400).json({ ok: false, error: 'Falta producto_codigo o producto_descripcion' });
    }
    if (!coberturaCodigo && !coberturaDescripcion) {
      return res.status(400).json({ ok: false, error: 'Falta cobertura_codigo o cobertura_descripcion' });
    }

    const updated = updateSeguros911CatalogRecord({
      aseguradora: slug,
      producto_codigo: productoCodigo,
      cobertura_codigo: coberturaCodigo,
      producto_descripcion: productoDescripcion,
      cobertura_descripcion: coberturaDescripcion,
      display_group_code: req.body?.display_group_code,
      summary_flags: req.body?.summary_flags,
      indicators: req.body?.indicators,
    }, {
      id: ctx.currentUser?.id || '',
      name: ctx.currentUser ? [ctx.currentUser.nombre, ctx.currentUser.apellido].filter(Boolean).join(' ').trim() : '',
    });

    appendActivity({
      event: 'seguros911_catalog_record_updated',
      entity_type: 'seguros911_producto',
      entity_id: updated.key,
      details: {
        aseguradora: updated.aseguradora,
        producto_codigo: updated.producto_codigo,
        cobertura_codigo: updated.cobertura_codigo,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (err) {
    console.error('admin:seguros911-productos:put', err);
    res.status(500).json({ ok: false, error: err.message || 'No se pudo guardar el catalogo Seguros911' });
  }
});

router.put('/seguros911-productos-grupos', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const ctx = ensureSeguros911CatalogManager(req, res);
    if (!ctx) return;
    const rawDefinitions = Array.isArray(req.body?.group_definitions) ? req.body.group_definitions : [];
    if (!rawDefinitions.length) {
      return res.status(400).json({ ok: false, error: 'Faltan group_definitions' });
    }

    const updated = updateSeguros911GroupDefinitions(rawDefinitions, {
      id: ctx.currentUser?.id || '',
      name: ctx.currentUser ? [ctx.currentUser.nombre, ctx.currentUser.apellido].filter(Boolean).join(' ').trim() : '',
    });

    appendActivity({
      event: 'seguros911_group_definitions_updated',
      entity_type: 'seguros911_catalog_groups',
      entity_id: 'seguros911_catalog_groups',
      details: {
        total: updated.length,
      },
    });

    res.json({ ok: true, group_definitions: updated });
  } catch (err) {
    console.error('admin:seguros911-productos-grupos:put', err);
    res.status(500).json({ ok: false, error: err.message || 'No se pudieron guardar los grupos de Seguros911' });
  }
});

module.exports = router;

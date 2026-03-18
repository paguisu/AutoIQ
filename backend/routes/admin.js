const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const {
  appendActivity,
  getAccessControl,
  getCurrentAccessContext,
  readRecentActivity,
  requireSuperadmin,
  saveAccessControl,
  setSession,
} = require('../utils/access_control');

const router = express.Router();

function projectPath(...parts) {
  return path.join(process.cwd(), ...parts);
}

function dataPath(...parts) {
  return projectPath('data', ...parts);
}

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

router.get('/session', (req, res) => {
  try {
    const ctx = getContext(req);
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
    res.json({
      ok: true,
      session,
      current_user: ctx.currentUser,
      current_role: ctx.currentRole,
      current_organization: ctx.currentOrganization,
      visible_tabs: ctx.visibleTabs,
      allowed_company_slugs: ctx.allowedCompanySlugs,
      is_superadmin: ctx.isSuperadmin,
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

module.exports = router;

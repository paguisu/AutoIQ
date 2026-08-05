const fs = require('fs');
const path = require('path');

function dataPath(...parts) {
  return path.join(process.cwd(), 'data', ...parts);
}

function ensureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

function ensureParent(absPath) {
  ensureDir(path.dirname(absPath));
}

function readJson(absPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(absPath, value) {
  ensureParent(absPath);
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2), 'utf8');
}

function accessFilePath() {
  return dataPath('system', 'access_control.json');
}

function sessionFilePath() {
  return dataPath('system', 'session.json');
}

function activityFilePath() {
  return dataPath('system', 'activity.log.jsonl');
}

function historialOwnershipPath() {
  return dataPath('system', 'historial_ownership.json');
}

function defaultAccessControl() {
  return {
    organizaciones: [
      {
        id: 'autoiq',
        nombre: 'AutoIQ',
        slug: 'autoiq',
        activa: true,
        companias_habilitadas: ['atm', 'mapfre', 'sancor', 'allianz', 'provincia'],
      },
      {
        id: 'mapfre-org',
        nombre: 'Mapfre',
        slug: 'mapfre',
        activa: true,
        companias_habilitadas: ['mapfre'],
      },
      {
        id: 'swiss-medical',
        nombre: 'Swiss Medical',
        slug: 'swiss-medical',
        activa: true,
        companias_habilitadas: ['atm', 'mapfre', 'sancor', 'allianz', 'provincia'],
      },
    ],
    roles: [
      {
        id: 'superadmin',
        nombre: 'Superadministrador',
        activa: true,
        is_superadmin: true,
        pestañas: ['*'],
        capabilities: ['*'],
      },
      {
        id: 'supervisor',
        nombre: 'Supervisor',
        activa: true,
        is_superadmin: false,
        pestañas: ['inputs', 'cabecera', 'historico', 'base', 'condiciones', 'procesos'],
        capabilities: ['seguros911_view', 'seguros911_catalog_manage'],
      },
      {
        id: 'usuario_generico',
        nombre: 'Usuario genérico',
        activa: true,
        is_superadmin: false,
        pestañas: ['inputs', 'cabecera', 'historico', 'procesos'],
        capabilities: [],
      },
    ],
    usuarios: [
      {
        id: 'superadmin-local',
        nombre: 'Super',
        apellido: 'Admin',
        email: 'superadmin@autoiq.local',
        organizacion_id: 'autoiq',
        role_id: 'superadmin',
        activo: true,
        pestañas_override: [],
      },
      {
        id: 'supervisor-local',
        nombre: 'Supervisor',
        apellido: 'Seguros911',
        email: 'supervisor@autoiq.local',
        organizacion_id: 'autoiq',
        role_id: 'supervisor',
        activo: true,
        pestañas_override: [],
      },
      {
        id: 'ezequiel-carra',
        nombre: 'Ezequiel',
        apellido: 'Carra',
        email: 'carraez@mapfre.com',
        organizacion_id: 'mapfre-org',
        role_id: 'usuario_generico',
        activo: true,
        pestañas_override: [],
      },
      {
        id: 'diego-schenquerman',
        nombre: 'Diego',
        apellido: 'Schenquerman',
        email: 'diego.schenquerman@smg.com.ar',
        organizacion_id: 'swiss-medical',
        role_id: 'usuario_generico',
        activo: true,
        pestañas_override: [],
      },
    ],
    updated_at: new Date().toISOString(),
  };
}

function normalizeOrganization(org) {
  if (!org || typeof org !== 'object') return null;
  const slug = String(org.slug || org.id || '').trim();
  if (!slug) return null;
  return {
    id: String(org.id || slug).trim(),
    nombre: String(org.nombre || slug).trim(),
    slug,
    activa: org.activa !== false,
    companias_habilitadas: Array.isArray(org.companias_habilitadas)
      ? org.companias_habilitadas.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function normalizeRole(role) {
  if (!role || typeof role !== 'object') return null;
  const id = String(role.id || '').trim();
  if (!id) return null;
  const pestañas = Array.isArray(role.pestañas)
    ? role.pestañas.map((x) => String(x || '').trim()).filter(Boolean)
    : Array.isArray(role.permisos)
      ? role.permisos.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  const capabilities = Array.isArray(role.capabilities)
    ? role.capabilities.map((x) => String(x || '').trim()).filter(Boolean)
    : Array.isArray(role.permisos_especiales)
      ? role.permisos_especiales.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  return {
    id,
    nombre: String(role.nombre || id).trim(),
    activa: role.activa !== false,
    is_superadmin: role.is_superadmin === true || pestañas.includes('*'),
    pestañas,
    capabilities,
  };
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const id = String(user.id || user.email || '').trim();
  if (!id) return null;
  const nombreCompuesto = String(user.nombre || '').trim();
  let nombre = String(user.nombre || '').trim();
  let apellido = String(user.apellido || '').trim();
  if (!apellido && nombreCompuesto.includes(' ')) {
    const parts = nombreCompuesto.split(/\s+/);
    nombre = parts.shift() || nombreCompuesto;
    apellido = parts.join(' ').trim();
  }
  const roleId = String(user.role_id || (Array.isArray(user.role_ids) ? user.role_ids[0] : '') || 'usuario_generico').trim();
  return {
    id,
    nombre,
    apellido,
    email: String(user.email || '').trim(),
    organizacion_id: String(user.organizacion_id || user.organizacion || 'autoiq').trim(),
    role_id: roleId,
    activo: user.activo !== false,
    pestañas_override: Array.isArray(user.pestañas_override)
      ? user.pestañas_override.map((x) => String(x || '').trim()).filter(Boolean)
      : [],
  };
}

function normalizeAccessControl(data) {
  const defaults = defaultAccessControl();
  const organizaciones = Array.isArray(data?.organizaciones)
    ? data.organizaciones.map(normalizeOrganization).filter(Boolean)
    : defaults.organizaciones;
  const roles = Array.isArray(data?.roles)
    ? data.roles.map(normalizeRole).filter(Boolean)
    : defaults.roles;
  const usuarios = Array.isArray(data?.usuarios)
    ? data.usuarios.map(normalizeUser).filter(Boolean)
    : defaults.usuarios;
  return {
    organizaciones,
    roles,
    usuarios,
    updated_at: data?.updated_at || new Date().toISOString(),
  };
}

function getAccessControl() {
  const file = accessFilePath();
  const current = readJson(file, null);
  const normalized = normalizeAccessControl(current || defaultAccessControl());
  if (!current) writeJson(file, normalized);
  return normalized;
}

function saveAccessControl(data) {
  const next = normalizeAccessControl(data);
  next.updated_at = new Date().toISOString();
  writeJson(accessFilePath(), next);
  return next;
}

function getSession() {
  const access = getAccessControl();
  const fallbackUserId = access.usuarios[0]?.id || 'superadmin-local';
  const current = readJson(sessionFilePath(), null);
  const next = {
    current_user_id: String(current?.current_user_id || fallbackUserId).trim(),
    updated_at: current?.updated_at || new Date().toISOString(),
  };
  if (!current) writeJson(sessionFilePath(), next);
  return next;
}

function setSession(currentUserId) {
  const next = {
    current_user_id: String(currentUserId || '').trim(),
    updated_at: new Date().toISOString(),
  };
  writeJson(sessionFilePath(), next);
  return next;
}

function getUserDisplayName(user) {
  const fullName = [user?.nombre, user?.apellido].filter(Boolean).join(' ').trim();
  return fullName || user?.email || user?.id || 'Usuario sin nombre';
}

function getCurrentAccessContext() {
  const access = getAccessControl();
  const session = getSession();
  const fallbackUser = access.usuarios[0] || null;
  const currentUser = access.usuarios.find((item) => item.id === session.current_user_id && item.activo !== false) || fallbackUser;
  const currentRole = access.roles.find((item) => item.id === currentUser?.role_id && item.activa !== false) || access.roles[0] || null;
  const currentOrganization = access.organizaciones.find((item) => item.id === currentUser?.organizacion_id && item.activa !== false) || access.organizaciones[0] || null;
  const isSuperadmin = currentRole?.is_superadmin === true;
  const capabilities = Array.isArray(currentRole?.capabilities) ? currentRole.capabilities : [];
  const visibleTabs = Array.isArray(currentUser?.pestañas_override) && currentUser.pestañas_override.length > 0
    ? currentUser.pestañas_override
    : Array.isArray(currentRole?.pestañas) && currentRole.pestañas.length > 0
      ? currentRole.pestañas
      : ['inputs', 'cabecera', 'historico', 'procesos'];
  const canViewSeguros911Flag = isSuperadmin || capabilities.includes('*') || capabilities.includes('seguros911_view') || capabilities.includes('seguros911_catalog_manage');
  const canManageSeguros911CatalogFlag = isSuperadmin || capabilities.includes('*') || capabilities.includes('seguros911_catalog_manage');

  return {
    session,
    access,
    currentUser,
    currentRole,
    currentOrganization,
    isSuperadmin,
    isSupervisor: currentRole?.id === 'supervisor',
    capabilities,
    visibleTabs,
    canViewSeguros911: canViewSeguros911Flag,
    canManageSeguros911Catalog: canManageSeguros911CatalogFlag,
    allowedCompanySlugs: isSuperadmin
      ? null
      : Array.isArray(currentOrganization?.companias_habilitadas)
        ? currentOrganization.companias_habilitadas
        : [],
  };
}

function canAccessTab(ctx, tabId) {
  const tabs = Array.isArray(ctx?.visibleTabs) ? ctx.visibleTabs : [];
  return tabs.includes('*') || tabs.includes(tabId);
}

function requireSuperadmin(ctx) {
  return !!ctx?.isSuperadmin;
}

function canViewSeguros911(ctx) {
  return !!ctx?.canViewSeguros911;
}

function canManageSeguros911Catalog(ctx) {
  return !!ctx?.canManageSeguros911Catalog;
}

function appendActivity(event) {
  const ctx = getCurrentAccessContext();
  const line = {
    at: new Date().toISOString(),
    user_id: ctx.currentUser?.id || '',
    user_email: ctx.currentUser?.email || '',
    user_name: getUserDisplayName(ctx.currentUser),
    organization_id: ctx.currentOrganization?.id || '',
    organization_name: ctx.currentOrganization?.nombre || '',
    event: String(event?.event || '').trim(),
    entity_type: String(event?.entity_type || '').trim(),
    entity_id: String(event?.entity_id || '').trim(),
    details: event?.details || {},
  };
  ensureParent(activityFilePath());
  fs.appendFileSync(activityFilePath(), `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}

function readRecentActivity(limit = 100) {
  try {
    const raw = fs.readFileSync(activityFilePath(), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .reverse();
  } catch {
    return [];
  }
}

function readHistorialOwnership() {
  return readJson(historialOwnershipPath(), { items: {} });
}

function saveHistorialOwnership(data) {
  writeJson(historialOwnershipPath(), data);
  return data;
}

function getHistorialOwner(historialId) {
  const map = readHistorialOwnership();
  return map.items?.[String(historialId)] || null;
}

function setHistorialOwner(historialId, owner) {
  const map = readHistorialOwnership();
  map.items = map.items || {};
  map.items[String(historialId)] = {
    organization_id: String(owner?.organization_id || 'autoiq').trim(),
    user_id: String(owner?.user_id || 'superadmin-local').trim(),
    assigned_at: new Date().toISOString(),
  };
  saveHistorialOwnership(map);
  return map.items[String(historialId)];
}

function isOwnedByContext(record, ctx) {
  if (ctx?.isSuperadmin) return true;
  const recordOrg = String(record?.organization_id || 'autoiq').trim();
  return recordOrg === String(ctx?.currentOrganization?.id || '').trim();
}

module.exports = {
  appendActivity,
  canManageSeguros911Catalog,
  canAccessTab,
  canViewSeguros911,
  defaultAccessControl,
  getAccessControl,
  getCurrentAccessContext,
  getHistorialOwner,
  getSession,
  getUserDisplayName,
  isOwnedByContext,
  readRecentActivity,
  requireSuperadmin,
  saveAccessControl,
  setHistorialOwner,
  setSession,
};

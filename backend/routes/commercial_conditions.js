const express = require('express');
const {
  addQuoteOverride,
  buildAllowedOverrides,
  buildEffectivePayload,
  buildMatrix,
  exportMatrixToWorkbook,
  loadStore,
  saveStore,
  saveValues,
  setInheritance,
  validateQuoteOverride,
} = require('../services/commercial_conditions');
const {
  appendActivity,
  getCurrentAccessContext,
  requireSuperadmin,
} = require('../utils/access_control');

const router = express.Router();

function actorFromRequest(req) {
  const ctx = req.accessContext || getCurrentAccessContext();
  return {
    ctx,
    user_id: ctx?.currentUser?.id || '',
    role: ctx?.currentRole?.id || '',
    isSuperadmin: !!ctx?.isSuperadmin,
    isSupervisor: !!ctx?.isSupervisor,
  };
}

function canWriteCommercialConditions(actor) {
  return actor.isSuperadmin || actor.isSupervisor;
}

function sendError(res, err) {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message || 'Error en condiciones comerciales',
    code: err.code || undefined,
    validation: err.validation || undefined,
  });
}

router.get('/concepts', (_req, res) => {
  const store = loadStore();
  res.json({ items: store.concepts });
});

router.get('/companies', (req, res) => {
  const includeInactive = ['1', 'true', 'si', 'sí'].includes(String(req.query.include_inactive || '').toLowerCase());
  const store = loadStore();
  const items = store.companies
    .filter((company) => includeInactive || company.active !== false)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  res.json({ items });
});

router.get('/users', (_req, res) => {
  const store = loadStore();
  res.json({ items: store.users });
});

router.get('/matrix', (req, res) => {
  const store = loadStore();
  res.json(buildMatrix(store, req.query));
});

router.get('/effective', (req, res) => {
  const store = loadStore();
  res.json(buildEffectivePayload(store, req.query));
});

router.get('/allowed-overrides', (req, res) => {
  const store = loadStore();
  res.json({ items: buildAllowedOverrides(store, req.query) });
});

router.put('/users/:userId/companies/:companySlug/inheritance', express.json({ limit: '256kb' }), (req, res) => {
  const actor = actorFromRequest(req);
  if (!canWriteCommercialConditions(actor)) {
    return res.status(403).json({ error: 'No autorizado para modificar condiciones comerciales' });
  }
  try {
    const store = loadStore();
    const updated = setInheritance(store, {
      ...req.body,
      user_id: req.params.userId,
      company_slug: req.params.companySlug,
    }, actor);
    saveStore(updated);
    appendActivity({
      event: 'commercial_conditions.inheritance.updated',
      entity_type: 'commercial_conditions',
      entity_id: `${req.params.userId}:${req.params.companySlug}`,
      details: { inherits_default: req.body?.inherits_default },
    });
    res.json({ ok: true, setting: updated.user_company_settings.find((setting) => (
      String(setting.user_id) === String(req.params.userId) &&
      String(setting.company_slug) === String(req.params.companySlug).toLowerCase()
    )) });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/values', express.json({ limit: '1mb' }), (req, res) => {
  const actor = actorFromRequest(req);
  if (!canWriteCommercialConditions(actor)) {
    return res.status(403).json({ error: 'No autorizado para modificar condiciones comerciales' });
  }
  try {
    const store = loadStore();
    const updated = saveValues(store, req.body, actor);
    saveStore(updated);
    appendActivity({
      event: 'commercial_conditions.values.saved',
      entity_type: 'commercial_conditions',
      entity_id: String(req.body?.owner_id || ''),
      details: { changes_count: Array.isArray(req.body?.changes) ? req.body.changes.length : 0 },
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/quote-overrides/validate', express.json({ limit: '256kb' }), (req, res) => {
  const actor = actorFromRequest(req);
  const store = loadStore();
  res.json(validateQuoteOverride(store, req.body, actor));
});

router.post('/quote-overrides', express.json({ limit: '256kb' }), (req, res) => {
  const actor = actorFromRequest(req);
  try {
    const store = loadStore();
    const override = addQuoteOverride(store, req.body, actor);
    saveStore(store);
    appendActivity({
      event: 'commercial_conditions.quote_override.created',
      entity_type: 'commercial_conditions',
      entity_id: override.id,
      details: {
        quote_id: override.quote_id,
        company_slug: override.company_slug,
        concept_code: override.concept_code,
      },
    });
    res.status(201).json({ ok: true, override });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/export', express.json({ limit: '256kb' }), (req, res) => {
  const actor = actorFromRequest(req);
  if (!requireSuperadmin(actor.ctx)) {
    return res.status(403).json({ error: 'Sólo Superadmin puede exportar condiciones comerciales' });
  }
  try {
    const store = loadStore();
    const buffer = exportMatrixToWorkbook(store, req.body || {});
    appendActivity({
      event: 'commercial_conditions.exported',
      entity_type: 'commercial_conditions',
      entity_id: 'matrix',
      details: { user_id: req.body?.user_id || '' },
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="condiciones-comerciales.xlsx"');
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

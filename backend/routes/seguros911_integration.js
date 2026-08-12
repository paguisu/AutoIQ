const express = require('express');
const {
  appendAudit,
  buildEffectivePayload,
  buildMatrix,
  exportMatrixToWorkbook,
  loadStore,
  saveStore,
  saveValues,
  setInheritance,
} = require('../services/commercial_conditions');
const { requireSeguros911Service } = require('../middleware/service_auth');
const fs = require('fs');
const path = require('path');
const { syncTable } = require('../services/catalogos');
const xlsx = require('xlsx');
const db = require('../config/db');
const { setHistorialOwner } = require('../utils/access_control');

const router = express.Router();
router.use(requireSeguros911Service);

function actor(req) {
  const role = req.serviceActor.role === 'admin' ? 'superadmin' : req.serviceActor.role;
  return {
    user_id: req.serviceActor.user_id,
    display_name: req.serviceActor.display_name,
    role,
    source_system: 'seguros911',
  };
}

function assertManager(req, res) {
  if (!['supervisor', 'admin', 'superadmin'].includes(req.serviceActor.role)) {
    res.status(403).json({ error: 'Se requiere rol Supervisor o superior', code: 'INSUFFICIENT_ROLE' });
    return false;
  }
  return true;
}

function ensureProducerUser(store, producer) {
  store.producers = Array.isArray(store.producers) ? store.producers : [];
  const id = String(producer.public_uuid || producer.id || '').trim();
  if (!id) throw Object.assign(new Error('El productor requiere public_uuid'), { statusCode: 400 });
  const normalized = {
    id,
    public_uuid: id,
    code: String(producer.code || '').trim().toLowerCase(),
    display_name: String(producer.display_name || producer.nombre || '').trim(),
    active: producer.active !== false,
    is_seguros911: producer.is_seguros911 === true,
    source_system: 'seguros911',
    updated_at: new Date().toISOString(),
  };
  const producerIndex = store.producers.findIndex((item) => String(item.id) === id);
  if (producerIndex >= 0) store.producers[producerIndex] = { ...store.producers[producerIndex], ...normalized };
  else store.producers.push(normalized);

  const userIndex = store.users.findIndex((item) => String(item.id) === id);
  const user = {
    id,
    source_system: 'seguros911',
    external_user_id: id,
    display_name: normalized.display_name,
    role: 'usuario_generico',
    active: normalized.active,
    entity_type: 'producer',
  };
  if (userIndex >= 0) store.users[userIndex] = { ...store.users[userIndex], ...user };
  else store.users.push(user);
  return normalized;
}

router.get('/commercial-conditions/bootstrap', (req, res) => {
  const store = loadStore();
  res.json({
    producers: store.producers || [],
    companies: store.companies.filter((item) => item.active !== false),
    concepts: store.concepts,
  });
});

router.put('/producers/:producerId', (req, res) => {
  if (!assertManager(req, res)) return;
  try {
    const store = loadStore();
    const producer = ensureProducerUser(store, { ...req.body, public_uuid: req.params.producerId });
    saveStore(store);
    appendAudit({
      event: 'producer.synced',
      actor_user_id: req.serviceActor.user_id,
      actor_role: req.serviceActor.role,
      entity_type: 'producer',
      entity_id: producer.id,
      details: { display_name: producer.display_name, active: producer.active },
    });
    res.json({ ok: true, producer });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get('/producers/:producerId/commercial-conditions', (req, res) => {
  const store = loadStore();
  res.json(buildMatrix(store, { user_id: req.params.producerId }));
});

router.get('/producers/:producerId/commercial-conditions/effective', (req, res) => {
  const store = loadStore();
  res.json(buildEffectivePayload(store, { ...req.query, user_id: req.params.producerId }));
});

router.put('/producers/:producerId/companies/:companySlug/inheritance', (req, res) => {
  if (!assertManager(req, res)) return;
  try {
    let store = loadStore();
    store = setInheritance(store, {
      ...req.body,
      user_id: req.params.producerId,
      company_slug: req.params.companySlug,
    }, actor(req));
    saveStore(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
  }
});

router.patch('/producers/:producerId/commercial-conditions', (req, res) => {
  if (!assertManager(req, res)) return;
  try {
    let store = loadStore();
    store = saveValues(store, {
      owner_type: 'user',
      owner_id: req.params.producerId,
      changes: req.body.changes,
    }, actor(req));
    saveStore(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message, code: error.code, validation: error.validation });
  }
});

router.post('/commercial-conditions/export', (req, res) => {
  if (!assertManager(req, res)) return;
  try {
    const store = loadStore();
    const buffer = exportMatrixToWorkbook(store, { user_id: req.body?.producer_id || '' });
    appendAudit({
      event: 'commercial_conditions.exported_by_seguros911',
      actor_user_id: req.serviceActor.user_id,
      actor_role: req.serviceActor.role,
      entity_type: 'commercial_conditions',
      entity_id: req.body?.producer_id || 'default_seguros911',
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="condiciones-comerciales.xlsx"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/catalogs/vehicle-snapshot', async (req, res) => {
  if (!assertManager(req, res)) return;
  const dataRoot = path.join(process.cwd(), 'data');
  const catalogRoot = path.join(dataRoot, 'catalogos');
  const tables = ['ws_au_marcas', 'ws_au_infoauto', 'ws_au_infoauto_dc', 'ws_au_localidades'];
  const refresh = req.body?.refresh !== false;
  const sync = [];
  if (refresh) {
    for (const table of tables) {
      try {
        // Deliberadamente secuencial: los servicios de catálogo externos suelen limitar concurrencia.
        // eslint-disable-next-line no-await-in-loop
        const result = await syncTable({ dataRoot, catalogRoot, slug: 'atm', table, source: 'remote', dryRun: false });
        sync.push({ table, ok: true, run_id: result.runId || null });
      } catch (error) {
        sync.push({ table, ok: false, error: error.message });
      }
    }
  }
  const files = {
    brands: path.join(catalogRoot, 'atm', 'ws_au_marcas', 'current.json'),
    infoauto: path.join(catalogRoot, 'atm', 'ws_au_infoauto', 'current.json'),
    infoautoDc: path.join(catalogRoot, 'atm', 'ws_au_infoauto_dc', 'current.json'),
    localities: path.join(catalogRoot, 'atm', 'ws_au_localidades', 'current.json'),
  };
  const data = {};
  for (const [key, file] of Object.entries(files)) {
    if (!fs.existsSync(file) && key === 'infoautoDc') {
      data[key] = [];
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data[key] = Array.isArray(parsed.rows) ? parsed.rows : [];
  }
  res.json({ generated_at: new Date().toISOString(), source: 'autoiq', sync, data });
});

router.post('/quote-inputs', async (req, res) => {
  if (!assertManager(req, res)) return;
  try {
    const row = req.body?.row;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return res.status(400).json({ error: 'Falta la fila canónica de cotización' });
    }
    const dir = path.join(process.cwd(), 'data', 'combinados');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `cotizador-publico-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.xlsx`;
    const absPath = path.join(dir, fileName);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([row]), 'Cotizacion');
    xlsx.writeFile(workbook, absPath);
    const [result] = await db.execute(
      `INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros)
       VALUES (?, ?, NOW(), 1)`,
      [fileName, absPath]
    );
    setHistorialOwner(result.insertId, {
      organization_id: 'autoiq',
      user_id: req.body?.producer_public_uuid || 'seguros911',
      source_system: 'seguros911',
    });
    res.status(201).json({ historial_id: result.insertId, file_name: fileName });
  } catch (error) {
    res.status(500).json({ error: error.message || 'No se pudo preparar el input de cotización' });
  }
});

module.exports = router;

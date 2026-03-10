const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  listCompanySlugs,
  listTablesForCompany,
  syncTable,
  readReport,
} = require('../services/catalogos');

const router = express.Router();

function roots() {
  const dataRoot = path.join(process.cwd(), 'data');
  const catalogRoot = path.join(dataRoot, 'catalogos');
  if (!fs.existsSync(catalogRoot)) fs.mkdirSync(catalogRoot, { recursive: true });
  return { dataRoot, catalogRoot };
}

router.get('/companias', (_req, res) => {
  try {
    const { dataRoot } = roots();
    const items = listCompanySlugs(dataRoot);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('catalogos:companias', err);
    res.status(500).json({ ok: false, error: 'No se pudo listar compañías' });
  }
});

router.get('/:slug/tablas', (req, res) => {
  try {
    const { dataRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const items = listTablesForCompany(dataRoot, slug);
    res.json({ ok: true, slug, items });
  } catch (err) {
    console.error('catalogos:tablas', err);
    res.status(500).json({ ok: false, error: 'No se pudo listar tablas' });
  }
});

router.post('/:slug/sync/:tabla', express.json(), async (req, res) => {
  try {
    const { dataRoot, catalogRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const table = String(req.params.tabla || '').trim();

    const out = await syncTable({
      dataRoot,
      catalogRoot,
      slug,
      table,
    });

    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('catalogos:sync:tabla', err);
    res.status(400).json({ ok: false, error: err.message || 'No se pudo sincronizar tabla' });
  }
});

router.post('/:slug/sync-all', express.json(), async (req, res) => {
  try {
    const { dataRoot, catalogRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const tables = listTablesForCompany(dataRoot, slug)
      .filter((x) => x.exists)
      .map((x) => x.table);

    const results = [];
    for (const table of tables) {
      const out = await syncTable({ dataRoot, catalogRoot, slug, table });
      results.push({ table, resumen: out.resumen, runId: out.runId });
    }

    res.json({ ok: true, slug, total: results.length, results });
  } catch (err) {
    console.error('catalogos:sync:all', err);
    res.status(400).json({ ok: false, error: err.message || 'No se pudo sincronizar todas las tablas' });
  }
});

router.get('/:slug/reportes/:runId', async (req, res) => {
  try {
    const { catalogRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const runId = String(req.params.runId || '').trim();
    const report = await readReport({ catalogRoot, slug, runId });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('catalogos:reporte:json', err);
    res.status(404).json({ ok: false, error: 'No se encontró reporte' });
  }
});

router.get('/:slug/reportes/:runId.csv', async (req, res) => {
  try {
    const { catalogRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const runId = String(req.params.runId || '').trim();
    const abs = path.join(catalogRoot, slug, 'reports', `${runId}.csv`);
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, error: 'No se encontró CSV' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${runId}.csv"`);
    res.send(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error('catalogos:reporte:csv', err);
    res.status(404).json({ ok: false, error: 'No se encontró CSV' });
  }
});

module.exports = router;

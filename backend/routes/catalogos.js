const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  listCompanySlugs,
  listTablesForCompany,
  getTableStatus,
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

function parseBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'si';
}

function pickSource(req) {
  const q = String(req.query?.source || req.body?.source || 'local').toLowerCase().trim();
  return q === 'remote' ? 'remote' : 'local';
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

router.get('/:slug/estado/:tabla', (req, res) => {
  try {
    const { dataRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const table = String(req.params.tabla || '').trim();
    const status = getTableStatus({ dataRoot, slug, table });
    res.json({ ok: true, status });
  } catch (err) {
    console.error('catalogos:estado:tabla', err);
    res.status(404).json({ ok: false, error: err.message || 'No se pudo leer el estado de la tabla' });
  }
});

router.post('/:slug/sync/:tabla', express.json(), async (req, res) => {
  try {
    const { dataRoot, catalogRoot } = roots();
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const table = String(req.params.tabla || '').trim();
    const dryRun = parseBool(req.query?.dryRun ?? req.body?.dryRun);
    const source = pickSource(req);

    const out = await syncTable({
      dataRoot,
      catalogRoot,
      slug,
      table,
      source,
      dryRun,
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
    const dryRun = parseBool(req.query?.dryRun ?? req.body?.dryRun);
    const source = pickSource(req);

    const tables = listTablesForCompany(dataRoot, slug)
      .filter((x) => source === 'remote' || x.exists)
      .map((x) => x.table);

    const results = [];
    for (const table of tables) {
      // secuencial para reducir ruido de IO y facilitar troubleshooting
      // eslint-disable-next-line no-await-in-loop
      const out = await syncTable({ dataRoot, catalogRoot, slug, table, source, dryRun });
      results.push({
        table,
        runId: out.runId,
        dryRun,
        source,
        rows: out.profile?.totalRows || 0,
        columns: out.profile?.columns?.length || 0,
        resumen: out.resumen,
      });
    }

    res.json({ ok: true, slug, source, dryRun, total: results.length, results });
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

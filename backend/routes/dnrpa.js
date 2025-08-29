// backend/routes/dnrpa.js
const express = require('express');
const router = express.Router();

let db;
try {
  db = require('../config/db'); // mismo cliente que usa tu server.js
} catch (e1) {
  try {
    db = require('../db'); // fallback por si tu proyecto usa ../db
  } catch (e2) {
    throw new Error('No se pudo cargar MySQL (../config/db ni ../db)');
  }
}

// Helper de consulta compatible con .execute y .query
async function q(sql, params = []) {
  if (db && typeof db.execute === 'function') {
    const [rows] = await db.execute(sql, params);
    return rows;
  }
  if (db && typeof db.query === 'function') {
    const [rows] = await db.query(sql, params);
    return rows;
  }
  throw new Error('Cliente MySQL sin método .execute/.query disponible');
}

/**
 * GET /dnrpa/summary
 * Devuelve el resumen por vigencia desde la vista dnrpa_resumen_vigencia
 */
router.get('/summary', async (_req, res) => {
  try {
    const rows = await q('SELECT * FROM dnrpa_resumen_vigencia ORDER BY vigencia DESC');
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('GET /dnrpa/summary error:', err);
    res.status(500).json({ ok: false, error: 'Error consultando resumen de DNRPA' });
  }
});

/**
 * POST /dnrpa/analyze (stub)
 * Próxima iteración: aceptar PDF/CSV + vigencia, convertir si es PDF (Tabula), normalizar y devolver conteos (dry-run).
 */
router.post('/analyze', async (_req, res) => {
  res.status(501).json({ ok: false, error: 'Analyze aún no implementado' });
});

/**
 * POST /dnrpa/import (stub)
 * Próxima iteración: convertir PDF→CSV, cargar a stage, upsert modelos+precios, devolver resumen final.
 */
router.post('/import', async (_req, res) => {
  res.status(501).json({ ok: false, error: 'Import aún no implementado' });
});

module.exports = router;

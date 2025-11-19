const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Lista
router.get('/', async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, nombre_publico, vigencia, refacturacion, descuento, ajuste_rc, ajuste_casco, activo FROM aseguradoras_config ORDER BY nombre_publico'
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('aseguradoras:list', err);
    res.status(500).json({ ok: false, error: 'Error al listar aseguradoras' });
  }
});

// Detalle
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, nombre_publico, vigencia, refacturacion, descuento, ajuste_rc, ajuste_casco, activo FROM aseguradoras_config WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('aseguradoras:detail', err);
    res.status(500).json({ ok: false, error: 'Error al obtener aseguradora' });
  }
});

// Crear
router.post('/', async (req, res) => {
  const { nombre_publico, vigencia, refacturacion, descuento = 0, ajuste_rc = 0, ajuste_casco = 0, activo = 1 } = req.body || {};
  try {
    const [r] = await db.execute(
      `INSERT INTO aseguradoras_config (nombre_publico, vigencia, refacturacion, descuento, ajuste_rc, ajuste_casco, activo)
       VALUES (?,?,?,?,?,?,?)`,
      [nombre_publico, vigencia, refacturacion, descuento, ajuste_rc, ajuste_casco, activo]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    console.error('aseguradoras:create', err);
    res.status(500).json({ ok: false, error: 'Error al crear aseguradora' });
  }
});

// Actualizar
router.put('/:id', async (req, res) => {
  const { nombre_publico, vigencia, refacturacion, descuento = 0, ajuste_rc = 0, ajuste_casco = 0, activo = 1 } = req.body || {};
  try {
    await db.execute(
      `UPDATE aseguradoras_config SET nombre_publico=?, vigencia=?, refacturacion=?, descuento=?, ajuste_rc=?, ajuste_casco=?, activo=? WHERE id=?`,
      [nombre_publico, vigencia, refacturacion, descuento, ajuste_rc, ajuste_casco, activo, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('aseguradoras:update', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar aseguradora' });
  }
});

module.exports = router;

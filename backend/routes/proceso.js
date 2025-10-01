// backend/routes/proceso.js
// POST /proceso/crear  -> delega en backend/scripts/crearProcesos.js (o crearProceso.js)

const express = require('express');
const router = express.Router();

function cargarImplementacion() {
  let mod = null;

  // 1) Intento nombre plural
  try { mod = require('../scripts/crearProcesos'); }
  catch (e1) {
    // 2) Intento nombre singular
    try { mod = require('../scripts/crearProceso'); }
    catch (e2) {
      mod = null;
    }
  }

  if (!mod) return null;

  // Formatos de export soportados
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.crearProceso === 'function') return mod.crearProceso;
  if (mod && typeof mod.default === 'function') return mod.default;

  return null;
}

const impl = cargarImplementacion();

router.post('/crear', express.json(), async (req, res) => {
  try {
    if (!impl) {
      return res.status(501).json({
        error: 'Implementación no disponible',
        detail: 'No se encontró scripts/crearProcesos(.js) ni scripts/crearProceso(.js), o no exportan una función válida'
      });
    }

    const { nombre, nombre_cabecera } = req.body || {};
    if (!nombre || typeof nombre !== 'string') {
      return res.status(400).json({ error: 'Parámetro "nombre" es requerido' });
    }

    // Delegar TODO al script existente
    const resultado = await impl({ nombre, nombre_cabecera: nombre_cabecera ?? null });
    return res.json(resultado);
  } catch (err) {
    console.error('[AutoIQ] Error en POST /proceso/crear:', err);
    return res.status(500).json({ error: 'No se pudo crear el proceso', detail: String(err?.message || err) });
  }
});

module.exports = router;

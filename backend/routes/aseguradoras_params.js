// backend/routes/aseguradoras_params.js
// Lectura de parámetros y diccionarios desde /data/<aseguradora>/...
// No escribe disco. Solo expone JSON al frontend.

const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

// Construye ruta absoluta a /data/<...> relativo a la raíz del proyecto.
// Evita hardcodear "D:\..." y funciona en Windows/Linux.
function dataPath(...p) {
  // Suponemos que el server se lanza desde la raíz del repo AutoIQ.
  // Si no fuera así, ajustar baseDir según corresponda.
  const baseDir = path.join(process.cwd(), 'data');
  return path.join(baseDir, ...p);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

// ----------------- Endpoints específicos ATM (azúcar sintáctica) -----------------

// GET /aseguradoras/atm/parametros
router.get('/atm/parametros', async (_req, res) => {
  try {
    const file = dataPath('atm', 'aseguradora.json');
    const json = await readJson(file);
    res.json({ ok: true, aseguradora: 'ATM', parametros: json });
  } catch (err) {
    console.error('aseguradoras_params:atm:parametros', err);
    res.status(500).json({ ok: false, error: 'No se pudieron leer los parámetros de ATM' });
  }
});

// GET /aseguradoras/atm/diccionarios/uso
router.get('/atm/diccionarios/uso', async (_req, res) => {
  try {
    const file = dataPath('atm', 'diccionarios', 'uso.json');
    const json = await readJson(file);
    res.json({ ok: true, aseguradora: 'ATM', diccionario: 'uso', data: json });
  } catch (err) {
    console.error('aseguradoras_params:atm:dicc:uso', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer el diccionario de uso de ATM' });
  }
});

// GET /aseguradoras/atm/diccionarios/tipo-vehiculo
router.get('/atm/diccionarios/tipo-vehiculo', async (_req, res) => {
  try {
    const file = dataPath('atm', 'diccionarios', 'tipo_vehiculo.json');
    const json = await readJson(file);
    res.json({ ok: true, aseguradora: 'ATM', diccionario: 'tipo_vehiculo', data: json });
  } catch (err) {
    console.error('aseguradoras_params:atm:dicc:tipo_vehiculo', err);
    res.status(500).json({ ok: false, error: 'No se pudo leer el diccionario tipo_vehiculo de ATM' });
  }
});

// ----------------- Endpoints genéricos para escalar a otras aseguradoras -----------------

// GET /aseguradoras/:slug/parametros
// Ej: /aseguradoras/atm/parametros  -> data/atm/aseguradora.json
router.get('/:slug/parametros', async (req, res) => {
  try {
    const { slug } = req.params;
    const file = dataPath(slug, 'aseguradora.json');
    const json = await readJson(file);
    res.json({ ok: true, aseguradora: slug.toUpperCase(), parametros: json });
  } catch (err) {
    console.error('aseguradoras_params:generic:parametros', err);
    res.status(404).json({ ok: false, error: 'No se encontraron parámetros para la aseguradora' });
  }
});

// GET /aseguradoras/:slug/diccionarios/:nombre
// Ej: /aseguradoras/atm/diccionarios/uso            -> data/atm/diccionarios/uso.json
//     /aseguradoras/atm/diccionarios/tipo_vehiculo -> data/atm/diccionarios/tipo_vehiculo.json
router.get('/:slug/diccionarios/:nombre', async (req, res) => {
  try {
    const { slug, nombre } = req.params;
    const file = dataPath(slug, 'diccionarios', `${nombre}.json`);
    const json = await readJson(file);
    res.json({ ok: true, aseguradora: slug.toUpperCase(), diccionario: nombre, data: json });
  } catch (err) {
    console.error('aseguradoras_params:generic:diccionario', err);
    res.status(404).json({ ok: false, error: 'No se encontró el diccionario solicitado' });
  }
});

module.exports = router;

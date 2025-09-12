// backend/routes/cotizacion.js
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const ejecutarCotizacion = require('../scripts/ejecutarCotizacion');

const router = Router();

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * POST /cotizacion/iniciar
 * Body (JSON):
 * {
 *   "nombreProceso": "Prueba multicotización 1",
 *   "nombreCabecera": "Cabecera demo",
 *   "archivoCombinado": "combinado-1757679952790.xlsx",
 *   "aseguradoras": [1, 2, 5],
 *   "parametrosCabecera": { ... }
 * }
 */
router.post('/iniciar', async (req, res) => {
  try {
    const {
      nombreProceso,
      nombreCabecera,
      archivoCombinado,
      aseguradoras,
      parametrosCabecera = {},
    } = req.body || {};

    if (!nombreProceso || !archivoCombinado || !Array.isArray(aseguradoras) || aseguradoras.length === 0) {
      return res.status(400).json({
        error: 'Faltan parámetros',
        detalle: 'Requeridos: nombreProceso, archivoCombinado, aseguradoras[]; opcional: nombreCabecera, parametrosCabecera{}',
      });
    }

    // Validar que el archivo combinado exista en data/combinados
    const rutaCombinadoAbs = path.join(__dirname, '../../data/combinados', archivoCombinado);
    if (!fs.existsSync(rutaCombinadoAbs)) {
      return res.status(400).json({ error: 'archivoCombinado no existe en data/combinados' });
    }

    // Crear proceso en DB (MV)
    let insertId = null;
    try {
      const [result] = await db.execute(
        'INSERT INTO procesos_cotizacion (nombre, nombre_cabecera, estado) VALUES (?, ?, ?)',
        [nombreProceso, nombreCabecera || null, 'en curso']
      );
      insertId = result.insertId;
    } catch (e) {
      // Fallback mínimo
      const [result2] = await db.execute('INSERT INTO procesos_cotizacion (nombre) VALUES (?)', [nombreProceso]);
      insertId = result2.insertId;
    }

    // Estructura física del proceso
    const procesoDir = path.join(__dirname, '../../data/procesos', `proceso-${insertId}`);
    asegurarDir(procesoDir);
    asegurarDir(path.join(procesoDir, 'inputs'));
    asegurarDir(path.join(procesoDir, 'logs'));
    asegurarDir(path.join(procesoDir, 'resultados'));

    // Copiar insumo de entrada
    const inputDestino = path.join(procesoDir, 'inputs', archivoCombinado);
    if (!fs.existsSync(inputDestino)) {
      fs.copyFileSync(rutaCombinadoAbs, inputDestino);
    }

    // Guardar cabecera y aseguradoras seleccionadas
    fs.writeFileSync(path.join(procesoDir, 'cabecera.json'), JSON.stringify(parametrosCabecera, null, 2));
    fs.writeFileSync(path.join(procesoDir, 'aseguradoras.json'), JSON.stringify(aseguradoras, null, 2));
    fs.writeFileSync(path.join(procesoDir, 'estado.txt'), 'en curso');

    // Ejecutar proceso (no bloqueante para la respuesta HTTP)
    setImmediate(() => {
      ejecutarCotizacion({
        procesoId: insertId,
        procesoDir,
        archivoCombinado: inputDestino,
        aseguradoras,
        parametrosCabecera,
      }).catch((e) => {
        console.error(`[proceso ${insertId}] Error al ejecutar cotización:`, e);
      });
    });

    return res.json({
      ok: true,
      mensaje: 'Proceso de cotización iniciado',
      proceso: {
        id: insertId,
        nombre: nombreProceso,
        nombre_cabecera: nombreCabecera || null,
        estado: 'en curso',
        carpeta: `data/procesos/proceso-${insertId}`,
      },
    });
  } catch (error) {
    console.error('Error en /cotizacion/iniciar:', error);
    res.status(500).json({ error: 'Error al iniciar el proceso de cotización', detalle: error.message });
  }
});

/**
 * GET /cotizacion/estado/:id
 * Devuelve el estado del proceso + conteos básicos
 */
router.get('/estado/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  try {
    const [rows] = await db.execute(
      'SELECT id, nombre, nombre_cabecera, estado, fecha_inicio, fecha_fin, registros_procesados, cotizaciones_exitosas, cotizaciones_con_error FROM procesos_cotizacion WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'proceso no encontrado' });

    // Leer estado.txt si existe
    const procesoDir = path.join(__dirname, '../../data/procesos', `proceso-${id}`);
    let estadoTxt = null;
    try {
      estadoTxt = fs.readFileSync(path.join(procesoDir, 'estado.txt'), 'utf8');
    } catch {}

    return res.json({ db: rows[0], estado_txt: estadoTxt });
  } catch (error) {
    console.error('Error en /cotizacion/estado:', error);
    res.status(500).json({ error: 'Error al consultar el estado', detalle: error.message });
  }
});

/**
 * GET /cotizacion/listar
 * Query params opcionales:
 *   - estado: "en curso" | "completado" | "con errores"
 *   - limit: número (default 20, máx 100)
 *   - offset: número (default 0)
 * Ordena por fecha_inicio DESC (más recientes primero)
 */
router.get('/listar', async (req, res) => {
  try {
    const estado = (req.query.estado || '').toString().trim();
    let limit = Number(req.query.limit);
    let offset = Number(req.query.offset);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 100) limit = 100;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    // Sanitizar para incrustar como literales numéricos
    const lim = Math.max(1, Math.min(100, Math.floor(limit)));
    const off = Math.max(0, Math.floor(offset));

    // Filtro por estado (placeholder SOLO para estado)
    const params = [];
    let where = '';
    if (['en curso', 'completado', 'con errores'].includes(estado)) {
      where = 'WHERE estado = ?';
      params.push(estado);
    }

    // Conteo total
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM procesos_cotizacion ${where}`,
      params
    );
    const total = countRows[0]?.total || 0;

    // Listado: limit/offset como literales (evita el error de mysqld_stmt_execute)
    const sqlListado = `
      SELECT
        id, nombre, nombre_cabecera, estado,
        fecha_inicio, fecha_fin,
        registros_procesados, cotizaciones_exitosas, cotizaciones_con_error
      FROM procesos_cotizacion
      ${where}
      ORDER BY fecha_inicio DESC
      LIMIT ${lim} OFFSET ${off}
    `;
    const [rows] = await db.execute(sqlListado, params);

    return res.json({
      total,
      limit: lim,
      offset: off,
      items: rows,
    });
  } catch (error) {
    console.error('Error en /cotizacion/listar:', error);
    res.status(500).json({ error: 'Error al listar procesos', detalle: error.message });
  }
});

module.exports = router;

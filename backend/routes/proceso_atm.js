// backend/routes/proceso_atm.js
// Crear y ejecutar procesos de cotización masiva (ATM) reusando el histórico existente

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const db = require('../config/db'); // mysql2/promise pool

const router = express.Router();

// ---------- helpers ----------
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err?.message || stdout || 'exec error'));
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
async function rutaDesdeHistorial(id) {
  const [rows] = await db.execute(
    'SELECT ruta FROM historial_combinaciones WHERE id = ?',
    [id]
  );
  if (!rows.length) throw new Error('historial_id no encontrado');
  const rutaRel = rows[0].ruta;
  return path.isAbsolute(rutaRel) ? rutaRel : path.join(process.cwd(), rutaRel);
}

// Resuelve id de aseguradora por nombre o código; si no existe, la crea.
async function resolveAseguradoraId(nombreOCode) {
  if (!nombreOCode) throw new Error('Nombre/código de aseguradora vacío');
  const val = String(nombreOCode).trim();

  // 1) buscar por nombre o codigo (case-insensitive)
  const [found] = await db.execute(
    `SELECT id FROM aseguradoras
      WHERE LOWER(nombre) = LOWER(?) OR LOWER(codigo) = LOWER(?)
      LIMIT 1`,
    [val, val]
  );
  if (found.length) return found[0].id;

  // 2) crear (usa mismo valor como nombre y codigo si no hay uno estándar)
  const [ins] = await db.execute(
    `INSERT INTO aseguradoras (nombre, codigo, estado)
       VALUES (?, ?, 'activa')`,
    [val, val]
  );
  return ins.insertId;
}

// Inserta asociaciones proceso ↔ aseguradoras (por nombre); usa prioridad incremental
async function registrarCompanias(procesoId, companias = []) {
  if (!Array.isArray(companias) || !companias.length) return;

  let prio = 1;
  for (const cia of companias) {
    try {
      const aseguradoraId = await resolveAseguradoraId(cia);
      await db.execute(
        `INSERT INTO procesos_cotizacion_aseguradoras
           (proceso_id, aseguradora_id, prioridad, estado, creado_en, actualizado_en)
         VALUES (?, ?, ?, 'pendiente', NOW(), NOW())`,
        [procesoId, aseguradoraId, prio++]
      );
    } catch (e) {
      console.warn(`No se pudo registrar companias en procesos_cotizacion_aseguradoras: ${e.message}`);
    }
  }
}

// ---------- POST /proceso/atm/crear ----------
// Body JSON: { historial_id?: number, ruta?: string, nombre?: string, cabecera?: {...}, companias?: string[] }
router.post('/crear', express.json(), async (req, res) => {
  try {
    const { historial_id, ruta, nombre, cabecera, companias } = req.body || {};

    // 1) Resolver XLSX a usar
    let rutaXlsx = ruta || null;
    if (!rutaXlsx && historial_id != null) {
      rutaXlsx = await rutaDesdeHistorial(Number(historial_id));
    }
    if (!rutaXlsx) return res.status(400).json({ ok:false, error:'Debe indicar "historial_id" o "ruta" de un .xlsx combinado' });
    if (!fs.existsSync(rutaXlsx)) return res.status(404).json({ ok:false, error:'No existe el archivo combinado en disco', ruta: rutaXlsx });

    // 2) Carpetas RR / RES
    const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
    const rrDir  = path.join(process.cwd(), 'data', 'atm', 'rr',  stamp);
    const resDir = path.join(process.cwd(), 'data', 'atm', 'res', stamp);
    ensureDir(rrDir); ensureDir(resDir);

    // 3) Cabecera: persistir en tabla existente + JSON espejo (incluye "uso", aunque la tabla no lo tenga)
    let cabeceraId = null;
    try {
      const nombreCotizacion = cabecera?.nombreCotizacion || (nombre || 'ATM – Proceso UI');
      const edad            = cabecera?.edad ?? null;
      const fechaNacimiento = cabecera?.fechaNacimiento ?? null;
      const genero          = cabecera?.genero ?? null;
      const estadoCivil     = cabecera?.estadoCivil ?? null;
      const medioPago       = cabecera?.medioPago ?? null;

      const [ins] = await db.execute(
        `INSERT INTO cabeceras_cotizacion (nombreCotizacion, edad, fechaNacimiento, genero, estadoCivil, medioPago, fecha_alta)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [nombreCotizacion, edad, fechaNacimiento, genero, estadoCivil, medioPago]
      );
      cabeceraId = ins.insertId;

      const cabeceraJson = { ...cabecera, id: cabeceraId };
      fs.writeFileSync(path.join(resDir, 'cabecera.json'), JSON.stringify(cabeceraJson, null, 2));
    } catch (e) {
      console.warn('No se pudo registrar cabecera en tabla (se guarda solo JSON):', e.message);
      if (cabecera) {
        fs.writeFileSync(path.join(resDir, 'cabecera.json'), JSON.stringify(cabecera, null, 2));
      }
    }

    // 4) Guardar selección de compañías (informativo)
    if (Array.isArray(companias)) {
      fs.writeFileSync(path.join(resDir, 'companias.json'), JSON.stringify(companias, null, 2));
    }

    // 5) Crear proceso
    const nombreProceso = nombre || cabecera?.nombreCotizacion || 'ATM – Proceso UI';
    const [r] = await db.execute(
      `INSERT INTO procesos_cotizacion
         (nombre, fecha_inicio, estado, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados,
          nombre_cabecera, registros_procesados, cotizaciones_exitosas, cotizaciones_con_error)
       VALUES (?, NOW(), 'en curso', ?, ?, ?, ?, 0, 0, 0)`,
      [nombreProceso, rutaXlsx, rrDir, resDir, cabecera?.nombreCotizacion || null]
    );
    const procesoId = r.insertId;

    // 6) Registrar compañías (por nombre → aseguradora_id)
    if (Array.isArray(companias) && companias.length) {
      await registrarCompanias(procesoId, companias);
    }

    return res.json({
      ok: true,
      proceso_id: procesoId,
      cabecera_id: cabeceraId,
      ruta_xlsx: rutaXlsx.replace(/\\/g,'/'),
      rr_dir: rrDir.replace(/\\/g,'/'),
      res_dir: resDir.replace(/\\/g,'/')
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// ---------- POST /proceso/atm/ejecutar ----------
// Body JSON: { proceso_id:number, limit?:number, dryRun?:boolean }
router.post('/ejecutar', express.json(), async (req, res) => {
  try {
    const procesoId = Number(req.body?.proceso_id);
    const limit  = req.body?.limit != null ? Number(req.body.limit) : null;
    const dryRun = !!req.body?.dryRun;
    if (!Number.isFinite(procesoId)) return res.status(400).json({ ok:false, error:'Falta "proceso_id"' });

    // ENV para los procesos hijo (runner/export) → evita "using password: NO"
    const childEnv = {
      ...process.env,
      MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
      MYSQL_USER: process.env.MYSQL_USER || 'root',
      MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'pITU60073803',
      MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'autoiq'
    };

    // Ejecutar runner ATM
    const args = ['backend/scripts/atm_runner.js', `--proceso-id=${procesoId}`, `--dry-run=${dryRun ? 'true':'false'}`, '--verbose=true'];
    if (Number.isFinite(limit)) args.push(`--limit=${limit}`);
    const { stdout } = await execFileAsync('node', args, { cwd: process.cwd(), env: childEnv });

    // Export Excel dentro de la carpeta de resultados del proceso
    const [[proc]] = await db.execute(
      'SELECT carpeta_resultados FROM procesos_cotizacion WHERE id = ?',
      [procesoId]
    );
    const resDir = proc?.carpeta_resultados || path.join(process.cwd(), 'data', 'atm', 'res');
    ensureDir(resDir);

    const excelPath = path.join(resDir, `proceso_${procesoId}.xlsx`);
    await execFileAsync('node', ['backend/scripts/export_atm_excel.js', `--proceso-id=${procesoId}`, `--out=${excelPath}`], { cwd: process.cwd(), env: childEnv });

    // Marcar finalizado
    await db.execute(`UPDATE procesos_cotizacion SET estado='completado', fecha_fin=NOW() WHERE id=?`, [procesoId]);     

    return res.json({
      ok: true,
      proceso_id: procesoId,
      runner_summary: stdout.trim().split(/\r?\n/).slice(-1)[0] || 'runner ok',
      excel_path: excelPath.replace(/\\/g,'/')
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// ... arriba del archivo (no tocar)

// Inserta asociaciones proceso ↔ aseguradoras (por nombre); usa prioridad incremental
async function registrarCompanias(procesoId, companias = []) {
  if (!Array.isArray(companias) || !companias.length) return;

  let prio = 1;
  for (const cia of companias) {
    try {
      const aseguradoraId = await resolveAseguradoraId(cia);

      // 👇 LOG 1: ver qué aseguradora se resolvió
      console.log('[DEBUG][registrarCompanias] proceso', procesoId, 'cia', cia, '→ aseguradora_id', aseguradoraId, 'prio', prio);

      // 👇 LOG 2: confirmar que INSERT usa aseguradora_id, no "aseguradora"
      console.log('[DEBUG][SQL] INSERT procesos_cotizacion_aseguradoras (proceso_id, aseguradora_id, prioridad, estado) ...');

      await db.execute(
        `INSERT INTO procesos_cotizacion_aseguradoras
           (proceso_id, aseguradora_id, prioridad, estado, creado_en, actualizado_en)
         VALUES (?, ?, ?, 'pendiente', NOW(), NOW())`,
        [procesoId, aseguradoraId, prio++]
      );
    } catch (e) {
      console.warn(`No se pudo registrar companias en procesos_cotizacion_aseguradoras: ${e.message}`);
    }
  }
}

module.exports = router;

// backend/scripts/crearProceso.js
// Crea un proceso de cotización y su estructura en /data/procesos/proceso-{id}/
// - Inserta en procesos_cotizacion
// - Crea carpetas de trabajo y metadata.json
// - Devuelve { id, nombre, nombre_cabecera, estado, carpeta, subcarpetas }

const fs = require('fs');
const path = require('path');

// ---- slugify: fallback seguro + import opcional (UNA sola vez) ----
let slugify = (s) => String(s || '').replace(/\s+/g, '-').toLowerCase();
try {
  const imported = require('slugify');
  slugify = (typeof imported === 'function') ? imported : (imported?.default || slugify);
} catch (_) {
  // seguimos con el fallback
}

// ---- Conexión a DB (compatibilidad con tu estructura) ----
let db;
try {
  db = require('../config/db');
} catch (e1) {
  try {
    db = require('../db');
  } catch (e2) {
    throw new Error('[crearProceso] No se pudo cargar el módulo de DB (../config/db o ../db)');
  }
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

const DATA_ROOT = path.join(__dirname, '../../data');
const PROCESOS_ROOT = path.join(DATA_ROOT, 'procesos');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Crea un proceso de cotización
 * @param {{nombre:string, nombre_cabecera?:string|null}} payload
 * @returns {Promise<{id:number, nombre:string, nombre_cabecera:string|null, estado:string, carpeta:string, subcarpetas:string[]}>}
 */
async function crearProceso({ nombre, nombre_cabecera = null } = {}) {
  // --- Validaciones/normalización seguras ---
  const nombreStr = (typeof nombre === 'string') ? nombre.trim() : '';
  if (!nombreStr) throw new Error('Parámetro "nombre" debe ser un string no vacío');

  // slugify SIEMPRE con string
  const nombreSlug = slugify(String(nombreStr), { lower: true, strict: true, locale: 'es' });

  // --- Insert en DB ---
  const insertSql = `
    INSERT INTO procesos_cotizacion
      (nombre, nombre_cabecera, fecha_inicio, estado, registros_procesados, cotizaciones_exitosas, cotizaciones_con_error)
    VALUES
      (?, ?, NOW(), 'en curso', 0, 0, 0)
  `;
  const result = await query(insertSql, [nombreStr, nombre_cabecera || null]);
  const id = result.insertId;

  // --- Estructura de carpetas ---
  ensureDir(DATA_ROOT);
  ensureDir(PROCESOS_ROOT);

  // Convención actual usada por el front: proceso-{id}/
  const procesoDir = path.join(PROCESOS_ROOT, `proceso-${id}`);
  ensureDir(procesoDir);

  const subcarpetas = ['requests', 'responses', 'logs', 'descargas'];
  subcarpetas.forEach((s) => ensureDir(path.join(procesoDir, s)));

  // --- Metadata inicial ---
  const metadata = {
    id,
    nombre: nombreStr,
    nombre_slug: nombreSlug,
    nombre_cabecera: nombre_cabecera || null,
    creado: new Date().toISOString(),
    estado: 'en curso'
  };
  fs.writeFileSync(path.join(procesoDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // --- Respuesta ---
  return {
    id,
    nombre: nombreStr,
    nombre_cabecera: nombre_cabecera || null,
    estado: 'en curso',
    carpeta: `/data/procesos/proceso-${id}/`,
    subcarpetas
  };
}

module.exports = crearProceso;

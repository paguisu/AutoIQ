﻿// backend/server.js

const path = require('path');

// ✅ Cargar .env desde la raíz del proyecto ANTES de importar el resto
// antes require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const serveIndex = require('serve-index');
const {
  appendActivity,
  canViewSeguros911,
  getCurrentAccessContext,
  getHistorialOwner,
  getUserDisplayName,
  isOwnedByContext,
  setHistorialOwner,
} = require('./utils/access_control');

// Combinador (ruta robusta)
let combinarArchivos;
try {
  combinarArchivos = require('./scripts/combinador');
} catch {
  combinarArchivos = require('../scripts/combinador');
}

// DB (mysql2/promise pool)
const db = require('./config/db');

// Routers externos
const atmRouter = require('./services/atm/atm');
const cotizacionRouter = require('./routes/cotizacion');
const procesoRouter = require('./routes/proceso');
const cabecerasRouter = require('./routes/cabeceras'); // <— NUEVO
const commercialConditionsRouter = require('./routes/commercial_conditions');
const seguros911IntegrationRouter = require('./routes/seguros911_integration');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares básicos
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  req.accessContext = getCurrentAccessContext();
  next();
});

// Asegurar carpetas necesarias
const dirSubidos = path.join(__dirname, '../data/archivos_subidos');
const dirCombinados = path.join(__dirname, '../data/combinados');
const dirDescargas = path.join(__dirname, '../frontend/descargas');
const dirHistorialDetalle = path.join(__dirname, '../data/historial_detalle');
[dirSubidos, dirCombinados, dirDescargas, dirHistorialDetalle].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function historialDetallePath(id) {
  return path.join(dirHistorialDetalle, `historial-${Number(id)}.json`);
}

function saveHistorialDetalle(id, detail) {
  try {
    fs.writeFileSync(historialDetallePath(id), JSON.stringify(detail, null, 2), 'utf8');
  } catch (err) {
    console.warn(`No se pudo guardar historial_detalle ${id}:`, err?.message || err);
  }
}

function readHistorialDetalle(id) {
  try {
    const p = historialDetallePath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function buildHistorialInputsLabel(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const custom = String(detail.nombre_input || '').trim();
  if (custom) return custom;
  if (detail.tipo === 'combinatorio') {
    const veh = String(detail.archivo_vehiculos_original || '').trim();
    const cp = String(detail.archivo_cp_original || '').trim();
    if (veh || cp) return [veh, cp].filter(Boolean).join(' + ');
  }
  if (detail.tipo === 'taxativo') {
    return String(detail.archivo_unico_original || '').trim();
  }
  return '';
}

function classifyHistorialOrigin(row, detail) {
  const nombreArchivo = String(row?.nombre_archivo || '').trim().toLowerCase();
  const tipoDetalle = String(detail?.tipo || '').trim().toLowerCase();

  if (
    nombreArchivo.startsWith('cotizador-publico-') ||
    tipoDetalle === 'servicio_publico' ||
    tipoDetalle === 'cotizador_publico' ||
    tipoDetalle === 'seguros911'
  ) {
    return 'seguros911';
  }

  if (nombreArchivo.startsWith('combinado-') || tipoDetalle === 'combinatorio') {
    return 'masivo_combinatorio';
  }

  if (nombreArchivo.startsWith('taxativo-') || tipoDetalle === 'taxativo') {
    return 'masivo_taxativo';
  }

  return 'otro';
}

// Multer storage + fileFilter
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dirSubidos),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const extensionesValidas = ['.xlsx', '.csv'];
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!extensionesValidas.includes(ext)) {
      return cb(
        new multer.MulterError(
          'LIMIT_UNEXPECTED_FILE',
          `Extensión no permitida (${ext}). Solo .xlsx / .csv`
        )
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Servir frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Exponer /data con índice navegable
const dataRoot = path.join(__dirname, '../data');
app.use(
  '/data',
  express.static(dataRoot, { extensions: ['html'] }),
  serveIndex(dataRoot, { icons: true, view: 'details' })
);

// Intentar montar DNRPA si existe (opcional)
try {
  const dnrpaRouter = require('./routes/dnrpa');
  app.use('/dnrpa', dnrpaRouter);
} catch (e) {
  console.warn('DNRPA router no disponible (ok si no existe en esta rama):', e.message);
}

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Helper para elegir archivo por varios posibles names
function pickFile(filesArray, possibleNames) {
  if (!Array.isArray(filesArray)) return undefined;
  return filesArray.find((f) =>
    possibleNames.map((s) => s.toLowerCase()).includes(f.fieldname.toLowerCase())
  );
}

// Upload (combinatorio / taxativo)
app.post('/upload', upload.any(), async (req, res) => {
  const jsonResp = { mensajes: [], errores: [], descarga: null };

  try {
    const files = req.files || [];
    const nombreInput = String(req.body?.nombreInput || '').trim();

    const fileVeh = pickFile(files, ['archivoVehiculos', 'archivoVehiculo', 'vehiculos', 'vehiculo']);
    const fileCP = pickFile(files, ['archivoCP', 'codigosPostales', 'codigoPostal', 'cp']);
    const fileUnico = pickFile(files, ['archivoUnico', 'taxativo']);

    // Flujo combinatorio (2 archivos)
    if (fileVeh && fileCP) {
      const wbVeh = xlsx.readFile(fileVeh.path);
      const vehHojaNombre =
        wbVeh.SheetNames.find((name) => {
          const datos = xlsx.utils.sheet_to_json(wbVeh.Sheets[name], { defval: '' });
          return Array.isArray(datos) && datos.length > 0;
        }) || wbVeh.SheetNames[0];

      const wbCP = xlsx.readFile(fileCP.path);
      const cpHojaNombre =
        wbCP.SheetNames.find((name) => {
          const datos = xlsx.utils.sheet_to_json(wbCP.Sheets[name], { defval: '' });
          return Array.isArray(datos) && datos.length > 0;
        }) || wbCP.SheetNames[0];

      if (!vehHojaNombre) throw new Error('El archivo de vehículos no contiene hojas con datos');
      if (!cpHojaNombre) throw new Error('El archivo de códigos postales no contiene hojas con datos');

      let rowsVeh = xlsx.utils.sheet_to_json(wbVeh.Sheets[vehHojaNombre], { defval: '' });
      const rowsCP = xlsx.utils.sheet_to_json(wbCP.Sheets[cpHojaNombre], { defval: '' });

      let completadosUso = 0;
      let completadosTipo = 0;
      rowsVeh = rowsVeh.map((row) => {
        const r = { ...row };
        if (r.uso == null || r.uso === '') {
          r.uso = 'Particular';
          completadosUso++;
        }
        if (r.tipo_vehiculo == null || r.tipo_vehiculo === '') {
          r.tipo_vehiculo = 'Sedán';
          completadosTipo++;
        }
        return r;
      });

      const columnasVeh = Object.keys(rowsVeh[0] || {});
      const columnasCP = Object.keys(rowsCP[0] || {});
      const faltanVeh = validarColumnas('combinatoriaVehiculos', columnasVeh);
      const faltanCP = validarColumnas('combinatoriaCP', columnasCP);

      jsonResp.mensajes.push(
        `Columnas detectadas Vehículos: ${columnasVeh.join(', ') || '(ninguna)'}`
      );
      jsonResp.mensajes.push(
        `Columnas detectadas Códigos Postales: ${columnasCP.join(', ') || '(ninguna)'}`
      );

      if (faltanVeh.length > 0 || faltanCP.length > 0) {
        if (faltanVeh.length > 0)
          jsonResp.errores.push(`Faltan columnas Vehículos: ${faltanVeh.join(', ')}`);
        if (faltanCP.length > 0)
          jsonResp.errores.push(`Faltan columnas Códigos postales: ${faltanCP.join(', ')}`);
      } else {
        if (completadosUso > 0 || completadosTipo > 0) {
          jsonResp.mensajes.push(
            `Se completaron auto ${completadosUso} "uso" y ${completadosTipo} "tipo_vehiculo".`
          );
        }

        // Guardar archivo de vehículos ajustado
        const wsVehNew = xlsx.utils.json_to_sheet(rowsVeh);
        const wbVehNew = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, 'Sheet1');
        const vehPathFinal = fileVeh.path.replace(/\.xlsx$/i, '-ajustado.xlsx');
        xlsx.writeFile(wbVehNew, vehPathFinal);

        const nombreArchivo = `combinado-${Date.now()}.xlsx`;
        const rutaDestino = path.join(dirCombinados, nombreArchivo);
        const rutaPublica = path.join(dirDescargas, nombreArchivo);

        const totalCombinaciones = combinarArchivos(vehPathFinal, fileCP.path, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        const rutaRelativa = path.join('data', 'combinados', nombreArchivo).replace(/\\/g, '/');
        jsonResp.mensajes.push(`Archivo combinado generado: ${totalCombinaciones} registros.`);
        jsonResp.descarga = `/descargas/${nombreArchivo}`;

        const fecha = new Date();
        try {
          const [insertResult] = await db.execute(
            'INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros) VALUES (?, ?, ?, ?)',
            [nombreArchivo, rutaRelativa, fecha, totalCombinaciones]
          );
          if (insertResult?.insertId) {
            saveHistorialDetalle(insertResult.insertId, {
              tipo: 'combinatorio',
              nombre_input: nombreInput,
              archivo_generado: nombreArchivo,
              archivo_vehiculos_original: fileVeh.originalname || '',
              archivo_cp_original: fileCP.originalname || '',
              archivo_vehiculos_subido: path.basename(fileVeh.path || ''),
              archivo_cp_subido: path.basename(fileCP.path || ''),
            });
            const ctx = req.accessContext || getCurrentAccessContext();
            setHistorialOwner(insertResult.insertId, {
              organization_id: ctx.currentOrganization?.id || 'autoiq',
              user_id: ctx.currentUser?.id || 'superadmin-local',
            });
            appendActivity({
              event: 'upload_combined_file',
              entity_type: 'historial',
              entity_id: String(insertResult.insertId),
              details: {
                archivo: nombreArchivo,
                registros: totalCombinaciones,
              },
            });
          }
        } catch (e) {
          jsonResp.mensajes.push(`ℹ️ Nota: no se guardó en historial (${e.message})`);
        }
      }

      // Flujo taxativo (1 archivo)
    } else if (fileUnico) {
      const wb = xlsx.readFile(fileUnico.path);
      const hoja =
        wb.SheetNames.find((n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { defval: '' }).length > 0) ||
        wb.SheetNames[0];
      if (!hoja) throw new Error('El archivo no contiene hojas con datos');

      const rows = xlsx.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });
      const columnas = Object.keys(rows[0] || {});
      const faltan = validarColumnas('taxativa', columnas);

      jsonResp.mensajes.push(`Columnas detectadas: ${columnas.join(', ') || '(ninguna)'}`);

      if (faltan.length > 0) {
        jsonResp.errores.push(`Faltan columnas requeridas (taxativo): ${faltan.join(', ')}`);
      } else {
        const nombreArchivo = `taxativo-${Date.now()}.xlsx`;
        const rutaDestino = path.join(dirCombinados, nombreArchivo);
        const rutaPublica = path.join(dirDescargas, nombreArchivo);

        const ws = xlsx.utils.json_to_sheet(rows);
        const wbOut = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbOut, ws, 'Sheet1');
        xlsx.writeFile(wbOut, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        const rutaRelativa = path.join('data', 'combinados', nombreArchivo).replace(/\\/g, '/');

        const fecha = new Date();
        try {
          const [insertResult] = await db.execute(
            'INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros) VALUES (?, ?, ?, ?)',
            [nombreArchivo, rutaRelativa, fecha, rows.length]
          );
          if (insertResult?.insertId) {
            saveHistorialDetalle(insertResult.insertId, {
              tipo: 'taxativo',
              nombre_input: nombreInput,
              archivo_generado: nombreArchivo,
              archivo_unico_original: fileUnico.originalname || '',
              archivo_unico_subido: path.basename(fileUnico.path || ''),
            });
            const ctx = req.accessContext || getCurrentAccessContext();
            setHistorialOwner(insertResult.insertId, {
              organization_id: ctx.currentOrganization?.id || 'autoiq',
              user_id: ctx.currentUser?.id || 'superadmin-local',
            });
            appendActivity({
              event: 'upload_taxative_file',
              entity_type: 'historial',
              entity_id: String(insertResult.insertId),
              details: {
                archivo: nombreArchivo,
                registros: rows.length,
              },
            });
          }
        } catch (e) {
          jsonResp.mensajes.push(`ℹ️ Nota: no se guardó en historial (taxativo) (${e.message})`);
        }

        jsonResp.mensajes.push(`Archivo válido para modo taxativo con ${rows.length} registros.`);
        jsonResp.descarga = `/descargas/${nombreArchivo}`;
      }
    } else {
      jsonResp.errores.push('No se detectaron archivos válidos o faltan campos requeridos.');
    }
  } catch (error) {
    const msg =
      error instanceof multer.MulterError && error.field
        ? `Error de carga en "${error.field}": ${error.message}`
        : error.message;
    jsonResp.errores.push(`Error al procesar archivos: ${msg}`);
  }

  res.json(jsonResp);
});

// Historial
app.get('/historial', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, nombre_archivo, ruta, DATE_FORMAT(fecha, "%Y-%m-%d %H:%i:%s") AS fecha, cantidad_registros FROM historial_combinaciones ORDER BY fecha DESC'
    );
    const ctx = req.accessContext || getCurrentAccessContext();
    const out = rows.map((row) => {
      const owner = getHistorialOwner(row.id) || { organization_id: 'autoiq', user_id: 'superadmin-local' };
      const detail = readHistorialDetalle(row.id);
      const historial_origen = classifyHistorialOrigin(row, detail);
      return {
        ...row,
        owner,
        detail,
        historial_origen,
      };
    }).filter((row) => {
      if (!isOwnedByContext(row.owner, ctx)) return false;
      if (row.historial_origen === 'seguros911' && !canViewSeguros911(ctx)) return false;
      return true;
    }).map((row) => ({
      id: row.id,
      nombre_archivo: row.nombre_archivo,
      ruta: row.ruta,
      fecha: row.fecha,
      cantidad_registros: row.cantidad_registros,
      inputs: row.detail,
      inputs_label: buildHistorialInputsLabel(row.detail),
      historial_origen: row.historial_origen,
      es_cotizacion_webapp: row.historial_origen === 'seguros911',
      organization_id: row.owner.organization_id,
      user_id: row.owner.user_id,
    }));
    res.json(out);
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Health
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Montaje de routers
app.use('/atm', atmRouter);
app.use('/cotizacion', cotizacionRouter);
app.use('/proceso', procesoRouter);
app.use('/cabeceras', cabecerasRouter);
app.use('/commercial-conditions', commercialConditionsRouter);
app.use('/integration/seguros911', seguros911IntegrationRouter);

// ✅ Dejar una sola fuente de /aseguradoras (evita doble mount)
// app.use('/aseguradoras', require('./routes/aseguradoras'));
app.use('/aseguradoras', require('./routes/aseguradoras_params'))
app.use('/catalogos', require('./routes/catalogos'));
app.use('/admin', require('./routes/admin'));

app.use('/preprocesado', require('./routes/preprocesado'));

// Escucha
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;

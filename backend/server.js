// backend/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const db = require('./config/db');
const combinarArchivos = require('./scripts/combinador');
const validarColumnas = require('./utils/validarColumnas');

const multer = require('multer');

// ==== CONFIGURACIÓN MULTER ====
const UPLOAD_DIR = path.join(__dirname, '../data/archivos_subidos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const limits = {
  fileSize: parseInt(process.env.MAX_UPLOAD_MB || '25', 10) * 1024 * 1024,
  files: 3,
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.xlsx') return cb(null, true);
  return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Formato inválido: ${ext}. Solo se aceptan archivos .xlsx`));
};

const uploadXlsx = multer({ storage, fileFilter, limits });

function wrap(inner) {
  return `<html><body style="font-family:Arial,sans-serif;margin:24px;">${inner}</body></html>`;
}

function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const maxMb = Math.round(limits.fileSize / (1024 * 1024));
    let msg = 'Error al subir archivos.';
    if (err.code === 'LIMIT_FILE_SIZE') msg = `El archivo supera el límite de ${maxMb} MB.`;
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') msg = err.message || 'Archivo no permitido.';
    const html = `<h2>Resultado de la carga</h2><ul style="line-height:1.6">
      <li style="color:red;">❌ ${msg}</li>
    </ul><a href="/" style="display:inline-block;margin-top:20px;">🔙 Volver al inicio</a>`;
    return res.status(400).send(wrap(html));
  }
  next(err);
}

// ==== EXPRESS ====
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Reemplazar función leerHoja por esta versión
function leerHoja(ruta) {
  const wb = xlsx.readFile(ruta);

  // Elegir la primera hoja con contenido
  const hoja = wb.SheetNames.find((name) => {
    const ws = wb.Sheets[name];
    const rowsA1 = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    return rowsA1 && rowsA1.length > 0;
  });
  if (!hoja) throw new Error('El archivo no contiene hojas con datos');

  const ws = wb.Sheets[hoja];

  // 1) Tomamos los ENCABEZADOS directamente (no desde la primera fila de datos)
  const rowsA1 = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
  // Buscamos la primera fila que tenga al menos una celda no vacía como encabezado
  const headerRow = rowsA1.find(r => Array.isArray(r) && r.some(v => (v !== null && String(v).trim() !== '')));
  const cols = (headerRow || []).map(v => String(v ?? '').trim()).filter(Boolean);

  // 2) Cargamos las filas como objetos manteniendo columnas aunque estén vacías
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null, blankrows: false });

  return { rows, cols, hoja };
}

app.post(
  '/upload',
  uploadXlsx.fields([
    { name: 'archivoVehiculos', maxCount: 1 },
    { name: 'archivoCP', maxCount: 1 },
    { name: 'archivoUnico', maxCount: 1 },
  ]),
  async (req, res) => {
    let html = '<h2>Resultado de la carga</h2><ul style="line-height:1.6">';
    try {
      const tieneCombinatorio = req.files?.archivoVehiculos && req.files?.archivoCP;
      const tieneTaxativo = req.files?.archivoUnico;

      if (!tieneCombinatorio && !tieneTaxativo) {
        html += '<li style="color:red;">⚠️ No se detectaron archivos válidos.</li>';
        return res.send(wrap(html));
      }

      if (tieneCombinatorio) {
        const vehRuta = req.files.archivoVehiculos[0].path;
        const cpRuta = req.files.archivoCP[0].path;

        const veh = leerHoja(vehRuta);
        const cp = leerHoja(cpRuta);

        const faltanVeh = validarColumnas('combinatoriaVehiculos', veh.cols);
        const faltanCP = validarColumnas('combinatoriaCP', cp.cols);

        if (faltanVeh.length || faltanCP.length) {
          html += '<li style="color:red;">❌ Faltan columnas requeridas:</li><ul>';
          if (faltanVeh.length) html += `<li>Vehículos: ${faltanVeh.join(', ')}</li>`;
          if (faltanCP.length) html += `<li>Códigos postales: ${faltanCP.join(', ')}</li>`;
          html += '</ul><li>👉 El nombre del archivo es libre; lo importante son los encabezados internos.</li>';
          return res.send(wrap(html));
        }

        let completadosUso = 0;
        let completadosTipo = 0;
        let completadosSuma = 0;

        const vehRowsAjustadas = veh.rows.map((r) => {
          const row = { ...r };
          if (!row.uso) { row.uso = 'Particular'; completadosUso++; }
          if (!row.tipo_vehiculo) { row.tipo_vehiculo = 'Sedán'; completadosTipo++; }
          if (!row.suma) { row.suma = 0; completadosSuma++; }
          return row;
        });

        const wbVehNew = xlsx.utils.book_new();
        const wsVehNew = xlsx.utils.json_to_sheet(vehRowsAjustadas);
        xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, 'Sheet1');
        const vehAjustado = vehRuta.replace(/\.xlsx$/i, '-ajustado.xlsx');
        xlsx.writeFile(wbVehNew, vehAjustado);

        const nombreArchivo = `combinado-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, '../data/combinados', nombreArchivo);
        const rutaPublica = path.join(__dirname, '../frontend/descargas', nombreArchivo);

        const total = combinarArchivos(vehAjustado, cpRuta, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        const fecha = new Date();
        await db.execute(
          'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
          [nombreArchivo, fecha, total]
        );

        html += `<li>✅ Modo: <strong>Combinatorio</strong></li>`;
        html += `<li>📄 Archivo generado: <strong>${nombreArchivo}</strong></li>`;
        html += `<li>🧮 Registros: <strong>${total}</strong></li>`;
        if (completadosUso || completadosTipo || completadosSuma) {
          html += `<li style="color:orange;">⚠️ Completados por defecto → Uso: ${completadosUso}, Tipo: ${completadosTipo}, Suma: ${completadosSuma}.</li>`;
        }
        html += `<li><a href="/descargas/${nombreArchivo}" download>⬇️ Descargar</a></li>`;
      } else {
        const unico = req.files.archivoUnico[0];
        const uno = leerHoja(unico.path);
        const faltanUnico = validarColumnas('taxativa', uno.cols);

        if (faltanUnico.length) {
          html += '<li style="color:red;">❌ Faltan columnas requeridas en el archivo único:</li>';
          html += `<ul><li>${faltanUnico.join(', ')}</li></ul>`;
          return res.send(wrap(html));
        }

        html += `<li>✅ Modo: <strong>Taxativo</strong>.</li>`;
        html += `<li>📄 Archivo recibido: <strong>${path.basename(unico.path)}</strong></li>`;
      }
    } catch (err) {
      console.error('Error en /upload:', err);
      html += `<li style="color:red;">❌ Error al procesar: ${err.message}</li>`;
    }

    html += '</ul>';
    res.send(wrap(html));
  }
);

app.get('/historial', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, nombre_archivo, DATE_FORMAT(fecha, "%Y-%m-%d %H:%i:%s") AS fecha, cantidad_registros FROM historial_combinaciones ORDER BY fecha DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

app.use(multerErrorHandler);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

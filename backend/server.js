const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const serveIndex = require('serve-index'); // âœ… agregado

// Combinador (ruta robusta)
let combinarArchivos;
try {
  combinarArchivos = require('./scripts/combinador');
} catch {
  combinarArchivos = require('../scripts/combinador');
}

// DB (mysql2/promise pool)
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares bÃ¡sicos
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Asegurar carpetas necesarias
const dirSubidos = path.join(__dirname, '../data/archivos_subidos');
const dirCombinados = path.join(__dirname, '../data/combinados');
const dirDescargas = path.join(__dirname, '../frontend/descargas');
[dirSubidos, dirCombinados, dirDescargas].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Multer storage + fileFilter con extensiones vÃ¡lidas
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
          `ExtensiÃ³n no permitida (${ext}). Solo .xlsx / .csv`
        )
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Servir frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// âœ… Exponer /data y listar directorios
const dataRoot = path.join(__dirname, '../data');
app.use(
  '/data',
  express.static(dataRoot, { extensions: ['html'] }),
  serveIndex(dataRoot, { icons: true, view: 'details' })
);

// Router DNRPA (si existe)
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

// Helper para encontrar archivos por varios posibles names
function pickFile(filesArray, possibleNames) {
  if (!Array.isArray(filesArray)) return undefined;
  return filesArray.find((f) =>
    possibleNames.map((s) => s.toLowerCase()).includes(f.fieldname.toLowerCase())
  );
}

// Upload (combinatorio / taxativo)
app.post('/upload', upload.any(), async (req, res) => {
  let mensaje = '<h2>Resultado de la carga</h2><ul>';

  try {
    const files = req.files || [];

    const fileVeh = pickFile(files, ['archivoVehiculos', 'archivoVehiculo', 'vehiculos', 'vehiculo']);
    const fileCP = pickFile(files, ['archivoCP', 'codigosPostales', 'codigoPostal', 'cp']);
    const fileUnico = pickFile(files, ['archivoUnico', 'taxativo']);

    // --- Flujo combinatorio (2 archivos) ---
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

      if (!vehHojaNombre) throw new Error('El archivo de vehÃ­culos no contiene hojas con datos');
      if (!cpHojaNombre) throw new Error('El archivo de cÃ³digos postales no contiene hojas con datos');

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
          r.tipo_vehiculo = 'SedÃ¡n';
          completadosTipo++;
        }
        return r;
      });

      const columnasVeh = Object.keys(rowsVeh[0] || {});
      const columnasCP = Object.keys(rowsCP[0] || {});
      const faltanVeh = validarColumnas('combinatoriaVehiculos', columnasVeh);
      const faltanCP = validarColumnas('combinatoriaCP', columnasCP);

      mensaje += `<li><strong>Columnas detectadas en archivo de vehÃ­culos:</strong> ${columnasVeh.join(', ') || '(ninguna)'}</li>`;
      mensaje += `<li><strong>Columnas detectadas en archivo de cÃ³digos postales:</strong> ${columnasCP.join(', ') || '(ninguna)'}</li>`;

      if (faltanVeh.length > 0 || faltanCP.length > 0) {
        mensaje += '<li style="color:red;">âŒ Error: Faltan columnas requeridas:</li><ul>';
        if (faltanVeh.length > 0) mensaje += `<li>VehÃ­culos: ${faltanVeh.join(', ')}</li>`;
        if (faltanCP.length > 0) mensaje += `<li>CÃ³digos postales: ${faltanCP.join(', ')}</li>`;
        mensaje += '</ul>';
      } else {
        mensaje += `<li>âœ… VehÃ­culos: ${rowsVeh.length} registros vÃ¡lidos</li>`;
        mensaje += `<li>âœ… CÃ³digos postales: ${rowsCP.length} registros vÃ¡lidos</li>`;

        if (completadosUso > 0 || completadosTipo > 0) {
          mensaje += `<li style="color:orange;">âš ï¸ Se completaron automÃ¡ticamente ${completadosUso} "uso" y ${completadosTipo} "tipo_vehiculo".</li>`;
        }

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

        mensaje += `<li>ðŸ“„ Archivo combinado generado con <strong>${totalCombinaciones}</strong> registros.</li>`;
        mensaje += `<li><a href="/descargas/${nombreArchivo}" download style="display:inline-block;margin-top:10px;">â¬‡ï¸ Descargar archivo combinado</a></li>`;

        const fecha = new Date();
        try {
          await db.execute(
            'INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros) VALUES (?, ?, ?, ?)',
            [nombreArchivo, rutaRelativa, fecha, totalCombinaciones]
          );
        } catch (e) {
          console.error('No se pudo guardar historial:', e.message);
          mensaje += `<li style="color:#b8860b;">â„¹ï¸ Nota: no se guardÃ³ en historial (${e.message})</li>`;
        }
      }

      // --- Flujo taxativo (1 archivo) ---
    } else if (fileUnico) {
      const wb = xlsx.readFile(fileUnico.path);
      const hoja =
        wb.SheetNames.find((n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { defval: '' }).length > 0) ||
        wb.SheetNames[0];
      if (!hoja) throw new Error('El archivo no contiene hojas con datos');

      const rows = xlsx.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });
      const columnas = Object.keys(rows[0] || {});
      const faltan = validarColumnas('taxativa', columnas);

      mensaje += `<li><strong>Columnas detectadas:</strong> ${columnas.join(', ') || '(ninguna)'}</li>`;

      if (faltan.length > 0) {
        mensaje += `<li style="color:red;">âŒ Faltan columnas requeridas (taxativo): ${faltan.join(', ')}</li>`;
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
          await db.execute(
            'INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros) VALUES (?, ?, ?, ?)',
            [nombreArchivo, rutaRelativa, fecha, rows.length]
          );
        } catch (e) {
          console.error('No se pudo guardar historial (taxativo):', e.message);
          mensaje += `<li style="color:#b8860b;">â„¹ï¸ Nota: no se guardÃ³ en historial (taxativo) (${e.message})</li>`;
        }

        mensaje += `<li>âœ… Archivo vÃ¡lido para modo taxativo con ${rows.length} registros.</li>`;
        mensaje += `<li><a href="/descargas/${nombreArchivo}" download style="display:inline-block;margin-top:10px;">â¬‡ï¸ Descargar archivo taxativo</a></li>`;
      }

    } else {
      mensaje += '<li style="color:red;">âš ï¸ No se detectaron archivos vÃ¡lidos o faltan campos requeridos.</li>';
    }
  } catch (error) {
    const msg =
      error instanceof multer.MulterError && error.field
        ? `Error de carga en "${error.field}": ${error.message}`
        : error.message;
    mensaje += `<li style="color:red;">âŒ Error al procesar archivos: ${msg}</li>`;
  }

  mensaje += '</ul><a href="/" style="display:inline-block;margin-top:20px;">ðŸ”™ Volver al inicio</a>';
  res.send(`<html><body style="font-family:Arial,sans-serif;">${mensaje}</body></html>`);
});

// Historial
app.get('/historial', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, nombre_archivo, ruta, DATE_FORMAT(fecha, "%Y-%m-%d %H:%i:%s") AS fecha, cantidad_registros FROM historial_combinaciones ORDER BY fecha DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Router de cotizaciÃ³n
const cotizacionRouter = require('./routes/cotizacion');
const procesoRouter = require('./routes/proceso');
app.use('/cotizacion', cotizacionRouter);
app.use('/proceso', procesoRouter);

// âœ… NUEVO endpoint de health
app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok" });
});

// âœ… Proteger el app.listen y exportar app
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

//registro la ruta de atm
const atmRouter = require('./services/atm/atm');
app.use('/atm', atmRouter);

module.exports = app;

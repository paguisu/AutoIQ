// ============================
// Importación de módulos
// ============================
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const combinarArchivos = require('./scripts/combinador');
const db = require('./config/db');

// ============================
// Configuración de servidor
// ============================
const app = express();
const PORT = process.env.PORT || 3000;

// ============================
// Configuración de Multer (carga de archivos)
// ============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../data/archivos_subidos')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ============================
// Servir frontend estático
// ============================
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================
// Endpoint principal de carga y procesamiento de archivos
// ============================
app.post('/upload', upload.fields([
  { name: 'archivoVehiculos', maxCount: 1 },
  { name: 'archivoCP', maxCount: 1 },
  { name: 'archivoUnico', maxCount: 1 }
]), async (req, res) => {
  let mensaje = '<h2>Resultado de la carga</h2><ul>';
  try {

    // -------------------------------------------------
    // MODO COMBINATORIO: archivoVehiculos + archivoCP
    // -------------------------------------------------
    if (req.files.archivoVehiculos && req.files.archivoCP) {
      const fileVeh = req.files.archivoVehiculos[0];
      const fileCP = req.files.archivoCP[0];

      // Leer y convertir a JSON
      const wbVeh = xlsx.readFile(fileVeh.path);
      const hojaVeh = wbVeh.SheetNames[0];
      let rowsVeh = xlsx.utils.sheet_to_json(wbVeh.Sheets[hojaVeh]);

      const wbCP = xlsx.readFile(fileCP.path);
      const hojaCP = wbCP.SheetNames[0];
      const rowsCP = xlsx.utils.sheet_to_json(wbCP.Sheets[hojaCP]);

      // Completar valores por defecto si faltan
      let completadosUso = 0, completadosTipo = 0;
      rowsVeh = rowsVeh.map(r => {
        if (!r.uso) { r.uso = "Particular"; completadosUso++; }
        if (!r.tipo_vehiculo) { r.tipo_vehiculo = "Sedán"; completadosTipo++; }
        return r;
      });

      // Validar columnas requeridas
      const columnasVeh = Object.keys(rowsVeh[0] || {});
      const columnasCP = Object.keys(rowsCP[0] || {});
      const faltanVeh = validarColumnas("combinatoriaVehiculos", columnasVeh);
      const faltanCP = validarColumnas("combinatoriaCP", columnasCP);

      // Reportar columnas encontradas
      mensaje += `<li>Columnas archivo vehículos: ${columnasVeh.join(", ")}</li>`;
      mensaje += `<li>Columnas archivo códigos postales: ${columnasCP.join(", ")}</li>`;

      // Si faltan columnas, mostrar error
      if (faltanVeh.length || faltanCP.length) {
        mensaje += `<li style="color:red;">Error: Faltan columnas.</li>`;
        if (faltanVeh.length) mensaje += `<li>Vehículos: ${faltanVeh.join(", ")}</li>`;
        if (faltanCP.length) mensaje += `<li>Códigos postales: ${faltanCP.join(", ")}</li>`;
      } else {
        // Guardar archivo de vehículos ajustado
        const vehPathFinal = fileVeh.path.replace(/\.xlsx$/i, '-ajustado.xlsx');
        const wsVeh = xlsx.utils.json_to_sheet(rowsVeh);
        const wbVehNuevo = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbVehNuevo, wsVeh, "Sheet1");
        xlsx.writeFile(wbVehNuevo, vehPathFinal);

        // Generar archivo combinado
        const nombreArchivo = `combinado-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, '../data/combinados', nombreArchivo);
        const rutaPublica = path.join(__dirname, '../frontend/descargas', nombreArchivo);

        const total = combinarArchivos(vehPathFinal, fileCP.path, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        // Registrar en historial
        await db.execute(
          'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
          [nombreArchivo, new Date(), total]
        );

        // Mensajes finales
        mensaje += `<li>Archivo combinado generado con ${total} registros.</li>`;
        mensaje += `<li><a href="/descargas/${nombreArchivo}" download>⬇️ Descargar archivo combinado</a></li>`;
        if (completadosUso || completadosTipo) {
          mensaje += `<li>Se completaron ${completadosUso} "uso" y ${completadosTipo} "tipo_vehiculo".</li>`;
        }
      }

    // -------------------------------------------------
    // MODO TAXATIVO: archivoUnico
    // -------------------------------------------------
    } else if (req.files.archivoUnico) {
      const fileUnico = req.files.archivoUnico[0];

      // Leer y convertir a JSON
      const wb = xlsx.readFile(fileUnico.path);
      const hoja = wb.SheetNames[0];
      let rows = xlsx.utils.sheet_to_json(wb.Sheets[hoja]);

      // Completar valores por defecto si faltan
      let completadosUso = 0, completadosTipo = 0;
      rows = rows.map(r => {
        if (!r.uso) { r.uso = "Particular"; completadosUso++; }
        if (!r.tipo_vehiculo) { r.tipo_vehiculo = "Sedán"; completadosTipo++; }
        return r;
      });

      // Validar columnas requeridas
      const columnas = Object.keys(rows[0] || {});
      const faltan = validarColumnas("taxativa", columnas);

      mensaje += `<li>Columnas archivo único: ${columnas.join(", ")}</li>`;

      if (faltan.length) {
        mensaje += `<li style="color:red;">Error: Faltan columnas: ${faltan.join(", ")}</li>`;
      } else {
        // Guardar archivo taxativo ajustado
        const nombreArchivo = `taxativo-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, '../data/combinados', nombreArchivo);
        const rutaPublica = path.join(__dirname, '../frontend/descargas', nombreArchivo);

        const ws = xlsx.utils.json_to_sheet(rows);
        const wbNuevo = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbNuevo, ws, "Sheet1");
        xlsx.writeFile(wbNuevo, rutaDestino);

        fs.copyFileSync(rutaDestino, rutaPublica);

        // Registrar en historial
        await db.execute(
          'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
          [nombreArchivo, new Date(), rows.length]
        );

        // Mensajes finales
        mensaje += `<li>Archivo taxativo generado con ${rows.length} registros.</li>`;
        mensaje += `<li><a href="/descargas/${nombreArchivo}" download>⬇️ Descargar archivo taxativo</a></li>`;
        if (completadosUso || completadosTipo) {
          mensaje += `<li>Se completaron ${completadosUso} "uso" y ${completadosTipo} "tipo_vehiculo".</li>`;
        }
      }

    // -------------------------------------------------
    // SIN ARCHIVOS VÁLIDOS
    // -------------------------------------------------
    } else {
      mensaje += `<li style="color:red;">No se detectaron archivos válidos.</li>`;
    }

  } catch (err) {
    mensaje += `<li style="color:red;">Error: ${err.message}</li>`;
  }
  mensaje += '</ul><a href="/">Volver</a>';
  res.send(mensaje);
});

// ============================
// Endpoint para ver historial
// ============================
app.get('/historial', async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM historial_combinaciones ORDER BY fecha DESC');
  res.json(rows);
});

// ============================
// Iniciar servidor
// ============================
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));

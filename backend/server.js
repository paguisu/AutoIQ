const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const completarTipoVehiculo = require('./utils/inferencias');
const combinarArchivos = require('../scripts/combinador');
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

const rutaFrontend = path.join(__dirname, '../frontend');
const rutaArchivosSubidos = path.join(__dirname, '../data/archivos_subidos');
const rutaCombinados = path.join(__dirname, '../data/combinados');
const rutaDescargas = path.join(__dirname, '../frontend/descargas');

if (!fs.existsSync(rutaArchivosSubidos)) fs.mkdirSync(rutaArchivosSubidos, { recursive: true });
if (!fs.existsSync(rutaCombinados)) fs.mkdirSync(rutaCombinados, { recursive: true });
if (!fs.existsSync(rutaDescargas)) fs.mkdirSync(rutaDescargas, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, rutaArchivosSubidos),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });
app.use(express.static(rutaFrontend));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(rutaFrontend, 'index.html'));
});

app.post('/guardar-cabecera', async (req, res) => {
  const { nombreCotizacion, edad, fechaNacimiento, genero, estadoCivil, medioPago } = req.body;
  try {
    await db.execute(
      `INSERT INTO cabeceras_cotizacion (nombreCotizacion, edad, fechaNacimiento, genero, estadoCivil, medioPago)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombreCotizacion, edad, fechaNacimiento, genero, estadoCivil, medioPago]
    );
    res.json({ message: "Cabecera guardada correctamente" });
  } catch (error) {
    console.error("Error al guardar cabecera:", error);
    res.status(500).json({ message: "Error al guardar la cabecera" });
  }
});

app.get('/cabeceras', async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM cabeceras_cotizacion ORDER BY fecha_alta DESC");
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener cabeceras:", err);
    res.status(500).json({ message: "Error al obtener cabeceras" });
  }
});

app.get('/cotizar/:idCabecera', async (req, res) => {
  const { idCabecera } = req.params;
  try {
    const [rows] = await db.execute("SELECT * FROM cabeceras_cotizacion WHERE id = ?", [idCabecera]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Cabecera no encontrada" });
    }
    const cabecera = rows[0];
    res.json({ message: "Cotización lanzada", cabecera });
  } catch (err) {
    console.error("Error al lanzar cotización:", err);
    res.status(500).json({ message: "Error al lanzar cotización" });
  }
});

app.get('/basepropia', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT infoautocod, Marca, Modelo, tipo_vehiculo, puertas, ocupantes, peso, combustible, motorizacion, Tipo_Vehiculo_Rivadavia, DATE_FORMAT(fecha_alta, "%Y-%m-%d") as fecha FROM datos_vehiculos_propios ORDER BY fecha_alta DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener base propia:', error);
    res.status(500).json({ error: 'Error al obtener base de datos interna' });
  }
});

app.get('/historial', async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM historial_combinaciones ORDER BY fecha DESC");
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener historial:", err);
    res.status(500).json({ message: "Error al obtener historial" });
  }
});

app.post('/upload', upload.fields([
  { name: 'archivoVehiculos', maxCount: 1 },
  { name: 'archivoCP', maxCount: 1 },
  { name: 'archivoUnico', maxCount: 1 }
]), async (req, res) => {
  let mensaje = '<h2>Resultado de la carga</h2><ul>';
  try {
    const fileVeh = req.files.archivoVehiculos?.[0];
    const fileCP = req.files.archivoCP?.[0];
    const fileUnico = req.files.archivoUnico?.[0];

    if (fileVeh && fileCP) {
      const wbVeh = xlsx.readFile(fileVeh.path);
      const wsVeh = wbVeh.Sheets[wbVeh.SheetNames[0]];
      let rowsVeh = xlsx.utils.sheet_to_json(wsVeh);

      for (let row of rowsVeh) {
        if (!row.tipo_vehiculo) {
          const tipo = await completarTipoVehiculo(row);
          row.tipo_vehiculo = tipo;
        }
      }

      const wbCP = xlsx.readFile(fileCP.path);
      const wsCP = wbCP.Sheets[wbCP.SheetNames[0]];
      const rowsCP = xlsx.utils.sheet_to_json(wsCP);

      const vehPath = fileVeh.path.replace('.xlsx', '-completado.xlsx');
      const wsVehNuevo = xlsx.utils.json_to_sheet(rowsVeh);
      const wbVehNuevo = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wbVehNuevo, wsVehNuevo, 'Sheet1');
      xlsx.writeFile(wbVehNuevo, vehPath);

      const nombreArchivo = `combinado-${Date.now()}.xlsx`;
      const rutaDestino = path.join(rutaCombinados, nombreArchivo);
      const rutaPublica = path.join(rutaDescargas, nombreArchivo);
      const totalCombinaciones = combinarArchivos(vehPath, fileCP.path, rutaDestino);
      fs.copyFileSync(rutaDestino, rutaPublica);

      mensaje += `<li>Archivo combinado generado con <strong>${totalCombinaciones}</strong> registros.</li>`;
      mensaje += `<li><a href=\"/descargas/${nombreArchivo}\" download>Descargar archivo combinado</a></li>`;

      const fecha = new Date();
      await db.execute(
        'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
        [nombreArchivo, fecha, totalCombinaciones]
      );

    } else if (fileUnico) {
      const wbUnico = xlsx.readFile(fileUnico.path);
      const wsUnico = wbUnico.Sheets[wbUnico.SheetNames[0]];
      let rows = xlsx.utils.sheet_to_json(wsUnico);

      for (let row of rows) {
        if (!row.tipo_vehiculo) {
          const tipo = await completarTipoVehiculo(row);
          row.tipo_vehiculo = tipo;
        }
      }

      const nombreArchivo = `taxativo-${Date.now()}.xlsx`;
      const rutaFinal = path.join(rutaDescargas, nombreArchivo);
      const wsFinal = xlsx.utils.json_to_sheet(rows);
      const wbFinal = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wbFinal, wsFinal, 'Sheet1');
      xlsx.writeFile(wbFinal, rutaFinal);

      mensaje += `<li>Archivo procesado con <strong>${rows.length}</strong> registros.</li>`;
      mensaje += `<li><a href=\"/descargas/${nombreArchivo}\" download>Descargar archivo procesado</a></li>`;

      const fecha = new Date();
      await db.execute(
        'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
        [nombreArchivo, fecha, rows.length]
      );
    } else {
      mensaje += '<li>No se detectaron archivos válidos para procesar.</li>';
    }
  } catch (error) {
    mensaje += `<li style=\"color:red;\">Error: ${error.message}</li>`;
  }

  mensaje += '</ul><a href=\"/\">Volver al inicio</a>';
  res.send(`<html><body style=\"font-family:Arial,sans-serif;\">${mensaje}</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

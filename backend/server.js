const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const combinarArchivos = require('../scripts/combinador');
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

const rutaSubidos = path.join(__dirname, '../data/archivos_subidos');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, rutaSubidos);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });
app.use(express.static('frontend'));
app.use('/descargas', express.static(path.join(__dirname, '../frontend/descargas')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.post('/upload', upload.fields([
  { name: 'archivoVehiculos', maxCount: 1 },
  { name: 'archivoCP', maxCount: 1 },
  { name: 'archivoUnico', maxCount: 1 }
]), async (req, res) => {
  let resultado = { errores: [], mensajes: [], descarga: null };
  try {
    if (req.files.archivoVehiculos && req.files.archivoCP) {
      const fileVeh = req.files.archivoVehiculos[0];
      const fileCP = req.files.archivoCP[0];

      const wbVeh = xlsx.readFile(fileVeh.path);
      const vehHojaNombre = wbVeh.SheetNames.find(name => xlsx.utils.sheet_to_json(wbVeh.Sheets[name], { defval: '' }).length > 0);
      const wbCP = xlsx.readFile(fileCP.path);
      const cpHojaNombre = wbCP.SheetNames.find(name => xlsx.utils.sheet_to_json(wbCP.Sheets[name], { defval: '' }).length > 0);

      if (!vehHojaNombre) throw new Error("El archivo de vehículos no contiene datos");
      if (!cpHojaNombre) throw new Error("El archivo de códigos postales no contiene datos");

      const rowsVehOriginal = xlsx.utils.sheet_to_json(wbVeh.Sheets[vehHojaNombre], { defval: '' });
      const rowsCP = xlsx.utils.sheet_to_json(wbCP.Sheets[cpHojaNombre], { defval: '' });

      const columnasVeh = Object.keys(rowsVehOriginal[0] || {});
      const columnasCP = Object.keys(rowsCP[0] || {});

      const faltanVeh = validarColumnas("combinatoriaVehiculos", columnasVeh);
      const faltanCP = validarColumnas("combinatoriaCP", columnasCP);

      resultado.mensajes.push(`Columnas detectadas en archivo de vehículos: ${columnasVeh.join(", ")}`);
      resultado.mensajes.push(`Columnas detectadas en archivo de códigos postales: ${columnasCP.join(", ")}`);

      if (faltanVeh.length > 0 || faltanCP.length > 0) {
        if (faltanVeh.length > 0) resultado.errores.push(`Vehículos: ${faltanVeh.join(", ")}`);
        if (faltanCP.length > 0) resultado.errores.push(`Códigos postales: ${faltanCP.join(", ")}`);
      } else {
        const rowsVeh = rowsVehOriginal.map(row => ({
          ...row,
          uso: row.uso || "Particular",
          tipo_vehiculo: row.tipo_vehiculo || "Sedán"
        }));

        resultado.mensajes.push(`Vehículos: ${rowsVeh.length} registros válidos`);
        resultado.mensajes.push(`Códigos postales: ${rowsCP.length} registros válidos`);

        const wsVehNew = xlsx.utils.json_to_sheet(rowsVeh);
        const wbVehNew = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, "Sheet1");
        const vehPathFinal = fileVeh.path.replace(".xlsx", "-ajustado.xlsx");
        xlsx.writeFile(wbVehNew, vehPathFinal);

        const nombreArchivo = `combinado-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, '../data/combinados', nombreArchivo);
        const rutaPublica = path.join(__dirname, '../frontend/descargas', nombreArchivo);
        const totalCombinaciones = combinarArchivos(vehPathFinal, fileCP.path, rutaDestino);

        fs.copyFileSync(rutaDestino, rutaPublica);
        resultado.mensajes.push(`Archivo combinado generado con ${totalCombinaciones} registros.`);
        resultado.descarga = `/descargas/${nombreArchivo}`;

        const fecha = new Date();
        await db.execute(
          'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
          [nombreArchivo, fecha, totalCombinaciones]
        );
      }
    } else {
      resultado.errores.push("No se detectaron archivos válidos.");
    }
  } catch (error) {
    resultado.errores.push(`Error al procesar archivos: ${error.message}`);
  }

  res.json(resultado);
});

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

app.listen(PORT, () => {
  // console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
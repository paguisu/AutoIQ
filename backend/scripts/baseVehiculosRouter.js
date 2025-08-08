// ================================
// 📁 baseVehiculosRouter.js
// ================================

const express = require('express');
const router = express.Router();
const xlsx = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../data/archivos_subidos'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// 📥 GET: descargar base de datos en Excel
router.get('/base-vehiculos', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM datos_vehiculos_propios');
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Base');

    const filePath = path.join(__dirname, '../../data/combinados/base_vehiculos.xlsx');
    xlsx.writeFile(wb, filePath);

    res.download(filePath);
  } catch (err) {
    console.error('Error al generar archivo:', err);
    res.status(500).send('Error al generar archivo de base interna');
  }
});

// 📤 POST: subir base en Excel y actualizar registros
router.post('/base-vehiculos', upload.single('archivoBase'), async (req, res) => {
  try {
    const wb = xlsx.readFile(req.file.path);
    const hoja = wb.SheetNames[0];
    const registros = xlsx.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });

    let insertados = 0;
    for (const reg of registros) {
      if (!reg.infoautocod || !reg.tipo_vehiculo) continue;

      const [existe] = await db.execute(
        'SELECT id FROM datos_vehiculos_propios WHERE infoautocod = ? LIMIT 1',
        [reg.infoautocod]
      );

      if (existe.length > 0) {
        await db.execute(
          'UPDATE datos_vehiculos_propios SET marca = ?, modelo = ?, tipo_vehiculo = ?, fuente = ?, fecha_alta = NOW() WHERE infoautocod = ?',
          [reg.marca || '', reg.modelo || '', reg.tipo_vehiculo, 'upload', reg.infoautocod]
        );
      } else {
        await db.execute(
          'INSERT INTO datos_vehiculos_propios (infoautocod, marca, modelo, tipo_vehiculo, fuente, fecha_alta) VALUES (?, ?, ?, ?, ?, NOW())',
          [reg.infoautocod, reg.marca || '', reg.modelo || '', reg.tipo_vehiculo, 'upload']
        );
      }
      insertados++;
    }

    res.send(`✅ Base cargada correctamente. Registros procesados: ${insertados}`);
  } catch (err) {
    console.error('Error al subir base:', err);
    res.status(500).send('Error al procesar archivo subido');
  }
});

// 🔍 GET: buscar por infoautocod o por marca+modelo
router.get('/buscar-vehiculo', async (req, res) => {
  const { infoautocod, marca, modelo } = req.query;

  try {
    let query = 'SELECT * FROM datos_vehiculos_propios WHERE ';
    let params = [];

    if (infoautocod) {
      query += 'infoautocod = ?';
      params.push(infoautocod);
    } else if (marca && modelo) {
      query += 'LOWER(marca) = ? AND LOWER(modelo) = ?';
      params.push(marca.toLowerCase(), modelo.toLowerCase());
    } else {
      return res.status(400).send('Faltan parámetros de búsqueda');
    }

    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error al buscar registro:', err);
    res.status(500).send('Error al buscar registro');
  }
});

// 🗑️ DELETE: eliminar por infoautocod
router.delete('/base-vehiculos/:infoautocod', async (req, res) => {
  try {
    const { infoautocod } = req.params;
    const [rows] = await db.execute('DELETE FROM datos_vehiculos_propios WHERE infoautocod = ?', [infoautocod]);
    res.send(`🗑️ Registros eliminados: ${rows.affectedRows}`);
  } catch (err) {
    console.error('Error al eliminar:', err);
    res.status(500).send('Error al eliminar registro');
  }
});

// ✏️ PUT: editar por infoautocod
router.put('/base-vehiculos/:infoautocod', async (req, res) => {
  const { infoautocod } = req.params;
  const { marca, modelo, tipo_vehiculo } = req.body;

  if (!marca || !modelo || !tipo_vehiculo) return res.status(400).send('Faltan campos obligatorios');

  try {
    // Validar duplicados por marca + modelo
    const [existente] = await db.execute(
      'SELECT id FROM datos_vehiculos_propios WHERE LOWER(marca) = ? AND LOWER(modelo) = ? AND infoautocod != ?',
      [marca.toLowerCase(), modelo.toLowerCase(), infoautocod]
    );

    if (existente.length > 0) return res.status(400).send('Ya existe un registro con esa marca y modelo');

    await db.execute(
      'UPDATE datos_vehiculos_propios SET marca = ?, modelo = ?, tipo_vehiculo = ?, fuente = ?, fecha_alta = NOW() WHERE infoautocod = ?',
      [marca, modelo, tipo_vehiculo, 'manual', infoautocod]
    );

    res.send('✏️ Registro actualizado correctamente');
  } catch (err) {
    console.error('Error al editar:', err);
    res.status(500).send('Error al editar registro');
  }
});

// ➕ POST: alta manual de un nuevo registro
router.post('/base-vehiculos/manual', async (req, res) => {
  const { infoautocod, marca, modelo, tipo_vehiculo } = req.body;

  if (!infoautocod || !marca || !modelo || !tipo_vehiculo) return res.status(400).send('Faltan campos obligatorios');

  try {
    // Validar que no exista infoautocod
    const [existCod] = await db.execute('SELECT id FROM datos_vehiculos_propios WHERE infoautocod = ?', [infoautocod]);
    if (existCod.length > 0) return res.status(400).send('Ya existe un registro con ese infoautocod');

    // Validar duplicado por marca + modelo
    const [existMarcaModelo] = await db.execute(
      'SELECT id FROM datos_vehiculos_propios WHERE LOWER(marca) = ? AND LOWER(modelo) = ?',
      [marca.toLowerCase(), modelo.toLowerCase()]
    );
    if (existMarcaModelo.length > 0) return res.status(400).send('Ya existe un registro con esa marca y modelo');

    await db.execute(
      'INSERT INTO datos_vehiculos_propios (infoautocod, marca, modelo, tipo_vehiculo, fuente, fecha_alta) VALUES (?, ?, ?, ?, ?, NOW())',
      [infoautocod, marca, modelo, tipo_vehiculo, 'manual']
    );

    res.send('✅ Registro agregado exitosamente');
  } catch (err) {
    console.error('Error al agregar registro:', err);
    res.status(500).send('Error al agregar registro');
  }
});

module.exports = router;

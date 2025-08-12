// baseVehiculosRouter.js completo, actualizado desde GitHub y ampliado para Base Autos

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const db = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../data/archivos_subidos'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// 🔽 Descargar base completa en Excel
router.get('/base-vehiculos', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM datos_vehiculos_propios');
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Base');

    const filePath = path.join(__dirname, '../data/combinados/base_vehiculos.xlsx');
    xlsx.writeFile(wb, filePath);
    res.download(filePath);
  } catch (err) {
    console.error('Error al generar archivo:', err);
    res.status(500).send('Error al generar archivo de base interna');
  }
});

// 🔼 Subir base por Excel y actualizar registros
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

// 🔍 Buscar por infoautocod o marca + modelo
router.get('/buscar-vehiculo', async (req, res) => {
  const { infoautocod, marca, modelo } = req.query;
  try {
    let result = [];
    if (infoautocod) {
      [result] = await db.execute('SELECT * FROM datos_vehiculos_propios WHERE infoautocod = ?', [infoautocod]);
    } else if (marca && modelo) {
      [result] = await db.execute('SELECT * FROM datos_vehiculos_propios WHERE marca = ? AND modelo = ?', [marca, modelo]);
    }
    res.json(result);
  } catch (err) {
    console.error('Error en búsqueda:', err);
    res.status(500).send('Error en búsqueda');
  }
});

// 🗑️ Eliminar por infoautocod
router.delete('/base-vehiculos/:infoautocod', async (req, res) => {
  const { infoautocod } = req.params;
  try {
    await db.execute('DELETE FROM datos_vehiculos_propios WHERE infoautocod = ?', [infoautocod]);
    res.send('Registro eliminado correctamente');
  } catch (err) {
    console.error('Error al eliminar:', err);
    res.status(500).send('Error al eliminar el registro');
  }
});

// ✏️ Editar registro existente
router.put('/base-vehiculos/:infoautocod', async (req, res) => {
  const { infoautocod } = req.params;
  const { marca, modelo, tipo_vehiculo } = req.body;
  try {
    const [duplicado] = await db.execute(
      'SELECT * FROM datos_vehiculos_propios WHERE marca = ? AND modelo = ? AND infoautocod != ?',
      [marca, modelo, infoautocod]
    );
    if (duplicado.length > 0) return res.status(400).send('Ya existe otro registro con esa marca y modelo');

    await db.execute(
      'UPDATE datos_vehiculos_propios SET marca = ?, modelo = ?, tipo_vehiculo = ?, fuente = ?, fecha_alta = NOW() WHERE infoautocod = ?',
      [marca, modelo, tipo_vehiculo, 'manual', infoautocod]
    );
    res.send('Registro actualizado');
  } catch (err) {
    console.error('Error al actualizar:', err);
    res.status(500).send('Error al actualizar el registro');
  }
});

// ➕ Agregar nuevo registro
router.post('/base-vehiculos/manual', async (req, res) => {
  const { infoautocod, marca, modelo, tipo_vehiculo } = req.body;
  try {
    const [existeCod] = await db.execute('SELECT id FROM datos_vehiculos_propios WHERE infoautocod = ?', [infoautocod]);
    if (existeCod.length > 0) return res.status(400).send('Ya existe un registro con ese infoautocod');

    const [existeMM] = await db.execute('SELECT id FROM datos_vehiculos_propios WHERE marca = ? AND modelo = ?', [marca, modelo]);
    if (existeMM.length > 0) return res.status(400).send('Ya existe un registro con esa marca y modelo');

    await db.execute(
      'INSERT INTO datos_vehiculos_propios (infoautocod, marca, modelo, tipo_vehiculo, fuente, fecha_alta) VALUES (?, ?, ?, ?, ?, NOW())',
      [infoautocod, marca, modelo, tipo_vehiculo, 'manual']
    );
    res.send('Registro agregado exitosamente');
  } catch (err) {
    console.error('Error al agregar:', err);
    res.status(500).send('Error al agregar el registro');
  }
});

module.exports = router;


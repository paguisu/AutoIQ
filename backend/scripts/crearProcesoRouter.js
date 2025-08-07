const express = require('express');
const multer = require('multer');
const path = require('path');
const crearProcesoCotizacion = require('./crearProceso');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../data/archivos_subidos'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now();
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ storage });

router.post('/crear-proceso', upload.single('archivoCombinatorio'), async (req, res) => {
  try {
    const { nombre, cabecera } = req.body;
    const parsedCabecera = JSON.parse(cabecera);

    const resultado = await crearProcesoCotizacion(
      nombre,
      req.file.path,
      parsedCabecera
    );

    if (!resultado.ok) {
      return res.status(500).json({ error: resultado.error });
    }

    res.json({ mensaje: 'Proceso creado correctamente', id: resultado.procesoId });
  } catch (error) {
    console.error('Error en endpoint /crear-proceso:', error);
    res.status(500).json({ error: 'Error al crear el proceso de cotización' });
  }
});

router.get('/procesos-en-curso', async (req, res) => {
  const db = require('../config/db');
  try {
    const [rows] = await db.execute(`
      SELECT id, nombre, DATE_FORMAT(fecha_inicio, "%Y-%m-%d %H:%i") as fecha, estado 
      FROM procesos_cotizacion 
      WHERE estado = 'en curso' 
      ORDER BY fecha_inicio DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener procesos en curso:', error);
    res.status(500).json({ error: 'No se pudieron obtener los procesos en curso' });
  }
});

module.exports = router;
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./config/db');

// Procesadores (módulos separados)
const procesarCombinatorio = require('./scripts/procesarCombinatorio');
const procesarTaxativo = require('./scripts/procesarTaxativo');

const app = express();
const PORT = process.env.PORT || 3000;

// Static del frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Storage para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../data/archivos_subidos/'));
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Upload + proceso (combinatorio o taxativo)
app.post(
  '/upload',
  upload.fields([
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
        html += '</ul><a href="/" style="display:inline-block;margin-top:20px;">🔙 Volver al inicio</a>';
        return res.send(wrap(html));
      }

      let resultado;

      if (tieneCombinatorio) {
        const fileVeh = req.files.archivoVehiculos[0];
        const fileCP  = req.files.archivoCP[0];
        console.log('📄 Vehículos subido:', fileVeh.originalname, '->', fileVeh.path);
        console.log('📄 CP subido:', fileCP.originalname, '->', fileCP.path);

        resultado = await procesarCombinatorio.procesar({
          rutaVehiculos: fileVeh.path,
          rutaCodigosPostales: fileCP.path,
          opciones: {},
        });

        html += `<li>✅ Modo: <strong>Combinatorio</strong></li>`;
        if (resultado.detalles?.completadosUso || resultado.detalles?.completadosTipo) {
          html += `<li style="color:orange;">⚠️ Se completaron automáticamente ${resultado.detalles.completadosUso || 0} campos "uso" y ${resultado.detalles.completadosTipo || 0} campos "tipo_vehiculo".</li>`;
        }
      } else {
        // Taxativo
        const rutaUnico = req.files.archivoUnico[0].path;
        resultado = await procesarTaxativo.procesar({
          rutaArchivo: rutaUnico,
          opciones: {},
        });
        html += `<li>✅ Modo: <strong>Taxativo</strong></li>`;
      }

      // Copia a carpeta pública de descargas
      const rutaPublica = path.join(__dirname, '../frontend/descargas', resultado.salida.archivoNombre);
      fs.copyFileSync(resultado.salida.archivoRuta, rutaPublica);

      // Persistir en historial
      const fecha = new Date();
      await db.execute(
        'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
        [resultado.salida.archivoNombre, fecha, resultado.salida.filas || 0]
      );

      // Mensaje al usuario
      html += `<li>📄 Archivo generado: <strong>${resultado.salida.archivoNombre}</strong></li>`;
      if (resultado.salida.filas != null) {
        html += `<li>🧮 Registros: <strong>${resultado.salida.filas}</strong></li>`;
      }
      if (resultado.salida.columnas != null) {
        html += `<li>🔢 Columnas: <strong>${resultado.salida.columnas}</strong></li>`;
      }
      html += `<li><a href="/descargas/${resultado.salida.archivoNombre}" download style="display:inline-block;margin-top:10px;">⬇️ Descargar</a></li>`;
    } catch (err) {
      console.error('Error en /upload:', err);
      html += `<li style="color:red;">❌ Error al procesar archivos: ${err.message}</li>`;
    }

    html += '</ul><a href="/" style="display:inline-block;margin-top:20px;">🔙 Volver al inicio</a>';
    res.send(wrap(html));
  }
);

// Historial
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
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Helpers
function wrap(inner) {
  return `<html><body style="font-family:Arial,sans-serif;margin:24px;">${inner}</body></html>`;
}

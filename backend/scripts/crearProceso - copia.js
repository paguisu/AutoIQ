const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const slugify = require('slugify');

async function crearProcesoCotizacion(nombre, rutaArchivoCombinatorio, cabecera) {
  try {
    const slug = slugify(nombre, { lower: true, strict: true });
    const carpetaBase = path.join(__dirname, '../../data/procesos', slug);
    const carpetaInputs = path.join(carpetaBase, 'inputs');
    const carpetaRequests = path.join(carpetaBase, 'requests');
    const carpetaResponses = path.join(carpetaBase, 'responses');
    const carpetaResultados = carpetaBase;

    fs.mkdirSync(carpetaBase, { recursive: true });
    fs.mkdirSync(carpetaInputs, { recursive: true });
    fs.mkdirSync(carpetaRequests, { recursive: true });
    fs.mkdirSync(carpetaResponses, { recursive: true });

    const nombreArchivo = path.basename(rutaArchivoCombinatorio);
    const destinoArchivo = path.join(carpetaInputs, nombreArchivo);
    fs.copyFileSync(rutaArchivoCombinatorio, destinoArchivo);

    fs.writeFileSync(path.join(carpetaBase, 'estado.txt'), 'EN CURSO');

    const cabeceraData = {
      nombre: cabecera.nombre,
      fecha_creacion: new Date(),
      datos: {
        dni: cabecera.dni,
        edad: cabecera.edad,
        fecha_nacimiento: cabecera.fecha_nacimiento,
        genero: cabecera.genero,
        estado_civil: cabecera.estado_civil,
        medio_pago: cabecera.medio_pago,
        uso: cabecera.uso,
        aseguradoras: cabecera.aseguradoras || []
      }
    };
    fs.writeFileSync(path.join(carpetaBase, 'cabecera.json'), JSON.stringify(cabeceraData, null, 2));

    const [result] = await db.execute(
      `INSERT INTO procesos_cotizacion 
        (nombre, nombre_cabecera, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados)
       VALUES (?, ?, ?, ?, ?)`,
      [nombre, cabecera.nombre, destinoArchivo, carpetaRequests, carpetaResultados]
    );

    const procesoId = result.insertId;

    for (const cod of cabecera.aseguradoras || []) {
      await db.execute(
        'INSERT INTO procesos_aseguradoras (proceso_id, aseguradora_codigo) VALUES (?, ?)',
        [procesoId, cod]
      );
    }

    return { ok: true, procesoId, carpeta: carpetaBase };

  } catch (error) {
    console.error('Error creando proceso de cotizacion:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = crearProcesoCotizacion;

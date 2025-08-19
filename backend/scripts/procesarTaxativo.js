const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('../utils/validarColumnas');
const db = require('../db'); // Conexión a la base de datos

// Lee encabezados reales desde la primera fila
function leerEncabezados(sheet) {
  const headerRow = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
  return headerRow.map((h) => String(h || '').trim().toLowerCase());
}

// Devuelve la primera hoja con datos o lanza error claro
function leerPrimeraHojaConDatos(ruta) {
  const wb = xlsx.readFile(ruta);
  const hojaNombre = wb.SheetNames.find((name) => {
    const datos = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    return Array.isArray(datos) && datos.length > 0;
  });
  if (!hojaNombre) {
    const nombre = path.basename(ruta);
    throw new Error(`El archivo ${nombre} no contiene hojas con datos`);
  }
  const sheet = wb.Sheets[hojaNombre];
  const datos = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return { wb, hojaNombre, sheet, datos };
}

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function procesar({ rutaArchivo, opciones = {} }) {
  // 1) Leer archivo único (taxativo)
  const { hojaNombre, sheet, datos } = leerPrimeraHojaConDatos(rutaArchivo);

  // 2) Obtener encabezados reales
  const columnas = leerEncabezados(sheet);

  // 3) Validar columnas según modo taxativo
  const faltantes = validarColumnas('taxativa', columnas);
  if (faltantes.length) {
    const err = new Error(`Faltan columnas requeridas para modo taxativo: [${faltantes.join(', ')}]`);
    err.code = 'USER_INPUT_ERROR';
    err.detalles = { faltantes };
    throw err;
  }

  // 4) Guardar una copia normalizada
  const dirCombinados = path.join(__dirname, '../../data/combinados');
  asegurarDir(dirCombinados);
  const archivoNombre = `taxativo-${Date.now()}.xlsx`;
  const rutaDestino = path.join(dirCombinados, archivoNombre);

  const ws = xlsx.utils.json_to_sheet(datos);
  const wbNuevo = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbNuevo, ws, hojaNombre || 'Sheet1');
  xlsx.writeFile(wbNuevo, rutaDestino);

  // 5) Registrar en la base de datos para que aparezca en histórico
  await new Promise((resolve, reject) => {
    const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const sql = 'INSERT INTO archivos_combinados (fecha, nombre_archivo) VALUES (?, ?)';
    db.query(sql, [fecha, archivoNombre], (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

  // 6) Devolver respuesta con mismo formato que combinatorio
  return {
    ok: true,
    mensaje: 'Archivo taxativo validado, exportado y registrado en histórico',
    salida: {
      archivoNombre,
      archivoRuta: rutaDestino,
      filas: datos.length,
      columnas: columnas.length,
    },
  };
}

module.exports = { procesar };

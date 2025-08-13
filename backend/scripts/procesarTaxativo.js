const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('../utils/validarColumnas');

function leerPrimeraHojaConDatos(ruta) {
  const wb = xlsx.readFile(ruta);
  const hojaNombre = wb.SheetNames.find((name) => {
    const datos = xlsx.utils.sheet_to_json(wb.Sheets[name]);
    return datos.length > 0;
  });
  if (!hojaNombre) {
    const nombre = path.basename(ruta);
    throw new Error(`El archivo ${nombre} no contiene hojas con datos`);
  }
  const datos = xlsx.utils.sheet_to_json(wb.Sheets[hojaNombre]);
  return { wb, hojaNombre, datos };
}

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function procesar({ rutaArchivo, opciones = {} }) {
  // 1) Leer archivo único (taxativo)
  const { wb, hojaNombre, datos } = leerPrimeraHojaConDatos(rutaArchivo);

  // 2) Validar columnas según modo taxativo
  const columnas = Object.keys(datos[0] || {});
  const faltantes = validarColumnas('taxativa', columnas);
  if (faltantes.length) {
    const err = new Error(`Faltan columnas requeridas para modo taxativo: [${faltantes.join(', ')}]`);
    err.code = 'USER_INPUT_ERROR';
    err.detalles = { faltantes };
    throw err;
  }

  // 3) Guardar una copia "normalizada" (en este paso solo reenviamos el libro original)
  const dirCombinados = path.join(__dirname, '../../data/combinados');
  asegurarDir(dirCombinados);
  const archivoNombre = `taxativo-${Date.now()}.xlsx`;
  const rutaDestino = path.join(dirCombinados, archivoNombre);

  // Reescribir a destino (asegura consistencia en metadata del archivo)
  const ws = xlsx.utils.json_to_sheet(datos);
  const wbNuevo = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbNuevo, ws, hojaNombre || 'Sheet1');
  xlsx.writeFile(wbNuevo, rutaDestino);

  return {
    ok: true,
    mensaje: 'Archivo taxativo validado y exportado',
    salida: {
      archivoNombre,
      archivoRuta: rutaDestino,
      filas: datos.length,
      columnas: columnas.length,
    },
  };
}

module.exports = { procesar };
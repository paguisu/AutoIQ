const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('../utils/validarColumnas');
const combinarArchivos = require('./combinador');

// Lee encabezados “reales” desde la fila 1 de la hoja (en lugar de inferir por la 1ª fila de datos)
function leerEncabezados(sheet) {
  const headerRow = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
  // normalizamos a minúsculas y sin espacios extras
  return headerRow.map((h) => String(h || '').trim().toLowerCase());
}

// Devuelve la primera hoja con datos o lanza error claro
function leerPrimeraHojaConDatos(ruta) {
  const wb = xlsx.readFile(ruta);
  const nombreHoja = wb.SheetNames.find((name) => {
    const datos = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    return Array.isArray(datos) && datos.length > 0;
  });
  if (!nombreHoja) {
    const nombre = path.basename(ruta);
    throw new Error(`El archivo ${nombre} no contiene hojas con datos`);
  }
  const sheet = wb.Sheets[nombreHoja];
  const datos = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return { wb, nombreHoja, sheet, datos };
}

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function procesar({ rutaVehiculos, rutaCodigosPostales, opciones = {} }) {
  // 1) Leer entradas (siempre la primera hoja con datos)
  const { wb: wbVeh, nombreHoja: hojaVeh, sheet: sheetVeh, datos: rowsVeh } =
    leerPrimeraHojaConDatos(rutaVehiculos);
  const { sheet: sheetCP, datos: rowsCP } =
    leerPrimeraHojaConDatos(rutaCodigosPostales);

  // 2) Encabezados reales (desde la fila 1, no desde la primera fila de datos)
  const columnasVeh = leerEncabezados(sheetVeh);
  const columnasCP = leerEncabezados(sheetCP);

  console.log('▶️ Columnas originales (veh, header):', columnasVeh);
  console.log('▶️ Columnas originales (cp, header):', columnasCP);

  // 3) Completar defaults mínimos (respeta comportamiento actual)
  let completadosUso = 0;
  let completadosTipo = 0;
  const rowsVehAjustado = rowsVeh.map((row) => {
    const copia = { ...row };
    if (copia.uso == null || copia.uso === '') {
      copia.uso = 'Particular';
      completadosUso++;
    }
    if (copia.tipo_vehiculo == null || copia.tipo_vehiculo === '') {
      copia.tipo_vehiculo = 'Sedán';
      completadosTipo++;
    }
    return copia;
  });

  // 4) Validaciones de columnas usando los ENCABEZADOS reales
  const faltanVeh = validarColumnas('combinatoriaVehiculos', columnasVeh);
  const faltanCP = validarColumnas('combinatoriaCP', columnasCP);

  console.log('✅ Requeridas (veh):', ['anio','marca','modelo','codigo_infoauto','suma','cerokm']);
  if (faltanVeh.length || faltanCP.length) {
    const err = new Error(
      `Faltan columnas requeridas. Vehículos: [${faltanVeh.join(', ')}] / Códigos postales: [${faltanCP.join(', ')}]`
    );
    err.code = 'USER_INPUT_ERROR';
    err.detalles = { faltanVeh, faltanCP };
    throw err;
  }

  // 5) Persistir versión ajustada de vehículos (convención -ajustado.xlsx)
  const wsVehNew = xlsx.utils.json_to_sheet(rowsVehAjustado);
  const wbVehNew = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, 'Sheet1');
  const vehPathFinal = rutaVehiculos.replace(/\.xlsx?$/i, '-ajustado.xlsx');
  xlsx.writeFile(wbVehNew, vehPathFinal);

  // 6) Ejecutar combinación (reutiliza el combinador actual)
  const dirCombinados = path.join(__dirname, '../../data/combinados');
  asegurarDir(dirCombinados);
  const archivoNombre = `combinado-${Date.now()}.xlsx`;
  const rutaDestino = path.join(dirCombinados, archivoNombre);

  const totalCombinaciones = combinarArchivos(vehPathFinal, rutaCodigosPostales, rutaDestino);

  // 7) Resultado estandarizado
  return {
    ok: true,
    mensaje: 'Combinación realizada con éxito',
    detalles: { completadosUso, completadosTipo },
    salida: {
      archivoNombre,
      archivoRuta: rutaDestino,
      filas: totalCombinaciones,
      columnas: null,
    },
  };
}

module.exports = { procesar };
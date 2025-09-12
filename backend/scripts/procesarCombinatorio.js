// backend/scripts/procesarCombinatorio.js
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const validarColumnas = require('../utils/validarColumnas');
const combinarArchivos = require('./combinador');
const { registrarCombinacion } = require('../utils/historialCombinaciones');

// Detectar pool de DB de forma robusta (soporta export default o { pool })
let pool = null;
(function detectarPool() {
  try {
    const dbA = require('../config/db');
    pool = dbA.pool || dbA;
  } catch (e1) {
    try {
      const dbB = require('../db');
      pool = dbB.pool || dbB;
    } catch (e2) {
      // Si no hay pool, registraremos el historial en modo best effort (log y seguimos)
      console.warn('[procesarCombinatorio] No se pudo cargar pool desde ../config/db ni ../db; el historial se intentará omitir.');
    }
  }
})();

// Lee encabezados “reales” desde la fila 1 de la hoja
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

  // 2) Encabezados reales (desde la fila 1)
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

  // 6.1) Registrar en historial (best effort: no romper el flujo si falla el INSERT)
  try {
    if (pool && registrarCombinacion) {
      // Guardamos ruta RELATIVA para no atarnos a la unidad/local (útil en despliegue)
      const rutaRelativa = path.join('data', 'combinados', archivoNombre).replace(/\\/g, '/');
      await registrarCombinacion({
        pool,
        nombreArchivo: archivoNombre,
        ruta: rutaRelativa,
        fecha: new Date(),
        cantidadRegistros: Number.isFinite(totalCombinaciones) ? totalCombinaciones : 0,
      });
    } else {
      console.warn('[procesarCombinatorio] Historial no registrado: pool o registrarCombinacion no disponibles.');
    }
  } catch (e) {
    console.error('[procesarCombinatorio] No se pudo guardar historial:', e?.message || e);
    // No lanzamos para no afectar la descarga del archivo combinado
  }

  // 7) Resultado estandarizado (compatibilidad con frontend actual)
  return {
    ok: true,
    mensaje: 'Combinación realizada con éxito',
    detalles: { completadosUso, completadosTipo },
    salida: {
      archivoNombre,
      archivoRuta: rutaDestino,  // absoluta en backend (para usar internamente)
      filas: totalCombinaciones,
      columnas: null,
    },
  };
}

module.exports = { procesar };

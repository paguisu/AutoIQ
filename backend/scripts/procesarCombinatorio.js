const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('../utils/validarColumnas');
const db = require('../config/db');

async function procesarTaxativo(fileUnico) {
  const resultado = { error: false, mensaje: '', nombreArchivo: null };
  try {
    const wb = xlsx.readFile(fileUnico.path);
    const hojaNombre = wb.SheetNames.find(name => {
      const datos = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      return datos.length > 0;
    });
    if (!hojaNombre) throw new Error("El archivo no contiene hojas con datos");

    let rows = xlsx.utils.sheet_to_json(wb.Sheets[hojaNombre], { defval: '' });

    let completadosUso = 0;
    let completadosTipo = 0;

    rows = rows.map(row => {
      let newRow = { ...row };
      if (!newRow.uso) {
        newRow.uso = "Particular";
        completadosUso++;
      }
      if (!newRow.tipo_vehiculo) {
        newRow.tipo_vehiculo = "Sedán";
        completadosTipo++;
      }
      return newRow;
    });

    const columnas = Object.keys(rows[0] || {});
    const faltantes = validarColumnas("taxativa", columnas);

    let mensajes = [];
    mensajes.push(`<li><strong>Columnas detectadas:</strong> ${columnas.join(", ")}`);

    if (faltantes.length > 0) {
      mensajes.push(`<li style="color:red;">❌ Faltan las siguientes columnas: ${faltantes.join(", ")}`);
      resultado.error = true;
      resultado.mensaje = mensajes.join('');
      return resultado;
    }

    mensajes.push(`<li>✅ Registros válidos: ${rows.length}`);
    if (completadosUso > 0 || completadosTipo > 0) {
      mensajes.push(`<li style="color:orange;">⚠️ Se completaron ${completadosUso} campos "uso" y ${completadosTipo} campos "tipo_vehiculo" con valores por defecto.`);
    }

    const ws = xlsx.utils.json_to_sheet(rows);
    const wbNuevo = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wbNuevo, ws, "Datos");

    const nombreArchivo = `taxativo-${Date.now()}.xlsx`;
    const rutaDestino = path.join(__dirname, '../../data/combinados', nombreArchivo);
    const rutaPublica = path.join(__dirname, '../../frontend/descargas', nombreArchivo);
    xlsx.writeFile(wbNuevo, rutaDestino);
    fs.copyFileSync(rutaDestino, rutaPublica);

    mensajes.push(`<li>📄 Archivo taxativo ajustado generado con ${rows.length} registros.`);

    const fecha = new Date();
    await db.execute(
      'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
      [nombreArchivo, fecha, rows.length]
    );

    resultado.mensaje = mensajes.join('');
    resultado.nombreArchivo = nombreArchivo;
    return resultado;
  } catch (error) {
    return { error: true, mensaje: `<li style=\"color:red;\">❌ ${error.message}` };
  }
}

module.exports = procesarTaxativo;
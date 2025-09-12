// backend/scripts/ejecutarCotizacion.js
/**
 * Ejecuta el proceso de multicotización (MVP simulado) y genera Excels:
 * - resultados/cotizaciones_master.xlsx
 * - resultados/errores.xlsx (si hay)
 * - copia del master en frontend/descargas/proceso-<ID>-cotizaciones.xlsx
 *
 * Próximos pasos: reemplazar simulación por WS reales y armar layout definitivo.
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const db = require('../config/db');

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJSON(fp, obj) {
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function toSheetJSON(rows, sheetName = 'Sheet1') {
  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

async function ejecutarCotizacion({ procesoId, procesoDir, archivoCombinado, aseguradoras, parametrosCabecera }) {
  const estadoPath = path.join(procesoDir, 'estado.txt');
  const logsDir = path.join(procesoDir, 'logs');
  const resultadosDir = path.join(procesoDir, 'resultados');
  asegurarDir(logsDir);
  asegurarDir(resultadosDir);

  const logLine = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(path.join(logsDir, 'ejecucion.log'), line);
    console.log(`[proceso ${procesoId}] ${msg}`);
  };

  try {
    // 1) Leer combinado para saber cuántos registros hay
    const wbIn = xlsx.readFile(archivoCombinado);
    const hojaIn = wbIn.SheetNames[0];
    const rowsIn = xlsx.utils.sheet_to_json(wbIn.Sheets[hojaIn], { defval: '' });
    const totalRegistros = rowsIn.length;

    // 2) Estado inicial
    try {
      await db.execute(
        'UPDATE procesos_cotizacion SET registros_procesados = ?, estado = ?, fecha_inicio = COALESCE(fecha_inicio, NOW()) WHERE id = ?',
        [0, 'en curso', procesoId]
      );
    } catch (e) {
      logLine('WARN: no se pudo actualizar estado inicial en DB: ' + e.message);
    }
    fs.writeFileSync(estadoPath, 'en curso');

    // 3) Simulación por aseguradora
    let exitosas = 0;
    let conError = 0;

    // Para Excel Master
    const cotizacionesMaster = []; // una fila por plan (aseguradora, plan, premio, vigencia)
    const errores = [];            // aseguradora, error

    for (const aseg of aseguradoras) {
      const asegLabel = String(aseg);
      const reqPath = path.join(resultadosDir, `request_${asegLabel}.json`);
      const resPath = path.join(resultadosDir, `response_${asegLabel}.json`);

      // "Request" simulado
      const reqPayload = {
        aseguradora: asegLabel,
        cabecera: parametrosCabecera,
        batch: totalRegistros,
        timestamp: new Date().toISOString(),
      };
      writeJSON(reqPath, reqPayload);

      // Simulamos latencia + resultado
      await sleep(300);
      const ok = Math.random() > 0.1; // 90% éxito ficticio

      if (ok) {
        // Armamos 3-5 planes ficticios usando los primeros N registros como base
        const n = Math.max(3, Math.min(5, totalRegistros || 3));
        const planes = Array.from({ length: n }).map((_, i) => ({
          plan: `Plan ${i + 1}`,
          premio: 10000 + Math.floor(Math.random() * 5000),
          vigencia: 'mensual',
        }));

        const resPayload = {
          ok: true,
          aseguradora: asegLabel,
          resumen: { registros: totalRegistros, planes: planes.length },
          primas: planes,
          mensaje: 'Cotización simulada OK',
        };
        writeJSON(resPath, resPayload);

        // Poblamos el master (una fila por plan)
        planes.forEach((p) => {
          cotizacionesMaster.push({
            proceso_id: procesoId,
            aseguradora: asegLabel,
            plan: p.plan,
            premio: p.premio,
            vigencia: p.vigencia,
          });
        });

        exitosas++;
      } else {
        const resPayload = {
          ok: false,
          aseguradora: asegLabel,
          error: 'Timeout de servicio (simulado)',
        };
        writeJSON(resPath, resPayload);
        errores.push({
          proceso_id: procesoId,
          aseguradora: asegLabel,
          error: 'Timeout de servicio (simulado)',
        });
        conError++;
      }
    }

    // 4) Generar Excels de salida en resultados/
    // 4.1) Master
    const wbMaster = toSheetJSON(cotizacionesMaster.length ? cotizacionesMaster : [{ info: 'Sin resultados' }], 'Cotizaciones');
    // Agregamos una hoja Meta (opcional)
    const meta = [{
      proceso_id: procesoId,
      registros_entrada: totalRegistros,
      aseguradoras: aseguradoras.join(','),
      fecha: new Date().toISOString(),
      exitosas, con_error: conError
    }];
    const wsMeta = xlsx.utils.json_to_sheet(meta);
    xlsx.utils.book_append_sheet(wbMaster, wsMeta, 'Meta');

    const masterPath = path.join(resultadosDir, 'cotizaciones_master.xlsx');
    xlsx.writeFile(wbMaster, masterPath);

    // 4.2) Errores (solo si hay)
    if (errores.length > 0) {
      const wbErr = toSheetJSON(errores, 'Errores');
      const errPath = path.join(resultadosDir, 'errores.xlsx');
      xlsx.writeFile(wbErr, errPath);
    }

    // 4.3) Copia a /frontend/descargas para descarga fácil por web
    const descargasDir = path.join(__dirname, '../../frontend/descargas');
    asegurarDir(descargasDir);
    const copiaNombre = `proceso-${procesoId}-cotizaciones.xlsx`;
    const copiaPath = path.join(descargasDir, copiaNombre);
    fs.copyFileSync(masterPath, copiaPath);

    // 5) Actualizar DB: totales y estado final
    try {
      await db.execute(
        'UPDATE procesos_cotizacion SET registros_procesados = ?, cotizaciones_exitosas = ?, cotizaciones_con_error = ?, estado = ?, fecha_fin = NOW() WHERE id = ?',
        [totalRegistros, exitosas, conError, conError > 0 ? 'con errores' : 'completado', procesoId]
      );
    } catch (e) {
      logLine('WARN: no se pudo actualizar estado final en DB: ' + e.message);
    }
    fs.writeFileSync(estadoPath, conError > 0 ? 'con errores' : 'completado');

    logLine(`FIN: registros=${totalRegistros}, exitosas=${exitosas}, errores=${conError}`);
    logLine(`Master: ${masterPath}`);
    logLine(`Copia  : ${copiaPath}`);
  } catch (err) {
    fs.writeFileSync(estadoPath, 'con errores');
    try {
      await db.execute('UPDATE procesos_cotizacion SET estado = ?, fecha_fin = NOW() WHERE id = ?', ['con errores', procesoId]);
    } catch {}
    fs.appendFileSync(path.join(logsDir, 'ejecucion.log'), `[${new Date().toISOString()}] ERROR: ${err.message}\n`);
    console.error(`[proceso ${procesoId}] ERROR:`, err);
  }
}

module.exports = ejecutarCotizacion;

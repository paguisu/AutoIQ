// backend/scripts/ejecutarProceso.js

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

function ejecutarProcesoCotizacion(idProceso) {
  return new Promise((resolve, reject) => {
    try {
      const rutaProceso = path.join(__dirname, '../../data/procesos', String(idProceso));
      const rutaCabecera = path.join(rutaProceso, 'cabecera.json');
      const rutaCombinado = path.join(rutaProceso, 'combinado.xlsx');

      if (!fs.existsSync(rutaCabecera)) {
        return reject(new Error('No se encontró el archivo cabecera.json'));
      }

      if (!fs.existsSync(rutaCombinado)) {
        return reject(new Error('No se encontró el archivo combinado.xlsx'));
      }

      const cabecera = JSON.parse(fs.readFileSync(rutaCabecera, 'utf8'));
      const wb = xlsx.readFile(rutaCombinado);
      const nombreHoja = wb.SheetNames[0];
      const datos = xlsx.utils.sheet_to_json(wb.Sheets[nombreHoja], { defval: '' });

      resolve({
        mensaje: 'Proceso leído correctamente',
        registros: datos.length,
        aseguradoras: cabecera.aseguradoras || [],
        cabecera
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = ejecutarProcesoCotizacion;
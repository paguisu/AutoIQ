const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

function combinarArchivos(vehiculosPath, cpPath, destinoPath) {
  const wbVeh = xlsx.readFile(vehiculosPath);
  const wbCP = xlsx.readFile(cpPath);
  const wsVeh = wbVeh.Sheets[wbVeh.SheetNames[0]];
  const wsCP = wbCP.Sheets[wbCP.SheetNames[0]];

  const vehiculos = xlsx.utils.sheet_to_json(wsVeh);
  const codigosPostales = xlsx.utils.sheet_to_json(wsCP);
  const resultado = [];

  for (let vehiculo of vehiculos) {
    for (let cp of codigosPostales) {
      resultado.push({ ...vehiculo, ...cp });
    }
  }

  const wsFinal = xlsx.utils.json_to_sheet(resultado);
  const wbFinal = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbFinal, wsFinal, "Combinado");
  xlsx.writeFile(wbFinal, destinoPath);

  return resultado.length;
}

module.exports = combinarArchivos;
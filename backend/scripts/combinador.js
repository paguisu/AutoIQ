const xlsx = require('xlsx');
const fs = require('fs');

function combinarArchivos(pathVehiculos, pathCP, pathSalida) {
  const wbVeh = xlsx.readFile(pathVehiculos);
  const wbCP = xlsx.readFile(pathCP);

  const hojaVeh = wbVeh.SheetNames[0];
  const hojaCP = wbCP.SheetNames[0];

  const registrosVeh = xlsx.utils.sheet_to_json(wbVeh.Sheets[hojaVeh]);
  const registrosCP = xlsx.utils.sheet_to_json(wbCP.Sheets[hojaCP]);

  const combinados = [];
  registrosVeh.forEach(v => {
    registrosCP.forEach(cp => {
      combinados.push({ ...v, ...cp });
    });
  });

  const wbNuevo = xlsx.utils.book_new();
  const wsNuevo = xlsx.utils.json_to_sheet(combinados);
  xlsx.utils.book_append_sheet(wbNuevo, wsNuevo, 'Combinado');
  xlsx.writeFile(wbNuevo, pathSalida);

  return combinados.length;
}

module.exports = combinarArchivos

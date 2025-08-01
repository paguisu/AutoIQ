function validarColumnas(tipo, columnas) {
  const columnasNecesarias = {
    combinatoriaVehiculos: ["marca", "modelo", "codigo_infoauto"],
    combinatoriaCP: ["codigo_postal", "localidad"],
    taxativa: ["marca", "modelo", "codigo_infoauto", "codigo_postal", "localidad"]
  };

  const requeridas = columnasNecesarias[tipo] || [];
  const faltantes = requeridas.filter(col => !columnas.includes(col));
  return faltantes;
}

module.exports = validarColumnas;
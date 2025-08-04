function validarColumnas(tipo, columnas) {
  const columnasNecesarias = {
    combinatoriaVehiculos: ["anio", "marca", "modelo", "codigo_infoauto", "suma", "cerokm"],
    combinatoriaCP: ["cp", "localidad", "provincia"],
    taxativa: ["marca", "modelo", "codigo_infoauto", "anio", "codigo_postal", "localidad", "provincia"]
  };

  const normalizadas = columnas.map(c => c.toLowerCase().trim());
  const requeridas = columnasNecesarias[tipo] || [];
  const faltantes = requeridas.filter(col => !normalizadas.includes(col.toLowerCase()));

  return faltantes;
}

module.exports = validarColumnas;

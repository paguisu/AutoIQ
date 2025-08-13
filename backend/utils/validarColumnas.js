function validarColumnas(tipo, columnas) {
  const columnasNecesarias = {
    combinatoriaVehiculos: ["anio", "marca", "modelo", "codigo_infoauto", "suma", "cerokm"],
    combinatoriaCP: ["cp", "localidad", "provincia"],
    taxativa: ["marca", "modelo", "codigo_infoauto", "anio","suma","cp", "localidad", "provincia"]
  };

  const requeridas = columnasNecesarias[tipo] || [];

  console.log("▶️ Columnas originales:", columnas);

  const normalizadas = columnas.map(c => c.toLowerCase().trim());
  console.log("🧽 Columnas normalizadas:", normalizadas);
  console.log("✅ Requeridas:", requeridas);

  const faltantes = requeridas.filter(col => {
    const existe = normalizadas.includes(col.toLowerCase());
    console.log(existe ? `✔️ OK: ${col}` : `❌ Falta: ${col}`);
    return !existe;
  });

  return faltantes;
}

module.exports = validarColumnas;

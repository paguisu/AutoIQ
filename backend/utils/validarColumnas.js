// validarColumnas.js con logs de depuración
function normalizar(nombre) {
  return nombre.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function validarColumnas(tipo, columnas) {
  const columnasNecesarias = {
    combinatoriaVehiculos: ["anio", "marca", "modelo", "codigo_infoauto", "suma", "cerokm"],
    combinatoriaCP: ["cp", "localidad", "provincia"],
    taxativa: ["marca", "modelo", "codigo_infoauto", "anio", "codigo_postal", "localidad", "provincia"]
  };

  const requeridas = columnasNecesarias[tipo] || [];
  const normalizadas = columnas.map(normalizar);

  console.log("\n▶️ Columnas originales:", columnas);
  console.log("🧽 Columnas normalizadas:", normalizadas);
  console.log("✅ Requeridas:", requeridas);

  const faltantes = [];
  requeridas.forEach(col => {
    const colNorm = normalizar(col);
    if (normalizadas.includes(colNorm)) {
      console.log(`✔️ OK: ${col}`);
    } else {
      console.log(`❌ Falta: ${col}`);
      faltantes.push(col);
    }
  });

  return faltantes;
}

module.exports = validarColumnas;
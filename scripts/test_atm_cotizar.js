// scripts/test_atm_cotizar.js
// Ejecuta una cotización DEMO contra ATM usando el cliente que formatea fechas en ddMMyyyy.
// Corre con: node scripts/test_atm_cotizar.js

const path = require('path');
const fs = require('fs');

// Cargar variables de entorno si existe .env
try { require('dotenv').config(); } catch {}

const {
  cotizarSoapDemo,
  formatDDMMYYYY,
} = require('../backend/services/atm/client'); // <-- ajustá la ruta si tu estructura es distinta

(async () => {
  try {
    // ---- Caso de prueba: editá estos valores si querés ----
    const body = {
      tau_codia: process.env.TEST_CODIA || "123456",
      anio: process.env.TEST_ANIO || "2020",
      codigo_postal: process.env.TEST_CP || "1406",
      uso: process.env.TEST_USO || "Particular",
      // Si querés forzar fechas: "11042022" ó "11/04/2022"; si no, hoy.
      // Fecha: "11042022",
      // VigenciaDesde: "11042022",
      // FechaCotizacion: "11042022",
    };
    // --------------------------------------------------------

    console.log(">> Ejecutando cotizarSoapDemo() con body:", body);

    const out = await cotizarSoapDemo(body);

    // Log a consola
    console.log("\n=== Resultado ===");
    console.log(JSON.stringify(out, null, 2));

    // Guardar última salida por si querés inspeccionar tranquilo
    const outDir = path.join(process.cwd(), "data", "atm", "debug");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "last_result.json"), JSON.stringify(out, null, 2), "utf8");

    console.log(`\nOK. Mirá también:\n- ${path.join(outDir, "last_doc_in.xml")} (lo que viajó a ATM)\n- ${path.join(outDir, "last_result.json")} (esta respuesta)`);
  } catch (err) {
    console.error("ERROR en test_atm_cotizar:", err && err.stack || err);
    process.exit(1);
  }
})();

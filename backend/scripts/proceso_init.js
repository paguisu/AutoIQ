/**
 * AutoIQ — ATM — Inicializar proceso de cotización masiva (Checkpoint MQ-2)
 * ---------------------------------------------------------
 * Qué hace:
 *  - Inserta un registro en procesos_cotizacion (solo columnas existentes).
 *  - Crea carpetas para request/response y resultados.
 *  - Imprime por consola el ID del proceso creado.
 *
 * No cotiza. No modifica server.js.
 *
 * Requisitos:
 *   npm i mysql2
 *
 * Uso (ejemplos):
 *   node backend/scripts/atm_mass_init.js ^
 *     --nombre="ATM prueba 2025-10-02" ^
 *     --archivo="D:/AutoIQ/data/combinados/vehiculos_codigos_2025-10-02.csv" ^
 *     --rr="D:/AutoIQ/data/atm/rr/2025-10-02_1700" ^
 *     --res="D:/AutoIQ/data/atm/resultados/2025-10-02_1700"
 *
 * Notas:
 *  - Si omitís --rr o --res, se crean rutas por defecto dentro del proyecto:
 *      ./data/atm/<timestamp>/request_response  y  ./data/atm/<timestamp>/resultados
 *  - La conexión MySQL se toma de variables de entorno si querés:
 *      MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *    Caso contrario, usa: host=localhost, port=3306, user=root, database=autoiq
 */

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, ...rest] = a.slice(2).split("=");
    const v = rest.length ? rest.join("=") : true;
    out[k] = v;
  }
  return out;
}

function ensureDir(p) {
  if (!p) return;
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

(async () => {
  try {
    const args = parseArgs(process.argv);

    // --- Validaciones mínimas ---
    const nombre = args.nombre || args.name;
    const archivo = args.archivo || args.file || args.combinado;

    if (!nombre) {
      console.error("Falta --nombre. Ej: --nombre=\"ATM prueba 2025-10-02\"");
      process.exit(1);
    }
    if (!archivo) {
      console.error("Falta --archivo (ruta del archivo combinado).");
      process.exit(1);
    }

    // --- Directorios por defecto si no vienen ---
    const stamp = ts();
    const baseDefault = path.join(process.cwd(), "data", "atm", stamp);
    const rr = args.rr || path.join(baseDefault, "request_response");
    const res = args.res || path.join(baseDefault, "resultados");

    ensureDir(rr);
    ensureDir(res);

    // --- Conexión MySQL ---
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || "localhost",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "", // te pedirá pass si no seteás acá
      database: process.env.MYSQL_DATABASE || "autoiq",
      multipleStatements: false,
      charset: "utf8mb4",
    });

    // --- Insert segun estructura existente de procesos_cotizacion ---
    // Columnas existentes: nombre, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados
    const sql = `
      INSERT INTO procesos_cotizacion
        (nombre, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados)
      VALUES (?, ?, ?, ?)
    `;
    const params = [nombre, archivo, rr, res];

    const [result] = await conn.execute(sql, params);
    const procesoId = result.insertId;

    await conn.end();

    console.log("=== Proceso creado OK ===");
    console.log("proceso_id:", procesoId);
    console.log("nombre:", nombre);
    console.log("ruta_archivo_combinatorio:", archivo);
    console.log("carpeta_request_response:", rr);
    console.log("carpeta_resultados:", res);
    console.log("");
    console.log("Guardá este proceso_id para el siguiente checkpoint.");

    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    process.exit(2);
  }
})();

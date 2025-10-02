/**
 * ATM - Paso a paso (Checkpoint FTP #1): Listar archivos del FTP de ATM.
 * 
 * NO integra nada al backend ni modifica server.js.
 * Solo lista archivos del FTP para confirmar acceso y visibilidad.
 * 
 * Requisitos: 
 *   npm i basic-ftp
 * 
 * Uso (ejemplos):
 *   node ftp_list.js --host wsatm-dev.atmseguros.com.ar --port 2111 --user PNONCECOM --password s91101 --vendedor 0067804766
 *   node ftp_list.js --host wsatm.atmseguros.com.ar     --port 2113 --user PNONCECOM --password s91101 --vendedor 0067804766
 * 
 * Opcionales:
 *   --secure=true|false       (por defecto: false)
 *   --remoteDir="/parametros" (por defecto: "/")
 *   --verbose=true|false      (por defecto: true)
 * 
 * Salida:
 *   - Muestra un listado por consola (nombre, tipo, tamaño, fecha si está disponible).
 *   - Guarda un JSON con el resultado en: data/atm/ftp_list_<timestamp>.json
 */

const fs = require("fs");
const path = require("path");
const ftp = require("basic-ftp");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k] = v === undefined ? true : v;
    }
  }
  return out;
}

function toBool(val, def=false) {
  if (val === undefined) return def;
  if (typeof val === "boolean") return val;
  const s = String(val).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch (e) {
    return null;
  }
}

(async () => {
  const args = parseArgs(process.argv);

  const host = args.host;
  const port = args.port ? Number(args.port) : undefined;
  const user = args.user || process.env.ATM_FTP_USER;
  const password = args.password || process.env.ATM_FTP_PASS;
  const secure = toBool(args.secure, false);
  const remoteDir = args.remoteDir || "/";
  const verbose = toBool(args.verbose, true);

  if (!host || !user || !password) {
    console.error("Faltan parámetros obligatorios.");
    console.error("Uso: node ftp_list.js --host <host> --port <puerto> --user <usuario> --password <clave> [--secure=false] [--remoteDir=/] [--verbose=true]");
    process.exit(1);
  }

  const client = new ftp.Client(30000); // 30s timeout
  client.ftp.verbose = verbose;

  try {
    await client.access({ host, port, user, password, secure });
    if (remoteDir && remoteDir !== "/") {
      await client.cd(remoteDir);
    }

    const list = await client.list();

    // Mostrar tabla simple por consola
    console.log("\n=== LISTADO FTP ===");
    for (const item of list) {
      console.log(
        [
          item.type === 2 ? "DIR " : "FILE",
          (item.name || "").padEnd(40, " "),
          String(item.size || "").padStart(10, " "),
          fmtDate(item.modifiedAt) || ""
        ].join("  ")
      );
    }

    // Guardar JSON con timestamp
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(process.cwd(), "data", "atm");
    ensureDir(outDir);
    const outFile = path.join(outDir, `ftp_list_${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(list, null, 2), "utf8");
    console.log(`\nGuardado: ${outFile}\n`);

    await client.close();
    process.exit(0);
  } catch (err) {
    console.error("\nERROR FTP:");
    console.error(err && err.message ? err.message : err);
    // Mostrar detalles si existen
    if (err && err.code) console.error("code:", err.code);
    if (err && err.name) console.error("name:", err.name);
    try { await client.close(); } catch {}
    process.exit(2);
  }
})();

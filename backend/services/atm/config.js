// backend/services/atm/config.js
const fs = require("fs");
const path = require("path");

function readJsonSafe(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function getAseguradoraJsonPath() {
  // Canónico
  const defaultPath = path.join(process.cwd(), "data", "atm", "aseguradora.json");

  // Override opcional por env (por si mañana querés otra ubicación)
  const fromEnv = (process.env.ATM_ASEGURADORA_JSON || "").trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return defaultPath;
}

function loadAtmConfig() {
  const jsonPath = getAseguradoraJsonPath();

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`No existe ATM aseguradora.json en: ${jsonPath}`);
  }

  const cfg = readJsonSafe(jsonPath);

  // Normalización básica
  const baseUrl = String(cfg.base_url || "").replace(/\/+$/, "");
  const soapPath = String(cfg.soap_path || "/index.php/soap");
  const soapUrl = cfg.soap_url
    ? String(cfg.soap_url)
    : `${baseUrl}${soapPath}`;

  const soapMethod = String(cfg.soap_method || "AUTOS_Cotizar_PHP");

  // Credenciales: canónicas en JSON, pero permito override por ENV si existiera (opcional)
  const usuario  = (process.env.ATM_USER || "").trim() || String(cfg.usuario || "");
  const password = (process.env.ATM_PASS || "").trim() || String(cfg.password || "");
  const vendedor = (process.env.ATM_VENDEDOR || "").trim() || String(cfg.vendedor || "");
  const origen   = String(cfg.origen || "WS");

  const seccionDefault = String(cfg.seccion_default || "3");
  const planDefault = String(cfg.plan || "");

  const fmt = (process.env.ATM_DATE_FMT || "").trim()
    || String(cfg?.parametros_extras?.formato_fecha_request || "")
    || "ddMMyyyy";

  if (!baseUrl) throw new Error("ATM: falta base_url en aseguradora.json");
  if (!usuario) throw new Error("ATM: falta usuario (JSON o ENV ATM_USER)");
  if (!password) throw new Error("ATM: falta password (JSON o ENV ATM_PASS)");
  if (!vendedor) throw new Error("ATM: falta vendedor (JSON o ENV ATM_VENDEDOR)");

  return {
    jsonPath,
    baseUrl,
    soapUrl,
    soapMethod,
    usuario,
    password,
    vendedor,
    origen,
    seccionDefault,
    planDefault,
    dateFormat: fmt,
    raw: cfg,
  };
}

module.exports = { loadAtmConfig };

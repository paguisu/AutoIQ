// backend/services/atm/config.js
const fs = require("fs");
const path = require("path");

function loadAtmConfig() {
  const jsonPath = path.join(process.cwd(), "data", "atm", "aseguradora.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`No existe ${jsonPath} (config ATM)`);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.base_url || !cfg.soap_path) {
    throw new Error("aseguradora.json ATM: faltan base_url o soap_path");
  }

  const soapUrl = `${String(cfg.base_url).replace(/\/+$/, "")}${String(cfg.soap_path)}`;

  const soapMethod = String(cfg.soap_method || "AUTOS_Cotizar_PHP");

  // Credenciales: preferimos ENV (si existen) y, si no, caemos al JSON.
  const usuario = String((process.env.ATM_USER || cfg.usuario || "")).trim();
  const password = String((process.env.ATM_PASS || cfg.password || "")).trim();
  const vendedor = String((process.env.ATM_VENDEDOR || cfg.vendedor || "")).trim();
  const origen = String((process.env.ATM_ORIGEN || cfg.origen || "WS")).trim();

  const seccionDefault = String(cfg.seccion_default || "3");
  const planDefault = String((process.env.ATM_PLAN || cfg.plan || "")).trim();

  const contactoTecnico = String(
    (process.env.ATM_CONTACTO_TECNICO || cfg.contacto_tecnico || "")
  ).trim();
  const contactoComercial = String(
    (process.env.ATM_CONTACTO_COMERCIAL || cfg.contacto_comercial || "")
  ).trim();

  const dateFormat =
    (cfg.parametros_extras && cfg.parametros_extras.formato_fecha_request) ||
    process.env.ATM_DATE_FMT ||
    "ddMMyyyy";

  if (!soapUrl) throw new Error("ATM config: soapUrl vacío");
  if (!usuario) throw new Error("ATM config: falta usuario (ATM_USER o json.usuario)");
  if (!password) throw new Error("ATM config: falta password (ATM_PASS o json.password)");
  if (!vendedor) throw new Error("ATM config: falta vendedor (ATM_VENDEDOR o json.vendedor)");

  return {
    jsonPath,
    soapUrl,
    soapMethod,
    usuario,
    password,
    vendedor,
    origen,
    seccionDefault,
    planDefault,
    contactoTecnico,
    contactoComercial,
    dateFormat,
    raw: cfg,
  };
}

module.exports = { loadAtmConfig };

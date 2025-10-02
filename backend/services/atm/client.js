// backend/services/atm/client.js
const axios = require("axios");

// Intentamos usar fast-xml-parser (debería estar ya en tu proyecto)
// Si no está, instalalo: npm i fast-xml-parser
let fxp;
try {
  fxp = require("fast-xml-parser");
} catch (_) {
  fxp = null;
}

/**
 * Crea un cliente Axios con baseURL y headers listos para ATM.
 * - validateStatus: true → tratamos 4xx/5xx como “respuesta” (no throw)
 * - logs mínimos de request/response (método, URL, status)
 */
function buildAxios({ baseURL, apiKey, timeoutMs = 10000 }) {
  const instance = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    validateStatus: () => true,
  });

  instance.interceptors.request.use((cfg) => {
    try {
      const u = (cfg.baseURL || "") + (cfg.url || "");
      console.log("[ATM][REQ]", (cfg.method || "GET").toUpperCase(), u);
    } catch {}
    return cfg;
  });

  instance.interceptors.response.use((res) => {
    try {
      console.log("[ATM][RES]", res.status, res.config?.url || "");
    } catch {}
    return res;
  });

  return instance;
}

/**
 * Envoltorio SOAP estándar (Envelope/Body) con namespaces clásicos.
 * Pone el XML que vos le pases dentro del <soap:Body>…</soap:Body>.
 */
function buildSoapEnvelope(innerXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    ${innerXml}
  </soap:Body>
</soap:Envelope>`.trim();
}

/**
 * Parsea una respuesta XML de SOAP a JSON y devuelve un objeto
 * con forma { ok, data, raw, fault }.
 *
 * - xml: string recibido del servidor
 * - pathSegments: array de “claves” para entrar al nodo útil dentro del Envelope.
 *   Ej: ["AUTOS_Cotizar_PHPResponse", "AUTOS_Cotizar_PHPResult", "auto"]
 *
 * Nota: ATM a veces usa prefijos (ns1:, soap:, etc.). Usamos fast-xml-parser
 * con ignoreNameSpace=true para aplanar esos prefijos.
 */
async function xmlToJson(xml, pathSegments = []) {
  if (!fxp) {
    return {
      ok: false,
      fault:
        "Falta dependencia 'fast-xml-parser'. Instalar con: npm i fast-xml-parser",
      raw: xml,
    };
  }

  // Config estándar para SOAP
  const parser = new fxp.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    allowBooleanAttributes: true,
    trimValues: true,
    parseTagValue: true,
    parseAttributeValue: true,
    ignoreDeclaration: true,
    // Clave: ignora namespaces (ns1:, soap:)
    ignoreNameSpace: true,
  });

  try {
    const obj = parser.parse(xml);

    // Buscamos “Envelope → Body”
    let cursor =
      obj?.Envelope?.Body ??
      obj?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"] ??
      obj?.["soap:Envelope"]?.["soap:Body"] ??
      obj;

    // Bajamos por las claves indicadas
    for (const k of pathSegments) {
      if (cursor && typeof cursor === "object") {
        // Buscamos clave exacta o variaciones comunes
        const key =
          Object.keys(cursor).find(
            (kk) => kk === k || kk.endsWith(":" + k) || kk.endsWith(k)
          ) || k;
        cursor = cursor[key];
      }
    }

    // Si vino Fault estándar
    const fault =
      cursor?.Fault ||
      obj?.Envelope?.Body?.Fault ||
      obj?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"]?.Fault ||
      null;

    if (fault) {
      return {
        ok: false,
        fault:
          fault.faultstring ||
          fault["faultstring"] ||
          fault.faultcode ||
          "SOAP Fault",
        raw: obj,
      };
    }

    return { ok: true, data: cursor, raw: obj };
  } catch (e) {
    return { ok: false, fault: e.message || String(e), raw: xml };
  }
}

/**
 * Lee credenciales/URLs desde variables de entorno.
 * (Las definís en tu .env y process.env las expone aquí)
 */
function pickEnv() {
  return {
    ATM_BASE_URL: process.env.ATM_BASE_URL, // ej: https://wsatm.atmseguros.com.ar  (sin /index.php/soap)
    ATM_USER: process.env.ATM_USER,
    ATM_PASS: process.env.ATM_PASS,
    ATM_VENDEDOR: process.env.ATM_VENDEDOR,
  };
}

module.exports = {
  buildAxios,
  buildSoapEnvelope,
  xmlToJson,
  pickEnv,
};

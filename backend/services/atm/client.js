// backend/services/atm/client.js
// Cliente ATM robusto con formateo de fecha configurable.
// - Por defecto: ddMMyyyy
// - Se puede forzar por request body: { fecha_formato: 'yyyyMMdd' }
// Fuente única de configuración: data/atm/aseguradora.json (loadAtmConfig)

const axios = require("axios");
const { parseStringPromise } = require("xml2js");
const fs = require("fs");
const path = require("path");
const { loadAtmConfig } = require("./config");

// ================== Helpers de fecha ==================
function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * Soporta patrones: ddMMyyyy, yyyyMMdd, dd/MM/yyyy, yyyy-MM-dd
 */
function formatByPattern(d, pattern) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = pad2(dt.getDate());
  const MM = pad2(dt.getMonth() + 1);
  const yyyy = String(dt.getFullYear());

  switch ((pattern || "").trim()) {
    case "yyyyMMdd": return `${yyyy}${MM}${dd}`;
    case "dd/MM/yyyy": return `${dd}/${MM}/${yyyy}`;
    case "yyyy-MM-dd": return `${yyyy}-${MM}-${dd}`;
    case "ddMMyyyy":
    default:
      return `${dd}${MM}${yyyy}`;
  }
}

function pickDateFormat(overrideFromBody, cfgDateFmt) {
  // prioridad: body.fecha_formato > cfg.dateFormat > 'ddMMyyyy'
  const bodyFmt = (overrideFromBody || "").trim();
  const cfgFmt = (cfgDateFmt || "").trim();
  return bodyFmt || cfgFmt || "ddMMyyyy";
}

// ================== SOAP helpers ==================
function buildSoapEnvelope(innerXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    ${innerXml}
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();
}

async function xmlToJson(xml, pathTags = []) {
  try {
    const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
    const fault = parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"]?.["SOAP-ENV:Fault"];
    if (fault) {
      const s = (fault?.faultstring || "Fault").toString();
      return { ok: false, fault: `Fault/${s}` };
    }
    let node = parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"];
    for (const t of pathTags) {
      node = node?.[t];
      if (!node) break;
    }
    return { ok: true, data: node };
  } catch (e) {
    return { ok: false, fault: e.message || "xml parse error" };
  }
}

// ================== Config ATM (fuente única: aseguradora.json) ==================
function pickEnv() {
  const cfg = loadAtmConfig();

  // Fuente única: aseguradora.json
  // - endpoint único: cfg.soapUrl
  // - método único: cfg.soapMethod
  // - credenciales: cfg.usuario/cfg.password
  const endpoints = [cfg.soapUrl];
  const methods = [cfg.soapMethod];

  return {
    cfg,
    endpoints,
    methods,
    ATM_USER: cfg.usuario,
    ATM_PASS: cfg.password,
    ATM_DATE_FMT: cfg.dateFormat,
  };
}

// Genera combinación de candidatos (endpoint × método × soapAction)
function buildCandidates(endpoints, methods) {
  const list = [];
  for (const url of endpoints) {
    for (const method of methods) {
      // 3 variantes de SOAPAction típicas
      list.push({ url, method, soapAction: `http://tempuri.org/${method}`, xmlns: "http://tempuri.org/" });
      list.push({ url, method, soapAction: `urn:${method}`,                  xmlns: "urn:" });
      list.push({ url, method, soapAction: "",                               xmlns: "http://tempuri.org/" });
    }
  }
  return list;
}

// Intenta un candidato concreto
async function trySoapCandidate({ url, method, soapAction, xmlns, docIn }) {
  const body = buildSoapEnvelope(`
<${method} xmlns="${xmlns}">
  <doc_in><![CDATA[${docIn}]]></doc_in>
</${method}>
  `.trim());

  const headers = {
    "Content-Type": "text/xml; charset=UTF-8",
    "SOAPAction": soapAction,
  };

  try {
    const res = await axios.post(url, body, { headers, timeout: 20000, validateStatus: () => true });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message || "axios error", body: String(e?.response?.data || "") };
  }
}

/**
 * Llama al WS de ATM enviando HOY con formato configurable en:
 *  - <usuario><fecha>
 *  - <cotizacion><fechacotizacion>
 *  - <cotizacion><fechavigenciadesde>
 *
 * Body mínimo:
 *  - tau_codia (o codia), anio (o anofab), codigo_postal (o codpostal o CP), uso
 * Opcional:
 *  - fecha_formato: 'ddMMyyyy' | 'yyyyMMdd' | 'dd/MM/yyyy' | 'yyyy-MM-dd'
 */
async function cotizarSoapDemo(bodyRaw) {
  const env = pickEnv();
  const fmt = pickDateFormat(bodyRaw?.fecha_formato, env.cfg?.dateFormat);
  const hoyFmt = formatByPattern(new Date(), fmt);

  // Campos del vehículo desde el body
  const codia = bodyRaw?.tau_codia || bodyRaw?.codia || "";
  const anio = bodyRaw?.anio || bodyRaw?.anofab || "";
  const cp = bodyRaw?.codigo_postal || bodyRaw?.codpostal || bodyRaw?.CP || "";
  const uso = bodyRaw?.uso || "Particular";

  // Armamos doc_in con fechas
  const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${env.ATM_USER}</usa>
      <pas>${env.ATM_PASS}</pas>
      <fecha>${hoyFmt}</fecha>
    </usuario>
    <cotizacion>
      <fechacotizacion>${hoyFmt}</fechacotizacion>
      <fechavigenciadesde>${hoyFmt}</fechavigenciadesde>
    </cotizacion>
    <vehiculo>
      <codia>${codia}</codia>
      <anio>${anio}</anio>
      <cp>${cp}</cp>
      <uso>${uso}</uso>
    </vehiculo>
  </auto>
</doc_in>`.trim();

  // Guardamos lo que viaja + config usada
  try {
    const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
    fs.mkdirSync(dbgDir, { recursive: true });
    fs.writeFileSync(path.join(dbgDir, "last_doc_in.xml"), docIn, "utf8");
    fs.writeFileSync(path.join(dbgDir, "last_date_format.txt"), fmt, "utf8");
    fs.writeFileSync(
      path.join(dbgDir, "last_atm_config_used.json"),
      JSON.stringify(
        { jsonPath: env.cfg?.jsonPath, soapUrl: env.cfg?.soapUrl, soapMethod: env.cfg?.soapMethod },
        null,
        2
      ),
      "utf8"
    );
  } catch {}

  // Construimos candidatos y probamos hasta que uno funcione
  const candidates = buildCandidates(env.endpoints, env.methods);

  const tried = [];
  for (const cand of candidates) {
    try {
      const r = await trySoapCandidate({ ...cand, docIn });
      tried.push({ url: cand.url, method: cand.method, soapAction: cand.soapAction, ok: r.ok, status: r.status });
      if (r.ok) {
        // Guardamos respuesta cruda
        try {
          const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
          fs.mkdirSync(dbgDir, { recursive: true });
          fs.writeFileSync(path.join(dbgDir, "last_soap_response.xml"), String(r.body || ""), "utf8");
          fs.writeFileSync(path.join(dbgDir, "last_candidate.json"), JSON.stringify(cand, null, 2), "utf8");
        } catch {}

        // Intento de parseo: SOAP → doc_out
        const parsed = await xmlToJson(r.body, [`${cand.method}Response`, `${cand.method}Result`]);
        if (!parsed.ok) {
          // algunos servers devuelven directamente doc_out sin el envoltorio esperado
          const inner = await xmlToJson(r.body, ["auto"]);
          if (!inner.ok) {
            return { ok: false, error: "ATM SOAP parse error", raw: { message: parsed.fault } };
          }
          const root = inner.data || {};
          const operacion = root?.operacion || root?.Operacion || null;
          const coberturas = Array.isArray(root?.coberturas?.cobertura) ? root.coberturas.cobertura : [];
          return { ok: true, operacion, coberturas, used: cand, tried };
        }

        let root = parsed.data;
        if (typeof root === "string") {
          const inner = await xmlToJson(root, ["auto"]);
          root = inner.ok ? inner.data : {};
        } else {
          root = root?.auto || {};
        }

        const operacion = root?.operacion || root?.Operacion || null;
        const coberturas = Array.isArray(root?.coberturas?.cobertura) ? root.coberturas.cobertura : [];
        return { ok: true, operacion, coberturas, used: cand, tried };
      }
    } catch (e) {
      tried.push({ url: cand.url, method: cand.method, soapAction: cand.soapAction, ok: false, status: 0, error: e.message });
    }
  }

  // Guardar intentos
  try {
    const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
    fs.mkdirSync(dbgDir, { recursive: true });
    fs.writeFileSync(path.join(dbgDir, "last_tried.json"), JSON.stringify(tried, null, 2), "utf8");
  } catch {}

  return { ok: false, error: "ATM SOAP error", raw: { message: "No SOAP endpoint/method matched", tried } };
}

module.exports = {
  buildSoapEnvelope,
  xmlToJson,
  pickEnv,
  formatByPattern,
  cotizarSoapDemo,
};

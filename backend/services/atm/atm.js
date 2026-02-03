﻿// backend/services/atm/atm.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const xlsx = require("xlsx");

const { cotizarSoapDemo } = require("./client");
const { loadAtmConfig } = require("./config");

// -------------------- Helpers --------------------
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
// ATM pide ddmmAAAA según el PDF
function formatDDMMYYYY(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  const yyyy = String(dt.getFullYear());
  return `${dd}${mm}${yyyy}`;
}
function pick(vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function isNumericString(s) {
  return typeof s === "string" && /^[0-9]+$/.test(s);
}
function normalizeBaseUrl(u) {
  if (!u) return "";
  let x = String(u).trim();
  if (!/^https?:\/\//i.test(x)) x = "https://" + x;
  return x.replace(/\/+$/, "");
}
function toAbs(relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(process.cwd(), relOrAbs.replace(/^\.?[/\\]/, ""));
}

function getAtmRuntimeConfig() {
  // 1) Cargo el JSON canónico (no lo rompo), pero:
  // 2) Piso con ENV cuando exista (centralización)
  const cfg = loadAtmConfig();

  const envSoapUrl = (process.env.ATM_SOAP_URL || "").trim();
  const envSoapMethod = (process.env.ATM_SOAP_METHOD || "").trim();
  const envUser = (process.env.ATM_USER || "").trim();
  const envPass = (process.env.ATM_PASS || "").trim();
  const envVendedor = (process.env.ATM_VENDEDOR || "").trim();
  const envOrigen = (process.env.ATM_ORIGEN || "").trim();
  const envSeccion = (process.env.ATM_SECCION || "").trim();
  const envPlan = (process.env.ATM_PLAN || "").trim();

  const baseUrl = normalizeBaseUrl(process.env.ATM_BASE_URL || cfg.baseUrl);

  const soapUrl = envSoapUrl || cfg.soapUrl || `${baseUrl}/index.php/soap`;
  const soapMethod = envSoapMethod || cfg.soapMethod || "AUTOS_Cotizar_PHP";

  const usuario = envUser || cfg.usuario;
  const password = envPass || cfg.password;
  const vendedor = envVendedor || cfg.vendedor;
  const origen = envOrigen || cfg.origen || "WS";

  const seccionDefault = envSeccion || cfg.seccionDefault || "3";
  const planDefault = envPlan || cfg.planDefault || "";

  if (!usuario) throw new Error("ATM: falta ATM_USER (o usuario en aseguradora.json)");
  if (!password) throw new Error("ATM: falta ATM_PASS (o password en aseguradora.json)");
  if (!vendedor) throw new Error("ATM: falta ATM_VENDEDOR (o vendedor en aseguradora.json)");

  return {
    jsonPath: cfg.jsonPath,
    soapUrl,
    soapMethod,
    usuario,
    password,
    vendedor,
    origen,
    seccionDefault,
    planDefault,
    baseUrl,
  };
}

function buildAseguradoBlockFromBody(body) {
  // Según el PDF, un ejemplo válido incluye:
  // <asegurado><persona>F</persona><iva>CF</iva>...</asegurado>
  // Para tu caso mínimo: persona F + iva CF.
  // Si el caller manda bloque_asegurado_xml, lo usamos tal cual.
  const raw = (body?.bloque_asegurado_xml || "").trim();
  if (raw) return raw;

  const persona = (body?.persona || "F").toString().trim() || "F";
  const iva = (body?.iva || "CF").toString().trim() || "CF";

  // Permitimos opcionales si mañana los querés sumar
  const cupondscto = (body?.cupondscto || "").toString().trim();
  const bonificacion = (body?.bonificacion || "").toString().trim();

  let extra = "";
  if (cupondscto) extra += `\n    <cupondscto>${cupondscto}</cupondscto>`;
  if (bonificacion) extra += `\n    <bonificacion>${bonificacion}</bonificacion>`;

  return `<asegurado>
    <persona>${persona}</persona>
    <iva>${iva}</iva>${extra}
  </asegurado>`;
}

function normalizeUso(uso) {
  const u = (uso || "").toString().trim();
  // El doc muestra uso numérico, y en tus respuestas aparece 0101.
  // Si te llega "Particular", lo pasamos a 0101 (default seguro).
  if (!u) return "0101";
  if (isNumericString(u)) return u;
  if (u.toLowerCase() === "particular") return "0101";
  return "0101";
}

function buildDocInATM(body, cfg) {
  const hoy = formatDDMMYYYY(new Date());

  const codia = pick([body?.tau_codia, body?.codia, body?.cod_infoauto]);
  const anio = pick([body?.anio, body?.anofab]);
  const cp = pick([body?.codigo_postal, body?.codpostal, body?.CP, body?.cp]);

  if (!codia) throw new Error("Falta tau_codia/codia");
  if (!anio) throw new Error("Falta anio/anofab");
  if (!cp) throw new Error("Falta codigo_postal/codpostal");

  const uso = normalizeUso(body?.uso);

  const seccion = pick([body?.seccion, cfg.seccionDefault]) || "3";
  const plan = pick([body?.plan, cfg.planDefault]) || "";

  const aseguradoXml = buildAseguradoBlockFromBody(body);

  // Estructura del PDF: <doc_in><auto><usuario>...<pass>...</pass>...</usuario><asegurado>...</asegurado><bien>...</bien></auto></doc_in>
  // Para tu test mínimo, llenamos lo que venís mandando: cod_infoauto/anofab/codpostal/uso/seccion.
  const usuarioXml = `<usuario>
    <usa>${cfg.usuario}</usa>
    <pass>${cfg.password}</pass>
    <fecha>${hoy}</fecha>
    <vendedor>${cfg.vendedor}</vendedor>
    <origen>${cfg.origen || "WS"}</origen>${plan ? `\n    <plan>${plan}</plan>` : ""}
  </usuario>`;

  const bienXml = `<bien>
    <cod_infoauto>${codia}</cod_infoauto>
    <anofab>${anio}</anofab>
    <codpostal>${cp}</codpostal>
    <uso>${uso}</uso>
    <seccion>${seccion}</seccion>
  </bien>`;

  return `<doc_in>
  <auto>
    ${usuarioXml}
    ${aseguradoXml}
    ${bienXml}
  </auto>
</doc_in>`;
}

function buildSoapEnvelope(method, docIn) {
  const xmlns = "http://tempuri.org/";
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <${method} xmlns="${xmlns}">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${method}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function parseAtmSoapResponse(xmlStr) {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(String(xmlStr || ""));

  const body =
    parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"] ||
    parsed?.Envelope?.Body ||
    null;

  // Resultado típico: <AUTOS_Cotizar_PHPResponse><AUTOS_Cotizar_PHPResult> ... </...Result></...Response>
  const responseNode =
    body?.["ns1:AUTOS_Cotizar_PHPResponse"] ||
    body?.["AUTOS_Cotizar_PHPResponse"] ||
    null;

  const resultNode =
    responseNode?.["ns1:AUTOS_Cotizar_PHPResult"] ||
    responseNode?.["AUTOS_Cotizar_PHPResult"] ||
    null;

  // Dentro suele venir <auto>...</auto> con xmlns="".
  const auto = resultNode?.auto || resultNode?.["auto"] || null;

  const operacion = auto?.operacion ?? null;
  const statusSuccess = auto?.statusSuccess ?? null;
  const msg = auto?.statusText?.msg ?? auto?.statusText ?? null;

  // Coberturas vienen así: <cotizacion><cobertura>...</cobertura></cotizacion>
  // A veces es array, a veces objeto único.
  let coberturas = [];
  const coberturaNode = auto?.cotizacion?.cobertura;
  if (Array.isArray(coberturaNode)) coberturas = coberturaNode;
  else if (coberturaNode) coberturas = [coberturaNode];

  return { operacion, statusSuccess, msg, coberturas };
}

// -------------------- 1) Ruta existente (compatibilidad) --------------------
router.post("/cotizar-soap-demo", async (req, res) => {
  try {
    const result = await cotizarSoapDemo(req.body || {});
    const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
    ensureDir(dbgDir);
    fs.writeFileSync(
      path.join(dbgDir, "last_result.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// -------------------- 2) Ruta 1 a 1 (AUTOS_Cotizar_PHP) --------------------
router.post("/cotizar-php", async (req, res) => {
  const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
  ensureDir(dbgDir);

  try {
    const cfg = getAtmRuntimeConfig();

    // Debug: qué config se usó realmente
    try {
      fs.writeFileSync(
        path.join(dbgDir, "last_atm_config_used.json"),
        JSON.stringify(
          {
            jsonPath: cfg.jsonPath,
            soapUrl: cfg.soapUrl,
            soapMethod: cfg.soapMethod,
            // NO escribo credenciales en debug por seguridad
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {}

    const docIn = buildDocInATM(req.body || {}, cfg);
    const envelope = buildSoapEnvelope(cfg.soapMethod, docIn);

    // Debug request
    try {
      fs.writeFileSync(path.join(dbgDir, "last_doc_in.xml"), docIn, "utf8");
      fs.writeFileSync(path.join(dbgDir, "last_soap_request.xml"), envelope, "utf8");
    } catch {}

    const soapAction = `http://tempuri.org/${cfg.soapMethod}`;

    const resp = await axios.post(cfg.soapUrl, envelope, {
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: soapAction,
      },
      timeout: 25000,
      validateStatus: () => true,
    });

    const rawResp = resp.data;

    // Debug response
    try {
      fs.writeFileSync(path.join(dbgDir, "last_soap_response.xml"), String(rawResp || ""), "utf8");
      fs.writeFileSync(
        path.join(dbgDir, "last_candidate.json"),
        JSON.stringify(
          { url: cfg.soapUrl, method: cfg.soapMethod, soapAction },
          null,
          2
        ),
        "utf8"
      );
    } catch {}

    if (!(resp.status >= 200 && resp.status < 300)) {
      return res.status(502).json({
        ok: false,
        error: "ATM SOAP error (PHP)",
        raw: {
          message: `HTTP ${resp.status}`,
          response: rawResp ? String(rawResp).slice(0, 4000) : null,
        },
        used: { url: cfg.soapUrl, method: cfg.soapMethod, soapAction },
      });
    }

    const parsed = parseAtmSoapResponse(rawResp);

    // Si ATM contestó statusSuccess FALSE, devolvemos error claro (sin romper el flujo)
    if (String(parsed.statusSuccess || "").toUpperCase() === "FALSE") {
      return res.status(502).json({
        ok: false,
        operacion: parsed.operacion ?? 0,
        error: parsed.msg || "ATM statusSuccess FALSE",
        used: { url: cfg.soapUrl, method: cfg.soapMethod, soapAction },
      });
    }

    return res.status(200).json({
      ok: true,
      operacion: parsed.operacion ?? null,
      coberturas: parsed.coberturas || [],
      used: { url: cfg.soapUrl, method: cfg.soapMethod, soapAction },
    });
  } catch (err) {
    console.error("Error en /atm/cotizar-php:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// -------------------- 3) Batch (se deja como estaba, no toco) --------------------
// Nota: si no lo estás usando ahora, no lo rompo. Mantengo tu implementación actual.
// Si querés que lo alinee al nuevo doc_in, lo hacemos después.
router.post("/cotizar-php-batch", async (req, res) => {
  const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
  ensureDir(dbgDir);

  try {
    // Fuente de datos
    let rows = [];
    if (Array.isArray(req.body?.items)) {
      rows = req.body.items;
    } else if (req.body?.archivo) {
      const abs = toAbs(req.body.archivo);
      if (!abs || !fs.existsSync(abs)) {
        return res.status(400).json({ ok: false, error: `No se encuentra el archivo: ${req.body.archivo}` });
      }
      if (abs.toLowerCase().endsWith(".csv")) {
        const content = fs.readFileSync(abs, "utf8");
        const lines = content.split(/\r?\n/).filter(Boolean);
        const headers = lines.shift().split(",").map((s) => s.trim());
        for (const ln of lines) {
          const cols = ln.split(",");
          const obj = {};
          headers.forEach((h, i) => (obj[h] = cols[i] ?? ""));
          rows.push(obj);
        }
      } else {
        const wb = xlsx.readFile(abs);
        const hoja =
          wb.SheetNames.find((n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { defval: "" }).length > 0) ||
          wb.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(wb.Sheets[hoja], { defval: "" });
        rows = data;
      }
    } else {
      return res.status(400).json({ ok: false, error: "Enviar items[] o archivo" });
    }

    const limite = Number(req.body?.limite || 10);
    const subset = rows.slice(0, Math.max(1, limite));

    const resultados = [];
    for (const item of subset) {
      // reutilizo la ruta 1 a 1 armando request interno
      const r = await axios.post(
        "http://localhost:" + (process.env.PORT || 3000) + "/atm/cotizar-php",
        item,
        { headers: { "Content-Type": "application/json" }, validateStatus: () => true }
      );
      resultados.push({ item, status: r.status, data: r.data });
    }

    return res.json({ ok: true, total: subset.length, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;

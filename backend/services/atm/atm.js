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

// ---------- Helpers compartidos ----------
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function pad2(n){ return String(n).padStart(2,"0"); }
function formatByPattern(d, pattern) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = pad2(dt.getDate()); const MM = pad2(dt.getMonth()+1); const yyyy = String(dt.getFullYear());
  switch ((pattern||"").trim()) {
    case "yyyyMMdd":   return `${yyyy}${MM}${dd}`;
    case "dd/MM/yyyy": return `${dd}/${MM}/${yyyy}`;
    case "yyyy-MM-dd": return `${yyyy}-${MM}-${dd}`;
    case "ddMMyyyy":
    default:           return `${dd}${MM}${yyyy}`;
  }
}
function pick(vals){ for(const v of vals){ if(v!=null && String(v).trim()!=="") return String(v).trim(); } return ""; }
function toAbs(relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(process.cwd(), relOrAbs.replace(/^\.?[/\\]/, ""));
}

// ---------- 1) Ruta existente: ws_* (barrido automático) ----------
router.post("/cotizar-soap-demo", async (req, res) => {
  try {
    const result = await cotizarSoapDemo(req.body || {});
    const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
    ensureDir(dbgDir);
    fs.writeFileSync(path.join(dbgDir, "last_result.json"), JSON.stringify(result, null, 2), "utf8");
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

// ---------- 2) Ruta 1 a 1 (AUTOS_Cotizar_PHP) ----------
router.post("/cotizar-php", async (req, res) => {
  const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
  ensureDir(dbgDir);

  try {
    const cfg = loadAtmConfig();

    const fmt = (req.body && req.body.fecha_formato) || cfg.dateFormat || "ddMMyyyy";
    const hoy = formatByPattern(new Date(), fmt);
    try {
      fs.writeFileSync(path.join(dbgDir, "last_date_format.txt"), fmt, "utf8");
      fs.writeFileSync(path.join(dbgDir, "last_atm_config_used.json"), JSON.stringify({
        jsonPath: cfg.jsonPath,
        soapUrl: cfg.soapUrl,
        soapMethod: cfg.soapMethod
      }, null, 2), "utf8");
    } catch {}

    const url = (process.env.ATM_SOAP_URL || "").trim() || cfg.soapUrl;
    const method = (process.env.ATM_SOAP_METHOD || "").trim() || cfg.soapMethod;

    const ATM_USER = cfg.usuario;
    const ATM_PASS = cfg.password;
    const ATM_VENDEDOR = cfg.vendedor;
    const ATM_SECCION = (process.env.ATM_SECCION || cfg.seccionDefault || "3").toString();
    const ORIGEN = cfg.origen || "WS";

    const codia = pick([req.body?.tau_codia, req.body?.codia]);
    const anio  = pick([req.body?.anio, req.body?.anofab]);
    const cp    = pick([req.body?.codigo_postal, req.body?.codpostal, req.body?.CP, req.body?.cp]);
    const uso   = pick([req.body?.uso]) || "Particular";

    const docIn = `
<doc_in>
  <usuario>
    <usu>${ATM_USER}</usu>
    <pas>${ATM_PASS}</pas>
    <fecha>${hoy}</fecha>
    <vendedor>${ATM_VENDEDOR}</vendedor>
    <origen>${ORIGEN}</origen>
  </usuario>
  <cotizacion>
    <seccion>${ATM_SECCION}</seccion>
    <fechacotizacion>${hoy}</fechacotizacion>
    <fechavigenciadesde>${hoy}</fechavigenciadesde>
  </cotizacion>
  <auto>
    <vehiculo>
      <codia>${codia}</codia>
      <anio>${anio}</anio>
      <cp>${cp}</cp>
      <uso>${uso}</uso>
    </vehiculo>
  </auto>
</doc_in>`.trim();

    try { fs.writeFileSync(path.join(dbgDir, "last_doc_in.xml"), docIn, "utf8"); } catch {}

    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <${method} xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${method}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

    const candidates = [
      { soapAction: `http://tempuri.org/${method}` },
      { soapAction: `${method}` },
      { soapAction: `urn:${method}` },
    ];

    const parser = new XMLParser({ ignoreAttributes:false, trimValues:true });
    let lastError = null, rawResp = null;

    for (const cand of candidates) {
      try {
        const resp = await axios.post(url, envelope, {
          headers: { "Content-Type": "text/xml; charset=UTF-8", "SOAPAction": cand.soapAction },
          timeout: 20000, validateStatus: () => true
        });
        rawResp = resp.data;

        try {
          fs.writeFileSync(path.join(dbgDir, "last_soap_response.xml"), String(rawResp || ""), "utf8");
          fs.writeFileSync(path.join(dbgDir, "last_candidate.json"), JSON.stringify(
            { url, method, soapAction: cand.soapAction }, null, 2
          ), "utf8");
        } catch {}

        if (resp.status >= 200 && resp.status < 300) {
          const parsed = parser.parse(String(rawResp || ""));
          const body = parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"] || parsed?.Envelope?.Body || null;
          const result =
            body?.["ns1:AUTOS_Cotizar_PHPResponse"]?.["ns1:AUTOS_Cotizar_PHPResult"] ||
            body?.["AUTOS_Cotizar_PHPResponse"]?.["AUTOS_Cotizar_PHPResult"] ||
            body?.[`${method}Response`]?.[`${method}Result`] ||
            null;

          let payload = result;
          if (typeof payload === "string") {
            try { payload = parser.parse(payload); } catch {}
          }
          const auto =
            payload?.auto ||
            payload?.doc_out?.auto ||
            payload?.DOC_OUT?.auto ||
            null;

          const operacion = auto?.operacion || auto?.Operacion || null;
          const coberturas = Array.isArray(auto?.coberturas?.cobertura) ? auto.coberturas.cobertura : [];

          return res.status(200).json({
            ok:true,
            operacion,
            coberturas,
            used: { url, method, soapAction: cand.soapAction }
          });
        } else {
          lastError = `HTTP ${resp.status}`;
        }
      } catch (e) {
        lastError = e.message || "axios error";
      }
    }

    return res.status(502).json({
      ok:false,
      error:"ATM SOAP error (PHP)",
      raw:{ message:lastError, response: rawResp ? String(rawResp).slice(0,4000) : null }
    });
  } catch (err) {
    console.error("Error en /atm/cotizar-php:", err);
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

// ---------- 3) Ruta batch ----------
router.post("/cotizar-php-batch", async (req, res) => {
  const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
  ensureDir(dbgDir);

  try {
    const cfg = loadAtmConfig();

    const fmt = (req.body && req.body.fecha_formato) || cfg.dateFormat || "ddMMyyyy";
    const hoy = formatByPattern(new Date(), fmt);
    try { fs.writeFileSync(path.join(dbgDir, "last_date_format.txt"), fmt, "utf8"); } catch {}

    const url = (process.env.ATM_SOAP_URL || "").trim() || cfg.soapUrl;
    const method = (process.env.ATM_SOAP_METHOD || "").trim() || cfg.soapMethod;

    const ATM_USER = cfg.usuario;
    const ATM_PASS = cfg.password;
    const ATM_VENDEDOR = cfg.vendedor;
    const ATM_SECCION = (process.env.ATM_SECCION || cfg.seccionDefault || "3").toString();
    const ORIGEN = cfg.origen || "WS";

    let rows = [];
    if (Array.isArray(req.body?.items)) {
      rows = req.body.items;
    } else if (req.body?.archivo) {
      const abs = toAbs(req.body.archivo);
      if (!abs || !fs.existsSync(abs)) {
        return res.status(400).json({ ok:false, error:`No se encuentra el archivo: ${req.body.archivo}` });
      }
      if (abs.toLowerCase().endsWith(".csv")) {
        const content = fs.readFileSync(abs, "utf8");
        const lines = content.split(/\r?\n/).filter(Boolean);
        const headers = lines.shift().split(",").map(s=>s.trim());
        for (const ln of lines) {
          const cols = ln.split(","); const obj = {};
          headers.forEach((h,i)=> obj[h] = cols[i] ?? "");
          rows.push(obj);
        }
      } else {
        const wb = xlsx.readFile(abs);
        const hoja = wb.SheetNames.find(n => xlsx.utils.sheet_to_json(wb.Sheets[n], {defval:""}).length>0) || wb.SheetNames[0];
        rows = xlsx.utils.sheet_to_json(wb.Sheets[hoja], {defval:""});
      }
    } else {
      return res.status(400).json({ ok:false, error:"Falta 'archivo' o 'items' en el body" });
    }

    const limite = Math.max(1, Math.min(Number(req.body?.limite || 10), rows.length));
    const out = [];
    const parser = new XMLParser({ ignoreAttributes:false, trimValues:true });

    for (let i = 0; i < limite; i++) {
      const r = rows[i] || {};
      const codia = pick([r.tau_codia, r.codia, r.CODIA, r.Codia]);
      const anio  = pick([r.anio, r.anofab, r.ANO, r.Anio, r.ano]);
      const cp    = pick([r.codigo_postal, r.codpostal, r.CP, r.cp, r.CodigoPostal]);
      const uso   = pick([r.uso, r.Uso]) || "Particular";

      const docIn = `
<doc_in>
  <usuario>
    <usu>${ATM_USER}</usu>
    <pas>${ATM_PASS}</pas>
    <fecha>${hoy}</fecha>
    <vendedor>${ATM_VENDEDOR}</vendedor>
    <origen>${ORIGEN}</origen>
  </usuario>
  <cotizacion>
    <seccion>${ATM_SECCION}</seccion>
    <fechacotizacion>${hoy}</fechacotizacion>
    <fechavigenciadesde>${hoy}</fechavigenciadesde>
  </cotizacion>
  <auto>
    <vehiculo>
      <codia>${codia}</codia>
      <anio>${anio}</anio>
      <cp>${cp}</cp>
      <uso>${uso}</uso>
    </vehiculo>
  </auto>
</doc_in>`.trim();

      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <${method} xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${method}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

      const candidates = [
        { soapAction: `http://tempuri.org/${method}` },
        { soapAction: `${method}` },
        { soapAction: `urn:${method}` },
      ];

      let rowRes = { index:i, codia, anio, cp, uso, ok:false, operacion:null, coberturas:[], error:null, used:null };
      let rawResp = null;

      for (const cand of candidates) {
        try {
          const resp = await axios.post(url, envelope, {
            headers: { "Content-Type": "text/xml; charset=UTF-8", "SOAPAction": cand.soapAction },
            timeout: 20000, validateStatus: () => true
          });
          rawResp = resp.data;

          if (resp.status >= 200 && resp.status < 300) {
            const parsed = parser.parse(String(rawResp || ""));
            const body = parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"] || parsed?.Envelope?.Body || null;
            const result =
              body?.["ns1:AUTOS_Cotizar_PHPResponse"]?.["ns1:AUTOS_Cotizar_PHPResult"] ||
              body?.["AUTOS_Cotizar_PHPResponse"]?.["AUTOS_Cotizar_PHPResult"] ||
              body?.[`${method}Response`]?.[`${method}Result`] || null;

            let payload = result;
            if (typeof payload === "string") { try { payload = parser.parse(payload); } catch {} }

            const auto =
              payload?.auto ||
              payload?.doc_out?.auto ||
              payload?.DOC_OUT?.auto || null;

            const operacion = auto?.operacion || auto?.Operacion || null;
            const coberturas = Array.isArray(auto?.coberturas?.cobertura) ? auto.coberturas.cobertura : [];

            rowRes.ok = true;
            rowRes.operacion = operacion;
            rowRes.coberturas = coberturas;
            rowRes.used = { soapAction: cand.soapAction };
            break;
          } else {
            rowRes.error = `HTTP ${resp.status}`;
          }
        } catch (e) {
          rowRes.error = e.message || "axios error";
        }
      }

      out.push(rowRes);
      try { fs.writeFileSync(path.join(dbgDir, "last_soap_response.xml"), String(rawResp || ""), "utf8"); } catch {}
    }

    try { fs.writeFileSync(path.join(dbgDir, "last_batch.json"), JSON.stringify(out, null, 2), "utf8"); } catch {}

    return res.status(200).json({ ok:true, totalIntentados: out.length, resultados: out });
  } catch (err) {
    console.error("Error en /atm/cotizar-php-batch:", err);
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

module.exports = router;

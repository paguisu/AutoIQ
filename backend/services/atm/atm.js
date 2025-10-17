// backend/services/atm/atm.js
const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");

// Core ATM (index.js en ESTA carpeta)
const atmService = require("./index");

const {
  buildAxios,
  buildSoapEnvelope,
  xmlToJson,
  pickEnv,
  getVigenciaOffsetDays,
  normalizeVigenciaDates,
  formatDDMMYYYY,
} = require("./client");

// ---- util: elegir función de cotización disponible en el core ----
function pickCotizarFn(svc) {
  if (!svc) return null;
  const candidates = [
    "cotizar",
    "cotizarSoapDemo",
    "cotizarSOAP",
    "cotizarWs",
    "cotizarWS",
    "cotizarSoap",
    "quote",
  ];
  for (const name of candidates) {
    if (typeof svc[name] === "function") return svc[name].bind(svc);
  }
  return null;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ======================= RUTAS =======================

// POST /atm/cotizar
router.post("/cotizar", async (req, res) => {
  try {
    const svc = typeof atmService === "function" ? atmService() : atmService;

    // Normalizar fechas (ddMMyyyy) y asegurar `fecha` (minúscula)
    const offset = getVigenciaOffsetDays();
    const bodyNorm = normalizeVigenciaDates(req.body || {}, offset);

    const fn = pickCotizarFn(svc);
    if (!fn) {
      const keys = Object.keys(svc || {});
      console.error("[ATM] No encontré función de cotización en el core. Claves exportadas:", keys);
      return res.status(500).json({
        ok: false,
        error: "Core ATM no expone función de cotización conocida",
        exportedKeys: keys,
      });
    }

    const result = await fn(bodyNorm);

    if (result && result.ok) {
      return res.status(200).json(result.data ?? result);
    }

    if (result && (result.error || result.raw)) {
      return res.status(502).json({
        ok: false,
        error: result.error || "Error en core ATM",
        raw: result.raw ?? null,
      });
    }

    return res.status(500).json({ ok: false, error: "Error de cotización" });
  } catch (err) {
    console.error("[ATM][cotizar] error:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// ======== MARCAS (SOAP: ws_au_marcas) ========
async function fetchMarcas() {
  const { ATM_BASE_URL, ATM_USER, ATM_PASS, ATM_VENDEDOR } = pickEnv();

  const ddmmyyyy = formatDDMMYYYY(new Date(), getVigenciaOffsetDays());

  const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${ATM_USER}</usa>
      <pass>${ATM_PASS}</pass>
      <fecha>${ddmmyyyy}</fecha>
      <vendedor>${ATM_VENDEDOR}</vendedor>
      <origen>WS</origen>
    </usuario>
  </auto>
</doc_in>`.trim();

  const soapBody = `
    <ws_au_marcas xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </ws_au_marcas>
  `.trim();

  const envelope = buildSoapEnvelope(soapBody);

  // baseURL normalizado (acepta que ATM_BASE_URL tenga o no /index.php/soap)
  const base = (process.env.ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/, "");
  const baseURL = /\/index\.php\/soap$/i.test(base) ? base : `${base}/index.php/soap`;

  const axios = buildAxios({ baseURL });

  // --- carpeta para debug ---
  const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
  ensureDir(dbgDir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const httpRawPath = path.join(dbgDir, `marcas_${ts}.xml`);

  const tryOnce = async (soapAction) => {
    const r = await axios.post("", envelope, {
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "SOAPAction": soapAction,
      },
      validateStatus: () => true,
    });
    return { res: r, soapAction };
  };

  // 1) Intento “tempuri”
  let { res, soapAction } = await tryOnce("http://tempuri.org/ws_au_marcas");

  // 2) Si 500 y “not present”, intento “urn”
  const bodyStr1 = String(res.data ?? "");
  if (res.status === 500 && bodyStr1.includes("not present")) {
    const r2 = await tryOnce("urn:ws_au_marcas");
    res = r2.res;
    soapAction = r2.soapAction;
  }

  // Guardar HTTP crudo
  try { fs.writeFileSync(httpRawPath, String(res.data ?? ""), "utf8"); } catch {}

  // Primer parseo: Envelope → Body → ws_au_marcasResponse → ws_au_marcasResult
  const parsed = await xmlToJson(res.data, [
    "ws_au_marcasResponse",
    "ws_au_marcasResult",
  ]);

  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.fault || `Respuesta inválida (HTTP ${res.status})`,
      raw: { http_raw_path: httpRawPath, http_status: res.status, soapAction },
    };
  }

  // Si data es string/CDATA, segundo parseo buscando <auto>…</auto>
  let root = parsed.data;
  if (typeof root === "string") {
    const inner = await xmlToJson(root, ["auto"]);
    if (inner.ok) {
      root = inner.data || {};
    } else {
      return {
        ok: true,
        marcas: [],
        raw: { http_raw_path: httpRawPath, http_status: res.status, soapAction, doc_out: root }
      };
    }
  } else {
    root = root?.auto || root || {};
  }

  const candidatos = [
    root?.marcas?.marca, // forma común: auto → marcas → marca[]
    root?.marca,         // fallback
  ].filter(Boolean);

  const lista = Array.isArray(candidatos[0])
    ? candidatos[0]
    : candidatos[0]
    ? [candidatos[0]]
    : [];

  const marcas = lista.map((m) => ({
    codigo: Number(m.codigo ?? m.cod ?? m.id ?? 0),
    descripcion: String(m.descripcion ?? m.desc ?? m.nombre ?? "").trim(),
    raw: m,
  }));

  return { ok: true, marcas, raw: { http_raw_path: httpRawPath, http_status: res.status, soapAction } };
}

// GET /atm/marcas
router.get("/marcas", async (req, res) => {
  try {
    const r = await fetchMarcas();
    if (!r.ok) return res.status(502).json({ ok: false, error: r.error, raw: r.raw });
    if ((req.query.raw === "1" || req.query.raw === "true") && r.raw) {
      return res.json({ ok: true, count: r.marcas.length, marcas: r.marcas, raw: r.raw });
    }
    return res.json({ ok: true, count: r.marcas.length, marcas: r.marcas });
  } catch (e) {
    console.error("[ATM][marcas] error:", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ===== DEBUG: ver SOAP crudo y status sin leer archivos =====
router.get("/marcas_raw", async (req, res) => {
  try {
    const { ATM_BASE_URL } = pickEnv();
    const ddmmyyyy = formatDDMMYYYY(new Date(), getVigenciaOffsetDays());

    const { ATM_USER, ATM_PASS, ATM_VENDEDOR } = pickEnv();
    const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${ATM_USER}</usa>
      <pass>${ATM_PASS}</pass>
      <fecha>${ddmmyyyy}</fecha>
      <vendedor>${ATM_VENDEDOR}</vendedor>
      <origen>WS</origen>
    </usuario>
  </auto>
</doc_in>`.trim();

    const soapBody = `
      <ws_au_marcas xmlns="http://tempuri.org/">
        <doc_in><![CDATA[${docIn}]]></doc_in>
      </ws_au_marcas>
    `.trim();

    const envelope = buildSoapEnvelope(soapBody);
    const base = (ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/, "");
    const baseURL = /\/index\.php\/soap$/i.test(base) ? base : `${base}/index.php/soap`;
    const axios = buildAxios({ baseURL });

    // mismo fallback que fetchMarcas
    const tryOnce = async (soapAction) => {
      const r = await axios.post("", envelope, {
        headers: { "Content-Type": "text/xml; charset=UTF-8", "SOAPAction": soapAction },
        validateStatus: () => true,
      });
      return { r, soapAction };
    };

    let { r, soapAction } = await tryOnce("http://tempuri.org/ws_au_marcas");
    const bodyStr = String(r.data ?? "");
    if (r.status === 500 && bodyStr.includes("not present")) {
      const r2 = await tryOnce("urn:ws_au_marcas");
      r = r2.r;
      soapAction = r2.soapAction;
    }

    res.status(200).json({
      ok: true,
      httpStatus: r.status,
      baseURL,
      soapAction,
      sample: String(r.data ?? "").slice(0, 800)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// --- DEBUG: probar combinaciones de endpoint/action/ns para ws_au_marcas ---
router.get("/marcas_probe", async (req, res) => {
  try {
    const { pickEnv, buildAxios, buildSoapEnvelope, formatDDMMYYYY, getVigenciaOffsetDays } = require("./client");
    const { ATM_BASE_URL, ATM_USER, ATM_PASS, ATM_VENDEDOR } = pickEnv();

    // Candidatos de endpoint (muchos servers de ATM cambian el sufijo)
    const base = (process.env.ATM_BASE_URL || ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/, "");
    const endpoints = [
      `${base}/index.php/soap`,
      `${base}/index.php/soap/auto`,
      `${base}/index.php/soap/au`,
      `${base}/soap`,
    ];

    // Candidatos de acción / xmlns
    const actions = [
      { soapAction: "http://tempuri.org/ws_au_marcas", xmlns: 'http://tempuri.org/' },
      { soapAction: "urn:ws_au_marcas",                xmlns: 'urn:' },
      { soapAction: "",                                 xmlns: 'http://tempuri.org/' }, // algunos ignoran SOAPAction
      { soapAction: "",                                 xmlns: 'urn:' },
    ];

    const ddmmyyyy = formatDDMMYYYY(new Date(), getVigenciaOffsetDays());
    const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${ATM_USER}</usa>
      <pass>${ATM_PASS}</pass>
      <fecha>${ddmmyyyy}</fecha>
      <vendedor>${ATM_VENDEDOR}</vendedor>
      <origen>WS</origen>
    </usuario>
  </auto>
</doc_in>`.trim();

    const tries = [];
    for (const ep of endpoints) {
      const axios = buildAxios({ baseURL: ep });
      for (const a of actions) {
        const soapBody = `
          <ws_au_marcas xmlns="${a.xmlns}">
            <doc_in><![CDATA[${docIn}]]></doc_in>
          </ws_au_marcas>
        `.trim();
        const envelope = buildSoapEnvelope(soapBody);
        let httpStatus = 0, sample = "", ok=false, fault=null;

        try {
          const r = await axios.post("", envelope, {
            headers: {
              "Content-Type": "text/xml; charset=UTF-8",
              ...(a.soapAction !== "" ? { "SOAPAction": a.soapAction } : {}),
            },
            validateStatus: () => true,
          });
          httpStatus = r.status;
          sample = String(r.data ?? "").slice(0, 600);

          // Heurística: si NO aparece "Fault" y sí aparece "ws_au_marcasResponse" ó "marcas"
          const isFault = /<Fault>|Procedure .* not present/i.test(sample);
          const looksOk = /ws_au_marcasResponse|ws_au_marcasResult|<marcas>|<marca>/i.test(sample);
          ok = !isFault && looksOk;
          if (isFault) fault = "Fault/Procedure not present";

        } catch (e) {
          sample = (e && e.message) ? e.message : String(e);
        }

        tries.push({
          endpoint: ep,
          soapAction: a.soapAction || "(empty)",
          xmlns: a.xmlns,
          httpStatus,
          ok,
          fault,
          sample
        });
      }
    }

    // Elegimos el “mejor” intento: ok=true y mejor httpStatus; sino devolvemos todos
    const winner = tries.find(t => t.ok) || null;
    res.json({ ok: !!winner, winner, tries });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

module.exports = router;
module.exports.fetchMarcas = fetchMarcas;

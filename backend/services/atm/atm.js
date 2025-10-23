// backend/services/atm/atm.js
const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");

// Core ATM (index.js en ESTA carpeta) – lo dejamos cargado por si necesitás /cotizar clásico
let atmService = null;
try {
  atmService = require("./index");
} catch (_) {
  atmService = null;
}

// IMPORT desde client.js (¡una sola fuente de verdad!)
const {
  buildSoapEnvelope,
  pickEnv,
  getVigenciaOffsetDays,
  normalizeVigenciaDates,
  formatDDMMYYYY,
  cotizarSoapDemo,
} = require("./client");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Util para armar un doc_in de debug (usando ddMMyyyy)
function buildDocInForDebug(bodyPlain, env) {
  return `
<doc_in>
  <auto>
    <usuario>
      <usa>${env.ATM_USER}</usa>
      <pass>${env.ATM_PASS}</pass>
      <fecha>${bodyPlain.Fecha}</fecha>
      <vendedor>${env.ATM_VENDEDOR}</vendedor>
      <origen>WS</origen>
    </usuario>
    <cotizacion>
      <seccion>${bodyPlain.Seccion || env.ATM_SECCION || "3"}</seccion>
      <fechacotizacion>${bodyPlain.FechaCotizacion}</fechacotizacion>
      <fechavigenciadesde>${bodyPlain.VigenciaDesde}</fechavigenciadesde>
    </cotizacion>
    <vehiculo>
      <codia>${bodyPlain.tau_codia || ""}</codia>
      <anio>${bodyPlain.anio || ""}</anio>
      <cp>${bodyPlain.codigo_postal || ""}</cp>
      <uso>${bodyPlain.uso || "Particular"}</uso>
    </vehiculo>
  </auto>
</doc_in>`.trim();
}

// ======================= RUTAS =======================

// POST /atm/cotizar-soap-demo
// Normaliza fechas y envía ddMMyyyy en los dos campos requeridos por ATM
router.post("/cotizar-soap-demo", async (req, res) => {
  try {
    const offset = getVigenciaOffsetDays(); // respeta ATM_VIGENCIA_OFFSET_DAYS o 0 por defecto
    const { bodySlash, bodyPlain } = normalizeVigenciaDates(req.body || {}, offset);

    // Si no vinieron fechas en el body, usar HOY
    const hoyPlain = formatDDMMYYYY(new Date());
    bodyPlain.Fecha = bodyPlain.Fecha || hoyPlain;
    bodyPlain.FechaCotizacion = bodyPlain.FechaCotizacion || bodyPlain.Fecha;
    bodyPlain.VigenciaDesde = bodyPlain.VigenciaDesde || bodyPlain.Fecha;

    // Guardamos XML de debug
    const env = pickEnv();
    const docInDebug = buildDocInForDebug(bodyPlain, env);
    const dbgDir = path.join(process.cwd(), "data", "atm", "debug");
    ensureDir(dbgDir);
    fs.writeFileSync(path.join(dbgDir, "last_doc_in.xml"), docInDebug, "utf8");

    // Llamada real
    const result = await cotizarSoapDemo({
      ...req.body,
      Fecha: bodyPlain.Fecha,
      FechaCotizacion: bodyPlain.FechaCotizacion,
      VigenciaDesde: bodyPlain.VigenciaDesde,
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error("[/atm/cotizar-soap-demo]", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;
                     


const express = require("express");
const router = express.Router();

// Servicio “core” ATM (tu index.js). OJO: desde atm.js (carpeta services/atm) el path ../atm
// resuelve a services/atm/index.js (si existe), que es lo que queremos.
const atmService = require("../atm");

// === Routes ===

// Cotizar (como ya tenías)
router.post("/cotizar", async (req, res) => {
  try {
    // En tu diseño anterior era una factoría: atmService() -> { cotizar, ... }
    // Si en tu index.js exportás directamente funciones, cambiamos a: const { cotizar } = atmService;
    const svc = typeof atmService === "function" ? atmService() : atmService;
    const result = await (svc.cotizar?.(req.body));
    if (result && result.ok) return res.status(200).json(result.data);
    return res.status(result?.status || 500).json({ error: result?.error || "Error de cotización" });
  } catch (err) {
    console.error("[ATM][cotizar] error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ===== MARCAS =====
// Reutilizamos utilidades del cliente SOAP
const { buildAxios, buildSoapEnvelope, xmlToJson, pickEnv } = require("./client");

/**
 * Llama al método SOAP ws_au_marcas y devuelve un array de marcas.
 * Normaliza a: { ok:true, marcas:[{codigo, descripcion, raw}], raw }
 */
async function fetchMarcas() {
  const { ATM_BASE_URL, ATM_USER, ATM_PASS, ATM_VENDEDOR } = pickEnv();

  // Fecha ddmmaaaa
  const hoy = new Date();
  const ddmmaaaa = hoy.toISOString().slice(0, 10).split("-").reverse().join("");

  const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${ATM_USER}</usa>
      <pass>${ATM_PASS}</pass>
      <fecha>${ddmmaaaa}</fecha>
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

  // Normalizamos baseURL: aceptamos que .env tenga con o sin /index.php/soap
  const base = (ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/, "");
  const baseURL = /\/index\.php\/soap$/i.test(base) ? base : `${base}/index.php/soap`;
  const axios = buildAxios({ baseURL });

  const res = await axios.post("", envelope, {
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      "SOAPAction": "http://tempuri.org/ws_au_marcas",
    },
    validateStatus: () => true,
  });

  const parsed = await xmlToJson(res.data, [
    "ws_au_marcasResponse",
    "ws_au_marcasResult",
    "auto",
  ]);

  if (!parsed.ok) {
    return { ok: false, error: parsed.fault || `Respuesta inválida (HTTP ${res.status})`, raw: parsed.raw ?? res.data };
  }

  const root = parsed.data || {};
  const candidatos = [
    root.marcas?.marca,
    root.marca,
  ].filter(Boolean);

  const lista = Array.isArray(candidatos[0]) ? candidatos[0] : (candidatos[0] ? [candidatos[0]] : []);
  const marcas = lista.map((m) => ({
    codigo: Number(m.codigo ?? m.cod ?? m.id ?? 0),
    descripcion: String(m.descripcion ?? m.desc ?? m.nombre ?? "").trim(),
    raw: m,
  }));

  return { ok: true, marcas, raw: root };
}

// GET /atm/marcas → usa fetchMarcas()
router.get("/marcas", async (req, res) => {
  try {
    const r = await fetchMarcas();
    if (!r.ok) return res.status(502).json({ ok: false, error: r.error, raw: r.raw });
    return res.json({ ok: true, count: r.marcas.length, marcas: r.marcas });
  } catch (e) {
    console.error("[ATM][marcas] error:", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Exportamos el router (para app.use('/atm', router))…
module.exports = router;
// …y además colgamos fetchMarcas para poder requerirlo desde otros módulos si hace falta.
module.exports.fetchMarcas = fetchMarcas;

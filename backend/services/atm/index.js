// backend/services/atm/index.js
// Servicio ATM: acá van SOLO funciones de negocio (no routers Express)

const { buildAxios, buildSoapEnvelope, xmlToJson, pickEnv } = require("./client");

/**
 * ws_au_marcas: trae catálogo de marcas desde ATM.
 * Devuelve { ok:true, marcas:[{codigo, descripcion, raw}], raw }
 */
async function fetchMarcas() {
  const { ATM_BASE_URL, ATM_USER, ATM_PASS, ATM_VENDEDOR } = pickEnv();

  // ATM_BASE_URL puede venir sin el /index.php/soap → lo normalizamos
  const soapUrlBase = (ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/, "");
  const axios = buildAxios({ baseURL: `${soapUrlBase}/index.php/soap` });

  // ddmmaaaa
  const hoy = new Date();
  const ddmmaaaa = hoy.toISOString().slice(0, 10).split("-").reverse().join("");

  // El doc_in debe ir como CDATA (igual que hicimos para cotizar)
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

  const res = await axios.post("", envelope, {
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      "SOAPAction": "http://tempuri.org/ws_au_marcas",
    },
    validateStatus: () => true,
  });

  // Parseo XML → JSON; los nombres con ns1 pueden variar
  const parsed = await xmlToJson(res.data, [
    "ws_au_marcasResponse",
    "ws_au_marcasResult",
    "auto",
  ]);

  if (!parsed.ok) {
    return { ok: false, error: parsed.fault || `Respuesta inválida (HTTP ${res.status})`, raw: parsed.raw ?? res.data };
  }

  const root = parsed.data || {};
  // Distintas formas en que puede venir:
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

module.exports = {
  fetchMarcas,
};


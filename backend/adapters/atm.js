/**
 * Adapter ATM para mq_runner
 * - Define la tabla de destino y cómo construir el payload/endpoint.
 */
const axios = require("axios");

function pick(row, col) {
  const v = row[col];
  return v == null ? null : String(v).trim();
}
function pickNum(row, col) {
  const v = row[col];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildPayload(row, mapping, cfg) {
  const out = {};
  // requeridos (según mapping)
  for (const req of (mapping.requiredFields || [])) {
    const spec = mapping.fields?.[req];
    if (!spec || !spec.sourceColumn) throw new Error(`Mapping inválido: falta sourceColumn para '${req}'`);
    const v = spec.type === "number" ? pickNum(row, spec.sourceColumn) : pick(row, spec.sourceColumn);
    if (v == null || v === "") throw new Error(`Falta campo requerido '${req}' (XLSX: '${spec.sourceColumn}')`);
    out[req] = v;
  }
  // opcionales
  for (const [k, spec] of Object.entries(mapping.fields || {})) {
    if ((mapping.requiredFields || []).includes(k)) continue;
    const v = spec.type === "number" ? pickNum(row, spec.sourceColumn) : pick(row, spec.sourceColumn);
    if (v != null && v !== "") out[k] = v;
  }
  // credenciales/sección
  out.Usa = cfg.credenciales?.Usa;
  out.Password = cfg.credenciales?.Password;
  out.Vendedor = cfg.credenciales?.Vendedor;
  if (cfg.seccion != null) out.Seccion = String(cfg.seccion);
  return out;
}

module.exports = {
  name: "ATM",
  table: "cotizaciones_atm",
  endpointFromConfig: (cfg) => cfg.local_endpoint || "http://127.0.0.1:3000/atm/cotizar-soap-demo",
  buildPayload,
  async post(endpoint, payload) {
    const resp = await axios.post(endpoint, payload, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
    return resp.data;
  },
  // columnas extra opcionales a persistir en la tabla (si existen)
  extractDbColumns(row, mapping, payload) {
    // mapeamos a columnas de la tabla ATM si están: cod_infoauto, anio, codigo_postal, patente
    const res = {};
    if (payload.tau_codia != null) res.cod_infoauto = String(payload.tau_codia);
    if (payload.anio != null)      res.anio = Number(payload.anio);
    if (payload.codigo_postal != null) res.codigo_postal = String(payload.codigo_postal);
    if (payload.patente != null)   res.patente = String(payload.patente);
    return res;
  }
};

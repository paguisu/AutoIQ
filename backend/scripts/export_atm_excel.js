/**
 * AutoIQ — Export Excel de cotizaciones ATM por proceso_id (v2.1)
 * ---------------------------------------------------------------
 * Genera un .xlsx con:
 *  - Resumen (con total real: OK + Error)
 *  - OK (aseguradora, datos vehículo/ubicación, cabecera, fecha/hora, operación, productos por columna, links RR)
 *  - Errores (intento de cotización, tipo/desc de error y links RR)
 *
 * Este export ignora el status almacenado en DB y clasifica por el valor real
 * de response_json.raw.statusSuccess (TRUE => OK, FALSE => Error).
 *
 * Requisitos: npm i mysql2 xlsx
 *
 * Uso:
 *  node backend/scripts/export_atm_excel.js --proceso-id=8 --out="D:/AutoIQ/data/atm/res/proceso_8.xlsx"
 *    (si omitís --out, lo guarda en carpeta_resultados del proceso)
 *
 * Opcional: mapa de CP → localidad/provincia
 *  backend/config/geo/cp_map.json con estructura:
 *   {
 *     "1000": {"localidad":"CABA","provincia":"CABA"},
 *     "5000": {"localidad":"Córdoba","provincia":"Córdoba"}
 *   }
 */

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const xlsx = require("xlsx");

// ---------- helpers ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const [k, ...rest] = argv[i].slice(2).split("=");
    out[k] = rest.length ? rest.join("=") : true;
  }
  return out;
}

function toFlat(obj, prefix = "", out = {}) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      toFlat(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out[prefix || "value"] = obj;
  }
  return out;
}

function safeStr(v) { return v == null ? "" : String(v); }
function safeNum(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function fmtDate(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtTime(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  const hh = String(dt.getHours()).padStart(2,'0');
  const mm = String(dt.getMinutes()).padStart(2,'0');
  const ss = String(dt.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

function firstString(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}
function firstNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return "";
}

// intenta extraer suma asegurada / combustible / tipo de vehículo y coberturas del response (robusto a nombres)
function extractFromResponse(resp) {
  const flat = toFlat(resp || {});
  // suma asegurada: busca claves que contengan "suma" y "asegur"
  const sumaKey = Object.keys(flat).find(k => /suma/i.test(k) && /asegur/i.test(k));
  const sumaAsegurada = sumaKey ? flat[sumaKey] : "";

  // combustible
  const combKey = Object.keys(flat).find(k => /combust/i.test(k));
  const combustible = combKey ? flat[combKey] : "";

  // tipo de vehículo
  const tipoKey = Object.keys(flat).find(k => /(tipo.*vehic|clase.*vehic|vehic.*tipo)/i.test(k));
  const tipoVehiculo = tipoKey ? flat[tipoKey] : "";

  // operación ATM
  const operacion = (resp && (resp.operacion || (resp.raw && resp.raw.operacion))) || "";

  // coberturas (productos) — preferimos "codigo"; si no hay, armamos por nombre normalizado
  let productos = {};
  const cob = (resp && (resp.coberturas || resp.Coberturas)) || [];
  if (Array.isArray(cob)) {
    for (const it of cob) {
      const code = it?.codigo || it?.Codigo || null;
      const name = it?.nombre || it?.Nombre || it?.plan || it?.Plan || it?.cobertura || it?.Cobertura || "";
      const price = it?.precio ?? it?.Precio ?? it?.premio ?? it?.Premio ?? it?.total ?? it?.Total ?? "";
      let col;
      if (code) col = `prod_${String(code).toString().trim()}`; // estable por código
      else col = `prod_${String(name).trim().replace(/\s+/g, "_").toLowerCase()}`;
      if (col) productos[col] = price;
    }
  }
  // statusSuccess real
  const statusSuccess = String(flat["raw.statusSuccess"] ?? resp.statusSuccess ?? "").toUpperCase();
  const statusMsg = firstString(flat["raw.statusText.msg"], flat["statusText.msg"], resp?.msg);

  return { sumaAsegurada, combustible, tipoVehiculo, operacion, productos, flat, statusSuccess, statusMsg };
}

// construye key única de una fila del XLSX para ubicar archivo RR
function buildKeyFromRowObj(row, mapping) {
  const tau = getByMap(row, mapping, "tau_codia");
  const anio = getByMap(row, mapping, "anio");
  const cp = getByMap(row, mapping, "codigo_postal");
  return [safeStr(tau), safeStr(anio), safeStr(cp)].join("|");
}
function getByMap(row, mapping, field) {
  const sc = mapping?.fields?.[field]?.sourceColumn;
  return sc ? row[sc] : null;
}

function loadCpMap() {
  const p = path.join("backend", "config", "geo", "cp_map.json");
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
  }
  return null;
}

function addHyperlinkCell(sheet, cellRef, filePath, label) {
  sheet[cellRef] = { f: `HYPERLINK("file:///${filePath.replace(/\\/g,"/")}", "${label}")` };
}

function tipoErrorDesdeMensaje(msg) {
  if (!msg) return "ERROR";
  const m = String(msg);
  if (m.includes("ECONNREFUSED")) return "CONEXION";
  if (/timeout/i.test(m)) return "TIMEOUT";
  if (m.startsWith("{") || m.startsWith("[")) return "RESPUESTA_WS";
  return "VALIDACION";
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const procesoId = Number(args["proceso-id"]);
  let outPath = args.out;

  if (!Number.isFinite(procesoId)) {
    console.error("Falta --proceso-id (ej: --proceso-id=8)");
    process.exit(1);
  }

  // DB
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "autoiq",
    charset: "utf8mb4",
    dateStrings: true // devuelve DATETIME como 'YYYY-MM-DD HH:MM:SS'
  });

  try {
    // Proceso
    const [pRows] = await conn.execute(
      `SELECT id, nombre, fecha_inicio, fecha_fin, estado, ruta_archivo_combinatorio,
              carpeta_request_response, carpeta_resultados,
              registros_procesados, cotizaciones_exitosas, cotizaciones_con_error
       FROM procesos_cotizacion WHERE id = ?`, [procesoId]
    );
    if (!pRows.length) throw new Error(`No existe proceso_id=${procesoId}`);
    const proc = pRows[0];

    // Cargar mapping y XLSX para poder localizar fila→RR
    const mappingPath = path.join("backend", "config", "mappings", "atm.mapping.json");
    const mapping = fs.existsSync(mappingPath) ? JSON.parse(fs.readFileSync(mappingPath, "utf8")) : null;
    const rrDir = proc.carpeta_request_response || "";
    const resultDir = proc.carpeta_resultados || "";

    let xrows = [];
    if (proc.ruta_archivo_combinatorio && fs.existsSync(proc.ruta_archivo_combinatorio)) {
      try {
        const wbS = xlsx.readFile(proc.ruta_archivo_combinatorio);
        const sheetS = wbS.Sheets[wbS.SheetNames[0]];
        xrows = xlsx.utils.sheet_to_json(sheetS, { defval: null });
      } catch {}
    }

    // Mapa: key(row) -> index (1-based) para formar fila_000001
    const xKeyToIndex = new Map();
    if (mapping && xrows.length) {
      xrows.forEach((r, idx) => {
        const key = buildKeyFromRowObj(r, mapping);
        if (key) xKeyToIndex.set(key, idx + 1);
      });
    }

    // cp map opcional
    const cpMap = loadCpMap();

    // OUT path
    if (!outPath) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const folder = resultDir || path.join(process.cwd(), "data", "atm", "resultados", `proc_${procesoId}`);
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      outPath = path.join(folder, `atm_proceso_${procesoId}_${ts}.xlsx`);
    } else {
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Traer TODAS las filas y clasificar por statusSuccess real
    const [allRows] = await conn.execute(
      `SELECT id, patente, cod_infoauto, marca, modelo, anio, codigo_postal,
              request_json, response_json, error_msg, started_at, finished_at, ms_duracion
       FROM cotizaciones_atm
       WHERE proceso_id = ?
       ORDER BY id`, [procesoId]
    );

    const okRows = [];
    const errRows = [];
    for (const r of allRows) {
      let resp = {};
      try { resp = JSON.parse(r.response_json || "{}"); } catch {}
      const { statusSuccess } = extractFromResponse(resp);
      if (statusSuccess === "TRUE") okRows.push(r);
      else errRows.push(r);
    }

    // -------- preparar columnas dinámicas de productos ----------
    const productosSet = new Set();
    for (const r of okRows) {
      let resp = {};
      try { resp = JSON.parse(r.response_json || "{}"); } catch {}
      const { productos } = extractFromResponse(resp);
      Object.keys(productos).forEach(k => productosSet.add(k));
    }
    const productosCols = Array.from(productosSet).sort(); // columnas de productos

    // -------- armar workbook ----------
    const wb = xlsx.utils.book_new();

    // RESUMEN (recuentos reales)
    const totalOk = okRows.length;
    const totalErr = errRows.length;
    const totalReal = totalOk + totalErr;

    const resumen = [
      ["Proceso ID", proc.id],
      ["Nombre", proc.nombre],
      ["Estado (tabla procesos)", proc.estado],
      ["Inicio", proc.fecha_inicio],
      ["Fin", proc.fecha_fin],
      ["Archivo combinado", proc.ruta_archivo_combinatorio || ""],
      ["Carpeta RR", rrDir],
      ["Carpeta resultados", resultDir],
      ["Registros procesados (OK+Error)", totalReal],
      ["OK (statusSuccess=TRUE)", totalOk],
      ["Errores (statusSuccess≠TRUE)", totalErr]
    ];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(resumen), "Resumen");

    // Cabecera común para OK
    const okHeaderFixed = [
      "aseguradora","id","resp_operacion",
      "patente","cod_infoauto","marca","modelo","anio",
      "codigo_postal","localidad","provincia",
      "tipo_vehiculo","combustible","suma_asegurada",
      "persona","estado_civil","edad","sexo",
      "ms_duracion","fecha","hora",
      "link_request","link_response"
    ];
    const okHeader = okHeaderFixed.concat(productosCols);
    const okAoA = [okHeader];

    for (const r of okRows) {
      let req = {}, resp = {};
      try { req = JSON.parse(r.request_json || "{}"); } catch {}
      try { resp = JSON.parse(r.response_json || "{}"); } catch {}

      const { sumaAsegurada, combustible, tipoVehiculo, operacion, productos } = extractFromResponse(resp);

      // fecha/hora separadas (preferimos finished_at si existe)
      const fh = r.finished_at || r.started_at || null;
      const fecha = fmtDate(fh);
      const hora  = fmtTime(fh);

      // localidad/provincia por CP
      let loc = "", prov = "";
      const cp = r.codigo_postal || req.codigo_postal || req.CodigoPostal || "";
      if (cpMap && cp && cpMap[cp]) {
        loc = cpMap[cp].localidad || "";
        prov = cpMap[cp].provincia || "";
      }

      // tipo_vehiculo por Seccion (3=Auto, 4=Moto) o de request
      const seccion = firstString(req.Seccion, req.seccion);
      const tipoVeh = tipoVehiculo || (seccion === "4" ? "Moto" : seccion === "3" ? "Auto" : firstString(req.tipo_vehiculo, req.tipo));

      // localizar archivo RR por key (para hiperlinks)
      let filaIdx = "";
      if (mapping && xrows.length) {
        const key = [safeStr(req.tau_codia || r.cod_infoauto), safeStr(req.anio || r.anio), safeStr(cp)].join("|");
        filaIdx = xKeyToIndex.get(key) || "";
      }
      const baseName = filaIdx ? `fila_${String(filaIdx).padStart(6, "0")}` : "";
      const reqPath = baseName ? path.join(rrDir, `${baseName}_request.json`) : "";
      const resPath = baseName ? path.join(rrDir, `${baseName}_response.json`) : "";

      const rowArr = [
        "ATM",                         // aseguradora
        r.id,                          // id AutoIQ
        safeStr(operacion),            // operacion ATM
        safeStr(r.patente),
        safeStr(r.cod_infoauto || req.tau_codia),
        safeStr(r.marca || req.marca),
        safeStr(r.modelo || req.modelo),
        safeNum(r.anio || req.anio),
        safeStr(cp),
        safeStr(loc), safeStr(prov),
        safeStr(tipoVeh),
        safeStr(combustible),
        safeStr(sumaAsegurada),
        safeStr(req.persona),
        safeStr(req.estado_civil),
        safeStr(req.edad),
        safeStr(req.sexo),
        safeNum(r.ms_duracion),
        safeStr(fecha), safeStr(hora),
        reqPath,                       // hiperlinks luego
        resPath
      ];

      // productos por columna
      for (const col of productosCols) {
        rowArr.push(productos[col] ?? "");
      }

      okAoA.push(rowArr);
    }
    const okSheet = xlsx.utils.aoa_to_sheet(okAoA);
    xlsx.utils.book_append_sheet(wb, okSheet, "OK");

    // convertir columnas link_* en HYPERLINK
    const linkReqIdx = okHeader.indexOf("link_request");
    const linkResIdx = okHeader.indexOf("link_response");
    for (let i = 1; i < okAoA.length; i++) {
      if (linkReqIdx >= 0) {
        const file = okAoA[i][linkReqIdx];
        if (file) addHyperlinkCell(okSheet, xlsx.utils.encode_cell({ c: linkReqIdx, r: i }), file, "ver request");
      }
      if (linkResIdx >= 0) {
        const file = okAoA[i][linkResIdx];
        if (file) addHyperlinkCell(okSheet, xlsx.utils.encode_cell({ c: linkResIdx, r: i }), file, "ver response");
      }
    }

    // ERRORES
    const errHeader = [
      "aseguradora","id","resp_operacion",
      "patente","cod_infoauto","marca","modelo","anio",
      "codigo_postal","localidad","provincia",
      "tipo_vehiculo","combustible","suma_asegurada",
      "persona","estado_civil","edad","sexo",
      "tipo_error","descripcion_error",
      "ms_duracion","fecha","hora",
      "link_request","link_response"
    ];
    const errAoA = [errHeader];

    for (const r of errRows) {
      let req = {}, resp = {};
      try { req = JSON.parse(r.request_json || "{}"); } catch {}
      try { resp = JSON.parse(r.response_json || "{}"); } catch {}

      const { sumaAsegurada, combustible, tipoVehiculo, operacion, statusMsg } = extractFromResponse(resp);

      const fh = r.finished_at || r.started_at || null;
      const fecha = fmtDate(fh);
      const hora  = fmtTime(fh);

      const cp = r.codigo_postal || req.codigo_postal || req.CodigoPostal || "";
      let loc = "", prov = "";
      if (cpMap && cp && cpMap[cp]) {
        loc = cpMap[cp].localidad || "";
        prov = cpMap[cp].provincia || "";
      }

      const seccion = firstString(req.Seccion, req.seccion);
      const tipoVeh = tipoVehiculo || (seccion === "4" ? "Moto" : seccion === "3" ? "Auto" : firstString(req.tipo_vehiculo, req.tipo));

      // RR
      let filaIdx = "";
      if (mapping && xrows.length) {
        const key = [safeStr(req.tau_codia || r.cod_infoauto), safeStr(req.anio || r.anio), safeStr(cp)].join("|");
        filaIdx = xKeyToIndex.get(key) || "";
      }
      const baseName = filaIdx ? `fila_${String(filaIdx).padStart(6, "0")}` : "";
      const reqPath = baseName ? path.join(rrDir, `${baseName}_request.json`) : "";
      const resPath = baseName ? path.join(rrDir, `${baseName}_response.json`) : "";

      const tipoErr = tipoErrorDesdeMensaje(r.error_msg || statusMsg);

      const rowArr = [
        "ATM",
        r.id,
        safeStr(operacion),
        safeStr(r.patente), safeStr(r.cod_infoauto || req.tau_codia), safeStr(r.marca || req.marca), safeStr(r.modelo || req.modelo),
        safeNum(r.anio || req.anio),
        safeStr(cp), safeStr(loc), safeStr(prov),
        safeStr(tipoVeh), safeStr(combustible), safeStr(sumaAsegurada),
        safeStr(req.persona), safeStr(req.estado_civil), safeStr(req.edad), safeStr(req.sexo),
        tipoErr, safeStr(r.error_msg || statusMsg || ""),
        safeNum(r.ms_duracion),
        safeStr(fecha), safeStr(hora),
        reqPath, resPath
      ];
      errAoA.push(rowArr);
    }

    const errSheet = xlsx.utils.aoa_to_sheet(errAoA);
    xlsx.utils.book_append_sheet(wb, errSheet, "Errores");

    // hyperlinks en Errores
    const eReqIdx = errHeader.indexOf("link_request");
    const eResIdx = errHeader.indexOf("link_response");
    for (let i = 1; i < errAoA.length; i++) {
      if (eReqIdx >= 0) {
        const file = errAoA[i][eReqIdx];
        if (file) addHyperlinkCell(errSheet, xlsx.utils.encode_cell({ c: eReqIdx, r: i }), file, "ver request");
      }
      if (eResIdx >= 0) {
        const file = errAoA[i][eResIdx];
        if (file) addHyperlinkCell(errSheet, xlsx.utils.encode_cell({ c: eResIdx, r: i }), file, "ver response");
      }
    }

    // Guardar archivo
    xlsx.writeFile(wb, outPath);
    console.log("Excel generado:", outPath);
  } finally {
    await conn.end();
  }
}

main().catch(e => { console.error("ERROR:", e?.message || e); process.exit(2); });

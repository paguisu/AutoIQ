/**
 * AutoIQ — Runner genérico de cotización masiva por aseguradora
 * -------------------------------------------------------------
 * Usa un adapter por compañía (backend/adapters/<aseguradora>.js)
 * y sus configs/mappings:
 *  - backend/config/aseguradoras/<aseguradora>.json
 *  - backend/config/mappings/<aseguradora>.mapping.json
 *
 * Requisitos: npm i mysql2 xlsx axios
 *
 * Uso:
 *   node backend/scripts/mq_runner.js --aseguradora=atm --proceso-id=7 [--dry-run=false] [--limit=10] [--from=0] [--verbose=true]
 */

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const xlsx = require("xlsx");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const [k, ...rest] = argv[i].slice(2).split("=");
    out[k] = rest.length ? rest.join("=") : true;
  }
  return out;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ensureDir = (p) => { if (p && !fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };

async function main() {
  const args = parseArgs(process.argv);
  const procesoId = Number(args["proceso-id"]);
  const aseguradora = String(args["aseguradora"] || "").toLowerCase();
  const dryRun = String(args["dry-run"] ?? "true").toLowerCase() !== "false";
  const verbose = String(args["verbose"] ?? "false").toLowerCase() === "true";
  const limit = args["limit"] != null ? Number(args["limit"]) : null;
  const from = args["from"] != null ? Number(args["from"]) : 0;

  if (!aseguradora) {
    console.error("Falta --aseguradora (ej: atm)");
    process.exit(1);
  }
  if (!Number.isFinite(procesoId)) {
    console.error("Falta --proceso-id (ej: --proceso-id=7)");
    process.exit(1);
  }

  // Cargar adapter + config + mapping
  const adapterPath = path.join("backend", "adapters", `${aseguradora}.js`);
  const cfgPath = path.join("backend", "config", "aseguradoras", `${aseguradora}.json`);
  const mapPath = path.join("backend", "config", "mappings", `${aseguradora}.mapping.json`);

  if (!fs.existsSync(adapterPath)) throw new Error(`No existe adapter: ${adapterPath}`);
  if (!fs.existsSync(cfgPath)) throw new Error(`No existe config: ${cfgPath}`);
  if (!fs.existsSync(mapPath)) throw new Error(`No existe mapping: ${mapPath}`);

  const adapter = require(path.resolve(adapterPath));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const mapping = JSON.parse(fs.readFileSync(mapPath, "utf8"));

  let minInterval = cfg?.rate_limit?.min_interval_ms ?? 800;

  // Auto-rate (opcional)
  const ar = Object.assign({
    enabled: false,
    target_rps: 1.0,
    warmup: 2,
    min_interval_floor_ms: 50,
    use_percentile: 0.9
  }, cfg.auto_rate || {});

  function percentile(arr, p) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x,y)=>x-y);
    const idx = Math.floor(p * (a.length - 1));
    return a[idx];
  }

  // DB
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "autoiq",
    charset: "utf8mb4"
  });

  let rateSummary = null;

  try {
    // Leer proceso
    const [pRows] = await conn.execute(
      `SELECT id, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados
       FROM procesos_cotizacion WHERE id=?`, [procesoId]
    );
    if (!pRows.length) throw new Error(`No existe proceso_id=${procesoId}`);
    const proc = pRows[0];

    ensureDir(proc.carpeta_request_response);
    ensureDir(proc.carpeta_resultados);

    if (!fs.existsSync(proc.ruta_archivo_combinatorio)) {
      throw new Error(`No existe XLSX: ${proc.ruta_archivo_combinatorio}`);
    }
    const wb = xlsx.readFile(proc.ruta_archivo_combinatorio);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    const start = Math.max(0, from);
    const end = limit != null ? Math.min(rows.length, start + limit) : rows.length;

    if (verbose) {
      console.log(`Aseguradora=${aseguradora} | Proceso ${procesoId} - filas: ${rows.length}, from=${start}, to=${end - 1}, dryRun=${dryRun}`);
    }

    const durs = [];
    let total = 0, ok = 0, errs = 0;

    for (let i = start; i < end; i++) {
      const row = rows[i];
      const t0 = Date.now();

      // Construir payload usando el adapter
      let payload;
      try {
        payload = adapter.buildPayload(row, mapping, cfg);
      } catch (e) {
        errs++;
        await insertRow(conn, adapter.table, procesoId, { status: "error", error_msg: e.message, ms: 0, payloadOnly: { row } });
        if (verbose) console.log(`[${i + 1}] ❌ ${e.message}`);
        continue;
      }

      // Ejecutar request (o simular)
      let status = "pendiente", respBody = null, errMsg = null;
      try {
        if (!dryRun) {
          const endpoint = adapter.endpointFromConfig(cfg);
          respBody = await adapter.post(endpoint, payload);
          status = "ok";
          ok++;
          if (verbose) console.log(`[${i + 1}] ✅ OK`);
        } else {
          if (verbose) console.log(`[${i + 1}] 📝 DRY-RUN (request guardado)`);
        }
      } catch (e) {
        status = "error";
        errMsg = e?.response?.data
          ? (typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data))
          : (e.message || "Error");
        errs++;
        if (verbose) console.log(`[${i + 1}] ❌ ${errMsg}`);
      }

      const ms = Date.now() - t0;
      if (!dryRun) durs.push(ms);

      // Armar extras a insertar (patente/cod_infoauto/etc) si el adapter los expone
      const extras = adapter.extractDbColumns ? adapter.extractDbColumns(row, mapping, payload) : {};

      await insertRow(conn, adapter.table, procesoId, {
        status, error_msg: errMsg || null, ms,
        request: payload, response: respBody, extras
      });

      total++;

      // Auto-rate
      if (!dryRun && ar.enabled && durs.length >= ar.warmup) {
        const p = Math.max(0, Math.min(1, Number(ar.use_percentile) || 0.9));
        const pctl = percentile(durs, p);
        const targetPeriod = Math.max(1, Math.round(1000 / Math.max(0.001, Number(ar.target_rps) || 1.0)));
        let computed;
        if (pctl >= targetPeriod) computed = ar.min_interval_floor_ms;
        else computed = Math.max(ar.min_interval_floor_ms, targetPeriod - pctl);

        if (computed !== minInterval) {
          if (verbose) console.log(`↪ auto-rate: p${Math.round(p*100)}=${pctl}ms, targetPeriod=${targetPeriod}ms → min_interval_ms=${computed}`);
          minInterval = computed;
        }
        rateSummary = {
          p50: percentile(durs, 0.5),
          p90: percentile(durs, 0.9),
          p95: percentile(durs, 0.95),
          avg_ms: Math.round(durs.reduce((a,b)=>a+b,0)/durs.length),
          target_rps: ar.target_rps,
          target_period_ms: Math.round(1000/Math.max(0.001, ar.target_rps)),
          used_min_interval_ms: minInterval
        };
      }

      await sleep(minInterval);
    }

    await conn.execute(
      `UPDATE procesos_cotizacion
         SET registros_procesados = COALESCE(registros_procesados,0) + ?,
             cotizaciones_exitosas = COALESCE(cotizaciones_exitosas,0) + ?,
             cotizaciones_con_error = COALESCE(cotizaciones_con_error,0) + ?,
             fecha_fin = NOW(),
             estado = CASE WHEN ? > 0 THEN 'con errores' ELSE 'completado' END
       WHERE id = ?`,
      [total, ok, errs, errs, procesoId]
    );

    if (rateSummary && proc.carpeta_resultados) {
      try {
        const fp = path.join(proc.carpeta_resultados, `rate_summary_proceso_${procesoId}.json`);
        fs.writeFileSync(fp, JSON.stringify(rateSummary, null, 2));
        if (verbose) console.log("Rate summary guardado en:", fp);
      } catch {}
    }

    console.log(`Aseguradora=${aseguradora} | Proceso ${procesoId} finalizado. Procesadas: ${total}, OK: ${ok}, Error: ${errs}. DRY-RUN=${dryRun}`);
  } finally {
    await conn.end();
  }
}

async function insertRow(conn, table, procesoId, opts) {
  const cols = ["proceso_id", "request_json", "response_json", "started_at", "finished_at", "ms_duracion", "status", "error_msg"];
  const vals = [procesoId, null, null, {raw: "NOW()"}, {raw: "NOW()"}, Number(opts.ms || 0), opts.status || "pendiente", opts.error_msg || null];

  // request/response
  if (opts.request) vals[1] = JSON.stringify(opts.request, null, 2);
  if (opts.response) vals[2] = JSON.stringify(opts.response, null, 2);
  if (opts.payloadOnly) vals[1] = JSON.stringify(opts.payloadOnly, null, 2);

  // extras (si existen columnas en la tabla)
  const extras = opts.extras || {};
  for (const [k, v] of Object.entries(extras)) {
    cols.push(k);
    vals.push(v);
  }

  // armar placeholders
  const ph = cols.map(() => "?");
  // reemplazo de NOW()
  vals.forEach((v, i) => { if (v && v.raw === "NOW()") { vals[i] = null; ph[i] = "NOW()"; } });

  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph.join(",")})`;
  await conn.execute(sql, vals.filter(v => !(v && v.raw === "NOW()")));
}

main().catch(e => { console.error("ERROR FATAL:", e?.message || e); process.exit(2); });

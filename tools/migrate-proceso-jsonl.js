const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, value) {
  fs.writeFileSync(p, JSON.stringify(value, null, 2), 'utf8');
}

function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Uso: node tools/migrate-proceso-jsonl.js <proceso_id>');
  }

  const repo = path.join(__dirname, '..');
  const procDir = path.join(repo, 'data', 'procesos', `proceso-${id}`);
  const resumenPath = path.join(procDir, 'resumen.json');
  const metadataPath = path.join(procDir, 'metadata.json');
  const resultadosDir = path.join(procDir, 'resultados');

  if (!fs.existsSync(resumenPath)) throw new Error(`No existe ${resumenPath}`);
  if (!fs.existsSync(metadataPath)) throw new Error(`No existe ${metadataPath}`);

  const resumen = readJson(resumenPath);
  let metadata = {};
  try {
    metadata = readJson(metadataPath);
  } catch {
    metadata = {};
  }
  const runPath = path.join(procDir, 'run.json');
  const run = fs.existsSync(runPath) ? readJson(runPath) : {};
  if (!metadata.id) {
    metadata = {
      id,
      nombre: `Proceso ${id}`,
      estado: 'incompleto',
      historial_id: run.historial_id || resumen.historial_id || null,
      archivo: run.archivo || resumen.archivo || '',
      cabecera_id: run.cabecera_id || resumen.cabecera_id || null,
      aseguradoras: run.aseguradoras || resumen.aseguradoras || Object.keys(resumen.resultados || {}),
      limite: null,
      fecha_creacion: run.started_at || resumen.fecha || new Date().toISOString(),
      fecha_inicio: run.started_at || resumen.fecha || new Date().toISOString(),
      fecha_fin: null,
      organization_id: 'autoiq',
      created_by_user_id: 'superadmin-local',
      created_by_name: 'Super Admin',
    };
  }
  const aseguradoras = Array.isArray(metadata.aseguradoras) && metadata.aseguradoras.length
    ? metadata.aseguradoras
    : Object.keys(resumen.resultados || {});

  ensureDir(resultadosDir);

  const written = {};
  const summary = {
    total: 0,
    ok: 0,
    err: 0,
    skipped: 0,
    pending: 0,
    pendingByCompany: {},
  };
  const tomar = Number(run.limite || resumen.limite || 0) || 0;
  for (const slug of aseguradoras) {
    const arr = Array.isArray(resumen?.resultados?.[slug]) ? resumen.resultados[slug] : [];
    const lines = [];
    let companyPending = 0;
    for (let i = 0; i < tomar; i += 1) {
      const item = arr[i];
      if (!item || item.pending === true) {
        summary.pending += 1;
        companyPending += 1;
        continue;
      }
      summary.total += 1;
      if (item.skipped) summary.skipped += 1;
      else if (item.ok) summary.ok += 1;
      else summary.err += 1;
    }
    for (const item of arr) {
      if (!item) continue;
      lines.push(JSON.stringify(item));
    }
    fs.writeFileSync(path.join(resultadosDir, `${slug}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    written[slug] = lines.length;
    if (companyPending > 0) summary.pendingByCompany[slug] = companyPending;
  }

  const nextMetadata = {
    ...metadata,
    storage_mode: 'jsonl',
    storage_migrated_at: new Date().toISOString(),
    storage_migration_source: 'resumen.json',
    storage_migration_counts: written,
    registros_total: tomar * aseguradoras.length,
    registros_filas: tomar,
    registros_procesados: summary.total,
    cotizaciones_exitosas: summary.ok,
    cotizaciones_con_error: summary.err,
    cotizaciones_skipped: summary.skipped,
    cotizaciones_pendientes: summary.pending,
    aseguradoras_pendientes: Object.keys(summary.pendingByCompany),
    estado: String(metadata.estado || '').toLowerCase() === 'en curso' ? 'incompleto' : metadata.estado,
  };
  writeJson(metadataPath, nextMetadata);

  console.log(JSON.stringify({
    ok: true,
    proceso_id: id,
    resultados_dir: resultadosDir,
    written,
    estado: nextMetadata.estado,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}

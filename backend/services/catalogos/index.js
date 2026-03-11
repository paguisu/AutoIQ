const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function slugifyName(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_');
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function listCompanySlugs(dataRoot) {
  if (!fs.existsSync(dataRoot)) return [];
  const skip = new Set(['catalogos', 'testing']);
  return fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !skip.has(name) && fs.existsSync(path.join(dataRoot, name, 'aseguradora.json')))
    .sort();
}

function mapObjectToRecords(obj) {
  return Object.entries(obj || {}).map(([codigo, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { codigo, ...value };
    }
    return { codigo, descripcion: String(value ?? '') };
  });
}

function normalizeRecords(input) {
  if (Array.isArray(input)) return input.map((x) => (x && typeof x === 'object' ? x : { value: x }));
  if (input && typeof input === 'object') return mapObjectToRecords(input);
  return [];
}

function pickPrimaryKey(tableName, rows) {
  const candidatesByTable = {
    ws_au_marca_modelo: ['tau_codia', 'codigo', 'cod_modelo'],
    ws_au_marcas: ['codigo', 'Codigo'],
    ws_au_localidades: ['codpos', 'codigo_postal', 'codigo'],
    ws_au_infoauto: ['tau_codia', 'codigo'],
  };
  const preferred = candidatesByTable[tableName] || ['codigo', 'id', 'key'];
  for (const key of preferred) {
    if (rows.some((r) => r && r[key] != null && String(r[key]).trim() !== '')) return key;
  }
  return preferred[0];
}

function byKey(rows, keyField) {
  const out = new Map();
  for (const row of rows) {
    const key = String(row?.[keyField] ?? '').trim();
    if (!key) continue;
    out.set(key, row);
  }
  return out;
}

function isSameShallow(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildDiff(tableName, prevRows, newRows) {
  const keyField = pickPrimaryKey(tableName, [...prevRows, ...newRows]);
  const prev = byKey(prevRows, keyField);
  const next = byKey(newRows, keyField);

  const altas = [];
  const bajas = [];
  const modificados = [];

  for (const [k, row] of next.entries()) {
    if (!prev.has(k)) {
      altas.push({ key: k, row });
      continue;
    }
    const before = prev.get(k);
    if (!isSameShallow(before, row)) {
      modificados.push({ key: k, antes: before, despues: row });
    }
  }
  for (const [k, row] of prev.entries()) {
    if (!next.has(k)) bajas.push({ key: k, row });
  }

  return {
    keyField,
    resumen: {
      altas: altas.length,
      bajas: bajas.length,
      modificados: modificados.length,
      sin_cambios: altas.length === 0 && bajas.length === 0 && modificados.length === 0,
    },
    altas,
    bajas,
    modificados,
  };
}

function toCsvRows(report) {
  const lines = ['tipo,key,detalle'];
  for (const x of report.altas || []) lines.push(`alta,${x.key},${JSON.stringify(x.row).replace(/"/g, '""')}`);
  for (const x of report.bajas || []) lines.push(`baja,${x.key},${JSON.stringify(x.row).replace(/"/g, '""')}`);
  for (const x of report.modificados || []) {
    lines.push(`modificado,${x.key},${JSON.stringify({ antes: x.antes, despues: x.despues }).replace(/"/g, '""')}`);
  }
  return lines.join('\n');
}

function buildProfile(rows) {
  const sample = rows.slice(0, 5);
  const columns = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row || {}).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  ).sort();

  return {
    totalRows: rows.length,
    columns,
    sample,
  };
}

function defaultAtmTableMap() {
  return {
    ws_au_usos: { fileName: 'uso.json', endpoint: 'ws_au_usos' },
    ws_au_marca_modelo: { fileName: 'marca_modelo.json', endpoint: 'ws_au_marca_modelo' },
    ws_au_marcas: { fileName: 'marcas.json', endpoint: 'ws_au_marcas' },
    ws_au_localidades: { fileName: 'localidades.json', endpoint: 'ws_au_localidades' },
    ws_au_rastreo_satelital: { fileName: 'rastreo_satelital.json', endpoint: 'ws_au_rastreo_satelital' },
    ws_au_infoauto: { fileName: 'infoauto.json', endpoint: 'ws_au_infoauto' },
    ws_au_forma_pago: { fileName: 'forma_pago.json', endpoint: 'ws_au_forma_pago' },
    ws_au_tarjeta: { fileName: 'tarjeta.json', endpoint: 'ws_au_tarjeta' },
    ws_au_tipo_persona: { fileName: 'tipo_persona.json', endpoint: 'ws_au_tipo_persona' },
    ws_au_iva: { fileName: 'iva.json', endpoint: 'ws_au_iva' },
    ws_au_sexo: { fileName: 'sexo.json', endpoint: 'ws_au_sexo' },
    ws_au_resp_inspeccion: { fileName: 'resp_inspeccion.json', endpoint: 'ws_au_resp_inspeccion' },
    ws_au_nacionalidad: { fileName: 'nacionalidad.json', endpoint: 'ws_au_nacionalidad' },
    ws_au_actividad: { fileName: 'actividad.json', endpoint: 'ws_au_actividad' },
    ws_au_est_civil: { fileName: 'est_civil.json', endpoint: 'ws_au_est_civil' },
    ws_au_inspeccion: { fileName: 'inspeccion.json', endpoint: 'ws_au_inspeccion' },
    ws_au_color: { fileName: 'color.json', endpoint: 'ws_au_color' },
    ws_au_accesorios: { fileName: 'accesorios.json', endpoint: 'ws_au_accesorios' },
  };
}

function tableMapFor(slug) {
  return slug === 'atm' ? defaultAtmTableMap() : {};
}

function buildAtmProviderUrl(endpoint) {
  const base = String(process.env.ATM_CATALOG_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  // Ajustable por ENV para distintos providers REST
  const template = String(process.env.ATM_CATALOG_PATH_TEMPLATE || '/{endpoint}').trim();
  return `${base}${template.replace('{endpoint}', endpoint)}`;
}

async function fetchFromProvider({ slug, table }) {
  if (slug !== 'atm') throw new Error(`Proveedor real no implementado para ${slug}`);
  const map = tableMapFor(slug);
  const meta = map[table];
  if (!meta) throw new Error(`Tabla no soportada para ${slug}: ${table}`);

  const url = buildAtmProviderUrl(meta.endpoint);
  if (!url) throw new Error('Falta ATM_CATALOG_BASE_URL para sync real');

  const headers = {};
  const apiKey = String(process.env.ATM_CATALOG_API_KEY || '').trim();
  if (apiKey) headers['x-api-key'] = apiKey;

  const timeout = Number(process.env.ATM_CATALOG_TIMEOUT_MS || 30000);
  const resp = await axios.get(url, { headers, timeout, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Proveedor ATM respondió HTTP ${resp.status} para ${table}`);
  }
  return { sourceRaw: resp.data, sourcePath: url, sourceType: 'remote' };
}

async function fetchFromLocal({ dataRoot, slug, table }) {
  const map = tableMapFor(slug);
  const meta = map[table];
  if (!meta) throw new Error(`Tabla no soportada para ${slug}: ${table}`);

  const sourcePath = path.join(dataRoot, slug, 'diccionarios', meta.fileName);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe fuente local para ${slug}/${table}: ${sourcePath}`);

  const sourceRaw = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
  return { sourceRaw, sourcePath, sourceType: 'local' };
}

function listTablesForCompany(dataRoot, slug) {
  const tableMap = tableMapFor(slug);
  return Object.keys(tableMap).map((table) => ({
    table,
    endpoint: tableMap[table].endpoint,
    sourcePath: path.join(dataRoot, slug, 'diccionarios', tableMap[table].fileName),
    exists: fs.existsSync(path.join(dataRoot, slug, 'diccionarios', tableMap[table].fileName)),
  }));
}

async function syncTable({ dataRoot, catalogRoot, slug, table, source = 'local', dryRun = false }) {
  const sourceInfo = source === 'remote'
    ? await fetchFromProvider({ slug, table })
    : await fetchFromLocal({ dataRoot, slug, table });

  const newRows = normalizeRecords(sourceInfo.sourceRaw);
  const profile = buildProfile(newRows);

  const tableDir = path.join(catalogRoot, slug, table);
  const histDir = path.join(tableDir, 'history');
  const reportsDir = path.join(catalogRoot, slug, 'reports');
  ensureDir(histDir);
  ensureDir(reportsDir);

  const currentPath = path.join(tableDir, 'current.json');
  let prevRows = [];
  if (fs.existsSync(currentPath)) {
    try {
      const oldRaw = JSON.parse(await fsp.readFile(currentPath, 'utf8'));
      prevRows = normalizeRecords(oldRaw.rows || oldRaw);
    } catch {
      prevRows = [];
    }
  }

  const diff = buildDiff(table, prevRows, newRows);
  const stamp = nowStamp();
  const runId = `run-${slugifyName(slug)}-${slugifyName(table)}-${stamp}`;

  const currentData = {
    slug,
    table,
    updatedAt: new Date().toISOString(),
    sourcePath: sourceInfo.sourcePath,
    sourceType: sourceInfo.sourceType,
    keyField: diff.keyField,
    rows: newRows,
    profile,
  };

  const report = {
    runId,
    slug,
    table,
    updatedAt: currentData.updatedAt,
    source: currentData.sourceType,
    sourcePath: currentData.sourcePath,
    dryRun,
    keyField: diff.keyField,
    profile,
    resumen: diff.resumen,
    altas: diff.altas,
    bajas: diff.bajas,
    modificados: diff.modificados,
  };

  const jsonReportPath = path.join(reportsDir, `${runId}.json`);
  const csvReportPath = path.join(reportsDir, `${runId}.csv`);

  await fsp.writeFile(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
  await fsp.writeFile(csvReportPath, toCsvRows(report), 'utf8');

  if (!dryRun) {
    await fsp.writeFile(path.join(histDir, `${stamp}.json`), JSON.stringify(currentData, null, 2), 'utf8');
    await fsp.writeFile(currentPath, JSON.stringify(currentData, null, 2), 'utf8');
  }

  return {
    ...report,
    paths: {
      currentPath,
      jsonReportPath,
      csvReportPath,
    },
  };
}

async function readReport({ catalogRoot, slug, runId }) {
  const p = path.join(catalogRoot, slug, 'reports', `${runId}.json`);
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

module.exports = {
  listCompanySlugs,
  listTablesForCompany,
  normalizeRecords,
  buildDiff,
  syncTable,
  readReport,
};
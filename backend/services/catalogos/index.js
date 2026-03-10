const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

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

function defaultAtmTableMap() {
  return {
    ws_au_usos: 'uso.json',
    ws_au_marca_modelo: 'marca_modelo.json',
    ws_au_marcas: 'marcas.json',
    ws_au_localidades: 'localidades.json',
    ws_au_rastreo_satelital: 'rastreo_satelital.json',
    ws_au_infoauto: 'infoauto.json',
    ws_au_forma_pago: 'forma_pago.json',
    ws_au_tarjeta: 'tarjeta.json',
    ws_au_tipo_persona: 'tipo_persona.json',
    ws_au_iva: 'iva.json',
    ws_au_sexo: 'sexo.json',
    ws_au_resp_inspeccion: 'resp_inspeccion.json',
    ws_au_nacionalidad: 'nacionalidad.json',
    ws_au_actividad: 'actividad.json',
    ws_au_est_civil: 'est_civil.json',
    ws_au_inspeccion: 'inspeccion.json',
    ws_au_color: 'color.json',
    ws_au_accesorios: 'accesorios.json',
  };
}

function listTablesForCompany(dataRoot, slug) {
  const tableMap = slug === 'atm' ? defaultAtmTableMap() : {};
  return Object.keys(tableMap).map((table) => ({
    table,
    sourcePath: path.join(dataRoot, slug, 'diccionarios', tableMap[table]),
    exists: fs.existsSync(path.join(dataRoot, slug, 'diccionarios', tableMap[table])),
  }));
}

async function syncTable({ dataRoot, catalogRoot, slug, table }) {
  const tableMap = slug === 'atm' ? defaultAtmTableMap() : {};
  const fileName = tableMap[table];
  if (!fileName) throw new Error(`Tabla no soportada para ${slug}: ${table}`);

  const sourcePath = path.join(dataRoot, slug, 'diccionarios', fileName);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe fuente local para ${slug}/${table}: ${sourcePath}`);

  const sourceRaw = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
  const newRows = normalizeRecords(sourceRaw);

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
    sourcePath,
    keyField: diff.keyField,
    rows: newRows,
  };

  await fsp.writeFile(path.join(histDir, `${stamp}.json`), JSON.stringify(currentData, null, 2), 'utf8');
  await fsp.writeFile(currentPath, JSON.stringify(currentData, null, 2), 'utf8');

  const report = {
    runId,
    slug,
    table,
    updatedAt: currentData.updatedAt,
    keyField: diff.keyField,
    resumen: diff.resumen,
    altas: diff.altas,
    bajas: diff.bajas,
    modificados: diff.modificados,
  };

  const jsonReportPath = path.join(reportsDir, `${runId}.json`);
  const csvReportPath = path.join(reportsDir, `${runId}.csv`);
  await fsp.writeFile(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
  await fsp.writeFile(csvReportPath, toCsvRows(report), 'utf8');

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

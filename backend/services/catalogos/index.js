const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Writable } = require('stream');
const axios = require('axios');
const ftp = require('basic-ftp');

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
    ws_au_infoauto_dc: ['tau_codia', 'codigo'],
    ws_au_color: ['descripcion', 'codigo'],
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
    ws_au_usos: { fileName: 'uso.json', endpoint: 'ws_au_usos', remoteName: 'WS_AU_USOS' },
    ws_au_marca_modelo: { fileName: 'marca_modelo.json', endpoint: 'ws_au_marca_modelo', remoteName: 'WS_AU_MARCA_MODELO' },
    ws_au_marcas: { fileName: 'marcas.json', endpoint: 'ws_au_marcas', remoteName: 'WS_AU_MARCAS' },
    ws_au_localidades: { fileName: 'localidades.json', endpoint: 'ws_au_localidades', remoteName: 'WS_AU_LOCALIDADES' },
    ws_au_rastreo_satelital: { fileName: 'rastreo_satelital.json', endpoint: 'ws_au_rastreo_satelital', remoteName: 'WS_AU_RASTREO_SATELITAL' },
    ws_au_infoauto: { fileName: 'infoauto.json', endpoint: 'ws_au_infoauto', remoteName: 'WS_AU_INFOAUTO' },
    ws_au_forma_pago: { fileName: 'forma_pago.json', endpoint: 'ws_au_forma_pago', remoteName: 'WS_AU_FORMA_PAGO' },
    ws_au_tarjeta: { fileName: 'tarjeta.json', endpoint: 'ws_au_tarjeta', remoteName: 'WS_AU_TARJETA' },
    ws_au_tipo_persona: { fileName: 'tipo_persona.json', endpoint: 'ws_au_tipo_persona', remoteName: 'WS_AU_TIPO_PERSONA' },
    ws_au_iva: { fileName: 'iva.json', endpoint: 'ws_au_iva', remoteName: 'WS_AU_IVA' },
    ws_au_sexo: { fileName: 'sexo.json', endpoint: 'ws_au_sexo', remoteName: 'WS_AU_SEXO' },
    ws_au_resp_inspeccion: { fileName: 'resp_inspeccion.json', endpoint: 'ws_au_resp_inspeccion', remoteName: 'WS_AU_RESP_INSPECCION' },
    ws_au_nacionalidad: { fileName: 'nacionalidad.json', endpoint: 'ws_au_nacionalidad', remoteName: 'WS_AU_NACIONALIDAD' },
    ws_au_actividad: { fileName: 'actividad.json', endpoint: 'ws_au_actividad', remoteName: 'WS_AU_ACTIVIDAD' },
    ws_au_est_civil: { fileName: 'est_civil.json', endpoint: 'ws_au_est_civil', remoteName: 'WS_AU_EST_CIVIL' },
    ws_au_inspeccion: { fileName: 'inspeccion.json', endpoint: 'ws_au_inspeccion', remoteName: 'WS_AU_INSPECCION' },
    ws_au_color: { fileName: 'color.json', endpoint: 'ws_au_color', remoteName: 'WS_AU_COLOR' },
    ws_au_accesorios: { fileName: 'accesorios.json', endpoint: 'ws_au_accesorios', remoteName: 'WS_AU_ACCESORIOS' },
    ws_au_tipo_doc: { fileName: 'tipo_doc.json', endpoint: 'ws_au_tipo_doc', remoteName: 'WS_AU_TIPO_DOC' },
    ws_au_combustible: { fileName: 'combustible.json', endpoint: 'ws_au_combustible', remoteName: 'WS_AU_COMBUSTIBLE' },
    ws_au_vigencia: { fileName: 'vigencia.json', endpoint: 'ws_au_vigencia', remoteName: 'WS_AU_VIGENCIA' },
    ws_au_infoauto_dc: { fileName: 'infoauto_dc.json', endpoint: 'ws_au_infoauto_dc', remoteName: 'WS_AU_INFOAUTO_DC' },
  };
}

function tableMapFor(slug) {
  return slug === 'atm' ? defaultAtmTableMap() : {};
}

function getTableMeta(slug, table) {
  const tableMap = tableMapFor(slug);
  const meta = tableMap[table];
  if (!meta) throw new Error(`Tabla no soportada para ${slug}: ${table}`);
  return meta;
}

function buildAtmProviderUrl(endpoint) {
  const base = String(process.env.ATM_CATALOG_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  const template = String(process.env.ATM_CATALOG_PATH_TEMPLATE || '/{endpoint}').trim();
  return `${base}${template.replace('{endpoint}', endpoint)}`;
}

function normalizeHeaderName(v) {
  return String(v || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeObjectKeys(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeHeaderName(key)] = value;
  }
  return out;
}

function normalizeRemoteRowsByTable(table, rows) {
  const normalized = rows.map((row) => normalizeObjectKeys(row));

  const normalizeCodigoDescripcion = (extraFields = []) =>
    normalized
      .map((row) => {
        const base = {
          codigo: String(row.codigo || '').trim(),
          descripcion: String(row.descripcion || '').trim(),
        };
        for (const field of extraFields) {
          base[field] = String(row[field] || '').trim();
        }
        return base;
      })
      .filter((row) => row.codigo && row.descripcion);

  if (table === 'ws_au_usos') {
    return normalizeCodigoDescripcion();
  }

  if (table === 'ws_au_marcas') {
    return normalizeCodigoDescripcion(['seccion']);
  }

  if (table === 'ws_au_marca_modelo') {
    return normalized
      .map((row) => ({
        cod_marca: String(row.cod_marca || '').trim(),
        marca: String(row.marca || '').trim(),
        cod_modelo: String(row.cod_model || row.cod_modelo || '').trim(),
        modelo: String(row.modelo || '').trim(),
        tau_codia: String(row.tau_codia || '').trim(),
        cod_uso: String(row.cod_uso || '').trim(),
        tipo_uso: String(row.tipo_uso || '').trim(),
      }))
      .filter((row) => row.tau_codia);
  }

  if (table === 'ws_au_infoauto') {
    return normalized
      .map((row) => ({
        tau_nmarc: String(row.tau_nmarc || '').trim(),
        tau_marca: String(row.tau_marca || '').trim(),
        tau_nmode: String(row.tau_nmode || '').trim(),
        tau_model: String(row.tau_model || '').trim(),
        tau_codia: String(row.tau_codia || '').trim(),
        tau_cgrup: String(row.tau_cgrup || '').trim(),
        tau_creas: String(row.tau_creas || '').trim(),
        tau_anioe: String(row.tau_anioe || '').trim(),
        ...Object.fromEntries(
          Object.entries(row).filter(([key]) => /^tau_pre\d{2}$/.test(key))
        ),
      }))
      .filter((row) => row.tau_codia);
  }

  if ([
    'ws_au_accesorios',
    'ws_au_actividad',
    'ws_au_combustible',
    'ws_au_iva',
    'ws_au_nacionalidad',
    'ws_au_rastreo_satelital',
    'ws_au_resp_inspeccion',
    'ws_au_sexo',
    'ws_au_tipo_doc',
    'ws_au_tipo_persona',
  ].includes(table)) {
    return normalizeCodigoDescripcion();
  }

  if (table === 'ws_au_est_civil') {
    return normalizeCodigoDescripcion();
  }

  if (table === 'ws_au_forma_pago') {
    return normalizeCodigoDescripcion();
  }

  if (table === 'ws_au_tarjeta') {
    return normalizeCodigoDescripcion(['longitud']);
  }

  if (table === 'ws_au_localidades') {
    return normalized
      .map((row) => ({
        codpos: String(row.codpos || '').trim(),
        localidad: String(row.localidad || '').trim(),
        provincia: String(row.provincia || '').trim(),
        codpro: String(row.codpro || '').trim(),
        subcodpos: String(row.subcodpos || '').trim(),
      }))
      .filter((row) => row.codpos && row.localidad);
  }

  if (table === 'ws_au_inspeccion') {
    return normalized
      .map((row) => ({
        codigo: String(row.codigo || '').trim(),
        tipo_insp: String(row.tipo_insp || '').trim(),
        concepto: String(row.concepto || '').trim(),
        tipo_reg: String(row.tipo_reg || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
        orden: String(row.orden || '').trim(),
      }))
      .filter((row) => row.codigo && row.descripcion);
  }

  if (table === 'ws_au_color') {
    return normalized
      .map((row) => ({
        descripcion: String(row.descripcion || '').trim(),
      }))
      .filter((row) => row.descripcion);
  }

  if (table === 'ws_au_vigencia') {
    return normalizeCodigoDescripcion(['cuotas']);
  }

  if (table === 'ws_au_infoauto_dc') {
    return normalized
      .map((row) => ({
        tau_codia: String(row.tau_codia || '').trim(),
        cmarca: String(row.cmarca || '').trim(),
      }))
      .filter((row) => row.tau_codia && row.cmarca);
  }

  return normalized;
}

function buildLegacyUsoMap(rows) {
  const out = {};
  for (const row of rows || []) {
    const codigo = String(row.codigo || '').trim();
    const descripcion = String(row.descripcion || '').trim().toLowerCase();
    if (!codigo || !descripcion) continue;

    if (!out.particular && descripcion.includes('particular') && descripcion.includes('auto')) {
      out.particular = codigo;
    }
    if (!out.comercial && descripcion.includes('comercial') && descripcion.includes('auto')) {
      out.comercial = codigo;
    }
    if (!out.taxi && descripcion.includes('taxi')) {
      out.taxi = codigo;
    }
  }
  return out;
}

function buildLocalSourcePayload(table, rows, sourceRaw) {
  if (table === 'ws_au_usos') {
    const legacy = buildLegacyUsoMap(rows);
    return {
      particular: legacy.particular || '0101',
      comercial: legacy.comercial || '010102',
      taxi: legacy.taxi || '4262',
    };
  }
  return rows;
}

function getAtmFtpConfig() {
  const mode = String(process.env.ATM_CATALOG_FTP_MODE || 'ftp').trim().toLowerCase();
  const isDev = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'development';
  const host = String(
    process.env.ATM_CATALOG_FTP_HOST ||
    process.env.ATM_BASE_URL_INFOAUTO ||
    process.env.ATM_BASE_URL ||
    process.env.ATM_CATALOG_HOST ||
    (isDev ? 'wsatm-dev.atmseguros.com.ar' : 'wsatm.atmseguros.com.ar')
  ).trim();
  const port = Number(
    process.env.ATM_CATALOG_FTP_PORT ||
    process.env.ATM_BASE_URL_PORT ||
    process.env.ATM_CATALOG_PORT ||
    (isDev ? 2111 : 2113)
  );
  const user = String(process.env.ATM_CATALOG_FTP_USER || process.env.USUARIO_INFOA || process.env.ATM_USER || '').trim();
  const password = String(process.env.ATM_CATALOG_FTP_PASS || process.env.CLAVE_INFOA || process.env.ATM_PASS || '').trim();
  const remoteDir = String(process.env.ATM_CATALOG_FTP_DIR || '/Parametros').trim();
  const timeoutMs = Number(process.env.ATM_CATALOG_TIMEOUT_MS || 30000);

  if (!host) throw new Error('Falta ATM_CATALOG_FTP_HOST');
  if (!user) throw new Error('Falta ATM_CATALOG_FTP_USER');
  if (!password) throw new Error('Falta ATM_CATALOG_FTP_PASS');

  return { mode, host, port, user, password, remoteDir, timeoutMs };
}

function buildFtpUrl({ mode, host, port, remoteDir, fileName = '' }) {
  const protocol = mode === 'ftps' ? 'ftps' : 'ftp';
  const dir = String(remoteDir || '/').replace(/\\/g, '/').replace(/\/+/g, '/');
  const baseDir = dir.startsWith('/') ? dir : `/${dir}`;
  const suffix = fileName ? `/${String(fileName).replace(/^\/+/, '')}` : '';
  return `${protocol}://${host}:${port}${baseDir.replace(/\/$/, '') || ''}${suffix}`;
}

async function listAtmFtpFiles(cfg) {
  const client = new ftp.Client(cfg.timeoutMs);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.mode === 'ftps',
    });
    await client.cd(cfg.remoteDir);
    const entries = await client.list();
    return entries.map((entry) => entry.name).filter(Boolean);
  } finally {
    client.close();
  }
}

function resolveRemoteFileName(meta, files) {
  const base = String(meta.remoteName || meta.endpoint || '').trim().toLowerCase();
  const candidates = [base, `${base}.txt`, `${base}.csv`, `${base}.json`, `${base}.dat`];

  for (const cand of candidates) {
    const match = files.find((x) => String(x).trim().toLowerCase() === cand);
    if (match) return match;
  }

  return files.find((x) => String(x).trim().toLowerCase().includes(base)) || '';
}

function parseDelimitedText(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const delimiters = [';', '|', '\t', ','];
  let headerIndex = 0;
  let delimiter = ';';
  let bestCount = 0;

  for (let lineIdx = 0; lineIdx < Math.min(lines.length, 5); lineIdx += 1) {
    for (const cand of delimiters) {
      const count = lines[lineIdx].split(cand).length;
      if (count > bestCount) {
        bestCount = count;
        delimiter = cand;
        headerIndex = lineIdx;
      }
    }
  }

  const dataLines = lines.slice(headerIndex);
  const scored = delimiters.map((cand) => ({
    delimiter: cand,
    count: dataLines[0].split(cand).length,
  }));
  scored.sort((a, b) => b.count - a.count);
  delimiter = scored[0].count > 1 ? scored[0].delimiter : delimiter;

  const rows = dataLines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const header = rows[0];
  const hasHeader = header.every((cell) => /[A-Za-z_]/.test(cell));

  if (!hasHeader) {
    return rows.map((cols) =>
      cols.reduce((acc, value, idx) => {
        acc[`col_${idx + 1}`] = value;
        return acc;
      }, {})
    );
  }

  return rows.slice(1).map((cols) =>
    header.reduce((acc, key, idx) => {
      acc[key] = cols[idx] ?? '';
      return acc;
    }, {})
  );
}

function parseRemoteCatalogRaw(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return parseDelimitedText(text);
  }
}

async function fetchFromHttpProvider(meta) {
  const url = buildAtmProviderUrl(meta.endpoint);
  if (!url) throw new Error('Falta ATM_CATALOG_BASE_URL para sync real');

  const headers = {};
  const apiKey = String(process.env.ATM_CATALOG_API_KEY || '').trim();
  if (apiKey) headers['x-api-key'] = apiKey;

  const timeout = Number(process.env.ATM_CATALOG_TIMEOUT_MS || 30000);
  const resp = await axios.get(url, { headers, timeout, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Proveedor ATM respondió HTTP ${resp.status}`);
  }
  return { sourceRaw: resp.data, sourcePath: url, sourceType: 'remote-http' };
}

async function fetchFromFtpProvider(meta) {
  const cfg = getAtmFtpConfig();
  const files = await listAtmFtpFiles(cfg);
  const remoteFileName = resolveRemoteFileName(meta, files);
  if (!remoteFileName) {
    throw new Error(`No se encontró archivo remoto para ${meta.endpoint} en ${cfg.remoteDir}`);
  }

  const client = new ftp.Client(cfg.timeoutMs);
  client.ftp.verbose = false;
  let raw = '';
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.mode === 'ftps',
    });
    await client.cd(cfg.remoteDir);
    const sink = new Writable({
      write(chunk, _enc, callback) {
        raw += chunk.toString('latin1');
        callback();
      },
    });
    await client.downloadTo(
      sink,
      remoteFileName
    );
  } finally {
    client.close();
  }

  const fileUrl = buildFtpUrl({ ...cfg, fileName: remoteFileName });

  return {
    sourceRaw: parseRemoteCatalogRaw(raw),
    sourcePath: fileUrl,
    sourceType: 'remote-ftp',
  };
}

async function fetchFromProvider({ slug, table }) {
  if (slug !== 'atm') throw new Error(`Proveedor real no implementado para ${slug}`);
  const meta = getTableMeta(slug, table);
  const provider = String(process.env.ATM_CATALOG_PROVIDER || 'ftp').trim().toLowerCase();
  return provider === 'http' ? fetchFromHttpProvider(meta) : fetchFromFtpProvider(meta);
}

async function fetchFromLocal({ dataRoot, slug, table }) {
  const meta = getTableMeta(slug, table);

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
    remoteSupported: slug === 'atm',
  }));
}

async function syncTable({
  dataRoot,
  catalogRoot,
  slug,
  table,
  source = 'local',
  dryRun = false,
  persistSource = true,
  providerFetch = fetchFromProvider,
}) {
  const meta = getTableMeta(slug, table);
  const localSourcePath = path.join(dataRoot, slug, 'diccionarios', meta.fileName);
  const sourceInfo = source === 'remote'
    ? await providerFetch({ slug, table })
    : await fetchFromLocal({ dataRoot, slug, table });

  const normalizedInput = source === 'remote'
    ? normalizeRemoteRowsByTable(table, normalizeRecords(sourceInfo.sourceRaw))
    : normalizeRecords(sourceInfo.sourceRaw);
  const newRows = normalizedInput;
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
    if (persistSource && source === 'remote') {
      ensureDir(path.dirname(localSourcePath));
      const localPayload = buildLocalSourcePayload(table, newRows, sourceInfo.sourceRaw);
      await fsp.writeFile(localSourcePath, JSON.stringify(localPayload, null, 2), 'utf8');
    }
    await fsp.writeFile(path.join(histDir, `${stamp}.json`), JSON.stringify(currentData, null, 2), 'utf8');
    await fsp.writeFile(currentPath, JSON.stringify(currentData, null, 2), 'utf8');
  }

  return {
    ...report,
    paths: {
      currentPath,
      localSourcePath,
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

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { buildExpertaAuthHeaders } = require('./auth');
const { isVehicleZeroKm } = require('../../utils/zero_km');

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function dataDir() {
  return path.join(process.cwd(), 'data', 'experta', 'diccionarios');
}

function cachePath(name) {
  return path.join(dataDir(), `${name}.json`);
}

async function readJsonOptional(absPath, fallback) {
  try {
    const raw = await fsp.readFile(absPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(absPath, value) {
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
  await fsp.writeFile(absPath, JSON.stringify(value, null, 2), 'utf8');
}

function getBaseUrl(cfg = {}) {
  return String(cfg?.base_url || '').replace(/\/+$/, '');
}

async function getExperta(url, token, cfg = {}, params = {}) {
  const resp = await axios.get(url, {
    headers: buildExpertaAuthHeaders(token, cfg),
    params,
    timeout: 20000,
    validateStatus: () => true,
  });

  if (!(resp.status >= 200 && resp.status < 300)) {
    const message =
      typeof resp.data === 'object' && resp.data
        ? String(resp.data.message || resp.data.error || '')
        : '';
    throw new Error(message ? `Experta commons HTTP ${resp.status}: ${message}` : `Experta commons HTTP ${resp.status}`);
  }

  return resp.data;
}

function pickBestMatch(items, rawText, getLabel) {
  const wanted = normalizeText(rawText);
  if (!wanted) return null;
  let exact = null;
  let includes = null;
  for (const item of items || []) {
    const label = normalizeText(getLabel(item));
    if (!label) continue;
    if (label === wanted) {
      exact = item;
      break;
    }
    if (!includes && (label.includes(wanted) || wanted.includes(label))) {
      includes = item;
    }
  }
  return exact || includes || null;
}

async function getCachedCollection(name) {
  return await readJsonOptional(cachePath(name), {});
}

async function putCachedCollection(name, key, value) {
  const current = await getCachedCollection(name);
  current[key] = value;
  await writeJson(cachePath(name), current);
  return value;
}

async function loadResponsabilidades(token, cfg = {}) {
  const cacheFile = cachePath('iva');
  const cached = await readJsonOptional(cacheFile, null);
  if (Array.isArray(cached) && cached.length > 0) return cached;

  const data = await getExperta(`${getBaseUrl(cfg)}/commons/responsabilidades`, token, cfg);
  const list = Array.isArray(data) ? data : [];
  await writeJson(cacheFile, list);
  return list;
}

async function loadLocalidades(codPostal, token, cfg = {}) {
  const cp = String(codPostal || '').trim();
  const cache = await getCachedCollection('localidades');
  if (Array.isArray(cache[cp]) && cache[cp].length > 0) return cache[cp];

  const data = await getExperta(`${getBaseUrl(cfg)}/commons/localidades`, token, cfg, { codPostal: cp });
  const list = Array.isArray(data?.localidades) ? data.localidades : [];
  await putCachedCollection('localidades', cp, list);
  return list;
}

async function loadMarcas(anio, token, cfg = {}) {
  const key = String(anio || '').trim();
  const cache = await getCachedCollection('marcas');
  if (Array.isArray(cache[key]) && cache[key].length > 0) return cache[key];

  const data = await getExperta(`${getBaseUrl(cfg)}/commons/marcas`, token, cfg, { anio: key });
  const list = Array.isArray(data?.marcas) ? data.marcas : [];
  await putCachedCollection('marcas', key, list);
  return list;
}

async function loadModelos(anio, marca, token, cfg = {}) {
  const key = `${String(anio || '').trim()}|${String(marca || '').trim()}`;
  const cache = await getCachedCollection('modelos');
  if (Array.isArray(cache[key]) && cache[key].length > 0) return cache[key];

  const data = await getExperta(`${getBaseUrl(cfg)}/commons/modelos`, token, cfg, {
    anio: String(anio || '').trim(),
    marca: String(marca || '').trim(),
  });
  const list = Array.isArray(data?.modelos) ? data.modelos : [];
  await putCachedCollection('modelos', key, list);
  return list;
}

async function loadVersiones(anio, ceroKm, marca, modelo, token, cfg = {}) {
  const key = [
    String(anio || '').trim(),
    String(ceroKm || '').trim(),
    String(marca || '').trim(),
    String(modelo || '').trim(),
  ].join('|');
  const cache = await getCachedCollection('versiones');
  if (Array.isArray(cache[key]) && cache[key].length > 0) return cache[key];

  const data = await getExperta(`${getBaseUrl(cfg)}/commons/versiones`, token, cfg, {
    anio: String(anio || '').trim(),
    ceroKm: String(ceroKm || '').trim(),
    marca: String(marca || '').trim(),
    modelo: String(modelo || '').trim(),
  });
  const list = Array.isArray(data?.versiones) ? data.versiones : [];
  await putCachedCollection('versiones', key, list);
  return list;
}

async function resolveExpertaPostalCode({
  fila = {},
  cabecera = {},
  cfg = {},
  token = '',
} = {}) {
  const direct = String(
    fila?.codigo_postal ??
    fila?.codpostal ??
    fila?.CP ??
    fila?.cp ??
    cabecera?.cp ??
    ''
  ).trim();

  if (/^\d{7}$/.test(direct)) {
    return { codigoPostal: direct, source: 'direct_7' };
  }

  const cp4 = /^\d{4}$/.test(direct) ? direct : '';
  if (!cp4) {
    const fallback = String(cfg?.parametros_extras?.codigo_postal_default || '').trim();
    return { codigoPostal: fallback, source: fallback ? 'default' : 'missing', localidades: [] };
  }

  const localidades = token ? await loadLocalidades(cp4, token, cfg).catch(() => []) : [];
  const wantedLocalidad = normalizeText(fila?.localidad || fila?.Localidad || cabecera?.localidad || '');
  const wantedProvincia = normalizeText(fila?.provincia || fila?.Provincia || cabecera?.provincia || '');

  let match = null;
  if (wantedLocalidad) {
    match = pickBestMatch(localidades, wantedLocalidad, (item) => item?.localidad);
  }

  if (!match && wantedProvincia) {
    match = (localidades || []).find((item) => normalizeText(item?.provinciaId).includes(wantedProvincia));
  }

  if (!match && localidades.length > 0) match = localidades[0];
  if (match?.codPostal) {
    return {
      codigoPostal: String(match.codPostal).trim(),
      source: match === localidades[0] && !wantedLocalidad ? 'commons_first' : 'commons_match',
      localidades,
    };
  }

  return { codigoPostal: `${cp4}000`, source: 'cp4_padded', localidades };
}

async function resolveExpertaIva({
  cabecera = {},
  cfg = {},
  token = '',
} = {}) {
  const raw = normalizeText(cabecera?.iva);
  const fallbackMap = {
    CF: '5',
    'CONSUMIDOR FINAL': '5',
    RI: '1',
    'RESPONSABLE INSCRIPTO': '1',
    EX: '4',
    EXENTO: '4',
    MT: '6',
    MONOTRIBUTO: '6',
  };

  const list = token ? await loadResponsabilidades(token, cfg).catch(() => []) : [];
  const match = pickBestMatch(list, raw, (item) => item?.nombre || item?.descripcion || item?.codigo);
  if (match?.codigo) {
    return { iva: String(match.codigo).trim(), source: 'commons', responsabilidades: list };
  }

  const fallback = fallbackMap[raw] || String(cfg?.parametros_extras?.iva_default || '5');
  return { iva: fallback, source: fallbackMap[raw] ? 'fallback_map' : 'default', responsabilidades: list };
}

async function resolveExpertaVehicleCatalog({
  fila = {},
  cabecera = {},
  cfg = {},
  token = '',
  codInfoAuto = '',
  anio = '',
} = {}) {
  const rawMarca = String(fila?.marca || cabecera?.marca || '').trim();
  const rawModelo = String(fila?.modelo || cabecera?.modelo || '').trim();
  const rawVersion = String(fila?.version || cabecera?.version || '').trim();
  const ceroKm = isVehicleZeroKm(fila) ? 'S' : 'N';

  const out = {
    marca: rawMarca,
    modelo: rawModelo,
    version: rawVersion,
    codInfoAuto: String(codInfoAuto || '').trim(),
    source: 'input',
  };

  if (!token || !anio) return out;

  const marcas = await loadMarcas(anio, token, cfg).catch(() => []);
  const marcaMatch = rawMarca ? pickBestMatch(marcas, rawMarca, (item) => item?.descripcion) : null;
  if (marcaMatch?.descripcion) out.marca = String(marcaMatch.descripcion).trim();

  const modelos = out.marca ? await loadModelos(anio, out.marca, token, cfg).catch(() => []) : [];
  const modeloMatch = rawModelo ? pickBestMatch(modelos, rawModelo, (item) => item?.descripcion) : null;
  if (modeloMatch?.descripcion) out.modelo = String(modeloMatch.descripcion).trim();

  const versiones = out.marca && out.modelo
    ? await loadVersiones(anio, ceroKm, out.marca, out.modelo, token, cfg).catch(() => [])
    : [];

  let versionMatch = null;
  if (out.codInfoAuto) {
    versionMatch = (versiones || []).find((item) => String(item?.codigoInfoauto || '').trim() === out.codInfoAuto);
  }
  if (!versionMatch && rawVersion) {
    versionMatch = pickBestMatch(versiones, rawVersion, (item) => item?.descripcion);
  }
  if (!versionMatch && !out.codInfoAuto && versiones.length === 1) {
    versionMatch = versiones[0];
  }

  if (versionMatch?.descripcion) out.version = String(versionMatch.descripcion).trim();
  if (!out.codInfoAuto && versionMatch?.codigoInfoauto != null) {
    out.codInfoAuto = String(versionMatch.codigoInfoauto).trim();
  }

  if (versionMatch) out.source = 'commons_version';
  else if (modeloMatch || marcaMatch) out.source = 'commons_partial';

  return out;
}

module.exports = {
  loadLocalidades,
  loadMarcas,
  loadModelos,
  loadResponsabilidades,
  loadVersiones,
  resolveExpertaIva,
  resolveExpertaPostalCode,
  resolveExpertaVehicleCatalog,
};

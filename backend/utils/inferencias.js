const fs = require('fs/promises');
const path = require('path');
const db = require('../config/db');

const RIVADAVIA_INFERENCE_FILE = path.join(
  process.cwd(),
  'data',
  'rivadavia',
  'diccionarios',
  'infoauto_tipo_vehiculo.json'
);

let rivadaviaInferenceCache = null;
let rivadaviaInferenceWriteQueue = Promise.resolve();

function isRetryableFileError(err) {
  return ['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE'].includes(String(err?.code || '').toUpperCase());
}

async function writeJsonAtomicWithRetry(absPath, value, { maxAttempts = 6, baseDelayMs = 25 } = {}) {
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  const payload = JSON.stringify(value, null, 2);

  try {
    await fs.writeFile(tempPath, payload, 'utf8');
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await fs.rename(tempPath, absPath);
        return;
      } catch (err) {
        if (!isRetryableFileError(err) || attempt >= maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
      }
    }
  } finally {
    await fs.unlink(tempPath).catch((err) => {
      if (err?.code !== 'ENOENT') throw err;
    });
  }
}

async function buscarEnBasePropia(infoautocod) {
  const [rows] = await db.execute(
    'SELECT tipo_vehiculo FROM datos_vehiculos_propios WHERE infoautocod = ? LIMIT 1',
    [infoautocod]
  );
  return rows.length > 0 ? rows[0].tipo_vehiculo : null;
}

async function consultarApiExterna(infoautocod) {
  const resultadosSimulados = {
    '123456': 'SUV',
    '999999': 'Pick-Up A'
  };
  return resultadosSimulados[infoautocod] || null;
}

function inferirHeuristicamente(marca, modelo) {
  const texto = `${marca} ${modelo}`.toLowerCase();
  if (texto.includes('pick') || texto.includes('hilux')) return 'Pick-Up A';
  if (texto.includes('suv') || texto.includes('tracker') || texto.includes('creta')) return 'SUV';
  if (texto.includes('hatch')) return 'Hatchback';
  return 'Sedán';
}

async function guardarEnBase(infoautocod, marca, modelo, tipoVehiculo) {
  await db.execute(
    'INSERT INTO datos_vehiculos_propios (infoautocod, Marca, Modelo, tipo_vehiculo) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tipo_vehiculo = VALUES(tipo_vehiculo)',
    [infoautocod, marca, modelo, tipoVehiculo]
  );
}

async function inferirTipoVehiculo(row) {
  const cod = row.infoautocod || row.codigo_infoauto || '';
  const marca = row.Marca || row.marca || '';
  const modelo = row.Modelo || row.modelo || '';

  if (!cod) return 'Sedán';

  let tipo = await buscarEnBasePropia(cod);
  if (tipo) return tipo;

  tipo = await consultarApiExterna(cod);
  if (tipo) {
    await guardarEnBase(cod, marca, modelo, tipo);
    return tipo;
  }

  tipo = inferirHeuristicamente(marca, modelo);
  await guardarEnBase(cod, marca, modelo, tipo);
  return tipo;
}

async function readJsonOptional(absPath, fallback) {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function loadRivadaviaInferenceMap() {
  if (rivadaviaInferenceCache) return rivadaviaInferenceCache;
  rivadaviaInferenceCache = await readJsonOptional(RIVADAVIA_INFERENCE_FILE, {});
  return rivadaviaInferenceCache;
}

async function getRivadaviaTipoVehiculoInferido(infoautocod) {
  const code = String(infoautocod || '').replace(/^0+/, '').trim();
  if (!code) return null;
  const map = await loadRivadaviaInferenceMap();
  return map[code] || null;
}

async function upsertRivadaviaTipoVehiculoInferido({
  codigoInfoAuto,
  tipoVehiculo,
  descripcionVehiculo = '',
  descripcionTipoVehiculo = '',
  source = 'quote_success',
} = {}) {
  const code = String(codigoInfoAuto || '').replace(/^0+/, '').trim();
  const tipo = String(tipoVehiculo || '').trim();
  if (!code || !tipo) return;

  const writeOperation = rivadaviaInferenceWriteQueue.catch(() => {}).then(async () => {
    const current = await readJsonOptional(RIVADAVIA_INFERENCE_FILE, {});
    current[code] = {
      codigoInfoAuto: code,
      tipoVehiculo: tipo,
      descripcionVehiculo: String(descripcionVehiculo || ''),
      descripcionTipoVehiculo: String(descripcionTipoVehiculo || ''),
      source: String(source || 'quote_success'),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomicWithRetry(RIVADAVIA_INFERENCE_FILE, current);
    rivadaviaInferenceCache = current;
    if (descripcionTipoVehiculo) {
      await guardarEnBase(code, '', descripcionVehiculo || '', descripcionTipoVehiculo);
    }
  });

  // Mantener la cola utilizable aun si una escritura puntual falla.
  rivadaviaInferenceWriteQueue = writeOperation.catch(() => {});

  await writeOperation;
}

module.exports = {
  buscarEnBasePropia,
  consultarApiExterna,
  guardarEnBase,
  getRivadaviaTipoVehiculoInferido,
  inferirTipoVehiculo,
  inferirHeuristicamente,
  loadRivadaviaInferenceMap,
  upsertRivadaviaTipoVehiculoInferido,
  writeJsonAtomicWithRetry,
};

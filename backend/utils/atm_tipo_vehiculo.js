const fs = require('fs/promises');
const path = require('path');

function dataPath(...p) {
  return path.join(process.cwd(), 'data', ...p);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

function pickInfoautoCode(row) {
  const raw =
    row?.infoautocod ??
    row?.tau_codia ??
    row?.codigo_infoauto ??
    row?.cod_infoauto ??
    row?.codigoInfoauto ??
    row?.CodigoInfoauto ??
    row?.InfoAutoCod ??
    row?.infoauto;
  return String(raw ?? '').trim();
}

let atmCatalogCache = null;

async function loadAtmCatalogIndexes() {
  if (atmCatalogCache) return atmCatalogCache;

  const [marcas, marcaModelo, infoautoDc] = await Promise.all([
    readJson(dataPath('atm', 'diccionarios', 'marcas.json')).catch(() => []),
    readJson(dataPath('atm', 'diccionarios', 'marca_modelo.json')).catch(() => []),
    readJson(dataPath('atm', 'diccionarios', 'infoauto_dc.json')).catch(() => []),
  ]);

  const marcasByCodigo = new Map(
    (Array.isArray(marcas) ? marcas : []).map((row) => [String(row?.codigo ?? '').trim(), row])
  );
  const marcaModeloByTauCodia = new Map(
    (Array.isArray(marcaModelo) ? marcaModelo : []).map((row) => [String(row?.tau_codia ?? '').trim(), row])
  );
  const infoautoDcByTauCodia = new Map(
    (Array.isArray(infoautoDc) ? infoautoDc : []).map((row) => [String(row?.tau_codia ?? '').trim(), row])
  );

  atmCatalogCache = { marcasByCodigo, marcaModeloByTauCodia, infoautoDcByTauCodia };
  return atmCatalogCache;
}

async function resolveAtmVehicleKind(row) {
  const infoautoCode = pickInfoautoCode(row);
  if (!infoautoCode) return null;

  const idx = await loadAtmCatalogIndexes();
  let modelRow = idx.marcaModeloByTauCodia.get(infoautoCode) || null;
  let canonicalCode = infoautoCode;
  let source = 'marca_modelo';

  if (!modelRow) {
    const dcRow = idx.infoautoDcByTauCodia.get(infoautoCode) || null;
    const mappedCode = String(dcRow?.cmarca ?? '').trim();
    if (mappedCode) {
      canonicalCode = mappedCode;
      modelRow = idx.marcaModeloByTauCodia.get(mappedCode) || null;
      source = 'infoauto_dc';
    }
  }

  if (!modelRow) return null;

  const marcaCode = String(modelRow?.cod_marca ?? '').trim();
  const marcaRow = idx.marcasByCodigo.get(marcaCode) || null;
  const seccion = String(marcaRow?.seccion ?? '').trim();
  const descripcionMarca = String(marcaRow?.descripcion ?? modelRow?.marca ?? '').trim();
  const modelo = String(modelRow?.modelo ?? '').trim();

  if (!seccion) {
    return {
      infoautoCode,
      canonicalCode,
      marcaCode,
      marca: descripcionMarca,
      modelo,
      source,
      isMoto: null,
      seccion: '',
    };
  }

  return {
    infoautoCode,
    canonicalCode,
    marcaCode,
    marca: descripcionMarca,
    modelo,
    source,
    isMoto: seccion === '4',
    seccion,
  };
}

module.exports = {
  pickInfoautoCode,
  resolveAtmVehicleKind,
};

const fs = require('fs');
const path = require('path');
const {
  fetchProvinciaBrands,
  fetchProvinciaModels,
  fetchProvinciaYears,
  findProvinciaBrandCandidate,
  findProvinciaModelCandidate,
} = require('../backend/services/provincia/catalog');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(ROOT, 'tmp');
const RAMO = '4';
const PRODUCTO = '04100';
const ES_0KM = 'N';
const LIMIT = 50;
const PER_BRAND = 5;
const ACCEPTED_MATCH_SOURCES = new Set([
  'catalog_code_exact',
  'catalog_description_exact',
  'catalog_description_no_line',
]);
const TARGET_BRANDS = [
  'AUDI',
  'CHEVROLET',
  'FIAT',
  'FORD',
  'PEUGEOT',
  'RENAULT',
  'TOYOTA',
  'VOLKSWAGEN',
  'NISSAN',
  'MERCEDES BENZ',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function pad6(value) {
  const digits = onlyDigits(value);
  return digits ? digits.padStart(6, '0') : '';
}

function csvEscape(value) {
  const raw = String(value ?? '');
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function uniqueRowsByModel(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(row?.modelo || '').trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((left, right) => Number(onlyDigits(right?.tau_codia)) - Number(onlyDigits(left?.tau_codia)));
}

async function main() {
  const cfg = readJson(path.join(DATA_DIR, 'provincia', 'aseguradora.json'));
  const marcas = readJson(path.join(DATA_DIR, 'atm', 'diccionarios', 'marcas.json'));
  const marcaModelo = readJson(path.join(DATA_DIR, 'atm', 'diccionarios', 'marca_modelo.json'));
  const marcasAuto = new Set(
    (Array.isArray(marcas) ? marcas : [])
      .filter((row) => String(row?.seccion || '').trim() === '3')
      .map((row) => String(row?.descripcion || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const provinciaBrands = await fetchProvinciaBrands(cfg, { ramo: RAMO, producto: PRODUCTO });
  const provinciaYears = (await fetchProvinciaYears(cfg))
    .map((row) => String(row?.codigo || '').trim())
    .filter((value) => /^\d{4}$/.test(value))
    .sort((left, right) => Number(right) - Number(left));

  const rowsByBrand = new Map();
  for (const row of Array.isArray(marcaModelo) ? marcaModelo : []) {
    const brand = String(row?.marca || '').trim().toUpperCase();
    if (!TARGET_BRANDS.includes(brand)) continue;
    if (!marcasAuto.has(brand)) continue;
    if (!rowsByBrand.has(brand)) rowsByBrand.set(brand, []);
    rowsByBrand.get(brand).push(row);
  }

  const reportRows = [];
  for (const brand of TARGET_BRANDS) {
    if (reportRows.length >= LIMIT) break;
    const brandRows = uniqueRowsByModel(rowsByBrand.get(brand) || []);
    if (!brandRows.length) continue;

    const brandMatch = findProvinciaBrandCandidate({
      brands: provinciaBrands,
      candidateTexts: [brand],
    });
    if (!brandMatch?.item?.codigo) continue;

    let collectedForBrand = 0;
    for (const row of brandRows) {
      if (reportRows.length >= LIMIT || collectedForBrand >= PER_BRAND) break;

      let resolved = null;
      for (const year of provinciaYears) {
        const models = await fetchProvinciaModels(cfg, {
          ramo: RAMO,
          producto: PRODUCTO,
          marca: String(brandMatch.item.codigo).trim(),
          anio: year,
          es0km: ES_0KM,
        });
        const match = findProvinciaModelCandidate({
          models,
          candidateTexts: [row?.modelo],
          candidateCodes: [row?.tau_codia, row?.cod_modelo],
        });
        if (match?.item?.codigo) {
          if (!ACCEPTED_MATCH_SOURCES.has(match.source)) continue;
          resolved = {
            year,
            match,
          };
          break;
        }
      }

      if (!resolved) continue;

      const rawInfoauto = onlyDigits(row?.tau_codia);
      const infoautoPad6 = pad6(row?.tau_codia);
      const codModelo = onlyDigits(row?.cod_modelo);
      const provinciaCode = String(resolved.match.item.codigo).trim();

      reportRows.push({
        brand,
        provincia_brand_code: String(brandMatch.item.codigo).trim(),
        model: String(row?.modelo || '').trim(),
        matched_year: resolved.year,
        infoauto_tau_codia: rawInfoauto,
        infoauto_tau_codia_pad6: infoautoPad6,
        infoauto_cod_modelo: codModelo,
        provincia_model_code: provinciaCode,
        provincia_model_description: String(resolved.match.item.descripcion || '').trim(),
        match_source: resolved.match.source || '',
        same_as_tau_codia: rawInfoauto === provinciaCode,
        same_as_tau_codia_pad6: infoautoPad6 === provinciaCode,
        same_as_cod_modelo: codModelo === provinciaCode,
      });
      collectedForBrand += 1;
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const summary = {
    generated_at: new Date().toISOString(),
    total: reportRows.length,
    sampled_brands: [...new Set(reportRows.map((row) => row.brand))],
    counts: {
      same_as_tau_codia: reportRows.filter((row) => row.same_as_tau_codia).length,
      same_as_tau_codia_pad6: reportRows.filter((row) => row.same_as_tau_codia_pad6).length,
      same_as_cod_modelo: reportRows.filter((row) => row.same_as_cod_modelo).length,
      description_or_catalog_resolve_only: reportRows.filter(
        (row) => !row.same_as_tau_codia && !row.same_as_tau_codia_pad6 && !row.same_as_cod_modelo
      ).length,
    },
  };

  const jsonPath = path.join(OUTPUT_DIR, 'provincia-infoauto-50-modelos.json');
  const csvPath = path.join(OUTPUT_DIR, 'provincia-infoauto-50-modelos.csv');

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows: reportRows }, null, 2));
  const headers = [
    'brand',
    'provincia_brand_code',
    'model',
    'matched_year',
    'infoauto_tau_codia',
    'infoauto_tau_codia_pad6',
    'infoauto_cod_modelo',
    'provincia_model_code',
    'provincia_model_description',
    'match_source',
    'same_as_tau_codia',
    'same_as_tau_codia_pad6',
    'same_as_cod_modelo',
  ];
  const csvLines = [
    headers.join(','),
    ...reportRows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`);

  console.log(JSON.stringify({
    summary,
    jsonPath,
    csvPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

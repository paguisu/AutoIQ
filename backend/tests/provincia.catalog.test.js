const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  __resetProvinciaCatalogStateForTests,
  buildBrandCacheKey,
  buildModelCacheKey,
  findProvinciaBrandCandidate,
  findProvinciaModelCandidate,
  resolveProvinciaBrand,
  resolveProvinciaModel,
} = require('../services/provincia/catalog');

describe('Provincia catalog helpers', () => {
  let tmpDir = '';
  const previousDictionaryDir = process.env.PROVINCIA_DICTIONARY_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provincia-catalog-'));
    process.env.PROVINCIA_DICTIONARY_DIR = tmpDir;
    __resetProvinciaCatalogStateForTests();
  });

  afterEach(() => {
    __resetProvinciaCatalogStateForTests();
    if (previousDictionaryDir == null) delete process.env.PROVINCIA_DICTIONARY_DIR;
    else process.env.PROVINCIA_DICTIONARY_DIR = previousDictionaryDir;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('encuentra marca por descripcion normalizada', () => {
    const match = findProvinciaBrandCandidate({
      brands: [
        { codigo: 'MEB', descripcion: 'MERCEDES-BENZ' },
        { codigo: 'TOY', descripcion: 'TOYOTA' },
      ],
      candidateTexts: ['Mercedes Benz'],
    });

    expect(match).toMatchObject({
      source: 'catalog_description_exact',
      item: { codigo: 'MEB' },
    });
  });

  test('encuentra modelo por descripcion aunque el codigo no coincida con InfoAuto crudo', () => {
    const match = findProvinciaModelCandidate({
      models: [
        { codigo: '006533', descripcion: 'A1 35T  SPORTBACK STRONIC ' },
        { codigo: '006534', descripcion: 'A1 30T  SPORTBACK STRONIC ' },
      ],
      candidateTexts: ['A1 35T SPORTBACK STRONIC'],
      candidateCodes: ['60533'],
    });

    expect(match).toMatchObject({
      source: 'catalog_description_exact',
      item: { codigo: '006533' },
    });
  });

  test('usa el diccionario persistente fresco para marca sin consultar Provincia', async () => {
    const cachePath = path.join(tmpDir, 'brand_cache.json');
    const cacheKey = buildBrandCacheKey({
      ramo: '4',
      producto: '04100',
      brandText: 'Audi',
    });
    fs.writeFileSync(cachePath, JSON.stringify({
      version: 1,
      ttl_days: 180,
      entries: {
        [cacheKey]: {
          code: 'AUD',
          description: 'AUDI',
          match_source: 'catalog_description_exact',
          first_verified_at: '2026-01-01T00:00:00.000Z',
          last_verified_at: new Date().toISOString(),
        },
      },
    }, null, 2));

    const fetchBrands = jest.fn();
    const result = await resolveProvinciaBrand({}, {
      ramo: '4',
      producto: '04100',
      candidateTexts: ['Audi'],
      fetchBrands,
    });

    expect(fetchBrands).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      code: 'AUD',
      source: 'dictionary_cache_fresh',
      cacheState: 'fresh',
      matchSource: 'catalog_description_exact',
    });
  });

  test('revalida un modelo vencido y actualiza el diccionario', async () => {
    const cachePath = path.join(tmpDir, 'model_cache.json');
    const cacheKey = buildModelCacheKey({
      ramo: '4',
      producto: '04100',
      brandCode: 'AUD',
      anio: '2023',
      es0km: 'N',
      modelText: 'A1 35T SPORTBACK STRONIC',
    });
    fs.writeFileSync(cachePath, JSON.stringify({
      version: 1,
      ttl_days: 180,
      entries: {
        [cacheKey]: {
          code: '006500',
          description: 'A1 35T SPORTBACK',
          match_source: 'catalog_description_exact',
          first_verified_at: '2025-01-01T00:00:00.000Z',
          last_verified_at: '2025-01-01T00:00:00.000Z',
        },
      },
    }, null, 2));

    const result = await resolveProvinciaModel({}, {
      ramo: '4',
      producto: '04100',
      brandCode: 'AUD',
      anio: '2023',
      es0km: 'N',
      candidateTexts: ['A1 35T SPORTBACK STRONIC'],
      fetchModels: jest.fn().mockResolvedValue([
        { codigo: '006533', descripcion: 'A1 35T  SPORTBACK STRONIC ' },
      ]),
    });

    expect(result).toMatchObject({
      code: '006533',
      source: 'catalog_description_exact',
      cacheState: 'revalidated',
    });

    const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    expect(persisted.entries[cacheKey]).toMatchObject({
      code: '006533',
      description: 'A1 35T  SPORTBACK STRONIC',
    });
    expect(Date.parse(persisted.entries[cacheKey].last_verified_at)).toBeGreaterThan(Date.parse('2025-01-01T00:00:00.000Z'));
  });

  test('si el cache vencio y Provincia no responde, usa el valor cacheado como stale fallback', async () => {
    const cachePath = path.join(tmpDir, 'model_cache.json');
    const cacheKey = buildModelCacheKey({
      ramo: '4',
      producto: '04100',
      brandCode: 'NIS',
      anio: '2023',
      es0km: 'N',
      modelText: 'KICKS 1.6 SENSE MT L/22',
    });
    fs.writeFileSync(cachePath, JSON.stringify({
      version: 1,
      ttl_days: 180,
      entries: {
        [cacheKey]: {
          code: '030259',
          description: 'KICKS 1.6 SENSE MT L/22',
          match_source: 'catalog_description_exact',
          first_verified_at: '2025-01-01T00:00:00.000Z',
          last_verified_at: '2025-01-01T00:00:00.000Z',
        },
      },
    }, null, 2));

    const result = await resolveProvinciaModel({}, {
      ramo: '4',
      producto: '04100',
      brandCode: 'NIS',
      anio: '2023',
      es0km: 'N',
      candidateTexts: ['KICKS 1.6 SENSE MT L/22'],
      fetchModels: jest.fn().mockRejectedValue(new Error('catalogo caido')),
    });

    expect(result).toMatchObject({
      code: '030259',
      source: 'dictionary_cache_stale_fallback',
      cacheState: 'stale_fallback',
      warning: 'catalogo caido',
    });
  });
});

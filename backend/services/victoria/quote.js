const { victoriaGet } = require('./client');
const { resolveCompanyTracking } = require('../../utils/rastreo');
const { isVehicleZeroKm } = require('../../utils/zero_km');

const companyCache = new Map();

function pick(values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function parsePositiveInt(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return null;
  const out = Number.parseInt(digits, 10);
  return Number.isFinite(out) && out > 0 ? out : null;
}

function parseNumber(value) {
  if (value == null) return null;
  const normalized = String(value)
    .trim()
    .replace('%', '')
    .replace(',', '.')
    .replace(/[^\d.+-]+/g, '');
  if (!normalized) return null;
  const out = Number(normalized);
  return Number.isFinite(out) ? out : null;
}

function boolFlag(value) {
  const raw = normalizeText(value);
  return ['1', 'S', 'SI', 'TRUE', 'CON', 'POSEE'].includes(raw);
}

function resolveVictoriaTracking({ cabecera = {}, cfg = {} } = {}) {
  const tracking = resolveCompanyTracking(cabecera, 'victoria', cfg);
  const enabled = tracking.hasTracking;
  const directSystemId = parsePositiveInt(pick([
    cabecera?.sistema_rastreo_victoria,
    cabecera?.sistemaRastreoVictoria,
  ]));
  const configuredDefaultId = parsePositiveInt(cfg?.parametros_extras?.sistema_rastreo_default_id);
  const systemId = enabled
    ? directSystemId ||
      parsePositiveInt(tracking.mappedValue) ||
      configuredDefaultId ||
      1
    : null;
  const systemDescriptions = {
    1: 'TRACER',
    2: 'ITURAN',
    3: 'DATATRAK',
    4: 'UBICAR',
    5: 'LO JACK',
  };

  return {
    poseeRastreo: enabled,
    sistemaRastreo: systemId ? { id: systemId, descripcion: systemDescriptions[systemId] || null } : null,
    nuevoRastreo: false,
    rastreoSistema: tracking.system,
    rastreoSistemaEfectivo: tracking.effectiveSystem,
    rastreoDefaultAplicado: tracking.defaultApplied,
  };
}

function normalizeCp(value) {
  return String(value || '').replace(/\D+/g, '');
}

function getCacheKey(cfg = {}) {
  return JSON.stringify({
    base_url: String(cfg?.base_url || '').trim().replace(/\/+$/, ''),
    usuario: String(cfg?.usuario || '').trim(),
    producer_code: String(cfg?.producer_code || '').trim(),
  });
}

function getCompanyCache(cfg = {}) {
  const cacheKey = getCacheKey(cfg);
  if (!companyCache.has(cacheKey)) {
    companyCache.set(cacheKey, {
      refs: new Map(),
      localitiesByProvince: new Map(),
      modelsByBrandYear: new Map(),
      localityIndexPromise: null,
    });
  }
  return companyCache.get(cacheKey);
}

async function rememberPromise(map, key, loader) {
  if (!map.has(key)) {
    map.set(
      key,
      Promise.resolve()
        .then(loader)
        .catch((err) => {
          map.delete(key);
          throw err;
        })
    );
  }
  return map.get(key);
}

async function cachedVictoriaGetJson(cfg, path, params) {
  const cache = getCompanyCache(cfg);
  const cacheKey = JSON.stringify({ path, params: params || null });
  return rememberPromise(cache.refs, cacheKey, async () => {
    const { resp } = await victoriaGet(cfg, path, params);
    if (!(resp.status >= 200 && resp.status < 300)) {
      const msg =
        typeof resp.data === 'object' && resp.data
          ? pick([resp.data.message, resp.data.error, resp.data.debugMessage])
          : '';
      throw new Error(msg ? `Victoria ${path} HTTP ${resp.status}: ${msg}` : `Victoria ${path} HTTP ${resp.status}`);
    }
    return resp.data;
  });
}

async function getLocalities(cfg, provinceCode) {
  const cache = getCompanyCache(cfg);
  const key = String(provinceCode || '').trim();
  return rememberPromise(cache.localitiesByProvince, key, async () => {
    const data = await cachedVictoriaGetJson(cfg, `/cea/reference/obtenerLocalidades/${encodeURIComponent(key)}`);
    return asArray(data);
  });
}

async function getModels(cfg, brandId, year) {
  const cache = getCompanyCache(cfg);
  const key = `${brandId}|${year}`;
  return rememberPromise(cache.modelsByBrandYear, key, async () => {
    const data = await cachedVictoriaGetJson(
      cfg,
      `/cea/reference/obtenerModelos/${encodeURIComponent(brandId)}/${encodeURIComponent(year)}`
    );
    return asArray(data);
  });
}

async function buildLocalityIndex(cfg) {
  const cache = getCompanyCache(cfg);
  if (!cache.localityIndexPromise) {
    cache.localityIndexPromise = (async () => {
      const provinces = asArray(await cachedVictoriaGetJson(cfg, '/cea/reference/provincias'));
      const byCp = new Map();
      for (const province of provinces) {
        const localities = await getLocalities(cfg, province.codigo);
        for (const locality of localities) {
          const cp = normalizeCp(locality?.codigoPostal);
          if (!cp) continue;
          if (!byCp.has(cp)) byCp.set(cp, []);
          byCp.get(cp).push({ province, locality });
        }
      }
      return { provinces, byCp };
    })().catch((err) => {
      cache.localityIndexPromise = null;
      throw err;
    });
  }
  return cache.localityIndexPromise;
}

function pickInfoautoCode(fila = {}) {
  return pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
}

function pickVehicleYear(fila = {}) {
  return (
    parsePositiveInt(
      pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano, fila?.veh_anio, fila?.veh_anofab])
    ) || null
  );
}

function pickProvinceText(fila = {}, cabecera = {}, cfg = {}) {
  return pick([
    fila?.provincia,
    fila?.Provincia,
    fila?.prov,
    cabecera?.provincia,
    cabecera?.Provincia,
    cfg?.parametros_extras?.provincia_default,
  ]);
}

function pickLocalityText(fila = {}, cabecera = {}) {
  return pick([
    fila?.localidad,
    fila?.Localidad,
    fila?.ciudad,
    fila?.Ciudad,
    cabecera?.localidad,
    cabecera?.Localidad,
    cabecera?.ciudad,
  ]);
}

function pickPostalCode(fila = {}, cabecera = {}) {
  return pick([
    fila?.codigo_postal,
    fila?.codpostal,
    fila?.CP,
    fila?.cp,
    fila?.CodigoPostal,
    cabecera?.cp,
    cabecera?.CP,
    cabecera?.codigo_postal,
  ]);
}

function pickBrandText(fila = {}, cabecera = {}, cfg = {}) {
  return pick([
    fila?.marca,
    fila?.Marca,
    fila?.veh_marca,
    cabecera?.marca,
    cabecera?.Marca,
    cfg?.parametros_extras?.marca_default,
  ]);
}

function pickModelText(fila = {}, cabecera = {}, cfg = {}) {
  return pick([
    fila?.modelo,
    fila?.Modelo,
    fila?.version,
    fila?.Version,
    fila?.veh_modelo,
    cabecera?.modelo,
    cabecera?.Modelo,
    cfg?.parametros_extras?.modelo_default,
  ]);
}

function matchByText(items, rawText, getter) {
  const list = asArray(items);
  if (!list.length) return null;

  const numeric = parsePositiveInt(rawText);
  if (numeric != null) {
    return list.find((item) => Number(item?.id ?? item?.codigo ?? 0) === numeric) || null;
  }

  const target = normalizeText(rawText);
  if (!target) return null;

  const exact = list.find((item) => normalizeText(getter(item)) === target);
  if (exact) return exact;

  const included = list.find((item) => {
    const current = normalizeText(getter(item));
    return current && (current.includes(target) || target.includes(current));
  });
  if (included) return included;

  const tokens = target.split(' ').filter(Boolean);
  if (tokens.length) {
    return (
      list.find((item) => {
        const current = normalizeText(getter(item));
        return current && tokens.every((token) => current.includes(token));
      }) || null
    );
  }

  return null;
}

function resolveVictoriaUseId({ fila = {}, cabecera = {}, usoDicc = {}, defaultId = 1 } = {}) {
  const raw = pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso, cabecera?.uso_default, cabecera?.uso]);
  const numeric = parsePositiveInt(raw);
  if (numeric != null) return numeric;

  const normalized = String(raw || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const mapped = parsePositiveInt(usoDicc[normalized]);
  if (mapped != null) return mapped;
  if (normalized.includes('comer') || normalized.includes('carga') || normalized.includes('flete')) return 2;
  if (normalized.includes('taxi') || normalized.includes('remis')) return 2;
  if (normalized) return 1;
  return parsePositiveInt(defaultId) || 1;
}

function resolveVictoriaUseDescription(useId, fila = {}, cabecera = {}) {
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, fila?.tipo_uso, cabecera?.uso_default, cabecera?.uso]));
  if (useId === 2) {
    if (raw.includes('TAXI')) return 'TAXI';
    if (raw.includes('REMIS')) return 'REMIS';
    return 'COMERCIAL';
  }
  return raw || 'PARTICULAR';
}

function resolveTipoPersona({ fila = {}, cabecera = {}, personTypes = [] } = {}) {
  const raw = normalizeText(pick([fila?.tipo_persona, cabecera?.tipo_persona, cabecera?.tipoPersona]));
  const juridica = raw.includes('JURID') || raw.includes('EMPRESA');
  return asArray(personTypes).find((item) => item?.id === (juridica ? 2 : 1)) || asArray(personTypes)[0] || null;
}

function resolveTipoDocumento({ tipoPersona, docs = [] } = {}) {
  const targetCode = Number(tipoPersona?.id || 0) === 2 ? 80 : 96;
  return asArray(docs).find((item) => Number(item?.codigoDocumento || 0) === targetCode) || asArray(docs)[0] || null;
}

function resolveIva({ cabecera = {}, cfg = {}, ivas = [] } = {}) {
  const list = asArray(ivas);
  const configured = parsePositiveInt(cfg?.parametros_extras?.iva_default);
  if (configured != null) {
    const exactConfigured = list.find((item) => Number(item?.codigo || 0) === configured);
    if (exactConfigured) return exactConfigured;
  }

  const raw = normalizeText(cabecera?.iva);
  const containsDescription = (needle) => list.find((item) => normalizeText(item?.descripcion).includes(needle)) || null;
  if (raw === 'CF' || raw.includes('CONSUMIDOR FINAL')) return containsDescription('CONSUMIDOR FINAL');
  if (raw === 'RI' || raw.includes('RESPONSABLE INSCRIPTO')) return containsDescription('RESPONSABLE INSCRIPTO');
  if (raw === 'MT' || raw.includes('MONOTRIBUTO')) return containsDescription('MONOTRIBUTO');
  if (raw === 'EX' || raw.includes('EXENTO')) return containsDescription('EXENTO');
  if (raw.includes('NO INSCRIPTO')) return containsDescription('NO INSCRIPTO');

  return containsDescription('CONSUMIDOR FINAL') || list[0] || null;
}

function resolveCivilStatus({ states = [] } = {}) {
  return asArray(states).find((item) => Number(item?.id || 0) === 1) || asArray(states)[0] || null;
}

function resolveOccupation({ occupations = [] } = {}) {
  return asArray(occupations)[0] || null;
}

async function resolveProducer(cfg) {
  const producers = asArray(await cachedVictoriaGetJson(cfg, '/cea/reference/productores'));
  if (!producers.length) throw new Error('Victoria no devolvio productores');

  const raw = pick([cfg?.producer_code, cfg?.parametros_extras?.producer_code_default]);
  const numeric = parsePositiveInt(raw);
  let producer = null;
  let source = 'first';

  if (numeric != null) {
    producer = producers.find((item) => Number(item?.id || 0) === numeric) || null;
    source = 'configured_id';
  } else if (raw) {
    producer = matchByText(producers, raw, (item) => item?.nombre) || null;
    source = 'configured_name';
  }

  if (!producer) {
    const userHint = normalizeText(cfg?.usuario);
    if (userHint) {
      producer = producers.find((item) => normalizeText(item?.nombre).includes(userHint)) || null;
      if (producer) source = 'user_hint';
    }
  }

  if (!producer) producer = producers[0];
  if (!producer) throw new Error('Victoria no pudo resolver el productor');

  return { producer, source };
}

async function resolveProvinceAndLocality({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const provinces = asArray(await cachedVictoriaGetJson(cfg, '/cea/reference/provincias'));
  const rawProvince = pickProvinceText(fila, cabecera, cfg);
  const rawLocality = pickLocalityText(fila, cabecera);
  const cp = normalizeCp(pickPostalCode(fila, cabecera));

  let province = null;
  const provinceCode = parsePositiveInt(rawProvince);
  if (provinceCode != null) {
    province = provinces.find((item) => Number(item?.codigo || 0) === provinceCode) || null;
  }
  if (!province && rawProvince) {
    province = matchByText(provinces, rawProvince, (item) => item?.nombre);
  }

  let locality = null;
  let source = province ? 'province' : 'cp';

  if (province) {
    const localities = await getLocalities(cfg, province.codigo);
    if (cp) {
      const sameCp = localities.filter((item) => normalizeCp(item?.codigoPostal) === cp);
      locality = (rawLocality ? matchByText(sameCp, rawLocality, (item) => item?.nombre) : null) || sameCp[0] || null;
      if (locality) source = 'province+cp';
    }
    if (!locality && rawLocality) {
      locality = matchByText(localities, rawLocality, (item) => item?.nombre);
      if (locality) source = 'province+locality';
    }
    if (!locality && localities.length === 1) {
      locality = localities[0];
      source = 'province-single-locality';
    }
  }

  if (!locality && cp) {
    const index = await buildLocalityIndex(cfg);
    const candidates = asArray(index.byCp.get(cp));
    const filteredByProvince =
      province ? candidates.filter((item) => Number(item?.province?.codigo || 0) === Number(province.codigo || 0)) : candidates;
    const scoped = filteredByProvince.length ? filteredByProvince : candidates;
    const matched =
      (rawLocality
        ? scoped.find((item) => normalizeText(item?.locality?.nombre) === normalizeText(rawLocality))
        : null) ||
      scoped[0] ||
      null;
    if (matched) {
      province = matched.province;
      locality = matched.locality;
      source = rawLocality ? 'cp+locality' : 'cp-only';
    }
  }

  if (!province || !locality) {
    throw new Error(`Victoria no pudo resolver provincia/localidad para CP ${cp || '(sin CP)'}`);
  }

  return { province, locality, source, cp: normalizeCp(locality?.codigoPostal) || cp };
}

async function resolveBrandAndModel({ fila = {}, cabecera = {}, cfg = {}, year }) {
  const brands = asArray(await cachedVictoriaGetJson(cfg, '/cea/reference/obtenerMarcas'));
  const rawBrand = pickBrandText(fila, cabecera, cfg);
  const rawModel = pickModelText(fila, cabecera, cfg);

  let brand = null;
  if (!brand && rawBrand) {
    brand = matchByText(brands, rawBrand, (item) => item?.descripcion);
  }
  if (!brand) throw new Error(`Victoria no pudo resolver la marca para "${rawBrand || '(sin marca)'}"`);

  const models = await getModels(cfg, brand.id, year);
  let model = null;
  if (!model && rawModel) {
    model = matchByText(models, rawModel, (item) => item?.descripcion);
  }
  if (!model && models.length) model = models[0];
  if (!model) throw new Error(`Victoria no pudo resolver el modelo para "${rawModel || '(sin modelo)'}"`);

  return {
    brand,
    model,
    source: {
      brand: rawBrand ? 'input' : 'fallback',
      model: rawModel ? 'input' : 'fallback',
    },
  };
}

function resolveFormaPagoCode({ cabecera = {}, cfg = {}, formasPago = [] } = {}) {
  const raw = normalizeText(
    pick([
      cabecera?.medio_pago,
      cabecera?.medioPago,
      cabecera?.forma_pago,
      cabecera?.formaPago,
      cfg?.forma_pago,
      cfg?.formaPago,
      cfg?.medio_pago,
      cfg?.medioPago,
      cfg?.parametros_extras?.forma_pago_default,
    ])
  );

  const configuredCode = parsePositiveInt(cfg?.parametros_extras?.forma_pago_default_id);
  if (configuredCode != null) return configuredCode;

  if (raw.includes('TARJ')) return 2;
  if (raw.includes('CBU') || raw.includes('DEBIT')) return 3;
  if (raw.includes('EFEC') || raw.includes('PAGO FACIL') || raw.includes('RAPIPAGO')) return 1;

  return asArray(formasPago)[0]?.codigo || 1;
}

function resolveByConfiguredIdOrNumber(list, idValue, rawValue, numericGetters = []) {
  const items = asArray(list);
  const configuredId = parsePositiveInt(idValue);
  if (configuredId != null) {
    const exact = items.find((item) => Number(item?.id ?? item?.codigo ?? 0) === configuredId);
    if (exact) return exact;
  }

  const configuredNumber = parseNumber(rawValue);
  if (configuredNumber != null) {
    const exact = items.find((item) =>
      numericGetters.some((getter) => {
        const n = parseNumber(getter(item));
        return n != null && Math.abs(n - configuredNumber) < 0.000001;
      })
    );
    if (exact) return exact;
  }

  const rawText = normalizeText(rawValue);
  if (rawText) {
    const exactText = items.find((item) => normalizeText(item?.nombre || item?.descripcion) === rawText);
    if (exactText) return exactText;
  }

  return null;
}

async function buildVictoriaPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  usoDicc = {},
  today = new Date(),
} = {}) {
  const versionId = parsePositiveInt(pickInfoautoCode(fila));
  const year = pickVehicleYear(fila);
  if (versionId == null) throw new Error('Victoria requiere codigo InfoAuto');
  if (year == null) throw new Error('Victoria requiere anio');

  const personTypes = asArray(await cachedVictoriaGetJson(cfg, '/cea/reference/obtenerTiposPersona'));
  const tipoPersona = resolveTipoPersona({ fila, cabecera, personTypes });
  if (!tipoPersona) throw new Error('Victoria no pudo resolver tipoPersona');

  const docs = asArray(await cachedVictoriaGetJson(cfg, `/cea/reference/obtenerTipoDocumento/${encodeURIComponent(tipoPersona.id)}`));
  const tipoDocumento = resolveTipoDocumento({ tipoPersona, docs });
  if (!tipoDocumento) throw new Error('Victoria no pudo resolver tipoDocumento');

  const [ivaList, states, occupations, clauses, discountSeguroList, qualityList, producerRes] = await Promise.all([
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerCondicionesIva'),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerEstadosCivil'),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerOcupaciones'),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerClausulasAjuste'),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerDescuentoSeguroNuevo'),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerCalidadAsegurado'),
    resolveProducer(cfg),
  ]);

  const iva = resolveIva({ cabecera, cfg, ivas: ivaList });
  if (!iva) throw new Error('Victoria no pudo resolver IVA');

  const iibbList = asArray(
    await cachedVictoriaGetJson(
      cfg,
      `/cea/reference/obtenerCondicionIIBB/${encodeURIComponent(tipoPersona.id)}/${encodeURIComponent(iva.codigo)}`
    )
  );
  const iibb =
    iibbList.find((item) => Number(item?.codigo || 0) === Number(iva.codigo || 0)) ||
    iibbList.find((item) => normalizeText(item?.descripcion).includes('NO INSCRIPTO')) ||
    iibbList[0] ||
    null;
  if (!iibb) throw new Error('Victoria no pudo resolver IIBB');

  const { province, locality, source: localitySource, cp } = await resolveProvinceAndLocality({ fila, cabecera, cfg });
  const { brand, model, source: brandModelSource } = await resolveBrandAndModel({ fila, cabecera, cfg, year });

  const [tipoVehiculo, suma, tipoCombustibles, vigencias, variaciones] = await Promise.all([
    cachedVictoriaGetJson(cfg, `/cea/reference/obtenerTipoVehiculoPorVersion/${encodeURIComponent(versionId)}`),
    cachedVictoriaGetJson(cfg, `/cea/reference/obtenerSumaAsegurada/${encodeURIComponent(versionId)}/${encodeURIComponent(year)}`),
    cachedVictoriaGetJson(cfg, `/cea/reference/obtenerTiposCombustible/${encodeURIComponent(versionId)}`),
    cachedVictoriaGetJson(cfg, `/cea/reference/obtenerVigencias/${encodeURIComponent(producerRes.producer.id)}`),
    cachedVictoriaGetJson(cfg, '/cea/reference/obtenerVariacion32080'),
  ]);

  const vigencia = resolveByConfiguredIdOrNumber(
    vigencias,
    cfg?.parametros_extras?.vigencia_default_id,
    pick([
      cfg?.tipoFacturacion,
      cfg?.tipo_facturacion,
      cfg?.refacturacion,
      cfg?.vigencia,
      cfg?.parametros_extras?.vigencia_default,
    ])
  ) || asArray(vigencias)[0] || null;
  if (!vigencia) throw new Error('Victoria no devolvio vigencias');

  const formasPago = asArray(
    await cachedVictoriaGetJson(cfg, `/cea/reference/obtenerFormaDePagos/${encodeURIComponent(vigencia.id)}`)
  );
  const formaPagoCode = resolveFormaPagoCode({ cabecera, cfg, formasPago });
  const formaPago =
    formasPago.find((item) => Number(item?.codigo || 0) === Number(formaPagoCode || 0)) ||
    formasPago[0] ||
    null;
  if (!formaPago) throw new Error('Victoria no devolvio formas de pago');

  const cuotas = asArray(
    await cachedVictoriaGetJson(
      cfg,
      `/cea/reference/obtenerCantidadCuotas/${encodeURIComponent(vigencia.id)}/${encodeURIComponent(formaPago.codigo)}`
    )
  );
  const cuotasDefault = parsePositiveInt(cfg?.parametros_extras?.cantidad_cuotas_default) || 1;
  const planCuota =
    cuotas.find((item) => Number(item?.cantidadCuotas || 0) === cuotasDefault) ||
    cuotas[0] ||
    null;
  if (!planCuota) throw new Error('Victoria no devolvio cuotas');

  const variacion = resolveByConfiguredIdOrNumber(
    variaciones,
    cfg?.parametros_extras?.variacion_32080_default_id,
    pick([
      cfg?.variacion_32080,
      cfg?.variacion32080,
      cfg?.parametros_extras?.variacion_32080_default,
    ]),
    [(item) => item?.variacion]
  ) || asArray(variaciones)[0] || null;
  if (!variacion) throw new Error('Victoria no devolvio variacion 32080');

  const tipoCombustible = asArray(tipoCombustibles)[0] || null;
  if (!tipoCombustible) throw new Error('Victoria no devolvio tipoCombustible');

  const clausulaAjuste = resolveByConfiguredIdOrNumber(
    clauses,
    cfg?.parametros_extras?.clausula_ajuste_default_id,
    pick([cfg?.clausula_ajuste, cfg?.parametros_extras?.clausula_ajuste_default]),
    [(item) => item?.porcentajeAjuste, (item) => item?.descripcion]
  ) || asArray(clauses)[0] || null;

  const descuentoSeguroNuevo = resolveByConfiguredIdOrNumber(
    discountSeguroList,
    cfg?.parametros_extras?.descuento_seguro_nuevo_default_id,
    pick([cfg?.descuento_seguro_nuevo, cfg?.parametros_extras?.descuento_seguro_nuevo_default]),
    [(item) => item?.valor, (item) => item?.descripcion]
  ) || asArray(discountSeguroList)[0] || null;

  const descuentoComercialValor = parseNumber(pick([
    cfg?.descuento_comercial,
    cfg?.descuentoComercial,
    cfg?.parametros_extras?.descuento_comercial_default,
  ]));

  const calidad = asArray(qualityList)[0] || null;
  const propietarioVehiculo = calidad?.tipoPropietarioVehiculo || null;

  const useId = resolveVictoriaUseId({
    fila,
    cabecera,
    usoDicc,
    defaultId: tipoVehiculo?.usoDefecto || cfg?.parametros_extras?.uso_default_id || 1,
  });
  const uso = {
    id: useId,
    descripcion: resolveVictoriaUseDescription(useId, fila, cabecera),
    carroceriaid: 0,
    porDefecto: false,
  };

  const tipoPersonaId = Number(tipoPersona?.id || 1);
  const isJuridica = tipoPersonaId === 2;
  const documentoDefault = isJuridica ? '30000000007' : '12345678';

  const asegurado = {
    nombre: pick([cabecera?.nombre, cabecera?.nombres, fila?.nombre, fila?.nombres]) || 'TEST',
    apellido: pick([cabecera?.apellido, fila?.apellido]) || (isJuridica ? 'EMPRESA' : 'AUTOIQ'),
    cuil: null,
    nroDocumento: pick([cabecera?.numero_documento, cabecera?.documento, fila?.numero_documento, fila?.documento]) || documentoDefault,
    tipoPersona,
    tipoDocumento,
    condicionIVA: '',
    condicionIIBB: iibb,
    calle: pick([cabecera?.calle, fila?.calle]) || 'SIN CALLE',
    numero: pick([cabecera?.numero, fila?.numero]) || '0',
    piso: pick([cabecera?.piso, fila?.piso]),
    departamento: pick([cabecera?.departamento, cabecera?.depto, fila?.departamento, fila?.depto]),
    provincia: province,
    localidad: locality,
    codigoPostal: parsePositiveInt(cp) || parsePositiveInt(locality?.codigoPostal) || 0,
    telefono: pick([cabecera?.telefono, fila?.telefono]) || '11111111',
    email: pick([cabecera?.email, fila?.email]) || 'cotizaciones@autoiq.local',
    estadoCivil: resolveCivilStatus({ states }),
    ocupacion: resolveOccupation({ occupations }),
    claseIva: iva,
  };

  const poliza = {
    productor: producerRes.producer,
    vigencia,
    planCuota,
    formaPago,
    lugarPago: {},
    operacion: {},
    fechaVigenciaDesde: today instanceof Date ? today.toISOString().slice(0, 10) : String(today || '').slice(0, 10),
    condicionIIBB: iibb,
    claseIva: iva,
    variacion32080: variacion,
  };

  const sumaAseguradaBase = Number(suma?.sumaAsegurada || 0);
  const sumaAsegurada0km = Number(suma?.sumaAsegurada0km || 0);
  const sumaAseguradaEfectiva = sumaAseguradaBase > 0 ? sumaAseguradaBase : sumaAsegurada0km;

  const vehiculo = {
    año: year,
    marca: brand,
    modelo: model,
    version: {
      id: versionId,
      sumaAsegurada: sumaAseguradaEfectiva,
      sumaAsegurada0km,
    },
    tipoVehiculo,
    tipoCombustible,
    carroceria: {
      id: parsePositiveInt(tipoVehiculo?.carroceriaDefecto) || parsePositiveInt(cfg?.parametros_extras?.carroceria_default_id) || 1,
      descripcion: null,
      tipovehiculo: 0,
      porDefecto: false,
    },
    uso,
    clausulaAjuste,
    descuentoSeguroNuevo,
    descuentoComercial: {
      id: 0,
      valor: descuentoComercialValor ?? 0,
    },
    primaGranizo: { descripcion: 'No Aplica', id: 0, id1g: 0, valor: 0 },
    propietarioVehiculo,
    poseeSiniestros: false,
    adicionalKm: false,
    ceroKm: isVehicleZeroKm(fila),
    gnc: String(cabecera?.gnc || fila?.gnc || '0').trim() === '1',
    ...resolveVictoriaTracking({ cabecera, cfg }),
    sumaAsegurada: sumaAseguradaEfectiva,
    sumaAsegurada0km,
    listaAccesorios: [],
    lstImagenes: [],
    motor: pick([fila?.motor, cabecera?.motor]),
    patente: pick([fila?.patente, cabecera?.patente]),
    chasis: pick([fila?.chasis, cabecera?.chasis]),
    acreedorVehiculo: null,
  };

  const payload = {
    asegurado,
    poliza,
    vehiculo,
    esRenovacion: false,
  };

  return {
    payload,
    requestMeta: {
      producerId: producerRes.producer.id,
      producerSource: producerRes.source,
      tipoPersonaId: tipoPersona.id,
      tipoDocumentoId: tipoDocumento.codigoDocumento,
      ivaCode: iva.codigo,
      iibbCode: iibb.codigo,
      provinceCode: province.codigo,
      localityId: locality.id,
      localityCp: cp,
      localitySource,
      brandId: brand.id,
      modelId: model.id,
      brandSource: brandModelSource.brand,
      modelSource: brandModelSource.model,
      versionId,
      year,
      vigenciaId: vigencia.id,
      formaPagoCode: formaPago.codigo,
      cantidadCuotas: planCuota.cantidadCuotas,
      variacionId: variacion.id,
      variacion32080: variacion?.variacion ?? null,
      useId,
      tipoVehiculoId: tipoVehiculo.id,
      tipoCombustibleId: tipoCombustible.id,
      poseeRastreo: vehiculo.poseeRastreo,
      sistemaRastreo: vehiculo.sistemaRastreo,
      nuevoRastreo: vehiculo.nuevoRastreo,
      rastreoSistema: vehiculo.rastreoSistema,
      rastreoSistemaEfectivo: vehiculo.rastreoSistemaEfectivo,
      rastreoDefaultAplicado: vehiculo.rastreoDefaultAplicado,
      clausulaAjusteId: clausulaAjuste?.id ?? null,
      clausulaAjuste: clausulaAjuste?.porcentajeAjuste ?? null,
      descuentoSeguroNuevoId: descuentoSeguroNuevo?.id ?? null,
      descuentoSeguroNuevo: descuentoSeguroNuevo?.valor ?? null,
      descuentoComercial: descuentoComercialValor ?? 0,
      sumaAsegurada: sumaAseguradaEfectiva,
      sumaAseguradaBase,
      sumaAsegurada0km,
      sumaAseguradaFuente: sumaAseguradaBase > 0 ? 'sumaAsegurada' : 'sumaAsegurada0km',
    },
  };
}

function parseVictoriaQuoteResponse(data) {
  const response = typeof data === 'string' ? JSON.parse(data) : data;
  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Respuesta Victoria invalida', operacion: '0', coberturas: [], raw: data };
  }

  if (response.status && String(response.status).toUpperCase() !== 'OK' && response.message) {
    return {
      ok: false,
      error: pick([response.message, response.debugMessage, response.error]),
      operacion: '0',
      coberturas: [],
      raw: data,
    };
  }

  const vehiculo = response?.vehiculo || {};
  const coberturas = asArray(vehiculo?.listaCoberturas).map((item) => {
    const calculos = item?.calculos || {};
    return {
      codigoDeCobertura: String(item?.numero ?? item?.id ?? ''),
      descripcionDeCobertura: String(item?.nombre || item?.descripcion || ''),
      codigoDeProducto: String(item?.seguroVehCobId ?? item?.id ?? ''),
      descripcionDeProducto: String(item?.nombreComercial || vehiculo?.tipoVehiculo?.descripcion || ''),
      importePrima: String(calculos?.prima ?? ''),
      importePremio: String(calculos?.premio ?? ''),
      importeCuota: String(calculos?.cuota ?? ''),
      premiumMonthly: String(calculos?.cuota ?? calculos?.premio ?? ''),
      premium: String(calculos?.premio ?? ''),
      primaNeta: String(calculos?.primaNeta ?? ''),
      premioSinIva: String(calculos?.premioSinIva ?? ''),
      iva: String(calculos?.iva ?? ''),
      iibb: String(calculos?.iibb ?? ''),
      servicioSocial: String(calculos?.servicioSocial ?? ''),
      tasaSuperintendencia: String(calculos?.tasaSuper ?? ''),
      recargo: String(calculos?.recargo ?? ''),
      resolucion32080: String(calculos?.resolucion32080 ?? ''),
      franquicia: String(calculos?.franquicia ?? ''),
      franquiciaPje: String(calculos?.franquiciaPje ?? ''),
      primaGranizo: String(calculos?.primaGranizo ?? ''),
      sumaAsegurada: String(vehiculo?.sumaAsegurada ?? ''),
      calculos,
    };
  });

  return {
    ok: coberturas.length > 0,
    operacion: pick([response?.nroCotizacion, response?.id]) || '0',
    suma_asegurada: String(vehiculo?.sumaAsegurada ?? ''),
    coberturas,
    raw: data,
    used: {
      tipoVehiculo: String(vehiculo?.tipoVehiculo?.descripcion || ''),
      marca: String(vehiculo?.marca?.descripcion || ''),
      modelo: String(vehiculo?.modelo?.descripcion || ''),
      versionId: String(vehiculo?.version?.id ?? ''),
      useId: String(vehiculo?.uso?.id ?? ''),
      clausulaAjusteId: String(vehiculo?.clausulaAjuste?.id ?? ''),
    },
  };
}

module.exports = {
  buildVictoriaPayload,
  parseVictoriaQuoteResponse,
  resolveVictoriaTracking,
  resolveVictoriaUseId,
};

const { resolveAtmVehicleKind, pickInfoautoCode } = require('../../utils/atm_tipo_vehiculo');
const { resolveSumaAsegurada } = require('../../utils/atm_infoauto');
const fs = require('fs');
const path = require('path');
const provinciaCatalog = require('./catalog');
const { isProvinciaRetryableError } = require('./http');
const { isVehicleZeroKm } = require('../../utils/zero_km');

const PROVINCIA_PROVINCE_CODES = {
  CAPITAL: '1',
  'CAPITAL FEDERAL': '1',
  CABA: '1',
  'CIUDAD AUTONOMA DE BUENOS AIRES': '1',
  'CIUDAD DE BUENOS AIRES': '1',
  'BUENOS AIRES': '2',
  BSAS: '2',
  'BS AS': '2',
  CATAMARCA: '3',
  CORDOBA: '4',
  CORRIENTES: '5',
  'ENTRE RIOS': '6',
  JUJUY: '7',
  'LA RIOJA': '8',
  MENDOZA: '9',
  SALTA: '10',
  'SAN JUAN': '11',
  'SAN LUIS': '12',
  'SANTA FE': '13',
  'SANTIAGO DEL ESTERO': '14',
  TUCUMAN: '15',
  CHACO: '16',
  CHUBUT: '17',
  FORMOSA: '18',
  'LA PAMPA': '19',
  MISIONES: '21',
  NEUQUEN: '22',
  'RIO NEGRO': '23',
  'SANTA CRUZ': '24',
  'TIERRA DEL FUEGO': '25',
};

const PROVINCIA_BRAND_CODE_ALIASES = {
  'ALFA ROMEO': 'ALF',
  AUDI: 'AUD',
  BMW: 'BMW',
  BYD: 'BYD',
  CADILLAC: 'CAD',
  CHERY: 'CHY',
  CHEVROLET: 'CHE',
  CHRYSLER: 'CHR',
  CITROEN: 'CTR',
  'DS AUTOMOBILES': 'DS',
  DAIHATSU: 'DAI',
  DODGE: 'DOD',
  FIAT: 'FIA',
  FORD: 'FOR',
  FOTON: 'FOT',
  GEELY: 'GEE',
  HONDA: 'HON',
  HYUNDAI: 'HYU',
  ISUZU: 'ISU',
  IVECO: 'IVE',
  JAC: 'JAC',
  JAGUAR: 'JAG',
  JEEP: 'JEE',
  KIA: 'KIA',
  'LAND ROVER': 'LAR',
  'MERCEDES BENZ': 'MEB',
  'MERCEDES-BENZ': 'MEB',
  MINI: 'MIN',
  'MINI COOPER': 'MIN',
  MITSUBISHI: 'MIT',
  NISSAN: 'NIS',
  PEUGEOT: 'PEU',
  PORSCHE: 'POR',
  RENAULT: 'REN',
  SCANIA: 'SCA',
  SMART: 'SMA',
  SSANGYONG: 'SSA',
  SUBARU: 'SUB',
  SUZUKI: 'SUZ',
  TOYOTA: 'TOY',
  VOLKSWAGEN: 'VWV',
  VW: 'VWV',
  VOLVO: 'VOL',
};

const PROVINCIA_IVA_CODES = {
  CF: 'CF',
  'CONSUMIDOR FINAL': 'CF',
  EX: 'EX',
  EXENTO: 'EX',
  MT: 'MT',
  MONOTRIBUTO: 'MT',
  RI: 'RI',
  'RESPONSABLE INSCRIPTO': 'RI',
};

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
    .trim()
    .toUpperCase();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

let provinciaModelAliasesCache = null;

function loadProvinciaModelAliases() {
  if (provinciaModelAliasesCache) return provinciaModelAliasesCache;
  const aliasesPath = path.join(process.cwd(), 'data', 'provincia', 'diccionarios', 'modelo_aliases.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
    provinciaModelAliasesCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    provinciaModelAliasesCache = [];
  }
  return provinciaModelAliasesCache;
}

function resolveProvinciaModelAlias({ infoautoCode = '', anio = '', marcaCode = '', es0km = '' } = {}) {
  const code = onlyDigits(infoautoCode);
  if (!code) return null;
  const year = String(anio || '').trim();
  const brand = String(marcaCode || '').trim().toUpperCase();
  const zeroKm = String(es0km || '').trim().toUpperCase();
  return loadProvinciaModelAliases().find((item) => {
    if (onlyDigits(item?.infoautoCode) !== code) return false;
    if (item?.anio && String(item.anio).trim() !== year) return false;
    if (item?.marcaCode && String(item.marcaCode).trim().toUpperCase() !== brand) return false;
    if (item?.es0km && String(item.es0km).trim().toUpperCase() !== zeroKm) return false;
    return true;
  }) || null;
}

function parsePositiveNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function parsePositiveInt(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  const num = Number.parseInt(digits, 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function resolveProvinciaGncAmount({ fila = {}, cabecera = {} } = {}) {
  if (String(cabecera?.gnc || fila?.gnc || '').trim() !== '1') return '0';
  return onlyDigits(pick([
    fila?.suma_gnc,
    fila?.sumaGnc,
    fila?.valor_gnc,
    fila?.valorGnc,
    cabecera?.suma_gnc,
    cabecera?.sumaGnc,
    cabecera?.valor_gnc,
    cabecera?.valorGnc,
  ])) || '0';
}

function parseJsonObjectLike(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = String(value).trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeProvinciaPayload(basePayload, overridePayload) {
  if (!overridePayload || typeof overridePayload !== 'object' || Array.isArray(overridePayload)) {
    return basePayload;
  }

  const next = {
    ...basePayload,
    ...overridePayload,
    contacto: {
      ...(basePayload.contacto || {}),
      ...(overridePayload.contacto || {}),
    },
    ramoProducto: {
      ...(basePayload.ramoProducto || {}),
      ...(overridePayload.ramoProducto || {}),
    },
    datosGenerales: {
      ...(basePayload.datosGenerales || {}),
      ...(overridePayload.datosGenerales || {}),
    },
    bien: {
      ...(basePayload.bien || {}),
      ...(overridePayload.bien || {}),
    },
  };

  if (basePayload.datosAdicionales || overridePayload.datosAdicionales) {
    next.datosAdicionales = {
      ...(basePayload.datosAdicionales || {}),
      ...(overridePayload.datosAdicionales || {}),
    };
  }
  if (overridePayload.promociones) next.promociones = overridePayload.promociones;
  return next;
}

function resolveProvinciaRamoSelection({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const extras = cfg?.parametros_extras || {};
  const configuredRamos = extras?.ramos && typeof extras.ramos === 'object' ? extras.ramos : {};
  const ramo = pick([
    fila?.provincia_ramo_codigo,
    fila?.provincia_ramo,
    fila?.ramo_ws,
    fila?.ramo,
    cabecera?.provincia_ramo_codigo,
    cabecera?.provincia_ramo,
    cabecera?.ramo_ws,
    cabecera?.ramo,
    extras?.ramo_default,
    '4',
  ]);
  const ramoCfg = configuredRamos[ramo] || {};
  const producto = pick([
    fila?.provincia_producto_codigo,
    fila?.provincia_producto,
    fila?.producto_ws,
    fila?.producto,
    cabecera?.provincia_producto_codigo,
    cabecera?.provincia_producto,
    cabecera?.producto_ws,
    cabecera?.producto,
    ramoCfg?.producto_default,
    extras?.producto_default,
  ]);

  return {
    ramo,
    producto,
    ramoCfg,
  };
}

function resolveProvinciaDocumentMeta({ fila = {}, cabecera = {}, cfg = {} } = {}) {
  const extras = cfg?.parametros_extras || {};
  const docDigits = onlyDigits(pick([
    cabecera?.nrodoc,
    cabecera?.numero_documento,
    cabecera?.numeroDocumento,
    cabecera?.documento,
    fila?.nrodoc,
    fila?.numero_documento,
    fila?.numeroDocumento,
    fila?.documento,
    extras?.dni_default,
  ]));
  const docType = normalizeText(pick([
    cabecera?.tipodoc,
    cabecera?.tipo_documento,
    cabecera?.tipoDocumento,
    fila?.tipodoc,
    fila?.tipo_documento,
    fila?.tipoDocumento,
  ]));

  const cuit = docDigits.length === 11 ? docDigits : '';
  const dni = docDigits.length >= 7 ? docDigits.slice(-8) : onlyDigits(extras?.dni_default);

  return {
    rawDigits: docDigits,
    dni,
    cuit,
    docType,
  };
}

function resolveProvinciaPersonType({ fila = {}, cabecera = {}, cfg = {}, ramoCfg = {} } = {}) {
  const raw = normalizeText(pick([
    fila?.provincia_tipo_persona,
    fila?.tipo_persona,
    cabecera?.provincia_tipo_persona,
    cabecera?.tipo_persona,
    cabecera?.tipoPersona,
    ramoCfg?.tipo_persona_default,
    cfg?.parametros_extras?.tipo_persona_default,
  ]));

  if (raw === 'J' || raw.includes('JURID') || raw.includes('EMPRESA')) return 'J';
  if (raw === 'F' || raw.includes('FISICA')) return 'F';
  return 'F';
}

function resolveProvinciaIvaCode({ cabecera = {}, cfg = {}, ramoCfg = {} } = {}) {
  const raw = normalizeText(pick([
    cabecera?.provincia_condicion_iva,
    cabecera?.iva,
    cfg?.parametros_extras?.condicion_iva_default,
    ramoCfg?.condicion_iva_default,
    'CF',
  ]));
  return PROVINCIA_IVA_CODES[raw] || 'CF';
}

function resolveProvinciaProvinceCode({ fila = {}, cabecera = {}, cfg = {}, ramoCfg = {} } = {}) {
  const explicitCode = pick([
    fila?.provincia_codigo,
    fila?.provincia_code,
    fila?.provincia_ps,
    cabecera?.provincia_codigo,
    cabecera?.provincia_code,
    cabecera?.provincia_ps,
  ]);
  if (/^\d+$/.test(explicitCode)) return explicitCode;

  const raw = normalizeText(pick([
    fila?.provincia,
    fila?.Provincia,
    fila?.veh_provincia,
    cabecera?.provincia,
    cabecera?.Provincia,
    ramoCfg?.provincia_default,
    cfg?.parametros_extras?.provincia_default,
  ]));
  const code = PROVINCIA_PROVINCE_CODES[raw];
  if (code) return code;

  throw new Error(`Provincia no pudo resolver la provincia para "${raw || '(sin provincia)'}"`);
}

async function resolveProvinciaBrandCode({
  fila = {},
  cabecera = {},
  cfg = {},
  ramo = '4',
  producto = '04100',
  atmVehicle = null,
  catalogClient = provinciaCatalog,
} = {}) {
  const explicitCode = normalizeText(pick([
    fila?.provincia_marca_codigo,
    fila?.provincia_marca,
    fila?.marca_codigo_provincia,
    fila?.ps_marca,
    cabecera?.provincia_marca_codigo,
    cabecera?.provincia_marca,
    cabecera?.marca_codigo_provincia,
    cabecera?.ps_marca,
  ]));
  if (/^[A-Z0-9]{3,4}$/.test(explicitCode)) {
    return {
      code: explicitCode,
      source: 'explicit',
      description: '',
      cacheState: '',
      matchSource: '',
      firstVerifiedAt: '',
      lastVerifiedAt: '',
      warning: '',
    };
  }

  const resolvedAtmVehicle = atmVehicle || await resolveAtmVehicleKind(fila).catch(() => null);
  const candidates = [
    pick([fila?.marca, fila?.Marca, fila?.veh_marca]),
    pick([cabecera?.marca, cabecera?.Marca]),
    resolvedAtmVehicle?.marca || '',
  ];

  if (catalogClient?.fetchProvinciaBrands && ramo === '4' && producto) {
    try {
      const match = catalogClient?.resolveProvinciaBrand
        ? await catalogClient.resolveProvinciaBrand(cfg, {
            ramo,
            producto,
            candidateTexts: candidates,
            candidateCodes: [explicitCode],
          })
        : provinciaCatalog.findProvinciaBrandCandidate({
            brands: await catalogClient.fetchProvinciaBrands(cfg, { ramo, producto }),
            candidateTexts: candidates,
            candidateCodes: [explicitCode],
          });
      if (match?.code) {
        return {
          code: String(match.code).trim(),
          source: match.source || 'catalog',
          description: String(match.description || '').trim(),
          cacheState: String(match.cacheState || '').trim(),
          matchSource: String(match.matchSource || '').trim(),
          firstVerifiedAt: String(match.firstVerifiedAt || '').trim(),
          lastVerifiedAt: String(match.lastVerifiedAt || '').trim(),
          warning: String(match.warning || '').trim(),
        };
      }
      if (match?.item?.codigo) {
        return {
          code: String(match.item.codigo).trim(),
          source: match.source || 'catalog',
          description: String(match.item.descripcion || '').trim(),
          cacheState: '',
          matchSource: String(match.source || '').trim(),
          firstVerifiedAt: '',
          lastVerifiedAt: '',
          warning: '',
        };
      }
    } catch {
      // Fallback al alias local para no romper la integración si el catálogo falla.
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized) continue;
    if (PROVINCIA_BRAND_CODE_ALIASES[normalized]) {
      return {
        code: PROVINCIA_BRAND_CODE_ALIASES[normalized],
        source: 'alias',
        description: candidate,
        cacheState: '',
        matchSource: '',
        firstVerifiedAt: '',
        lastVerifiedAt: '',
        warning: '',
      };
    }
    if (/^[A-Z0-9]{3,4}$/.test(normalized)) {
      return {
        code: normalized,
        source: 'normalized_input',
        description: candidate,
        cacheState: '',
        matchSource: '',
        firstVerifiedAt: '',
        lastVerifiedAt: '',
        warning: '',
      };
    }
  }

  throw new Error(`Provincia no pudo resolver la marca para "${candidates.find(Boolean) || '(sin marca)'}"`);
}

function resolveProvinciaZeroKmFlag({ fila = {} } = {}) {
  const raw = pick([
    fila?.provincia_es_0km,
    fila?.provincia_0km,
    fila?.esOkm,
    fila?.es_0km,
    fila?.cero_km,
    fila?.cerokm,
    fila?.['0km'],
  ]);
  return isVehicleZeroKm({ cerokm: raw }) ? 'S' : 'N';
}

async function resolveProvinciaModelCode({
  fila = {},
  cabecera = {},
  cfg = {},
  ramo = '4',
  producto = '04100',
  marcaCode = '',
  anio = '',
  es0km = 'N',
  atmVehicle = null,
  catalogClient = provinciaCatalog,
} = {}) {
  const explicit = onlyDigits(pick([
    fila?.provincia_modelo_codigo,
    fila?.provincia_modelo,
    fila?.modelo_codigo_provincia,
    fila?.ps_modelo,
    cabecera?.provincia_modelo_codigo,
    cabecera?.provincia_modelo,
    cabecera?.modelo_codigo_provincia,
    cabecera?.ps_modelo,
  ]));
  if (explicit) {
    return {
      code: explicit.padStart(6, '0'),
      source: 'explicit',
      description: '',
      suggestions: [],
      cacheState: '',
      matchSource: '',
      firstVerifiedAt: '',
      lastVerifiedAt: '',
      warning: '',
    };
  }

  const infoautoCode = onlyDigits(pickInfoautoCode(fila));
  const infoautoCanonicalCode = onlyDigits(atmVehicle?.canonicalCode);
  const candidateTexts = [
    pick([fila?.modelo, fila?.veh_modelo, fila?.Modelo]),
    pick([cabecera?.modelo, cabecera?.veh_modelo, cabecera?.Modelo]),
    atmVehicle?.modelo || '',
  ];
  const alias = resolveProvinciaModelAlias({ infoautoCode, anio, marcaCode, es0km });
  if (alias?.provinciaModelCode) {
    return {
      code: String(alias.provinciaModelCode).trim().padStart(6, '0'),
      source: 'alias',
      description: String(alias.descripcion || candidateTexts.find(Boolean) || '').trim(),
      suggestions: [],
      cacheState: '',
      matchSource: String(alias.source || 'modelo_aliases'),
      firstVerifiedAt: '',
      lastVerifiedAt: '',
      warning: '',
    };
  }

  if (catalogClient?.fetchProvinciaModels && marcaCode && anio) {
    try {
      const match = catalogClient?.resolveProvinciaModel
        ? await catalogClient.resolveProvinciaModel(cfg, {
            ramo,
            producto,
            brandCode: marcaCode,
            anio,
            es0km,
            candidateTexts,
            candidateCodes: [infoautoCode, infoautoCanonicalCode],
          })
        : provinciaCatalog.findProvinciaModelCandidate({
            models: await catalogClient.fetchProvinciaModels(cfg, {
              ramo,
              producto,
              marca: marcaCode,
              anio,
              es0km,
            }),
            candidateTexts,
            candidateCodes: [infoautoCode, infoautoCanonicalCode],
          });
      if (match?.code) {
        return {
          code: String(match.code).trim(),
          source: match.source || 'catalog',
          description: String(match.description || '').trim(),
          suggestions: Array.isArray(match.suggestions) ? match.suggestions : [],
          cacheState: String(match.cacheState || '').trim(),
          matchSource: String(match.matchSource || '').trim(),
          firstVerifiedAt: String(match.firstVerifiedAt || '').trim(),
          lastVerifiedAt: String(match.lastVerifiedAt || '').trim(),
          warning: String(match.warning || '').trim(),
        };
      }
      if (match?.item?.codigo) {
        return {
          code: String(match.item.codigo).trim(),
          source: match.source || 'catalog',
          description: String(match.item.descripcion || '').trim(),
          suggestions: Array.isArray(match.suggestions) ? match.suggestions : [],
          cacheState: '',
          matchSource: String(match.source || '').trim(),
          firstVerifiedAt: '',
          lastVerifiedAt: '',
          warning: '',
        };
      }
      if (match?.source === 'ambiguous') {
        const error = new Error(`Provincia no pudo resolver el modelo con seguridad para "${candidateTexts.find(Boolean) || '(sin modelo)'}"`);
        error.catalogAmbiguous = true;
        error.suggestions = Array.isArray(match.suggestions) ? match.suggestions : [];
        throw error;
      }
    } catch (error) {
      if (error?.catalogAmbiguous) {
        const suggestions = Array.isArray(error.suggestions) && error.suggestions.length
          ? ` Sugerencias: ${error.suggestions.map((item) => `${item.codigo} ${item.descripcion}`.trim()).join(' | ')}`
          : '';
        throw new Error(`${error.message}.${suggestions}`.trim());
      }
      if (isProvinciaRetryableError(error)) {
        throw error;
      }
      if (infoautoCode) {
        return {
          code: infoautoCode.padStart(6, '0'),
          source: 'fallback_infoauto',
          description: candidateTexts.find(Boolean) || '',
          suggestions: [],
          cacheState: '',
          matchSource: '',
          firstVerifiedAt: '',
          lastVerifiedAt: '',
          warning: error?.message || '',
        };
      }
      throw error;
    }
  }

  if (infoautoCode) {
    return {
      code: infoautoCode.padStart(6, '0'),
      source: 'fallback_infoauto',
      description: candidateTexts.find(Boolean) || '',
      suggestions: [],
      cacheState: '',
      matchSource: '',
      firstVerifiedAt: '',
      lastVerifiedAt: '',
    };
  }

  throw new Error('Provincia requiere codigo de modelo/InfoAuto');
}

function resolveProvinciaVehicleType({ fila = {}, cabecera = {}, ramoCfg = {}, atmVehicle = null } = {}) {
  const explicit = pick([
    fila?.provincia_tipo_codigo,
    fila?.provincia_40007_tipo,
    fila?.tipo_codigo_provincia,
    cabecera?.provincia_tipo_codigo,
    cabecera?.provincia_40007_tipo,
    cabecera?.tipo_codigo_provincia,
    ramoCfg?.tipo_default,
  ]);
  if (/^\d+$/.test(explicit)) return explicit;
  if (atmVehicle?.isMoto === true) {
    throw new Error('Provincia requiere provincia_tipo_codigo explicito para motos');
  }
  return '1';
}

function resolveProvinciaUseCode({ fila = {}, cabecera = {}, usoDicc = {}, ramoCfg = {} } = {}) {
  const explicit = pick([
    fila?.provincia_uso_codigo,
    fila?.uso_codigo_provincia,
    fila?.provincia_40008_uso,
    cabecera?.provincia_uso_codigo,
    cabecera?.uso_codigo_provincia,
    cabecera?.provincia_40008_uso,
  ]);
  if (/^\d+$/.test(explicit)) return explicit;

  const raw = normalizeText(pick([
    fila?.uso,
    fila?.Uso,
    fila?.tipo_uso,
    cabecera?.uso,
    cabecera?.uso_default,
    ramoCfg?.uso_default,
  ]));
  const normalizedKey = raw.toLowerCase();
  if (usoDicc && usoDicc[normalizedKey]) return String(usoDicc[normalizedKey]).trim();
  if (raw.includes('PARTIC')) return '1';
  if (raw.includes('COMER')) return '42';
  if (raw.includes('OFIC')) return '9';
  if (raw.includes('RURAL')) return raw.includes('NO') ? '11' : '10';

  return String(ramoCfg?.uso_default || '1');
}

function resolveProvinciaPaymentCodes({ fila = {}, cabecera = {}, ramoCfg = {} } = {}) {
  const explicitMedio = pick([
    fila?.provincia_medio_pago,
    fila?.medio_pago_codigo,
    cabecera?.provincia_medio_pago,
    cabecera?.medio_pago_codigo,
    ramoCfg?.medio_de_pago,
  ]);
  const explicitOrigen = pick([
    fila?.provincia_origen_pago,
    fila?.origen_pago_codigo,
    cabecera?.provincia_origen_pago,
    cabecera?.origen_pago_codigo,
    ramoCfg?.origen_de_pago,
  ]);

  const rawMedio = normalizeText(pick([
    cabecera?.medio_pago,
    cabecera?.medioPago,
    cabecera?.forma_pago,
    fila?.medio_pago,
    fila?.medioPago,
  ]));

  let medio = explicitMedio;
  if (!/^\d+$/.test(medio)) {
    if (rawMedio.includes('DEBIT') || rawMedio.includes('CBU')) medio = '3';
    else if (rawMedio.includes('CAJA') || rawMedio.includes('EFECT')) medio = '1';
    else medio = String(ramoCfg?.medio_de_pago || '2');
  }

  let origen = explicitOrigen;
  if (!origen) {
    if (String(medio) === '1') origen = 'A';
    else if (String(medio) === '3') origen = 'PDIR';
    else origen = String(ramoCfg?.origen_de_pago || 'VISO');
  }

  return { medioDePago: String(medio), origenDePago: String(origen) };
}

function resolveProvinciaGenderCode({ fila = {}, cabecera = {}, ramoCfg = {} } = {}) {
  const raw = normalizeText(pick([
    fila?.provincia_genero,
    fila?.sexo,
    fila?.genero,
    cabecera?.provincia_genero,
    cabecera?.sexo,
    cabecera?.genero,
    ramoCfg?.genero_default,
  ]));
  if (raw.startsWith('F')) return 'F';
  if (raw.startsWith('M')) return 'M';
  return String(ramoCfg?.genero_default || 'M');
}

function resolveProvinciaBonifAdicional({ fila = {}, cabecera = {}, cfg = {}, ramoCfg = {} } = {}) {
  const raw = pick([
    fila?.provincia_bonif_adicional,
    fila?.provincia_40088_bonifAdicional,
    fila?.provincia_40088_bonificacionAdicional,
    fila?.descuento_comercial,
    cabecera?.provincia_bonif_adicional,
    cabecera?.provincia_40088_bonifAdicional,
    cabecera?.provincia_40088_bonificacionAdicional,
    cabecera?.descuento_comercial,
    cfg?.descuento_comercial,
    cfg?.parametros_extras?.descuento_comercial_default,
    ramoCfg?.bonif_adicional,
  ]);
  const cleaned = String(raw ?? '1').replace('%', '').replace(',', '.').trim();
  return cleaned || '1';
}

function buildProvinciaContact({ fila = {}, cabecera = {}, cfg = {}, personMeta = {} } = {}) {
  const extras = cfg?.parametros_extras || {};
  const nombreCompleto = pick([
    cabecera?.nombre_completo,
    fila?.nombre_completo,
    [cabecera?.nombre, cabecera?.apellido].filter(Boolean).join(' ').trim(),
    [fila?.nombre, fila?.apellido].filter(Boolean).join(' ').trim(),
    cabecera?.nombre,
    fila?.nombre,
    extras?.nombre_default,
    'AUTOIQ',
  ]);

  const telefono = pick([
    cabecera?.telefono,
    cabecera?.celular,
    fila?.telefono,
    fila?.celular,
    extras?.celular_default,
    '1100000000',
  ]);

  const email = pick([
    cabecera?.email,
    fila?.email,
    extras?.email_default,
    'cotizaciones@autoiq.local',
  ]);

  const canal = pick([
    fila?.provincia_canal,
    cabecera?.provincia_canal,
    extras?.canal_default,
    'PAS',
  ]);

  const out = {
    dni: personMeta?.dni || onlyDigits(extras?.dni_default),
    cuit: personMeta?.cuit || '',
    nombre: nombreCompleto,
    celular: telefono,
    telefono,
    email,
    canal,
  };

  return out;
}

function resolveProvinciaDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = onlyDigits(raw);
  if (digits.length === 8) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = String(parsed.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

async function resolveProvinciaVehicleValue({ fila = {} } = {}) {
  const explicit = parsePositiveNumber(pick([
    fila?.valorVehiculo,
    fila?.valor_vehiculo,
    fila?.suma,
    fila?.suma_asegurada,
    fila?.valor,
  ]));
  if (explicit != null) return String(Math.round(explicit));

  const inferred = parsePositiveNumber(await resolveSumaAsegurada({ row: fila }));
  if (inferred != null) return String(Math.round(inferred));

  throw new Error('Provincia requiere valor del vehiculo/suma asegurada');
}

function parsePromotions(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item.trim();
        return pick([item?.promocion, item?.codigo, item?.code]);
      })
      .filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return parsePromotions([value]);
  }

  const raw = String(value || '').trim();
  if (!raw) return [];
  const parsed = parseJsonObjectLike(raw);
  if (parsed) return parsePromotions(parsed);
  return raw
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildProvinciaAdditionalData({ fila = {}, cabecera = {}, cfg = {}, ramoCfg = {} } = {}) {
  const porcentajeComision = pick([
    fila?.provincia_porcentaje_comision,
    cabecera?.provincia_porcentaje_comision,
    ramoCfg?.porcentaje_comision,
    cfg?.parametros_extras?.porcentaje_comision_default,
  ]);
  const mantieneComision = pick([
    fila?.provincia_mantiene_comision,
    cabecera?.provincia_mantiene_comision,
    ramoCfg?.mantiene_comision_en_renovacion,
  ]);

  const datosAdicionales = {};
  if (porcentajeComision !== '') datosAdicionales.porcentajeComision = porcentajeComision;
  if (mantieneComision !== '') datosAdicionales.mantieneComisionEnRenovacion = mantieneComision;
  return Object.keys(datosAdicionales).length ? datosAdicionales : null;
}

async function buildProvinciaAutomotorPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  usoDicc = {},
  ramo,
  producto,
  ramoCfg = {},
  catalogClient = provinciaCatalog,
} = {}) {
  const cp = onlyDigits(pick([
    fila?.codigo_postal,
    fila?.codpostal,
    fila?.CP,
    fila?.cp,
    fila?.CodigoPostal,
    cabecera?.cp,
    cabecera?.CP,
  ])).slice(0, 4);
  if (!cp || cp.length !== 4) throw new Error('Provincia automotores requiere codigo postal de 4 digitos');

  const personMeta = resolveProvinciaDocumentMeta({ fila, cabecera, cfg });
  const tipoPersona = resolveProvinciaPersonType({ fila, cabecera, cfg, ramoCfg });
  const contacto = buildProvinciaContact({ fila, cabecera, cfg, personMeta });
  const { medioDePago, origenDePago } = resolveProvinciaPaymentCodes({ fila, cabecera, ramoCfg });
  const atmVehicle = await resolveAtmVehicleKind(fila).catch(() => null);
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  if (!String(anio || '').trim()) {
    throw new Error('Provincia automotores requiere anio del vehiculo');
  }
  const es0km = resolveProvinciaZeroKmFlag({ fila, cabecera, ramoCfg });
  const marcaMatch = await resolveProvinciaBrandCode({
    fila,
    cabecera,
    cfg,
    ramo,
    producto,
    atmVehicle,
    catalogClient,
  });
  const modeloMatch = await resolveProvinciaModelCode({
    fila,
    cabecera,
    cfg,
    ramo,
    producto,
    marcaCode: marcaMatch.code,
    anio,
    es0km,
    atmVehicle,
    catalogClient,
  });

  const payload = {
    contacto,
    ramoProducto: { ramo, producto },
    datosGenerales: {
      provincia: resolveProvinciaProvinceCode({ fila, cabecera, cfg, ramoCfg }),
      tipoPersona,
      medioDePago,
      origenDePago,
      condicionIva: resolveProvinciaIvaCode({ cabecera, cfg, ramoCfg }),
      cuit: personMeta.cuit || '',
      vigencia: String(ramoCfg?.vigencia || 'E'),
      vigenciaTecnica: String(ramoCfg?.vigencia_tecnica ?? 'A'),
      tipoFacturacion: String(ramoCfg?.tipo_facturacion || cfg?.parametros_extras?.tipo_facturacion_default || 'F'),
      moneda: String(ramoCfg?.moneda || cfg?.parametros_extras?.moneda_default || '01'),
      planDePago: String(ramoCfg?.plan_de_pago || '1'),
      modoDeCalculo: String(ramoCfg?.modo_calculo || cfg?.parametros_extras?.modo_calculo_default || 'N'),
    },
    bien: {
      '40007_tipo': resolveProvinciaVehicleType({ fila, cabecera, ramoCfg, atmVehicle }),
      '40012_anio': anio,
      '40013_esOkm': es0km,
      '40020_marca': marcaMatch.code,
      '40021_modelo': modeloMatch.code,
      '40008_uso': resolveProvinciaUseCode({ fila, cabecera, usoDicc, ramoCfg }),
      '40220_ValorDelVehiculo': await resolveProvinciaVehicleValue({ fila }),
      '900008_codPostal': cp,
      '40086_genero': resolveProvinciaGenderCode({ fila, cabecera, ramoCfg }),
      '40550_clausulaAjuste': String(ramoCfg?.clausula_ajuste ?? '10'),
      '40088_bonifAdicional': resolveProvinciaBonifAdicional({ fila, cabecera, cfg, ramoCfg }),
      '40102_limiteResponsabilidadCivil': String(ramoCfg?.limite_rc ?? '1'),
      '40090_limiteMercosur': String(ramoCfg?.limite_mercosur ?? '4'),
      '40082_roboContenido': String(ramoCfg?.robo_contenido ?? 'S'),
      '40101_cobAdicComerciales': String(ramoCfg?.cob_adic_comerciales ?? 'N'),
      montoAccesorios: resolveProvinciaGncAmount({ fila, cabecera }) || String(ramoCfg?.monto_accesorios ?? '0'),
    },
  };

  if (!String(payload.bien['40012_anio'] || '').trim()) {
    throw new Error('Provincia automotores requiere anio del vehiculo');
  }

  const datosAdicionales = buildProvinciaAdditionalData({ fila, cabecera, cfg, ramoCfg });
  if (datosAdicionales) payload.datosAdicionales = datosAdicionales;

  const merged = mergeProvinciaPayload(
    payload,
    parseJsonObjectLike(pick([fila?.provincia_payload_json, fila?.provincia_payload, cabecera?.provincia_payload_json, cabecera?.provincia_payload]))
  );

  return {
    payload: merged,
    requestMeta: {
      ramo,
      producto,
      ramoDescripcion: 'Automotores',
      codigoPostal: cp,
      tipoPersona,
      medioDePago,
      origenDePago,
      condicionIva: payload.datosGenerales.condicionIva,
      marca: payload.bien['40020_marca'],
      marcaDescripcion: marcaMatch.description || '',
      marcaSource: marcaMatch.source || '',
      marcaMatchSource: marcaMatch.matchSource || '',
      marcaCacheState: marcaMatch.cacheState || '',
      marcaFirstVerifiedAt: marcaMatch.firstVerifiedAt || '',
      marcaLastVerifiedAt: marcaMatch.lastVerifiedAt || '',
      marcaWarning: marcaMatch.warning || '',
      modelo: payload.bien['40021_modelo'],
      modeloDescripcion: modeloMatch.description || '',
      modeloSource: modeloMatch.source || '',
      modeloMatchSource: modeloMatch.matchSource || '',
      modeloCacheState: modeloMatch.cacheState || '',
      modeloFirstVerifiedAt: modeloMatch.firstVerifiedAt || '',
      modeloLastVerifiedAt: modeloMatch.lastVerifiedAt || '',
      modeloSuggestions: Array.isArray(modeloMatch.suggestions) ? modeloMatch.suggestions : [],
      modeloWarning: modeloMatch.warning || '',
      anio: payload.bien['40012_anio'],
      es0km: payload.bien['40013_esOkm'],
      uso: payload.bien['40008_uso'],
      valorVehiculo: payload.bien['40220_ValorDelVehiculo'],
      clausulaAjuste: payload.bien['40550_clausulaAjuste'],
      bonifAdicional: payload.bien['40088_bonifAdicional'],
      limiteMercosur: payload.bien['40090_limiteMercosur'],
    },
  };
}

async function buildProvinciaAccidentesPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  ramo,
  producto,
  ramoCfg = {},
} = {}) {
  const personMeta = resolveProvinciaDocumentMeta({ fila, cabecera, cfg });
  const tipoPersona = resolveProvinciaPersonType({ fila, cabecera, cfg, ramoCfg });
  const contacto = buildProvinciaContact({ fila, cabecera, cfg, personMeta });
  const { medioDePago, origenDePago } = resolveProvinciaPaymentCodes({ fila, cabecera, ramoCfg });

  const fechaNacimiento = resolveProvinciaDate(pick([
    fila?.fechaNacimiento,
    fila?.fecha_nacimiento,
    fila?.fec_nac,
    cabecera?.fechaNacimiento,
    cabecera?.fecha_nacimiento,
    cabecera?.fec_nac,
  ]));
  if (!fechaNacimiento) throw new Error('Provincia AP requiere fecha de nacimiento');

  const promociones = parsePromotions(
    pick([
      fila?.provincia_promociones,
      fila?.provincia_promocion,
      fila?.promociones,
      fila?.promocion,
      cabecera?.provincia_promociones,
      cabecera?.provincia_promocion,
      cabecera?.promociones,
      cabecera?.promocion,
    ])
  );
  const promocionesFinales = (promociones.length ? promociones : asArray(ramoCfg?.promociones))
    .map((codigo) => ({ promocion: String(codigo).trim() }))
    .filter((item) => item.promocion);
  if (!promocionesFinales.length) throw new Error('Provincia AP requiere al menos una promocion');

  const payload = {
    contacto,
    ramoProducto: { ramo, producto },
    datosGenerales: {
      provincia: resolveProvinciaProvinceCode({ fila, cabecera, cfg, ramoCfg }),
      tipoPersona,
      medioDePago,
      origenDePago,
      condicionIva: resolveProvinciaIvaCode({ cabecera, cfg, ramoCfg }),
      cuit: personMeta.cuit || '',
      vigencia: String(ramoCfg?.vigencia || 'A'),
      vigenciaTecnica: String(ramoCfg?.vigencia_tecnica ?? ''),
      tipoFacturacion: String(ramoCfg?.tipo_facturacion || cfg?.parametros_extras?.tipo_facturacion_default || 'F'),
      moneda: String(ramoCfg?.moneda || cfg?.parametros_extras?.moneda_default || '01'),
      planDePago: String(ramoCfg?.plan_de_pago || '161'),
      modoDeCalculo: String(ramoCfg?.modo_calculo || cfg?.parametros_extras?.modo_calculo_default || 'N'),
    },
    bien: {
      AseguraTitularConyugue: pick([
        fila?.asegura_titular_conyugue,
        fila?.AseguraTitularConyugue,
        cabecera?.asegura_titular_conyugue,
        cabecera?.AseguraTitularConyugue,
        ramoCfg?.asegura_titular_conyugue,
        'N',
      ]),
      fechaNacimiento,
    },
    promociones: promocionesFinales,
  };

  const datosAdicionales = buildProvinciaAdditionalData({ fila, cabecera, cfg, ramoCfg });
  if (datosAdicionales) payload.datosAdicionales = datosAdicionales;

  const merged = mergeProvinciaPayload(
    payload,
    parseJsonObjectLike(pick([fila?.provincia_payload_json, fila?.provincia_payload, cabecera?.provincia_payload_json, cabecera?.provincia_payload]))
  );

  return {
    payload: merged,
    requestMeta: {
      ramo,
      producto,
      ramoDescripcion: 'Accidentes Personales',
      tipoPersona,
      medioDePago,
      origenDePago,
      condicionIva: payload.datosGenerales.condicionIva,
      fechaNacimiento,
      promociones: promocionesFinales.map((item) => item.promocion),
    },
  };
}

async function buildProvinciaPayload({
  fila = {},
  cabecera = {},
  cfg = {},
  usoDicc = {},
  catalogClient = provinciaCatalog,
} = {}) {
  const selection = resolveProvinciaRamoSelection({ fila, cabecera, cfg });
  const payloadOverride = parseJsonObjectLike(pick([
    fila?.provincia_payload_json,
    fila?.provincia_payload,
    cabecera?.provincia_payload_json,
    cabecera?.provincia_payload,
  ]));

  if (selection.ramo === '4') {
    const built = await buildProvinciaAutomotorPayload({
      fila,
      cabecera,
      cfg,
      usoDicc,
      ramo: selection.ramo,
      producto: selection.producto,
      ramoCfg: selection.ramoCfg,
      catalogClient,
    });
    if (payloadOverride) {
      return {
        payload: mergeProvinciaPayload(built.payload, payloadOverride),
        requestMeta: { ...built.requestMeta, source: 'merged_override' },
      };
    }
    return built;
  }

  if (selection.ramo === '16') {
    const built = await buildProvinciaAccidentesPayload({
      fila,
      cabecera,
      cfg,
      ramo: selection.ramo,
      producto: selection.producto,
      ramoCfg: selection.ramoCfg,
    });
    if (payloadOverride) {
      return {
        payload: mergeProvinciaPayload(built.payload, payloadOverride),
        requestMeta: { ...built.requestMeta, source: 'merged_override' },
      };
    }
    return built;
  }

  if (payloadOverride) {
    return {
      payload: payloadOverride,
      requestMeta: {
        ramo: selection.ramo,
        producto: selection.producto,
        ramoDescripcion: 'Payload override',
        source: 'payload_override',
      },
    };
  }

  throw new Error(`Provincia no soporta el ramo ${selection.ramo} sin provincia_payload_json`);
}

function extractProvinciaErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return pick([
    payload?.message,
    payload?.error,
    payload?.description,
    payload?.detalle,
    payload?.errors?.[0]?.message,
    payload?.errors?.[0]?.description,
  ]);
}

function parseProvinciaQuoteResponse(data) {
  const payload = typeof data === 'string'
    ? (() => {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      })()
    : data;

  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      operacion: '0',
      coberturas: [],
      error: 'Respuesta Provincia invalida',
      raw: data,
    };
  }

  const bienes = asArray(payload?.bienesCotizados);
  const planes = asArray(payload?.planes);
  const errorMessage = extractProvinciaErrorMessage(payload);

  const coberturas = [];
  for (const plan of planes) {
    const promociones = asArray(plan?.promocionesPorPlan);
    const baseCoverage = {
      codigoDeCobertura: pick([plan?.plan, plan?.codigo, plan?.id]),
      descripcionDeCobertura: pick([plan?.descripcion, plan?.descripcionAdicional]),
      codigoDeProducto: pick([plan?.plan, plan?.codigo, plan?.id]),
      descripcionDeProducto: pick([plan?.descripcion, plan?.descripcionAdicional]),
      plan: pick([plan?.plan, plan?.codigo, plan?.id]),
      descripcion: pick([plan?.descripcion]),
      descripcionAdicional: pick([plan?.descripcionAdicional]),
      sumaAsegurada: pick([bienes[0]?.sumaAsegurada]),
    };

    if (!promociones.length) {
      coberturas.push(baseCoverage);
      continue;
    }

    for (const promo of promociones) {
      coberturas.push({
        ...baseCoverage,
        codigoPromocion: pick([promo?.codigoPromocion, promo?.codigo]),
        descripcionPromocion: pick([promo?.descripcion]),
        importePrima: pick([promo?.primaComisionable]),
        importePremio: pick([promo?.premio]),
        importeCuota: pick([promo?.premio]),
        vigencia: pick([promo?.vigencia]),
        comision: pick([promo?.comision]),
      });
    }
  }

  const ok = coberturas.length > 0;
  return {
    ok,
    operacion: pick([payload?.numeroCotizacion, payload?.numeroOperacion]) || '0',
    fechaCotizacion: pick([payload?.fechaCotizacion]),
    suma_asegurada: pick([bienes[0]?.sumaAsegurada]) || '',
    bienesCotizados: bienes,
    coberturas,
    error: ok ? '' : (errorMessage || 'Provincia respondio sin planes'),
    raw: data,
  };
}

module.exports = {
  buildProvinciaPayload,
  extractProvinciaErrorMessage,
  parseProvinciaQuoteResponse,
  resolveProvinciaBonifAdicional,
  resolveProvinciaModelAlias,
  resolveProvinciaRamoSelection,
};

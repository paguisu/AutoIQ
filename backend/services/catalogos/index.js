const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Writable } = require('stream');
const { execFileSync } = require('child_process');
const axios = require('axios');
const ftp = require('basic-ftp');
const { XMLParser } = require('fast-xml-parser');
const { fetchMercantilAndinaToken } = require('../mercantil_andina/auth');
const { buildHeaders: buildMercantilAndinaHeaders } = require('../mercantil_andina/client');
const { getMercantilAndinaHttpsAgent } = require('../mercantil_andina/tls');

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });

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
    vehiculos: ['catalog_key', 'codigo'],
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

function defaultMapfreTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    tipo_vehiculo: { fileName: 'tipo_vehiculo.json', endpoint: 'tipo_vehiculo', remoteName: null },
    vigencia: {
      fileName: 'vigencia.json',
      endpoint: 'vigencia',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/datos_poliza/',
      docsTableIndex: 0,
    },
    tipo_lugar_inspeccion: {
      fileName: 'tipo_lugar_inspeccion.json',
      endpoint: 'tipo_lugar_inspeccion',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/datos_poliza/',
      docsTableIndex: 1,
    },
    centros_externos: {
      fileName: 'centros_externos.json',
      endpoint: 'centros_externos',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/datos_poliza/',
      docsTableIndex: 2,
    },
    formas_pago: {
      fileName: 'formas_pago.json',
      endpoint: 'formas_pago',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/formas_pago/',
      docsTableIndex: 0,
    },
    monedas: {
      fileName: 'monedas.json',
      endpoint: 'monedas',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/formas_pago/',
      docsTableIndex: 1,
    },
    entidades_bancarias: {
      fileName: 'entidades_bancarias.json',
      endpoint: 'entidades_bancarias',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/formas_pago/',
      docsTableIndex: 2,
    },
    sucursales_bancarias: {
      fileName: 'sucursales_bancarias.json',
      endpoint: 'sucursales_bancarias',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/formas_pago/',
      docsSource: 'meta',
    },
    tarjetas_credito: {
      fileName: 'tarjetas_credito.json',
      endpoint: 'tarjetas_credito',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/formas_pago/',
      docsTableIndex: 3,
    },
    provincias: {
      fileName: 'provincias.json',
      endpoint: 'provincias',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/domicilio/',
      docsTableIndex: 0,
    },
    codigos_postales: {
      fileName: 'codigos_postales.json',
      endpoint: 'codigos_postales',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/domicilio/',
      docsTableIndex: 1,
    },
    tipo_domicilio: {
      fileName: 'tipo_domicilio.json',
      endpoint: 'tipo_domicilio',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/domicilio/',
      docsTableIndex: 2,
    },
    color_vehiculo: {
      fileName: 'color_vehiculo.json',
      endpoint: 'color_vehiculo',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/datos_vehiculo/',
      docsTableIndex: 1,
    },
    formas_envio: {
      fileName: 'formas_envio.json',
      endpoint: 'formas_envio',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/envio/',
      docsTableIndex: 0,
    },
    tipos_envio: {
      fileName: 'tipos_envio.json',
      endpoint: 'tipos_envio',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/envio/',
      docsTableIndex: 1,
    },
    tipo_persona: {
      fileName: 'tipo_persona.json',
      endpoint: 'tipo_persona',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 0,
    },
    sexo: {
      fileName: 'sexo.json',
      endpoint: 'sexo',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 1,
    },
    estado_civil: {
      fileName: 'estado_civil.json',
      endpoint: 'estado_civil',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 2,
    },
    tipo_documento: {
      fileName: 'tipo_documento.json',
      endpoint: 'tipo_documento',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 3,
    },
    nacionalidades: {
      fileName: 'nacionalidades.json',
      endpoint: 'nacionalidades',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 4,
    },
    condicion_iva: {
      fileName: 'condicion_iva.json',
      endpoint: 'condicion_iva',
      remoteName: null,
      docsUrl: 'https://devs.mapfre.com.ar/api-docs/documentacion/ws_autos/ws_descripcion_campos.md/tomador_asegurado/',
      docsTableIndex: 5,
    },
    localidad_aliases: { fileName: 'localidad_aliases.json', endpoint: 'localidad_aliases', remoteName: null },
  };
}

function defaultAllianzTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    tipo_vehiculo: { fileName: 'tipo_vehiculo.json', endpoint: 'tipo_vehiculo', remoteName: null },
    accesorios: { fileName: 'accesorios.json', endpoint: 'accesorios', remoteName: 'ObtenerAccesoriosVehiculo' },
    codigo_postal_aliases: { fileName: 'codigo_postal_aliases.json', endpoint: 'codigo_postal_aliases', remoteName: null },
  };
}

function defaultExpertaTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    modalidad: { fileName: 'modalidad.json', endpoint: 'modalidad', remoteName: null },
    iva: { fileName: 'iva.json', endpoint: 'iva', remoteName: null },
    marcas: { fileName: 'marcas.json', endpoint: 'marcas', remoteName: null },
    modelos: { fileName: 'modelos.json', endpoint: 'modelos', remoteName: null },
    versiones: { fileName: 'versiones.json', endpoint: 'versiones', remoteName: null },
    localidades: { fileName: 'localidades.json', endpoint: 'localidades', remoteName: null },
  };
}

function defaultProvinciaTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    brand_cache: { fileName: 'brand_cache.json', endpoint: 'brand_cache', remoteName: null },
    model_cache: { fileName: 'model_cache.json', endpoint: 'model_cache', remoteName: null },
  };
}

function defaultRivadaviaTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    tipo_vehiculo: { fileName: 'tipo_vehiculo.json', endpoint: 'tipo_vehiculo', remoteName: null },
    infoauto_tipo_vehiculo: {
      fileName: 'infoauto_tipo_vehiculo.json',
      endpoint: 'infoauto_tipo_vehiculo',
      remoteName: null,
    },
  };
}

function defaultSancorTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    tipo_vehiculo: { fileName: 'tipo_vehiculo.json', endpoint: 'tipo_vehiculo', remoteName: null },
    localidad_aliases: { fileName: 'localidad_aliases.json', endpoint: 'localidad_aliases', remoteName: null },
  };
}

function defaultSmgTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
    tipo_vehiculo: { fileName: 'tipo_vehiculo.json', endpoint: 'tipo_vehiculo', remoteName: null },
  };
}

function defaultVictoriaTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
  };
}

function defaultNacionTableMap() {
  return {
    uso: { fileName: 'uso.json', endpoint: 'uso', remoteName: null },
  };
}

function defaultMercantilAndinaTableMap() {
  return {
    marcas: { fileName: 'marcas.json', endpoint: 'marcas', remoteName: '/vehiculos/v1/marcas' },
    vehiculos: { fileName: 'vehiculos.json', endpoint: 'vehiculos', remoteName: '/vehiculos/v1/' },
  };
}

function tableMapFor(slug) {
  if (slug === 'atm') return defaultAtmTableMap();
  if (slug === 'mapfre') return defaultMapfreTableMap();
  if (slug === 'allianz') return defaultAllianzTableMap();
  if (slug === 'experta') return defaultExpertaTableMap();
  if (slug === 'provincia') return defaultProvinciaTableMap();
  if (slug === 'rivadavia') return defaultRivadaviaTableMap();
  if (slug === 'sancor') return defaultSancorTableMap();
  if (slug === 'smg') return defaultSmgTableMap();
  if (slug === 'victoria') return defaultVictoriaTableMap();
  if (slug === 'nacion') return defaultNacionTableMap();
  if (slug === 'mercantil_andina') return defaultMercantilAndinaTableMap();
  return {};
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

  if (table === 'vigencia') {
    return normalized
      .map((row) => ({
        codigo: String(row.codigo || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
      }))
      .filter((row) => row.codigo && row.descripcion);
  }

  if ([
    'formas_pago',
    'tipo_lugar_inspeccion',
    'tipo_domicilio',
    'color_vehiculo',
    'formas_envio',
    'tipos_envio',
    'tipo_persona',
    'sexo',
    'estado_civil',
    'tipo_documento',
    'nacionalidades',
    'condicion_iva',
    'provincias',
    'tarjetas_credito',
  ].includes(table)) {
    return normalized
      .map((row) => ({
        codigo: String(row.codigo || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
      }))
      .filter((row) => row.codigo && row.descripcion);
  }

  if (table === 'centros_externos') {
    return normalized
      .map((row) => ({
        cod_tercer: String(row.cod_tercer || '').trim(),
        nom_completo: String(row.nom_completo || '').trim(),
        domicilio: String(row.domicilio || '').trim(),
        nom_localidad: String(row.nom_localidad || '').trim(),
        dia_hora: String(row.dia_hora || '').trim(),
      }))
      .filter((row) => row.cod_tercer && row.nom_completo);
  }

  if (table === 'monedas') {
    return normalized
      .map((row) => ({
        codigo: String(row.codigo || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
        simbolo: String(row.col_3 || row.simbolo || '').trim(),
      }))
      .filter((row) => row.codigo && row.descripcion);
  }

  if (table === 'entidades_bancarias') {
    return normalized
      .map((row) => ({
        codigo: String(row.codigo || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
      }))
      .filter((row) => row.codigo && row.descripcion);
  }

  if (table === 'sucursales_bancarias') {
    return normalized
      .map((row) => ({
        entidad: String(row.entidad || '').trim(),
        codigo_sucursal: String(row.codigo_sucursal || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
      }))
      .filter((row) => row.entidad && row.codigo_sucursal && row.descripcion);
  }

  if (table === 'codigos_postales') {
    return normalized
      .map((row) => ({
        codigo_postal: String(row.codigo_postal || row.codigoPostal || '').trim(),
        codigo_mapfre: String(row.codigo_mapfre || row.codigoMapfre || '').trim(),
        descripcion: String(row.descripcion || '').trim(),
        codigo_provincia: String(row.codigo_provincia || row.cod_prov || '').trim(),
        provincia: String(row.provincia || row.nom_prov || '').trim(),
      }))
      .filter((row) => row.codigo_postal && row.codigo_mapfre && row.descripcion);
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00C2/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairMojibake(value) {
  const text = String(value || '');
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
}

function stripHtml(value) {
  return repairMojibake(decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')));
}

function extractHtmlTables(html) {
  const tables = [];
  const regex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match;
  while ((match = regex.exec(String(html || '')))) {
    tables.push(match[1]);
  }
  return tables;
}

function parseHtmlTable(tableHtml) {
  const rowMatches = [...String(tableHtml || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows = rowMatches.map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => stripHtml(cell[1]));
    return cells.filter((cell) => cell !== '');
  }).filter((cells) => cells.length > 0);
  if (!rows.length) return [];

  const headerRow = rows[0];
  const hasHeader = headerRow.every((cell) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cell));
  if (!hasHeader) {
    return rows.map((cells) => cells.reduce((acc, value, index) => {
      acc[`col_${index + 1}`] = value;
      return acc;
    }, {}));
  }

  const headers = headerRow.map((cell) => normalizeHeaderName(cell));
  return rows.slice(1).map((cells) => headers.reduce((acc, key, index) => {
    acc[key] = cells[index] ?? '';
    return acc;
  }, {}));
}

function extractMetaDescription(html) {
  const match = String(html || '').match(/<meta name="description" content="([\s\S]*?)"/i);
  return repairMojibake(decodeHtmlEntities(match?.[1] || ''));
}

function parseMapfreDocsTableByIndex(html, tableIndex) {
  const tables = extractHtmlTables(html).map((item) => parseHtmlTable(item));
  return Array.isArray(tables[tableIndex]) ? tables[tableIndex] : [];
}

function parseMapfreSucursalesBancariasFromMeta(html) {
  const text = extractMetaDescription(html);
  const startMarker = 'Sucursal bancaria';
  const endMarker = 'Tarjeta de Crédito';
  const startIndex = text.indexOf(startMarker);
  if (startIndex < 0) return [];
  const endIndex = text.indexOf(endMarker, startIndex + startMarker.length);
  const section = (endIndex > startIndex ? text.slice(startIndex, endIndex) : text.slice(startIndex)).replace(/\|/g, ' | ');
  const tokens = section.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  const pipeIndex = tokens.indexOf('|');
  const dataTokens = pipeIndex >= 0 ? tokens.slice(pipeIndex + 1).filter((item) => item !== '—' && item !== '|') : tokens;
  const rows = [];
  for (let i = 0; i + 2 < dataTokens.length;) {
    const entidad = dataTokens[i];
    const codigoSucursal = dataTokens[i + 1];
    if (!/^\d+$/.test(entidad) || !/^\d+$/.test(codigoSucursal)) {
      i += 1;
      continue;
    }
    i += 2;
    const descripcionParts = [];
    while (i < dataTokens.length && !/^\d+$/.test(dataTokens[i])) {
      descripcionParts.push(dataTokens[i]);
      i += 1;
    }
    const descripcion = descripcionParts.join(' ').trim();
    if (entidad && codigoSucursal && descripcion) {
      rows.push({
        entidad,
        codigo_sucursal: codigoSucursal,
        descripcion,
      });
    }
  }
  return rows;
}

function parseMapfreDocs(table, html) {
  const meta = getTableMeta('mapfre', table);
  if (meta.docsSource === 'meta' && table === 'sucursales_bancarias') {
    return parseMapfreSucursalesBancariasFromMeta(html);
  }
  if (Number.isInteger(meta.docsTableIndex)) {
    return parseMapfreDocsTableByIndex(html, meta.docsTableIndex);
  }
  return [];
}

function fetchMapfreDocsHtml(url) {
  const command = `(Invoke-WebRequest -UseBasicParsing '${String(url).replace(/'/g, "''")}').Content`;
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', command],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  return value == null ? '' : String(value).trim();
}

function readCompanyConfig(slug) {
  const cfgPath = path.join(process.cwd(), 'data', slug, 'aseguradora.json');
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

function buildAllianzAccessoriesEnvelope(cfg = {}, { page = 1, pageSize = 100, codigoAccesorio = '' } = {}) {
  const username = String(cfg?.usuario || '').trim();
  const password = String(cfg?.password || '').trim();
  const application = String(cfg?.application || '').trim();
  const senderUsername = String(cfg?.sender_username || username).trim();
  const country = String(cfg?.country || 'ARG').trim();
  const target = String(cfg?.target || 'Allianz').trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:atr="http://xmlns.allianz.com.ar/Core/EBM/Vehiculo/AtrVehiculo"
                  xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM">
   <soapenv:Header>
      <user>${escapeXml(username)}</user>
      <pwd>${escapeXml(password)}</pwd>
   </soapenv:Header>
   <soapenv:Body>
      <atr:ObtenerAccesoriosVehiculoEBM>
         <ebm:EBMHeader>
            <ebm:Sender>
               <ebm:userName>${escapeXml(senderUsername)}</ebm:userName>
               <ebm:Application>${escapeXml(application)}</ebm:Application>
               <ebm:Country>${escapeXml(country)}</ebm:Country>
            </ebm:Sender>
            <ebm:Target>${escapeXml(target)}</ebm:Target>
         </ebm:EBMHeader>
         <atr:DataArea>
            <atr:ObtenerAccesoriosVehiculo>
               <atr:codigoAccesorio>${escapeXml(codigoAccesorio)}</atr:codigoAccesorio>
               <atr:paginacion>
                  <atr:numeroPagina>${escapeXml(page)}</atr:numeroPagina>
                  <atr:cantidadRegistros>${escapeXml(pageSize)}</atr:cantidadRegistros>
               </atr:paginacion>
            </atr:ObtenerAccesoriosVehiculo>
         </atr:DataArea>
      </atr:ObtenerAccesoriosVehiculoEBM>
   </soapenv:Body>
</soapenv:Envelope>`.trim();
}

function parseAllianzAccessoriesResponse(xml) {
  const parsed = xmlParser.parse(String(xml || ''));
  const body = parsed?.Envelope?.Body || {};
  const fault = body?.Fault;
  if (fault) throw new Error(asText(fault?.faultstring || 'SOAP Fault Allianz accesorios'));

  const response = body?.ObtenerAccesoriosVehiculoResponseEBM;
  if (!response) throw new Error('Respuesta Allianz accesorios inválida');

  const returnCode = asText(response?.ReturnCode);
  const returnMessage = asText(response?.ReturnMessage);
  const errorCode = asText(response?.ErrorCode);
  if (returnCode && returnCode !== '0') {
    throw new Error(returnMessage || errorCode || `Allianz accesorios ReturnCode=${returnCode}`);
  }

  const data = response?.DataArea?.ObtenerAccesoriosVehiculoResponse || {};
  const rows = asArray(data?.ListaAccesorioVehiculo?.AccesorioVehiculo)
    .map((item) => ({
      codigo: asText(item?.codigoAccesorio),
      descripcion: asText(item?.descripcionAccesorio),
    }))
    .filter((item) => item.codigo && item.descripcion);

  return {
    cantidadPaginas: Number(data?.cantidadPaginas || 1) || 1,
    cantidadRegistros: Number(data?.cantidadRegistros || rows.length) || rows.length,
    rows,
  };
}

async function fetchAllianzAccessoriesProvider() {
  const cfg = readCompanyConfig('allianz');
  const baseUrl = String(cfg?.base_url || '').replace(/\/+$/, '');
  const soapPath = String(
    cfg?.parametros_extras?.attributes_soap_path ||
    cfg?.attributes_soap_path ||
    '/Vehiculo/Externo/Atributos/AtrVehiculoExtReqABCS'
  ).trim();
  if (!baseUrl || !soapPath) throw new Error('Allianz requiere base_url y attributes_soap_path para sincronizar accesorios');
  if (!String(cfg?.usuario || '').trim() || !String(cfg?.password || '').trim()) {
    throw new Error('Allianz requiere usuario y password para sincronizar accesorios');
  }

  const url = `${baseUrl}${soapPath}`;
  const pageSize = Number(cfg?.parametros_extras?.catalog_page_size || 100) || 100;
  const timeout = Number(cfg?.parametros_extras?.catalog_timeout_ms || 30000) || 30000;
  const soapAction = String(
    cfg?.parametros_extras?.accessories_soap_action ||
    'http://xmlns.allianz.com.ar/Core/EBS/Vehiculo/ObtenerAccesoriosVehiculo'
  );
  const rowsByCode = new Map();
  let cantidadPaginas = 1;

  for (let page = 1; page <= cantidadPaginas; page += 1) {
    const envelope = buildAllianzAccessoriesEnvelope(cfg, { page, pageSize });
    // eslint-disable-next-line no-await-in-loop
    const resp = await axios.post(url, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        SOAPAction: `"${soapAction}"`,
      },
      timeout,
      validateStatus: () => true,
    });
    if (!(resp.status >= 200 && resp.status < 300)) {
      throw new Error(`Allianz accesorios HTTP ${resp.status}`);
    }
    const parsed = parseAllianzAccessoriesResponse(resp.data);
    cantidadPaginas = Math.max(1, parsed.cantidadPaginas);
    for (const row of parsed.rows) rowsByCode.set(row.codigo, row);
  }

  return {
    sourceRaw: [...rowsByCode.values()].sort((a, b) => Number(a.codigo) - Number(b.codigo)),
    sourcePath: url,
    sourceType: 'remote-soap',
  };
}

function readMercantilAndinaCatalogConfig() {
  const cfg = readCompanyConfig('mercantil_andina');
  const overlays = {
    base_url: 'MERCANTIL_ANDINA_BASE_URL',
    auth_url: 'MERCANTIL_ANDINA_AUTH_URL',
    usuario: 'MERCANTIL_ANDINA_USER',
    password: 'MERCANTIL_ANDINA_PASS',
    client_id: 'MERCANTIL_ANDINA_CLIENT_ID',
    grant_type: 'MERCANTIL_ANDINA_GRANT_TYPE',
    subscription_key: 'MERCANTIL_ANDINA_SUBSCRIPTION_KEY',
    access_token: 'MERCANTIL_ANDINA_ACCESS_TOKEN',
  };
  for (const [field, envName] of Object.entries(overlays)) {
    if (String(process.env[envName] || '').trim()) cfg[field] = process.env[envName];
  }
  return cfg;
}

async function mercantilAndinaCatalogGet(cfg, relativePath, params = undefined) {
  const baseUrl = String(cfg?.parametros_extras?.catalog_base_url || cfg?.base_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Mercantil Andina requiere base_url para sincronizar catálogos');
  const tokenData = await fetchMercantilAndinaToken(cfg);
  const timeout = Number(cfg?.parametros_extras?.catalog_timeout_ms || 30000) || 30000;
  const maxRetries = Math.max(0, Number(cfg?.parametros_extras?.catalog_max_retries || 6) || 6);
  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    response = await axios.get(`${baseUrl}${relativePath}`, {
      params,
      headers: buildMercantilAndinaHeaders(cfg, tokenData),
      httpsAgent: getMercantilAndinaHttpsAgent(),
      timeout,
      validateStatus: () => true,
    });
    if (response.status !== 429 && response.status < 500) break;
    if (attempt >= maxRetries) break;
    const retryAfterSeconds = Number(response.headers?.['retry-after']);
    const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Math.min(30000, 1000 * (2 ** attempt));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  if (!(response.status >= 200 && response.status < 300)) {
    const detail = response.data?.errores?.map((item) => item?.texto).filter(Boolean).join('; ');
    throw new Error(`Mercantil Andina catálogo HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.data;
}

async function fetchMercantilAndinaCatalogProvider(table) {
  const cfg = readMercantilAndinaCatalogConfig();
  const sourceBase = String(cfg?.parametros_extras?.catalog_base_url || cfg?.base_url || '').trim().replace(/\/+$/, '');
  if (table === 'marcas') {
    const data = await mercantilAndinaCatalogGet(cfg, '/vehiculos/v1/marcas');
    const unique = new Map(asArray(data).map((item) => [String(item?.codigo ?? '').trim(), item]));
    return {
      sourceRaw: [...unique.values()].map((item) => ({
        codigo: String(item?.codigo ?? '').trim(),
        descripcion: asText(item?.desc || item?.descripcion),
      })).filter((item) => item.codigo && item.descripcion),
      sourcePath: `${sourceBase}/vehiculos/v1/marcas`,
      sourceType: 'remote-api',
    };
  }

  if (table === 'vehiculos') {
    const currentYear = new Date().getFullYear();
    const fromYear = Number(process.env.MERCANTIL_ANDINA_CATALOG_YEAR_FROM || cfg?.parametros_extras?.catalog_year_from || 1960);
    const toYear = Number(process.env.MERCANTIL_ANDINA_CATALOG_YEAR_TO || cfg?.parametros_extras?.catalog_year_to || currentYear + 1);
    const pageSize = Math.min(999, Math.max(20, Number(cfg?.parametros_extras?.catalog_page_size || 999) || 999));
    const requestIntervalMs = Math.max(0, Number(cfg?.parametros_extras?.catalog_request_interval_ms || 1000) || 1000);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear) {
      throw new Error('Rango de años inválido para catálogo de vehículos Mercantil Andina');
    }

    const rowsByYearAndId = new Map();
    for (let anio = fromYear; anio <= toYear; anio += 1) {
      let offset = 0;
      let total = 0;
      do {
        // Un espacio es el criterio documentado por comportamiento de producción para listar todo el año.
        // eslint-disable-next-line no-await-in-loop
        const page = await mercantilAndinaCatalogGet(cfg, '/vehiculos/v1/', {
          q: ' ', anio, tipo: 'AUTO', offset, limit: pageSize,
        });
        const datos = asArray(page?.datos);
        total = Number(page?.total || datos.length) || 0;
        for (const item of datos) {
          const codigo = String(item?.codigo ?? item?.id ?? '').trim();
          if (!codigo) continue;
          rowsByYearAndId.set(`${anio}:${codigo}`, {
            catalog_key: `${anio}:${codigo}`,
            codigo,
            anio: String(anio),
            descripcion: asText(item?.nombre || item?.desc),
            infoauto: String(item?.infoauto ?? '').trim(),
            propulsion: String(item?.propulsion ?? '').trim(),
          });
        }
        offset += datos.length;
        if (!datos.length) break;
        if (requestIntervalMs > 0 && offset < total) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, requestIntervalMs));
        }
      } while (offset < total);
      if (requestIntervalMs > 0 && anio < toYear) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, requestIntervalMs));
      }
    }
    return {
      sourceRaw: [...rowsByYearAndId.values()],
      sourcePath: `${sourceBase}/vehiculos/v1/?q=%20&anio={anio}&tipo=AUTO`,
      sourceType: 'remote-api-paginated',
    };
  }
  throw new Error(`Tabla Mercantil Andina no implementada: ${table}`);
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
  const meta = getTableMeta(slug, table);
  if (slug === 'atm') {
    const provider = String(process.env.ATM_CATALOG_PROVIDER || 'ftp').trim().toLowerCase();
    return provider === 'http' ? fetchFromHttpProvider(meta) : fetchFromFtpProvider(meta);
  }
  if (slug === 'mapfre') {
    if (!meta.docsUrl) throw new Error(`Proveedor real no implementado para ${slug}/${table}`);
    const html = fetchMapfreDocsHtml(meta.docsUrl);
    return {
      sourceRaw: parseMapfreDocs(table, html),
      sourcePath: meta.docsUrl,
      sourceType: 'remote-docs',
    };
  }
  if (slug === 'allianz' && table === 'accesorios') {
    return fetchAllianzAccessoriesProvider();
  }
  if (slug === 'mercantil_andina') {
    return fetchMercantilAndinaCatalogProvider(table);
  }
  throw new Error(`Proveedor real no implementado para ${slug}`);
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
    remoteSupported: Boolean(tableMap[table].remoteName || tableMap[table].docsUrl),
  }));
}

function getTableStatus({ dataRoot, slug, table }) {
  const meta = getTableMeta(slug, table);
  const localSourcePath = path.join(dataRoot, slug, 'diccionarios', meta.fileName);
  const exists = fs.existsSync(localSourcePath);
  const updatedAt = exists ? fs.statSync(localSourcePath).mtime.toISOString() : null;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const updatedMonthKey = updatedAt
    ? `${new Date(updatedAt).getFullYear()}-${String(new Date(updatedAt).getMonth() + 1).padStart(2, '0')}`
    : null;

  return {
    slug,
    table,
    exists,
    sourcePath: localSourcePath,
    updatedAt,
    currentMonthKey,
    isCurrentMonth: Boolean(updatedMonthKey && updatedMonthKey === currentMonthKey),
  };
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
  getTableStatus,
  normalizeRecords,
  buildAllianzAccessoriesEnvelope,
  buildDiff,
  parseAllianzAccessoriesResponse,
  fetchMercantilAndinaCatalogProvider,
  syncTable,
  readReport,
};

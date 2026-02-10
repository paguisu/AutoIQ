// backend/routes/proceso.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../config/db');
const { initPreprocesador } = require('../utils/preprocesado_helper');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmt_ddmmAAAA(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getDate())}${pad2(dt.getMonth() + 1)}${dt.getFullYear()}`;
}

// ===== Testing data (tarjetas / CBU / DNI) =====
const TESTING_DIR = path.join(__dirname, '..', '..', 'data', 'testing');
const _testingCache = { tarjetas: null, cbus: null, dnis: null };

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getTestingTarjetas() {
  if (_testingCache.tarjetas) return _testingCache.tarjetas;
  const p = path.join(TESTING_DIR, 'tarjetas_credito.json');
  _testingCache.tarjetas = readJsonFileSafe(p) || { default: null, tarjetas: {} };
  return _testingCache.tarjetas;
}

function getTestingCbus() {
  if (_testingCache.cbus) return _testingCache.cbus;
  const p = path.join(TESTING_DIR, 'cbus.json');
  _testingCache.cbus = readJsonFileSafe(p) || { default: null, cbus: {} };
  return _testingCache.cbus;
}

function pick(a) {
  for (const v of a) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ===== formato de fecha configurable (ATM / otras) =====
function formatFecha(input, pattern) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return fmt_ddmmAAAA(new Date());
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  const yyyy = dt.getFullYear();
  const fmt = (pattern || '').trim();

  switch (fmt) {
    case 'yyyyMMdd':
      return `${yyyy}${mm}${dd}`;
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${yyyy}`;
    case 'yyyy-MM-dd':
      return `${yyyy}-${mm}-${dd}`;
    case 'ddMMyyyy':
    default:
      return `${dd}${mm}${yyyy}`;
  }
}

async function readJsonStrict(abs) {
  const raw = await fsp.readFile(abs, 'utf8');
  return JSON.parse(raw);
}
async function writeJson(abs, obj) {
  await fsp.writeFile(abs, JSON.stringify(obj, null, 2), 'utf8');
}

// ===== Cabeceras (JSON local ya usado por tu proyecto) =====
const cabStore = path.join(process.cwd(), 'data', 'cabeceras', 'cabeceras.json');
function getCabecera(id) {
  try {
    const j = JSON.parse(fs.readFileSync(cabStore, 'utf8'));
    return (j.items || []).find((x) => x.id === Number(id)) || null;
  } catch {
    return null;
  }
}

// ===== Config y helpers por aseguradora (dinámico) =====
function asegPath(slug) {
  return path.join(process.cwd(), 'data', slug);
}
async function loadAsegConfig(slug) {
  const cfgPath = path.join(asegPath(slug), 'aseguradora.json');
  const j = await readJsonStrict(cfgPath);
  // Centralización credenciales ATM: preferimos ENV y, si no, caemos al JSON.
  if (slug === 'atm') {
    j.usuario = process.env.ATM_USER || j.usuario;
    j.password = process.env.ATM_PASS || j.password;
    j.vendedor = process.env.ATM_VENDEDOR || j.vendedor;
    j.origen = process.env.ATM_ORIGEN || j.origen;
    j.plan = process.env.ATM_PLAN || j.plan;
    j.contacto_tecnico = process.env.ATM_CONTACTO_TECNICO || j.contacto_tecnico;
    j.contacto_comercial = process.env.ATM_CONTACTO_COMERCIAL || j.contacto_comercial;
  }
  if (!j.base_url || !j.soap_path) throw new Error(`Config ${slug}: faltan base_url o soap_path`);
  const method = j.soap_method || j.SOAP_METHOD || 'AUTOS_Cotizar_PHP';
  let url = `${j.base_url.replace(/\/+$/, '')}${j.soap_path}`;
  const formato =
    (j.parametros_extras && j.parametros_extras.formato_fecha_request) ||
    process.env.ATM_DATE_FMT ||
    'ddMMyyyy';
  return { cfg: j, SOAP_URL: url, SOAP_METHOD: method, fechaFmt: formato };
}

// ===== Fallbacks menores =====
function inferSeccionVehiculo(fila) {
  const join = Object.values(fila || {}).join(' ').toLowerCase();
  if (/\bmoto(s)?\b/.test(join)) return '1';
  return '3';
}

// ===== Diccionarios de USO =====
async function readUsoDicc(slug) {
  try {
    const p = path.join(asegPath(slug), 'diccionarios', 'uso.json');
    return await readJsonStrict(p);
  } catch {
    return {};
  }
}
function mapUsoTextoACodigo(value, DICC) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return raw;
  const key = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return DICC[key] || '';
}

// ===== Helpers Proceso (filesystem) =====
function procesosRoot() {
  return path.join(process.cwd(), 'data', 'procesos');
}
function procesoDir(id) {
  return path.join(procesosRoot(), `proceso-${id}`);
}
function metadataPath(id) {
  return path.join(procesoDir(id), 'metadata.json');
}
function resumenPath(id) {
  return path.join(procesoDir(id), 'resumen.json');
}

// ===== Export Excel por Proceso =====
function flattenForExcel(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}${k}` : k;
    if (v == null) {
      out[key] = '';
    } else if (typeof v === 'object') {
      // Evitar explotar columnas: guardar objeto completo como JSON
      out[key] = JSON.stringify(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

async function generarExcelProceso(procesoId) {
  const id = Number(procesoId);
  const meta = await loadMetadata(id);
  if (!meta) throw new Error('No existe el proceso');

  const rp = resumenPath(id);
  if (!fs.existsSync(rp)) throw new Error('El proceso no tiene resumen.json');
  const resumen = JSON.parse(fs.readFileSync(rp, 'utf8'));

  const cabecera = meta.cabecera_id ? getCabecera(meta.cabecera_id) : null;

  // Resolver archivo combinado desde metadata (fallback: DB historial)
  let relArchivo = meta.archivo || null;
  let absArchivo = null;
  if (relArchivo) {
    absArchivo = path.isAbsolute(relArchivo) ? relArchivo : path.join(process.cwd(), relArchivo);
  } else if (meta.historial_id) {
    const hist = await getHistorialItem(meta.historial_id);
    if (hist) {
      const resolved = resolveCombinedAbsPath(hist);
      relArchivo = resolved.relPath;
      absArchivo = resolved.absPath;
    }
  }
  if (!absArchivo || !fs.existsSync(absArchivo)) {
    throw new Error('No se encontró el archivo combinado para exportar');
  }

  const filas = await readFilasFromFile(absArchivo);

  const rowsCot = [];
  const rowsSkip = [];
  const rowsErr = [];

  for (const slug of Object.keys(resumen.resultados || {})) {
    const arr = Array.isArray(resumen.resultados[slug]) ? resumen.resultados[slug] : [];
    for (const item of arr) {
      const idx = Number(item.index);
      const filaIn = filas[idx] || {};
      const base = {
        proceso_id: id,
        historial_id: meta.historial_id || resumen.historial_id || null,
        cabecera_id: meta.cabecera_id || resumen.cabecera_id || null,
        aseguradora: slug,
        index: idx,
        ok: item.ok === true,
        skipped: item.skipped === true,
        operacion: item.operacion || '',
        reason: item.reason || '',
        error: item.error || '',
      };

      const filaFlat = flattenForExcel(filaIn, 'veh_');
      const cabFlat = cabecera ? flattenForExcel(cabecera, 'cab_') : {};

      if (item.skipped) {
        rowsSkip.push({ ...base, ...filaFlat, ...cabFlat, used: JSON.stringify(item.used || {}) });
        continue;
      }

      if (!item.ok) {
        rowsErr.push({ ...base, ...filaFlat, ...cabFlat, used: JSON.stringify(item.used || {}) });
        continue;
      }

      // ok y no skipped: una fila por cobertura (si existe), sino una fila base
      const cobs = Array.isArray(item.coberturas) ? item.coberturas : [];
      if (cobs.length === 0) {
        rowsCot.push({ ...base, ...filaFlat, ...cabFlat, used: JSON.stringify(item.used || {}) });
      } else {
        for (const cob of cobs) {
          const cobFlat = flattenForExcel(cob, 'cot_');
          rowsCot.push({ ...base, ...filaFlat, ...cabFlat, ...cobFlat, used: JSON.stringify(item.used || {}) });
        }
      }
    }
  }

  const wb = xlsx.utils.book_new();
  const wsCot = xlsx.utils.json_to_sheet(rowsCot);
  xlsx.utils.book_append_sheet(wb, wsCot, 'Cotizaciones');

  const wsErr = xlsx.utils.json_to_sheet(rowsErr);
  xlsx.utils.book_append_sheet(wb, wsErr, 'Errores');

  const wsSkip = xlsx.utils.json_to_sheet(rowsSkip);
  xlsx.utils.book_append_sheet(wb, wsSkip, 'Skipped');

  const dlDir = path.join(procesoDir(id), 'descargas');
  ensureDir(dlDir);
  const outAbs = path.join(dlDir, `proceso-${id}-cotizaciones.xlsx`);
  xlsx.writeFile(wb, outAbs);
  return outAbs;
}

async function loadMetadata(id) {
  const p = metadataPath(id);
  if (!fs.existsSync(p)) return null;
  return await readJsonStrict(p);
}
async function saveMetadata(id, patch) {
  ensureDir(procesoDir(id));
  const cur = (await loadMetadata(id)) || {};
  const next = { ...cur, ...patch };
  await writeJson(metadataPath(id), next);
  return next;
}

async function getHistorialItem(historial_id) {
  const [rows] = await db.execute(
    'SELECT id, nombre_archivo, ruta, ruta AS archivo, fecha, cantidad_registros FROM historial_combinaciones WHERE id = ? LIMIT 1',
    [Number(historial_id)]
  );
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

function resolveCombinedAbsPath(item) {
  const relPath =
    item.ruta && String(item.ruta).trim()
      ? String(item.ruta).trim()
      : path.join('data', 'combinados', item.nombre_archivo);
  const abs = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);
  return { relPath: relPath.replace(/\\/g, '/'), absPath: abs };
}

async function readFilasFromFile(absPath) {
  let filas = [];

  if (absPath.toLowerCase().endsWith('.csv')) {
    const csv = fs.readFileSync(absPath, 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const headers = (lines.shift() || '').split(',').map((s) => s.trim());
    for (const ln of lines) {
      const cols = ln.split(',');
      const obj = {};
      headers.forEach((h, i) => (obj[h] = cols[i] ?? ''));
      filas.push(obj);
    }
    return filas;
  }

  const wb = xlsx.readFile(absPath);

  // Elegir una hoja "con rango" y luego una con filas parseables
  const sheetNames = wb.SheetNames || [];
  let best = sheetNames[0];

  // 1) Preferir la hoja con más filas en el rango (!ref)
  let bestRows = -1;
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws && ws['!ref'];
    if (!ref) continue;
    const r = xlsx.utils.decode_range(ref);
    const rowsInRange = (r.e.r - r.s.r + 1);
    if (rowsInRange > bestRows) {
      bestRows = rowsInRange;
      best = name;
    }
  }

  // 2) Intentar parsear; si da 0, probar otras hojas
  const tryParse = (name) => xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });

  filas = tryParse(best) || [];
  if (filas.length === 0) {
    for (const name of sheetNames) {
      const tmp = tryParse(name) || [];
      if (tmp.length > 0) {
        filas = tmp;
        break;
      }
    }
  }

  return filas;
}

// ===== Instrumentación (evidencias por fila) =====
function evidenciasDir(proceso_id, slug, index) {
  return path.join(procesoDir(proceso_id), 'evidencias', String(slug), `fila-${String(index).padStart(4, '0')}`);
}
function safeWriteFile(absPath, content, encoding = 'utf8') {
  try {
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, content, encoding);
    return true;
  } catch {
    return false;
  }
}
function safeWriteJson(absPath, obj) {
  try {
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ===== Caller SOAP para una fila =====
async function cotizarFila({
  proceso_id,
  slug,
  index,
  fila,
  cabecera,
  hoy_fmt,
  mapeos,
  Aseg,
  SOAP_URL,
  SOAP_METHOD,
  usoDicc,
}) {
  const codiaRaw = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto
  ]);
  const codia = String(codiaRaw ?? '').trim();
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const cpRaw = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]);
  const cp = String(cpRaw ?? '').trim();

  const evDir = (proceso_id != null && slug != null && index != null)
    ? evidenciasDir(proceso_id, slug, index)
    : null;

  if (evDir) {
    safeWriteJson(path.join(evDir, 'fila_input.json'), { fila, mapeos, cabecera_id: cabecera?.id ?? null });
  }

  if (!cp) {
    const out = { ok: false, error: 'Debe informar el código postal', operacion: '0', coberturas: [], raw: '' };
    if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
    return out;
  }
  if (!/^\d{4}$/.test(cp)) {
    const out = { ok: false, error: 'Código postal inválido (debe ser numérico de 4 posiciones)', operacion: '0', coberturas: [], raw: '' };
    if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
    return out;
  }

  let usoCodigo = '';
  if (mapeos && mapeos.uso_codigo) {
    usoCodigo = String(mapeos.uso_codigo);
  } else {
    const usoExcel = pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso]);
    if (usoExcel) usoCodigo = mapUsoTextoACodigo(usoExcel, usoDicc);
    if (!usoCodigo) {
      const maybe = (cabecera?.uso_default || cabecera?.uso || '').toString().trim();
      if (maybe) usoCodigo = mapUsoTextoACodigo(maybe, usoDicc);
    }
  }

  const seccion =
    (mapeos && mapeos.seccion && String(mapeos.seccion).trim()) ||
    (cabecera?.seccion && String(cabecera.seccion).trim()) ||
    inferSeccionVehiculo(fila) ||
    (Aseg.seccion_default && String(Aseg.seccion_default).trim()) ||
    '3';

  // Bypass motos: por ahora NO se envían al WS de autos (AUTOS_Cotizar_PHP).
  // Se detecta por: seccion=1, texto tipo_vehiculo, o regla InfoAuto >= 8000000.
  const tipoVehTxt = pick([fila?.tipo_vehiculo, fila?.TipoVehiculo, fila?.tipoVehiculo]);
  const tipoVehNorm = (tipoVehTxt || '').toString().toLowerCase();
  const codiaNum = Number.parseInt(String(codia || '').replace(/\D+/g, ''), 10);
  const esMoto =
    String(seccion) === '1' ||
    (Number.isFinite(codiaNum) && codiaNum >= 8000000) ||
    tipoVehNorm.includes('moto') ||
    tipoVehNorm.includes('scooter');

  if (slug === 'atm' && String(SOAP_METHOD) === 'AUTOS_Cotizar_PHP' && esMoto) {
    const outSkip = {
      ok: true,
      skipped: true,
      reason: 'Moto: se omite WS AUTOS_Cotizar_PHP',
      operacion: 'SKIP_MOTO',
      coberturas: [],
      raw: '',
      used: { seccion, cod_infoauto: codia, soap_method: SOAP_METHOD }
    };
    if (evDir) safeWriteJson(path.join(evDir, 'atm-skip.json'), outSkip);
    return outSkip;
  }

  const cerokm = cabecera?.cerokm === '1' ? '1' : '0';
  const tipo_uso = ['1', '2'].includes(String(cabecera?.tipo_uso || ''))
    ? String(cabecera.tipo_uso)
    : '1';
  const ajuste = (cabecera?.ajuste || '').toString().trim();
  const rastreoRaw = (cabecera?.rastreo ?? '').toString().trim();
  // ATM: 'rastreo' es un CÓDIGO de la tabla ws_au_rastreo_satelital. Si no hay código válido, NO se envía.
  // Si tu UI guarda 0/1 como booleano, lo tratamos como 'no informar'.
  const rastreoCodigo = (!rastreoRaw || rastreoRaw === '0' || rastreoRaw === '1') ? '' : rastreoRaw;
  const alarma = cabecera?.alarma === '1' ? '1' : '0';
  const gnc = cabecera?.gnc === '1' ? '1' : '0';

  let bienXML = `
    <cod_infoauto>${codia}</cod_infoauto>
    <anofab>${anio}</anofab>
    <codpostal>${cp}</codpostal>
    <seccion>${seccion}</seccion>
  `.trim();

  if (usoCodigo) bienXML += `\n    <uso>${usoCodigo}</uso>`;
  if (ajuste) bienXML += `\n    <ajuste>${ajuste}</ajuste>`;
  bienXML += `\n    <alarma>${alarma}</alarma>`;
  if (rastreoCodigo) bienXML += `\n    <rastreo>${rastreoCodigo}</rastreo>`;
  bienXML += `\n    <cerokm>${cerokm}</cerokm>`;
  bienXML += `\n    <gnc>${gnc}</gnc>`;
  if (seccion === '4' && tipo_uso) bienXML += `\n    <tipo_uso>${tipo_uso}</tipo_uso>`;

  // ===== Forma de pago (ATM) =====
  const mpRaw = String(
    cabecera?.medio_pago ??
      cabecera?.medioPago ??
      cabecera?.forma_pago ??
      cabecera?.formaPago ??
      ''
  )
    .trim()
    .toUpperCase();

  const formaPago =
    mpRaw === '2' || mpRaw.includes('TARJ') || mpRaw.includes('TC') || mpRaw.includes('CRED')
      ? '2'
      : mpRaw === '4' || mpRaw.includes('CBU')
      ? '4'
      : mpRaw === '1' || mpRaw.includes('EFVO') || mpRaw.includes('EFEC') || mpRaw.includes('OTRA')
      ? '1'
      : '2';

  let formapagoXML = '';
  if (formaPago === '1') {
    formapagoXML = `\n  <formapago>\n    <forma>1</forma>\n  </formapago>`;
  } else if (formaPago === '4') {
    const cbusCfg = getTestingCbus();
    const cbuKey = String(cabecera?.cbu_id ?? cabecera?.cbu_key ?? cabecera?.cbu ?? cbusCfg.default ?? '').trim();
    const cbuObj = cbusCfg.cbus?.[cbuKey];
    const cbuNumero = String(cabecera?.cbu_numero ?? cbuObj?.numero ?? '').trim();

    if (!cbuNumero) {
      const out = { ok: false, error: 'Forma de pago CBU (forma=4) requiere cbu_numero (o cbu_id con data/testing/cbus.json)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
      return out;
    }
    if (!/^\d{22}$/.test(cbuNumero)) {
      const out = { ok: false, error: 'CBU inválido (debe ser numérico de 22 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
      return out;
    }

    formapagoXML =
      `\n  <formapago>` +
      `\n    <forma>4</forma>` +
      `\n    <cbu>\n      <numero>${cbuNumero}</numero>\n    </cbu>` +
      `\n  </formapago>`;
  } else {
    const tarjetasCfg = getTestingTarjetas();
    const tarjetaKey = String(cabecera?.tarjeta_id ?? cabecera?.tarjeta_key ?? cabecera?.tarjeta ?? tarjetasCfg.default ?? '').trim();
    const tObj = tarjetasCfg.tarjetas?.[tarjetaKey];

    const tNombre = String(cabecera?.tarjeta_nombre ?? tObj?.codigo_atm ?? '').trim();
    const tNumero = String(cabecera?.tarjeta_numero ?? tObj?.numero ?? '').trim();
    const tVcto = String(cabecera?.tarjeta_vcto ?? tObj?.vencimiento ?? '').trim(); // MMAAAA

    if (!tNombre || !tNumero || !tVcto) {
      const out = { ok: false, error: 'Forma de pago TARJETA (forma=2) requiere tarjeta_nombre(código ws_au_tarjeta), tarjeta_numero y tarjeta_vcto (MMAAAA) en cabecera o en data/testing/tarjetas_credito.json', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
      return out;
    }
    if (!/^\d{13,19}$/.test(tNumero)) {
      const out = { ok: false, error: 'Número de tarjeta inválido (debe ser numérico 13-19 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
      return out;
    }
    if (!/^\d{6}$/.test(tVcto)) {
      const out = { ok: false, error: 'Vencimiento de tarjeta inválido (formato MMAAAA, 6 dígitos)', operacion: '0', coberturas: [], raw: '' };
      if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
      return out;
    }

    formapagoXML =
      `\n  <formapago>` +
      `\n    <forma>2</forma>` +
      `\n    <tarjeta>` +
      `\n      <nombre>${tNombre}</nombre>` +
      `\n      <numero>${tNumero}</numero>` +
      `\n      <vcto>${tVcto}</vcto>` +
      `\n    </tarjeta>` +
      `\n  </formapago>`;
  }

  const docIn = `
<auto>
  <usuario>
    <usa>${Aseg.usuario}</usa>
    <pass>${Aseg.password}</pass>
    <fecha>${hoy_fmt}</fecha>
    <vendedor>${Aseg.vendedor || ''}</vendedor>
    <origen>${Aseg.origen || 'WS'}</origen>
    ${Aseg.plan ? `<plan>${Aseg.plan}</plan>` : ''}
    ${Aseg.contacto_tecnico ? `<contacto_tecnico>${Aseg.contacto_tecnico}</contacto_tecnico>` : ''}
    ${Aseg.contacto_comercial ? `<contacto_comercial>${Aseg.contacto_comercial}</contacto_comercial>` : ''}
  </usuario>
  <asegurado>
    <persona>${cabecera.tipopersona || 'F'}</persona>
    <iva>${cabecera.iva || 'CF'}</iva>
  </asegurado>
  <bien>
    ${bienXML}
  </bien>${formapagoXML}
</auto>`.trim();

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <${SOAP_METHOD} xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${SOAP_METHOD}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

  if (evDir) {
    safeWriteFile(path.join(evDir, 'atm-doc_in.xml'), docIn);
    safeWriteFile(path.join(evDir, 'atm-soap_request.xml'), envelope);
    safeWriteJson(path.join(evDir, 'atm-config-usada.json'), {
      soap_url: SOAP_URL,
      soap_method: SOAP_METHOD,
      vendedor: Aseg?.vendedor ?? null,
      origen: Aseg?.origen ?? null,
      plan: Aseg?.plan ?? null,
      fecha_fmt: hoy_fmt,
    });
  }

  const actions = [`http://tempuri.org/${SOAP_METHOD}`, `${SOAP_METHOD}`, `urn:${SOAP_METHOD}`];
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  let lastErr = null;
  let rawResp = null;

  for (const sa of actions) {
    try {
      if (evDir) {
        safeWriteFile(path.join(evDir, 'atm-soapaction.txt'), sa);
      }

      const resp = await axios.post(SOAP_URL, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: sa },
        timeout: 20000,
        validateStatus: () => true,
      });
      rawResp = resp.data;

      if (evDir) {
        safeWriteFile(path.join(evDir, 'atm-raw_response.xml'), String(rawResp || ''));
        safeWriteJson(path.join(evDir, 'atm-http.json'), { status: resp.status, ok: resp.status >= 200 && resp.status < 300 });
      }

      if (resp.status >= 200 && resp.status < 300) {
        const parsed = parser.parse(String(rawResp || ''));
        const body =
          parsed?.['SOAP-ENV:Envelope']?.['SOAP-ENV:Body'] || parsed?.Envelope?.Body;
        const result =
          body?.['ns1:' + SOAP_METHOD + 'Response']?.['ns1:' + SOAP_METHOD + 'Result'] ||
          body?.[SOAP_METHOD + 'Response']?.[SOAP_METHOD + 'Result'] ||
          body?.[`${SOAP_METHOD}Response`]?.[`${SOAP_METHOD}Result`];

        let payload = result;
        if (typeof payload === 'string') {
          try {
            payload = parser.parse(payload);
          } catch {}
        }

        const auto = payload?.auto || payload?.doc_out?.auto || payload?.AUTO || null;
        const operacion = auto?.operacion || auto?.Operacion || null;
        const coberturas = Array.isArray(auto?.cotizacion?.cobertura)
          ? auto.cotizacion.cobertura
          : auto?.cotizacion?.Cobertura
          ? [].concat(auto.cotizacion.Cobertura)
          : [];

        const rawStr = String(rawResp || '');
        const opRx = rawStr.match(/<operacion>\s*([^<]+)\s*<\/operacion>/i);
        const ssRx = rawStr.match(/<statusSuccess>\s*([^<]+)\s*<\/statusSuccess>/i);
        const msgRx = rawStr.match(/<msg>\s*([^<]+)\s*<\/msg>/i);

        const operacionFinal = (operacion ?? (opRx ? opRx[1].trim() : null));
        const statusSuccess =
          (auto?.statusSuccess ?? auto?.StatusSuccess ?? (ssRx ? ssRx[1].trim() : '')).toString().toUpperCase();
        const msg = (msgRx ? msgRx[1].trim() : '');

        const success = statusSuccess === 'TRUE';

        const parsedOut = {
          ok: success,
          operacion: operacionFinal,
          statusSuccess,
          msg,
          coberturas_len: Array.isArray(coberturas) ? coberturas.length : 0,
          used: { soapAction: sa }
        };

        if (evDir) {
          safeWriteJson(path.join(evDir, 'atm-parsed.json'), parsedOut);
          if (Array.isArray(coberturas) && coberturas.length) {
            safeWriteJson(path.join(evDir, 'atm-coberturas.json'), coberturas);
          }
        }

        if (!success) {
          const out = {
            ok: false,
            operacion: operacionFinal,
            coberturas: [],
            error: msg || 'statusSuccess=FALSE',
            used: { soapAction: sa },
            raw: rawResp,
          };
          if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
          return out;
        }

        return {
          ok: true,
          operacion: operacionFinal,
          coberturas,
          used: { soapAction: sa },
          raw: rawResp,
        };
      }

      lastErr = `HTTP ${resp.status}`;
    } catch (e) {
      lastErr = e.message || 'axios error';
      if (evDir) {
        safeWriteJson(path.join(evDir, 'atm-exception.json'), {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
      }
    }
  }

  const out = { ok: false, error: lastErr, raw: rawResp };
  if (evDir) safeWriteJson(path.join(evDir, 'atm-error.json'), out);
  return out;
}

// =============================================================================
// NUEVO: POST /proceso/crear
// =============================================================================
router.post('/crear', express.json(), async (req, res) => {
  try {
    const historial_id = Number(req.body?.historial_id);
    const cabecera_id = Number(req.body?.cabecera_id);
    const nombre = (req.body?.nombre || '').toString().trim();

    if (!historial_id) return res.status(400).json({ ok: false, error: 'Falta historial_id' });
    if (!cabecera_id) return res.status(400).json({ ok: false, error: 'Falta cabecera_id' });

    const cabecera = getCabecera(cabecera_id);
    if (!cabecera) return res.status(404).json({ ok: false, error: `Cabecera ${cabecera_id} no encontrada` });

    const hist = await getHistorialItem(historial_id);
    if (!hist) return res.status(404).json({ ok: false, error: `Historial ${historial_id} no encontrado` });

    const { relPath, absPath } = resolveCombinedAbsPath(hist);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: `No existe el archivo combinado: ${absPath}` });
    }

    let aseguradoras = req.body?.aseguradoras;
    if (typeof aseguradoras === 'string') aseguradoras = [aseguradoras];
    if (!Array.isArray(aseguradoras) || aseguradoras.length === 0) aseguradoras = ['atm'];
    aseguradoras = aseguradoras.map((s) => String(s).toLowerCase().trim()).filter(Boolean);

    const limiteBody = Number(req.body?.limite);
    const limite = Number.isFinite(limiteBody) ? Math.max(1, Math.min(limiteBody, 100)) : 5;

    const proceso_id = Date.now();

    ensureDir(procesosRoot());
    ensureDir(procesoDir(proceso_id));

    const meta = {
      id: proceso_id,
      nombre: nombre || `Proceso ${proceso_id}`,
      estado: 'creado',
      historial_id,
      archivo: relPath,
      cabecera_id,
      aseguradoras,
      limite,
      fecha_creacion: new Date().toISOString(),
      fecha_inicio: null,
      fecha_fin: null,
      registros_total: Number(hist.cantidad_registros || 0) || null,
      registros_procesados: 0,
      cotizaciones_exitosas: 0,
      cotizaciones_con_error: 0,
    };

    await writeJson(metadataPath(proceso_id), meta);

    return res.status(200).json({ ok: true, proceso_id, metadata: meta });
  } catch (err) {
    console.error('Error en /proceso/crear', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// POST /proceso/ejecutar/:id
// =============================================================================
router.post('/ejecutar/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);

    let meta = await loadMetadata(id);

    if (!meta) {
      // Si no existe metadata, interpretamos :id como HISTORIAL id y creamos un NUEVO proceso (DB + carpeta).
      const historial_id = id;

      const cabeceraIdCompat = Number(req.body?.cabecera_id);
      if (!cabeceraIdCompat) return res.status(400).json({ ok: false, error: 'Falta cabecera_id' });

      const cabeceraCompat = getCabecera(cabeceraIdCompat);
      if (!cabeceraCompat) return res.status(404).json({ ok: false, error: `Cabecera ${cabeceraIdCompat} no encontrada` });

      const hist = await getHistorialItem(historial_id);
      if (!hist) return res.status(404).json({ ok: false, error: `No existe el histórico ${historial_id}` });

      const archivo = hist?.archivo;
      if (!archivo) return res.status(400).json({ ok: false, error: `Histórico ${historial_id} sin archivo asociado` });

      // Crear registro en DB para que aparezca en "Procesos en curso"
      let proceso_id = null;
      try {
        const nombreProceso = `ATM - UI (histórico ${historial_id})`;
        const nombreCabecera = cabeceraCompat?.nombre || cabeceraCompat?.nombre_cabecera || cabeceraCompat?.nombre_publico || `Cabecera ${cabeceraIdCompat}`;

        const [ins] = await db.execute(
          'INSERT INTO procesos_cotizacion (nombre, nombre_cabecera, estado, fecha_inicio) VALUES (?, ?, ?, NOW())',
          [nombreProceso, nombreCabecera, 'en curso']
        );
        proceso_id = ins.insertId;

        // Guardar nombre de cabecera si existe la columna (defensivo)
        try {
          await db.execute('UPDATE procesos_cotizacion SET nombre_cabecera = ? WHERE id = ?', [nombreCabecera, proceso_id]);
        } catch (_e) {
          // columna puede no existir; ignorar
        }
      } catch (e) {
        console.error('Error creando proceso en DB', e);
        return res.status(500).json({ ok: false, error: 'No se pudo crear el proceso en DB' });
      }

      const procesoFolder = path.join(process.cwd(), 'data', 'procesos', `proceso-${proceso_id}`);
      ensureDir(procesoFolder);
      const metaPath = path.join(procesoFolder, 'metadata.json');

      meta = {
        id: proceso_id,
        historial_id,
        archivo,
        fecha: new Date().toISOString(),
        limite: Number(req.body?.limite ?? 50),
        cabecera_id: cabeceraIdCompat,
        aseguradoras: req.body?.aseguradoras || req.body?.aseguradora || [],
        resultados: {}
      };

      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }

    const proceso_id = meta.id;
    const historial_id = Number(meta.historial_id);
    const cabecera_id = Number(meta.cabecera_id);

    const cabecera = getCabecera(cabecera_id);
    if (!cabecera) return res.status(404).json({ ok: false, error: `Cabecera ${cabecera_id} no encontrada` });

    const hist = await getHistorialItem(historial_id);
    if (!hist) return res.status(404).json({ ok: false, error: `Historial ${historial_id} no encontrado` });

    const { relPath, absPath } = resolveCombinedAbsPath(hist);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: `No existe el archivo combinado: ${absPath}` });
    }

    const limiteBody = Number(req.body?.limite);
    const limite = Number.isFinite(limiteBody)
      ? Math.max(1, Math.min(limiteBody, 100))
      : Math.max(1, Math.min(Number(meta.limite || 5), 100));

    let aseguradoras = req.body?.aseguradoras;
    if (typeof aseguradoras === 'string') aseguradoras = [aseguradoras];
    if (!Array.isArray(aseguradoras) || aseguradoras.length === 0) aseguradoras = meta.aseguradoras || ['atm'];
    aseguradoras = aseguradoras.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    if (aseguradoras.length === 0) aseguradoras = ['atm'];

    await saveMetadata(proceso_id, {
      estado: 'en curso',
      fecha_inicio: new Date().toISOString(),
      archivo: relPath,
      limite,
      aseguradoras,
      registros_procesados: 0,
      cotizaciones_exitosas: 0,
      cotizaciones_con_error: 0,
    });

    ensureDir(procesoDir(proceso_id));
    ensureDir(path.join(procesoDir(proceso_id), 'evidencias'));

    // leer filas una vez
    const filas = await readFilasFromFile(absPath);

    // ===== FIX: si el combinado viene vacío, cortar con error explícito =====
    if (!Array.isArray(filas) || filas.length === 0) {
      const resumenVacio = {
        id: proceso_id,
        historial_id,
        archivo: relPath.replace(/\\/g, '/'),
        fecha: new Date().toISOString(),
        limite: 0,
        cabecera_id,
        aseguradoras,
        resultados: Object.fromEntries(aseguradoras.map((s) => [s, []])),
        error: 'El archivo combinado no tiene filas parseables (0).',
      };

      fs.writeFileSync(resumenPath(proceso_id), JSON.stringify(resumenVacio, null, 2), 'utf8');
      fs.writeFileSync(path.join(procesoDir(proceso_id), 'resumen.csv'), 'aseguradora,index,ok,operacion,coberturas,error\n', 'utf8');

      await saveMetadata(proceso_id, {
        estado: 'con errores',
        fecha_fin: new Date().toISOString(),
        registros_total: 0,
        registros_procesados: 0,
        cotizaciones_exitosas: 0,
        cotizaciones_con_error: 0,
        cotizaciones_skipped: 0,
      });

      return res.status(400).json({
        ok: false,
        error: 'El archivo combinado no tiene filas parseables (0). Revisá que el XLSX tenga datos.',
        archivo: absPath,
      });
    }

    // guardar total real (sirve para UI)
    await saveMetadata(proceso_id, { registros_total: filas.length });

    const tomar = Math.min(limite, filas.length);

    const resultadosPorAseg = {};
    let totalOk = 0;
    let totalErr = 0;
    let totalSkipped = 0;

    // Guardar “run header”
    safeWriteJson(path.join(procesoDir(proceso_id), 'run.json'), {
      proceso_id,
      historial_id,
      cabecera_id,
      archivo: relPath.replace(/\\/g, '/'),
      absPath,
      limite: tomar,
      aseguradoras,
      started_at: new Date().toISOString()
    });

    for (const slug of aseguradoras) {
      const { cfg: Aseg, SOAP_URL, SOAP_METHOD, fechaFmt } = await loadAsegConfig(slug);
      const hoy = formatFecha(new Date(), fechaFmt);

      const procesarFila = await initPreprocesador({ slug, cabecera_id });
      const usoDicc = await readUsoDicc(slug);

      const resultados = [];

      for (let i = 0; i < tomar; i++) {
        const fila = filas[i] || {};
        const { fila_preparada, mapeos } = await procesarFila(fila);

        // Merge defensivo: conservar columnas del Excel (ej. CP)
        const fila_final = { ...fila, ...fila_preparada };

        // Si el preprocesador borró CP, restaurar el CP original
        if ((fila_final.CP === '' || fila_final.CP == null) && (fila.CP != null && String(fila.CP).trim() !== '')) {
          fila_final.CP = fila.CP;
        }

        const resp = await cotizarFila({
          proceso_id,
          slug,
          index: i,
          fila: fila_final,
          cabecera,
          hoy_fmt: hoy,
          mapeos,
          Aseg,
          SOAP_URL,
          SOAP_METHOD,
          usoDicc,
        });

        resultados.push({
          index: i,
          fila_preview: {
            infoautocod: fila_preparada.infoautocod ?? fila.infoautocod ?? fila.tau_codia ?? '',
            anio: fila_preparada.anio || fila_preparada.anofab || fila.anio || fila.anofab || '',
            cp: fila_preparada.cp || fila_preparada.codigo_postal || fila.codigo_postal || fila.cp || '',
            uso_origen: fila.uso || fila.Uso || '',
          },
          mapeos,
          ...resp,
        });

        if (resp && resp.skipped) {
          totalSkipped++;
        } else if (resp && resp.ok) {
          totalOk++;
        } else {
          totalErr++;
        }

        // evidencia “resumen” por fila (rápido de leer)
        safeWriteJson(path.join(evidenciasDir(proceso_id, slug, i), 'atm-result.json'), {
          ok: resp.ok,
          operacion: resp.operacion ?? null,
          coberturas_len: Array.isArray(resp.coberturas) ? resp.coberturas.length : 0,
          error: resp.error || null,
          used: resp.used || null,
        });

        await saveMetadata(proceso_id, {
          registros_procesados: i + 1,
          cotizaciones_exitosas: totalOk,
          cotizaciones_con_error: totalErr,
          cotizaciones_skipped: totalSkipped,
        });
      }

      resultadosPorAseg[slug] = resultados;
    }

    const resumen = {
      id: proceso_id,
      historial_id,
      archivo: relPath.replace(/\\/g, '/'),
      fecha: new Date().toISOString(),
      limite: tomar,
      cabecera_id,
      aseguradoras,
      resultados: resultadosPorAseg,
    };

    fs.writeFileSync(resumenPath(proceso_id), JSON.stringify(resumen, null, 2), 'utf8');

    const head = 'aseguradora,index,ok,operacion,coberturas,error';
    const lines = [];
    for (const slug of Object.keys(resultadosPorAseg)) {
      for (const r of resultadosPorAseg[slug]) {
        lines.push(
          [
            slug,
            r.index,
            r.ok ? 1 : 0,
            r.operacion ?? '',
            Array.isArray(r.coberturas) ? r.coberturas.length : 0,
            (r.error || '').replace(/[\r\n,]+/g, ' '),
          ].join(',')
        );
      }
    }
    fs.writeFileSync(path.join(procesoDir(proceso_id), 'resumen.csv'), [head, ...lines].join('\n'));

    const estadoFinalMeta = totalErr > 0 ? 'con errores' : 'completado';

    await saveMetadata(proceso_id, {
      estado: estadoFinalMeta,
      fecha_fin: new Date().toISOString(),
      registros_procesados: tomar,
      cotizaciones_exitosas: totalOk,
      cotizaciones_con_error: totalErr,
      cotizaciones_skipped: totalSkipped,
    });

    // Persistir estado final en DB (para la tabla de "Procesos de Cotización")
    try {
      await db.execute(
        `UPDATE procesos_cotizacion
         SET estado = ?, fecha_fin = NOW(),
             registros_procesados = ?, cotizaciones_exitosas = ?, cotizaciones_con_error = ?
         WHERE id = ?`,
        [estadoFinalMeta, tomar, totalOk, totalErr, proceso_id]
      );
    } catch (e) {
      console.warn('No se pudo actualizar procesos_cotizacion', e?.message || e);
    }

    // marcar fin de run
    safeWriteJson(path.join(procesoDir(proceso_id), 'run_end.json'), {
      proceso_id,
      finished_at: new Date().toISOString(),
      estado: estadoFinalMeta,
      total_filas_intentadas: tomar,
      cotizaciones_exitosas: totalOk,
      cotizaciones_con_error: totalErr,
      cotizaciones_skipped: totalSkipped,
    });

    return res.status(200).json({
      ok: true,
      proceso_id,
      historial_id,
      cabecera_id,
      aseguradoras,
      total_filas_intentadas: tomar,
      cotizaciones_exitosas: totalOk,
      cotizaciones_con_error: totalErr,
      cotizaciones_skipped: totalSkipped,
      carpeta: `data/procesos/proceso-${proceso_id}/`,
      resumen,
    });
  } catch (err) {
    console.error('Error en /proceso/ejecutar/:id', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/listar
// =============================================================================
router.get('/listar', async (req, res) => {
  try {
    const base = procesosRoot();
    ensureDir(base);

    const items = [];
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (!/^proceso-\d+$/.test(ent.name)) continue;
      const id = Number(ent.name.split('-')[1]);

      const metaP = metadataPath(id);
      if (!fs.existsSync(metaP)) continue;

      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(metaP, 'utf8'));
      } catch {
        continue;
      }

      items.push({
        id: meta.id,
        nombre: meta.nombre || `Proceso ${meta.id}`,
        estado: meta.estado || '',
        fecha_creacion: meta.fecha_creacion || null,
        fecha_inicio: meta.fecha_inicio || null,
        fecha_fin: meta.fecha_fin || null,
        historial_id: meta.historial_id || null,
        archivo: meta.archivo || null,
        cabecera_id: meta.cabecera_id || null,
        aseguradoras: meta.aseguradoras || [],
        limite: meta.limite || null,
        registros_total: meta.registros_total ?? null,
        registros_procesados: meta.registros_procesados ?? 0,
        cotizaciones_exitosas: meta.cotizaciones_exitosas ?? 0,
        cotizaciones_con_error: meta.cotizaciones_con_error ?? 0,
        cotizaciones_skipped: meta.cotizaciones_skipped ?? 0,
        carpeta: `data/procesos/proceso-${meta.id}/`,
      });
    }

// Orden: más recientes primero (fecha_inicio DESC). Fallback: id DESC.
items.sort((a, b) => {
  const ta = Date.parse(a?.fecha_inicio || '') || 0;
  const tb = Date.parse(b?.fecha_inicio || '') || 0;
  if (tb !== ta) return tb - ta;
  return (Number(b?.id) || 0) - (Number(a?.id) || 0);
});
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/excel/:id
// Descarga Excel con: (vehículo + cabecera + cotizaciones) + hojas Errores/Skipped
// =============================================================================
router.get('/excel/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const dlDir = path.join(procesoDir(id), 'descargas');
    const outAbs = path.join(dlDir, `proceso-${id}-cotizaciones.xlsx`);

    if (!fs.existsSync(outAbs)) {
      await generarExcelProceso(id);
    }

    if (!fs.existsSync(outAbs)) {
      return res.status(404).json({ ok: false, error: 'No se pudo generar el Excel' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.download(outAbs, `proceso-${id}-cotizaciones.xlsx`);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================================================================
// GET /proceso/estado/:id
// =============================================================================
router.get('/estado/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const meta = await loadMetadata(id);
    if (!meta) return res.status(404).json({ ok: false, error: 'No existe el proceso' });

    let resumen = null;
    const rp = resumenPath(id);
    if (fs.existsSync(rp)) {
      try {
        resumen = JSON.parse(fs.readFileSync(rp, 'utf8'));
      } catch {}
    }

    res.json({ ok: true, metadata: meta, resumen });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Compat: GET /proceso/:id
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rp = resumenPath(id);
    if (!fs.existsSync(rp)) return res.status(404).json({ ok: false, error: 'No existe el proceso' });
    const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
    res.json(j);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;


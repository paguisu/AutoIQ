// backend/routes/proceso.js
console.log('[proceso.js] running from:', __filename);

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
    'SELECT id, nombre_archivo, ruta, fecha, cantidad_registros FROM historial_combinaciones WHERE id = ? LIMIT 1',
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

  // 2) Parsear la hoja elegida
  let ws = wb.Sheets[best];
  filas = xlsx.utils.sheet_to_json(ws, { defval: '' });

  // 3) Si quedó vacío, intentar otras hojas
  if (!filas || filas.length === 0) {
    for (const name of sheetNames) {
      if (name === best) continue;
      ws = wb.Sheets[name];
      const f = xlsx.utils.sheet_to_json(ws, { defval: '' });
      if (f && f.length > 0) {
        filas = f;
        break;
      }
    }
  }

  return filas || [];
}

// =============================================================================
// Cotizador SOAP genérico (ATM) con retries + logging raw
// =============================================================================
async function cotizarFila({ proceso_id, fila, cabecera, hoy_fmt, mapeos, Aseg, SOAP_URL, SOAP_METHOD, usoDicc }) {
  const user = (Aseg && (Aseg.usuario || Aseg.USER || Aseg.user)) || process.env.ATM_USER;
  const pass = (Aseg && (Aseg.password || Aseg.PASS || Aseg.pass)) || process.env.ATM_PASS;

  const docTipo = pick([cabecera.tipo_documento, cabecera.doc_tipo, cabecera.tipoDoc, 'DNI']);
  const docNro = pick([cabecera.documento, cabecera.doc_nro, cabecera.doc, cabecera.dni, '00000000']);
  const sexo = pick([cabecera.sexo, cabecera.genero, 'M']);
  const nac = pick([cabecera.fecha_nacimiento, cabecera.nacimiento, cabecera.fec_nac, fmt_ddmmAAAA(new Date(1990, 0, 1))]);
  const email = pick([cabecera.email, cabecera.mail, 'test@autoiq.local']);
  const tel = pick([cabecera.telefono, cabecera.tel, '5491100000000']);

  const pat = pick([fila.patente, fila.Patente, fila.dominio, fila.Dominio, fila.pat, 'AA000AA']);
  const cp = pick([fila.CP, fila.cp, fila.codigo_postal, fila.Codigo_Postal, fila.codpos, fila.cod_postal]);

  // InfoAuto: aceptar varias columnas posibles
  const codInfoAuto = pick([fila.codigo_infoauto, fila.cod_infoauto, fila.infoautocod, fila.tau_codia]);

  const anio = pick([fila.anio, fila.anofab, fila.ANIO, fila.ANO, fila['Año'], fila['anio_fabricacion']]);

  // Uso puede venir textual y lo mapeamos con diccionario
  const usoTxt = pick([fila.uso, fila.Uso, fila.uso_vehiculo, fila.UsoVehiculo]);
  const usoCod = (() => {
    if (!usoTxt) return pick([fila.uso_cod, fila.usoCod, fila.uso_codigo]);
    const raw = String(usoTxt).trim();
    if (/^\d+$/.test(raw)) return raw;
    const key = raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return usoDicc?.[key] || pick([fila.uso_cod, fila.usoCod, fila.uso_codigo]);
  })();

  const seccionVehiculo = (() => {
    const join = Object.values(fila || {}).join(' ').toLowerCase();
    if (/\bmoto(s)?\b/.test(join)) return '4';
    return '3';
  })();

  // Construcción XML: ATM - AUTOS_Cotizar_PHP
  const sa = `urn:ws#${SOAP_METHOD}`;
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ws">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:${SOAP_METHOD}>
      <user>${user || ''}</user>
      <pass>${pass || ''}</pass>

      <cod_infoauto>${codInfoAuto || ''}</cod_infoauto>
      <anio>${anio || ''}</anio>
      <patente>${pat || ''}</patente>
      <cp>${cp || ''}</cp>
      <uso>${usoCod || ''}</uso>
      <seccion>${seccionVehiculo || ''}</seccion>

      <fecha>${hoy_fmt}</fecha>

      <doc_tipo>${docTipo}</doc_tipo>
      <doc_nro>${docNro}</doc_nro>
      <sexo>${sexo}</sexo>
      <fec_nac>${nac}</fec_nac>
      <email>${email}</email>
      <telefono>${tel}</telefono>
    </urn:${SOAP_METHOD}>
  </soapenv:Body>
</soapenv:Envelope>`;

  // logging last request
  try {
    fs.writeFileSync(path.join(procesoDir(proceso_id), 'last_soap_request_atm.xml'), soapEnvelope, 'utf8');
  } catch {}

  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
    SOAPAction: sa,
  };

  let rawResp = '';
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await axios.post(SOAP_URL, soapEnvelope, { headers, timeout: 20000, validateStatus: () => true });
      rawResp = resp.data;

      if (resp.status >= 200 && resp.status < 300) {
        const parser = new XMLParser({ ignoreAttributes: false });
        const json = parser.parse(String(resp.data || ''));

        const body =
          json?.['soapenv:Envelope']?.['soapenv:Body'] ||
          json?.['SOAP-ENV:Envelope']?.['SOAP-ENV:Body'] ||
          json?.Envelope?.Body ||
          json?.['soap:Envelope']?.['soap:Body'];

        const node = body?.[`${SOAP_METHOD}Response`] || body?.[`${SOAP_METHOD}Result`] || body?.return || body;

        const ok = !!node && !String(rawResp).toLowerCase().includes('fault');

        const operacion = pick([node?.operacion, node?.Operacion, node?.op, node?.Op]);
        const error = pick([node?.error, node?.Error, node?.mensaje, node?.Mensaje]);

        let coberturas = [];
        try {
          const c = node?.coberturas || node?.Coberturas || node?.cobertura || node?.Cobertura;
          if (Array.isArray(c)) coberturas = c;
          else if (c) coberturas = [c];
        } catch {}

        return {
          ok: ok && !error,
          operacion: operacion || null,
          coberturas,
          error: error || null,
          used: { soapAction: sa },
          raw: rawResp,
        };
      }

      lastErr = `HTTP ${resp.status}`;
    } catch (e) {
      lastErr = e.message || 'axios error';
    }
  }

  return { ok: false, error: lastErr, raw: rawResp };
}

// ===== Config y helpers por aseguradora (dinámico) =====
function asegPath(slug) {
  return path.join(process.cwd(), 'data', slug);
}
async function loadAsegConfig(slug) {
  const cfgPath = path.join(asegPath(slug), 'aseguradora.json');
  const j = await readJsonStrict(cfgPath);
  if (!j.base_url || !j.soap_path) throw new Error(`Config ${slug}: faltan base_url o soap_path`);
  const method = j.soap_method || j.SOAP_METHOD || 'AUTOS_Cotizar_PHP';
  const url = `${j.base_url.replace(/\/+$/, '')}${j.soap_path}`;
  const formato =
    (j.parametros_extras && j.parametros_extras.formato_fecha_request) ||
    process.env.ATM_DATE_FMT ||
    'ddMMyyyy';
  return { cfg: j, SOAP_URL: url, SOAP_METHOD: method, fechaFmt: formato };
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

    // Crear proceso en DB para que aparezca en "Procesos en curso"
    const nombreProceso = nombre || `Proceso (historial ${historial_id})`;
    const nombreCabecera = cabecera?.nombre || cabecera?.nombre_cabecera || cabecera?.nombre_publico || `Cabecera ${cabecera_id}`;

    let proceso_id = null;
    try {
      const [ins] = await db.execute(
        'INSERT INTO procesos_cotizacion (nombre, cabecera_id, nombre_cabecera, estado, fecha_inicio) VALUES (?, ?, ?, ?, NOW())',
        [nombreProceso, cabecera_id, nombreCabecera || null, 'creado']
      );
      proceso_id = ins.insertId;
    } catch (e) {
      const [ins2] = await db.execute('INSERT INTO procesos_cotizacion (nombre, estado, fecha_inicio) VALUES (?, ?, NOW())', [
        nombreProceso,
        'creado',
      ]);
      proceso_id = ins2.insertId;
    }

    ensureDir(procesosRoot());
    ensureDir(procesoDir(proceso_id));

    const meta = {
      id: proceso_id,
      nombre: nombreProceso,
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

    // Si existe metadata pero no hay registro en procesos_cotizacion, insertarlo para que aparezca en "Procesos en Curso"
    if (meta && meta.id) {
      try {
        const [rowsProc] = await db.execute('SELECT id FROM procesos_cotizacion WHERE id = ? LIMIT 1', [Number(meta.id)]);
        if (!rowsProc || rowsProc.length === 0) {
          const nombreProc = meta.nombre || `Proceso ${meta.id}`;
          const cabId = meta.cabecera_id ? Number(meta.cabecera_id) : null;

          // Intentar insertar con el mismo ID (para mantener consistencia con metadata/carpeta)
          try {
            await db.execute(
              'INSERT INTO procesos_cotizacion (id, nombre, cabecera_id, estado, fecha_inicio) VALUES (?, ?, ?, ?, NOW())',
              [Number(meta.id), nombreProc, cabId, meta.estado || 'en curso']
            );
          } catch (eIns) {
            console.warn('No se pudo insertar procesos_cotizacion con ID explícito (proceso existe en FS pero no en DB).', eIns?.message || eIns);
          }
        }
      } catch (eSel) {
        console.warn('No se pudo verificar/crear proceso en DB', eSel?.message || eSel);
      }
    }

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
          'INSERT INTO procesos_cotizacion (nombre, cabecera_id, estado, fecha_inicio) VALUES (?, ?, ?, NOW())',
          [nombreProceso, cabeceraIdCompat, 'en curso']
        );
        proceso_id = ins.insertId;

        // Guardar nombre de cabecera si existe la columna (defensivo)
        try {
          await db.execute('UPDATE procesos_cotizacion SET nombre_cabecera = ? WHERE id = ?', [nombreCabecera, proceso_id]);
        } catch (_e) {
          // columna puede no existir en algunos esquemas; ignorar
        }
      } catch (e) {
        console.error('Error creando proceso en DB', e);
        return res.status(500).json({ ok: false, error: 'No se pudo crear el proceso en DB' });
      }

      const procesoDirAbs = path.join(process.cwd(), 'data', 'procesos', `proceso-${proceso_id}`);
      await ensureDir(procesoDirAbs);
      const metaPath = path.join(procesoDirAbs, 'metadata.json');

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

    // Reflejar "en curso" en DB
    try {
      await db.execute(
        `UPDATE procesos_cotizacion
         SET estado = ?, fecha_inicio = NOW(), cabecera_id = ?
         WHERE id = ?`,
        ['en curso', cabecera_id, proceso_id]
      );
    } catch (e) {
      // si no existe en DB, ya intentamos crear arriba; no frenamos ejecución
      console.warn('No se pudo actualizar procesos_cotizacion al inicio', e?.message || e);
    }

    ensureDir(procesoDir(proceso_id));

    // leer filas una vez
    const filas = await readFilasFromFile(absPath);

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
      });

      return res.status(400).json({
        ok: false,
        error: 'El archivo combinado no tiene filas parseables (0). Revisá que el XLSX tenga datos.',
        archivo: absPath,
      });
    }

    await saveMetadata(proceso_id, { registros_total: filas.length });

    const tomar = Math.min(limite, filas.length);

    const resultadosPorAseg = {};
    let totalOk = 0;
    let totalErr = 0;

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

        // Si el preprocesador borró codigo_infoauto / cod_infoauto / infoautocod, restaurar del original
        const originalInfoAuto = (fila.codigo_infoauto ?? fila.cod_infoauto ?? fila.infoautocod ?? fila.tau_codia ?? '');
        const finalInfoAuto    = (fila_final.codigo_infoauto ?? fila_final.cod_infoauto ?? fila_final.infoautocod ?? fila_final.tau_codia ?? '');

        if ((finalInfoAuto === '' || finalInfoAuto == null) && (originalInfoAuto != null && String(originalInfoAuto).trim() !== '')) {
          // Preferimos mantener el nombre de columna original del Excel (codigo_infoauto)
          fila_final.codigo_infoauto = fila.codigo_infoauto ?? fila_final.codigo_infoauto;
          fila_final.cod_infoauto    = fila.cod_infoauto ?? fila_final.cod_infoauto;
          fila_final.infoautocod     = fila.infoautocod ?? fila_final.infoautocod;
          fila_final.tau_codia       = fila.tau_codia ?? fila_final.tau_codia;
        }

        const resp = await cotizarFila({
          proceso_id: meta.id,
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

        if (resp.ok) totalOk++;
        else totalErr++;

        try {
          fs.writeFileSync(
            path.join(procesoDir(proceso_id), `last_soap_response_${slug}.xml`),
            String(resp.raw || ''),
            'utf8'
          );
        } catch {}

        await saveMetadata(proceso_id, {
          registros_procesados: i + 1,
          cotizaciones_exitosas: totalOk,
          cotizaciones_con_error: totalErr,
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

    await saveMetadata(proceso_id, {
      estado: totalErr > 0 ? 'con errores' : 'completado',
      fecha_fin: new Date().toISOString(),
      registros_procesados: tomar,
      cotizaciones_exitosas: totalOk,
      cotizaciones_con_error: totalErr,
    });

    // Persistir estado final en DB (para la tabla de "Procesos de Cotización")
    try {
      const estadoFinal = totalErr > 0 ? 'con errores' : 'completado';
      await db.execute(
        `UPDATE procesos_cotizacion
         SET estado = ?, fecha_fin = NOW(),
             registros_procesados = ?, cotizaciones_exitosas = ?, cotizaciones_con_error = ?
         WHERE id = ?`,
        [estadoFinal, tomar, totalOk, totalErr, proceso_id]
      );
    } catch (e) {
      console.warn('No se pudo actualizar procesos_cotizacion', e?.message || e);
    }

    return res.status(200).json({
      ok: true,
      proceso_id,
      historial_id,
      cabecera_id,
      aseguradoras,
      total_filas_intentadas: tomar,
      cotizaciones_exitosas: totalOk,
      cotizaciones_con_error: totalErr,
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
        carpeta: `data/procesos/proceso-${meta.id}/`,
      });
    }

    items.sort((a, b) => b.id - a.id);
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
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

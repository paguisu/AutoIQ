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

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }
function pad2(n){ return String(n).padStart(2,'0'); }
function fmt_ddmmAAAA(d){ const dt = d instanceof Date ? d : new Date(d); return `${pad2(dt.getDate())}${pad2(dt.getMonth()+1)}${dt.getFullYear()}`; }
function pick(a){ for(const v of a){ if(v!=null && String(v).trim()!=='') return String(v).trim(); } return ''; }

async function readJsonStrict(abs){
  const raw = await fsp.readFile(abs,'utf8');
  return JSON.parse(raw);
}

// ===== Cabeceras (JSON local ya usado por tu proyecto) =====
const cabStore = path.join(process.cwd(),'data','cabeceras','cabeceras.json');
function getCabecera(id){
  try{
    const db = JSON.parse(fs.readFileSync(cabStore,'utf8'));
    return (db.items||[]).find(x => x.id === Number(id)) || null;
  }catch{ return null; }
}

// ===== Config y helpers por aseguradora (dinámico) =====
function asegPath(slug){ return path.join(process.cwd(),'data',slug); }
async function loadAsegConfig(slug){
  const cfgPath = path.join(asegPath(slug), 'aseguradora.json');
  const j = await readJsonStrict(cfgPath); // si falta, lanza
  // Validaciones mínimas
  if(!j.base_url || !j.soap_path) throw new Error(`Config ${slug}: faltan base_url o soap_path`);
  const method = j.soap_method || j.SOAP_METHOD || 'AUTOS_Cotizar_PHP'; // nombre de método por defecto técnico
  const url = `${j.base_url.replace(/\/+$/,'')}${j.soap_path}`;
  return { cfg:j, SOAP_URL:url, SOAP_METHOD:method };
}

// ===== Fallbacks menores que NO exponen credenciales =====
function inferSeccionVehiculo(fila){
  const join = Object.values(fila||{}).join(' ').toLowerCase();
  if(/\bmoto(s)?\b/.test(join)) return '4'; // tu convención histórica
  return '3';
}

// ===== Diccionarios de USO (solo por si el preprocesado no retorna uso_codigo) =====
async function readUsoDicc(slug){
  try{
    const p = path.join(asegPath(slug),'diccionarios','uso.json');
    const j = await readJsonStrict(p);
    return j;
  }catch{ return {}; }
}
function mapUsoTextoACodigo(value, DICC){
  if(!value) return '';
  const raw = String(value).trim();
  if(/^\d+$/.test(raw)) return raw;
  const key = raw.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  return DICC[key] || '';
}

// ===== Caller SOAP para una fila =====
async function cotizarFila({ fila, cabecera, hoy_ddmmyyyy, mapeos, Aseg, SOAP_URL, SOAP_METHOD, usoDicc }) {
  const codia = (fila?.infoautocod ?? fila?.tau_codia ?? '').toString().trim();
  const anio  = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const cp    = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]);

  // USO: 1) mapeos.uso_codigo; 2) Excel mapeado; 3) cabecera.uso_default mapeado
  let usoCodigo = '';
  if (mapeos && mapeos.uso_codigo) {
    usoCodigo = String(mapeos.uso_codigo);
  } else {
    const usoExcel = pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso]);
    if(usoExcel) usoCodigo = mapUsoTextoACodigo(usoExcel, usoDicc);
    if(!usoCodigo){
      const maybe = (cabecera?.uso_default || cabecera?.uso || '').toString().trim();
      if(maybe) usoCodigo = mapUsoTextoACodigo(maybe, usoDicc);
    }
  }

  // Sección: 1) mapeos.seccion; 2) cabecera.seccion; 3) inferencia; 4) config.seccion_default; 5) '3'
  const seccion =
    (mapeos && mapeos.seccion && String(mapeos.seccion).trim()) ||
    (cabecera?.seccion && String(cabecera.seccion).trim()) ||
    inferSeccionVehiculo(fila) ||
    (Aseg.seccion_default && String(Aseg.seccion_default).trim()) ||
    '3';

  // Defaults vehículo desde cabecera
  const cerokm  = cabecera?.cerokm === '1' ? '1' : '0';
  const tipo_uso= ['1','2'].includes(String(cabecera?.tipo_uso || '')) ? String(cabecera.tipo_uso) : '1';
  const ajuste  = (cabecera?.ajuste || '').toString().trim();
  const rastreo = cabecera?.rastreo === '1' ? '1' : '0';
  const alarma  = cabecera?.alarma  === '1' ? '1' : '0';
  const gnc     = cabecera?.gnc     === '1' ? '1' : '0';

  let bienXML = `
    <cod_infoauto>${codia}</cod_infoauto>
    <anofab>${anio}</anofab>
    <codpostal>${cp}</codpostal>
    <seccion>${seccion}</seccion>
  `.trim();

  if(usoCodigo) bienXML += `\n    <uso>${usoCodigo}</uso>`;
  if(ajuste)    bienXML += `\n    <ajuste>${ajuste}</ajuste>`;
  bienXML += `\n    <alarma>${alarma}</alarma>`;
  bienXML += `\n    <rastreo>${rastreo}</rastreo>`;
  bienXML += `\n    <cerokm>${cerokm}</cerokm>`;
  bienXML += `\n    <gnc>${gnc}</gnc>`;
  if(seccion === '4' && tipo_uso) bienXML += `\n    <tipo_uso>${tipo_uso}</tipo_uso>`;

  const docIn = `
<auto>
  <usuario>
    <usa>${Aseg.usuario}</usa>
    <pass>${Aseg.password}</pass>
    <fecha>${hoy_ddmmyyyy}</fecha>
    <vendedor>${Aseg.vendedor||''}</vendedor>
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
  </bien>
</auto>`.trim();

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <${SOAP_METHOD} xmlns="http://tempuri.org/">
      <doc_in><![CDATA[${docIn}]]></doc_in>
    </${SOAP_METHOD}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();

  const actions = [
    `http://tempuri.org/${SOAP_METHOD}`,
    `${SOAP_METHOD}`,
    `urn:${SOAP_METHOD}`,
  ];

  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  let lastErr = null, rawResp = null;

  for(const sa of actions){
    try{
      const resp = await axios.post(SOAP_URL, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': sa },
        timeout: 20000, validateStatus: () => true
      });
      rawResp = resp.data;
      if(resp.status>=200 && resp.status<300){
        const parsed = parser.parse(String(rawResp || ''));
        const body = parsed?.['SOAP-ENV:Envelope']?.['SOAP-ENV:Body'] || parsed?.Envelope?.Body;
        const result = body?.['ns1:' + SOAP_METHOD + 'Response']?.['ns1:' + SOAP_METHOD + 'Result']
                    || body?.[SOAP_METHOD + 'Response']?.[SOAP_METHOD + 'Result']
                    || body?.[`${SOAP_METHOD}Response`]?.[`${SOAP_METHOD}Result`];

        let payload = result;
        if(typeof payload === 'string'){ try{ payload = parser.parse(payload); }catch{} }

        const auto = payload?.auto || payload?.doc_out?.auto || payload?.AUTO || null;
        const operacion = auto?.operacion || auto?.Operacion || null;
        const coberturas = Array.isArray(auto?.cotizacion?.cobertura)
          ? auto.cotizacion.cobertura
          : (auto?.cotizacion?.Cobertura ? [].concat(auto.cotizacion.Cobertura) : []);
        return { ok:true, operacion, coberturas, used:{soapAction:sa}, raw:rawResp };
      }
      lastErr = `HTTP ${resp.status}`;
    }catch(e){
      lastErr = e.message || 'axios error';
    }
  }
  return { ok:false, error:lastErr, raw:rawResp };
}

// ===== POST /proceso/ejecutar/:id =====
router.post('/ejecutar/:id', express.json(), async (req, res) => {
  try{
    const id = Number(req.params.id);
    const limiteBody = Number(req.body?.limite);
    const limite = Number.isFinite(limiteBody) ? Math.max(1, Math.min(limiteBody, 100)) : 5;

    const cabeceraId = Number(req.body?.cabecera_id);
    if(!cabeceraId) return res.status(400).json({ ok:false, error:'Falta cabecera_id' });
    const cabecera = getCabecera(cabeceraId);
    if(!cabecera) return res.status(404).json({ ok:false, error:`Cabecera ${cabeceraId} no encontrada` });

    // aseguradora dinámica
    const slug = (req.body?.aseguradora || 'atm').toString().toLowerCase();
    const { cfg: Aseg, SOAP_URL, SOAP_METHOD } = await loadAsegConfig(slug);

    const hoy = fmt_ddmmAAAA(new Date()); // ddmmAAAA

    // 1) histórico -> ruta combinado
    const [rows] = await db.execute(
      'SELECT id, nombre_archivo, ruta, fecha, cantidad_registros FROM historial_combinaciones WHERE id = ? LIMIT 1',
      [id]
    );
    if(!rows || rows.length===0) return res.status(404).json({ ok:false, error:`No existe histórico id=${id}` });
    const item = rows[0];
    const relPath = item.ruta && item.ruta.trim() ? item.ruta : path.join('data','combinados', item.nombre_archivo);
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);
    if(!fs.existsSync(absPath)) return res.status(400).json({ ok:false, error:`No se encuentra el archivo combinado: ${absPath}` });

    // 2) carpeta proceso
    const procDir = path.join(process.cwd(), 'data', 'procesos', `proceso-${id}`);
    ensureDir(procDir);

    // 3) leer filas
    let filas = [];
    if(absPath.toLowerCase().endsWith('.csv')){
      const csv = fs.readFileSync(absPath, 'utf8');
      const lines = csv.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(',').map(s=>s.trim());
      for(const ln of lines){
        const cols = ln.split(',');
        const obj = {}; headers.forEach((h,i)=>obj[h]=cols[i]??'');
        filas.push(obj);
      }
    } else {
      const wb = xlsx.readFile(absPath);
      const hoja = wb.SheetNames.find(n => xlsx.utils.sheet_to_json(wb.Sheets[n], {defval:''}).length>0) || wb.SheetNames[0];
      filas = xlsx.utils.sheet_to_json(wb.Sheets[hoja], {defval:''});
    }

    // 4) preprocesador una vez por corrida con el slug dinámico
    const procesarFila = await initPreprocesador({ slug, cabecera_id: cabeceraId });
    const usoDicc = await readUsoDicc(slug);

    const tomar = Math.min(limite, filas.length);
    const resultados = [];
    for(let i=0;i<tomar;i++){
      const fila = filas[i] || {};

      const { fila_preparada, mapeos } = await procesarFila(fila);

      const resp = await cotizarFila({
        fila: fila_preparada,
        cabecera,
        hoy_ddmmyyyy: hoy,
        mapeos,
        Aseg,
        SOAP_URL,
        SOAP_METHOD,
        usoDicc
      });

      resultados.push({
        index:i,
        fila_preview: {
          infoautocod: fila_preparada.infoautocod ?? fila.infoautocod ?? fila.tau_codia ?? '',
          anio: fila_preparada.anio || fila_preparada.anofab || fila.anio || fila.anofab || '',
          cp: fila_preparada.cp || fila_preparada.codigo_postal || fila.codigo_postal || fila.cp || '',
          uso_origen: fila.uso || fila.Uso || ''
        },
        mapeos,
        ...resp
      });

      try{ fs.writeFileSync(path.join(procDir, 'last_soap_response.xml'), String(resp.raw || ''), 'utf8'); }catch{}
    }

    const resumen = {
      id,
      archivo: relPath.replace(/\\/g,'/'),
      fecha: new Date().toISOString(),
      limite: tomar,
      cabecera_id: cabeceraId,
      aseguradora: slug,
      resultados
    };
    fs.writeFileSync(path.join(procDir, 'resumen.json'), JSON.stringify(resumen, null, 2), 'utf8');

    const head = 'index,ok,operacion,coberturas,error';
    const lines = resultados.map(r =>
      [r.index, r.ok ? 1:0, r.operacion ?? '', Array.isArray(r.coberturas)?r.coberturas.length:0, (r.error||'').replace(/[\r\n,]+/g,' ')].join(',')
    );
    fs.writeFileSync(path.join(procDir, 'resumen.csv'), [head, ...lines].join('\n'), 'utf8');

    return res.status(200).json({ ok:true, proceso:`proceso-${id}`, total: tomar, cabecera_id:cabeceraId, aseguradora:slug, resultados });
  }catch(err){
    console.error('Error en /proceso/ejecutar/:id', err);
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

// ===== GET /proceso/listar =====
router.get('/listar', async (_req, res) => {
  try{
    const base = path.join(process.cwd(), 'data', 'procesos');
    ensureDir(base);
    const items = [];

    for(const name of fs.readdirSync(base, { withFileTypes: true })){
      if(!name.isDirectory()) continue;
      if(!/^proceso-\d+$/.test(name.name)) continue;
      const id = Number(name.name.split('-')[1]);
      const resumenPath = path.join(base, name.name, 'resumen.json');
      if(!fs.existsSync(resumenPath)) continue;

      try{
        const j = JSON.parse(fs.readFileSync(resumenPath, 'utf8'));
        const okCount = (j.resultados || []).filter(r => r.ok).length;
        const errCount = (j.resultados || []).filter(r => !r.ok).length;
        items.push({
          id,
          carpeta: `data/procesos/${name.name}/`,
          archivo: j.archivo,
          fecha: j.fecha,
          intentados: j.limite,
          ok: okCount,
          error: errCount,
          cabecera_id: j.cabecera_id ?? null,
          aseguradora: j.aseguradora || 'atm'
        });
      }catch{}
    }

    items.sort((a,b)=> b.id - a.id);
    res.json(items);
  }catch(err){
    res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

router.get('/:id', async (req, res) => {
  try{
    const id = Number(req.params.id);
    const resumenPath = path.join(process.cwd(), 'data', 'procesos', `proceso-${id}`, 'resumen.json');
    if(!fs.existsSync(resumenPath)) return res.status(404).json({ ok:false, error:'No existe el proceso' });
    const j = JSON.parse(fs.readFileSync(resumenPath, 'utf8'));
    res.json(j);
  }catch(err){
    res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

module.exports = router;

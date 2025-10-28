// backend/routes/proceso.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../config/db');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }
function pad2(n){ return String(n).padStart(2,'0'); }
function fmt_ddmmAAAA(d){ const dt = d instanceof Date ? d : new Date(d); return `${pad2(dt.getDate())}${pad2(dt.getMonth()+1)}${dt.getFullYear()}`; }
function pick(a){ for(const v of a){ if(v!=null && String(v).trim()!=='') return String(v).trim(); } return ''; }
function readJSONSafe(p, fb){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return fb; } }

// ===== Config de aseguradora ACTIVA =====
// Hoy seguimos con ATM, pero si mañana querés usar SMG, cambiás esta ruta a:
//   data/smg/aseguradora.json
const asegCfgPath = path.join(process.cwd(), 'data', 'atm', 'aseguradora.json');
ensureDir(path.dirname(asegCfgPath));
const Aseg = readJSONSafe(asegCfgPath, {
  base_url: "https://wsatm.atmseguros.com.ar",
  soap_path: "/index.php/soap",
  usuario: "PNONCECOM",
  password: "s91101",
  vendedor: "0067804766",
  origen: "WS",
  seccion_default: "3",
  plan: "01",
  contacto_tecnico: "",
  contacto_comercial: "",
  date_format: "ddmmAAAA",
  // opcional: id: "atm"
});
const SOAP_URL = `${Aseg.base_url.replace(/\/+$/,'')}${Aseg.soap_path}`;
const SOAP_METHOD = 'AUTOS_Cotizar_PHP';

// ===== Cabeceras =====
const cabStore = path.join(process.cwd(),'data','cabeceras','cabeceras.json');
function getCabecera(id){
  const db = readJSONSafe(cabStore,{seq:0,items:[]});
  return db.items.find(x => x.id === Number(id)) || null;
}

// ===== Diccionarios por aseguradora =====
// Se ubican RELATIVO a la carpeta donde está aseguradora.json (atm/smg/lo-que-sea)
const asegDir = path.dirname(asegCfgPath);
const usoDiccPath = path.join(asegDir, 'diccionarios', 'uso.json');
ensureDir(path.dirname(usoDiccPath));
const USO_DICC = readJSONSafe(usoDiccPath, {
  // Ejemplos ATM; cada aseguradora tendrá su propio archivo
  "particular": "4263",
  "comercial":  "4261",
  "taxi":       "4262"
});
function mapUsoTextoACodigo(value){
  if(!value) return '';
  const raw = String(value).trim();
  // si ya parece código (todo dígitos), devolverlo
  if(/^\d+$/.test(raw)) return raw;
  const key = raw.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  return USO_DICC[key] || '';
}

// ===== Inferencia de sección (3=auto, 4=moto) =====
function inferSeccion(fila){
  const join = Object.values(fila||{}).join(' ').toLowerCase();
  if(/\bmoto(s)?\b/.test(join)) return '4';
  return '3';
}

// ===== Caller SOAP para una fila =====
async function cotizarFila({ fila, cabecera, hoy_ddmmyyyy }) {
  const codia = (fila?.infoautocod ?? '').toString().trim();
  const anio  = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const cp    = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, fila?.CodigoPostal]);

  // USO (reglas: Excel código → OK; Excel texto → diccionario; sino → cabecera.uso_default)
  let usoCodigo = '';
  const usoExcel = pick([fila?.uso, fila?.Uso, fila?.tipo_uso, fila?.TipoUso]);
  if(usoExcel) usoCodigo = mapUsoTextoACodigo(usoExcel);
  if(!usoCodigo){
    const maybe = (cabecera?.uso_default || '').trim();
    if(maybe) usoCodigo = mapUsoTextoACodigo(maybe);
  }

  // Sección (prioridad cabecera → inferir → default config)
  const seccion =
    (cabecera?.seccion && String(cabecera.seccion).trim()) ||
    inferSeccion(fila) ||
    Aseg.seccion_default ||
    '3';

  // Datos de vehículo desde cabecera (defaults que pediste)
  const cerokm  = cabecera?.cerokm === '1' ? '1' : '0';
  const tipo_uso= ['1','2'].includes(String(cabecera?.tipo_uso || '')) ? String(cabecera.tipo_uso) : '1';
  const ajuste  = (cabecera?.ajuste || '').toString().trim();
  const rastreo = cabecera?.rastreo === '1' ? '1' : '0';
  const alarma  = cabecera?.alarma  === '1' ? '1' : '0';
  const gnc     = cabecera?.gnc     === '1' ? '1' : '0';
  const suma    = (cabecera?.suma || '').toString().trim();
  const sub_cp  = (cabecera?.sub_cp || '').toString().trim();

  // === Construcción doc_in (según tu decisión: NO enviamos marca, modelo, suma, sub_cp, accesorios) ===
  let bienXML = `
    <cod_infoauto>${codia}</cod_infoauto>
    <anofab>${anio}</anofab>
    <codpostal>${cp}</codpostal>
    <seccion>${seccion}</seccion>
  `.trim();

  if(usoCodigo) bienXML += `\n    <uso>${usoCodigo}</uso>`;
  if(ajuste)    bienXML += `\n    <ajuste>${ajuste}</ajuste>`;
  // sub_cp y suma: por ahora no se envían, según tu tabla de decisiones
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
    <vendedor>${Aseg.vendedor}</vendedor>
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
        const result = body?.['ns1:AUTOS_Cotizar_PHPResponse']?.['ns1:AUTOS_Cotizar_PHPResult']
                    || body?.['AUTOS_Cotizar_PHPResponse']?.['AUTOS_Cotizar_PHPResult']
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

    const tomar = Math.min(limite, filas.length);
    const resultados = [];
    for(let i=0;i<tomar;i++){
      const fila = filas[i] || {};
      const resp = await cotizarFila({ fila, cabecera, hoy_ddmmyyyy: hoy });
      resultados.push({
        index:i,
        fila_preview: {
          infoautocod: fila.infoautocod,
          anio: fila.anio || fila.anofab,
          cp: fila.cp || fila.codigo_postal,
          uso_origen: fila.uso || fila.Uso || ''
        },
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
      resultados
    };
    fs.writeFileSync(path.join(procDir, 'resumen.json'), JSON.stringify(resumen, null, 2), 'utf8');

    const head = 'index,ok,operacion,coberturas,error';
    const lines = resultados.map(r =>
      [r.index, r.ok ? 1:0, r.operacion ?? '', Array.isArray(r.coberturas)?r.coberturas.length:0, (r.error||'').replace(/[\r\n,]+/g,' ')].join(',')
    );
    fs.writeFileSync(path.join(procDir, 'resumen.csv'), [head, ...lines].join('\n'), 'utf8');

    return res.status(200).json({ ok:true, proceso:`proceso-${id}`, total: tomar, cabecera_id:cabeceraId, resultados });
  }catch(err){
    console.error('Error en /proceso/ejecutar/:id', err);
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

// ===== GET /proceso/listar =====
router.get('/listar', async (req, res) => {
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
          cabecera_id: j.cabecera_id ?? null
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

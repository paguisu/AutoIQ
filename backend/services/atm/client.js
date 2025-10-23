// backend/services/atm/client.js
const axiosBase = require("axios");
const { parseStringPromise } = require("xml2js");
const fs = require("fs");
const path = require("path");

function pad2(n){return String(n).padStart(2,"0");}
function formatDDMMYYYY(d){const dt=d instanceof Date?d:new Date(d);return `${pad2(dt.getDate())}${pad2(dt.getMonth()+1)}${dt.getFullYear()}`;}
function formatDDMMYYYYSlash(d){const dt=d instanceof Date?d:new Date(d);return `${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${dt.getFullYear()}`;}

function getVigenciaOffsetDays(){const v=Number(process.env.ATM_VIGENCIA_OFFSET_DAYS);return Number.isFinite(v)?v:0;}

function normalizeVigenciaDates(bodyRaw, offsetDays=getVigenciaOffsetDays()){
  const body={...(bodyRaw||{})};
  const base=new Date(); if(offsetDays) base.setDate(base.getDate()+offsetDays);
  const todaySlash=formatDDMMYYYYSlash(base); const todayPlain=formatDDMMYYYY(base);
  const toSlash=(s)=>{
    if(!s) return todaySlash;
    const str=String(s).trim();
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
    if(/^\d{8}$/.test(str)) return `${str.slice(0,2)}/${str.slice(2,4)}/${str.slice(4,8)}`;
    const dt=new Date(str); return isNaN(dt)?todaySlash:formatDDMMYYYYSlash(dt);
  };
  const fields=["Fecha","fecha","VigenciaDesde","FechaDesde","FechaCotizacion","fecha_vigencia"];
  const bodySlash={...body};
  for(const f of fields){ bodySlash[f]=toSlash(bodySlash[f]); }
  const bodyPlain={...bodySlash};
  for(const f of fields){
    const s=bodySlash[f];
    if(s && /^\d{2}\/\d{2}\/\d{4}$/.test(s)) bodyPlain[f]=s.replace(/\//g,"");
    else if(!s) bodyPlain[f]=todayPlain;
  }
  return { bodySlash, bodyPlain };
}

function buildSoapEnvelope(innerXml){
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    ${innerXml}
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function buildAxios({ baseURL }){
  return axiosBase.create({ baseURL, timeout: 30000, validateStatus: ()=>true });
}

async function xmlToJson(xml, pathTags=[]){
  try{
    const parsed=await parseStringPromise(xml,{ explicitArray:false, trim:true });
    const fault=parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"]?.["SOAP-ENV:Fault"];
    if(fault){ const s=(fault?.faultstring||"Fault").toString(); return { ok:false, fault:`Fault/${s}` }; }
    let node=parsed?.["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"];
    for(const t of pathTags){ node=node?.[t]; if(!node) break; }
    return { ok:true, data: node };
  }catch(e){ return { ok:false, fault:e.message||"xml parse error" }; }
}

function pickEnv(){
  const base=(process.env.ATM_BASE_URL || "https://wsatm.atmseguros.com.ar").replace(/\/+$/,"");
  // lista de endpoints candidatos (hay instalaciones con distintos sufijos)
  const endpoints=[
    process.env.ATM_SOAP_URL || `${base}/index.php/soap`,
    `${base}/index.php/soap/auto`,
    `${base}/index.php/soap/au`,
    `${base}/soap`
  ];
  return {
    endpoints,
    ATM_USER: process.env.ATM_USER || "PNONCECOM",
    ATM_PASS: process.env.ATM_PASS || "s91101",
    ATM_VENDEDOR: process.env.ATM_VENDEDOR || "0067804766",
    ATM_SECCION: process.env.ATM_SECCION || "3",
  };
}

// ============== core SOAP with fallbacks ==============
async function postSoapWithFallbacks({ method, innerXmlBuilder }){
  const env=pickEnv();
  const candidates = [];
  for(const url of env.endpoints){
    candidates.push({ url, soapAction: `http://tempuri.org/${method}`, xmlns: "http://tempuri.org/" });
    candidates.push({ url, soapAction: `urn:${method}`,                  xmlns: "urn:" });
    candidates.push({ url, soapAction: "",                               xmlns: "http://tempuri.org/" });
  }
  let lastErr = null;
  for(const cand of candidates){
    try{
      const axios=buildAxios({ baseURL: cand.url });
      const innerXml = innerXmlBuilder(cand.xmlns);
      const envelope=buildSoapEnvelope(innerXml);
      const res=await axios.post("", envelope, {
        headers: { "Content-Type": "text/xml; charset=UTF-8", "SOAPAction": cand.soapAction },
        validateStatus: ()=>true
      });
      const txt=String(res.data||"");
      // si el server devuelve 500 + 'not present', probamos siguiente candidato
      if(res.status===500 && /not present/i.test(txt)){ lastErr = `HTTP 500 not present @ ${cand.url} ${cand.soapAction}`; continue; }
      // si devuelve 404/405 también probamos siguiente
      if(res.status>=400 && res.status!==500){ lastErr = `HTTP ${res.status} @ ${cand.url}`; continue; }
      return { ok:true, res, cand };
    }catch(e){ lastErr = e.message || String(e); }
  }
  return { ok:false, error:lastErr || "No SOAP endpoint matched" };
}

// ============== operaciones ==============
async function cotizarSoapDemo(bodyRaw){
  const env = pickEnv();
  const { bodyPlain } = normalizeVigenciaDates(bodyRaw);
  const usuarioFecha = bodyPlain.Fecha || formatDDMMYYYY(new Date());
  const fechaCot     = bodyPlain.FechaCotizacion || usuarioFecha;
  const vigDesde     = bodyPlain.VigenciaDesde || usuarioFecha;

  const docIn = `
<doc_in>
  <auto>
    <usuario>
      <usa>${env.ATM_USER}</usa>
      <pass>${env.ATM_PASS}</pass>
      <fecha>${usuarioFecha}</fecha>
      <vendedor>${env.ATM_VENDEDOR}</vendedor>
      <origen>WS</origen>
    </usuario>
    <cotizacion>
      <seccion>${(bodyRaw?.Seccion || env.ATM_SECCION).toString()}</seccion>
      <fechacotizacion>${fechaCot}</fechacotizacion>
      <fechavigenciadesde>${vigDesde}</fechavigenciadesde>
    </cotizacion>
    <vehiculo>
      <codia>${bodyRaw?.tau_codia || bodyRaw?.codia || ""}</codia>
      <anio>${bodyRaw?.anio || bodyRaw?.anofab || ""}</anio>
      <cp>${bodyRaw?.codigo_postal || bodyRaw?.codpostal || bodyRaw?.CP || ""}</cp>
      <uso>${bodyRaw?.uso || "Particular"}</uso>
    </vehiculo>
  </auto>
</doc_in>`.trim();

  // debug
  try{ const dbg=path.join(process.cwd(),"data","atm","debug"); fs.mkdirSync(dbg,{recursive:true}); fs.writeFileSync(path.join(dbg,"last_doc_in.xml"),docIn,"utf8"); }catch{}

  const method = "ws_au_cotizar_demo";
  const result = await postSoapWithFallbacks({
    method,
    innerXmlBuilder: (xmlns)=>`
      <${method} xmlns="${xmlns}">
        <doc_in><![CDATA[${docIn}]]></doc_in>
      </${method}>
    `.trim()
  });

  if(!result.ok){
    return { ok:false, error:"ATM SOAP error", raw:{ message: result.error } };
  }

  const { res } = result;
  // SOAP → doc_out string
  const parsed = await xmlToJson(res.data,[`${method}Response`,`${method}Result`]);
  if(!parsed.ok){
    return { ok:false, error:"ATM SOAP error", raw:{ message: parsed.fault || `HTTP ${res.status}` } };
  }
  let root = parsed.data;
  if(typeof root === "string"){
    const inner = await xmlToJson(root, ["auto"]);
    root = inner.ok ? inner.data : {};
  } else {
    root = root?.auto || {};
  }

  const operacion = root?.operacion || root?.Operacion || null;
  const statusSuccess = (root?.statusSuccess || "").toString();
  const statusText = root?.statusText || {};
  const coberturas = Array.isArray(root?.coberturas?.cobertura) ? root.coberturas.cobertura : [];

  return { ok:true, operacion, coberturas, raw:{ operacion, statusSuccess, statusText } };
}

module.exports = {
  formatDDMMYYYY,
  formatDDMMYYYYSlash,
  getVigenciaOffsetDays,
  normalizeVigenciaDates,
  buildSoapEnvelope,
  buildAxios,
  xmlToJson,
  pickEnv,
  cotizarSoapDemo,
};


// backend/routes/cabeceras.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  appendActivity,
  getCurrentAccessContext,
  getUserDisplayName,
  isOwnedByContext,
} = require('../utils/access_control');

const router = express.Router();

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }

const storeDir  = path.join(process.cwd(), 'data', 'cabeceras');
const storeFile = path.join(storeDir, 'cabeceras.json');
ensureDir(storeDir);

function readAll(){
  try {
    const raw = fs.readFileSync(storeFile, 'utf8');
    const json = JSON.parse(raw);
    // Compat: aseguramos estructura mínima
    if(typeof json !== 'object' || json === null) return { seq:0, items:[] };
    if(!Array.isArray(json.items)) json.items = [];
    if(typeof json.seq !== 'number') {
      // Si no hay seq, lo inferimos del mayor id
      const maxId = json.items.reduce((m, x) => Math.max(m, Number(x.id)||0), 0);
      json.seq = maxId;
    }
    return json;
  } catch {
    return { seq:0, items:[] };
  }
}

function writeAll(db){
  // Backup rápido (opción más segura sin agregar complejidad)
  try {
    if(fs.existsSync(storeFile)){
      fs.copyFileSync(storeFile, storeFile.replace(/\.json$/i, '.bak.json'));
    }
  } catch (e) {
    // si falla el backup, igual intentamos escribir
    console.warn('cabeceras:backup:error', e?.message || e);
  }
  fs.writeFileSync(storeFile, JSON.stringify(db, null, 2), 'utf8');
}

const toStr = v => (v ?? '').toString().trim();
function rastreoActivo(b = {}) {
  const raw = toStr(b.rastreo).toUpperCase();
  if (['1', 'S', 'SI', 'CON', 'POSEE', 'A'].includes(raw)) return true;
  return Boolean(toStr(b.rastreo_sistema || b.rastreoSistema));
}

// GET /cabeceras/listar  -> devuelve items
router.get('/listar', (req, res) => {
  const db = readAll();
  const ctx = req.accessContext || getCurrentAccessContext();
  const items = db.items
    .map((item) => ({
      organization_id: item.organization_id || 'autoiq',
      created_by_user_id: item.created_by_user_id || 'superadmin-local',
      created_by_name: item.created_by_name || '',
      ...item,
    }))
    .filter((item) => isOwnedByContext(item, ctx));
  res.json(items);
});

// GET /cabeceras/:id -> detalle
router.get('/:id', (req,res) => {
  const id = Number(req.params.id);
  const db = readAll();
  const cab = db.items.find(x => Number(x.id) === id);
  if(!cab) return res.status(404).json({ ok:false, error:'Cabecera no encontrada' });
  const ctx = req.accessContext || getCurrentAccessContext();
  if (!isOwnedByContext(cab, ctx)) {
    return res.status(403).json({ ok:false, error:'No tenés acceso a esta cabecera' });
  }
  res.json(cab);
});

// POST /cabeceras/crear -> crea nueva cabecera (siempre)
router.post('/crear', express.json(), (req, res) => {
  const b = req.body || {};
  const ctx = req.accessContext || getCurrentAccessContext();

  const cab = {
    id: 0,

    // Identificación
    nombre: toStr(b.nombre) || 'Cabecera sin nombre',

    // Asegurado (campos que ya estaban en tu cabeceras.json)
    tipopersona: toStr(b.tipopersona) || 'F',  // F/J
    iva: toStr(b.iva) || 'CF',
    tipodoc: toStr(b.tipodoc) || 'DNI',
    medio_pago: toStr(b.medio_pago) || 'TC',
    nrodoc: toStr(b.nrodoc),
    apellido: toStr(b.apellido),
    nombre_aseg: toStr(b.nombre_aseg),
    sexo: toStr(b.sexo) || 'M',                // M/F
    fec_nac: toStr(b.fec_nac),                 // yyyymmdd
    est_civil: toStr(b.est_civil),
    provincia: toStr(b.provincia),
    localidad: toStr(b.localidad),
    calle: toStr(b.calle),
    altura: toStr(b.altura),
    cp: toStr(b.cp),
    sub_cp: toStr(b.sub_cp),
    tel_part: toStr(b.tel_part),
    tel_cel: toStr(b.tel_cel),
    mail: toStr(b.mail),

    // Parámetros ATM (general)
    seccion: toStr(b.seccion) || '', // si viene vacío lo puede inferir el proceso
    plan: toStr(b.plan),
    contacto_tecnico: toStr(b.contacto_tecnico),
    contacto_comercial: toStr(b.contacto_comercial),

    // Variables “default / vehículo”
    // Uso: 1=Particular, 2=Comercial
    tipo_uso: ['1','2'].includes(toStr(b.tipo_uso)) ? toStr(b.tipo_uso) : '1',

    // Rastreador
    rastreo: rastreoActivo(b) ? '1' : '0',
    rastreo_sistema: toStr(b.rastreo_sistema || b.rastreoSistema),

    // GNC (ATM) + suma asegurada GNC (nuevo, por ahora solo se persiste)
    gnc: toStr(b.gnc) === '1' ? '1' : '0',
    suma_gnc: toStr(b.suma_gnc),

    // Mantener compat con campos anteriores si vinieran
    alarma: toStr(b.alarma),
    ajuste: toStr(b.ajuste),
    cerokm: toStr(b.cerokm),
    suma: toStr(b.suma),
    uso_default: toStr(b.uso_default),
    accesorios: toStr(b.accesorios),
    organization_id: ctx.currentOrganization?.id || 'autoiq',
    created_by_user_id: ctx.currentUser?.id || 'superadmin-local',
    created_by_name: getUserDisplayName(ctx.currentUser),
    created_at: new Date().toISOString(),
  };

  const db = readAll();
  // id correlativo
  const maxId = db.items.reduce((m, x) => Math.max(m, Number(x.id)||0), 0);
  db.seq = Math.max(Number(db.seq)||0, maxId);
  cab.id = ++db.seq;

  db.items.push(cab);
  writeAll(db);
  appendActivity({
    event: 'cabecera_created',
    entity_type: 'cabecera',
    entity_id: String(cab.id),
    details: {
      nombre: cab.nombre,
      organization_id: cab.organization_id,
    },
  });
  res.json({ ok:true, cabecera:cab });
});

// POST /cabeceras/eliminar/:id
router.post('/eliminar/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readAll();
  const idx = db.items.findIndex(x => Number(x.id) === id);
  if(idx < 0) return res.status(404).json({ ok:false, error:'Cabecera no encontrada' });
  const ctx = req.accessContext || getCurrentAccessContext();
  if (!isOwnedByContext(db.items[idx], ctx)) {
    return res.status(403).json({ ok:false, error:'No tenés acceso a esta cabecera' });
  }
  const [removed] = db.items.splice(idx,1);
  writeAll(db);
  appendActivity({
    event: 'cabecera_deleted',
    entity_type: 'cabecera',
    entity_id: String(removed.id),
    details: { nombre: removed.nombre || '' },
  });
  res.json({ ok:true, removed });
});

module.exports = router;

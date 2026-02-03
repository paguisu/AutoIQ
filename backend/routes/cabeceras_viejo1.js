// backend/routes/cabeceras.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }

const storeDir = path.join(process.cwd(), 'data', 'cabeceras');
const storeFile = path.join(storeDir, 'cabeceras.json');
ensureDir(storeDir);

function readAll(){
  try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')); }
  catch { return { seq:0, items:[] }; }
}
function writeAll(db){ fs.writeFileSync(storeFile, JSON.stringify(db, null, 2), 'utf8'); }

// GET /cabeceras/listar
router.get('/listar', (req, res) => {
  const db = readAll();
  res.json(db.items);
});

// POST /cabeceras/crear
router.post('/crear', express.json(), (req, res) => {
  const b = req.body || {};
  const toStr = v => (v ?? '').toString().trim();

  const cab = {
    id: 0,
    // Identificación
    nombre: toStr(b.nombre) || 'Cabecera sin nombre',

    // Datos asegurado (ya existentes en tu flujo)
    tipopersona: toStr(b.tipopersona) || 'F', // F/J
    iva: toStr(b.iva) || 'CF',
    tipodoc: toStr(b.tipodoc) || 'DNI',
    nrodoc: toStr(b.nrodoc),
    apellido: toStr(b.apellido),
    nombre_aseg: toStr(b.nombre_aseg),
    sexo: toStr(b.sexo) || 'M',
    fec_nac: toStr(b.fec_nac), // yyyymmdd
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

    // Parámetros ATM (generales)
    seccion: toStr(b.seccion) || '', // si viene vacío infiere proceso.js (3=auto/4=moto)
    plan: toStr(b.plan),
    contacto_tecnico: toStr(b.contacto_tecnico),
    contacto_comercial: toStr(b.contacto_comercial),

    // ===== Datos del vehículo (según tu decisión) =====
    // Si no están en Excel, salen de acá:
    cerokm: toStr(b.cerokm) === '1' ? '1' : '0',             // default No
    tipo_uso: ['1','2'].includes(toStr(b.tipo_uso)) ? toStr(b.tipo_uso) : '1', // default Particular (1)
    ajuste: toStr(b.ajuste),                                  // si vacío, no se envía
    rastreo: toStr(b.rastreo) === '1' ? '1' : '0',            // default No
    alarma: toStr(b.alarma) === '1' ? '1' : '0',              // default No
    gnc: toStr(b.gnc) === '1' ? '1' : '0',                    // default No

    // No usamos por ahora, pero dejamos preparado:
    suma: toStr(b.suma),               // si vacío, no se envía
    uso_default: toStr(b.uso_default), // si Excel no trae código de uso y dicc no matchea, podrías setear acá
    accesorios: '0' // bloqueado (siempre No) como pediste
  };

  const db = readAll();
  cab.id = ++db.seq;
  db.items.push(cab);
  writeAll(db);
  res.json({ ok:true, cabecera:cab });
});

// POST /cabeceras/eliminar/:id
router.post('/eliminar/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readAll();
  const idx = db.items.findIndex(x => x.id === id);
  if(idx < 0) return res.status(404).json({ ok:false, error:'Cabecera no encontrada' });
  const [removed] = db.items.splice(idx,1);
  writeAll(db);
  res.json({ ok:true, removed });
});

// GET /cabeceras/:id
router.get('/:id', (req,res) => {
  const id = Number(req.params.id);
  const db = readAll();
  const cab = db.items.find(x => x.id === id);
  if(!cab) return res.status(404).json({ ok:false, error:'Cabecera no encontrada' });
  res.json(cab);
});

module.exports = router;

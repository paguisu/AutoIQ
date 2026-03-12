// backend/routes/preprocesado.js
// Previsualiza el completado de faltantes por fila usando:
// - Cabecera guardada (vía HTTP: GET /cabeceras/:id)
// - Diccionarios JSON en /data/<aseguradora>/diccionarios
//
// POST /preprocesado/preview
// Body: { aseguradora: "atm", cabecera_id?: number, fila: { uso?, tipo_vehiculo?, tau_codia?, anio?, codigo_postal? } }

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { resolveAtmVehicleKind } = require('../utils/atm_tipo_vehiculo');

const router = express.Router();

function dataPath(...p) {
  return path.join(process.cwd(), 'data', ...p);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

function norm(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

// Lee cabecera por HTTP del propio backend
async function getCabeceraByIdHTTP(id) {
  const base = process.env.SELF_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${base}/cabeceras/${id}`);
  if (!res.ok) {
    const txt = await res.text().catch(()=>res.statusText);
    const e = new Error(`cabeceras HTTP ${res.status}: ${txt}`);
    e.code = 'CABECERA_HTTP';
    throw e;
  }
  return await res.json();
}

async function getDiccionarios(slug) {
  const uso = await readJson(dataPath(slug, 'diccionarios', 'uso.json'));
  const tipoVeh = await readJson(dataPath(slug, 'diccionarios', 'tipo_vehiculo.json'));
  return { uso, tipoVeh };
}

async function completarYMapear({ fila, cabecera, dicc, slug }) {
  const fuentes = { uso: 'archivo', tipo_vehiculo: 'archivo' };
  const out = { ...fila };

  // 1) completar uso
  if (!out.uso || norm(out.uso) === 'null') {
    if (cabecera?.uso) {
      out.uso = cabecera.uso;
      fuentes.uso = 'cabecera';
    }
  }

  // 2) completar tipo_vehiculo
  const atmVehicle = slug === 'atm' ? await resolveAtmVehicleKind(out) : null;
  if (atmVehicle?.isMoto === true) {
    out.tipo_vehiculo = 'Moto';
    fuentes.tipo_vehiculo = 'atm_catalogo';
  }

  if (!out.tipo_vehiculo || norm(out.tipo_vehiculo) === 'null') {
    if (cabecera?.tipo_vehiculo) {
      out.tipo_vehiculo = cabecera.tipo_vehiculo;
      fuentes.tipo_vehiculo = 'cabecera';
    }
  }

  // 3) mapeos
  let uso_codigo = null;
  if (out.uso) {
    const key = norm(out.uso);
    if (dicc.uso[key] != null) {
      uso_codigo = dicc.uso[key];
    } else {
      if (key.includes('part')) uso_codigo = dicc.uso['particular'];
      else if (key.includes('tax')) uso_codigo = dicc.uso['taxi'];
      else if (key.includes('comer') || key.includes('trab')) uso_codigo = dicc.uso['comercial'];
    }
  }

  let seccion = null;
  if (atmVehicle?.seccion) {
    seccion = atmVehicle.seccion;
  }

  if (out.tipo_vehiculo) {
    const t = out.tipo_vehiculo.toString();
    if (!seccion && dicc.tipoVeh[t]?.seccion) {
      seccion = dicc.tipoVeh[t].seccion;
    } else {
      const tN = norm(t);
      const match = Object.keys(dicc.tipoVeh).find(k => norm(k) === tN);
      if (!seccion && match && dicc.tipoVeh[match]?.seccion) seccion = dicc.tipoVeh[match].seccion;
      if (!seccion) {
        if (tN.includes('moto') || tN.includes('scooter')) seccion = '1';
        else seccion = '3';
      }
    }
  }

  return {
    fila_original: fila,
    completada: out,
    mapeos: { uso_codigo, seccion },
    fuentes,
    atm_vehicle: atmVehicle,
  };
}

// --------- Endpoint ---------

router.post('/preview', async (req, res) => {
  try {
    const { aseguradora = 'atm', cabecera_id, fila } = req.body || {};
    if (!fila || typeof fila !== 'object') {
      return res.status(400).json({ ok: false, error: 'Body inválido: se espera { cabecera_id?, fila }' });
    }

    const dicc = await getDiccionarios(aseguradora);

    let cabecera = null;
    if (cabecera_id != null) {
      cabecera = await getCabeceraByIdHTTP(cabecera_id); // ← usa HTTP, no SQL
    }

    const result = await completarYMapear({ fila, cabecera, dicc, slug: aseguradora });
    res.json({ ok: true, aseguradora, cabecera_id: cabecera_id ?? null, result });
  } catch (err) {
    console.error('preprocesado:preview', err);
    res.status(500).json({
      ok: false,
      error: 'Fallo en preprocesado',
      detail: String(err && (err.code || err.message || err))
    });
  }
});

module.exports = router;

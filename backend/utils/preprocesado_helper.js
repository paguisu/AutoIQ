// backend/utils/preprocesado_helper.js
const fs = require('fs/promises');
const path = require('path');
const { resolveAtmVehicleKind } = require('./atm_tipo_vehiculo');

function dataPath(...p) {
  return path.join(process.cwd(), 'data', ...p);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

async function readJsonOptional(absPath, fallback) {
  try {
    return await readJson(absPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function norm(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

// Lee cabecera por HTTP del propio backend (evita dependencia directa de DB)
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

async function cargarDiccionarios(slug) {
  const uso = await readJsonOptional(dataPath(slug, 'diccionarios', 'uso.json'), {});
  const tipoVeh = await readJsonOptional(dataPath(slug, 'diccionarios', 'tipo_vehiculo.json'), {});
  return { uso, tipoVeh };
}

async function completarYMapear({ fila, cabecera, dicc, slug }) {
  const fuentes = { uso: 'archivo', tipo_vehiculo: 'archivo' };
  const out = { ...fila };

  // completar uso
  if (!out.uso || norm(out.uso) === 'null') {
    if (cabecera?.uso) {
      out.uso = cabecera.uso;
      fuentes.uso = 'cabecera';
    }
  }

  // Si ATM identifica al código como moto, priorizamos eso para no depender
  // de un umbral numérico frágil.
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

  // mapeo uso → código
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

  // mapeo tipo_vehiculo → seccion
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
    fila_preparada: out,
    mapeos: { uso_codigo, seccion },
    fuentes,
    atm_vehicle: atmVehicle,
  };
}

/** Carga cabecera y diccionarios una sola vez y devuelve una función para procesar filas. */
async function initPreprocesador({ slug = 'atm', cabecera_id = null } = {}) {
  const [cabecera, dicc] = await Promise.all([
    cabecera_id != null ? getCabeceraByIdHTTP(cabecera_id) : null,
    cargarDiccionarios(slug)
  ]);

  return async function procesarFila(fila) {
    const { fila_preparada, mapeos, fuentes, atm_vehicle } = await completarYMapear({ fila, cabecera, dicc, slug });
    return { fila_preparada, mapeos, fuentes, atm_vehicle };
  };
}

module.exports = { initPreprocesador };

// ===============================
// inferirTipoVehiculo.js
// ===============================

const db = require('../config/db');

async function buscarEnBase(infoautocod) {
  const [rows] = await db.execute(
    'SELECT tipo_vehiculo FROM datos_vehiculos_propios WHERE infoautocod = ? LIMIT 1',
    [infoautocod]
  );
  return rows.length > 0 ? rows[0].tipo_vehiculo : null;
}

async function guardarEnBase({ infoautocod, marca, modelo, tipo_vehiculo, fuente }) {
  await db.execute(
    `INSERT INTO datos_vehiculos_propios (infoautocod, marca, modelo, tipo_vehiculo, fuente, fecha_alta)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [infoautocod, marca, modelo, tipo_vehiculo, fuente]
  );
}

async function consultarAPI(infoautocod) {
  // 🔧 Simulación de consulta externa (reemplazar por request real)
  // Ejemplo: const response = await axios.get(`https://api.example.com/vehiculos/${infoautocod}`);
  return null; // De momento devolvemos null
}

function heuristicaInferencia(marca, modelo) {
  const texto = `${marca} ${modelo}`.toLowerCase();
  if (texto.includes("pick")) return "Pick-Up";
  if (texto.includes("suv")) return "SUV";
  if (texto.includes("coupe")) return "Coupé";
  if (texto.includes("furg")) return "Furgón";
  if (texto.includes("camion")) return "Camión";
  return "Sedán";
}

async function inferirTipoVehiculo(infoautocod, marca = '', modelo = '') {
  if (!infoautocod) return "Desconocido";

  // 1. Buscar en base propia
  const tipoBD = await buscarEnBase(infoautocod);
  if (tipoBD) return tipoBD;

  // 2. Consultar API externa (simulada)
  const tipoAPI = await consultarAPI(infoautocod);
  if (tipoAPI) {
    await guardarEnBase({ infoautocod, marca, modelo, tipo_vehiculo: tipoAPI, fuente: 'api' });
    return tipoAPI;
  }

  // 3. Aplicar heurística
  const tipoHeuristico = heuristicaInferencia(marca, modelo);
  await guardarEnBase({ infoautocod, marca, modelo, tipo_vehiculo: tipoHeuristico, fuente: 'heuristica' });
  return tipoHeuristico;
}

module.exports = inferirTipoVehiculo;

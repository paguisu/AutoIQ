const db = require('../config/db');
const axios = require('axios');

function inferenciaHeuristica(row) {
  const modelo = (row.Modelo || '').toLowerCase();
  if (modelo.includes('pickup') || modelo.includes('pick-up') || modelo.includes('4x4') || modelo.includes('hilux') || modelo.includes('amarok') || modelo.includes('ranger')) {
    return 'Pick-Up B';
  }
  if (modelo.includes('suv') || modelo.includes('duster') || modelo.includes('ecosport') || modelo.includes('renegade')) {
    return 'SUV';
  }
  return 'Sedán';
}

function mapearParaRivadavia(tipo) {
  if (!tipo) return null;
  if (['Hatchback', 'Sedán'].includes(tipo)) return 'Sedán';
  if (['SUV', 'Pick-Up A'].includes(tipo)) return 'Pick-Up A';
  return tipo;
}

async function completarTipoVehiculo(row) {
  const cod = row.infoautocod;
  if (!cod) return null;

  console.log('>>> Iniciando inferencia para', {
    infoautocod: row.infoautocod,
    Marca: row.Marca,
    Modelo: row.Modelo,
    anio: row.anio
  });

  const [resultados] = await db.execute(
    'SELECT tipo_vehiculo FROM datos_vehiculos_propios WHERE infoautocod = ?',
    [cod]
  );
  if (resultados.length > 0) return resultados[0].tipo_vehiculo;

  try {
    const anio = row.anio;
    const marca = row.Marca;
    const modelo = row.Modelo;

    const modeloSimplificado = (modelo || '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .split(' ')[0];

    const apiUrl = `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=${anio}&make=${marca}&model=${modeloSimplificado}`;
    const response = await axios.get(apiUrl, { headers: { Accept: 'application/json' } });

    if (response.data && response.data.menuItem && response.data.menuItem.length > 0) {
      const opciones = response.data.menuItem;
      const vehId = opciones[0].value;
      const text = opciones[0].text;

      const tipoInferido = text.includes('SUV') ? 'SUV'
        : text.includes('Pickup') ? 'Pick-Up B'
        : text.includes('Van') ? 'Furgón'
        : text.includes('Wagon') ? 'Rural'
        : text.includes('Coupe') ? 'Coupé'
        : 'Sedán';

      const tipoRivadavia = mapearParaRivadavia(tipoInferido);

      const detailUrl = `https://www.fueleconomy.gov/ws/rest/vehicle/${vehId}`;
      const detailResponse = await axios.get(detailUrl, { headers: { Accept: 'application/json' } });
      const info = detailResponse.data;

      console.log('>>> API externa OK. Guardando en base:', {
        infoautocod: cod,
        tipoInferido,
        tipoRivadavia,
        puertas: info.trany,
        ocupantes: info.passengers,
        peso: info.lv2 || info.lv4,
        combustible: info.fuelType,
        motorizacion: info.displ
      });

      await db.execute(
        'INSERT INTO datos_vehiculos_propios (infoautocod, Marca, Modelo, tipo_vehiculo, Tipo_Vehiculo_Rivadavia, puertas, ocupantes, peso, combustible, motorizacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          cod,
          marca,
          modelo,
          tipoInferido,
          tipoRivadavia,
          parseInt(info.trany?.match(/\d/)) || null,
          parseInt(info.passengers) || null,
          parseInt(info.lv2 || info.lv4) || null,
          info.fuelType || null,
          info.displ ? `${info.displ}L` : null
        ]
      );
      return tipoInferido;
    } else {
      console.warn('>>> API no devolvió resultados válidos para', { apiUrl });
    }
  } catch (err) {
    console.error('>>> Falla API externa:', {
      infoautocod: cod,
      anio: row.anio,
      marca: row.Marca,
      modelo: row.Modelo,
      error: err.message
    });
  }

  const tipoHeuristico = inferenciaHeuristica(row);
  const tipoRivadavia = mapearParaRivadavia(tipoHeuristico);
  console.log('>>> Aplicando heurística:', tipoHeuristico);
  await db.execute(
    'INSERT INTO datos_vehiculos_propios (infoautocod, Marca, Modelo, tipo_vehiculo, Tipo_Vehiculo_Rivadavia) VALUES (?, ?, ?, ?, ?)',
    [cod, row.Marca, row.Modelo, tipoHeuristico, tipoRivadavia]
  );
  return tipoHeuristico;
}

module.exports = completarTipoVehiculo;
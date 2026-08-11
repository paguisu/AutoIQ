const fs = require('fs');
const path = require('path');
const {
  buildRivadaviaSoapPayload,
  parseRivadaviaSoapQuoteResponse,
} = require('../backend/services/rivadavia/quote');
const { rivadaviaSoapPost } = require('../backend/services/rivadavia/client');

const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/rivadavia/aseguradora.json'), 'utf8'));
const vehicles = [
  { codigo_infoauto: '60450', anio: 2019, suma_asegurada: 30000000, label: 'Audi A1' },
  { codigo_infoauto: '450309', anio: 2025, suma_asegurada: 24750000, label: 'Auto 450309' },
];
const zones = [
  { cp: '1605', localidad: 'MUNRO', zona: 'Norte' },
  { cp: '1638', localidad: 'VICENTE LOPEZ', zona: 'Norte' },
  { cp: '1648', localidad: 'TIGRE', zona: 'Norte' },
  { cp: '1617', localidad: 'GENERAL PACHECO', zona: 'Norte' },
  { cp: '1014', localidad: 'CAPITAL FEDERAL', zona: 'Control CABA', provincia: 'CAPITAL FEDERAL' },
  { cp: '1712', localidad: 'CASTELAR', zona: 'Control Oeste' },
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function quote(vehicle, zone, coefficient) {
  const fila = {
    ...vehicle,
    CP: zone.cp,
    localidad: zone.localidad,
    provincia: zone.provincia || 'BUENOS AIRES',
    uso: 'Particular',
    rivadavia_coef_rc: String(coefficient),
    rivadavia_coef_casco: String(coefficient),
  };
  const cabecera = {
    tipo_uso: '1',
    uso: 'Particular',
    ajuste: '30',
    gnc: '0',
    rastreo: 'Sin Rastreador/Alarma',
    iva: 'CF',
    medio_pago: 'TC',
  };
  const built = await buildRivadaviaSoapPayload({
    fila,
    cabecera,
    cfg,
    mapeos: { uso_codigo: '1' },
    today: new Date(),
    overrideTipoVehiculo: '1',
    overrideTipoUso: '1',
    attemptSource: 'controlled_test',
  });
  const { resp } = await rivadaviaSoapPost(cfg, built.envelope);
  if (!(resp.status >= 200 && resp.status < 300)) throw new Error(`HTTP ${resp.status}`);
  const parsed = parseRivadaviaSoapQuoteResponse(resp.data, cfg, built.requestMeta);
  if (!parsed.ok) throw new Error(parsed.error || 'Respuesta sin coberturas');
  return {
    vehicle: vehicle.label,
    codigo_infoauto: vehicle.codigo_infoauto,
    anio: vehicle.anio,
    zona: zone.zona,
    cp: zone.cp,
    localidad: zone.localidad,
    coefficient,
    suma_asegurada: built.requestMeta.sumaAsegurada,
    tipo_vehiculo: built.requestMeta.descripcionTipoVehiculo,
    products: parsed.coberturas.map((item) => ({
      plan: item.plan,
      premio_mensual: Number(item.premioMensual),
    })),
  };
}

async function main() {
  const results = [];
  for (const vehicle of vehicles) {
    for (const zone of zones) {
      for (const coefficient of [1, 0.9]) {
        results.push(await quote(vehicle, zone, coefficient));
        await sleep(1000);
      }
    }
  }
  const comparisons = [];
  for (const vehicle of vehicles) {
    for (const zone of zones) {
      const base = results.find((x) => x.codigo_infoauto === vehicle.codigo_infoauto && x.cp === zone.cp && x.coefficient === 1);
      const discounted = results.find((x) => x.codigo_infoauto === vehicle.codigo_infoauto && x.cp === zone.cp && x.coefficient === 0.9);
      const discountedByPlan = new Map(discounted.products.map((x) => [x.plan, x.premio_mensual]));
      for (const item of base.products) {
        const price09 = discountedByPlan.get(item.plan);
        if (!price09 || !item.premio_mensual) continue;
        comparisons.push({
          vehicle: vehicle.label,
          codigo_infoauto: vehicle.codigo_infoauto,
          zona: zone.zona,
          cp: zone.cp,
          localidad: zone.localidad,
          plan: item.plan,
          precio_coef_1: item.premio_mensual,
          precio_coef_09: price09,
          variacion_pct: Math.round(((price09 / item.premio_mensual) - 1) * 10000) / 100,
        });
      }
    }
  }
  const output = path.join(process.cwd(), 'data/procesos/rivadavia-prueba-controlada-coeficientes-zona-norte.json');
  fs.writeFileSync(output, JSON.stringify({ generated_at: new Date().toISOString(), results, comparisons }, null, 2));
  process.stdout.write(JSON.stringify({ output, quotes: results.length, comparisons: comparisons.length }));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 1;
});

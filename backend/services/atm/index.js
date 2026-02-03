const { buildAxios, cotizarVehiculo } = require("./client");
const { loadAtmConfig } = require("./config");

function atmService() {
  const cfg = loadAtmConfig();

  // Si en el futuro necesitás usar API KEY, la incorporamos desde cfg.raw.parametros_extras
  const http = buildAxios({
    baseURL: cfg.baseUrl,
    apiKey: process.env.ATM_API_KEY || undefined,
    timeoutMs: 10000,
  });

  return {
    cotizar: (payload) => cotizarVehiculo(http, payload),
  };
}

module.exports = atmService;

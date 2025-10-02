const { buildAxios, cotizarVehiculo } = require("./client");

// Variables de entorno (agregalas a .env)
const ATM_BASE_URL = process.env.ATM_BASE_URL;
const ATM_API_KEY  = process.env.ATM_API_KEY; // o el método que corresponda

// “Fachada” para usar en tus rutas/controladores
function atmService() {
  const http = buildAxios({ baseURL: ATM_BASE_URL, apiKey: ATM_API_KEY, timeoutMs: 10000 });

  return {
    cotizar: (payload) => cotizarVehiculo(http, payload),
    // acá después sumamos: emitir, validar, etc.
  };
}

module.exports = atmService;

const axios = require("axios");

function buildAxios({ baseURL, apiKey, timeoutMs = 10000 }) {
  const instance = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
      // Ajustar según ATM: Authorization, x-api-key, etc.
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    // validateStatus permite tratar 4xx/5xx como “respuestas” y no como throw
    validateStatus: () => true,
  });

  // Log básico (podemos afinar con winston más adelante)
  instance.interceptors.request.use((cfg) => {
    console.log("[ATM][REQ]", cfg.method?.toUpperCase(), cfg.baseURL + cfg.url);
    return cfg;
  });
  instance.interceptors.response.use((res) => {
    console.log("[ATM][RES]", res.status, res.config.url);
    return res;
  });

  return instance;
}

/**
 * Ejemplo de operación: cotizar vehículo.
 * @param {object} http - instancia axios
 * @param {object} payload - body según especificación ATM
 * @returns {object} { ok: boolean, status, data, error }
 */
async function cotizarVehiculo(http, payload) {
  try {
    const res = await http.post("/cotizaciones", payload);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: res.data };
    }
    return { ok: false, status: res.status, error: res.data || res.statusText };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

module.exports = { buildAxios, cotizarVehiculo };

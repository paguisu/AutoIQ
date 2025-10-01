const nock = require("nock");
const { buildAxios, cotizarVehiculo } = require("../services/atm/client");

describe("ATM client", () => {
  const baseURL = "https://atm-sandbox.local";
  const http = buildAxios({ baseURL, apiKey: "test-key" });

  afterEach(() => {
    nock.cleanAll();
  });

  test("cotizarVehiculo devuelve ok=true en 200", async () => {
    const payload = { dominio: "ABC123", marca: "VW", modelo: "Golf" };

    nock(baseURL).post("/cotizaciones", payload)
      .reply(200, { precio: 12345, moneda: "ARS" });

    const res = await cotizarVehiculo(http, payload);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ precio: 12345, moneda: "ARS" });
  });

  test("cotizarVehiculo maneja error 400", async () => {
    const payload = { dominio: "" };

    nock(baseURL).post("/cotizaciones", payload)
      .reply(400, { mensaje: "Dominio inválido" });

    const res = await cotizarVehiculo(http, payload);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toEqual({ mensaje: "Dominio inválido" });
  });
});

const { resolveAmountFromInfoautoRow, resolveSumaAsegurada } = require('../utils/atm_infoauto');

describe('atm_infoauto', () => {
  test('resuelve la suma desde tau_pre segun el anio del vehiculo', () => {
    const row = {
      tau_anioe: '2026',
      tau_pre01: '31000000.00',
      tau_pre02: '29500000.00',
      tau_pre03: '28000000.00',
      tau_pre30: '1000000.00',
    };

    expect(resolveAmountFromInfoautoRow(row, 2026)).toBe(31000000);
    expect(resolveAmountFromInfoautoRow(row, 2025)).toBe(29500000);
    expect(resolveAmountFromInfoautoRow(row, 2024)).toBe(28000000);
  });

  test('acota al rango 1..30 cuando el anio se sale del catalogo', () => {
    const row = {
      tau_anioe: '2026',
      tau_pre01: '31000000.00',
      tau_pre30: '1000000.00',
    };

    expect(resolveAmountFromInfoautoRow(row, 2030)).toBe(31000000);
    expect(resolveAmountFromInfoautoRow(row, 1990)).toBe(1000000);
  });

  test('escala importes en miles y resuelve via infoauto_dc sin fijar una valuacion de catalogo', async () => {
    const amount = await resolveSumaAsegurada({
      row: { codigo_infoauto: 60533, anio: 2023 },
    });

    expect(Number.isFinite(amount)).toBe(true);
    expect(amount).toBeGreaterThan(1000000);
    expect(amount % 1000).toBe(0);
  });
});

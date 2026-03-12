const { resolveAmountFromInfoautoRow } = require('../utils/atm_infoauto');

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
});

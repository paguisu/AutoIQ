const {
  applyZeroKmToVehicle,
  normalizeZeroKmFlag,
  resolveVehicleZeroKm,
} = require('../utils/zero_km');

describe('zero km normalization', () => {
  test('normaliza valores comunes de 0 km', () => {
    expect(normalizeZeroKmFlag(true)).toBe('1');
    expect(normalizeZeroKmFlag('1')).toBe('1');
    expect(normalizeZeroKmFlag('S')).toBe('1');
    expect(normalizeZeroKmFlag('0 km')).toBe('1');
    expect(normalizeZeroKmFlag(false)).toBe('0');
    expect(normalizeZeroKmFlag('0')).toBe('0');
    expect(normalizeZeroKmFlag('N')).toBe('0');
    expect(normalizeZeroKmFlag('')).toBe('0');
  });

  test('resuelve el atributo desde la fila y default usado cuando falta', () => {
    expect(resolveVehicleZeroKm({ cerokm: '1' })).toBe('1');
    expect(resolveVehicleZeroKm({ esCeroKm: true })).toBe('1');
    expect(resolveVehicleZeroKm({ veh_cerokm: '0' })).toBe('0');
    expect(resolveVehicleZeroKm({})).toBe('0');
  });

  test('aplica el valor externo de Seguros911 al registro efectivo', () => {
    expect(applyZeroKmToVehicle({ marca: 'FIAT' }, true)).toMatchObject({
      marca: 'FIAT',
      cerokm: '1',
    });
  });
});

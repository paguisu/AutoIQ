const { resolveAtmVehicleKind } = require('../utils/atm_tipo_vehiculo');

describe('atm_tipo_vehiculo', () => {
  test('los codigos BYD remapeados por infoauto_dc no se infieren como moto', async () => {
    const ids = ['1390002', '1390004', '1390005'];

    for (const id of ids) {
      const out = await resolveAtmVehicleKind({ infoautocod: id });
      expect(out).toBeTruthy();
      expect(out.source).toBe('infoauto_dc');
      expect(out.marca).toBe('BYD');
      expect(out.isMoto).toBe(false);
      expect(out.seccion).toBe('3');
    }
  });
});

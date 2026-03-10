const { normalizeRecords, buildDiff } = require('../services/catalogos');

describe('catalogos service', () => {
  test('normalizeRecords convierte objeto diccionario a filas con codigo', () => {
    const rows = normalizeRecords({ particular: '4263', comercial: '4261' });
    expect(rows).toEqual([
      { codigo: 'particular', descripcion: '4263' },
      { codigo: 'comercial', descripcion: '4261' },
    ]);
  });

  test('buildDiff detecta altas/bajas/modificados', () => {
    const prev = [
      { codigo: '1', descripcion: 'A' },
      { codigo: '2', descripcion: 'B' },
    ];
    const next = [
      { codigo: '2', descripcion: 'B2' },
      { codigo: '3', descripcion: 'C' },
    ];

    const out = buildDiff('ws_au_usos', prev, next);

    expect(out.keyField).toBe('codigo');
    expect(out.resumen).toEqual({
      altas: 1,
      bajas: 1,
      modificados: 1,
      sin_cambios: false,
    });
    expect(out.altas[0].key).toBe('3');
    expect(out.bajas[0].key).toBe('1');
    expect(out.modificados[0].key).toBe('2');
  });
});

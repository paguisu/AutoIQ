const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeRecords, buildDiff, syncTable } = require('../services/catalogos');

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

  test('syncTable remoto persiste diccionario fuente y snapshots', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const catalogRoot = path.join(dataRoot, 'catalogos');
    fs.mkdirSync(path.join(dataRoot, 'atm'), { recursive: true });

    const out = await syncTable({
      dataRoot,
      catalogRoot,
      slug: 'atm',
      table: 'ws_au_tarjeta',
      source: 'remote',
      providerFetch: async () => ({
        sourceRaw: [
          { codigo: 'VISA', descripcion: 'Visa' },
          { codigo: 'MC', descripcion: 'Mastercard' },
        ],
        sourcePath: 'https://atm.example/catalogos/ws_au_tarjeta',
        sourceType: 'remote',
      }),
    });

    const localSourcePath = path.join(dataRoot, 'atm', 'diccionarios', 'tarjeta.json');
    const currentPath = path.join(catalogRoot, 'atm', 'ws_au_tarjeta', 'current.json');

    expect(fs.existsSync(localSourcePath)).toBe(true);
    expect(fs.existsSync(currentPath)).toBe(true);
    expect(out.paths.localSourcePath).toBe(localSourcePath);

    const persisted = JSON.parse(fs.readFileSync(localSourcePath, 'utf8'));
    expect(persisted).toEqual([
      { codigo: 'VISA', descripcion: 'Visa', longitud: '' },
      { codigo: 'MC', descripcion: 'Mastercard', longitud: '' },
    ]);
  });

  test('normalizeRecords soporta filas parseadas desde FTP con headers codigo/descripcion', () => {
    const rows = normalizeRecords([
      { codigo: '0101', descripcion: 'Particular' },
      { codigo: '1717', descripcion: 'Comercial' },
    ]);

    expect(rows).toEqual([
      { codigo: '0101', descripcion: 'Particular' },
      { codigo: '1717', descripcion: 'Comercial' },
    ]);
  });

  test('syncTable remoto de ws_au_usos guarda uso.json compatible con AutoIQ', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const catalogRoot = path.join(dataRoot, 'catalogos');
    fs.mkdirSync(path.join(dataRoot, 'atm'), { recursive: true });

    await syncTable({
      dataRoot,
      catalogRoot,
      slug: 'atm',
      table: 'ws_au_usos',
      source: 'remote',
      providerFetch: async () => ({
        sourceRaw: [
          { codigo: '0101', Descripcion: 'AUTO/JEEP/SUV PARTICULARES Y FAMILIARES' },
          { codigo: '010102', Descripcion: 'AUTO/JEEP/SUV COMERCIAL' },
          { codigo: '9999', Descripcion: 'TAXI' },
        ],
        sourcePath: 'ftp://atm.example/Parametros/WS_AU_USOS',
        sourceType: 'remote-ftp',
      }),
    });

    const persisted = JSON.parse(fs.readFileSync(path.join(dataRoot, 'atm', 'diccionarios', 'uso.json'), 'utf8'));
    expect(persisted).toEqual({
      particular: '0101',
      comercial: '010102',
      taxi: '9999',
    });
  });

  test('syncTable remoto de ws_au_marcas normaliza columnas del FTP', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const catalogRoot = path.join(dataRoot, 'catalogos');
    fs.mkdirSync(path.join(dataRoot, 'atm'), { recursive: true });

    const out = await syncTable({
      dataRoot,
      catalogRoot,
      slug: 'atm',
      table: 'ws_au_marcas',
      source: 'remote',
      dryRun: true,
      providerFetch: async () => ({
        sourceRaw: [
          { Codigo: '1', Descripcion: 'ACURA', Seccion: '3' },
        ],
        sourcePath: 'ftp://atm.example/Parametros/WS_AU_MARCAS',
        sourceType: 'remote-ftp',
      }),
    });

    expect(out.profile.sample[0]).toEqual({
      codigo: '1',
      descripcion: 'ACURA',
      seccion: '3',
    });
  });
});

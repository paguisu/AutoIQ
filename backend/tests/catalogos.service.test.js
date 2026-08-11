const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeRecords,
  buildAllianzAccessoriesEnvelope,
  buildDiff,
  parseAllianzAccessoriesResponse,
  syncTable,
  getTableStatus,
} = require('../services/catalogos');

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

  test('parsea catálogo remoto de accesorios Allianz', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <atr:ObtenerAccesoriosVehiculoResponseEBM xmlns:atr="http://xmlns.allianz.com.ar/Core/EBM/Vehiculo/AtrVehiculo">
      <ebm:ReturnCode xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM">0</ebm:ReturnCode>
      <atr:DataArea>
        <atr:ObtenerAccesoriosVehiculoResponse>
          <atr:cantidadPaginas>2</atr:cantidadPaginas>
          <atr:cantidadRegistros>30</atr:cantidadRegistros>
          <atr:ListaAccesorioVehiculo>
            <acc:AccesorioVehiculo xmlns:acc="http://xmlns.allianz.com.ar/Core/EBO/Allianz/AccesorioVehiculo">
              <acc:codigoAccesorio>20</acc:codigoAccesorio>
              <acc:descripcionAccesorio>GNC</acc:descripcionAccesorio>
            </acc:AccesorioVehiculo>
          </atr:ListaAccesorioVehiculo>
        </atr:ObtenerAccesoriosVehiculoResponse>
      </atr:DataArea>
    </atr:ObtenerAccesoriosVehiculoResponseEBM>
  </soapenv:Body>
</soapenv:Envelope>`;

    expect(buildAllianzAccessoriesEnvelope({
      usuario: 'u',
      password: 'p',
      application: 'AutoIQ',
      sender_username: 'sender',
    }, { page: 2, pageSize: 50 })).toContain('<atr:numeroPagina>2</atr:numeroPagina>');

    expect(parseAllianzAccessoriesResponse(xml)).toEqual({
      cantidadPaginas: 2,
      cantidadRegistros: 30,
      rows: [{ codigo: '20', descripcion: 'GNC' }],
    });
  });

  test('syncTable remoto de accesorios Allianz persiste accesorios.json', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const catalogRoot = path.join(dataRoot, 'catalogos');
    fs.mkdirSync(path.join(dataRoot, 'allianz'), { recursive: true });

    const out = await syncTable({
      dataRoot,
      catalogRoot,
      slug: 'allianz',
      table: 'accesorios',
      source: 'remote',
      providerFetch: async () => ({
        sourceRaw: [
          { codigo: '20', descripcion: 'GNC' },
          { codigo: '21', descripcion: 'EQUIPO DE FRIO' },
        ],
        sourcePath: 'https://wbs.allianzonline.com.ar/accesorios',
        sourceType: 'remote-soap',
      }),
    });

    const persisted = JSON.parse(fs.readFileSync(path.join(dataRoot, 'allianz', 'diccionarios', 'accesorios.json'), 'utf8'));
    expect(out.profile.totalRows).toBe(2);
    expect(persisted).toEqual([
      { codigo: '20', descripcion: 'GNC' },
      { codigo: '21', descripcion: 'EQUIPO DE FRIO' },
    ]);
  });

  test('getTableStatus informa si la tabla pertenece al mes en curso', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const diccDir = path.join(dataRoot, 'atm', 'diccionarios');
    fs.mkdirSync(diccDir, { recursive: true });

    const file = path.join(diccDir, 'infoauto.json');
    fs.writeFileSync(file, '[]', 'utf8');

    const currentDate = new Date();
    fs.utimesSync(file, currentDate, currentDate);

    const status = getTableStatus({ dataRoot, slug: 'atm', table: 'ws_au_infoauto' });
    expect(status.exists).toBe(true);
    expect(status.isCurrentMonth).toBe(true);
    expect(status.updatedAt).toBeTruthy();
  });

  test('Mercantil Andina expone y persiste sus catálogos remotos en el flujo común', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-catalogos-'));
    const dataRoot = path.join(tmpRoot, 'data');
    const catalogRoot = path.join(dataRoot, 'catalogos');
    fs.mkdirSync(path.join(dataRoot, 'mercantil_andina'), { recursive: true });

    const { listTablesForCompany } = require('../services/catalogos');
    expect(listTablesForCompany(dataRoot, 'mercantil_andina').map((item) => item.table)).toEqual([
      'marcas',
      'vehiculos',
    ]);

    await syncTable({
      dataRoot,
      catalogRoot,
      slug: 'mercantil_andina',
      table: 'vehiculos',
      source: 'remote',
      providerFetch: async () => ({
        sourceRaw: [{ catalog_key: '2019:10624121', codigo: 10624121, anio: 2019, descripcion: 'AUDI A1', infoauto: 60450, propulsion: 1 }],
        sourcePath: 'https://api.mercantilandina.com.ar/vehiculos/v1/',
        sourceType: 'remote-api-paginated',
      }),
    });

    const persisted = JSON.parse(fs.readFileSync(
      path.join(dataRoot, 'mercantil_andina', 'diccionarios', 'vehiculos.json'),
      'utf8'
    ));
    expect(persisted).toEqual([{
      catalog_key: '2019:10624121',
      codigo: 10624121,
      anio: 2019,
      descripcion: 'AUDI A1',
      infoauto: 60450,
      propulsion: 1,
    }]);
  });
});

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeJsonAtomicWithRetry } = require('../utils/inferencias');

describe('Persistencia de inferencias Rivadavia', () => {
  test('reemplaza el JSON de forma atomica y deja un archivo valido', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoiq-rivadavia-inference-'));
    const file = path.join(dir, 'infoauto_tipo_vehiculo.json');
    try {
      await writeJsonAtomicWithRetry(file, {
        460836: { tipoVehiculo: '1' },
        460921: { tipoVehiculo: '8' },
      });
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(saved).toEqual({
        460836: { tipoVehiculo: '1' },
        460921: { tipoVehiculo: '8' },
      });
      expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

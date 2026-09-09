const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const proceso = require('../routes/proceso');

const root = path.join(__dirname, '..', '..');
const specPath = path.join(root, 'docs', 'openapi', 'seguros911-private-api.yaml');

describe('contrato AutoIQ Seguros911', () => {
  test('OpenAPI 3.1 parsea y documenta exactamente las rutas privadas', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    expect(spec.openapi).toBe('3.1.0');
    const documented = Object.entries(spec.paths).flatMap(([route, item]) =>
      Object.keys(item).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map((method) => `${method}:${route}`)
    ).sort();
    const source = fs.readFileSync(path.join(root, 'backend', 'routes', 'seguros911_integration.js'), 'utf8');
    const actual = [...source.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)]
      .map((m) => `${m[1]}:${m[2].replace(/:([A-Za-z]+)/g, '{$1}')}`).sort();
    expect(documented).toEqual(actual);
  });

  test('todos los ejemplos son JSON válido y no contienen secretos evidentes', () => {
    const dir = path.join(root, 'docs', 'openapi', 'examples');
    for (const name of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw).not.toMatch(/(password|api[_-]?key|service[_-]?secret|bearer\s)/i);
    }
  });

  test('la guía de consumo cubre el ciclo individual completo y extensiones', () => {
    const guide = fs.readFileSync(path.join(root, 'docs', 'integracion-seguros911-consumo-cotizacion.md'), 'utf8');
    for (const term of [
      '/cotizador-publico/cotizar',
      '/integration/seguros911/quote-inputs',
      '/proceso/crear',
      '/proceso/ejecutar/',
      '/proceso/estado/',
      'GET /proceso/',
      'uso comercial',
      'motos',
    ]) expect(guide).toContain(term);
  });

  test('GNC explícito del riesgo prevalece sobre perfiles y conserva suma', () => {
    const { resolveRiskGnc } = proceso.__test;
    expect(resolveRiskGnc({ fila: { gnc: 1, suma_gnc: 800000 }, cabecera: { gnc: '0' } })).toEqual({ gnc: '1', suma_gnc: '800000', warnings: [] });
    expect(resolveRiskGnc({ fila: { gnc: 1, suma_gnc: 800000 }, cabeceraOverride: { gnc: '0' } })).toEqual({ gnc: '0', suma_gnc: '', warnings: ['GNC_AMOUNT_WITHOUT_GNC'] });
    expect(resolveRiskGnc({ fila: { gnc: 1 } }).warnings).toContain('GNC_WITHOUT_AMOUNT');
  });
});

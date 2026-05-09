const {
  canonicalTrackingSystem,
  resolveCompanyTracking,
  resolveTrackingInput,
} = require('../utils/rastreo');

describe('rastreo canonico', () => {
  test('normaliza estados basicos y proveedores', () => {
    expect(canonicalTrackingSystem('No posee')).toBe('sin_rastreo');
    expect(canonicalTrackingSystem('Posee, sin especificar')).toBe('sin_especificar');
    expect(canonicalTrackingSystem('Lo Jack')).toBe('lojack');
    expect(canonicalTrackingSystem('ITURAN AVL')).toBe('ituran');
  });

  test('rastreo=1 queda como posee sin especificar compatible con cabeceras viejas', () => {
    expect(resolveTrackingInput({ rastreo: '1' })).toMatchObject({
      hasTracking: true,
      system: 'sin_especificar',
      source: 'rastreo',
    });
  });

  test('un sistema explicito puede completar una cabecera vieja con rastreo en 0', () => {
    expect(resolveTrackingInput({ rastreo: '0', rastreo_sistema: 'Ituran' })).toMatchObject({
      hasTracking: true,
      system: 'ituran',
      source: 'rastreo_sistema',
    });
  });

  test('traduce por compania con default controlado', () => {
    expect(resolveCompanyTracking({ rastreo: '1' }, 'smg')).toMatchObject({
      mappedValue: '2',
      effectiveSystem: 'lojack',
      defaultApplied: true,
    });
    expect(resolveCompanyTracking({ rastreo: '1', rastreo_sistema: 'Tracer' }, 'victoria')).toMatchObject({
      mappedValue: 1,
      effectiveSystem: 'tracer',
      defaultApplied: false,
    });
    expect(resolveCompanyTracking({ rastreo: '1' }, 'victoria')).toMatchObject({
      mappedValue: 5,
      effectiveSystem: 'lojack',
      defaultApplied: true,
    });
    expect(resolveCompanyTracking({ rastreo: '0' }, 'experta')).toMatchObject({
      mappedValue: 'N',
      hasTracking: false,
    });
  });
});

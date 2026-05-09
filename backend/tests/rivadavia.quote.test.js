const {
  resolveRivadaviaAlarmaSatelital,
} = require('../services/rivadavia/quote');

describe('Rivadavia quote adapter', () => {
  test('mapea rastreo de cabecera a alarmaSatelital configurable', () => {
    expect(resolveRivadaviaAlarmaSatelital({ rastreo: '0' }, {})).toBe('SIN_ALARMA');
    expect(resolveRivadaviaAlarmaSatelital(
      { rastreo: '1' },
      { parametros_extras: { alarma_satelital_con_default: 'CON_ALARMA' } }
    )).toBe('CON_ALARMA');
  });
});

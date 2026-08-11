const procesoRouter = require('../routes/proceso');

const {
  addResponseTiming,
  annotateResultStatus,
  buildPeriodoCotizacionInfo,
  createProviderCircuitBreaker,
  getCotizacionPeriodo,
  getCompanyQueueConfig,
} = procesoRouter.__test;

describe('proceso provider circuit breaker', () => {
  test('marca como tecnico y retryable un error transitorio de proveedor', () => {
    const result = annotateResultStatus({
      ok: false,
      error: 'HTTP 503 Service Unavailable',
      operacion: '0',
      coberturas: [],
    });

    expect(result.pending).toBe(true);
    expect(result.technical_error).toBe(true);
    expect(result.retryable).toBe(true);
  });

  test('no marca como tecnico un rechazo funcional de negocio', () => {
    const result = annotateResultStatus({
      ok: false,
      error: 'La relacion vehiculo - año de fabricacion no es valida',
      operacion: '0',
      coberturas: [],
    });

    expect(result.pending).toBe(false);
    expect(result.technical_error).toBe(false);
    expect(result.retryable).toBe(false);
  });

  test('abre pausa al alcanzar el umbral de fallas tecnicas consecutivas', () => {
    let now = Date.UTC(2026, 5, 13, 12, 0, 0);
    const breaker = createProviderCircuitBreaker({
      slug: 'allianz',
      queueCfg: {
        circuitBreakerFailureThreshold: 3,
        circuitBreakerCooldownMs: 15 * 60 * 1000,
        circuitBreakerMaxPauseCycles: 2,
      },
      now: () => now,
    });

    const failure = annotateResultStatus({ ok: false, error: 'ENOTFOUND wbs.allianzonline.com.ar' });

    expect(breaker.recordResult(failure).action).toBe('continue');
    expect(breaker.recordResult(failure).action).toBe('continue');

    const action = breaker.recordResult(failure);
    expect(action.action).toBe('pause');
    expect(action.pauseMs).toBe(15 * 60 * 1000);
    expect(action.pausedUntilIso).toBe('2026-06-13T12:15:00.000Z');

    now += 15 * 60 * 1000;
    expect(breaker.recordResult({ ok: true }).action).toBe('continue');
    expect(breaker.snapshot().consecutive_technical_failures).toBe(0);
  });

  test('agota el circuito despues del maximo de pausas configurado', () => {
    const breaker = createProviderCircuitBreaker({
      slug: 'atm',
      queueCfg: {
        circuitBreakerFailureThreshold: 1,
        circuitBreakerCooldownMs: 1000,
        circuitBreakerMaxPauseCycles: 1,
      },
      now: () => Date.UTC(2026, 5, 13, 12, 0, 0),
    });
    const failure = annotateResultStatus({ ok: false, error: 'HTTP 504 Gateway Timeout' });

    expect(breaker.recordResult(failure).action).toBe('pause');
    expect(breaker.recordResult(failure).action).toBe('exhausted');
  });

  test('agrega tiempos comunes a la respuesta de cualquier aseguradora', () => {
    const timed = addResponseTiming(
      { ok: true, operacion: '123' },
      Date.UTC(2026, 5, 13, 12, 0, 0),
      Date.UTC(2026, 5, 13, 12, 0, 2, 345)
    );

    expect(timed.started_at).toBe('2026-06-13T12:00:00.000Z');
    expect(timed.finished_at).toBe('2026-06-13T12:00:02.345Z');
    expect(timed.duration_ms).toBe(2345);
  });

  test('lee configuracion operacional desde parametros_extras', () => {
    const cfg = getCompanyQueueConfig('allianz', {
      parametros_extras: {
        max_concurrency: 1,
        min_interval_ms: 2500,
        circuit_breaker_failure_threshold: 2,
        circuit_breaker_cooldown_ms: 30000,
        circuit_breaker_max_pause_cycles: 4,
      },
    });

    expect(cfg.maxConcurrency).toBe(1);
    expect(cfg.minIntervalMs).toBe(2500);
    expect(cfg.circuitBreakerFailureThreshold).toBe(2);
    expect(cfg.circuitBreakerCooldownMs).toBe(30000);
    expect(cfg.circuitBreakerMaxPauseCycles).toBe(4);
  });

  test('calcula el periodo de cotizacion desde la fecha de ejecucion', () => {
    expect(getCotizacionPeriodo(new Date(2026, 5, 30, 12, 0, 0))).toBe('2026-06');
    expect(getCotizacionPeriodo(new Date(2026, 6, 1, 0, 5, 0))).toBe('2026-07');
  });

  test('advierte cuando la estimacion cruza a otro mes', () => {
    const info = buildPeriodoCotizacionInfo({
      startedAt: new Date(2026, 5, 30, 23, 50, 0),
      filas: 100,
      aseguradoras: ['mapfre'],
    });

    expect(info.periodo).toBe('2026-06');
    expect(info.cruza_mes_estimado).toBe(true);
    expect(info.advertencia).toContain('Conviene abrir otro proceso');
  });
});

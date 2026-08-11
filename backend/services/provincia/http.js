function trimText(value) {
  return String(value || '').trim();
}

function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProvinciaHttpSettings(
  cfg = {},
  {
    prefix = 'request',
    defaultTimeoutMs = 30000,
    defaultRetries = 0,
    defaultRetryDelayMs = 0,
  } = {}
) {
  const extras = cfg?.parametros_extras || {};
  return {
    timeoutMs: parsePositiveInt(
      extras?.[`${prefix}_timeout_ms`] ?? cfg?.[`${prefix}_timeout_ms`],
      defaultTimeoutMs
    ),
    retries: Math.max(0, parsePositiveInt(
      extras?.[`${prefix}_retries`] ?? cfg?.[`${prefix}_retries`],
      defaultRetries
    )),
    retryDelayMs: Math.max(0, parsePositiveInt(
      extras?.[`${prefix}_retry_delay_ms`] ?? cfg?.[`${prefix}_retry_delay_ms`],
      defaultRetryDelayMs
    )),
  };
}

function isProvinciaRetryableError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (status === 429 || status >= 500) return true;

  const code = trimText(error?.code).toUpperCase();
  if ([
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
  ].includes(code)) {
    return true;
  }

  const message = trimText(error?.message).toUpperCase();
  if (!message) return false;

  const patterns = [
    'TIMEOUT',
    'TIMED OUT',
    'SOCKET HANG UP',
    'NETWORK ERROR',
    'SERVICE UNAVAILABLE',
    'BAD GATEWAY',
    'GATEWAY TIMEOUT',
    'TEMPORARILY UNAVAILABLE',
    'TOO MANY REQUESTS',
    'HTTP 429',
    'HTTP 500',
    'HTTP 502',
    'HTTP 503',
    'HTTP 504',
  ];

  return patterns.some((pattern) => message.includes(pattern));
}

function buildProvinciaResponseError(message, resp) {
  const err = new Error(message);
  if (resp) {
    err.response = resp;
    err.status = Number(resp.status || 0) || undefined;
  }
  return err;
}

async function runProvinciaRequest({
  cfg = {},
  prefix = 'request',
  defaultTimeoutMs = 30000,
  defaultRetries = 0,
  defaultRetryDelayMs = 0,
  executor,
  shouldRetry = isProvinciaRetryableError,
} = {}) {
  if (typeof executor !== 'function') {
    throw new Error('Provincia request executor requerido');
  }

  const settings = getProvinciaHttpSettings(cfg, {
    prefix,
    defaultTimeoutMs,
    defaultRetries,
    defaultRetryDelayMs,
  });

  let lastError = null;
  for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
    try {
      return await executor({
        attempt,
        timeoutMs: settings.timeoutMs,
        settings,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= settings.retries || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = settings.retryDelayMs * (attempt + 1);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('Provincia request fallo');
}

module.exports = {
  buildProvinciaResponseError,
  getProvinciaHttpSettings,
  isProvinciaRetryableError,
  runProvinciaRequest,
};

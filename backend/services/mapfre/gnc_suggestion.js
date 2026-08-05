const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { buildMapfreEnvelope, parseMapfreResponse } = require('./quote');

const DEFAULT_PROBE = {
  fila: {
    infoautocod: '450420',
    anio: '2023',
    CP: '1650',
    localidad: 'SAN MARTIN',
    provincia: 'Buenos Aires',
    suma: '25190000',
  },
  cabecera: {
    fec_nac: '19840311',
    sexo: 'M',
    medio_pago: 'Tarjeta de crédito',
    tipopersona: 'F',
    iva: 'CF',
    rastreo: '0',
    cerokm: '0',
    gnc: '1',
    suma_gnc: '300000',
  },
  mapeos: { uso_codigo: '1' },
};

function suggestionPath(dataRoot) {
  return path.join(dataRoot, 'mapfre', 'metadata', 'gnc_suggestion.json');
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readMapfreGncSuggestion({ dataRoot = path.join(process.cwd(), 'data') } = {}) {
  const file = suggestionPath(dataRoot);
  const data = readJsonIfExists(file);
  return data || {
    company: 'mapfre',
    concept: 'gnc_suggested_amount',
    ok: false,
    value: null,
    formatted: '',
    updated_at: '',
    updated_date: '',
    period_key: '',
  };
}

function formatMapfreDate(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear());
  return `${d}${m}${y}`;
}

function formatDisplayDate(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

function periodKey(date = new Date()) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatThousands(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function extractMapfreGncSuggestedAmount(message) {
  const text = String(message || '');
  const match = text.match(/VALOR\s+SUGERIDO\s+ES\s+DE\s+([0-9][0-9.,]*)/i);
  if (!match) return null;
  const normalized = String(match[1]).replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

async function refreshMapfreGncSuggestion({
  dataRoot = path.join(process.cwd(), 'data'),
  now = new Date(),
  probe = DEFAULT_PROBE,
  httpPost = axios.post,
} = {}) {
  const cfgPath = path.join(dataRoot, 'mapfre', 'aseguradora.json');
  const previous = readMapfreGncSuggestion({ dataRoot });

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `No se pudo leer config Mapfre: ${err.message}`, previous };
  }

  const url = `${String(cfg.base_url || '').replace(/\/+$/, '')}${cfg.soap_path || ''}`;
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Config Mapfre sin URL valida para cotizar', previous };
  }

  try {
    const { envelope, requestMeta } = await buildMapfreEnvelope({
      fila: probe.fila,
      cabecera: probe.cabecera,
      hoyFmt: formatMapfreDate(now),
      cfg,
      mapeos: probe.mapeos,
      postalCatalog: probe.postalCatalog,
    });

    const resp = await httpPost(url, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        SOAPAction: cfg.soap_method || 'cotizar',
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    const parsed = parseMapfreResponse(resp.data);
    const suggested = extractMapfreGncSuggestedAmount(parsed.error || resp.data);
    if (!suggested) {
      return {
        ok: false,
        error: parsed.ok
          ? 'Mapfre cotizo el sondeo sin informar valor sugerido'
          : (parsed.error || 'Mapfre no informo valor sugerido de GNC'),
        http_status: resp.status,
        previous,
      };
    }

    const out = {
      company: 'mapfre',
      concept: 'gnc_suggested_amount',
      ok: true,
      value: suggested,
      formatted: formatThousands(suggested),
      updated_at: now.toISOString(),
      updated_date: formatDisplayDate(now),
      period_key: periodKey(now),
      source: 'mapfre_quote_probe',
      http_status: resp.status,
      probe: {
        infoautocod: probe.fila.infoautocod,
        anio: probe.fila.anio,
        cp: probe.fila.CP,
        localidad: probe.fila.localidad,
        suma_gnc_probe: probe.cabecera.suma_gnc,
      },
      request_meta: requestMeta,
      mapfre_message: parsed.error || '',
    };

    const file = suggestionPath(dataRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    return out;
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo refrescar sugerencia GNC Mapfre', previous };
  }
}

module.exports = {
  extractMapfreGncSuggestedAmount,
  readMapfreGncSuggestion,
  refreshMapfreGncSuggestion,
  suggestionPath,
};

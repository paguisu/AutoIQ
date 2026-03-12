const fs = require('fs/promises');
const path = require('path');
const { pickInfoautoCode } = require('./atm_tipo_vehiculo');

function dataPath(...p) {
  return path.join(process.cwd(), 'data', ...p);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

let infoautoIndexPromise = null;

async function loadInfoautoIndex() {
  if (!infoautoIndexPromise) {
    infoautoIndexPromise = readJson(dataPath('atm', 'diccionarios', 'infoauto.json'))
      .then((rows) => {
        const byCode = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
          const key = String(row?.tau_codia ?? '').trim();
          if (key) byCode.set(key, row);
        }
        return byCode;
      })
      .catch(() => new Map());
  }
  return infoautoIndexPromise;
}

function pickVehicleYear(row = {}) {
  const raw =
    row?.anio ??
    row?.anofab ??
    row?.ANO ??
    row?.Anio ??
    row?.ano ??
    row?.veh_anio ??
    row?.veh_anofab;
  const year = Number.parseInt(String(raw ?? '').replace(/\D+/g, ''), 10);
  return Number.isFinite(year) ? year : null;
}

function normalizeAmount(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/\s+/g, '').replace(',', '.');
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : text;
}

function resolveAmountFromInfoautoRow(infoautoRow, year) {
  if (!infoautoRow || typeof infoautoRow !== 'object') return null;

  const baseYear = Number.parseInt(String(infoautoRow.tau_anioe ?? '').replace(/\D+/g, ''), 10);
  let index = 1;

  if (Number.isFinite(baseYear) && Number.isFinite(year)) {
    index = Math.max(1, Math.min(30, baseYear - year + 1));
  }

  const key = `tau_pre${String(index).padStart(2, '0')}`;
  return normalizeAmount(infoautoRow[key]);
}

async function resolveSumaAsegurada({ row = {}, responseAmount = null } = {}) {
  const responseValue = normalizeAmount(responseAmount);
  if (responseValue != null) return responseValue;

  const infoautoCode = pickInfoautoCode(row);
  if (!infoautoCode) return null;

  const infoautoByCode = await loadInfoautoIndex();
  const infoautoRow = infoautoByCode.get(infoautoCode) || null;
  if (!infoautoRow) return null;

  return resolveAmountFromInfoautoRow(infoautoRow, pickVehicleYear(row));
}

module.exports = {
  pickVehicleYear,
  resolveAmountFromInfoautoRow,
  resolveSumaAsegurada,
};

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function pick(values) {
  for (const value of values) {
    if (value == null) continue;
    const raw = String(value).trim();
    if (raw !== '') return value;
  }
  return '';
}

function pickZeroKmValue(source = {}) {
  return pick([
    source?.cerokm,
    source?.ceroKm,
    source?.cero_km,
    source?.CeroKm,
    source?.CeroKM,
    source?.['0km'],
    source?.['0Km'],
    source?.['0KM'],
    source?.es0km,
    source?.es0Km,
    source?.es0KM,
    source?.es_0km,
    source?.es_0Km,
    source?.esCeroKm,
    source?.esCeroKM,
    source?.veh_cerokm,
    source?.veh_0km,
    source?.veh_cero_km,
    source?.veh_ceroKm,
  ]);
}

function normalizeZeroKmFlag(value) {
  if (value === true) return '1';
  if (value === false) return '0';
  const raw = normalizeText(value);
  if (!raw) return '0';
  if (['1', 'S', 'SI', 'Y', 'YES', 'TRUE', 'T', 'OKM', '0KM', '0 KM', 'CERO KM'].includes(raw)) return '1';
  return '0';
}

function resolveVehicleZeroKm(fila = {}) {
  return normalizeZeroKmFlag(pickZeroKmValue(fila));
}

function isVehicleZeroKm(fila = {}) {
  return resolveVehicleZeroKm(fila) === '1';
}

function applyZeroKmToVehicle(fila = {}, value) {
  return {
    ...(fila || {}),
    cerokm: normalizeZeroKmFlag(value),
  };
}

module.exports = {
  applyZeroKmToVehicle,
  isVehicleZeroKm,
  normalizeZeroKmFlag,
  pickZeroKmValue,
  resolveVehicleZeroKm,
};

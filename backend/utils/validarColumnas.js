// backend/utils/validarColumnas.js
// Valida que los encabezados (array de strings) contengan las columnas esperadas.
// Robusto ante mayúsculas/minúsculas, espacios y tildes, e incluye 'suma'.

// Normaliza: minúsculas, trim, sin tildes ni espacios duplicados.
function normalizar(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/\s+/g, ' ')
    .trim();
}

// Algunas variantes comunes de nombres que suelen aparecer en planillas.
// clave normalizada -> conjunto de alias aceptados normalizados
const ALIAS = {
  anio: new Set(['anio', 'año', 'year']),
  marca: new Set(['marca']),
  modelo: new Set(['modelo']),
  infoautocod: new Set(['infoautocod', 'infoauto', 'codigo_infoauto', 'cod_infoauto', 'codigo infoauto']),
  cerokm: new Set(['cerokm', '0km', 'cero km', '0 km', 'es0km', 'es_0km']),
  uso: new Set(['uso']),
  tipo_vehiculo: new Set(['tipo_vehiculo', 'tipovehiculo', 'tipo vehiculo', 'tipo']),
  suma: new Set(['suma', 'suma_asegurada', 'suma asegurada', 'sumaasegurada']),

  provincia: new Set(['provincia']),
  localidad: new Set(['localidad']),
  cp: new Set(['cp', 'codigo postal', 'codigo_postal']),
};

// Dado un encabezado normalizado, lo mapea a la clave canónica si es alias.
function canon(enc) {
  for (const [canonKey, variantes] of Object.entries(ALIAS)) {
    if (variantes.has(enc)) return canonKey;
  }
  return enc; // si no es alias conocido, queda tal cual
}

// Mapea y normaliza todos los encabezados recibidos.
function normalizarEncabezados(encabezados = []) {
  const set = new Set();
  for (const h of encabezados) {
    const norm = normalizar(h);
    if (!norm) continue;
    set.add(canon(norm));
  }
  return Array.from(set);
}

// Columnas esperadas por tipo de validación.
const ESPERADAS = {
  // Vehículos (modo combinatorio)
  combinatoriaVehiculos: ['anio', 'marca', 'modelo', 'infoautocod', 'cerokm', 'uso', 'tipo_vehiculo', 'suma'],

  // Códigos postales (modo combinatorio)
  combinatoriaCP: ['provincia', 'localidad', 'cp'],

  // Archivo único (taxativo) — ajustá según tu definición final
  taxativa: ['anio', 'marca', 'modelo', 'infoautocod', 'cerokm', 'provincia', 'localidad', 'cp', 'uso', 'tipo_vehiculo', 'suma'],
};

// API principal: recibe tipo ('combinatoriaVehiculos' | 'combinatoriaCP' | 'taxativa')
// y un array de encabezados tal como vienen de la planilla.
function validarColumnas(tipo, encabezados) {
  const canonizados = normalizarEncabezados(encabezados);
  const esperadas = ESPERADAS[tipo];

  if (!esperadas) {
    return { ok: false, faltan: [`Tipo de validación desconocido: ${tipo}`], detectadas: canonizados };
  }

  const faltan = esperadas.filter(req => !canonizados.includes(req));
  return {
    ok: faltan.length === 0,
    faltan,
    detectadas: canonizados,
    requeridas: esperadas,
  };
}

module.exports = validarColumnas;


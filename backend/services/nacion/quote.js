const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pick(values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeMoney(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num.toFixed(2) : '';
}

function resolveNacionDocumentType(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.tipodoc);
  const map = {
    CUIT: '80',
    CUIL: '86',
    LE: '89',
    LC: '90',
    PASAPORTE: '94',
    PAS: '94',
    DNI: '96',
  };
  return map[raw] || String(cfg?.parametros_extras?.tipo_documento_default || '96');
}

function resolveNacionIvaCode(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: '5',
    'CONSUMIDOR FINAL': '5',
    RI: '1',
    'RESPONSABLE INSCRIPTO': '1',
    EX: '4',
    EXENTO: '4',
    MT: '6',
    MONOTRIBUTO: '6',
  };
  return map[raw] || String(cfg?.parametros_extras?.iva_default || '5');
}

function resolveNacionPaymentCode(cabecera = {}, cfg = {}) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
    cabecera?.medioPago ??
    cabecera?.forma_pago ??
    cabecera?.formaPago ??
    ''
  );
  const map = {
    EFECTIVO: '1',
    CUPONERA: '1',
    TARJETA: '2',
    'TARJETA DE CREDITO': '2',
    CBU: '3',
    DEBITO: '3',
  };
  return map[raw] || String(cfg?.parametros_extras?.forma_pago_default || '2');
}

function resolveNacionVehicleUse({ fila = {}, cabecera = {}, mapeos = {}, cfg = {} }) {
  if (mapeos?.uso_codigo) return String(mapeos.uso_codigo).trim();
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (raw.includes('COMER')) return '2';
  if (raw.includes('OFIC')) return '4';
  return String(cfg?.parametros_extras?.uso_default || '1');
}

function resolveNacionFuelCode(fila = {}, cfg = {}) {
  const raw = normalizeText(pick([fila?.combustible, fila?.Combustible, fila?.tipo_combustible]));
  if (raw.includes('GNC')) return '1';
  if (raw.includes('GASOIL') || raw.includes('DIESEL')) return '2';
  if (raw.includes('NAFTA')) return '3';
  return String(cfg?.parametros_extras?.combustible_default || '4');
}

function buildNacionEnvelope({ fila = {}, cabecera = {}, cfg = {}, mapeos = {}, today = new Date() } = {}) {
  const cotizadorId = String(cfg?.cotizador_id || '').trim();
  const usuarioAplicacion = String(cfg?.usuario_aplicacion || '').trim();
  const codInfoauto = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
  const anio = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const codigoPostal = pick([fila?.codigo_postal, fila?.codpostal, fila?.CP, fila?.cp, cabecera?.cp]).replace(/\D+/g, '').slice(0, 4);
  const numeroDocumento = pick([cabecera?.nrodoc, cabecera?.numeroDocumento, fila?.nrodoc]).replace(/\D+/g, '');
  const fechaVigenciaDesde = new Date(today).toISOString().slice(0, 10);
  const tipoDocumento = resolveNacionDocumentType(cabecera, cfg);
  const categoriaIva = resolveNacionIvaCode(cabecera, cfg);
  const formaPago = resolveNacionPaymentCode(cabecera, cfg);
  const usoVehiculo = resolveNacionVehicleUse({ fila, cabecera, mapeos, cfg });
  const tipoCombustible = resolveNacionFuelCode(fila, cfg);
  const sumaAsegurada = normalizeMoney(pick([
    fila?.valorVehiculo,
    fila?.valor_vehiculo,
    fila?.suma,
    fila?.suma_asegurada,
  ])) || String(cfg?.parametros_extras?.valor_vehiculo_default || '0.00');

  if (!cotizadorId) throw new Error('Nacion requiere cotizador_id');
  if (!usuarioAplicacion) throw new Error('Nacion requiere usuario_aplicacion');
  if (!codInfoauto) throw new Error('Nacion requiere codigo InfoAuto');
  if (!anio) throw new Error('Nacion requiere anio del vehiculo');
  if (!codigoPostal) throw new Error('Nacion requiere codigo postal');

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <SER_CotizadorEnviarCoberturas>
      <PEDIDO_PROCESO>
        <COTIZADOR_ID>${escapeXml(cotizadorId)}</COTIZADOR_ID>
        <USUARIO_APLICACION>${escapeXml(usuarioAplicacion)}</USUARIO_APLICACION>
        <FECHA_VIGENCIA_DESDE>${escapeXml(fechaVigenciaDesde)}</FECHA_VIGENCIA_DESDE>
        <TIPO_DOCUMENTO>${escapeXml(tipoDocumento)}</TIPO_DOCUMENTO>
        <NUMERO_DOCUMENTO>${escapeXml(numeroDocumento)}</NUMERO_DOCUMENTO>
        <CODIGO_POSTAL>${escapeXml(codigoPostal)}</CODIGO_POSTAL>
        <CODIGO_INFOAUTO>${escapeXml(codInfoauto)}</CODIGO_INFOAUTO>
        <ANIO>${escapeXml(anio)}</ANIO>
        <CATEGORIA_IVA>${escapeXml(categoriaIva)}</CATEGORIA_IVA>
        <FORMA_PAGO>${escapeXml(formaPago)}</FORMA_PAGO>
        <USO_VEHICULO>${escapeXml(usoVehiculo)}</USO_VEHICULO>
        <TIPO_COMBUSTIBLE>${escapeXml(tipoCombustible)}</TIPO_COMBUSTIBLE>
        <SUMA_ASEGURADA>${escapeXml(sumaAsegurada)}</SUMA_ASEGURADA>
      </PEDIDO_PROCESO>
    </SER_CotizadorEnviarCoberturas>
  </soapenv:Body>
</soapenv:Envelope>`;

  return {
    envelope,
    requestMeta: {
      cotizadorId,
      usuarioAplicacion,
      fechaVigenciaDesde,
      tipoDocumento,
      numeroDocumento,
      codigoPostal,
      codInfoauto,
      anio,
      categoriaIva,
      formaPago,
      usoVehiculo,
      tipoCombustible,
      sumaAsegurada,
    },
  };
}

function parseNacionQuoteResponse(xml) {
  const raw = String(xml || '');
  const parsed = parser.parse(raw);
  const body = parsed?.Envelope?.Body || {};
  const response =
    body?.SER_CotizadorEnviarCoberturasRespuesta ||
    body?.CotizadorEnviarCoberturasRespuesta ||
    body?.cotizadorEnviarCoberturasResponse ||
    body;
  const proceso =
    response?.RESPUESTA_PROCESO ||
    response?.respuestaProceso ||
    response?.Response ||
    {};
  const salida = String(
    proceso?.SALIDA ??
    proceso?.salida ??
    response?.SALIDA ??
    response?.salida ??
    ''
  ).trim();
  const operacion = String(
    proceso?.NUMERO_PRESUPUESTO ??
    proceso?.numeroPresupuesto ??
    proceso?.NUMERO_COTIZACION ??
    response?.NUMERO_PRESUPUESTO ??
    ''
  ).trim();

  const errores = asArray(
    proceso?.LISTA_MENSAJES?.MENSAJE ||
    proceso?.mensajes?.mensaje ||
    response?.LISTA_MENSAJES?.MENSAJE
  ).map((item) => ({
    codigo: String(item?.CODIGO || item?.codigo || '').trim(),
    descripcion: String(item?.DESCRIPCION || item?.descripcion || item || '').trim(),
  })).filter((item) => item.codigo || item.descripcion);

  const coberturas = asArray(
    proceso?.LISTA_COBERTURAS?.COBERTURA ||
    proceso?.coberturas?.cobertura ||
    response?.LISTA_COBERTURAS?.COBERTURA
  ).map((item) => ({
    codigo: String(item?.CODIGO || item?.codigo || '').trim(),
    descripcion: String(item?.DESCRIPCION || item?.descripcion || '').trim(),
    plan: String(item?.PLAN || item?.plan || '').trim(),
    premio: normalizeMoney(item?.PREMIO || item?.premio || ''),
    premioMensual: normalizeMoney(item?.PREMIO_MENSUAL || item?.premioMensual || ''),
    sumaAsegurada: normalizeMoney(item?.SUMA_ASEGURADA || item?.sumaAsegurada || ''),
  }));

  const ok = ['9', '1', 'SUCCESS', 'OK'].includes(salida.toUpperCase()) || (salida === '' && coberturas.length > 0);
  return {
    ok,
    operacion: operacion || '0',
    coberturas,
    errores,
    error: ok ? '' : (errores[0]?.descripcion || 'Nacion respondio sin contrato final confirmado'),
    raw,
  };
}

module.exports = {
  buildNacionEnvelope,
  parseNacionQuoteResponse,
  resolveNacionDocumentType,
  resolveNacionFuelCode,
  resolveNacionIvaCode,
  resolveNacionPaymentCode,
  resolveNacionVehicleUse,
};

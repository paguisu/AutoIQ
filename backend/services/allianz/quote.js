const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { resolveCompanyTracking } = require('../../utils/rastreo');

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, removeNSPrefix: true });
let postalAliasCache = null;
const POSTAL_ALIASES_JSON_PATH = path.join(process.cwd(), 'data', 'allianz', 'diccionarios', 'codigo_postal_aliases.json');

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

function asText(value) {
  return value == null ? '' : String(value);
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeAllianzPostalAliases(rows) {
  return Array.isArray(rows)
    ? rows.map((item) => ({
        inputCodPostal: String(item?.inputCodPostal || '').trim(),
        inputLocalidad: normalizeText(item?.inputLocalidad || ''),
        inputProvincia: normalizeText(item?.inputProvincia || ''),
        codPostal: String(item?.codPostal || '').trim(),
        reason: String(item?.reason || '').trim(),
      })).filter((item) => item.codPostal)
    : [];
}

function loadAllianzPostalAliases(customAliases) {
  if (Array.isArray(customAliases)) return normalizeAllianzPostalAliases(customAliases);
  if (postalAliasCache) return postalAliasCache;
  try {
    if (!fs.existsSync(POSTAL_ALIASES_JSON_PATH)) {
      postalAliasCache = [];
      return postalAliasCache;
    }
    const raw = JSON.parse(fs.readFileSync(POSTAL_ALIASES_JSON_PATH, 'utf8'));
    postalAliasCache = normalizeAllianzPostalAliases(raw);
    return postalAliasCache;
  } catch {
    postalAliasCache = [];
    return postalAliasCache;
  }
}

function resolveAllianzPostalCode({ fila = {}, cabecera = {}, postalAliases } = {}) {
  const originalCodigoPostal = pick([
    fila?.codigo_postal,
    fila?.codpostal,
    fila?.CP,
    fila?.cp,
    cabecera?.cp,
  ]).replace(/\D+/g, '').slice(0, 7);
  if (!originalCodigoPostal) {
    return {
      codigoPostal: '',
      originalCodigoPostal: '',
      aliasApplied: false,
      aliasReason: '',
    };
  }

  const localidad = normalizeText(pick([
    fila?.localidad,
    fila?.Localidad,
    fila?.ciudad,
    fila?.Ciudad,
    cabecera?.localidad,
  ]));
  const provincia = normalizeText(pick([
    fila?.provincia,
    fila?.Provincia,
    cabecera?.provincia,
  ]));

  const alias = loadAllianzPostalAliases(postalAliases).find((item) => {
    if (item.inputCodPostal && item.inputCodPostal !== originalCodigoPostal) return false;
    if (item.inputLocalidad && item.inputLocalidad !== localidad) return false;
    if (item.inputProvincia && item.inputProvincia !== provincia) return false;
    return true;
  });

  return {
    codigoPostal: alias?.codPostal || originalCodigoPostal,
    originalCodigoPostal,
    aliasApplied: Boolean(alias?.codPostal && alias.codPostal !== originalCodigoPostal),
    aliasReason: alias?.reason || '',
  };
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{8}$/.test(raw)) {
    const yyyy = raw.slice(0, 4);
    const mm = raw.slice(4, 6);
    const dd = raw.slice(6, 8);
    if (Number(yyyy) > 1900) return `${yyyy}-${mm}-${dd}T00:00:00.000-03:00`;
    return `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}T00:00:00.000-03:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000-03:00`;
  return raw;
}

function addMonthsIso(dateLike, months) {
  const dt = new Date(dateLike instanceof Date ? dateLike : new Date(dateLike));
  dt.setMonth(dt.getMonth() + months);
  return `${dt.toISOString().slice(0, 10)}T00:00:00.000-03:00`;
}

function resolveAllianzVehicleValue(fila = {}, cfg = {}) {
  const direct = pick([
    fila?.valorVehiculo,
    fila?.valor_vehiculo,
    fila?.valorVeh,
    fila?.valor_veh,
    fila?.suma,
    fila?.suma_asegurada,
  ]);
  if (direct) return String(direct).replace(',', '.');
  return String(cfg?.parametros_extras?.valor_vehiculo_default || '0');
}

function resolveAllianzUseCode({ fila = {}, cabecera = {}, mapeos = {}, usoDicc = {} }) {
  if (mapeos?.uso_codigo) return String(mapeos.uso_codigo).trim();
  const raw = normalizeText(pick([fila?.uso, fila?.Uso, cabecera?.uso, cabecera?.uso_default]));
  if (usoDicc && Object.keys(usoDicc).length) {
    if (raw.includes('PART')) return String(usoDicc.particular || '1');
    if (raw.includes('COMER')) return String(usoDicc.comercial || '2');
    if (raw.includes('TAX')) return String(usoDicc.taxi || usoDicc.comercial || '2');
  }
  if (raw.includes('COMER')) return '2';
  return '1';
}

function resolveAllianzIvaCode(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.iva);
  const map = {
    CF: '1',
    'CONSUMIDOR FINAL': '1',
    RI: '2',
    'RESPONSABLE INSCRIPTO': '2',
    EX: '3',
    EXENTO: '3',
    MT: '4',
    MONOTRIBUTO: '4',
  };
  return map[raw] || String(cfg?.parametros_extras?.codigo_condicion_iva_default || '1');
}

function resolveAllianzIibbCode(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.iibb);
  const map = {
    CF: '1',
    EX: '2',
    EXENTO: '2',
  };
  return map[raw] || String(cfg?.parametros_extras?.codigo_condicion_iibb_default || '1');
}

function resolveAllianzDocumentType(cabecera = {}, cfg = {}) {
  const raw = normalizeText(cabecera?.tipodoc);
  const map = {
    DNI: 'D',
    LC: 'L',
    LE: 'E',
    CUIT: 'C',
    CUIL: 'C',
    PAS: 'P',
  };
  return map[raw] || String(cfg?.parametros_extras?.tipo_documento_default || 'D');
}

function resolveAllianzGender(cabecera = {}) {
  const raw = normalizeText(cabecera?.sexo);
  if (raw === 'F' || raw.includes('MUJ')) return 'M';
  if (raw === 'J') return 'J';
  return 'H';
}

function resolveAllianzPayment({ cabecera = {}, cfg = {} }) {
  const raw = normalizeText(
    cabecera?.medio_pago ??
    cabecera?.medioPago ??
    cabecera?.forma_pago ??
    cabecera?.formaPago ??
    ''
  );

  const medio = ['TC', 'CBU', 'DC', 'TARJETA DE CREDITO', 'TARJETA', 'CREDITO'].includes(raw)
    ? 'T'
    : ['EF', 'EFECTIVO', 'E', 'PAGO FACIL', 'RAPIPAGO'].includes(raw)
      ? 'E'
      : String(cfg?.parametros_extras?.medio_pago_default || 'T');

  const policy = String(cfg?.parametros_extras?.tipo_poliza_default || 'M').toUpperCase();
  let cuotas = String(cfg?.parametros_extras?.cantidad_cuotas_default || '1');
  if (policy === 'S' && cuotas === '1') cuotas = medio === 'T' ? '6' : '1';
  if (policy === 'A' && cuotas === '1') cuotas = medio === 'T' ? '12' : '1';
  return { medioDePago: medio, tipoDePoliza: policy, cantidadDeCuotas: cuotas };
}

function buildDiscountXml(cfg = {}) {
  const value = String(cfg?.descuento_comercial || cfg?.parametros_extras?.descuento_comercial || '').trim();
  if (!value) return '';
  const amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount === 0) return '';
  // Allianz documenta 001 para rebaja y 002 para recargo.
  const codigoEsquema = amount < 0 ? '001' : '002';
  const valor = Math.abs(amount);
  return `
               <cot:ListaEsquemasComerciales>
                  <cot:EsquemaComercial>
                     <cot:codigoEsquema>${codigoEsquema}</cot:codigoEsquema>
                     <cot:ListaConfiguracion>
                        <cot:Configuracion>
                           <cot:codigo>001</cot:codigo>
                           <cot:valor>${escapeXml(String(valor))}</cot:valor>
                        </cot:Configuracion>
                     </cot:ListaConfiguracion>
                  </cot:EsquemaComercial>
               </cot:ListaEsquemasComerciales>`.trimEnd();
}

async function buildAllianzEnvelope({
  fila = {},
  cabecera = {},
  cfg = {},
  mapeos = {},
  usoDicc = {},
  today = new Date(),
  postalAliases,
} = {}) {
  const codigoMarcaModelo = pick([
    fila?.infoautocod,
    fila?.tau_codia,
    fila?.codigo_infoauto,
    fila?.cod_infoauto,
    fila?.codigoInfoauto,
    fila?.CodigoInfoauto,
    fila?.InfoAutoCod,
    fila?.infoauto,
  ]);
  const anioFabricacion = pick([fila?.anio, fila?.anofab, fila?.ANO, fila?.Anio, fila?.ano]);
  const postal = resolveAllianzPostalCode({ fila, cabecera, postalAliases });
  const codigoPostal = postal.codigoPostal;
  const numeroDocumento = pick([cabecera?.nrodoc, cabecera?.numeroDocumento, fila?.nrodoc]).replace(/\D+/g, '');

  if (!codigoMarcaModelo) throw new Error('Allianz requiere codigoMarcaModelo');
  if (!anioFabricacion) throw new Error('Allianz requiere anioFabricacion');
  if (!codigoPostal) throw new Error('Allianz requiere codigoPostal');

  const payment = resolveAllianzPayment({ cabecera, cfg });
  const fechaDesde = `${new Date(today).toISOString().slice(0, 10)}T00:00:00.000-03:00`;
  const months = payment.tipoDePoliza === 'S' ? 6 : payment.tipoDePoliza === 'A' ? 12 : 1;
  const fechaHasta = addMonthsIso(today, months);
  const fechaNacimiento = normalizeIsoDate(cabecera?.fec_nac);
  const valorVehiculo = resolveAllianzVehicleValue(fila, cfg);
  const clausula = String(cfg?.clausula_ajuste || cfg?.parametros_extras?.clausula_ajuste || '').trim();
  const tracking = resolveCompanyTracking(cabecera, 'allianz', cfg);
  const hasTracking = Boolean(tracking.mappedValue?.tieneAlarma);
  const alarmType = tracking.mappedValue?.codigoTipoAlarma || '';
  const discountXml = buildDiscountXml(cfg);
  const application = String(cfg?.application || '').trim();
  const username = String(cfg?.usuario || '').trim();
  const password = String(cfg?.password || '').trim();
  const senderUsername = String(cfg?.sender_username || cfg?.parametros_extras?.sender_username || username).trim();

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cot="http://xmlns.allianz.com.ar/Core/EBM/Vehiculo/CotizacionVehiculo"
                  xmlns:ebm="http://xmlns.allianz.com.ar/CommonCore/EBM"
                  xmlns:con="http://xmlns.allianz.com.ar/Core/EBO/Allianz/CondicionesContratacion">
   <soapenv:Header>
      <user>${escapeXml(username)}</user>
      <pwd>${escapeXml(password)}</pwd>
   </soapenv:Header>
   <soapenv:Body>
      <cot:CalcularCotizacionFullVehiculoEBM>
         <ebm:EBMHeader>
            <ebm:Sender>
               <ebm:userName>${escapeXml(senderUsername)}</ebm:userName>
               <ebm:Application>${escapeXml(application)}</ebm:Application>
               <ebm:Country>${escapeXml(cfg?.country || 'ARG')}</ebm:Country>
            </ebm:Sender>
            <ebm:Target>${escapeXml(cfg?.target || 'Allianz')}</ebm:Target>
         </ebm:EBMHeader>
         <cot:DataArea>
            <cot:CalcularCotizacionFullVehiculo>
               <cot:codigoDeProductor>${escapeXml(cfg?.producer_code || '')}</cot:codigoDeProductor>
               <cot:VehiculoACotizar>
                  <cot:codigoMarcaModelo>${escapeXml(codigoMarcaModelo)}</cot:codigoMarcaModelo>
                  <cot:anioFabricacion>${escapeXml(anioFabricacion)}</cot:anioFabricacion>
                  <cot:valorVehiculo>${escapeXml(valorVehiculo)}</cot:valorVehiculo>
                  <cot:codigoDeUso>${escapeXml(resolveAllianzUseCode({ fila, cabecera, mapeos, usoDicc }))}</cot:codigoDeUso>
                  <cot:es0Km>${cabecera?.cerokm === '1' ? 'true' : 'false'}</cot:es0Km>
                  <cot:tieneAlarma>${hasTracking || cfg?.parametros_extras?.use_alarm_default === true ? 'true' : 'false'}</cot:tieneAlarma>
                  ${alarmType ? `<cot:codigoTipoAlarma>${alarmType}</cot:codigoTipoAlarma>` : ''}
               </cot:VehiculoACotizar>
               <con:CondicionesContratacion>
                  <con:tipoDePoliza>${escapeXml(payment.tipoDePoliza)}</con:tipoDePoliza>
                  <con:medioDePago>${escapeXml(payment.medioDePago)}</con:medioDePago>
                  <con:cantidadDeCuotas>${escapeXml(payment.cantidadDeCuotas)}</con:cantidadDeCuotas>
                  <con:codigoCondicionIVA>${escapeXml(resolveAllianzIvaCode(cabecera, cfg))}</con:codigoCondicionIVA>
                  <con:codigoCondicionIIBB>${escapeXml(resolveAllianzIibbCode(cabecera, cfg))}</con:codigoCondicionIIBB>
                  <con:tipoDocumentoTomador>${escapeXml(resolveAllianzDocumentType(cabecera, cfg))}</con:tipoDocumentoTomador>
                  <con:numeroDocumentoTomador>${escapeXml(numeroDocumento || '0')}</con:numeroDocumentoTomador>
                  ${clausula ? `<con:clausulaDeAjuste>${escapeXml(clausula)}</con:clausulaDeAjuste>` : ''}
                  <con:fechaDesde>${escapeXml(fechaDesde)}</con:fechaDesde>
                  <con:fechaHasta>${escapeXml(fechaHasta)}</con:fechaHasta>
                  ${fechaNacimiento ? `<con:fechaNacimientoAsegurado>${escapeXml(fechaNacimiento)}</con:fechaNacimientoAsegurado>` : ''}
                  <con:sexoDelAsegurado>${escapeXml(resolveAllianzGender(cabecera))}</con:sexoDelAsegurado>
               </con:CondicionesContratacion>
               <cot:UbicacionDelRiesgo>
                  <cot:codigoPostal>${escapeXml(codigoPostal)}</cot:codigoPostal>
                  <cot:codigoProvincia>${escapeXml(cfg?.parametros_extras?.codigo_provincia_default || '0')}</cot:codigoProvincia>
                  ${cfg?.parametros_extras?.codigo_zona_riesgo_default ? `<cot:codigoZonaDeRiesgo>${escapeXml(cfg.parametros_extras.codigo_zona_riesgo_default)}</cot:codigoZonaDeRiesgo>` : '<cot:codigoZonaDeRiesgo/>'}
               </cot:UbicacionDelRiesgo>
${discountXml ? `               ${discountXml}` : ''}
            </cot:CalcularCotizacionFullVehiculo>
         </cot:DataArea>
      </cot:CalcularCotizacionFullVehiculoEBM>
   </soapenv:Body>
</soapenv:Envelope>`.trim();

  return {
    envelope,
    requestMeta: {
      codigoMarcaModelo,
      anioFabricacion,
      valorVehiculo,
      codigoDeUso: resolveAllianzUseCode({ fila, cabecera, mapeos, usoDicc }),
      tipoDePoliza: payment.tipoDePoliza,
      medioDePago: payment.medioDePago,
      cantidadDeCuotas: payment.cantidadDeCuotas,
      codigoPostal,
      codigoPostalOriginal: postal.originalCodigoPostal,
      codigoPostalAliasApplied: postal.aliasApplied,
      codigoPostalAliasReason: postal.aliasReason,
      codigoProvincia: String(cfg?.parametros_extras?.codigo_provincia_default || '0'),
      codigoDeProductor: String(cfg?.producer_code || ''),
      clausulaDeAjuste: clausula,
      fechaDesde,
      fechaHasta,
    },
  };
}

function parseAllianzQuoteResponse(xml) {
  const parsed = parser.parse(String(xml || ''));
  const body = parsed?.Envelope?.Body || {};
  const fault = body?.Fault;
  if (fault) {
    return {
      ok: false,
      error: asText(fault?.faultstring || 'SOAP Fault Allianz'),
      coberturas: [],
      raw: xml,
    };
  }

  const response = body?.CalcularCotizacionFullVehiculoResponseEBM;
  if (!response) {
    return { ok: false, error: 'Respuesta Allianz inválida', coberturas: [], raw: xml };
  }

  const returnCode = asText(response?.ReturnCode);
  const returnMessage = asText(response?.ReturnMessage);
  const errorCode = asText(response?.ErrorCode);
  if (returnCode && returnCode !== '0') {
    return {
      ok: false,
      error: returnMessage || errorCode || `Allianz ReturnCode=${returnCode}`,
      coberturas: [],
      raw: xml,
    };
  }

  const cotizacion = response?.DataArea?.CalcularCotizacionFullVehiculoResponse || {};
  const numeroDeCotizacion = asText(cotizacion?.numeroDeCotizacion);
  const lista = asArray(cotizacion?.ListaCotizacionFull?.CotizacionFull).map((item) => ({
    codigoDeCobertura: asText(item?.codigoDeCobertura),
    descripcionDeCobertura: asText(item?.descripcionDeCobertura),
    codigoDeProducto: asText(item?.codigoDeProducto),
    descripcionDeProducto: asText(item?.descripcionDeProducto),
    importePrima: asText(item?.prima?.importePrima),
    importePrimaRC: asText(item?.prima?.importePrimaRC),
    importePrimaCasco: asText(item?.prima?.importePrimaCasco),
    importePremio: asText(item?.premio?.importePremio),
    importeSellados: asText(item?.impuestos?.importeSellados),
    porcentajeIVA: asText(item?.impuestos?.porcentajeIVA),
    importeIVA: asText(item?.impuestos?.importeIVA),
    importeIngresosBrutos: asText(item?.impuestos?.importeIngresosBrutos),
    importeTotalImpuestos: asText(item?.impuestos?.importeTotalImpuestos),
    sumaAsegurada: asText(item?.sumaAsegurada),
    porcentajeRecargoFinanciero: asText(item?.porcentajeRecargoFinanciero),
    importeRecargoFinanciero: asText(item?.importeRecargoFinanciero),
    requiereInspeccion: asText(item?.requiereInspeccion),
    valorComisionPAS: asText(item?.valorComisionPAS),
    porcentajeComisionPAS: asText(item?.porcentajeComisionPAS),
    franquicias: asArray(item?.ListaFranquicias?.Franquicia).map((fr) => ({
      codigoTipoFranquicia: asText(fr?.codigoTipoFranquicia),
      valorFranquicia: asText(fr?.valorFranquicia),
    })),
  }));

  return {
    ok: true,
    operacion: numeroDeCotizacion,
    suma_asegurada: asText(lista[0]?.sumaAsegurada),
    coberturas: lista,
    raw: xml,
  };
}

module.exports = {
  buildAllianzEnvelope,
  parseAllianzQuoteResponse,
  resolveAllianzPayment,
  resolveAllianzPostalCode,
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractMapfreGncSuggestedAmount,
  readMapfreGncSuggestion,
  refreshMapfreGncSuggestion,
  suggestionPath,
} = require('../services/mapfre/gnc_suggestion');

describe('Mapfre GNC suggestion', () => {
  function buildDataRoot() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoiq-mapfre-gnc-'));
    const dataRoot = path.join(tmpRoot, 'data');
    fs.mkdirSync(path.join(dataRoot, 'mapfre'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'mapfre', 'aseguradora.json'), JSON.stringify({
      base_url: 'https://ws.mapfre.example',
      soap_path: '/api/srv/SuscripcionAutosService',
      soap_method: 'cotizar',
      codAgt: '21062',
      claveAcceso: '21NOVEC0',
      claveProcedencia: '',
      tipoFacturacion: 'M',
      parametros_extras: {
        moneda: '1',
        cobertura_default: '0',
        tipo_persona_default: 'F',
        condicion_iva_default: '5',
        tipo_medio_pago_default: 'TC',
        cod_prov_default: '0',
        guarda_gge_default: '0',
        porcentaje_ajuste_default: '',
      },
    }), 'utf8');
    return dataRoot;
  }

  const probe = {
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
    postalCatalog: [
      {
        codigo_postal: '1650',
        codigo_mapfre: '1650001',
        descripcion: 'SAN MARTIN',
        codigo_provincia: '1',
        provincia: 'BUENOS AIRES',
      },
    ],
  };

  test('extrae el valor sugerido desde el mensaje de Mapfre', () => {
    expect(
      extractMapfreGncSuggestedAmount('LA SUMA ASEGURADA DEL GNC NO ES CORRECTA. EL VALOR SUGERIDO ES DE 1000000 (43-24)')
    ).toBe(1000000);
    expect(extractMapfreGncSuggestedAmount('sin valor')).toBeNull();
  });

  test('refresca y persiste la sugerencia cuando Mapfre informa valor sugerido', async () => {
    const dataRoot = buildDataRoot();
    const xml = `<?xml version='1.0' encoding='UTF-8'?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns1:cotizarResponse xmlns:ns1="http://ws.mapfre.com.ar/SuscripcionAutos">
      <ns1:errores>
        <ns1:error>
          <ns1:codigo>43</ns1:codigo>
          <ns1:descripcion>LA SUMA ASEGURADA DEL GNC NO ES CORRECTA. EL VALOR SUGERIDO ES DE 1000000 (43-24)</ns1:descripcion>
        </ns1:error>
      </ns1:errores>
    </ns1:cotizarResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const out = await refreshMapfreGncSuggestion({
      dataRoot,
      now: new Date('2026-08-04T12:00:00.000Z'),
      probe,
      httpPost: async (_url, body) => {
        expect(body).toContain('<valorGNC>300000</valorGNC>');
        return { status: 200, data: xml };
      },
    });

    expect(out.ok).toBe(true);
    expect(out.value).toBe(1000000);
    expect(out.formatted).toBe('1.000.000');
    expect(out.updated_date).toBe('04/08/26');
    expect(fs.existsSync(suggestionPath(dataRoot))).toBe(true);

    const persisted = readMapfreGncSuggestion({ dataRoot });
    expect(persisted.value).toBe(1000000);
  });

  test('no pisa el valor anterior si el sondeo no informa sugerencia', async () => {
    const dataRoot = buildDataRoot();
    fs.mkdirSync(path.dirname(suggestionPath(dataRoot)), { recursive: true });
    fs.writeFileSync(suggestionPath(dataRoot), JSON.stringify({
      company: 'mapfre',
      concept: 'gnc_suggested_amount',
      ok: true,
      value: 1000000,
      formatted: '1.000.000',
      updated_date: '04/08/26',
    }), 'utf8');

    const out = await refreshMapfreGncSuggestion({
      dataRoot,
      probe,
      httpPost: async () => ({ status: 200, data: '<invalid />' }),
    });

    expect(out.ok).toBe(false);
    expect(readMapfreGncSuggestion({ dataRoot }).value).toBe(1000000);
  });
});

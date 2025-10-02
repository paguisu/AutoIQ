const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

async function cotizarSOAP(docInXml) {
  const baseURL = process.env.ATM_BASE_URL || "https://wsatm.atmseguros.com.ar";
  const url = `${baseURL}/index.php/soap`;
  const headers = {
    "Content-Type": "text/xml; charset=UTF-8",
    "SOAPAction": "http://tempuri.org/AUTOS_Cotizar_PHP",
  };

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <AUTOS_Cotizar_PHP xmlns="http://tempuri.org/">
      <doc_in><![CDATA[
${docInXml}
      ]]></doc_in>
    </AUTOS_Cotizar_PHP>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const res = await axios.post(url, envelope, { headers, validateStatus: () => true });

  if (res.status !== 200) {
    return { ok:false, status:res.status, raw:res.data };
  }

  // Parseo XML → JSON
  const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:"@", trimValues:true });
  const json = parser.parse(res.data);

  // Intento extraer la parte útil (coberturas)
  const body = json["SOAP-ENV:Envelope"]["SOAP-ENV:Body"];
  const result = body["ns1:AUTOS_Cotizar_PHPResponse"]?.["ns1:AUTOS_Cotizar_PHPResult"]
              || body["AUTOS_Cotizar_PHPResponse"]?.["AUTOS_Cotizar_PHPResult"]; // por las namespaces variables
  const auto = result?.auto;

  return { ok:true, status:200, data:auto, raw:json };
}

module.exports = { cotizarSOAP };

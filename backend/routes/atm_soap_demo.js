const express = require("express");
const { cotizarSOAP } = require("../services/atm/soapClient");
const router = express.Router();

router.post("/cotizar-soap-demo", async (req, res) => {
  try {
    const xmlAuto = `
<auto>
  <usuario>
    <usa>PNONCECOM</usa>
    <pass>s91101</pass>
    <fecha>02102025</fecha>
    <vendedor>0067804766</vendedor>
    <vigencia>A</vigencia>
    <origen>WS</origen>
    <plan>02</plan>
  </usuario>
  <asegurado>
    <persona>F</persona>
    <iva>CF</iva>
    <infomotoclub>N</infomotoclub>
    <bonificacion>30</bonificacion>
  </asegurado>
  <bien>
    <seccion>3</seccion>
    <ajuste>010</ajuste>
    <marca>32</marca>
    <modelo>612</modelo>
    <uso>101</uso>
    <tipo_uso>1</tipo_uso>
    <anofab>2013</anofab>
    <cerokm>N</cerokm>
    <sub_cp>1</sub_cp>
    <suma>12480000,00</suma>
    <codpostal>1609</codpostal>
    <rastreo>N</rastreo>
    <micrograbado>-21</micrograbado>
    <alarma>0</alarma>
  </bien>
</auto>`.trim();

    const out = await cotizarSOAP(xmlAuto);
    if (!out.ok) return res.status(out.status || 500).json({ error: "ATM SOAP error", raw: out.raw });

    // Normalizo un poco la salida: operación, coberturas
    const operacion = out.data?.operacion;
    const cotizacion = out.data?.cotizacion;
    let coberturas = [];
    if (cotizacion?.cobertura) {
      coberturas = Array.isArray(cotizacion.cobertura) ? cotizacion.cobertura : [cotizacion.cobertura];
      coberturas = coberturas.map(c => ({
        codigo: c.codigo, descripcion: c.descripcion, premio: c.premio, prima: c.prima, cuotas: c.cuotas
      }));
    }

    return res.json({ ok:true, operacion, coberturas, raw: out.data });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = router;

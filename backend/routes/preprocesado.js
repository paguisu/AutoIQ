// backend/routes/preprocesado.js
// Previsualiza el completado de faltantes por fila usando la misma lógica
// que el proceso de cotización real.

const express = require('express');
const {
  completarYMapear,
  cargarDiccionarios,
  getCabeceraByIdHTTP,
} = require('../utils/preprocesado_helper');

const router = express.Router();

router.post('/preview', async (req, res) => {
  try {
    const { aseguradora = 'atm', cabecera_id, fila } = req.body || {};
    if (!fila || typeof fila !== 'object') {
      return res.status(400).json({ ok: false, error: 'Body inválido: se espera { cabecera_id?, fila }' });
    }

    const dicc = await cargarDiccionarios(aseguradora);
    const cabecera = cabecera_id != null ? await getCabeceraByIdHTTP(cabecera_id) : null;
    const result = await completarYMapear({ fila, cabecera, dicc, slug: aseguradora });

    res.json({
      ok: true,
      aseguradora,
      cabecera_id: cabecera_id ?? null,
      result: {
        fila_original: fila,
        completada: result.fila_preparada,
        mapeos: result.mapeos,
        fuentes: result.fuentes,
        atm_vehicle: result.atm_vehicle,
      },
    });
  } catch (err) {
    console.error('preprocesado:preview', err);
    res.status(500).json({
      ok: false,
      error: 'Fallo en preprocesado',
      detail: String(err && (err.code || err.message || err))
    });
  }
});

module.exports = router;

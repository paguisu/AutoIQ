// utils/cotizador.js
function cotizarConCompania(compania, datosVehiculo, datosAsegurado) {
    return {
        compania,
        plan: "Responsabilidad Civil",
        prima_total: 24300 + Math.floor(Math.random() * 4000),
        rc: 18000,
        casco: 0,
        franquicia: "No aplica",
        vigencia: "Mensual",
        medio_pago: datosAsegurado.medio_pago,
        vehiculo: datosVehiculo.Modelo || "Desconocido",
        edad: datosAsegurado.edad,
        estado_civil: datosAsegurado.estado_civil
    };
}

module.exports = cotizarConCompania;
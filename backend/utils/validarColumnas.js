
const validarColumnas = (tipo, encabezados) => {
    const columnasEsperadas = {
        combinatoriaVehiculos: ["anio", "Marca", "Modelo", "infoautocod", "cerokm", "uso", "tipo_vehiculo"],
        combinatoriaCP: ["Provincia", "Localidad", "CP"],
        taxativa: ["anio", "Marca", "Modelo", "infoautocod", "cerokm", "Provincia", "Localidad", "CP", "uso", "tipo_vehiculo"]
    };

    const faltantes = (esperadas) => esperadas.filter(col => !encabezados.includes(col));

    if (tipo === "combinatoriaVehiculos") {
        return faltantes(columnasEsperadas.combinatoriaVehiculos);
    }
    if (tipo === "combinatoriaCP") {
        return faltantes(columnasEsperadas.combinatoriaCP);
    }
    if (tipo === "taxativa") {
        return faltantes(columnasEsperadas.taxativa);
    }
    return ["Tipo de validación desconocido"];
};

module.exports = validarColumnas;

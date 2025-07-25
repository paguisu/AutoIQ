const db = require('../config/db');

async function buscarEnBasePropia(infoautocod) {
    const [rows] = await db.execute(
        'SELECT tipo_vehiculo FROM datos_vehiculos_propios WHERE infoautocod = ? LIMIT 1',
        [infoautocod]
    );
    return rows.length > 0 ? rows[0].tipo_vehiculo : null;
}

async function consultarApiExterna(infoautocod) {
    // 🚧 Simulación de respuesta externa (reemplazable por API real)
    const resultadosSimulados = {
        '123456': 'SUV',
        '999999': 'Pick-Up A'
    };
    return resultadosSimulados[infoautocod] || null;
}

function inferirHeuristicamente(marca, modelo) {
    const texto = `${marca} ${modelo}`.toLowerCase();
    if (texto.includes("pick") || texto.includes("hilux")) return "Pick-Up A";
    if (texto.includes("suv") || texto.includes("tracker") || texto.includes("creta")) return "SUV";
    if (texto.includes("hatch")) return "Hatchback";
    return "Sedán";
}

async function guardarEnBase(infoautocod, marca, modelo, tipoVehiculo) {
    await db.execute(
        'INSERT INTO datos_vehiculos_propios (infoautocod, Marca, Modelo, tipo_vehiculo) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tipo_vehiculo = VALUES(tipo_vehiculo)',
        [infoautocod, marca, modelo, tipoVehiculo]
    );
}

async function inferirTipoVehiculo(row) {
    const cod = row.infoautocod || '';
    const marca = row.Marca || '';
    const modelo = row.Modelo || '';

    if (!cod) return 'Sedán';

    let tipo = await buscarEnBasePropia(cod);
    if (tipo) return tipo;

    tipo = await consultarApiExterna(cod);
    if (tipo) {
        await guardarEnBase(cod, marca, modelo, tipo);
        return tipo;
    }

    tipo = inferirHeuristicamente(marca, modelo);
    await guardarEnBase(cod, marca, modelo, tipo);
    return tipo;
}

module.exports = inferirTipoVehiculo;
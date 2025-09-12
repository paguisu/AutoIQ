// backend/utils/historialCombinaciones.js
// Registrar una combinación en la tabla historial_combinaciones
// Uso: await registrarCombinacion({ pool, nombreArchivo, ruta, fecha, cantidadRegistros })

/**
 * Inserta un registro en historial_combinaciones.
 * @param {object} params
 * @param {import('mysql2/promise').Pool} params.pool - Pool de MySQL (mysql2/promise)
 * @param {string} params.nombreArchivo - Nombre de archivo (ej: "combinado-<ts>.xlsx")
 * @param {string} params.ruta - Ruta relativa/absoluta donde quedó guardado
 * @param {Date|string} [params.fecha=new Date()] - Fecha/hora (Date o string 'YYYY-MM-DD HH:mm:ss')
 * @param {number} params.cantidadRegistros - Cantidad de filas combinadas
 */
async function registrarCombinacion({ pool, nombreArchivo, ruta, fecha = new Date(), cantidadRegistros }) {
  if (!pool) throw new Error('registrarCombinacion: falta pool');
  if (!nombreArchivo) throw new Error('registrarCombinacion: falta nombreArchivo');
  if (typeof ruta !== 'string') throw new Error('registrarCombinacion: ruta debe ser string');
  if (typeof cantidadRegistros !== 'number') throw new Error('registrarCombinacion: cantidadRegistros debe ser number');

  // Normalizar fecha a 'YYYY-MM-DD HH:mm:ss' si viene como Date
  let fechaStr;
  if (fecha instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    fechaStr = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}:${pad(fecha.getSeconds())}`;
  } else {
    fechaStr = String(fecha);
  }

  const sql = `
    INSERT INTO historial_combinaciones (nombre_archivo, ruta, fecha, cantidad_registros)
    VALUES (?, ?, ?, ?)
  `;
  const params = [nombreArchivo, ruta, fechaStr, cantidadRegistros];

  const conn = await pool.getConnection();
  try {
    await conn.execute(sql, params);
  } finally {
    conn.release();
  }
}

module.exports = { registrarCombinacion };

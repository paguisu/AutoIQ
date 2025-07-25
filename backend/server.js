const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const combinarArchivos = require('../scripts/combinador');
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'data/archivos_subidos/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });
app.use(express.static('frontend'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.post('/upload', upload.fields([
    { name: 'archivoVehiculos', maxCount: 1 },
    { name: 'archivoCP', maxCount: 1 },
    { name: 'archivoUnico', maxCount: 1 }
]), async (req, res) => {
    let mensaje = '<h2>Resultado de la carga</h2><ul>';
    try {
        if (req.files.archivoVehiculos && req.files.archivoCP) {
            // MODO COMBINATORIO
            const fileVeh = req.files.archivoVehiculos[0];
            const fileCP = req.files.archivoCP[0];

            const wbVeh = xlsx.readFile(fileVeh.path);
            const vehHojaNombre = wbVeh.SheetNames.find(name => {
                const datos = xlsx.utils.sheet_to_json(wbVeh.Sheets[name]);
                return datos.length > 0;
            });
            if (!vehHojaNombre) throw new Error("El archivo de vehículos no contiene hojas con datos");

            const wbCP = xlsx.readFile(fileCP.path);
            const cpHojaNombre = wbCP.SheetNames.find(name => {
                const datos = xlsx.utils.sheet_to_json(wbCP.Sheets[name]);
                return datos.length > 0;
            });
            if (!cpHojaNombre) throw new Error("El archivo de códigos postales no contiene hojas con datos");

            let rowsVeh = xlsx.utils.sheet_to_json(wbVeh.Sheets[vehHojaNombre]);
            const rowsCP = xlsx.utils.sheet_to_json(wbCP.Sheets[cpHojaNombre]);

            let completadosUso = 0;
            let completadosTipo = 0;

            rowsVeh = rowsVeh.map(function(row) {
                let newRow = Object.assign({}, row);
                if (!newRow.uso) {
                    newRow.uso = "Particular";
                    completadosUso++;
                }
                if (!newRow.tipo_vehiculo) {
                    newRow.tipo_vehiculo = "Sedán";
                    completadosTipo++;
                }
                return newRow;
            });

            const columnasVeh = Object.keys(rowsVeh[0] || {});
            const columnasCP = Object.keys(rowsCP[0] || {});

            const faltanVeh = validarColumnas("combinatoriaVehiculos", columnasVeh);
            const faltanCP = validarColumnas("combinatoriaCP", columnasCP);

            mensaje += `<li><strong>Columnas detectadas en archivo de vehículos:</strong> ${columnasVeh.join(", ") || "(ninguna)"}</li>`;
            mensaje += `<li><strong>Columnas detectadas en archivo de códigos postales:</strong> ${columnasCP.join(", ") || "(ninguna)"}</li>`;

            if (faltanVeh.length > 0 || faltanCP.length > 0) {
                mensaje += '<li style="color:red;">❌ Error: Las siguientes columnas faltan:</li><ul>';
                if (faltanVeh.length > 0) {
                    mensaje += `<li>Vehículos: ${faltanVeh.join(", ")}</li>`;
                }
                if (faltanCP.length > 0) {
                    mensaje += `<li>Códigos postales: ${faltanCP.join(", ")}</li>`;
                }
                mensaje += '</ul>';
            } else {
                mensaje += `<li>✅ Vehículos: ${rowsVeh.length} registros válidos</li>`;
                mensaje += `<li>✅ Códigos postales: ${rowsCP.length} registros válidos</li>`;

                if (completadosUso > 0 || completadosTipo > 0) {
                    mensaje += `<li style="color:orange;">⚠️ Se completaron automáticamente ${completadosUso} campos "uso" y ${completadosTipo} campos "tipo_vehiculo" con valores por defecto.</li>`;
                }

                const wsVehNew = xlsx.utils.json_to_sheet(rowsVeh);
                const wbVehNew = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, "Sheet1");
                const vehPathFinal = fileVeh.path.replace(".xlsx", "-ajustado.xlsx");
                xlsx.writeFile(wbVehNew, vehPathFinal);

                const nombreArchivo = `combinado-${Date.now()}.xlsx`;
                const rutaDestino = path.join(__dirname, '../data/combinados', nombreArchivo);
                const rutaPublica = path.join(__dirname, '../frontend/descargas', nombreArchivo);
                const totalCombinaciones = combinarArchivos(vehPathFinal, fileCP.path, rutaDestino);

                fs.copyFileSync(rutaDestino, rutaPublica);
                mensaje += `<li>📄 Archivo combinado generado con <strong>${totalCombinaciones}</strong> registros.</li>`;
                mensaje += `<li><a href="/descargas/${nombreArchivo}" download style="display:inline-block;margin-top:10px;">⬇️ Descargar archivo combinado</a></li>`;

                const fecha = new Date();
                await db.execute(
                    'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
                    [nombreArchivo, fecha, totalCombinaciones]
                );
            }
        } else if (req.files.archivoUnico) {
            // MODO TAXATIVO
            const fileUnico = req.files.archivoUnico[0];
            const wb = xlsx.readFile(fileUnico.path);
            const hojaNombre = wb.SheetNames.find(name => {
                const datos = xlsx.utils.sheet_to_json(wb.Sheets[name]);
                return datos.length > 0;
            });
            if (!hojaNombre) throw new Error("El archivo no contiene hojas con datos");

            let rows = xlsx.utils.sheet_to_json(wb.Sheets[hojaNombre]);

            let completadosUso = 0;
            let completadosTipo = 0;

            rows = rows.map(row => {
                const nuevo = { ...row };
                if (!nuevo.uso) {
                    nuevo.uso = "Particular";
                    completadosUso++;
                }
                if (!nuevo.tipo_vehiculo) {
                    nuevo.tipo_vehiculo = "Sedán";
                    completadosTipo++;
                }
                return nuevo;
            });

            const columnas = Object.keys(rows[0] || {});
            const faltan = validarColumnas("taxativa", columnas);

            mensaje += `<li><strong>Columnas detectadas:</strong> ${columnas.join(", ") || "(ninguna)"}</li>`;

            if (faltan.length > 0) {
                mensaje += `<li style="color:red;">❌ Error: Faltan columnas requeridas: ${faltan.join(", ")}</li>`;
            } else {
                mensaje += `<li>✅ Archivo contiene ${rows.length} registros válidos</li>`;
                if (completadosUso > 0 || completadosTipo > 0) {
                    mensaje += `<li style="color:orange;">⚠️ Se completaron automáticamente ${completadosUso} campos "uso" y ${completadosTipo} campos "tipo_vehiculo" con valores por defecto.</li>`;
                }

                const wbNew = xlsx.utils.book_new();
                const ws = xlsx.utils.json_to_sheet(rows);
                xlsx.utils.book_append_sheet(wbNew, ws, "Sheet1");

                const nombreArchivo = `taxativo-ajustado-${Date.now()}.xlsx`;
                const rutaFinal = path.join(__dirname, '../frontend/descargas', nombreArchivo);
                xlsx.writeFile(wbNew, rutaFinal);

                mensaje += `<li>📄 Archivo ajustado generado correctamente.</li>`;
                mensaje += `<li><a href="/descargas/${nombreArchivo}" download style="display:inline-block;margin-top:10px;">⬇️ Descargar archivo ajustado</a></li>`;
            }
        } else {
            mensaje += '<li style="color:red;">⚠️ No se detectaron archivos válidos.</li>';
        }
    } catch (error) {
        mensaje += `<li style="color:red;">❌ Error al procesar archivos: ${error.message}</li>`;
    }

    mensaje += '</ul><a href="/" style="display:inline-block;margin-top:20px;">🔙 Volver al inicio</a>';
    res.send(`<html><body style="font-family:Arial,sans-serif;">${mensaje}</body></html>`);
});

// Endpoint para devolver historial de combinaciones
app.get('/historial', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT id, nombre_archivo, DATE_FORMAT(fecha, "%Y-%m-%d %H:%i:%s") AS fecha, cantidad_registros FROM historial_combinaciones ORDER BY fecha DESC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
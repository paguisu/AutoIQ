const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const validarColumnas = require('./utils/validarColumnas');
const combinarArchivos = require('../scripts/combinador');
const db = require('./config/db');
const cotizarConCompania = require('./utils/cotizador');

const app = express();
const PORT = process.env.PORT || 3000;
const rutaSubidos = path.join(__dirname, '../data/archivos_subidos');
const rutaCombinados = path.join(__dirname, '../data/combinados');
const rutaDescargas = path.join(__dirname, '../frontend/descargas');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, rutaSubidos),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

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
            const fileVeh = req.files.archivoVehiculos[0];
            const fileCP = req.files.archivoCP[0];

            const wbVeh = xlsx.readFile(fileVeh.path);
            const wbCP = xlsx.readFile(fileCP.path);

            const hojaVeh = wbVeh.SheetNames[0];
            const hojaCP = wbCP.SheetNames[0];

            let rowsVeh = xlsx.utils.sheet_to_json(wbVeh.Sheets[hojaVeh]);
            const rowsCP = xlsx.utils.sheet_to_json(wbCP.Sheets[hojaCP]);

            let completadosUso = 0;
            let completadosTipo = 0;

            rowsVeh = rowsVeh.map(row => {
                if (!row.uso) { row.uso = 'Particular'; completadosUso++; }
                if (!row.tipo_vehiculo) { row.tipo_vehiculo = 'Sedán'; completadosTipo++; }
                return row;
            });

            const columnasVeh = Object.keys(rowsVeh[0] || {});
            const columnasCP = Object.keys(rowsCP[0] || {});

            const faltanVeh = validarColumnas('combinatoriaVehiculos', columnasVeh);
            const faltanCP = validarColumnas('combinatoriaCP', columnasCP);

            if (faltanVeh.length > 0 || faltanCP.length > 0) {
                mensaje += '<li style="color:red;">Faltan columnas requeridas</li>';
            } else {
                const wbVehNew = xlsx.utils.book_new();
                const wsVehNew = xlsx.utils.json_to_sheet(rowsVeh);
                xlsx.utils.book_append_sheet(wbVehNew, wsVehNew, 'Sheet1');
                const vehPathFinal = fileVeh.path.replace('.xlsx', '-ajustado.xlsx');
                xlsx.writeFile(wbVehNew, vehPathFinal);

                const nombreArchivo = `combinado-${Date.now()}.xlsx`;
                const rutaFinal = path.join(rutaCombinados, nombreArchivo);
                const rutaPublica = path.join(rutaDescargas, nombreArchivo);

                const total = combinarArchivos(vehPathFinal, fileCP.path, rutaFinal);
                fs.copyFileSync(rutaFinal, rutaPublica);

                await db.execute(
                    'INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)',
                    [nombreArchivo, new Date(), total]
                );

                mensaje += `<li>Archivo combinado generado con ${total} registros</li>`;
                mensaje += `<li><a href="/descargas/${nombreArchivo}" download>Descargar</a></li>`;
            }
        } else if (req.files.archivoUnico) {
            const fileUnico = req.files.archivoUnico[0];
            const wb = xlsx.readFile(fileUnico.path);
            const hoja = wb.SheetNames[0];
            let rows = xlsx.utils.sheet_to_json(wb.Sheets[hoja]);

            let completadosUso = 0;
            let completadosTipo = 0;
            rows = rows.map(row => {
                if (!row.uso) { row.uso = 'Particular'; completadosUso++; }
                if (!row.tipo_vehiculo) { row.tipo_vehiculo = 'Sedán'; completadosTipo++; }
                return row;
            });

            const columnas = Object.keys(rows[0] || {});
            const faltan = validarColumnas('taxativa', columnas);

            if (faltan.length > 0) {
                mensaje += '<li style="color:red;">Faltan columnas requeridas</li>';
            } else {
                const wbNew = xlsx.utils.book_new();
                const ws = xlsx.utils.json_to_sheet(rows);
                xlsx.utils.book_append_sheet(wbNew, ws, 'Sheet1');
                const nombreArchivo = `taxativo-ajustado-${Date.now()}.xlsx`;
                const rutaFinal = path.join(rutaDescargas, nombreArchivo);
                xlsx.writeFile(wbNew, rutaFinal);

                mensaje += `<li>Archivo ajustado generado</li>`;
                mensaje += `<li><a href="/descargas/${nombreArchivo}" download>Descargar</a></li>`;
            }
        } else {
            mensaje += '<li style="color:red;">No se detectaron archivos</li>';
        }
    } catch (error) {
        console.error(error);
        mensaje += `<li style="color:red;">Error: ${error.message}</li>`;
    }

    mensaje += '</ul><a href="/">Volver</a>';
    res.send(`<html><body>${mensaje}</body></html>`);
});

app.get('/historial', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, nombre_archivo, DATE_FORMAT(fecha, "%Y-%m-%d %H:%i:%s") as fecha, cantidad_registros FROM historial_combinaciones ORDER BY fecha DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

app.post('/cotizar', (req, res) => {
    try {
        const { registros, asegurado, companias } = req.body;
        if (!registros || !asegurado || !companias) {
            return res.status(400).json({ error: 'Faltan datos' });
        }
        const resultados = registros.flatMap(reg => companias.map(comp => cotizarConCompania(comp, reg, asegurado)));
        res.json({ cotizaciones: resultados });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error en cotización' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
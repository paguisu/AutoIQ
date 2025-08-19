// backend/server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const cors = require("cors");
const { upload: uploadXlsx } = require("./middleware/uploadxlsx");
const validarColumnas = require("./utils/validarColumnas");
const db = require("./config/db");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../frontend")));

function wrap(html) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Resultado</title>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;
}

function leerHoja(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const cols = Object.keys(rows[0] || {});
  return { rows, cols };
}

app.post(
  "/upload",
  uploadXlsx.fields([
    { name: "archivoVehiculos", maxCount: 1 },
    { name: "archivoCodigosPostales", maxCount: 1 },
    { name: "archivoUnico", maxCount: 1 },
  ]),
  async (req, res) => {
    let html = "<h2>Resultado de la carga</h2><ul>";

    try {
      const tieneVehiculos = !!req.files.archivoVehiculos;
      const tieneCP = !!req.files.archivoCodigosPostales;
      const tieneUnico = !!req.files.archivoUnico;

      // Validación estricta de combinación de archivos
      if (tieneUnico && (tieneVehiculos || tieneCP)) {
        return res.send(
          wrap(`<p style="color:red;">❌ No se puede subir archivo único junto con archivos para combinar.</p>`)
        );
      }
      if ((tieneVehiculos && !tieneCP) || (!tieneVehiculos && tieneCP)) {
        return res.send(
          wrap(`<p style="color:red;">❌ Para modo combinado, debe subir archivos de vehículos y códigos postales.</p>`)
        );
      }
      if (!tieneUnico && !(tieneVehiculos && tieneCP)) {
        return res.send(
          wrap(`<p style="color:red;">❌ Debe subir o bien un archivo único (modo taxativo), o bien los dos archivos requeridos (modo combinado).</p>`)
        );
      }

      // --- MODO COMBINATORIO ---
      if (tieneVehiculos && tieneCP) {
        const vehiculos = req.files.archivoVehiculos[0];
        const cp = req.files.archivoCodigosPostales[0];

        const veh = leerHoja(vehiculos.path);
        const cpHoja = leerHoja(cp.path);

        const faltanVeh = validarColumnas("combinatoriaVehiculos", veh.cols);
        const faltanCP = validarColumnas("combinatoriaCP", cpHoja.cols);

        if (faltanVeh.length || faltanCP.length) {
          html += "<li style='color:red;'>❌ Faltan columnas requeridas:</li>";
          if (faltanVeh.length) html += `<li>Vehículos: ${faltanVeh.join(", ")}</li>`;
          if (faltanCP.length) html += `<li>Códigos Postales: ${faltanCP.join(", ")}</li>`;
          return res.send(wrap(html));
        }

        let completadosUso = 0, completadosTipo = 0, completadosSuma = 0;
        const vehiculosAjustados = veh.rows.map((r) => {
          const row = { ...r };
          if (!row.uso) { row.uso = "Particular"; completadosUso++; }
          if (!row.tipo_vehiculo) { row.tipo_vehiculo = "Sedán"; completadosTipo++; }
          if (!row.suma) { row.suma = 0; completadosSuma++; }
          return row;
        });

        const combinados = vehiculosAjustados.flatMap((veh) =>
          cpHoja.rows.map((cp) => ({
            ...veh,
            Provincia: cp.Provincia,
            Localidad: cp.Localidad,
            CP: cp.CP,
          }))
        );

        const wbNuevo = xlsx.utils.book_new();
        const wsNuevo = xlsx.utils.json_to_sheet(combinados);
        xlsx.utils.book_append_sheet(wbNuevo, wsNuevo, "Sheet1");

        const nombreArchivo = `combinado-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, "../data/combinados", nombreArchivo);
        const rutaPublica = path.join(__dirname, "../frontend/descargas", nombreArchivo);

        fs.mkdirSync(path.dirname(rutaDestino), { recursive: true });
        fs.mkdirSync(path.dirname(rutaPublica), { recursive: true });

        xlsx.writeFile(wbNuevo, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        const fecha = new Date();
        await db.execute(
          "INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)",
          [nombreArchivo, fecha, combinados.length]
        );

        html += `<li>✅ Modo: <strong>Combinatorio</strong>.</li>`;
        html += `<li>📄 Archivo generado: <strong>${nombreArchivo}</strong></li>`;
        html += `<li>🧮 Registros: <strong>${combinados.length}</strong></li>`;
        if (completadosUso || completadosTipo || completadosSuma) {
          html += `<li style="color:orange;">⚠️ Completados por defecto → Uso: ${completadosUso}, Tipo: ${completadosTipo}, Suma: ${completadosSuma}.</li>`;
        }
        html += `<li><a href="/descargas/${nombreArchivo}" download>⬇️ Descargar</a></li>`;
      }

      // --- MODO TAXATIVO ---
      if (tieneUnico) {
        const unico = req.files.archivoUnico[0];
        const uno = leerHoja(unico.path);
        const faltanUnico = validarColumnas("taxativa", uno.cols);

        if (faltanUnico.length) {
          html += "<li style='color:red;'>❌ Faltan columnas requeridas en el archivo único:</li>";
          html += `<ul><li>${faltanUnico.join(", ")}</li></ul>`;
          return res.send(wrap(html));
        }

        let completadosUso = 0, completadosTipo = 0, completadosSuma = 0;
        const filasAjustadas = uno.rows.map((r) => {
          const row = { ...r };
          if (!row.uso) { row.uso = "Particular"; completadosUso++; }
          if (!row.tipo_vehiculo) { row.tipo_vehiculo = "Sedán"; completadosTipo++; }
          if (!row.suma) { row.suma = 0; completadosSuma++; }
          return row;
        });

        const wbNuevo = xlsx.utils.book_new();
        const wsNuevo = xlsx.utils.json_to_sheet(filasAjustadas);
        xlsx.utils.book_append_sheet(wbNuevo, wsNuevo, "Sheet1");

        const nombreArchivo = `taxativo-${Date.now()}.xlsx`;
        const rutaDestino = path.join(__dirname, "../data/combinados", nombreArchivo);
        const rutaPublica = path.join(__dirname, "../frontend/descargas", nombreArchivo);

        fs.mkdirSync(path.dirname(rutaDestino), { recursive: true });
        fs.mkdirSync(path.dirname(rutaPublica), { recursive: true });

        xlsx.writeFile(wbNuevo, rutaDestino);
        fs.copyFileSync(rutaDestino, rutaPublica);

        const fecha = new Date();
        await db.execute(
          "INSERT INTO historial_combinaciones (nombre_archivo, fecha, cantidad_registros) VALUES (?, ?, ?)",
          [nombreArchivo, fecha, filasAjustadas.length]
        );

        html += `<li>✅ Modo: <strong>Taxativo</strong>.</li>`;
        html += `<li>📄 Archivo generado: <strong>${nombreArchivo}</strong></li>`;
        html += `<li>🧮 Registros: <strong>${filasAjustadas.length}</strong></li>`;
        if (completadosUso || completadosTipo || completadosSuma) {
          html += `<li style="color:orange;">⚠️ Completados por defecto → Uso: ${completadosUso}, Tipo: ${completadosTipo}, Suma: ${completadosSuma}.</li>`;
        }
        html += `<li><a href="/descargas/${nombreArchivo}" download>⬇️ Descargar</a></li>`;
      }

      html += "</ul>";
      res.send(wrap(html));

    } catch (error) {
      console.error(error);
      res.status(500).send("Error en el procesamiento de archivos.");
    }
  }
);

app.get("/historico", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM historial_combinaciones ORDER BY fecha DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el histórico" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

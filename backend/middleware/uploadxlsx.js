const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// Configuración de Multer para aceptar solo .xls y .xlsx y guardar en la carpeta temporal
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../data/archivos_subidos');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Filtro para validar extensión
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos con extensión .xls o .xlsx'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Función para leer y procesar el archivo, asegurando que 'suma' siempre esté presente
function leerArchivoXLSX(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Leemos todas las filas como arrays para capturar encabezados reales, aunque estén vacíos
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    const headers = rawData[0].map(h => (h || "").toString().trim());

    // Asegurar que 'suma' esté presente en los encabezados
    if (!headers.includes("suma")) {
        headers.push("suma");
    }

    // Convertir las filas a objetos usando los encabezados asegurados
    const data = rawData.slice(1).map(row => {
        const obj = {};
        headers.forEach((col, idx) => {
            obj[col] = row[idx] !== undefined ? row[idx] : "";
        });
        return obj;
    });

    return { headers, data };
}

module.exports = { upload, leerArchivoXLSX };

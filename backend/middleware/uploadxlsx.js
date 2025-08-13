// backend/middleware/uploadXlsx.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../../data/archivos_subidos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const limits = {
  fileSize: parseInt(process.env.MAX_UPLOAD_MB || '25', 10) * 1024 * 1024, // 25MB por defecto
  files: 3,
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.xlsx') return cb(null, true);
  return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Formato inválido: ${ext}. Solo se aceptan archivos .xlsx`));
};

// Exporto el instance Multer (lo usaremos con .fields([...]) en server.js)
const uploadXlsx = multer({ storage, fileFilter, limits });

// Handler de errores presentable en HTML
function wrap(inner) {
  return `<html><body style="font-family:Arial,sans-serif;margin:24px;">${inner}</body></html>`;
}
function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const maxMb = Math.round(limits.fileSize / (1024 * 1024));
    let msg = 'Error al subir archivos.';
    if (err.code === 'LIMIT_FILE_SIZE') msg = `El archivo supera el límite de ${maxMb} MB.`;
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') msg = err.message || 'Archivo no permitido.';
    const html = `<h2>Resultado de la carga</h2><ul style="line-height:1.6">
      <li style="color:red;">❌ ${msg}</li>
    </ul><a href="/" style="display:inline-block;margin-top:20px;">🔙 Volver al inicio</a>`;
    return res.status(400).send(wrap(html));
  }
  next(err);
}

module.exports = { uploadXlsx, multerErrorHandler, UPLOAD_DIR };

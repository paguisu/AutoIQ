// backend/scripts/proceso_web_router.js
// Router para ejecutar procesos de cotización ATM desde el navegador
// - GET  /proceso-web/           → página con formulario (subir XLSX, limit, dry-run)
// - POST /proceso-web/atm/run     → crea proceso, ejecuta runner y exporta Excel
// - GET  /proceso-web/download    → descarga el Excel generado

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { execFile } = require('child_process');
const mysql   = require('mysql2/promise');

const router = express.Router();

// ---------- helpers ----------
function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

async function getConn() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'autoiq',
    charset: 'utf8mb4',
    dateStrings: true
  });
  return conn;
}

// ---------- storage para XLSX combinados ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(process.cwd(), 'data', 'combinados');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const base = file.originalname.replace(/\.[^.]+$/, '');
    const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
    cb(null, `${base}_${stamp}.xlsx`);
  }
});
const upload = multer({ storage });

// ---------- UI simple ----------
router.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>AutoIQ – Proceso Web ATM</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;margin:24px;line-height:1.45}
    h1{font-size:20px;margin-bottom:8px}
    label{display:block;margin:10px 0 4px}
    input[type="text"], input[type="number"]{width:360px;padding:6px}
    .row{display:flex;gap:24px;align-items:center;margin:8px 0}
    .btn{background:#111;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer}
    #log{white-space:pre-wrap;background:#f7f7f7;padding:12px;border-radius:6px;margin-top:16px;max-height:260px;overflow:auto}
    .ok{color:#0a7a0a}.err{color:#b00020}
    .muted{color:#666}
    .link{margin-top:12px}
  </style>
</head>
<body>
  <h1>AutoIQ – Ejecutar proceso ATM desde el navegador</h1>
  <p class="muted">Subí el XLSX combinado, definí límites si querés, y corré el proceso end-to-end.</p>

  <form id="f" enctype="multipart/form-data">
    <label>Archivo combinado (.xlsx)</label>
    <input type="file" name="combinado" accept=".xlsx" required>

    <label>Nombre del proceso</label>
    <input type="text" name="nombre" value="ATM – Lote web">

    <div class="row">
      <label>Limit (filas a ejecutar ahora)</label>
      <input type="number" name="limit" min="1" placeholder="vacío = todas">
      <label class="row"><input type="checkbox" name="dryRun"> DRY-RUN</label>
    </div>

    <button class="btn" type="submit">Crear proceso + Ejecutar + Exportar</button>
  </form>

  <div id="log" class="muted">Listo para ejecutar.</div>
  <div id="out" class="link"></div>

<script>
const f = document.getElementById('f');
const log = (msg, cls='') => {
  const el = document.getElementById('log');
  el.innerHTML += (cls? '<div class="'+cls+'">':'<div>') + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('log').textContent = 'Ejecutando...';
  document.getElementById('out').textContent = '';
  const form = new FormData(f);
  try{
    const resp = await fetch('/proceso-web/atm/run', { method:'POST', body:form });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    log('✔ Proceso creado: ID='+data.proceso_id, 'ok');
    log('Runner: ' + data.runner_summary);
    log('Excel: ' + data.excel_path, 'ok');
    const outDiv = document.getElementById('out');
    outDiv.innerHTML = '<a href="/proceso-web/download?path='+encodeURIComponent(data.excel_path)+'">Descargar Excel</a>';
  }catch(err){
    log('✖ ' + err.message, 'err');
  }
});
</script>
</body>
</html>`);
});

// ---------- POST: crear proceso + correr runner + exportar ----------
router.post('/atm/run', upload.single('combinado'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta archivo .xlsx' });

    const nombre = req.body.nombre || 'ATM – Lote web';
    const limit  = req.body.limit ? Number(req.body.limit) : null;
    const dryRun = req.body.dryRun === 'on';

    const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
    const rrDir  = path.join(process.cwd(), 'data', 'atm', 'rr', stamp);
    const resDir = path.join(process.cwd(), 'data', 'atm', 'res', stamp);
    fs.mkdirSync(rrDir,  { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    const conn = await getConn();
    let procesoId;

    try {
      const [r] = await conn.execute(
        `INSERT INTO procesos_cotizacion
          (nombre, ruta_archivo_combinatorio, carpeta_request_response, carpeta_resultados)
         VALUES (?, ?, ?, ?)`,
        [nombre, req.file.path, rrDir, resDir]
      );
      procesoId = r.insertId;
    } catch (e) {
      await conn.end();
      return res.status(500).json({ error: 'Error creando proceso: ' + e.message });
    }

    try {
      const runnerArgs = ['backend/scripts/atm_runner.js', `--proceso-id=${procesoId}`, `--dry-run=${dryRun ? 'true' : 'false'}`, '--verbose=true'];
      if (limit && Number.isFinite(limit)) runnerArgs.push(`--limit=${limit}`);

      const { stdout } = await execFileAsync('node', runnerArgs, { cwd: process.cwd() });

      const excelPath = path.join(resDir, `proceso_${procesoId}.xlsx`);
      await execFileAsync('node', ['backend/scripts/export_atm_excel.js', `--proceso-id=${procesoId}`, `--out=${excelPath}`], { cwd: process.cwd() });

      await conn.execute(`UPDATE procesos_cotizacion SET estado='completado', fecha_fin=NOW() WHERE id=?`, [procesoId]);
      await conn.end();

      return res.json({
        proceso_id: procesoId,
        runner_summary: stdout.trim().split(/\r?\n/).slice(-1)[0] || 'runner ok',
        excel_path: excelPath.replace(/\\/g,'/')
      });
    } catch (e) {
      await conn.execute(`UPDATE procesos_cotizacion SET estado='con errores', fecha_fin=NOW() WHERE id=?`, [procesoId]);
      await conn.end();
      return res.status(500).json({ error: 'Runner/Export falló: ' + e.message, proceso_id: procesoId });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ---------- GET: descarga del Excel generado ----------
router.get('/download', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).send('Missing path');
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return res.status(404).send('No existe');
  res.download(abs);
});

module.exports = router;

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultCaPath = path.join(repoRoot, 'tools', 'avast-root.cer');
const configuredCaPath = process.env.AUTOIQ_EXTRA_CA_CERTS || process.env.NODE_EXTRA_CA_CERTS || defaultCaPath;

const env = { ...process.env };

if (configuredCaPath && fs.existsSync(configuredCaPath)) {
  env.NODE_EXTRA_CA_CERTS = configuredCaPath;
  console.log(`[AutoIQ] NODE_EXTRA_CA_CERTS=${configuredCaPath}`);
} else if (configuredCaPath) {
  console.warn(`[AutoIQ] Certificado extra no encontrado: ${configuredCaPath}`);
}

const child = spawn(process.execPath, [path.join(repoRoot, 'backend', 'server.js')], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

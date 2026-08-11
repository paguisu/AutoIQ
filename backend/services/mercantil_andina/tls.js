const fs = require('fs');
const https = require('https');
const path = require('path');

let cachedAgent = null;

function existingFile(candidates) {
  return candidates.find((candidate) => {
    try {
      return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function getMercantilAndinaHttpsAgent() {
  if (cachedAgent !== null) return cachedAgent;

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const caPath = existingFile([
    process.env.MERCANTIL_ANDINA_CA_CERT,
    process.env.AUTOIQ_EXTRA_CA_CERTS,
    process.env.NODE_EXTRA_CA_CERTS,
    path.join(repoRoot, 'tools', 'avast-root-current.pem'),
  ]);

  if (!caPath) {
    cachedAgent = undefined;
    return cachedAgent;
  }

  cachedAgent = new https.Agent({
    ca: fs.readFileSync(caPath),
  });
  return cachedAgent;
}

module.exports = {
  getMercantilAndinaHttpsAgent,
};

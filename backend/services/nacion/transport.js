const fs = require('fs');
const https = require('https');
const tls = require('tls');

// Optional, explicit trust root for environments with a corporate HTTPS proxy.
// Keep the standard roots and certificate/hostname verification enabled.
function nacionTransportOptions(cfg = {}) {
  const caFile = cfg.ca_file || process.env.NACION_CA_FILE;
  return {
    timeout: 25000,
    maxRedirects: 0,
    validateStatus: () => true,
    ...(caFile ? {
      httpsAgent: new https.Agent({
        ca: [...tls.rootCertificates, fs.readFileSync(caFile, 'utf8')],
        rejectUnauthorized: true,
      }),
    } : {}),
  };
}

module.exports = { nacionTransportOptions };

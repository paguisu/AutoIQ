const path = require('path');
const { spawn } = require('child_process');

function startKeepAwake({ procesoId, reason } = {}) {
  if (process.platform !== 'win32') {
    return { active: false, stop: () => {} };
  }
  if (String(process.env.AUTOIQ_KEEP_AWAKE || '').trim() === '0') {
    return { active: false, stop: () => {} };
  }

  const scriptPath = path.join(__dirname, '..', '..', 'tools', 'keep-awake.ps1');
  const metadataPath = procesoId
    ? path.join(__dirname, '..', '..', 'data', 'procesos', `proceso-${procesoId}`, 'metadata.json')
    : '';
  const label = reason || `AutoIQ proceso ${procesoId || ''}`.trim();
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Reason',
    label,
    '-ParentPid',
    String(process.pid),
  ];
  if (metadataPath) {
    args.push('-MetadataPath', metadataPath);
  }
  const child = spawn('powershell.exe', args, {
    windowsHide: true,
    stdio: 'ignore',
  });

  child.on('error', () => {});

  return {
    active: true,
    pid: child.pid,
    stop: () => {
      if (!child.killed) {
        try {
          child.kill();
        } catch {}
      }
    },
  };
}

module.exports = {
  startKeepAwake,
};

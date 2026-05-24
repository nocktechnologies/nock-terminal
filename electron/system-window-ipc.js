const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { getAgentAdapters } = require('./agent-adapters');
const { normalizeSettingValue } = require('./settings-utils');
const { listAvailableShells } = require('./system-shells');

const execFileAsync = promisify(execFile);

async function defaultFetchOllamaVersion(url) {
  try {
    return await new Promise((resolve) => {
      const req = http.get(`${url}/api/version`, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).version || 'unknown');
          } catch {
            resolve('unknown');
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

async function defaultFindCommand(command) {
  const candidates = process.platform === 'win32'
    ? [`${command}.cmd`, `${command}.exe`, command]
    : [command];

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [candidate], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      const output = stdout.trim();
      const firstLine = output.split(/\r?\n/).find(Boolean);
      if (firstLine) return firstLine;
    } catch {
      // try next candidate
    }
  }

  const absoluteCandidates = process.platform === 'win32'
    ? []
    : [`/usr/local/bin/${command}`, `/opt/homebrew/bin/${command}`, path.join(process.env.HOME || '', '.local', 'bin', command)];
  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function registerSystemWindowIPC({
  ipcMain,
  app,
  shell,
  clipboard,
  portScanner,
  fileService,
  getMainWindow,
  getSettingsSnapshot,
  detectShells = listAvailableShells,
  fetchOllamaVersion = defaultFetchOllamaVersion,
  agentAdapters = getAgentAdapters,
  findCommand = defaultFindCommand,
}) {
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());

  ipcMain.on('window:maximize', () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.on('window:close', () => getMainWindow()?.close());

  ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized() ?? false);

  ipcMain.handle('window:setAlwaysOnTop', (_, value) => {
    const window = getMainWindow();
    if (window) window.setAlwaysOnTop(!!value);
  });

  ipcMain.handle('window:setOpacity', (_, value) => {
    const normalized = normalizeSettingValue('windowOpacity', value);
    const window = getMainWindow();
    if (window && normalized.ok) {
      const clamped = Math.max(0.7, Math.min(1.0, normalized.value / 100));
      window.setOpacity(clamped);
    }
  });

  ipcMain.handle('ports:scan', async () => {
    return portScanner.scan();
  });

  ipcMain.handle('system:detectShells', async () => {
    return detectShells();
  });

  ipcMain.handle('system:ollamaVersion', async () => {
    const url = getSettingsSnapshot().ollamaUrl || 'http://localhost:11434';
    return fetchOllamaVersion(url);
  });

  ipcMain.handle('system:appVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:detectAgents', async () => {
    const agents = await Promise.all(agentAdapters().map(async ({ id, label, command }) => {
      const agentPath = command ? await findCommand(command) : null;
      return { id, label, command, path: agentPath };
    }));
    return agents.map(agent => ({ ...agent, installed: !!agent.path }));
  });

  ipcMain.on('shell:openExternal', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.on('shell:showItemInFolder', (_, filePath) => {
    if (typeof filePath === 'string' && filePath.length > 0 && fileService.isAllowedPath(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.on('clipboard:write', (_, text) => {
    clipboard.writeText(typeof text === 'string' ? text : '');
  });
}

module.exports = {
  registerSystemWindowIPC,
};

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');
const TerminalManager = require('./terminal-manager');
const SessionDiscovery = require('./session-discovery');
const OllamaClient = require('./ollama-client');
const ClaudeCodeClient = require('./claude-code-client');
const PortScanner = require('./port-scanner');
const FileService = require('./file-service');
const FileWatcher = require('./file-watcher');
const ProcessDetector = require('./process-detector');
const TelegramNotifier = require('./telegram-notifier');
const ProjectProfiles = require('./project-profiles');
const SessionHistory = require('./session-history');
const PromptStore = require('./prompt-store');
const { DEFAULT_SETTINGS, normalizeSettingValue, sanitizeStoredSettings } = require('./settings-utils');
const NockCCClient = require('./nockcc-client');

const store = new Store({
  defaults: DEFAULT_SETTINGS,
});

function getSettingsSnapshot() {
  return sanitizeStoredSettings(store.store);
}

function repairStoredSettings() {
  const sanitized = getSettingsSnapshot();

  for (const [key, value] of Object.entries(sanitized)) {
    const currentValue = store.get(key);
    if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
      store.set(key, value);
    }
  }
}

let mainWindow = null;
let tray = null;
let terminalManager = null;
let sessionDiscovery = null;
let ollamaClient = null;
let claudeCodeClient = null;
let portScanner = null;
let fileService = null;
let fileWatcher = null;
let processDetector = null;
let telegramNotifier = null;
let projectProfiles = null;
let sessionHistory = null;
let promptStore = null;
let nockccClient = null;
let nockccHeartbeatInterval = null;

const isDev = !app.isPackaged;

function createWindow() {
  const settings = getSettingsSnapshot();
  const { width, height, x, y } = settings.windowBounds;

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty via preload
    },
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-react', 'index.html'));
  }

  // Apply stored window settings
  if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true);
  const opacity = settings.windowOpacity;
  if (opacity != null && opacity < 100) mainWindow.setOpacity(Math.max(0.7, opacity / 100));

  mainWindow.once('ready-to-show', () => {
    if (!settings.startMinimized) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Save window bounds before closing
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  // macOS: setTemplateImage(true) tells the OS to treat the icon as a template image,
  // inverting it automatically for dark/light menu bar mode. No forced resize on macOS —
  // the OS handles density scaling. Windows/Linux: 16×16 PNG.
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const fallbackIcon = () => nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 0), { width: 16, height: 16 });
  let trayIcon;
  if (process.platform === 'darwin') {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      console.error(`[tray] Failed to load icon from ${iconPath} — using fallback`);
      trayIcon = fallbackIcon();
    } else {
      trayIcon.setTemplateImage(true);
    }
  } else {
    const loaded = nativeImage.createFromPath(iconPath);
    if (loaded.isEmpty()) {
      console.error(`[tray] Failed to load icon from ${iconPath} — using fallback`);
      trayIcon = fallbackIcon();
    } else {
      trayIcon = loaded.resize({ width: 16, height: 16 });
    }
  }
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Terminal',
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: 'Active Sessions: 0',
      enabled: false,
      id: 'session-count',
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Nock Terminal');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function initServices() {
  const settings = getSettingsSnapshot();
  terminalManager = new TerminalManager();
  sessionDiscovery = new SessionDiscovery({
    devRoots: settings.devRoots,
    skipList: settings.projectSkipList,
  });
  ollamaClient = new OllamaClient(settings.ollamaUrl);
  claudeCodeClient = new ClaudeCodeClient(settings.claudeCodePath);
  portScanner = new PortScanner();
  fileService = new FileService(store);
  fileWatcher = new FileWatcher(fileService);
  processDetector = new ProcessDetector(terminalManager);
  telegramNotifier = new TelegramNotifier(store);
  projectProfiles = new ProjectProfiles();
  sessionHistory = new SessionHistory(store);
  promptStore = new PromptStore();
  nockccClient = new NockCCClient(store);
}

function registerIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // Terminal management
  ipcMain.handle('terminal:create', async (_, { id, cwd, shell: shellPath }) => {
    return terminalManager.create(id, cwd, shellPath);
  });
  ipcMain.on('terminal:write', (_, { id, data }) => {
    terminalManager.write(id, data);
  });
  ipcMain.on('terminal:resize', (_, { id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });
  ipcMain.on('terminal:destroy', (_, { id }) => {
    terminalManager.destroy(id);
  });

  // (Terminal data/exit events are wired in wireTerminalEvents() — not here)

  // Session discovery
  ipcMain.handle('sessions:discover', async () => {
    const sessions = await sessionDiscovery.discover();
    fileService.setGrantedRoots(sessions.map((session) => session.path));
    fileWatcher.revalidate();
    return sessions;
  });

  // Ollama chat
  ipcMain.handle('ai:ollama:chat', async (event, { model, messages }) => {
    const response = await ollamaClient.chat(model, messages, (chunk) => {
      mainWindow?.webContents.send('ai:stream', { chunk });
    });
    return response;
  });
  ipcMain.handle('ai:ollama:models', async () => {
    return ollamaClient.listModels();
  });
  ipcMain.handle('ai:ollama:status', async () => {
    return ollamaClient.checkStatus();
  });

  // Claude Code chat (Kit/Mara)
  ipcMain.handle('ai:claude:chat', async (event, { message, mode, cwd }) => {
    const maraBriefPath = store.get('maraBriefPath');
    const response = await claudeCodeClient.chat(message, mode, cwd, maraBriefPath, (chunk) => {
      mainWindow?.webContents.send('ai:stream', { chunk });
    });
    return response;
  });

  // Port scanning
  ipcMain.handle('ports:scan', async () => {
    return portScanner.scan();
  });

  // System info
  ipcMain.handle('system:detectShells', async () => {
    const fs = require('fs');
    const { execFileSync } = require('child_process');
    const shells = [];

    if (process.platform === 'win32') {
      // PowerShell 7
      try {
        const ver = execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { timeout: 5000, encoding: 'utf8' }).trim();
        shells.push({ name: 'PowerShell 7', path: 'pwsh', version: ver });
      } catch { /* not installed */ }
      // Windows PowerShell
      try {
        const ver = execFileSync('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { timeout: 5000, encoding: 'utf8' }).trim();
        shells.push({ name: 'Windows PowerShell', path: 'powershell', version: ver });
      } catch { /* not available */ }
      // CMD
      if (process.env.ComSpec || fs.existsSync('C:\\Windows\\System32\\cmd.exe')) {
        shells.push({ name: 'Command Prompt', path: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', version: '' });
      }
      // Git Bash
      const gitBashPaths = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
      for (const p of gitBashPaths) {
        if (fs.existsSync(p)) {
          shells.push({ name: 'Git Bash', path: p, version: '' });
          break;
        }
      }
      // WSL
      try {
        execFileSync('wsl', ['--status'], { timeout: 5000, encoding: 'utf8' });
        shells.push({ name: 'WSL', path: 'wsl', version: '' });
      } catch { /* not available */ }
    } else {
      // macOS / Linux: surface $SHELL (login shell) first, then known paths.
      // execFileSync avoids shell injection — all paths come from known locations or $SHELL.
      const seen = new Set();
      const addShell = (name, shellPath) => {
        if (!fs.existsSync(shellPath)) return;
        // Resolve to canonical path to deduplicate symlinks (e.g. /bin/bash and
        // /usr/bin/bash can point to the same binary on merged-/usr systems).
        // If realpathSync throws the symlink is broken — skip the entry.
        let canonical;
        try { canonical = fs.realpathSync(shellPath); } catch { return; }
        if (seen.has(canonical)) return;
        seen.add(canonical);
        let version = '';
        try {
          version = execFileSync(shellPath, ['--version'], { timeout: 3000, encoding: 'utf8' }).split('\n')[0].trim();
        } catch (e) {
          // Some shells (e.g. dash) don't support --version; grab stdout from the error
          if (e.stdout) version = e.stdout.toString().split('\n')[0].trim();
        }
        shells.push({ name, path: shellPath, version });
      };

      // $SHELL is set by the OS to the user's login shell — show it first
      const loginShell = process.env.SHELL;
      if (loginShell) {
        const base = path.basename(loginShell);
        addShell(base.charAt(0).toUpperCase() + base.slice(1), loginShell);
      }

      // Scan well-known install locations (deduped via seen set)
      const candidates = [
        { name: 'Zsh',  paths: ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'] },
        { name: 'Bash', paths: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'] },
        { name: 'Fish', paths: ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'] },
        { name: 'Dash', paths: ['/bin/dash', '/usr/bin/dash'] },
      ];
      for (const { name, paths: candidatePaths } of candidates) {
        for (const p of candidatePaths) {
          addShell(name, p);
        }
      }
    }

    return shells;
  });

  ipcMain.handle('system:ollamaVersion', async () => {
    try {
      const url = getSettingsSnapshot().ollamaUrl || 'http://localhost:11434';
      const http = require('http');
      return await new Promise((resolve, reject) => {
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
  });

  ipcMain.handle('system:appVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('window:setAlwaysOnTop', (_, value) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!value);
  });

  ipcMain.handle('window:setOpacity', (_, value) => {
    const normalized = normalizeSettingValue('windowOpacity', value);
    if (mainWindow && normalized.ok) {
      const clamped = Math.max(0.7, Math.min(1.0, normalized.value / 100));
      mainWindow.setOpacity(clamped);
    }
  });

  // Settings
  ipcMain.handle('settings:get', (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return undefined;
    return getSettingsSnapshot()[key];
  });
  ipcMain.handle('settings:getAll', () => {
    const all = getSettingsSnapshot();
    if (all.telegramBotToken) all.telegramBotToken = '••••••••';
    return all;
  });
  ipcMain.handle('settings:getSecure', (_, key) => {
    const allowed = ['telegramBotToken', 'nockccApiKey'];
    if (!allowed.includes(key)) return null;
    return getSettingsSnapshot()[key];
  });
  ipcMain.on('settings:set', (_, payload) => {
    if (!payload || typeof payload.key !== 'string') return;

    const { key } = payload;
    const normalized = normalizeSettingValue(key, payload.value);
    if (!normalized.ok) return;

    store.set(key, normalized.value);
    const currentValue = getSettingsSnapshot()[key];
    // Update services when settings change
    if (key === 'ollamaUrl') {
      ollamaClient.setUrl(currentValue);
    }
    if (key === 'claudeCodePath') {
      claudeCodeClient.setBinaryPath(currentValue);
    }
    if (key === 'devRoots' || key === 'projectSkipList') {
      sessionDiscovery.setConfig({
        devRoots: getSettingsSnapshot().devRoots,
        skipList: getSettingsSnapshot().projectSkipList,
      });
      fileWatcher.revalidate();
    }
    if (key === 'alwaysOnTop') {
      if (mainWindow) mainWindow.setAlwaysOnTop(!!currentValue);
    }
    if (key === 'windowOpacity') {
      if (mainWindow) {
        const clamped = Math.max(0.7, Math.min(1.0, currentValue / 100));
        mainWindow.setOpacity(clamped);
      }
    }
    if (key === 'launchAtStartup') {
      app.setLoginItemSettings({ openAtLogin: !!currentValue });
    }
  });

  // File operations
  ipcMain.handle('files:tree', (_, dirPath) => {
    return fileService.tree(dirPath);
  });
  ipcMain.handle('files:read', (_, filePath) => {
    return fileService.read(filePath);
  });
  ipcMain.handle('files:write', (_, { filePath, content }) => {
    return fileService.write(filePath, content);
  });
  ipcMain.handle('files:stat', (_, filePath) => {
    return fileService.stat(filePath);
  });
  ipcMain.handle('files:gitStatus', (_, dirPath) => {
    return fileService.gitStatus(dirPath);
  });
  ipcMain.handle('files:gitOp', (_, { dirPath, operation }) => {
    return fileService.gitOp(dirPath, operation);
  });
  ipcMain.on('files:watch', (_, dirPath) => {
    if (!fileService.isAllowedPath(dirPath)) return;
    fileWatcher.watch(dirPath);
  });
  ipcMain.on('files:stopWatch', () => {
    fileWatcher.stop();
  });

  // Shell / external — restrict to http/https URLs
  ipcMain.on('shell:openExternal', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // Shell / show item in folder (Explorer / Finder)
  ipcMain.on('shell:showItemInFolder', (_, filePath) => {
    if (typeof filePath === 'string' && filePath.length > 0 && fileService.isAllowedPath(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  // Clipboard (routed via IPC so renderer doesn't need permission prompts)
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_, text) => clipboard.writeText(text || ''));

  // Telegram notifications
  ipcMain.handle('telegram:test', async () => {
    return telegramNotifier.test();
  });
  ipcMain.handle('telegram:notify', async (_, { eventType, details }) => {
    return telegramNotifier.notify(eventType, details);
  });

  // Project profiles
  ipcMain.handle('profiles:get', (_, projectPath) => {
    return projectProfiles.get(projectPath);
  });
  ipcMain.handle('profiles:save', (_, { projectPath, profile }) => {
    return projectProfiles.save(projectPath, profile);
  });
  ipcMain.handle('profiles:delete', (_, projectPath) => {
    return projectProfiles.delete(projectPath);
  });
  ipcMain.handle('profiles:list', () => {
    return projectProfiles.list();
  });

  // Session history
  ipcMain.handle('sessionHistory:list', () => {
    return sessionHistory.list();
  });
  ipcMain.handle('sessionHistory:getOutput', (_, { startTime, tabId }) => {
    return sessionHistory.getOutput(startTime, tabId);
  });
  ipcMain.handle('sessionHistory:start', (_, { tabId, metadata }) => {
    return sessionHistory.startSession(tabId, metadata);
  });

  // Prompt library
  ipcMain.handle('prompts:list', () => {
    return promptStore.list();
  });
  ipcMain.handle('prompts:get', (_, id) => {
    return promptStore.get(id);
  });
  ipcMain.handle('prompts:save', (_, { id, data }) => {
    return promptStore.save(id, data);
  });
  ipcMain.handle('prompts:delete', (_, id) => {
    return promptStore.delete(id);
  });
}

// Wire up terminal data events after services init
function wireTerminalEvents() {
  terminalManager.on('data', (id, data) => {
    mainWindow?.webContents.send('terminal:data', { id, data });
    // Capture output for session history
    if (sessionHistory) {
      sessionHistory.appendOutput(id, data);
    }
  });
  terminalManager.on('exit', (id, code) => {
    mainWindow?.webContents.send('terminal:exit', { id, code });
    // End session in history
    if (sessionHistory) {
      sessionHistory.endSession(id, code);
    }
  });
}

function wireFileEvents() {
  fileWatcher.on('changed', (event) => {
    mainWindow?.webContents.send('files:changed', event);
  });
  fileWatcher.on('gitStatus', (status) => {
    mainWindow?.webContents.send('files:gitStatus', status);
  });
  processDetector.on('status', (status) => {
    mainWindow?.webContents.send('process:status', status);
  });
}

app.whenReady().then(() => {
  repairStoredSettings();
  initServices();
  createWindow();
  createTray();
  registerIPC();
  wireTerminalEvents();
  wireFileEvents();
  processDetector.start();

  // NockCC session tracking
  const { version: appVersion } = require('../package.json');
  nockccClient.startSession({ machine: process.platform, appVersion });
  nockccHeartbeatInterval = setInterval(() => {
    nockccClient.heartbeat({ activeProjectCount: 0, activeClaudeSessionIds: [] });
  }, 60_000);

  // Global shortcut: try candidates in order, take the first one that registers.
  // register() returns false if the shortcut is already claimed by another app —
  // we never leave the user without feedback in that case.
  const shortcutCandidates = ['Control+Shift+T', 'Control+Shift+Space', 'Control+Alt+T'];
  let registeredShortcut = null;
  for (const candidate of shortcutCandidates) {
    if (globalShortcut.register(candidate, toggleWindow)) {
      registeredShortcut = candidate;
      break;
    }
  }
  if (registeredShortcut) {
    tray.setToolTip(`Nock Terminal (${registeredShortcut})`);
  } else {
    tray.setToolTip('Nock Terminal — no global shortcut (all candidates taken by other apps)');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Don't quit — keep in tray
  if (process.platform !== 'darwin') {
    // On Windows, hide to tray instead of quitting
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  terminalManager?.destroyAll();
  fileWatcher?.stop();
  processDetector?.stop();
  if (nockccHeartbeatInterval) clearInterval(nockccHeartbeatInterval);
  nockccClient?.endSession();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

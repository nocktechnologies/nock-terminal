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

const store = new Store({
  defaults: {
    windowBounds: { width: 1400, height: 900 },
    // General
    theme: 'dark',
    startMinimized: false,
    alwaysOnTop: false,
    launchAtStartup: false,
    windowOpacity: 100,
    // AI / Models
    ollamaUrl: 'http://localhost:11434',
    defaultModel: 'qwen3.5:9b',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    showThinking: false,
    // Claude Code
    claudeCodePath: '',
    maraBriefPath: '',
    // Terminal
    terminalFontSize: 16,
    terminalFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    defaultShell: '',
    shellArgs: '',
    scrollbackSize: 5000,
    cursorStyle: 'block',
    cursorBlink: true,
    bellSound: false,
    copyOnSelect: false,
    rightClickPaste: true,
    // Editor
    editorFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    editorFontSize: 15,
    editorMinimap: false,
    editorWordWrap: false,
    // File Tree
    fileTreeOpen: true,
    showDotfiles: false,
    // Notifications
    desktopNotifications: true,
    notificationSound: false,
    notifyPrMerged: true,
    notifyBuildComplete: true,
    notifySessionEnded: true,
    notifyFenceEvent: false,
    // Telegram
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
    telegramQuietStart: '22:00',
    telegramQuietEnd: '07:00',
    telegramNotifyPrMerged: true,
    telegramNotifyBuildComplete: true,
    telegramNotifySessionEnded: true,
    telegramNotifyFenceEvent: false,
    // Session
    autoCaptureSessions: false,
    // Layout
    sidebarCollapsed: false,
    // Projects
    devRoots: process.platform === 'win32' ? ['C:\\Dev'] : [],
    projectSkipList: ['Gym-App', 'github.com-kkwills13-nock-technologies-site'],
  },
});

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

const isDev = !app.isPackaged;

function createWindow() {
  const { width, height, x, y } = store.get('windowBounds');

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
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-react', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
  // Load the Nock logo and resize for tray (16x16 on Windows)
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 0), { width: 16, height: 16 });
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
  terminalManager = new TerminalManager();
  sessionDiscovery = new SessionDiscovery({
    devRoots: store.get('devRoots'),
    skipList: store.get('projectSkipList'),
  });
  ollamaClient = new OllamaClient(store.get('ollamaUrl'));
  claudeCodeClient = new ClaudeCodeClient(store.get('claudeCodePath'));
  portScanner = new PortScanner();
  fileService = new FileService(store);
  fileWatcher = new FileWatcher(fileService);
  processDetector = new ProcessDetector(terminalManager);
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
    return sessionDiscovery.discover();
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
    const { execSync } = require('child_process');
    const shells = [];
    // PowerShell 7
    try {
      const ver = execSync('pwsh -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"', { timeout: 5000, encoding: 'utf8' }).trim();
      shells.push({ name: 'PowerShell 7', path: 'pwsh', version: ver });
    } catch { /* not installed */ }
    // Windows PowerShell
    try {
      const ver = execSync('powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"', { timeout: 5000, encoding: 'utf8' }).trim();
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
      execSync('wsl --status', { timeout: 5000, encoding: 'utf8' });
      shells.push({ name: 'WSL', path: 'wsl', version: '' });
    } catch { /* not available */ }
    return shells;
  });

  ipcMain.handle('system:ollamaVersion', async () => {
    try {
      const url = store.get('ollamaUrl') || 'http://localhost:11434';
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
    if (mainWindow) {
      const clamped = Math.max(0.7, Math.min(1.0, value / 100));
      mainWindow.setOpacity(clamped);
    }
  });

  // Settings
  ipcMain.handle('settings:get', (_, key) => {
    return store.get(key);
  });
  ipcMain.handle('settings:getAll', () => {
    return store.store;
  });
  ipcMain.on('settings:set', (_, { key, value }) => {
    store.set(key, value);
    // Update services when settings change
    if (key === 'ollamaUrl') {
      ollamaClient.setUrl(value);
    }
    if (key === 'claudeCodePath') {
      claudeCodeClient.setBinaryPath(value);
    }
    if (key === 'devRoots' || key === 'projectSkipList') {
      sessionDiscovery.setConfig({
        devRoots: store.get('devRoots'),
        skipList: store.get('projectSkipList'),
      });
    }
    if (key === 'alwaysOnTop') {
      if (mainWindow) mainWindow.setAlwaysOnTop(!!value);
    }
    if (key === 'windowOpacity') {
      if (mainWindow) {
        const clamped = Math.max(0.7, Math.min(1.0, value / 100));
        mainWindow.setOpacity(clamped);
      }
    }
    if (key === 'launchAtStartup') {
      app.setLoginItemSettings({ openAtLogin: !!value });
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
  ipcMain.on('files:watch', (_, dirPath) => {
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

  // Clipboard (routed via IPC so renderer doesn't need permission prompts)
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_, text) => clipboard.writeText(text || ''));
}

// Wire up terminal data events after services init
function wireTerminalEvents() {
  terminalManager.on('data', (id, data) => {
    mainWindow?.webContents.send('terminal:data', { id, data });
  });
  terminalManager.on('exit', (id, code) => {
    mainWindow?.webContents.send('terminal:exit', { id, code });
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
  initServices();
  createWindow();
  createTray();
  registerIPC();
  wireTerminalEvents();
  wireFileEvents();
  processDetector.start();

  // Global shortcut: Ctrl+Shift+T to toggle window
  globalShortcut.register('Control+Shift+T', toggleWindow);

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
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

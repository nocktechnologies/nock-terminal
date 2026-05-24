const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');
const TerminalManager = require('./terminal-manager');
const SessionDiscovery = require('./session-discovery');
const OllamaClient = require('./ollama-client');
const PortScanner = require('./port-scanner');
const FileService = require('./file-service');
const FileWatcher = require('./file-watcher');
const ProcessDetector = require('./process-detector');
const TelegramNotifier = require('./telegram-notifier');
const ProjectProfiles = require('./project-profiles');
const SessionHistory = require('./session-history');
const PromptStore = require('./prompt-store');
const { listAvailableShells } = require('./system-shells');
const {
  DEFAULT_SETTINGS,
  migrateSettingsStore,
  normalizeSettingValue,
  sanitizeStoredSettings,
} = require('./settings-utils');
const {
  errorPayload,
  validateTerminalCreatePayload,
} = require('./ipc-validators');
const { getAgentAdapters } = require('./agent-adapters');
const NockCCClient = require('./nockcc-client');
const { AgentDispatchService } = require('./agent-dispatch');
const { registerDispatchIPC } = require('./dispatch-ipc');
const { registerFileIPC } = require('./file-ipc');
const { registerLocalDataIPC } = require('./local-data-ipc');
const { registerSettingsIPC } = require('./settings-ipc');

const APP_NAME = 'Nock Terminal';
const IS_PACKAGED_SMOKE = process.env.NOCK_TERMINAL_PACKAGED_SMOKE === '1';
const SMOKE_READY_PREFIX = '[nock-terminal-smoke] ready ';
const SMOKE_FAILURE_PREFIX = '[nock-terminal-smoke] failure ';
const SMOKE_RENDER_TIMEOUT_MS = 10_000;
const SMOKE_RENDER_POLL_MS = 100;

if (IS_PACKAGED_SMOKE && process.env.NOCK_TERMINAL_USER_DATA_DIR) {
  try {
    app.setPath('userData', process.env.NOCK_TERMINAL_USER_DATA_DIR);
  } catch (err) {
    console.error(`${SMOKE_FAILURE_PREFIX}${JSON.stringify({ error: err.message })}`);
  }
}

const store = new Store({
  defaults: DEFAULT_SETTINGS,
});

function getSettingsSnapshot() {
  return sanitizeStoredSettings(store.store);
}

function getAllowedProjectRoots() {
  const settings = getSettingsSnapshot();
  return [
    ...(settings.devRoots || []),
    ...(fileService?.grantedRoots || []),
  ];
}

function repairStoredSettings() {
  migrateSettingsStore(store);
}

function applySettingsRuntimeEffects(key, currentValue) {
  if (key === 'ollamaUrl') {
    ollamaClient?.setUrl(currentValue);
  }
  if (key === 'devRoots' || key === 'projectSkipList') {
    sessionDiscovery?.setConfig({
      devRoots: getSettingsSnapshot().devRoots,
      skipList: getSettingsSnapshot().projectSkipList,
    });
    fileWatcher?.revalidate();
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
}

function applyResetRuntimeEffects(settings) {
  applySettingsRuntimeEffects('ollamaUrl', settings.ollamaUrl);
  applySettingsRuntimeEffects('devRoots', settings.devRoots);
  applySettingsRuntimeEffects('alwaysOnTop', settings.alwaysOnTop);
  applySettingsRuntimeEffects('windowOpacity', settings.windowOpacity);
  applySettingsRuntimeEffects('launchAtStartup', settings.launchAtStartup);
}

let mainWindow = null;
let tray = null;
let terminalManager = null;
let sessionDiscovery = null;
let ollamaClient = null;
let portScanner = null;
let fileService = null;
let fileWatcher = null;
let processDetector = null;
let telegramNotifier = null;
let projectProfiles = null;
let sessionHistory = null;
let promptStore = null;
let nockccClient = null;
let agentDispatchService = null;
let nockccHeartbeatInterval = null;
let nockccActivity = {
  activeProjectCount: 0,
  activeClaudeSessionIds: [],
  activeAgentSessionIds: [],
};

const isDev = !app.isPackaged;

function getAssetPath(fileName) {
  return path.join(__dirname, '..', 'assets', fileName);
}

function getPlatformIconPath() {
  if (process.platform === 'win32') return getAssetPath('icon.ico');
  if (process.platform === 'darwin') return getAssetPath('icon.icns');
  return getAssetPath('icon.png');
}

function getBrandingIconPath() {
  return process.platform === 'darwin' ? getAssetPath('icon.png') : getPlatformIconPath();
}

function configureAppBranding() {
  const iconPath = getBrandingIconPath();

  if (process.platform === 'darwin') {
    try {
      const dockIcon = nativeImage.createFromPath(iconPath);
      if (!dockIcon.isEmpty()) {
        app.dock?.setIcon(dockIcon);
      }
    } catch (err) {
      console.error(`[branding] Failed to set dock icon from ${iconPath}:`, err.message);
    }
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      iconPath,
      copyright: 'Copyright Nock Technologies (K Wills Technologies LLC)',
    });
  }
}

function createWindow() {
  const settings = getSettingsSnapshot();
  const { width, height, x, y } = settings.windowBounds;

  const windowOptions = {
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
      // Current Electron 28 preload is CommonJS-based. Keep sandbox disabled
      // until the preload bridge is migrated and smoke-tested under sandbox:true.
      // node-pty remains isolated to the main process.
      sandbox: false,
    },
    show: false,
  };
  if (process.platform !== 'darwin') {
    windowOptions.icon = getPlatformIconPath();
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-react', 'index.html'));
  }

  // Apply stored window settings
  if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true);
  const opacity = settings.windowOpacity;
  if (opacity != null && opacity < 100) mainWindow.setOpacity(Math.max(0.7, opacity / 100));

  let initialShowDone = false;
  const showInitialWindow = () => {
    if (settings.startMinimized || initialShowDone || !mainWindow || mainWindow.isDestroyed()) return;
    initialShowDone = true;
    showMainWindow();
  };

  mainWindow.once('ready-to-show', showInitialWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(showInitialWindow, 100);
    if (IS_PACKAGED_SMOKE) {
      finishPackagedSmokeCheck();
    }
  });
  mainWindow.webContents.once('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    if (!IS_PACKAGED_SMOKE) return;
    console.error(`${SMOKE_FAILURE_PREFIX}${JSON.stringify({
      errorCode,
      errorDescription,
      validatedURL,
    })}`);
    app.exit(1);
  });
  setTimeout(showInitialWindow, 2500);

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
  // macOS menu-bar icons need a monochrome template source so the OS can tint
  // it for light/dark menu bars. Windows/Linux keep the full-color app tile.
  const iconPath = getAssetPath(process.platform === 'darwin' ? 'tray-template.png' : 'icon.png');
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

  tray.setToolTip(APP_NAME);
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
    showMainWindow();
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPackagedSmokeRendererState() {
  return mainWindow.webContents.executeJavaScript(`
    (() => {
      const text = document.body?.innerText || '';
      return {
        title: document.title || '',
        bodyHasBrand: text.includes('NOCK TERMINAL'),
        bodyHasDashboard: text.includes('DASHBOARD') || text.includes('Sessions'),
        textLength: text.length,
      };
    })()
  `, true);
}

async function finishPackagedSmokeCheck() {
  if (!IS_PACKAGED_SMOKE || !mainWindow || mainWindow.isDestroyed()) return;

  try {
    const deadline = Date.now() + SMOKE_RENDER_TIMEOUT_MS;
    let renderer = null;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        renderer = await readPackagedSmokeRendererState();
        if (renderer.bodyHasBrand || renderer.bodyHasDashboard) {
          break;
        }
      } catch (err) {
        lastError = err;
      }
      await sleep(SMOKE_RENDER_POLL_MS);
    }

    if (!renderer?.bodyHasBrand && !renderer?.bodyHasDashboard) {
      throw new Error(lastError?.message || 'Timed out waiting for packaged renderer content');
    }

    console.log(`${SMOKE_READY_PREFIX}${JSON.stringify({
      isPackaged: app.isPackaged,
      url: mainWindow.webContents.getURL(),
      renderer,
    })}`);
    setTimeout(() => app.exit(0), 250);
  } catch (err) {
    console.error(`${SMOKE_FAILURE_PREFIX}${JSON.stringify({ error: err.message })}`);
    app.exit(1);
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
  portScanner = new PortScanner();
  fileService = new FileService(store);
  fileWatcher = new FileWatcher(fileService);
  processDetector = new ProcessDetector(terminalManager);
  telegramNotifier = new TelegramNotifier(store);
  projectProfiles = new ProjectProfiles();
  sessionHistory = new SessionHistory(store);
  promptStore = new PromptStore();
  nockccClient = new NockCCClient(store);
  agentDispatchService = new AgentDispatchService(store);
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
  ipcMain.handle('terminal:create', async (_, payload) => {
    const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : '';
    const profile = projectPath ? projectProfiles.get(projectPath) : {};
    const validated = validateTerminalCreatePayload(payload, {
      allowedRoots: getAllowedProjectRoots(),
      settings: getSettingsSnapshot(),
      profile,
    });
    if (!validated.ok) return errorPayload(validated);

    const { id, cwd, shell: shellPath, shellArgs, envVars } = validated.value;
    return terminalManager.create(id, cwd, {
      shell: shellPath,
      shellArgs,
      envVars,
    });
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

  registerDispatchIPC({
    ipcMain,
    agentDispatchService,
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

  // Port scanning
  ipcMain.handle('ports:scan', async () => {
    return portScanner.scan();
  });

  // System info
  ipcMain.handle('system:detectShells', async () => {
    return listAvailableShells();
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

  ipcMain.handle('system:detectAgents', async () => {
    const fs = require('fs');
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const findCommand = async (command) => {
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
    };

    const agents = await Promise.all(getAgentAdapters().map(async ({ id, label, command }) => {
      const agentPath = command ? await findCommand(command) : null;
      return { id, label, command, path: agentPath };
    }));
    return agents.map(agent => ({ ...agent, installed: !!agent.path }));
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

  registerSettingsIPC({
    ipcMain,
    store,
    getSettingsSnapshot,
    applySettingsRuntimeEffects,
    applyResetRuntimeEffects,
  });

  registerFileIPC({
    ipcMain,
    fileService,
    fileWatcher,
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

  ipcMain.on('nockcc:updateActivity', (_, activity = {}) => {
    if (!activity || typeof activity !== 'object') activity = {};
    const activeProjectCount = Number.isFinite(activity.activeProjectCount)
      ? Math.max(0, Math.round(activity.activeProjectCount))
      : 0;
    const sanitizeList = (value) => (
      Array.isArray(value)
        ? value.filter(item => typeof item === 'string' && item.length <= 200).slice(0, 100)
        : []
    );

    nockccActivity = {
      activeProjectCount,
      activeClaudeSessionIds: sanitizeList(activity.activeClaudeSessionIds),
      activeAgentSessionIds: sanitizeList(activity.activeAgentSessionIds),
    };
  });

  registerLocalDataIPC({
    ipcMain,
    fileService,
    projectProfiles,
    promptStore,
    sessionHistory,
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
  configureAppBranding();
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
    nockccClient.heartbeat(nockccActivity);
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
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

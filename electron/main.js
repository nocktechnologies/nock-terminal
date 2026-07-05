const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, clipboard, safeStorage } = require('electron');
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
const GitHubNotifier = require('./github-notifier');
const ProjectProfiles = require('./project-profiles');
const SessionHistory = require('./session-history');
const PromptStore = require('./prompt-store');
const {
  DEFAULT_SETTINGS,
  migrateSettingsStore,
  sanitizeStoredSettings,
} = require('./settings-utils');
const {
  SecureSettingsStore,
  createSecureSettingsFacade,
} = require('./secure-settings-store');
const NockCCClient = require('./nockcc-client');
const { AgentDispatchService } = require('./agent-dispatch');
const { registerDispatchIPC } = require('./dispatch-ipc');
const { registerFileIPC } = require('./file-ipc');
const { registerLocalDataIPC } = require('./local-data-ipc');
const { createNockCCActivityIPC } = require('./nockcc-activity-ipc');
const { registerOllamaIPC } = require('./ollama-ipc');
const { registerSettingsIPC } = require('./settings-ipc');
const { registerSessionIPC } = require('./session-ipc');
const { registerSystemWindowIPC } = require('./system-window-ipc');
const { registerTelegramIPC } = require('./telegram-ipc');
const { registerTerminalIPC } = require('./terminal-ipc');
const { installWindowSecurity, acquireSingleInstanceLock } = require('./window-security');
const { decideRendererRecovery } = require('./renderer-recovery');
const { version: appVersion } = require('../package.json');

const APP_NAME = 'Nock Terminal';
const IS_PACKAGED_SMOKE = process.env.NOCK_TERMINAL_PACKAGED_SMOKE === '1';
const SMOKE_READY_PREFIX = '[nock-terminal-smoke] ready ';
const SMOKE_FAILURE_PREFIX = '[nock-terminal-smoke] failure ';
const SMOKE_RENDER_TIMEOUT_MS = 10_000;
const SMOKE_RENDER_POLL_MS = 100;
const SMOKE_SHUTDOWN_TIMEOUT_MS = 2_000;

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
let secureSettings = null;
let runtimeSettingsStore = store;

function getSettingsSnapshot() {
  const sanitized = sanitizeStoredSettings(store.store);
  return secureSettings?.applyToSettings?.(sanitized) || sanitized;
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
  secureSettings?.migrateLegacySettings?.();
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
  // Any change that affects whether/what the GitHub poller watches: (re)start it
  // if it should now be running (a fresh start baselines new repos and picks up
  // the new token/toggles immediately), otherwise stop it.
  if ([
    'githubToken', 'githubWatchRepos', 'telegramEnabled',
    'telegramNotifyPrMerged', 'telegramNotifyBuildComplete',
  ].includes(key)) {
    if (githubNotifier?.isActive?.()) {
      githubNotifier.start();
    } else {
      githubNotifier?.stop();
    }
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
let rendererCrashTimestamps = [];
let terminalManager = null;
let sessionDiscovery = null;
let ollamaClient = null;
let portScanner = null;
let fileService = null;
let fileWatcher = null;
let processDetector = null;
let telegramNotifier = null;
let githubNotifier = null;
let projectProfiles = null;
let sessionHistory = null;
let promptStore = null;
let nockccClient = null;
let agentDispatchService = null;
let nockccActivityController = null;

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

// Recover from a dead or hung renderer. A crashed render process leaves a
// blank, frozen window (the exact "won't launch / freezes" symptom), so on an
// unexpected exit we reload the window — but only up to a rate cap, so a
// genuinely broken renderer can't spin in a reload loop and peg the CPU.
function installRendererRecovery(win) {
  const contents = win.webContents;

  contents.on('render-process-gone', (_event, details) => {
    // Smoke runs assert a clean first paint; let the smoke harness observe the
    // failure instead of silently reloading underneath it.
    if (IS_PACKAGED_SMOKE) return;
    if (app.isQuitting || win.isDestroyed()) return;

    const decision = decideRendererRecovery({
      reason: details?.reason,
      crashTimestamps: rendererCrashTimestamps,
      now: Date.now(),
    });
    rendererCrashTimestamps = decision.crashTimestamps;

    if (decision.action === 'reload') {
      console.error(`[recovery] renderer gone (reason=${details?.reason}); reloading (attempt ${decision.attempt})`);
      // Defer the reload: calling reload() synchronously inside the
      // render-process-gone handler crashes the main process (Chromium hits a
      // CHECK while the dead render process is still being torn down). Let the
      // event unwind first, then re-check the window is still valid.
      setTimeout(() => {
        if (app.isQuitting || win.isDestroyed()) return;
        try {
          win.reload();
        } catch (err) {
          console.error('[recovery] reload failed:', err.message);
        }
      }, 100);
    } else if (decision.action === 'giveup') {
      console.error(`[recovery] renderer gone (reason=${details?.reason}); repeated crashes — not reloading`);
      tray?.setToolTip(`${APP_NAME} — renderer crashed repeatedly; restart the app`);
    }
  });

  // Hang (not crash) — surface it rather than auto-reloading, which would drop
  // unsaved editor buffers. Observability now; a recovery prompt can come later.
  contents.on('unresponsive', () => {
    console.error('[recovery] renderer unresponsive');
  });
  contents.on('responsive', () => {
    console.log('[recovery] renderer responsive again');
  });
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
      // The preload bridge only requires the sandbox-safe 'electron' module
      // (contextBridge + ipcRenderer), so the renderer runs fully sandboxed.
      // node-pty and all filesystem access stay in the main process.
      sandbox: true,
    },
    show: false,
  };
  if (process.platform !== 'darwin') {
    windowOptions.icon = getPlatformIconPath();
  }

  mainWindow = new BrowserWindow(windowOptions);
  // Fresh window starts with a clean crash history.
  rendererCrashTimestamps = [];

  // Renderer containment: deny in-app window-open (route real web links to the
  // OS browser) and block main-frame navigation away from the app origin, so a
  // renderer foothold can't reach attacker content and escalate via terminal:write.
  installWindowSecurity(mainWindow.webContents, {
    isDev,
    appDir: path.join(__dirname, '..', 'dist-react'),
    openExternal: (url) => shell.openExternal(url),
  });

  installRendererRecovery(mainWindow);

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
    exitPackagedSmoke(1);
  });
  setTimeout(showInitialWindow, 2500);

  mainWindow.on('close', () => {
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

// app.exit() skips before-quit/will-quit, so the file watcher started by the
// renderer (FileTree → files:watch) would still be live during Electron's
// Node teardown. Historically (fsevents 2.3.x) that deadlocked the exit; the
// fs.watch-based watcher closes synchronously, but the teardown-before-exit
// ordering is kept so no service outlives will-quit. Run it first, then exit.
let packagedSmokeExitStarted = false;
async function exitPackagedSmoke(code) {
  if (packagedSmokeExitStarted) return;
  packagedSmokeExitStarted = true;
  try {
    await Promise.race([shutdownServices(), sleep(SMOKE_SHUTDOWN_TIMEOUT_MS)]);
  } finally {
    app.exit(code);
  }
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
    setTimeout(() => { exitPackagedSmoke(0); }, 250);
  } catch (err) {
    console.error(`${SMOKE_FAILURE_PREFIX}${JSON.stringify({ error: err.message })}`);
    exitPackagedSmoke(1);
  }
}

function initServices() {
  const settings = getSettingsSnapshot();
  const serviceSettingsStore = runtimeSettingsStore || store;
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
  telegramNotifier = new TelegramNotifier(serviceSettingsStore);
  githubNotifier = new GitHubNotifier({
    settingsStore: serviceSettingsStore, // decrypts githubToken; reads repos/toggles
    stateStore: store, // persists last-seen cursors (githubPollState)
    notifier: telegramNotifier,
  });
  projectProfiles = new ProjectProfiles();
  sessionHistory = new SessionHistory(store);
  promptStore = new PromptStore();
  nockccClient = new NockCCClient(serviceSettingsStore);
  agentDispatchService = new AgentDispatchService(serviceSettingsStore);
}

function registerIPC() {
  registerSystemWindowIPC({
    ipcMain,
    app,
    shell,
    clipboard,
    portScanner,
    fileService,
    getMainWindow: () => mainWindow,
    getSettingsSnapshot,
  });

  registerTerminalIPC({
    ipcMain,
    terminalManager,
    projectProfiles,
    getAllowedProjectRoots,
    getSettingsSnapshot,
  });

  // (Terminal data/exit events are wired in wireTerminalEvents() — not here)

  registerSessionIPC({
    ipcMain,
    sessionDiscovery,
    fileService,
    fileWatcher,
  });

  registerDispatchIPC({
    ipcMain,
    agentDispatchService,
  });

  registerOllamaIPC({
    ipcMain,
    ollamaClient,
    getMainWindow: () => mainWindow,
  });

  registerSettingsIPC({
    ipcMain,
    store,
    secureSettings,
    getSettingsSnapshot,
    applySettingsRuntimeEffects,
    applyResetRuntimeEffects,
  });

  registerFileIPC({
    ipcMain,
    fileService,
    fileWatcher,
  });

  registerTelegramIPC({
    ipcMain,
    telegramNotifier,
  });

  nockccActivityController = createNockCCActivityIPC({
    ipcMain,
    nockccClient,
    machine: process.platform,
    appVersion,
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
  terminalManager.on('exit', (id, code, details, meta) => {
    mainWindow?.webContents.send('terminal:exit', { id, code });
    // End session in history
    if (sessionHistory) {
      sessionHistory.endSession(id, code);
    }
    // Telegram "session ended" notification — only for a natural process exit,
    // not a user-closed tab (reason: 'destroyed') or a reaped orphan. notify()
    // self-gates on enablement/quiet-hours/toggle, so this is a no-op unless the
    // user configured it. Fire-and-forget: never let it affect teardown.
    if (details?.reason === 'process-exit') {
      telegramNotifier
        ?.notify('session_ended', TelegramNotifier.formatSessionEndedDetail(meta?.cwd, code))
        ?.catch(() => {});
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

// Single-instance lock: a second launch of this tray app would spawn a
// duplicate TerminalManager/Tray and race the global-shortcut registration.
// The primary instance focuses its window when a second launch is attempted.
const singleInstance = acquireSingleInstanceLock(app, () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
  } else {
    createWindow();
  }
});
if (!singleInstance.acquired) {
  app.quit();
}

app.whenReady().then(() => {
  if (!singleInstance.acquired) return;
  secureSettings = new SecureSettingsStore({ store, safeStorage });
  runtimeSettingsStore = createSecureSettingsFacade(store, secureSettings);
  repairStoredSettings();
  configureAppBranding();
  initServices();
  createWindow();
  createTray();
  registerIPC();
  wireTerminalEvents();
  wireFileEvents();
  processDetector.start();

  nockccActivityController?.start();
  githubNotifier?.start();

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

// Shared by the normal quit path (will-quit) and the packaged smoke exit.
// Returns the file-watcher close promise so exit paths that bypass the quit
// events (app.exit) can wait for fsevents teardown before terminating.
function shutdownServices() {
  globalShortcut.unregisterAll();
  terminalManager?.destroyAll();
  const watcherClosed = fileWatcher?.stop();
  processDetector?.stop();
  nockccActivityController?.stop();
  githubNotifier?.stop();
  return watcherClosed || Promise.resolve();
}

app.on('will-quit', () => {
  shutdownServices();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

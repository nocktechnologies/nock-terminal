const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nockTerminal', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setAlwaysOnTop: (value) => ipcRenderer.invoke('window:setAlwaysOnTop', value),
    setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  },

  // System info
  system: {
    detectShells: () => ipcRenderer.invoke('system:detectShells'),
    ollamaVersion: () => ipcRenderer.invoke('system:ollamaVersion'),
    appVersion: () => ipcRenderer.invoke('system:appVersion'),
  },

  // Terminal
  terminal: {
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
    destroy: (id) => ipcRenderer.send('terminal:destroy', { id }),
    onData: (callback) => {
      const handler = (_, payload) => callback(payload.id, payload.data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback) => {
      const handler = (_, payload) => callback(payload.id, payload.code);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  // Sessions
  sessions: {
    discover: () => ipcRenderer.invoke('sessions:discover'),
  },

  // AI Chat
  ai: {
    ollama: {
      chat: (model, messages) => ipcRenderer.invoke('ai:ollama:chat', { model, messages }),
      models: () => ipcRenderer.invoke('ai:ollama:models'),
      status: () => ipcRenderer.invoke('ai:ollama:status'),
    },
    claude: {
      chat: (message, mode, cwd) => ipcRenderer.invoke('ai:claude:chat', { message, mode, cwd }),
    },
    onStream: (callback) => {
      const handler = (_, payload) => callback(payload.chunk);
      ipcRenderer.on('ai:stream', handler);
      return () => ipcRenderer.removeListener('ai:stream', handler);
    },
  },

  // Ports
  ports: {
    scan: () => ipcRenderer.invoke('ports:scan'),
  },

  // Settings
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    getSecure: (key) => ipcRenderer.invoke('settings:getSecure', key),
    set: (key, value) => ipcRenderer.send('settings:set', { key, value }),
  },

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    showItemInFolder: (filePath) => ipcRenderer.send('shell:showItemInFolder', filePath),
  },

  // Clipboard
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },

  // Telegram notifications
  telegram: {
    test: () => ipcRenderer.invoke('telegram:test'),
    notify: (eventType, details) => ipcRenderer.invoke('telegram:notify', { eventType, details }),
  },

  // Project profiles
  profiles: {
    get: (projectPath) => ipcRenderer.invoke('profiles:get', projectPath),
    save: (projectPath, profile) => ipcRenderer.invoke('profiles:save', { projectPath, profile }),
    delete: (projectPath) => ipcRenderer.invoke('profiles:delete', projectPath),
    list: () => ipcRenderer.invoke('profiles:list'),
  },

  // Prompt library
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    get: (id) => ipcRenderer.invoke('prompts:get', id),
    save: (id, data) => ipcRenderer.invoke('prompts:save', { id, data }),
    delete: (id) => ipcRenderer.invoke('prompts:delete', id),
  },

  // Session history
  sessionHistory: {
    list: () => ipcRenderer.invoke('sessionHistory:list'),
    getOutput: (startTime, tabId) => ipcRenderer.invoke('sessionHistory:getOutput', { startTime, tabId }),
    start: (tabId, metadata) => ipcRenderer.invoke('sessionHistory:start', { tabId, metadata }),
  },

  // File operations
  files: {
    tree: (dirPath) => ipcRenderer.invoke('files:tree', dirPath),
    read: (filePath) => ipcRenderer.invoke('files:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('files:write', { filePath, content }),
    stat: (filePath) => ipcRenderer.invoke('files:stat', filePath),
    gitStatus: (dirPath) => ipcRenderer.invoke('files:gitStatus', dirPath),
    watch: (dirPath) => ipcRenderer.send('files:watch', dirPath),
    stopWatch: () => ipcRenderer.send('files:stopWatch'),
    onChanged: (callback) => {
      const handler = (_, event) => callback(event);
      ipcRenderer.on('files:changed', handler);
      return () => ipcRenderer.removeListener('files:changed', handler);
    },
    onGitStatus: (callback) => {
      const handler = (_, status) => callback(status);
      ipcRenderer.on('files:gitStatus', handler);
      return () => ipcRenderer.removeListener('files:gitStatus', handler);
    },
  },

  // Process detection
  process: {
    onStatus: (callback) => {
      const handler = (_, status) => callback(status);
      ipcRenderer.on('process:status', handler);
      return () => ipcRenderer.removeListener('process:status', handler);
    },
  },
});

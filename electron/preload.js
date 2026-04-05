const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nockTerminal', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
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
    set: (key, value) => ipcRenderer.send('settings:set', { key, value }),
  },

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  },
});

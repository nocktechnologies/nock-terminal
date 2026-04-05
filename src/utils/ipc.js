// Typed wrappers around window.nockTerminal IPC bridge

const api = () => window.nockTerminal;

// Window controls
export const windowControls = {
  minimize: () => api().window.minimize(),
  maximize: () => api().window.maximize(),
  close: () => api().window.close(),
  isMaximized: () => api().window.isMaximized(),
};

// Terminal
export const terminal = {
  create: (id, cwd, shell) => api().terminal.create({ id, cwd, shell }),
  write: (id, data) => api().terminal.write(id, data),
  resize: (id, cols, rows) => api().terminal.resize(id, cols, rows),
  destroy: (id) => api().terminal.destroy(id),
  onData: (cb) => api().terminal.onData(cb),
  onExit: (cb) => api().terminal.onExit(cb),
};

// Sessions
export const sessions = {
  discover: () => api().sessions.discover(),
};

// AI
export const ai = {
  ollama: {
    chat: (model, messages) => api().ai.ollama.chat(model, messages),
    models: () => api().ai.ollama.models(),
    status: () => api().ai.ollama.status(),
  },
  claude: {
    chat: (message, mode, cwd) => api().ai.claude.chat(message, mode, cwd),
  },
  onStream: (cb) => api().ai.onStream(cb),
};

// Ports
export const ports = {
  scan: () => api().ports.scan(),
};

// Settings
export const settings = {
  get: (key) => api().settings.get(key),
  getAll: () => api().settings.getAll(),
  set: (key, value) => api().settings.set(key, value),
};

// Shell
export const shell = {
  openExternal: (url) => api().shell.openExternal(url),
};

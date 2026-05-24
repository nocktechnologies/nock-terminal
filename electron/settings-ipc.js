const {
  SETTINGS_SCHEMA_KEY,
  SETTINGS_SCHEMA_VERSION,
  createSettingsResetSnapshot,
  getSecureSettingStatus,
  getSettingForRenderer,
  sanitizeSettingsForExport,
  sanitizeSettingsForRenderer,
} = require('./settings-utils');
const {
  errorPayload,
  validateSettingsSetPayload,
} = require('./ipc-validators');

const SECURE_SETTING_READ_KEYS = new Set(['telegramBotToken', 'nockccApiKey']);

function registerSettingsIPC({
  ipcMain,
  store,
  getSettingsSnapshot,
  applySettingsRuntimeEffects,
  applyResetRuntimeEffects,
}) {
  ipcMain.handle('settings:get', (_, key) => {
    return getSettingForRenderer(store.store, key);
  });

  ipcMain.handle('settings:getAll', () => {
    return sanitizeSettingsForRenderer(store.store);
  });

  ipcMain.handle('settings:export', () => {
    return sanitizeSettingsForExport(store.store);
  });

  ipcMain.handle('settings:getSecure', (_, key) => {
    if (!SECURE_SETTING_READ_KEYS.has(key)) return null;
    return getSettingsSnapshot()[key];
  });

  ipcMain.handle('settings:getSecureStatus', (_, key) => {
    return getSecureSettingStatus(store.store, key);
  });

  ipcMain.handle('settings:reset', (_, options = {}) => {
    const resetSnapshot = createSettingsResetSnapshot(store.store, {
      preserveWindowBounds: options?.preserveWindowBounds !== false,
    });

    store.clear();
    for (const [key, value] of Object.entries(resetSnapshot)) {
      store.set(key, value);
    }
    store.set(SETTINGS_SCHEMA_KEY, SETTINGS_SCHEMA_VERSION);

    applyResetRuntimeEffects(resetSnapshot);
    return sanitizeSettingsForRenderer(store.store);
  });

  ipcMain.handle('settings:set', (_, payload) => {
    const validated = validateSettingsSetPayload(payload);
    if (!validated.ok) return errorPayload(validated);

    const { key, value } = validated.value;
    store.set(key, value);
    const currentValue = getSettingsSnapshot()[key];
    applySettingsRuntimeEffects(key, currentValue);
    return { success: true, key, value: currentValue };
  });
}

module.exports = {
  registerSettingsIPC,
};

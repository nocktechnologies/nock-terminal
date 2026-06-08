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
const { SECURE_SETTING_KEYS } = require('./secure-settings-store');

function registerSettingsIPC({
  ipcMain,
  store,
  secureSettings,
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
    if (!SECURE_SETTING_KEYS.has(key)) return null;
    return null;
  });

  ipcMain.handle('settings:getSecureStatus', (_, key) => {
    if (secureSettings?.getStatus) {
      return secureSettings.getStatus(key);
    }
    return getSecureSettingStatus(store.store, key);
  });

  ipcMain.handle('settings:reset', (_, options = {}) => {
    const resetSnapshot = createSettingsResetSnapshot(store.store, {
      preserveWindowBounds: options?.preserveWindowBounds !== false,
    });

    secureSettings?.clearAll?.();
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
    if (SECURE_SETTING_KEYS.has(key)) {
      if (secureSettings?.set) {
        secureSettings.set(key, value);
      } else {
        store.set(key, '');
      }
      const currentValue = secureSettings?.get?.(key) || '';
      applySettingsRuntimeEffects(key, currentValue);
      return { success: true, key, value: '' };
    }

    store.set(key, value);
    const currentValue = getSettingsSnapshot()[key];
    applySettingsRuntimeEffects(key, currentValue);
    return { success: true, key, value: currentValue };
  });
}

module.exports = {
  registerSettingsIPC,
};

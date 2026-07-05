'use strict';

const SECURE_SETTINGS_STORE_KEY = 'secureSettings';
const SECURE_SETTING_KEYS = new Set(['telegramBotToken', 'nockccApiKey', 'githubToken']);

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

class SecureSettingsStore {
  constructor({ store, safeStorage } = {}) {
    this.store = store;
    this.safeStorage = safeStorage;
    this.memorySecrets = new Map();
  }

  isSecureKey(key) {
    return SECURE_SETTING_KEYS.has(key);
  }

  canEncrypt() {
    if (!this.safeStorage) return false;
    if (typeof this.safeStorage.encryptString !== 'function') return false;
    if (typeof this.safeStorage.decryptString !== 'function') return false;
    if (typeof this.safeStorage.isEncryptionAvailable !== 'function') return true;
    try {
      return this.safeStorage.isEncryptionAvailable() !== false;
    } catch {
      return false;
    }
  }

  get(key) {
    if (!this.isSecureKey(key)) return undefined;

    const encrypted = this.readEncryptedValue(key);
    if (typeof encrypted === 'string') return encrypted;

    if (this.memorySecrets.has(key)) {
      return this.memorySecrets.get(key);
    }

    const legacy = this.readLegacyPlaintextValue(key);
    return typeof legacy === 'string' ? legacy : '';
  }

  set(key, value) {
    if (!this.isSecureKey(key)) return null;

    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      this.clear(key);
      return this.getStatus(key);
    }

    this.clearPlaintextValue(key);

    if (this.canEncrypt()) {
      const encrypted = this.encrypt(normalized);
      if (encrypted) {
        this.memorySecrets.delete(key);
        this.writeEncryptedEntry(key, {
          value: encrypted,
          encoding: 'base64',
          storage: 'safeStorage',
        });
        return this.getStatus(key);
      }
    }

    this.removeEncryptedEntry(key);
    this.memorySecrets.set(key, normalized);
    return this.getStatus(key);
  }

  clear(key) {
    if (!this.isSecureKey(key)) return;
    this.memorySecrets.delete(key);
    this.removeEncryptedEntry(key);
    this.clearPlaintextValue(key);
  }

  clearAll() {
    for (const key of SECURE_SETTING_KEYS) {
      this.clear(key);
    }
  }

  migrateLegacySettings() {
    const migratedKeys = [];
    for (const key of SECURE_SETTING_KEYS) {
      const value = this.readLegacyPlaintextValue(key);
      if (typeof value === 'string' && value.length > 0) {
        this.set(key, value);
        migratedKeys.push(key);
      } else {
        this.clearPlaintextValue(key);
      }
    }
    return { migratedKeys };
  }

  getStatus(key) {
    if (!this.isSecureKey(key)) return null;
    const value = this.get(key);
    if (!value) {
      return { key, configured: false, storage: 'none' };
    }

    return {
      key,
      configured: true,
      storage: this.hasEncryptedEntry(key) ? 'safeStorage' : 'memory',
    };
  }

  applyToSettings(settings = {}) {
    const merged = { ...settings };
    for (const key of SECURE_SETTING_KEYS) {
      merged[key] = this.get(key) || '';
    }
    return merged;
  }

  readLegacyPlaintextValue(key) {
    const value = typeof this.store?.get === 'function'
      ? this.store.get(key)
      : this.store?.store?.[key];
    return typeof value === 'string' ? value : '';
  }

  clearPlaintextValue(key) {
    if (typeof this.store?.set === 'function') {
      this.store.set(key, '');
    } else if (this.store?.store && typeof this.store.store === 'object') {
      this.store.store[key] = '';
    }
  }

  readNamespace() {
    const value = typeof this.store?.get === 'function'
      ? this.store.get(SECURE_SETTINGS_STORE_KEY)
      : this.store?.store?.[SECURE_SETTINGS_STORE_KEY];
    return safeObject(value);
  }

  writeNamespace(namespace) {
    if (typeof this.store?.set === 'function') {
      this.store.set(SECURE_SETTINGS_STORE_KEY, namespace);
    } else if (this.store?.store && typeof this.store.store === 'object') {
      this.store.store[SECURE_SETTINGS_STORE_KEY] = namespace;
    }
  }

  deleteNamespace() {
    if (typeof this.store?.delete === 'function') {
      this.store.delete(SECURE_SETTINGS_STORE_KEY);
    } else if (this.store?.store && typeof this.store.store === 'object') {
      delete this.store.store[SECURE_SETTINGS_STORE_KEY];
    }
  }

  hasEncryptedEntry(key) {
    return Boolean(this.readNamespace()[key]?.value);
  }

  writeEncryptedEntry(key, entry) {
    const namespace = this.readNamespace();
    namespace[key] = entry;
    this.writeNamespace(namespace);
  }

  removeEncryptedEntry(key) {
    const namespace = this.readNamespace();
    if (!Object.prototype.hasOwnProperty.call(namespace, key)) return;
    delete namespace[key];
    if (Object.keys(namespace).length > 0) {
      this.writeNamespace(namespace);
    } else {
      this.deleteNamespace();
    }
  }

  readEncryptedValue(key) {
    const entry = this.readNamespace()[key];
    if (!entry?.value || entry.encoding !== 'base64') return undefined;
    return this.decrypt(entry.value);
  }

  encrypt(value) {
    try {
      return Buffer.from(this.safeStorage.encryptString(value)).toString('base64');
    } catch {
      return '';
    }
  }

  decrypt(value) {
    if (!this.canEncrypt()) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }
}

function readStoreValue(store, key, defaultValue) {
  if (typeof store?.get === 'function') {
    return store.get(key, defaultValue);
  }
  if (store?.store && Object.prototype.hasOwnProperty.call(store.store, key)) {
    return store.store[key];
  }
  return defaultValue;
}

function createSecureSettingsFacade(store, secureSettings) {
  return new Proxy(store || {}, {
    get(target, prop) {
      if (prop === 'get') {
        return (key, defaultValue) => {
          if (secureSettings?.isSecureKey?.(key)) {
            return secureSettings.get(key);
          }
          return readStoreValue(target, key, defaultValue);
        };
      }

      if (prop === 'store') {
        return secureSettings?.applyToSettings?.(target?.store || {}) || target?.store || {};
      }

      const value = target?.[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = {
  SECURE_SETTINGS_STORE_KEY,
  SECURE_SETTING_KEYS,
  SecureSettingsStore,
  createSecureSettingsFacade,
};

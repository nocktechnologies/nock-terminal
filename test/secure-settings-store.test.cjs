const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SECURE_SETTINGS_STORE_KEY,
  SECURE_SETTING_KEYS,
  SecureSettingsStore,
  createSecureSettingsFacade,
} = require('../electron/secure-settings-store');

function createMemoryStore(initial = {}) {
  const backing = { ...initial };
  return {
    get store() {
      return backing;
    },
    get(key, defaultValue) {
      return Object.prototype.hasOwnProperty.call(backing, key) ? backing[key] : defaultValue;
    },
    set(key, value) {
      backing[key] = value;
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(backing, key);
    },
  };
}

function createFakeSafeStorage() {
  return {
    isEncryptionAvailable() {
      return true;
    },
    encryptString(value) {
      return Buffer.from(`encrypted:${value}`, 'utf8');
    },
    decryptString(buffer) {
      return buffer.toString('utf8').replace(/^encrypted:/, '');
    },
  };
}

test('SecureSettingsStore migrates legacy plaintext secrets into encrypted blobs', () => {
  const store = createMemoryStore({
    telegramBotToken: '123:secret',
    nockccApiKey: 'nock-secret',
    githubToken: 'gh-secret',
  });
  const secureSettings = new SecureSettingsStore({
    store,
    safeStorage: createFakeSafeStorage(),
  });

  const result = secureSettings.migrateLegacySettings();

  assert.deepEqual(result.migratedKeys.sort(), [...SECURE_SETTING_KEYS].sort());
  assert.equal(store.store.telegramBotToken, '');
  assert.equal(store.store.nockccApiKey, '');
  assert.equal(store.store.githubToken, '');
  assert.equal(secureSettings.get('telegramBotToken'), '123:secret');
  assert.equal(secureSettings.get('nockccApiKey'), 'nock-secret');
  assert.equal(secureSettings.get('githubToken'), 'gh-secret');
  assert.notEqual(store.store[SECURE_SETTINGS_STORE_KEY].telegramBotToken.value, '123:secret');
  assert.equal(store.store[SECURE_SETTINGS_STORE_KEY].telegramBotToken.encoding, 'base64');
  assert.deepEqual(secureSettings.getStatus('telegramBotToken'), {
    key: 'telegramBotToken',
    configured: true,
    storage: 'safeStorage',
  });
});

test('SecureSettingsStore keeps unavailable safeStorage secrets in memory without plaintext persistence', () => {
  const store = createMemoryStore({
    telegramBotToken: '123:secret',
  });
  const secureSettings = new SecureSettingsStore({
    store,
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
    },
  });

  secureSettings.migrateLegacySettings();
  secureSettings.set('nockccApiKey', 'nock-secret');

  assert.equal(store.store.telegramBotToken, '');
  assert.equal(store.store.nockccApiKey, '');
  assert.equal(store.store[SECURE_SETTINGS_STORE_KEY], undefined);
  assert.equal(secureSettings.get('telegramBotToken'), '123:secret');
  assert.equal(secureSettings.get('nockccApiKey'), 'nock-secret');
  assert.deepEqual(secureSettings.getStatus('telegramBotToken'), {
    key: 'telegramBotToken',
    configured: true,
    storage: 'memory',
  });
});

test('createSecureSettingsFacade exposes decrypted secrets only to main-process services', () => {
  const store = createMemoryStore({
    defaultModel: 'llama3.2',
    telegramBotToken: '',
  });
  const secureSettings = new SecureSettingsStore({
    store,
    safeStorage: createFakeSafeStorage(),
  });

  secureSettings.set('telegramBotToken', '123:secret');
  const facade = createSecureSettingsFacade(store, secureSettings);

  assert.equal(facade.get('defaultModel'), 'llama3.2');
  assert.equal(facade.get('telegramBotToken'), '123:secret');
  assert.equal(facade.store.telegramBotToken, '123:secret');
  assert.equal(store.store.telegramBotToken, '');
  assert.equal(facade.has('defaultModel'), true);
});

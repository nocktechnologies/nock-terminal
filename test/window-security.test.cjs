const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  APP_DEV_ORIGIN,
  isAllowedNavigationUrl,
  decideWindowOpen,
  installWindowSecurity,
  acquireSingleInstanceLock,
} = require('../electron/window-security');

// --- isAllowedNavigationUrl -------------------------------------------------

test('dev: only the Vite dev origin is allowed', () => {
  assert.equal(isAllowedNavigationUrl(`${APP_DEV_ORIGIN}/index.html`, { isDev: true }), true);
  assert.equal(isAllowedNavigationUrl(`${APP_DEV_ORIGIN}/foo?bar=1`, { isDev: true }), true);
  assert.equal(isAllowedNavigationUrl('http://localhost:5174/', { isDev: true }), false);
  assert.equal(isAllowedNavigationUrl('https://evil.example/', { isDev: true }), false);
  assert.equal(isAllowedNavigationUrl('http://100.67.243.87:8080/', { isDev: true }), false);
});

test('packaged: file:// inside the app dir is allowed, outside is denied', () => {
  const appDir = path.join('/tmp', 'nock-app', 'dist-react');
  const inside = `file://${path.join(appDir, 'index.html')}`;
  const outside = 'file:///etc/passwd';
  const sibling = `file://${path.join('/tmp', 'nock-app', 'dist-react-evil', 'x.html')}`;

  assert.equal(isAllowedNavigationUrl(inside, { isDev: false, appDir }), true);
  assert.equal(isAllowedNavigationUrl(outside, { isDev: false, appDir }), false);
  assert.equal(isAllowedNavigationUrl(sibling, { isDev: false, appDir }), false);
});

test('packaged: a remote origin is never an allowed navigation', () => {
  const appDir = path.join('/tmp', 'nock-app', 'dist-react');
  assert.equal(isAllowedNavigationUrl('https://evil.example/', { isDev: false, appDir }), false);
  assert.equal(isAllowedNavigationUrl(APP_DEV_ORIGIN, { isDev: false, appDir }), false);
});

test('malformed / empty URLs are denied', () => {
  assert.equal(isAllowedNavigationUrl('not a url', { isDev: true }), false);
  assert.equal(isAllowedNavigationUrl('', { isDev: false, appDir: '/tmp' }), false);
  assert.equal(isAllowedNavigationUrl(undefined, { isDev: true }), false);
});

// --- decideWindowOpen -------------------------------------------------------

test('window-open is always denied; web links are surfaced externally', () => {
  assert.deepEqual(decideWindowOpen('https://nocktechnologies.com'), {
    action: 'deny',
    openExternally: 'https://nocktechnologies.com',
  });
  assert.deepEqual(decideWindowOpen('http://localhost:3000'), {
    action: 'deny',
    openExternally: 'http://localhost:3000',
  });
  assert.deepEqual(decideWindowOpen('file:///etc/passwd'), { action: 'deny', openExternally: null });
  assert.deepEqual(decideWindowOpen('javascript:alert(1)'), { action: 'deny', openExternally: null });
  assert.deepEqual(decideWindowOpen('garbage'), { action: 'deny', openExternally: null });
});

// --- installWindowSecurity --------------------------------------------------

function makeFakeWebContents() {
  const listeners = {};
  return {
    windowOpenHandler: null,
    setWindowOpenHandler(fn) {
      this.windowOpenHandler = fn;
    },
    on(event, fn) {
      listeners[event] = fn;
    },
    emit(event, ...args) {
      if (listeners[event]) listeners[event](...args);
    },
  };
}

test('window-open handler denies and routes web links to openExternal', () => {
  const opened = [];
  const wc = makeFakeWebContents();
  installWindowSecurity(wc, { isDev: true, openExternal: (u) => opened.push(u) });

  const webResult = wc.windowOpenHandler({ url: 'https://nocktechnologies.com' });
  assert.deepEqual(webResult, { action: 'deny' });
  assert.deepEqual(opened, ['https://nocktechnologies.com']);

  const fileResult = wc.windowOpenHandler({ url: 'file:///etc/passwd' });
  assert.deepEqual(fileResult, { action: 'deny' });
  assert.deepEqual(opened, ['https://nocktechnologies.com'], 'file:// must not be opened externally');
});

test('will-navigate blocks disallowed targets and allows the app origin', () => {
  const opened = [];
  let prevented = 0;
  const wc = makeFakeWebContents();
  installWindowSecurity(wc, { isDev: true, openExternal: (u) => opened.push(u) });

  const evt = () => ({ preventDefault() { prevented += 1; } });

  // Allowed: same dev origin → no preventDefault, no external open.
  wc.emit('will-navigate', evt(), `${APP_DEV_ORIGIN}/route`);
  assert.equal(prevented, 0);

  // Disallowed remote → preventDefault + opened externally (it is http/https).
  wc.emit('will-navigate', evt(), 'https://evil.example/');
  assert.equal(prevented, 1);
  assert.deepEqual(opened, ['https://evil.example/']);

  // Disallowed non-web (file) → preventDefault, NOT opened externally.
  wc.emit('will-navigate', evt(), 'file:///etc/passwd');
  assert.equal(prevented, 2);
  assert.deepEqual(opened, ['https://evil.example/']);
});

test('openExternal failures never throw out of the guard', () => {
  const wc = makeFakeWebContents();
  installWindowSecurity(wc, {
    isDev: true,
    openExternal: () => { throw new Error('boom'); },
  });
  assert.doesNotThrow(() => wc.windowOpenHandler({ url: 'https://example.com' }));
});

// --- acquireSingleInstanceLock ----------------------------------------------

function makeFakeApp(lockResult) {
  const handlers = {};
  return {
    requestSingleInstanceLock: () => lockResult,
    on(event, fn) {
      handlers[event] = fn;
    },
    handlers,
  };
}

test('single-instance: primary acquires the lock and wires second-instance', () => {
  let focused = 0;
  const app = makeFakeApp(true);
  const result = acquireSingleInstanceLock(app, () => { focused += 1; });
  assert.deepEqual(result, { acquired: true });
  assert.equal(typeof app.handlers['second-instance'], 'function');
  app.handlers['second-instance']();
  assert.equal(focused, 1);
});

test('single-instance: a second launch fails to acquire', () => {
  const app = makeFakeApp(false);
  const result = acquireSingleInstanceLock(app, () => {});
  assert.deepEqual(result, { acquired: false });
  assert.equal(app.handlers['second-instance'], undefined);
});

test('single-instance: missing primitive does not block startup', () => {
  assert.deepEqual(acquireSingleInstanceLock(null, () => {}), { acquired: true });
  assert.deepEqual(acquireSingleInstanceLock({}, () => {}), { acquired: true });
});

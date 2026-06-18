const path = require('path');

// Renderer containment hardening.
//
// The renderer holds no privilege of its own, but `terminal:write` forwards
// any string to a live PTY, so a renderer foothold (XSS, or navigation to
// attacker-controlled content) is a real escalation path. These guards close
// the two main-side gaps the June-7 audit flagged: (1) no navigation/window
// guards, (2) no single-instance lock. The decision logic is kept dependency
// -light here so it is unit-testable without booting Electron.

const APP_DEV_ORIGIN = 'http://localhost:5173';

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// True only for URLs the renderer may navigate the main frame to: the Vite dev
// origin in dev, or a file:// URL inside the packaged app directory. Everything
// else (remote origins, file:// outside the app dir, malformed URLs) is denied.
function isAllowedNavigationUrl(targetUrl, { isDev = false, appDir = '' } = {}) {
  const parsed = safeParseUrl(targetUrl);
  if (!parsed) return false;

  if (isDev) {
    return parsed.origin === APP_DEV_ORIGIN;
  }

  if (parsed.protocol !== 'file:') return false;
  if (!appDir) return true;

  let filePath;
  try {
    filePath = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  // Windows file URLs carry a leading slash before the drive (/C:/...).
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  const normalizedTarget = path.resolve(filePath);
  const root = path.resolve(appDir);
  const relative = path.relative(root, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Window-open requests are always denied in-app. A genuine http(s) link is
// surfaced to the OS browser instead (matching the existing openExternal
// allowlist); anything else is dropped silently.
function decideWindowOpen(targetUrl) {
  const parsed = safeParseUrl(targetUrl);
  const isWebUrl = !!parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  return { action: 'deny', openExternally: isWebUrl ? targetUrl : null };
}

// Wire the guards onto a webContents. `openExternal` is injected (shell.open
// External in production) so this stays testable with a plain fake.
function installWindowSecurity(webContents, { isDev = false, appDir = '', openExternal } = {}) {
  if (!webContents) return;

  const openSafely = (url) => {
    if (url && typeof openExternal === 'function') {
      try {
        openExternal(url);
      } catch {
        // Best-effort: never let an openExternal failure crash the main process.
      }
    }
  };

  if (typeof webContents.setWindowOpenHandler === 'function') {
    webContents.setWindowOpenHandler(({ url }) => {
      const { openExternally } = decideWindowOpen(url);
      openSafely(openExternally);
      return { action: 'deny' };
    });
  }

  if (typeof webContents.on === 'function') {
    webContents.on('will-navigate', (event, url) => {
      if (isAllowedNavigationUrl(url, { isDev, appDir })) return;
      event.preventDefault();
      openSafely(decideWindowOpen(url).openExternally);
    });
  }
}

// Acquire the OS single-instance lock. When a second launch is attempted the
// running instance gets a `second-instance` event (used to focus the existing
// window). Returns { acquired }. If the lock primitive is unavailable we do not
// block startup — a missing lock is a lifecycle defect, not a security gate.
function acquireSingleInstanceLock(appRef, onSecondInstance) {
  if (!appRef || typeof appRef.requestSingleInstanceLock !== 'function') {
    return { acquired: true };
  }
  const acquired = appRef.requestSingleInstanceLock();
  if (!acquired) return { acquired: false };
  if (typeof appRef.on === 'function' && typeof onSecondInstance === 'function') {
    appRef.on('second-instance', onSecondInstance);
  }
  return { acquired: true };
}

module.exports = {
  APP_DEV_ORIGIN,
  isAllowedNavigationUrl,
  decideWindowOpen,
  installWindowSecurity,
  acquireSingleInstanceLock,
};

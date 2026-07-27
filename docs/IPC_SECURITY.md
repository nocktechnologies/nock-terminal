# IPC Security Notes

Nock Terminal keeps renderer access behind the preload bridge with
`contextIsolation: true` and `nodeIntegration: false`. Risky renderer inputs are
validated in the main process before they reach terminal spawning, file access,
settings persistence, profile/prompt stores, or dispatch payload creation.

Telegram and NockCC credentials are owned by the main process. Legacy plaintext
values are migrated into Electron `safeStorage` encrypted blobs when OS-backed
encryption is available, and are cleared from top-level `electron-store` keys.
If `safeStorage` is unavailable, secrets are kept in main-process memory for the
current run instead of being persisted as plaintext. Renderer settings reads and
exports only expose blank/status values; `settings:getSecure` is retained as a
compatibility channel but returns `null` for allowlisted secret keys.

`sandbox: true` is set in `BrowserWindow.webPreferences` (`electron/main.js`).
The preload bridge only requires the sandbox-safe `electron` renderer APIs
(`contextBridge` + `ipcRenderer`), so the renderer runs fully sandboxed on the
current Electron 41 runtime. `node-pty` is only loaded in the main process, not
in the renderer or preload.

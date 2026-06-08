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

`sandbox: false` remains in `BrowserWindow.webPreferences` for now because the
current Electron 28 preload is a CommonJS bridge that still needs a dedicated
smoke pass before switching to `sandbox: true`. `node-pty` is only loaded in the
main process, not in the renderer or preload. Revisit this after migrating or
verifying the preload under Electron's sandboxed-preload constraints.

# IPC Security Notes

Nock Terminal keeps renderer access behind the preload bridge with
`contextIsolation: true` and `nodeIntegration: false`. Risky renderer inputs are
validated in the main process before they reach terminal spawning, file access,
settings persistence, profile/prompt stores, or dispatch payload creation.

`sandbox: false` remains in `BrowserWindow.webPreferences` for now because the
current Electron 28 preload is a CommonJS bridge that still needs a dedicated
smoke pass before switching to `sandbox: true`. `node-pty` is only loaded in the
main process, not in the renderer or preload. Revisit this after migrating or
verifying the preload under Electron's sandboxed-preload constraints.

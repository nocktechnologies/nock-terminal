# Changelog

This changelog is summarized from git history. The repository has no version tags; `package.json` currently reports version `1.0.0`.

## 1.0.0 - Current

### 2026-04-28

- Completed an Iris polish pass across the Nock Terminal UI.

### 2026-04-19

- Added the Anvil Codex security review workflow for pull requests.

### 2026-04-17

- Added macOS code signing and release workflow support.
- Fixed zsh/bash spawning so interactive login shells load aliases.
- Fixed alt-screen terminal wheel scrolling so TUIs scroll viewport content instead of cycling input history.

### 2026-04-15

- Added GitHub Actions CI for tests and Vite builds.
- Added git Pull, Push, and Fetch toolbar buttons with status feedback.
- Hardened global shortcut fallback behavior.
- Improved cross-platform shell detection and login shell support.
- Added platform-aware icons and macOS/Linux build targets.
- Pinned `node-pty` to stable `1.1.0`.

### 2026-04-12 - 2026-04-13

- Split Nock Terminal into a standalone repo with repository metadata and README.
- Added NockCC session tracking integration.
- Added toolbar git operations and early cross-platform shell/icon/shortcut fixes.

### 2026-04-11

- Hardened the Electron security boundary.
- Added an OAuth 2.1 shim for claude.ai custom connectors to reach `/mcp/`.
- Addressed PR review feedback.

### 2026-04-06

- Expanded settings into full sections with auto-persist.
- Added persistent status bar, dynamic model selector, Ollama API integration, and Kit/Mara entries.
- Added Telegram notifications with quiet hours.
- Added project profiles, session history, output capture, and prompt library.
- Added tab management and context menus for cards, tabs, and file tree.
- Fixed bot token handling, Ollama status checks, duplicate tab tracking, security, error handling, and stale closures.

### 2026-04-05

- Created the Electron + React Nock Terminal app for Windows.
- Added terminal dogfood fixes for typing, shell behavior, and clipboard.
- Added Phase 2 product planning docs.
- Added port monitor process detection, reusable split panes, file service, file watcher, process detector, IPC bridge, file tree, context monitor, Monaco editor pane, action toolbar, and keyboard shortcuts.
- Added terminal/editor/file tree/theme settings.
- Fixed terminal session lifetime across view switches and downgraded chokidar for Electron CommonJS compatibility.

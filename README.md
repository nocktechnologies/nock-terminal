# Nock Terminal

Cross-platform Electron app for managing Claude Code sessions. Built by [Nock Technologies](https://nocktechnologies.io).

## What it does

Nock Terminal is a desktop session manager for Claude Code. It provides:

- **Multi-session management** — run and monitor multiple Claude Code instances side by side
- **Integrated terminal** — full xterm.js terminal with PTY support
- **Session discovery** — auto-detects running Claude Code sessions on the local machine
- **Project profiles** — per-project settings and working directories
- **Prompt store** — save and recall prompts across sessions
- **Monaco editor** — code editor integration for prompt editing
- **Telegram notifications** — session alerts via the Nock notification bus
- **Ollama integration** — optional local model support

## Requirements

- Node.js 18+
- npm 9+
- macOS, Windows, or Linux

## Install

```bash
npm install
```

## Dev

```bash
npm start
```

Starts the Vite dev server and Electron together via `concurrently`.

## Build

```bash
npm run build
```

Produces a distributable in `dist/` via `electron-builder`.

## Test

```bash
npm test
```

Runs the Node.js built-in test runner over `test/**/*.test.cjs`.

## Structure

```
electron/       Main process — window management, IPC, PTY, session discovery
src/            React renderer — UI components
public/         Static assets served by Vite
assets/         App icons (macOS icns, Windows ico)
test/           Unit tests
```

## License

MIT — see [LICENSE](LICENSE).

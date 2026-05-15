# Nock Terminal

Nock Terminal is a cross-platform Electron cockpit for Claude Code work. It has two primary surfaces: Nock Command, the terminal/workbench surface for running sessions, editing files, chatting with local or Claude Code agents, and using git controls; and the dashboard, a project/session overview for discovered Claude Code activity and local dev repositories.

## Tech Stack

- Electron main process with a secure preload IPC bridge
- React 18 renderer built with Vite
- Tailwind CSS for the Nock desktop UI
- xterm.js plus `node-pty` for real shell sessions
- Monaco Editor for file editing
- electron-store for persisted settings
- chokidar for file watching
- Ollama and Claude Code subprocess integrations for AI chat flows
- electron-builder for macOS, Windows, and Linux packaging

## Key Directories

- `electron/` - Main-process services, IPC handlers, PTY management, file access, settings, session discovery, and NockCC integration.
- `src/` - React renderer app and UI components.
- `src/components/` - Dashboard, terminal view, sidebar, settings, editor, chat panel, file tree, tab bar, status bar, and shared controls.
- `src/utils/` - Renderer utilities such as terminal theme definitions.
- `assets/` - App icons and macOS entitlements.
- `public/` - Static assets served by Vite.
- `test/` - Node test-runner unit tests and the Monaco smoke test assets.
- `.github/workflows/` - CI, release, and Codex security review workflows.
- `docs/superpowers/` - Historical product specs and implementation plans.

## Development Setup

1. Install Node.js 18+ and npm 9+.
2. Install dependencies: `npm install`
3. Start the desktop app: `npm start`

`npm start` runs Vite and then launches Electron when `http://localhost:5173` is ready. The app discovers Claude Code sessions from `~/.claude/projects` and can also scan configured dev roots for git repositories.

## Commands

- `npm start` - Run Vite and Electron together for local desktop development.
- `npm run dev` - Run only the Vite renderer server.
- `npm run preview` - Preview a built Vite renderer.
- `npm test` - Run Node test-runner tests.
- `npx vite build` - Build the renderer into `dist-react/`.
- `npm run build` - Build the renderer and package the app with electron-builder.
- `npx electron-builder --mac --publish never` - Build macOS artifacts.
- `npx electron-builder --win --publish never` - Build Windows artifacts.

CI runs `npm test` on Node 20 and 22, then `npx vite build`. Tagged `v*.*.*` releases build macOS DMG and Windows NSIS artifacts.

## What The App Does

- Discovers Claude Code sessions and git projects, then presents them as dashboard cards and sidebar entries.
- Opens PTY-backed terminal tabs, supports splits, keeps terminals mounted across view switches, and launches `claude` from a new tab.
- Provides sidebar file browsing, git status markers, Monaco editing, and project context checks for `CLAUDE.md` and `.nock/config.toml`.
- Provides AI chat against Ollama models and Claude Code modes, including Kit/Mara-style prompts.
- Tracks session history and optional terminal output capture.
- Stores project profiles, prompt library entries, window/settings state, notification preferences, and NockCC connection settings.
- Sends optional Telegram notifications and links terminal app presence to NockCC.

# Nock Terminal

Nock Terminal is a cross-platform Electron cockpit for local agentic coding work. The current implementation is Claude Code and Ollama oriented; the product direction is an agent-agnostic cockpit that can also support Codex CLI and other terminal-first coding agents.

## Product Posture

- Be honest about current capabilities: Claude Code transcript discovery, local agent-folder discovery from existing `config.json` files, local NockCC file-bus state checks, Claude/Codex/Gemini process and context adapters, Claude/Codex/Gemini/custom terminal launch profiles, Codex/DeepSeek dispatch-agent discovery and Mira-brokered/direct dispatch requests, Ollama chat, Monaco editing, git/file controls, prompt library, session history, Telegram, NockCC heartbeats, and first-run onboarding.
- Treat Codex transcript discovery, Codex resume/attach, and dispatch completion-thread tracking as strategic direction until the code has real adapters for those flows.
- The best product wedge is local-first agent observability and orchestration, not a generic AI IDE clone.
- Maintain a quiet, dense, cockpit-like UI for repeated developer work.

## Tech Stack

- Electron main process with a secure preload IPC bridge
- React 18 renderer built with Vite
- Tailwind CSS for the Nock desktop UI
- xterm.js plus `node-pty` for shell sessions
- Monaco Editor for file editing
- electron-store for persisted settings
- Node `fs.watch` (recursive; FSEvents-backed on macOS) for file watching
- Ollama and Claude Code subprocess integrations for AI chat flows
- electron-builder for macOS, Windows, and Linux packaging

## Key Directories

- `electron/` - Main-process services, IPC handlers, PTY management, file access, settings, session discovery, and NockCC integration.
- `src/` - React renderer app and UI components.
- `src/components/` - Dashboard, terminal view, sidebar, settings, editor, chat panel, file tree, tab bar, status bar, and shared controls.
- `src/utils/` - Renderer utilities such as terminal theme definitions.
- `assets/` - App icons and macOS entitlements.
- `public/` - Static assets served by Vite.
- `test/` - Node test-runner unit tests and Monaco smoke test assets.
- `.github/workflows/` - CI, release, and Codex security review workflows.
- `docs/` - Current product audit, GTM readiness, release readiness, roadmap, docs index, and historical specs.

## Development Setup

1. Install Node.js 18+ and npm 9+.
2. Install dependencies: `npm install`.
3. Start the desktop app: `npm start`.

`npm start` runs Vite and then launches Electron when `http://localhost:5173` is ready.

## Commands

- `npm start` - Run Vite and Electron together for local desktop development.
- `npm run dev` - Run only the Vite renderer server.
- `npm run preview` - Preview a built Vite renderer.
- `npm test` - Run Node test-runner tests.
- `npx vite build` - Build the renderer into `dist-react/`.
- `npm run check:bundle` - Check renderer bundle budgets.
- `npm run release:check` - Run tests, dependency audit, Vite build, and bundle budget.
- `python3 test/monaco.smoke.py` - Browser smoke test for Monaco; requires `npm run dev`.
- `npm run build` - Build the renderer and package the app with electron-builder.
- `npx electron-builder --mac --publish never` - Build macOS artifacts.
- `npx electron-builder --win --publish never` - Build Windows artifacts.

## What The App Does Today

- Discovers Claude Code sessions, local agent folders, dispatch-agent configs, and git projects, then presents agents separately from repos in dashboard cards and sidebar entries.
- Opens PTY-backed terminal tabs, applies global/project shell settings, supports splits, keeps terminals mounted across view switches, reconciles stale/orphaned PTYs, and launches `claude` from a new tab.
- Sends brokered Codex/DeepSeek dispatch requests to Mira via NockCC AgentMessage, or launches direct CRM dispatch scripts with generated payload files.
- Provides sidebar file browsing, git status markers, Monaco editing with unsaved-change protection, and project context checks for `CLAUDE.md`, `AGENTS.md`, Codex config, and `.nock/config.toml`.
- Shows first-run onboarding for dev roots, agent binaries, sessions, context files, and Ollama status.
- Provides AI chat against Ollama models, plus Claude-oriented Kit/Mara entries.
- Tracks session history and optional terminal output capture.
- Stores project profiles, prompt library entries, window/settings state, notification preferences, and NockCC connection settings.
- Sends optional Telegram notifications and links terminal app presence to NockCC.

## Current Audit Status

The May 15, 2026 audit/remediation pass found that the repo is dogfoodable and private-alpha ready, but not public GTM-ready.

- `npm run release:check` passes.
- `python3 test/monaco.smoke.py` passes when Vite is running.
- Dependency audit blockers are fixed.
- Remaining launch gaps: Codex/Gemini transcript discovery, resume/attach support, dispatch completion-thread tracking, packaged smoke automation, update distribution, crash/error reporting, and a sharper public demo.

Start with `docs/PRODUCT_AUDIT_GTM_READINESS.md`, `docs/ROADMAP.md`, `docs/AGENT_DISPATCH.md`, and `docs/RELEASE_READINESS.md` before major product work.

## Session Closeout

File a Session Report for every build/session before final response, even
docs-only work. Use `nockcc_session_report_create` or
`POST /api/sessions/reports/` with `session_id`, `agent_name`, `duration`,
task/PR/message/decision counts, `handoff_written`, standing-order pass/total
counts, concise notes, and 2-5 highlights. Include `nock-terminal` in the
session id or notes so NockCC can trace the report back to this repo.

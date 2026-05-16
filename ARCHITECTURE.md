# Architecture

Nock Terminal is an Electron desktop app with a React 18 renderer. The renderer owns the cockpit UI; the Electron main process owns privileged work: PTYs, filesystem access, settings, process discovery, network clients, notifications, and OS integrations.

This document describes the current codebase, not the aspirational Codex roadmap. Today, the implementation is Claude Code-oriented with Ollama support, plus first-class local agent-folder discovery for existing `agents/*/config.json` folders. The next architecture step is real Codex discovery and launch support behind the same adapter model.

## Process Model

- `src/main.jsx` mounts the React app.
- `src/App.jsx` owns top-level renderer state for the active view, terminal tabs, session list, port list, process status, chat panel, queued prompts, and active project path.
- `electron/main.js` creates the frameless window, tray, global shortcuts, service instances, and IPC handlers.
- `electron/preload.js` exposes `window.nockTerminal` through `contextBridge`.
- The renderer does not import Node APIs directly. It calls preload methods, which route to `ipcMain` handlers and main-process services.

## Main Surfaces

- **Dashboard**: `Dashboard`, `ProjectCard`, `OnboardingPanel`, and `Sidebar` show discovered agent folders, Claude Code sessions, git repositories, status counts, ports, project context, prompt library entries, first-run setup status, and session history.
- **Nock Command**: `TabBar`, `ActionToolbar`, `TerminalView`, `SplitPane`, `EditorPane`, and `AIChatPanel` form the terminal workbench for shells, Claude Code launch, split terminals, file editing, git actions, and AI chat.
- **Settings**: `Settings` edits electron-store-backed preferences for window behavior, AI/model settings, terminal/editor options, file-tree roots, notifications, Telegram, data import/export, and app info.

## Main-Process Services

- `TerminalManager` wraps `node-pty`, chooses a platform shell, applies global/project shell overrides, parses shell arguments and environment variables, relays terminal data, resizes PTYs, chunks large writes on Windows, and destroys processes.
- `SessionDiscovery` reads Claude Code transcripts from `~/.claude/projects`, scans configured dev roots for git repos and `agents/*/config.json` folders, merges them by path, and annotates branch, dirty state, activity metadata, agent runtime state, and launch defaults.
- `PortScanner` finds local development servers for the sidebar.
- `FileService` reads/writes files, builds trees, reads git status, and runs `pull`, `push`, and `fetch` only inside allowed roots.
- `FileWatcher` emits file and git status changes for the active project tree.
- `ProcessDetector` observes terminal processes and reports active agent identities under each PTY through the adapter registry.
- `OllamaClient` streams local model chat through `/api/chat` and lists models through `/api/tags`.
- `ClaudeCodeClient` can spawn `claude -p --output-format stream-json` for Claude Code chat-style calls.
- `TelegramNotifier` sends configured notification events.
- `ProjectProfiles`, `SessionHistory`, and `PromptStore` persist project settings, terminal output metadata, and prompt library entries.
- `NockCCClient` links this desktop app instance to the NockCC server.

## Data Flow

### Session Discovery

1. `App` calls `window.nockTerminal.sessions.discover()` on mount and every 30 seconds.
2. `SessionDiscovery` reads Claude transcripts, scans configured dev roots, reads agent `config.json` files, checks local NockCC file-bus state, and returns normalized sessions/projects/agents.
3. `main.js` grants discovered project paths to `FileService` and revalidates `FileWatcher`.
4. Dashboard and sidebar render sessions, project status, file trees, context checks, and cards from the returned data.

### Terminal Tabs

1. The renderer creates a tab and mounts `TerminalView`.
2. `TerminalView` creates an xterm instance and calls `terminal:create` over IPC.
3. `TerminalManager` spawns a PTY in the tab cwd and streams output back with `terminal:data`.
4. xterm sends user input through `terminal:write`; resize events use `terminal:resize`.
5. Session history records output only when `autoCaptureSessions` is enabled.

### Files And Git

1. The sidebar chooses an active project path from the active tab cwd or the first discovered session.
2. `FileTree`, `EditorPane`, and `ActionToolbar` call preload file APIs.
3. `FileService` rejects paths outside configured dev roots or discovered granted roots.
4. Writes are atomic via a temporary `.nock-tmp` file and rename.
5. Git toolbar operations are restricted to `pull`, `push`, and `fetch`.

### AI Chat

1. `AIChatPanel` polls Ollama status and model list.
2. Local model chat streams through `OllamaClient` and `ai:stream`.
3. The Kit option opens a new terminal tab that launches `claude`.
4. The Mara option opens `https://claude.ai`.

## NockCC Connection

`electron/main.js` creates `NockCCClient` during service initialization. The client reads `nockccApiKey` and `nockccUrl` from electron-store; without an API key it silently does nothing.

When configured:

- On app ready, `startSession()` sends `POST /api/terminal/sessions/` with `machine` and `app_version`.
- The returned session id is stored in memory.
- Every 60 seconds, `heartbeat()` sends `PATCH /api/terminal/sessions/{id}/`.
- The renderer reports active project count plus Claude and generic agent session ids through `nockcc:updateActivity`; `NockCCClient` forwards those values in the heartbeat.
- On app quit, `endSession()` sends `POST /api/terminal/sessions/{id}/end/`.
- Calls are fire-and-forget with short timeouts so NockCC outages do not crash or block the desktop app.
- Requests authenticate with `X-Api-Key`.

## Security Boundaries

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The renderer reaches privileged APIs only through the preload bridge.
- External URL opening is limited to `http` and `https`.
- File APIs are path-gated by sanitized dev roots and discovered project grants.
- Settings are normalized before being stored or applied.
- Claude Code spawning avoids shell execution and validates custom binary paths.
- CI includes Node tests for security utilities, settings normalization, and file-service write behavior.

## Known Architectural Gaps

- Claude Code transcript discovery is still hard-coded around `~/.claude/projects`; Codex needs first-class transcript/session discovery and launch adapters.
- Agent folder state is read-only and local-file-bus based. True reconnect/attach still needs a runtime adapter that can choose tmux attach, transcript resume, or another agent-specific reconnect path.
- Monaco is lazy-loaded and now budgeted in CI, but targeted worker/language loading is still worth tightening if startup or update size becomes a problem.
- The app has CI for tests, dependency audit, renderer builds, and bundle budgets, but no automated packaged Electron smoke test, crash reporting, or update channel validation.

See [docs/PRODUCT_AUDIT_GTM_READINESS.md](docs/PRODUCT_AUDIT_GTM_READINESS.md) for severity and launch impact.

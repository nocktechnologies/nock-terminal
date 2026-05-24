# Architecture

Nock Terminal is an Electron desktop app with a React 18 renderer. The renderer owns the cockpit UI; the Electron main process owns privileged work: PTYs, filesystem access, settings, process discovery, network clients, notifications, and OS integrations.

This document describes the current codebase, not aspirational product copy. Today, the implementation is strongest around Claude Code transcript discovery and Ollama chat, plus first-class local agent-folder discovery for existing `agents/*/config.json` folders. The renderer now has profile-driven launch support for Claude Code, Codex CLI, Gemini CLI, and custom terminal agents, plus brokered/direct dispatch support for Codex and DeepSeek agents managed by Mira. The next architecture step is real non-Claude transcript discovery and resume/attach support behind the same adapter model.

## Process Model

- `src/main.jsx` mounts the React app.
- `src/App.jsx` owns top-level renderer state for the active view, terminal tabs, session list, profile cache, port list, process status, command launcher, dispatch-run telemetry, chat panel, queued prompts, and active project path.
- `electron/main.js` creates the frameless window, tray, global shortcuts, service instances, and composes focused IPC registration modules.
- `electron/preload.js` exposes `window.nockTerminal` through `contextBridge`.
- The renderer does not import Node APIs directly. It calls preload methods, which route to `ipcMain` handlers and main-process services.

## Main Surfaces

- **Dashboard**: `Dashboard`, `ProjectCard`, `OnboardingPanel`, and `Sidebar` show discovered agent folders, Claude Code sessions, git repositories, operations telemetry, status counts, ports, project context, prompt library entries, first-run setup status, and session history.
- **Command launcher**: `CommandPalette` and `src/utils/agentLaunchers.mjs` provide repo/agent search, default-agent launch resolution, task staging for terminal-first agent work, and brokered/direct dispatch routing for dispatch-and-die agents.
- **Nock Command**: `TabBar`, `ActionToolbar`, `TerminalView`, `SplitPane`, `EditorPane`, and `AIChatPanel` form the terminal workbench for shells, Claude Code launch, split terminals, file editing, git actions, and AI chat.
- **Settings**: `Settings` edits electron-store-backed preferences for window behavior, AI/model settings, terminal/editor options, file-tree roots, notifications, Telegram, data import/export, and app info.

## Main-Process Services

- `TerminalManager` wraps `node-pty`, chooses a platform shell, applies global/project shell overrides, parses shell arguments and environment variables, relays terminal data, resizes PTYs, chunks large writes on Windows, and destroys processes.
- `SessionDiscovery` reads Claude Code transcripts from `~/.claude/projects`, scans configured dev roots for git repos and `agents/*/config.json` folders, merges them by path, and annotates branch, dirty state, activity metadata, agent runtime state, terminal launch defaults, and dispatch descriptors.
- `AgentDispatchService` builds sanitized dispatch payloads, writes direct-dispatch payload files, and sends brokered NockCC AgentMessages to Mira.
- `PortScanner` finds local development servers for the sidebar.
- `FileService` reads/writes files, builds trees, reads git status, and runs `pull`, `push`, and `fetch` only inside allowed roots.
- `FileWatcher` emits file and git status changes for the active project tree.
- `ProcessDetector` observes terminal processes and reports active agent identities under each PTY through the adapter registry.
- `agent-adapters.js` defines known terminal agents for main-process detection and context checks. The current registry covers Claude Code, Codex CLI, and Gemini CLI.
- `OllamaClient` streams local model chat through `/api/chat` and lists models through `/api/tags`; `electron/ollama-ipc.js` owns the renderer IPC bridge and stream forwarding.
- `ClaudeCodeClient` can spawn `claude -p --output-format stream-json` for Claude Code chat-style calls.
- `TelegramNotifier` sends configured notification events; `electron/telegram-ipc.js` owns the renderer IPC bridge.
- `ProjectProfiles`, `SessionHistory`, and `PromptStore` persist project settings, terminal output metadata, and prompt library entries.
- `NockCCClient` links this desktop app instance to the NockCC server.

## Data Flow

### Session Discovery

1. `App` calls `window.nockTerminal.sessions.discover()` on mount and every 30 seconds.
2. `SessionDiscovery` reads Claude transcripts, scans configured dev roots, reads agent `config.json` files, checks local NockCC file-bus state, resolves dispatch runtimes/allowlists, dedupes copied worktree configs, and returns normalized sessions/projects/agents.
3. `electron/session-ipc.js` grants discovered project paths to `FileService` and revalidates `FileWatcher`.
4. Dashboard and sidebar render sessions, project status, file trees, context checks, and cards from the returned data.

### Terminal Tabs

1. The renderer creates a tab and mounts `TerminalView`.
2. `TerminalView` creates an xterm instance and calls `terminal:create` over IPC.
3. `TerminalManager` spawns a PTY in the tab cwd and streams output back with `terminal:data`.
4. xterm sends user input through `terminal:write`; resize events use `terminal:resize`.
5. When a tab has a launch command, `TerminalView` sends it after the shell initializes.
6. When a tab has staged task text, `TerminalView` places the sanitized text into the terminal after launch without sending an Enter key.
7. Session history records output only when `autoCaptureSessions` is enabled.

### Files And Git

1. The sidebar chooses an active project path from the active tab cwd or the first discovered session.
2. `FileTree`, `EditorPane`, and `ActionToolbar` call preload file APIs.
3. `FileService` rejects paths outside configured dev roots or discovered granted roots.
4. Writes are atomic via a temporary `.nock-tmp` file and rename.
5. Git toolbar operations are restricted to `pull`, `push`, and `fetch`.

### AI Chat

1. `AIChatPanel` polls Ollama status and model list through `electron/ollama-ipc.js`.
2. Local model chat streams through `OllamaClient`, and `ollama-ipc` forwards chunks through `ai:stream`.
3. The Kit option opens a new terminal tab that launches the configured Claude command.
4. The Mara option opens `https://claude.ai`.

### Agent Launching

1. `CommandPalette` searches discovered sessions with `buildLauncherTargets()`.
2. For repos, `resolveSessionLaunch()` chooses the project profile's default agent and command override. Supported built-ins are Claude Code, Codex CLI, Gemini CLI, and custom agent command.
3. For local agent folders, `resolveSessionLaunch()` uses the discovered `config.json` launch command and cwd.
4. `App` creates a terminal tab with the resolved cwd, launch command, and optional staged task text.
5. The task text is sanitized to remove terminal control characters and shell-submitting newlines before it is written to the PTY.

### Dispatch Agents

1. `SessionDiscovery` treats configs with `agent_runtime: codex` or `agent_runtime: deepseek` as dispatch-and-die agents.
2. Disabled dispatch agents are not treated as broken. They receive a `dispatch` lifecycle because CRM keeps them off launchd intentionally.
3. Discovery walks upward to find `core/scripts/dispatch-codex.sh` or `core/scripts/dispatch-deepseek.sh`, parses `ALLOWED_AGENTS=(...)`, and marks each agent ready or blocked.
4. `CommandPalette` requires task text before dispatch. The default route sends a NockCC AgentMessage to `mira-nockos`; the direct route creates a temp payload file and opens a terminal that runs the dispatcher script.
5. `App` keeps lightweight recent dispatch-run telemetry in renderer local storage so the dashboard can show whether a request was sent, launched, or failed.

## NockCC Connection

`electron/main.js` creates `NockCCClient` during service initialization, then delegates renderer activity updates and heartbeat lifecycle wiring to `electron/nockcc-activity-ipc.js`. The client reads `nockccApiKey` and `nockccUrl` from electron-store; without an API key it silently does nothing.

When configured:

- On app ready, `startSession()` sends `POST /api/terminal/sessions/` with `machine` and `app_version`.
- The returned session id is stored in memory.
- Every 60 seconds, `heartbeat()` sends `PATCH /api/terminal/sessions/{id}/`.
- The renderer reports active project count plus Claude and generic agent session ids through `nockcc:updateActivity`; `nockcc-activity-ipc` sanitizes the renderer payload and `NockCCClient` forwards those values in the heartbeat.
- On app quit, `endSession()` sends `POST /api/terminal/sessions/{id}/end/`.
- Brokered dispatch uses the same configured NockCC URL/API key, with a fallback to `~/.nockcc/config.json`, and sends `POST /api/teams/messages/` to `mira-nockos`.
- Calls are fire-and-forget with short timeouts so NockCC outages do not crash or block the desktop app.
- Requests authenticate with `X-Api-Key`.

## Security Boundaries

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The renderer reaches privileged APIs only through the preload bridge.
- External URL opening is limited to `http` and `https`.
- File APIs are path-gated by sanitized dev roots and discovered project grants.
- Settings are normalized before being stored or applied.
- Dispatch IPC validates runtime and agent names, strips unsafe control characters from payload text, writes payload files under the OS temp directory with best-effort cleanup, and shell-quotes direct script commands.
- Claude Code spawning avoids shell execution and validates custom binary paths.
- CI includes Node tests for security utilities, settings normalization, and file-service write behavior.

## Known Architectural Gaps

- Claude Code transcript discovery is still hard-coded around `~/.claude/projects`; Codex and Gemini need first-class transcript/session discovery and resume/attach adapters.
- Dispatch completion is request-level only. The app records that a brokered request was sent or a direct dispatcher launched; it does not yet subscribe to the resulting NockCC reply thread.
- Agent folder state is read-only and local-file-bus based. True reconnect/attach still needs a runtime adapter that can choose tmux attach, transcript resume, or another agent-specific reconnect path.
- Monaco is lazy-loaded and now budgeted in CI, but targeted worker/language loading is still worth tightening if startup or update size becomes a problem.
- The app has CI for tests, dependency audit, renderer builds, and bundle budgets, but no automated packaged Electron smoke test, crash reporting, or update channel validation.

See [docs/PRODUCT_AUDIT_GTM_READINESS.md](docs/PRODUCT_AUDIT_GTM_READINESS.md) for severity and launch impact.

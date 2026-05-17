# Changelog

This changelog is summarized from git history. The repository has no version tags; `package.json` currently reports version `1.0.0`.

## Unreleased

### 2026-05-16

- Added the `Ctrl+K` command launcher for searching repos, agent folders, branches, lifecycle state, models, and launch commands.
- Added profile-driven default agent selection and command overrides for Claude Code, Codex CLI, Gemini CLI, and custom terminal agents.
- Added Gemini CLI process detection and `GEMINI.md` context checks.
- Added dashboard operations telemetry for active agent folders, live agent processes, terminals, quiet tabs, stale agents, and dirty repos.
- Added task staging so a launched agent terminal receives sanitized task text without auto-submitting it.
- Added Codex/DeepSeek dispatch-agent discovery from `agent_runtime` configs, including intentional `enabled:false` handling and dispatcher allowlist parsing.
- Added Mira-brokered NockCC dispatch requests plus a direct dispatcher-script route with sanitized payload-file creation.
- Added dashboard dispatch telemetry and deduping for copied dispatch/worktree agent configs.
- Added `docs/AGENT_DISPATCH.md` and refreshed release/docs/audit coverage for dispatch-agent behavior.
- Added launcher and fleet summary unit tests plus a mocked browser smoke pass for launch/task staging.
- Updated README, architecture, roadmap, release readiness, audit, and agent-folder docs for the agent-agnostic cockpit slice.
- Fixed the Anvil Codex security-review workflow invocation and added OpenAI/Codex auth preflights so missing, malformed, or unauthorized review credentials skip cleanly instead of posting CLI/auth traces.
- Replaced blocking dispatch failure alerts with a non-blocking in-app error notice and hardened NockCC response stream decoding.

### 2026-05-15

- Added agent-folder intelligence: configured dev roots now discover existing `agents/*/config.json` folders, read local NockCC file-bus state, show agents separately from repos, and use conservative launch defaults.
- Added a full product, technical, and GTM readiness audit in `docs/PRODUCT_AUDIT_GTM_READINESS.md`.
- Added a product roadmap and positioning plan in `docs/ROADMAP.md`.
- Added a docs index in `docs/README.md`.
- Refreshed `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, and `CLAUDE.md` to distinguish the current Claude/Ollama implementation from the strategic Codex-ready direction.
- Marked the historical Phase 2 superpowers plan/spec as implemented historical context and linked them to the current audit.
- Fixed dependency audit blockers with patched transitive packages and updated dependency overrides.
- Wired global and project shell settings into PTY creation, including shell arguments and environment variables.
- Added unsaved Monaco editor close protection.
- Added an initial Claude/Codex agent adapter registry for process detection and project context checks.
- Populated NockCC heartbeat activity from active renderer state.
- Added first-run onboarding checks for dev roots, installed agents, context files, sessions, and Ollama.
- Improved accessible labels and hit targets across sidebar, file tree, editor, prompt library, project settings, and context monitor controls.
- Added bundle-budget checks, CI audit/budget gates, release workflow preflight, Linux artifacts, signing/notarization secret checks, artifact checksums, and `docs/RELEASE_READINESS.md`.

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

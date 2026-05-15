# Nock Terminal

Nock Terminal is a cross-platform Electron cockpit for local agentic coding work. The current build is strongest as a Claude Code and Ollama companion: it discovers local Claude Code activity, opens PTY-backed terminal tabs, shows project/file context, embeds Monaco editing, tracks prompts/history, and exposes git, port, and notification controls from one desktop shell.

The product direction is broader than a Claude-only launcher: Nock should become a local-first command center for supervising coding agents across terminals, worktrees, projects, and eventually Codex-compatible flows.

Built by [Nock Technologies](https://nocktechnologies.io).

## Current Status

As of the May 15, 2026 audit/remediation pass, this repo is ready for renewed dogfooding and a controlled private alpha, but not yet ready for a public GTM launch.

- Passing: `npm test`, `npm audit --audit-level=moderate`, `npx vite build`, `npm run check:bundle`, and the Monaco browser smoke test.
- Fixed in the remediation pass: dependency audit blockers, shell/profile settings application, unsaved editor protection, agent context/process adapters, NockCC heartbeat activity, first-run onboarding, hit-target/accessibility polish, and release gate scripts.
- Strategic gap: Claude Code remains the only transcript-discovery source. Codex support now has context/process foundations, but full Codex session discovery and launch behavior are still roadmap work.
- Launch gap: release workflows now enforce signing/notarization secrets and checksums, but packaged-app smoke tests, update distribution, crash/error reporting, and support flow still need a release pass.

Read the full audit in [docs/PRODUCT_AUDIT_GTM_READINESS.md](docs/PRODUCT_AUDIT_GTM_READINESS.md).

## What It Does Today

- Discovers Claude Code session transcripts from `~/.claude/projects`.
- Scans configured development roots for git repositories.
- Opens xterm.js terminal tabs through `node-pty`, including splits.
- Keeps terminal sessions mounted while switching between dashboard, terminal, and settings views.
- Provides a sidebar file tree, git status markers, context checks, and Monaco editing.
- Provides local AI chat through Ollama models.
- Launches a Claude Code terminal tab from the AI panel.
- Stores project profiles, prompt library entries, session history, output capture settings, and app preferences.
- Sends optional Telegram notifications and heartbeat events to NockCC.

## Product Direction

The strongest GTM wedge is not "another AI IDE." The market has converged around agent-first workspaces, background agents, and multi-agent orchestration. Nock can be useful if it owns a sharper niche:

- Local-first observability for agent sessions that already run in terminals.
- Agent-agnostic adapters for Claude Code, Codex CLI, local Ollama workflows, and future agent CLIs.
- Worktree-aware parallel execution and review.
- Session replay, handoff notes, terminal output capture, and after-action summaries.
- Team-ready notifications and presence through NockCC.

See [docs/ROADMAP.md](docs/ROADMAP.md) for concrete product ideas and sequencing.

## Requirements

- Node.js 18+
- npm 9+
- macOS, Windows, or Linux

## Quick Start

```bash
npm install
npm start
```

`npm start` runs the Vite renderer and launches Electron when `http://localhost:5173` is ready.

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Run Vite and Electron together for local desktop development. |
| `npm run dev` | Run only the Vite renderer server. |
| `npm run preview` | Preview the built Vite renderer. |
| `npm test` | Run Node test-runner tests. |
| `npx vite build` | Build the renderer into `dist-react/`. |
| `npm run check:bundle` | Check the Vite output against explicit bundle budgets. |
| `npm run release:check` | Run the local release gate: tests, dependency audit, build, and bundle budget. |
| `npm run build` | Build the renderer and package the app with electron-builder. |
| `npx electron-builder --mac --publish never` | Build macOS artifacts. |
| `npx electron-builder --win --publish never` | Build Windows artifacts. |
| `python3 test/monaco.smoke.py` | Browser smoke test for Monaco loading; requires `npm run dev` first. |

## Repository Structure

```
electron/       Main process services, IPC handlers, PTY, files, settings, sessions
src/            React renderer app and desktop UI
src/components/ Dashboard, terminal workbench, editor, settings, chat, sidebar
src/utils/      Renderer utilities such as terminal themes
assets/         App icons and macOS entitlements
public/         Static assets served by Vite
test/           Node tests and Monaco smoke-test assets
docs/           Product audit, launch readiness, roadmap, historical specs
.github/        CI, release, and security review workflows
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) explains the current Electron/React system.
- [docs/PRODUCT_AUDIT_GTM_READINESS.md](docs/PRODUCT_AUDIT_GTM_READINESS.md) is the current audit and launch-readiness report.
- [docs/ROADMAP.md](docs/ROADMAP.md) lists product directions and prioritization.
- [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md) documents the release gate and packaged smoke checklist.
- [CHANGELOG.md](CHANGELOG.md) summarizes repo history.
- [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) provide agent instructions for future work in this repo.

## License

MIT.

# Product Audit And GTM Readiness

Audit date: 2026-05-15
Latest product update: 2026-07-07

Scope: repository documentation, Electron/React implementation, local verification commands, browser smoke checks with the mocked preload bridge, and a current market read of agentic development tools.

## Executive Decision

Nock Terminal is not ready for public GTM or paid launch.

After the May 15 remediation pass, it is ready for renewed internal dogfood and a controlled private alpha. The previous launch blockers around dependency audit, terminal settings, unsaved editor protection, NockCC placeholder activity, first-run onboarding, and release gates have been fixed or materially reduced.

The remaining public-GTM blockers are product depth and distribution proof: broader reconnect/attach for live agents beyond the proven CRM tmux path (including Codex/Gemini live attach), Gemini full transcript/replay semantics, worktree lanes, full session replay, signed installer smoke coverage on every target OS, a public support/feedback route, crash/error reporting privacy posture, and a crisp public demo path.

The product has useful bones: a real PTY-backed terminal, Claude transcript discovery, agent-folder discovery, project cards, file tree, Monaco editing, local model chat, prompt/session history, git controls, port awareness, and notifications. The main problem is not lack of product surface. The problem is that the surface is not yet formed into a sharp promise people can immediately understand and trust.

## May 16 Product Progress

The approved agent-agnostic cockpit phases now have a working private-alpha slice:

- `Ctrl+K` command launcher for searching repos, agents, branches, lifecycle state, models, and launch commands.
- Profile-driven default agent selection for Claude Code, Codex CLI, Gemini CLI, and custom agent aliases/wrappers.
- Project command overrides for Claude, Codex, Gemini, and custom agents.
- Dashboard operations strip for active agent folders, live agent processes, open terminals, quiet agent tabs, dirty repos, and stale agent folders.
- Task staging that launches an agent terminal and places the task text into the terminal without submitting it.
- Gemini process/context support using `GEMINI.md`; official reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
- Codex and DeepSeek dispatch-agent discovery from `agent_runtime` configs, including intentional `enabled:false` handling.
- Brokered dispatch requests through Mira via NockCC AgentMessage and an operator direct-dispatch route through CRM scripts.
- Dispatch-run telemetry in the dashboard and deduping for copied dispatch/worktree agent configs.

Readiness impact: this improves private-alpha usefulness and product clarity, especially for agent-agnostic orchestration. It does not remove the public-GTM blockers around real transcript discovery beyond Claude, attach/reconnect semantics beyond the proven CRM tmux path, full completion-thread/transcript rendering, worktree lanes, session replay, signed installer smoke coverage, update distribution, crash/error reporting, and public support/demo material.

## May 25 Phase H Progress

Phase H closed several truth gaps after the May 16 product slice:

- Brokered dispatch runs can now poll NockCC live `status_update` AgentMessages by `context.request_id` and move beyond local `sent` telemetry.
- Adapter/session contracts now separate transcript discovery, live attach, resume command, folder launch, and dispatch request semantics.
- CRM persistent agent folders have the first proven attach/resume metadata and execution path through deterministic `tmux attach -t crm-<instance>-<agent>` targets.
- `docs/RELEASE_READINESS.md` now records the release decision log and signed artifact evidence ledger for Nock #123.

Readiness impact: this reduces the product-truth risk around dispatch and CRM attach, but it does not make Gemini full transcript replay, Codex/Gemini resume and attach support, generic live reconnect, worktree lanes, session replay, signed artifact smoke, auto-update, crash reporting, or public support ready.

## June 12 Wave 3 Progress

Wave 3 closed the first Codex transcript-discovery adapter:

- Codex rollout transcripts are discovered from `~/.codex/sessions/**/rollout-*.jsonl`.
- Discovery reads only bounded file heads: default 45-day recency window, newest 500 rollout files, and the first 16 KiB per candidate.
- Project cwd is recovered from `session_meta.payload.cwd`, with `turn_context.payload.cwd` as a fallback.
- Malformed or empty rollout files are skipped with opt-in discovery debug logging.
- Codex `AGENT_SESSION_CONTRACTS.transcriptDiscovery` now honestly reports `supported` with source `codex-rollout-jsonl`; Codex live attach remains future work (one-keystroke `codex resume <id>` later shipped in the June 13 Wave 6 resume pass below).

Readiness impact: this removes the "Claude-only transcript discovery" truth gap for recent Codex CLI sessions. It does not make Codex fully first-class yet because live attach semantics, full transcript replay, worktree lanes, signed installer smoke, auto-update, crash reporting, public support, and demo material still need proof (resume shipped in the June 13 Wave 6 resume pass below).

## June 12 Wave 4 Progress

Wave 4 closed request-level dispatch thread rendering:

- Brokered dispatch rows in the dashboard can expand into an on-demand NockCC AgentMessage thread keyed by `context.request_id`.
- The main process fetches the same live inbox family used for dispatch status updates, keeps the response bounded, filters foreign request ids, and caps body text before IPC.
- The renderer presents the thread as request evidence with quiet loading, empty, and offline states. It deliberately does not claim launched-agent terminal transcript replay.

Readiness impact: this improves operational observability for dispatched work and removes the "no visible request thread" gap. It still does not make full session replay, Codex live attach, Gemini full transcript replay, signed installer smoke, auto-update, crash reporting, public support, or demo material ready (Codex resume later shipped in the June 13 Wave 6 resume pass below).

## June 12 Wave 5 Progress

Wave 5 added conditional Gemini session-presence discovery:

- Gemini projects are discovered from the allowlisted `~/.gemini/projects.json` path plus `~/.gemini/tmp/<slug>/.project_root` and `~/.gemini/tmp/<slug>/logs.json`.
- Discovery emits a project row only when `logs.json` contains prompt records with session evidence; empty, missing, malformed, or oversized logs are skipped with opt-in discovery debug logging.
- The Gemini adapter contract now reports `transcriptDiscovery.state: conditional` with evidence `gemini-prompt-logs`.
- This is deliberately not transcript replay: Gemini CLI prompt logs expose user prompt events, session ids, project paths, and last activity, but not assistant/tool output.

Readiness impact: this removes the "Gemini has no local session signal" gap while preserving the public promise boundary. Gemini full transcript replay, live attach, signed installer smoke, auto-update, crash reporting, public support, and demo material remain future work (latest-session resume later shipped in the June 13 Wave 6 resume pass below).

## June 12-13 Wave 5-6 Resume Progress

Waves 5 (Lane A) and 6 closed one-keystroke session resume across the fleet, honest to each CLI's actual resume model:

- Claude: transcript-derived project rows whose newest transcript filename is a safe session id expose a "Resume Claude Session" action running `claude --resume <id>` in the project cwd. The claude contract `resumeCommand` moved from `future` to `conditional` with evidence `claude-jsonl-session-id`.
- Codex: rollout rows with a safe session id resume via `codex resume <id>` at the same per-session fidelity as Claude. Contract `resumeCommand` moved to `conditional` with evidence `codex-rollout-session-id`.
- Gemini: `gemini --resume` accepts `latest` or an ephemeral per-project index, not the recovered session id, so Nock honestly offers `gemini --resume latest` — the most recent session in the project, which is the session the row already represents. Nock does not claim arbitrary-session Gemini resume. Contract `resumeCommand` moved to `conditional` with evidence `gemini-latest-session`.
- Resume never fires from a plain row click; ids that fail the safe charset check produce no launch at all.

Readiness impact: this closes the "discovery without recovery" gap — discovered Claude/Codex/Gemini sessions are now resumable, not just visible. Live attach, Gemini full transcript replay, signed installer smoke, auto-update, crash reporting, public support, and demo material remain future work.

## July 7 Packaged Smoke Progress

CI now runs the unpacked packaged-app smoke on macOS in addition to Linux (`packaged-smoke-macos` in `.github/workflows/ci.yml`). The macOS job builds with `electron-builder --dir` and launches the packaged binary on the runner's real windowserver; it would have caught two shipped darwin packaging regressions — a broken node-pty `pty.node` rebuild (main-process SIGABRT at launch) and a missing transitive `conf` dependency.

Readiness impact: packaged renderer/load regressions are now caught pre-merge on both Linux and macOS. Signed installer smoke on clean target OS machines remains the release gate for public beta.

## Verification Summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | Pass | 44 Node test-runner tests passed after the May 16 launcher/profile/dispatch additions and PR review hardening. |
| `npm audit --audit-level=moderate` | Pass | 0 vulnerabilities found after dependency remediation. |
| `npx vite build` | Pass with warnings | Renderer build succeeded; known Monaco/editor chunks exceed Vite's generic 500 kB warning threshold. |
| `npm run check:bundle` | Pass | Explicit budgets cover app entry, Monaco workers/API, and xterm chunks. |
| `python3 test/monaco.smoke.py` | Pass | Monaco loaded, TypeScript language mode worked, no worker/console errors. |
| Lightweight browser DOM audit | Pass with residual risk | Mocked dashboard and command-launcher smoke passed, including `Ctrl+K`, profile-selected Codex launch, and staged task text. |

## Technical Quality Score

| # | Dimension | Score | Key Finding |
| --- | --- | --- | --- |
| 1 | Accessibility | 3/4 | Keyboard/focus exists and key icon controls now have accessible names and larger hit targets; full screen-reader regression coverage is still missing. |
| 2 | Performance | 3/4 | Lazy Monaco remains, and CI now has explicit bundle budgets; worker/language targeting can still improve startup/update size. |
| 3 | Theming | 3/4 | Tailwind tokens exist, but hard-coded colors and dark-only assumptions remain. |
| 4 | Responsive / Window Fit | 2/4 | Works as a desktop app with `minWidth: 900`, but dense panes and small controls are not touch-friendly. |
| 5 | Anti-patterns | 2/4 | The dark/cyan/purple agent cockpit aesthetic fits the domain but still risks looking generic in the current AI tools market. |
| **Total** |  | **14/20** | **Acceptable for dogfood/private alpha, not public launch.** |

## GTM Readiness Score

| Dimension | Score | Readiness |
| --- | --- | --- |
| Product clarity | 3/5 | Docs now lead with local agent observability; Claude/Codex transcript discovery and Claude/Codex/Gemini one-keystroke resume are supported, while attach claims remain deliberately narrow. |
| Differentiation | 2/5 | "Agent cockpit" is promising, but OpenAI, Cursor, Warp, Claude, Windsurf, GitHub, and JetBrains now all tell multi-agent stories. |
| Onboarding | 3/5 | First-run checklist now covers dev roots, agent binaries, context files, sessions, and Ollama status. |
| Reliability | 3/5 | Unit/build/smoke/release checks pass; Linux and macOS unpacked packaged smoke is automated; no signed artifact or auto-update validation. |
| Security | 3/5 | Good Electron boundaries and zero moderate+ audit findings; public launch still needs signed installer smoke on each target OS and support process. |
| Packaging/distribution | 3/5 | Release workflow enforces signing/notarization secrets, Linux artifacts, checksums, and Linux/macOS unpacked packaged smoke; signed installer smoke coverage is still manual. |
| Feedback/analytics | 3/5 | NockCC heartbeat now receives active project and agent session data from renderer state. |
| Docs/sales readiness | 3/5 | Repo docs now explain state, roadmap, and release gates; public site, beta guide, support path, and release-note flow remain. |
| **Overall** | **24/40** | **Controlled private alpha only.** |

## Market Context

The market has moved fast since the original Phase 2 docs. A terminal wrapper or single-agent launcher is no longer enough.

- OpenAI positions the Codex app as a command center for running multiple agents in parallel, with work organized by projects and threads, plus sandboxing and approvals. It became available on macOS in February 2026 and Windows in March 2026. Source: https://openai.com/index/introducing-the-codex-app/
- OpenAI also described the Codex App Server as a JSON-RPC platform surface created because partners and OpenAI products needed a safe way to embed the same Codex harness. Source: https://openai.com/index/unlocking-the-codex-harness/
- Claude Code is now described as available in terminal, IDE, desktop app, and browser, with multiple agents, background agents, scripting, and automation. Source: https://code.claude.com/docs/en/overview
- Cursor 2.0 moved toward an agent-centered interface, parallel agents, git worktrees/remote machines, and built-in browser testing. Source: https://cursor.com/blog/2-0
- Warp now frames itself as an agentic development environment with cloud agent orchestration and claims nearly one million developers. Source: https://www.warp.dev/newsroom/2026/4/28/warp-open-sources-its-agentic-development-environment
- GitHub Copilot cloud agent creates branches and can open pull requests from GitHub Actions-powered environments. Source: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- JetBrains Junie emphasizes BYOK, top model support, custom guidelines, skills, MCP, and human-in-the-loop control. Source: https://junie.jetbrains.com/
- Windsurf is explicitly selling flow-state coding and an Agent Command Center story. Source: https://windsurf.com/

Implication: Nock should not compete head-on as "the AI coding app." It should own a narrower, practical wedge: local-first supervision of terminal agents, with session history, context health, process telemetry, notifications, worktree isolation, and handoff/replay.

## Severity Findings

### P1 - Dependency Audit Blocks Launch

Location: `package.json`, `package-lock.json`

Status: Fixed in the May 15 remediation pass.

`npm audit --audit-level=moderate` now reports 0 vulnerabilities. The patch updates the lockfile and tightens dependency overrides for vulnerable transitive packages.

Residual risk: keep dependency audit in CI and release preflight so future advisories block release tags.

### P1 - Product Positioning And Implementation Diverge

Locations:

- `electron/session-discovery.js:11`
- `src/App.jsx:133`
- `src/App.jsx:391`
- `src/components/ContextMonitor.jsx:62`
- `src/components/Dashboard.jsx:106`

Docs and product instructions refer to Codex, but the implementation discovers `~/.claude/projects`, launches `claude`, detects `hasClaude`, checks `CLAUDE.md`, and labels the dashboard as Claude Code sessions.

Impact: Users will bounce if the public promise says Codex but the app behaves like a Claude-specific shell.

Status: Improved, still not public-GTM complete.

The docs now lead with "local cockpit for terminal coding agents" rather than a Codex-only promise. The code has an adapter registry for Claude/Codex/Gemini process detection and project context checks, first-class local agent-folder discovery from existing `config.json` files, profile-driven launches for Claude/Codex/Gemini/custom agents, Claude transcript discovery, recent Codex rollout transcript discovery, conditional Gemini prompt-log session-presence discovery, Codex/DeepSeek dispatch discovery, brokered dispatch through Mira, request-level dispatch AgentMessage thread rendering, and a command launcher that can stage tasks into fresh agent terminals or dispatch requests. True reconnect/attach for live agents remains future work outside the proven CRM tmux path.

Recommendation: keep the private alpha agent-agnostic in launch/profile posture, while staying explicit that Codex transcript discovery covers recent rollout JSONL files only. Rollout transcript discovery and `codex resume <id>` are now backed by code; do not market Codex as fully first-class until live attach, full transcript history/replay, and settings are as well.

### P1 - Settings Promise More Than The Terminal Applies

Locations:

- `src/components/Settings.jsx:409`
- `src/components/Settings.jsx:432`
- `electron/terminal-manager.js:26`
- `src/components/TerminalView.jsx`

Status: Fixed.

The renderer now loads global settings and project profiles before PTY creation. `TerminalManager` accepts shell overrides, parses shell arguments, and injects validated environment variables. Tests cover shell args and env var filtering.

Residual risk: packaged-app smoke should verify shell behavior on macOS, Windows, and Linux.

### P1 - Unsaved Editor Changes Can Be Lost

Location: `src/components/EditorPane.jsx:214`

Status: Fixed.

Editor modified state now propagates to tab/split close flows. Closing a modified editor asks for confirmation before discarding unsaved files. Unit tests cover unsaved-file normalization and confirmation copy.

Residual risk: add automated renderer interaction coverage for the confirmation flows when the app has broader browser/Electron testing.

### P1 - NockCC Heartbeat Is Placeholder Telemetry

Location: `electron/main.js:571`

Status: Fixed.

The renderer now reports active project count, Claude session ids, and generic active agent session ids through `nockcc:updateActivity`. `NockCCClient` sends those values in heartbeat payloads and tests cover the serialized fields.

Residual risk: validate the receiving NockCC API contract in staging before selling team presence.

### P1 - Release Pipeline Is Not Launch Complete

Locations:

- `package.json:51`
- `.github/workflows/release.yml`

Status: Materially improved, not complete.

macOS notarization is enabled in package config. The release workflow now has a preflight release gate, macOS signing/notarization secret checks, Windows signing secret checks, Linux AppImage/deb artifacts, and platform checksum files. `docs/RELEASE_READINESS.md` documents the packaged smoke checklist and rollback path.

Remaining work: extend packaged smoke to signed macOS/Windows/Linux release artifacts, configure real signing credentials, and publish support/feedback/crash-reporting decisions before public beta.

### P2 - Accessibility And Hit Targets Need A Polish Pass

Locations:

- `src/components/Sidebar.jsx:141`
- `src/components/FileTree.jsx:192`
- `src/components/EditorPane.jsx:214`

Status: Improved.

The remediation pass added accessible labels and larger hit targets across sidebar, file tree, editor close/dismiss controls, prompt library actions, context monitor actions, and project settings modal controls.

Remaining work: run a real assistive-tech pass and add automated accessibility checks for dense workbench states.

### P2 - Build Performance Needs A Budget

Location: Vite build output

Status: Fixed at the gate level.

The renderer build still emits Vite's generic large-chunk warnings for known Monaco assets, but `scripts/check-bundle-budget.mjs` now enforces explicit limits in CI and release preflight.

Remaining work: restrict Monaco workers/languages if startup, update size, or memory becomes a measured problem.

### P2 - First-Run Onboarding Is Missing

Location: product flow

Status: Fixed for private alpha.

`OnboardingPanel` now checks dev roots, installed Claude/Codex CLIs, discovered sessions, active project context, and Ollama status. Users can dismiss it once setup is complete.

Remaining work: turn the checklist into an opinionated "first useful session" flow and add public onboarding/demo material.

### P2 - Context Monitor Is Claude-Only

Location: `src/components/ContextMonitor.jsx:62`

Status: Fixed.

The context monitor now uses a project-context registry covering Claude instructions, `AGENTS.md`, Codex config paths, and `.nock/config.toml`.

Remaining work: connect context repair/generation flows to the same registry.

### P2 - Docs Were Stale Before This Pass

Locations: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, historical `docs/superpowers/*`

Status: Fixed.

Root docs, agent docs, roadmap, release readiness, and the docs index now distinguish current Claude/Ollama capabilities from the agent-agnostic/Codex-ready direction. Historical Phase 2 docs are marked as historical.

Residual risk: update docs alongside each adapter or release workflow change.

### P3 - Visual Identity Needs Sharper Ownership

Location: `src/index.css`, `tailwind.config.js`, dashboard/AI panel components

The dark cockpit style is serviceable and domain-appropriate, but the cyan/purple/glow/metric-card pattern overlaps heavily with common AI developer-tool aesthetics.

Impact: The product may be remembered as "yet another dark AI dashboard."

Recommendation: Keep the dense cockpit ergonomics, but make the signature interaction the memorable part: live agent timelines, session replay, worktree lanes, and clear handoff states.

## Positive Findings

- Electron security posture is directionally sound: context isolation, no Node integration in the renderer, path-gated file APIs, normalized settings, and restricted external URL opening.
- Terminal lifetime fixes are already in place: terminal views remain mounted across dashboard/settings switches.
- File writes are atomic and covered by tests for symlink/temp-file safety.
- CI runs tests on Node 20 and 22 and builds the Vite renderer.
- GitHub Actions are pinned in CI/release workflows.
- The Monaco smoke test is thoughtful and caught the Vite/worker integration path.
- The app already has product primitives worth building on: project profiles, prompt library, session history, git controls, port monitor, Telegram, and NockCC.

## GTM Recommendation

Do not launch broadly as "Nock Terminal for Codex" yet.

Launch path:

1. Private dogfood: continue exercising the remediated shell settings, unsaved editor protection, onboarding, context checks, and NockCC heartbeat.
2. Private alpha: position as "local cockpit for terminal coding agents" while staying honest that Claude and recent Codex have transcript discovery, Gemini exposes only prompt-log session presence, and all three carry honest one-keystroke resume.
3. Public beta: add Codex/Gemini live attach adapters, Gemini full transcript/replay semantics if the CLI exposes them, worktree lanes, session replay, crash/error reporting, signed artifact smoke coverage, update distribution, and a clear support path.

## What Would Make People Want It

People will want Nock if it gives them control over agent work they already struggle to supervise.

The highest-leverage promise:

> Keep your coding agents visible, recoverable, and accountable while they work across your local projects.

Concrete hooks:

- See every active agent, terminal, branch, dirty repo, and dev server from one desktop view.
- Launch agents into isolated worktrees without remembering commands.
- Watch live output without babysitting.
- Save the transcript, diff, commands, tests, and final handoff as a session replay.
- Get notified when an agent needs input, breaks a test, opens a PR, or stops producing output.
- Standardize prompts and project context files for a team.

That is more compelling than "a terminal with AI chat."

## Remaining Fixes

1. Implement broader reconnect/attach for live local agents beyond the proven CRM tmux path.
2. Implement Codex/Gemini live attach semantics; rollout/prompt-log transcript discovery, one-keystroke resume, and launch/profile settings now exist.
3. Add worktree lanes for parallel agent attempts.
4. Add session replay and handoff export from terminal output, diff, commands, and test results.
5. Extend packaged-app smoke coverage to signed macOS, Windows, and Linux release artifacts.
6. Publish the public support path, beta feedback channel, and crash/error reporting privacy posture.
7. Build the public demo around agent observability, worktree safety, and recoverable sessions.

# Product Roadmap

Updated: 2026-05-15

This roadmap follows the audit in `docs/PRODUCT_AUDIT_GTM_READINESS.md`. It assumes Nock Terminal should become a local-first cockpit for supervising coding agents, not a generic AI IDE.

## Positioning

Recommended positioning:

> Nock Terminal is mission control for terminal-native coding agents. It keeps agent sessions, repos, worktrees, terminals, files, prompts, ports, and notifications visible from one local desktop cockpit.

Do not lead with "Codex app" or "Claude app." Lead with the workflow:

- I have multiple agents running.
- I need to know what each one is doing.
- I need to pause, resume, review, recover, or hand off the work.
- I want local control without losing the benefits of terminal-native tools.

## Product Principles

- **Local-first trust**: source code stays local unless the user chooses otherwise.
- **Agent-agnostic adapters**: Claude Code, Codex CLI, Ollama flows, and future agents should share one cockpit model.
- **Visible autonomy**: agents can work independently, but users can see state, output, diffs, tests, and blockers.
- **Project context as a first-class asset**: AGENTS/CLAUDE instructions, `.nock/config.toml`, prompts, and skills should be discoverable and repairable.
- **Dense, calm, repeated-use UI**: this is an operator console, not a marketing dashboard.

## Near-Term Roadmap

### 1. Relaunch Foundations

Goal: make the current app trustworthy for private dogfood.

Completed in the May 15 remediation pass:

- Fixed `npm audit --audit-level=moderate` blockers.
- Wired `defaultShell`, `shellArgs`, environment variables, and project profile shell settings into terminal creation.
- Added unsaved-change protection for Monaco tabs and split close.
- Added first-run setup checks for dev roots, installed agents, context files, discovered sessions, and local model status.
- Populated NockCC heartbeat fields with real active project/session data.
- Added release preflight, bundle budgets, signing/notarization secret checks, Linux artifacts, checksums, and release readiness docs.

Still required before public beta:

- Automate packaged app smoke tests for macOS, Windows, and Linux release artifacts.
- Decide update distribution, crash/error reporting, support path, and beta feedback channel.

### 2. Agent Adapter Layer

Goal: stop hard-coding Claude Code assumptions throughout the app.

Initial adapter foundations now exist for process detection and project context checks. Agent folders are now first-class discovered entries when existing `agents/*/config.json` files are present, with local NockCC file-bus state used for enabled/running/stale/offline status.

Completed in the agent-folder intelligence pass:

- Detect existing agent folders from configured dev roots.
- Read `config.json` as the source of truth instead of creating a parallel metadata format.
- Show agent cards separately from repo cards in the dashboard and sidebar.
- Resolve conservative launch defaults from config or the agent name.
- Avoid auto-launching duplicate processes when an agent appears running or idle.

Extend the adapter contract for:

- Agent display name and status labels.
- Session transcript discovery paths.
- Process detection names.
- Launch command and arguments.
- Project context files, such as `CLAUDE.md`, `AGENTS.md`, or agent-specific rule folders.
- Settings fields and validation.
- Session metadata sent to NockCC.

Current adapter posture:

- Claude Code: current transcript discovery and launch behavior remain preserved.
- Local agent folders: discovered from config and file-bus state; true reconnect/attach remains future work.
- Codex CLI: context/process foundations exist; first-class discovery and launch support remain next work after confirming the desired Codex integration surface.

### 3. Worktree Lanes

Goal: make parallel agent work safe and visually obvious.

- Create a worktree per agent task.
- Show lanes by branch/worktree, active terminal, changed files, test state, and last output.
- Support "compare lanes" when multiple agents attempt the same task.
- Make cleanup explicit: keep, merge, archive, or delete worktree.

### 4. Session Replay

Goal: turn terminal chaos into durable context.

- Capture terminal output, commands, active files, git diff, test results, and final summary.
- Generate a handoff note after each agent session.
- Let users reopen a past session from the dashboard.
- Support export to Markdown for PR notes, docs, or team review.

### 5. Project Readiness Check

Goal: make the app valuable before the first agent runs.

For each project, show:

- Context files present/missing.
- Dev commands detected from `package.json`, Makefiles, scripts, or common config.
- Git state and branch safety.
- Running ports.
- Agent binaries available.
- Local model availability.
- Suggested first prompt or task.

## GTM Experiments

### Private Alpha: "Agent Control Room"

Audience: developers already using Claude Code, Codex CLI, Cursor background agents, or local LLM workflows.

Promise: "Stop losing track of what your agents are doing."

Activation target:

- User adds dev root.
- Nock discovers at least one repo.
- User launches or attaches to one agent session.
- User receives one useful notification or saves one session replay.

### Team Pilot: "Nock For Agent Ops"

Audience: small engineering teams experimenting with multiple agent tools.

Promise: "Standardize how your team runs, reviews, and hands off agent work."

Pilot features:

- Shared prompt library.
- Shared project context health.
- NockCC presence/heartbeat dashboard.
- Session replay export.
- Slack/Telegram notifications.

### Power-User Wedge: "Worktree Autopilot"

Audience: senior engineers who run several agent attempts in parallel.

Promise: "Run three safe attempts, compare the diffs, keep the best one."

Required features:

- Worktree lanes.
- Agent launcher templates.
- Diff/test summary.
- Cleanup and merge commands.

## Ideas Worth Exploring

1. **Agent adapters marketplace**: lightweight adapters for Claude Code, Codex CLI, Junie, Gemini CLI, Aider, OpenCode, and local scripts.
2. **Prompt recipes by workflow**: bug fix, refactor, test failure, code review, docs update, release prep, dependency bump.
3. **Live agent health**: stuck detector, no-output timer, repeated approval detector, failing-test loop detector.
4. **Handoff composer**: generate PR description, test summary, risk notes, and rollback instructions from a session.
5. **Context repair**: create or improve `AGENTS.md`, `CLAUDE.md`, `.nock/config.toml`, and repo-specific prompt libraries.
6. **Local model bench**: compare local Ollama models on project-specific prompts and latency.
7. **Review cockpit**: aggregate CodeRabbit/Codex/GitHub review comments and map them to open worktrees.
8. **Release desk**: show CI, release branch, changelog, build artifacts, and post-release checks.

## What Not To Build Yet

- A full IDE replacement.
- A public cloud agent runner before local trust is excellent.
- More chat panes without session/diff/test grounding.
- Broad team analytics before the individual workflow is sticky.
- A generic dashboard hero page inside the app.

## Success Metrics

Private dogfood:

- 5 daily active dogfooders.
- 20 agent sessions launched or attached per week.
- 80% of sessions have project path, branch, and terminal status.
- No known data-loss bugs.

Private alpha:

- 25 active users.
- 50% weekly retention after week two.
- Median time to first useful session under 5 minutes.
- At least 30% of sessions end with a saved replay, notification, or handoff artifact.

Public beta:

- Signed/notarized installers.
- Zero high or critical dependency advisories.
- Packaged smoke tests passing for macOS and Windows.
- Clear support and feedback channel.
- One crisp landing page with a demo of worktree lanes or session replay.

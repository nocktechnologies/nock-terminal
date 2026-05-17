# Agent Dispatch

Updated: 2026-05-16

Nock Terminal now understands dispatch-and-die agents in addition to long-lived terminal agents. This is the first implementation of the Codex/DeepSeek agent plan discussed with Mira.

## Supported Dispatch Runtimes

Dispatch agents are discovered from existing `agents/<name>/config.json` files when `agent_runtime` is one of:

- `codex`
- `deepseek`

These agents are intentionally allowed to have `enabled: false`. For the CRM fleet, that does not mean broken or unavailable; it means they should not be started by launchd as a persistent checker. Nock renders them with a `DISPATCH` lifecycle instead of treating them like disabled long-lived agents.

## Discovery Contract

For each dispatch agent, Nock:

1. Reads `agent_name`, `agent_runtime`, `model`, and `working_directory` from config.
2. Walks upward from the agent folder to find the CRM root.
3. Looks for `core/scripts/dispatch-codex.sh` or `core/scripts/dispatch-deepseek.sh`.
4. Parses the script `ALLOWED_AGENTS=(...)` list as the launch source of truth.
5. Marks allowlisted agents as dispatch-ready.
6. Keeps non-allowlisted agents visible but blocked, with an explicit disabled reason.
7. Resolves a per-agent launch alias when one exists, such as `agents/ash/scripts/dispatch-ash.sh`; otherwise it falls back to the canonical dispatcher plus `--agent <name>`.

Nock also dedupes copied agent configs from dispatch/worktree clones by canonical `agent_name`, preferring `/claude-remote-manager/agents/<name>` when available. This keeps copied worktrees from flooding the dashboard with repeated Ash/Smith/etc. cards.

## Current Fleet Mapping

Codex dispatch agents currently expected from Mira's reply:

- `ash`
- `forge`
- `hammer`
- `kiln`
- `talon`
- `vale`

DeepSeek dispatch agents currently expected:

- `smith`
- `tinker`

Agents such as `anvil` or `warden` can appear if their configs declare `agent_runtime: codex`, but they remain blocked until the dispatcher allowlist includes them.

## Launch Routes

The command launcher task-staging panel supports two routes for dispatch agents.

### Brokered By Mira

Default route.

Nock sends a NockCC AgentMessage to `mira-nockos` at `POST /api/teams/messages/` with:

- `from_agent: nock-terminal`
- `to_agent: mira-nockos`
- `message_type: directive`
- `subject: Nock Terminal dispatch: <agent>`
- body containing `request_id`, `agent_name`, `runtime`, `target_repo`, `project_name`, and the task text
- context fields for `source`, `launch_mode`, `dispatch_agent`, `agent_runtime`, `target_repo`, `project_name`, and `request_id`

The brokered route lets Mira apply her kill-switches, payload-file policy, API-key checks, worktree setup, and reporting rules.

### Direct Dispatch Script

Operator route.

Nock asks the Electron main process to create a sanitized task payload file under the OS temp directory, then opens a terminal in the CRM root and runs:

```bash
core/scripts/dispatch-<runtime>.sh --agent <agent> --payload-file <payload-file>
```

The main process shell-quotes the script and payload path, strips unsafe control characters from task text, rejects invalid runtime or agent names, and schedules best-effort temp payload cleanup after 24 hours.

## UI Behavior

- Dashboard agent cards show dispatch runtime and broker status.
- `Ctrl+K` search matches runtime, dispatch state, broker, and command template.
- Task staging switches copy and button text from terminal staging to dispatch request when a dispatch agent is selected.
- Recent dispatch requests appear in the dashboard operations panel with route and status.
- Clicking a dispatch agent card opens the launcher with that agent selected in task staging, because dispatch agents need a task payload before they can launch.
- Direct dispatch uses the per-agent alias script when available, and falls back to `core/scripts/dispatch-<runtime>.sh --agent <agent>` when no alias exists.

## Current Limits

- Completion tracking is request-level only. Nock records that the request was sent or direct script was launched, but it does not yet subscribe to the resulting NockCC AgentMessage reply thread.
- Codex transcript discovery, Codex session resume, and attach semantics remain future adapter work.
- DeepSeek support is API-backed through the CRM dispatcher; there is no standalone DeepSeek CLI profile launcher.

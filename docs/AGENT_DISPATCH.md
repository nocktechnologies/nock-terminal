# Agent Dispatch

Updated: 2026-05-24

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

## Completion Tracking Contract

Current behavior is request-level telemetry. The renderer stores the most recent 12 dispatch runs in `localStorage` under `nock-terminal.dispatchRuns.v1`; it records route, agent, runtime, target repo, project name, request id, message id, payload file, command, status, and error text. It does not store the task body in dispatch-run history.

Phase H completion tracking should preserve that privacy posture and add a live status source rather than inventing a second local file bus.

### Correlation Fields

Every dispatch route must carry a stable `request_id`.

Brokered dispatch already sends a NockCC AgentMessage with:

- `body` lines for `request_id`, `agent_name`, `runtime`, `target_repo`, and `project_name`
- `context.source: nock-terminal`
- `context.launch_mode: brokered`
- `context.dispatch_agent`
- `context.agent_runtime`
- `context.target_repo`
- `context.project_name`
- `context.request_id`

Direct dispatch payload files include the same request fields in the payload body. Direct completion tracking is only reliable if the dispatcher or launched agent reports the same `request_id` back to NockCC; otherwise Nock can only prove that the local payload file and terminal command were created.

### Status Model

Use these status values for future tracked runs:

| Status | Meaning | Source |
| --- | --- | --- |
| `drafted` | Task text is staged but not submitted. | Renderer state only. |
| `sent` | Brokered dispatch message was accepted by NockCC. | `dispatch:brokered` response. |
| `launched` | Direct dispatch payload and terminal command were created. | `dispatch:createPayload` plus terminal launch. |
| `accepted` | Mira or the dispatcher acknowledged the request id. | NockCC live AgentMessage. |
| `running` | A worktree, terminal session, or remote agent run started for the request id. | NockCC live AgentMessage. |
| `blocked` | A policy, allowlist, kill-switch, missing credential, or runtime check stopped the request before work began. | NockCC live AgentMessage or local validation. |
| `completed` | The dispatched work finished and produced a success summary, PR, patch, or explicit done signal. | NockCC live AgentMessage. |
| `failed` | The dispatch request or run failed. | Local exception, terminal launch failure, or NockCC live AgentMessage. |
| `expired` | No correlated update arrived within the configured tracking window. | Nock local timeout. |
| `unknown` | Nock has a historical run that cannot be safely mapped into the newer status model. | Migration fallback. |

Allowed transitions:

- `drafted` -> `sent`, `launched`, or `failed`
- `sent` -> `accepted`, `running`, `completed`, `blocked`, `failed`, `expired`, or `unknown`
- `launched` -> `accepted`, `running`, `completed`, `blocked`, `failed`, `expired`, or `unknown`
- `accepted` -> `running`, `blocked`, `completed`, `failed`, `expired`, or `unknown`
- `running` -> `completed`, `failed`, `expired`, or `unknown`
- terminal states: `blocked`, `completed`, `failed`, `expired`, `unknown`

The reducer should tolerate leapfrog transitions because live messages can arrive out of order or skip intermediate acknowledgements. Once a run reaches `running`, policy or credential failures should be represented as `failed` with a specific reason instead of `blocked`, because `blocked` means work did not begin.

H4 should implement this as a reducer with tests before wiring it into polling or UI rendering.

### Source Of Truth

For brokered dispatch, the source of truth should be NockCC live AgentMessages retrieved through the live API, keyed by `context.request_id` or an equivalent reply-thread correlation. Local project database rows and local file-bus state are not sufficient for completion tracking because Mira and the dispatched agent own the orchestration.

For direct dispatch, the source of truth is split:

- Local Nock can prove `launched` and local terminal launch errors.
- NockCC can prove `accepted`, `running`, `blocked`, `completed`, or `failed` only if the direct dispatcher or agent reports the same `request_id` back through live messages.
- Without a live message, direct runs should age into `expired`, not fake success.

If NockCC exposes both polling and push/live-subscription APIs, H4 should start with bounded polling because it is easier to test and recover. The polling interval should be conservative, stop when all visible runs are terminal, and never block direct dispatch.

### Retention And Privacy

- Keep the renderer-side history capped at 12 visible runs unless a user setting is added.
- Do not store dispatch task text in `localStorage`.
- Store status summaries, request ids, message ids, repo/project names, agent/runtime, timestamps, and short error/status strings only.
- Treat payload file paths as local-sensitive data. They can remain in local history for the direct route, but should not be sent back to NockCC unless the user explicitly chooses direct diagnostic reporting.
- Expire unresolved runs with a visible stale state instead of silently deleting them.

### H4 Implementation Boundary

The implementation slice should add:

- a pure dispatch status reducer with tests
- a NockCC live-message polling or subscription service with request-id correlation
- a compatibility migration for current `sent`, `launched`, and `failed` local history
- dashboard rendering for `accepted`, `running`, `blocked`, `completed`, `failed`, and `expired`
- soft failure when NockCC is unconfigured or unavailable

It should not change dispatch-agent discovery, direct payload creation, or dispatcher script invocation unless the correlation contract cannot be satisfied without a minimal request-id propagation fix.

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

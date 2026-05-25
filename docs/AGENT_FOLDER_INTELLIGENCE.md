# Agent Folder Intelligence

Updated: 2026-05-25

Nock Terminal now treats local agent folders as first-class cockpit entries instead of pretending every discovered path is a repo.

## What Counts As An Agent Folder

`SessionDiscovery` scans configured development roots for existing agent configs in these shapes. When the stored settings have no dev roots yet, Nock falls back to common local roots such as `~/Dev`, `~/dev`, and `~/Projects` so a fresh or reset install can still discover the canonical agent fleet.

- `<root>/config.json`
- `<root>/agents/<agent>/config.json`
- `<root>/<workspace>/agents/<agent>/config.json`

A folder is accepted when `config.json` is valid JSON and contains a safe `agent_name` value. Generic `config.json` files and model-only configs are ignored so normal project configuration files do not become agent cards.

## Config Fields Used

Nock reads existing fields only. It does not introduce a parallel metadata format.

- `agent_name` - canonical local agent id.
- `enabled` - disabled agents render inactive and do not auto-launch.
- `model` - shown on agent cards.
- `agent_runtime` - when `codex` or `deepseek`, the folder is treated as a dispatch-and-die agent.
- `crons` - counted for lightweight cockpit metadata.
- `working_directory` - launch cwd override; relative paths resolve from the agent folder.
- `broker_agent` or `brokerAgent` - optional broker override for dispatch agents; defaults to `mira-nockos`.
- `launch_command`, `launchCommand`, `command`, `start_command`, `startCommand`, or `launch.command` - optional explicit launch command.
- `passive_frozen_threshold` or `stale_threshold_seconds` - heartbeat freshness threshold.

When no explicit launch command exists, enabled CRM persistent agents launch through the canonical tmux attach path, such as `tmux attach -t crm-default-cooper`. That path is now tagged as a live attach/resume capability because Nock can derive the exact tmux target. Other enabled agent folders still derive a command from the raw agent name and are treated as plain folder launches, not attach support.

## Adapter Session Contract

`electron/agent-adapters.js` defines a session contract that separates four different ideas that should not be blended in UI copy:

- Transcript discovery
- Live attach
- Resume command
- Folder launch

Current contract posture:

- Claude Code has supported transcript discovery through `~/.claude/projects/*/*.jsonl`, but no proven live attach command yet.
- Codex CLI and Gemini CLI have process/context detection and profile-driven folder launch, while transcript discovery, live attach, and resume remain future work until backed by runtime evidence.
- Local agent folders have config and file-bus discovery. CRM persistent agents get supported live attach/resume only when discovery derives a deterministic `tmux attach -t crm-<instance>-<agent>` command. Explicit custom commands remain folder launches.
- Dispatch agents are request-level workers. They support dispatch requests when allowlisted, but do not expose local transcript, attach, or resume capabilities.

## Runtime State

Agent state is read from the local NockCC file bus root:

- `CRM_ROOT` when set.
- Otherwise `~/.claude-remote/<CRM_INSTANCE_ID || default>`.

The app checks:

- `state/<agent>.fc-heartbeat`
- `state/<agent>.nockcc-last-ok`
- `state/<agent>.tg-bridge.heartbeat`
- `state/<agent>.session-start`
- `state/<agent>.stats.json`
- `state/<agent>.fast-checker.pid`
- `state/<agent>.mcp-children.pids`
- `inbox/<agent>/`
- `inflight/<agent>/`

Lifecycle values are normalized to:

- `running`
- `idle`
- `stale`
- `offline`
- `disabled`
- `dispatch`

For the renamed Mira surface, Nock also checks the legacy `mara-nockos` bus alias.

## Dispatch Agents

Configs with `agent_runtime: codex` or `agent_runtime: deepseek` follow a different lifecycle from persistent agents:

- `enabled: false` is expected and does not mean the card is broken.
- Nock walks up to the CRM root and looks for `core/scripts/dispatch-codex.sh` or `core/scripts/dispatch-deepseek.sh`.
- The script `ALLOWED_AGENTS=(...)` list is the source of truth for whether the agent can launch.
- Per-agent aliases such as `agents/ash/scripts/dispatch-ash.sh` are detected when present; agents without a shim use the canonical dispatcher with `--agent <name>`.
- Allowlisted dispatch agents show as dispatch-ready and can receive task-staging requests.
- Non-allowlisted dispatch agents remain visible with an explicit blocked reason.

To prevent copied dispatch worktrees from duplicating every agent card, Nock dedupes agent folders by canonical `agent_name` and prefers the root `/claude-remote-manager/agents/<name>` path.

## UI Behavior

Dashboard and sidebar now split discovered entries into:

- Agents
- Projects

Agent cards show:

- Agent badge
- Lifecycle
- Model
- Launch command or dispatch broker
- Unread/inflight message count

Click behavior is conservative:

- Running or idle plain launch agents open a terminal in the agent folder without auto-launching a duplicate process.
- Offline or stale enabled plain launch agents launch the derived or configured command.
- Persistent CRM agents do not require shell aliases such as `cooper` or `rook`; Nock falls back to `tmux attach -t crm-<instance>-<agent>` and executes that command only for attach/launch actions.
- `Open Agent Folder` is a literal folder terminal action for agent rows. It suppresses launch and attach commands even when the row has a supported command.
- The context menu provides `Attach Session` for CRM tmux-backed persistent agents, `Launch Fresh` for plain folder launches, and `Stage Dispatch Task` for dispatch agents.
- `Ctrl+K` includes agent folders in the command launcher, ranks exact agent-name matches above similarly named repos, and can launch a fresh agent terminal.
- Task staging can place a user-written task into a freshly launched agent terminal without submitting it.
- Dispatch agent clicks open task staging with that agent selected; task staging sends a brokered NockCC request to Mira by default, or opens the resolved direct dispatch alias/script when the direct route is selected.

## Current Limits

Attach/resume support is intentionally narrow. Today it means CRM persistent agent tmux attach, and only when the command target is deterministic. Nock still does not claim Claude Code resume, Codex resume, Gemini resume, arbitrary agent reconnect, transcript replay, or file-bus handoff.

Dispatch completion tracking is request-level, not full reply-thread tracking. Brokered runs can advance from NockCC live `status_update` AgentMessages correlated by `context.request_id`, but Nock does not yet render the full dispatched agent transcript or AgentMessage thread.

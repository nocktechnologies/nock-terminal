# Agent Folder Intelligence

Updated: 2026-08-08

Nock Terminal now treats local agent folders as first-class cockpit entries instead of pretending every discovered path is a repo.

## What Counts As An Agent Folder

`SessionDiscovery` scans configured development roots for existing agent configs and resident harness manifests in these shapes. When the stored settings have no dev roots yet, Nock falls back to common local roots such as `~/Dev`, `~/dev`, and `~/Projects` so a fresh or reset install can still discover the canonical agent fleet.

- `<root>/config.json`
- `<root>/agents/<agent>/config.json`
- `<root>/<workspace>/agents/<agent>/config.json`
- `<root>/seats/<agent>.json`
- `<root>/<workspace>/seats/<agent>.json`

A folder is accepted when `config.json` is valid JSON and contains a safe `agent_name` value. Generic `config.json` files and model-only configs are ignored so normal project configuration files do not become agent cards.

A resident harness seat is accepted when the JSON manifest has a safe `agent` or `agent_name`, `runtime.adapter: claude-code-interactive`, a deterministic `tmux.socket`, a deterministic `tmux.session`, and a `control_socket`. Resident manifests win dedupe over retired SDK agent folders for the same agent name, because Mira's old bounded-turn harness is no longer load-bearing.

## Config Fields Used

Nock reads existing fields only. It does not introduce a parallel metadata format.

- `agent_name` - canonical local agent id.
- `enabled` - disabled agents render inactive and do not auto-launch.
- `model` - shown on agent cards.
- `agent_runtime` - when `codex` or `deepseek`, the folder is treated as a dispatch-and-die agent.
- `crons` - counted for lightweight cockpit metadata.
- `working_directory` - launch cwd override; relative paths resolve from the agent folder.
- `broker_agent` or `brokerAgent` - optional broker override for dispatch agents; defaults to `mira-nockos`.
- `launch_command`, `launchCommand`, `command`, `start_command`, `startCommand`, or `launch.command` - optional explicit launch command metadata. These commands are discovered and displayed, but they are not auto-run unless a trusted launcher path explicitly marks them launchable.
- `passive_frozen_threshold` or `stale_threshold_seconds` - heartbeat freshness threshold.

When no explicit launch command exists, enabled CRM persistent agents attach through the canonical tmux path, such as `tmux attach -t crm-default-cooper`. That path is tagged as a live attach/resume capability because Nock can derive the exact tmux target. Other enabled agent folders may still expose a configured command or raw agent-name fallback as metadata, but Nock treats those commands as untrusted until a future confirmation/trust UI exists.

## Resident Seat Manifest Fields Used

Nock reads the new TMUX resident harness manifest as an operational contract, not as a folder launch recipe.

- `agent` or `agent_name` - canonical resident seat id.
- `home` - resident home path; becomes the agent row path when present.
- `work_dir` or `workDir` - working directory for the attach terminal cwd.
- `state_dir` or `stateDir` - resident state root; defaults to `<home>/state/resident`.
- `presence_dir` or `presenceDir` - directory containing `presence.json`; defaults to `<state_dir>/presence`.
- `runtime.adapter` - must be `claude-code-interactive`.
- `runtime.model` - shown on the agent card when present.
- `tmux.socket` - exact tmux socket path for human attach.
- `tmux.session` - exact tmux session name. Nock prefixes the attach target with `=` to avoid tmux prefix matching.
- `control_socket` or `controlSocket` - same-uid AF_UNIX control socket for future status/receipt/lifecycle actions.

The resolved attach command has this shape:

```bash
tmux -S <tmux.socket> attach -t =<tmux.session>
```

Nock only marks that attach action runnable when the tmux socket is reachable on the current machine. A checked-out manifest for a remote fleet host can still identify Mira as a resident seat, but the local app will disable Attach instead of opening a terminal that can only fail.

## Adapter Session Contract

`electron/agent-adapters.js` defines a session contract that separates four different ideas that should not be blended in UI copy:

- Transcript discovery
- Live attach
- Resume command
- Folder launch

Current contract posture:

- Claude Code has supported transcript discovery through `~/.claude/projects/*/*.jsonl`, but no proven live attach command yet.
- Codex CLI has recent rollout transcript discovery plus process/context detection and profile-driven folder launch. Gemini CLI has process/context detection, profile-driven folder launch, and conditional prompt-log session-presence discovery; full transcript replay, live attach, and resume remain future work until backed by runtime evidence.
- Local agent folders have config and file-bus discovery. CRM persistent agents get supported live attach/resume only when discovery derives a deterministic `tmux attach -t crm-<instance>-<agent>` command. Explicit custom commands remain conditional folder-launch metadata and are blocked from auto-run until explicitly trusted.
- TMUX resident agents are discovered from `seats/*.json` manifests. They expose hook-derived presence, a same-uid control-socket contract, a read-only journal path, and exact tmux attach metadata. They do not expose transcript discovery, SDK resume, folder launch, old queue database state, pane scraping, or `send-keys` control.
- Dispatch agents are request-level workers. They support dispatch requests when allowlisted, but do not expose local transcript, attach, or resume capabilities.

## Runtime State

Classic CRM agent state is read from the local NockCC file bus root:

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

Resident harness state is read from `presence.json` under the manifest's `presence_dir`. Presence is hook-derived liveness, not process-table inference. Nock maps resident presence statuses like this:

- `starting`, `working`, and `compacting` -> `running`
- `waiting` and `idle` -> `idle`
- `ended`, `capsule_failed`, and `unknown` -> `offline`

Nock does not scrape tmux panes, use `tmux send-keys`, read the old SDK `state/queue.db`, inspect wake state, or infer resident state from process tables. Future control actions must use the resident control socket with request ids and idempotent effects.

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
- Offline or stale enabled plain launch agents also open a terminal in the agent folder. Derived or configured commands remain visible, but Nock does not auto-run them without explicit trust.
- Persistent CRM agents do not require shell aliases such as `cooper` or `rook`; Nock falls back to `tmux attach -t crm-<instance>-<agent>` and executes that command only for attach/launch actions.
- TMUX resident agents show runtime `resident` and attach with the exact manifest command, such as `tmux -S /run/nock-agent-harness-tmux/mira/tmux.sock attach -t =nock-resident-mira`, but only when the socket is reachable from the machine running Nock Terminal.
- `Open Agent Folder` is a literal folder terminal action for agent rows. It suppresses launch and attach commands even when the row has a supported command.
- The context menu provides `Attach Session` for CRM tmux-backed persistent agents, disables untrusted plain folder launches, and provides `Stage Dispatch Task` for dispatch agents.
- `Ctrl+K` includes agent folders in the command launcher, ranks exact agent-name matches above similarly named repos, and opens untrusted folders without auto-running their discovered commands.
- Task staging can place a user-written task into a freshly opened or launched agent terminal without submitting it.
- Dispatch agent clicks open task staging with that agent selected; task staging sends a brokered NockCC request to Mira by default, or opens the resolved direct dispatch alias/script when the direct route is selected.

## Current Limits

Attach/resume support is intentionally narrow. Today it means CRM persistent agent tmux attach and TMUX resident harness attach, and only when the command target is deterministic. Resident support is currently discovery, presence metadata, session-contract metadata, and exact attach behavior; Nock does not yet call the resident control socket for status, receipt, pause, resume, restart, steer, or rotate. Nock still does not claim Claude Code resume, Codex resume, Gemini resume, arbitrary agent reconnect, transcript replay, or file-bus handoff.

Dispatch completion tracking is request-level, not full transcript tracking. Brokered runs can advance from NockCC live `status_update` AgentMessages correlated by `context.request_id`, and operators can inspect the correlated request-level AgentMessage thread, but Nock does not yet render the dispatched agent terminal transcript.

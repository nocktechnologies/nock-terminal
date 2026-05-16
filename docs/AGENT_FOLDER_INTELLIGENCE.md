# Agent Folder Intelligence

Updated: 2026-05-15

Nock Terminal now treats local agent folders as first-class cockpit entries instead of pretending every discovered path is a repo.

## What Counts As An Agent Folder

`SessionDiscovery` scans configured development roots for existing agent configs in these shapes:

- `<root>/config.json`
- `<root>/agents/<agent>/config.json`
- `<root>/<workspace>/agents/<agent>/config.json`

A folder is accepted when `config.json` is valid JSON and contains a safe `agent_name` value, or when the folder basename can be used as the agent name.

## Config Fields Used

Nock reads existing fields only. It does not introduce a parallel metadata format.

- `agent_name` - canonical local agent id.
- `enabled` - disabled agents render inactive and do not auto-launch.
- `model` - shown on agent cards.
- `crons` - counted for lightweight cockpit metadata.
- `working_directory` - launch cwd override; relative paths resolve from the agent folder.
- `launch_command`, `launchCommand`, `command`, `start_command`, `startCommand`, or `launch.command` - optional explicit launch command.
- `passive_frozen_threshold` or `stale_threshold_seconds` - heartbeat freshness threshold.

When no explicit launch command exists, enabled agents derive a command from the agent name, such as `Mira` for `mira`.

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

For the renamed Mira surface, Nock also checks the legacy `mara-nockos` bus alias.

## UI Behavior

Dashboard and sidebar now split discovered entries into:

- Agents
- Projects

Agent cards show:

- Agent badge
- Lifecycle
- Model
- Launch command
- Unread/inflight message count

Click behavior is conservative:

- Running or idle agents open a terminal in the agent folder without auto-launching a duplicate process.
- Offline or stale enabled agents launch the derived or configured command.
- The context menu provides `Launch Fresh` when the agent is enabled and has a launch command.

## Current Limits

This is not true session attach/reconnect yet. Nock can show that an agent appears alive and can open the correct folder, but a future adapter must confirm whether reconnect means tmux attach, transcript resume, file-bus handoff, or another runtime-specific action.

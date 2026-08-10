# Agent Console v1

## Product boundary

Agent Console is Nock Terminal's control plane for persistent agent harnesses.
It is not a second terminal emulator and it does not copy Hermes' profile
model. The console has two modes with different ownership boundaries:

- **Remote Seats** preserves the existing SSH-backed harness view. It reads
  status, control, pulse, and presence data and opens interactive or read-only
  access to seats that are already installed on remote hosts.
- **Local Residents** creates and manages Nock-owned residents on this Mac.

Remote Seats does not provision, install, or rewrite a remote harness. Local
Residents does not turn the remote SSH surface into a deployment system.

The first managed template is intentionally narrow:

- local machine only;
- Claude Code interactive runtime;
- `nock-agent-harness-tmux` resident engine;
- one dedicated tmux server and one launchd service per seat on macOS;
- console channel only;
- dedicated Claude configuration and authentication per seat.

The first Local Residents template is intentionally narrow. It does not add
Codex, Gemini, SDK, or generic runtime resident support.

## Ownership model

The durable entities are separate even when v1 presents them in one screen:

1. **Harness template** describes a supported runtime architecture.
2. **Agent blueprint** is operator intent: identity, model, workspace roots,
   and permission preset.
3. **Deployed seat** is a local residence, engine manifest, and supervisor
   registration.
4. **Session** is the live tmux-hosted Claude conversation.

Nock owns only files below the managed roots and the matching launchd plist.
It never edits an imported residence or the resident engine checkout.

## Managed paths

```text
~/.nock/agents/<agent>/
  nock-agent.json              # Nock metadata and blueprint
  seat.json                    # engine manifest
  identity/agent.md            # residence-owned capsule source
  bin/compile-capsule.py       # residence-owned envelope compiler
  bin/run-resident.sh          # launchd exit-code adapter
  config/claude/settings.json  # permission preset + engine hook merge target
  state/resident/              # engine-owned live state
  state/nock-supervisor.json   # Nock-owned last process exit receipt
  logs/                        # launchd stdout/stderr

~/.nock/run/<agent>/           # short 0700 socket directory
  tmux.sock
  control.sock
  channel.sock

~/Library/LaunchAgents/io.nock.terminal.resident.<agent>.plist
```

The short runtime root is required because AF_UNIX paths are length-bounded on
macOS. Residence state and identity remain outside the engine checkout, as the
engine's doctor contract requires.

## Provisioning states

```text
draft -> needs_auth -> stopped -> starting -> running
                                -> paused
                                -> terminal_failed
        -> invalid
```

Creation is transactional: write to a temporary residence, run the resident
engine's `runtime.seat --check` against the generated manifest, then rename the
residence, runtime directory, and plist into place. A failed create leaves no
partially managed seat or launchd registration.

`needs_auth` is expected after creation. Nock opens a terminal running
`CLAUDE_CONFIG_DIR=<seat config> claude auth login --claudeai`. Validation then
probes `claude auth status --json`, computes the engine's non-secret auth
fingerprint, and updates the manifest. Nock never copies or reads credential
files.

## Runtime prerequisites

Nock probes, and reports separately:

- macOS launchd availability;
- the `nock-agent-harness-tmux` checkout;
- Python 3 and the engine runtime environment;
- tmux;
- Claude Code, its exact version, and dedicated-seat authentication.

The engine checkout is code, not a data home. The initial development lookup
accepts an explicit configured path and the sibling checkout
`~/Dev/nock-agent-harness-tmux`. A packaged distribution must install a pinned
engine release instead of depending on that development convention.

launchd runs `python -m runtime.seat --manifest <seat.json>` from the engine
root. The seat wrapper preserves the engine's exit contract: terminal/config
failures (3/78) become a clean supervisor stop, while transient failures remain
restartable. It records only the exit code and timestamp in Nock-owned state so
Agent Console can show an operator-action state without reading engine state.
Nock does not emulate systemd on macOS.

## Permission presets

Presets compile into the dedicated Claude `settings.json`; they are not prose
and they do not expand the resident engine's verified launch argv.

| Preset | Claude default mode | Intended use |
| --- | --- | --- |
| Supervised | `manual` | Ask before tool actions. |
| Standard | `acceptEdits` | Apply edits while retaining command gates. |
| Autonomous | `bypassPermissions` | Trusted local seat with broad authority. |

Advanced details show the exact setting plus allowed and denied workspace
roots. The engine manifest remains the source of truth for workspace scope.

## Control contract

Renderer access is limited to a structured preload API:

```text
managedAgents.prerequisites()
managedAgents.list()
managedAgents.create(draft)
managedAgents.update(agentId, draft)
managedAgents.validate(agentId)
managedAgents.authLaunch(agentId)
managedAgents.supervise(agentId, start|stop)
managedAgents.control(agentId, status|pause|resume|restart|rotate|steer, params)
```

Updates preserve the immutable seat id, residence, and auth fingerprint, and
are accepted only while the seat is stopped and its launchd job is unloaded.
Generated files are replaced as one rollback-capable transaction. IPC validates agent ids, bounded
strings, enumerated models/presets/actions,
and absolute workspace roots. The renderer never supplies a command, socket
path, manifest path, launchd label, or executable path.

Resident mutations use the manifest-declared same-UID NDJSON control socket.
Each request gets a UUID that must be echoed by the resident. Nock does not
silently retry a mutation, so an ambiguous result cannot become a second
effect. The resident tmux server enables mouse handling and clipboard
forwarding, then Nock attaches with `tmux -S <socket> attach -t =<session>`
using trusted manifest metadata. This keeps scrollback and terminal OSC 52
copy behavior available through local or remote attaches. Nock never
pane-scrapes, uses `send-keys`, or writes engine state.

## v1 UI

Agent Console is a first-class navigation view. Remote Seats retains:

- configured SSH seat inventory and connection editing;
- bounded status and control actions;
- interactive console and protected watch access;
- agent pulse and live presence.

Local Residents adds:

- compact managed inventory;
- lifecycle and prerequisite state;
- one selected-agent inspector;
- Create Resident flow;
- authenticate, validate, start, stop, attach, pause, resume, restart, rotate,
  and steer commands when supported;
- visible ownership, harness, runtime, model, permission preset, residence,
  workspace, and failure reason.

Controls are capability-driven. Local resident actions never mutate a remote
seat, and remote controls never write a local managed residence.

## Deliberate non-goals

- remote provisioning or remote mutation;
- NockCC/Telegram credential installation;
- SDK resident creation;
- Codex/Gemini resident templates;
- transcript scraping or synthetic resume for resident sessions;
- deleting residences from the UI;
- arbitrary command or environment editing;
- editing imported agents.

Those features can reuse the entity and adapter boundaries above without
turning the first managed template into a generic command launcher.

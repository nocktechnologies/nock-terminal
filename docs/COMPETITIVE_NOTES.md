# Competitive Notes

Living notes from product comparisons. These are not feature commitments; they are useful patterns to consider when shaping Nock Terminal's local-first, supervised-autonomy cockpit.

## herdctl

Reviewed: 2026-05-23

Positioning: herdctl is strongest as a Claude Code fleet runner: source-controlled agents, schedules, jobs, hooks, chat connectors, Docker isolation, session continuity, and a web dashboard.

Nock takeaways:

- Use one run ledger for terminal sessions, NockCC dispatches, scheduled runs, and brokered autonomous work.
- Track NockCC dispatch completion threads beyond "sent", including status, summaries, artifacts, and handoff.
- Add source-controlled Nock recipes for launch profiles, prompts, schedules, hooks, safety policy, and notification rules.
- Add work-source adapters, starting with GitHub Issues: fetch, claim, complete, and release.
- Add schedule/autonomy controls through Nock's supervised lens: visible state, approvals, review, and recovery.
- Make the public demo explain human-in-loop terminal work plus autonomous NockCC work in one cockpit.

Do not copy:

- Do not become Claude-only.
- Do not become YAML-first at the expense of the native cockpit.
- Do not turn Nock into a daemon/web-dashboard clone.

## Claude Fleet

Reviewed: 2026-05-23

Positioning: Claude Fleet is strongest as a multi-agent orchestration substrate for Claude Code: iterative waves, specialized roles, worker spawning, tmux/headless modes, REST and MCP control, swarm blackboards, worktrees, task routing, memory, metrics, and pluggable storage.

Nock takeaways:

- Model autonomous work as waves or phases when a task needs discovery, design, implementation, testing, and review instead of one agent run.
- Add visible run topology: which agents are scouts, implementers, reviewers, blockers, dependencies, and quality gates.
- Treat blackboard-style coordination as a useful NockCC primitive: directives, reports, queries, discoveries, and read tracking.
- Add bounded spawn policy to autonomous work: soft and hard worker limits, max depth, role permissions, and queueing.
- Add task routing heuristics so simple work can stay direct while complex work escalates to supervised or multi-agent execution.
- Preserve tmux/terminal visibility as a debugging and trust surface for autonomous runs.
- Track context rollover and handoff summaries as first-class run events.

Do not copy:

- Do not import the full swarm vocabulary into the main UI unless it maps to concrete operator decisions.
- Do not depend on unreleased or patched Claude Code feature gates for core product value.
- Do not add broad server/storage/Rust acceleration layers before Nock has a crisp run ledger and completion loop.
- Do not let package/API ambition outpace verified workflows and demoable reliability.

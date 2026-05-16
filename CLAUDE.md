# Claude Instructions

Canonical repo guidance lives in [AGENTS.md](AGENTS.md). Use that file for product posture, setup, commands, architecture notes, current audit status, and roadmap links.

Claude-specific note: this app still has first-class Claude Code transcript discovery and launch flows. It also discovers local agent folders from existing `config.json` files, but true reconnect/attach is still future adapter work, so keep product copy honest while the broader agent-agnostic layer continues.

## Session Closeout

File a Session Report for every build/session before final response, even
docs-only work. Use `nockcc_session_report_create` or
`POST /api/sessions/reports/` with `session_id`, `agent_name`, `duration`,
task/PR/message/decision counts, `handoff_written`, standing-order pass/total
counts, concise notes, and 2-5 highlights. Include `nock-terminal` in the
session id or notes so NockCC can trace the report back to this repo.

# Post-A/B/C Integration Audit

Updated: 2026-06-08

This is the Nock `7533` checkpoint after the first remediation wave landed:

- Nock `7530` / Phase A: UI/settings truth cleanup, PR #31, merge `9eb0558`.
- Nock `7531` / Phase B: Electron IPC and secret hardening, PR #32, merge `e970df0`.
- Nock `7532` / Phase C: file tree and editor correctness, PR #37, merge `1ba415f`.

The goal is to name the risks that are actually closed, identify the remaining load-bearing risks, and decide what the next wave should be. This is not a broad module-split task.

## Follow-Up Status

The next-wave E/G contracts have now landed on `origin/main`:

- Nock `7551` / Phase E: PR #39, merge `1cd45fd`.
- Nock `7552` / Phase G: PR #40, merge `ed5751b`.

Phase E removed the unused Claude chat IPC/client path and the misleading global Claude/Mara settings, kept Kit launch behavior profile-driven, moved Telegram token access behind explicit reveal/status UI, and normalized `dispatch:brokered` onto the shared IPC validator/error response pattern.

Phase G added schema-versioned migrations for settings, project profiles, prompt markdown, and session-history metadata. It also tightened migration behavior after review: whole-store replacement for `electron-store`, stable nested-object comparison, invalid legacy `defaultAgent` reset, and safer prompt-file read metadata.

Phase F is now unblocked, but should remain a mechanical decomposition of `App.jsx`, `electron/main.js`, and `electron/session-discovery.js`. Phase H remains release readiness rather than local architecture work.

## Verification

Run from branch `codex/n7533-integration-audit` based on `origin/main` at `1ba415f`.

| Check | Result |
| --- | --- |
| `npm test` | Pass, 85/85 tests |
| `npm audit --audit-level=moderate` | Pass, 0 vulnerabilities |
| `npx vite build` | Pass |
| `npm run check:bundle` | Pass |
| `python3 test/monaco.smoke.py` with Vite on `localhost:5173` | Pass |
| `npx knip --reporter compact` | Pass, no output |

The Monaco smoke emitted the usual Vite-side worker fallback warnings while loading the dev page, but the smoke result itself reported Monaco loaded, TypeScript mode active, keyboard input accepted, and no browser console or worker errors.

## Closed Risks

Phase A closed the most misleading settings/profile debt. Removed no-op settings and profile fields are rejected or stripped, settings reset now produces a real default snapshot, project profile defaults line up with the current launcher model, and the UI no longer advertises options that are not wired.

Phase B materially improved the renderer-to-main boundary. `terminal:create`, `settings:set`, `profiles:save`, `prompts:save`, file operations, and dispatch payload creation now have main-process validation before reaching services. Settings export and renderer-wide settings reads redact sensitive values. The IPC security note now records the remaining Electron sandbox decision instead of pretending the boundary is finished.

Phase C closed the highest-risk file/editor correctness defects. File tree traversal is capped by depth and entry count, large files return a read-only preview without reading the full file, tree truncation is surfaced to the UI, file watcher `change` events refresh clean editor models, and saves update the editor cache so close/reopen shows the saved content.

During this checkpoint, one small Phase B leftover was fixed: generic `settings:get(key)` no longer returns sensitive keys such as `telegramBotToken` or `nockccApiKey`. Renderer code that needs those values must use the explicit `settings:getSecure` allowlist.

June 8 audit-hardening update: the remaining `settings:getSecure` exposure is now closed. `settings:getSecure` returns `null`, renderer settings reads stay status-only, and main-process services read Telegram/NockCC credentials through a secure settings facade backed by Electron `safeStorage` when available.

## Remaining Risks

The repo is private-alpha hardening clean after A/B/C, but not public-launch clean. The remaining risks are structural, not the same concrete defects from the original audit.

1. Closed after this checkpoint: `settings:getSecure` is no longer a renderer-accessible secret path. The remaining secret-storage caveat is operational rather than architectural: on systems where Electron `safeStorage` is unavailable, secrets are kept in main-process memory for the run instead of persisted as plaintext.

2. `dispatch:brokered` still relies on `AgentDispatchService` sanitization and thrown errors instead of the shared `validateDispatchCreatePayload` plus `errorPayload` pattern. It does not create files or spawn commands, so this is not a blocker, but it is the last uneven IPC edge in the A/B/C surface.

3. Local persisted data is still schema-less. Settings, project profiles, prompt library entries, and session history rely on best-effort sanitization at read/write time instead of versioned migrations. That is fine for dogfood, brittle for public support.

4. `App.jsx`, `electron/main.js`, and `electron/session-discovery.js` remain too large and too stateful. They are now safer to split because the high-risk contracts have settled, but splitting them before Phase E/G would still create avoidable churn.

5. Release readiness is still mostly checklist-grade outside Linux unpacked packaged smoke. Public launch still needs signed macOS/Windows/Linux artifact smoke, update-channel policy, crash/error reporting, and support escalation behavior.

## Go/No-Go

Go for the next wave, with sequencing constraints:

- Phase E and Phase G can run in parallel.
- Phase F should wait until Phase E/G contracts are clear.
- Phase H can start as docs/checklist work now, but packaged smoke implementation should wait until the module split settles.

Do not reopen the old A/B/C defect list wholesale. The next work should target the current residual risks above.

## Recommended Next Nocks

Phase E: settings/profile/AI wiring and deletion pass. **Done via PR #39.**

Scope: decide which AI/profile fields are real product surface, wire the ones that are real, delete the rest, tighten `settings:getSecure` UX, and normalize `dispatch:brokered` onto the shared validator/error response pattern.

Phase G: versioned local data migrations. **Done via PR #40.**

Scope: introduce a persisted schema version for settings, project profiles, prompt library entries, and session history; migrate removed fields; add regression tests for old stored shapes.

Phase F: module decomposition.

Scope: split `App.jsx`, `electron/main.js`, and `electron/session-discovery.js` after Phase E/G. Preserve behavior, keep commits small, and avoid combining extraction with feature changes. Start from `origin/main` at or after `ed5751b`.

Phase H: production release readiness.

Scope: signed artifact smoke across macOS/Windows/Linux, update-channel decision, crash/error reporting path, release support checklist, and a sharper public demo script.

# Nock Backlog Reconciliation

Updated: 2026-05-24

This document reconciles the live NockCC queue with the current `origin/main` state for Nock Terminal. It exists because the remediation work moved quickly enough that the labels drifted: some Nocks are truly done, one important Nock was marked done even though the merged PR did different work, and several older roadmap rows now need narrower wording.

## Current Baseline

- Repo baseline: `origin/main` at merge commit `cc2c517` after PRs #31, #32, #37, #38, #39, #40, #42, #43, #44, #46, #47, #48, #49, #50, #51, #52, #53, #54, #55, and #56.
- NockCC live update: message `#1443` sent to `mira-nockos` when Phase E/G PRs opened; later closeout messages should reference PRs #39 and #40.
- Project board: Nocks `7530`, `7531`, `7532`, `7533`, `7551`, and `7552` are attached to the Terminal project.
- Primary local checkout note: `/Users/kevin/Dev/nock-terminal` had unrelated dirty work and was behind `origin/main` during this pass, so implementation and audit work used clean worktrees.

## Reconciled Nocks

| Nock | Live state | Project lane | Repo status | Decision |
| --- | --- | --- | --- | --- |
| `831` | Done | `20 Dispatch Ready` | PR #27 merged | Keep as completed dispatch-agent support record. |
| `7530` | Done | `40 Product Ops / Polish` | PR #31 merged: `9eb0558` | Correctly closed Phase A: UI/settings truth cleanup. |
| `7531` | Done | `40 Product Ops / Polish` | PR #32 merged: `e970df0` | Correctly closed Phase B: Electron IPC and secret hardening. |
| `7532` | Done | `10 Active Foundation` | PR #37 merged: `1ba415f` | True Phase C is complete: bounded tree traversal, large-file preview behavior, and editor stale-cache refresh. |
| `7533` | Done | `30 Roadmap` | PR #38 merged: `9751a36` | Post-A/B/C integration audit complete. See `docs/POST_ABC_INTEGRATION_AUDIT.md`. |
| `7551` | Done | `10 Active Foundation` | PR #39 merged: `1cd45fd` | Phase E closed: settings/profile/AI deletion pass, explicit secret reveal UX, and shared `dispatch:brokered` validation. |
| `7552` | Done | `10 Active Foundation` | PR #40 merged: `ed5751b` | Phase G closed: schema-versioned settings, project profile, prompt, and session-history migrations. |
| `7576` | Done | `10 Active Foundation` | PR #42 merged | Phase F slice 1: settings IPC extraction. |
| `7578` | Done | `10 Active Foundation` | PR #43 merged | Phase F slice 2: file IPC extraction. |
| `7579` | Done | `10 Active Foundation` | PR #44 merged | Phase F slice 3: dispatch IPC extraction. |
| `7598` | Done | `10 Active Foundation` | PR #46 merged | Phase F slice 4: local-data IPC extraction. |
| `7604` | Done | `10 Active Foundation` | PR #47 merged | Phase F slice 5: terminal IPC extraction. |
| `7608` | Done | `10 Active Foundation` | PR #48 merged | Phase F slice 6: system/window IPC extraction. |
| `7614` | Done | `10 Active Foundation` | PR #49 merged: `f11036a` | Phase F slice 7: NockCC activity IPC extraction. |
| `7620` | Done | `10 Active Foundation` | PR #50 merged: `f059b2f` | Phase F final slice: session discovery, Ollama, and Telegram IPC extraction. |
| `7621` | Done | `30 Roadmap` | PR #51 merged: `891e8a8` | Phase H Task 0: execution plan and release Nock rewrite. |
| `7627` | Done | `30 Roadmap` | PR #52 merged: `596e6d8` | Phase H H3: dispatch completion tracking contract. |
| `7628` | Done | `10 Active Foundation` | PR #53 merged: `6fee7d6` | Phase H H4a: local dispatch status reducer and history normalization foundation. |
| `7680` | Done | `10 Active Foundation` | PR #55 merged: `e81f3e6`; PR #56 merged: `cc2c517` | Phase H H4 proper: live NockCC inbox polling for brokered dispatch completion updates after Mira message #1513 confirmed the read API contract; PR #56 handled post-merge review stabilization. |
| `886` | Backlog | `30 Roadmap` | Still valid | Marketing/GTM positioning is useful, but should use this ledger and current release docs. |
| `123` | Backlog | `30 Roadmap` | Rewritten for Phase H | Distribution readiness now tracks signed artifact smoke, credentials, update channel, crash/error reporting, support path, and beta feedback. |
| `7451` | Done | None | Historical assessment | Keep as archived historical launch-readiness report. |

Declined historical rows `7468`, `7482`, `7483`, `7484`, and `7485` are not active execution inputs.

## Important Correction

Do not treat PR #33 as completion of Nock `7532`.

PR #33 was titled `N7532: Phase C - stale contract cleanup`, but the live Nock `7532` is titled `Nock Terminal Phase C: File tree and editor correctness` and has these acceptance criteria:

- Large repos and large files do not stall the desktop app.
- Saving a file and reopening it in the same editor session shows the saved content.
- File tree returns bounded, predictable results with partial-tree metadata or an equivalent UI affordance.

Those acceptance criteria were not implemented by PR #33. The stale-contract cleanup was still useful, but it should be considered a separate cleanup that landed between Phase B and the true Phase C. PR #37 is the merge that satisfies Nock `7532`.

## Next Execution Order

1. **Treat Phase F as closed.**
   Phase F moved settings, file, dispatch, local-data, terminal, system/window, NockCC activity, session discovery, Ollama, and Telegram IPC out of `electron/main.js`. Further work in this area should be framed as adapter/product behavior, not generic main-process decomposition.

2. **Execute Phase H from `docs/PHASE_H_EXECUTION_PLAN.md`.**
   The next follow-up should be either signed artifact smoke evidence for Nock `123` or the H5/H6 adapter contract/resume work after H4 polling lands. Those can run in parallel if release-machine access and product-contract work have separate owners.

3. **Keep Nock `886` as product/GTM work.**
   It should be informed by current truth: Claude transcript discovery is real, Codex/Gemini launch profiles exist, Codex/DeepSeek dispatch exists, Linux unpacked packaged smoke exists, and full Codex/Gemini transcript discovery, attach/reconnect, signed installer smoke, update distribution, crash reporting, worktree lanes, and replay remain roadmap.

## Notes For Future Agents

- When closing a Nock, set the live Nock `repo`, `branch`, `pr_number`, and `pr_url` fields.
- If a PR title references a Nock but the implementation does not satisfy that Nock's acceptance criteria, leave the Nock open and add an audit note.
- Keep Terminal project placement current. Active implementation belongs in `10 Active Foundation`; future planning belongs in `30 Roadmap`; completed hardening evidence belongs in `40 Product Ops / Polish`.
- Do not start broad `App.jsx`, `main.js`, or session-discovery extraction from a branch older than PR #40.

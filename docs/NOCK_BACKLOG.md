# Nock Backlog Reconciliation

Updated: 2026-05-24

This document reconciles the live NockCC queue with the current `origin/main` state for Nock Terminal. It exists because the remediation work moved quickly enough that the labels drifted: some Nocks are truly done, one important Nock was marked done even though the merged PR did different work, and several older roadmap rows now need narrower wording.

## Current Baseline

- Repo baseline: `origin/main` at merge commit `1ba415f` after PRs #31, #32, and #37.
- NockCC live update: message `#1436` sent to `mira-nockos` when Nock `7532` closed and Nock `7533` started.
- Project board: Nocks `7530`, `7531`, `7532`, and `7533` are attached to the Terminal project.
- Primary local checkout note: `/Users/kevin/Dev/nock-terminal` had unrelated dirty work and was behind `origin/main` during this pass, so implementation and audit work used clean worktrees.

## Reconciled Nocks

| Nock | Live state | Project lane | Repo status | Decision |
| --- | --- | --- | --- | --- |
| `831` | Done | `20 Dispatch Ready` | PR #27 merged | Keep as completed dispatch-agent support record. |
| `7530` | Done | `40 Product Ops / Polish` | PR #31 merged: `9eb0558` | Correctly closed Phase A: UI/settings truth cleanup. |
| `7531` | Done | `40 Product Ops / Polish` | PR #32 merged: `e970df0` | Correctly closed Phase B: Electron IPC and secret hardening. |
| `7532` | Done | `10 Active Foundation` | PR #37 merged: `1ba415f` | True Phase C is complete: bounded tree traversal, large-file preview behavior, and editor stale-cache refresh. |
| `7533` | In progress | `30 Roadmap` | Branch `codex/n7533-integration-audit` | Post-A/B/C integration audit is active. See `docs/POST_ABC_INTEGRATION_AUDIT.md`. |
| `886` | Backlog | `30 Roadmap` | Still valid | Marketing/GTM positioning is useful, but should use this ledger and current release docs. |
| `123` | Backlog | `30 Roadmap` | Partially stale | App icons and signing config have moved forward; rewrite this around signed artifact smoke, actual certificates, update channel, crash/error reporting, and support path. |
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

1. **Finish Nock `7533`.**
   Complete the post-A/B/C report, record closed and remaining risks, and make a current go/no-go recommendation for the next wave.

2. **Create or assign the next-wave Nocks from `7533`.**
   Recommended sequence: Phase E and Phase G can run in parallel; Phase F waits for E/G contracts; Phase H can start as docs/checklist work before packaged smoke automation.

3. **Rewrite or replace Nock `123`.**
   It still points at app icon/code-signing work as if none of it happened. The remaining work is signed installer smoke on macOS/Windows/Linux release artifacts, actual credential setup, update-channel decision, crash/error reporting, and support path.

4. **Keep Nock `886` as product/GTM work.**
   It should be informed by current truth: Claude transcript discovery is real, Codex/Gemini launch profiles exist, Codex/DeepSeek dispatch exists, Linux unpacked packaged smoke exists, and full Codex/Gemini transcript discovery, attach/reconnect, signed installer smoke, update distribution, crash reporting, worktree lanes, and replay remain roadmap.

## Notes For Future Agents

- When closing a Nock, set the live Nock `repo`, `branch`, `pr_number`, and `pr_url` fields.
- If a PR title references a Nock but the implementation does not satisfy that Nock's acceptance criteria, leave the Nock open and add an audit note.
- Keep Terminal project placement current. Active implementation belongs in `10 Active Foundation`; future planning belongs in `30 Roadmap`; completed hardening evidence belongs in `40 Product Ops / Polish`.
- Do not start broad `App.jsx`, `main.js`, or session-discovery extraction before `7532` and `7533` are complete.

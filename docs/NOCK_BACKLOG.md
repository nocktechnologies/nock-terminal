# Nock Backlog Reconciliation

Updated: 2026-05-24

This document reconciles the live NockCC queue with the current `origin/main` state for Nock Terminal. It exists because the remediation work moved quickly enough that the labels drifted: some Nocks are truly done, one important Nock was marked done even though the merged PR did different work, and several older roadmap rows now need narrower wording.

## Current Baseline

- Repo baseline: `origin/main` at merge commit `4360bfc` after PRs #31-#35.
- NockCC live update: message `#1426` sent to `mira-nockos`.
- Project board: Nocks `7530`, `7531`, `7532`, and `7533` are attached to the Terminal project.
- Primary local checkout note: `/Users/kevin/Dev/nock-terminal` had unrelated dirty work and was behind `origin/main` during this pass, so reconciliation work used `/Users/kevin/Dev/nock-terminal-nox-backlog`.

## Reconciled Nocks

| Nock | Live state | Project lane | Repo status | Decision |
| --- | --- | --- | --- | --- |
| `831` | Done | `20 Dispatch Ready` | PR #27 merged | Keep as completed dispatch-agent support record. |
| `7530` | Done | `40 Product Ops / Polish` | PR #31 merged: `9eb0558` | Correctly closed Phase A: UI/settings truth cleanup. |
| `7531` | Done | `40 Product Ops / Polish` | PR #32 merged: `e970df0` | Correctly closed Phase B: Electron IPC and secret hardening. |
| `7532` | Backlog | `10 Active Foundation` | No matching implementation merged | Reopened. The live Nock describes file tree/editor correctness, but PR #33 did stale contract cleanup. |
| `7533` | Backlog | `30 Roadmap` | Blocked | Keep blocked until the true `7532` file tree/editor work lands. |
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

Those acceptance criteria were not implemented by PR #33. The stale-contract cleanup was still useful, but it should be considered a separate cleanup that landed between Phase B and the true Phase C.

## Next Execution Order

1. **Run Nock `7532` next.**
   Implement bounded file-tree traversal, honest large-file handling, editor stale-cache fixes, and targeted file/editor tests.

2. **Run Nock `7533` after `7532` lands.**
   Re-audit the merged A/B/C state and decide the next wave from current code, not from the old audit text.

3. **Rewrite or replace Nock `123`.**
   It still points at app icon/code-signing work as if none of it happened. The remaining work is signed installer smoke on macOS/Windows/Linux release artifacts, actual credential setup, update-channel decision, crash/error reporting, and support path.

4. **Keep Nock `886` as product/GTM work.**
   It should be informed by current truth: Claude transcript discovery is real, Codex/Gemini launch profiles exist, Codex/DeepSeek dispatch exists, Linux unpacked packaged smoke exists, and full Codex/Gemini transcript discovery, attach/reconnect, signed installer smoke, update distribution, crash reporting, worktree lanes, and replay remain roadmap.

## Notes For Future Agents

- When closing a Nock, set the live Nock `repo`, `branch`, `pr_number`, and `pr_url` fields.
- If a PR title references a Nock but the implementation does not satisfy that Nock's acceptance criteria, leave the Nock open and add an audit note.
- Keep Terminal project placement current. Active implementation belongs in `10 Active Foundation`; future planning belongs in `30 Roadmap`; completed hardening evidence belongs in `40 Product Ops / Polish`.
- Do not start broad `App.jsx`, `main.js`, or session-discovery extraction before `7532` and `7533` are complete.

# Phase H Execution Plan

Updated: 2026-05-24

Phase F closed the `electron/main.js` IPC decomposition in PR #50. Phase H should not keep carving files just because the knife is warm. The next work is product and release truth: prove the app can be distributed, make agent state more useful, and turn dispatch/session events into operator-visible outcomes.

## Objective

Get Nock Terminal from private-alpha dogfoodable to public-beta credible without overstating the product.

Phase H is successful when:

- Release artifacts can be signed, built, installed, smoked, and rolled back with documented evidence.
- The app has a clear update, crash/error reporting, support, and beta feedback posture.
- Dispatch requests have an observable completion path instead of only "sent" or "launched" telemetry.
- Agent adapter work has a written contract for transcript discovery, resume, and attach semantics before implementation.
- Product docs and NockCC tasks tell the same story.

## Architecture Decisions

- Keep release readiness and adapter/product behavior in separate PRs. Release operations need proof and credentials; adapter behavior needs runtime contracts and UI semantics.
- Treat NockCC live messages as the coordination path for Mira and the fleet. Repo docs are durable memory; live NockCC is execution state.
- Do not add broad "agent abstraction" code until one runtime-specific path is proven end to end.
- Prefer evidence led release gates. If a smoke step is manual, say it is manual and record the operator, artifact, OS, and result.

## Task List

### H0: Phase H Plan And Release Nock Rewrite

**Description:** Create this execution plan, update roadmap/backlog docs, and rewrite stale Nock #123 around current release-readiness gaps.

**Acceptance criteria:**
- `docs/PHASE_H_EXECUTION_PLAN.md` exists with ordered tasks, dependencies, acceptance criteria, and verification.
- `docs/ROADMAP.md`, `docs/NOCK_BACKLOG.md`, and `docs/RELEASE_READINESS.md` reference Phase H accurately.
- Nock #123 is rewritten in live NockCC as the distribution readiness task, not the old icon/signing placeholder.
- Mira receives a live NockCC update with the branch and current scope.

**Verification:**
- `git diff --check`
- `npm test`

**Dependencies:** Phase F complete through PR #50.

**Files likely touched:**
- `docs/PHASE_H_EXECUTION_PLAN.md`
- `docs/ROADMAP.md`
- `docs/NOCK_BACKLOG.md`
- `docs/RELEASE_READINESS.md`

**Estimated scope:** Small, docs and NockCC coordination.

### H1: Signed Artifact Smoke Evidence

**Description:** Turn Nock #123 into a release proof pass. Generate or collect signed macOS, Windows, Linux AppImage, and Linux deb artifacts, then record target-OS smoke results.

**Acceptance criteria:**
- macOS DMG is signed and notarized, and `spctl --assess --type execute --verbose /Applications/Nock\ Terminal.app` passes on a clean machine.
- Windows installer uses the expected publisher certificate and has a recorded SmartScreen result on a clean Windows machine or VM.
- Linux AppImage launches and deb installs cleanly on a clean Linux machine or VM.
- Results include artifact name, checksum, OS version, machine/VM, operator, date, and pass/fail notes.
- Repo docs distinguish automated CI smoke from signed artifact smoke.

**Verification:**
- `npm run release:check`
- `npm run smoke:package`
- Release workflow run on a test tag, or documented local artifact build commands when secrets are not yet installed.
- Manual signed artifact checklist in `docs/RELEASE_READINESS.md`.

**Dependencies:** H0.

**Files likely touched:**
- `docs/RELEASE_READINESS.md`
- `docs/NOCK_BACKLOG.md`
- `.github/workflows/release.yml` if evidence upload or checklist automation is added.

**Estimated scope:** Medium, release operations plus docs.

### H2: Update, Crash, Support, And Beta Feedback Decisions

**Description:** Record product and operations decisions for update distribution, crash/error reporting, support path, and beta feedback before public beta.

**Acceptance criteria:**
- Update-channel decision is documented: none/manual/GitHub Releases/auto-update, with rationale and rollback impact.
- Crash/error reporting decision is documented with privacy posture, data captured, opt-in/opt-out behavior, and owner.
- Support path is documented with expected response route, escalation owner, and public beta wording.
- Beta feedback channel is documented and linked from release docs.

**Verification:**
- Docs review by Kevin/Mira.
- No runtime code claims are made unless implemented and tested.

**Dependencies:** H0.

**Files likely touched:**
- `docs/RELEASE_READINESS.md`
- `docs/PRODUCT_AUDIT_GTM_READINESS.md`
- `docs/ROADMAP.md`

**Estimated scope:** Small to medium, decision record.

### H3: Dispatch Completion Tracking Contract

**Description:** Define how a brokered or direct dispatch request becomes `sent`, `accepted`, `running`, `blocked`, `completed`, or `failed` in the cockpit.

**Acceptance criteria:**
- A dispatch run has a stable request id that can correlate Nock Terminal local telemetry with NockCC/Mira responses.
- The NockCC response source is chosen and documented: live AgentMessages keyed by `request_id`, initially consumed through bounded polling unless a push API is available.
- UI state names and failure modes are documented before implementation.
- Privacy and retention behavior for dispatch run history is documented.

**Verification:**
- Contract doc review.
- No runtime code changes in this slice.

**Dependencies:** H0.

**Files likely touched:**
- `docs/AGENT_DISPATCH.md`
- `docs/PHASE_H_EXECUTION_PLAN.md`

**Estimated scope:** Small to medium, documentation and interface design only.

### H4: Dispatch Completion Tracking Implementation

**Description:** Implement the smallest end-to-end completion signal path chosen in H3.

**H4a local foundation:** Land the pure renderer-side dispatch run reducer, storage normalizer, retention cap, and compatibility cleanup first. This lets Nock safely read historical local dispatch telemetry and gives the future live polling/subscription work one tested status contract. H4a does not claim completion-thread tracking until NockCC exposes a confirmed live-message read or subscription API; attempted GET reads against `/api/teams/messages/` currently return `405 Method Not Allowed`.

**Acceptance criteria:**
- Brokered dispatch runs move beyond `sent` when the chosen NockCC/Mira response source emits a correlated status.
- Failed or blocked completion states are visible in the dashboard operations panel.
- Existing local-storage dispatch run history migrates or remains compatible.
- Missing NockCC config fails softly and does not block direct dispatch.

**H4a acceptance criteria:**
- Dispatch-run status values and allowed transitions from H3 are implemented in one shared renderer utility.
- Local history reads defensively from `nock-terminal.dispatchRuns.v1`, normalizes old records, drops task bodies, and caps to 12 visible runs.
- App dispatch recording uses the shared normalizer instead of hand-rolled local-storage JSON.
- Existing dashboard dispatch chips render normalized non-success states without implying every non-failed run is complete.
- Focused reducer/storage tests cover transition rules, privacy, retention, and malformed storage.

**Verification:**
- Focused reducer/parser tests.
- IPC or service tests if the main process polls/subscribes to NockCC.
- `npm test`
- Manual brokered dispatch smoke with a known test agent when credentials are available.

**H4a verification:**
- `node --test test/dispatch-runs.test.mjs`
- `npm test`
- `npx vite build`

**Dependencies:** H3.

**Files likely touched:**
- `electron/agent-dispatch.js`
- `electron/dispatch-ipc.js`
- `src/App.jsx`
- `src/components/Dashboard.jsx`
- `test/agent-dispatch.test.cjs`
- `test/dispatch-ipc.test.cjs`

**Estimated scope:** Medium to large.

### H5: Agent Transcript And Resume Contract

**Description:** Write the adapter contract for transcript discovery, resume, and attach across Claude Code, Codex CLI, Gemini CLI, and local agent folders.

**Acceptance criteria:**
- Contract separates transcript discovery, live attach, resume command, and folder launch.
- Claude Code current behavior is documented as the baseline.
- Codex and Gemini are explicitly marked as future implementation until real filesystem/runtime evidence is added.
- Local agent folder attach semantics distinguish tmux attach, process presence, and file-bus state.

**Verification:**
- Contract review.
- No UI claim changes unless backed by implementation.

**Dependencies:** H0.

**Files likely touched:**
- `docs/AGENT_FOLDER_INTELLIGENCE.md`
- `docs/ROADMAP.md`
- `ARCHITECTURE.md`
- possibly `electron/agent-adapters.js` if adding typed metadata only.

**Estimated scope:** Small to medium.

### H6: First Resume/Attach Implementation Slice

**Description:** Implement one proven attach/resume path end to end, ideally the one with the most reliable local evidence.

**Acceptance criteria:**
- A discovered session exposes a safe attach/resume action only when the adapter can prove the command target.
- The command launcher and dashboard do not imply attach support for runtimes that only support folder launch.
- Tests cover adapter capability detection and launch command resolution.

**Verification:**
- Focused adapter tests.
- `npm test`
- Manual launch/attach smoke on the chosen runtime.

**Dependencies:** H5.

**Files likely touched:**
- `electron/agent-adapters.js`
- `electron/session-discovery.js`
- `src/utils/agentLaunchers.mjs`
- `src/components/CommandPalette.jsx`
- relevant tests.

**Estimated scope:** Medium.

## Parallelization

Safe to parallelize after H0:

- H1 release artifact smoke and H3 dispatch completion contract can run independently.
- H2 release decisions can run alongside H5 adapter contract if owners are clear.

Must be sequential:

- H4 depends on H3.
- H6 depends on H5.
- Public beta readiness depends on H1 and H2.

## Phase H Checkpoints

### Checkpoint 1: Execution Ready

- H0 merged.
- Nock #123 rewritten and attached to the Terminal roadmap lane.
- Follow-up Nocks exist for H1, H2, H3/H4, and H5/H6.

### Checkpoint 2: Release Proof

- H1 and H2 complete.
- Release readiness docs include signed artifact smoke evidence and decisions.
- Public beta remains blocked only by product/demo choices, not unknown distribution risk.

### Checkpoint 3: Product Truth

- H3/H4 and H5/H6 have either landed or been explicitly deferred.
- UI copy and docs do not overclaim attach, transcript discovery, or completion tracking.

## Open Questions

- What update distribution posture does Kevin want for public beta: manual GitHub Releases first, or auto-update from day one?
- Should crash/error reporting be fully opt-in for private alpha, or disabled until public beta?
- Which NockCC API surface should Nock Terminal use for dispatch completion tracking?
- Which runtime is the first attach/resume implementation target after Claude Code baseline behavior?

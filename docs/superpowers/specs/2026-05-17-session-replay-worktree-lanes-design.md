# Session Replay, Worktree Lanes, Dispatch Tracking, And Handoff Composer Design

Date: 2026-05-17
Status: Approved direction, ready for implementation planning
Repo: nock-terminal

## Summary

Nock Terminal has reached a useful private-alpha cockpit state: it discovers repos and agent folders, searches them from the launcher, stages tasks into terminal agents, and routes Codex/DeepSeek dispatch agents through Mira or direct CRM scripts.

The next product layer should make agent work durable and reviewable. The approved four-part direction is:

1. Session replay
2. Worktree lanes
3. Dispatch run completion tracking
4. One-click handoff and PR composer

The product promise becomes: run terminal-native agents locally, keep every attempt visible, and never lose the thread.

## Goals

- Capture enough session context to understand what happened after an agent run ends.
- Show parallel work clearly by task, branch, worktree, agent, output, git state, and test state.
- Close the loop for brokered and direct dispatch agents so they do not disappear after request submission.
- Generate useful handoff artifacts from captured state: summary, changed files, tests, risk notes, and PR-ready copy.
- Preserve the local-first trust model. Captured replay data stays local unless the operator explicitly exports or sends it.

## Non-Goals

- Replace GitHub, Git clients, or a full IDE.
- Build a cloud agent runner.
- Auto-merge code without human review.
- Claim full Codex/Gemini transcript discovery until adapters exist.
- Build team analytics before individual replay and lane workflows are reliable.

## Product Model

### Replay

A replay is the durable record of one terminal or dispatch run. It extends the current `SessionHistory` metadata and output capture.

Minimum replay fields:

- `id`
- `tabId`
- `sessionId`
- `projectName`
- `projectPath`
- `agentName`
- `agentRuntime`
- `agentMode`: `terminal`, `dispatch-brokered`, or `dispatch-direct`
- `taskText`
- `startTime`
- `endTime`
- `exitCode`
- `cwd`
- `branch`
- `worktreePath`
- `launchCommand`
- `outputPath`
- `outputCaptured`
- `outputTruncated`
- `gitSummary`
- `testSummary`
- `dispatchRequest`
- `handoff`

The replay should support two states:

- `active`: tab or dispatch request is still running or unresolved.
- `closed`: run ended, failed, or was manually marked complete.

### Lane

A lane is the cockpit view for one attempt at a task. It may be backed by a normal repo branch, a git worktree, a dispatch request, or an existing agent folder.

Minimum lane fields:

- `id`
- `taskId`
- `label`
- `projectPath`
- `worktreePath`
- `branch`
- `baseBranch`
- `agentName`
- `agentRuntime`
- `status`: `queued`, `running`, `needs-review`, `failed`, `completed`, `archived`
- `replayId`
- `dispatchRunId`
- `changedFiles`
- `testState`
- `lastOutputAt`
- `lastOutputPreview`
- `prUrl`
- `createdAt`
- `updatedAt`

Lanes should be derived where possible, not manually duplicated. A terminal tab with a replay, a dispatch request, and a git branch can all become lane signals.

### Dispatch Run

The current renderer stores recent dispatch runs in local storage. This should become a small persisted dispatch-run registry in the main process so direct and brokered routes share one lifecycle.

Minimum dispatch fields:

- `id`
- `requestId`
- `messageId`
- `agentName`
- `runtime`
- `mode`
- `broker`
- `targetRepo`
- `projectName`
- `status`
- `payloadFile`
- `command`
- `createdAt`
- `updatedAt`
- `lastCheckedAt`
- `error`
- `replayId`

Allowed dispatch statuses:

- `queued`
- `sent`
- `launched`
- `running`
- `needs-review`
- `failed`
- `completed`
- `unknown`

Brokered dispatch completion tracking should prefer NockCC or Mira state when available. Direct dispatch completion tracking can initially rely on terminal exit and replay metadata.

### Handoff

A handoff is a generated review artifact attached to a replay or lane.

Minimum handoff fields:

- `summary`
- `changedFiles`
- `testCommands`
- `testResults`
- `risks`
- `followUps`
- `prBody`
- `generatedAt`
- `sourceReplayId`

The first implementation can generate a structured Markdown draft locally from replay metadata, captured output excerpts, git status, and test markers. It should not call an external model by default.

## User Experience

### Dashboard

Add a "Lanes" band below the existing operations panel and above the agent/repo card grid.

Each lane row or compact card should show:

- Agent/runtime
- Project or worktree
- Branch
- Status
- Changed-file count
- Test state
- Last output time
- Actions: open terminal/replay, view diff, compose handoff, archive

The dashboard should remain dense and calm. Lanes should feel like an operator board, not a marketing card grid.

### Sidebar

Upgrade the existing Session History panel into "Replay" behavior without removing its compact utility.

List entries should show:

- Project/session name
- Agent/runtime
- Duration
- Exit or active status
- Output captured indicator
- Handoff indicator

The detail view should add tabs or sections for:

- Output
- Summary
- Git
- Tests
- Handoff

### Command Launcher

Task staging should optionally create a lane when launching an agent or dispatching a task.

The default path:

1. User picks repo/agent.
2. User writes task.
3. Nock launches terminal or sends dispatch.
4. Nock creates replay and lane metadata.
5. Dashboard shows the lane immediately.

Worktree creation should be explicit, not automatic by default in the first implementation. A later mode can offer "Run in new worktree" once the basic lane lifecycle is stable.

### Dispatch Agents

For Codex and DeepSeek dispatch agents:

- Clicking the agent still opens task staging.
- Sending brokered or direct dispatch creates a dispatch run and lane.
- The operations panel shows recent dispatch statuses.
- The lane tracks whether the request is sent, running, failed, completed, or needs review.

If Nock cannot determine completion, it should say `unknown` or `needs review`, not pretend success.

### Handoff Composer

From a replay or lane, the user can open a composer that shows a generated Markdown draft.

Draft sections:

- Summary
- What changed
- Tests run
- Risks and review notes
- Follow-ups

Actions:

- Copy Markdown
- Save handoff to replay
- Export Markdown
- Use as PR body later

## Architecture

### Main Process

Extend the current `electron/session-history.js` instead of replacing it.

New responsibilities:

- Store replay metadata as versioned JSON.
- Store output paths and truncation state.
- Update active replay metadata before and after terminal exit.
- Generate local git summaries using safe read-only git commands.
- Store handoff Markdown drafts next to replay metadata.
- Expose replay CRUD through preload IPC.

Add a small `electron/lane-registry.js` or equivalent service.

Responsibilities:

- Persist lane records in the app data directory.
- Upsert lanes when terminal agents launch, dispatch requests are sent, or replays end.
- Refresh lane git/test signals on demand.
- Archive lanes without deleting user worktrees.

Add a small `electron/dispatch-runs.js` or equivalent service.

Responsibilities:

- Move dispatch run storage out of renderer local storage.
- Upsert brokered/direct dispatch status.
- Link dispatch runs to replay and lane ids.
- Provide a single list/detail API for renderer panels.

### Renderer

Introduce focused UI components:

- `LaneBoard`
- `LaneCard` or compact row
- `ReplayDetail`
- `HandoffComposer`
- `DispatchRunStatus`

Keep the first version integrated with existing surfaces:

- `Dashboard` renders lane board.
- `Sidebar` continues to render replay/history.
- `CommandPalette` passes task text and route metadata into launch calls.
- `App` owns refresh cadence and IPC calls until a dedicated state hook is justified.

### Data Flow

Terminal launch flow:

1. `CommandPalette` or dashboard starts a terminal agent task.
2. `App` creates a tab and calls `sessionHistory.start`.
3. Main process creates replay metadata.
4. Main process or renderer upserts a lane linked to replay id.
5. Terminal output appends to replay output when capture is enabled.
6. On terminal exit, replay closes, git/test summaries refresh, lane status changes.

Brokered dispatch flow:

1. User sends brokered dispatch to Mira.
2. Main process stores dispatch run with status `sent`.
3. Lane is created with status `queued` or `sent`.
4. Nock polls or refreshes broker state when an API exists; until then it stays `sent` or user marks needs review/completed.
5. Replay is attached if a terminal exists; otherwise dispatch run remains the durable record.

Direct dispatch flow:

1. User chooses direct dispatch.
2. Main process creates payload and dispatch run.
3. App opens terminal with resolved alias/script command.
4. Replay and lane are linked to the direct dispatch run.
5. Terminal exit updates replay and dispatch status.

Handoff flow:

1. User opens composer from replay/lane.
2. Main process gathers replay metadata, output excerpt, git summary, and test summary.
3. Renderer shows generated Markdown draft.
4. User edits, copies, exports, or saves the handoff.

## Persistence

Use the existing app data directory pattern:

- `~/nock-terminal/sessions/` for replay metadata and output.
- `~/nock-terminal/lanes/` for lane records.
- `~/nock-terminal/dispatch-runs/` for dispatch records.

The first version can use JSON files with pruning, mirroring the existing session-history approach. If query needs grow, migrate to a small embedded database later.

Version every persisted record with `schemaVersion`.

## Git And Test Signals

Git summaries should be read-only and bounded:

- branch
- base branch when available
- dirty file count
- changed files list capped at a safe limit
- diff stat
- latest commit hash

Test summaries should start conservative:

- Detect explicit test commands launched through Nock task metadata when available.
- Parse common terminal output markers only as hints, not proof.
- Allow manual status correction in the UI.

## Privacy And Safety

- Do not capture terminal output unless the user has enabled auto-capture or explicitly saves a replay.
- Clearly mark when output is not captured.
- Redact common secret patterns before generating handoff drafts.
- Keep payload files and replay files local.
- Never run destructive git cleanup automatically.
- Archive lanes as metadata first; worktree deletion must require explicit user action.

## Testing Plan

Unit tests:

- Replay metadata creation, update, close, pruning, and output truncation.
- Lane upsert, status transitions, archive, and read models.
- Dispatch run persistence and status mapping.
- Handoff Markdown generation from fixture replay/git/test data.
- Secret redaction.

Renderer tests:

- Lane board renders empty, active, failed, needs-review, and completed states.
- Replay detail handles no-output, captured-output, and truncated-output states.
- Handoff composer copies and saves draft content.
- Dispatch task staging creates the expected lane/run metadata calls.

Manual smoke:

- Launch a Claude agent with task staging and confirm a replay/lane appears.
- Launch a direct Ash dispatch and confirm lane links to terminal replay.
- Send a brokered Smith dispatch and confirm dispatch run appears with honest status.
- End a terminal session and confirm output, git summary, and handoff draft are available.

## Implementation Phases

### Phase 1: Replay Registry

- Extend `SessionHistory` into versioned replay metadata.
- Capture task, agent, runtime, cwd, branch, and launch route metadata.
- Add replay list/detail IPC.
- Upgrade the sidebar detail view.

### Phase 2: Lane Board

- Add lane registry persistence.
- Create lanes from launched terminal tasks and dispatch requests.
- Render lane board on the dashboard.
- Add archive and open actions.

### Phase 3: Dispatch Completion Tracking

- Move dispatch runs to main-process persistence.
- Link dispatch runs to lanes and replays.
- Add status refresh hooks.
- Support manual status updates for unknown brokered completion.

### Phase 4: Handoff Composer

- Generate local Markdown drafts from replay, git, test, and dispatch state.
- Add copy/export/save actions.
- Attach saved handoff state to replay and lane detail.

## Open Decisions For Implementation Planning

- Whether replay capture remains opt-in by default or task-staging sessions should prompt to save replay at the end.
- Whether lane records should be created for every terminal tab or only task-staged/dispatch sessions.
- How much brokered dispatch completion state Mira/NockCC can expose immediately.
- Whether worktree creation belongs in Phase 2 or should wait for a dedicated Phase 5 after lane display is stable.

## Success Criteria

- A user can launch or dispatch an agent task and immediately see a lane representing the attempt.
- A completed terminal task produces a replay with metadata and optional output.
- Dispatch requests remain visible after submission and show honest status.
- A user can generate a useful handoff draft from a replay or lane.
- The app remains local-first, dense, and calm.


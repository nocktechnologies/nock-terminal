# Code Audit — nock-terminal

**Date:** 2026-05-24
**Reviewer:** Senior-engineer pass focused on "vibe coding" tech debt
**Scope:** `electron/`, `src/`, with spot-checks across tests and utils
**Bottom line:** Healthy bones, accumulating fat. ~350 lines of safely deletable code, one god component, and a handful of small bugs that aren't biting yet but will.

## Progress (this session)

**Done:**
- §2.1 Claude chat client deleted (~265 lines across 5 files)
- §1.2 `destroy()` race fixed via `_destroyIntents` stash — deterministic `reason: 'destroyed'` regardless of whether `onExit` fires sync or async (+ regression test)
- §1.3 `terminal:write` per-id FIFO queue — overlapping large writes no longer interleave chunks (+ regression test)
- §1.1 `_decodeDirName` rewritten — slices explicitly at first `--` so multi-dash Windows paths don't get clobbered (+ 4 regression tests, 3 Windows-gated)
- §1.6 Stale reaper boot race fixed — renderer passes `RENDERER_STARTED_AT`, reaper preserves PTYs created after renderer mount (+ regression test)
- §2.4 `_metadataFromProcess` dead branch deleted
- §2.8 `nockccActivity` init collapsed to one line
- §1.7 `window-all-closed` — **CORRECTION**: previous finding was wrong. The empty handler is *load-bearing* on Electron: subscribing (even with no body) overrides the default-quit-on-all-closed behavior, which is exactly what a tray app wants. Comment updated to make the intent clear; handler kept.

**Test impact:** 59 → 66 (63 passing on darwin, 3 Windows-gated). Zero regressions.

**June 12 Wave 2 hardening update:**
- §1.5 env-var deny-list closed in PR #65. Terminal environment injection now rejects loader and shell-hook variables before process launch.
- §1.9 discovery/shell fallback logging closed in PR #72. `session-discovery` no longer has bare `catch {}` blocks; fallback failures log path/context behind `NOCK_DEBUG_DISCOVERY=1`.
- Dispatch validation helper dedupe is ready in PR #71 and green, but intentionally left open pending explicit merge approval. The PR body records the one sanitizer API difference found during the dedupe pass.
- A fresh esbuild audit advisory hit the release gate during Wave 2. PR #72 included the minimal lockfile bump from esbuild `0.28.0` to `0.28.1`; `package.json` already allowed that patch version.

**Still on the roadmap:** §4.5 dedupe agent context groups via IPC, §4.2 `settings:set` dispatch map, §3.1 extract hooks from `App.jsx` (the big one), §1.4 stop appending to closed-tab session history.

---

## Severity Verdict

**Overall: 6/10 ("Needs a focused cleanup week, not a rewrite")**

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 7/10 | Works in the happy path. A handful of latent bugs (§1.1, §1.2, §1.6). |
| Architecture | 5/10 | Layering is sane, but `App.jsx` is a god component and source-of-truth is duplicated. |
| Maintainability | 4/10 | A new hire will spend 2-3 days orienting before they can ship. |
| Security | 7/10 | Settings are user-local, so the env-var injection (§1.5) is low-blast. No glaring web vulns. |
| Test coverage | 7/10 | Decent — `test/` has 14 files for the core surfaces. |
| Dead code | 4/10 | Whole subsystem (Claude chat backend) is wired but never called. |

**Not on fire. Worth one focused engineer-week before you hire/onboard anyone new.**

---

## 1. The Breakpoints — Broken or Fragile Logic

### 1.1 `_decodeDirName` silently corrupts Windows paths with multiple `--` markers
**File:** `electron/session-discovery.js:849`

```js
decoded = decoded.replace('--', ':\\');   // replaces FIRST occurrence only
decoded = decoded.replace(/-/g, '\\');
```

`String.replace(str, str)` is single-occurrence. Also strips legitimate dashes from folder names like `nock-terminal` → `nock\terminal`. The JSONL-based `_cwdFromTranscripts` is the safety net, but for fresh projects with no transcripts this is what runs.

**Fix:** see §4.7.

### 1.2 `destroy()` double-fires the exit event
**File:** `electron/terminal-manager.js:120` → `_finalizeTerminal` (line 222)

`destroy()` calls `term.kill()` (triggers node-pty `onExit` → `_finalizeTerminal`) **and** calls `_finalizeTerminal` directly. The guard at line 225 makes the second a no-op, but `reason` becomes timing-dependent: sometimes `'destroyed'`, sometimes `'process-exit'`. Any downstream telemetry on `reason` is non-deterministic.

**Fix:** see §4.3.

### 1.3 `terminal:write` chunker has no backpressure or ordering guarantees
**File:** `electron/terminal-manager.js:82-106`

For payloads > 512 bytes, chunks are written via `setTimeout(writeChunk, 1)`. A second large write arriving before the first drains will **interleave chunks**. Nothing serializes per-id. Rare for typed input, real for paste/scripted input.

**Fix:** Per-id write queue (linked list of pending chunks; drain in FIFO).

### 1.4 `sessionHistory.appendOutput` keeps writing to closed-but-unreaped tabs
**File:** `electron/main.js:674-680`

The `data` listener unconditionally appends to session history. Daemons that keep writing after the renderer closes the tab (but before `destroy()` lands) bloat disk unboundedly.

**Fix:** Wrap in `if (terminalManager.terminals.has(id))` or have `sessionHistory.endSession` flip a per-tab flag.

### 1.5 `_parseEnvVars` accepts any value content
**File:** `electron/terminal-manager.js:358-375`

Key is regex-validated; value is not. A user (or a poisoned local `config.json`) can set `LD_PRELOAD`, `PYTHONSTARTUP`, `NODE_OPTIONS`, etc. Low blast radius (local settings), but it's a settings-as-code surface you didn't intend to ship.

**Fix:** Deny-list known dangerous vars (`LD_*`, `DYLD_*`, `NODE_OPTIONS`, `PYTHONSTARTUP`) or require user confirmation on first use.

### 1.6 Stale terminal reaper races startup
**Files:** `src/App.jsx:213-225`, `electron/terminal-manager.js:150`

On boot, the reaper runs 2s after mount with `liveTerminalIds` derived from `tabs` (empty on cold start). Anything in `terminalManager.terminals` older than `graceMs` (5s) gets killed. On slow machines where app init + first paint > 5s, you can kill PTYs the user *just* opened. There's no "renderer hasn't reported yet" sentinel.

**Fix:** Don't run the reaper until the renderer has explicitly called `terminal:list` at least once, OR until the renderer signals "ready."

### 1.7 `window-all-closed` handler is a comment, not code
**File:** `electron/main.js:746-751`

```js
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On Windows, hide to tray instead of quitting
  }
});
```

Empty body. Current behavior does NOT match the stated intent. Either implement tray-hide or delete the handler.

**Fix:** see §4.6.

### 1.8 Triple belt-and-suspenders for initial window show
**File:** `electron/main.js:142-153`

`showInitialWindow` wired to `ready-to-show`, `did-finish-load` (+100ms), and a 2500ms wall-clock fallback. `initialShowDone` flag is the only thing keeping it from firing twice. If the page crashes pre-paint, you eventually show a broken window with no log.

**Fix:** Pick one event, log loudly if it doesn't fire within 5s.

### 1.9 Silent error swallowing in shell detection
**File:** `electron/main.js:357, 362, 379, 390`

```js
try { canonical = fs.realpathSync(shellPath); } catch { return; }
```

No logging anywhere. When users report "my shell isn't listed," you have nothing.

**Fix:** Gate behind `NOCK_DEBUG_DISCOVERY` (already used in `session-discovery.js`) and log to `console.warn` when a shell candidate fails detection.

---

## 2. The Cemetery — Dead & Redundant Code

### 2.1 The entire Claude Code chat backend is dead — 250+ lines
- **File:** `electron/claude-code-client.js` (215 lines) — delete entirely
- **Wiring:** `electron/main.js:7, 47, 250, 333-339, 537-539`
- **Preload:** `electron/preload.js:60-62`
- **Settings:** `claudeCodePath` in `DEFAULT_SETTINGS` + Settings.jsx field

`window.nockTerminal.ai.claude.chat` is exposed and has a backend handler. **No file in `src/` calls it.** The `Kit (Claude)` tab in `App.jsx:480-509` just shells out to the `claude` binary; it doesn't touch this client.

### 2.2 Two parallel agent-context source-of-truths
- `electron/agent-adapters.js:1-49` defines `AGENT_ADAPTERS` with context groups, exports `getAgentContextGroups()`.
- `src/utils/agentContext.mjs:1-22` hardcodes the same data as `AGENT_CONTEXT_GROUPS`.

Add Gemini support to one and forget the other — guaranteed drift.

**Fix:** see §4.5.

### 2.3 Exported utility functions with no external consumers
**File:** `src/utils/sessionSearch.mjs`
- `normalizeSessionSearchQuery` — only used inside this module
- `matchesSessionSearch` — only used inside this module

Inline them or stop exporting.

### 2.4 `_metadataFromProcess` exists for a defensive caller that can't fire
**File:** `electron/terminal-manager.js:207-220`

Only called from `reapStaleTerminals` line 163 when metadata is missing. Metadata is always set in `create()` and only deleted in `_finalizeTerminal` (which also removes the terminal). Anything in `this.terminals` therefore has metadata. Dead defensive code.

### 2.5 `repairStoredSettings` is startup busy-work
**File:** `electron/main.js:31-40`

JSON-stringifies each setting to compare against its sanitized version before conditionally writing back. The sanitizer is deterministic and cheap; just write the sanitized object wholesale. See §4.x cleanup.

### 2.6 Custom shell-args parser when `shell-quote` exists
**File:** `electron/terminal-manager.js:308-356`

50 lines of bespoke quoting/escaping. `shell-quote` is 8KB, maintained, has the tests this code doesn't.

**Fix:** see §4.1.

### 2.7 Mixed `.js`/`.mjs`/`.cjs` with no convention
- `electron/*.js` — CommonJS
- `src/utils/*.mjs` — ES modules
- `src/utils/themes.js` — ES module with `.js` extension
- `test/*.test.cjs` and `test/*.test.mjs` — both used

Pick a convention. Recommend: keep electron CJS `.js` (node-pty constraint), make all `src/utils/*` use `.js` (Vite handles ESM transparently), and align test extensions to the layer they test.

### 2.8 `nockccActivity` init block is redundant
**File:** `electron/main.js:59-63`

Initial value is the same as the zero-state any first heartbeat would send anyway.

---

## 3. The Tangle — Complexity & Readability

### 3.1 `App.jsx` is a 1040-line god component
14 useState, ~10 useCallback/useMemo, ~10 useEffect. Concerns crammed in:
- Tabs CRUD + rename + pin + duplicate + reorder
- Splits (terminal/editor)
- Session discovery & polling
- Profile loading
- Ollama health polling
- Dispatch run history (in localStorage)
- 100-line keyboard shortcut if-chain
- Notice toast
- Stale terminal reaping
- NockCC activity heartbeat aggregation
- Editor unsaved-file tracking

**Fix:** Extract `useTabs`, `useSessions`, `useStaleTerminalReaper`, `useKeyboardShortcuts`, `useDispatchRuns`, `useNockccHeartbeat`. Target: `App.jsx` becomes ~200 lines of composition root.

### 3.2 `launchSessionWithAgent` — 130 lines, three flows in one function
**File:** `src/App.jsx:328-457`

Direct dispatch, brokered dispatch, terminal launch — three flows duct-taped with early returns. Tab-construction logic duplicated three times.

**Fix:** Split into `launchDirectDispatch`, `launchBrokeredDispatch`, `launchTerminalAgent`, with a thin dispatcher. Extract `createTabFromLaunch(session, launch, initialInput)`.

### 3.3 Keyboard handler runs every if-block on every keystroke
**File:** `src/App.jsx:691-789`

Thirteen un-broken `if` statements, no `else`, no early return. The `useEffect` re-binds whenever `tabs`/`activeTabId` changes.

**Fix:** Bind once with a ref holding latest state. Switch on `e.key` with early-return per match.

### 3.4 `settings:set` is an if-chain pretending to be a switch
**File:** `electron/main.js:524-559`

Six branches on `key`. Convert to dispatch map (§4.2).

### 3.5 `_agentAliases` hardcodes business logic in discovery
**File:** `electron/session-discovery.js:601-603`

```js
if (aliases.has('mira')) aliases.add('mara-nockos');
if (aliases.has('mara')) aliases.add('mara-chat');
```

A generic scanner shouldn't know about specific agent personas. Move the aliases to each agent's `config.json` (`aliases: [...]` field).

### 3.6 `resolveSessionLaunch` returns a discriminated union without saying so
**File:** `src/utils/agentLaunchers.mjs:69-132`

Dispatch return: ~14 fields. Terminal return: ~10. Five shared. Document the shape per `mode` or split into two functions and let callers compose.

### 3.7 `_agentFolderPriority` magic-number ranking
**File:** `electron/session-discovery.js:235-248`

`+1000`, `+100`, `+50`, `+25`, `Math.max(0, 24 - hours)` — what does any of it mean? Replace with a tuple-sort or a named priority array with comments.

### 3.8 `Settings.jsx` is 905 lines
Almost certainly one giant form with N sections inlined. Split into one component per section.

---

## 4. The Simplifier — Refactoring Blueprint

### 4.1 Replace bespoke shell-arg parser

```js
const { parse: parseShell } = require('shell-quote');

_parseShellArgs(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1000) return [];
  return parseShell(value)
    .filter(token => typeof token === 'string')   // drops operators like `;` `|`
    .slice(0, 50);
}
```

### 4.2 Replace `settings:set` if-chain with a dispatch map

```js
const SETTING_EFFECTS = {
  ollamaUrl:        (v) => ollamaClient.setUrl(v),
  // claudeCodePath: deleted with §2.1
  devRoots:         () => syncDiscoveryConfig(),
  projectSkipList:  () => syncDiscoveryConfig(),
  alwaysOnTop:      (v) => mainWindow?.setAlwaysOnTop(!!v),
  windowOpacity:    (v) => mainWindow?.setOpacity(clampOpacity(v)),
  launchAtStartup:  (v) => app.setLoginItemSettings({ openAtLogin: !!v }),
};

function syncDiscoveryConfig() {
  const { devRoots, projectSkipList } = getSettingsSnapshot();
  sessionDiscovery.setConfig({ devRoots, skipList: projectSkipList });
  fileWatcher.revalidate();
}

const clampOpacity = (v) => Math.max(0.7, Math.min(1.0, v / 100));

ipcMain.on('settings:set', (_, { key, value } = {}) => {
  if (typeof key !== 'string') return;
  const normalized = normalizeSettingValue(key, value);
  if (!normalized.ok) return;
  store.set(key, normalized.value);
  SETTING_EFFECTS[key]?.(getSettingsSnapshot()[key]);
});
```

### 4.3 Collapse `destroy()` to single source of truth

```js
destroy(id) {
  const term = this.terminals.get(id);
  if (!term) return;
  this._destroyReason.set(id, 'destroyed');
  try { term.kill(); } catch {}
  // onExit (registered in create) handles cleanup + emission
}

// In create(), augment onExit:
ptyProcess.onExit(({ exitCode }) => {
  const reason = this._destroyReason.get(id) || 'process-exit';
  this._destroyReason.delete(id);
  this._finalizeTerminal(id, exitCode, { reason });
});
```

Single emission, deterministic `reason`.

### 4.4 Extract `useTabs` from App.jsx

```js
// src/hooks/useTabs.js
export function useTabs() {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  const open = useCallback((tab) => {
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const close = useCallback((tabId) => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId);
      setActiveTabId(curr => curr === tabId ? (remaining.at(-1)?.id ?? null) : curr);
      return remaining;
    });
  }, []);

  const update = useCallback((tabId, patch) =>
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t)),
  []);

  const reorder = useCallback((dragId, targetId) => {
    setTabs(prev => {
      const arr = [...prev];
      const from = arr.findIndex(t => t.id === dragId);
      const to   = arr.findIndex(t => t.id === targetId);
      if (from < 0 || to < 0) return prev;
      arr.splice(to, 0, ...arr.splice(from, 1));
      return arr;
    });
  }, []);

  return { tabs, activeTabId, setActiveTabId, open, close, update, reorder };
}
```

### 4.5 Deduplicate agent context groups via IPC

Delete `src/utils/agentContext.mjs`. Add:

```js
// electron/main.js
ipcMain.handle('agents:contextGroups', () => getAgentContextGroups());

// electron/preload.js
agents: { contextGroups: () => ipcRenderer.invoke('agents:contextGroups') },

// src/components/ContextMonitor.jsx
const [groups, setGroups] = useState([]);
useEffect(() => {
  window.nockTerminal.agents.contextGroups().then(setGroups);
}, []);
```

### 4.6 Replace empty `window-all-closed` handler

If the intent is "hide to tray on Windows/Linux":

```js
app.on('window-all-closed', (event) => {
  if (process.platform === 'darwin') return;   // mac convention
  if (app.isQuitting) return;                   // user actually quit
  event.preventDefault();                       // stay alive in tray
});
```

If the intent is "just don't quit on macOS" (Electron default), **delete the handler entirely** — the current empty body doesn't override anything. **Verify current behavior on Windows before choosing.**

### 4.7 Fix `_decodeDirName` for Windows multi-dash

```js
_decodeDirName(name) {
  if (process.platform === 'win32') {
    const stripped = name.replace(/^-/, '');
    const driveSep = stripped.indexOf('--');
    if (driveSep < 0) return stripped.replace(/-/g, '\\');
    const drive = stripped.slice(0, driveSep);
    const rest  = stripped.slice(driveSep + 2).replace(/-/g, '\\');
    return `${drive}:\\${rest}`;
  }
  return '/' + name.replace(/-/g, '/').replace(/^\/+/, '');
}
```

Better: when transcripts are absent, label paths in the UI as "decoded (unverified)" rather than silently presenting them as authoritative.

---

## Deletion Summary

| What | Section | Lines |
|---|---|---|
| `electron/claude-code-client.js` + all wiring | §2.1 | ~250 |
| `src/utils/agentContext.mjs` (replaced by IPC) | §2.2 / §4.5 | 23 |
| `_metadataFromProcess` + defensive reap branch | §2.4 | ~20 |
| Bespoke `_parseShellArgs` body | §2.6 / §4.1 | ~45 |
| Empty `window-all-closed` handler or body | §1.7 / §4.6 | 6 |
| Triple show-window wiring → one event | §1.8 | ~10 |
| **Total safely deletable** | | **~350+** |

---

## Recommended Sequence (One Engineer-Week)

**Day 1 — Delete:**
- Rip out the Claude chat client (§2.1) — biggest visible win, zero risk.
- Delete `agentContext.mjs` and wire IPC (§4.5).
- Fix `window-all-closed` (§4.6) after verifying current behavior.

**Day 2 — Fix bugs:**
- `_decodeDirName` (§4.7).
- `destroy()` race (§4.3).
- Stale reaper startup race (§1.6).
- Add `terminal:write` per-id queue (§1.3).

**Day 3-4 — Extract hooks from App.jsx:**
- `useTabs` (§4.4)
- `useSessions`
- `useKeyboardShortcuts`
- `useStaleTerminalReaper`
- `useDispatchRuns`
- `useNockccHeartbeat`
- Target: `App.jsx` < 250 lines.

**Day 5 — Polish:**
- `settings:set` dispatch map (§4.2).
- Replace `_parseShellArgs` with `shell-quote` (§4.1).
- Split `Settings.jsx` per section.
- Move agent aliases out of discovery (§3.5).
- Add shell/discovery fallback logging behind `NOCK_DEBUG_DISCOVERY` (§1.9). **Done via PR #72.**

After this week, the codebase is in good shape for handoff or growth. Skip it and the next person onboarding spends those days deleting your code before they can add theirs.

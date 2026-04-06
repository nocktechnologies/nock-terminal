# Nock Terminal Windows — Phase 2: Product Features Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Scope:** Phase 2a — Bug fix, File Tree, Monaco Editor, Split Terminal, Port Monitor, Context Monitor, Session Status, Keyboard Shortcuts, Settings

## Overview

Phase 2 transforms Nock Terminal from a terminal wrapper into a development environment. The core addition is an in-tab split system where the right pane can be either a code editor (Monaco) or a second terminal, contextually linked to the session on the left.

Phase 2b (Todos, Notifications) is deferred to a follow-up spec.

## Architecture: Component-Layer

Add features as isolated components with a thin coordination layer in `App.jsx`. No state machine library, no micro-module directories — the app is still small enough that flat components in `src/components/` and services in `electron/` is the right level of structure.

### New Files

**Electron services:**
- `electron/file-watcher.js` — chokidar tree watcher + git status poller
- `electron/file-service.js` — file read/write with path validation
- `electron/process-detector.js` — PowerShell CIM child-process walker

**React components:**
- `src/components/SplitPane.jsx` — reusable resizable split container
- `src/components/EditorPane.jsx` — Monaco editor wrapper (lazy-loaded)
- `src/components/FileTree.jsx` — project file tree with git status
- `src/components/ContextMonitor.jsx` — CLAUDE.md / config status display
- `src/components/ActionToolbar.jsx` — button bar for split/panel actions

**Modified files:**
- `electron/main.js` — new IPC handlers for files, process detection
- `electron/preload.js` — new API namespaces (files, process)
- `src/App.jsx` — keep-mounted terminals, split state management, new shortcuts
- `src/components/TerminalView.jsx` — accept visibility prop, remove mount/unmount PTY lifecycle
- `src/components/Sidebar.jsx` — add FileTree and ContextMonitor sections
- `src/components/TabBar.jsx` — status dots from process detector
- `src/components/Settings.jsx` — new config sections

### New Dependencies

- `monaco-editor` — code editor (bundled locally, lazy-loaded)
- `chokidar` — file system watcher for tree updates

---

## 1. Session Persistence Fix (Critical Bug)

**Problem:** Navigating to dashboard unmounts the terminal area, destroying all PTY processes. Sessions die when the user clicks away.

**Root cause:** `App.jsx` conditionally renders `<Dashboard />` vs the terminal area based on `view` state. When view changes, React unmounts the terminal components, which triggers PTY cleanup in `TerminalView.jsx`.

**Fix:** Render ALL views simultaneously. Control visibility with CSS `display: none`, never with conditional mounting.

```jsx
// App.jsx structure after fix
<div style={{ display: view === 'dashboard' ? 'block' : 'none' }}>
  <Dashboard />
</div>
<div style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
  <ActionToolbar />
  <TabBar />
  {tabs.map(tab => (
    <div key={tab.id} style={{ display: tab.id === activeTabId ? 'flex' : 'none', flex: 1 }}>
      <SplitPane>
        <TerminalView tabId={tab.id} />
        {tab.splitContent && <tab.splitContent.component />}
      </SplitPane>
    </div>
  ))}
</div>
<div style={{ display: view === 'settings' ? 'block' : 'none' }}>
  <Settings />
</div>
```

**Validation:** Open 3 terminals, run long processes, switch to dashboard, switch back — all 3 sessions must be exactly where they were. Scrollback preserved, processes running.

---

## 2. SplitPane Component

Reusable container that divides its area into two resizable sections.

**Props:**
- `direction`: `'horizontal'` (side-by-side, default) or `'vertical'` (top/bottom)
- `defaultRatio`: initial split ratio (default 0.5)
- `minSize`: minimum pane size in pixels (default 200)
- `onRatioChange`: callback when user drags divider
- `rightPane`: React node for the right/bottom pane (null = no split, full width)

**Behavior:**
- Draggable divider with visible grip handle (7px wide hit target, 3px visible line)
- Mouse drag on divider recalculates ratio from container width
- Min/max constraints prevent collapsing either pane below `minSize`
- Split ratio persisted per-tab in `App.jsx` state (survives tab switching)
- When `rightPane` is null, left pane takes full width (no divider rendered)

**Usage patterns:**
- File click → `rightPane = <EditorPane file={path} />`
- Ctrl+Shift+D → `rightPane = <TerminalView tabId={splitId} />`
- Close split → `rightPane = null`, terminal goes full width

---

## 3. File Tree

### Electron Service — `file-watcher.js`

**Responsibilities:**
- Maintain a chokidar watcher on the active project directory
- On tab focus change, stop old watcher, start new one for the new project root
- Watch events: `add`, `unlink`, `addDir`, `unlinkDir` → push `files:changed` IPC event to renderer
- chokidar `ignored` option filters: `node_modules`, `.git`, `__pycache__`, `dist`, `build`, `*.pyc`
- Also respect `.gitignore` patterns (chokidar supports this via `ignored` callback + parsing `.gitignore`)
- Every 10 seconds, run `git status --porcelain` on the project root → push `files:gitStatus` IPC event with `{ relativePath: statusCode }` map
- Status codes: `M` = modified (orange), `A`/`?` = added/untracked (green), `D` = deleted (red)

### React Component — `FileTree.jsx`

**Location:** Left sidebar, top section (above Sessions and Ports).

**Features:**
- Recursive tree renderer: folders expand/collapse with ▾/▸ indicators
- Expand/collapse state tracked in local component state
- Git status dots: colored 6px circles next to filenames
  - Green = added/new
  - Orange = modified
  - Red = deleted
  - Gray = untracked
- Single-click a file → opens editor split in active tab
- Right-click context menu:
  - Open (same as click — editor split)
  - Open in External Editor (IPC → `shell.openPath`)
  - Copy Path (IPC → clipboard)
  - Reveal in Explorer (IPC → `shell.showItemInFolder`)
- Filter/search bar at top: text input that filters visible tree nodes by substring match against filename
- Ctrl+P focuses the filter bar from anywhere
- Tree root follows active tab's project directory — switching tabs triggers new tree load

**IPC APIs (added to preload.js):**
```
window.nockTerminal.files.tree(dirPath)         → [{ name, path, type: 'file'|'dir', children? }]
window.nockTerminal.files.gitStatus(dirPath)     → { 'src/App.jsx': 'M', 'src/New.jsx': '?' }
window.nockTerminal.files.onChanged(callback)    → cleanup fn
window.nockTerminal.files.onGitStatus(callback)  → cleanup fn
```

---

## 4. Monaco Editor

### React Component — `EditorPane.jsx`

**Lazy loading:**
- `monaco-editor` imported via dynamic `import()` on first file open
- While loading, show a skeleton placeholder in the pane
- Once loaded, Monaco instance is cached — subsequent file opens are instant

**Configuration:**
- Theme: custom pitch-black theme registered with Monaco
  - Background: `#0D0D12`, foreground: `#E8E8F0`
  - Keywords: `#C370FF`, strings: `#00D670`, functions: `#5B9FFF`, comments: `#757585`
- Font: JetBrains Mono (configurable in Settings)
- Minimap: off by default (tight space in split view), toggleable in Settings
- Line numbers: on
- Word wrap: off by default, toggleable in Settings

**Language support:**
Ship grammars for: JavaScript, TypeScript, JSX, TSX, Go, Python, Rust, JSON, YAML, TOML, Markdown, HTML, CSS, Shell/Bash. Language auto-detected from file extension.

**Multiple editor tabs:**
- Tab bar at top of editor pane (within the split, not the main tab bar)
- Clicking a second file opens it as a new editor tab, not replacing the first
- Modified indicator (orange dot) on unsaved tabs
- Ctrl+W closes the active editor tab; if last tab, closes the split

**Read-only mode:**
- Files >1MB open in read-only mode
- Warning banner at top: "This file is too large to edit (read-only)"
- Binary files rejected entirely with error message

**Keyboard shortcuts (within editor focus):**
- Ctrl+S → save to disk via IPC `files:write`, clear modified indicator
- Ctrl+G → go to line (Monaco built-in)
- Ctrl+F → find (Monaco built-in)
- Ctrl+H → find/replace (Monaco built-in)

### Electron Service — `file-service.js`

**Methods:**
- `read(filePath)` → `{ content: string, size: number, readOnly: boolean }`
  - Size check: >1MB sets `readOnly: true`
  - Binary detection: check first 8KB for null bytes, reject if binary
  - Path validation: file must be within a registered project root (prevent directory traversal)
- `write(filePath, content)` → `{ success: boolean }`
  - Atomic write: write to `{filePath}.tmp`, then rename
  - Path validation: same as read

**IPC APIs:**
```
window.nockTerminal.files.read(filePath)           → { content, size, readOnly }
window.nockTerminal.files.write(filePath, content)  → { success }
```

---

## 5. Port Monitor (Enhanced)

Build on existing `port-scanner.js`.

**Enhancements:**
- After `netstat -ano` parse, run `tasklist /FI "PID eq {pid}" /FO CSV /NH` for each listening PID to get process name
- Display per port row: port number, process name (e.g., "node.exe"), custom label if configured
- Match ports to terminal sessions by PID ancestry (port's PID is descendant of a terminal's PTY PID)
- Manual refresh button in sidebar section header
- Keep existing 30s auto-poll

**No new IPC needed** — enrich existing `ports:scan` response with `processName` field.

---

## 6. Context Monitor

New section at bottom of left sidebar.

**Shows for the active tab's project directory:**
- CLAUDE.md: exists checkmark/x, file size, last modified (relative time, e.g., "12 min ago")
- .nock/config.toml: same treatment
- "Edit" button next to each — triggers file tree → editor flow (opens file in editor split)

**Implementation:**
- New IPC: `files:stat(filePath)` → `{ exists, size, mtime }`
- Called on tab switch + every 30s (piggyback on existing polling timer)
- Tiny stateless component: `ContextMonitor.jsx`

---

## 7. Session Status Indicators

### Electron Service — `process-detector.js`

**Detection method:** PowerShell `Get-CimInstance Win32_Process`

**Flow (every 2 seconds):**
1. For each active terminal, get PTY PID from `terminal-manager.js`
2. Run PowerShell command to get all processes, filter child tree by walking `ParentProcessId`
3. Search child tree for `claude.exe`, `claude.cmd`, or `node.exe` (Claude's subprocess)
4. Push result via IPC: `process:status` → `{ tabId, hasClaude: boolean }`

**Renderer-side status logic:**
- Track `lastDataTimestamp` per terminal (updated on every `terminal:onData` callback)
- Combine with process detection result:
  - **Red** = `hasClaude: false` — no Claude process in child tree
  - **Yellow** = `hasClaude: true` AND `Date.now() - lastDataTimestamp < 2000` — actively generating
  - **Green** = `hasClaude: true` AND `Date.now() - lastDataTimestamp >= 2000` — waiting for input

**Display locations:**
- Tab bar: colored dot before tab title
- Session list in sidebar: colored dot before session name
- Dashboard project cards: colored dot on card header

**IPC API:**
```
window.nockTerminal.process.onStatus(callback) → cleanup fn
```

---

## 8. Action Toolbar

### React Component — `ActionToolbar.jsx`

Horizontal button bar positioned between the tab strip and the terminal/split area.

**Buttons:**

| Button | Label | Shortcut | Action |
|--------|-------|----------|--------|
| ⊞ | Split | Ctrl+Shift+D | Toggle terminal split on active tab |
| ◧ | Sidebar | Ctrl+B | Toggle left sidebar visibility |
| 💬 | Chat | Ctrl+Shift+A | Toggle AI chat panel |
| ⊟ | Dash | Ctrl+D | Switch to dashboard view |

**Style:** Small pill-shaped buttons, `#1A1A22` background, `#2A2A35` border, `#A0A0B0` text. Hover: border lightens. Active state (e.g., sidebar is open): subtle gradient background matching accent colors.

**Tooltip:** Each button shows tooltip on hover with action name + shortcut.

### Full Keyboard Shortcut Map

| Binding | Action |
|---------|--------|
| Ctrl+` | Toggle terminal focus |
| Ctrl+B | Toggle sidebar |
| Ctrl+D | Dashboard view |
| Ctrl+P | Quick file finder (focus filter bar) |
| Ctrl+T | New terminal tab |
| Ctrl+N | New terminal tab (alias) |
| Ctrl+W | Close current editor tab (if editor focused), or close terminal split (if split terminal focused). If last editor tab, closes the split. Never closes the primary terminal. |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+1-9 | Switch to tab by number |
| Ctrl+Shift+A | Toggle AI chat panel |
| Ctrl+Shift+D | Split terminal |
| Ctrl+S | Save file (when editor focused) |
| Ctrl+G | Go to line (when editor focused) |
| Ctrl+F | Find in editor (when editor focused) |
| Ctrl+H | Find/replace (when editor focused) |
| F11 | Toggle fullscreen |

Registered in `App.jsx` via `useEffect` keydown listener, consistent with Phase 1 pattern.

---

## 9. Settings Improvements

Add to existing `Settings.jsx` sections:

**Terminal:**
- Font family dropdown (detect installed monospace fonts: JetBrains Mono, Consolas, Cascadia Code, Courier New)
- Font size slider (existing)

**Editor:**
- Font family dropdown (same font list)
- Font size (separate from terminal)
- Minimap toggle (default off)
- Word wrap toggle (default off)

**File Tree:**
- Default open/closed on app launch
- Show/hide dotfiles toggle

**Theme:**
- Pitch black is default and only shipped theme
- Structure settings for future theme additions (theme selector dropdown, currently single option)

All persisted via existing `electron-store`.

---

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  NOCK TERMINAL                           ● 2 ACTIVE   18:30 │
├────────┬────────────────────────────────────────┬────────────┤
│ FILES  │ Tab: nocklock·main ● │ nock-cc·dev │ + │  AI Chat   │
│ ▾ src/ │ [⊞ Split] [◧ Side] [💬 Chat] [⊟ Dash] │            │
│   App  ├─────────────────────┬──────────────────│  [G3·12B]  │
│   Term●│                     │ SplitPane.jsx ●  │  [G4]      │
│   Side │ $ nocklock wrap --  │ 1 import React   │  [KIT]     │
│   Tab  │ NockLock v0.1.0    │ 2                 │  [MARA]    │
│ ▸ elec/│ > █                │ 3 export default  │            │
│        │                     │ 4   function...   │  Ready ●   │
│ SESSNS │                     │                   │            │
│ ● nock │                     │ JS JSX  Ln 7 UTF8 │  [input]   │
│ ● cc   ├─────────────────���───┴──────────────────│  [SEND]    │
│ PORTS  │                                         │            │
│ :3000  │                                         │            │
│ CONTEXT│                                         │            │
│ CLAUDE✓│                                         │            │
└────────┴─────────────────────────────────────────┴────────────┘
```

---

## Design System

All new components use the existing pitch-black palette:
- Background: `#0A0A0F`, Elevated: `#111116`, Cards: `#1A1A22`
- Borders: `#2A2A35`, Text: `#E8E8F0`, Dim: `#A0A0B0`, Muted: `#757585`
- Accent gradient: `#3B6FD4` → `#7C5CFC`
- Status: Green `#00D670`, Yellow `#FFA500`, Red `#FF6B6B`, Cyan `#5FFFFF`
- Font: JetBrains Mono (terminal + editor), DM Sans (UI labels)
- All panels collapsible — sidebar, chat, splits all toggleable

---

## Testing Checklist

1. Open 3 terminals, switch to dashboard, switch back — all sessions alive with scrollback
2. Click file in tree → editor opens in split next to terminal
3. Edit file, Ctrl+S, verify changes on disk
4. Open multiple files in editor tabs, close one, close all (split closes)
5. Ctrl+Shift+D splits terminal, both panes functional, drag divider to resize
6. Verify file tree shows git status dots (modify a file, check dot appears within 10s)
7. Verify file tree updates when files created/deleted on disk
8. Ctrl+P focuses file filter, type partial name, tree filters
9. Right-click file → Copy Path, Reveal in Explorer both work
10. Port monitor shows process names alongside port numbers
11. Context monitor shows CLAUDE.md status, "Edit" button opens it in editor
12. Session status dots: red when no Claude, yellow when generating, green when idle
13. All toolbar buttons work and match their keyboard shortcuts
14. All keyboard shortcuts registered and functional
15. Settings: change editor font, toggle minimap — changes apply immediately

---

## What's NOT in This Spec

- Todo/Task panel — Phase 2b
- Notification/Alert panel — Phase 2b
- NockCC deep integration (pipeline data, fence events) — Phase 3
- Git operations from UI (pull, push, branch switch) — Phase 3
- Plugin system — Phase 4
- Multi-user/team features — Phase 4

---

## Commit Convention

`feat: Phase 2 — file tree, editor, port monitor, split terminal, session persistence`

## PR Title

`Phase 2: Product Features — File Tree, Editor, Port Monitor, Split Terminal`

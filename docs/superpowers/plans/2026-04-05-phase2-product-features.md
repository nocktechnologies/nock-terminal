# Phase 2: Product Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Nock Terminal from a terminal wrapper into a development environment with file tree, Monaco editor, split panes, port monitor, context monitor, session status detection, and action toolbar.

**Architecture:** Component-layer — isolated React components in `src/components/` and Electron services in `electron/`, coordinated through `App.jsx` state and IPC bridge. No state machine library. SplitPane is the shared primitive for editor and terminal splits.

**Tech Stack:** Electron 28, React 18, Vite 5, xterm.js 5, Monaco Editor, chokidar, node-pty, Tailwind CSS 3, electron-store

**Spec:** `docs/superpowers/specs/2026-04-05-phase2-product-features-design.md`

**Codebase:** `C:\Dev\nock-command-center\terminal-electron`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `electron/file-watcher.js` | chokidar tree watcher + `git status --porcelain` poller (10s) |
| `electron/file-service.js` | File read/write with path validation, binary detection, atomic writes |
| `electron/process-detector.js` | PowerShell `Get-CimInstance Win32_Process` child-tree walker (2s poll) |
| `src/components/SplitPane.jsx` | Reusable resizable split container (horizontal/vertical, draggable divider) |
| `src/components/EditorPane.jsx` | Monaco editor wrapper — lazy-loaded, multi-tab, pitch-black theme |
| `src/components/FileTree.jsx` | Recursive file tree with git status dots, filter bar, context menu |
| `src/components/ContextMonitor.jsx` | CLAUDE.md / .nock/config.toml status display |
| `src/components/ActionToolbar.jsx` | Button bar: Split, Sidebar, Chat, Dashboard |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | Add `monaco-editor`, `chokidar` dependencies |
| `electron/main.js` | Add IPC handlers for files, process detection; init new services |
| `electron/preload.js` | Add `files` and `process` API namespaces |
| `electron/port-scanner.js` | Add process name resolution via `tasklist` |
| `src/App.jsx` | Keep-mounted views, split state per tab, new keyboard shortcuts |
| `src/components/TerminalView.jsx` | Remove PTY destroy on unmount (moved to explicit close) |
| `src/components/Sidebar.jsx` | Add FileTree and ContextMonitor sections |
| `src/components/TabBar.jsx` | Add status dots from process detector |
| `src/components/Settings.jsx` | Add terminal font family, editor settings, file tree settings |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install monaco-editor and chokidar**

```bash
cd C:\Dev\nock-command-center\terminal-electron
npm install monaco-editor chokidar
```

Expected: Both packages added to `dependencies` in package.json. No errors.

- [ ] **Step 2: Verify install**

```bash
cd C:\Dev\nock-command-center\terminal-electron
node -e "require('chokidar'); console.log('chokidar OK')"
node -e "require('monaco-editor/esm/vs/editor/editor.api'); console.log('monaco OK')"
```

Expected: Both print OK without errors.

- [ ] **Step 3: Configure Vite for Monaco Editor workers**

Monaco needs web workers for syntax highlighting. Add the Monaco Vite plugin. First install it:

```bash
cd C:\Dev\nock-command-center\terminal-electron
npm install -D vite-plugin-monaco-editor
```

Then modify `vite.config.js` to add the plugin. Read the current file first, then add:

```js
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
```

And add to the plugins array:

```js
monacoEditorPlugin({
  languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
}),
```

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add package.json package-lock.json vite.config.js
git commit -m "chore: add monaco-editor, chokidar, vite-plugin-monaco-editor"
```

---

## Task 2: Session Persistence Fix (Critical Bug)

**Files:**
- Modify: `src/App.jsx`

This is the most important task. Currently, switching to dashboard unmounts all terminal components, killing PTY processes.

- [ ] **Step 1: Refactor App.jsx to keep-mounted views**

Replace the conditional rendering in `src/App.jsx`. Change the main content area (lines 163-208) from conditional rendering to always-rendered with CSS visibility.

Replace this block in `src/App.jsx`:

```jsx
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {view === 'dashboard' && (
            <Dashboard
              sessions={sessions}
              onSessionClick={openTerminalTab}
              onNewTerminal={openNewTab}
              onRefresh={refreshSessions}
            />
          )}

          {view === 'terminal' && (
            <>
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={(id) => setActiveTabId(id)}
                onTabClose={closeTab}
                onNewTab={openNewTab}
              />
              <div className="flex-1 overflow-hidden relative">
                {tabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`absolute inset-0 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
                  >
                    <TerminalView
                      tabId={tab.id}
                      cwd={tab.cwd}
                      active={tab.id === activeTabId}
                    />
                  </div>
                ))}
                {tabs.length === 0 && (
                  <div className="flex items-center justify-center h-full text-nock-text-dim">
                    <div className="text-center">
                      <p className="text-lg mb-2">No terminal tabs open</p>
                      <p className="text-sm">Press <kbd className="px-2 py-1 bg-nock-card border border-nock-border rounded text-xs font-mono">Ctrl+T</kbd> to open a new tab</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'settings' && <Settings />}
        </div>
```

With this:

```jsx
        {/* Main content — all views always mounted, visibility controlled by CSS */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Dashboard */}
          <div className={`absolute inset-0 ${view === 'dashboard' ? 'flex flex-col' : 'hidden'}`}>
            <Dashboard
              sessions={sessions}
              onSessionClick={openTerminalTab}
              onNewTerminal={openNewTab}
              onRefresh={refreshSessions}
            />
          </div>

          {/* Terminal area — always rendered so PTYs stay alive */}
          <div className={`absolute inset-0 flex flex-col ${view === 'terminal' ? '' : 'hidden'}`}>
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabClick={(id) => setActiveTabId(id)}
              onTabClose={closeTab}
              onNewTab={openNewTab}
            />
            <div className="flex-1 overflow-hidden relative">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`absolute inset-0 ${tab.id === activeTabId ? 'flex' : 'hidden'}`}
                >
                  <TerminalView
                    tabId={tab.id}
                    cwd={tab.cwd}
                    active={tab.id === activeTabId && view === 'terminal'}
                  />
                </div>
              ))}
              {tabs.length === 0 && view === 'terminal' && (
                <div className="flex items-center justify-center h-full text-nock-text-dim">
                  <div className="text-center">
                    <p className="text-lg mb-2">No terminal tabs open</p>
                    <p className="text-sm">Press <kbd className="px-2 py-1 bg-nock-card border border-nock-border rounded text-xs font-mono">Ctrl+T</kbd> to open a new tab</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Settings */}
          <div className={`absolute inset-0 overflow-y-auto ${view === 'settings' ? '' : 'hidden'}`}>
            <Settings />
          </div>
        </div>
```

Key changes:
1. All three views rendered inside `absolute inset-0` containers
2. `hidden` class toggles visibility instead of conditional mount/unmount
3. Terminal `active` prop now checks BOTH `activeTabId` match AND `view === 'terminal'` (so terminal doesn't steal focus when on dashboard)

- [ ] **Step 2: Verify the fix**

```bash
cd C:\Dev\nock-command-center\terminal-electron
npm run dev
```

Manual test:
1. Open the app, create a terminal tab
2. Type something in the terminal (e.g., `echo hello`)
3. Click Dashboard in the sidebar
4. Click Terminal in the sidebar
5. Verify the terminal still shows `echo hello` output and the process is alive
6. Open 2 more tabs, switch between dashboard/terminal/settings — all 3 sessions survive

- [ ] **Step 3: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/App.jsx
git commit -m "fix: keep terminal sessions alive across view switches

Render all views simultaneously with CSS visibility instead of
conditional mounting. PTY processes no longer die when navigating
to dashboard or settings."
```

---

## Task 3: SplitPane Component

**Files:**
- Create: `src/components/SplitPane.jsx`

- [ ] **Step 1: Create SplitPane.jsx**

Create `src/components/SplitPane.jsx`:

```jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';

export default function SplitPane({
  children,
  rightPane = null,
  direction = 'horizontal',
  defaultRatio = 0.5,
  minSize = 200,
  onRatioChange,
}) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newRatio;
      if (direction === 'horizontal') {
        newRatio = (e.clientX - rect.left) / rect.width;
      } else {
        newRatio = (e.clientY - rect.top) / rect.height;
      }
      // Enforce minSize constraints
      const containerSize = direction === 'horizontal' ? rect.width : rect.height;
      const minRatio = minSize / containerSize;
      const maxRatio = 1 - minRatio;
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
      setRatio(newRatio);
      onRatioChange?.(newRatio);
    };

    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, minSize, onRatioChange]);

  // Update ratio when defaultRatio changes (e.g., restoring from saved state)
  useEffect(() => {
    setRatio(defaultRatio);
  }, [defaultRatio]);

  // No split — render children full width
  if (!rightPane) {
    return (
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {children}
      </div>
    );
  }

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`flex-1 flex overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      {/* Left / Top pane */}
      <div
        style={{ [isHorizontal ? 'width' : 'height']: `${ratio * 100}%` }}
        className="overflow-hidden relative"
      >
        {children}
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={handleMouseDown}
        className={`shrink-0 relative group ${
          isHorizontal
            ? 'w-[3px] cursor-col-resize hover:w-[5px]'
            : 'h-[3px] cursor-row-resize hover:h-[5px]'
        } bg-nock-border transition-all`}
      >
        {/* Grip handle */}
        <div
          className={`absolute bg-nock-border-bright rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${
            isHorizontal
              ? 'left-[-2px] top-1/2 -translate-y-1/2 w-[7px] h-6'
              : 'top-[-2px] left-1/2 -translate-x-1/2 h-[7px] w-6'
          }`}
        />
      </div>

      {/* Right / Bottom pane */}
      <div
        style={{ [isHorizontal ? 'width' : 'height']: `${(1 - ratio) * 100}%` }}
        className="overflow-hidden relative"
      >
        {rightPane}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

In the dev app (`npm run dev`), temporarily test by importing SplitPane in App.jsx and wrapping a TerminalView:

```jsx
<SplitPane rightPane={<div className="bg-nock-card p-4 text-nock-text text-sm">Split pane test</div>}>
  <TerminalView ... />
</SplitPane>
```

Verify: two panes appear side-by-side, divider is draggable, panes resize. Then revert the test code.

- [ ] **Step 3: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/SplitPane.jsx
git commit -m "feat: add SplitPane reusable split container component"
```

---

## Task 4: Integrate SplitPane into App.jsx Tab State

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add split state to tab model**

In `src/App.jsx`, update the tab model to include split state. In the `openTerminalTab` function, add `splitRatio` and `splitContent` to the tab object:

Change the `newTab` in `openTerminalTab` (around line 57-66):

```jsx
    const newTab = {
      id: tabId,
      sessionId: session.id,
      title: session.name,
      branch: session.branch,
      status: session.status,
      cwd: session.path,
      splitContent: null,   // null = no split, { type: 'editor', files: [...] } or { type: 'terminal', id: '...' }
      splitRatio: 0.5,
    };
```

Do the same for `openNewTab` (around line 73-83):

```jsx
    const newTab = {
      id: tabId,
      sessionId: null,
      title: 'Terminal',
      branch: null,
      status: 'active',
      cwd: cwd || 'C:\\Users\\kkwil',
      splitContent: null,
      splitRatio: 0.5,
    };
```

- [ ] **Step 2: Add split management functions**

Add these functions in `src/App.jsx` after `closeTab`:

```jsx
  // Open a file in the editor split for the active tab
  const openFileInEditor = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const existingFiles = tab.splitContent?.type === 'editor' ? tab.splitContent.files : [];
      // Don't add duplicate
      if (existingFiles.includes(filePath)) {
        return {
          ...tab,
          splitContent: { type: 'editor', files: existingFiles, activeFile: filePath },
        };
      }
      return {
        ...tab,
        splitContent: {
          type: 'editor',
          files: [...existingFiles, filePath],
          activeFile: filePath,
        },
      };
    }));
  }, [activeTabId]);

  // Toggle terminal split on active tab
  const toggleTerminalSplit = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      if (tab.splitContent?.type === 'terminal') {
        // Close split — destroy the split terminal
        window.nockTerminal.terminal.destroy(tab.splitContent.id);
        return { ...tab, splitContent: null };
      }
      const splitId = `${tab.id}-split-${Date.now()}`;
      return {
        ...tab,
        splitContent: { type: 'terminal', id: splitId },
      };
    }));
  }, [activeTabId]);

  // Close the split on the active tab
  const closeSplit = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      if (tab.splitContent?.type === 'terminal') {
        window.nockTerminal.terminal.destroy(tab.splitContent.id);
      }
      return { ...tab, splitContent: null };
    }));
  }, [activeTabId]);

  // Close a single editor file tab; if last file, close split
  const closeEditorFile = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId || tab.splitContent?.type !== 'editor') return tab;
      const remaining = tab.splitContent.files.filter(f => f !== filePath);
      if (remaining.length === 0) {
        return { ...tab, splitContent: null };
      }
      const activeFile = tab.splitContent.activeFile === filePath ? remaining[remaining.length - 1] : tab.splitContent.activeFile;
      return {
        ...tab,
        splitContent: { ...tab.splitContent, files: remaining, activeFile },
      };
    }));
  }, [activeTabId]);

  // Set active editor file tab
  const setActiveEditorFile = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId || tab.splitContent?.type !== 'editor') return tab;
      return {
        ...tab,
        splitContent: { ...tab.splitContent, activeFile: filePath },
      };
    }));
  }, [activeTabId]);

  // Update split ratio
  const updateSplitRatio = useCallback((ratio) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => tab.id === activeTabId ? { ...tab, splitRatio: ratio } : tab));
  }, [activeTabId]);
```

- [ ] **Step 3: Wire SplitPane into the terminal rendering**

Import SplitPane at the top of `src/App.jsx`:

```jsx
import SplitPane from './components/SplitPane';
```

Replace the terminal tab rendering block (inside the terminal area div where tabs.map is). Change:

```jsx
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`absolute inset-0 ${tab.id === activeTabId ? 'flex' : 'hidden'}`}
                >
                  <TerminalView
                    tabId={tab.id}
                    cwd={tab.cwd}
                    active={tab.id === activeTabId && view === 'terminal'}
                  />
                </div>
              ))}
```

To:

```jsx
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`absolute inset-0 ${tab.id === activeTabId ? 'flex' : 'hidden'}`}
                >
                  <SplitPane
                    defaultRatio={tab.splitRatio}
                    onRatioChange={tab.id === activeTabId ? updateSplitRatio : undefined}
                    rightPane={
                      tab.splitContent?.type === 'terminal' ? (
                        <TerminalView
                          tabId={tab.splitContent.id}
                          cwd={tab.cwd}
                          active={tab.id === activeTabId && view === 'terminal'}
                        />
                      ) : tab.splitContent?.type === 'editor' ? (
                        <div className="flex-1 bg-nock-card text-nock-text-dim flex items-center justify-center text-sm">
                          Editor placeholder — Task 8
                        </div>
                      ) : null
                    }
                  >
                    <TerminalView
                      tabId={tab.id}
                      cwd={tab.cwd}
                      active={tab.id === activeTabId && view === 'terminal'}
                    />
                  </SplitPane>
                </div>
              ))}
```

- [ ] **Step 4: Verify split works**

Run `npm run dev`. Open a terminal tab. The editor placeholder shows "Editor placeholder — Task 8" for now. We can test the terminal split by temporarily calling `toggleTerminalSplit()` from the console or wiring a temp button. Verify dragging the divider resizes both panes.

- [ ] **Step 5: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/App.jsx
git commit -m "feat: integrate SplitPane into tab model with split state management"
```

---

## Task 5: IPC Bridge — File and Process APIs

**Files:**
- Create: `electron/file-service.js`
- Create: `electron/file-watcher.js`
- Create: `electron/process-detector.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Create file-service.js**

Create `electron/file-service.js`:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class FileService {
  constructor(store) {
    this.store = store;
  }

  /**
   * Read a directory tree recursively.
   * Returns [{ name, path, type: 'file'|'dir', children? }]
   */
  tree(dirPath, depth = 0) {
    if (depth > 8) return []; // Prevent runaway recursion
    if (!this._isAllowedPath(dirPath)) return [];

    const IGNORED = new Set([
      'node_modules', '.git', '__pycache__', 'dist', 'build',
      '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage',
      '.venv', 'venv', 'env', '.env', '.DS_Store', 'Thumbs.db',
    ]);

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = [];

      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue; // Hide dotfiles except .claude

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'dir',
            children: this.tree(fullPath, depth + 1),
          });
        } else if (entry.isFile()) {
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
          });
        }
      }

      // Sort: directories first, then alphabetical
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return result;
    } catch (err) {
      console.error(`FileService.tree error for ${dirPath}:`, err.message);
      return [];
    }
  }

  /**
   * Read a file. Returns { content, size, readOnly }.
   * Files >1MB are readOnly. Binary files are rejected.
   */
  read(filePath) {
    if (!this._isAllowedPath(filePath)) {
      return { error: 'Path not allowed' };
    }

    try {
      const stat = fs.statSync(filePath);
      const size = stat.size;
      const readOnly = size > 1024 * 1024; // >1MB

      // Binary detection: check first 8KB for null bytes
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(Math.min(8192, size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);

      if (buf.includes(0)) {
        return { error: 'Binary file — cannot open in editor' };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, size, readOnly };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Write content to a file. Atomic write via tmp + rename.
   */
  write(filePath, content) {
    if (!this._isAllowedPath(filePath)) {
      return { success: false, error: 'Path not allowed' };
    }

    try {
      const tmpPath = filePath + '.nock-tmp';
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      return { success: true };
    } catch (err) {
      // Clean up tmp file on error
      try { fs.unlinkSync(filePath + '.nock-tmp'); } catch { /* ignore */ }
      return { success: false, error: err.message };
    }
  }

  /**
   * Stat a file. Returns { exists, size, mtime }.
   */
  stat(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return { exists: true, size: stat.size, mtime: stat.mtimeMs };
    } catch {
      return { exists: false, size: 0, mtime: 0 };
    }
  }

  /**
   * Get git status for a directory.
   * Returns { 'relative/path': statusCode } where statusCode is M, A, D, ?, etc.
   */
  gitStatus(dirPath) {
    try {
      const output = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });

      const status = {};
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const code = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        if (file) status[file] = code;
      }
      return status;
    } catch {
      return {};
    }
  }

  /**
   * Validate path is within a registered project root.
   */
  _isAllowedPath(filePath) {
    const resolved = path.resolve(filePath);
    const devRoots = this.store?.get('devRoots') || [];
    const homeDir = require('os').homedir();

    // Allow paths under dev roots or home directory
    const allowedRoots = [...devRoots, homeDir];
    return allowedRoots.some(root => resolved.startsWith(path.resolve(root)));
  }
}

module.exports = FileService;
```

- [ ] **Step 2: Create file-watcher.js**

Create `electron/file-watcher.js`:

```js
const chokidar = require('chokidar');
const EventEmitter = require('events');

class FileWatcher extends EventEmitter {
  constructor(fileService) {
    super();
    this.fileService = fileService;
    this.watcher = null;
    this.currentRoot = null;
    this.gitPollInterval = null;
  }

  /**
   * Watch a project directory for file changes.
   * Stops any existing watcher first.
   */
  watch(dirPath) {
    this.stop();
    this.currentRoot = dirPath;

    this.watcher = chokidar.watch(dirPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/__pycache__/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/.cache/**',
        '**/coverage/**',
      ],
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher
      .on('add', (filePath) => this.emit('changed', { type: 'add', path: filePath }))
      .on('unlink', (filePath) => this.emit('changed', { type: 'unlink', path: filePath }))
      .on('addDir', (dirPath) => this.emit('changed', { type: 'addDir', path: dirPath }))
      .on('unlinkDir', (dirPath) => this.emit('changed', { type: 'unlinkDir', path: dirPath }));

    // Poll git status every 10 seconds
    this._pollGitStatus();
    this.gitPollInterval = setInterval(() => this._pollGitStatus(), 10000);
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.gitPollInterval) {
      clearInterval(this.gitPollInterval);
      this.gitPollInterval = null;
    }
    this.currentRoot = null;
  }

  _pollGitStatus() {
    if (!this.currentRoot) return;
    const status = this.fileService.gitStatus(this.currentRoot);
    this.emit('gitStatus', status);
  }
}

module.exports = FileWatcher;
```

- [ ] **Step 3: Create process-detector.js**

Create `electron/process-detector.js`:

```js
const { execSync } = require('child_process');
const EventEmitter = require('events');

class ProcessDetector extends EventEmitter {
  constructor(terminalManager) {
    super();
    this.terminalManager = terminalManager;
    this.pollInterval = null;
  }

  start() {
    this.pollInterval = setInterval(() => this._detect(), 2000);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  _detect() {
    if (process.platform !== 'win32') {
      this._detectUnix();
      return;
    }

    try {
      // Get all processes in one call (much faster than per-PID queries)
      const output = execSync(
        'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation"',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );

      // Parse CSV: "ProcessId","ParentProcessId","Name"
      const processes = [];
      const lines = output.split('\n').slice(1); // Skip header
      for (const line of lines) {
        const match = line.match(/"(\d+)","(\d+)","([^"]*)"/);
        if (match) {
          processes.push({
            pid: parseInt(match[1]),
            ppid: parseInt(match[2]),
            name: match[3],
          });
        }
      }

      // For each terminal, walk child tree looking for claude
      for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
        const rootPid = ptyProcess.pid;
        const hasClaude = this._hasClaudeInTree(rootPid, processes);
        this.emit('status', { tabId, hasClaude });
      }
    } catch (err) {
      // Silently fail — process detection is best-effort
    }
  }

  _hasClaudeInTree(rootPid, processes) {
    const claudeNames = ['claude.exe', 'claude.cmd', 'claude'];
    const visited = new Set();
    const queue = [rootPid];

    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);

      // Check children of this PID
      for (const proc of processes) {
        if (proc.ppid === pid) {
          if (claudeNames.some(name => proc.name.toLowerCase() === name.toLowerCase())) {
            return true;
          }
          queue.push(proc.pid);
        }
      }
    }
    return false;
  }

  _detectUnix() {
    // Fallback for non-Windows: use pgrep
    for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
      try {
        const output = execSync(`pgrep -P ${ptyProcess.pid} -a 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 3000,
        });
        const hasClaude = /claude/i.test(output);
        this.emit('status', { tabId, hasClaude });
      } catch {
        this.emit('status', { tabId, hasClaude: false });
      }
    }
  }
}

module.exports = ProcessDetector;
```

- [ ] **Step 4: Register new services and IPC handlers in main.js**

In `electron/main.js`, add the imports at the top (after existing requires):

```js
const FileService = require('./file-service');
const FileWatcher = require('./file-watcher');
const ProcessDetector = require('./process-detector');
```

Add variables after the existing `let portScanner = null;`:

```js
let fileService = null;
let fileWatcher = null;
let processDetector = null;
```

In `initServices()`, add after `portScanner = new PortScanner();`:

```js
  fileService = new FileService(store);
  fileWatcher = new FileWatcher(fileService);
  processDetector = new ProcessDetector(terminalManager);
  processDetector.start();
```

In `registerIPC()`, add before the `// Shell / external` comment:

```js
  // File operations
  ipcMain.handle('files:tree', (_, dirPath) => {
    return fileService.tree(dirPath);
  });
  ipcMain.handle('files:read', (_, filePath) => {
    return fileService.read(filePath);
  });
  ipcMain.handle('files:write', (_, { filePath, content }) => {
    return fileService.write(filePath, content);
  });
  ipcMain.handle('files:stat', (_, filePath) => {
    return fileService.stat(filePath);
  });
  ipcMain.handle('files:gitStatus', (_, dirPath) => {
    return fileService.gitStatus(dirPath);
  });
  ipcMain.on('files:watch', (_, dirPath) => {
    fileWatcher.watch(dirPath);
  });
  ipcMain.on('files:stopWatch', () => {
    fileWatcher.stop();
  });
```

Add a `wireFileEvents()` function after `wireTerminalEvents()`:

```js
function wireFileEvents() {
  fileWatcher.on('changed', (event) => {
    mainWindow?.webContents.send('files:changed', event);
  });
  fileWatcher.on('gitStatus', (status) => {
    mainWindow?.webContents.send('files:gitStatus', status);
  });
  processDetector.on('status', (status) => {
    mainWindow?.webContents.send('process:status', status);
  });
}
```

Call `wireFileEvents()` in `app.whenReady().then(...)` after `wireTerminalEvents();`:

```js
  wireFileEvents();
```

In the `app.on('will-quit', ...)` handler, add cleanup:

```js
  fileWatcher?.stop();
  processDetector?.stop();
```

- [ ] **Step 5: Update preload.js with new APIs**

In `electron/preload.js`, add these namespaces inside `contextBridge.exposeInMainWorld('nockTerminal', {`, after the `clipboard` namespace:

```js
  // File operations
  files: {
    tree: (dirPath) => ipcRenderer.invoke('files:tree', dirPath),
    read: (filePath) => ipcRenderer.invoke('files:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('files:write', { filePath, content }),
    stat: (filePath) => ipcRenderer.invoke('files:stat', filePath),
    gitStatus: (dirPath) => ipcRenderer.invoke('files:gitStatus', dirPath),
    watch: (dirPath) => ipcRenderer.send('files:watch', dirPath),
    stopWatch: () => ipcRenderer.send('files:stopWatch'),
    onChanged: (callback) => {
      const handler = (_, event) => callback(event);
      ipcRenderer.on('files:changed', handler);
      return () => ipcRenderer.removeListener('files:changed', handler);
    },
    onGitStatus: (callback) => {
      const handler = (_, status) => callback(status);
      ipcRenderer.on('files:gitStatus', handler);
      return () => ipcRenderer.removeListener('files:gitStatus', handler);
    },
  },

  // Process detection
  process: {
    onStatus: (callback) => {
      const handler = (_, status) => callback(status);
      ipcRenderer.on('process:status', handler);
      return () => ipcRenderer.removeListener('process:status', handler);
    },
  },
```

- [ ] **Step 6: Verify IPC bridge works**

```bash
cd C:\Dev\nock-command-center\terminal-electron
npm run dev
```

In the Electron DevTools console, test:
```js
await window.nockTerminal.files.tree('C:\\Dev\\nock-command-center\\terminal-electron')
await window.nockTerminal.files.stat('C:\\Dev\\nock-command-center\\terminal-electron\\package.json')
await window.nockTerminal.files.gitStatus('C:\\Dev\\nock-command-center\\terminal-electron')
```

All three should return data without errors.

- [ ] **Step 7: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add electron/file-service.js electron/file-watcher.js electron/process-detector.js electron/main.js electron/preload.js
git commit -m "feat: add file service, file watcher, process detector with IPC bridge"
```

---

## Task 6: FileTree Component

**Files:**
- Create: `src/components/FileTree.jsx`

- [ ] **Step 1: Create FileTree.jsx**

Create `src/components/FileTree.jsx`:

```jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

const GIT_STATUS_COLORS = {
  M: 'bg-nock-yellow',     // Modified
  A: 'bg-nock-green',      // Added
  D: 'bg-red-400',         // Deleted
  '?': 'bg-nock-text-muted', // Untracked
  '??': 'bg-nock-text-muted',
};

export default function FileTree({ rootPath, onFileClick, onCtrlPFocus }) {
  const [tree, setTree] = useState([]);
  const [gitStatus, setGitStatus] = useState({});
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const filterRef = useRef(null);

  // Load tree
  const loadTree = useCallback(async () => {
    if (!rootPath) return;
    const result = await window.nockTerminal.files.tree(rootPath);
    setTree(result);
  }, [rootPath]);

  useEffect(() => {
    loadTree();
    // Start watching
    window.nockTerminal.files.watch(rootPath);
    const cleanupChanged = window.nockTerminal.files.onChanged(() => loadTree());
    const cleanupGit = window.nockTerminal.files.onGitStatus((status) => setGitStatus(status));

    return () => {
      cleanupChanged();
      cleanupGit();
      window.nockTerminal.files.stopWatch();
    };
  }, [rootPath, loadTree]);

  // Expose focus method for Ctrl+P
  useEffect(() => {
    if (onCtrlPFocus) {
      onCtrlPFocus(() => filterRef.current?.focus());
    }
  }, [onCtrlPFocus]);

  // Close context menu
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 120);
    setContextMenu({ x, y, node });
  };

  const filterNodes = (nodes) => {
    if (!filter) return nodes;
    const lower = filter.toLowerCase();
    return nodes.reduce((acc, node) => {
      if (node.type === 'file' && node.name.toLowerCase().includes(lower)) {
        acc.push(node);
      } else if (node.type === 'dir') {
        const filteredChildren = filterNodes(node.children || []);
        if (filteredChildren.length > 0) {
          acc.push({ ...node, children: filteredChildren });
        }
      }
      return acc;
    }, []);
  };

  const filteredTree = filterNodes(tree);

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="px-2 pb-2">
        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files..."
          className="w-full bg-nock-card border border-nock-border rounded px-2 py-1 text-[10px] text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue placeholder:text-nock-text-muted"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1">
        {filteredTree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            gitStatus={gitStatus}
            rootPath={rootPath}
            onFileClick={onFileClick}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-nock-card border border-nock-border rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { onFileClick(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Open in Editor
          </button>
          <button
            onClick={() => { window.nockTerminal.shell.openExternal(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Open in External Editor
          </button>
          <div className="border-t border-nock-border my-1" />
          <button
            onClick={() => { window.nockTerminal.clipboard.write(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Copy Path
          </button>
          <button
            onClick={() => {
              // Reveal in Explorer uses shell:openExternal on the parent dir
              const parentDir = contextMenu.node.path.replace(/[/\\][^/\\]+$/, '');
              window.nockTerminal.shell.openExternal(parentDir);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, depth, gitStatus, rootPath, onFileClick, onContextMenu }) {
  const [expanded, setExpanded] = useState(depth < 1); // Auto-expand top level

  const relativePath = node.path.replace(rootPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
  const statusCode = gitStatus[relativePath] || gitStatus[relativePath.replace(/\//g, '\\')];

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="w-full text-left flex items-center gap-1 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <span className="text-[10px] text-nock-accent-blue w-3 shrink-0">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="text-[10px] text-nock-accent-blue truncate">{node.name}/</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            gitStatus={gitStatus}
            rootPath={rootPath}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      className="w-full text-left flex items-center gap-1.5 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <span className="text-[10px] text-nock-text truncate">{node.name}</span>
      {statusCode && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${GIT_STATUS_COLORS[statusCode] || 'bg-nock-text-muted'}`} />
      )}
    </button>
  );
}
```

- [ ] **Step 2: Integrate FileTree into Sidebar**

In `src/components/Sidebar.jsx`, add the import at the top:

```jsx
import FileTree from './FileTree';
```

Update the component signature to accept new props:

```jsx
export default function Sidebar({
  collapsed,
  onToggle,
  sessions,
  activePorts,
  onSessionClick,
  onPortClick,
  onRefresh,
  activeView,
  onViewChange,
  activeProjectPath,
  onFileClick,
  onCtrlPFocus,
}) {
```

Add the File Tree section inside the `{!collapsed && (` block, BEFORE the Sessions section. Insert this right after the opening `<div className="flex-1 overflow-y-auto">`:

```jsx
          {/* File Tree */}
          {activeProjectPath && (
            <div className="px-1 pt-3 pb-2 border-b border-nock-border">
              <div className="px-2 mb-2 flex items-center justify-between">
                <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
                  // Files
                </span>
                <span className="font-mono text-[8px] text-nock-text-muted bg-nock-card px-1.5 py-0.5 rounded">Ctrl+P</span>
              </div>
              <FileTree
                rootPath={activeProjectPath}
                onFileClick={onFileClick}
                onCtrlPFocus={onCtrlPFocus}
              />
            </div>
          )}
```

- [ ] **Step 3: Pass new props from App.jsx to Sidebar**

In `src/App.jsx`, update the `<Sidebar>` usage to pass the new props. Add a ref for the Ctrl+P focus callback:

Add state after the existing state declarations:

```jsx
  const ctrlPFocusRef = useRef(null);
```

(Also add `useRef` to the React import if not already there — it's already imported.)

Update the Sidebar usage:

```jsx
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(prev => !prev)}
          sessions={sessions}
          activePorts={activePorts}
          onSessionClick={openTerminalTab}
          onPortClick={(port) => window.nockTerminal.shell.openExternal(port.url)}
          onRefresh={refreshSessions}
          activeView={view}
          onViewChange={setView}
          activeProjectPath={activeTab?.cwd || null}
          onFileClick={openFileInEditor}
          onCtrlPFocus={(fn) => { ctrlPFocusRef.current = fn; }}
        />
```

- [ ] **Step 4: Verify file tree renders**

Run `npm run dev`. Open a terminal tab for any project. The sidebar should show the file tree above sessions. Click to expand folders. Git status dots should appear after ~10s.

- [ ] **Step 5: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/FileTree.jsx src/components/Sidebar.jsx src/App.jsx
git commit -m "feat: add file tree with git status dots, filter bar, and context menu"
```

---

## Task 7: ContextMonitor Component

**Files:**
- Create: `src/components/ContextMonitor.jsx`
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 1: Create ContextMonitor.jsx**

Create `src/components/ContextMonitor.jsx`:

```jsx
import React, { useState, useEffect } from 'react';

export default function ContextMonitor({ projectPath, onEditFile }) {
  const [claudeMd, setClaudeMd] = useState(null);
  const [nockConfig, setNockConfig] = useState(null);

  useEffect(() => {
    if (!projectPath) return;

    const check = async () => {
      const claudePath = projectPath + '\\CLAUDE.md';
      const nockPath = projectPath + '\\.nock\\config.toml';
      const [c, n] = await Promise.all([
        window.nockTerminal.files.stat(claudePath),
        window.nockTerminal.files.stat(nockPath),
      ]);
      setClaudeMd({ ...c, path: claudePath });
      setNockConfig({ ...n, path: nockPath });
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [projectPath]);

  const formatTime = (ms) => {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}KB`;
  };

  return (
    <div className="px-3 py-2">
      <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest mb-2 block">
        // Context
      </span>
      <ContextRow
        label="CLAUDE.md"
        stat={claudeMd}
        onEdit={() => claudeMd?.exists && onEditFile(claudeMd.path)}
        formatTime={formatTime}
        formatSize={formatSize}
      />
      <ContextRow
        label=".nock/config.toml"
        stat={nockConfig}
        onEdit={() => nockConfig?.exists && onEditFile(nockConfig.path)}
        formatTime={formatTime}
        formatSize={formatSize}
      />
    </div>
  );
}

function ContextRow({ label, stat, onEdit, formatTime, formatSize }) {
  if (!stat) return null;
  return (
    <div className="flex items-center gap-1.5 py-1 group">
      <span className={`text-[10px] ${stat.exists ? 'text-nock-green' : 'text-red-400'}`}>
        {stat.exists ? '✓' : '✗'}
      </span>
      <span className="text-[9px] text-nock-text-dim flex-1 truncate">{label}</span>
      {stat.exists && (
        <>
          <span className="font-mono text-[8px] text-nock-text-muted">{formatSize(stat.size)}</span>
          <span className="font-mono text-[8px] text-nock-text-muted">{formatTime(stat.mtime)}</span>
          <button
            onClick={onEdit}
            className="text-[8px] text-nock-accent-blue opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ContextMonitor to Sidebar**

In `src/components/Sidebar.jsx`, import at the top:

```jsx
import ContextMonitor from './ContextMonitor';
```

Add the Context Monitor section at the bottom of the sidebar, just before the collapse toggle button. Insert before `{/* Collapse toggle */}`:

```jsx
      {/* Context Monitor */}
      {!collapsed && activeProjectPath && (
        <div className="border-t border-nock-border">
          <ContextMonitor projectPath={activeProjectPath} onEditFile={onFileClick} />
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run `npm run dev`. Open a terminal for a project that has a CLAUDE.md file. The bottom of the sidebar should show "CLAUDE.md ✓" with size and time. Hover to see "Edit" button.

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/ContextMonitor.jsx src/components/Sidebar.jsx
git commit -m "feat: add context monitor showing CLAUDE.md and .nock/config.toml status"
```

---

## Task 8: EditorPane with Monaco

**Files:**
- Create: `src/components/EditorPane.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create EditorPane.jsx**

Create `src/components/EditorPane.jsx`:

```jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';

// Language detection from file extension
const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', go: 'go', rs: 'rust',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  sql: 'sql', xml: 'xml', svg: 'xml',
};

const NOCK_DARK_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '757585', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C370FF' },
    { token: 'string', foreground: '00D670' },
    { token: 'number', foreground: '5FFFFF' },
    { token: 'type', foreground: '5B9FFF' },
    { token: 'function', foreground: '5B9FFF' },
    { token: 'variable', foreground: 'E8E8F0' },
    { token: 'operator', foreground: 'A0A0B0' },
  ],
  colors: {
    'editor.background': '#0D0D12',
    'editor.foreground': '#E8E8F0',
    'editor.lineHighlightBackground': '#1A1A2E40',
    'editor.selectionBackground': '#3B6FD440',
    'editorCursor.foreground': '#7C5CFC',
    'editorLineNumber.foreground': '#757585',
    'editorLineNumber.activeForeground': '#A0A0B0',
    'editorWidget.background': '#111116',
    'editorWidget.border': '#2A2A35',
    'input.background': '#1A1A22',
    'input.border': '#2A2A35',
    'input.foreground': '#E8E8F0',
    'scrollbarSlider.background': '#2A2A3560',
    'scrollbarSlider.hoverBackground': '#3A3A4580',
  },
};

export default function EditorPane({
  files = [],
  activeFile,
  onActiveFileChange,
  onClose,
  onCloseFile,
}) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const monacoRef = useRef(null);
  const modelsRef = useRef({}); // { filePath: { model, viewState, modified } }
  const [loading, setLoading] = useState(true);
  const [fileContents, setFileContents] = useState({}); // { filePath: { content, readOnly, error } }

  // Lazy-load Monaco
  useEffect(() => {
    let cancelled = false;
    const loadMonaco = async () => {
      const monaco = await import('monaco-editor');
      if (cancelled) return;
      monacoRef.current = monaco;

      // Register Nock dark theme
      monaco.editor.defineTheme('nock-dark', NOCK_DARK_THEME);

      // Create editor instance
      if (containerRef.current && !editorRef.current) {
        editorRef.current = monaco.editor.create(containerRef.current, {
          theme: 'nock-dark',
          fontFamily: "'JetBrains Mono', 'Consolas', monospace",
          fontSize: 13,
          lineNumbers: 'on',
          minimap: { enabled: false },
          wordWrap: 'off',
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          automaticLayout: true,
          padding: { top: 8 },
        });

        // Ctrl+S to save
        editorRef.current.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => saveCurrentFile()
        );
      }
      setLoading(false);
    };
    loadMonaco();
    return () => { cancelled = true; };
  }, []);

  // Load file content when a new file is added
  useEffect(() => {
    const loadNewFiles = async () => {
      for (const filePath of files) {
        if (fileContents[filePath]) continue;
        const result = await window.nockTerminal.files.read(filePath);
        setFileContents(prev => ({ ...prev, [filePath]: result }));
      }
    };
    loadNewFiles();
  }, [files]);

  // Switch active file model
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFile) return;
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const content = fileContents[activeFile];
    if (!content || content.error) return;

    // Save current view state
    const currentModel = editor.getModel();
    if (currentModel) {
      const currentPath = Object.keys(modelsRef.current).find(
        p => modelsRef.current[p].model === currentModel
      );
      if (currentPath) {
        modelsRef.current[currentPath].viewState = editor.saveViewState();
      }
    }

    // Create or reuse model
    if (!modelsRef.current[activeFile]) {
      const ext = activeFile.split('.').pop()?.toLowerCase() || '';
      const language = EXT_TO_LANG[ext] || 'plaintext';
      const model = monaco.editor.createModel(content.content, language);

      model.onDidChangeContent(() => {
        modelsRef.current[activeFile].modified = true;
      });

      modelsRef.current[activeFile] = { model, viewState: null, modified: false };
    }

    const entry = modelsRef.current[activeFile];
    editor.setModel(entry.model);
    if (entry.viewState) {
      editor.restoreViewState(entry.viewState);
    }
    editor.updateOptions({ readOnly: content.readOnly || false });
  }, [activeFile, fileContents]);

  // Clean up models for closed files
  useEffect(() => {
    const openPaths = new Set(files);
    for (const [path, entry] of Object.entries(modelsRef.current)) {
      if (!openPaths.has(path)) {
        entry.model.dispose();
        delete modelsRef.current[path];
      }
    }
  }, [files]);

  const saveCurrentFile = useCallback(async () => {
    if (!activeFile || !modelsRef.current[activeFile]) return;
    const entry = modelsRef.current[activeFile];
    const content = entry.model.getValue();
    const result = await window.nockTerminal.files.write(activeFile, content);
    if (result.success) {
      entry.modified = false;
      // Force re-render for modified indicator
      setFileContents(prev => ({ ...prev }));
    }
  }, [activeFile]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      for (const entry of Object.values(modelsRef.current)) {
        entry.model.dispose();
      }
      modelsRef.current = {};
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  const getFileName = (filePath) => filePath.split(/[/\\]/).pop();

  return (
    <div className="flex-1 flex flex-col bg-[#0D0D12] overflow-hidden">
      {/* Editor tab bar */}
      <div className="flex items-center border-b border-nock-border bg-nock-bg shrink-0 h-7 overflow-x-auto no-scrollbar">
        {files.map(filePath => {
          const isActive = filePath === activeFile;
          const modified = modelsRef.current[filePath]?.modified;
          const hasError = fileContents[filePath]?.error;
          return (
            <div
              key={filePath}
              onClick={() => onActiveFileChange(filePath)}
              className={`flex items-center gap-1.5 px-2.5 h-7 cursor-pointer shrink-0 text-[10px] font-mono transition-colors ${
                isActive
                  ? 'text-nock-text border-b border-nock-accent-purple bg-[#0D0D12]'
                  : 'text-nock-text-muted hover:text-nock-text'
              }`}
            >
              <span className="truncate max-w-[120px]">{getFileName(filePath)}</span>
              {modified && <span className="text-nock-yellow text-[8px]">●</span>}
              {hasError && <span className="text-red-400 text-[8px]">!</span>}
              <button
                onClick={(e) => { e.stopPropagation(); onCloseFile(filePath); }}
                className="opacity-0 hover:opacity-100 transition-opacity ml-0.5"
              >
                <svg className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="px-2 h-7 text-nock-text-muted hover:text-nock-text transition-colors shrink-0"
          title="Close Editor (Ctrl+W)"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Read-only banner */}
      {fileContents[activeFile]?.readOnly && (
        <div className="px-3 py-1.5 bg-nock-yellow/10 border-b border-nock-yellow/20 text-[10px] text-nock-yellow font-mono">
          This file is too large to edit (read-only)
        </div>
      )}

      {/* Error banner */}
      {fileContents[activeFile]?.error && (
        <div className="px-3 py-1.5 bg-red-400/10 border-b border-red-400/20 text-[10px] text-red-400 font-mono">
          {fileContents[activeFile].error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-nock-text-muted text-sm">
          Loading editor...
        </div>
      )}

      {/* Monaco container */}
      <div ref={containerRef} className={`flex-1 ${loading ? 'hidden' : ''}`} />

      {/* Status bar */}
      <div className="h-5 bg-nock-bg border-t border-nock-border px-3 flex items-center justify-between shrink-0">
        <span className="font-mono text-[8px] text-nock-text-muted">
          {activeFile ? EXT_TO_LANG[activeFile.split('.').pop()?.toLowerCase()] || 'plaintext' : ''}
        </span>
        <span className="font-mono text-[8px] text-nock-text-muted">
          {fileContents[activeFile]?.readOnly ? 'Read-Only' : 'Ctrl+S save'}
        </span>
        <span className="font-mono text-[8px] text-nock-text-muted">UTF-8</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire EditorPane into App.jsx split rendering**

In `src/App.jsx`, import EditorPane at the top:

```jsx
import EditorPane from './components/EditorPane';
```

Replace the editor placeholder in the SplitPane `rightPane` prop (from Task 4). Change:

```jsx
                      ) : tab.splitContent?.type === 'editor' ? (
                        <div className="flex-1 bg-nock-card text-nock-text-dim flex items-center justify-center text-sm">
                          Editor placeholder — Task 8
                        </div>
                      ) : null
```

To:

```jsx
                      ) : tab.splitContent?.type === 'editor' ? (
                        <EditorPane
                          files={tab.splitContent.files}
                          activeFile={tab.splitContent.activeFile}
                          onActiveFileChange={setActiveEditorFile}
                          onClose={closeSplit}
                          onCloseFile={closeEditorFile}
                        />
                      ) : null
```

- [ ] **Step 3: Verify editor works end-to-end**

Run `npm run dev`. Open a terminal tab. Click a file in the file tree. The editor should:
1. Open in a split pane to the right of the terminal
2. Show syntax-highlighted code
3. Have a tab bar at the top showing the filename
4. Support Ctrl+S to save
5. Show modified indicator when changed
6. Close with the X button

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/EditorPane.jsx src/App.jsx
git commit -m "feat: add Monaco editor pane with syntax highlighting, multi-tab, save"
```

---

## Task 9: ActionToolbar Component

**Files:**
- Create: `src/components/ActionToolbar.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create ActionToolbar.jsx**

Create `src/components/ActionToolbar.jsx`:

```jsx
import React from 'react';

export default function ActionToolbar({
  onSplit,
  onToggleSidebar,
  onToggleChat,
  onDashboard,
  sidebarOpen,
  chatOpen,
  hasSplit,
}) {
  return (
    <div className="flex items-center gap-1 px-2 shrink-0">
      <ToolbarButton
        icon="⊞"
        label="Split"
        shortcut="Ctrl+Shift+D"
        onClick={onSplit}
        active={hasSplit}
      />
      <ToolbarButton
        icon="◧"
        label="Sidebar"
        shortcut="Ctrl+B"
        onClick={onToggleSidebar}
        active={sidebarOpen}
      />
      <ToolbarButton
        icon="💬"
        label="Chat"
        shortcut="Ctrl+Shift+A"
        onClick={onToggleChat}
        active={chatOpen}
      />
      <ToolbarButton
        icon="⊟"
        label="Dash"
        shortcut="Ctrl+D"
        onClick={onDashboard}
      />
    </div>
  );
}

function ToolbarButton({ icon, label, shortcut, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono transition-all border ${
        active
          ? 'bg-gradient-to-r from-nock-accent-blue/10 to-nock-accent-purple/10 border-nock-accent-blue/30 text-nock-text'
          : 'bg-nock-card border-nock-border text-nock-text-dim hover:text-nock-text hover:border-nock-border-bright'
      }`}
      title={`${label} (${shortcut})`}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
```

- [ ] **Step 2: Integrate ActionToolbar into App.jsx**

Import at the top of `src/App.jsx`:

```jsx
import ActionToolbar from './components/ActionToolbar';
```

In the terminal area, add ActionToolbar between TabBar and the terminal content div. Replace the TabBar usage area:

```jsx
          <div className={`absolute inset-0 flex flex-col ${view === 'terminal' ? '' : 'hidden'}`}>
            <div className="flex items-center border-b border-nock-border shrink-0">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={(id) => setActiveTabId(id)}
                onTabClose={closeTab}
                onNewTab={openNewTab}
              />
              <ActionToolbar
                onSplit={toggleTerminalSplit}
                onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
                onToggleChat={() => setChatOpen(prev => !prev)}
                onDashboard={() => setView('dashboard')}
                sidebarOpen={!sidebarCollapsed}
                chatOpen={chatOpen}
                hasSplit={!!activeTab?.splitContent}
              />
            </div>
```

Note: This puts TabBar and ActionToolbar in a shared flex row. TabBar has `flex-1` to take remaining space. The `border-b` from TabBar should be moved to the wrapper div.

Update `src/components/TabBar.jsx` — remove the `border-b border-nock-border` from the root div (the parent wrapper now handles it). Change line 33:

```jsx
  return (
    <div className="bg-nock-bg flex items-center shrink-0 h-9 relative flex-1">
```

- [ ] **Step 3: Verify toolbar renders**

Run `npm run dev`. The toolbar should appear to the right of the tab bar. Each button should show a tooltip on hover. Click Split to verify terminal splits.

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/ActionToolbar.jsx src/components/TabBar.jsx src/App.jsx
git commit -m "feat: add action toolbar with Split, Sidebar, Chat, Dashboard buttons"
```

---

## Task 10: Session Status Indicators

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/TabBar.jsx`

- [ ] **Step 1: Add process status state to App.jsx**

In `src/App.jsx`, add state for process status and data timestamps:

```jsx
  const [processStatus, setProcessStatus] = useState({}); // { tabId: { hasClaude } }
  const [lastDataTimestamps, setLastDataTimestamps] = useState({}); // { tabId: timestamp }
```

Add an effect to listen for process status events:

```jsx
  // Listen for process status updates
  useEffect(() => {
    const cleanup = window.nockTerminal.process.onStatus((status) => {
      setProcessStatus(prev => ({ ...prev, [status.tabId]: status }));
    });
    return cleanup;
  }, []);

  // Track terminal data timestamps for activity detection
  useEffect(() => {
    const cleanup = window.nockTerminal.terminal.onData((id) => {
      setLastDataTimestamps(prev => ({ ...prev, [id]: Date.now() }));
    });
    return cleanup;
  }, []);
```

Add a function to compute display status:

```jsx
  // Compute session status: red / yellow / green
  const getSessionStatus = useCallback((tabId) => {
    const proc = processStatus[tabId];
    const lastData = lastDataTimestamps[tabId] || 0;
    if (!proc?.hasClaude) return 'inactive'; // red
    if (Date.now() - lastData < 2000) return 'active'; // yellow (generating)
    return 'ready'; // green (waiting for input)
  }, [processStatus, lastDataTimestamps]);
```

- [ ] **Step 2: Update TabBar to use real status**

Pass `getSessionStatus` to TabBar. Update the TabBar usage in App.jsx:

```jsx
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={(id) => setActiveTabId(id)}
                onTabClose={closeTab}
                onNewTab={openNewTab}
                getSessionStatus={getSessionStatus}
              />
```

Update `src/components/TabBar.jsx` to accept and use the prop. Change the component signature:

```jsx
export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab, getSessionStatus }) {
```

Replace the `STATUS_COLORS` object and its usage. Change the status dot rendering (around line 55):

Replace:
```jsx
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[tab.status] || STATUS_COLORS.active}`} />
```

With:
```jsx
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                (() => {
                  const status = getSessionStatus?.(tab.id) || tab.status;
                  if (status === 'ready') return 'bg-nock-green';
                  if (status === 'active') return 'bg-nock-yellow animate-pulse-glow';
                  return 'bg-red-400';
                })()
              }`} />
```

- [ ] **Step 3: Verify status dots work**

Run `npm run dev`. Open a terminal tab. The status dot should be:
- Red when no Claude process is running
- Launch Claude in the terminal — dot should turn green/yellow

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/App.jsx src/components/TabBar.jsx
git commit -m "feat: add session status indicators — red/yellow/green from process detection"
```

---

## Task 11: Enhanced Port Monitor

**Files:**
- Modify: `electron/port-scanner.js`

- [ ] **Step 1: Add process name resolution**

In `electron/port-scanner.js`, update `_scanWindows()` to resolve process names. Replace the entire `_scanWindows` method:

```js
  _scanWindows() {
    const activePorts = [];
    try {
      const output = execSync('netstat -ano -p TCP', {
        timeout: 5000,
        encoding: 'utf-8',
        windowsHide: true,
      });

      const lines = output.split('\n');
      const portPidMap = new Map(); // port → pid

      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const match = line.match(/:(\d+)\s+\S+\s+(\d+)/);
          if (match) {
            portPidMap.set(parseInt(match[1], 10), parseInt(match[2], 10));
          }
        }
      }

      // Resolve process names for matched ports
      const pidsToResolve = new Set();
      for (const { port } of this.knownPorts) {
        if (portPidMap.has(port)) {
          pidsToResolve.add(portPidMap.get(port));
        }
      }

      const processNames = this._resolveProcessNames(pidsToResolve);

      for (const { port, label } of this.knownPorts) {
        if (portPidMap.has(port)) {
          const pid = portPidMap.get(port);
          activePorts.push({
            port,
            label,
            url: `http://localhost:${port}`,
            pid,
            processName: processNames.get(pid) || null,
          });
        }
      }
    } catch {
      // netstat may fail
    }
    return activePorts;
  }

  _resolveProcessNames(pids) {
    const names = new Map();
    if (pids.size === 0) return names;

    try {
      for (const pid of pids) {
        const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          timeout: 3000,
          encoding: 'utf-8',
          windowsHide: true,
        });
        const match = output.match(/"([^"]+)"/);
        if (match) {
          names.set(pid, match[1]);
        }
      }
    } catch {
      // tasklist may fail
    }
    return names;
  }
```

- [ ] **Step 2: Update Sidebar to show process names**

In `src/components/Sidebar.jsx`, update the port display (around line 88). Replace:

```jsx
                    <p className="text-[9px] text-nock-text-muted truncate">{port.label}</p>
```

With:

```jsx
                    <p className="text-[9px] text-nock-text-muted truncate">
                      {port.processName ? `${port.processName} · ${port.label}` : port.label}
                    </p>
```

- [ ] **Step 3: Verify port monitor shows process names**

Run `npm run dev`. Start a dev server (e.g., `npm run dev` in another project on port 3000). The port monitor should show "node.exe · React/Next.js" or similar.

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add electron/port-scanner.js src/components/Sidebar.jsx
git commit -m "feat: enhance port monitor with process name resolution via tasklist"
```

---

## Task 12: Keyboard Shortcuts

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Expand keyboard shortcuts in App.jsx**

Replace the entire keyboard handler `useEffect` in `src/App.jsx` (the one with `handleKeyDown`):

```jsx
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+T / Ctrl+N: New tab
      if (isCtrl && (e.key === 't' || e.key === 'n') && !e.shiftKey) {
        e.preventDefault();
        openNewTab();
      }
      // Ctrl+W: Close editor tab/split or close terminal tab
      if (isCtrl && e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab?.splitContent) {
          closeSplit();
        } else if (activeTabId) {
          closeTab(activeTabId);
        }
      }
      // Ctrl+1-9: Switch tabs
      if (isCtrl && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (tabs[index]) {
          setActiveTabId(tabs[index].id);
          setView('terminal');
        }
      }
      // Ctrl+Tab: Next tab
      if (isCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 0) {
          const next = (idx + 1) % tabs.length;
          setActiveTabId(tabs[next].id);
          setView('terminal');
        }
      }
      // Ctrl+Shift+Tab: Previous tab
      if (isCtrl && e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 0) {
          const prev = (idx - 1 + tabs.length) % tabs.length;
          setActiveTabId(tabs[prev].id);
          setView('terminal');
        }
      }
      // Ctrl+Shift+A: Toggle AI chat
      if (isCtrl && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setChatOpen(prev => !prev);
      }
      // Ctrl+Shift+D: Toggle terminal split
      if (isCtrl && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggleTerminalSplit();
      }
      // Ctrl+B: Toggle sidebar
      if (isCtrl && e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        setSidebarCollapsed(prev => !prev);
      }
      // Ctrl+D: Dashboard
      if (isCtrl && e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        setView('dashboard');
      }
      // Ctrl+P: Focus file filter
      if (isCtrl && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        ctrlPFocusRef.current?.();
      }
      // Ctrl+`: Toggle terminal focus
      if (isCtrl && e.key === '`') {
        e.preventDefault();
        if (view !== 'terminal' && tabs.length > 0) {
          setView('terminal');
        }
      }
      // F11: Fullscreen
      if (e.key === 'F11') {
        e.preventDefault();
        // Toggle fullscreen via Electron
        window.nockTerminal.window.isMaximized().then(max => {
          if (max) window.nockTerminal.window.maximize(); // unmaximize
          else window.nockTerminal.window.maximize();
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, openNewTab, closeTab, closeSplit, toggleTerminalSplit, view]);
```

- [ ] **Step 2: Verify all shortcuts**

Test each shortcut manually:
- Ctrl+T → new tab
- Ctrl+W → close split or tab
- Ctrl+1 → switch to first tab
- Ctrl+Tab → next tab
- Ctrl+Shift+A → toggle chat
- Ctrl+Shift+D → toggle split
- Ctrl+B → toggle sidebar
- Ctrl+D → go to dashboard
- Ctrl+P → focus file filter
- Ctrl+` → toggle terminal

- [ ] **Step 3: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/App.jsx
git commit -m "feat: expand keyboard shortcuts — sidebar, dashboard, split, file filter, tab cycling"
```

---

## Task 13: Settings Improvements

**Files:**
- Modify: `src/components/Settings.jsx`
- Modify: `electron/main.js`

- [ ] **Step 1: Add new settings defaults to electron-store**

In `electron/main.js`, update the `store` defaults (around line 10-22). Add these new defaults to the `defaults` object:

```js
    terminalFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    editorFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    editorFontSize: 13,
    editorMinimap: false,
    editorWordWrap: false,
    fileTreeOpen: true,
    showDotfiles: false,
    theme: 'pitch-black',
```

- [ ] **Step 2: Update Settings.jsx with new sections**

In `src/components/Settings.jsx`, add new state fields in the `useState` default:

```jsx
  const [settings, setSettings] = useState({
    ollamaUrl: 'http://localhost:11434',
    claudeCodePath: '',
    maraBriefPath: '',
    terminalFontSize: 14,
    terminalFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    editorFontFamily: "'JetBrains Mono', 'Consolas', monospace",
    editorFontSize: 13,
    editorMinimap: false,
    editorWordWrap: false,
    fileTreeOpen: true,
    showDotfiles: false,
    theme: 'pitch-black',
    launchAtStartup: false,
    devRoots: [],
    projectSkipList: [],
  });
```

Add new sections in the JSX, after the existing Terminal section (Section 04). Insert:

```jsx
        <Section num="04" title="Terminal">
          <Field label="Font Family">
            <select
              value={settings.terminalFontFamily}
              onChange={(e) => updateSetting('terminalFontFamily', e.target.value)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
            >
              <option value="'JetBrains Mono', 'Consolas', monospace">JetBrains Mono</option>
              <option value="'Consolas', monospace">Consolas</option>
              <option value="'Cascadia Code', monospace">Cascadia Code</option>
              <option value="'Courier New', monospace">Courier New</option>
            </select>
          </Field>
          <Field label="Font Size">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="10"
                max="24"
                value={settings.terminalFontSize}
                onChange={(e) => updateSetting('terminalFontSize', parseInt(e.target.value))}
                className="flex-1 accent-[#3B6FD4]"
              />
              <span className="font-mono text-sm text-nock-text tabular-nums w-10 text-right">
                {settings.terminalFontSize}px
              </span>
            </div>
          </Field>
        </Section>

        <Section num="05" title="Editor">
          <Field label="Font Family">
            <select
              value={settings.editorFontFamily}
              onChange={(e) => updateSetting('editorFontFamily', e.target.value)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
            >
              <option value="'JetBrains Mono', 'Consolas', monospace">JetBrains Mono</option>
              <option value="'Consolas', monospace">Consolas</option>
              <option value="'Cascadia Code', monospace">Cascadia Code</option>
              <option value="'Courier New', monospace">Courier New</option>
            </select>
          </Field>
          <Field label="Font Size">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="10"
                max="24"
                value={settings.editorFontSize}
                onChange={(e) => updateSetting('editorFontSize', parseInt(e.target.value))}
                className="flex-1 accent-[#3B6FD4]"
              />
              <span className="font-mono text-sm text-nock-text tabular-nums w-10 text-right">
                {settings.editorFontSize}px
              </span>
            </div>
          </Field>
          <Field label="Minimap">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.editorMinimap}
                onChange={(e) => updateSetting('editorMinimap', e.target.checked)}
                className="w-4 h-4 rounded border-nock-border bg-nock-card accent-[#3B6FD4]"
              />
              <span className="text-sm text-nock-text">Show minimap in editor</span>
            </label>
          </Field>
          <Field label="Word Wrap">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.editorWordWrap}
                onChange={(e) => updateSetting('editorWordWrap', e.target.checked)}
                className="w-4 h-4 rounded border-nock-border bg-nock-card accent-[#3B6FD4]"
              />
              <span className="text-sm text-nock-text">Wrap long lines</span>
            </label>
          </Field>
        </Section>

        <Section num="06" title="File Tree">
          <Field label="Default State">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.fileTreeOpen}
                onChange={(e) => updateSetting('fileTreeOpen', e.target.checked)}
                className="w-4 h-4 rounded border-nock-border bg-nock-card accent-[#3B6FD4]"
              />
              <span className="text-sm text-nock-text">Open file tree by default</span>
            </label>
          </Field>
          <Field label="Dotfiles">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showDotfiles}
                onChange={(e) => updateSetting('showDotfiles', e.target.checked)}
                className="w-4 h-4 rounded border-nock-border bg-nock-card accent-[#3B6FD4]"
              />
              <span className="text-sm text-nock-text">Show dotfiles in file tree</span>
            </label>
          </Field>
        </Section>

        <Section num="07" title="Theme">
          <Field label="Theme" description="More themes coming soon.">
            <select
              value={settings.theme}
              disabled
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono opacity-60"
            >
              <option value="pitch-black">Pitch Black</option>
            </select>
          </Field>
        </Section>
```

Update the section numbers for existing General and Shortcuts sections:

```jsx
        <Section num="08" title="General">
```

```jsx
        <Section num="09" title="Shortcuts">
```

Update the Shortcuts section to include the new shortcuts:

```jsx
        <Section num="09" title="Shortcuts">
          <div className="space-y-2.5">
            <Shortcut keys="Ctrl+T" action="New terminal tab" />
            <Shortcut keys="Ctrl+W" action="Close editor tab or split" />
            <Shortcut keys="Ctrl+B" action="Toggle sidebar" />
            <Shortcut keys="Ctrl+D" action="Dashboard" />
            <Shortcut keys="Ctrl+P" action="Quick file finder" />
            <Shortcut keys="Ctrl+1-9" action="Switch to tab N" />
            <Shortcut keys="Ctrl+Tab" action="Next tab" />
            <Shortcut keys="Ctrl+Shift+Tab" action="Previous tab" />
            <Shortcut keys="Ctrl+Shift+A" action="Toggle AI chat panel" />
            <Shortcut keys="Ctrl+Shift+D" action="Split terminal" />
            <Shortcut keys="Ctrl+Shift+T" action="Toggle window (global)" />
            <Shortcut keys="Ctrl+S" action="Save file (editor)" />
            <Shortcut keys="Ctrl+`" action="Focus terminal" />
            <Shortcut keys="F11" action="Fullscreen" />
          </div>
        </Section>
```

- [ ] **Step 3: Verify settings**

Run `npm run dev`. Go to Settings. Verify all new sections render. Change a font, toggle minimap, etc. Changes should persist after app restart.

- [ ] **Step 4: Commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add src/components/Settings.jsx electron/main.js
git commit -m "feat: add terminal font, editor, file tree, and theme settings"
```

---

## Task 14: Final Integration and Verification

**Files:** None new — this is a verification pass.

- [ ] **Step 1: Run the full test checklist**

```bash
cd C:\Dev\nock-command-center\terminal-electron
npm run dev
```

Walk through every item from the spec's testing checklist:

1. Open 3 terminals, switch to dashboard, switch back — all sessions alive with scrollback
2. Click file in tree → editor opens in split next to terminal
3. Edit a file, Ctrl+S, verify changes on disk
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

- [ ] **Step 2: Fix any issues found during verification**

Address each failing test case individually.

- [ ] **Step 3: Final commit**

```bash
cd C:\Dev\nock-command-center\terminal-electron
git add -A
git commit -m "feat: Phase 2 — file tree, editor, port monitor, split terminal, session persistence

- Fix session persistence across view switches (keep-mounted terminals)
- Add SplitPane for in-tab editor and terminal splits
- Add file tree with git status dots, filter, and context menu
- Add Monaco editor with syntax highlighting, multi-tab, Ctrl+S save
- Add action toolbar (Split, Sidebar, Chat, Dashboard buttons)
- Add session status indicators (red/yellow/green from process detection)
- Enhance port monitor with process name resolution
- Add context monitor for CLAUDE.md and .nock/config.toml
- Expand keyboard shortcuts (Ctrl+B, Ctrl+D, Ctrl+P, Ctrl+Shift+D, etc.)
- Add terminal/editor font, minimap, word wrap, file tree settings"
```

---

## Summary

| Task | Component | Type | Dependencies |
|------|-----------|------|-------------|
| 1 | Dependencies | Setup | None |
| 2 | Session Persistence | Bug fix | None |
| 3 | SplitPane | New component | None |
| 4 | Split integration | Integration | 2, 3 |
| 5 | IPC Bridge | Backend services | 1 |
| 6 | FileTree | New component | 5 |
| 7 | ContextMonitor | New component | 5 |
| 8 | EditorPane (Monaco) | New component | 1, 4, 5 |
| 9 | ActionToolbar | New component | 4 |
| 10 | Session Status | Enhancement | 5 |
| 11 | Port Monitor | Enhancement | None |
| 12 | Keyboard Shortcuts | Enhancement | 4, 6 |
| 13 | Settings | Enhancement | None |
| 14 | Verification | Testing | All |

**Parallelizable groups:**
- Tasks 1, 2, 11 can run in parallel (no dependencies)
- Tasks 3 + 5 can run in parallel after 1
- Tasks 6, 7, 10 can run in parallel after 5
- Task 8 requires 1, 4, 5
- Task 9 requires 4
- Task 12 requires 4, 6
- Task 13 can run any time
- Task 14 must be last

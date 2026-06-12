import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TabBar from './components/TabBar';
import ActionToolbar from './components/ActionToolbar';
import TerminalView from './components/TerminalView';
import SplitPane from './components/SplitPane';
import AIChatPanel from './components/AIChatPanel';
import EditorPane from './components/EditorPane';
import Settings from './components/Settings';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import {
  MAX_DISPATCH_RUNS,
  applyDispatchRunUpdates,
  createDispatchRun,
  getDispatchRunStorage,
  isTerminalDispatchStatus,
  readDispatchRunsFromStorage,
  writeDispatchRunsToStorage,
} from './utils/dispatchRuns.mjs';
import {
  canRunResolvedLaunch,
  resolveSessionLaunch,
  sanitizeStagedTerminalInput,
} from './utils/agentLaunchers.mjs';
import { createTabId } from './utils/tabOps.mjs';
import useTabs from './hooks/useTabs.js';
import useTabSplits from './hooks/useTabSplits.js';

function projectNameFromPath(projectPath) {
  const normalized = String(projectPath || '').replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || '';
}

export default function App() {
  const [view, setView] = useState('dashboard'); // dashboard | terminal | settings
  const {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    openTab,
    openTerminalTab,
    launchAgentFresh,
    openNewTab,
    openTerminalWithClaude,
    closeTab,
    renameTab,
    pinTab,
    duplicateTab,
    reorderTabs,
  } = useTabs({ setView });
  const {
    openFileInEditor,
    toggleTerminalSplit,
    closeSplit,
    closeEditorFile,
    updateEditorUnsavedFiles,
    setActiveEditorFile,
    updateSplitRatio,
  } = useTabSplits({ tabs, setTabs, activeTabId });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activePorts, setActivePorts] = useState([]);
  const [processStatus, setProcessStatus] = useState({});
  const [lastDataTimestamps, setLastDataTimestamps] = useState({});
  const [ollamaStatus, setOllamaStatus] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPalettePreset, setCommandPalettePreset] = useState(null);
  const [profilesByPath, setProfilesByPath] = useState({});
  const [dispatchRuns, setDispatchRuns] = useState(() => readDispatchRunsFromStorage(getDispatchRunStorage(window)));
  const [notice, setNotice] = useState(null);
  const queuedPromptIdRef = useRef(0);

  // Discover sessions on mount and periodically
  const refreshSessions = useCallback(async () => {
    try {
      const discovered = await window.nockTerminal.sessions.discover();
      setSessions(discovered);
    } catch (err) {
      console.error('Session discovery failed:', err);
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const ports = await window.nockTerminal.ports.scan();
      setActivePorts(ports);
    } catch (err) {
      console.error('Port scan failed:', err);
    }
  }, []);

  useEffect(() => {
    refreshSessions();
    refreshPorts();
    const interval = setInterval(() => {
      refreshSessions();
      refreshPorts();
    }, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [refreshSessions, refreshPorts]);

  useEffect(() => {
    let cancelled = false;
    const paths = [...new Set(sessions.map(session => session.path).filter(Boolean))];
    if (paths.length === 0) {
      setProfilesByPath({});
      return undefined;
    }

    Promise.all(paths.map(async (projectPath) => {
      try {
        const profile = await window.nockTerminal.profiles.get(projectPath);
        return [projectPath, profile || {}];
      } catch {
        return [projectPath, {}];
      }
    })).then((entries) => {
      if (!cancelled) {
        setProfilesByPath(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessions]);

  useEffect(() => {
    const storage = getDispatchRunStorage(window);
    if (storage) {
      writeDispatchRunsToStorage(storage, dispatchRuns);
    }
  }, [dispatchRuns]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const showDispatchError = useCallback((message) => {
    setNotice({
      id: createTabId('notice'),
      title: 'Dispatch failed',
      message,
    });
  }, []);

  const openCommandPalette = useCallback((preset = null) => {
    const safePreset = preset && typeof preset === 'object' && !preset.nativeEvent && !preset.currentTarget ? preset : null;
    setCommandPalettePreset(safePreset ? { ...safePreset, key: Date.now() } : null);
    setCommandPaletteOpen(true);
  }, []);

  const openCommandPaletteForSession = useCallback((session) => {
    openCommandPalette({
      sessionId: session?.id,
      query: session?.agent?.name || session?.name || '',
      focusTask: session?.launch?.mode === 'dispatch',
    });
  }, [openCommandPalette]);

  // Poll Ollama status every 30s
  useEffect(() => {
    const checkOllama = async () => {
      try {
        const result = await window.nockTerminal.ai.ollama.status();
        setOllamaStatus(result?.connected === true);
      } catch {
        setOllamaStatus(false);
      }
    };
    checkOllama();
    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const cleanup = window.nockTerminal.process.onStatus((status) => {
      setProcessStatus(prev => ({ ...prev, [status.tabId]: status }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = window.nockTerminal.terminal.onData((id) => {
      setLastDataTimestamps(prev => ({ ...prev, [id]: Date.now() }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const projectPaths = new Set(tabs.map(tab => tab.cwd).filter(Boolean));
    const activeAgentSessionIds = [];
    const activeClaudeSessionIds = [];

    for (const tab of tabs) {
      const status = processStatus[tab.id];
      const activeAgents = Array.isArray(status?.activeAgents) ? [...status.activeAgents] : [];
      if (status?.hasClaude && !activeAgents.includes('claude')) {
        activeAgents.push('claude');
      }

      for (const agentId of activeAgents) {
        activeAgentSessionIds.push(`${agentId}:${tab.id}`);
        if (agentId === 'claude') activeClaudeSessionIds.push(tab.id);
      }
    }

    window.nockTerminal.nockcc?.updateActivity({
      activeProjectCount: projectPaths.size,
      activeClaudeSessionIds,
      activeAgentSessionIds,
    });
  }, [tabs, processStatus]);

  const recordDispatchRun = useCallback((run) => {
    setDispatchRuns(prev => [
      createDispatchRun(run, { id: createTabId('dispatch') }),
      ...prev,
    ].slice(0, MAX_DISPATCH_RUNS));
  }, []);

  const activeBrokeredDispatchRequestKey = useMemo(() => {
    const requestIds = [];
    const seen = new Set();
    for (const run of dispatchRuns) {
      if (run.mode !== 'brokered' || !run.requestId || isTerminalDispatchStatus(run.status)) continue;
      if (seen.has(run.requestId)) continue;
      seen.add(run.requestId);
      requestIds.push(run.requestId);
    }
    return requestIds.sort().join('|');
  }, [dispatchRuns]);

  useEffect(() => {
    const requestIds = activeBrokeredDispatchRequestKey.split('|').filter(Boolean);
    const pollStatusUpdates = window.nockTerminal.dispatch?.statusUpdates;
    if (requestIds.length === 0 || typeof pollStatusUpdates !== 'function') return undefined;

    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await pollStatusUpdates({
          requestIds,
          agentName: 'nock-terminal',
          limit: 50,
        });
        if (!cancelled && result?.success !== false && Array.isArray(result?.updates) && result.updates.length > 0) {
          setDispatchRuns(prev => applyDispatchRunUpdates(prev, result.updates));
        }
      } catch {
        // NockCC polling is best-effort; local/direct dispatch must keep working offline.
      } finally {
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeBrokeredDispatchRequestKey]);

  const getProfileForPath = useCallback(async (projectPath) => {
    if (!projectPath) return {};
    if (profilesByPath[projectPath]) return profilesByPath[projectPath];
    try {
      return await window.nockTerminal.profiles.get(projectPath);
    } catch {
      return {};
    }
  }, [profilesByPath]);

  const openSession = useCallback((session, options = {}) => {
    if (session?.launch?.mode === 'dispatch' && options.openDispatchFolder !== true) {
      openCommandPaletteForSession(session);
      return;
    }
    openTerminalTab(session, options);
  }, [openCommandPaletteForSession, openTerminalTab]);

  const launchSessionWithAgent = useCallback(async (session, agentId, options = {}) => {
    if (!session) return;
    const profile = await getProfileForPath(session.path);
    const launch = resolveSessionLaunch(session, profile, agentId);
    const initialInput = sanitizeStagedTerminalInput(options.initialInput || '');

    if (launch.mode === 'dispatch') {
      if (!initialInput) {
        openTerminalTab(session, { launchFresh: options.launchFresh === true });
        return;
      }

      const agentName = session.agent?.name || session.name;
      const targetRepo = options.targetRepo || '';
      const projectName = options.projectName || projectNameFromPath(targetRepo);
      const dispatchMode = options.dispatchMode === 'direct' ? 'direct' : 'brokered';
      const runBase = {
        agentName,
        agentDisplayName: session.name,
        runtime: launch.runtime,
        targetRepo,
        projectName,
        mode: dispatchMode,
      };

      try {
        if (dispatchMode === 'direct') {
          const payload = await window.nockTerminal.dispatch.createPayload({
            agentName,
            runtime: launch.runtime,
            taskDescription: initialInput,
            targetRepo,
            projectName,
            scriptPath: launch.directScriptPath || launch.scriptPath,
            agentBound: launch.directAgentBound === true,
          });
          if (payload?.success === false) {
            throw new Error(payload.error || 'Dispatch payload validation failed');
          }
          openTab({
            id: createTabId(),
            sessionId: session.id,
            title: `${session.name} Dispatch`,
            branch: session.branch,
            status: 'active',
            cwd: launch.cwd,
            splitContent: null,
            splitRatio: 0.5,
            launchCommand: payload.command,
            initialInput: '',
            agentId: launch.agentId,
          }, {
            project: `${session.name} Dispatch`,
            shell: payload.command,
            cwd: launch.cwd || undefined,
          });
          recordDispatchRun({
            ...runBase,
            status: 'launched',
            requestId: payload.request?.requestId,
            payloadFile: payload.filePath,
            command: payload.command,
          });
          return;
        }

        const result = await window.nockTerminal.dispatch.brokered({
          agentName,
          runtime: launch.runtime,
          taskDescription: initialInput,
          targetRepo,
          projectName,
          brokerAgent: launch.broker,
        });
        if (result?.success === false) {
          throw new Error(result.error || 'Brokered dispatch validation failed');
        }
        recordDispatchRun({
          ...runBase,
          mode: 'brokered',
          status: 'sent',
          requestId: result?.requestId,
          messageId: result?.messageId,
          broker: result?.broker || launch.broker,
        });
      } catch (err) {
        const message = err?.message || 'Dispatch request failed';
        recordDispatchRun({
          ...runBase,
          status: 'failed',
          error: message,
          broker: launch.broker,
        });
        showDispatchError(message);
      }
      return;
    }

    if (!canRunResolvedLaunch(launch)) {
      openTerminalTab(session, {
        launchFresh: options.launchFresh === true,
        initialInput,
        openFolderOnly: true,
      });
      return;
    }

    openTab({
      id: createTabId(),
      sessionId: session.id,
      title: launch.title,
      branch: session.branch,
      status: 'active',
      cwd: launch.cwd,
      splitContent: null,
      splitRatio: 0.5,
      launchCommand: launch.command,
      initialInput,
      agentId: launch.agentId,
    }, {
      project: launch.title,
      shell: launch.command,
      cwd: launch.cwd || undefined,
    });
  }, [getProfileForPath, openTab, openTerminalTab, recordDispatchRun]);

  const executePrompt = useCallback((promptText) => {
    const text = typeof promptText === 'string' ? promptText.trim() : '';
    if (!text) return;
    setChatOpen(true);
    queuedPromptIdRef.current += 1;
    setQueuedPrompt({ id: queuedPromptIdRef.current, text });
  }, []);

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
      // Ctrl+K / Cmd+K: Command launcher
      if (isCtrl && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        setCommandPaletteOpen(prev => {
          if (prev) return false;
          setCommandPalettePreset(null);
          return true;
        });
      }
      // Ctrl+`: Toggle terminal focus
      if (isCtrl && e.key === '`') {
        e.preventDefault();
        if (view !== 'terminal' && tabs.length > 0) {
          setView('terminal');
        }
      }
      // F11: Toggle maximize
      if (e.key === 'F11') {
        e.preventDefault();
        window.nockTerminal.window.maximize();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, openNewTab, closeTab, closeSplit, toggleTerminalSplit, view]);

  const getSessionStatus = useCallback((tabId) => {
    const proc = processStatus[tabId];
    const lastData = lastDataTimestamps[tabId] || 0;
    const hasAgent = proc?.hasClaude || (Array.isArray(proc?.activeAgents) && proc.activeAgents.length > 0);
    if (!hasAgent) return 'inactive';
    if (Date.now() - lastData < 2000) return 'active';
    return 'ready';
  }, [processStatus, lastDataTimestamps]);

  const ctrlPFocusRef = useRef(null);

  // File tree path: active tab's cwd, or fall back to first session's path
  const activeProjectPath = activeTab?.cwd || sessions[0]?.path || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-nock-bg overflow-hidden">
      <TitleBar
        sessionCount={sessions.length}
        activeCount={sessions.filter(s => s.status === 'active').length}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(prev => !prev)}
          sessions={sessions}
          activePorts={activePorts}
          onSessionClick={openSession}
          onPortClick={(port) => window.nockTerminal.shell.openExternal(port.url)}
          onRefresh={refreshSessions}
          activeView={view}
          onViewChange={setView}
          activeProjectPath={activeProjectPath}
          onFileClick={openFileInEditor}
          onCtrlPFocus={(fn) => { ctrlPFocusRef.current = fn; }}
          onExecutePrompt={executePrompt}
          onOpenCommandPalette={openCommandPalette}
        />

        {/* Main content — all views always mounted, visibility controlled by CSS */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Dashboard */}
          <div className={`absolute inset-0 ${view === 'dashboard' ? 'flex flex-col z-10' : 'invisible pointer-events-none z-0'}`}>
            <Dashboard
              sessions={sessions}
              onSessionClick={openSession}
              onLaunchAgentFresh={launchAgentFresh}
              onNewTerminal={openNewTab}
              onRefresh={refreshSessions}
              onOpenSettings={() => setView('settings')}
              activeProjectPath={activeProjectPath}
              ollamaStatus={ollamaStatus}
              tabs={tabs}
              processStatus={processStatus}
              lastDataTimestamps={lastDataTimestamps}
              profilesByPath={profilesByPath}
              dispatchRuns={dispatchRuns}
              onOpenCommandPalette={openCommandPalette}
              onLaunchSessionWithAgent={launchSessionWithAgent}
            />
          </div>

          {/* Terminal area — uses visibility:hidden (not display:none) so xterm canvas stays alive */}
          <div className={`absolute inset-0 flex flex-col ${view === 'terminal' ? 'z-10' : 'invisible pointer-events-none z-0'}`}>
            <div className="flex items-center border-b border-nock-border shrink-0">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={(id) => setActiveTabId(id)}
                onTabClose={closeTab}
                onNewTab={openNewTab}
                getSessionStatus={getSessionStatus}
                onTabRename={renameTab}
                onTabPin={pinTab}
                onTabDuplicate={duplicateTab}
                onSplit={toggleTerminalSplit}
                onTabReorder={reorderTabs}
              />
              <ActionToolbar
                onSplit={toggleTerminalSplit}
                onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
                onToggleChat={() => setChatOpen(prev => !prev)}
                onDashboard={() => setView('dashboard')}
                onOpenCommandPalette={openCommandPalette}
                sidebarOpen={!sidebarCollapsed}
                chatOpen={chatOpen}
                hasSplit={!!activeTab?.splitContent}
                cwd={activeTab?.cwd}
              />
            </div>
            <div className="flex-1 overflow-hidden relative">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`absolute inset-0 ${tab.id === activeTabId ? 'flex z-10' : 'invisible pointer-events-none z-0'}`}
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
                        <EditorPane
                          files={tab.splitContent.files}
                          activeFile={tab.splitContent.activeFile}
                          onActiveFileChange={setActiveEditorFile}
                          onClose={closeSplit}
                          onCloseFile={closeEditorFile}
                          onUnsavedFilesChange={(unsavedFiles) => updateEditorUnsavedFiles(tab.id, unsavedFiles)}
                        />
                      ) : null
                    }
                  >
                    <TerminalView
                      tabId={tab.id}
                      cwd={tab.cwd}
                      active={tab.id === activeTabId && view === 'terminal'}
                      launchCommand={tab.launchCommand}
                      initialInput={tab.initialInput}
                    />
                  </SplitPane>
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
          <div className={`absolute inset-0 overflow-y-auto ${view === 'settings' ? 'z-10' : 'invisible pointer-events-none z-0'}`}>
            <Settings />
          </div>
        </div>

        {/* AI Chat Panel */}
        <div className={chatOpen ? '' : 'hidden'}>
          <AIChatPanel
            onClose={() => setChatOpen(false)}
            activeSession={activeTab}
            onOpenTerminalWithClaude={openTerminalWithClaude}
            queuedPrompt={queuedPrompt}
            onQueuedPromptHandled={(handledPromptId) => {
              setQueuedPrompt((currentPrompt) => (
                currentPrompt?.id === handledPromptId ? null : currentPrompt
              ));
            }}
          />
        </div>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        sessions={sessions}
        profilesByPath={profilesByPath}
        activeProjectPath={activeProjectPath}
        preset={commandPalettePreset}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenSession={openSession}
        onLaunchSessionWithAgent={launchSessionWithAgent}
        onNewTerminal={openNewTab}
        onOpenSettings={() => setView('settings')}
      />

      {notice && (
        <div
          className="fixed right-4 top-14 z-[80] flex max-w-md items-start gap-3 border border-red-500/30 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold tracking-wide">{notice.title}</div>
            <div className="mt-1 break-words text-red-100/85">{notice.message}</div>
          </div>
          <button
            type="button"
            className="min-h-7 min-w-7 text-red-200 hover:text-white"
            onClick={() => setNotice(null)}
            aria-label="Dismiss dispatch error"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Status Bar */}
      <StatusBar
        activeTab={activeTab}
        sessions={sessions}
        ollamaStatus={ollamaStatus}
        processStatus={processStatus}
      />

      {/* Chat toggle button (when closed) */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-4 right-4 w-12 h-12 rounded-full nock-gradient-bg flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity z-50"
          title="Open AI Chat (Ctrl+Shift+A)"
          aria-label="Open AI Chat (Ctrl+Shift+A)"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

export default function App() {
  const [view, setView] = useState('dashboard'); // dashboard | terminal | settings
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activePorts, setActivePorts] = useState([]);
  const [processStatus, setProcessStatus] = useState({});
  const [lastDataTimestamps, setLastDataTimestamps] = useState({});
  const [ollamaStatus, setOllamaStatus] = useState(false);

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

  // Open a terminal tab for a session
  const openTerminalTab = useCallback((session) => {
    const existingTab = tabs.find(t => t.sessionId === session.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setView('terminal');
      return;
    }

    const tabId = `tab-${Date.now()}`;
    const newTab = {
      id: tabId,
      sessionId: session.id,
      title: session.name,
      branch: session.branch,
      status: session.status,
      cwd: session.path,
      splitContent: null,
      splitRatio: 0.5,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    setView('terminal');
    window.nockTerminal.sessionHistory.start(tabId, { project: session.name, shell: '', cwd: session.path });
  }, [tabs]);

  // Open a new blank terminal
  const openNewTab = useCallback((cwd) => {
    const tabId = `tab-${Date.now()}`;
    const newTab = {
      id: tabId,
      sessionId: null,
      title: 'Terminal',
      branch: null,
      status: 'active',
      cwd: cwd || undefined,
      splitContent: null,
      splitRatio: 0.5,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    setView('terminal');
    window.nockTerminal.sessionHistory.start(tabId, { project: 'Terminal', shell: '', cwd: cwd || undefined });
  }, []);

  // Open a new terminal tab with Claude Code launched
  const openTerminalWithClaude = useCallback((cwd) => {
    const tabId = `tab-${Date.now()}`;
    const newTab = {
      id: tabId,
      sessionId: null,
      title: 'Kit (Claude)',
      branch: null,
      status: 'active',
      cwd: cwd || undefined,
      splitContent: null,
      splitRatio: 0.5,
      launchCommand: 'claude',
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    setView('terminal');
    window.nockTerminal.sessionHistory.start(tabId, { project: 'Kit (Claude)', shell: 'claude', cwd: cwd || undefined });
  }, []);

  const closeTab = useCallback((tabId) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (tab?.pinned) return prev; // Don't close pinned tabs
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        if (filtered.length > 0) {
          setActiveTabId(filtered[filtered.length - 1].id);
        } else {
          setActiveTabId(null);
          setView('dashboard');
        }
      }
      return filtered;
    });
    // Destroy the terminal process (only if not pinned — the setTabs above is a no-op for pinned)
    const tab = tabs.find(t => t.id === tabId);
    if (!tab?.pinned) {
      window.nockTerminal.terminal.destroy(tabId);
    }
  }, [activeTabId, tabs]);

  const renameTab = useCallback((tabId, title) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  const pinTab = useCallback((tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, pinned: !t.pinned } : t));
  }, []);

  const duplicateTab = useCallback((tab) => {
    const tabId = `tab-${Date.now()}`;
    const newTab = { ...tab, id: tabId, pinned: false };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  }, []);

  const reorderTabs = useCallback((dragId, targetId) => {
    setTabs(prev => {
      const arr = [...prev];
      const dragIdx = arr.findIndex(t => t.id === dragId);
      const targetIdx = arr.findIndex(t => t.id === targetId);
      if (dragIdx === -1 || targetIdx === -1) return prev;
      const [dragged] = arr.splice(dragIdx, 1);
      arr.splice(targetIdx, 0, dragged);
      return arr;
    });
  }, []);

  const openFileInEditor = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const existingFiles = tab.splitContent?.type === 'editor' ? tab.splitContent.files : [];
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

  const toggleTerminalSplit = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      if (tab.splitContent?.type === 'terminal') {
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

  const updateSplitRatio = useCallback((ratio) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => tab.id === activeTabId ? { ...tab, splitRatio: ratio } : tab));
  }, [activeTabId]);

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
    if (!proc?.hasClaude) return 'inactive';
    if (Date.now() - lastData < 2000) return 'active';
    return 'ready';
  }, [processStatus, lastDataTimestamps]);

  const ctrlPFocusRef = useRef(null);

  const activeTab = tabs.find(t => t.id === activeTabId);

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
          onSessionClick={openTerminalTab}
          onPortClick={(port) => window.nockTerminal.shell.openExternal(port.url)}
          onRefresh={refreshSessions}
          activeView={view}
          onViewChange={setView}
          activeProjectPath={activeProjectPath}
          onFileClick={openFileInEditor}
          onCtrlPFocus={(fn) => { ctrlPFocusRef.current = fn; }}
        />

        {/* Main content — all views always mounted, visibility controlled by CSS */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Dashboard */}
          <div className={`absolute inset-0 ${view === 'dashboard' ? 'flex flex-col z-10' : 'invisible pointer-events-none z-0'}`}>
            <Dashboard
              sessions={sessions}
              onSessionClick={openTerminalTab}
              onNewTerminal={openNewTab}
              onRefresh={refreshSessions}
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
                sidebarOpen={!sidebarCollapsed}
                chatOpen={chatOpen}
                hasSplit={!!activeTab?.splitContent}
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
                        />
                      ) : null
                    }
                  >
                    <TerminalView
                      tabId={tab.id}
                      cwd={tab.cwd}
                      active={tab.id === activeTabId && view === 'terminal'}
                      launchCommand={tab.launchCommand}
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
          />
        </div>
      </div>

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
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}
    </div>
  );
}

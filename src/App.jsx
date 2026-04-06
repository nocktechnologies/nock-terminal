import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TabBar from './components/TabBar';
import ActionToolbar from './components/ActionToolbar';
import TerminalView from './components/TerminalView';
import SplitPane from './components/SplitPane';
import AIChatPanel from './components/AIChatPanel';
import Settings from './components/Settings';

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
      cwd: cwd || 'C:\\Users\\kkwil',
      splitContent: null,
      splitRatio: 0.5,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    setView('terminal');
  }, []);

  const closeTab = useCallback((tabId) => {
    setTabs(prev => {
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
    // Destroy the terminal process
    window.nockTerminal.terminal.destroy(tabId);
  }, [activeTabId]);

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
      // Ctrl+T: New tab
      if (e.ctrlKey && e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        openNewTab();
      }
      // Ctrl+W: Close active tab
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
      // Ctrl+1-9: Switch tabs
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (tabs[index]) {
          setActiveTabId(tabs[index].id);
          setView('terminal');
        }
      }
      // Ctrl+Shift+A: Toggle AI chat
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setChatOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, openNewTab, closeTab]);

  const getSessionStatus = useCallback((tabId) => {
    const proc = processStatus[tabId];
    const lastData = lastDataTimestamps[tabId] || 0;
    if (!proc?.hasClaude) return 'inactive';
    if (Date.now() - lastData < 2000) return 'active';
    return 'ready';
  }, [processStatus, lastDataTimestamps]);

  const ctrlPFocusRef = useRef(null);

  const activeTab = tabs.find(t => t.id === activeTabId);

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
          activeProjectPath={activeTab?.cwd || null}
          onFileClick={openFileInEditor}
          onCtrlPFocus={(fn) => { ctrlPFocusRef.current = fn; }}
        />

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
            <div className="flex items-center border-b border-nock-border shrink-0">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={(id) => setActiveTabId(id)}
                onTabClose={closeTab}
                onNewTab={openNewTab}
                getSessionStatus={getSessionStatus}
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
                          Editor — will be connected in Task 8
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

        {/* AI Chat Panel */}
        <div className={chatOpen ? '' : 'hidden'}>
          <AIChatPanel
            onClose={() => setChatOpen(false)}
            activeSession={activeTab}
          />
        </div>
      </div>

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

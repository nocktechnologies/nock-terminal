import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TabBar from './components/TabBar';
import TerminalView from './components/TerminalView';
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

  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="h-screen w-screen flex flex-col bg-nock-bg overflow-hidden">
      <TitleBar />

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
        />

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

        {/* AI Chat Panel */}
        {chatOpen && (
          <AIChatPanel
            onClose={() => setChatOpen(false)}
            activeSession={activeTab}
          />
        )}
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

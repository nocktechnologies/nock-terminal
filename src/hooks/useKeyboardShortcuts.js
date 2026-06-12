import { useEffect } from 'react';

// Global keydown shortcuts for tab management, view switching, and panel
// toggles. Listener re-attaches when tab state changes; setter callbacks from
// useState are stable and intentionally omitted from the dependency list.
export default function useKeyboardShortcuts({
  tabs,
  activeTabId,
  setActiveTabId,
  view,
  setView,
  openNewTab,
  closeTab,
  closeSplit,
  toggleTerminalSplit,
  setChatOpen,
  setSidebarCollapsed,
  setCommandPaletteOpen,
  setCommandPalettePreset,
  ctrlPFocusRef,
}) {
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
}

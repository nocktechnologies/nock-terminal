import { useState, useCallback, useMemo } from 'react';
import { buildUnsavedFilesMessage } from '../utils/unsavedFiles.mjs';
import {
  sanitizeStagedTerminalInput,
  shouldRunSessionLaunch,
} from '../utils/agentLaunchers.mjs';
import {
  createTabId,
  nextActiveTabId,
  removeTabById,
  reorderTabList,
} from '../utils/tabOps.mjs';

// Owns the terminal tab list, the active tab selection, and every operation
// that creates, closes, or rearranges tabs. Split-pane/editor content inside a
// tab is managed by the caller via the exposed setTabs.
export default function useTabs({ setView }) {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  // Shared append-and-activate path: every tab creation funnels through here
  // so session history always starts exactly once per new tab.
  const openTab = useCallback((tab, history = {}, { show = true } = {}) => {
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    if (show) setView('terminal');
    window.nockTerminal.sessionHistory.start(tab.id, {
      project: history.project ?? tab.title ?? 'Terminal',
      shell: history.shell ?? '',
      cwd: history.cwd !== undefined ? history.cwd : (tab.cwd || undefined),
    });
  }, [setView]);

  // Open a terminal tab for a session or agent folder
  const openTerminalTab = useCallback((session, options = {}) => {
    const launchFresh = options?.launchFresh === true;
    const existingTab = !launchFresh
      ? [...tabs].reverse().find(t => t.sessionId === session.id)
      : null;
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setView('terminal');
      return;
    }

    const isAgent = session.kind === 'agent';
    const launchCommand = shouldRunSessionLaunch(session, options) ? session.launch.command : undefined;
    const initialInput = sanitizeStagedTerminalInput(options?.initialInput || '');
    const cwd = isAgent ? (session.launch?.cwd || session.path) : session.path;
    openTab({
      id: createTabId(),
      sessionId: session.id,
      title: session.name,
      branch: session.branch,
      status: session.status,
      cwd,
      splitContent: null,
      splitRatio: 0.5,
      launchCommand,
      initialInput,
    }, {
      project: session.name,
      shell: launchCommand || '',
      cwd,
    });
  }, [tabs, openTab, setView]);

  const launchAgentFresh = useCallback((session) => {
    openTerminalTab(session, { launchFresh: true });
  }, [openTerminalTab]);

  // Open a new blank terminal
  const openNewTab = useCallback((cwd) => {
    openTab({
      id: createTabId(),
      sessionId: null,
      title: 'Terminal',
      branch: null,
      status: 'active',
      cwd: cwd || undefined,
      splitContent: null,
      splitRatio: 0.5,
    }, { project: 'Terminal', shell: '', cwd: cwd || undefined });
  }, [openTab]);

  // Open a new terminal tab with Claude Code launched
  const openTerminalWithClaude = useCallback(async (cwd) => {
    let launchCommand = 'claude';
    if (cwd) {
      try {
        const profile = await window.nockTerminal.profiles.get(cwd);
        if (profile?.claudeCommand?.trim()) {
          launchCommand = profile.claudeCommand.trim();
        }
      } catch {
        launchCommand = 'claude';
      }
    }

    openTab({
      id: createTabId(),
      sessionId: null,
      title: 'Kit (Claude)',
      branch: null,
      status: 'active',
      cwd: cwd || undefined,
      splitContent: null,
      splitRatio: 0.5,
      launchCommand,
    }, { project: 'Kit (Claude)', shell: launchCommand, cwd: cwd || undefined });
  }, [openTab]);

  const closeTab = useCallback((tabId) => {
    const tabToClose = tabs.find(t => t.id === tabId);
    if (tabToClose?.pinned) return;
    if (tabToClose?.splitContent?.type === 'editor') {
      const message = buildUnsavedFilesMessage(tabToClose.splitContent.unsavedFiles);
      if (message && !window.confirm(message)) return;
    }

    setTabs(prev => {
      const filtered = removeTabById(prev, tabId);
      if (filtered === prev) return prev;
      if (activeTabId === tabId) {
        const nextActive = nextActiveTabId(filtered, tabId, activeTabId);
        setActiveTabId(nextActive);
        if (nextActive === null) setView('dashboard');
      }
      return filtered;
    });
    window.nockTerminal.terminal.destroy(tabId);
  }, [activeTabId, tabs, setView]);

  const renameTab = useCallback((tabId, title) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  const pinTab = useCallback((tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, pinned: !t.pinned } : t));
  }, []);

  const duplicateTab = useCallback((tab) => {
    openTab(
      { ...tab, id: createTabId(), pinned: false, initialInput: '' },
      { project: tab.title || 'Terminal', shell: '', cwd: tab.cwd || undefined },
      { show: false }
    );
  }, [openTab]);

  const reorderTabs = useCallback((dragId, targetId) => {
    setTabs(prev => reorderTabList(prev, dragId, targetId));
  }, []);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);

  return {
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
  };
}

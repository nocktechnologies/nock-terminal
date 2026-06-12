import { useCallback } from 'react';
import { buildUnsavedFilesMessage, normalizeUnsavedFiles } from '../utils/unsavedFiles.mjs';
import { closeEditorFileInTab, openFileInEditorSplit } from '../utils/splitContentOps.mjs';
import { createTabId } from '../utils/tabOps.mjs';

// Split-pane and editor-split operations for the active tab. Owns the
// unsaved-file confirm dialogs and split-terminal destroy side effects;
// the next-tab-shape math lives in utils/splitContentOps.mjs.
export default function useTabSplits({ tabs, setTabs, activeTabId }) {
  const openFileInEditor = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => (
      tab.id === activeTabId ? openFileInEditorSplit(tab, filePath) : tab
    )));
  }, [activeTabId, setTabs]);

  const toggleTerminalSplit = useCallback(() => {
    if (!activeTabId) return;
    const active = tabs.find(t => t.id === activeTabId);
    if (active?.splitContent?.type === 'editor') {
      const message = buildUnsavedFilesMessage(active.splitContent.unsavedFiles);
      if (message && !window.confirm(message)) return;
    }

    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      if (tab.splitContent?.type === 'terminal') {
        window.nockTerminal.terminal.destroy(tab.splitContent.id);
        return { ...tab, splitContent: null };
      }
      const splitId = createTabId(`${tab.id}-split`);
      return {
        ...tab,
        splitContent: { type: 'terminal', id: splitId },
      };
    }));
  }, [activeTabId, tabs, setTabs]);

  const closeSplit = useCallback(() => {
    if (!activeTabId) return;
    const active = tabs.find(t => t.id === activeTabId);
    if (active?.splitContent?.type === 'editor') {
      const message = buildUnsavedFilesMessage(active.splitContent.unsavedFiles);
      if (message && !window.confirm(message)) return;
    }

    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      if (tab.splitContent?.type === 'terminal') {
        window.nockTerminal.terminal.destroy(tab.splitContent.id);
      }
      return { ...tab, splitContent: null };
    }));
  }, [activeTabId, tabs, setTabs]);

  const closeEditorFile = useCallback((filePath) => {
    if (!activeTabId) return;
    const active = tabs.find(t => t.id === activeTabId);
    const unsavedFiles = normalizeUnsavedFiles(active?.splitContent?.unsavedFiles);
    if (unsavedFiles.includes(filePath)) {
      const message = buildUnsavedFilesMessage([filePath]);
      if (message && !window.confirm(message)) return;
    }

    setTabs(prev => prev.map(tab => (
      tab.id === activeTabId ? closeEditorFileInTab(tab, filePath) : tab
    )));
  }, [activeTabId, tabs, setTabs]);

  const updateEditorUnsavedFiles = useCallback((tabId, unsavedFiles) => {
    const normalized = normalizeUnsavedFiles(unsavedFiles);
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId || tab.splitContent?.type !== 'editor') return tab;
      return {
        ...tab,
        splitContent: { ...tab.splitContent, unsavedFiles: normalized },
      };
    }));
  }, [setTabs]);

  const setActiveEditorFile = useCallback((filePath) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId || tab.splitContent?.type !== 'editor') return tab;
      return {
        ...tab,
        splitContent: { ...tab.splitContent, activeFile: filePath },
      };
    }));
  }, [activeTabId, setTabs]);

  const updateSplitRatio = useCallback((ratio) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => tab.id === activeTabId ? { ...tab, splitRatio: ratio } : tab));
  }, [activeTabId, setTabs]);

  return {
    openFileInEditor,
    toggleTerminalSplit,
    closeSplit,
    closeEditorFile,
    updateEditorUnsavedFiles,
    setActiveEditorFile,
    updateSplitRatio,
  };
}

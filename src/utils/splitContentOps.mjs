import { normalizeUnsavedFiles } from './unsavedFiles.mjs';

// Pure transforms for a tab's splitContent. Callers own confirm dialogs and
// terminal-destroy side effects; these only compute the next tab shape.

export function openFileInEditorSplit(tab, filePath) {
  const existingFiles = tab.splitContent?.type === 'editor' ? tab.splitContent.files : [];
  if (existingFiles.includes(filePath)) {
    return {
      ...tab,
      splitContent: { ...tab.splitContent, type: 'editor', files: existingFiles, activeFile: filePath },
    };
  }
  return {
    ...tab,
    splitContent: {
      ...(tab.splitContent?.type === 'editor' ? tab.splitContent : {}),
      type: 'editor',
      files: [...existingFiles, filePath],
      activeFile: filePath,
    },
  };
}

export function closeEditorFileInTab(tab, filePath) {
  if (tab.splitContent?.type !== 'editor') return tab;
  const remaining = tab.splitContent.files.filter(f => f !== filePath);
  if (remaining.length === 0) {
    return { ...tab, splitContent: null };
  }
  const activeFile = tab.splitContent.activeFile === filePath
    ? remaining[remaining.length - 1]
    : tab.splitContent.activeFile;
  const remainingUnsaved = normalizeUnsavedFiles(tab.splitContent.unsavedFiles)
    .filter(f => f !== filePath);
  return {
    ...tab,
    splitContent: { ...tab.splitContent, files: remaining, activeFile, unsavedFiles: remainingUnsaved },
  };
}

import React, { useEffect, useRef, useState } from 'react';

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
  const modelsRef = useRef({});
  const activeFileRef = useRef(activeFile);
  const [loading, setLoading] = useState(true);
  const [fileContents, setFileContents] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [, forceUpdate] = useState(0);

  // Keep ref in sync so Monaco command closure reads current value
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  useEffect(() => {
    let cancelled = false;
    const loadMonaco = async () => {
      const monaco = await import('monaco-editor');
      if (cancelled) return;
      monacoRef.current = monaco;

      monaco.editor.defineTheme('nock-dark', NOCK_DARK_THEME);

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

        editorRef.current.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => {
            const file = activeFileRef.current;
            if (!file || !modelsRef.current[file]) return;
            const entry = modelsRef.current[file];
            const content = entry.model.getValue();
            window.nockTerminal.files.write(file, content).then(result => {
              if (result.success) {
                entry.modified = false;
                setSaveError(null);
                forceUpdate(n => n + 1);
              } else {
                console.error('Save failed:', result.error);
                setSaveError(result.error);
              }
            }).catch(err => {
              console.error('Save IPC error:', err);
              setSaveError(err.message);
            });
          }
        );
      }
      setLoading(false);
    };
    loadMonaco();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const loadNewFiles = async () => {
      for (const filePath of files) {
        if (fileContents[filePath]) continue;
        try {
          const result = await window.nockTerminal.files.read(filePath);
          setFileContents(prev => ({ ...prev, [filePath]: result }));
        } catch (err) {
          console.error(`Failed to load file ${filePath}:`, err);
          setFileContents(prev => ({ ...prev, [filePath]: { error: err.message } }));
        }
      }
    };
    loadNewFiles();
  }, [files]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFile) return;
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const content = fileContents[activeFile];
    if (!content || content.error) return;

    const currentModel = editor.getModel();
    if (currentModel) {
      const currentPath = Object.keys(modelsRef.current).find(
        p => modelsRef.current[p].model === currentModel
      );
      if (currentPath) {
        modelsRef.current[currentPath].viewState = editor.saveViewState();
      }
    }

    if (!modelsRef.current[activeFile]) {
      const ext = activeFile.split('.').pop()?.toLowerCase() || '';
      const language = EXT_TO_LANG[ext] || 'plaintext';
      const model = monaco.editor.createModel(content.content, language);

      model.onDidChangeContent(() => {
        modelsRef.current[activeFile].modified = true;
        forceUpdate(n => n + 1);
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

  useEffect(() => {
    const openPaths = new Set(files);
    for (const [path, entry] of Object.entries(modelsRef.current)) {
      if (!openPaths.has(path)) {
        entry.model.dispose();
        delete modelsRef.current[path];
      }
    }
  }, [files]);

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

      {fileContents[activeFile]?.readOnly && (
        <div className="px-3 py-1.5 bg-nock-yellow/10 border-b border-nock-yellow/20 text-[10px] text-nock-yellow font-mono">
          This file is too large to edit (read-only)
        </div>
      )}

      {fileContents[activeFile]?.error && (
        <div className="px-3 py-1.5 bg-red-400/10 border-b border-red-400/20 text-[10px] text-red-400 font-mono">
          {fileContents[activeFile].error}
        </div>
      )}

      {saveError && (
        <div className="px-3 py-1.5 bg-red-400/10 border-b border-red-400/20 text-[10px] text-red-400 font-mono flex items-center justify-between">
          <span>Save failed: {saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-300 ml-2">✕</button>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center text-nock-text-muted text-sm">
          Loading editor...
        </div>
      )}

      <div ref={containerRef} className={`flex-1 ${loading ? 'hidden' : ''}`} />

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

import React, { useState, useEffect } from 'react';

export default function Settings() {
  const [settings, setSettings] = useState({
    ollamaUrl: 'http://localhost:11434',
    claudeCodePath: '',
    maraBriefPath: '',
    terminalFontSize: 14,
    launchAtStartup: false,
    devRoots: [],
    projectSkipList: [],
  });
  const [saved, setSaved] = useState(false);
  // Local draft state for multi-line textareas (committed on blur, not per-keystroke)
  const [devRootsDraft, setDevRootsDraft] = useState('');
  const [skipListDraft, setSkipListDraft] = useState('');

  useEffect(() => {
    window.nockTerminal.settings.getAll().then(all => {
      setSettings(prev => ({ ...prev, ...all }));
      setDevRootsDraft((all.devRoots || []).join('\n'));
      setSkipListDraft((all.projectSkipList || []).join('\n'));
    });
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    window.nockTerminal.settings.set(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Parse multi-line textarea → array on blur (not on every keystroke)
  const commitListSetting = (key, draft) => {
    const parsed = draft.split('\n').map(s => s.trim()).filter(Boolean);
    updateSetting(key, parsed);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Editorial header */}
      <div className="relative border-b border-nock-border px-8 py-7">
        <span className="font-mono text-[10px] text-nock-accent-cyan tracking-widest uppercase block mb-2">
          // Configuration
        </span>
        <h1 className="font-display font-bold text-4xl tracking-tight leading-none nock-gradient-text">
          Settings
        </h1>
        <p className="font-mono text-xs text-nock-text-dim mt-2 tracking-wide">
          Persistence via electron-store · applied on save
        </p>
        {saved && (
          <div className="absolute top-7 right-8 px-3 py-1.5 bg-nock-green/10 border border-nock-green/30 rounded font-mono text-[10px] text-nock-green tracking-wider uppercase animate-fade-in">
            ● Saved
          </div>
        )}
      </div>

      <div className="px-8 py-6 max-w-3xl">
        <Section num="01" title="Projects">
          <Field
            label="Dev Root Directories"
            description="One path per line. Git repos in these folders auto-appear on the dashboard."
          >
            <textarea
              rows={3}
              value={devRootsDraft}
              onChange={(e) => setDevRootsDraft(e.target.value)}
              onBlur={() => commitListSetting('devRoots', devRootsDraft)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono resize-none focus:outline-none focus:border-nock-accent-blue"
              placeholder="C:\Dev"
            />
          </Field>
          <Field
            label="Hidden Projects"
            description="Folder names to hide (case-insensitive, one per line)."
          >
            <textarea
              rows={3}
              value={skipListDraft}
              onChange={(e) => setSkipListDraft(e.target.value)}
              onBlur={() => commitListSetting('projectSkipList', skipListDraft)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono resize-none focus:outline-none focus:border-nock-accent-blue"
              placeholder="Gym-App"
            />
          </Field>
        </Section>

        <Section num="02" title="Ollama">
          <Field
            label="Ollama URL"
            description="Local: http://localhost:11434 · Remote: http://100.67.243.87:11434"
          >
            <input
              type="text"
              value={settings.ollamaUrl}
              onChange={(e) => updateSetting('ollamaUrl', e.target.value)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
              placeholder="http://localhost:11434"
            />
          </Field>
        </Section>

        <Section num="03" title="Claude Code">
          <Field label="Binary Path" description="Leave empty for auto-detection.">
            <input
              type="text"
              value={settings.claudeCodePath}
              onChange={(e) => updateSetting('claudeCodePath', e.target.value)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
              placeholder="Auto-detect"
            />
          </Field>
          <Field label="Mara Brief File" description="Prepended to messages in Mara mode.">
            <input
              type="text"
              value={settings.maraBriefPath}
              onChange={(e) => updateSetting('maraBriefPath', e.target.value)}
              className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
              placeholder="C:\path\to\mara-brief.md"
            />
          </Field>
        </Section>

        <Section num="04" title="Terminal">
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

        <Section num="05" title="General">
          <Field label="Launch at Startup">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.launchAtStartup}
                onChange={(e) => updateSetting('launchAtStartup', e.target.checked)}
                className="w-4 h-4 rounded border-nock-border bg-nock-card accent-[#3B6FD4]"
              />
              <span className="text-sm text-nock-text">Start Nock Terminal with Windows</span>
            </label>
          </Field>
        </Section>

        <Section num="06" title="Shortcuts">
          <div className="space-y-2.5">
            <Shortcut keys="Ctrl+T" action="New terminal tab" />
            <Shortcut keys="Ctrl+W" action="Close active tab" />
            <Shortcut keys="Ctrl+1-9" action="Switch to tab N" />
            <Shortcut keys="Ctrl+Shift+A" action="Toggle AI chat panel" />
            <Shortcut keys="Ctrl+Shift+T" action="Toggle window (global)" />
            <Shortcut keys="Ctrl+C" action="Copy (when selection exists, else SIGINT)" />
            <Shortcut keys="Ctrl+V" action="Paste from clipboard" />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ num, title, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[10px] text-nock-accent-cyan tracking-widest">
          {num}
        </span>
        <h2 className="font-display font-semibold text-[13px] text-nock-text uppercase tracking-widest">
          {title}
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-nock-border to-transparent" />
      </div>
      <div className="space-y-5 bg-nock-card/40 border border-nock-border rounded-lg p-5">
        {children}
      </div>
    </div>
  );
}

function Field({ label, description, children }) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-medium text-nock-text mb-1 tracking-wider uppercase">
        {label}
      </label>
      {description && (
        <p className="text-[10px] text-nock-text-muted mb-2 font-mono tracking-tight">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

function Shortcut({ keys, action }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-nock-text-dim">{action}</span>
      <kbd>{keys}</kbd>
    </div>
  );
}

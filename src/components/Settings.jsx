import React, { useState, useEffect } from 'react';

export default function Settings() {
  const [settings, setSettings] = useState({
    ollamaUrl: 'http://localhost:11434',
    claudeCodePath: '',
    maraBriefPath: '',
    terminalFontSize: 14,
    launchAtStartup: false,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const all = await window.nockTerminal.settings.getAll();
      setSettings(prev => ({ ...prev, ...all }));
    };
    load();
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    window.nockTerminal.settings.set(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <h1 className="text-2xl font-bold nock-gradient-text mb-6">Settings</h1>

      {/* Saved indicator */}
      {saved && (
        <div className="mb-4 px-3 py-2 bg-nock-green/10 border border-nock-green/30 rounded text-xs text-nock-green">
          Settings saved
        </div>
      )}

      {/* Ollama */}
      <Section title="Ollama">
        <Field
          label="Ollama URL"
          description="Local: http://localhost:11434 | Remote: http://100.67.243.87:11434"
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

      {/* Claude Code */}
      <Section title="Claude Code">
        <Field
          label="Binary Path"
          description="Leave empty for auto-detection. Set if claude is not in PATH."
        >
          <input
            type="text"
            value={settings.claudeCodePath}
            onChange={(e) => updateSetting('claudeCodePath', e.target.value)}
            className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
            placeholder="Auto-detect"
          />
        </Field>
        <Field
          label="Mara Brief File"
          description="Path to mara-brief.md — prepended to messages in Mara mode."
        >
          <input
            type="text"
            value={settings.maraBriefPath}
            onChange={(e) => updateSetting('maraBriefPath', e.target.value)}
            className="w-full bg-nock-card border border-nock-border rounded px-3 py-2 text-sm text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue"
            placeholder="C:\path\to\mara-brief.md"
          />
        </Field>
      </Section>

      {/* Terminal */}
      <Section title="Terminal">
        <Field label="Font Size">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="10"
              max="24"
              value={settings.terminalFontSize}
              onChange={(e) => updateSetting('terminalFontSize', parseInt(e.target.value))}
              className="flex-1 accent-[#3B6FD4]"
            />
            <span className="text-sm text-nock-text font-mono w-8 text-right">
              {settings.terminalFontSize}
            </span>
          </div>
        </Field>
      </Section>

      {/* General */}
      <Section title="General">
        <Field label="Launch at Startup">
          <label className="flex items-center gap-2 cursor-pointer">
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

      {/* Keyboard shortcuts reference */}
      <Section title="Keyboard Shortcuts">
        <div className="space-y-2">
          <Shortcut keys="Ctrl+T" action="New terminal tab" />
          <Shortcut keys="Ctrl+W" action="Close active tab" />
          <Shortcut keys="Ctrl+1-9" action="Switch to tab N" />
          <Shortcut keys="Ctrl+Shift+A" action="Toggle AI chat panel" />
          <Shortcut keys="Ctrl+Shift+T" action="Toggle window (global)" />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-nock-text mb-3 uppercase tracking-wider">{title}</h2>
      <div className="space-y-4 bg-nock-card border border-nock-border rounded-lg p-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, description, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-nock-text mb-1">{label}</label>
      {description && (
        <p className="text-[10px] text-nock-text-dim mb-2">{description}</p>
      )}
      {children}
    </div>
  );
}

function Shortcut({ keys, action }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-nock-text-dim">{action}</span>
      <kbd className="px-2 py-0.5 bg-nock-bg border border-nock-border rounded text-[10px] font-mono text-nock-text">
        {keys}
      </kbd>
    </div>
  );
}

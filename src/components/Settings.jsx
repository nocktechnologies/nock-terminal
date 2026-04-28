import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings2, Cpu, TerminalSquare, Code2, FolderTree,
  Bell, Send, Keyboard, Database, Info,
  ChevronDown, RotateCcw, Download, Upload, ExternalLink,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Section metadata — drives the left sidebar nav
// ---------------------------------------------------------------------------
const SECTIONS = [
  { id: 'general',       label: 'General',       icon: Settings2 },
  { id: 'ai',            label: 'AI / Models',   icon: Cpu },
  { id: 'terminal',      label: 'Terminal',       icon: TerminalSquare },
  { id: 'editor',        label: 'Editor',         icon: Code2 },
  { id: 'filetree',      label: 'File Tree',      icon: FolderTree },
  { id: 'notifications', label: 'Notifications',  icon: Bell },
  { id: 'telegram',      label: 'Telegram',       icon: Send },
  { id: 'shortcuts',     label: 'Shortcuts',      icon: Keyboard },
  { id: 'data',          label: 'Data',           icon: Database },
  { id: 'about',         label: 'About',          icon: Info },
];

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------

function SettingsSection({ title, description, children }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-semibold text-base text-nock-text mb-1">{title}</h2>
      {description && (
        <p className="text-xs text-nock-text-muted mb-4 font-mono">{description}</p>
      )}
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, description, children }) {
  return (
    <div className="bg-nock-card/40 border border-nock-border rounded-lg p-4">
      <label className="block font-mono text-[11px] font-medium text-nock-text mb-0.5 tracking-wider uppercase">
        {label}
      </label>
      {description && (
        <p className="text-[10px] text-nock-text-muted mb-2 font-mono tracking-tight">{description}</p>
      )}
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-nock-accent-blue ${
          checked
            ? 'bg-nock-accent-blue border-nock-accent-blue'
            : 'bg-nock-card border-nock-border group-hover:border-nock-border-bright'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      {label && <span className="text-sm text-nock-text">{label}</span>}
    </label>
  );
}

function Slider({ min, max, step = 1, value, onChange, suffix = '' }) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-nock-accent-blue"
      />
      <span className="font-mono text-sm text-nock-text tabular-nums w-16 text-right">
        {value}{suffix}
      </span>
    </div>
  );
}

function Select({ value, onChange, options, disabled = false }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`settings-input font-mono ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-nock-border/50 last:border-b-0">
      <span className="text-xs text-nock-text-dim">{label}</span>
      <span className={`text-xs text-nock-text ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Shortcut({ keys, action }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-nock-text-dim">{action}</span>
      <kbd>{keys}</kbd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Settings Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const [activeSection, setActiveSection] = useState('general');
  const [settings, setSettings] = useState({});
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);

  // About-section data
  const [appVersion, setAppVersion] = useState('...');
  const [ollamaVersion, setOllamaVersion] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [shells, setShells] = useState([]);

  // Draft state for multi-line textareas (committed on blur)
  const [devRootsDraft, setDevRootsDraft] = useState('');
  const [skipListDraft, setSkipListDraft] = useState('');
  const [systemPromptDraft, setSystemPromptDraft] = useState('');
  const [shellArgsDraft, setShellArgsDraft] = useState('');

  // -----------------------------------------------------------------------
  // Load settings once
  // -----------------------------------------------------------------------
  useEffect(() => {
    window.nockTerminal.settings.getAll().then((all) => {
      setSettings(all);
      setDevRootsDraft((all.devRoots || []).join('\n'));
      setSkipListDraft((all.projectSkipList || []).join('\n'));
      setSystemPromptDraft(all.systemPrompt || '');
      setShellArgsDraft(all.shellArgs || '');
      // Load real bot token (getAll returns redacted placeholder)
      if (window.nockTerminal.settings.getSecure) {
        window.nockTerminal.settings.getSecure('telegramBotToken').then((token) => {
          if (token) setSettings(prev => ({ ...prev, telegramBotToken: token }));
        });
      }
    });
  }, []);

  // Load system info for About
  useEffect(() => {
    if (window.nockTerminal.system) {
      window.nockTerminal.system.appVersion().then(setAppVersion);
      window.nockTerminal.system.ollamaVersion().then(setOllamaVersion);
      window.nockTerminal.system.detectShells().then(setShells);
    }
    if (window.nockTerminal.ai?.ollama?.models) {
      window.nockTerminal.ai.ollama.models().then((res) => {
        if (res && Array.isArray(res.models)) setOllamaModels(res.models);
        else if (Array.isArray(res)) setOllamaModels(res);
      }).catch(() => {});
    }
  }, []);

  // -----------------------------------------------------------------------
  // Auto-persist helper
  // -----------------------------------------------------------------------
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    window.nockTerminal.settings.set(key, value);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  const commitListSetting = useCallback((key, draft) => {
    const parsed = draft.split('\n').map((s) => s.trim()).filter(Boolean);
    updateSetting(key, parsed);
  }, [updateSetting]);

  const commitTextSetting = useCallback((key, draft) => {
    updateSetting(key, draft);
  }, [updateSetting]);

  // -----------------------------------------------------------------------
  // Data: export / import / reset
  // -----------------------------------------------------------------------
  const exportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nock-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const importSettings = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (typeof imported !== 'object' || imported === null) return;
          Object.entries(imported).forEach(([k, v]) => {
            updateSetting(k, v);
          });
          setDevRootsDraft((imported.devRoots || []).join('\n'));
          setSkipListDraft((imported.projectSkipList || []).join('\n'));
          setSystemPromptDraft(imported.systemPrompt || '');
          setShellArgsDraft(imported.shellArgs || '');
        } catch {
          // Silently ignore invalid JSON
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [updateSetting]);

  const resetDefaults = useCallback(() => {
    if (!window.confirm('Reset all settings to defaults? This cannot be undone.')) return;
    // Clear store and reload — electron-store will repopulate defaults
    window.nockTerminal.settings.getAll().then((all) => {
      Object.keys(all).forEach((key) => {
        if (key === 'windowBounds') return; // preserve window position
        window.nockTerminal.settings.set(key, undefined);
      });
      // Reload to get fresh defaults
      window.location.reload();
    });
  }, []);

  // -----------------------------------------------------------------------
  // Telegram test
  // -----------------------------------------------------------------------
  const [telegramTestStatus, setTelegramTestStatus] = useState(null);
  const testTelegram = useCallback(async () => {
    setTelegramTestStatus('sending...');
    try {
      const result = await window.nockTerminal.telegram.test();
      setTelegramTestStatus(result.success ? 'Sent successfully' : `Error: ${result.error || 'Unknown error'}`);
    } catch (err) {
      setTelegramTestStatus(`Failed: ${err.message}`);
    }
    setTimeout(() => setTelegramTestStatus(null), 4000);
  }, []);

  // -----------------------------------------------------------------------
  // Render section content
  // -----------------------------------------------------------------------
  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <SettingsSection title="General" description="Window behavior and appearance">
            <Field label="Theme" description="App color scheme">
              <Select
                value={settings.theme || 'dark'}
                onChange={(v) => updateSetting('theme', v)}
                options={[
                  { value: 'dark', label: 'Dark (Pitch Black)' },
                ]}
                disabled
              />
            </Field>
            <Field label="Window Opacity" description="Reduce for transparency effect (70%-100%)">
              <Slider
                min={70}
                max={100}
                value={settings.windowOpacity ?? 100}
                onChange={(v) => updateSetting('windowOpacity', Math.round(v))}
                suffix="%"
              />
            </Field>
            <Field label="Always On Top" description="Keep window above other applications">
              <Toggle
                checked={settings.alwaysOnTop ?? false}
                onChange={(v) => updateSetting('alwaysOnTop', v)}
                label="Pin window on top"
              />
            </Field>
            <Field label="Start Minimized" description="Launch to system tray instead of showing window">
              <Toggle
                checked={settings.startMinimized ?? false}
                onChange={(v) => updateSetting('startMinimized', v)}
                label="Start minimized to tray"
              />
            </Field>
            <Field label="Launch at Startup" description="Open at login">
              <Toggle
                checked={settings.launchAtStartup ?? false}
                onChange={(v) => updateSetting('launchAtStartup', v)}
                label="Open at login"
              />
            </Field>
          </SettingsSection>
        );

      case 'ai':
        return (
          <SettingsSection title="AI / Models" description="Ollama and model configuration">
            <Field label="Ollama URL" description="Local: http://localhost:11434 -- Remote: your Tailscale IP">
              <input
                type="text"
                value={settings.ollamaUrl || ''}
                onChange={(e) => updateSetting('ollamaUrl', e.target.value)}
                className="settings-input font-mono"
                placeholder="http://localhost:11434"
              />
            </Field>
            <Field label="Default Model" description="Model used when opening a new AI chat">
              <input
                type="text"
                value={settings.defaultModel || ''}
                onChange={(e) => updateSetting('defaultModel', e.target.value)}
                className="settings-input font-mono"
                placeholder="qwen3.5:9b"
              />
            </Field>
            <Field label="System Prompt" description="Prepended to every AI conversation">
              <textarea
                rows={4}
                value={systemPromptDraft}
                onChange={(e) => setSystemPromptDraft(e.target.value)}
                onBlur={() => commitTextSetting('systemPrompt', systemPromptDraft)}
                className="settings-input font-mono resize-none"
                placeholder="You are a helpful coding assistant..."
              />
            </Field>
            <Field label="Temperature" description="Creativity vs. determinism (0.0 - 2.0)">
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={settings.temperature ?? 0.7}
                onChange={(v) => updateSetting('temperature', Math.round(v * 10) / 10)}
              />
            </Field>
            <Field label="Max Tokens" description="Maximum response length">
              <Slider
                min={256}
                max={32768}
                step={256}
                value={settings.maxTokens ?? 4096}
                onChange={(v) => updateSetting('maxTokens', Math.round(v))}
              />
            </Field>
            <Field label="Show Thinking" description="Display model reasoning tokens when supported">
              <Toggle
                checked={settings.showThinking ?? false}
                onChange={(v) => updateSetting('showThinking', v)}
                label="Show thinking output"
              />
            </Field>
            <Field label="Claude Code Binary" description="Leave empty for auto-detection">
              <input
                type="text"
                value={settings.claudeCodePath || ''}
                onChange={(e) => updateSetting('claudeCodePath', e.target.value)}
                className="settings-input font-mono"
                placeholder="Auto-detect"
              />
            </Field>
            <Field label="Mara Brief File" description="Prepended to messages in Mara mode">
              <input
                type="text"
                value={settings.maraBriefPath || ''}
                onChange={(e) => updateSetting('maraBriefPath', e.target.value)}
                className="settings-input font-mono"
                placeholder="~/.claude/mara-brief.md"
              />
            </Field>
          </SettingsSection>
        );

      case 'terminal':
        return (
          <SettingsSection title="Terminal" description="Shell, font, and behavior settings">
            <Field label="Default Shell" description="Leave empty for system default">
              {shells.length > 0 ? (
                <Select
                  value={settings.defaultShell || ''}
                  onChange={(v) => updateSetting('defaultShell', v)}
                  options={[
                    { value: '', label: 'System Default' },
                    ...shells.map((s) => ({
                      value: s.path,
                      label: `${s.name}${s.version ? ` (${s.version})` : ''}`,
                    })),
                  ]}
                />
              ) : (
                <input
                  type="text"
                  value={settings.defaultShell || ''}
                  onChange={(e) => updateSetting('defaultShell', e.target.value)}
                  className="settings-input font-mono"
                  placeholder="Auto-detect"
                />
              )}
            </Field>
            <Field label="Shell Arguments" description="Extra arguments passed to the shell process">
              <input
                type="text"
                value={shellArgsDraft}
                onChange={(e) => setShellArgsDraft(e.target.value)}
                onBlur={() => commitTextSetting('shellArgs', shellArgsDraft)}
                className="settings-input font-mono"
                placeholder="-NoLogo"
              />
            </Field>
            <Field label="Font Family">
              <Select
                value={settings.terminalFontFamily || "'JetBrains Mono', 'Consolas', monospace"}
                onChange={(v) => updateSetting('terminalFontFamily', v)}
                options={[
                  { value: "'JetBrains Mono', 'Consolas', monospace", label: 'JetBrains Mono' },
                  { value: "'Consolas', monospace", label: 'Consolas' },
                  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
                  { value: "'Courier New', monospace", label: 'Courier New' },
                ]}
              />
            </Field>
            <Field label="Font Size">
              <Slider
                min={10}
                max={24}
                value={settings.terminalFontSize ?? 16}
                onChange={(v) => updateSetting('terminalFontSize', Math.round(v))}
                suffix="px"
              />
            </Field>
            <Field label="Scrollback Size" description="Number of lines kept in terminal history">
              <Slider
                min={1000}
                max={50000}
                step={1000}
                value={settings.scrollbackSize ?? 5000}
                onChange={(v) => updateSetting('scrollbackSize', Math.round(v))}
                suffix=" lines"
              />
            </Field>
            <Field label="Cursor Style">
              <Select
                value={settings.cursorStyle || 'block'}
                onChange={(v) => updateSetting('cursorStyle', v)}
                options={[
                  { value: 'block', label: 'Block' },
                  { value: 'underline', label: 'Underline' },
                  { value: 'bar', label: 'Bar' },
                ]}
              />
            </Field>
            <Field label="Cursor Blink">
              <Toggle
                checked={settings.cursorBlink ?? true}
                onChange={(v) => updateSetting('cursorBlink', v)}
                label="Blink cursor"
              />
            </Field>
            <Field label="Bell Sound">
              <Toggle
                checked={settings.bellSound ?? false}
                onChange={(v) => updateSetting('bellSound', v)}
                label="Play bell sound"
              />
            </Field>
            <Field label="Copy on Select">
              <Toggle
                checked={settings.copyOnSelect ?? false}
                onChange={(v) => updateSetting('copyOnSelect', v)}
                label="Copy text to clipboard on selection"
              />
            </Field>
            <Field label="Right-Click Paste">
              <Toggle
                checked={settings.rightClickPaste ?? true}
                onChange={(v) => updateSetting('rightClickPaste', v)}
                label="Paste from clipboard on right-click"
              />
            </Field>
          </SettingsSection>
        );

      case 'editor':
        return (
          <SettingsSection title="Editor" description="Code editor preferences">
            <Field label="Font Family">
              <Select
                value={settings.editorFontFamily || "'JetBrains Mono', 'Consolas', monospace"}
                onChange={(v) => updateSetting('editorFontFamily', v)}
                options={[
                  { value: "'JetBrains Mono', 'Consolas', monospace", label: 'JetBrains Mono' },
                  { value: "'Consolas', monospace", label: 'Consolas' },
                  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
                  { value: "'Courier New', monospace", label: 'Courier New' },
                ]}
              />
            </Field>
            <Field label="Font Size">
              <Slider
                min={10}
                max={24}
                value={settings.editorFontSize ?? 15}
                onChange={(v) => updateSetting('editorFontSize', Math.round(v))}
                suffix="px"
              />
            </Field>
            <Field label="Minimap">
              <Toggle
                checked={settings.editorMinimap ?? false}
                onChange={(v) => updateSetting('editorMinimap', v)}
                label="Show minimap in editor"
              />
            </Field>
            <Field label="Word Wrap">
              <Toggle
                checked={settings.editorWordWrap ?? false}
                onChange={(v) => updateSetting('editorWordWrap', v)}
                label="Wrap long lines"
              />
            </Field>
          </SettingsSection>
        );

      case 'filetree':
        return (
          <SettingsSection title="File Tree" description="Sidebar file explorer behavior">
            <Field label="Default State">
              <Toggle
                checked={settings.fileTreeOpen ?? true}
                onChange={(v) => updateSetting('fileTreeOpen', v)}
                label="Open file tree by default"
              />
            </Field>
            <Field label="Dotfiles">
              <Toggle
                checked={settings.showDotfiles ?? false}
                onChange={(v) => updateSetting('showDotfiles', v)}
                label="Show dotfiles in file tree"
              />
            </Field>
            <Field label="Dev Root Directories" description="One path per line. Git repos in these folders auto-appear on the dashboard.">
              <textarea
                rows={3}
                value={devRootsDraft}
                onChange={(e) => setDevRootsDraft(e.target.value)}
                onBlur={() => commitListSetting('devRoots', devRootsDraft)}
                className="settings-input font-mono resize-none"
                placeholder="C:\Dev"
              />
            </Field>
            <Field label="Hidden Projects" description="Folder names to hide (case-insensitive, one per line).">
              <textarea
                rows={3}
                value={skipListDraft}
                onChange={(e) => setSkipListDraft(e.target.value)}
                onBlur={() => commitListSetting('projectSkipList', skipListDraft)}
                className="settings-input font-mono resize-none"
                placeholder="Gym-App"
              />
            </Field>
          </SettingsSection>
        );

      case 'notifications':
        return (
          <SettingsSection title="Notifications" description="Desktop notification preferences">
            <Field label="Desktop Notifications">
              <Toggle
                checked={settings.desktopNotifications ?? true}
                onChange={(v) => updateSetting('desktopNotifications', v)}
                label="Enable desktop notifications"
              />
            </Field>
            <Field label="Notification Sound">
              <Toggle
                checked={settings.notificationSound ?? false}
                onChange={(v) => updateSetting('notificationSound', v)}
                label="Play sound on notification"
              />
            </Field>
            <Field label="Events" description="Choose which events trigger a notification">
              <div className="space-y-3 mt-1">
                <Toggle
                  checked={settings.notifyPrMerged ?? true}
                  onChange={(v) => updateSetting('notifyPrMerged', v)}
                  label="PR merged"
                />
                <Toggle
                  checked={settings.notifyBuildComplete ?? true}
                  onChange={(v) => updateSetting('notifyBuildComplete', v)}
                  label="Build complete"
                />
                <Toggle
                  checked={settings.notifySessionEnded ?? true}
                  onChange={(v) => updateSetting('notifySessionEnded', v)}
                  label="Session ended"
                />
                <Toggle
                  checked={settings.notifyFenceEvent ?? false}
                  onChange={(v) => updateSetting('notifyFenceEvent', v)}
                  label="Fence event"
                />
              </div>
            </Field>
            <Field label="Auto-Capture Sessions">
              <Toggle
                checked={settings.autoCaptureSessions ?? false}
                onChange={(v) => updateSetting('autoCaptureSessions', v)}
                label="Automatically capture session data"
              />
            </Field>
          </SettingsSection>
        );

      case 'telegram':
        return (
          <SettingsSection title="Telegram" description="Receive push notifications via Telegram bot">
            <Field label="Enable Telegram">
              <Toggle
                checked={settings.telegramEnabled ?? false}
                onChange={(v) => updateSetting('telegramEnabled', v)}
                label="Send notifications to Telegram"
              />
            </Field>
            <Field label="Bot Token" description="From @BotFather">
              <input
                type="password"
                value={settings.telegramBotToken || ''}
                onChange={(e) => updateSetting('telegramBotToken', e.target.value)}
                className="settings-input font-mono"
                placeholder="123456:ABC-DEF..."
                autoComplete="off"
              />
            </Field>
            <Field label="Chat ID" description="Your user or group chat ID">
              <input
                type="text"
                value={settings.telegramChatId || ''}
                onChange={(e) => updateSetting('telegramChatId', e.target.value)}
                className="settings-input font-mono"
                placeholder="123456789"
              />
            </Field>
            <Field label="Test Connection">
              <div className="flex items-center gap-3">
                <button onClick={testTelegram} className="settings-button">
                  Send Test Message
                </button>
                {telegramTestStatus && (
                  <span className={`text-xs font-mono ${
                    telegramTestStatus.startsWith('Sent') ? 'text-nock-green' : 'text-nock-red'
                  }`}>
                    {telegramTestStatus}
                  </span>
                )}
              </div>
            </Field>
            <Field label="Quiet Hours" description="Suppress notifications during this window">
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={settings.telegramQuietStart || '22:00'}
                  onChange={(e) => updateSetting('telegramQuietStart', e.target.value)}
                  className="settings-input font-mono w-32"
                />
                <span className="text-xs text-nock-text-dim">to</span>
                <input
                  type="time"
                  value={settings.telegramQuietEnd || '07:00'}
                  onChange={(e) => updateSetting('telegramQuietEnd', e.target.value)}
                  className="settings-input font-mono w-32"
                />
              </div>
            </Field>
            <Field label="Notification Events" description="Which events are forwarded to Telegram">
              <div className="space-y-3 mt-1">
                <Toggle
                  checked={settings.telegramNotifyPrMerged ?? true}
                  onChange={(v) => updateSetting('telegramNotifyPrMerged', v)}
                  label="PR merged"
                />
                <Toggle
                  checked={settings.telegramNotifyBuildComplete ?? true}
                  onChange={(v) => updateSetting('telegramNotifyBuildComplete', v)}
                  label="Build complete"
                />
                <Toggle
                  checked={settings.telegramNotifySessionEnded ?? true}
                  onChange={(v) => updateSetting('telegramNotifySessionEnded', v)}
                  label="Session ended"
                />
                <Toggle
                  checked={settings.telegramNotifyFenceEvent ?? false}
                  onChange={(v) => updateSetting('telegramNotifyFenceEvent', v)}
                  label="Fence event"
                />
              </div>
            </Field>
          </SettingsSection>
        );

      case 'shortcuts':
        return (
          <SettingsSection title="Keyboard Shortcuts" description="Global and in-app key bindings">
            <div className="bg-nock-card/40 border border-nock-border rounded-lg p-4">
              <div className="space-y-1">
                <Shortcut keys="Ctrl+T" action="New terminal tab" />
                <Shortcut keys="Ctrl+W" action="Close editor tab or split" />
                <Shortcut keys="Ctrl+B" action="Toggle sidebar" />
                <Shortcut keys="Ctrl+D" action="Dashboard" />
                <Shortcut keys="Ctrl+P" action="Quick file finder" />
                <Shortcut keys="Ctrl+1-9" action="Switch to tab N" />
                <Shortcut keys="Ctrl+Tab" action="Next tab" />
                <Shortcut keys="Ctrl+Shift+Tab" action="Previous tab" />
                <Shortcut keys="Ctrl+Shift+A" action="Toggle AI chat panel" />
                <Shortcut keys="Ctrl+Shift+D" action="Split terminal" />
                <Shortcut keys="Ctrl+Shift+T" action="Toggle window (global)" />
                <Shortcut keys="Ctrl+S" action="Save file (editor)" />
                <Shortcut keys="Ctrl+`" action="Focus terminal" />
                <Shortcut keys="F11" action="Fullscreen" />
              </div>
            </div>
          </SettingsSection>
        );

      case 'data':
        return (
          <SettingsSection title="Data Management" description="Export, import, or reset your configuration">
            <Field label="Export Settings" description="Download current settings as JSON">
              <button onClick={exportSettings} className="settings-button flex items-center gap-2">
                <Download size={14} />
                Export Settings
              </button>
            </Field>
            <Field label="Import Settings" description="Load settings from a JSON file">
              <button onClick={importSettings} className="settings-button flex items-center gap-2">
                <Upload size={14} />
                Import Settings
              </button>
            </Field>
            <Field label="Reset to Defaults" description="Restore all settings to factory defaults">
              <button onClick={resetDefaults} className="settings-button-danger flex items-center gap-2">
                <RotateCcw size={14} />
                Reset All Settings
              </button>
            </Field>
          </SettingsSection>
        );

      case 'about':
        return (
          <SettingsSection title="About" description="Nock Terminal information">
            <div className="bg-nock-card/40 border border-nock-border rounded-lg p-4">
              <InfoRow label="App Version" value={appVersion} mono />
              <InfoRow
                label="Ollama"
                value={ollamaVersion ? `v${ollamaVersion}` : 'Not connected'}
                mono
              />
              <InfoRow
                label="Models Installed"
                value={ollamaModels.length > 0
                  ? ollamaModels.map((m) => m.name || m).join(', ')
                  : 'None detected'}
                mono
              />
              <InfoRow label="Platform" value={navigator.platform} />
              <InfoRow
                label="Detected Shells"
                value={shells.length > 0 ? shells.map((s) => s.name).join(', ') : 'Detecting...'}
              />
            </div>
            <div className="bg-nock-card/40 border border-nock-border rounded-lg p-4 mt-4">
              <p className="text-xs text-nock-text-dim mb-3">Links</p>
              <div className="space-y-2">
                <button
                  onClick={() => window.nockTerminal.shell.openExternal('https://github.com/kkwills13/nock-command-center')}
                  className="settings-button flex items-center gap-2 w-full justify-start"
                >
                  <ExternalLink size={14} />
                  GitHub Repository
                </button>
                <button
                  onClick={() => window.nockTerminal.shell.openExternal('https://nocktechnologies.com')}
                  className="settings-button flex items-center gap-2 w-full justify-start"
                >
                  <ExternalLink size={14} />
                  Nock Technologies
                </button>
              </div>
            </div>
            <div className="mt-4 text-center">
              <p className="font-mono text-[10px] text-nock-text-muted tracking-wider">
                Nock Technologies (K Wills Technologies LLC)
              </p>
            </div>
          </SettingsSection>
        );

      default:
        return null;
    }
  };

  // -----------------------------------------------------------------------
  // Layout: VS Code-style sidebar + content
  // -----------------------------------------------------------------------
  return (
    <div className="flex h-full">
      {/* Left sidebar nav */}
      <div className="w-52 shrink-0 border-r border-nock-border bg-nock-bg-elevated/50 flex flex-col">
        {/* Header */}
        <div className="px-4 py-5 border-b border-nock-border">
          <span className="font-mono text-[10px] text-nock-accent-cyan tracking-widest uppercase block mb-1">
            // Configuration
          </span>
          <h1 className="font-display font-bold text-lg tracking-tight leading-none text-nock-text">
            Settings
          </h1>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-xs transition-colors ${
                activeSection === id
                  ? 'text-nock-text bg-nock-accent-blue/10 border-r-2 border-nock-accent-blue'
                  : 'text-nock-text-dim hover:text-nock-text hover:bg-nock-card/50'
              }`}
            >
              <Icon size={14} className={activeSection === id ? 'text-nock-accent-blue' : ''} />
              {label}
            </button>
          ))}
        </nav>

        {/* Save indicator */}
        {saved && (
          <div className="px-4 py-2 border-t border-nock-border">
            <span className="font-mono text-[10px] text-nock-green tracking-wider uppercase animate-fade-in">
              Saved
            </span>
          </div>
        )}
      </div>

      {/* Right content panel */}
      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl">
        {renderSection()}
      </div>
    </div>
  );
}

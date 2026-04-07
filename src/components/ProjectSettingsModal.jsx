import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, FolderOpen, Check } from 'lucide-react';

// ---------------------------------------------------------------------------
// Field wrapper — mirrors the Settings.jsx pattern
// ---------------------------------------------------------------------------
function Field({ label, description, children }) {
  return (
    <div className="mb-3">
      <label className="block font-mono text-[11px] font-medium text-nock-text mb-0.5 tracking-wider uppercase">
        {label}
      </label>
      {description && (
        <p className="text-[10px] text-nock-text-muted mb-1 font-mono tracking-tight">{description}</p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectSettingsModal
// ---------------------------------------------------------------------------
export default function ProjectSettingsModal({ projectPath, projectName, onClose }) {
  const [profile, setProfile] = useState(null);
  const [saved, setSaved] = useState(false);
  const savedTimeout = useRef(null);
  const cardRef = useRef(null);

  // Load profile on mount / when projectPath changes
  useEffect(() => {
    if (!projectPath) return;
    window.nockTerminal.profiles
      .get(projectPath)
      .then((p) => setProfile(p))
      .catch((err) => console.error('[ProjectSettingsModal] load error:', err));
  }, [projectPath]);

  // Flash the "Saved" indicator
  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    savedTimeout.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  // Persist on every field change
  const updateField = useCallback(
    (key, value) => {
      setProfile((prev) => {
        const next = { ...prev, [key]: value };
        window.nockTerminal.profiles
          .save(projectPath, next)
          .then(() => flashSaved())
          .catch((err) => console.error('[ProjectSettingsModal] save error:', err));
        return next;
      });
    },
    [projectPath, flashSaved]
  );

  // Close when clicking the backdrop (outside the card)
  const handleBackdropClick = useCallback(
    (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        onClose();
      }
    },
    [onClose]
  );

  // Escape key closes
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!profile) return null;

  const displayName = projectName || projectPath.split(/[\\/]/).pop() || 'Project';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div
        ref={cardRef}
        className="bg-nock-bg border border-nock-border rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nock-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-nock-accent-blue shrink-0" />
              <h2 className="font-display font-semibold text-sm text-nock-text truncate">
                {displayName}
              </h2>
              {saved && (
                <span className="flex items-center gap-1 text-[10px] text-green-400 font-mono shrink-0">
                  <Check size={12} /> Saved
                </span>
              )}
            </div>
            <p className="text-[10px] text-nock-text-muted font-mono mt-0.5 truncate">
              {projectPath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-nock-card text-nock-text-muted hover:text-nock-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- Body (scrollable) ---- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          <Field label="Preferred AI Model" description="Model to use for this project's AI chat sessions">
            <input
              type="text"
              className="settings-input font-mono"
              placeholder="e.g., qwen3.5:9b"
              value={profile.preferredModel}
              onChange={(e) => updateField('preferredModel', e.target.value)}
            />
          </Field>

          <Field label="System Prompt" description="Custom system prompt prepended to AI conversations">
            <textarea
              className="settings-input font-mono resize-none"
              rows={3}
              placeholder="You are a helpful assistant for this project..."
              value={profile.systemPrompt}
              onChange={(e) => updateField('systemPrompt', e.target.value)}
            />
          </Field>

          <Field label="Default Shell" description="Override the global default shell for this project">
            <input
              type="text"
              className="settings-input font-mono"
              placeholder="Auto-detect"
              value={profile.defaultShell}
              onChange={(e) => updateField('defaultShell', e.target.value)}
            />
          </Field>

          <Field label="Environment Variables" description="Extra env vars injected into terminals (KEY=VALUE, one per line)">
            <textarea
              className="settings-input font-mono resize-none"
              rows={3}
              placeholder={"API_KEY=xxx\nNODE_ENV=development"}
              value={profile.envVars}
              onChange={(e) => updateField('envVars', e.target.value)}
            />
          </Field>

          <Field label="Claude Code Command" description="Custom command to launch Claude Code for this project">
            <input
              type="text"
              className="settings-input font-mono"
              placeholder="claude --dangerously-skip-permissions"
              value={profile.claudeCommand}
              onChange={(e) => updateField('claudeCommand', e.target.value)}
            />
          </Field>

          <Field label="Notes" description="Free-form notes about this project">
            <textarea
              className="settings-input font-mono resize-none"
              rows={4}
              placeholder="Architecture notes, deployment tips, etc."
              value={profile.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

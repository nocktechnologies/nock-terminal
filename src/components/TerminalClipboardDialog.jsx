import React, { useEffect } from 'react';
import { Copy as CopyIcon } from 'lucide-react';

export default function TerminalClipboardDialog({ text, source, onCancel, onConfirm }) {
  useEffect(() => {
    const cancel = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terminal-clipboard-dialog-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-nock-border bg-nock-card shadow-xl">
        <div className="border-b border-nock-border px-4 py-3">
          <h2 id="terminal-clipboard-dialog-title" className="text-sm font-semibold text-nock-text">
            Terminal clipboard request
          </h2>
          <p className="mt-1 truncate text-xs text-nock-text-dim" title={source}>
            Source: {source}
          </p>
        </div>
        <div className="px-4 py-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-nock-border bg-nock-bg p-3 text-xs text-nock-text">
            {text.slice(0, 2000)}
            {text.length > 2000 ? '\n…' : ''}
          </pre>
          <p className="mt-2 text-[11px] text-nock-text-dim">
            {text.length.toLocaleString()} characters
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-nock-border px-4 py-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded border border-nock-border px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded bg-nock-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-nock-accent-purple"
          >
            <CopyIcon size={13} aria-hidden="true" />
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

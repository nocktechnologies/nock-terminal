import React, { useState, useEffect } from 'react';

function joinProjectPath(basePath, relativePath) {
  const separator = basePath.includes('\\') ? '\\' : '/';
  const cleanBase = basePath.replace(/[\\/]+$/, '');
  const cleanRelative = relativePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
  return `${cleanBase}${separator}${cleanRelative}`;
}

export default function ContextMonitor({ projectPath, onEditFile }) {
  const [claudeMd, setClaudeMd] = useState(null);
  const [nockConfig, setNockConfig] = useState(null);

  useEffect(() => {
    if (!projectPath) return;

    const check = async () => {
      const claudePath = joinProjectPath(projectPath, 'CLAUDE.md');
      const nockPath = joinProjectPath(projectPath, '.nock/config.toml');
      const [c, n] = await Promise.all([
        window.nockTerminal.files.stat(claudePath),
        window.nockTerminal.files.stat(nockPath),
      ]);
      setClaudeMd({ ...c, path: claudePath });
      setNockConfig({ ...n, path: nockPath });
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [projectPath]);

  const formatTime = (ms) => {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}KB`;
  };

  return (
    <div className="px-3 py-2">
      <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest mb-2 block">
        // Context
      </span>
      <ContextRow
        label="CLAUDE.md"
        stat={claudeMd}
        onEdit={() => claudeMd?.exists && onEditFile(claudeMd.path)}
        formatTime={formatTime}
        formatSize={formatSize}
      />
      <ContextRow
        label=".nock/config.toml"
        stat={nockConfig}
        onEdit={() => nockConfig?.exists && onEditFile(nockConfig.path)}
        formatTime={formatTime}
        formatSize={formatSize}
      />
    </div>
  );
}

function ContextRow({ label, stat, onEdit, formatTime, formatSize }) {
  if (!stat) return null;
  return (
    <div className="flex items-center gap-1.5 py-1 group">
      <span className={`text-[10px] ${stat.exists ? 'text-nock-green' : 'text-red-400'}`}>
        {stat.exists ? '✓' : '✗'}
      </span>
      <span className="text-[9px] text-nock-text-dim flex-1 truncate">{label}</span>
      {stat.exists && (
        <>
          <span className="font-mono text-[8px] text-nock-text-muted">{formatSize(stat.size)}</span>
          <span className="font-mono text-[8px] text-nock-text-muted">{formatTime(stat.mtime)}</span>
          <button
            onClick={onEdit}
            className="text-[8px] text-nock-accent-blue opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';

function joinProjectPath(basePath, relativePath) {
  const separator = basePath.includes('\\') ? '\\' : '/';
  const cleanBase = basePath.replace(/[\\/]+$/, '');
  const cleanRelative = relativePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
  return `${cleanBase}${separator}${cleanRelative}`;
}

function getParentPath(currentPath) {
  const normalized = currentPath.replace(/[\\/]+$/, '');
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));

  if (lastSeparatorIndex <= 0) {
    return null;
  }

  const parent = normalized.slice(0, lastSeparatorIndex);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }

  return parent || null;
}

async function findNearestContextFile(projectPath, relativePaths, maxDepth = 5) {
  let currentPath = projectPath;

  for (let depth = 0; depth <= maxDepth && currentPath; depth += 1) {
    const candidatePaths = relativePaths.map((relativePath) => joinProjectPath(currentPath, relativePath));
    const stats = await Promise.all(candidatePaths.map((candidatePath) => window.nockTerminal.files.stat(candidatePath)));
    const existingIndex = stats.findIndex((stat) => stat?.exists);

    if (existingIndex !== -1) {
      return { ...stats[existingIndex], path: candidatePaths[existingIndex] };
    }

    const parentPath = getParentPath(currentPath);
    if (!parentPath || parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return {
    exists: false,
    size: 0,
    mtime: 0,
    path: joinProjectPath(projectPath, relativePaths[0]),
  };
}

export default function ContextMonitor({ projectPath, onEditFile }) {
  const [claudeMd, setClaudeMd] = useState(null);
  const [nockConfig, setNockConfig] = useState(null);

  useEffect(() => {
    if (!projectPath) return;

    const check = async () => {
      const [claudeStat, nockStat] = await Promise.all([
        findNearestContextFile(projectPath, ['CLAUDE.md', '.claude/CLAUDE.md']),
        findNearestContextFile(projectPath, ['.nock/config.toml']),
      ]);
      setClaudeMd(claudeStat);
      setNockConfig(nockStat);
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
